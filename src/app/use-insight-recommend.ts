"use client";
// SP2 on-demand recommendation: a per-insight "Generate recommendation" button.
// One bounded forced-tool Anthropic call via runInsightRecommendation; the
// result is applied through the caller's functional setInsights writer (Task 9
// provides it). Unlike use-action-analysis.ts's single `busy` flag, callers here
// need to know WHICH insight is generating (multiple rows can each show their
// own button/spinner), so this hook keeps a `generatingId` instead.
import { useCallback, useEffect, useRef, useState } from "react";
import { runInsightRecommendation } from "./insights/recommend-call";
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
  generatingId: number | null;
  generate: (insightId: number) => Promise<void>;
}

export function useInsightRecommend(args: UseInsightRecommendArgs): UseInsightRecommendResult {
  const [generatingId, setGeneratingId] = useState<number | null>(null);

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
      const rec = await runInsightRecommendation({
        apiKey: current.ai.apiKey,
        model: current.ai.model,
        context: current.buildContextFor(insight),
        index: current.buildIndex(),
        today: current.today,
      });
      if (rec) current.applyRecommendation(insightId, rec);
    } catch (e) {
      // NEVER log/echo the api key or response body — classify + surface only.
      current.onError?.(e instanceof AiHttpError ? classifyAiError(e.status, e.errorType) : "generic");
    } finally {
      setGeneratingId(null);
    }
  }, []);

  return { generatingId, generate };
}
