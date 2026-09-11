import { requireUser } from "@/lib/auth";
import { requireOwnedChat } from "@/lib/chats";
import { corsHeaders } from "@/lib/cors";
import { prisma } from "@/lib/db";
import { errorResponse, jsonError } from "@/lib/errors";
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
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = async () => {
          const run = await prisma.agentRun.findUnique({ where: { id: runId } });
          if (!run) throw jsonError(404, "NOT_FOUND", "Run not found");
          await requireOwnedChat(user.id, run.chatId);
          const view = await loadRunView(runId);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(view)}\n\n`));
          return run.status;
        };

        try {
          let status = await send();
          while (["queued", "thinking", "working", "waiting", "stopping"].includes(status)) {
            await new Promise((resolve) => setTimeout(resolve, 800));
            status = await send();
          }
        } catch (error) {
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ message: String(error) })}\n\n`),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders(),
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
