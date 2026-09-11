import { createChatRequestSchema } from "@/contracts/api";
import { requireApiKey } from "@/lib/api-keys";
import { createChat, listChats } from "@/lib/chats";
import { corsHeaders } from "@/lib/cors";
import { errorResponse, jsonOk } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  try {
    const user = await requireApiKey(request);
    const url = new URL(request.url);
    return jsonOk(await listChats(user.id, url.searchParams.get("cursor"), url.searchParams.get("q")));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiKey(request);
    const body = createChatRequestSchema.parse(await request.json().catch(() => ({})));
    return jsonOk(await createChat(user.id, body.title), 201);
  } catch (error) {
    return errorResponse(error);
  }
}
