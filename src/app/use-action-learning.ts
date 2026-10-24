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
import {
  EMPTY_SNAPSHOT,
  learningStoreKey,
  pickLearningStore,
  type LearningSnapshot,
  type LearningStore,
} from "./learning-store";
import type { TranslationKey } from "./i18n";
import { logDiag } from "./diagnostics";
import { isRetryableLearningLoadError } from "./storage-transient";
import { tursoErrorKind } from "./storage-error";
import type { SuggestedAction } from "./next-actions/types";
import { learningKindOf } from "./next-actions/learning-kind";
import type { NextActionsLearningConfig } from "./settings-types";
import type { TursoConfig } from "./turso-config";

interface UseActionLearningArgs {
  config: NextActionsLearningConfig;
  tursoConfig: TursoConfig | null;
  isPopout: boolean;
  /** `useSettings`' `hydrated` (settings AND sealed secrets merged). Until it is
   *  true the config is the DEFAULT one, so no store is loaded or saved (§781). */
  hydrated: boolean;
  /** Called once per failure episode, for the caller to toast (guard transparency,
   *  `reportSilentFailure`): "rejected" at once when the Turso token is rejected,
   *  "load" on the first write held by any other failed load, "notReady" on the first
   *  write held while Turso is chosen but not usable, "save" on the first failed save
   *  after a success. */
  onError?: (kind: LearningErrorKind, err: unknown) => void;
}

interface UseActionLearningResult {
  bias: Record<string, number>;
  state: LearningState;
  overrides: LearningOverrides;
  /** Why the configured store has not been read (null once it has): writes are kept
   *  in memory and saved once a load works. The learning view names it. */
  loadProblem: LearningLoadProblem;
  record(action: SuggestedAction, type: OutcomeType): Promise<void>;
  setOverride(kind: string, override: LearningOverride): Promise<void>;
  reset(): Promise<void>;
}

export type LearningErrorKind = "load" | "rejected" | "notReady" | "save";
/** "unreadable": a load failed (retried when retryable); "token-rejected": Turso
 *  refused the token (not retried); "store-not-ready": Turso is chosen but has no
 *  usable config yet, so nothing is loaded. */
export type LearningLoadProblem = null | "unreadable" | "token-rejected" | "store-not-ready";

/** §781 — the toast key for each failure `onError` reports, for the caller's `reportSilentFailure`. */
export const LEARNING_ERROR_TOAST = {
  load: "learningWriteHeldToast",
  rejected: "learningLoadRejectedToast",
  notReady: "learningStoreNotReadyToast",
  save: "learningSaveFailedToast",
} as const satisfies Record<LearningErrorKind, TranslationKey>;

/** A failed load is retried a few times, with a growing delay (as `useScheduledJobs`
 *  retries its read), and again on the next write once those run out (§781). */
export const LEARNING_LOAD_RETRY_MS = 5_000;
const MAX_LOAD_RETRIES = 3;

/** A learning write, kept as a function so it can replay on top of a late load (§781). */
type Mutation = (s: LearningSnapshot) => LearningSnapshot;

/**
 * Capture hook for the Action Center learning layer. Loads a learning snapshot
 * via pickLearningStore, records outcomes (no-op when disabled or in a popout),
 * exposes a memoized bias map + overrides + reset, and persists every mutation.
 *
 * §781 — every save is a FULL REWRITE of its store (on Turso: DELETE FROM the
 * GLOBAL `action_learning` table, then re-insert), so a save is only ever made
 * from a snapshot that was LOADED from that same store in this session:
 * - The load waits for `hydrated` (before it the config is the default "local"
 *   one, and a Turso user's table would be rewritten from the local snapshot) and
 *   is keyed on the store identity (`learningStoreKey`); a change of identity — a
 *   store switch in Settings, a Turso URL edit — starts a new load.
 * - Until a load of the current store succeeds, writes are applied in memory and
 *   queued; the load replays the queue on top of what it read and saves once, to
 *   the store object it loaded from. A switch therefore never copies one store's
 *   rows into the other: the new store keeps its rows plus this session's later
 *   writes.
 * - Only the LATEST load (`loadGenRef`) is authoritative. StrictMode's second
 *   mount, or a store switch, makes an earlier one stale: it then touches neither
 *   the queue, the state nor a save.
 * - A failed load is retried; meanwhile nothing is saved, `loadFailed` is true
 *   (the learning view shows a notice) and the first write held is reported.
 */
export function useActionLearning({
  config,
  tursoConfig,
  isPopout,
  hydrated,
  onError,
}: UseActionLearningArgs): UseActionLearningResult {
  const [snap, setSnap] = useState<LearningSnapshot>(EMPTY_SNAPSHOT);
  const [loadProblem, setLoadProblem] = useState<LearningLoadProblem>(null);
  // Decay is time-dependent, but Date.now() is banned inside useMemo (engine-purity
  // lint). We capture "now" inside the load/persist callbacks (where it is allowed)
  // and feed it to the memo as a plain dep, so the bias map stays a pure derivation.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const storeKey = learningStoreKey(config, tursoConfig);

  // Ref mirrors keep callbacks/effects reading the latest values without widening
  // their dep arrays. These mirror effects MUST stay declared before the
  // consuming effects/callbacks: React runs effects in declaration order, so the
  // refs are refreshed before anything reads them (see use-action-notifications).
  const snapRef = useRef(snap);
  const argsRef = useRef({ config, tursoConfig, isPopout, onError });
  // The store whose load succeeded (saves go to this object), or null while none has.
  const loadedStoreRef = useRef<LearningStore | null>(null);
  const loadGenRef = useRef(0);
  const storeKeyRef = useRef(storeKey);
  const queueRef = useRef<Mutation[]>([]);
  const loadInFlightRef = useRef(false);
  const retriesRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadErrorRef = useRef<unknown>(null); // set while the current load has failed
  const heldReportedRef = useRef(false);
  // The current load failed permanently, or Turso is not ready: no retries until the
  // store identity (URL, token) changes.
  const permanentRef = useRef(false);
  // Unmounted: a load that fails afterwards schedules no retry. A load that SUCCEEDS
  // afterwards still saves the queue, because the writes are the user's (see the resolve).
  const mountedRef = useRef(true);
  const saveFailingRef = useRef(false);
  // Serializes saves so two rapid persists cannot land out-of-order on the async
  // Turso store (a slower older write reverting a newer outcome).
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  // The retry timer and a write call the latest `attemptLoad` through this ref.
  const attemptLoadRef = useRef<(gen: number) => void>(() => {});
  useEffect(() => {
    snapRef.current = snap;
  });
  useEffect(() => {
    argsRef.current = { config, tursoConfig, isPopout, onError };
    storeKeyRef.current = storeKey;
  });

  const enqueueSave = useCallback((store: LearningStore, next: LearningSnapshot) => {
    // Chain saves so they run in enqueue order — the last record's snapshot is
    // the last write even if an earlier (slower) save is still in flight.
    saveChainRef.current = saveChainRef.current
      .then(() => store.save(next))
      .then(
        () => {
          saveFailingRef.current = false;
        },
        (err: unknown) => {
          // Reported once per failing streak; the next save carries the whole
          // snapshot, so nothing is lost while the session lasts.
          if (saveFailingRef.current) return;
          saveFailingRef.current = true;
          logDiag("error", "learning.saveFailed", { message: err instanceof Error ? err.message : String(err) });
          argsRef.current.onError?.("save", err);
        },
      );
  }, []);

  const attemptLoad = useCallback(
    (gen: number) => {
      if (gen !== loadGenRef.current || loadInFlightRef.current) return;
      loadInFlightRef.current = true;
      const store = pickLearningStore(argsRef.current.config, argsRef.current.tursoConfig);
      store
        .load()
        .then((s) => {
          // A stale load (StrictMode's first mount, or a store switched since) is
          // ignored entirely: it neither drains the queue nor marks the load done.
          if (gen !== loadGenRef.current) return;
          loadInFlightRef.current = false;
          // §778 — rows and overrides stored under a count-variant kind merge
          // into the canonical one here; the next save writes them merged.
          const queued = queueRef.current;
          queueRef.current = [];
          loadedStoreRef.current = store;
          loadErrorRef.current = null;
          heldReportedRef.current = false;
          const next = queued.reduce((acc, m) => m(acc), normalizeLearningSnapshot(s));
          // Saved even after an unmount: the queued writes are the user's, and
          // `next` already holds every stored row.
          if (queued.length > 0) enqueueSave(store, next);
          snapRef.current = next;
          setSnap(next);
          setLoadProblem(null);
          setNowTick(Date.now());
        })
        .catch((err: unknown) => {
          if (gen !== loadGenRef.current) return;
          loadInFlightRef.current = false;
          // Keep the in-memory snapshot and the queue; save nothing until a load works.
          loadErrorRef.current = err;
          logDiag("warn", "learning.loadFailedSavesHeld", {
            retry: retriesRef.current,
            message: err instanceof Error ? err.message : String(err),
          });
          const kind = tursoErrorKind(err);
          const tokenRejected = kind === "auth" || kind === "auth-env";
          setLoadProblem(tokenRejected ? "token-rejected" : "unreadable");
          if (tokenRejected || !isRetryableLearningLoadError(err)) {
            // Retrying cannot fix a rejected token, a SQL error or a malformed
            // response: stop. A rejected token is told to the user NOW; a new token
            // in Settings is a new store identity, so it re-runs the load, which
            // saves the held writes without waiting for another write.
            permanentRef.current = true;
            if (tokenRejected && !heldReportedRef.current) {
              heldReportedRef.current = true;
              argsRef.current.onError?.("rejected", err);
            }
            return;
          }
          if (!mountedRef.current || retriesRef.current >= MAX_LOAD_RETRIES) return;
          retriesRef.current += 1;
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            attemptLoadRef.current(gen);
          }, LEARNING_LOAD_RETRY_MS * retriesRef.current);
        });
    },
    [enqueueSave],
  );
  useEffect(() => {
    attemptLoadRef.current = attemptLoad;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Load once settings are hydrated, and again whenever the store identity
  // changes: the store, the Turso URL or the token (a rejected token fixed in
  // Settings). The queue is KEPT across a reload: writes made since the last
  // successful load replay on top of the new store's rows.
  useEffect(() => {
    if (!hydrated) return;
    const gen = ++loadGenRef.current;
    loadedStoreRef.current = null;
    loadInFlightRef.current = false;
    permanentRef.current = false;
    heldReportedRef.current = false;
    loadErrorRef.current = null;
    retriesRef.current = 0;
    if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    // Until the new store is read, show only this session's unsaved writes: the
    // previous store's rows are not this store's, and an override or Reset made
    // on them would replay into the new store.
    const pending = queueRef.current.reduce((acc, m) => m(acc), EMPTY_SNAPSHOT);
    snapRef.current = pending;
    setSnap(pending);
    if (storeKey === null) {
      // Turso is chosen but not usable yet: load nothing, never fall back to local.
      permanentRef.current = true;
      loadErrorRef.current = new Error("learning: the Turso store is not ready");
      setLoadProblem("store-not-ready");
    } else {
      setLoadProblem(null);
      attemptLoadRef.current(gen);
    }
    return () => {
      if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    };
  }, [hydrated, storeKey]);

  // Pure derivation of the bias map — no Date.now() here (it would trip the
  // engine-purity lint); the timestamp arrives via nowTick.
  const bias = useMemo(
    () => (config.enabled ? buildBiasMap(snap.state, snap.overrides, nowTick) : {}),
    [snap, config.enabled, nowTick],
  );

  const apply = useCallback(
    (m: Mutation) => {
      const next = m(snapRef.current);
      // Update the ref synchronously so consecutive mutations within one tick
      // (before React flushes the mirror effect) build on each other.
      snapRef.current = next;
      setSnap(next);
      setNowTick(Date.now());
      const store = loadedStoreRef.current;
      if (store !== null) {
        enqueueSave(store, next);
        return;
      }
      queueRef.current.push(m);
      if (loadErrorRef.current === null) return;
      if (!heldReportedRef.current) {
        heldReportedRef.current = true;
        argsRef.current.onError?.(storeKeyRef.current === null ? "notReady" : "load", loadErrorRef.current);
      }
      // Retries used up and none scheduled: this write starts a fresh round
      // (never after a permanent failure, which only a config change can fix).
      if (!permanentRef.current && retryTimerRef.current === null && !loadInFlightRef.current && retriesRef.current >= MAX_LOAD_RETRIES) {
        retriesRef.current = 0;
        attemptLoadRef.current(loadGenRef.current);
      }
    },
    [enqueueSave],
  );

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

  return { bias, state: snap.state, overrides: snap.overrides, loadProblem, record, setOverride, reset };
}
