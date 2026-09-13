import { describe, expect, it } from "vitest";
import {
  applyCropTargetToArgs,
  askQuestionsInput,
  cropRectFromAnswer,
  cropTargetInstruction,
  CROP_TARGET_QUESTION,
  isCropTargetAsk,
  needsCropTarget,
  normalizeAskQuestions,
  questionIds,
  reusedCropTargetAnswers,
} from "./questions";

describe("ask_questions", () => {
  it("accepts 1–6 questions with a message", () => {
    expect(
      askQuestionsInput.safeParse({
        message: "Let's nail down a few details.",
        questions: [{ prompt: "App name?" }, { prompt: "Style?", required: true }],
      }).success,
    ).toBe(true);
  });

  it("rejects an empty question list or more than 3 questions", () => {
    expect(askQuestionsInput.safeParse({ message: "Hi", questions: [] }).success).toBe(false);
    expect(
      askQuestionsInput.safeParse({
        message: "Hi",
        questions: [{ prompt: "a" }, { prompt: "b" }, { prompt: "c" }, { prompt: "d" }],
      }).success,
    ).toBe(false);
  });

  it("numbers questions Q1…Qn", () => {
    expect(questionIds(3)).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("accepts Magica choice questions", () => {
    expect(
      askQuestionsInput.safeParse({
        message: "Need a crop target.",
        questions: [CROP_TARGET_QUESTION],
      }).success,
    ).toBe(true);
  });

  it("rewrites a crop ask without choices into the Magica crop-target preset", () => {
    const normalized = normalizeAskQuestions({
      message: "I need a crop region.",
      questions: [{ prompt: "Please specify percent or pixel coordinates" }],
    });
    expect(normalized.questions).toHaveLength(1);
    expect(normalized.questions[0]?.prompt).toBe("Choose a crop target");
    expect(normalized.questions[0]?.choices?.map((choice) => choice.label)).toEqual(
      CROP_TARGET_QUESTION.choices.map((choice) => choice.label),
    );
  });

  it("leaves a non-crop ask unchanged", () => {
    const raw = {
      message: "Let's nail down a few details.",
      questions: [{ prompt: "App name?", required: true }],
    };
    expect(normalizeAskQuestions(raw)).toEqual(raw);
  });

  it("pauses crop-without-ratio and skips an already-specified target", () => {
    const empty = { version: 1 as const };
    expect(needsCropTarget("crop this image", empty)).toBe(true);
    expect(needsCropTarget("crop this to 1:1", empty)).toBe(false);
    expect(needsCropTarget("crop this image", { version: 1, questionAnswers: { q: { Q1: "Square (1:1)" } } })).toBe(
      false,
    );
    expect(needsCropTarget("make a logo", empty)).toBe(false);
  });

  it("maps preset crop answers to a centered percent rectangle", () => {
    expect(cropRectFromAnswer("Portrait (4:5)")).toEqual({
      x: 10,
      y: 0,
      width: 80,
      height: 100,
      unit: "percent",
    });
    expect(cropRectFromAnswer("Landscape (16:9)")).toEqual({
      x: 0,
      y: 21.875,
      width: 100,
      height: 56.25,
      unit: "percent",
    });
    expect(cropRectFromAnswer("Story / Reel (9:16)")).toEqual({
      x: 21.875,
      y: 0,
      width: 56.25,
      height: 100,
      unit: "percent",
    });
    expect(cropRectFromAnswer("Square (1:1)")).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      unit: "percent",
    });
    expect(cropRectFromAnswer("Custom region or ratio")).toBeNull();
  });

  it("reuses a prior crop-target answer instead of asking again", () => {
    const snapshot = { version: 1 as const, questionAnswers: { first: { Q1: "Portrait (4:5)" } } };
    const cropAsk = {
      message: "Choose a crop target for your image",
      questions: [{ prompt: "Choose a crop target", choices: CROP_TARGET_QUESTION.choices.map((choice) => ({ ...choice })) }],
    };
    expect(isCropTargetAsk(cropAsk)).toBe(true);
    expect(reusedCropTargetAnswers(cropAsk, snapshot)).toEqual({ Q1: "Portrait (4:5)" });
    expect(
      reusedCropTargetAnswers(
        { message: "App name?", questions: [{ prompt: "What should we call it?" }] },
        snapshot,
      ),
    ).toBeNull();
    expect(
      reusedCropTargetAnswers(cropAsk, {
        version: 1,
        questionAnswers: { first: { Q1: "Custom region or ratio" } },
      }),
    ).toBeNull();
  });

  it("fills a missing crop rectangle from the answered target", () => {
    const snapshot = { version: 1 as const, questionAnswers: { q: { Q1: "Portrait (4:5)" } } };
    expect(applyCropTargetToArgs({}, snapshot, "https://x.test/a.png")).toEqual({
      image_url: "https://x.test/a.png",
      crop: { x: 10, y: 0, width: 80, height: 100 },
      unit: "percent",
    });
    expect(applyCropTargetToArgs({ image_url: "https://x.test/a.png" }, snapshot)).toEqual({
      image_url: "https://x.test/a.png",
      crop: { x: 10, y: 0, width: 80, height: 100 },
      unit: "percent",
    });
    expect(
      applyCropTargetToArgs({ image_url: "https://x.test/a.png", x: 0, y: 0, width: 20, height: 20 }, snapshot),
    ).toEqual({ image_url: "https://x.test/a.png", x: 0, y: 0, width: 20, height: 20 });
    expect(cropTargetInstruction(snapshot)).toMatch(/do not call ask_questions again/i);
  });
});
