import { describe, expect, it } from "vitest";
import { signWebhookBody, verifyWebhookSignature } from "./webhooks";

describe("webhooks", () => {
  it("signs and verifies HMAC-SHA256 over timestamp + body", () => {
    const secret = "whsec_test";
    const timestamp = "1710000000";
    const rawBody = JSON.stringify({ id: "evt_1", event: "agent.completed" });
    const signature = signWebhookBody(secret, timestamp, rawBody);
    expect(signature.startsWith("sha256=")).toBe(true);
    expect(verifyWebhookSignature({ secret, timestamp, rawBody, signature })).toBe(true);
    expect(
      verifyWebhookSignature({ secret, timestamp, rawBody: "{}", signature }),
    ).toBe(false);
  });

  it("produces a stable digest for the same event id payload", () => {
    const first = signWebhookBody("s", "1", `{"id":"evt"}`);
    const second = signWebhookBody("s", "1", `{"id":"evt"}`);
    expect(first).toBe(second);
  });
});
