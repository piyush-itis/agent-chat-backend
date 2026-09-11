import { task } from "@trigger.dev/sdk/v3";
import { runAgentTurn } from "@/lib/orchestrator";

export const agentTurnTask = task({
  id: "agent.turn",
  run: async (payload: { runId: string }) => {
    await runAgentTurn(payload.runId);
  },
});
