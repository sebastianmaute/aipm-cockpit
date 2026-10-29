import { vi, test, expect, beforeEach, describe } from "vitest";
import { runInsightRecommendation } from "./recommend-call";
import { buildGroundingIndex } from "../action-ai";

const WHOLE = vi.hoisted(() => ({ summary: "reschedule 12", calls: [{ name: "update_task", input: { id: 12, dueDate: "2026-08-01" } }] }));
// One mocked request per reply; `runForcedToolCallWithRetry` keeps its contract over it (one retry at the
// larger budget when a reply is cut — ai-forced-call.test.ts pins the real one), so these tests see every
// request the caller makes.
vi.mock("../ai-forced-call", () => {
  type Args = { maxTokens: number };
  type Reply = { input: Record<string, unknown>; stopReason: string | undefined };
  const runForcedToolCallWithStop = vi.fn<(args: Args) => Promise<Reply>>(async () => ({ input: WHOLE, stopReason: "tool_use" }));
  const runForcedToolCallWithRetry = vi.fn(async (args: Args, retryMaxTokens: number) => {
    const first = await runForcedToolCallWithStop(args);
    return first.stopReason === "max_tokens" ? runForcedToolCallWithStop({ ...args, maxTokens: retryMaxTokens }) : first;
  });
  return { runForcedToolCallWithStop, runForcedToolCallWithRetry };
});

beforeEach(() => vi.clearAllMocks());

test("returns a grounded recommendation stamped with today", async () => {
  const index = buildGroundingIndex({ tasks: [{ id: 12 }], raid: [], milestones: [], changes: [], stakeholders: [] });
  const out = await runInsightRecommendation({ apiKey: "sk-ant-x", model: "claude-x", context: "ctx", index, today: "2026-07-20" });
  expect(out?.generatedAt).toBe("2026-07-20");
  expect(out?.proposedCalls).toHaveLength(1);
});

test("throws parse when nothing grounds", async () => {
  const mod = await import("../ai-forced-call");
  vi.mocked(mod.runForcedToolCallWithStop).mockResolvedValueOnce({ input: { summary: "x", calls: [{ name: "update_task", input: { id: 777 } }] }, stopReason: "tool_use" });
  const index = buildGroundingIndex({ tasks: [], raid: [], milestones: [], changes: [], stakeholders: [] });
  await expect(runInsightRecommendation({ apiKey: "k", model: "m", context: "c", index, today: "2026-07-20" })).rejects.toThrow("parse");
});

// §763 — under auto tool choice the model thinks on the same output budget, and a reply cut at it may
// carry `{}` or only the first calls. A cut reply is never read: it is asked for once more with 8192.
describe("runInsightRecommendation output budget (§763)", () => {
  const index = buildGroundingIndex({ tasks: [{ id: 12 }], raid: [], milestones: [], changes: [], stakeholders: [] });
  const args = { apiKey: "k", model: "m", context: "c", index, today: "2026-07-20" };
  const withStop = async () => vi.mocked((await import("../ai-forced-call")).runForcedToolCallWithStop);
  const budgets = (m: { mock: { calls: unknown[][] } }) => m.mock.calls.map((c) => (c[0] as { maxTokens: number }).maxTokens);

  test("asks for 4096 tokens and reads a reply that was not cut", async () => {
    const m = await withStop();
    await expect(runInsightRecommendation(args)).resolves.toMatchObject({ summary: "reschedule 12" });
    expect(budgets(m)).toEqual([4096]);
  });

  test("asks once more with 8192 tokens when the reply was cut, and returns that answer", async () => {
    const m = await withStop();
    m.mockResolvedValueOnce({ input: {}, stopReason: "max_tokens" });
    await expect(runInsightRecommendation(args)).resolves.toMatchObject({ summary: "reschedule 12" });
    expect(budgets(m)).toEqual([4096, 8192]);
  });

  test("never reads a cut reply, even when it grounds; a cut retry is the parse error", async () => {
    const m = await withStop();
    m.mockResolvedValueOnce({ input: WHOLE, stopReason: "max_tokens" }).mockResolvedValueOnce({ input: WHOLE, stopReason: "max_tokens" });
    await expect(runInsightRecommendation(args)).rejects.toThrow("parse");
    expect(budgets(m)).toEqual([4096, 8192]);
  });

  // AI-01 — the background runner's `level` reaches every forced call, the retry included; a click passes none.
  test("passes the caller's consent level to the call and to the retry", async () => {
    const m = await withStop();
    m.mockResolvedValueOnce({ input: {}, stopReason: "max_tokens" });
    await runInsightRecommendation({ ...args, level: "background" });
    expect(m.mock.calls.map((c) => (c[0] as { level?: string }).level)).toEqual(["background", "background"]);
    m.mockClear();
    await runInsightRecommendation(args);
    expect(m.mock.calls.map((c) => (c[0] as { level?: string }).level)).toEqual([undefined]);
  });

  test("passes the caller's signal to the retry too", async () => {
    const m = await withStop();
    const controller = new AbortController();
    m.mockResolvedValueOnce({ input: {}, stopReason: "max_tokens" });
    await runInsightRecommendation({ ...args, signal: controller.signal });
    expect(m.mock.calls.map((c) => (c[0] as { signal?: AbortSignal }).signal)).toEqual([controller.signal, controller.signal]);
  });
});
