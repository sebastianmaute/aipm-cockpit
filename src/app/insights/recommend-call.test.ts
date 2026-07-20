import { vi, test, expect, beforeEach } from "vitest";
import { runInsightRecommendation } from "./recommend-call";
import { buildGroundingIndex } from "../action-ai";

vi.mock("../ai-forced-call", () => ({
  runForcedToolCall: vi.fn(async () => ({
    summary: "reschedule 12", calls: [{ name: "update_task", input: { id: 12, dueDate: "2026-08-01" } }],
  })),
}));

beforeEach(() => vi.clearAllMocks());

test("returns a grounded recommendation stamped with today", async () => {
  const index = buildGroundingIndex({ tasks: [{ id: 12 }], raid: [], milestones: [], changes: [], stakeholders: [] });
  const out = await runInsightRecommendation({ apiKey: "sk-ant-x", model: "claude-x", context: "ctx", index, today: "2026-07-20" });
  expect(out?.generatedAt).toBe("2026-07-20");
  expect(out?.proposedCalls).toHaveLength(1);
});

test("throws parse when nothing grounds", async () => {
  const mod = await import("../ai-forced-call");
  (mod.runForcedToolCall as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ summary: "x", calls: [{ name: "update_task", input: { id: 777 } }] });
  const index = buildGroundingIndex({ tasks: [], raid: [], milestones: [], changes: [], stakeholders: [] });
  await expect(runInsightRecommendation({ apiKey: "k", model: "m", context: "c", index, today: "2026-07-20" })).rejects.toThrow("parse");
});
