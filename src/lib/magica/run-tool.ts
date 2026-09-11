import { Prisma } from "@prisma/client";
import { settleToolCharge } from "@/lib/credits";
import { jsonError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import type { ToolContext } from "@/lib/registry";
import { copyToDurableStorage } from "@/lib/storage";
import { mapMagicaCredits, pollNodeRun, startNodeRun, type MagicaRun } from "./client";

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
  status: "completed" | "failed" | "cancelled";
}> {
  const completionKey = `${input.ctx.runId}:${input.ctx.toolCallId}`;
  const existing = await prisma.toolInvocation.findUnique({ where: { completionKey } });
  if (existing?.status === "completed" && existing.output) {
    const output = existing.output as { url?: string; urls?: string[] };
    return {
      url: output.url ?? output.urls?.[0] ?? "",
      urls: output.urls ?? (output.url ? [output.url] : []),
      providerRunId: existing.providerRunId ?? "",
      creditCost: existing.creditCost,
      status: "completed",
    };
  }

  const invocation = existing
    ? existing
    : await prisma.toolInvocation.create({
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
      });

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

  const run = await pollNodeRun(started.runId, {
    shouldAbort: async () => {
      const current = await prisma.agentRun.findUnique({ where: { id: input.ctx.runId } });
      return current?.status === "stopping" || current?.status === "cancelled";
    },
  });
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

  const creditCost = mapMagicaCredits(run.creditUsed);
  const finishedAt = new Date();
  await prisma.toolInvocation.update({
    where: { id: invocation.id },
    data: {
      status: "completed",
      output: { url: urls[0], urls } as Prisma.InputJsonValue,
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

  return { url: urls[0], urls, providerRunId: started.runId, creditCost, status: "completed" };
}

function extractMediaUrls(run: MagicaRun): string[] {
  const output = run.output;
  if (!output || typeof output !== "object") return [];
  const record = output as Record<string, unknown>;
  const urls: string[] = [];
  for (const key of ["image_url", "video_url", "url"]) {
    if (typeof record[key] === "string") urls.push(record[key] as string);
  }
  for (const key of ["images", "videos", "urls"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") urls.push(item);
        if (item && typeof item === "object" && "url" in item && typeof item.url === "string") {
          urls.push(item.url);
        }
      }
    }
  }
  return urls;
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
