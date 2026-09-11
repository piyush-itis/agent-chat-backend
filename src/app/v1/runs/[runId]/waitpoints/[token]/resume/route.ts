import { resumeWaitpointRequestSchema } from "@/contracts/api";
import { requireApiKey } from "@/lib/api-keys";
import { corsHeaders } from "@/lib/cors";
import { errorResponse, jsonOk } from "@/lib/errors";
import { loadRunView } from "@/lib/runs";
import { resumeWaitpoint } from "@/lib/waitpoints";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string; token: string }> },
) {
  try {
    const user = await requireApiKey(request);
    const { runId, token } = await context.params;
    const body = resumeWaitpointRequestSchema.parse(await request.json());
    await resumeWaitpoint(user.id, runId, token, body);
    return jsonOk(await loadRunView(runId));
  } catch (error) {
    return errorResponse(error);
  }
}
