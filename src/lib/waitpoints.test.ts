import { describe, expect, it } from "vitest";
import { waitpointPayloadSchema } from "@/contracts/api";
import { extractChoices, parseSnapshot, serializeWaitpoint, waitpointKindForPlan } from "./waitpoints";

describe("waitpoints", () => {
  it("extracts numbered and dashed choices", () => {
    const choices = extractChoices("1. Crop first\n2. Then merge\n- Skip");
    expect(choices).toHaveLength(3);
    expect(choices[0]).toEqual({ id: "1", label: "Crop first" });
  });

  it("uses options kind when there are two or more choices", () => {
    const result = waitpointKindForPlan("1. Generate\n2. Crop");
    expect(result.kind).toBe("options");
    expect(result.payload.choices?.length).toBe(2);
  });

  it("uses plan kind for free-form text", () => {
    const result = waitpointKindForPlan("I will generate an image then crop it.");
    expect(result.kind).toBe("plan");
  });

  it("defaults invalid snapshots", () => {
    expect(parseSnapshot(null)).toEqual({ version: 1 });
    expect(parseSnapshot({ version: 1, planMode: true }).planMode).toBe(true);
  });

  it("accepts a questions waitpoint payload and skipped empty answers", () => {
    const parsed = waitpointPayloadSchema.parse({
      title: "Waiting for your input",
      summary: "Let's nail down a few details.",
      message: "Let's nail down a few details.",
      questions: [
        { id: "Q1", prompt: "App name?", required: true, answer: "Galaxy Chat" },
        { id: "Q2", prompt: "Style?", required: true, answer: "" },
      ],
    });
    expect(parsed.questions).toHaveLength(2);
    expect(parsed.questions?.[1]?.answer).toBe("");
  });

  it("serializes a text-cast questions waitpoint including JSON payloads", () => {
    const dto = serializeWaitpoint({
      id: "wp_1",
      token: "tok",
      runId: "run_1",
      kind: "questions",
      payload: JSON.stringify({
        title: "Waiting for your input",
        summary: "Details",
        message: "Details",
        questions: [{ id: "Q1", prompt: "What style?" }],
      }),
      status: "open",
      resumeKey: "resume_1",
      expiresAt: new Date("2026-09-13T00:00:00.000Z"),
      createdAt: new Date("2026-09-13T00:00:00.000Z"),
    });
    expect(dto.kind).toBe("questions");
    expect(dto.payload.questions?.[0]?.prompt).toBe("What style?");
  });
});
