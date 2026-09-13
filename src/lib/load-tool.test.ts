import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const findRun = vi.fn();
const updateRun = vi.fn();

vi.mock("./db", () => ({
  prisma: {
    agentRun: {
      findUnique: (...args: unknown[]) => findRun(...args),
      update: (...args: unknown[]) => updateRun(...args),
    },
  },
}));

describe("executeLoadTool", () => {
  beforeEach(async () => {
    const { registerTool } = await import("./registry");
    registerTool({
      name: "unit_catalog_probe",
      description: "Unit-test catalog tool",
      input: z.object({ ping: z.string() }),
      output: z.object({ pong: z.string() }),
      renderHint: "text",
      exposure: "catalog",
      billable: false,
      estimateCredits: async () => ({ applicationCredits: 0 }),
      execute: async () => ({ pong: "ok" }),
    });
  });

  beforeEach(() => {
    findRun.mockReset();
    updateRun.mockReset();
    findRun.mockResolvedValue({ sessionSnapshot: { version: 1 } });
    updateRun.mockResolvedValue({});
  });

  it("pins a catalog tool on the run snapshot", async () => {
    const { executeLoadTool } = await import("./registry");
    const loaded = await executeLoadTool(
      { runId: "run_1", chatId: "chat_1", userId: "user_1", toolCallId: "call_1" },
      { name: "unit_catalog_probe" },
    );
    expect(loaded.name).toBe("unit_catalog_probe");
    expect(loaded.schema).toMatchObject({ type: "object" });
    expect(updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run_1" },
        data: expect.objectContaining({
          sessionSnapshot: expect.objectContaining({ loadedTools: ["unit_catalog_probe"] }),
        }),
      }),
    );
  });

  it("rejects tools that are not in the catalog", async () => {
    const { executeLoadTool } = await import("./registry");
    const { SkillError } = await import("./skills/registry");
    await expect(
      executeLoadTool(
        { runId: "run_1", chatId: "chat_1", userId: "user_1", toolCallId: "call_1" },
        { name: "crop_image" },
      ),
    ).rejects.toBeInstanceOf(SkillError);
  });
});
