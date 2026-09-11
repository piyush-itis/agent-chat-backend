import { createClerkClient, verifyToken } from "@clerk/backend";
import { LIMITS } from "@/contracts/limits";
import { prisma } from "./db";
import { jsonError } from "./errors";

export type AppUser = {
  id: string;
  clerkUserId: string;
  email: string | null;
};

export async function requireUser(request: Request): Promise<AppUser> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) {
    throw jsonError(500, "CONFIG", "CLERK_SECRET_KEY is not set");
  }

  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    throw jsonError(401, "UNAUTHORIZED", "Missing bearer token");
  }

  let clerkUserId: string;
  try {
    const payload = await verifyToken(token, { secretKey: secret });
    clerkUserId = payload.sub;
  } catch {
    throw jsonError(401, "UNAUTHORIZED", "Invalid session");
  }

  const existing = await prisma.user.findUnique({
    where: { clerkUserId },
  });
  if (existing) {
    return { id: existing.id, clerkUserId: existing.clerkUserId, email: existing.email };
  }

  const clerk = createClerkClient({ secretKey: secret });
  const clerkUser = await clerk.users.getUser(clerkUserId);
  const email = clerkUser.emailAddresses[0]?.emailAddress ?? null;

  const created = await prisma.user.create({
    data: {
      clerkUserId,
      email,
      creditAccount: {
        create: { balance: LIMITS.initialGrant },
      },
      ledger: {
        create: {
          kind: "grant",
          amount: LIMITS.initialGrant,
          settlementKey: `grant:${clerkUserId}:initial`,
          note: "Initial credit grant",
        },
      },
    },
  });

  return { id: created.id, clerkUserId: created.clerkUserId, email: created.email };
}
