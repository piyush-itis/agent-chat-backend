import { describe, expect, it } from "vitest";
import { z } from "zod";
import { advertisedTools, catalogPromptLines, listCatalogTools, registerTool } from "./registry";

registerTool({
  name: "unit_catalog_probe",
  description: "Unit-test catalog tool",
  input: z.object({ ping: z.string() }),
  output: z.object({ pong: z.string() }),
  renderHint: "text",
  exposure: "catalog",
  billable: false,
  estimateCredits: async () => ({ applicationCredits: 0 }),
  execute: async () => ({ pong: "ok" }),
});

describe("advertisedTools", () => {
  it("always advertises Magica tools and omits catalog tools until loaded", () => {
    const names = advertisedTools().map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["crop_image", "gpt_image_2", "merge_videos", "load_tool"]));
    expect(names).not.toContain("unit_catalog_probe");
    expect(advertisedTools(["unit_catalog_probe"]).map((tool) => tool.name)).toContain("unit_catalog_probe");
  });

  it("omits completed Magica tools even when they are always-on", () => {
    expect(advertisedTools([], ["crop_image"]).map((tool) => tool.name)).not.toContain("crop_image");
  });

  it("lists catalog names only when a catalog tool exists", () => {
    expect(listCatalogTools().map((tool) => tool.name)).toContain("unit_catalog_probe");
    expect(catalogPromptLines()).toContain("unit_catalog_probe");
  });
});
