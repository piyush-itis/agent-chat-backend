import { describe, expect, it } from "vitest";
import {
  appendAssistant,
  appendThinking,
  assetsFromBlocks,
  createRealtimePublisher,
  pendingToolFromBlocks,
  publishRunMeta,
} from "./run-realtime";

describe("run-realtime", () => {
  it("is safe to call outside a Trigger task", async () => {
    await expect(appendThinking("hmm")).resolves.toBeUndefined();
    await expect(appendAssistant("hello")).resolves.toBeUndefined();
    await expect(publishRunMeta({ status: "thinking" })).resolves.toBeUndefined();
  });

  it("coalesces tokens so a slow append does not drop later deltas", async () => {
    const writes: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const realtime = createRealtimePublisher({
      thinking: async (chunk) => {
        writes.push(chunk);
        if (writes.length === 1) await firstWrite;
      },
    });
    realtime.appendThinking("We");
    await Promise.resolve();
    realtime.appendThinking(" need");
    realtime.appendThinking(" a short confirmation.");
    releaseFirst?.();
    await realtime.flush();
    expect(writes.join("")).toBe("We need a short confirmation.");
    await realtime.beginHop();
    expect(realtime.offsets()).toEqual({
      thinkingOffset: "We need a short confirmation.".length,
      assistantOffset: 0,
    });
  });

  it("reads the pending tool from unmatched tool_use blocks", () => {
    expect(
      pendingToolFromBlocks([
        { type: "tool_use", invocationId: "a", toolName: "crop_image", input: {} },
        { type: "tool_result", invocationId: "a", toolName: "crop_image", output: {}, status: "success" },
        { type: "tool_use", invocationId: "b", toolName: "merge_videos", input: {} },
      ]),
    ).toBe("merge_videos");
  });

  it("collects generated media URLs from tool results", () => {
    expect(
      assetsFromBlocks([
        {
          type: "tool_result",
          invocationId: "g1",
          toolName: "gpt_image_2",
          output: { image_url: "https://cdn.example/rose.png" },
          status: "success",
        },
      ]),
    ).toEqual([{ url: "https://cdn.example/rose.png", durableUrl: null, kind: "image" }]);
  });
});
