import type { ContentBlock } from "@/contracts/blocks";

const KEEP = new Set(["stopping", "cancelled", "complete", "failed"]);

export function hasStartedToolWork(blocks: ContentBlock[]): boolean {
  return blocks.some((block) => block.type === "tool_use" || block.type === "tool_result");
}

export function nextLiveRunStatus(input: {
  currentStatus: string;
  openWait: boolean;
  blocks: ContentBlock[];
}): "thinking" | "working" | "waiting" | "stopping" | "cancelled" | "complete" | "failed" {
  if (input.openWait) return "waiting";
  if (KEEP.has(input.currentStatus)) {
    return input.currentStatus as "stopping" | "cancelled" | "complete" | "failed";
  }
  return hasStartedToolWork(input.blocks) ? "working" : "thinking";
}
