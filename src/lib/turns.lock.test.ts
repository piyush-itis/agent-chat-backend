import { beforeEach, describe, expect, it, vi } from "vitest";

const findChat = vi.fn();
const findRun = vi.fn();

vi.mock("./db", () => ({
  prisma: {
    chat: { findFirst: (...args: unknown[]) => findChat(...args) },
    agentRun: { findUnique: (...args: unknown[]) => findRun(...args) },
  },
}));

describe("claimActiveRun", () => {
  beforeEach(() => {
    findChat.mockReset();
    findRun.mockReset();
  });

  it("returns 409 when the chat already has an active run", async () => {
    findChat.mockResolvedValue({ id: "chat_1", userId: "user_1", activeRunId: "run_1", deletedAt: null });
    findRun.mockResolvedValue({ id: "run_1", status: "working" });
    const { claimActiveRun } = await import("./turns");
    const { ApiError } = await import("./errors");
    await expect(claimActiveRun("user_1", "chat_1")).rejects.toMatchObject({
      status: 409,
      code: "ACTIVE_RUN",
    } satisfies Partial<InstanceType<typeof ApiError>>);
  });

  it("allows a new turn when the previous run is terminal", async () => {
    findChat.mockResolvedValue({ id: "chat_1", userId: "user_1", activeRunId: "run_1", deletedAt: null });
    findRun.mockResolvedValue({ id: "run_1", status: "complete" });
    const { claimActiveRun } = await import("./turns");
    await expect(claimActiveRun("user_1", "chat_1")).resolves.toMatchObject({ id: "chat_1" });
  });
});
