"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildBiasMap,
  recordOutcome,
  type LearningOverride,
  type LearningOverrides,
  type LearningState,
  type OutcomeType,
} from "./action-learning";
import { EMPTY_SNAPSHOT, pickLearningStore, type LearningSnapshot } from "./learning-store";
import type { SuggestedAction } from "./next-actions/types";
import type { NextActionsLearningConfig } from "./settings-types";
import type { TursoConfig } from "./turso-config";

interface UseActionLearningArgs {
  config: NextActionsLearningConfig;
  tursoConfig: TursoConfig | null;
  isPopout: boolean;
}

interface UseActionLearningResult {
  bias: Record<string, number>;
  state: LearningState;
  overrides: LearningOverrides;
  record(action: SuggestedAction, type: OutcomeType): Promise<void>;
  setOverride(kind: string, override: LearningOverride): Promise<void>;
  reset(): Promise<void>;
}

const kindOf = (a: SuggestedAction): string => `${a.source}:${a.why.key}`;

/**
 * Capture hook for the Action Center learning layer. Loads a learning snapshot
 * via pickLearningStore, records outcomes (no-op when disabled or in a popout),
 * exposes a memoized bias map + overrides + reset, and persists every mutation.
 */
export function useActionLearning({
  config,
  tursoConfig,
  isPopout,
}: UseActionLearningArgs): UseActionLearningResult {
  const [snap, setSnap] = useState<LearningSnapshot>(EMPTY_SNAPSHOT);
  // Decay is time-dependent, but Date.now() is banned inside useMemo (engine-purity
  // lint). We capture "now" inside the load/persist callbacks (where it is allowed)
  // and feed it to the memo as a plain dep, so the bias map stays a pure derivation.
  const [nowTick, setNowTick] = useState(0);

  // Ref mirrors keep callbacks/effects reading the latest values without widening
  // their dep arrays. These mirror effects MUST stay declared before the
  // consuming effects/callbacks: React runs effects in declaration order, so the
  // refs are refreshed before anything reads them (see use-action-notifications).
  const snapRef = useRef(snap);
  const argsRef = useRef({ config, tursoConfig, isPopout });
  // Guards a late mount-load promise from clobbering an outcome recorded before
  // the load resolved (load() is async even for the synchronous local store).
  const dirtyRef = useRef(false);
  useEffect(() => {
    snapRef.current = snap;
  });
  useEffect(() => {
    argsRef.current = { config, tursoConfig, isPopout };
  });

  // Load the persisted snapshot once on mount.
  useEffect(() => {
    let live = true;
    pickLearningStore(argsRef.current.config, argsRef.current.tursoConfig)
      .load()
      .then((s) => {
        if (live && !dirtyRef.current) {
          setSnap(s);
          setNowTick(Date.now());
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Pure derivation of the bias map — no Date.now() here (it would trip the
  // engine-purity lint); the timestamp arrives via nowTick.
  const bias = useMemo(
    () => (config.enabled ? buildBiasMap(snap.state, snap.overrides, nowTick) : {}),
    [snap, config.enabled, nowTick],
  );

  const persist = useCallback((next: LearningSnapshot) => {
    dirtyRef.current = true;
    // Update the ref synchronously so consecutive mutations within one tick
    // (before React flushes the mirror effect) build on each other.
    snapRef.current = next;
    setSnap(next);
    setNowTick(Date.now());
    pickLearningStore(argsRef.current.config, argsRef.current.tursoConfig)
      .save(next)
      .catch(() => {});
  }, []);

  const record = useCallback(
    async (action: SuggestedAction, type: OutcomeType) => {
      if (!argsRef.current.config.enabled || argsRef.current.isPopout) return;
      persist({
        ...snapRef.current,
        state: recordOutcome(snapRef.current.state, kindOf(action), type, Date.now()),
      });
    },
    [persist],
  );

  const setOverride = useCallback(
    async (kind: string, override: LearningOverride) => {
      persist({
        ...snapRef.current,
        overrides: { ...snapRef.current.overrides, [kind]: override },
      });
    },
    [persist],
  );

  const reset = useCallback(async () => {
    persist({ state: {}, overrides: {} });
  }, [persist]);

  return { bias, state: snap.state, overrides: snap.overrides, record, setOverride, reset };
}
