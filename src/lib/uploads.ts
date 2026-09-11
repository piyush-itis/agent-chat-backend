import { createHmac } from "node:crypto";
import { prisma } from "./db";
import { jsonError } from "./errors";
import { requireOwnedChat } from "./chats";
import { copyToDurableStorage } from "./storage";

export const MAX_FILE_BYTES = Math.floor(0.5 * 1024 * 1024 * 1024);
export const MAX_MONTHLY_BYTES = 5 * 1024 * 1024 * 1024;
export const MAX_ATTACHMENTS = 8;
export const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
];

export function signAssembly(input: { mimeType: string; byteSize: number; originalName: string }) {
  const key = process.env.TRANSLOADIT_KEY;
  const secret = process.env.TRANSLOADIT_SECRET;
  if (!key || !secret) {
    throw jsonError(500, "CONFIG", "TRANSLOADIT_KEY or TRANSLOADIT_SECRET is not set");
  }
  if (!ALLOWED_MIME.includes(input.mimeType)) {
    throw jsonError(400, "VALIDATION", `Unsupported MIME type: ${input.mimeType}`);
  }
  if (input.byteSize > MAX_FILE_BYTES) {
    throw jsonError(400, "VALIDATION", "File exceeds the 0.5 GB Community-plan cap");
  }
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const params = JSON.stringify({
    auth: { key, expires },
    template_id: process.env.TRANSLOADIT_TEMPLATE_ID || undefined,
    steps: {
      ":original": { robot: "/upload/handle" },
    },
  });
  const signature = `sha384:${createHmac("sha384", secret).update(params).digest("hex")}`;
  return { params, signature, expires };
}

export async function assertUploadQuota(userId: string, byteSize: number) {
  const account = await prisma.creditAccount.findUnique({ where: { userId } });
  const used = account ? Number(account.monthlyUploadBytes) : 0;
  if (used + byteSize > MAX_MONTHLY_BYTES) {
    throw jsonError(429, "QUOTA", "Monthly 5 GB Transloadit Community allowance is exhausted");
  }
}

export async function completeUpload(input: {
  userId: string;
  chatId?: string;
  assemblyId: string;
  mimeType: string;
  byteSize: number;
  originalName: string;
  resultUrl?: string;
  sortOrder?: number;
}) {
  if (!ALLOWED_MIME.includes(input.mimeType)) {
    throw jsonError(400, "VALIDATION", "Unsupported MIME type");
  }
  await assertUploadQuota(input.userId, input.byteSize);
  if (input.chatId) {
    await requireOwnedChat(input.userId, input.chatId);
  }

  const existing = await prisma.attachment.findFirst({
    where: { userId: input.userId, assemblyId: input.assemblyId },
  });
  if (existing) return existing;

  const durableUrl = input.resultUrl
    ? await copyToDurableStorage(input.resultUrl, `uploads/${input.userId}/${input.assemblyId}`)
    : input.resultUrl;

  const attachment = await prisma.attachment.create({
    data: {
      userId: input.userId,
      chatId: input.chatId,
      source: "direct_upload",
      sortOrder: input.sortOrder ?? 0,
      assemblyId: input.assemblyId,
      assemblyStatus: "completed",
      mimeType: input.mimeType,
      byteSize: BigInt(input.byteSize),
      originalName: input.originalName,
      resultUrl: input.resultUrl,
      durableUrl,
    },
  });

  await prisma.creditAccount.update({
    where: { userId: input.userId },
    data: { monthlyUploadBytes: { increment: BigInt(input.byteSize) } },
  });

  return attachment;
}
