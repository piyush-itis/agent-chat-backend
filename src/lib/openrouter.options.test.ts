import { describe, expect, it, vi } from "vitest";

const create = vi.fn();

vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create } };
    constructor() {}
  }
  return { default: OpenAI };
});

async function* emptyStream() {
  yield { choices: [{ delta: { content: "Hi." } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
}

describe("OpenRouter chat-only options", () => {
  it("excludes reasoning and does not advertise tools on chat-only hops", async () => {
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "test-key";
    create.mockResolvedValue(emptyStream());
    const { streamOpenRouterFree } = await import("./openrouter");
    await streamOpenRouterFree([{ role: "user", content: "hi" }], { onText: () => undefined }, {
      reasoningEffort: "none",
      excludeReasoning: true,
      timeoutMs: 12_000,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning: { effort: "none", exclude: true },
      }),
    );
    expect(create.mock.calls[0]?.[0]?.tools).toBeUndefined();
    expect(create.mock.calls[0]?.[0]?.max_tokens).toBeUndefined();
  });
});
