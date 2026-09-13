import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findRun = vi.fn();
const upsertSkill = vi.fn();
const updateRun = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    agentRun: {
      findUnique: (...args: unknown[]) => findRun(...args),
      update: (...args: unknown[]) => updateRun(...args),
    },
    runSkill: { upsert: (...args: unknown[]) => upsertSkill(...args) },
  },
}));

describe("load_skill persistence", () => {
  beforeEach(() => {
    findRun.mockReset();
    upsertSkill.mockReset();
    updateRun.mockReset();
    findRun.mockResolvedValue({ sessionSnapshot: { version: 1 } });
    upsertSkill.mockResolvedValue({});
    updateRun.mockResolvedValue({});
  });

  it("upserts RunSkill and pins the body on AgentRun", async () => {
    const root = mkdtempSync(join(tmpdir(), "skills-tools-"));
    mkdirSync(join(root, "image-generation"));
    writeFileSync(
      join(root, "image-generation", "SKILL.md"),
      "---\nname: image-generation\ndescription: Generate images\n---\n\n# Body\n",
    );
    const { resetSkillCache, getSkillMap } = await import("./registry");
    resetSkillCache();
    getSkillMap(root);
    const { executeLoadSkill } = await import("./tools");
    const loaded = await executeLoadSkill(
      { runId: "run_1", chatId: "chat_1", userId: "user_1", toolCallId: "call_1" },
      { name: "image-generation" },
    );
    expect(loaded.body).toContain("# Body");
    expect(upsertSkill).toHaveBeenCalled();
    expect(updateRun).toHaveBeenCalled();
  });
});
