import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ContentBlock } from "@/contracts/blocks";
import { LIMITS } from "@/contracts/limits";
import type { SessionSnapshot } from "@/contracts/api";
import { prisma } from "./db";
import { ApiError } from "./errors";
import { hasCredits } from "./credits";
import { streamOpenRouterFree, type ChatTurn, type ToolCall } from "./openrouter";
import { getTool, listTools, type ToolContext } from "./registry";
import { parseBlocks } from "./serialize";
import { skillPromptLines } from "./skills/tools";
import { SkillError } from "./skills/registry";
import { finalizeCancelledRun, finalizeRun } from "./finalize";
import { emitWebhook } from "./webhooks";
import {
  RunStopped,
  WaitpointPause,
  assertRunNotStopping,
  mergeSnapshot,
  parseSnapshot,
  pauseForWaitpoint,
  waitpointKindForPlan,
} from "./waitpoints";

function asJson(blocks: ContentBlock[]): Prisma.InputJsonValue {
  return blocks as unknown as Prisma.InputJsonValue;
}

function systemPrompt(planMode: boolean): string {
  return [
    "You are Galaxy Agent Chat.",
    "Use only the OpenRouter free route. Do not suggest paid models.",
    "Skills (names and descriptions only). Call load_skill before Magica work when relevant:",
    skillPromptLines(),
    "Available tools: load_skill, read_skill_asset, gpt_image_2, crop_image, merge_videos.",
    "Choose tools from user intent. You may chain generate then crop.",
    planMode
      ? "Plan mode is on. First reply with a short numbered plan. Do not call tools until the user approves."
      : "",
    "Never mention API keys or provider secrets.",
  ]
    .filter(Boolean)
    .join("\n");
}

export { finalizeCancelledRun, finalizeRun };

export async function runAgentTurn(runId: string): Promise<void> {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run || !run.assistantMessageId) return;
  if (["complete", "failed", "cancelled"].includes(run.status)) return;
  if (run.status === "stopping") {
    await finalizeCancelledRun(runId);
    return;
  }

  const snapshot = parseSnapshot(run.sessionSnapshot);
  const assistant = await prisma.message.findUnique({ where: { id: run.assistantMessageId } });
  const blocks: ContentBlock[] = assistant ? [...parseBlocks(assistant.blocks)] : [];

  if (run.status === "queued") {
    void emitWebhook(run.userId, "agent.started", { runId, chatId: run.chatId });
  }

  await prisma.agentRun.update({
    where: { id: runId },
    data: { status: "thinking", startedAt: run.startedAt ?? new Date() },
  });

  const history = await prisma.message.findMany({
    where: { chatId: run.chatId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LIMITS.contextWindowMessages,
  });
  const chronological = history.reverse();

  const messages: ChatTurn[] = [
    { role: "system", content: systemPrompt(Boolean(snapshot.planMode)) },
    ...chronological
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role === "user" ? ("user" as const) : ("assistant" as const),
        content: textFromBlocks(parseBlocks(message.blocks)),
      }))
      .filter((message) => message.content.length > 0),
  ];

  const attachments = await prisma.attachment.findMany({
    where: { chatId: run.chatId },
    orderBy: { sortOrder: "asc" },
    take: 20,
  });
  if (attachments.length > 0) {
    messages.push({
      role: "system",
      content: `User media: ${attachments
        .map((item) => `${item.mimeType} ${item.durableUrl ?? item.resultUrl ?? ""}`)
        .join(" | ")}`,
    });
  }

  let lastPersist = 0;
  const persist = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastPersist < LIMITS.persistIntervalMs) return;
    lastPersist = now;
    await prisma.message.update({
      where: { id: run.assistantMessageId! },
      data: { blocks: asJson(blocks) },
    });
    const current = await prisma.agentRun.findUnique({ where: { id: runId } });
    if (current && !["waiting", "stopping", "cancelled"].includes(current.status)) {
      await prisma.agentRun.update({
        where: { id: runId },
        data: { status: "working" },
      });
    }
  };

  const tools = toOpenAiTools();
  let modelRouted: string | null = run.modelRouted;
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    if (snapshot.pendingToolCalls?.length) {
      await assertRunNotStopping(runId);
      await maybePauseForToolPolicy(runId, snapshot, snapshot.pendingToolCalls);
      const ctxBase = { runId, chatId: run.chatId, userId: run.userId };
      const outputs = await Promise.all(
        snapshot.pendingToolCalls
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((call) => executeOneTool({ ...ctxBase, toolCallId: call.id }, call, blocks, persist)),
      );
      for (const output of outputs) messages.push(output);
      await mergeSnapshot(runId, { pendingToolCalls: [], pendingPhase: undefined });
      await persist(true);
    }

    for (let iteration = 0; iteration < LIMITS.maxToolIterations; iteration += 1) {
      await assertRunNotStopping(runId);
      let thinking = "";
      let text = "";
      const result = await streamOpenRouterFree(
        messages,
        {
          onThinking: async (_delta, full) => {
            thinking = full;
            replaceOrPush(blocks, { type: "thinking", text: full });
            await persist();
          },
          onText: async (_delta, full) => {
            text = full;
            replaceOrPush(blocks, { type: "text", text: full });
            await persist();
          },
        },
        tools,
      );
      modelRouted = result.modelRouted ?? modelRouted;
      promptTokens += result.promptTokens;
      completionTokens += result.completionTokens;
      if (result.thinking) replaceOrPush(blocks, { type: "thinking", text: result.thinking });
      if (result.text) replaceOrPush(blocks, { type: "text", text: result.text });
      await persist(true);

      if (snapshot.planMode && !snapshot.planApproved) {
        const planText = result.text || thinking || "The agent prepared a plan.";
        const { kind, payload } = waitpointKindForPlan(planText);
        await persist(true);
        await pauseForWaitpoint({
          runId,
          kind,
          payload,
          snapshot: {
            planMode: true,
            pendingPhase: "plan",
            pendingToolCalls: result.toolCalls,
          },
        });
      }

      if (result.toolCalls.length === 0) break;

      messages.push({
        role: "assistant",
        content: result.text || thinking || null,
        tool_calls: result.toolCalls,
      });

      const live = parseSnapshot(
        (await prisma.agentRun.findUnique({ where: { id: runId } }))?.sessionSnapshot,
      );
      await maybePauseForToolPolicy(runId, live, result.toolCalls);
      await assertRunNotStopping(runId);

      const ctxBase = { runId, chatId: run.chatId, userId: run.userId };
      const outputs = await Promise.all(
        result.toolCalls
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((call) => executeOneTool({ ...ctxBase, toolCallId: call.id }, call, blocks, persist)),
      );
      for (const output of outputs) {
        messages.push(output);
      }
      await persist(true);
    }

    const settled = await prisma.agentRun.findUnique({ where: { id: runId } });
    if (settled?.status === "stopping") {
      await finalizeCancelledRun(runId);
      return;
    }
    blocks.push({
      type: "usage",
      modelRouted,
      promptTokens,
      completionTokens,
      applicationCredits: settled?.creditsSettled ?? 0,
    });

    await finalizeRun(runId, {
      status: "complete",
      blocks,
      modelRouted,
      messageStatus: "success",
    });
  } catch (error) {
    if (error instanceof WaitpointPause) {
      await persist(true);
      return;
    }
    if (error instanceof RunStopped) {
      await persist(true);
      await finalizeCancelledRun(runId);
      return;
    }
    const safe =
      error instanceof ApiError
        ? error.message
        : "The model or a tool failed. There is no paid fallback.";
    const code = error instanceof ApiError ? error.code : "MODEL_UNAVAILABLE";
    await finalizeRun(runId, {
      status: "failed",
      blocks,
      modelRouted,
      messageStatus: "failed",
      errorCode: code,
      errorSafeMessage: safe,
    });
  }
}

async function maybePauseForToolPolicy(runId: string, snapshot: SessionSnapshot, calls: ToolCall[]) {
  const magica = calls.filter((call) => ["crop_image", "gpt_image_2", "merge_videos"].includes(call.name));
  if (magica.length === 0) return;

  const creditPending = magica.filter((call) => !(snapshot.approvedCreditKeys ?? []).includes(call.id));
  if (creditPending.length > 0) {
    const estimate = creditPending.length * LIMITS.creditWaitThreshold;
    if (estimate >= LIMITS.creditWaitThreshold) {
      await pauseForWaitpoint({
        runId,
        kind: "credit",
        payload: {
          title: "Approve credit use",
          summary: `This step will use about ${estimate} credit${estimate === 1 ? "" : "s"} for ${creditPending.map((call) => call.name).join(", ")}.`,
          estimateCredits: estimate,
          toolName: creditPending[0]?.name,
        },
        snapshot: { pendingToolCalls: calls, pendingPhase: "tools" },
      });
    }
  }

  const mediaPending = magica.filter(
    (call) =>
      (call.name === "crop_image" || call.name === "merge_videos" || call.name === "gpt_image_2") &&
      !(snapshot.approvedMediaKeys ?? []).includes(call.id),
  );
  const mediaUrls = mediaPending.flatMap((call) => extractMediaUrlsFromArgs(call.arguments));
  if (mediaPending.length > 0 && mediaUrls.length > 0) {
    await pauseForWaitpoint({
      runId,
      kind: "media",
      payload: {
        title: "Confirm media",
        summary: "The agent will use this media with a Magica tool.",
        toolName: mediaPending[0]?.name,
        mediaUrls,
      },
      snapshot: { pendingToolCalls: calls, pendingPhase: "tools" },
    });
  }
}

function extractMediaUrlsFromArgs(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const urls: string[] = [];
    if (typeof parsed.image_url === "string") urls.push(parsed.image_url);
    if (Array.isArray(parsed.video_urls)) {
      for (const item of parsed.video_urls) {
        if (typeof item === "string") urls.push(item);
      }
    }
    return urls;
  } catch {
    return [];
  }
}

async function executeOneTool(
  ctx: ToolContext,
  call: ToolCall,
  blocks: ContentBlock[],
  persist: (force?: boolean) => Promise<void>,
): Promise<Extract<ChatTurn, { role: "tool" }>> {
  const tool = getTool(call.name);
  let parsed: unknown = {};
  try {
    parsed = call.arguments ? JSON.parse(call.arguments) : {};
  } catch {
    parsed = {};
  }

  const already = blocks.find(
    (block) => block.type === "tool_result" && block.invocationId === call.id,
  );
  if (already && already.type === "tool_result") {
    return { role: "tool", tool_call_id: call.id, content: JSON.stringify(already.output) };
  }

  if (!blocks.some((block) => block.type === "tool_use" && block.invocationId === call.id)) {
    blocks.push({
      type: "tool_use",
      invocationId: call.id,
      toolName: call.name,
      input: parsed,
    });
    await persist(true);
  }

  if (!tool) {
    const message = `Unknown tool: ${call.name}`;
    blocks.push({
      type: "tool_result",
      invocationId: call.id,
      toolName: call.name,
      output: { error: message },
      status: "failed",
    });
    return { role: "tool", tool_call_id: call.id, content: message };
  }

  const input = tool.input.safeParse(parsed);
  if (!input.success) {
    const message = input.error.issues[0]?.message ?? "Invalid tool input";
    blocks.push({
      type: "tool_result",
      invocationId: call.id,
      toolName: call.name,
      output: { error: message },
      status: "failed",
    });
    return { role: "tool", tool_call_id: call.id, content: message };
  }

  if (tool.billable) {
    const estimate = await tool.estimateCredits(input.data);
    if (!(await hasCredits(ctx.userId, estimate.applicationCredits))) {
      const message = "Not enough credits to run this tool. Completed work was kept.";
      blocks.push({
        type: "tool_result",
        invocationId: call.id,
        toolName: call.name,
        output: { error: message },
        status: "failed",
      });
      throw new ApiError(402, "INSUFFICIENT_CREDITS", message);
    }
  }

  try {
    await assertRunNotStopping(ctx.runId);
    const output = await tool.execute(ctx, input.data);
    blocks.push({
      type: "tool_result",
      invocationId: call.id,
      toolName: call.name,
      output,
      status: "success",
    });
    void emitWebhook(ctx.userId, "tool.completed", {
      runId: ctx.runId,
      chatId: ctx.chatId,
      toolName: call.name,
      invocationId: call.id,
    });
    return { role: "tool", tool_call_id: call.id, content: JSON.stringify(output) };
  } catch (error) {
    if (error instanceof RunStopped || error instanceof WaitpointPause) throw error;
    const message =
      error instanceof SkillError || error instanceof ApiError ? error.message : "Tool failed";
    blocks.push({
      type: "tool_result",
      invocationId: call.id,
      toolName: call.name,
      output: { error: message },
      status: "failed",
    });
    return { role: "tool", tool_call_id: call.id, content: message };
  }
}

function toOpenAiTools(): ChatCompletionTool[] {
  return listTools().map((tool) => {
    const schema = z.toJSONSchema(tool.input) as Record<string, unknown>;
    delete schema.$schema;
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: schema,
      },
    };
  });
}

function replaceOrPush(blocks: ContentBlock[], next: ContentBlock) {
  const index = [...blocks].reverse().findIndex((block) => block.type === next.type);
  if (index === -1 || (next.type !== "text" && next.type !== "thinking")) {
    blocks.push(next);
    return;
  }
  blocks[blocks.length - 1 - index] = next;
}

function textFromBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
