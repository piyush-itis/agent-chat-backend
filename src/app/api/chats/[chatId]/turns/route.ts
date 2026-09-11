import { sendTurnRequestSchema } from "@/contracts/api";
import { requireUser } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { errorResponse, jsonOk } from "@/lib/errors";
import { assertRateLimit } from "@/lib/rate-limit";
import { sendTurn } from "@/lib/turns";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  try {
    const user = await requireUser(request);
    const { chatId } = await context.params;
    assertRateLimit(user.id);
    const body = sendTurnRequestSchema.parse(await request.json());
    const result = await sendTurn(user.id, chatId, body);
    return jsonOk(result, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
