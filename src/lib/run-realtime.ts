import { metadata } from "@trigger.dev/sdk";
import type { ContentBlock } from "@/contracts/blocks";
import type { Waitpoint as WaitpointDto } from "@/contracts/api";
import { assistantStream, thinkingStream } from "@/trigger/streams";

export type RunRealtimeMeta = {
  status: string;
  pendingTool?: string;
  waitpoint?: { kind: string; status: string; title?: string } | null;
  assets?: { url: string; durableUrl: string | null; kind: "image" | "video" | "audio" }[];
  thinkingOffset?: number;
  assistantOffset?: number;
};

type StreamWriter = (chunk: string) => Promise<void>;

export const STREAM_APPEND_TIMEOUT_MS = 500;

function writeWithTimeout(write: StreamWriter, chunk: string, timeoutMs: number): Promise<void> {
  if (timeoutMs <= 0) return write(chunk);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    write(chunk).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<void>((_, reject) => {
      timer = setTimeout(() => reject(new Error("STREAM_WRITE_TIMEOUT")), timeoutMs);
    }),
  ]);
}

export function createPump(write: StreamWriter, timeoutMs = STREAM_APPEND_TIMEOUT_MS) {
  let buffer = "";
  let sent = 0;
  let inflight: Promise<void> | null = null;

  const drain = async () => {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        while (buffer) {
          const chunk = buffer;
          buffer = "";
          try {
            await writeWithTimeout(write, chunk, timeoutMs);
          } catch {
            // Drop a hung Trigger stream write; never block the turn.
          }
          sent += chunk.length;
        }
      } finally {
        inflight = null;
      }
    })();
    try {
      await inflight;
    } finally {
      if (buffer) await drain();
    }
  };

  return {
    get sent() {
      return sent;
    },
    push(delta: string) {
      if (!delta) return;
      buffer += delta;
      void drain();
    },
    async flush() {
      while (buffer || inflight) {
        await (inflight ?? drain());
      }
    },
  };
}

export function createRealtimePublisher(
  writers?: { thinking?: StreamWriter; assistant?: StreamWriter },
  timeoutMs = STREAM_APPEND_TIMEOUT_MS,
) {
  const thinking = createPump(writers?.thinking ?? ((chunk) => thinkingStream.append(chunk)), timeoutMs);
  const assistant = createPump(writers?.assistant ?? ((chunk) => assistantStream.append(chunk)), timeoutMs);
  let thinkingOffset = 0;
  let assistantOffset = 0;

  return {
    appendThinking(delta: string) {
      thinking.push(delta);
    },
    appendAssistant(delta: string) {
      assistant.push(delta);
    },
    offsets() {
      return { thinkingOffset, assistantOffset };
    },
    async beginHop() {
      await Promise.all([thinking.flush(), assistant.flush()]);
      thinkingOffset = thinking.sent;
      assistantOffset = assistant.sent;
    },
    async flush() {
      await Promise.all([thinking.flush(), assistant.flush()]);
    },
  };
}

export async function appendThinking(delta: string): Promise<void> {
  if (!delta) return;
  try {
    await thinkingStream.append(delta);
  } catch {
    // no-op outside a Trigger task
  }
}

export async function appendAssistant(delta: string): Promise<void> {
  if (!delta) return;
  try {
    await assistantStream.append(delta);
  } catch {
    // no-op outside a Trigger task
  }
}

export async function publishRunMeta(input: RunRealtimeMeta): Promise<void> {
  try {
    metadata.set("galaxy", input);
  } catch {
    // no-op outside a Trigger task
  }
}

export function pendingToolFromBlocks(blocks: ContentBlock[]): string | undefined {
  const done = new Set(
    blocks
      .filter((block): block is Extract<ContentBlock, { type: "tool_result" }> => block.type === "tool_result")
      .map((block) => block.invocationId),
  );
  const pending = [...blocks]
    .reverse()
    .find((block) => block.type === "tool_use" && !done.has(block.invocationId));
  return pending && pending.type === "tool_use" ? pending.toolName : undefined;
}

export function assetsFromBlocks(blocks: ContentBlock[]): RunRealtimeMeta["assets"] {
  const assets: NonNullable<RunRealtimeMeta["assets"]> = [];
  for (const block of blocks) {
    if (block.type !== "tool_result") continue;
    const record = block.output && typeof block.output === "object" ? (block.output as Record<string, unknown>) : {};
    for (const key of ["image_url", "video_url", "url"] as const) {
      const url = record[key];
      if (typeof url === "string" && /^https?:\/\//.test(url)) {
        assets.push({
          url,
          durableUrl: typeof record.durableUrl === "string" ? record.durableUrl : null,
          kind: key === "video_url" || /\.(mp4|webm)(?:\?|$)/i.test(url) ? "video" : "image",
        });
      }
    }
  }
  return assets;
}

export async function publishRunMetaFromBlocks(input: {
  status: string;
  blocks: ContentBlock[];
  waitpoint?: { kind: string; status: string; payload?: unknown } | WaitpointDto | null;
  thinkingOffset?: number;
  assistantOffset?: number;
}): Promise<void> {
  const payload =
    input.waitpoint && "payload" in input.waitpoint
      ? (input.waitpoint.payload as { title?: string } | undefined)
      : undefined;
  await publishRunMeta({
    status: input.status,
    pendingTool: pendingToolFromBlocks(input.blocks),
    waitpoint: input.waitpoint
      ? {
          kind: input.waitpoint.kind,
          status: input.waitpoint.status,
          title: payload?.title,
        }
      : null,
    assets: assetsFromBlocks(input.blocks),
    thinkingOffset: input.thinkingOffset,
    assistantOffset: input.assistantOffset,
  });
}
