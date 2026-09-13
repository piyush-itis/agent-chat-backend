import { beforeEach, describe, expect, it, vi } from "vitest";

const createPublicToken = vi.fn();
const usesTriggerDispatch = vi.fn();

vi.mock("@trigger.dev/sdk", () => ({
  auth: { createPublicToken: (...args: unknown[]) => createPublicToken(...args) },
}));

vi.mock("./dispatch", () => ({
  usesTriggerDispatch: (...args: unknown[]) => usesTriggerDispatch(...args),
}));

describe("realtimeAccessForRun", () => {
  beforeEach(() => {
    createPublicToken.mockReset();
    usesTriggerDispatch.mockReset();
  });

  it("returns poll when Trigger dispatch is off", async () => {
    usesTriggerDispatch.mockReturnValue(false);
    const { realtimeAccessForRun } = await import("./realtime-access");
    await expect(
      realtimeAccessForRun({ id: "run_1", status: "thinking", triggerRunId: "tr_1" }),
    ).resolves.toEqual({ transport: "poll", pollUrl: "/api/runs/run_1" });
    expect(createPublicToken).not.toHaveBeenCalled();
  });

  it("mints a scoped Trigger token when a trigger run exists", async () => {
    usesTriggerDispatch.mockReturnValue(true);
    createPublicToken.mockResolvedValue("pat_live");
    const { realtimeAccessForRun } = await import("./realtime-access");
    await expect(
      realtimeAccessForRun({ id: "run_1", status: "working", triggerRunId: "tr_1" }),
    ).resolves.toEqual({
      transport: "trigger",
      pollUrl: "/api/runs/run_1",
      triggerRunId: "tr_1",
      publicAccessToken: "pat_live",
      streams: { thinking: "thinking", assistant: "assistant" },
    });
    expect(createPublicToken).toHaveBeenCalledWith({
      scopes: { read: { runs: ["tr_1"] } },
      expirationTime: "1hr",
    });
  });

  it("falls back to poll if minting fails", async () => {
    usesTriggerDispatch.mockReturnValue(true);
    createPublicToken.mockRejectedValue(new Error("no key"));
    const { realtimeAccessForRun } = await import("./realtime-access");
    await expect(
      realtimeAccessForRun({ id: "run_1", status: "working", triggerRunId: "tr_1" }),
    ).resolves.toEqual({ transport: "poll", pollUrl: "/api/runs/run_1" });
  });
});
