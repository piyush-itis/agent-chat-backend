import { patchChatRequestSchema } from "@/contracts/api";
import { requireUser } from "@/lib/auth";
import { deleteChat, patchChat, requireOwnedChat } from "@/lib/chats";
import { corsHeaders } from "@/lib/cors";
import { errorResponse, jsonOk } from "@/lib/errors";
import { serializeChat } from "@/lib/serialize";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  try {
    const user = await requireUser(request);
    const { chatId } = await context.params;
    const chat = await requireOwnedChat(user.id, chatId);
    return jsonOk(serializeChat(chat));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  try {
    const user = await requireUser(request);
    const { chatId } = await context.params;
    const body = patchChatRequestSchema.parse(await request.json());
    const chat = await patchChat(user.id, chatId, body);
    return jsonOk(chat);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  try {
    const user = await requireUser(request);
    const { chatId } = await context.params;
    await deleteChat(user.id, chatId);
    return jsonOk({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
