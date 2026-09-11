import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";
import { jsonError } from "./errors";
import type { AppUser } from "./auth";

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function generateApiKeySecret(): { secret: string; prefix: string; hash: string } {
  const secret = `gx_live_${randomBytes(24).toString("base64url")}`;
  return { secret, prefix: secret.slice(0, 16), hash: hashApiKey(secret) };
}

export async function listApiKeys(userId: string) {
  const keys = await prisma.apiKey.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return keys.map((key) => ({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
  }));
}

export async function createApiKey(userId: string, name: string) {
  const generated = generateApiKeySecret();
  const row = await prisma.apiKey.create({
    data: {
      userId,
      name: name.trim() || "Default",
      prefix: generated.prefix,
      hash: generated.hash,
    },
  });
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    secret: generated.secret,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function revokeApiKey(userId: string, keyId: string) {
  const key = await prisma.apiKey.findFirst({ where: { id: keyId, userId } });
  if (!key) throw jsonError(404, "NOT_FOUND", "API key not found");
  await prisma.apiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
  });
}

export async function requireApiKey(request: Request): Promise<AppUser> {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    throw jsonError(401, "UNAUTHORIZED", "Missing bearer token");
  }
  const key = await prisma.apiKey.findUnique({
    where: { hash: hashApiKey(token) },
    include: { user: true },
  });
  if (!key || key.revokedAt) {
    throw jsonError(401, "UNAUTHORIZED", "Invalid API key");
  }
  await prisma.apiKey.update({
    where: { id: key.id },
    data: { lastUsedAt: new Date() },
  });
  return { id: key.user.id, clerkUserId: key.user.clerkUserId, email: key.user.email };
}
