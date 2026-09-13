import type { TriggerConfig } from "@trigger.dev/sdk/v3";

export const config: TriggerConfig = {
  project: process.env.TRIGGER_PROJECT_REF || "proj_galaxy_chat",
  dirs: ["./src/trigger"],
  maxDuration: 3600,
};
