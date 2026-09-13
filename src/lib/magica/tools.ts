import { Prisma } from "@prisma/client";
import { z } from "zod";
import { jsonError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import type { ToolContext } from "@/lib/registry";
import { estimateNodeCredits, getModelSchema } from "./client";
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
  creditUsed: z.number().optional(),
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
  creditUsed: z.number().optional(),
});

export const mergeVideosInput = z.object({
  video_urls: z.array(z.string().url()).min(2).max(100),
  transition: z.enum(["none", "fade", "dissolve"]).default("none"),
});

export const mergeVideosOutput = z.object({
  video_url: z.string(),
  creditCost: z.number(),
  creditUsed: z.number().optional(),
});

export async function executeCropImage(ctx: ToolContext, raw: z.infer<typeof cropImageInput>) {
  const crop = raw.crop ?? {
    x: raw.x!,
    y: raw.y!,
    width: raw.width!,
    height: raw.height!,
  };
  const schemaStarted = Date.now();
  const schema = await getModelSchema("crop_image");
  const providerInput = pickSchemaInput(schema, cropProviderCandidate(raw.image_url, crop, raw.unit));
  const schemaStep = await recordInternalStep(ctx, {
    toolName: "model_schema",
    input: { modelId: "crop_image" },
    output: { modelId: "crop_image", fields: schemaFieldNames(schema) },
    durationMs: Date.now() - schemaStarted,
  });
  const result = await runMagicaTool({
    ctx,
    toolName: "crop_image",
    nodeType: "crop_image",
    providerInput,
    kind: "image",
  });
  return {
    image_url: result.url,
    creditCost: result.creditCost,
    creditUsed: result.creditUsed,
    _timelineSteps: [schemaStep],
  };
}

export async function executeGptImage(ctx: ToolContext, raw: z.infer<typeof gptImageInput>) {
  if (raw.mode === "edit" && !raw.image_url) {
    throw jsonError(400, "VALIDATION", "image_url is required for gpt_image_2 edit");
  }
  const subModelId = raw.mode === "edit" ? "gpt-image-2-edit" : "gpt-image-2-text";
  const schemaStarted = Date.now();
  const schema = await getModelSchema(subModelId);
  const providerInput = pickSchemaInput(schema, {
    prompt: raw.prompt,
    image_url: raw.image_url,
    image: raw.image_url,
  });
  const schemaStep = await recordInternalStep(ctx, {
    toolName: "model_schema",
    input: { modelId: subModelId },
    output: { modelId: subModelId, fields: schemaFieldNames(schema) },
    durationMs: Date.now() - schemaStarted,
  });

  const priceStarted = Date.now();
  const estimate = await estimateNodeCredits([
    { nodeType: "gpt_image_2", subModelId, input: providerInput },
  ]);
  const priceStep = await recordInternalStep(ctx, {
    toolName: "get_pricing",
    input: { nodeType: "gpt_image_2", subModelId },
    output: { estimateCredits: estimate?.total ?? null },
    durationMs: Date.now() - priceStarted,
  });

  const result = await runMagicaTool({
    ctx,
    toolName: "gpt_image_2",
    nodeType: "gpt_image_2",
    subModelId,
    providerInput,
    kind: "image",
  });
  return {
    image_url: result.url,
    image_urls: result.urls,
    creditCost: result.creditCost,
    creditUsed: result.creditUsed,
    model: subModelId,
    prompt: raw.prompt,
    size: typeof providerInput.size === "string" ? providerInput.size : undefined,
    quality: typeof providerInput.quality === "string" ? providerInput.quality : undefined,
    _timelineSteps: [schemaStep, priceStep],
  };
}

export async function executeMergeVideos(ctx: ToolContext, raw: z.infer<typeof mergeVideosInput>) {
  const schemaStarted = Date.now();
  const schema = await getModelSchema("merge_videos");
  const providerInput = pickSchemaInput(schema, {
    video_urls: raw.video_urls,
    transition: raw.transition,
  });
  const schemaStep = await recordInternalStep(ctx, {
    toolName: "model_schema",
    input: { modelId: "merge_videos" },
    output: { modelId: "merge_videos", fields: schemaFieldNames(schema) },
    durationMs: Date.now() - schemaStarted,
  });
  const result = await runMagicaTool({
    ctx,
    toolName: "merge_videos",
    nodeType: "merge_videos",
    providerInput,
    kind: "video",
  });
  return {
    video_url: result.url,
    creditCost: result.creditCost,
    creditUsed: result.creditUsed,
    _timelineSteps: [schemaStep],
  };
}

function schemaFieldNames(schema: unknown): string[] {
  const fields = (schema as { fields?: { name?: string }[] })?.fields;
  if (!Array.isArray(fields)) return [];
  return fields.map((field) => field.name).filter((name): name is string => Boolean(name));
}

async function recordInternalStep(
  ctx: ToolContext,
  input: { toolName: string; input: Record<string, unknown>; output: Record<string, unknown>; durationMs: number },
) {
  const completionKey = `${ctx.runId}:${ctx.toolCallId}:${input.toolName}`;
  const startedAt = new Date(Date.now() - input.durationMs);
  const existing = await prisma.toolInvocation.findUnique({ where: { completionKey } });
  const row =
    existing ??
    (await prisma.toolInvocation.create({
      data: {
        runId: ctx.runId,
        chatId: ctx.chatId,
        toolName: input.toolName,
        provider: "internal",
        status: "completed",
        input: input.input as Prisma.InputJsonValue,
        output: input.output as Prisma.InputJsonValue,
        completionKey,
        startedAt,
        finishedAt: new Date(),
        durationMs: input.durationMs,
      },
    }));
  return {
    invocationId: row.id,
    toolName: input.toolName,
    input: input.input,
    output: { ...input.output, durationMs: input.durationMs },
  };
}

export function cropProviderCandidate(
  imageUrl: string,
  crop: { x: number; y: number; width: number; height: number },
  unit?: "percent" | "pixel",
): Record<string, unknown> {
  const pixel = unit === "pixel";
  return {
    image_url: imageUrl,
    image: imageUrl,
    crop,
    unit: unit ?? "percent",
    x: crop.x,
    y: crop.y,
    width: crop.width,
    height: crop.height,
    ...(pixel
      ? { x_px: crop.x, y_px: crop.y, width_px: crop.width, height_px: crop.height }
      : {
          x_percent: crop.x,
          y_percent: crop.y,
          width_percent: crop.width,
          height_percent: crop.height,
        }),
  };
}

export function pickSchemaInput(schema: unknown, candidate: Record<string, unknown>): Record<string, unknown> {
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
  if (fields.includes("image") && input.image === undefined && candidate.image_url !== undefined) {
    input.image = candidate.image_url;
  }
  if (fields.includes("image_url") && input.image_url === undefined && candidate.image !== undefined) {
    input.image_url = candidate.image;
  }
  if (candidate.image_url !== undefined && Object.keys(input).every((key) => key === "prompt")) {
    input.image_url = candidate.image_url;
  }
  return input;
}
