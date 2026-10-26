// §701 — the five single-request AI calls wired in the second batch append the
// action's guide text after their fixed system prompt, and send exactly what
// they sent before when there is none. The request body is read off `fetch`, so
// this checks what reaches Anthropic, not what the call was handed.
import "../test/ai-consent-live";
import { describe, it, expect, vi, afterEach } from "vitest";
import { runDigestNarrative } from "./digest/digest-narrative";
import type { DigestModel } from "./digest/digest-model";
import { runInsightRecommendation } from "./insights/recommend-call";
import { runJobAnalysis } from "./scheduled-job-analysis";
import { runDedupProposal } from "./task-dedup-call";
import { runWeightSuggestion } from "./weight-suggestion-call";
import { defaultNextActionsConfig } from "./settings-types";
import { buildRecommendSystemPrompt } from "./insights/recommend-context";
import { buildAnalysisSystemPrompt } from "./action-ai";
import { buildDedupSystemPrompt } from "./task-dedup/dedup";
import { buildSuggestionSystemPrompt } from "./weight-suggestion-ai";

afterEach(() => vi.restoreAllMocks());

const GUIDE = "GUIDE-TEXT-701";
const AI = { apiKey: "sk-ant-k", model: "claude-x" };

const DIGEST: DigestModel = {
  rag: "A", ragPrev: null, overdue: { count: 1, delta: null }, milestonesDueSoon: [],
  openRaid: { count: 0, high: 0, delta: null }, generatedAt: "2026-10-12",
};

/** Each call, run with the given guide text. A parse failure after the request
 *  is irrelevant here (the fetch mock returns no tool output), so it is swallowed. */
const CALLS: Record<string, (guideText: string | undefined) => Promise<unknown>> = {
  digest: (guideText) => runDigestNarrative(DIGEST, { ...AI, lang: "en-US", guideText }),
  insightRecommend: (guideText) =>
    runInsightRecommendation({ ...AI, context: "ctx", index: {} as never, today: "2026-10-12", guideText }),
  jobAnalysis: (guideText) => runJobAnalysis("ctx", { ...AI, guideText }),
  dedup: (guideText) => runDedupProposal("ctx", { ...AI, guideText }),
  weights: (guideText) => runWeightSuggestion("ctx", { ...AI, guideText }, defaultNextActionsConfig, "weights"),
};

/** What each call sent before §701: its fixed prompt (the digest sends none). */
const BASE: Record<string, () => string | undefined> = {
  digest: () => undefined,
  insightRecommend: buildRecommendSystemPrompt,
  jobAnalysis: buildAnalysisSystemPrompt,
  dedup: buildDedupSystemPrompt,
  weights: buildSuggestionSystemPrompt,
};

async function sentSystem(run: () => Promise<unknown>): Promise<unknown> {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    { ok: true, json: async () => ({ content: [] }) } as unknown as Response,
  );
  await run().catch(() => undefined);
  expect(spy).toHaveBeenCalledTimes(1);
  const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string) as { system?: unknown };
  spy.mockRestore();
  return body.system;
}

describe.each(Object.keys(CALLS))("%s call — operating guides (§701)", (name) => {
  const run = CALLS[name];

  it("appends the guide text after the fixed system prompt", async () => {
    const before = await sentSystem(() => run(undefined));
    const withGuide = await sentSystem(() => run(GUIDE));
    // The guides ride their own block after the fixed prompt, with no cache
    // marker: these calls are single requests unless a runner asks for one.
    const guideBlock = { type: "text", text: GUIDE };
    expect(withGuide).toEqual(before === undefined ? [guideBlock] : [{ type: "text", text: before }, guideBlock]);
  });

  it("sends the same system prompt as before for absent or empty guide text", async () => {
    const base = BASE[name]();
    expect(await sentSystem(() => run(undefined))).toEqual(base);
    expect(await sentSystem(() => run(""))).toEqual(base);
  });
});

// The two batching runners ask for the cache marker; their calls must forward it.
describe("cacheGuides is forwarded by the batching calls (§701)", () => {
  const marked = { type: "text", text: GUIDE, cache_control: { type: "ephemeral" } };
  it("runJobAnalysis", async () => {
    const sent = await sentSystem(() => runJobAnalysis("ctx", { ...AI, guideText: GUIDE, cacheGuides: true }));
    expect((sent as unknown[]).at(-1)).toEqual(marked);
  });
  it("runInsightRecommendation", async () => {
    const sent = await sentSystem(() =>
      runInsightRecommendation({ ...AI, context: "ctx", index: {} as never, today: "2026-10-12", guideText: GUIDE, cacheGuides: true }),
    );
    expect((sent as unknown[]).at(-1)).toEqual(marked);
  });
});
