import { describe, expect, it } from "vitest";
import { ALLOWED_MIME, MAX_FILE_BYTES, completeUpload, signAssembly } from "./uploads";
import { ApiError } from "./errors";

describe("uploads", () => {
  it("rejects when Transloadit secrets are missing", () => {
    const previousKey = process.env.TRANSLOADIT_KEY;
    const previousSecret = process.env.TRANSLOADIT_SECRET;
    delete process.env.TRANSLOADIT_KEY;
    delete process.env.TRANSLOADIT_SECRET;
    try {
      expect(() =>
        signAssembly({ mimeType: "image/png", byteSize: 10, originalName: "a.png" }),
      ).toThrow(ApiError);
    } finally {
      if (previousKey) process.env.TRANSLOADIT_KEY = previousKey;
      if (previousSecret) process.env.TRANSLOADIT_SECRET = previousSecret;
    }
  });

  it("enforces Community MIME and size constants", () => {
    expect(ALLOWED_MIME).toContain("image/png");
    expect(ALLOWED_MIME).toContain("video/mp4");
    expect(MAX_FILE_BYTES).toBe(Math.floor(0.5 * 1024 * 1024 * 1024));
  });

  it("rejects complete without a resultUrl", async () => {
    await expect(
      completeUpload({
        userId: "user_1",
        assemblyId: "asm_1",
        mimeType: "image/png",
        byteSize: 12,
        originalName: "a.png",
      }),
    ).rejects.toMatchObject({ status: 400, code: "VALIDATION" } satisfies Partial<ApiError>);
  });

  it("rejects oversized files on complete", async () => {
    await expect(
      completeUpload({
        userId: "user_1",
        assemblyId: "asm_1",
        mimeType: "image/png",
        byteSize: MAX_FILE_BYTES + 1,
        originalName: "huge.png",
        resultUrl: "https://example.com/a.png",
      }),
    ).rejects.toMatchObject({ status: 400, code: "VALIDATION" } satisfies Partial<ApiError>);
  });
});
