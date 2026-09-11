import { randomBytes } from "node:crypto";
import { Prisma, type WaitpointKind } from "@prisma/client";
import { LIMITS } from "@/contracts/limits";
import {
  sessionSnapshotSchema,
  waitpointPayloadSchema,
  type SessionSnapshot,
  type Waitpoint as WaitpointDto,
  type WaitpointPayload,
} from "@/contracts/api";
import { prisma } from "./db";
import { jsonError } from "./errors";
import { dispatchAgentTurn } from "./dispatch";

export class WaitpointPause extends Error {
  constructor(public token: string) {
    super("WAITPOINT_PAUSE");
    this.name = "WaitpointPause";
  }
}

export class RunStopped extends Error {
  constructor() {
    super("RUN_STOPPED");
    this.name = "RunStopped";
  }
}

export function parseSnapshot(raw: unknown): SessionSnapshot {
  const parsed = sessionSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : { version: 1 };
}

export function extractChoices(text: string): { id: string; label: string }[] {
  const choices: { id: string; label: string }[] = [];
  for (const line of text.split("\n")) {
    const match = line.trim().match(/^(?:[-*]|\d+[.)])\s+(.+)/);
    if (!match?.[1]) continue;
    choices.push({ id: String(choices.length + 1), label: match[1].slice(0, 200) });
    if (choices.length >= 6) break;
  }
  return choices;
}

export function waitpointKindForPlan(text: string): { kind: WaitpointKind; payload: WaitpointPayload } {
  const choices = extractChoices(text);
  const summary = text.trim().slice(0, 2000) || "Review the proposed plan before tools run.";
  if (choices.length >= 2) {
    return {
      kind: "options",
      payload: {
        title: "Choose how to continue",
        summary,
        choices,
      },
    };
  }
  return {
    kind: "plan",
    payload: {
      title: "Approve this plan",
      summary,
    },
  };
}

export function serializeWaitpoint(row: {
  id: string;
  token: string;
  runId: string;
  kind: WaitpointKind;
  payload: unknown;
  status: string;
  resumeKey: string;
  expiresAt: Date;
  createdAt: Date;
}): WaitpointDto {
  const payload = waitpointPayloadSchema.safeParse(row.payload);
  return {
    id: row.id,
    token: row.token,
    runId: row.runId,
    kind: row.kind,
    payload: payload.success
      ? payload.data
      : { title: "Approval needed", summary: "Continue this run from the overlay." },
    status: row.status as WaitpointDto["status"],
    resumeKey: row.resumeKey,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function expireOpenWaitpoints(runId: string): Promise<number> {
  const result = await prisma.waitpoint.updateMany({
    where: { runId, status: "open", expiresAt: { lt: new Date() } },
    data: { status: "expired" },
  });
  if (result.count > 0) {
    await prisma.agentRun.update({
      where: { id: runId },
      data: {
        errorCode: "WAITPOINT_EXPIRED",
        errorSafeMessage: "This approval expired. Send a new message to continue later.",
      },
    });
  }
  return result.count;
}

export async function findOpenWaitpoint(runId: string) {
  await expireOpenWaitpoints(runId);
  return prisma.waitpoint.findFirst({
    where: { runId, status: "open" },
    orderBy: { createdAt: "desc" },
  });
}

export async function mergeSnapshot(runId: string, patch: Partial<SessionSnapshot>) {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run) return;
  const current = parseSnapshot(run.sessionSnapshot);
  const next: SessionSnapshot = { ...current, ...patch, version: 1 };
  await prisma.agentRun.update({
    where: { id: runId },
    data: { sessionSnapshot: next as Prisma.InputJsonValue },
  });
}

export async function createWaitpoint(input: {
  runId: string;
  kind: WaitpointKind;
  payload: WaitpointPayload;
  snapshot?: Partial<SessionSnapshot>;
  ttlMinutes?: number;
}): Promise<{ token: string; resumeKey: string }> {
  const payload = waitpointPayloadSchema.parse(input.payload);
  const token = randomBytes(16).toString("hex");
  const resumeKey = randomBytes(24).toString("hex");
  const expiresAt = new Date(
    Date.now() + (input.ttlMinutes ?? LIMITS.waitpointTtlMinutes) * 60_000,
  );

  await prisma.$transaction(async (tx) => {
    await tx.waitpoint.create({
      data: {
        token,
        resumeKey,
        runId: input.runId,
        kind: input.kind,
        payload: payload as Prisma.InputJsonValue,
        expiresAt,
      },
    });
    const run = await tx.agentRun.findUnique({ where: { id: input.runId } });
    const snapshot: SessionSnapshot = {
      ...parseSnapshot(run?.sessionSnapshot),
      ...input.snapshot,
      version: 1,
    };
    await tx.agentRun.update({
      where: { id: input.runId },
      data: {
        status: "waiting",
        sessionSnapshot: snapshot as Prisma.InputJsonValue,
        errorCode: null,
        errorSafeMessage: null,
      },
    });
  });

  return { token, resumeKey };
}

export async function pauseForWaitpoint(input: {
  runId: string;
  kind: WaitpointKind;
  payload: WaitpointPayload;
  snapshot?: Partial<SessionSnapshot>;
}): Promise<never> {
  const created = await createWaitpoint(input);
  throw new WaitpointPause(created.token);
}

export async function resumeWaitpoint(
  userId: string,
  runId: string,
  token: string,
  input: { resumeKey: string; decision: "approved" | "rejected"; choiceId?: string },
) {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run || run.userId !== userId) {
    throw jsonError(404, "NOT_FOUND", "Run not found");
  }

  await expireOpenWaitpoints(runId);
  const waitpoint = await prisma.waitpoint.findFirst({
    where: { token, runId },
  });
  if (!waitpoint) {
    throw jsonError(404, "NOT_FOUND", "Waitpoint not found");
  }
  if (waitpoint.resumeKey !== input.resumeKey) {
    throw jsonError(403, "FORBIDDEN", "Resume key does not match");
  }
  if (waitpoint.status === "expired") {
    throw jsonError(
      409,
      "WAITPOINT_EXPIRED",
      "This approval expired. Send a new message to continue later.",
    );
  }
  if (waitpoint.status === "approved" || waitpoint.status === "rejected") {
    return { waitpoint: serializeWaitpoint(waitpoint), alreadyApplied: true as const };
  }

  const snapshot = parseSnapshot(run.sessionSnapshot);
  const payload = waitpointPayloadSchema.safeParse(waitpoint.payload);
  const nextPayload = payload.success
    ? { ...payload.data, selectedChoiceId: input.choiceId }
    : { title: "Approval", summary: "", selectedChoiceId: input.choiceId };

  if (input.decision === "rejected") {
    await prisma.$transaction(async (tx) => {
      await tx.waitpoint.update({
        where: { id: waitpoint.id },
        data: { status: "rejected", payload: nextPayload as Prisma.InputJsonValue },
      });
    });
    const { finalizeCancelledRun } = await import("./finalize");
    await finalizeCancelledRun(runId, "The plan was rejected.");
    const closed = await prisma.waitpoint.findUniqueOrThrow({ where: { id: waitpoint.id } });
    return { waitpoint: serializeWaitpoint(closed), alreadyApplied: false as const };
  }

  const approvedCreditKeys = new Set(snapshot.approvedCreditKeys ?? []);
  const approvedMediaKeys = new Set(snapshot.approvedMediaKeys ?? []);
  for (const call of snapshot.pendingToolCalls ?? []) {
    if (waitpoint.kind === "credit") approvedCreditKeys.add(call.id);
    if (waitpoint.kind === "media") approvedMediaKeys.add(call.id);
  }

  await prisma.$transaction(async (tx) => {
    await tx.waitpoint.update({
      where: { id: waitpoint.id },
      data: { status: "approved", payload: nextPayload as Prisma.InputJsonValue },
    });
    await tx.agentRun.update({
      where: { id: runId },
      data: {
        status: "working",
        sessionSnapshot: {
          ...snapshot,
          planApproved: waitpoint.kind === "plan" || waitpoint.kind === "options" ? true : snapshot.planApproved,
          approvedCreditKeys: [...approvedCreditKeys],
          approvedMediaKeys: [...approvedMediaKeys],
          version: 1,
        } as Prisma.InputJsonValue,
      },
    });
  });

  await dispatchAgentTurn(runId, `${run.dispatchKey}:resume:${waitpoint.id}`);
  const closed = await prisma.waitpoint.findUniqueOrThrow({ where: { id: waitpoint.id } });
  return { waitpoint: serializeWaitpoint(closed), alreadyApplied: false as const };
}

export async function assertRunNotStopping(runId: string) {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run) return;
  if (run.status === "stopping" || run.status === "cancelled") {
    throw new RunStopped();
  }
}

export async function requestStop(userId: string, runId: string) {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run || run.userId !== userId) {
    throw jsonError(404, "NOT_FOUND", "Run not found");
  }
  if (["complete", "failed", "cancelled"].includes(run.status)) {
    return run;
  }
  return prisma.agentRun.update({
    where: { id: runId },
    data: { status: "stopping" },
  });
}
