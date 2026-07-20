"use client";
// SP2 background runner: while the app is open and insight recommendations are
// opted in, this hook proposes an AI recommendation for a bounded number of
// active/acknowledged insights that don't already have one. Mirrors
// use-scheduled-job-runner.ts closely (refs for a stable tick, mount +
// visibilitychange + interval, overlap guard) — the caller wires
// insights/ai/context builders and owns the persisted setInsights writer; this
// hook owns no state. Recommendations are billed calls, so the cadence is
// longer than scheduled jobs' 5 min and is USER-SETTABLE (SP4: default 60 min,
// clamped to [15, 1440] here), and a global limit/auth failure stops the tick
// early rather than burning through remaining candidates.
import { useEffect, useRef } from "react";
import { runInsightRecommendation } from "./insights/recommend-call";
import { AiHttpError, classifyAiError } from "./ai-errors";
import { clampInsightRecInterval } from "./settings-types";
import { MAX_BG_RECS_PER_TICK, type Insight, type InsightRecommendation } from "./insights/insight";
import type { GroundingIndex } from "./action-ai";

export interface InsightRecommendRunnerArgs {
  /** Caller passes isAiEnabled && ai.insightRecommendations===true && !isPopout. */
  enabled: boolean;
  insights: readonly Insight[];
  ai: { apiKey: string; model: string };
  today: string;
  /** Cadence in minutes. Re-clamped here — this hook drives BILLED calls, so it
   *  never trusts a caller-supplied rate. */
  intervalMinutes: number;
  /** Closes over the live workspace. */
  buildIndex: () => GroundingIndex;
  buildContextFor: (insight: Insight) => string;
  /** Functional setInsights writer (Task 9 provides). */
  applyRecommendation: (id: number, rec: InsightRecommendation) => void;
}

export function useInsightRecommendRunner(args: InsightRecommendRunnerArgs): void {
  // Mirror every arg into a ref so the tick callback can stay stable (no deps
  // that change each render) and the listener/interval subscribe exactly once.
  const enabledRef = useRef(args.enabled);
  const insightsRef = useRef(args.insights);
  const aiRef = useRef(args.ai);
  const todayRef = useRef(args.today);
  const buildIndexRef = useRef(args.buildIndex);
  const buildContextForRef = useRef(args.buildContextFor);
  const applyRecommendationRef = useRef(args.applyRecommendation);
  useEffect(() => { enabledRef.current = args.enabled; }, [args.enabled]);
  useEffect(() => { insightsRef.current = args.insights; }, [args.insights]);
  useEffect(() => { aiRef.current = args.ai; }, [args.ai]);
  useEffect(() => { todayRef.current = args.today; }, [args.today]);
  useEffect(() => { buildIndexRef.current = args.buildIndex; }, [args.buildIndex]);
  useEffect(() => { buildContextForRef.current = args.buildContextFor; }, [args.buildContextFor]);
  useEffect(() => { applyRecommendationRef.current = args.applyRecommendation; }, [args.applyRecommendation]);

  // Overlap guard: skip a tick while a previous async run is still in flight.
  const isRunningRef = useRef(false);

  // The cadence is a hoisted SCALAR local: react-hooks/exhaustive-deps REJECTS
  // an `args.intervalMinutes` member expression in a dep array.
  const intervalMs = clampInsightRecInterval(args.intervalMinutes) * 60_000;

  // The tick body lives in a ref so BOTH effects below can reach it without
  // taking it as a dep (which would re-arm/re-fire on every render). useRef
  // keeps only the FIRST closure — which stays correct forever because the body
  // reads nothing but refs. (Assigning tickRef.current during render instead
  // would trip the react-hooks purity rule.)
  const tickRef = useRef(async (): Promise<void> => {
    if (!enabledRef.current) return;
    if (isRunningRef.current) return; // a run is already in flight

    const candidates = insightsRef.current
      .filter(
        (insight) =>
          (insight.status === "active" || insight.status === "acknowledged") && !insight.recommendation,
      )
      .slice(0, MAX_BG_RECS_PER_TICK);
    if (candidates.length === 0) return;

    isRunningRef.current = true;
    try {
      // Serial, not parallel — bounded by MAX_BG_RECS_PER_TICK candidates, and
      // a global failure (usage limit / auth) should stop the whole tick
      // rather than fire N more calls that will fail the same way.
      for (const insight of candidates) {
        try {
          const rec = await runInsightRecommendation({
            apiKey: aiRef.current.apiKey,
            model: aiRef.current.model,
            context: buildContextForRef.current(insight),
            index: buildIndexRef.current(),
            today: todayRef.current,
          });
          applyRecommendationRef.current(insight.id, rec);
        } catch (e) {
          // NEVER log/echo the api key or response body. A limit/auth failure
          // is global (every remaining call this tick would fail the same
          // way) — stop burning budget. Any other failure (parse/network/
          // one-off) is swallowed so the next candidate still gets a try.
          if (e instanceof AiHttpError) {
            const cls = classifyAiError(e.status, e.errorType);
            if (cls === "limit" || cls === "auth") break;
          }
        }
      }
    } finally {
      isRunningRef.current = false;
    }
  });

  // ★★ TWO SEPARATE EFFECTS ON PURPOSE — do NOT merge them back.
  // Every tick can make BILLED Anthropic calls. The mount tick + listener must
  // fire exactly ONCE per hook lifetime, while the interval must RE-ARM when the
  // user changes the cadence. Folding the interval into the `[]` effect would
  // leave a stale rate armed until reload; adding `[intervalMs]` to the effect
  // that also fires the mount tick would spend an EXTRA BILLED ROUND on every
  // settings change.
  useEffect(() => {
    void tickRef.current();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void tickRef.current();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // Cadence only: re-arms cleanly on a settings change, fires no extra tick.
  useEffect(() => {
    const interval = setInterval(() => { void tickRef.current(); }, intervalMs);
    return () => { clearInterval(interval); };
  }, [intervalMs]);
}
