import { describe, expect, it } from "vitest";
import { cropImageInput, gptImageInput, mergeVideosInput } from "./tools";
import { executeCropImage, executeGptImage } from "./tools";

const live = Boolean(process.env.MAGICA_API_KEY && process.env.MAGICA_LIVE_ACCEPTANCE === "1");

describe("magica acceptance", () => {
  it("keeps the three tool contracts aligned", () => {
    expect(cropImageInput.safeParse({ image_url: "https://x.test/a.png", x: 0, y: 0, width: 1, height: 1 }).success).toBe(true);
    expect(gptImageInput.safeParse({ mode: "text", prompt: "a cat" }).success).toBe(true);
    expect(mergeVideosInput.safeParse({ video_urls: ["https://x.test/a.mp4", "https://x.test/b.mp4"] }).success).toBe(true);
  });

  it.skipIf(!live)("generate then crop against live Magica", async () => {
    const ctx = { runId: "accept", chatId: "accept", userId: "accept", toolCallId: "gen" };
    const generated = await executeGptImage(ctx, { mode: "text", prompt: "a red square" });
    expect(generated.image_url).toMatch(/^https?:\/\//);
    const cropped = await executeCropImage(
      { ...ctx, toolCallId: "crop" },
      { image_url: generated.image_url, x: 0, y: 0, width: 50, height: 50, unit: "percent" },
    );
    expect(cropped.image_url).toMatch(/^https?:\/\//);
  });
});
