import { createChatRequestSchema } from "@/contracts/api";
import { requireUser } from "@/lib/auth";
import { createChat, listChats } from "@/lib/chats";
import { corsHeaders } from "@/lib/cors";
import { errorResponse, jsonOk } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const data = await listChats(user.id, url.searchParams.get("cursor"), url.searchParams.get("q"));
    return jsonOk(data);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = createChatRequestSchema.parse(await request.json().catch(() => ({})));
    const chat = await createChat(user.id, body.title);
    return jsonOk(chat, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
