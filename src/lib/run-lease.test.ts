import { beforeEach, describe, expect, it, vi } from "vitest";

const executeRaw = vi.fn();
const queryRaw = vi.fn();

vi.mock("./db", () => ({
  prisma: {
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    agentRun: { update: vi.fn() },
  },
}));

describe("run lease", () => {
  beforeEach(() => {
    executeRaw.mockReset();
    queryRaw.mockReset();
  });

  it("lets only one worker claim a live lease", async () => {
    executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const { claimAgentRun } = await import("./run-lease");
    expect(await claimAgentRun("run_1", "lease-a")).toBe("lease-a");
    expect(await claimAgentRun("run_1", "lease-b")).toBeNull();
  });

  it("allows a claim after the previous lease expires", async () => {
    executeRaw.mockResolvedValueOnce(1);
    const { claimAgentRun } = await import("./run-lease");
    expect(await claimAgentRun("run_1", "lease-c")).toBe("lease-c");
  });

  it("builds recovery dispatch keys from the attempt number", async () => {
    const { dispatchKeyForAttempt } = await import("./run-lease");
    expect(dispatchKeyForAttempt("dispatch:chat:key", 1)).toBe("dispatch:chat:key");
    expect(dispatchKeyForAttempt("dispatch:chat:key", 2)).toBe("dispatch:chat:key:g2");
  });

  it("increments dispatchAttempt on recovery", async () => {
    queryRaw.mockResolvedValueOnce([{ dispatchAttempt: 2 }]);
    const { bumpDispatchAttempt } = await import("./run-lease");
    expect(await bumpDispatchAttempt("run_1")).toBe(2);
  });
});
