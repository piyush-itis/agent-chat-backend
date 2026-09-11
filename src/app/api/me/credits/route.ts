import { requireUser } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { prisma } from "@/lib/db";
import { errorResponse, jsonOk } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const account = await prisma.creditAccount.findUnique({ where: { userId: user.id } });
    return jsonOk({ balance: account?.balance ?? 0 });
  } catch (error) {
    return errorResponse(error);
  }
}
