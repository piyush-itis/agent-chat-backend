import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "@/contracts/api";
import { hadSuccessfulMagicaWork, needsMagicaTools } from "./turn-intent";

const empty: SessionSnapshot = { version: 1 };

describe("needsMagicaTools", () => {
  it("keeps greetings and chat replies off the Magica path", () => {
    for (const userText of ["hi", "say hi", "thanks", "how are you", "what can you do", "what's 2+2"]) {
      expect(needsMagicaTools({ userText, thisTurnAttachmentCount: 0, snapshot: empty })).toBe(false);
    }
  });

  it("turns tools on for generate, crop, and merge prompts", () => {
    expect(needsMagicaTools({ userText: "generate a logo", thisTurnAttachmentCount: 0, snapshot: empty })).toBe(
      true,
    );
    expect(needsMagicaTools({ userText: "crop this", thisTurnAttachmentCount: 0, snapshot: empty })).toBe(true);
    expect(
      needsMagicaTools({ userText: "merge these videos", thisTurnAttachmentCount: 0, snapshot: empty }),
    ).toBe(true);
    expect(needsMagicaTools({ userText: "make a sunset logo", thisTurnAttachmentCount: 0, snapshot: empty })).toBe(
      true,
    );
  });

  it("turns tools on for this-turn media even if the text is a greeting", () => {
    expect(needsMagicaTools({ userText: "hi", thisTurnAttachmentCount: 1, snapshot: empty })).toBe(true);
  });

  it("does not treat older chat media as this-turn work", () => {
    expect(needsMagicaTools({ userText: "hi", thisTurnAttachmentCount: 0, snapshot: empty })).toBe(false);
  });

  it("turns tools on for plan mode, pending tools, and pending phase", () => {
    expect(needsMagicaTools({ userText: "hi", thisTurnAttachmentCount: 0, snapshot: { version: 1, planMode: true } })).toBe(
      true,
    );
    expect(
      needsMagicaTools({
        userText: "hi",
        thisTurnAttachmentCount: 0,
        snapshot: { version: 1, pendingToolCalls: [{ id: "t1", name: "crop_image", arguments: "{}" }] },
      }),
    ).toBe(true);
    expect(
      needsMagicaTools({
        userText: "ok",
        thisTurnAttachmentCount: 0,
        snapshot: { version: 1, pendingPhase: "tools" },
      }),
    ).toBe(true);
  });

  it("turns tools on for Magica follow-ups after a successful generate", () => {
    expect(
      needsMagicaTools({
        userText: "crop it to 1:1",
        thisTurnAttachmentCount: 0,
        snapshot: empty,
        hadRecentMagicaWork: true,
      }),
    ).toBe(true);
    expect(
      needsMagicaTools({
        userText: "hi",
        thisTurnAttachmentCount: 0,
        snapshot: empty,
        hadRecentMagicaWork: true,
      }),
    ).toBe(false);
  });
});

describe("hadSuccessfulMagicaWork", () => {
  it("detects a successful Magica tool result", () => {
    expect(
      hadSuccessfulMagicaWork([
        {
          role: "assistant",
          blocks: [
            {
              type: "tool_result",
              invocationId: "g1",
              toolName: "gpt_image_2",
              status: "success",
              output: {},
            },
          ],
        },
      ]),
    ).toBe(true);
    expect(hadSuccessfulMagicaWork([{ role: "assistant", blocks: [{ type: "text", text: "hi" }] }])).toBe(false);
  });
});
