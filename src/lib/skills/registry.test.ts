import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSkillIdentity,
  defaultSkillsRoot,
  getSkillMap,
  listSkillMeta,
  parseFrontmatter,
  readSkillAsset,
  resetSkillCache,
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
  it("loads the shipped skills from agent-skills without extra registration", () => {
    resetSkillCache();
    const names = listSkillMeta(getSkillMap(defaultSkillsRoot())).map((skill) => skill.name);
    expect(names).toEqual(["image-cropping", "image-generation", "video-merging"]);
  });

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
    writeSkill(root, "shared-name", "---\nname: shared-name\ndescription: one\n---\n\nA\n");
    writeSkill(root, "other-folder", "---\nname: shared-name\ndescription: two\n---\n\nB\n");
    expect(listSkillMeta(scanSkillDirectory(root))).toEqual([
      { name: "shared-name", description: "one" },
    ]);
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

  it("discovers a fourth skill from a new folder with no extra registration", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-"));
    writeSkill(root, "image-generation", "---\nname: image-generation\ndescription: Generate images\n---\n\nA\n");
    writeSkill(root, "image-cropping", "---\nname: image-cropping\ndescription: Crop\n---\n\nB\n");
    writeSkill(root, "video-merging", "---\nname: video-merging\ndescription: Merge\n---\n\nC\n");
    writeSkill(root, "logo-lockup", "---\nname: logo-lockup\ndescription: Guide a wordmark lockup\n---\n\nD\n");
    expect(listSkillMeta(scanSkillDirectory(root)).map((skill) => skill.name)).toEqual([
      "image-cropping",
      "image-generation",
      "logo-lockup",
      "video-merging",
    ]);
  });

  it("keeps valid skills when another folder fails validation", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-"));
    writeSkill(root, "image-generation", "---\nname: image-generation\ndescription: Generate images\n---\n\nA\n");
    writeSkill(root, "broken", "# no frontmatter\n");
    writeSkill(root, "wrong-folder", "---\nname: not-the-folder\ndescription: Nope\n---\n\nX\n");
    expect(listSkillMeta(scanSkillDirectory(root))).toEqual([
      { name: "image-generation", description: "Generate images" },
    ]);
  });

  it("rejects a folder name that does not match frontmatter name", () => {
    expect(() => assertSkillIdentity("folder-a", "folder-b", "ok")).toThrow(/must match folder/);
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
