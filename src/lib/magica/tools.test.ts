import { describe, expect, it } from "vitest";
import { cropImageInput, cropProviderCandidate, pickSchemaInput } from "./tools";
import { formatMagicaCredits, mapMagicaCredits, readMagicaCreditUsed } from "./client";
import { extractMediaUrls } from "./run-tool";

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

  it("reads Magica creditUsed from the run or nested output", () => {
    expect(readMagicaCreditUsed(undefined)).toBe(0);
    expect(readMagicaCreditUsed({ status: "COMPLETED" })).toBe(0);
    expect(readMagicaCreditUsed({ status: "COMPLETED", creditUsed: 10000 })).toBe(10000);
    expect(
      readMagicaCreditUsed({
        status: "COMPLETED",
        output: { creditUsed: 214032, result: ["https://cdn.example/a.png"] },
      }),
    ).toBe(214032);
  });

  it("formats Magica units as M credits", () => {
    expect(formatMagicaCredits(10000)).toBe("0.01M credits");
    expect(formatMagicaCredits(240000)).toBe("0.24M credits");
    expect(formatMagicaCredits(214032)).toBe("0.21M credits");
    expect(formatMagicaCredits(0)).toBe("0.00M credits");
  });

  it("reads GPT Image 2 URLs from Magica output.result", () => {
    expect(
      extractMediaUrls({
        id: "cmtyeesed000dl504657yl7vk",
        status: "COMPLETED",
        output: {
          result: ["https://g.tlcdn.com/gen/example.png"],
          provider: "fal",
          creditUsed: 214032,
          resultMetadata: [{ mimeType: "image/png", mediaType: "image" }],
        },
      }),
    ).toEqual(["https://g.tlcdn.com/gen/example.png"]);
  });

  it("reads documented images[] and MCP assets[] shapes", () => {
    expect(
      extractMediaUrls({
        id: "doc",
        status: "COMPLETED",
        output: { images: ["https://cdn.example/a.png"] },
      }),
    ).toEqual(["https://cdn.example/a.png"]);
    expect(
      extractMediaUrls({
        id: "mcp",
        status: "COMPLETED",
        output: { assets: [{ type: "image", url: "https://cdn.example/b.png" }] },
      }),
    ).toEqual(["https://cdn.example/b.png"]);
  });

  it("maps a percent crop onto Magica schema fields only", () => {
    const schema = {
      fields: [
        { name: "image_url" },
        { name: "x_percent" },
        { name: "y_percent" },
        { name: "width_percent" },
        { name: "height_percent" },
      ],
    };
    expect(
      pickSchemaInput(
        schema,
        cropProviderCandidate("https://cdn.example/book.png", { x: 0, y: 21.875, width: 100, height: 56.25 }, "percent"),
      ),
    ).toEqual({
      image_url: "https://cdn.example/book.png",
      x_percent: 0,
      y_percent: 21.875,
      width_percent: 100,
      height_percent: 56.25,
    });
  });

  it("maps merge videos onto Magica schema fields only", () => {
    expect(
      pickSchemaInput(
        { fields: [{ name: "video_urls" }, { name: "transition" }] },
        { video_urls: ["https://cdn.example/a.mp4", "https://cdn.example/b.mp4"], transition: "fade", extra: true },
      ),
    ).toEqual({
      video_urls: ["https://cdn.example/a.mp4", "https://cdn.example/b.mp4"],
      transition: "fade",
    });
  });

  it("aliases image_url onto a schema image field", () => {
    expect(
      pickSchemaInput({ fields: [{ name: "image" }, { name: "prompt" }] }, { image_url: "https://cdn.example/a.png" }),
    ).toEqual({ image: "https://cdn.example/a.png" });
  });

  it("does not treat the source input URL as generated media", () => {
    expect(
      extractMediaUrls({
        id: "crop",
        status: "COMPLETED",
        input: { image_url: "https://cdn.example/source.png" },
        output: { result: ["https://cdn.example/cropped.png"] },
      }),
    ).toEqual(["https://cdn.example/cropped.png"]);
  });
});
