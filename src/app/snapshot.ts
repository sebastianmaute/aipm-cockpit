// src/app/snapshot.ts
//
// Pure snapshot domain logic for the Baseline + Variance / Burndown Trends
// feature. No React, no I/O. Snapshots capture project KPIs at a moment in time
// (persisted Turso-only) so slippage can be shown over time.

import type { Health } from "./health";
import type { DashboardModel } from "./dashboard";
import { isTaskClosed, isTaskDelivered } from "./task-closed";
import type { Milestone, Task } from "./types";

export type SnapshotCadence = "weekly" | "daily" | "monthly";
export type SnapshotTrigger = "auto" | "manual";

export interface SnapshotSeriesPoint {
  period: string;
  plannedHours: number;
  actualHours: number | null;
  plannedCost: number;
  actualCost: number | null;
}

export interface SnapshotMilestone {
  id: number;
  name: string;
  target: string;   // YYYY-MM-DD
  forecast: string;  // YYYY-MM-DD
}

export interface SnapshotRecord {
  id: string;            // client-generated = capturedAt (ISO ms), unique per capture
  capturedAt: string;    // ISO timestamp
  bucket: string;        // bucketKey(capturedAt, cadence)
  cadence: SnapshotCadence;
  trigger: SnapshotTrigger;
  isBaseline: boolean;
  remainingHours: number | null;
  remainingCost: number | null;
  pctComplete: number;
  forecastEndDate: string;  // YYYY-MM-DD
  planEndDate: string;      // YYYY-MM-DD
  spi: number | null;
  cpi: number | null;
  overallRag: Health | "";
  scheduleRag: Health | "";
  budgetRag: Health | "";
  scopeRag: Health | "";
  currency: string;
  milestones: SnapshotMilestone[];
  series: SnapshotSeriesPoint[];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** ISO-8601 week number + week-year for a date (Mon-based, week 1 contains the
 *  first Thursday). Returns { year, week }. */
function isoWeek(date: Date): { year: number; week: number } {
  // Work in UTC to avoid TZ drift; copy so we don't mutate the input.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Sun=0 -> 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // shift to the Thursday of this week
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year, week };
}

/** Cadence bucket key for a capture instant. */
export function bucketKey(date: Date, cadence: SnapshotCadence): string {
  const y = date.getUTCFullYear();
  const m = pad2(date.getUTCMonth() + 1);
  const d = pad2(date.getUTCDate());
  if (cadence === "daily") return `${y}-${m}-${d}`;
  if (cadence === "monthly") return `${y}-${m}`;
  const { year, week } = isoWeek(date);
  return `${year}-W${pad2(week)}`;
}

function startOfBucket(date: Date, cadence: SnapshotCadence): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (cadence === "daily") return d;
  if (cadence === "monthly") return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  // weekly: step back to Monday
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

function advance(date: Date, cadence: SnapshotCadence): Date {
  const d = new Date(date);
  if (cadence === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (cadence === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** Inclusive list of cadence bucket keys from `from` to `to`. Empty if to < from. */
export function expectedBuckets(from: Date, to: Date, cadence: SnapshotCadence): string[] {
  const out: string[] = [];
  let cursor = startOfBucket(from, cadence);
  const end = startOfBucket(to, cadence);
  // Guard against pathological inputs: cap at 1000 buckets.
  for (let i = 0; cursor.getTime() <= end.getTime() && i < 1000; i++) {
    out.push(bucketKey(cursor, cadence));
    cursor = advance(cursor, cadence);
  }
  return out;
}

/** Expected buckets between the earliest snapshot and `today` that have no
 *  snapshot. Empty when there are no snapshots. */
export function detectGaps(
  snapshots: readonly SnapshotRecord[],
  cadence: SnapshotCadence,
  today: Date,
): string[] {
  if (snapshots.length === 0) return [];
  const sorted = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const first = new Date(sorted[0].capturedAt);
  const have = new Set(snapshots.map((s) => s.bucket));
  return expectedBuckets(first, today, cadence).filter((b) => !have.has(b));
}

function lastNonNull(values: readonly (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null) return values[i];
  }
  return null;
}

/** Latest effective end for a milestone: max of its target date and any linked
 *  task's effective end (completedDate || dueDate).
 *
 *  Closed-but-undelivered (Cancelled) work is skipped: it will never land, so
 *  its dueDate is not a date this milestone is waiting on. A DELIVERED task
 *  still contributes its completedDate — that is a real historical end, and
 *  dropping it would move the forecast in the wrong direction. */
export function milestoneForecast(m: Milestone, tasksById: ReadonlyMap<number, Task>): string {
  let latest = m.date;
  for (const id of m.linkedTaskIds) {
    const t = tasksById.get(id);
    if (!t) continue;
    if (isTaskClosed(t) && !isTaskDelivered(t)) continue;
    const end = t.completedDate || t.dueDate;
    if (end && end > latest) latest = end;
  }
  return latest;
}

/** Project forecast finish: the latest effective end across OPEN tasks (neither
 *  Done nor Cancelled) and unachieved milestones, never earlier than
 *  `planEndDate`. */
export function forecastEndDate(
  tasks: readonly Task[],
  milestones: readonly Milestone[],
  tasksById: ReadonlyMap<number, Task>,
  planEndDate: string,
): string {
  let latest = planEndDate;
  for (const t of tasks) {
    if (isTaskClosed(t)) continue;
    if (t.dueDate && t.dueDate > latest) latest = t.dueDate;
  }
  for (const m of milestones) {
    if (m.achievedDate) continue;
    const f = milestoneForecast(m, tasksById);
    if (f > latest) latest = f;
  }
  return latest;
}

export interface BuildSnapshotInput {
  model: DashboardModel;
  tasks: readonly Task[];
  milestones: readonly Milestone[];
  planEndDate: string;
  currency: string;
  capturedAt: string;       // ISO ms timestamp; also used as the record id
  cadence: SnapshotCadence;
  trigger: SnapshotTrigger;
}

const ragOrEmpty = (h: Health | null): Health | "" => h ?? "";

/** Assemble a SnapshotRecord from an already-computed DashboardModel + context.
 *  Pure: the caller supplies `capturedAt` (no implicit clock). */
export function buildSnapshot(input: BuildSnapshotInput): SnapshotRecord {
  const { model, tasks, milestones, planEndDate, currency, capturedAt, cadence, trigger } = input;
  const tasksById = new Map(tasks.map((t) => [t.id, t] as const));
  const bd = model.burndown;
  const series: SnapshotSeriesPoint[] = bd
    ? bd.periods.map((period, i) => ({
        period,
        plannedHours: bd.plannedRemainingHours[i] ?? 0,
        actualHours: bd.actualRemainingHours[i] ?? null,
        plannedCost: bd.plannedRemainingValue[i] ?? 0,
        actualCost: bd.actualRemainingValue[i] ?? null,
      }))
    : [];
  return {
    id: capturedAt,
    capturedAt,
    bucket: bucketKey(new Date(capturedAt), cadence),
    cadence,
    trigger,
    isBaseline: false,
    remainingHours: bd ? lastNonNull(bd.actualRemainingHours) : null,
    remainingCost: bd ? lastNonNull(bd.actualRemainingValue) : null,
    pctComplete: model.progress.percent,
    forecastEndDate: forecastEndDate(tasks, milestones, tasksById, planEndDate),
    planEndDate,
    spi: model.evm.spi,
    cpi: model.evm.cpi,
    overallRag: ragOrEmpty(model.overall.effective),
    scheduleRag: ragOrEmpty(model.schedule.effective),
    budgetRag: ragOrEmpty(model.budget.effective),
    scopeRag: ragOrEmpty(model.scope.effective),
    currency,
    milestones: milestones.map((m) => ({
      id: m.id, name: m.name, target: m.date, forecast: milestoneForecast(m, tasksById),
    })),
    series,
  };
}

/** Is there anything in this project worth recording a snapshot of?
 *
 *  ★★★ THIS GUARDS A PERMANENT WRITE — but only ONE of the three that make it.
 *  The auto-capture effect claims a cadence bucket by writing to it, and
 *  `hasCurrent` never revisits a claimed bucket — so a capture taken over an
 *  empty project is not merely useless, it costs that period its real numbers
 *  forever. Worse, being the first ever row it is also flagged `isBaseline`,
 *  and every later variance row then compares against nulls. (§78.)
 *  ★★ `captureNow` and `rebaselineNow` make the IDENTICAL permanent claim and
 *  are deliberately NOT gated on this — a manual capture is an explicit user
 *  act, and §78 is scoped to the automatic one. So do not read "this guards a
 *  permanent write" as "the write is guarded": a reader who did would wrongly
 *  conclude an empty manual capture is impossible. It is reachable and allowed.
 *
 *  ★★ Do NOT "simplify" this to a check on the built record's KPIs. A real
 *  project that has scope but no budget yet legitimately reports null
 *  `remainingHours`/`remainingCost` (both derive from `model.burndown`, which
 *  is non-null iff `budgets.length > 0`), so an output-shaped test would refuse
 *  to snapshot a project that genuinely should be snapshotted. Scope is the
 *  question, so ask it of the INPUT.
 *  ★ `spi`/`cpi` are NOT part of that argument — `computeEvm` reads task
 *  `originalEstimateMinutes`/`timeSpentMinutes` and never touches budgets, so a
 *  budget-less project can report a non-null SPI. An earlier revision blamed
 *  the missing budget bucket for all four KPIs; it accounts for two.
 *  ★★ KNOWN GAP (open-followups §78): this admits a project with one task and
 *  no budget, whose capture is then baselined with partial KPIs — the exact
 *  case §78 named when it warned that "a naive `tasks.length > 0` test would
 *  still baseline a snapshot with no SPI/CPI". What is closed is the ALL-null
 *  empty-project case. Do not read this predicate as answering that objection.
 */
export function hasCapturableContent(
  input: Pick<BuildSnapshotInput, "tasks" | "milestones" | "model">,
): boolean {
  return (
    input.tasks.length > 0 ||
    input.milestones.length > 0 ||
    input.model.burndown !== null
  );
}

export type VarianceKey =
  | "remainingHours" | "remainingCost" | "pctComplete" | "forecastEndDate" | "spi" | "cpi";

export interface VarianceRow {
  key: VarianceKey;
  baseline: number | null;   // for forecastEndDate this is null (shown via deltaDays)
  current: number | null;
  delta: number | null;      // current - baseline (numeric KPIs)
  deltaDays?: number;        // for forecastEndDate only
  health: Health | null;     // directional: worse -> R/A, better/flat -> G, unknown -> null
}

function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(`${aISO}T00:00:00Z`);
  const b = Date.parse(`${bISO}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/** "higher is worse" KPIs (remaining hours/cost): up => A, down/flat => G. */
function worseIfHigher(baseline: number | null, current: number | null): Health | null {
  if (baseline === null || current === null) return null;
  if (current > baseline) return "A";
  return "G";
}

/** "lower is worse" KPIs (spi/cpi, %complete momentum): a drop is Amber. */
function worseIfLower(baseline: number | null, current: number | null): Health | null {
  if (baseline === null || current === null) return null;
  if (current < baseline) return "A";
  return "G";
}

/** Drop the completion row from a variance list.
 *
 *  ★★ For a project whose every remaining task is cancelled, `pctComplete` is 0
 *  because the denominator is 0 — not because delivery regressed. `computeVariance`
 *  pairs that with `worseIfLower`, so a project baselined at 40% renders
 *  "Percent complete −40%" beside an AMBER dot, and on the dashboard that card
 *  sits one card below a tile reading "No active scope". Removing the ROW keeps
 *  the other KPIs (hours, cost, forecast date), which stay meaningful.
 *  ★ AMBER, not red: `worseIfLower` returns only `"A"` or `"G"` — this module
 *  never emits `"R"` for a numeric KPI, only for a forecast-date slip. A review
 *  and this comment both said "red" until a test asserted it.
 *
 *  ★★★ This is PRESENTATION ONLY and must stay that way. The stored
 *  `SnapshotRecord.pctComplete` is untouched: giving THAT a null state is a
 *  data-shape change with migration consequences for every stored snapshot and
 *  for what Trends charts over time (`docs/open-followups.md` §64 keeps the two
 *  halves apart deliberately). Do not "finish the job" at the record.
 */
export function withoutCompletionVariance(rows: readonly VarianceRow[]): VarianceRow[] {
  return rows.filter((row) => row.key !== "pctComplete");
}

/** Baseline-vs-current variance per KPI with a directional RAG. A null baseline
 *  (no baseline snapshot yet) yields rows with null baseline/health. */
export function computeVariance(
  baseline: SnapshotRecord | null,
  current: SnapshotRecord,
): VarianceRow[] {
  const num = (key: VarianceKey, b: number | null, c: number | null, health: Health | null): VarianceRow => ({
    key, baseline: b, current: c,
    delta: b === null || c === null ? null : c - b,
    health: baseline === null ? null : health,
  });
  const rows: VarianceRow[] = [
    num("remainingHours", baseline?.remainingHours ?? null, current.remainingHours, worseIfHigher(baseline?.remainingHours ?? null, current.remainingHours)),
    num("remainingCost", baseline?.remainingCost ?? null, current.remainingCost, worseIfHigher(baseline?.remainingCost ?? null, current.remainingCost)),
    num("pctComplete", baseline?.pctComplete ?? null, current.pctComplete, worseIfLower(baseline?.pctComplete ?? null, current.pctComplete)),
    num("spi", baseline?.spi ?? null, current.spi, worseIfLower(baseline?.spi ?? null, current.spi)),
    num("cpi", baseline?.cpi ?? null, current.cpi, worseIfLower(baseline?.cpi ?? null, current.cpi)),
  ];
  const deltaDays = baseline ? daysBetween(baseline.forecastEndDate, current.forecastEndDate) : undefined;
  rows.push({
    key: "forecastEndDate",
    baseline: null,
    current: null,
    delta: null,
    deltaDays,
    health: baseline === null ? null : (deltaDays! > 0 ? "R" : "G"),
  });
  return rows;
}

/** Per-milestone committed baseline (`target`) dates from the pinned baseline
 *  snapshot, keyed by milestone id. Empty when no snapshot is flagged
 *  `isBaseline`. Pure — the Gantt overlays these behind the live diamonds. */
export function baselineMilestoneTargets(
  snapshots: readonly SnapshotRecord[],
): Map<number, string> {
  const base = snapshots.find((s) => s.isBaseline);
  const map = new Map<number, string>();
  if (!base) return map;
  for (const m of base.milestones) map.set(m.id, m.target);
  return map;
}
