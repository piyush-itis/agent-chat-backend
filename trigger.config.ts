import { additionalFiles } from "@trigger.dev/build/extensions/core";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";
import type { TriggerConfig } from "@trigger.dev/sdk/v3";

export const config: TriggerConfig = {
  project: process.env.TRIGGER_PROJECT_REF || "proj_galaxy_chat",
  dirs: ["./src/trigger"],
  maxDuration: 3600,
  build: {
    extensions: [
      prismaExtension({
        mode: "legacy",
        schema: "prisma/schema.prisma",
        version: "6.16.3",
      }),
      additionalFiles({ files: ["./agent-skills/**"] }),
    ],
  },
};
