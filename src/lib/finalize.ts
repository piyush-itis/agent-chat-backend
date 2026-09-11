import { Prisma } from "@prisma/client";
import type { ContentBlock } from "@/contracts/blocks";
import { prisma } from "./db";
import { parseBlocks } from "./serialize";
import { emitWebhook } from "./webhooks";

function asJson(blocks: ContentBlock[]): Prisma.InputJsonValue {
  return blocks as unknown as Prisma.InputJsonValue;
}

export async function finalizeRun(
  runId: string,
  input: {
    status: "complete" | "failed" | "cancelled";
    blocks?: ContentBlock[];
    modelRouted?: string | null;
    messageStatus: "success" | "failed" | "cancelled";
    errorCode?: string;
    errorSafeMessage?: string;
  },
) {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run?.assistantMessageId) return;

  const existing = await prisma.message.findUnique({ where: { id: run.assistantMessageId } });
  const blocks = input.blocks ?? (existing ? parseBlocks(existing.blocks) : []);

  await prisma.$transaction(async (tx) => {
    await tx.message.update({
      where: { id: run.assistantMessageId! },
      data: { blocks: asJson(blocks), status: input.messageStatus },
    });

    if (run.admissionReserved > 0) {
      try {
        await tx.creditAccount.update({
          where: { userId: run.userId },
          data: { balance: { increment: run.admissionReserved } },
        });
        await tx.creditLedger.create({
          data: {
            userId: run.userId,
            runId,
            kind: "admission_release",
            amount: run.admissionReserved,
            settlementKey: `admission_release:${runId}`,
            note: "Unused admission released",
          },
        });
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) {
          throw error;
        }
      }
    }

    await tx.agentRun.update({
      where: { id: runId },
      data: {
        status: input.status,
        modelRouted: input.modelRouted ?? run.modelRouted,
        errorCode: input.errorCode,
        errorSafeMessage: input.errorSafeMessage,
        admissionReserved: 0,
        finishedAt: new Date(),
      },
    });

    await tx.chat.update({
      where: { id: run.chatId },
      data: { activeRunId: null, updatedAt: new Date() },
    });
  });

  const event =
    input.status === "complete"
      ? "agent.completed"
      : input.status === "failed"
        ? "agent.failed"
        : "agent.failed";
  void emitWebhook(run.userId, event, {
    runId,
    chatId: run.chatId,
    status: input.status,
    errorCode: input.errorCode ?? null,
  });
}

export async function finalizeCancelledRun(runId: string, message = "Run stopped.") {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  const assistant = run?.assistantMessageId
    ? await prisma.message.findUnique({ where: { id: run.assistantMessageId } })
    : null;
  await finalizeRun(runId, {
    status: "cancelled",
    blocks: assistant ? parseBlocks(assistant.blocks) : [],
    messageStatus: "cancelled",
    errorCode: "CANCELLED",
    errorSafeMessage: message,
  });
}
