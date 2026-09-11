import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { errorResponse, jsonOk } from "@/lib/errors";
import { jsonError } from "@/lib/errors";
import { ALLOWED_MIME, assertUploadQuota, signAssembly } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  mimeType: z.string(),
  byteSize: z.number().int().positive(),
  originalName: z.string().min(1).max(255),
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = bodySchema.parse(await request.json());
    if (!ALLOWED_MIME.includes(body.mimeType)) {
      throw jsonError(400, "VALIDATION", `Unsupported MIME type: ${body.mimeType}`);
    }
    await assertUploadQuota(user.id, body.byteSize);
    return jsonOk(signAssembly(body));
  } catch (error) {
    return errorResponse(error);
  }
}
