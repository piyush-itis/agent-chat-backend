import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";

describe("cursor pagination", () => {
  it("round-trips createdAt + id", () => {
    const createdAt = new Date("2026-09-11T12:00:00.000Z");
    const encoded = encodeCursor({ createdAt, id: "msg_2" });
    expect(decodeCursor(encoded)).toEqual({ createdAt, id: "msg_2" });
  });

  it("orders two pages by (createdAt, id) without offset", () => {
    const rows = [
      { createdAt: new Date("2026-09-11T12:00:02.000Z"), id: "c" },
      { createdAt: new Date("2026-09-11T12:00:01.000Z"), id: "b" },
      { createdAt: new Date("2026-09-11T12:00:01.000Z"), id: "a" },
    ];
    const first = rows[0];
    const cursor = encodeCursor(first);
    const decoded = decodeCursor(cursor)!;
    const secondPage = rows.filter(
      (row) =>
        row.createdAt < decoded.createdAt ||
        (row.createdAt.getTime() === decoded.createdAt.getTime() && row.id < decoded.id),
    );
    expect(secondPage.map((row) => row.id)).toEqual(["b", "a"]);
  });

  it("returns null for junk cursors", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("not-a-cursor")).toBeNull();
  });
});
