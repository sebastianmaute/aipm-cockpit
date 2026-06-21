import { useEffect, useState } from "react";
import { computeDelta, type DeltaResult, type LandingState, type RagScope } from "./dashboard-delta";
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

export function useLandingDelta(args: {
  projectId: string;
  currentRag: Record<RagScope, Health | null>;
  overdue: readonly Task[];
  today: string;
  isPopout: boolean;
}): DeltaResult {
  const { projectId, currentRag, overdue, today, isPopout } = args;

  // Capture the delta ONCE at mount from the PRIOR snapshot — before advancing.
  // Lazy initializer keeps loadLandingState/loadActivityLog out of the render body
  // and avoids set-state-in-effect.
  const [delta] = useState<DeltaResult>(() =>
    computeDelta({ prior: loadLandingState(projectId), activity: loadActivityLog(), currentRag, overdue, today }),
  );

  // Debounced advance — side-effect-only write to localStorage (no setState).
  // `new Date()` lives in the timeout callback, never the render body. Popouts
  // are read-only and must not mutate device state.
  useEffect(() => {
    if (isPopout) return;
    const id = window.setTimeout(() => {
      saveLandingState(projectId, { lastVisitAt: new Date().toISOString(), rag: snapshotRag(currentRag) });
    }, ADVANCE_DELAY_MS);
    return () => window.clearTimeout(id);
    // Intentionally mount-only: the delta + advance reflect the visit at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return delta;
}
