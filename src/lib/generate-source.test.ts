import { describe, expect, it } from "vitest";
import {
  alreadyGenerated,
  dropCompletedGenerateCalls,
  generateResultCount,
  lastSuccessfulGenerateOutput,
} from "./generate-source";

const generated = [
  { type: "tool_use" as const, invocationId: "g1", toolName: "gpt_image_2", input: { prompt: "a parrot" } },
  {
    type: "tool_result" as const,
    invocationId: "g1",
    toolName: "gpt_image_2",
    output: { image_url: "https://cdn.example/parrot.png" },
    status: "success" as const,
  },
];

describe("alreadyGenerated", () => {
  it("is true after a successful gpt_image_2 result", () => {
    expect(alreadyGenerated(generated)).toBe(true);
  });

  it("drops a second generate call", () => {
    expect(
      dropCompletedGenerateCalls(
        [
          { id: "g2", name: "gpt_image_2", arguments: "{}" },
          { id: "c1", name: "crop_image", arguments: "{}" },
        ],
        true,
      ),
    ).toEqual([{ id: "c1", name: "crop_image", arguments: "{}" }]);
  });

  it("returns the last successful output", () => {
    expect(lastSuccessfulGenerateOutput(generated)).toEqual({ image_url: "https://cdn.example/parrot.png" });
  });

  it("counts generate attempts so a looping model can be cut off", () => {
    expect(generateResultCount(generated)).toBe(1);
    expect(
      generateResultCount([
        ...generated,
        {
          type: "tool_result",
          invocationId: "g2",
          toolName: "gpt_image_2",
          output: { error: "timed out" },
          status: "failed",
        },
      ]),
    ).toBe(2);
    expect(
      dropCompletedGenerateCalls([{ id: "g3", name: "gpt_image_2", arguments: "{}" }], generateResultCount(generated) >= 2),
    ).toEqual([{ id: "g3", name: "gpt_image_2", arguments: "{}" }]);
  });
});
