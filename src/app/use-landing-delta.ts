import { useEffect, useState } from "react";
import { computeDelta, type DeltaResult, type LandingState, type RagScope } from "./dashboard-delta";
import { computeMetricTrends, type MetricKey, type MetricTrend } from "./dashboard-trends";
import { loadLandingState, saveLandingState } from "./landing-state";
import { loadActivityLog } from "./activity-log";
import type { Health } from "./health";
import type { Task } from "./types";

/** Delay before the visit advances the stored snapshot, so the strip stays
 *  readable on the current visit and the next visit diffs from "now". */
const ADVANCE_DELAY_MS = 4000;

function snapshotRag(rag: Record<RagScope, Health | null>): LandingState["rag"] {
  const out: NonNullable<LandingState["rag"]> = {};
  (Object.keys(rag) as RagScope[]).forEach((k) => {
    const v = rag[k];
    if (v) out[k] = v;
  });
  return out;
}

export interface LandingDelta {
  delta: DeltaResult;
  trends: Record<MetricKey, MetricTrend>;
}

export function useLandingDelta(args: {
  projectId: string;
  currentRag: Record<RagScope, Health | null>;
  currentMetrics: Record<MetricKey, number>;
  overdue: readonly Task[];
  today: string;
  isPopout: boolean;
}): LandingDelta {
  const { projectId, currentRag, currentMetrics, overdue, today, isPopout } = args;

  // Capture the delta + KPI trends ONCE at mount from the PRIOR snapshot — before
  // advancing. Lazy initializer keeps loadLandingState/loadActivityLog out of the
  // render body and avoids set-state-in-effect.
  const [result] = useState<LandingDelta>(() => {
    const prior = loadLandingState(projectId);
    return {
      delta: computeDelta({ prior, activity: loadActivityLog(), currentRag, overdue, today }),
      trends: computeMetricTrends(prior.metrics, currentMetrics),
    };
  });

  // Debounced advance — side-effect-only write to localStorage (no setState).
  // `new Date()` lives in the timeout callback, never the render body. Popouts
  // are read-only and must not mutate device state.
  useEffect(() => {
    if (isPopout) return;
    const id = window.setTimeout(() => {
      saveLandingState(projectId, {
        lastVisitAt: new Date().toISOString(),
        rag: snapshotRag(currentRag),
        metrics: currentMetrics,
      });
    }, ADVANCE_DELAY_MS);
    return () => window.clearTimeout(id);
    // Intentionally mount-only: the delta + advance reflect the visit at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return result;
}
