import { PrismaClient } from "@prisma/client";

/** Bump when Prisma enums/schema change so the dev global client is recreated. */
const PRISMA_CLIENT_REV = 4;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaRev?: number;
};

if (globalForPrisma.prisma && globalForPrisma.prismaRev !== PRISMA_CLIENT_REV) {
  void globalForPrisma.prisma.$disconnect();
  globalForPrisma.prisma = undefined;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaRev = PRISMA_CLIENT_REV;
}
