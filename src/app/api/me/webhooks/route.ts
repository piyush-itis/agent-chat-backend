import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";
import { corsHeaders } from "@/lib/cors";
import { prisma } from "@/lib/db";
import { errorResponse, jsonOk } from "@/lib/errors";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).optional(),
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const items = await prisma.webhookEndpoint.findMany({
      where: { userId: user.id, disabledAt: null },
      orderBy: { createdAt: "desc" },
    });
    return jsonOk({
      items: items.map((item) => ({
        id: item.id,
        url: item.url,
        events: item.events,
        createdAt: item.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = createSchema.parse(await request.json());
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    const created = await prisma.webhookEndpoint.create({
      data: {
        userId: user.id,
        url: body.url,
        secret,
        events: body.events ?? [...WEBHOOK_EVENTS],
      },
    });
    return jsonOk(
      {
        id: created.id,
        url: created.url,
        events: created.events,
        secret,
        createdAt: created.createdAt.toISOString(),
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
