import { z } from "zod";
import { LIMITS } from "./limits";
import { contentBlocksSchema } from "./blocks";

export const errorEnvelopeSchema = z.object({
  error: z.string(),
  message: z.string(),
  code: z.string(),
  traceId: z.string(),
});

export const cursorSchema = z.string().min(1).optional();

export const sendTurnRequestSchema = z.object({
  text: z.string().trim().min(1).max(LIMITS.maxMessageChars),
  model: z.literal(LIMITS.model).default(LIMITS.model),
  clientIdempotencyKey: z.string().min(8).max(128),
  attachmentIds: z.array(z.string()).max(8).optional(),
  planMode: z.boolean().optional(),
});

export const waitpointKindSchema = z.enum(["options", "plan", "credit", "media", "questions"]);
export const waitpointStatusSchema = z.enum(["open", "approved", "rejected", "expired"]);

export const waitpointChoiceSchema = z.object({
  id: z.string(),
  label: z.string(),
});

export const waitpointQuestionChoiceSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
});

export const waitpointQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  answer: z.string().optional(),
  choices: z.array(waitpointQuestionChoiceSchema).optional(),
});

export const waitpointPayloadSchema = z.object({
  title: z.string(),
  summary: z.string(),
  message: z.string().optional(),
  estimateCredits: z.number().optional(),
  toolName: z.string().optional(),
  mediaUrls: z.array(z.string()).optional(),
  choices: z.array(waitpointChoiceSchema).optional(),
  selectedChoiceId: z.string().optional(),
  questions: z.array(waitpointQuestionSchema).optional(),
});

export const waitpointSchema = z.object({
  id: z.string(),
  token: z.string(),
  runId: z.string(),
  kind: waitpointKindSchema,
  payload: waitpointPayloadSchema,
  status: waitpointStatusSchema,
  resumeKey: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export const resumeWaitpointRequestSchema = z.object({
  resumeKey: z.string().min(8),
  decision: z.enum(["approved", "rejected"]),
  choiceId: z.string().optional(),
  answers: z.record(z.string(), z.string()).optional(),
});

export const generatedAssetSchema = z.object({
  id: z.string(),
  kind: z.enum(["image", "video", "audio"]),
  url: z.string(),
  durableUrl: z.string().nullable(),
  mimeType: z.string().nullable(),
  createdAt: z.string(),
});

export const sessionSnapshotSchema = z.object({
  version: z.literal(1),
  planMode: z.boolean().optional(),
  planApproved: z.boolean().optional(),
  approvedCreditKeys: z.array(z.string()).optional(),
  approvedMediaKeys: z.array(z.string()).optional(),
  pendingToolCalls: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        arguments: z.string(),
      }),
    )
    .optional(),
  pendingPhase: z.enum(["plan", "tools"]).optional(),
  skipWaitpoints: z.boolean().optional(),
  publicToolOnly: z.boolean().optional(),
  questionAnswers: z.record(z.string(), z.record(z.string(), z.string())).optional(),
});

export const chatCompletionsRequestSchema = z.object({
  model: z.literal(LIMITS.model).default(LIMITS.model),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().trim().min(1).max(LIMITS.maxMessageChars),
      }),
    )
    .min(1),
  chatId: z.string().optional(),
  clientIdempotencyKey: z.string().min(8).max(128).optional(),
  planMode: z.boolean().optional(),
});

export const REALTIME_STREAMS = {
  thinking: "thinking",
  assistant: "assistant",
} as const;

export const realtimeAccessSchema = z.discriminatedUnion("transport", [
  z.object({
    transport: z.literal("poll"),
    pollUrl: z.string(),
  }),
  z.object({
    transport: z.literal("trigger"),
    pollUrl: z.string(),
    triggerRunId: z.string(),
    publicAccessToken: z.string(),
    streams: z.object({
      thinking: z.literal(REALTIME_STREAMS.thinking),
      assistant: z.literal(REALTIME_STREAMS.assistant),
    }),
  }),
]);

export const realtimeTokenResponseSchema = z.object({
  token: z.string(),
});

export const sendTurnResponseSchema = z.object({
  chatId: z.string(),
  messageId: z.string(),
  runId: z.string(),
  realtime: realtimeAccessSchema,
});

export const chatSchema = z.object({
  id: z.string(),
  title: z.string(),
  favorited: z.boolean(),
  pinned: z.boolean(),
  activeRunId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const chatListResponseSchema = z.object({
  items: z.array(chatSchema),
  nextCursor: z.string().nullable(),
});

export const createChatRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

export const patchChatRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  favorited: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

export const messageAttachmentSchema = z.object({
  id: z.string(),
  mimeType: z.string(),
  originalName: z.string(),
  resultUrl: z.string().nullable(),
  durableUrl: z.string().nullable(),
  sortOrder: z.number(),
});

export const messageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  runId: z.string().nullable(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  status: z.enum(["success", "failed", "cancelled"]),
  blocks: contentBlocksSchema,
  attachments: z.array(messageAttachmentSchema).optional(),
  createdAt: z.string(),
});

export const messageListResponseSchema = z.object({
  items: z.array(messageSchema),
  nextCursor: z.string().nullable(),
});

export const runStatusSchema = z.enum([
  "queued",
  "thinking",
  "working",
  "waiting",
  "stopping",
  "complete",
  "failed",
  "cancelled",
]);

export const runResponseSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  status: runStatusSchema,
  modelRequested: z.string(),
  modelRouted: z.string().nullable(),
  userMessageId: z.string(),
  assistantMessageId: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorSafeMessage: z.string().nullable(),
  assistant: messageSchema.nullable(),
  waitpoint: waitpointSchema.nullable(),
  generatedAssets: z.array(generatedAssetSchema),
  pendingTool: z.string().optional(),
  triggerRunId: z.string().optional(),
  realtime: realtimeAccessSchema.optional(),
  createdAt: z.string(),
});

export const creditsResponseSchema = z.object({
  balance: z.number().int(),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type SendTurnRequest = z.infer<typeof sendTurnRequestSchema>;
export type SendTurnResponse = z.infer<typeof sendTurnResponseSchema>;
export type Chat = z.infer<typeof chatSchema>;
export type ChatListResponse = z.infer<typeof chatListResponseSchema>;
export type Message = z.infer<typeof messageSchema>;
export type MessageListResponse = z.infer<typeof messageListResponseSchema>;
export type RunResponse = z.infer<typeof runResponseSchema>;
export type CreditsResponse = z.infer<typeof creditsResponseSchema>;
export type RealtimeAccess = z.infer<typeof realtimeAccessSchema>;
export type RealtimeTokenResponse = z.infer<typeof realtimeTokenResponseSchema>;
export type Waitpoint = z.infer<typeof waitpointSchema>;
export type WaitpointPayload = z.infer<typeof waitpointPayloadSchema>;
export type ResumeWaitpointRequest = z.infer<typeof resumeWaitpointRequestSchema>;
export type GeneratedAsset = z.infer<typeof generatedAssetSchema>;
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;
export type ChatCompletionsRequest = z.infer<typeof chatCompletionsRequestSchema>;
