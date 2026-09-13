import { afterEach, describe, expect, it } from "vitest";
import { usesTriggerDispatch } from "./dispatch";

describe("dispatch mode", () => {
  const secret = process.env.TRIGGER_SECRET_KEY;
  const mode = process.env.DISPATCH_MODE;

  afterEach(() => {
    if (secret === undefined) delete process.env.TRIGGER_SECRET_KEY;
    else process.env.TRIGGER_SECRET_KEY = secret;
    if (mode === undefined) delete process.env.DISPATCH_MODE;
    else process.env.DISPATCH_MODE = mode;
  });

  it("uses Trigger when a secret is set and mode is not inline", () => {
    process.env.TRIGGER_SECRET_KEY = "tr_test";
    process.env.DISPATCH_MODE = "trigger";
    expect(usesTriggerDispatch()).toBe(true);
  });

  it("stays inline when DISPATCH_MODE=inline even if a secret exists", () => {
    process.env.TRIGGER_SECRET_KEY = "tr_test";
    process.env.DISPATCH_MODE = "inline";
    expect(usesTriggerDispatch()).toBe(false);
  });

  it("stays inline when the Trigger secret is missing", () => {
    delete process.env.TRIGGER_SECRET_KEY;
    process.env.DISPATCH_MODE = "trigger";
    expect(usesTriggerDispatch()).toBe(false);
  });
});
