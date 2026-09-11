import { describe, expect, it } from "vitest";
import { cropImageInput } from "./tools";
import { mapMagicaCredits } from "./client";

describe("magica contracts", () => {
  it("rejects an incomplete crop rectangle", () => {
    const parsed = cropImageInput.safeParse({ image_url: "https://example.com/a.png", x: 1, y: 2 });
    expect(parsed.success).toBe(false);
  });

  it("accepts crop object or complete flat coordinates", () => {
    expect(
      cropImageInput.safeParse({
        image_url: "https://example.com/a.png",
        crop: { x: 0, y: 0, width: 10, height: 10 },
      }).success,
    ).toBe(true);
    expect(
      cropImageInput.safeParse({
        image_url: "https://example.com/a.png",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        unit: "percent",
      }).success,
    ).toBe(true);
  });

  it("maps Magica microcredits to application credits", () => {
    expect(mapMagicaCredits(0)).toBe(0);
    expect(mapMagicaCredits(2_500_000)).toBe(3);
  });
});
