"use client";
// SP2 background runner: while the app is open and insight recommendations are
// opted in, this hook proposes an AI recommendation for a bounded number of
// active/acknowledged insights that don't already have one. Mirrors
// use-scheduled-job-runner.ts EXACTLY (refs for a stable tick, `[]`-dep effect,
// mount + visibilitychange + interval, overlap guard) — the caller wires
// insights/ai/context builders and owns the persisted setInsights writer; this
// hook owns no state. Recommendations are billed calls, so the cadence is
// longer (15 min, vs scheduled jobs' 5 min) and a global limit/auth failure
// stops the tick early rather than burning through remaining candidates.
import { useEffect, useRef } from "react";
import { runInsightRecommendation } from "./insights/recommend-call";
import { AiHttpError, classifyAiError } from "./ai-errors";
import { MAX_BG_RECS_PER_TICK, type Insight, type InsightRecommendation } from "./insights/insight";
import type { GroundingIndex } from "./action-ai";

const TICK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export interface InsightRecommendRunnerArgs {
  /** Caller passes isAiEnabled && ai.insightRecommendations===true && !isPopout. */
  enabled: boolean;
  insights: readonly Insight[];
  ai: { apiKey: string; model: string };
  today: string;
  /** Closes over the live workspace. */
  buildIndex: () => GroundingIndex;
  buildContextFor: (insight: Insight) => string;
  /** Functional setInsights writer (Task 9 provides). */
  applyRecommendation: (id: number, rec: InsightRecommendation) => void;
  /** Injectable for tests; default () => new Date(). */
  now?: () => Date;
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
  const nowRef = useRef(args.now);
  useEffect(() => { enabledRef.current = args.enabled; }, [args.enabled]);
  useEffect(() => { insightsRef.current = args.insights; }, [args.insights]);
  useEffect(() => { aiRef.current = args.ai; }, [args.ai]);
  useEffect(() => { todayRef.current = args.today; }, [args.today]);
  useEffect(() => { buildIndexRef.current = args.buildIndex; }, [args.buildIndex]);
  useEffect(() => { buildContextForRef.current = args.buildContextFor; }, [args.buildContextFor]);
  useEffect(() => { applyRecommendationRef.current = args.applyRecommendation; }, [args.applyRecommendation]);
  useEffect(() => { nowRef.current = args.now; }, [args.now]);

  // Overlap guard: skip a tick while a previous async run is still in flight.
  const isRunningRef = useRef(false);

  useEffect(() => {
    const tick = async () => {
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
            if (rec) applyRecommendationRef.current(insight.id, rec);
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
    };

    // Fire on mount.
    void tick();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const interval = setInterval(() => { void tick(); }, TICK_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearInterval(interval);
    };
  }, []);
}
