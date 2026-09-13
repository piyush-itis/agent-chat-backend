import { schedules } from "@trigger.dev/sdk/v3";
import { prisma } from "@/lib/db";
import { dispatchAgentTurn, usesTriggerDispatch } from "@/lib/dispatch";
import { finalizeCancelledRun } from "@/lib/finalize";
import { bumpDispatchAttempt, dispatchKeyForAttempt } from "@/lib/run-lease";
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

    let redispatched = 0;
    if (usesTriggerDispatch()) {
      const orphans = await prisma.agentRun.findMany({
        where: {
          status: { in: ["queued", "thinking", "working"] },
          OR: [...leaseExpired],
        },
        take: 25,
      });
      for (const run of orphans) {
        const attempt = await bumpDispatchAttempt(run.id);
        await dispatchAgentTurn(run.id, dispatchKeyForAttempt(run.dispatchKey, attempt));
        redispatched += 1;
      }
    }

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

    return { expired: stale.length, unlocked, cancelled, redispatched, copied };
  },
});
