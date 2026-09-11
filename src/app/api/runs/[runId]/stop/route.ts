import { requireUser } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { errorResponse, jsonOk } from "@/lib/errors";
import { requestStop } from "@/lib/waitpoints";
import { loadRunView } from "@/lib/runs";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    const user = await requireUser(request);
    const { runId } = await context.params;
    await requestStop(user.id, runId);
    return jsonOk(await loadRunView(runId));
  } catch (error) {
    return errorResponse(error);
  }
}
