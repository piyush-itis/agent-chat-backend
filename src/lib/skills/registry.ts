import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, relative, resolve, sep } from "node:path";

export const SKILL_BODY_MAX_BYTES = 64 * 1024;
export const SKILL_ASSET_MAX_BYTES = 512 * 1024;
export const SKILL_DESCRIPTION_MAX = 512;
export const SKILL_NAME_RE = /^[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const ALLOWED_ASSET_EXT = new Set([".md", ".txt", ".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export type SkillMeta = {
  name: string;
  description: string;
};

export type LoadedSkill = SkillMeta & {
  dir: string;
  body: string;
  contentHash: string;
};

export type SkillAsset = {
  name: string;
  path: string;
  contentHash: string;
  mediaType: string;
  content: string;
};

export class SkillError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "SkillError";
  }
}

export function parseFrontmatter(raw: string): { name: string; description: string; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new SkillError("MALFORMED_FRONTMATTER", "SKILL.md must start with YAML frontmatter");
  }
  const yaml = match[1];
  const body = match[2].trim();
  const name = yamlMatch(yaml, "name");
  const description = yamlMatch(yaml, "description");
  if (!name || !description) {
    throw new SkillError("MALFORMED_FRONTMATTER", "Frontmatter must include name and description");
  }
  return { name, description, body };
}

function yamlMatch(yaml: string, key: string): string | null {
  const line = yaml.split(/\r?\n/).find((entry) => entry.startsWith(`${key}:`));
  if (!line) return null;
  return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

export function assertSkillIdentity(folder: string, name: string, description: string): void {
  if (!SKILL_NAME_RE.test(folder)) {
    throw new SkillError("INVALID_NAME", `Skill folder must be kebab-case: ${folder}`);
  }
  if (name !== folder) {
    throw new SkillError("NAME_MISMATCH", `Frontmatter name "${name}" must match folder "${folder}"`);
  }
  if (!description || description.length > SKILL_DESCRIPTION_MAX) {
    throw new SkillError("MALFORMED_FRONTMATTER", "Description is missing or too long");
  }
}

export function hashContent(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function scanSkillDirectory(root: string): Map<string, LoadedSkill> {
  const skills = new Map<string, LoadedSkill>();
  if (!existsSync(root)) {
    throw new SkillError("MISSING_DIR", `Skill directory not found: ${root}`);
  }
  const approvedRoot = resolve(root);

  for (const entry of readdirSync(approvedRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(approvedRoot, entry.name);
    const skillPath = join(dir, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    try {
      const stat = statSync(skillPath);
      if (stat.size > SKILL_BODY_MAX_BYTES) {
        throw new SkillError("OVERSIZED", `SKILL.md too large in ${entry.name}`);
      }
      const raw = readFileSync(skillPath, "utf8");
      const parsed = parseFrontmatter(raw);
      assertSkillIdentity(entry.name, parsed.name, parsed.description);
      if (skills.has(parsed.name)) {
        throw new SkillError("DUPLICATE", `Duplicate skill name: ${parsed.name}`);
      }
      skills.set(parsed.name, {
        name: parsed.name,
        description: parsed.description,
        dir,
        body: parsed.body,
        contentHash: hashContent(parsed.body),
      });
    } catch (error) {
      if (error instanceof SkillError && error.code === "DUPLICATE") throw error;
      continue;
    }
  }
  return skills;
}

export function listSkillMeta(skills: Map<string, LoadedSkill>): SkillMeta[] {
  return [...skills.values()]
    .map(({ name, description }) => ({ name, description }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function readSkillAsset(
  skills: Map<string, LoadedSkill>,
  name: string,
  userPath: string,
): SkillAsset {
  const skill = skills.get(name);
  if (!skill) {
    throw new SkillError("UNKNOWN_SKILL", `Unknown skill: ${name}`);
  }
  if (!userPath || userPath.includes("\0")) {
    throw new SkillError("TRAVERSAL", "Invalid skill asset path");
  }
  const cleaned = userPath.replaceAll("\\", "/");
  if (cleaned.startsWith("/") || cleaned.split("/").some((part) => part === "..")) {
    throw new SkillError("TRAVERSAL", "Path traversal is not allowed");
  }

  const target = resolve(skill.dir, normalize(cleaned));
  const rel = relative(skill.dir, target);
  if (rel.startsWith("..") || rel.includes(`..${sep}`) || resolve(target) === resolve(skill.dir)) {
    throw new SkillError("TRAVERSAL", "Path traversal is not allowed");
  }

  const ext = extname(target).toLowerCase();
  if (!ALLOWED_ASSET_EXT.has(ext)) {
    throw new SkillError("UNSUPPORTED", `Unsupported asset type: ${ext || "unknown"}`);
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    throw new SkillError("NOT_FOUND", "Skill asset not found");
  }
  const stat = statSync(target);
  if (stat.size > SKILL_ASSET_MAX_BYTES) {
    throw new SkillError("OVERSIZED", "Skill asset is too large");
  }
  const content = readFileSync(target);
  const isText = ext === ".md" || ext === ".txt";
  return {
    name,
    path: cleaned,
    contentHash: hashContent(content.toString("base64")),
    mediaType: isText ? "text/plain" : "application/octet-stream",
    content: isText ? content.toString("utf8") : content.toString("base64"),
  };
}

let cached: { root: string; fingerprint: string; skills: Map<string, LoadedSkill> } | null = null;

export function defaultSkillsRoot(): string {
  return resolve(process.cwd(), "agent-skills");
}

function skillsFingerprint(root: string): string {
  if (!existsSync(root)) return "";
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const skillPath = join(root, entry.name, "SKILL.md");
      if (!existsSync(skillPath)) return entry.name;
      const stat = statSync(skillPath);
      return `${entry.name}:${stat.mtimeMs}:${stat.size}`;
    })
    .sort()
    .join("|");
}

export function getSkillMap(root?: string): Map<string, LoadedSkill> {
  const resolved = root ?? cached?.root ?? defaultSkillsRoot();
  const fingerprint = skillsFingerprint(resolved);
  if (!cached || cached.root !== resolved || cached.fingerprint !== fingerprint) {
    cached = { root: resolved, fingerprint, skills: scanSkillDirectory(resolved) };
  }
  return cached.skills;
}

export function resetSkillCache(): void {
  cached = null;
}
