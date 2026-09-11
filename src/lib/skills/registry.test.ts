import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  listSkillMeta,
  parseFrontmatter,
  readSkillAsset,
  scanSkillDirectory,
  SkillError,
} from "./registry";

function writeSkill(root: string, folder: string, yaml: string, extra?: { file: string; body: string }) {
  const dir = join(root, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), yaml);
  if (extra) writeFileSync(join(dir, extra.file), extra.body);
}

describe("skills registry", () => {
  it("exposes only names and descriptions until a skill is loaded", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-"));
    writeSkill(
      root,
      "image-generation",
      "---\nname: image-generation\ndescription: Generate images\n---\n\n# Secret body\n",
    );
    const skills = scanSkillDirectory(root);
    expect(listSkillMeta(skills)).toEqual([
      { name: "image-generation", description: "Generate images" },
    ]);
    expect(skills.get("image-generation")?.body).toContain("Secret body");
  });

  it("rejects malformed frontmatter", () => {
    expect(() => parseFrontmatter("# no yaml")).toThrow(SkillError);
    expect(() => parseFrontmatter("---\nname: only\n---\nbody")).toThrow(/description/);
  });

  it("rejects duplicate skill names", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-"));
    writeSkill(root, "a", "---\nname: dup\ndescription: one\n---\n\nA\n");
    writeSkill(root, "b", "---\nname: dup\ndescription: two\n---\n\nB\n");
    expect(() => scanSkillDirectory(root)).toThrow(/Duplicate/);
  });

  it("rejects unknown skills and path traversal", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-"));
    writeSkill(
      root,
      "image-cropping",
      "---\nname: image-cropping\ndescription: Crop\n---\n\nBody\n",
      { file: "notes.md", body: "ok" },
    );
    const skills = scanSkillDirectory(root);
    expect(() => readSkillAsset(skills, "missing", "notes.md")).toThrow(/Unknown skill/);
    expect(() => readSkillAsset(skills, "image-cropping", "../secret.txt")).toThrow(/traversal/i);
    expect(() => readSkillAsset(skills, "image-cropping", "/etc/passwd")).toThrow(/traversal/i);
    expect(readSkillAsset(skills, "image-cropping", "notes.md").content).toBe("ok");
  });

  it("dedupes skill identity by name and pins content hash", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-"));
    writeSkill(root, "video-merging", "---\nname: video-merging\ndescription: Merge\n---\n\nFirst\n");
    const first = scanSkillDirectory(root).get("video-merging");
    writeFileSync(
      join(root, "video-merging", "SKILL.md"),
      "---\nname: video-merging\ndescription: Merge\n---\n\nSecond\n",
    );
    const second = scanSkillDirectory(root).get("video-merging");
    expect(first?.contentHash).not.toBe(second?.contentHash);
    expect(first?.name).toBe(second?.name);
  });
});
