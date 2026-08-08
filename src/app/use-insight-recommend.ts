"use client";
// SP2 on-demand recommendation: a per-insight "Generate recommendation" button.
// One bounded forced-tool Anthropic call via runInsightRecommendation; the
// result is applied through the caller's functional setInsights writer (Task 9
// provides it). Unlike use-action-analysis.ts's single `busy` flag, callers here
// need to know WHICH insight is generating (multiple rows can each show their
// own button/spinner), so this hook keeps a `generatingId` instead.
import { useCallback, useEffect, useRef, useState } from "react";
import { runInsightRecommendation } from "./insights/recommend-call";
import { useAbortableAi } from "./use-abortable-ai";
import { isAbortError } from "./abort-error";
import { AiHttpError, classifyAiError, type AiErrorClass } from "./ai-errors";
import type { Insight, InsightRecommendation } from "./insights/insight";
import type { GroundingIndex } from "./action-ai";

export interface UseInsightRecommendArgs {
  insights: readonly Insight[];
  ai: { apiKey: string; model: string };
  today: string;
  buildIndex: () => GroundingIndex;
  buildContextFor: (insight: Insight) => string;
  applyRecommendation: (id: number, rec: InsightRecommendation) => void;
  isPopout?: boolean;
  /** Caller surfaces the toast for a failed generate. */
  onError?: (kind: AiErrorClass) => void;
}

export interface UseInsightRecommendResult {
  /** WHICH insight is generating — multiple rows each show their own spinner. */
  generatingId: number | null;
  /** The GLOBAL in-flight flag, for the shared AiTriggerButton's Stop state. */
  busy: boolean;
  generate: (insightId: number) => Promise<void>;
  /** Aborts the in-flight generate. A stop is not a failure: nothing is toasted. */
  cancel: () => void;
}

export function useInsightRecommend(args: UseInsightRecommendArgs): UseInsightRecommendResult {
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  // This was the ONE of six AI trigger sites with no AbortController.
  // runInsightRecommendation already accepted a signal, so this threads one
  // rather than adding a call path. The five that already own a controller are
  // deliberately left alone (see use-abortable-ai.ts).
  const { busy, run, cancel } = useAbortableAi();

  // Mirrored into a ref after every commit (refs can't be written during
  // render — react-hooks/refs) so `generate` stays a single stable callback
  // that always reads the LIVE props, even though the caller re-renders with
  // fresh insights/handlers on every insight edit.
  const argsRef = useRef(args);
  useEffect(() => { argsRef.current = args; });

  const generate = useCallback(async (insightId: number): Promise<void> => {
    const current = argsRef.current;
    if (current.isPopout) return;
    const insight = current.insights.find((i) => i.id === insightId);
    if (!insight) return;

    setGeneratingId(insightId);
    try {
      const rec = await run(async (signal) => {
        try {
          return await runInsightRecommendation({
            apiKey: current.ai.apiKey,
            model: current.ai.model,
            context: current.buildContextFor(insight),
            index: current.buildIndex(),
            today: current.today,
            signal,
          });
        } catch (e) {
          // A user-initiated stop is NOT a failure — rethrow it untouched so
          // run() swallows it and no toast fires. Everything else keeps the
          // classified toast this hook has always surfaced; classification
          // lives here because run() only carries a message string.
          // NEVER log/echo the api key or response body — classify + surface only.
          if (!isAbortError(e)) {
            current.onError?.(e instanceof AiHttpError ? classifyAiError(e.status, e.errorType) : "generic");
          }
          throw e;
        }
      });
      if (rec == null) return; // aborted, or an error already surfaced above
      current.applyRecommendation(insightId, rec);
    } finally {
      // Functional, and guarded on OUR id: a superseded generate settles AFTER
      // its successor set the spinner, so an unconditional clear would blank
      // the row that is still working.
      setGeneratingId((cur) => (cur === insightId ? null : cur));
    }
  }, [run]);

  return { generatingId, busy, generate, cancel };
}
