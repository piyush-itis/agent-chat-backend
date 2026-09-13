import { requireUser } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { errorResponse, jsonOk } from "@/lib/errors";
import { listAttachments } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const chatId = new URL(request.url).searchParams.get("chatId") ?? undefined;
    const items = await listAttachments(user.id, chatId);
    return jsonOk({
      items: items.map((item) => ({
        id: item.id,
        mimeType: item.mimeType,
        originalName: item.originalName,
        resultUrl: item.resultUrl,
        durableUrl: item.durableUrl,
        sortOrder: item.sortOrder,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
