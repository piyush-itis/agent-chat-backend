import { task } from "@trigger.dev/sdk/v3";
import { pollNodeRun } from "@/lib/magica/client";
import { prisma } from "@/lib/db";
import { touchAgentRunLease } from "@/lib/run-lease";

export const magicaRunTask = task({
  id: "magica.run",
  run: async (payload: { providerRunId: string; parentRunId: string }) => {
    return pollNodeRun(payload.providerRunId, {
      shouldAbort: async () => {
        const current = await prisma.agentRun.findUnique({
          where: { id: payload.parentRunId },
        });
        return current?.status === "stopping" || current?.status === "cancelled";
      },
      onTick: () => touchAgentRunLease(payload.parentRunId),
    });
  },
});
