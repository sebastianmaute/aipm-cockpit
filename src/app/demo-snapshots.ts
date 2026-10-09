// src/app/demo-snapshots.ts
//
// Replays the sample master week by week into Trends snapshot records, for the
// demo project's seeded history (`scripts/generate-demo-snapshots.ts` writes the
// result to `sample-demo-snapshots.json`). Pure and i18n-free: no clock, no I/O.
//
// ★ Each record is built by the SAME two calls the live capture makes in
// `use-trend-snapshots.ts` — `computeDashboard(buildLiveDashboardInput(…, null))`
// then `buildSnapshot` — over the workspace as it stood that Friday. Do not
// re-derive any figure here.
//
// ★ ACCEPTED LIMITATION: the master records only today's state plus the dates on
// which facts happened, so `workspaceAsOf` is an approximation. It removes rows
// created after the date and reverts dated state changes; the undated values the
// engines read (task time spent, a bucket's hand-entered `percentComplete`) are
// prorated linearly over their own window, which is a guess, not a record.

import { withBlockerLog } from "./blocker-log";
import { buildLiveDashboardInput, computeDashboard } from "./dashboard";
import { isDayKey } from "./actual-hours";
import { defaultSettings } from "./settings-types";
import { buildSnapshot, type SnapshotRecord } from "./snapshot";
import { addCalendarDays, calendarDaysBetween, periodBounds } from "./working-days";
import {
  ASSUMPTION_STATUSES, DEPENDENCY_STATUSES, ISSUE_STATUSES, RISK_STATUSES,
  type BudgetBucket, type ChangeItem, type Milestone, type ProjectStatus, type RaidCategory,
  type RaidItem, type RaidStatus, type Task,
} from "./types";
import { DEMO_AS_OF } from "./demo-workspace";
import type { Workspace } from "./workspace";

/** Hour of the replayed capture, matching an end-of-day Friday auto-capture. */
const CAPTURE_TIME = "T17:00:00.000Z";
const FRIDAY = 5;

/** A RAID item reopened by the replay takes its category's FIRST status — the one
 *  a new item starts in. The status it held before closing is not recorded. */
const REOPEN_STATUS: Record<RaidCategory, RaidStatus> = {
  R: RISK_STATUSES[0],
  A: ASSUMPTION_STATUSES[0],
  I: ISSUE_STATUSES[0],
  D: DEPENDENCY_STATUSES[0],
};

/** A change decided after the date reverts to "Under Review", the pending status a
 *  change sits in while awaiting its decision; the status it held before is not recorded. */
const PRE_DECISION_STATUS: ChangeItem["status"] = "Under Review";

/** A copy of `row` without `keys` (the input is untouched). */
function without<T extends object, K extends keyof T>(row: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...row };
  for (const k of keys) delete copy[k];
  return copy;
}

/** True when an ISO date or timestamp falls on a day after `asOf` (YYYY-MM-DD). */
const after = (iso: string | undefined, asOf: string): boolean => !!iso && iso.slice(0, 10) > asOf;

/** The undated task fields only work on the task can produce: none of them can
 *  predate the task, so a task not yet created by `asOf` sheds them. */
const WORK_FIELDS = ["healthOverride", "timeSpentMinutes", "remainingEstimateMinutes"] as const;

/**
 * `timeSpentMinutes` (the only spent-effort field `computeEvm` reads) is undated,
 * so it is prorated by the share of the task's own window elapsed at `asOf`. The
 * window runs from `startDate` to the task's `completedDate`, or to `now` for a
 * task still open. Without a start, or with a window of zero (or negative) length,
 * the task carries all of its effort once the window has ended and none before.
 * ★ Unprorated, a reopened task kept its FINAL time spent while earning no value,
 * and the replay's baseline CPI read 0.25 with a red Budget RAG.
 */
function spentMinutesAsOf(t: Task, asOf: string, now: string): number | undefined {
  const spent = t.timeSpentMinutes;
  if (spent === undefined) return undefined;
  return Math.round(spent * elapsedShare(t.startDate, t.completedDate || now, asOf));
}

/** Share (0–1) of the window `start` → `end` elapsed at `asOf`. Without a start, or
 *  for a window of zero (or negative) length: 1 once `end` ≤ `asOf`, else 0. */
function elapsedShare(start: string | undefined, end: string, asOf: string): number {
  const span = start ? calendarDaysBetween(start, end) : 0;
  if (!start || span <= 0) return end <= asOf ? 1 : 0;
  return Math.min(1, Math.max(0, calendarDaysBetween(start, asOf) / span));
}

function taskAsOf(t: Task, asOf: string, now: string): Task {
  let out = t;
  const notYetCreated = after(t.createdDate, asOf);
  if (notYetCreated) {
    // ★ KEPT, not removed: the sample's tasks are the project's planned scope, and
    // removing the later ones would shrink the denominator of every early
    // pctComplete (the replay read 50% → 33% → 50% in March when it did).
    out = without(out, ...WORK_FIELDS);
  }
  const spent = spentMinutesAsOf(out, asOf, now);
  if (spent !== undefined && spent !== out.timeSpentMinutes) out = { ...out, timeSpentMinutes: spent };
  if (after(t.completedDate, asOf)) {
    // Reopen: status and completedDate move together (docs/AGENTS/task-status.md).
    // The status before completion is not recorded: a task whose planned start is
    // still ahead had not begun, any other was being worked on.
    out = { ...without(out, "completedDate"), status: after(t.startDate, asOf) ? "To Do" : "In Progress" };
  }
  // A task that did not exist yet had not begun either (Cancelled is undated, so it stays).
  if (notYetCreated && out.status !== "Cancelled") out = { ...out, status: "To Do" };
  if (after(out.lastUpdateDate, asOf)) out = { ...out, lastUpdateDate: asOf };
  if (out.blockerLog?.some((b) => after(b.createdAt, asOf) || after(b.resolvedAt, asOf))) {
    const log = out.blockerLog
      .filter((b) => !after(b.createdAt, asOf))
      .map((b) => {
        if (!after(b.resolvedAt, asOf)) return b;
        return without(b, "resolvedAt");
      });
    out = withBlockerLog(out, log);
  }
  return out;
}

function raidAsOf(r: RaidItem, asOf: string): RaidItem {
  if (!after(r.closedDate, asOf)) return r;
  return { ...without(r, "closedDate"), status: REOPEN_STATUS[r.category] };
}

function changeAsOf(c: ChangeItem, asOf: string): ChangeItem {
  if (!after(c.decisionDate, asOf)) return c;
  return { ...without(c, "decisionDate", "decisionBy"), status: PRE_DECISION_STATUS };
}

function milestoneAsOf(m: Milestone, asOf: string): Milestone {
  if (!after(m.achievedDate, asOf)) return m;
  return without(m, "achievedDate");
}

/** An actual-hours key is booked after `asOf` when its day (a day key) or the
 *  first day of its period (a month or ISO-week key) is later. Unknown keys stay. */
function actualAfter(key: string, asOf: string): boolean {
  if (isDayKey(key)) return key > asOf;
  const bounds = periodBounds(key);
  return bounds !== null && bounds.start > asOf;
}

function actualsAsOf<A extends { actualHours: Record<string, number> }>(a: A, asOf: string): A {
  const actualHours = Object.fromEntries(Object.entries(a.actualHours).filter(([k]) => !actualAfter(k, asOf)));
  return { ...a, actualHours };
}

function bucketAsOf(b: BudgetBucket, asOf: string, now: string): BudgetBucket {
  let out: BudgetBucket = {
    ...b,
    allocations: b.allocations.map((a) => actualsAsOf(a, asOf)),
    ...(b.disciplineAllocations ? { disciplineAllocations: b.disciplineAllocations.map((a) => actualsAsOf(a, asOf)) } : {}),
  };
  if (after(b.closedDate, asOf)) {
    out = { ...without(out, "closedDate"), status: "open" };
  }
  // A hand-entered percentComplete is undated: it is prorated over the bucket's
  // window, and a bucket not yet started has none, so `bucketPercentComplete`
  // falls back as for a bucket never given one. The stored value is TODAY's, like
  // an open task's time spent, so the window ends at min(endDate, now): ending it
  // at a later endDate left the last seeded week short of it (14 → 30 for bucket 4).
  if (b.percentComplete !== undefined) {
    out = after(b.startDate, asOf)
      ? without(out, "percentComplete")
      : { ...out, percentComplete: Math.round(b.percentComplete * elapsedShare(b.startDate, b.endDate < now ? b.endDate : now, asOf)) };
  }
  return out;
}

/** The PM status (overrides + narrative) carries one timestamp for the whole set.
 *  Set after `asOf`, it is dropped: no override, so the computed RAGs show. */
function statusAsOf(s: ProjectStatus | undefined, asOf: string): ProjectStatus {
  if (!s || after(s.narrativeUpdatedAt, asOf)) return {};
  return s;
}

/**
 * The workspace as it stood at the end of `asOf` (YYYY-MM-DD), reconstructed from
 * its dated facts. Rows created after the date are removed (RAID and changes by
 * `raisedDate`, buckets by `createdDate`, activity and budget history by their
 * dates) — except tasks, which are planned scope and are kept as not-yet-started
 * (see `taskAsOf`); later state changes on earlier rows are reverted (task
 * completion, blockers, RAID closure, change decision, milestone achievement, bucket
 * closure, PM status), and actuals booked in later periods are dropped. Task time
 * spent and a bucket's hand-entered percentComplete are prorated over their own
 * window (see `spentMinutesAsOf` and `bucketAsOf`), which ends no later than `now`,
 * the date the master describes (`DEMO_AS_OF`). Ids that
 * other rows reference may dangle afterwards, as after a live delete, which every
 * engine tolerates. The slices the dashboard does not read are returned unchanged.
 * The input is not mutated.
 */
export function workspaceAsOf(ws: Workspace, asOf: string, now: string = DEMO_AS_OF): Workspace {
  return {
    ...ws,
    tasks: ws.tasks.map((t) => taskAsOf(t, asOf, now)),
    raid: ws.raid.filter((r) => !after(r.raisedDate, asOf)).map((r) => raidAsOf(r, asOf)),
    changes: (ws.changes ?? []).filter((c) => !after(c.raisedDate, asOf)).map((c) => changeAsOf(c, asOf)),
    milestones: (ws.milestones ?? []).map((m) => milestoneAsOf(m, asOf)),
    budgets: (ws.budgets ?? []).filter((b) => !after(b.createdDate, asOf)).map((b) => bucketAsOf(b, asOf, now)),
    activityLog: (ws.activityLog ?? []).filter((a) => !after(a.timestamp, asOf)),
    budgetHistory: (ws.budgetHistory ?? []).filter((h) => !after(h.date, asOf)),
    status: statusAsOf(ws.status, asOf),
  };
}

/**
 * The replay Fridays: from the SECOND Friday after `startDate` (a start on a Friday
 * does not count as the first) through the last Friday strictly before `asOf`.
 */
export function demoSnapshotFridays(startDate: string, asOf: string): string[] {
  const dow = new Date(`${startDate}T00:00:00.000Z`).getUTCDay();
  const firstFriday = addCalendarDays(startDate, ((FRIDAY - dow + 7) % 7) || 7);
  const out: string[] = [];
  for (let d = addCalendarDays(firstFriday, 7); d < asOf; d = addCalendarDays(d, 7)) out.push(d);
  return out;
}

/** One record per replay Friday, captured at that Friday's `CAPTURE_TIME`; the first
 *  is the baseline. Mirrors `useTrendSnapshots`' `buildContext` call for call. */
export function buildDemoSnapshots(ws: Workspace, asOf: string): SnapshotRecord[] {
  return demoSnapshotFridays(ws.plan.startDate, asOf).map((friday, i) => {
    const w = workspaceAsOf(ws, friday, asOf);
    const tasks = w.tasks as Task[];
    const milestones = w.milestones ?? [];
    const budgets = w.budgets ?? [];
    const model = computeDashboard(
      buildLiveDashboardInput(
        {
          tasks, raid: w.raid, budgets, plan: w.plan, roles: w.roles, resources: w.resources,
          absences: w.absences, fxRates: w.fxRates ?? null, milestones, changes: w.changes ?? [],
          budgetHistory: w.budgetHistory ?? [],
        },
        {
          workdayHours: defaultSettings.resources.workdayHours,
          holidaySet: new Set<string>(),
          status: w.status ?? {},
          activity: w.activityLog ?? [],
          today: friday,
        },
        null,
      ),
    );
    const record = buildSnapshot({
      model, tasks, milestones, buckets: budgets, planEndDate: w.plan.endDate,
      capturedAt: `${friday}${CAPTURE_TIME}`, cadence: "weekly", trigger: "auto",
    });
    return { ...record, isBaseline: i === 0 };
  });
}
