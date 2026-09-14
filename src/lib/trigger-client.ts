import { configure } from "@trigger.dev/sdk/v3";

/**
 * Trigger 4.x sends `x-trigger-branch` from `VERCEL_GIT_COMMIT_REF`.
 * On Vercel production that is `main`, which is not a preview branch env
 * and makes `tasks.trigger` fail with "No matching branch env".
 */
export function triggerPreviewBranch() {
  if (process.env.TRIGGER_PREVIEW_BRANCH) return process.env.TRIGGER_PREVIEW_BRANCH;
  if (process.env.VERCEL_ENV === "production") return "";
  return undefined;
}

export function configureTriggerClient() {
  const previewBranch = triggerPreviewBranch();
  if (previewBranch === undefined) return;
  configure({ previewBranch });
}
