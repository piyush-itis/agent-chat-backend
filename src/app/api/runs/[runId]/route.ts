import { requireUser } from "@/lib/auth";
import { requireOwnedChat } from "@/lib/chats";
import { corsHeaders } from "@/lib/cors";
import { prisma } from "@/lib/db";
import { errorResponse, jsonError, jsonOk } from "@/lib/errors";
import { loadRunView } from "@/lib/runs";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    const user = await requireUser(request);
    const { runId } = await context.params;
    const run = await prisma.agentRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw jsonError(404, "NOT_FOUND", "Run not found");
    }
    await requireOwnedChat(user.id, run.chatId);
    const view = await loadRunView(runId);
    return jsonOk(view);
  } catch (error) {
    return errorResponse(error);
  }
}
