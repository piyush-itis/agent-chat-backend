import { schedules } from "@trigger.dev/sdk/v3";
import { prisma } from "@/lib/db";
import { finalizeCancelledRun } from "@/lib/finalize";
import { settleOrphanedLiveRuns } from "@/lib/recover-runs";
import { expireOpenWaitpoints, unlockExpiredWaitpointRuns } from "@/lib/waitpoints";
import { copyToDurableStorage, s3Configured } from "@/lib/storage";

export const reconcileTask = schedules.task({
  id: "run.reconcile",
  cron: "*/2 * * * *",
  run: async () => {
    const stale = await prisma.agentRun.findMany({
      where: {
        status: "waiting",
        waitpoints: { some: { status: "open", expiresAt: { lt: new Date() } } },
      },
      take: 50,
    });
    for (const run of stale) {
      await expireOpenWaitpoints(run.id);
    }
    const unlocked = await unlockExpiredWaitpointRuns(50);

    const now = new Date();
    const leaseExpired = [{ leaseUntil: { equals: null } }, { leaseUntil: { lt: now } }] as const;

    let cancelled = 0;
    const stopping = await prisma.agentRun.findMany({
      where: { status: "stopping", OR: [...leaseExpired] },
      take: 25,
    });
    for (const run of stopping) {
      await finalizeCancelledRun(run.id);
      cancelled += 1;
    }

    const { completed, failed, redispatched } = await settleOrphanedLiveRuns(25);

    let copied = 0;
    if (s3Configured()) {
      const missing = await prisma.generatedAsset.findMany({
        where: { durableUrl: null },
        take: 20,
      });
      for (const asset of missing) {
        const durableUrl = await copyToDurableStorage(asset.url, `reconcile/${asset.id}`);
        await prisma.generatedAsset.update({
          where: { id: asset.id },
          data: { durableUrl },
        });
        copied += 1;
      }
    }

    return { expired: stale.length, unlocked, cancelled, completed, failed, redispatched, copied };
  },
});
