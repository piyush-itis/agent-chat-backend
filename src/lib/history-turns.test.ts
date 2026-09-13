import { describe, expect, it } from "vitest";
import { historyTurnsForModel } from "./history-turns";

describe("historyTurnsForModel", () => {
  it("keeps a failed assistant stub so an earlier generate is not still open", () => {
    expect(
      historyTurnsForModel([
        {
          role: "user",
          status: "success",
          blocks: [{ type: "text", text: "generate an image of sky" }],
        },
        {
          role: "assistant",
          status: "failed",
          blocks: [{ type: "thinking", text: "Need to load the skill." }],
        },
        {
          role: "user",
          status: "success",
          blocks: [{ type: "text", text: "generate an image of a parrot" }],
        },
      ]),
    ).toEqual([
      { role: "user", content: "generate an image of sky" },
      {
        role: "assistant",
        content: "(Previous turn failed. Do not retry that request unless the user asks again.)",
      },
      { role: "user", content: "generate an image of a parrot" },
    ]);
  });
});
