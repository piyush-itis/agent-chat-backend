import { resumeWaitpointRequestSchema } from "@/contracts/api";
import { requireUser } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { errorResponse, jsonOk } from "@/lib/errors";
import { resumeWaitpoint } from "@/lib/waitpoints";
import { loadRunView } from "@/lib/runs";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string; token: string }> },
) {
  try {
    const user = await requireUser(request);
    const { runId, token } = await context.params;
    const body = resumeWaitpointRequestSchema.parse(await request.json());
    await resumeWaitpoint(user.id, runId, token, body);
    return jsonOk(await loadRunView(runId));
  } catch (error) {
    return errorResponse(error);
  }
}
