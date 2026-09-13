import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const monorepoRoot = path.join(__dirname, "..");
const isMonorepo = existsSync(path.join(monorepoRoot, "pnpm-workspace.yaml"));

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "prisma"],
  ...(isMonorepo
    ? {
        outputFileTracingRoot: monorepoRoot,
        turbopack: { root: monorepoRoot },
      }
    : {}),
};

export default nextConfig;
