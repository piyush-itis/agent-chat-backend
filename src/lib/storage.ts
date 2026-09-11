import { createHash, createHmac, randomUUID } from "node:crypto";

export function s3Configured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT &&
      process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY,
  );
}

export async function copyToDurableStorage(
  sourceUrl: string,
  keyHint?: string,
): Promise<string> {
  if (!sourceUrl) return sourceUrl;
  if (!s3Configured()) return sourceUrl;

  const response = await fetch(sourceUrl);
  if (!response.ok) return sourceUrl;
  const bytes = Buffer.from(await response.arrayBuffer());
  const key = keyHint ?? `${new Date().toISOString().slice(0, 10)}/${randomUUID()}`;
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const uploaded = await putObject(key, bytes, contentType);
  return uploaded ?? sourceUrl;
}

async function putObject(key: string, body: Buffer, contentType: string): Promise<string | null> {
  const endpoint = process.env.S3_ENDPOINT!.replace(/\/$/, "");
  const bucket = process.env.S3_BUCKET!;
  const region = process.env.S3_REGION || "auto";
  const accessKey = process.env.S3_ACCESS_KEY_ID!;
  const secretKey = process.env.S3_SECRET_ACCESS_KEY!;
  const url = new URL(`${endpoint}/${bucket}/${key}`);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(body).digest("hex");
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ].join("\n");
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    url.pathname,
    "",
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), "s3"),
    "aws4_request",
  );
  const signature = hmac(signingKey, stringToSign, "hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const put = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: authorization,
    },
    body: new Uint8Array(body),
  });
  if (!put.ok) return null;
  return url.toString();
}

function hmac(key: string | Buffer, value: string): Buffer;
function hmac(key: string | Buffer, value: string, encoding: "hex"): string;
function hmac(key: string | Buffer, value: string, encoding?: "hex"): Buffer | string {
  const digest = createHmac("sha256", key).update(value);
  return encoding ? digest.digest(encoding) : digest.digest();
}
