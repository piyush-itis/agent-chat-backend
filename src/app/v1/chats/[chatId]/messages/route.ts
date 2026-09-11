import { requireApiKey } from "@/lib/api-keys";
import { listMessages } from "@/lib/chats";
import { corsHeaders } from "@/lib/cors";
import { errorResponse, jsonOk } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  try {
    const user = await requireApiKey(request);
    const { chatId } = await context.params;
    const url = new URL(request.url);
    return jsonOk(await listMessages(user.id, chatId, url.searchParams.get("cursor")));
  } catch (error) {
    return errorResponse(error);
  }
}
