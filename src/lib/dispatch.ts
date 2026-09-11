import { runAgentTurn } from "./orchestrator";

export async function dispatchAgentTurn(runId: string, dispatchKey: string): Promise<void> {
  const hasTrigger = Boolean(process.env.TRIGGER_SECRET_KEY);
  const inline = process.env.DISPATCH_MODE === "inline" || !hasTrigger;

  if (inline) {
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

  const { agentTurnTask } = await import("@/trigger/agent-turn");
  await agentTurnTask.trigger({ runId }, { idempotencyKey: dispatchKey });
}
