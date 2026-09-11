import { describe, expect, it } from "vitest";
import { chatSearchWhere } from "./chats";

describe("chat search where", () => {
  it("filters only by user when query is empty", () => {
    expect(chatSearchWhere("user_1", "  ")).toEqual({ userId: "user_1", deletedAt: null });
  });

  it("adds title and message filters then keeps the same ownership clause", () => {
    const where = chatSearchWhere("user_1", "crop");
    expect(where.userId).toBe("user_1");
    expect(where.deletedAt).toBeNull();
    expect(where.OR).toBeDefined();
  });
});
