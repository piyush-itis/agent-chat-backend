import { describe, expect, it } from "vitest";
import { copyToDurableStorage, s3Configured } from "./storage";

describe("storage", () => {
  it("is a no-op when S3 env is unset", async () => {
    const previous = {
      S3_ENDPOINT: process.env.S3_ENDPOINT,
      S3_BUCKET: process.env.S3_BUCKET,
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    };
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    try {
      expect(s3Configured()).toBe(false);
      await expect(copyToDurableStorage("https://example.com/a.png")).resolves.toBe(
        "https://example.com/a.png",
      );
    } finally {
      Object.assign(process.env, previous);
    }
  });
});
