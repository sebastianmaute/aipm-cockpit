// src/app/use-snapshots.ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendSnapshot as storeAppend, deleteSnapshot as storeDelete,
  deleteSnapshots as storeDeleteMany,
  loadSnapshots, setBaseline as storeSetBaseline,
} from "./snapshot-store";
import { bucketKey, buildSnapshot, computeVariance, detectGaps, hasCapturableContent, withoutCompletionVariance } from "./snapshot";
import type { SnapshotCadence, SnapshotRecord, SnapshotTrigger, VarianceRow } from "./snapshot";
import type { BuildSnapshotInput } from "./snapshot";
import type { TursoConfig } from "./turso-config";
import { tasksHaveNoActiveScope } from "./dashboard";
import type { Task } from "./types";
import { reportCapabilityGap } from "./guard-feedback";
import type { Lang } from "./i18n";

export interface UseSnapshotsArgs {
  /** True only when storage is Turso, this is not a popout, and recording is on. */
  active: boolean;
  /**
   * True once the backend's workspace load has been APPLIED to render scope.
   *
   * ★★★ WITHOUT THIS GATE EVERY AUTO SNAPSHOT RECORDS AN EMPTY PROJECT. The
   * auto-capture below and the workspace load (`use-storage-backend`'s load
   * effect) are two independent async reads fired on the same commit, and this
   * one wins essentially always — `loadSnapshots` reads two small tables while
   * `backend.load()` reads the whole workspace. `buildContext()` then closes
   * over `tasks: []`, `budgets: []` and the DEFAULT-SEEDED plan, so
   * `model.burndown` is null (it needs at least one budget bucket),
   * `evm.spi`/`cpi` are null and `progress.percent` is 0 — and the row is
   * written with all four KPIs null.
   *
   * ★★ The damage is PERMANENT for that bucket, which is why this is a gate and
   * not a retry: `hasCurrent` sees the poisoned row, decides the bucket is
   * covered, and the real values are never captured for it. Every weekly bucket
   * of a live project was lost this way, and the only visible symptom was the
   * charts reading "Not enough snapshots yet" beside a full snapshot table.
   *
   * ★ A capture is DEFERRED until a load LANDS, not skipped outright: the effect
   * re-runs when this flips, so the bucket is still captured — just with real
   * data. ★★ It IS skipped when no load lands at all: a FAILED load leaves the
   * flag false for the session (pinned by use-storage-backend.test.tsx), and the
   * bucket is only picked up by a later successful load — `reloadCurrentProject`
   * or a project switch, both of which re-enter `applyWorkspace`. That is the
   * correct trade: a failed load must never license a capture, because capturing
   * the default workspace is the exact corruption this flag exists to stop.
   * Do not soften this to "never skipped" — an earlier revision said so, and
   * this repo's recurring defect is prose that outlives its code.
   *
   * ★ Deliberately SEPARATE from `active` at the call site rather than folded
   * into it: `active` also decides whether the Trends view renders its panel at
   * all, so gating that on the load would flash the "needs Turso" placeholder on
   * every boot. Only CAPTURE has to wait.
   *
   * ★★ CLOSED, and NOT by this flag — a brand-new project used to slip through
   * here. `createTursoProject` applies an empty workspace and changes
   * `projectId` in one batch, so this flag is legitimately true (data WAS
   * applied — there just isn't any). The capture effect now asks a SEPARATE
   * question first, `hasCapturableContent` (`snapshot.ts`), and declines. This
   * flag still answers only "has a load landed"; it was never overloaded.
   * ★★★ An earlier revision of this comment prescribed gating `isFirstEver` on
   * content instead. That would NOT have closed it: `pickBaseline` below falls
   * back to the EARLIEST row when none is flagged, so the empty capture would
   * still have been the baseline — and `hasCurrent` would still have claimed
   * the bucket. The gate has to be on the CAPTURE. (open-followups §78.)
   */
  workspaceReady: boolean;
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
  /** Surfaces a capability-gap toast when a user action bails on `!active`
   *  (e.g. Turso quarantined mid-session after the panel/CTA already rendered). */
  showToast: (kind: "info" | "error", text: string) => void;
  lang: Lang;
  /** Live task list. Used ONLY to decide whether the completion variance row is
   *  meaningful — see the `variance` derivation below. */
  tasks: readonly Task[];
}

export interface UseSnapshotsResult {
  snapshots: SnapshotRecord[];
  baseline: SnapshotRecord | null;
  latest: SnapshotRecord | null;
  variance: VarianceRow[];
  gaps: string[];
  busy: boolean;
  captureNow: () => Promise<void>;
  rebaselineNow: () => Promise<void>;
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
  const { active, workspaceReady, cadence, tursoConfig, today } = args;
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const ctxRef = useRef(args.buildContext);
  const errRef = useRef(args.onError);
  const cfgRef = useRef(tursoConfig);
  const pidRef = useRef(args.projectId);
  const toastRef = useRef(args.showToast);
  const langRef = useRef(args.lang);
  // Bumped by every user mutation. A load in flight that sees this change
  // between its start and completion must NOT clobber state with stale history.
  const opSeqRef = useRef(0);
  useEffect(() => { ctxRef.current = args.buildContext; }, [args.buildContext]);
  useEffect(() => { errRef.current = args.onError; }, [args.onError]);
  useEffect(() => { cfgRef.current = tursoConfig; }, [tursoConfig]);
  useEffect(() => { pidRef.current = args.projectId; }, [args.projectId]);
  useEffect(() => { toastRef.current = args.showToast; }, [args.showToast]);
  useEffect(() => { langRef.current = args.lang; }, [args.lang]);

  // Shared bail for the USER-INVOKED mutators below (captureNow/rebaselineNow/
  // setBaseline/deleteSnapshot/deleteSnapshots): `active` can leak stale-true
  // briefly (e.g. Turso quarantined mid-session after a button already
  // rendered), so tell the user instead of silently no-oping. NOT used by the
  // auto-capture effect below — that one must stay silent.
  const reportInactiveBail = useCallback(() => {
    reportCapabilityGap(toastRef.current, langRef.current, "trends.notConfigured", "guardTrendsNotConfigured");
  }, []);

  const makeRecord = useCallback(
    (
      trigger: SnapshotTrigger,
      isBaseline: boolean,
      bucket: string,
      ctx: ReturnType<UseSnapshotsArgs["buildContext"]> = ctxRef.current(),
    ): SnapshotRecord => {
      const capturedAt = new Date().toISOString();
      return { ...buildSnapshot({ ...ctx, capturedAt, cadence, trigger }), bucket, isBaseline };
    },
    [cadence],
  );

  const currentBucket = bucketKey(today, cadence);

  // Load history; auto-capture once per bucket when enabled.
  useEffect(() => {
    // Defense-in-depth: even if `active` leaks true, never run a Turso pipeline
    // without a config — it would throw StorageNotReadyError on mount.
    // `workspaceReady` keeps the capture off the boot race entirely (see the
    // arg's note): until the load has been applied, a snapshot taken here would
    // record an empty project and permanently claim this bucket.
    if (!active || !workspaceReady || !cfgRef.current) return;
    let cancelled = false;
    const startSeq = opSeqRef.current;
    const stale = () => cancelled || opSeqRef.current !== startSeq;
    (async () => {
      try {
        const history = await loadSnapshots(cfgRef.current, pidRef.current);
        if (stale()) return;
        const hasCurrent = history.some((s) => s.bucket === currentBucket);
        if (!hasCurrent) {
          const ctx = ctxRef.current();
          // ★★★ open-followups §78. A capture CLAIMS this bucket permanently
          // (`hasCurrent` never revisits it), so an empty project must not be
          // captured at all — un-flagging `isBaseline` would NOT be enough,
          // because `pickBaseline` falls back to the earliest row when none is
          // flagged, and the bucket would still be claimed.
          // ★★ "Declines" means declines FOR THIS EFFECT RUN, and nothing
          // re-arms it. The deps below are [active, workspaceReady, cadence,
          // currentBucket, args.projectId] — adding the project's first task changes
          // NONE of them, so this bucket is not reconsidered until a reload,
          // a project switch, or a bucket rollover (which captures the NEW
          // bucket, not the missed one). Create a project on Monday and
          // populate it Tuesday and that first period simply has no auto row.
          // That is a deliberate trade, and strictly better than the bug: the
          // bucket is NOT claimed, so nothing is poisoned and the first REAL
          // capture correctly becomes the baseline. Adding `tasks.length` as a
          // dep would close the gap but re-runs this effect on every task edit.
          if (!hasCapturableContent(ctx)) {
            setSnapshots(history);
            return;
          }
          const isFirstEver = history.length === 0;
          const rec = makeRecord("auto", isFirstEver, currentBucket, ctx);
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
    // Intentional: buildContext/onError/tursoConfig are read via the refs mirrored
    // above (ctxRef/errRef/cfgRef), so they must NOT be effect deps — re-running on
    // every render-new buildContext would re-fetch history (and re-auto-capture) each
    // render. The effect fires only when active/cadence/bucket/project actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, workspaceReady, cadence, currentBucket, args.projectId]);

  const captureNow = useCallback(async () => {
    if (!active) { reportInactiveBail(); return; }
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
  }, [active, snapshots.length, makeRecord, currentBucket, reportInactiveBail]);

  const rebaselineNow = useCallback(async () => {
    if (!active) { reportInactiveBail(); return; }
    opSeqRef.current += 1;
    setBusy(true);
    try {
      const rec = makeRecord("manual", false, currentBucket);
      await storeAppend(cfgRef.current, rec, pidRef.current);
      await storeSetBaseline(cfgRef.current, rec.id, pidRef.current);
      setSnapshots((prev) => [...prev, rec].map((s) => ({ ...s, isBaseline: s.id === rec.id })));
    } catch (err) {
      errRef.current?.(err);
    } finally {
      setBusy(false);
    }
  }, [active, makeRecord, currentBucket, reportInactiveBail]);

  const setBaseline = useCallback(async (id: string) => {
    if (!active) { reportInactiveBail(); return; }
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
  }, [active, reportInactiveBail]);

  const deleteSnapshot = useCallback(async (id: string) => {
    if (!active) { reportInactiveBail(); return; }
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
  }, [active, reportInactiveBail]);

  const deleteSnapshots = useCallback(async (ids: readonly string[]) => {
    if (!active) { reportInactiveBail(); return; }
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
  }, [active, reportInactiveBail]);

  const baseline = pickBaseline(snapshots);
  const sorted = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const latest = sorted.length ? sorted[sorted.length - 1] : null;
  // The completion row is dropped for a project with no active scope: 0% there
  // is an empty denominator, not lost delivery, and `worseIfLower` would report
  // it as a fall against the baseline. Gated HERE rather than at either render
  // site because both surfaces that show variance — the dashboard's Trends card
  // and the Trends view — read this one value, and a per-surface gate is exactly
  // how the dashboard's own two completion cards came to disagree.
  // ★ PRESENTATION ONLY: the stored `SnapshotRecord.pctComplete` is untouched.
  // ★★ KNOWN LIMIT — the gate mixes LIVE and HISTORICAL data: the rows come from
  // two stored snapshots, the predicate reads today's tasks. Narrow in practice
  // (no-active-scope needs every task to lack a `completedDate`, so a non-zero
  // historical `pctComplete` requires the delivered tasks to have been DELETED
  // since), but it is not "unconditionally correct" — say so rather than let a
  // later reader assume it.
  // ★ `rawVariance.length` FIRST, and it is not a micro-optimisation: this hook
  // is called unconditionally from the root orchestrator, Trends is Turso-only,
  // so on a file backend `rawVariance` is always [] and `scopeCounts` would
  // otherwise filter+allocate over every task on every render of the whole app.
  const rawVariance = latest ? computeVariance(baseline, latest) : [];
  const variance = rawVariance.length > 0 && tasksHaveNoActiveScope(args.tasks)
    ? withoutCompletionVariance(rawVariance)
    : rawVariance;
  const gaps = detectGaps(snapshots, cadence, today);

  return { snapshots: sorted, baseline, latest, variance, gaps, busy, captureNow, rebaselineNow, setBaseline, deleteSnapshot, deleteSnapshots };
}
