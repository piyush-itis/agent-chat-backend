import type { ContentBlock } from "@/contracts/blocks";
import type { ChatTurn } from "@/lib/openrouter";

export function textFromBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function assistantHistoryText(status: string, blocks: ContentBlock[]): string {
  const text = textFromBlocks(blocks);
  if (status === "failed") {
    return text
      ? `${text}\n\n(Previous turn failed. Do not retry that request unless the user asks again.)`
      : "(Previous turn failed. Do not retry that request unless the user asks again.)";
  }
  if (status === "cancelled") {
    return text || "(Previous turn was cancelled. Do not retry that request unless the user asks again.)";
  }
  return text;
}

export function historyTurnsForModel(
  messages: { role: string; status: string; blocks: ContentBlock[] }[],
): ChatTurn[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const content =
        message.role === "user"
          ? textFromBlocks(message.blocks)
          : assistantHistoryText(message.status, message.blocks);
      return {
        role: message.role === "user" ? ("user" as const) : ("assistant" as const),
        content,
      };
    })
    .filter((message) => message.content.length > 0);
}
