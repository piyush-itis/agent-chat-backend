import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { LIMITS } from "@/contracts/limits";
import { prisma } from "./db";
import { jsonError } from "./errors";
import {
  cropImageInput,
  gptImageInput,
  mergeVideosInput,
} from "./magica/tools";
import { createChat } from "./chats";
import { claimActiveRun, toSendResponse } from "./turns";
import { dispatchAgentTurn } from "./dispatch";

const toolInputs = {
  crop_image: cropImageInput,
  gpt_image_2: gptImageInput,
  merge_videos: mergeVideosInput,
} as const;

export type PublicToolName = keyof typeof toolInputs;

export async function runPublicTool(
  userId: string,
  toolName: PublicToolName,
  input: Record<string, unknown>,
  chatId?: string,
) {
  const parsed = toolInputs[toolName].safeParse(input);
  if (!parsed.success) {
    throw jsonError(400, "VALIDATION", parsed.error.issues[0]?.message ?? "Invalid tool input");
  }

  const chat = chatId
    ? await claimActiveRun(userId, chatId)
    : await createChat(userId, `${toolName} run`);

  const account = await prisma.creditAccount.findUnique({ where: { userId } });
  if (!account || account.balance < LIMITS.admissionReserve) {
    throw jsonError(402, "INSUFFICIENT_CREDITS", "Not enough credits to start a turn");
  }

  const toolCallId = randomUUID();
  const clientKey = `public-tool:${toolName}:${randomUUID()}`;

  let result: { runId: string; messageId: string; chatId: string; dispatchKey: string };
  try {
    result = await prisma.$transaction(async (tx) => {
      const reserved = await tx.creditAccount.updateMany({
        where: { userId, balance: { gte: LIMITS.admissionReserve } },
        data: { balance: { decrement: LIMITS.admissionReserve } },
      });
      if (reserved.count !== 1) {
        throw jsonError(402, "INSUFFICIENT_CREDITS", "Not enough credits to start a turn");
      }

      const userMessage = await tx.message.create({
        data: {
          chatId: chat.id,
          role: "user",
          status: "success",
          clientIdempotencyKey: clientKey,
          blocks: [{ type: "text", text: `Run ${toolName}` }],
        },
      });
      const assistantMessage = await tx.message.create({
        data: {
          chatId: chat.id,
          role: "assistant",
          status: "success",
          blocks: [],
        },
      });
      const run = await tx.agentRun.create({
        data: {
          chatId: chat.id,
          userId,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          status: "queued",
          modelRequested: LIMITS.model,
          dispatchKey: `dispatch:${chat.id}:${clientKey}`,
          admissionReserved: LIMITS.admissionReserve,
          sessionSnapshot: {
            version: 1,
            skipWaitpoints: true,
            publicToolOnly: true,
            pendingPhase: "tools",
            pendingToolCalls: [
              {
                id: toolCallId,
                name: toolName,
                arguments: JSON.stringify(parsed.data),
              },
            ],
          },
        },
      });
      await tx.message.update({ where: { id: userMessage.id }, data: { runId: run.id } });
      await tx.message.update({ where: { id: assistantMessage.id }, data: { runId: run.id } });
      await tx.creditLedger.create({
        data: {
          userId,
          runId: run.id,
          kind: "admission_reserve",
          amount: -LIMITS.admissionReserve,
          settlementKey: `admission_reserve:${run.id}`,
          note: "Admission reserve",
        },
      });
      await tx.chat.update({
        where: { id: chat.id },
        data: { activeRunId: run.id, updatedAt: new Date() },
      });
      return {
        runId: run.id,
        messageId: userMessage.id,
        chatId: chat.id,
        dispatchKey: run.dispatchKey,
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw jsonError(409, "ACTIVE_RUN", "This chat already has an active run");
    }
    throw error;
  }

  await dispatchAgentTurn(result.runId, result.dispatchKey);
  return await toSendResponse(result.chatId, result.messageId, result.runId);
}
