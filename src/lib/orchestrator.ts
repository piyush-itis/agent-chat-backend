import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ContentBlock } from "@/contracts/blocks";
import { LIMITS } from "@/contracts/limits";
import type { SessionSnapshot } from "@/contracts/api";
import { prisma } from "./db";
import { ApiError } from "./errors";
import { creditsFromTokens, hasCredits, settleModelCharge } from "./credits";
import { streamOpenRouterFree, type ChatTurn, type ToolCall } from "./openrouter";
import { getTool, listTools, type ToolContext } from "./registry";
import { parseBlocks } from "./serialize";
import {
  alreadyCropped,
  buildAutoCropCall,
  dropCompletedCropCalls,
  lastSuccessfulCropOutput,
  latestCropImageUrl,
  resolveCropImageUrl,
} from "./crop-source";
import {
  alreadyMerged,
  buildAutoMergeCall,
  chatVideoUrls,
  dropCompletedMergeCalls,
  lastSuccessfulMergeOutput,
  resolveMergeVideoUrls,
} from "./merge-source";
import {
  alreadyGenerated,
  dropCompletedGenerateCalls,
  generateResultCount,
  lastSuccessfulGenerateOutput,
} from "./generate-source";
import { historyTurnsForModel, textFromBlocks } from "./history-turns";
import { nextLiveRunStatus } from "./run-status";
import { hadSuccessfulMagicaWork, needsMagicaTools } from "./turn-intent";
import {
  applyCropTargetToArgs,
  askQuestionsInput,
  cropTargetInstruction,
  CROP_TARGET_QUESTION,
  executeAskQuestions,
  needsCropTarget,
  reusedCropTargetAnswers,
} from "./questions";
import { skillPromptLines } from "./skills/tools";
import { SkillError } from "./skills/registry";
import { finalizeCancelledRun, finalizeRun } from "./finalize";
import { emitWebhook } from "./webhooks";
import { HEARTBEAT_MS, LostLease, claimAgentRun, heartbeatAgentRun, releaseLease } from "./run-lease";
import {
  RunStopped,
  WaitpointPause,
  assertRunNotStopping,
  mergeSnapshot,
  findOpenWaitpoint,
  parseSnapshot,
  pauseForWaitpoint,
  waitpointKindForPlan,
} from "./waitpoints";
import { createRealtimePublisher, publishRunMetaFromBlocks } from "./run-realtime";

function asJson(blocks: ContentBlock[]): Prisma.InputJsonValue {
  return blocks as unknown as Prisma.InputJsonValue;
}

function sumMagicaCreditUsed(blocks: ContentBlock[]): number {
  return blocks.reduce((total, block) => {
    if (block.type !== "tool_result") return total;
    const output = block.output as { creditUsed?: unknown } | null;
    return total + (typeof output?.creditUsed === "number" && output.creditUsed > 0 ? output.creditUsed : 0);
  }, 0);
}

async function settleOpenRouterUsage(
  userId: string,
  runId: string,
  promptTokens: number,
  completionTokens: number,
): Promise<number> {
  await settleModelCharge({
    userId,
    runId,
    amount: creditsFromTokens(promptTokens, completionTokens),
  });
  const settled = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { creditsSettled: true },
  });
  return settled?.creditsSettled ?? 0;
}

function usageBlock(
  modelRouted: string | null,
  promptTokens: number,
  completionTokens: number,
  applicationCredits: number,
  blocks: ContentBlock[],
): Extract<ContentBlock, { type: "usage" }> {
  const magicaCreditUsed = sumMagicaCreditUsed(blocks);
  return {
    type: "usage",
    modelRouted,
    promptTokens,
    completionTokens,
    applicationCredits,
    ...(magicaCreditUsed > 0 ? { magicaCreditUsed } : {}),
  };
}

function systemPrompt(planMode: boolean, chatOnly = false): string {
  if (chatOnly) {
    return [
      "You are Galaxy Agent Chat.",
      "Reply in one or two short sentences.",
      "Do not call tools. Do not mention APIs, models, or safety ratings.",
      "Do not write a safety evaluation.",
    ].join("\n");
  }
  return [
    "You are Galaxy Agent Chat.",
    "Use only the OpenRouter free route. Do not suggest paid models.",
    "Skills (names and descriptions only). Call load_skill before Magica work when relevant:",
    skillPromptLines(),
    "Available tools: load_skill, read_skill_asset, ask_questions, gpt_image_2, crop_image, merge_videos.",
    "Choose tools from user intent. You may chain generate then crop.",
    "The latest user message is the active task. Do not fulfill earlier user requests unless they ask to continue.",
    "After gpt_image_2 succeeds this turn, do not call it again. Crop the result if needed.",
    "Call ask_questions only when the user wants generate/crop/merge AND a critical detail is missing (logo wordmark, style, palette, a crop target, or a second video). Skip questions when the prompt is already specific enough to run. Never narrate the questions in chat text — call the tool only, with at most 3 short questions.",
    "When the user wants to crop and did not give a ratio or region, call ask_questions with exactly one question: prompt \"Choose a crop target\" and Magica choices Square (1:1), Story / Reel (9:16), Portrait (4:5), Landscape (16:9), Custom region or ratio. Do not ask for raw coordinates.",
    "After a crop target is answered, never call ask_questions again for crop. Call crop_image immediately with that ratio as a centered percent rectangle.",
    "When the user wants to merge and two or more videos are already attached, do not ask for another clip. Call merge_videos with those URLs in upload order. After merge succeeds, do not call merge_videos again.",
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
  const leaseId = await claimAgentRun(runId);
  if (!leaseId) return;

  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run || !run.assistantMessageId) {
    await releaseLease(runId, leaseId);
    return;
  }
  if (["complete", "failed", "cancelled"].includes(run.status)) {
    await releaseLease(runId, leaseId);
    return;
  }
  if (run.status === "stopping") {
    await finalizeCancelledRun(runId);
    await releaseLease(runId, leaseId);
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
  await publishRunMetaFromBlocks({ status: "thinking", blocks });

  const history = await prisma.message.findMany({
    where: { chatId: run.chatId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LIMITS.contextWindowMessages,
  });
  const chronological = history.reverse();

  const attachments = await prisma.attachment.findMany({
    where: { chatId: run.chatId },
    orderBy: { sortOrder: "asc" },
    take: 20,
  });
  const thisTurnAttachments = attachments.filter((item) => item.messageId === run.userMessageId);
  const historyForModel = chronological.map((message) => ({
    role: message.role,
    status: message.status,
    blocks: parseBlocks(message.blocks),
  }));
  const lastUserPreview = [...chronological].reverse().find((message) => message.role === "user");
  const lastUserPreviewText = lastUserPreview ? textFromBlocks(parseBlocks(lastUserPreview.blocks)) : "";
  const chatOnly = !needsMagicaTools({
    userText: lastUserPreviewText,
    thisTurnAttachmentCount: thisTurnAttachments.length,
    snapshot,
    hadRecentMagicaWork: hadSuccessfulMagicaWork(historyForModel),
  });
  console.info(
    `[agent.turn] run=${runId} chatOnly=${chatOnly} text=${JSON.stringify(lastUserPreviewText.slice(0, 80))}`,
  );

  const messages: ChatTurn[] = [
    { role: "system", content: systemPrompt(Boolean(snapshot.planMode), chatOnly) },
    ...historyTurnsForModel(historyForModel),
  ];
  if (!chatOnly && attachments.length > 0) {
    messages.push({
      role: "system",
      content: `User media: ${attachments
        .map((item) => `${item.mimeType} ${item.durableUrl ?? item.resultUrl ?? ""}`)
        .join(" | ")}`,
    });
  }
  const cropHint = chatOnly ? null : cropTargetInstruction(snapshot);
  if (cropHint) {
    messages.push({ role: "system", content: cropHint });
  }

  let lastPersist = 0;
  let lastHeartbeat = 0;
  const realtime = createRealtimePublisher();
  const beat = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastHeartbeat < HEARTBEAT_MS) return;
    lastHeartbeat = now;
    const ok = await heartbeatAgentRun(runId, leaseId);
    if (!ok) throw new LostLease();
  };
  const persist = async (force = false) => {
    const now = Date.now();
    await beat();
    if (!force && now - lastPersist < LIMITS.persistIntervalMs) return;
    lastPersist = now;
    await prisma.message.update({
      where: { id: run.assistantMessageId! },
      data: { blocks: asJson(blocks) },
    });
    const current = await prisma.agentRun.findUnique({ where: { id: runId } });
    if (current && ["complete", "failed", "cancelled"].includes(current.status)) {
      throw new LostLease();
    }
    const openWait = current ? await findOpenWaitpoint(runId) : null;
    const nextStatus = nextLiveRunStatus({
      currentStatus: current?.status ?? "thinking",
      openWait: Boolean(openWait),
      blocks,
    });
    if (current && current.status !== nextStatus) {
      await prisma.agentRun.update({
        where: { id: runId },
        data: { status: nextStatus },
      });
    }
    await publishRunMetaFromBlocks({
      status: nextStatus,
      blocks,
      waitpoint: openWait,
      ...realtime.offsets(),
    });
    if (openWait) return;
  };

  let tools = toOpenAiTools();
  let modelRouted: string | null = run.modelRouted;
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    const lastUser = [...chronological].reverse().find((message) => message.role === "user");
    const lastUserText = lastUser ? textFromBlocks(parseBlocks(lastUser.blocks)) : "";
    if (!chatOnly && !snapshot.pendingToolCalls?.length && needsCropTarget(lastUserText, snapshot)) {
      await executeAskQuestions(
        {
          runId,
          chatId: run.chatId,
          userId: run.userId,
          toolCallId: `crop-target:${run.userMessageId}`,
        },
        {
          message: CROP_TARGET_QUESTION.prompt,
          questions: [{ prompt: CROP_TARGET_QUESTION.prompt, required: true, choices: [...CROP_TARGET_QUESTION.choices] }],
        },
      );
    }

    const pendingCalls = dropRepeats(snapshot.pendingToolCalls ?? [], blocks);
    if (pendingCalls.length) {
      await assertRunNotStopping(runId);
      await maybePauseForToolPolicy(runId, snapshot, pendingCalls);
      const ctxBase = { runId, chatId: run.chatId, userId: run.userId };
      const outputs = await runToolBatch(
        ctxBase,
        pendingCalls,
        blocks,
        persist,
      );
      for (const output of outputs) {
        messages.push(output);
        appendAnswersContext(messages, output);
      }
      await mergeSnapshot(runId, { pendingToolCalls: [], pendingPhase: undefined });
      await persist(true);
      if (snapshot.publicToolOnly) {
        const creditsSettled = await settleOpenRouterUsage(run.userId, runId, promptTokens, completionTokens);
        blocks.push(usageBlock(modelRouted, promptTokens, completionTokens, creditsSettled, blocks));
        await finalizeRun(runId, {
          status: "complete",
          blocks,
          modelRouted,
          messageStatus: "success",
        });
        await releaseLease(runId, leaseId);
        return;
      }
    }

    const liveAfterPending = parseSnapshot(
      (await prisma.agentRun.findUnique({ where: { id: runId } }))?.sessionSnapshot,
    );
    const cropSourceUrl = chatOnly ? undefined : await latestCropImageUrl(run.chatId, run.userMessageId);
    const autoCrop = chatOnly
      ? null
      : buildAutoCropCall({
          userMessageId: run.userMessageId,
          imageUrl: cropSourceUrl,
          snapshot: liveAfterPending,
          alreadyCropped: alreadyCropped(blocks),
        });
    if (autoCrop) {
      await maybePauseForToolPolicy(runId, liveAfterPending, [autoCrop]);
      await mergeSnapshot(runId, { pendingToolCalls: [autoCrop], pendingPhase: "tools" });
      const cropOutputs = await runToolBatch(
        { runId, chatId: run.chatId, userId: run.userId },
        [autoCrop],
        blocks,
        persist,
      );
      for (const output of cropOutputs) {
        messages.push(output);
      }
      await mergeSnapshot(runId, { pendingToolCalls: [], pendingPhase: undefined });
      await persist(true);
    }
    const videoUrls = chatOnly ? [] : await chatVideoUrls(run.chatId, run.userMessageId);
    const autoMerge = chatOnly
      ? null
      : buildAutoMergeCall({
          userMessageId: run.userMessageId,
          userText: lastUserText,
          videoUrls,
          alreadyMerged: alreadyMerged(blocks),
        });
    if (autoMerge) {
      await maybePauseForToolPolicy(runId, liveAfterPending, [autoMerge]);
      await mergeSnapshot(runId, { pendingToolCalls: [autoMerge], pendingPhase: "tools" });
      const mergeOutputs = await runToolBatch(
        { runId, chatId: run.chatId, userId: run.userId },
        [autoMerge],
        blocks,
        persist,
      );
      for (const output of mergeOutputs) {
        messages.push(output);
      }
      await mergeSnapshot(runId, { pendingToolCalls: [], pendingPhase: undefined });
      await persist(true);
    }
    const noted = new Set<string>();

    for (let iteration = 0; iteration < LIMITS.maxToolIterations; iteration += 1) {
      const omitTools: string[] = [];
      if (alreadyCropped(blocks)) {
        omitTools.push("crop_image");
        const note = "Crop already completed. Do not call crop_image again. Reply with a short confirmation only.";
        if (!noted.has(note)) {
          messages.push({ role: "system", content: note });
          noted.add(note);
        }
      }
      if (alreadyMerged(blocks)) {
        omitTools.push("merge_videos");
        const note = "Merge already completed. Do not call merge_videos again. Reply with a short confirmation only.";
        if (!noted.has(note)) {
          messages.push({ role: "system", content: note });
          noted.add(note);
        }
      }
      if (alreadyGenerated(blocks)) {
        omitTools.push("gpt_image_2");
        const note =
          "Image generation already completed this turn. Do not call gpt_image_2 again. You may crop the result. Reply with a short confirmation only.";
        if (!noted.has(note)) {
          messages.push({ role: "system", content: note });
          noted.add(note);
        }
      } else if (generateResultCount(blocks) >= 2) {
        omitTools.push("gpt_image_2");
        const note =
          "Image generation already failed twice this turn. Do not call gpt_image_2 again. Tell the user it did not complete.";
        if (!noted.has(note)) {
          messages.push({ role: "system", content: note });
          noted.add(note);
        }
      }
      tools = chatOnly ? [] : toOpenAiTools(omitTools);
      await assertRunNotStopping(runId);
      if (iteration > 0) {
        for (let index = blocks.length - 1; index >= 0; index -= 1) {
          if (blocks[index]?.type === "thinking" || blocks[index]?.type === "text") {
            blocks.splice(index, 1);
          }
        }
      }
      await realtime.beginHop();
      let thinking = "";
      let text = "";
      const hopStarted = Date.now();
      let firstTokenAt: number | null = null;
      const keepAlive = setInterval(() => {
        void beat(true).catch(() => undefined);
      }, HEARTBEAT_MS);
      let result: Awaited<ReturnType<typeof streamOpenRouterFree>>;
      try {
        result = await streamOpenRouterFree(
          messages,
          {
            onThinking: async (delta, full) => {
              await assertRunNotStopping(runId);
              if (firstTokenAt == null) firstTokenAt = Date.now();
              thinking = full;
              replaceOrPush(blocks, { type: "thinking", text: full });
              realtime.appendThinking(delta);
              await persist();
            },
            onText: async (delta, full) => {
              await assertRunNotStopping(runId);
              if (firstTokenAt == null) firstTokenAt = Date.now();
              text = full;
              replaceOrPush(blocks, { type: "text", text: full });
              realtime.appendAssistant(delta);
              await persist();
            },
          },
          {
            tools,
            ...(chatOnly
              ? {
                  reasoningEffort: "none" as const,
                  excludeReasoning: true,
                  timeoutMs: LIMITS.chatOnlyTimeoutMs,
                }
              : {}),
          },
        );
      } finally {
        clearInterval(keepAlive);
      }
      modelRouted = result.modelRouted ?? modelRouted;
      promptTokens += result.promptTokens;
      completionTokens += result.completionTokens;
      if (result.thinking) replaceOrPush(blocks, { type: "thinking", text: result.thinking });
      if (result.text) replaceOrPush(blocks, { type: "text", text: result.text });
      console.info(
        `[agent.turn] openrouter chatOnly=${chatOnly} model=${modelRouted ?? "unknown"} firstTokenMs=${
          firstTokenAt ? firstTokenAt - hopStarted : -1
        } totalMs=${Date.now() - hopStarted}`,
      );
      await persist(true);
      void realtime.flush().catch(() => undefined);

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

      const toolCalls = dropRepeats(result.toolCalls, blocks);
      if (toolCalls.length === 0) break;

      messages.push({
        role: "assistant",
        content: result.text || thinking || null,
        tool_calls: toolCalls,
      });

      const live = parseSnapshot(
        (await prisma.agentRun.findUnique({ where: { id: runId } }))?.sessionSnapshot,
      );
      await maybePauseForToolPolicy(runId, live, toolCalls);
      await assertRunNotStopping(runId);

      await mergeSnapshot(runId, { pendingToolCalls: toolCalls, pendingPhase: "tools" });
      const ctxBase = { runId, chatId: run.chatId, userId: run.userId };
      const outputs = await runToolBatch(ctxBase, toolCalls, blocks, persist);
      for (const output of outputs) {
        messages.push(output);
        appendAnswersContext(messages, output);
      }
      await mergeSnapshot(runId, { pendingToolCalls: [], pendingPhase: undefined });
      await persist(true);
    }

    const liveStatus = (await prisma.agentRun.findUnique({ where: { id: runId } }))?.status;
    if (liveStatus === "stopping") {
      await finalizeCancelledRun(runId);
      await releaseLease(runId, leaseId);
      return;
    }
    const creditsSettled = await settleOpenRouterUsage(run.userId, runId, promptTokens, completionTokens);
    blocks.push(usageBlock(modelRouted, promptTokens, completionTokens, creditsSettled, blocks));

    await finalizeRun(runId, {
      status: "complete",
      blocks,
      modelRouted,
      messageStatus: "success",
    });
    await releaseLease(runId, leaseId);
  } catch (error) {
    await realtime.flush().catch(() => undefined);
    if (error instanceof LostLease) {
      await persist(true).catch(() => undefined);
      return;
    }
    if (error instanceof WaitpointPause) {
      await persist(true);
      await prisma.agentRun.update({
        where: { id: runId },
        data: { status: "waiting" },
      });
      await releaseLease(runId, leaseId);
      return;
    }
    if (error instanceof RunStopped) {
      await persist(true);
      await finalizeCancelledRun(runId);
      await releaseLease(runId, leaseId);
      return;
    }
    const safe =
      error instanceof ApiError
        ? error.message
        : "The model or a tool failed. There is no paid fallback.";
    const code = error instanceof ApiError ? error.code : "MODEL_UNAVAILABLE";
    await settleOpenRouterUsage(run.userId, runId, promptTokens, completionTokens).catch(() => undefined);
    await finalizeRun(runId, {
      status: "failed",
      blocks,
      modelRouted,
      messageStatus: "failed",
      errorCode: code,
      errorSafeMessage: safe,
    });
    await releaseLease(runId, leaseId);
  }
}

function dropRepeats(calls: ToolCall[], blocks: ContentBlock[]) {
  return dropCompletedGenerateCalls(
    dropCompletedMergeCalls(dropCompletedCropCalls(calls, alreadyCropped(blocks)), alreadyMerged(blocks)),
    alreadyGenerated(blocks) || generateResultCount(blocks) >= 2,
  );
}

async function maybePauseForToolPolicy(runId: string, snapshot: SessionSnapshot, calls: ToolCall[]) {
  if (snapshot.skipWaitpoints || snapshot.publicToolOnly) return;
  const unansweredAsk = calls.some(
    (call) => call.name === "ask_questions" && !hasQuestionAnswers(call, snapshot),
  );
  if (unansweredAsk) return;
  const magica = calls.filter((call) => ["crop_image", "gpt_image_2", "merge_videos"].includes(call.name));
  if (magica.length === 0) return;

  const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { chatId: true } });
  const knownUrls = new Set(
    [
      ...(
        await prisma.attachment.findMany({
          where: { chatId: run?.chatId ?? "__none__" },
          select: { durableUrl: true, resultUrl: true },
        })
      ).flatMap((item) => [item.durableUrl, item.resultUrl]),
      ...(
        await prisma.generatedAsset.findMany({
          where: { run: { chatId: run?.chatId ?? "__none__" } },
          select: { url: true, durableUrl: true },
        })
      ).flatMap((item) => [item.durableUrl, item.url]),
    ].filter((url): url is string => Boolean(url)),
  );
  const mediaPending = magica.filter((call) => {
    if ((snapshot.approvedMediaKeys ?? []).includes(call.id)) return false;
    if (call.name !== "crop_image" && call.name !== "merge_videos" && call.name !== "gpt_image_2") {
      return false;
    }
    if (call.name === "crop_image" || call.name === "merge_videos") {
      const urls = extractMediaUrlsFromArgs(call.arguments);
      if (urls.length > 0 && urls.every((url) => knownUrls.has(url))) return false;
    }
    return true;
  });
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

function hasQuestionAnswers(call: ToolCall, snapshot: SessionSnapshot) {
  if (snapshot.questionAnswers?.[call.id]) return true;
  try {
    const parsed = askQuestionsInput.safeParse(JSON.parse(call.arguments || "{}"));
    return parsed.success && reusedCropTargetAnswers(parsed.data, snapshot) !== null;
  } catch {
    return false;
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

function appendAnswersContext(messages: ChatTurn[], output: Extract<ChatTurn, { role: "tool" }>) {
  try {
    const parsed = JSON.parse(output.content) as { answers?: Record<string, string> };
    if (!parsed.answers || Object.keys(parsed.answers).length === 0) return;
    const lines = Object.entries(parsed.answers)
      .map(([id, answer]) => `${id}: ${answer || "(skipped)"}`)
      .join("\n");
    messages.push({ role: "user", content: `User input received:\n${lines}` });
    const hint = cropTargetInstruction({ version: 1, questionAnswers: { answered: parsed.answers } });
    if (hint) messages.push({ role: "system", content: hint });
  } catch {
    /* not a questions result */
  }
}

async function runToolBatch(
  ctxBase: Omit<ToolContext, "toolCallId">,
  calls: ToolCall[],
  blocks: ContentBlock[],
  persist: (force?: boolean) => Promise<void>,
) {
  const ordered = [...calls].sort((a, b) => {
    if (a.name === "ask_questions" && b.name !== "ask_questions") return -1;
    if (b.name === "ask_questions" && a.name !== "ask_questions") return 1;
    return a.id.localeCompare(b.id);
  });
  const outputs: Extract<ChatTurn, { role: "tool" }>[] = [];
  for (const call of ordered) {
    outputs.push(await executeOneTool({ ...ctxBase, toolCallId: call.id }, call, blocks, persist));
  }
  return outputs;
}

async function executeOneTool(
  ctx: ToolContext,
  call: ToolCall,
  blocks: ContentBlock[],
  persist: (force?: boolean) => Promise<void>,
): Promise<Extract<ChatTurn, { role: "tool" }>> {
  await persist();
  const tool = getTool(call.name);
  let parsed: unknown = {};
  try {
    parsed = call.arguments ? JSON.parse(call.arguments) : {};
  } catch {
    parsed = {};
  }
  if (call.name === "crop_image") {
    const liveRun = await prisma.agentRun.findUnique({ where: { id: ctx.runId } });
    const live = parseSnapshot(liveRun?.sessionSnapshot);
    const trustedUrl = await latestCropImageUrl(ctx.chatId, liveRun?.userMessageId);
    parsed = applyCropTargetToArgs(resolveCropImageUrl(parsed, trustedUrl), live, trustedUrl);
  }
  if (call.name === "merge_videos") {
    const liveRun = await prisma.agentRun.findUnique({ where: { id: ctx.runId } });
    const trustedVideos = await chatVideoUrls(ctx.chatId, liveRun?.userMessageId);
    parsed = resolveMergeVideoUrls(parsed, trustedVideos);
  }

  const already = blocks.find(
    (block) => block.type === "tool_result" && block.invocationId === call.id,
  );
  if (already && already.type === "tool_result") {
    return { role: "tool", tool_call_id: call.id, content: JSON.stringify(already.output) };
  }
  if (call.name === "crop_image" && alreadyCropped(blocks)) {
    const previous = lastSuccessfulCropOutput(blocks);
    if (previous) {
      return { role: "tool", tool_call_id: call.id, content: JSON.stringify(previous) };
    }
  }
  if (call.name === "merge_videos" && alreadyMerged(blocks)) {
    const previous = lastSuccessfulMergeOutput(blocks);
    if (previous) {
      return { role: "tool", tool_call_id: call.id, content: JSON.stringify(previous) };
    }
  }
  if (call.name === "gpt_image_2" && alreadyGenerated(blocks)) {
    const previous = lastSuccessfulGenerateOutput(blocks);
    if (previous) {
      return { role: "tool", tool_call_id: call.id, content: JSON.stringify(previous) };
    }
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
    const started = Date.now();
    const output = await tool.execute(ctx, input.data);
    const { visible, prelude } = splitTimelineOutput(output);
    if (visible && typeof visible === "object" && !Array.isArray(visible) && !("durationMs" in visible)) {
      (visible as Record<string, unknown>).durationMs = Date.now() - started;
    }
    insertPreludeBlocks(blocks, call.id, prelude);
    blocks.push({
      type: "tool_result",
      invocationId: call.id,
      toolName: call.name,
      output: visible,
      status: "success",
    });
    void emitWebhook(ctx.userId, "tool.completed", {
      runId: ctx.runId,
      chatId: ctx.chatId,
      toolName: call.name,
      invocationId: call.id,
    });
    return { role: "tool", tool_call_id: call.id, content: JSON.stringify(visible) };
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

function toOpenAiTools(omit: string[] = []): ChatCompletionTool[] {
  return listTools()
    .filter((tool) => !omit.includes(tool.name))
    .map((tool) => {
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

type TimelinePrelude = {
  invocationId: string;
  toolName: string;
  input: unknown;
  output: unknown;
};

function splitTimelineOutput(output: unknown): { visible: unknown; prelude: TimelinePrelude[] } {
  if (!output || typeof output !== "object" || !("_timelineSteps" in output)) {
    return { visible: output, prelude: [] };
  }
  const record = output as Record<string, unknown>;
  const raw = record._timelineSteps;
  const { _timelineSteps: _dropped, ...visible } = record;
  const prelude = Array.isArray(raw)
    ? raw.filter((item): item is TimelinePrelude => {
        return Boolean(
          item &&
            typeof item === "object" &&
            typeof (item as TimelinePrelude).invocationId === "string" &&
            typeof (item as TimelinePrelude).toolName === "string",
        );
      })
    : [];
  return { visible, prelude };
}

function insertPreludeBlocks(blocks: ContentBlock[], beforeInvocationId: string, prelude: TimelinePrelude[]) {
  if (prelude.length === 0) return;
  const index = blocks.findIndex(
    (block) => block.type === "tool_use" && block.invocationId === beforeInvocationId,
  );
  const extras: ContentBlock[] = prelude.flatMap((step) => [
    { type: "tool_use" as const, invocationId: step.invocationId, toolName: step.toolName, input: step.input },
    {
      type: "tool_result" as const,
      invocationId: step.invocationId,
      toolName: step.toolName,
      output: step.output,
      status: "success" as const,
    },
  ]);
  if (index === -1) {
    blocks.push(...extras);
    return;
  }
  blocks.splice(index, 0, ...extras);
}

function replaceOrPush(blocks: ContentBlock[], next: ContentBlock) {
  const index = [...blocks].reverse().findIndex((block) => block.type === next.type);
  if (index === -1 || (next.type !== "text" && next.type !== "thinking")) {
    blocks.push(next);
    return;
  }
  blocks[blocks.length - 1 - index] = next;
}

