import { Prisma } from "@prisma/client";
import { LIMITS } from "@/contracts/limits";
import { decodeCursor, encodeCursor } from "./cursor";
import { prisma } from "./db";
import { jsonError } from "./errors";
import { serializeChat } from "./serialize";

const ACTIVE_STATUSES = ["queued", "thinking", "working", "waiting", "stopping"] as const;

export async function requireOwnedChat(userId: string, chatId: string) {
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, userId, deletedAt: null },
  });
  if (!chat) {
    throw jsonError(404, "NOT_FOUND", "Chat not found");
  }
  return chat;
}

export function chatSearchWhere(userId: string, q?: string | null): Prisma.ChatWhereInput {
  const query = q?.trim();
  const base: Prisma.ChatWhereInput = { userId, deletedAt: null };
  if (!query) return base;
  return {
    ...base,
    OR: [
      { title: { contains: query, mode: "insensitive" } },
      { messages: { some: { blocks: { string_contains: query } } } },
    ],
  };
}

export async function listChats(userId: string, cursorRaw: string | null, q?: string | null) {
  const cursor = decodeCursor(cursorRaw);
  const take = LIMITS.pageSizeChats;

  const items = await prisma.chat.findMany({
    where: {
      AND: [
        chatSearchWhere(userId, q),
        cursor
          ? {
              OR: [
                { updatedAt: { lt: cursor.createdAt } },
                { updatedAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {},
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: take + 1,
  });

  const page = items.slice(0, take);
  const next = items[take];
  return {
    items: page.map(serializeChat),
    nextCursor: next
      ? encodeCursor({ createdAt: next.updatedAt, id: next.id })
      : null,
  };
}

export async function createChat(userId: string, title?: string) {
  const chat = await prisma.chat.create({
    data: { userId, title: title ?? "New chat" },
  });
  return serializeChat(chat);
}

export async function patchChat(
  userId: string,
  chatId: string,
  data: { title?: string; favorited?: boolean; pinned?: boolean },
) {
  await requireOwnedChat(userId, chatId);
  const chat = await prisma.chat.update({
    where: { id: chatId },
    data,
  });
  return serializeChat(chat);
}

export async function deleteChat(userId: string, chatId: string) {
  const chat = await requireOwnedChat(userId, chatId);
  if (chat.activeRunId) {
    throw jsonError(409, "ACTIVE_RUN", "Stop the active run before deleting this chat");
  }
  await prisma.chat.update({
    where: { id: chatId },
    data: { deletedAt: new Date() },
  });
}

export async function listMessages(userId: string, chatId: string, cursorRaw: string | null) {
  await requireOwnedChat(userId, chatId);
  const cursor = decodeCursor(cursorRaw);
  const take = LIMITS.pageSizeMessages;

  const items = await prisma.message.findMany({
    where: {
      chatId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    include: { attachments: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
  });

  const { serializeMessage } = await import("./serialize");
  const page = items.slice(0, take);
  const next = items[take];
  return {
    items: page.map(serializeMessage),
    nextCursor: next
      ? encodeCursor({ createdAt: next.createdAt, id: next.id })
      : null,
  };
}

export function isActiveStatus(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

export { Prisma };
