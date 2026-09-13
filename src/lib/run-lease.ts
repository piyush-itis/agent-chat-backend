import { randomUUID } from "node:crypto";
import { prisma } from "./db";

export const LEASE_MS = 90_000;
export const HEARTBEAT_MS = 15_000;

export class LostLease extends Error {
  constructor() {
    super("LOST_LEASE");
    this.name = "LostLease";
  }
}

export function dispatchKeyForAttempt(dispatchKey: string, attempt: number): string {
  return attempt <= 1 ? dispatchKey : `${dispatchKey}:g${attempt}`;
}

export async function claimAgentRun(runId: string, leaseId: string = randomUUID()): Promise<string | null> {
  const now = new Date();
  const until = new Date(now.getTime() + LEASE_MS);
  const updated = await prisma.$executeRaw`
    UPDATE "AgentRun"
    SET "leaseId" = ${leaseId},
        "leaseUntil" = ${until},
        "lastHeartbeatAt" = ${now}
    WHERE id = ${runId}
      AND status IN (
        'queued'::"AgentRunStatus",
        'thinking'::"AgentRunStatus",
        'working'::"AgentRunStatus",
        'stopping'::"AgentRunStatus"
      )
      AND ("leaseUntil" IS NULL OR "leaseUntil" < ${now})
  `;
  return updated === 1 ? leaseId : null;
}

export async function heartbeatAgentRun(runId: string, leaseId: string): Promise<boolean> {
  const now = new Date();
  const until = new Date(now.getTime() + LEASE_MS);
  const updated = await prisma.$executeRaw`
    UPDATE "AgentRun"
    SET "leaseUntil" = ${until},
        "lastHeartbeatAt" = ${now}
    WHERE id = ${runId} AND "leaseId" = ${leaseId}
  `;
  return updated === 1;
}

export async function releaseLease(runId: string, leaseId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "AgentRun"
    SET "leaseId" = NULL, "leaseUntil" = NULL
    WHERE id = ${runId} AND "leaseId" = ${leaseId}
  `;
}

export async function bumpDispatchAttempt(runId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ dispatchAttempt: number }[]>`
    UPDATE "AgentRun"
    SET "dispatchAttempt" = "dispatchAttempt" + 1
    WHERE id = ${runId}
    RETURNING "dispatchAttempt"
  `;
  return rows[0]?.dispatchAttempt ?? 1;
}

export async function persistTriggerRunId(runId: string, triggerRunId: string): Promise<void> {
  await prisma.agentRun.update({
    where: { id: runId },
    data: { triggerRunId },
  });
}
