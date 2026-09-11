import { z } from "zod";

export const textBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const thinkingBlockSchema = z.object({
  type: z.literal("thinking"),
  text: z.string(),
  durationMs: z.number().int().nonnegative().optional(),
});

export const toolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  invocationId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
});

export const toolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  invocationId: z.string(),
  toolName: z.string(),
  output: z.unknown(),
  status: z.enum(["success", "failed", "cancelled"]),
});

export const reasoningBlockSchema = z.object({
  type: z.literal("reasoning"),
  text: z.string(),
});

export const citationsBlockSchema = z.object({
  type: z.literal("citations"),
  items: z.array(
    z.object({
      url: z.string().optional(),
      title: z.string().optional(),
      text: z.string().optional(),
    }),
  ),
});

export const usageBlockSchema = z.object({
  type: z.literal("usage"),
  modelRouted: z.string().nullable(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  applicationCredits: z.number().int().nonnegative(),
});

export const contentBlockSchema = z.discriminatedUnion("type", [
  textBlockSchema,
  thinkingBlockSchema,
  toolUseBlockSchema,
  toolResultBlockSchema,
  reasoningBlockSchema,
  citationsBlockSchema,
  usageBlockSchema,
]);

export const contentBlocksSchema = z.array(contentBlockSchema);

export type ContentBlock = z.infer<typeof contentBlockSchema>;
