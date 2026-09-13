import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const upsert = vi.fn();
const updateMany = vi.fn();

vi.mock("./db", () => ({
  prisma: {
    rateLimitBucket: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      upsert: (...args: unknown[]) => upsert(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
    },
  },
}));

describe("assertRateLimit", () => {
  beforeEach(() => {
    findUnique.mockReset();
    upsert.mockReset();
    updateMany.mockReset();
  });

  it("opens a new window when none exists", async () => {
    findUnique.mockResolvedValue(null);
    upsert.mockResolvedValue({});
    const { assertRateLimit } = await import("./rate-limit");
    await expect(assertRateLimit("user_1")).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rejects when the persisted window is full", async () => {
    findUnique.mockResolvedValue({
      userId: "user_1",
      count: 20,
      resetAt: new Date(Date.now() + 30_000),
    });
    updateMany.mockResolvedValue({ count: 0 });
    const { assertRateLimit } = await import("./rate-limit");
    const { ApiError } = await import("./errors");
    await expect(assertRateLimit("user_1")).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
    } satisfies Partial<InstanceType<typeof ApiError>>);
  });
});
