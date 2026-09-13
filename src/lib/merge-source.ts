import type { ContentBlock } from "@/contracts/blocks";
import { prisma } from "@/lib/db";
import type { ToolCall } from "@/lib/openrouter";

export function pickChatVideoUrls(input: {
  messageUrls: string[];
  chatUrls: string[];
  generatedUrls: string[];
}) {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const url of [...input.messageUrls, ...input.chatUrls, ...input.generatedUrls]) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function attachmentUrl(item: { durableUrl: string | null; resultUrl: string | null }) {
  return item.durableUrl ?? item.resultUrl ?? undefined;
}

export async function chatVideoUrls(chatId: string, userMessageId?: string | null) {
  const onMessage = userMessageId
    ? await prisma.attachment.findMany({
        where: { chatId, messageId: userMessageId, mimeType: { startsWith: "video/" } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      })
    : [];
  const onChat = await prisma.attachment.findMany({
    where: { chatId, mimeType: { startsWith: "video/" } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const generated = await prisma.generatedAsset.findMany({
    where: { kind: "video", run: { chatId } },
    orderBy: { createdAt: "asc" },
  });
  return pickChatVideoUrls({
    messageUrls: onMessage.map((item) => attachmentUrl(item)).filter((url): url is string => Boolean(url)),
    chatUrls: onChat.map((item) => attachmentUrl(item)).filter((url): url is string => Boolean(url)),
    generatedUrls: generated
      .map((item) => item.durableUrl ?? item.url)
      .filter((url): url is string => Boolean(url)),
  });
}

export function resolveMergeVideoUrls(parsed: unknown, trusted: string[]): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const record = { ...(parsed as Record<string, unknown>) };
  if (trusted.length < 2) return record;
  const current = Array.isArray(record.video_urls)
    ? record.video_urls.filter((item): item is string => typeof item === "string")
    : [];
  const known = new Set(trusted);
  if (current.length >= 2 && current.every((url) => known.has(url))) return record;
  return { ...record, video_urls: trusted };
}

export function transitionFromText(text: string): "none" | "fade" | "dissolve" {
  if (/\bdissolve\b/i.test(text)) return "dissolve";
  if (/\bfade\b/i.test(text)) return "fade";
  return "none";
}

export function looksLikeMerge(text: string) {
  return /\b(merge|concatenate|concat|stitch)\b/i.test(text);
}

export function alreadyMerged(blocks: ContentBlock[]) {
  return blocks.some(
    (block) => block.type === "tool_result" && block.toolName === "merge_videos" && block.status === "success",
  );
}

export function dropCompletedMergeCalls(calls: ToolCall[], merged: boolean) {
  if (!merged) return calls;
  return calls.filter((call) => call.name !== "merge_videos");
}

export function lastSuccessfulMergeOutput(blocks: ContentBlock[]) {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.type === "tool_result" && block.toolName === "merge_videos" && block.status === "success") {
      return block.output;
    }
  }
  return null;
}

export function buildAutoMergeCall(input: {
  userMessageId: string;
  userText: string;
  videoUrls: string[];
  alreadyMerged: boolean;
}): ToolCall | null {
  if (input.alreadyMerged || !looksLikeMerge(input.userText) || input.videoUrls.length < 2) return null;
  return {
    id: `auto-merge:${input.userMessageId}`,
    name: "merge_videos",
    arguments: JSON.stringify({
      video_urls: input.videoUrls,
      transition: transitionFromText(input.userText),
    }),
  };
}
