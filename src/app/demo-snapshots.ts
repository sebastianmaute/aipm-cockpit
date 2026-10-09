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
// created after the date and reverts dated state changes, but undated values
// (task effort, a bucket's hand-entered `percentComplete`) keep today's figure.

import { withBlockerLog } from "./blocker-log";
import { buildLiveDashboardInput, computeDashboard } from "./dashboard";
import { isDayKey } from "./actual-hours";
import { defaultSettings } from "./settings-types";
import { buildSnapshot, type SnapshotRecord } from "./snapshot";
import { addCalendarDays, periodBounds } from "./working-days";
import {
  ASSUMPTION_STATUSES, DEPENDENCY_STATUSES, ISSUE_STATUSES, RISK_STATUSES,
  type BudgetBucket, type ChangeItem, type Milestone, type ProjectStatus, type RaidCategory,
  type RaidItem, type RaidStatus, type Task,
} from "./types";
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

function taskAsOf(t: Task, asOf: string): Task {
  let out = t;
  const notYetCreated = after(t.createdDate, asOf);
  if (notYetCreated) {
    // ★ KEPT, not removed: the sample's tasks are the project's planned scope, and
    // removing the later ones would shrink the denominator of every early
    // pctComplete (the replay read 50% → 33% → 50% in March when it did).
    out = without(out, ...WORK_FIELDS);
  }
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

function bucketAsOf(b: BudgetBucket, asOf: string): BudgetBucket {
  let out: BudgetBucket = {
    ...b,
    allocations: b.allocations.map((a) => actualsAsOf(a, asOf)),
    ...(b.disciplineAllocations ? { disciplineAllocations: b.disciplineAllocations.map((a) => actualsAsOf(a, asOf)) } : {}),
  };
  if (after(b.closedDate, asOf)) {
    out = { ...without(out, "closedDate"), status: "open" };
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
 * closure, PM status), and actuals booked in later periods are dropped. Ids that
 * other rows reference may dangle afterwards, as after a live delete, which every
 * engine tolerates. The slices the dashboard does not read are returned unchanged.
 * The input is not mutated.
 */
export function workspaceAsOf(ws: Workspace, asOf: string): Workspace {
  return {
    ...ws,
    tasks: ws.tasks.map((t) => taskAsOf(t, asOf)),
    raid: ws.raid.filter((r) => !after(r.raisedDate, asOf)).map((r) => raidAsOf(r, asOf)),
    changes: (ws.changes ?? []).filter((c) => !after(c.raisedDate, asOf)).map((c) => changeAsOf(c, asOf)),
    milestones: (ws.milestones ?? []).map((m) => milestoneAsOf(m, asOf)),
    budgets: (ws.budgets ?? []).filter((b) => !after(b.createdDate, asOf)).map((b) => bucketAsOf(b, asOf)),
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
    const w = workspaceAsOf(ws, friday);
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
