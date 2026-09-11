import { z } from "zod";
import { jsonError } from "@/lib/errors";
import type { ToolContext } from "@/lib/registry";
import { getModelSchema } from "./client";
import { runMagicaTool } from "./run-tool";

const cropObject = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const cropImageInput = z
  .object({
    image_url: z.string().url(),
    crop: cropObject.optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    unit: z.enum(["percent", "pixel"]).optional(),
  })
  .superRefine((value, ctx) => {
    const fromObject = value.crop;
    const fromFlat =
      value.x !== undefined &&
      value.y !== undefined &&
      value.width !== undefined &&
      value.height !== undefined;
    if (fromObject && fromFlat) {
      ctx.addIssue({ code: "custom", message: "Use either crop or flat coordinates, not both" });
    }
    if (!fromObject && !fromFlat) {
      ctx.addIssue({ code: "custom", message: "A complete crop rectangle is required" });
    }
  });

export const cropImageOutput = z.object({
  image_url: z.string(),
  creditCost: z.number(),
});

export const gptImageInput = z.object({
  mode: z.enum(["text", "edit"]),
  prompt: z.string().min(1),
  image_url: z.string().url().optional(),
});

export const gptImageOutput = z.object({
  image_url: z.string(),
  image_urls: z.array(z.string()),
  creditCost: z.number(),
});

export const mergeVideosInput = z.object({
  video_urls: z.array(z.string().url()).min(2).max(100),
  transition: z.enum(["none", "fade", "dissolve"]).default("none"),
});

export const mergeVideosOutput = z.object({
  video_url: z.string(),
  creditCost: z.number(),
});

export async function executeCropImage(ctx: ToolContext, raw: z.infer<typeof cropImageInput>) {
  const crop = raw.crop ?? {
    x: raw.x!,
    y: raw.y!,
    width: raw.width!,
    height: raw.height!,
  };
  const result = await runMagicaTool({
    ctx,
    toolName: "crop_image",
    nodeType: "crop_image",
    providerInput: {
      image_url: raw.image_url,
      crop,
      ...(raw.unit ? { unit: raw.unit } : {}),
    },
    kind: "image",
  });
  return { image_url: result.url, creditCost: result.creditCost };
}

export async function executeGptImage(ctx: ToolContext, raw: z.infer<typeof gptImageInput>) {
  if (raw.mode === "edit" && !raw.image_url) {
    throw jsonError(400, "VALIDATION", "image_url is required for gpt_image_2 edit");
  }
  const subModelId = raw.mode === "edit" ? "gpt-image-2-edit" : "gpt-image-2-text";
  const schema = await getModelSchema(subModelId);
  const providerInput = pickSchemaInput(schema, {
    prompt: raw.prompt,
    image_url: raw.image_url,
    image: raw.image_url,
  });
  const result = await runMagicaTool({
    ctx,
    toolName: "gpt_image_2",
    nodeType: "gpt_image_2",
    subModelId,
    providerInput,
    kind: "image",
  });
  return { image_url: result.url, image_urls: result.urls, creditCost: result.creditCost };
}

export async function executeMergeVideos(ctx: ToolContext, raw: z.infer<typeof mergeVideosInput>) {
  const result = await runMagicaTool({
    ctx,
    toolName: "merge_videos",
    nodeType: "merge_videos",
    providerInput: {
      video_urls: raw.video_urls,
      transition: raw.transition,
    },
    kind: "video",
  });
  return { video_url: result.url, creditCost: result.creditCost };
}

function pickSchemaInput(schema: unknown, candidate: Record<string, unknown>): Record<string, unknown> {
  const fields = Array.isArray((schema as { fields?: { name?: string }[] })?.fields)
    ? ((schema as { fields: { name?: string }[] }).fields.map((field) => field.name).filter(Boolean) as string[])
    : [];
  if (fields.length === 0) {
    return Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined));
  }
  const input: Record<string, unknown> = {};
  for (const name of fields) {
    if (candidate[name] !== undefined) input[name] = candidate[name];
  }
  if (candidate.prompt !== undefined && !input.prompt) input.prompt = candidate.prompt;
  if (candidate.image_url !== undefined && Object.keys(input).every((key) => key === "prompt")) {
    input.image_url = candidate.image_url;
  }
  return input;
}
