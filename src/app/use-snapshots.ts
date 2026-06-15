// src/app/use-snapshots.ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendSnapshot as storeAppend, deleteSnapshot as storeDelete,
  deleteSnapshots as storeDeleteMany,
  loadSnapshots, setBaseline as storeSetBaseline,
} from "./snapshot-store";
import { bucketKey, buildSnapshot, computeVariance, detectGaps } from "./snapshot";
import type { SnapshotCadence, SnapshotRecord, SnapshotTrigger, VarianceRow } from "./snapshot";
import type { BuildSnapshotInput } from "./snapshot";
import type { TursoConfig } from "./turso-config";

export interface UseSnapshotsArgs {
  /** True only when storage is Turso, this is not a popout, and recording is on. */
  active: boolean;
  cadence: SnapshotCadence;
  tursoConfig: TursoConfig | null;
  /** Active project id (Turso multi-tenant scoping). */
  projectId: string;
  today: Date;
  /** Lazily assembles the capture context (model + workspace bits) at capture
   *  time. Returns the BuildSnapshotInput minus capturedAt/cadence/trigger,
   *  which the hook fills. */
  buildContext: () => Omit<BuildSnapshotInput, "capturedAt" | "cadence" | "trigger">;
  /** Optional: surface a manual-capture error to the user. */
  onError?: (err: unknown) => void;
}

export interface UseSnapshotsResult {
  snapshots: SnapshotRecord[];
  baseline: SnapshotRecord | null;
  latest: SnapshotRecord | null;
  variance: VarianceRow[];
  gaps: string[];
  busy: boolean;
  captureNow: () => Promise<void>;
  setBaseline: (id: string) => Promise<void>;
  deleteSnapshot: (id: string) => Promise<void>;
  deleteSnapshots: (ids: readonly string[]) => Promise<void>;
}

function pickBaseline(snaps: readonly SnapshotRecord[]): SnapshotRecord | null {
  if (snaps.length === 0) return null;
  const flagged = snaps.find((s) => s.isBaseline);
  if (flagged) return flagged;
  return [...snaps].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))[0];
}

export function useSnapshots(args: UseSnapshotsArgs): UseSnapshotsResult {
  const { active, cadence, tursoConfig, today } = args;
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const ctxRef = useRef(args.buildContext);
  const errRef = useRef(args.onError);
  const cfgRef = useRef(tursoConfig);
  const pidRef = useRef(args.projectId);
  // Bumped by every user mutation. A load in flight that sees this change
  // between its start and completion must NOT clobber state with stale history.
  const opSeqRef = useRef(0);
  useEffect(() => { ctxRef.current = args.buildContext; }, [args.buildContext]);
  useEffect(() => { errRef.current = args.onError; }, [args.onError]);
  useEffect(() => { cfgRef.current = tursoConfig; }, [tursoConfig]);
  useEffect(() => { pidRef.current = args.projectId; }, [args.projectId]);

  const makeRecord = useCallback(
    (trigger: SnapshotTrigger, isBaseline: boolean, bucket: string): SnapshotRecord => {
      const capturedAt = new Date().toISOString();
      const ctx = ctxRef.current();
      return { ...buildSnapshot({ ...ctx, capturedAt, cadence, trigger }), bucket, isBaseline };
    },
    [cadence],
  );

  const currentBucket = bucketKey(today, cadence);

  // Load history; auto-capture once per bucket when enabled.
  useEffect(() => {
    // Defense-in-depth: even if `active` leaks true, never run a Turso pipeline
    // without a config — it would throw StorageNotReadyError on mount.
    if (!active || !cfgRef.current) return;
    let cancelled = false;
    const startSeq = opSeqRef.current;
    const stale = () => cancelled || opSeqRef.current !== startSeq;
    (async () => {
      try {
        const history = await loadSnapshots(cfgRef.current, pidRef.current);
        if (stale()) return;
        const hasCurrent = history.some((s) => s.bucket === currentBucket);
        if (!hasCurrent) {
          const isFirstEver = history.length === 0;
          const rec = makeRecord("auto", isFirstEver, currentBucket);
          await storeAppend(cfgRef.current, rec, pidRef.current);
          if (stale()) return;
          setSnapshots([...history, rec]);
        } else {
          setSnapshots(history);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("snapshot auto-capture failed", err);
          // Surface it so the storage status + banner can react (this is often
          // the first request that hits a rotated/dead Turso DB while the app
          // is open). The handler classifies and decides whether to toast.
          errRef.current?.(err);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, cadence, currentBucket, args.projectId]);

  const captureNow = useCallback(async () => {
    if (!active) return;
    opSeqRef.current += 1;
    setBusy(true);
    try {
      const isFirstEver = snapshots.length === 0;
      const rec = makeRecord("manual", isFirstEver, currentBucket);
      await storeAppend(cfgRef.current, rec, pidRef.current);
      setSnapshots((prev) => [...prev, rec]);
    } catch (err) {
      errRef.current?.(err);
    } finally {
      setBusy(false);
    }
  }, [active, snapshots.length, makeRecord, currentBucket]);

  const setBaseline = useCallback(async (id: string) => {
    if (!active) return;
    opSeqRef.current += 1;
    setBusy(true);
    try {
      await storeSetBaseline(cfgRef.current, id, pidRef.current);
      setSnapshots((prev) => prev.map((s) => ({ ...s, isBaseline: s.id === id })));
    } catch (err) {
      errRef.current?.(err);
    } finally {
      setBusy(false);
    }
  }, [active]);

  const deleteSnapshot = useCallback(async (id: string) => {
    if (!active) return;
    opSeqRef.current += 1;
    setBusy(true);
    try {
      await storeDelete(cfgRef.current, id, pidRef.current);
      setSnapshots((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      errRef.current?.(err);
    } finally {
      setBusy(false);
    }
  }, [active]);

  const deleteSnapshots = useCallback(async (ids: readonly string[]) => {
    if (!active) return;
    opSeqRef.current += 1;
    setBusy(true);
    try {
      await storeDeleteMany(cfgRef.current, ids, pidRef.current);
      setSnapshots((prev) => prev.filter((s) => !ids.includes(s.id)));
    } catch (err) {
      errRef.current?.(err);
    } finally {
      setBusy(false);
    }
  }, [active]);

  const baseline = pickBaseline(snapshots);
  const sorted = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const latest = sorted.length ? sorted[sorted.length - 1] : null;
  const variance = latest ? computeVariance(baseline, latest) : [];
  const gaps = detectGaps(snapshots, cadence, today);

  return { snapshots: sorted, baseline, latest, variance, gaps, busy, captureNow, setBaseline, deleteSnapshot, deleteSnapshots };
}
