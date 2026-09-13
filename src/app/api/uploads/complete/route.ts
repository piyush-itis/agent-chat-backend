import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { errorResponse, jsonOk } from "@/lib/errors";
import { completeUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  chatId: z.string().optional(),
  assemblyId: z.string().min(1),
  mimeType: z.string(),
  byteSize: z.number().int().positive(),
  originalName: z.string().min(1),
  resultUrl: z.string().url(),
  assemblyStatus: z.string().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = bodySchema.parse(await request.json());
    const attachment = await completeUpload({ userId: user.id, ...body });
    return jsonOk({
      id: attachment.id,
      mimeType: attachment.mimeType,
      originalName: attachment.originalName,
      resultUrl: attachment.resultUrl,
      durableUrl: attachment.durableUrl,
      sortOrder: attachment.sortOrder,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
