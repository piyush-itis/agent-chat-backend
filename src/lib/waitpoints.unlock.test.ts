import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const updateMany = vi.fn();
const updateRun = vi.fn();
const finalizeRun = vi.fn();

vi.mock("./db", () => ({
  prisma: {
    agentRun: {
      findMany: (...args: unknown[]) => findMany(...args),
      update: (...args: unknown[]) => updateRun(...args),
    },
    waitpoint: { updateMany: (...args: unknown[]) => updateMany(...args) },
  },
}));

vi.mock("./finalize", () => ({
  finalizeRun: (...args: unknown[]) => finalizeRun(...args),
}));

describe("unlockExpiredWaitpointRuns", () => {
  beforeEach(() => {
    findMany.mockReset();
    updateMany.mockReset();
    updateRun.mockReset();
    finalizeRun.mockReset();
    updateMany.mockResolvedValue({ count: 0 });
  });

  it("finalizes waiting runs that have no open waitpoint", async () => {
    findMany.mockResolvedValueOnce([{ id: "run_1" }]);
    const { unlockExpiredWaitpointRuns } = await import("./waitpoints");
    expect(await unlockExpiredWaitpointRuns()).toBe(1);
    expect(finalizeRun).toHaveBeenCalledWith("run_1", {
      status: "failed",
      messageStatus: "failed",
      errorCode: "WAITPOINT_EXPIRED",
      errorSafeMessage: "This approval expired. Send a new message to continue later.",
    });
  });
});
