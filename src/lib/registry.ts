import { z } from "zod";
import {
  executeLoadSkill,
  executeReadSkillAsset,
  loadSkillInput,
  loadSkillOutput,
  readSkillAssetInput,
  readSkillAssetOutput,
} from "@/lib/skills/tools";
import {
  cropImageInput,
  cropImageOutput,
  executeCropImage,
  executeGptImage,
  executeMergeVideos,
  gptImageInput,
  gptImageOutput,
  mergeVideosInput,
  mergeVideosOutput,
} from "@/lib/magica/tools";
import { askQuestionsInput, askQuestionsOutput, executeAskQuestions } from "@/lib/questions";
import { SkillError } from "@/lib/skills/registry";

export type CreditEstimate = { applicationCredits: number };

export type ToolContext = {
  runId: string;
  chatId: string;
  userId: string;
  toolCallId: string;
};

export type ToolDefinition<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: I;
  output: O;
  renderHint: "image" | "video" | "text" | "skill";
  billable: boolean;
  estimateCredits: (input: z.infer<I>) => Promise<CreditEstimate>;
  execute: (ctx: ToolContext, input: z.infer<I>) => Promise<z.infer<O>>;
};

const tools = new Map<string, ToolDefinition>();

export function registerTool<I extends z.ZodType, O extends z.ZodType>(tool: ToolDefinition<I, O>): void {
  tools.set(tool.name, tool as ToolDefinition);
}

export function getTool(name: string) {
  return tools.get(name);
}

export function listTools() {
  return [...tools.values()];
}

function skillErrorToResult(error: unknown): never {
  if (error instanceof SkillError) {
    throw error;
  }
  throw error;
}

registerTool({
  name: "load_skill",
  description: "Load a skill body by name when the current turn needs that guidance.",
  input: loadSkillInput,
  output: loadSkillOutput,
  renderHint: "skill",
  billable: false,
  estimateCredits: async () => ({ applicationCredits: 0 }),
  execute: async (ctx, input) => executeLoadSkill(ctx, input).catch(skillErrorToResult),
});

registerTool({
  name: "read_skill_asset",
  description: "Read a file from an approved skill directory. Paths cannot escape the skill folder.",
  input: readSkillAssetInput,
  output: readSkillAssetOutput,
  renderHint: "skill",
  billable: false,
  estimateCredits: async () => ({ applicationCredits: 0 }),
  execute: async (ctx, input) => executeReadSkillAsset(ctx, input).catch(skillErrorToResult),
});

registerTool({
  name: "ask_questions",
  description:
    "Ask 1–3 clarifying questions only when generate/crop/merge is too vague to run. For crop without a ratio or region, ask exactly \"Choose a crop target\" with Square (1:1), Story / Reel (9:16), Portrait (4:5), Landscape (16:9), and Custom region or ratio. Skip this tool when the user already specified the subject and key details.",
  input: askQuestionsInput,
  output: askQuestionsOutput,
  renderHint: "text",
  billable: false,
  estimateCredits: async () => ({ applicationCredits: 0 }),
  execute: executeAskQuestions,
});

registerTool({
  name: "crop_image",
  description: "Crop an image with a complete rectangle (percent, pixel, or crop.{x,y,width,height}).",
  input: cropImageInput,
  output: cropImageOutput,
  renderHint: "image",
  billable: true,
  estimateCredits: async () => ({ applicationCredits: 1 }),
  execute: executeCropImage,
});

registerTool({
  name: "gpt_image_2",
  description: "Generate a new image (mode=text) or edit an image (mode=edit) with GPT Image 2.",
  input: gptImageInput,
  output: gptImageOutput,
  renderHint: "image",
  billable: true,
  estimateCredits: async () => ({ applicationCredits: 1 }),
  execute: executeGptImage,
});

registerTool({
  name: "merge_videos",
  description: "Merge 2–100 videos in order with none, fade, or dissolve transitions.",
  input: mergeVideosInput,
  output: mergeVideosOutput,
  renderHint: "video",
  billable: true,
  estimateCredits: async () => ({ applicationCredits: 1 }),
  execute: executeMergeVideos,
});
