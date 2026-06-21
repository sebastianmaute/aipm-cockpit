// Pure, i18n-free engine for the Dashboard completion-trend sparkline.
// Produces a chronological series of % complete (0–100). Prefers exact Turso
// snapshot history; falls back to reconstructing done/total from the local
// activity log when there are fewer than two snapshots. No I/O, no clock —
// `today`, `currentDone`, `currentTotal` are passed in.

import type { SnapshotRecord } from "./snapshot";
import type { ActivityEntry } from "./activity-log";

export interface CompletionPoint {
  /** Short day label "MM-DD" for tooltips/labels. */
  label: string;
  /** Completion percentage, clamped to [0, 100]. */
  percent: number;
}

export interface CompletionTrendInput {
  snapshots: readonly SnapshotRecord[];
  activity: readonly ActivityEntry[];
  /** Live completed-task count (model.progress.completed). */
  currentDone: number;
  /** Live total-task count (model.progress.total). */
  currentTotal: number;
  /** Today as YYYY-MM-DD; used only to drop future-dated (clock-skew) events. */
  today: string;
}

/** Trailing window so a long history doesn't flood the sparkline. */
export const MAX_POINTS = 12;

function clampPctFromCounts(done: number, total: number): number {
  if (total <= 0) return 0;
  const pct = Math.round((100 * done) / total);
  if (!Number.isFinite(pct)) return 0;
  return pct < 0 ? 0 : pct > 100 ? 100 : pct;
}

function clampPctValue(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  const r = Math.round(pct);
  return r < 0 ? 0 : r > 100 ? 100 : r;
}

/** ISO timestamp/date -> "MM-DD". */
function dayLabel(iso: string): string {
  return iso.slice(5, 10);
}

function trailing<T>(arr: readonly T[]): T[] {
  return arr.length > MAX_POINTS ? arr.slice(arr.length - MAX_POINTS) : [...arr];
}

function fromSnapshots(snapshots: readonly SnapshotRecord[]): CompletionPoint[] {
  if (snapshots.length < 2) return [];
  const sorted = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  return trailing(sorted).map((s) => ({
    label: dayLabel(s.capturedAt),
    percent: clampPctValue(s.pctComplete),
  }));
}

const COUNT_KINDS = new Set(["task.created", "task.completed", "task.reopened", "task.deleted"]);

type DayDelta = { day: string; dDone: number; dTotal: number };

function reconstructFromActivity(
  activity: readonly ActivityEntry[],
  currentDone: number,
  currentTotal: number,
  today: string,
): CompletionPoint[] {
  // Per-day deltas from task events (created/deleted move total; completed/
  // reopened move done). Deleted task's done-state is unknown -> assumed not
  // done (documented approximation).
  const byDay = new Map<string, { dDone: number; dTotal: number }>();
  for (const e of activity) {
    if (!COUNT_KINDS.has(e.kind)) continue;
    const day = e.timestamp.slice(0, 10);
    if (day > today) continue; // clock-skew guard
    const cur = byDay.get(day) ?? { dDone: 0, dTotal: 0 };
    if (e.kind === "task.created") cur.dTotal += 1;
    else if (e.kind === "task.deleted") cur.dTotal -= 1;
    else if (e.kind === "task.completed") cur.dDone += 1;
    else if (e.kind === "task.reopened") cur.dDone -= 1;
    byDay.set(day, cur);
  }
  const days: DayDelta[] = [...byDay.entries()]
    .map(([day, d]) => ({ day, ...d }))
    .sort((a, b) => a.day.localeCompare(b.day));
  if (days.length < 2) return [];

  // Walk backward: the last event-day's END state = current; subtract each
  // day's delta to get the end state of the previous day. Floor counts at 0.
  const endState: { done: number; total: number }[] = new Array(days.length);
  let done = currentDone;
  let total = currentTotal;
  for (let i = days.length - 1; i >= 0; i--) {
    endState[i] = { done: Math.max(0, done), total: Math.max(0, total) };
    done -= days[i].dDone;
    total -= days[i].dTotal;
  }
  const points = days.map((d, i) => ({
    label: dayLabel(`${d.day}`),
    percent: clampPctFromCounts(endState[i].done, endState[i].total),
  }));
  return trailing(points);
}

export function computeCompletionTrend(input: CompletionTrendInput): CompletionPoint[] {
  const snap = fromSnapshots(input.snapshots);
  if (snap.length >= 2) return snap;
  return reconstructFromActivity(input.activity, input.currentDone, input.currentTotal, input.today);
}
