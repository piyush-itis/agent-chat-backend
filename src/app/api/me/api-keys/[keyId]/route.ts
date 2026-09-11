import { requireUser } from "@/lib/auth";
import { revokeApiKey } from "@/lib/api-keys";
import { corsHeaders } from "@/lib/cors";
import { errorResponse, jsonOk } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ keyId: string }> },
) {
  try {
    const user = await requireUser(request);
    const { keyId } = await context.params;
    await revokeApiKey(user.id, keyId);
    return jsonOk({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
