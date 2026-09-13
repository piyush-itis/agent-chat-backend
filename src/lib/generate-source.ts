import type { ContentBlock } from "@/contracts/blocks";
import type { ToolCall } from "@/lib/openrouter";

export function alreadyGenerated(blocks: ContentBlock[]) {
  return blocks.some(
    (block) => block.type === "tool_result" && block.toolName === "gpt_image_2" && block.status === "success",
  );
}

export function dropCompletedGenerateCalls(calls: ToolCall[], generated: boolean) {
  if (!generated) return calls;
  return calls.filter((call) => call.name !== "gpt_image_2");
}

export function lastSuccessfulGenerateOutput(blocks: ContentBlock[]) {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.type === "tool_result" && block.toolName === "gpt_image_2" && block.status === "success") {
      return block.output;
    }
  }
  return null;
}
