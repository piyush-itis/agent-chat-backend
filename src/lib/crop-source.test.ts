import { describe, expect, it } from "vitest";
import {
  alreadyCropped,
  buildAutoCropCall,
  dropCompletedCropCalls,
  pickCropImageUrl,
  resolveCropImageUrl,
} from "./crop-source";

describe("crop source", () => {
  it("prefers the current message image over older chat or generated media", () => {
    expect(
      pickCropImageUrl({
        messageUrl: "https://cdn.example/bookstore.png",
        chatUrl: "https://cdn.example/old.png",
        generatedUrl: "https://g.tlcdn.com/gen/umbrella.png",
      }),
    ).toBe("https://cdn.example/bookstore.png");
    expect(pickCropImageUrl({ chatUrl: "https://cdn.example/old.png", generatedUrl: "https://g.tlcdn.com/gen/a.png" })).toBe(
      "https://cdn.example/old.png",
    );
    expect(pickCropImageUrl({ generatedUrl: "https://g.tlcdn.com/gen/a.png" })).toBe("https://g.tlcdn.com/gen/a.png");
  });

  it("replaces a model image_url with the trusted chat image", () => {
    expect(
      resolveCropImageUrl(
        { image_url: "https://pub-typo.r2.dev/missing.png", crop: { x: 0, y: 0, width: 10, height: 10 } },
        "https://cdn.example/bookstore.png",
      ),
    ).toEqual({
      image_url: "https://cdn.example/bookstore.png",
      crop: { x: 0, y: 0, width: 10, height: 10 },
    });
  });

  it("builds a Landscape crop call without a model tool call", () => {
    const call = buildAutoCropCall({
      userMessageId: "msg_1",
      imageUrl: "https://cdn.example/bookstore.png",
      snapshot: { version: 1, questionAnswers: { q: { Q1: "Landscape (16:9)" } } },
      alreadyCropped: false,
    });
    expect(call?.id).toBe("auto-crop:msg_1");
    expect(call?.name).toBe("crop_image");
    expect(JSON.parse(call?.arguments ?? "{}")).toEqual({
      image_url: "https://cdn.example/bookstore.png",
      crop: { x: 0, y: 21.875, width: 100, height: 56.25 },
      unit: "percent",
    });
    expect(
      buildAutoCropCall({
        userMessageId: "msg_1",
        imageUrl: "https://cdn.example/bookstore.png",
        snapshot: { version: 1, questionAnswers: { q: { Q1: "Landscape (16:9)" } } },
        alreadyCropped: true,
      }),
    ).toBeNull();
    expect(
      alreadyCropped([
        {
          type: "tool_result",
          invocationId: "c1",
          toolName: "crop_image",
          output: { image_url: "https://cdn.example/cropped.png" },
          status: "success",
        },
      ]),
    ).toBe(true);
  });

  it("drops a second crop_image once one has already succeeded", () => {
    expect(
      dropCompletedCropCalls(
        [
          { id: "auto-crop:msg", name: "crop_image", arguments: "{}" },
          { id: "call_2", name: "ask_questions", arguments: "{}" },
        ],
        true,
      ),
    ).toEqual([{ id: "call_2", name: "ask_questions", arguments: "{}" }]);
    expect(dropCompletedCropCalls([{ id: "c1", name: "crop_image", arguments: "{}" }], false)).toHaveLength(1);
  });
});
