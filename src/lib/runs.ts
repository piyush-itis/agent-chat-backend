import { prisma } from "./db";
import { findOpenWaitpoint } from "./waitpoints";
import { serializeRun } from "./serialize";

export async function loadRunView(runId: string) {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run) return null;
  const [assistant, waitpoint, generatedAssets] = await Promise.all([
    run.assistantMessageId
      ? prisma.message.findUnique({ where: { id: run.assistantMessageId } })
      : Promise.resolve(null),
    findOpenWaitpoint(runId),
    prisma.generatedAsset.findMany({
      where: { runId },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return serializeRun(run, assistant, { waitpoint, generatedAssets });
}
