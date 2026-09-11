import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { LIMITS } from "@/contracts/limits";
import { prisma } from "./db";
import { jsonError } from "./errors";
import {
  cropImageInput,
  executeCropImage,
  executeGptImage,
  executeMergeVideos,
  gptImageInput,
  mergeVideosInput,
} from "./magica/tools";
import type { ToolContext } from "./registry";
import { createChat } from "./chats";

export async function runPublicTool(
  userId: string,
  toolName: "crop_image" | "gpt_image_2" | "merge_videos",
  input: Record<string, unknown>,
  chatId?: string,
) {
  const chat = chatId ? { id: chatId } : await createChat(userId, `${toolName} run`);
  if (chatId) {
    const owned = await prisma.chat.findFirst({ where: { id: chatId, userId, deletedAt: null } });
    if (!owned) throw jsonError(404, "NOT_FOUND", "Chat not found");
  }

  const userMessage = await prisma.message.create({
    data: {
      chatId: chat.id,
      role: "user",
      status: "success",
      blocks: [{ type: "text", text: `Run ${toolName}` }],
    },
  });
  const assistantMessage = await prisma.message.create({
    data: {
      chatId: chat.id,
      role: "assistant",
      status: "success",
      blocks: [],
    },
  });
  const run = await prisma.agentRun.create({
    data: {
      chatId: chat.id,
      userId,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      status: "working",
      modelRequested: LIMITS.model,
      dispatchKey: `public-tool:${chat.id}:${randomUUID()}`,
    },
  });
  await prisma.message.update({ where: { id: userMessage.id }, data: { runId: run.id } });
  await prisma.message.update({ where: { id: assistantMessage.id }, data: { runId: run.id } });

  const ctx: ToolContext = {
    runId: run.id,
    chatId: chat.id,
    userId,
    toolCallId: randomUUID(),
  };

  let result: unknown;
  if (toolName === "crop_image") result = await executeCropImage(ctx, cropImageInput.parse(input));
  else if (toolName === "gpt_image_2") result = await executeGptImage(ctx, gptImageInput.parse(input));
  else result = await executeMergeVideos(ctx, mergeVideosInput.parse(input));

  await prisma.agentRun.update({
    where: { id: run.id },
    data: { status: "complete", finishedAt: new Date() },
  });
  await prisma.message.update({
    where: { id: assistantMessage.id },
    data: {
      blocks: [
        {
          type: "tool_result",
          invocationId: ctx.toolCallId,
          toolName,
          output: result as Prisma.InputJsonValue,
          status: "success",
        },
      ] as Prisma.InputJsonValue,
    },
  });

  return { chatId: chat.id, runId: run.id, result };
}
