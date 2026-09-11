import { task } from "@trigger.dev/sdk/v3";
import { pollNodeRun } from "@/lib/magica/client";

export const magicaRunTask = task({
  id: "magica.run",
  run: async (payload: { providerRunId: string }) => {
    return pollNodeRun(payload.providerRunId);
  },
});
