import { task } from "@trigger.dev/sdk";
import { persistTriggerRunId } from "@/lib/run-lease";
import { runAgentTurn } from "@/lib/orchestrator";

export const agentTurnTask = task({
  id: "agent.turn",
  run: async (payload: { runId: string }, { ctx }: { ctx: { run: { id: string } } }) => {
    if (ctx?.run?.id) {
      await persistTriggerRunId(payload.runId, ctx.run.id);
    }
    await runAgentTurn(payload.runId);
  },
});
