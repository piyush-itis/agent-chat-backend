import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { LIMITS } from "@/contracts/limits";
import { ApiError, jsonError } from "./errors";

export type ToolCall = { id: string; name: string; arguments: string };

export type ChatTurn =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type StreamHandlers = {
  onText: (delta: string, full: string) => Promise<void> | void;
  onThinking?: (delta: string, full: string) => Promise<void> | void;
};

export type StreamResult = {
  text: string;
  thinking: string;
  modelRouted: string | null;
  promptTokens: number;
  completionTokens: number;
  toolCalls: ToolCall[];
};

function client(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw jsonError(500, "CONFIG", "OPENROUTER_API_KEY is not set");
  }
  return new OpenAI({
    apiKey,
    baseURL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type StreamOptions = {
  tools?: ChatCompletionTool[];
  reasoningEffort?: "low" | "minimal" | "none";
  excludeReasoning?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
};

export async function streamOpenRouterFree(
  messages: ChatTurn[],
  handlers: StreamHandlers,
  toolsOrOptions?: ChatCompletionTool[] | StreamOptions,
): Promise<StreamResult> {
  const options: StreamOptions = Array.isArray(toolsOrOptions)
    ? { tools: toolsOrOptions }
    : (toolsOrOptions ?? {});
  let lastError: unknown;

  for (let attempt = 1; attempt <= LIMITS.openRouterMaxRetries; attempt += 1) {
    try {
      return await streamOnce(messages, handlers, options);
    } catch (error) {
      if (error instanceof Error && error.name === "RunStopped") throw error;
      lastError = error;
      const status = (error as { status?: number }).status;
      if (status === 429 && attempt < LIMITS.openRouterMaxRetries) {
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      break;
    }
  }

  if (lastError instanceof ApiError) throw lastError;
  const status = (lastError as { status?: number } | undefined)?.status;
  if (status === 429) {
    throw jsonError(
      503,
      "MODEL_UNAVAILABLE",
      "OpenRouter Free is rate limited. There is no paid fallback.",
    );
  }
  throw jsonError(
    503,
    "MODEL_UNAVAILABLE",
    "OpenRouter Free is unavailable. There is no paid fallback.",
  );
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && (error.name === "AbortError" || error.name === "APIUserAbortError")) ||
    (typeof error === "object" && error !== null && "code" in error && error.code === "ABORT_ERR")
  );
}

function reasoningPayload(options: StreamOptions): Record<string, unknown> | undefined {
  if (!options.reasoningEffort && !options.excludeReasoning) return undefined;
  return {
    ...(options.reasoningEffort ? { effort: options.reasoningEffort } : {}),
    ...(options.excludeReasoning ? { exclude: true } : {}),
  };
}

async function streamOnce(
  messages: ChatTurn[],
  handlers: StreamHandlers,
  options: StreamOptions,
): Promise<StreamResult> {
  const openai = client();
  const controller = options.timeoutMs ? new AbortController() : undefined;
  const timer = options.timeoutMs
    ? setTimeout(() => controller?.abort(), options.timeoutMs)
    : undefined;
  let text = "";
  let thinking = "";
  let modelRouted: string | null = null;
  let promptTokens = 0;
  let completionTokens = 0;
  const pending = new Map<number, { id: string; name: string; arguments: string }>();

  try {
    const stream = await openai.chat.completions.create({
      model: LIMITS.model,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      stream: true,
      stream_options: { include_usage: true },
      ...(controller ? { signal: controller.signal } : {}),
      ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
      ...(reasoningPayload(options) ? { reasoning: reasoningPayload(options) } : {}),
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming);

    for await (const chunk of stream) {
      if (chunk.model) modelRouted = chunk.model;
      const choice = chunk.choices[0];
      const delta = choice?.delta as
        | {
            content?: string | null;
            reasoning?: string | null;
            reasoning_content?: string | null;
            tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
          }
        | undefined;
      const piece = delta?.content ?? "";
      const thinkPiece = delta?.reasoning ?? delta?.reasoning_content ?? "";
      if (piece) {
        text += piece;
        await handlers.onText(piece, text);
      }
      if (thinkPiece) {
        thinking += thinkPiece;
        await handlers.onThinking?.(thinkPiece, thinking);
      }
      for (const call of delta?.tool_calls ?? []) {
        const current = pending.get(call.index) ?? { id: "", name: "", arguments: "" };
        if (call.id) current.id = call.id;
        if (call.function?.name) current.name += call.function.name;
        if (call.function?.arguments) current.arguments += call.function.arguments;
        pending.set(call.index, current);
      }
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
        completionTokens = chunk.usage.completion_tokens ?? completionTokens;
      }
    }
  } catch (error) {
    if (isAbortError(error) && (text.trim() || thinking.trim() || pending.size > 0)) {
      const toolCalls = [...pending.values()].filter((call) => call.name);
      return { text, thinking, modelRouted, promptTokens, completionTokens, toolCalls };
    }
    if (isAbortError(error)) {
      throw jsonError(503, "MODEL_UNAVAILABLE", "The model timed out. There is no paid fallback.");
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const toolCalls = [...pending.values()].filter((call) => call.name);
  if (!text.trim() && !thinking.trim() && toolCalls.length === 0) {
    throw jsonError(503, "EMPTY_STREAM", "The model returned an empty response.");
  }

  return { text, thinking, modelRouted, promptTokens, completionTokens, toolCalls };
}
