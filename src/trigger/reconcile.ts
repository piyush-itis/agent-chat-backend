import { task } from "@trigger.dev/sdk/v3";
import { prisma } from "@/lib/db";
import { expireOpenWaitpoints } from "@/lib/waitpoints";
import { copyToDurableStorage, s3Configured } from "@/lib/storage";

export const reconcileTask = task({
  id: "run.reconcile",
  run: async () => {
    const stale = await prisma.agentRun.findMany({
      where: {
        status: { in: ["waiting"] },
        waitpoints: { some: { status: "open", expiresAt: { lt: new Date() } } },
      },
      take: 50,
    });
    for (const run of stale) {
      await expireOpenWaitpoints(run.id);
    }

    if (!s3Configured()) return { expired: stale.length, copied: 0 };

    let copied = 0;
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
    return { expired: stale.length, copied };
  },
});
