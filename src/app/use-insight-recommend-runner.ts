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

  // ★ One controller per TICK (not per candidate) — unmount must stop every
  //   remaining candidate this tick, not just the one in flight at that
  //   instant. See the mount-effect cleanup below for the abort() call.
  const abortRef = useRef<AbortController | null>(null);

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

    const controller = new AbortController();
    abortRef.current = controller;
    isRunningRef.current = true;
    try {
      // Serial, not parallel — bounded by MAX_BG_RECS_PER_TICK candidates, and
      // a global failure (usage limit / auth) should stop the whole tick
      // rather than fire N more calls that will fail the same way. An abort
      // (unmount mid-tick) is the same kind of global stop — checked before
      // starting a candidate AND after one settles, so neither a call that
      // never gets issued nor one that resolves in the same tick the abort
      // landed can slip past.
      for (const insight of candidates) {
        if (controller.signal.aborted) break;
        try {
          const rec = await runInsightRecommendation({
            apiKey: aiRef.current.apiKey,
            model: aiRef.current.model,
            context: buildContextForRef.current(insight),
            index: buildIndexRef.current(),
            today: todayRef.current,
            signal: controller.signal,
          });
          if (controller.signal.aborted) break;
          applyRecommendationRef.current(insight.id, rec);
        } catch (e) {
          // NEVER log/echo the api key or response body. An abort (unmount)
          // stops the whole tick — the promise's rejection is expected, not a
          // failure to classify. A limit/auth failure is likewise global
          // (every remaining call this tick would fail the same way) — stop
          // burning budget. Any OTHER failure (parse/network/one-off) is
          // swallowed so the next candidate still gets a try.
          if (controller.signal.aborted) break;
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

  // ★★★ REGRESSION (§120): navigating away did not stop up to
  //    MAX_BG_RECS_PER_TICK billed calls already in flight. `[]` deps —
  //    unmount-only, like the mount effect above. Deliberately NOT folded
  //    into either effect above: the mount effect's `[]` cleanup would work
  //    too, but the interval effect's `[intervalMs]` cleanup re-runs on every
  //    cadence change and would abort legitimate in-flight work on a settings
  //    edit, not just on unmount.
  //
  // ★★ DEV-ONLY SIDE EFFECT — do NOT report §120 as broken from a dev session.
  //    App Router runs StrictMode by default here (no `reactStrictMode` in
  //    next.config.ts), so under `next dev` the mount commit runs effects →
  //    cleanup → effects: this cleanup aborts the mount tick's controller, and
  //    the re-run then returns early on `isRunningRef` (lowered only in the
  //    tick's `finally`, a later microtask). Net: no recommendations on mount
  //    under `npm run dev`. Production no-ops StrictMode, so shipped users are
  //    unaffected — which is why this is filed rather than fixed. An identity
  //    guard cannot be added HERE (empty effect body, no controller captured;
  //    and at a simulated unmount the mount tick's controller IS the current
  //    one). See docs/open-followups.md §310 for the minimal fix if dev parity
  //    is ever wanted.
  useEffect(() => () => abortRef.current?.abort(), []);
}
