import { z } from "zod";
import type { SessionSnapshot } from "@/contracts/api";
import { prisma } from "@/lib/db";
import type { ToolContext } from "@/lib/registry";
import { mergeSnapshot, parseSnapshot, pauseForWaitpoint } from "@/lib/waitpoints";

const questionChoiceInput = z.object({
  id: z.string().min(1).max(64).optional(),
  label: z.string().min(1).max(120),
  description: z.string().max(240).optional(),
});

export const askQuestionsInput = z.object({
  message: z.string().min(1).max(2000),
  questions: z
    .array(
      z.object({
        prompt: z.string().min(1).max(400),
        required: z.boolean().optional(),
        placeholder: z.string().max(200).optional(),
        choices: z.array(questionChoiceInput).max(8).optional(),
      }),
    )
    .min(1)
    .max(3),
});

export const askQuestionsOutput = z.object({
  message: z.string(),
  answers: z.record(z.string(), z.string()),
  durationMs: z.number().optional(),
});

export const CROP_TARGET_QUESTION = {
  prompt: "Choose a crop target",
  required: true,
  choices: [
    { id: "square", label: "Square (1:1)", description: "Centered square crop" },
    { id: "story", label: "Story / Reel (9:16)", description: "Vertical, for Instagram/TikTok/Reels stories" },
    { id: "portrait", label: "Portrait (4:5)", description: "Instagram feed portrait" },
    { id: "landscape", label: "Landscape (16:9)", description: "Widescreen crop" },
    { id: "custom", label: "Custom region or ratio", description: "I'll specify exact dimensions or area" },
  ],
} as const;

const CROP_HINT = /\b(crop|ratio|region)\b/i;
export const CROP_RATIO_HINT = /\b(1:1|9:16|4:5|16:9|square|portrait|landscape|story|reel|custom region)\b/i;
const CUSTOM_CROP_HINT = /\bcustom\b/i;

export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  unit: "percent";
};

export function questionIds(count: number) {
  return Array.from({ length: count }, (_, index) => `Q${index + 1}`);
}

export function looksLikeCropAsk(raw: {
  message: string;
  questions: { prompt: string; choices?: unknown[] }[];
}) {
  if (raw.questions.some((question) => Array.isArray(question.choices) && question.choices.length > 0)) {
    return false;
  }
  return CROP_HINT.test([raw.message, ...raw.questions.map((question) => question.prompt)].join(" "));
}

export function isCropTargetAsk(raw: {
  message: string;
  questions: { prompt: string; choices?: unknown[] }[];
}) {
  const blob = [raw.message, ...raw.questions.map((question) => question.prompt)].join(" ");
  if (/choose a crop target/i.test(blob)) return true;
  if (looksLikeCropAsk(raw)) return true;
  return CROP_HINT.test(blob) && raw.questions.some((question) => Array.isArray(question.choices) && question.choices.length > 0);
}

export function latestCropTargetAnswer(snapshot: SessionSnapshot): string | null {
  for (const answers of Object.values(snapshot.questionAnswers ?? {}).reverse()) {
    const text = Object.values(answers).join(" ").trim();
    if (CROP_RATIO_HINT.test(text)) return text;
  }
  return null;
}

export function latestPresetCropAnswer(snapshot: SessionSnapshot): string | null {
  const answer = latestCropTargetAnswer(snapshot);
  if (!answer || CUSTOM_CROP_HINT.test(answer)) return null;
  return answer;
}

export function hasCropTargetAnswer(snapshot: SessionSnapshot) {
  return latestCropTargetAnswer(snapshot) !== null;
}

export function centeredRatioCrop(rw: number, rh: number): CropRect {
  const target = rw / rh;
  if (target <= 1) {
    const width = 100 * target;
    return { x: (100 - width) / 2, y: 0, width, height: 100, unit: "percent" };
  }
  const height = 100 / target;
  return { x: 0, y: (100 - height) / 2, width: 100, height, unit: "percent" };
}

export function cropRectFromAnswer(answer: string): CropRect | null {
  const text = answer.toLowerCase();
  if (CUSTOM_CROP_HINT.test(text)) return null;
  if (/\b1:1\b/.test(text) || /\bsquare\b/.test(text)) return centeredRatioCrop(1, 1);
  if (/\b9:16\b/.test(text) || /\bstory\b/.test(text) || /\breel\b/.test(text)) return centeredRatioCrop(9, 16);
  if (/\b4:5\b/.test(text) || /\bportrait\b/.test(text)) return centeredRatioCrop(4, 5);
  if (/\b16:9\b/.test(text) || /\blandscape\b/.test(text)) return centeredRatioCrop(16, 9);
  return null;
}

export function reusedCropTargetAnswers(
  raw: z.infer<typeof askQuestionsInput>,
  snapshot: SessionSnapshot,
): Record<string, string> | null {
  if (!isCropTargetAsk(raw)) return null;
  const answer = latestPresetCropAnswer(snapshot);
  if (!answer) return null;
  return { Q1: answer };
}

export function applyCropTargetToArgs(
  parsed: unknown,
  snapshot: SessionSnapshot,
  imageUrl?: string,
): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const record = { ...(parsed as Record<string, unknown>) };
  if (!record.image_url && imageUrl) record.image_url = imageUrl;
  const hasObject = record.crop && typeof record.crop === "object";
  const hasFlat =
    record.x !== undefined &&
    record.y !== undefined &&
    record.width !== undefined &&
    record.height !== undefined;
  if (hasObject || hasFlat) return record;
  const rect = cropRectFromAnswer(latestPresetCropAnswer(snapshot) ?? "");
  if (!rect) return record;
  return {
    ...record,
    crop: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    unit: rect.unit,
  };
}

export function cropTargetInstruction(snapshot: SessionSnapshot): string | null {
  const answer = latestCropTargetAnswer(snapshot);
  if (!answer) return null;
  const rect = cropRectFromAnswer(answer);
  if (!rect) {
    return "The user chose a custom crop. Ask only for the missing region or ratio. Do not show the Square/Story/Portrait/Landscape picker again.";
  }
  return `The user already chose crop target "${answer}". Do not call ask_questions again. Call crop_image with the user media image_url and crop {"x":${rect.x},"y":${rect.y},"width":${rect.width},"height":${rect.height}} unit "${rect.unit}".`;
}

export function needsCropTarget(userText: string, snapshot: SessionSnapshot) {
  if (snapshot.planMode && !snapshot.planApproved) return false;
  if (hasCropTargetAnswer(snapshot)) return false;
  if (!/\bcrop\b/i.test(userText)) return false;
  if (CROP_RATIO_HINT.test(userText)) return false;
  return true;
}

export function normalizeAskQuestions(raw: z.infer<typeof askQuestionsInput>): z.infer<typeof askQuestionsInput> {
  if (!looksLikeCropAsk(raw)) return raw;
  return {
    message: raw.message,
    questions: [{ prompt: CROP_TARGET_QUESTION.prompt, required: true, choices: [...CROP_TARGET_QUESTION.choices] }],
  };
}

export async function executeAskQuestions(
  ctx: ToolContext,
  raw: z.infer<typeof askQuestionsInput>,
): Promise<z.infer<typeof askQuestionsOutput>> {
  const normalized = normalizeAskQuestions(raw);
  const run = await prisma.agentRun.findUnique({ where: { id: ctx.runId } });
  const snapshot = parseSnapshot(run?.sessionSnapshot);
  const reused = reusedCropTargetAnswers(normalized, snapshot);
  if (reused && !snapshot.questionAnswers?.[ctx.toolCallId]) {
    await mergeSnapshot(ctx.runId, {
      questionAnswers: { ...(snapshot.questionAnswers ?? {}), [ctx.toolCallId]: reused },
    });
  }
  const existing = snapshot.questionAnswers?.[ctx.toolCallId] ?? reused;
  if (existing) {
    const waitpoint = await prisma.waitpoint.findFirst({
      where: { runId: ctx.runId, kind: "questions", status: "approved" },
      orderBy: { createdAt: "desc" },
    });
    return {
      message: normalized.message,
      answers: existing,
      durationMs: waitpoint ? Date.now() - waitpoint.createdAt.getTime() : undefined,
    };
  }

  const questions = normalized.questions.map((question, index) => ({
    id: `Q${index + 1}`,
    prompt: question.prompt,
    required: question.required !== false,
    placeholder: question.placeholder,
    choices: question.choices?.map((choice, choiceIndex) => ({
      id: choice.id ?? `c${choiceIndex + 1}`,
      label: choice.label,
      description: choice.description,
    })),
  }));

  return await pauseForWaitpoint({
    runId: ctx.runId,
    kind: "questions",
    payload: {
      title: questions[0]?.prompt ?? "Waiting for your input",
      summary: normalized.message,
      message: normalized.message,
      toolName: "ask_questions",
      questions,
    },
    snapshot: {
      pendingPhase: "tools",
      pendingToolCalls: [
        {
          id: ctx.toolCallId,
          name: "ask_questions",
          arguments: JSON.stringify(normalized),
        },
      ],
    },
  });
}
