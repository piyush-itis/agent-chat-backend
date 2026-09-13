import { beforeEach, describe, expect, it, vi } from "vitest";

const findRun = vi.fn();
const findMessage = vi.fn();
const transaction = vi.fn();
const emitWebhook = vi.fn();

vi.mock("./db", () => ({
  prisma: {
    agentRun: { findUnique: (...args: unknown[]) => findRun(...args) },
    message: { findUnique: (...args: unknown[]) => findMessage(...args) },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

vi.mock("./webhooks", () => ({
  emitWebhook: (...args: unknown[]) => emitWebhook(...args),
}));

const liveRun = {
  id: "run_1",
  chatId: "chat_1",
  userId: "user_1",
  assistantMessageId: "msg_1",
  status: "working",
  admissionReserved: 10,
  modelRouted: null,
};

describe("finalizeRun", () => {
  beforeEach(() => {
    findRun.mockReset();
    findMessage.mockReset();
    transaction.mockReset();
    emitWebhook.mockReset();
    findMessage.mockResolvedValue({ id: "msg_1", blocks: [] });
    transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const ledgerCreate = vi.fn().mockResolvedValue({});
      const updateMany = vi.fn().mockResolvedValue({ count: 1 });
      const accountUpdate = vi.fn();
      await fn({
        message: { update: vi.fn() },
        creditLedger: { create: ledgerCreate },
        agentRun: { updateMany, update: vi.fn() },
        creditAccount: { update: accountUpdate },
        chat: { update: vi.fn() },
      });
      return { ledgerCreate, updateMany, accountUpdate };
    });
  });

  it("releases admission once when finalize is called twice", async () => {
    findRun.mockResolvedValueOnce(liveRun).mockResolvedValueOnce({ ...liveRun, status: "complete" });
    const { finalizeRun } = await import("./finalize");
    await finalizeRun("run_1", { status: "complete", messageStatus: "success" });
    await finalizeRun("run_1", { status: "complete", messageStatus: "success" });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(emitWebhook).toHaveBeenCalledTimes(1);
  });
});
