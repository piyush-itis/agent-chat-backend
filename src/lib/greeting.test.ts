import { describe, expect, it } from "vitest";
import { isGreetingOnly, localChatReply } from "./greeting";

describe("localChatReply", () => {
  it("answers greetings and how-are-you without the model", () => {
    expect(localChatReply("hi")).toMatch(/work on/);
    expect(localChatReply("how are you")).toMatch(/Doing well/);
    expect(localChatReply("thanks")).toMatch(/welcome/i);
    expect(localChatReply("generate a logo")).toBeNull();
    expect(localChatReply("what's 2+2")).toBeNull();
  });
});

describe("isGreetingOnly", () => {
  it("accepts short hellos", () => {
    expect(isGreetingOnly("hi")).toBe(true);
    expect(isGreetingOnly("say hi")).toBe(true);
    expect(isGreetingOnly("heyey")).toBe(true);
    expect(isGreetingOnly("Hello there!")).toBe(true);
  });

  it("rejects real tasks", () => {
    expect(isGreetingOnly("say hi and crop this")).toBe(false);
    expect(isGreetingOnly("generate a logo")).toBe(false);
  });
});
