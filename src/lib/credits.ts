import { prisma } from "./db";
import { jsonError } from "./errors";

export function creditsFromTokens(promptTokens: number, completionTokens: number): number {
  return Math.max(0, Math.round(promptTokens + completionTokens));
}

export async function settleModelCharge(input: {
  userId: string;
  runId: string;
  amount: number;
}): Promise<void> {
  if (input.amount <= 0) return;
  const key = `model_charge:${input.runId}`;
  try {
    await prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUnique({ where: { userId: input.userId } });
      if (!account || account.balance < input.amount) {
        throw jsonError(402, "INSUFFICIENT_CREDITS", "Not enough credits to settle this response");
      }
      await tx.creditAccount.update({
        where: { userId: input.userId },
        data: { balance: { decrement: input.amount } },
      });
      await tx.creditLedger.create({
        data: {
          userId: input.userId,
          runId: input.runId,
          kind: "model_charge",
          amount: -input.amount,
          settlementKey: key,
          note: "OpenRouter token usage",
        },
      });
      await tx.agentRun.update({
        where: { id: input.runId },
        data: { creditsSettled: { increment: input.amount } },
      });
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return;
    }
    throw error;
  }
}

export async function settleToolCharge(input: {
  userId: string;
  runId: string;
  invocationId: string;
  amount: number;
}): Promise<void> {
  if (input.amount <= 0) return;
  const key = `tool_charge:${input.invocationId}`;
  try {
    await prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUnique({ where: { userId: input.userId } });
      if (!account || account.balance < input.amount) {
        throw jsonError(402, "INSUFFICIENT_CREDITS", "Not enough credits to settle this tool");
      }
      await tx.creditAccount.update({
        where: { userId: input.userId },
        data: { balance: { decrement: input.amount } },
      });
      await tx.creditLedger.create({
        data: {
          userId: input.userId,
          runId: input.runId,
          toolInvocationId: input.invocationId,
          kind: "tool_charge",
          amount: -input.amount,
          settlementKey: key,
          note: "Magica tool charge",
        },
      });
      await tx.agentRun.update({
        where: { id: input.runId },
        data: { creditsSettled: { increment: input.amount } },
      });
      await tx.toolInvocation.update({
        where: { id: input.invocationId },
        data: { creditCost: input.amount },
      });
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return;
    }
    throw error;
  }
}

export async function hasCredits(userId: string, amount: number): Promise<boolean> {
  const account = await prisma.creditAccount.findUnique({ where: { userId } });
  return Boolean(account && account.balance >= amount);
}
