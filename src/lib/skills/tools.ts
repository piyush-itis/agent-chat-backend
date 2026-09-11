import { z } from "zod";
import { prisma } from "@/lib/db";
import type { ToolContext } from "@/lib/registry";
import { SkillError, getSkillMap, listSkillMeta, readSkillAsset } from "./registry";

export const loadSkillInput = z.object({ name: z.string().min(1) });
export const loadSkillOutput = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
  contentHash: z.string(),
});

export const readSkillAssetInput = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
});
export const readSkillAssetOutput = z.object({
  name: z.string(),
  path: z.string(),
  contentHash: z.string(),
  mediaType: z.string(),
  content: z.string(),
});

type Snapshot = { skills?: Record<string, { hash: string; body: string; description: string }> };

export function skillPromptLines(): string {
  const meta = listSkillMeta(getSkillMap());
  if (meta.length === 0) return "No skills are registered.";
  return meta.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n");
}

export async function executeLoadSkill(ctx: ToolContext, input: z.infer<typeof loadSkillInput>) {
  const skills = getSkillMap();
  const skill = skills.get(input.name);
  if (!skill) {
    throw new SkillError("UNKNOWN_SKILL", `Unknown skill: ${input.name}`);
  }

  const run = await prisma.agentRun.findUnique({ where: { id: ctx.runId } });
  const snapshot = (run?.sessionSnapshot as Snapshot | null) ?? {};
  const pinned = snapshot.skills?.[input.name];
  if (pinned) {
    return {
      name: input.name,
      description: pinned.description,
      body: pinned.body,
      contentHash: pinned.hash,
    };
  }

  await prisma.runSkill.upsert({
    where: {
      runId_skillName_assetPath: {
        runId: ctx.runId,
        skillName: input.name,
        assetPath: "",
      },
    },
    create: {
      runId: ctx.runId,
      skillName: input.name,
      contentHash: skill.contentHash,
      assetPath: "",
    },
    update: {},
  });

  await prisma.agentRun.update({
    where: { id: ctx.runId },
    data: {
      sessionSnapshot: {
        ...snapshot,
        skills: {
          ...snapshot.skills,
          [input.name]: {
            hash: skill.contentHash,
            body: skill.body,
            description: skill.description,
          },
        },
      },
    },
  });

  return {
    name: skill.name,
    description: skill.description,
    body: skill.body,
    contentHash: skill.contentHash,
  };
}

export async function executeReadSkillAsset(
  ctx: ToolContext,
  input: z.infer<typeof readSkillAssetInput>,
) {
  const asset = readSkillAsset(getSkillMap(), input.name, input.path);
  await prisma.runSkill.upsert({
    where: {
      runId_skillName_assetPath: {
        runId: ctx.runId,
        skillName: input.name,
        assetPath: input.path,
      },
    },
    create: {
      runId: ctx.runId,
      skillName: input.name,
      contentHash: asset.contentHash,
      assetPath: input.path,
    },
    update: {},
  });
  return asset;
}
