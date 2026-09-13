import { describe, expect, it } from "vitest";
import {
  alreadyMerged,
  buildAutoMergeCall,
  dropCompletedMergeCalls,
  pickChatVideoUrls,
  resolveMergeVideoUrls,
  transitionFromText,
} from "./merge-source";

describe("merge source", () => {
  it("keeps message clips first, then chat, then generated, without duplicates", () => {
    expect(
      pickChatVideoUrls({
        messageUrls: ["https://cdn.example/a.mp4", "https://cdn.example/b.mp4"],
        chatUrls: ["https://cdn.example/a.mp4", "https://cdn.example/old.mp4"],
        generatedUrls: ["https://g.tlcdn.com/gen/c.mp4"],
      }),
    ).toEqual([
      "https://cdn.example/a.mp4",
      "https://cdn.example/b.mp4",
      "https://cdn.example/old.mp4",
      "https://g.tlcdn.com/gen/c.mp4",
    ]);
  });

  it("replaces a typo or short model list with trusted chat clips", () => {
    const trusted = ["https://cdn.example/a.mp4", "https://cdn.example/b.mp4"];
    expect(
      resolveMergeVideoUrls(
        { video_urls: ["https://pub-typo.r2.dev/missing.mp4"], transition: "fade" },
        trusted,
      ),
    ).toEqual({ video_urls: trusted, transition: "fade" });
    expect(resolveMergeVideoUrls({ transition: "none" }, trusted)).toEqual({
      video_urls: trusted,
      transition: "none",
    });
    expect(resolveMergeVideoUrls({ video_urls: trusted, transition: "fade" }, trusted)).toEqual({
      video_urls: trusted,
      transition: "fade",
    });
  });

  it("reads fade or dissolve from the user text and defaults to none", () => {
    expect(transitionFromText("merge these with a fade")).toBe("fade");
    expect(transitionFromText("concatenate with dissolve")).toBe("dissolve");
    expect(transitionFromText("merge these")).toBe("none");
  });

  it("builds an auto-merge call when two clips exist", () => {
    const call = buildAutoMergeCall({
      userMessageId: "msg_1",
      userText: "merge these with a fade",
      videoUrls: ["https://cdn.example/a.mp4", "https://cdn.example/b.mp4"],
      alreadyMerged: false,
    });
    expect(call?.id).toBe("auto-merge:msg_1");
    expect(call?.name).toBe("merge_videos");
    expect(JSON.parse(call?.arguments ?? "{}")).toEqual({
      video_urls: ["https://cdn.example/a.mp4", "https://cdn.example/b.mp4"],
      transition: "fade",
    });
    expect(
      buildAutoMergeCall({
        userMessageId: "msg_1",
        userText: "merge these",
        videoUrls: ["https://cdn.example/a.mp4"],
        alreadyMerged: false,
      }),
    ).toBeNull();
    expect(
      dropCompletedMergeCalls(
        [
          { id: "auto-merge:msg", name: "merge_videos", arguments: "{}" },
          { id: "call_2", name: "ask_questions", arguments: "{}" },
        ],
        true,
      ),
    ).toEqual([{ id: "call_2", name: "ask_questions", arguments: "{}" }]);
    expect(
      alreadyMerged([
        {
          type: "tool_result",
          invocationId: "m1",
          toolName: "merge_videos",
          output: { video_url: "https://cdn.example/out.mp4" },
          status: "success",
        },
      ]),
    ).toBe(true);
  });
});
