import { prisma } from "./db";
import { dispatchAgentTurn, usesTriggerDispatch } from "./dispatch";
import { finalizeRun } from "./finalize";
import { bumpDispatchAttempt, dispatchKeyForAttempt } from "./run-lease";
import { parseBlocks } from "./serialize";
import { findOpenWaitpoint, parseSnapshot } from "./waitpoints";

const MAX_REDISPATCH = 3;

function looksLikeIncompleteDump(text: string): boolean {
  const compact = text.trim();
  if (compact.length < 8) return true;
  if (/^(user|response|assistant)\s*safety\b/i.test(compact)) return true;
  if (/^(user|assistant|system)$/i.test(compact)) return true;
  return false;
}

function hasSettledOutput(blocks: ReturnType<typeof parseBlocks>): boolean {
  return blocks.some((block) => {
    if (block.type === "tool_result" && block.status === "success") return true;
    if (block.type !== "text") return false;
    const text = block.text.trim();
    return text.length > 0 && !looksLikeIncompleteDump(text);
  });
}

export async function settleOrphanedLiveRuns(limit = 25) {
  const now = new Date();
  const orphans = await prisma.agentRun.findMany({
    where: {
      status: { in: ["queued", "thinking", "working"] },
      OR: [{ leaseUntil: { equals: null } }, { leaseUntil: { lt: now } }],
    },
    take: limit,
  });

  let completed = 0;
  let failed = 0;
  let redispatched = 0;

  for (const run of orphans) {
    if (await findOpenWaitpoint(run.id)) continue;

    const inflightMagica = await prisma.toolInvocation.findFirst({
      where: { runId: run.id, provider: "magica", status: "running" },
      select: { id: true },
    });
    if (inflightMagica) continue;

    const assistant = run.assistantMessageId
      ? await prisma.message.findUnique({ where: { id: run.assistantMessageId } })
      : null;
    const blocks = assistant ? parseBlocks(assistant.blocks) : [];
    const pending = parseSnapshot(run.sessionSnapshot).pendingToolCalls?.length ?? 0;

    if (pending > 0) {
      if (usesTriggerDispatch()) {
        const attempt = await bumpDispatchAttempt(run.id);
        await dispatchAgentTurn(run.id, dispatchKeyForAttempt(run.dispatchKey, attempt));
        redispatched += 1;
      }
      continue;
    }

    if (hasSettledOutput(blocks)) {
      await finalizeRun(run.id, {
        status: "complete",
        blocks,
        messageStatus: "success",
      });
      completed += 1;
      continue;
    }

    if (run.dispatchAttempt >= MAX_REDISPATCH || !usesTriggerDispatch()) {
      await finalizeRun(run.id, {
        status: "failed",
        blocks,
        messageStatus: "failed",
        errorCode: "WORKER_INTERRUPTED",
        errorSafeMessage: "The run was interrupted. Send a new message to continue.",
      });
      failed += 1;
      continue;
    }

    const attempt = await bumpDispatchAttempt(run.id);
    await dispatchAgentTurn(run.id, dispatchKeyForAttempt(run.dispatchKey, attempt));
    redispatched += 1;
  }

  return { completed, failed, redispatched };
}
