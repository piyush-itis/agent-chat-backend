import { afterEach, describe, expect, it } from "vitest";
import { triggerPreviewBranch } from "./trigger-client";

describe("triggerPreviewBranch", () => {
  const preview = process.env.TRIGGER_PREVIEW_BRANCH;
  const vercelEnv = process.env.VERCEL_ENV;

  afterEach(() => {
    if (preview === undefined) delete process.env.TRIGGER_PREVIEW_BRANCH;
    else process.env.TRIGGER_PREVIEW_BRANCH = preview;
    if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = vercelEnv;
  });

  it("uses an explicit preview branch when set", () => {
    process.env.TRIGGER_PREVIEW_BRANCH = "feature-x";
    process.env.VERCEL_ENV = "production";
    expect(triggerPreviewBranch()).toBe("feature-x");
  });

  it("clears the auto Vercel git branch on production so Trigger does not 500", () => {
    delete process.env.TRIGGER_PREVIEW_BRANCH;
    process.env.VERCEL_ENV = "production";
    expect(triggerPreviewBranch()).toBe("");
  });

  it("leaves branch detection alone off production", () => {
    delete process.env.TRIGGER_PREVIEW_BRANCH;
    delete process.env.VERCEL_ENV;
    expect(triggerPreviewBranch()).toBeUndefined();
  });
});
