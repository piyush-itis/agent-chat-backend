-- AlterIndex
DROP INDEX IF EXISTS "AgentRun_chatId_createdAt_idx";

CREATE INDEX "AgentRun_chatId_createdAt_id_idx" ON "AgentRun"("chatId", "createdAt" DESC, "id" DESC);
