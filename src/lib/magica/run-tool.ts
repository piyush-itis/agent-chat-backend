import { Prisma } from "@prisma/client";
import { settleToolCharge } from "@/lib/credits";
import { usesTriggerDispatch } from "@/lib/dispatch";
import { jsonError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import type { ToolContext } from "@/lib/registry";
import { HEARTBEAT_MS, touchAgentRunLease } from "@/lib/run-lease";
import { copyToDurableStorage } from "@/lib/storage";
import { magicaRunTask } from "@/trigger/magica-run";
import { mapMagicaCredits, pollNodeRun, readMagicaCreditUsed, startNodeRun, type MagicaRun } from "./client";

export async function runMagicaTool(input: {
  ctx: ToolContext;
  toolName: string;
  nodeType: string;
  subModelId?: string;
  providerInput: Record<string, unknown>;
  kind: "image" | "video";
}): Promise<{
  url: string;
  urls: string[];
  providerRunId: string;
  creditCost: number;
  creditUsed: number;
  status: "completed" | "failed" | "cancelled";
}> {
  const completionKey = `${input.ctx.runId}:${input.ctx.toolCallId}`;
  const existing = await prisma.toolInvocation.findUnique({ where: { completionKey } });
  if (existing?.status === "completed" && existing.output) {
    return completedInvocationResult(existing);
  }

  const reusable = !existing
    ? await prisma.toolInvocation.findFirst({
        where: {
          runId: input.ctx.runId,
          toolName: input.toolName,
          status: { in: ["running", "completed"] },
        },
        orderBy: { startedAt: "desc" },
      })
    : null;
  if (reusable?.status === "completed" && reusable.output) {
    return completedInvocationResult(reusable);
  }

  const invocation =
    existing ??
    (reusable?.status === "running" ? reusable : null) ??
    (await prisma.toolInvocation.create({
      data: {
        runId: input.ctx.runId,
        chatId: input.ctx.chatId,
        toolName: input.toolName,
        provider: "magica",
        status: "running",
        input: input.providerInput as Prisma.InputJsonValue,
        completionKey,
        startedAt: new Date(),
      },
    }));

  let started: { runId: string };
  try {
    started = invocation.providerRunId
      ? { runId: invocation.providerRunId }
      : await startNodeRun({
          nodeType: input.nodeType,
          subModelId: input.subModelId,
          input: input.providerInput,
        });
  } catch (error) {
    await failInvocation(invocation.id, error);
    throw error;
  }

  await prisma.toolInvocation.update({
    where: { id: invocation.id },
    data: { providerRunId: started.runId, status: "running" },
  });

  const run = await waitForMagicaRun({
    providerRunId: started.runId,
    parentRunId: input.ctx.runId,
    completionKey: invocation.completionKey,
  });
  const finished = await prisma.toolInvocation.findUnique({ where: { id: invocation.id } });
  if (finished?.status === "completed" && finished.output) {
    return completedInvocationResult(finished);
  }
  if (run.status === "FAILED") {
    const message = run.userMessage ?? run.error ?? "Magica run failed";
    await failInvocation(invocation.id, jsonError(502, "PROVIDER_ERROR", message));
    throw jsonError(502, "PROVIDER_ERROR", message);
  }
  if (run.status === "CANCELED") {
    await prisma.toolInvocation.update({
      where: { id: invocation.id },
      data: { status: "cancelled", finishedAt: new Date(), errorSafeMessage: "Cancelled" },
    });
    throw jsonError(409, "CANCELLED", "Magica run was cancelled");
  }

  const urls = extractMediaUrls(run);
  if (urls.length === 0) {
    await failInvocation(invocation.id, jsonError(502, "PROVIDER_ERROR", "Magica returned no media"));
    throw jsonError(502, "PROVIDER_ERROR", "Magica returned no media");
  }

  const creditUsed = readMagicaCreditUsed(run);
  const creditCost = mapMagicaCredits(creditUsed);
  const finishedAt = new Date();
  await prisma.toolInvocation.update({
    where: { id: invocation.id },
    data: {
      status: "completed",
      output: { url: urls[0], urls, creditUsed } as Prisma.InputJsonValue,
      finishedAt,
      durationMs: invocation.startedAt ? finishedAt.getTime() - invocation.startedAt.getTime() : null,
    },
  });

  const durableUrl = await copyToDurableStorage(
    urls[0],
    `generated/${input.ctx.runId}/${invocation.id}`,
  );
  await prisma.generatedAsset.create({
    data: {
      runId: input.ctx.runId,
      toolInvocationId: invocation.id,
      kind: input.kind,
      url: urls[0],
      durableUrl,
      provider: "magica",
    },
  });

  await settleToolCharge({
    userId: input.ctx.userId,
    runId: input.ctx.runId,
    invocationId: invocation.id,
    amount: creditCost,
  });

  return { url: urls[0], urls, providerRunId: started.runId, creditCost, creditUsed, status: "completed" };
}

export async function waitForMagicaRun(input: {
  providerRunId: string;
  parentRunId: string;
  completionKey: string;
}): Promise<MagicaRun> {
  const beat = setInterval(() => {
    void touchAgentRunLease(input.parentRunId).catch(() => undefined);
  }, HEARTBEAT_MS);
  void touchAgentRunLease(input.parentRunId).catch(() => undefined);
  try {
    if (usesTriggerDispatch()) {
      const result = await magicaRunTask.triggerAndWait(
        { providerRunId: input.providerRunId, parentRunId: input.parentRunId },
        { idempotencyKey: input.completionKey },
      );
      if (result.ok) return normalizeMagicaRun(result.output);
      const message = result.error instanceof Error ? result.error.message : "Magica child task failed";
      throw jsonError(502, "PROVIDER_ERROR", message);
    }

    return await pollNodeRun(input.providerRunId, {
      shouldAbort: async () => {
        const current = await prisma.agentRun.findUnique({ where: { id: input.parentRunId } });
        return current?.status === "stopping" || current?.status === "cancelled";
      },
      onTick: () => touchAgentRunLease(input.parentRunId),
    });
  } finally {
    clearInterval(beat);
  }
}

function completedInvocationResult(invocation: {
  providerRunId?: string | null;
  creditCost: number;
  output: unknown;
}) {
  const output = invocation.output as { url?: string; urls?: string[]; creditUsed?: number };
  return {
    url: output.url ?? output.urls?.[0] ?? "",
    urls: output.urls ?? (output.url ? [output.url] : []),
    providerRunId: invocation.providerRunId ?? "",
    creditCost: invocation.creditCost,
    creditUsed: typeof output.creditUsed === "number" ? output.creditUsed : 0,
    status: "completed" as const,
  };
}

export function extractMediaUrls(run: MagicaRun): string[] {
  const record = run as MagicaRun & { response?: unknown };
  const bags = [record.output, record.response, record];
  const urls: string[] = [];
  for (const bag of bags) {
    collectMediaUrls(bag, urls);
  }
  return [...new Set(urls.filter((url) => /^https?:\/\//.test(url)))];
}

function normalizeMagicaRun(value: unknown): MagicaRun {
  if (!value || typeof value !== "object") {
    throw jsonError(502, "PROVIDER_ERROR", "Magica child task returned empty output");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.status === "string") return value as MagicaRun;
  const nested = record.output;
  if (nested && typeof nested === "object" && typeof (nested as MagicaRun).status === "string") {
    return nested as MagicaRun;
  }
  if (record.result || record.images || record.urls) {
    return { id: "", status: "COMPLETED", output: value };
  }
  return value as MagicaRun;
}

function collectMediaUrls(value: unknown, urls: string[], depth = 0) {
  if (value == null || depth > 4) return;
  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    if (parsed !== undefined) {
      collectMediaUrls(parsed, urls, depth + 1);
      return;
    }
    if (/^https?:\/\//.test(value)) urls.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMediaUrls(item, urls, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const key of ["image_url", "video_url", "url", "result"]) {
    collectMediaUrls(record[key], urls, depth + 1);
  }
  for (const key of ["images", "videos", "urls", "assets"]) {
    collectMediaUrls(record[key], urls, depth + 1);
  }
}

function tryParseJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

async function failInvocation(id: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Tool failed";
  await prisma.toolInvocation.update({
    where: { id },
    data: {
      status: "failed",
      errorSafeMessage: message,
      finishedAt: new Date(),
    },
  });
}
