"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildBiasMap,
  normalizeLearningSnapshot,
  recordOutcome,
  type LearningOverride,
  type LearningOverrides,
  type LearningState,
  type OutcomeType,
} from "./action-learning";
import { EMPTY_SNAPSHOT, pickLearningStore, type LearningSnapshot, type LearningStore } from "./learning-store";
import { logDiag } from "./diagnostics";
import type { SuggestedAction } from "./next-actions/types";
import { learningKindOf } from "./next-actions/learning-kind";
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

/**
 * Capture hook for the Action Center learning layer. Loads a learning snapshot
 * via pickLearningStore, records outcomes (no-op when disabled or in a popout),
 * exposes a memoized bias map + overrides + reset, and persists every mutation.
 */
/** A failed load is retried a few times, with a growing delay (as `useScheduledJobs`
 *  retries its read), and again on the next write once those run out (§781). */
export const LEARNING_LOAD_RETRY_MS = 5_000;
const MAX_LOAD_RETRIES = 3;

/** A learning write, kept as a function so it can replay on top of a late load (§781). */
type Mutation = (s: LearningSnapshot) => LearningSnapshot;

export function useActionLearning({
  config,
  tursoConfig,
  isPopout,
}: UseActionLearningArgs): UseActionLearningResult {
  const [snap, setSnap] = useState<LearningSnapshot>(EMPTY_SNAPSHOT);
  // Decay is time-dependent, but Date.now() is banned inside useMemo (engine-purity
  // lint). We capture "now" inside the load/persist callbacks (where it is allowed)
  // and feed it to the memo as a plain dep, so the bias map stays a pure derivation.
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Ref mirrors keep callbacks/effects reading the latest values without widening
  // their dep arrays. These mirror effects MUST stay declared before the
  // consuming effects/callbacks: React runs effects in declaration order, so the
  // refs are refreshed before anything reads them (see use-action-notifications).
  const snapRef = useRef(snap);
  const argsRef = useRef({ config, tursoConfig, isPopout });
  // §781 — where the mount load stands. Until it resolves, every write is applied
  // to the in-memory snapshot (so the view and bias react at once) AND queued; the
  // load then replays the queue on top of what it read and saves that ONCE. A
  // write used to mark the hook "dirty", the late load was DROPPED, and the save
  // carried only the new write — on Turso a full rewrite of the GLOBAL
  // `action_learning` table (`tursoLearningStore.save`), so one early snooze wiped
  // every stored row. A FAILED load leaves the hook pending: nothing is saved
  // while the store cannot be read (a full rewrite would replace rows it never
  // read), the writes wait in memory and in the queue, and the load is retried —
  // `MAX_LOAD_RETRIES` times on a timer, then again on the next write — until one
  // succeeds and saves them on top of the stored rows.
  const loadStateRef = useRef<"pending" | "loaded">("pending");
  const queueRef = useRef<Mutation[]>([]);
  const loadInFlightRef = useRef(false);
  const retriesRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveRef = useRef(true);
  // The retry timer calls the latest `attemptLoad` through this ref.
  const attemptLoadRef = useRef<() => void>(() => {});
  // Serializes saves so two rapid persists cannot land out-of-order on the async
  // Turso store (a slower older write reverting a newer outcome).
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    snapRef.current = snap;
  });
  useEffect(() => {
    argsRef.current = { config, tursoConfig, isPopout };
  });

  const enqueueSave = useCallback((store: LearningStore, next: LearningSnapshot) => {
    // Chain saves so they run in enqueue order — the last record's snapshot is
    // the last write even if an earlier (slower) save is still in flight.
    saveChainRef.current = saveChainRef.current.then(() => store.save(next)).catch(() => {});
  }, []);

  const attemptLoad = useCallback(() => {
    if (loadStateRef.current === "loaded" || loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    // ★ The queued writes are saved to the store they were LOADED from, so a store
    //   switch during the load cannot write one store's rows into another.
    const store = pickLearningStore(argsRef.current.config, argsRef.current.tursoConfig);
    store
      .load()
      .then((s) => {
        loadInFlightRef.current = false;
        // §778 — rows and overrides stored under a count-variant kind merge
        // into the canonical one here; the next save writes them merged.
        const queued = queueRef.current;
        queueRef.current = [];
        loadStateRef.current = "loaded";
        const next = queued.reduce((acc, m) => m(acc), normalizeLearningSnapshot(s));
        // Saved even after an unmount: the queued writes are the user's, and
        // `next` already holds every stored row.
        if (queued.length > 0) enqueueSave(store, next);
        if (liveRef.current) {
          snapRef.current = next;
          setSnap(next);
          setNowTick(Date.now());
        }
      })
      .catch(() => {
        // Keep the in-memory snapshot and the queue; save nothing until a load works.
        loadInFlightRef.current = false;
        logDiag("warn", "learning.loadFailedSavesHeld", { retry: retriesRef.current });
        if (!liveRef.current || retriesRef.current >= MAX_LOAD_RETRIES) return;
        retriesRef.current += 1;
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          attemptLoadRef.current();
        }, LEARNING_LOAD_RETRY_MS * retriesRef.current);
      });
  }, [enqueueSave]);
  useEffect(() => {
    attemptLoadRef.current = attemptLoad;
  });

  // Load the persisted snapshot on mount (retried on failure, see above).
  useEffect(() => {
    liveRef.current = true;
    attemptLoadRef.current();
    return () => {
      liveRef.current = false;
      if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    };
  }, []);

  // Pure derivation of the bias map — no Date.now() here (it would trip the
  // engine-purity lint); the timestamp arrives via nowTick.
  const bias = useMemo(
    () => (config.enabled ? buildBiasMap(snap.state, snap.overrides, nowTick) : {}),
    [snap, config.enabled, nowTick],
  );

  const apply = useCallback((m: Mutation) => {
    const next = m(snapRef.current);
    // Update the ref synchronously so consecutive mutations within one tick
    // (before React flushes the mirror effect) build on each other.
    snapRef.current = next;
    setSnap(next);
    setNowTick(Date.now());
    if (loadStateRef.current === "pending") {
      queueRef.current.push(m);
      // Retries used up and none scheduled: this write starts a fresh round.
      if (retryTimerRef.current === null && !loadInFlightRef.current && retriesRef.current >= MAX_LOAD_RETRIES) {
        retriesRef.current = 0;
        attemptLoadRef.current();
      }
      return;
    }
    enqueueSave(pickLearningStore(argsRef.current.config, argsRef.current.tursoConfig), next);
  }, [enqueueSave]);

  const record = useCallback(
    async (action: SuggestedAction, type: OutcomeType) => {
      if (!argsRef.current.config.enabled || argsRef.current.isPopout) return;
      // §502 — a simulated signal never teaches the learning layer (it is not measured).
      if (action.source === "forecast-sim") return;
      // `now` is captured here, at the outcome, not when a queued write replays.
      const kind = learningKindOf(action);
      const now = Date.now();
      apply((s) => ({ ...s, state: recordOutcome(s.state, kind, type, now) }));
    },
    [apply],
  );

  const setOverride = useCallback(
    async (kind: string, override: LearningOverride) => {
      apply((s) => ({ ...s, overrides: { ...s.overrides, [kind]: override } }));
    },
    [apply],
  );

  const reset = useCallback(async () => {
    apply(() => ({ state: {}, overrides: {} }));
  }, [apply]);

  return { bias, state: snap.state, overrides: snap.overrides, record, setOverride, reset };
}
