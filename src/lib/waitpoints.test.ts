import { describe, expect, it } from "vitest";
import { extractChoices, parseSnapshot, waitpointKindForPlan } from "./waitpoints";

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
});
