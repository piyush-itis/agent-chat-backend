import { requireUser } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { prisma } from "@/lib/db";
import { errorResponse, jsonError, jsonOk } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ endpointId: string }> },
) {
  try {
    const user = await requireUser(request);
    const { endpointId } = await context.params;
    const endpoint = await prisma.webhookEndpoint.findFirst({
      where: { id: endpointId, userId: user.id },
    });
    if (!endpoint) throw jsonError(404, "NOT_FOUND", "Webhook not found");
    await prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: { disabledAt: new Date() },
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
