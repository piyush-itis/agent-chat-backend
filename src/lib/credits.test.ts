import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ prisma: {} }));

import { creditsFromTokens } from "./credits";

describe("creditsFromTokens", () => {
  it("charges the exact OpenRouter token count", () => {
    expect(creditsFromTokens(0, 0)).toBe(0);
    expect(creditsFromTokens(120, 47)).toBe(167);
    expect(creditsFromTokens(12.4, 0.6)).toBe(13);
  });
});
