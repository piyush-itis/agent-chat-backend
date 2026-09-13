import { beforeEach, describe, expect, it, vi } from "vitest";

const findRun = vi.fn();
const executeRaw = vi.fn();
const queryRaw = vi.fn();
const updateMany = vi.fn();
const updateRun = vi.fn();
const dispatchAgentTurn = vi.fn();

vi.mock("./db", () => ({
  prisma: {
    agentRun: {
      findUnique: (...args: unknown[]) => findRun(...args),
      update: (...args: unknown[]) => updateRun(...args),
    },
    waitpoint: {
      updateMany: (...args: unknown[]) => updateMany(...args),
    },
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $executeRaw: (...args: unknown[]) => executeRaw(...args),
        agentRun: { update: (...args: unknown[]) => updateRun(...args) },
      }),
  },
}));

vi.mock("./dispatch", () => ({
  dispatchAgentTurn: (...args: unknown[]) => dispatchAgentTurn(...args),
}));

const openRow = {
  id: "wp_1",
  token: "tok_real",
  runId: "run_1",
  kind: "plan",
  payload: { title: "Approve this plan", summary: "Do the work." },
  status: "open",
  resumeKey: "rk_real",
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
};

describe("resumeWaitpoint", () => {
  beforeEach(() => {
    findRun.mockReset();
    executeRaw.mockReset();
    queryRaw.mockReset();
    updateMany.mockReset();
    updateRun.mockReset();
    dispatchAgentTurn.mockReset();
    updateMany.mockResolvedValue({ count: 0 });
    findRun.mockResolvedValue({
      id: "run_1",
      userId: "user_1",
      dispatchKey: "dispatch:chat:key",
      sessionSnapshot: { version: 1 },
    });
  });

  it("rejects the magic open token", async () => {
    queryRaw.mockResolvedValueOnce([]);
    const { resumeWaitpoint } = await import("./waitpoints");
    const { ApiError } = await import("./errors");
    await expect(
      resumeWaitpoint("user_1", "run_1", "open", {
        resumeKey: "open-wait",
        decision: "approved",
      }),
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" } satisfies Partial<InstanceType<typeof ApiError>>);
    expect(dispatchAgentTurn).not.toHaveBeenCalled();
  });

  it("dispatches once when two resumes race", async () => {
    queryRaw
      .mockResolvedValueOnce([openRow])
      .mockResolvedValueOnce([openRow])
      .mockResolvedValueOnce([{ ...openRow, status: "approved" }])
      .mockResolvedValueOnce([{ ...openRow, status: "approved" }]);
    executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    const { resumeWaitpoint } = await import("./waitpoints");
    const first = resumeWaitpoint("user_1", "run_1", "tok_real", {
      resumeKey: "rk_real",
      decision: "approved",
    });
    const second = resumeWaitpoint("user_1", "run_1", "tok_real", {
      resumeKey: "rk_real",
      decision: "approved",
    });
    const [a, b] = await Promise.all([first, second]);
    expect([a.alreadyApplied, b.alreadyApplied].sort()).toEqual([false, true]);
    expect(dispatchAgentTurn).toHaveBeenCalledTimes(1);
    expect(dispatchAgentTurn).toHaveBeenCalledWith("run_1", "dispatch:chat:key:resume:wp_1");
  });
});
