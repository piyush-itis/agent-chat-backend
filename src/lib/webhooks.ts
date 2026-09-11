import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";

export const WEBHOOK_EVENTS = [
  "agent.started",
  "agent.completed",
  "agent.failed",
  "tool.completed",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function signWebhookBody(secret: string, timestamp: string, rawBody: string): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `sha256=${digest}`;
}

export function verifyWebhookSignature(input: {
  secret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
}): boolean {
  const expected = signWebhookBody(input.secret, input.timestamp, input.rawBody);
  const left = Buffer.from(expected);
  const right = Buffer.from(input.signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function emitWebhook(
  userId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { userId, disabledAt: null },
  });
  const matching = endpoints.filter(
    (endpoint) => endpoint.events.length === 0 || endpoint.events.includes(event),
  );
  if (matching.length === 0) return;

  const eventId = randomUUID();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = {
    id: eventId,
    event,
    createdAt: new Date().toISOString(),
    data,
  };
  const rawBody = JSON.stringify(payload);

  for (const endpoint of matching) {
    await deliverOnce({
      endpointId: endpoint.id,
      url: endpoint.url,
      secret: endpoint.secret,
      eventId: `${eventId}:${endpoint.id}`,
      event,
      payload,
      rawBody,
      timestamp,
    });
  }
}

async function deliverOnce(input: {
  endpointId: string;
  url: string;
  secret: string;
  eventId: string;
  event: string;
  payload: Record<string, unknown>;
  rawBody: string;
  timestamp: string;
}) {
  const existing = await prisma.webhookDelivery.findUnique({ where: { eventId: input.eventId } });
  if (existing?.status === "delivered") return;

  const delivery =
    existing ??
    (await prisma.webhookEndpoint
      .findUnique({ where: { id: input.endpointId } })
      .then(() =>
        prisma.webhookDelivery.create({
          data: {
            endpointId: input.endpointId,
            eventId: input.eventId,
            event: input.event,
            payload: input.payload as Prisma.InputJsonValue,
          },
        }),
      ));

  const maxAttempts = 4;
  let lastError: string | null = null;
  let attempts = delivery?.attempts ?? 0;

  for (let i = 0; i < maxAttempts; i += 1) {
    attempts += 1;
    try {
      const signature = signWebhookBody(input.secret, input.timestamp, input.rawBody);
      const response = await fetch(input.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Galaxy-Timestamp": input.timestamp,
          "X-Galaxy-Signature": signature,
          "X-Galaxy-Event": input.event,
          "X-Galaxy-Event-Id": input.eventId,
        },
        body: input.rawBody,
      });
      if (response.ok) {
        await prisma.webhookDelivery.update({
          where: { eventId: input.eventId },
          data: { status: "delivered", attempts, deliveredAt: new Date(), lastError: null },
        });
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Delivery failed";
    }
    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** i));
    }
  }

  await prisma.webhookDelivery.update({
    where: { eventId: input.eventId },
    data: { status: "failed", attempts, lastError },
  });
}
