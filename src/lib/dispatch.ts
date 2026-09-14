import { runAgentTurn } from "./orchestrator";
import { persistTriggerRunId } from "./run-lease";
import { configureTriggerClient } from "./trigger-client";

export function usesTriggerDispatch(): boolean {
  return Boolean(process.env.TRIGGER_SECRET_KEY) && process.env.DISPATCH_MODE !== "inline";
}

export async function dispatchAgentTurn(runId: string, dispatchKey: string): Promise<void> {
  if (!usesTriggerDispatch()) {
    void runAgentTurn(runId).catch((error) => {
      console.error(
        JSON.stringify({
          level: "error",
          runId,
          dispatchKey,
          err: String(error),
        }),
      );
    });
    return;
  }

  configureTriggerClient();
  const { agentTurnTask } = await import("@/trigger/agent-turn");
  const handle = await agentTurnTask.trigger({ runId }, { idempotencyKey: dispatchKey });
  if (handle?.id) {
    await persistTriggerRunId(runId, handle.id);
  }
}
