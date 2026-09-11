import { z } from "zod";
import { requireApiKey } from "@/lib/api-keys";
import { corsHeaders } from "@/lib/cors";
import { errorResponse, jsonError, jsonOk } from "@/lib/errors";
import { runPublicTool } from "@/lib/public-tools";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  chatId: z.string().optional(),
  input: z.record(z.string(), z.unknown()),
});

const tools = new Set(["crop_image", "gpt_image_2", "merge_videos"]);

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ toolName: string }> },
) {
  try {
    const user = await requireApiKey(request);
    const { toolName } = await context.params;
    if (!tools.has(toolName)) {
      throw jsonError(404, "NOT_FOUND", "Tool not found");
    }
    const body = bodySchema.parse(await request.json());
    const result = await runPublicTool(
      user.id,
      toolName as "crop_image" | "gpt_image_2" | "merge_videos",
      body.input,
      body.chatId,
    );
    return jsonOk(result, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
