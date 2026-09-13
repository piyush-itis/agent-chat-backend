import type { ContentBlock } from "@/contracts/blocks";
import type { SessionSnapshot } from "@/contracts/api";
import { prisma } from "@/lib/db";
import type { ToolCall } from "@/lib/openrouter";
import { cropRectFromAnswer, latestPresetCropAnswer } from "@/lib/questions";

export function pickCropImageUrl(input: {
  messageUrl?: string;
  chatUrl?: string;
  generatedUrl?: string;
}) {
  return input.messageUrl || input.chatUrl || input.generatedUrl || undefined;
}

export async function latestCropImageUrl(chatId: string, userMessageId?: string | null) {
  const onMessage = userMessageId
    ? await prisma.attachment.findFirst({
        where: { chatId, messageId: userMessageId, mimeType: { startsWith: "image/" } },
        orderBy: { createdAt: "desc" },
      })
    : null;
  const onChat = await prisma.attachment.findFirst({
    where: { chatId, mimeType: { startsWith: "image/" } },
    orderBy: { createdAt: "desc" },
  });
  const generated = await prisma.generatedAsset.findFirst({
    where: { kind: "image", run: { chatId } },
    orderBy: { createdAt: "desc" },
  });
  return pickCropImageUrl({
    messageUrl: onMessage?.durableUrl ?? onMessage?.resultUrl ?? undefined,
    chatUrl: onChat?.durableUrl ?? onChat?.resultUrl ?? undefined,
    generatedUrl: generated?.durableUrl ?? generated?.url ?? undefined,
  });
}

export function resolveCropImageUrl(parsed: unknown, trustedUrl?: string): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  if (!trustedUrl) return parsed;
  return { ...(parsed as Record<string, unknown>), image_url: trustedUrl };
}

export function alreadyCropped(blocks: ContentBlock[]) {
  return blocks.some(
    (block) => block.type === "tool_result" && block.toolName === "crop_image" && block.status === "success",
  );
}

export function dropCompletedCropCalls(calls: ToolCall[], cropped: boolean) {
  if (!cropped) return calls;
  return calls.filter((call) => call.name !== "crop_image");
}

export function lastSuccessfulCropOutput(blocks: ContentBlock[]) {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.type === "tool_result" && block.toolName === "crop_image" && block.status === "success") {
      return block.output;
    }
  }
  return null;
}

export function buildAutoCropCall(input: {
  userMessageId: string;
  imageUrl?: string;
  snapshot: SessionSnapshot;
  alreadyCropped: boolean;
}): ToolCall | null {
  if (input.alreadyCropped || !input.imageUrl) return null;
  const answer = latestPresetCropAnswer(input.snapshot);
  if (!answer) return null;
  const rect = cropRectFromAnswer(answer);
  if (!rect) return null;
  return {
    id: `auto-crop:${input.userMessageId}`,
    name: "crop_image",
    arguments: JSON.stringify({
      image_url: input.imageUrl,
      crop: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      unit: rect.unit,
    }),
  };
}
