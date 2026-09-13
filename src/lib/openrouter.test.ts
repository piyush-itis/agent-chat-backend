import { describe, expect, it, vi } from "vitest";

vi.mock("openai", () => {
  class OpenAI {
    chat = {
      completions: {
        create: vi.fn().mockRejectedValue(Object.assign(new Error("rate limited"), { status: 429 })),
      },
    };
    constructor() {}
  }
  return { default: OpenAI };
});

describe("OpenRouter free route", () => {
  it("maps 429 to MODEL_UNAVAILABLE with no paid fallback", async () => {
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "test-key";
    const { streamOpenRouterFree } = await import("./openrouter");
    const { ApiError } = await import("./errors");
    const { LIMITS } = await import("@/contracts/limits");
    expect(LIMITS.model).toBe("openrouter/free");
    await expect(
      streamOpenRouterFree([{ role: "user", content: "hi" }], { onText: () => undefined }),
    ).rejects.toMatchObject({
      status: 503,
      code: "MODEL_UNAVAILABLE",
    } satisfies Partial<InstanceType<typeof ApiError>>);
    await expect(
      streamOpenRouterFree([{ role: "user", content: "hi" }], { onText: () => undefined }),
    ).rejects.toThrow(/no paid fallback/i);
  });
});
