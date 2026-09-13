import { beforeEach, describe, expect, it, vi } from "vitest";

const findRuns = vi.fn();
const findMessage = vi.fn();
const findWaitpoint = vi.fn();
const finalize = vi.fn();
const dispatch = vi.fn();
const bump = vi.fn();

vi.mock("./db", () => ({
  prisma: {
    agentRun: { findMany: (...args: unknown[]) => findRuns(...args) },
    message: { findUnique: (...args: unknown[]) => findMessage(...args) },
  },
}));
vi.mock("./finalize", () => ({
  finalizeRun: (...args: unknown[]) => finalize(...args),
}));
vi.mock("./dispatch", () => ({
  usesTriggerDispatch: () => true,
  dispatchAgentTurn: (...args: unknown[]) => dispatch(...args),
}));
vi.mock("./run-lease", () => ({
  bumpDispatchAttempt: (...args: unknown[]) => bump(...args),
  dispatchKeyForAttempt: (key: string, attempt: number) => `${key}:${attempt}`,
}));
vi.mock("./waitpoints", () => ({
  findOpenWaitpoint: (...args: unknown[]) => findWaitpoint(...args),
  parseSnapshot: (raw: unknown) => raw ?? {},
}));

describe("settleOrphanedLiveRuns", () => {
  beforeEach(() => {
    findRuns.mockReset();
    findMessage.mockReset();
    findWaitpoint.mockReset();
    finalize.mockReset();
    dispatch.mockReset();
    bump.mockReset();
    findWaitpoint.mockResolvedValue(null);
    bump.mockResolvedValue(2);
  });

  it("completes an orphan that already has assistant text", async () => {
    findRuns.mockResolvedValue([
      {
        id: "run_1",
        assistantMessageId: "a1",
        sessionSnapshot: { version: 1 },
        dispatchKey: "d1",
        dispatchAttempt: 3,
      },
    ]);
    findMessage.mockResolvedValue({
      blocks: [{ type: "text", text: "Hi — what should we work on?" }],
    });
    const { settleOrphanedLiveRuns } = await import("./recover-runs");
    await expect(settleOrphanedLiveRuns()).resolves.toMatchObject({ completed: 1, redispatched: 0 });
    expect(finalize).toHaveBeenCalledWith(
      "run_1",
      expect.objectContaining({ status: "complete", messageStatus: "success" }),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not treat a leaked safety fragment as a finished reply", async () => {
    findRuns.mockResolvedValue([
      {
        id: "run_2",
        assistantMessageId: "a2",
        sessionSnapshot: { version: 1 },
        dispatchKey: "d2",
        dispatchAttempt: 3,
      },
    ]);
    findMessage.mockResolvedValue({
      blocks: [{ type: "text", text: "User" }],
    });
    const { settleOrphanedLiveRuns } = await import("./recover-runs");
    await expect(settleOrphanedLiveRuns()).resolves.toMatchObject({ completed: 0, failed: 1 });
    expect(finalize).toHaveBeenCalledWith(
      "run_2",
      expect.objectContaining({ status: "failed", errorCode: "WORKER_INTERRUPTED" }),
    );
  });
});
