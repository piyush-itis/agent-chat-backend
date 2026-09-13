import { auth } from "@trigger.dev/sdk";
import { REALTIME_STREAMS, type RealtimeAccess } from "@/contracts/api";
import { isActiveStatus } from "./chats";
import { usesTriggerDispatch } from "./dispatch";

export function pollRealtime(runId: string): RealtimeAccess {
  return { transport: "poll", pollUrl: `/api/runs/${runId}` };
}

export async function mintTriggerRealtime(triggerRunId: string, runId: string): Promise<RealtimeAccess> {
  const publicAccessToken = await auth.createPublicToken({
    scopes: { read: { runs: [triggerRunId] } },
    expirationTime: "1hr",
  });
  return {
    transport: "trigger",
    pollUrl: `/api/runs/${runId}`,
    triggerRunId,
    publicAccessToken,
    streams: { thinking: REALTIME_STREAMS.thinking, assistant: REALTIME_STREAMS.assistant },
  };
}

export async function realtimeAccessForRun(run: {
  id: string;
  status: string;
  triggerRunId: string | null;
} | null): Promise<RealtimeAccess> {
  if (!run) return pollRealtime("");
  if (!usesTriggerDispatch() || !run.triggerRunId) return pollRealtime(run.id);
  try {
    return await mintTriggerRealtime(run.triggerRunId, run.id);
  } catch {
    return pollRealtime(run.id);
  }
}

export async function realtimeAccessForActiveRun(run: {
  id: string;
  status: string;
  triggerRunId: string | null;
} | null): Promise<RealtimeAccess | undefined> {
  if (!run || !isActiveStatus(run.status) || !run.triggerRunId || !usesTriggerDispatch()) {
    return undefined;
  }
  try {
    return await mintTriggerRealtime(run.triggerRunId, run.id);
  } catch {
    return undefined;
  }
}
