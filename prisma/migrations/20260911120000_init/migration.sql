-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('admission_reserve', 'admission_release', 'tool_charge', 'refund', 'grant');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant', 'system', 'tool');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('success', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('queued', 'thinking', 'working', 'waiting', 'stopping', 'complete', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "ToolProvider" AS ENUM ('magica', 'skill', 'internal');

-- CreateEnum
CREATE TYPE "ToolInvocationStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "WaitpointKind" AS ENUM ('options', 'plan', 'credit', 'media');

-- CreateEnum
CREATE TYPE "WaitpointStatus" AS ENUM ('open', 'approved', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "AttachmentSource" AS ENUM ('direct_upload', 'media_library');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('image', 'video', 'audio');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "monthlyUploadBytes" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT,
    "toolInvocationId" TEXT,
    "kind" "LedgerKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "settlementKey" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New chat',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "favorited" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "activeRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "runId" TEXT,
    "role" "MessageRole" NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'success',
    "blocks" JSONB NOT NULL,
    "clientIdempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userMessageId" TEXT NOT NULL,
    "assistantMessageId" TEXT,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'queued',
    "modelRequested" TEXT NOT NULL,
    "modelRouted" TEXT,
    "dispatchKey" TEXT NOT NULL,
    "triggerRunId" TEXT,
    "sessionSnapshot" JSONB,
    "errorCode" TEXT,
    "errorSafeMessage" TEXT,
    "admissionReserved" INTEGER NOT NULL DEFAULT 0,
    "creditsSettled" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolInvocation" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "provider" "ToolProvider" NOT NULL,
    "providerRunId" TEXT,
    "status" "ToolInvocationStatus" NOT NULL DEFAULT 'pending',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "errorSafeMessage" TEXT,
    "creditCost" INTEGER NOT NULL DEFAULT 0,
    "completionKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "ToolInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunSkill" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "skillName" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "assetPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Waitpoint" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" "WaitpointKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WaitpointStatus" NOT NULL DEFAULT 'open',
    "resumeKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Waitpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT,
    "messageId" TEXT,
    "source" "AttachmentSource" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "assemblyId" TEXT,
    "assemblyStatus" TEXT,
    "mimeType" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "originalName" TEXT NOT NULL,
    "resultUrl" TEXT,
    "durableUrl" TEXT,
    "checksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedAsset" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "toolInvocationId" TEXT,
    "kind" "AssetKind" NOT NULL,
    "url" TEXT NOT NULL,
    "durableUrl" TEXT,
    "mimeType" TEXT,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditAccount_userId_key" ON "CreditAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedger_settlementKey_key" ON "CreditLedger"("settlementKey");

-- CreateIndex
CREATE INDEX "CreditLedger_userId_createdAt_idx" ON "CreditLedger"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Chat_activeRunId_key" ON "Chat"("activeRunId");

-- CreateIndex
CREATE INDEX "Chat_userId_updatedAt_id_idx" ON "Chat"("userId", "updatedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Chat_userId_favorited_updatedAt_id_idx" ON "Chat"("userId", "favorited", "updatedAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Message_chatId_clientIdempotencyKey_key" ON "Message"("chatId", "clientIdempotencyKey");

-- CreateIndex
CREATE INDEX "Message_chatId_createdAt_id_idx" ON "Message"("chatId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_dispatchKey_key" ON "AgentRun"("dispatchKey");

-- CreateIndex
CREATE INDEX "AgentRun_chatId_createdAt_idx" ON "AgentRun"("chatId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_one_active_per_chat" ON "AgentRun"("chatId") WHERE status IN ('queued', 'thinking', 'working', 'waiting', 'stopping');

-- CreateIndex
CREATE UNIQUE INDEX "ToolInvocation_completionKey_key" ON "ToolInvocation"("completionKey");

-- CreateIndex
CREATE UNIQUE INDEX "RunSkill_runId_skillName_assetPath_key" ON "RunSkill"("runId", "skillName", "assetPath");

-- CreateIndex
CREATE UNIQUE INDEX "Waitpoint_token_key" ON "Waitpoint"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Waitpoint_resumeKey_key" ON "Waitpoint"("resumeKey");

-- CreateIndex
CREATE INDEX "Attachment_chatId_sortOrder_idx" ON "Attachment"("chatId", "sortOrder");

-- AddForeignKey
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_activeRunId_fkey" FOREIGN KEY ("activeRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolInvocation" ADD CONSTRAINT "ToolInvocation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunSkill" ADD CONSTRAINT "RunSkill_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waitpoint" ADD CONSTRAINT "Waitpoint_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedAsset" ADD CONSTRAINT "GeneratedAsset_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedAsset" ADD CONSTRAINT "GeneratedAsset_toolInvocationId_fkey" FOREIGN KEY ("toolInvocationId") REFERENCES "ToolInvocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
