import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createApiKey, listApiKeys } from "@/lib/api-keys";
import { corsHeaders } from "@/lib/cors";
import { errorResponse, jsonOk } from "@/lib/errors";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80).default("Default"),
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return jsonOk({ items: await listApiKeys(user.id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = createSchema.parse(await request.json().catch(() => ({ name: "Default" })));
    return jsonOk(await createApiKey(user.id, body.name), 201);
  } catch (error) {
    return errorResponse(error);
  }
}
