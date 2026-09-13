import { describe, expect, it } from "vitest";
import { nextLiveRunStatus } from "./run-status";

describe("nextLiveRunStatus", () => {
  it("stays thinking while only thinking or text blocks exist", () => {
    expect(
      nextLiveRunStatus({
        currentStatus: "thinking",
        openWait: false,
        blocks: [{ type: "thinking", text: "planning a hello" }],
      }),
    ).toBe("thinking");
    expect(
      nextLiveRunStatus({
        currentStatus: "working",
        openWait: false,
        blocks: [{ type: "text", text: "Hi there." }],
      }),
    ).toBe("thinking");
  });

  it("moves to working once a tool starts", () => {
    expect(
      nextLiveRunStatus({
        currentStatus: "thinking",
        openWait: false,
        blocks: [
          {
            type: "tool_use",
            invocationId: "g1",
            toolName: "gpt_image_2",
            input: {},
          },
        ],
      }),
    ).toBe("working");
  });

  it("keeps waiting and terminal statuses", () => {
    expect(
      nextLiveRunStatus({
        currentStatus: "thinking",
        openWait: true,
        blocks: [{ type: "text", text: "Choose a crop" }],
      }),
    ).toBe("waiting");
    expect(
      nextLiveRunStatus({
        currentStatus: "stopping",
        openWait: false,
        blocks: [{ type: "tool_use", invocationId: "g1", toolName: "gpt_image_2", input: {} }],
      }),
    ).toBe("stopping");
  });
});
