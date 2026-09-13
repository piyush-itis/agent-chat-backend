import type { AgentRun, Attachment, Chat, GeneratedAsset, Message, Waitpoint } from "@prisma/client";
import { contentBlocksSchema, type ContentBlock } from "@/contracts/blocks";
import type { Chat as ChatDto, Message as MessageDto, RunResponse } from "@/contracts/api";
import { serializeWaitpoint } from "./waitpoints";

type MessageWithAttachments = Message & { attachments?: Attachment[] };

export function serializeChat(chat: Chat): ChatDto {
  return {
    id: chat.id,
    title: chat.title,
    favorited: chat.favorited,
    pinned: chat.pinned,
    activeRunId: chat.activeRunId,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
  };
}

export function parseBlocks(raw: unknown): ContentBlock[] {
  const parsed = contentBlocksSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return [{ type: "text", text: "[Unable to render message content]" }];
}

export function serializeAttachment(item: Attachment) {
  return {
    id: item.id,
    mimeType: item.mimeType,
    originalName: item.originalName,
    resultUrl: item.resultUrl,
    durableUrl: item.durableUrl,
    sortOrder: item.sortOrder,
  };
}

export function serializeMessage(message: MessageWithAttachments): MessageDto {
  return {
    id: message.id,
    chatId: message.chatId,
    runId: message.runId,
    role: message.role,
    status: message.status,
    blocks: parseBlocks(message.blocks),
    attachments: message.attachments?.map(serializeAttachment),
    createdAt: message.createdAt.toISOString(),
  };
}

export function serializeRun(
  run: AgentRun,
  assistant: Message | null,
  extras: { waitpoint?: Waitpoint | null; generatedAssets?: GeneratedAsset[] } = {},
): RunResponse {
  return {
    id: run.id,
    chatId: run.chatId,
    status: run.status,
    modelRequested: run.modelRequested,
    modelRouted: run.modelRouted,
    userMessageId: run.userMessageId,
    assistantMessageId: run.assistantMessageId,
    errorCode: run.errorCode,
    errorSafeMessage: run.errorSafeMessage,
    assistant: assistant ? serializeMessage(assistant) : null,
    waitpoint: extras.waitpoint ? serializeWaitpoint(extras.waitpoint) : null,
    generatedAssets: (extras.generatedAssets ?? []).map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      url: asset.url,
      durableUrl: asset.durableUrl,
      mimeType: asset.mimeType,
      createdAt: asset.createdAt.toISOString(),
    })),
    triggerRunId: run.triggerRunId ?? undefined,
    createdAt: run.createdAt.toISOString(),
  };
}
