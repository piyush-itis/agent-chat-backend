import { chatCompletionsRequestSchema } from "@/contracts/api";
import { requireApiKey } from "@/lib/api-keys";
import { corsHeaders } from "@/lib/cors";
import { errorResponse, jsonOk } from "@/lib/errors";
import { assertRateLimit } from "@/lib/rate-limit";
import { sendChatCompletion } from "@/lib/turns";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  try {
    const user = await requireApiKey(request);
    assertRateLimit(user.id);
    const body = chatCompletionsRequestSchema.parse(await request.json());
    return jsonOk(await sendChatCompletion(user.id, body), 202);
  } catch (error) {
    return errorResponse(error);
  }
}
