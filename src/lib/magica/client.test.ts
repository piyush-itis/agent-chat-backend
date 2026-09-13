import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/errors";
import { getNodeRun, pollNodeRun } from "./client";

describe("Magica client failures", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps Magica 429 to PROVIDER_RATE_LIMITED", async () => {
    process.env.MAGICA_API_KEY = process.env.MAGICA_API_KEY || "test";
    process.env.MAGICA_BASE_URL = process.env.MAGICA_BASE_URL || "https://inference.magica.com";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 429,
        ok: false,
        json: async () => ({}),
      }),
    );
    await expect(getNodeRun("run_1")).rejects.toMatchObject({
      status: 429,
      code: "PROVIDER_RATE_LIMITED",
    } satisfies Partial<ApiError>);
  });

  it("times out a non-terminal poll", async () => {
    process.env.MAGICA_API_KEY = process.env.MAGICA_API_KEY || "test";
    process.env.MAGICA_BASE_URL = process.env.MAGICA_BASE_URL || "https://inference.magica.com";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ id: "run_1", status: "RUNNING" }),
      }),
    );
    await expect(pollNodeRun("run_1", { intervalMs: 1, maxAttempts: 1 })).rejects.toMatchObject({
      status: 504,
      code: "PROVIDER_TIMEOUT",
    } satisfies Partial<ApiError>);
  });
});
