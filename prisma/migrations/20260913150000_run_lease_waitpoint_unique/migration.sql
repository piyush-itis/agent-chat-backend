ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "leaseId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "leaseUntil" TIMESTAMP(3);
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "lastHeartbeatAt" TIMESTAMP(3);
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "dispatchAttempt" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "AgentRun_status_leaseUntil_idx" ON "AgentRun"("status", "leaseUntil");

CREATE UNIQUE INDEX IF NOT EXISTS "Waitpoint_one_open_per_run" ON "Waitpoint" ("runId") WHERE status = 'open';
