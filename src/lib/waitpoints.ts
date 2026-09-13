import { randomBytes } from "node:crypto";
import { Prisma, type WaitpointKind, type WaitpointStatus } from "@prisma/client";
import { LIMITS } from "@/contracts/limits";
import {
  sessionSnapshotSchema,
  waitpointKindSchema,
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

type WaitpointRow = {
  id: string;
  token: string;
  runId: string;
  kind: string;
  payload: unknown;
  status: string;
  resumeKey: string;
  expiresAt: Date | string;
  createdAt: Date | string;
};

function coerceDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function parseWaitpointPayload(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

export function serializeWaitpoint(row: WaitpointRow): WaitpointDto {
  const payload = waitpointPayloadSchema.safeParse(parseWaitpointPayload(row.payload));
  const kind = waitpointKindSchema.safeParse(row.kind);
  return {
    id: row.id,
    token: row.token,
    runId: row.runId,
    kind: kind.success ? kind.data : "plan",
    payload: payload.success
      ? payload.data
      : { title: "Approval needed", summary: "Continue this run from the overlay." },
    status: row.status as WaitpointDto["status"],
    resumeKey: row.resumeKey,
    expiresAt: coerceDate(row.expiresAt).toISOString(),
    createdAt: coerceDate(row.createdAt).toISOString(),
  };
}

async function readWaitpointRows(sql: ReturnType<typeof Prisma.sql>): Promise<WaitpointRow[]> {
  return prisma.$queryRaw<WaitpointRow[]>(sql);
}

async function readOpenWaitpoint(runId: string) {
  const rows = await readWaitpointRows(Prisma.sql`
    SELECT id, token, "runId", kind::text AS kind, payload, status::text AS status,
           "resumeKey", "expiresAt", "createdAt"
    FROM "Waitpoint"
    WHERE "runId" = ${runId} AND status::text = 'open'
    ORDER BY "createdAt" DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function readWaitpointByToken(runId: string, token: string) {
  const rows = await readWaitpointRows(Prisma.sql`
    SELECT id, token, "runId", kind::text AS kind, payload, status::text AS status,
           "resumeKey", "expiresAt", "createdAt"
    FROM "Waitpoint"
    WHERE "runId" = ${runId} AND token = ${token}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function readWaitpointById(id: string) {
  const rows = await readWaitpointRows(Prisma.sql`
    SELECT id, token, "runId", kind::text AS kind, payload, status::text AS status,
           "resumeKey", "expiresAt", "createdAt"
    FROM "Waitpoint"
    WHERE id = ${id}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function casWaitpointStatus(id: string, status: string, payload: unknown): Promise<boolean> {
  const updated = await prisma.$executeRaw`
    UPDATE "Waitpoint"
    SET status = CAST(${status} AS "WaitpointStatus"),
        payload = CAST(${JSON.stringify(payload)} AS jsonb)
    WHERE id = ${id} AND status::text = 'open'
  `;
  return updated === 1;
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

export async function unlockExpiredWaitpointRuns(limit = 50): Promise<number> {
  const stale = await prisma.agentRun.findMany({
    where: {
      status: "waiting",
      waitpoints: { none: { status: "open" } },
    },
    take: limit,
  });
  if (stale.length === 0) return 0;
  const { finalizeRun } = await import("./finalize");
  let unlocked = 0;
  for (const run of stale) {
    await expireOpenWaitpoints(run.id);
    await finalizeRun(run.id, {
      status: "failed",
      messageStatus: "failed",
      errorCode: "WAITPOINT_EXPIRED",
      errorSafeMessage: "This approval expired. Send a new message to continue later.",
    });
    unlocked += 1;
  }
  return unlocked;
}

export async function findOpenWaitpoint(runId: string) {
  try {
    await expireOpenWaitpoints(runId);
  } catch {
    /* stale Prisma enum clients still need to read the open row */
  }
  const row = await readOpenWaitpoint(runId);
  if (!row) return null;
  return {
    ...row,
    kind: row.kind as WaitpointKind,
    status: row.status as WaitpointStatus,
    payload: row.payload as Prisma.JsonValue,
    expiresAt: coerceDate(row.expiresAt),
    createdAt: coerceDate(row.createdAt),
  };
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
    await tx.waitpoint.updateMany({
      where: { runId: input.runId, status: "open" },
      data: { status: "expired" },
    });
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
  input: {
    resumeKey: string;
    decision: "approved" | "rejected";
    choiceId?: string;
    answers?: Record<string, string>;
  },
) {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run || run.userId !== userId) {
    throw jsonError(404, "NOT_FOUND", "Run not found");
  }

  try {
    await expireOpenWaitpoints(runId);
  } catch {
    /* continue — the raw read below is the source of truth */
  }
  const waitpoint = await readWaitpointByToken(runId, token);
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
  const payload = waitpointPayloadSchema.safeParse(parseWaitpointPayload(waitpoint.payload));
  const answeredQuestions = payload.success
    ? (payload.data.questions ?? []).map((question) => ({
        ...question,
        answer: input.answers?.[question.id] ?? question.answer ?? "",
      }))
    : [];
  const nextPayload = payload.success
    ? {
        ...payload.data,
        selectedChoiceId: input.choiceId,
        questions: payload.data.questions ? answeredQuestions : payload.data.questions,
      }
    : { title: "Approval", summary: "", selectedChoiceId: input.choiceId };

  if (input.decision === "rejected") {
    const claimed = await casWaitpointStatus(waitpoint.id, "rejected", nextPayload);
    if (!claimed) {
      return alreadyResolved(waitpoint.id);
    }
    const { finalizeCancelledRun } = await import("./finalize");
    await finalizeCancelledRun(runId, "The plan was rejected.");
    const closed = await readWaitpointById(waitpoint.id);
    if (!closed) throw jsonError(404, "NOT_FOUND", "Waitpoint not found");
    return { waitpoint: serializeWaitpoint(closed), alreadyApplied: false as const };
  }

  const approvedCreditKeys = new Set(snapshot.approvedCreditKeys ?? []);
  const approvedMediaKeys = new Set(snapshot.approvedMediaKeys ?? []);
  const questionAnswers = { ...(snapshot.questionAnswers ?? {}) };
  for (const call of snapshot.pendingToolCalls ?? []) {
    if (waitpoint.kind === "credit") approvedCreditKeys.add(call.id);
    if (waitpoint.kind === "media") approvedMediaKeys.add(call.id);
    if (waitpoint.kind === "questions" && call.name === "ask_questions") {
      questionAnswers[call.id] = Object.fromEntries(
        answeredQuestions.map((question) => [question.id, question.answer ?? ""]),
      );
    }
  }

  const claimed = await prisma.$transaction(async (tx) => {
    const updated = await tx.$executeRaw`
      UPDATE "Waitpoint"
      SET status = CAST(${"approved"} AS "WaitpointStatus"),
          payload = CAST(${JSON.stringify(nextPayload)} AS jsonb)
      WHERE id = ${waitpoint.id} AND status::text = 'open'
    `;
    if (updated !== 1) return false;
    await tx.agentRun.update({
      where: { id: runId },
      data: {
        status: "working",
        sessionSnapshot: {
          ...snapshot,
          planApproved: waitpoint.kind === "plan" || waitpoint.kind === "options" ? true : snapshot.planApproved,
          approvedCreditKeys: [...approvedCreditKeys],
          approvedMediaKeys: [...approvedMediaKeys],
          questionAnswers,
          version: 1,
        } as Prisma.InputJsonValue,
      },
    });
    return true;
  });
  if (!claimed) {
    return alreadyResolved(waitpoint.id);
  }

  await dispatchAgentTurn(runId, `${run.dispatchKey}:resume:${waitpoint.id}`);
  const closed = await readWaitpointById(waitpoint.id);
  if (!closed) throw jsonError(404, "NOT_FOUND", "Waitpoint not found");
  return { waitpoint: serializeWaitpoint(closed), alreadyApplied: false as const };
}

async function alreadyResolved(id: string) {
  const current = await readWaitpointById(id);
  if (current && (current.status === "approved" || current.status === "rejected")) {
    return { waitpoint: serializeWaitpoint(current), alreadyApplied: true as const };
  }
  throw jsonError(409, "CONFLICT", "This waitpoint was already resolved.");
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
