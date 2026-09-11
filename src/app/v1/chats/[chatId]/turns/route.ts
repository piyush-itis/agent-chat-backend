import { sendTurnRequestSchema } from "@/contracts/api";
import { requireApiKey } from "@/lib/api-keys";
import { corsHeaders } from "@/lib/cors";
import { errorResponse, jsonOk } from "@/lib/errors";
import { assertRateLimit } from "@/lib/rate-limit";
import { sendTurn } from "@/lib/turns";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  try {
    const user = await requireApiKey(request);
    const { chatId } = await context.params;
    assertRateLimit(user.id);
    const body = sendTurnRequestSchema.parse(await request.json());
    return jsonOk(await sendTurn(user.id, chatId, body), 202);
  } catch (error) {
    return errorResponse(error);
  }
}
