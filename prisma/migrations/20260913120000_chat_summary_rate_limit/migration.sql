ALTER TABLE "Chat" ADD COLUMN "summary" TEXT;

CREATE TABLE "RateLimitBucket" (
    "userId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("userId")
);
