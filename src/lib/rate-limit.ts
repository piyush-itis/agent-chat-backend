import { LIMITS } from "@/contracts/limits";
import { jsonError } from "./errors";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function assertRateLimit(userId: string): void {
  const now = Date.now();
  const current = buckets.get(userId);
  if (!current || current.resetAt <= now) {
    buckets.set(userId, { count: 1, resetAt: now + 60_000 });
    return;
  }
  if (current.count >= LIMITS.rateLimitPerMinute) {
    throw jsonError(429, "RATE_LIMITED", "Too many sends. Try again in a minute.");
  }
  current.count += 1;
}
