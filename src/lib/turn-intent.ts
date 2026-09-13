import type { ContentBlock } from "@/contracts/blocks";
import type { SessionSnapshot } from "@/contracts/api";

const MAGICA_TOOLS = new Set(["gpt_image_2", "crop_image", "merge_videos"]);

const GENERATE_VERB =
  /\b(generate|imagine|draw|illustrate|render|paint|design)\b/i;
const CREATE_VISUAL =
  /\b(create|make|craft)\b[\s\S]{0,40}\b(image|picture|photo|logo|poster|illustration|artwork|thumbnail|banner|icon|wallpaper|wordmark|graphic)\b/i;
const VISUAL_NOUN =
  /\b(image|picture|photo|logo|poster|illustration|artwork|thumbnail|banner|icon|wallpaper|wordmark)\b/i;
const CROP_HINT = /\b(crop|uncrop)\b/i;
const MERGE_HINT =
  /\b(merge|stitch|combine|join|concatenat)\b[\s\S]{0,40}\b(videos?|clips?|reels?)\b|\b(videos?|clips?|reels?)\b[\s\S]{0,40}\b(merge|stitch|combine|join)\b/i;
const RATIO_HINT = /\b(1:1|9:16|16:9|4:5)\b/;
const FOLLOW_UP =
  /\b(crop|merge|again|regenerate|retry|square|portrait|landscape|story|reel)\b|\b(do it again|one more|another one|same but)\b|\b(1:1|9:16|16:9|4:5)\b/i;

export type MagicaIntentInput = {
  userText: string;
  thisTurnAttachmentCount: number;
  snapshot: SessionSnapshot;
  hadRecentMagicaWork?: boolean;
};

export function looksLikeMagicaTask(text: string): boolean {
  const compact = text.trim();
  if (!compact) return false;
  return (
    GENERATE_VERB.test(compact) ||
    CREATE_VISUAL.test(compact) ||
    VISUAL_NOUN.test(compact) ||
    CROP_HINT.test(compact) ||
    MERGE_HINT.test(compact) ||
    RATIO_HINT.test(compact)
  );
}

export function looksLikeMagicaFollowUp(text: string): boolean {
  return FOLLOW_UP.test(text.trim());
}

export function hadSuccessfulMagicaWork(
  messages: { role: string; blocks: ContentBlock[] }[],
): boolean {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      message.blocks.some(
        (block) =>
          block.type === "tool_result" &&
          MAGICA_TOOLS.has(block.toolName) &&
          block.status === "success",
      ),
  );
}

export function needsMagicaTools(input: MagicaIntentInput): boolean {
  const { userText, thisTurnAttachmentCount, snapshot, hadRecentMagicaWork } = input;
  if (snapshot.planMode) return true;
  if (snapshot.pendingToolCalls?.length) return true;
  if (snapshot.pendingPhase) return true;
  if (thisTurnAttachmentCount > 0) return true;
  if (looksLikeMagicaTask(userText)) return true;
  if (hadRecentMagicaWork && looksLikeMagicaFollowUp(userText)) return true;
  return false;
}
