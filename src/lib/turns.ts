import { Prisma } from "@prisma/client";
import { LIMITS } from "@/contracts/limits";
import type { ChatCompletionsRequest, SendTurnRequest, SendTurnResponse } from "@/contracts/api";
import { createChat, requireOwnedChat, isActiveStatus } from "./chats";
import { prisma } from "./db";
import { jsonError } from "./errors";
import { dispatchAgentTurn } from "./dispatch";
import { realtimeAccessForRun } from "./realtime-access";

export async function sendTurn(
  userId: string,
  chatId: string,
  input: SendTurnRequest,
): Promise<SendTurnResponse> {
  if (input.model !== LIMITS.model) {
    throw jsonError(400, "UNSUPPORTED_MODEL", "Only openrouter/free is allowed");
  }

  const existing = await prisma.message.findUnique({
    where: {
      chatId_clientIdempotencyKey: {
        chatId,
        clientIdempotencyKey: input.clientIdempotencyKey,
      },
    },
  });
  if (existing?.runId) {
    const run = await prisma.agentRun.findUnique({ where: { id: existing.runId } });
    if (run) {
      return await toSendResponse(chatId, existing.id, run.id);
    }
  }

  const chat = await claimActiveRun(userId, chatId);

  const account = await prisma.creditAccount.findUnique({ where: { userId } });
  if (!account || account.balance < LIMITS.admissionReserve) {
    throw jsonError(402, "INSUFFICIENT_CREDITS", "Not enough credits to start a turn");
  }

  let result: { userMessage: { id: string }; run: { id: string; dispatchKey: string } };
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
        chatId,
        role: "user",
        status: "success",
        clientIdempotencyKey: input.clientIdempotencyKey,
        blocks: [{ type: "text", text: input.text }],
      },
    });

    if (input.attachmentIds?.length) {
      await tx.attachment.updateMany({
        where: { id: { in: input.attachmentIds }, userId },
        data: { chatId, messageId: userMessage.id },
      });
    }

    const assistantMessage = await tx.message.create({
      data: {
        chatId,
        role: "assistant",
        status: "success",
        blocks: [],
      },
    });

    const run = await tx.agentRun.create({
      data: {
        chatId,
        userId,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        status: "queued",
        modelRequested: LIMITS.model,
        dispatchKey: `dispatch:${chatId}:${input.clientIdempotencyKey}`,
        admissionReserved: LIMITS.admissionReserve,
        sessionSnapshot: {
          version: 1,
          planMode: Boolean(input.planMode),
        },
      },
    });

    await tx.message.update({
      where: { id: assistantMessage.id },
      data: { runId: run.id },
    });
    await tx.message.update({
      where: { id: userMessage.id },
      data: { runId: run.id },
    });

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
      where: { id: chatId },
      data: {
        activeRunId: run.id,
        title: chat.title === "New chat" ? titleFromText(input.text) : undefined,
        updatedAt: new Date(),
      },
    });

    return { userMessage, run };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw jsonError(409, "ACTIVE_RUN", "This chat already has an active run");
    }
    throw error;
  }

  try {
    await dispatchAgentTurn(result.run.id, result.run.dispatchKey);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        runId: result.run.id,
        err: String(error),
        message: "dispatch failed after the turn was created",
      }),
    );
  }

  return await toSendResponse(chatId, result.userMessage.id, result.run.id);
}

function titleFromText(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 48 ? `${compact.slice(0, 45)}…` : compact || "New chat";
}

export async function sendChatCompletion(
  userId: string,
  input: ChatCompletionsRequest,
): Promise<SendTurnResponse> {
  if (input.model !== LIMITS.model) {
    throw jsonError(400, "UNSUPPORTED_MODEL", "Only openrouter/free is allowed");
  }
  const lastUser = [...input.messages].reverse().find((message) => message.role === "user");
  if (!lastUser) {
    throw jsonError(400, "VALIDATION", "At least one user message is required");
  }
  const chat = input.chatId
    ? await claimActiveRun(userId, input.chatId)
    : await createChat(userId, titleFromText(lastUser.content));
  return sendTurn(userId, chat.id, {
    text: lastUser.content,
    model: LIMITS.model,
    clientIdempotencyKey: input.clientIdempotencyKey ?? `completions:${chat.id}:${randomIdempotencyKey()}`,
    planMode: input.planMode,
  });
}

function randomIdempotencyKey(): string {
  return `cmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function claimActiveRun(userId: string, chatId: string) {
  const chat = await requireOwnedChat(userId, chatId);
  if (chat.activeRunId) {
    const active = await prisma.agentRun.findUnique({ where: { id: chat.activeRunId } });
    if (active && isActiveStatus(active.status)) {
      throw jsonError(409, "ACTIVE_RUN", "This chat already has an active run");
    }
  }
  return chat;
}

export async function toSendResponse(
  chatId: string,
  messageId: string,
  runId: string,
): Promise<SendTurnResponse> {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  return {
    chatId,
    messageId,
    runId,
    realtime: await realtimeAccessForRun(run),
  };
}
