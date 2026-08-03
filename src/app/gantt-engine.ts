// Pure Gantt engine — preferences (localStorage-backed), date helpers, bar
// derivation, and the critical-path (CPM) algorithm, extracted verbatim from
// gantt.tsx.
//
// Constraint: no React, no DOM, no JSX. Everything here is plain data and
// functions, unit-testable without jsdom. The only browser API touched is
// localStorage in loadPrefs/savePrefs, guarded for SSR via `typeof window`.

import { addDays } from "./calendar-window";
import type { Lang } from "./i18n";
import { isPlainObject } from "./sanitize";
import { PRIORITIES, type AbsenceType, type DependencyType, type Milestone, type Priority, type Task } from "./types";

// --- preferences ----------------------------------------------------------

/** Sort modes — match the dropdown's option order. */
const GANTT_SORTS = [
  "auto",
  "due",
  "name",
  "priority",
  "custom",
] as const;
export type GanttSort = (typeof GANTT_SORTS)[number];

/** Concrete status buckets a task can be filtered to. Under the v2 prefs
 *  schema an empty `statuses` array means "show nothing", not "show all" —
 *  see `GanttPrefs.statuses`. */
export const GANTT_STATUS_VALUES = ["open", "completed", "overdue"] as const;
export type GanttStatus = (typeof GANTT_STATUS_VALUES)[number];

/** Every status bucket, i.e. the "everything ticked" filter state.
 *  Frozen and typed `readonly` on purpose: it backs `DEFAULT_PREFS.statuses`
 *  and every reset, so an in-place `sort()`/`push()` by any consumer would
 *  silently corrupt the default for the rest of the session. Spread it
 *  (`[...ALL_GANTT_STATUSES]`) wherever a mutable `GanttStatus[]` is needed. */
export const ALL_GANTT_STATUSES: readonly GanttStatus[] = Object.freeze([
  ...GANTT_STATUS_VALUES,
]);

/** Where milestone rows render relative to the task rows:
 *  - "below" (default): all milestones as a block beneath the task rows.
 *  - "inline": each non-achieved milestone spliced into the task rows at its
 *    chronological (due-date) position. */
export const GANTT_MILESTONE_PLACEMENTS = ["below", "inline"] as const;
export type MilestonePlacement = (typeof GANTT_MILESTONE_PLACEMENTS)[number];

export type GanttPrefs = {
  sort: GanttSort;
  search: string;
  /** Selected status buckets. EMPTY MEANS SHOW NOTHING (v2 semantics) — the
   *  chart renders an explicit "no status selected" message instead of an
   *  empty grid. Pre-v2 blobs stored `[]` to mean "show everything"; loadPrefs
   *  migrates those. OR within the filter. */
  statuses: GanttStatus[];
  /** Selected priorities; empty = all. OR within the filter. */
  priorities: Priority[];
  /** Selected (resolved) assignee names; empty = all. OR within the filter. */
  assignees: string[];
  /** Task ids in user-defined order (drag-and-drop). Ignored unless
   *  `sort === "custom"`. */
  customOrder: number[];
  /** When true, the chart paints critical-path tasks with a red ring and
   *  the dependency arrows between them in red. Defaults on. */
  showCriticalPath: boolean;
  /** When true, milestones show a hollow ghost diamond at their committed
   *  baseline date (from the pinned snapshot) with a connector + slip label.
   *  Defaults on; only visible when baseline data exists (Turso). */
  showBaseline: boolean;
  /** Where milestone rows render relative to the task rows. Defaults to
   *  "below" (the historical block-beneath-tasks layout). */
  milestonePlacement: MilestonePlacement;
  /** Shade non-working public holidays as full-height columns. */
  showHolidays: boolean;
  /** Draw the per-row absence bands. */
  showAbsences: boolean;
  /** Draw the dependency arrows between task bars. */
  showDependencies: boolean;
  /** Render milestone rows at all (independent of the status filter). */
  showMilestones: boolean;
  /** Dotted vertical day lines, aligned to the header's day columns. */
  showGrid: boolean;
};

const PREFS_KEY = "aipm-cockpit:gantt-prefs";

/** Persisted prefs schema version. v2 flipped the meaning of an empty
 *  `statuses` array from "show everything" to "show nothing". */
export const GANTT_PREFS_VERSION = 2;

export const DEFAULT_PREFS: GanttPrefs = {
  sort: "auto",
  search: "",
  statuses: [...ALL_GANTT_STATUSES],
  priorities: [],
  assignees: [],
  customOrder: [],
  showCriticalPath: true,
  showBaseline: true,
  milestonePlacement: "below",
  showHolidays: true,
  showAbsences: true,
  showDependencies: true,
  showMilestones: true,
  showGrid: false,
};

/** De-duplicate while preserving first-seen order. */
function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** Parse the status filter, migrating the legacy scalar `status` key. */
function parseStatusFilters(parsed: Record<string, unknown>): GanttStatus[] {
  const allowed = GANTT_STATUS_VALUES as readonly string[];
  if (Array.isArray(parsed.statuses)) {
    return uniq(
      parsed.statuses.filter((s): s is GanttStatus =>
        allowed.includes(s as string),
      ),
    );
  }
  return typeof parsed.status === "string" && allowed.includes(parsed.status)
    ? [parsed.status as GanttStatus]
    : [];
}

/** Parse the priority filter, migrating the legacy scalar `priority` key. */
function parsePriorityFilters(parsed: Record<string, unknown>): Priority[] {
  const allowed = PRIORITIES as readonly string[];
  if (Array.isArray(parsed.priorities)) {
    return uniq(
      parsed.priorities.filter((p): p is Priority =>
        allowed.includes(p as string),
      ),
    );
  }
  return typeof parsed.priority === "string" && allowed.includes(parsed.priority)
    ? [parsed.priority as Priority]
    : [];
}

/** Parse the assignee filter, migrating the legacy scalar `assignee` key. */
function parseAssigneeFilters(parsed: Record<string, unknown>): string[] {
  if (Array.isArray(parsed.assignees)) {
    return uniq(
      parsed.assignees.filter(
        (a): a is string => typeof a === "string" && a.trim() !== "",
      ),
    );
  }
  return typeof parsed.assignee === "string" &&
    parsed.assignee !== "All" &&
    parsed.assignee.trim() !== ""
    ? [parsed.assignee]
    : [];
}

export function loadPrefs(): GanttPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) return DEFAULT_PREFS;
    const sort = (GANTT_SORTS as readonly string[]).includes(
      parsed.sort as string,
    )
      ? (parsed.sort as GanttSort)
      : DEFAULT_PREFS.sort;
    // Status/priority/assignee are multi-select arrays (empty = all). Migrate
    // from the legacy scalar keys (status/priority/assignee, with "all"/"All"
    // sentinels) when a saved prefs blob predates the multi-select change.
    const statuses = parseStatusFilters(parsed);
    const priorities = parsePriorityFilters(parsed);
    const assignees = parseAssigneeFilters(parsed);
    // v1 stored `[]` to mean "show everything". Under v2 that means "show
    // nothing", so carrying it forward verbatim would open the chart empty for
    // every existing user. A non-empty v1 list means the same under both
    // schemas and passes through untouched. `priorities`/`assignees` keep the
    // empty-means-all semantics, so only the status filter migrates.
    const isV2 = parsed.v === GANTT_PREFS_VERSION;
    const migratedStatuses =
      !isV2 && statuses.length === 0 ? [...ALL_GANTT_STATUSES] : statuses;
    return {
      sort,
      search: typeof parsed.search === "string" ? parsed.search : "",
      statuses: migratedStatuses,
      priorities,
      assignees,
      customOrder: Array.isArray(parsed.customOrder)
        ? parsed.customOrder.filter((n): n is number => typeof n === "number")
        : [],
      // Older saved prefs (pre critical-path feature) won't have this field;
      // missing means "on", matching the new default.
      showCriticalPath:
        typeof parsed.showCriticalPath === "boolean"
          ? parsed.showCriticalPath
          : DEFAULT_PREFS.showCriticalPath,
      // Older saved prefs won't have this field; missing means "on".
      showBaseline:
        typeof parsed.showBaseline === "boolean"
          ? parsed.showBaseline
          : DEFAULT_PREFS.showBaseline,
      // Older saved prefs won't have this field; missing means "below".
      milestonePlacement: (GANTT_MILESTONE_PLACEMENTS as readonly string[]).includes(
        parsed.milestonePlacement as string,
      )
        ? (parsed.milestonePlacement as MilestonePlacement)
        : DEFAULT_PREFS.milestonePlacement,
      // Display toggles; older saved prefs won't have these fields, so a
      // missing value falls back to the default.
      showHolidays:
        typeof parsed.showHolidays === "boolean"
          ? parsed.showHolidays
          : DEFAULT_PREFS.showHolidays,
      showAbsences:
        typeof parsed.showAbsences === "boolean"
          ? parsed.showAbsences
          : DEFAULT_PREFS.showAbsences,
      showDependencies:
        typeof parsed.showDependencies === "boolean"
          ? parsed.showDependencies
          : DEFAULT_PREFS.showDependencies,
      showMilestones:
        typeof parsed.showMilestones === "boolean"
          ? parsed.showMilestones
          : DEFAULT_PREFS.showMilestones,
      showGrid:
        typeof parsed.showGrid === "boolean"
          ? parsed.showGrid
          : DEFAULT_PREFS.showGrid,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: GanttPrefs): void {
  if (typeof window === "undefined") return;
  try {
    // Stamp the schema version so the next load knows the blob is already
    // migrated and leaves a deliberately-emptied status filter alone.
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ ...p, v: GANTT_PREFS_VERSION }),
    );
  } catch {
    // Quota / disabled — drop silently.
  }
}

const DAY_MS = 86_400_000;
export const DAY_WIDTH_PX = 28; // ~one day per column
export const ROW_HEIGHT_PX = 32;
export const HEADER_ROW_HEIGHT_PX = 22; // each of the two header rows
export const HEADER_HEIGHT_PX = HEADER_ROW_HEIGHT_PX * 2;
export const LEFT_GUTTER_PX = 240; // task-name column width (runtime default)
export const GANTT_NAME_COL_MIN = 140;
export const GANTT_NAME_COL_MAX = 560;
/** Clamp a candidate task-name column width to sane bounds; non-finite → default. */
export function clampNameColWidth(w: number): number {
  if (!Number.isFinite(w)) return LEFT_GUTTER_PX;
  return Math.max(GANTT_NAME_COL_MIN, Math.min(GANTT_NAME_COL_MAX, Math.round(w)));
}
export const BAR_HEIGHT_PX = 18;
export const BAR_VPADDING_PX = (ROW_HEIGHT_PX - BAR_HEIGHT_PX) / 2;
// Size of the chart-scale timeline diamond. The gutter uses a fixed 16-viewBox
// icon (intentionally small/independent of chart scale) — see comment below.
export const MILESTONE_DIAMOND_PX = 14;
export const EDGE_STROKE_MUTED = "rgb(99, 99, 98)";

// Milestone status math takes a holiday set; the Gantt has no holiday data
// of its own, so we pass a shared empty set rather than allocating per row.
export const EMPTY_HOLIDAY_SET: ReadonlySet<string> = new Set<string>();

// Priority → bar fill class. Matches the priority pill colors elsewhere.
export const priorityFillClass: Record<Priority, string> = {
  Low: "fill-ui-medium-grey",
  Medium: "fill-ui-blue",
  High: "fill-ui-purple",
  Urgent: "fill-ui-pink",
};

// ---------- date helpers --------------------------------------------------

export function parseISO(s: string | undefined | null): Date | null {
  if (!s) return null;
  // YYYY-MM-DD or full ISO — both work for Date constructor.
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  // Normalize to start of day (UTC) so cross-timezone math is stable.
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

export function todayUTC(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
}

export function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** Signed day slip of a milestone's live date vs its baseline target:
 *  positive = slipped later, negative = pulled in, 0 = on baseline.
 *  `null` when either date is unparseable. Pure (reuses parseISO/diffDays). */
export function milestoneSlipDays(baselineISO: string, liveISO: string): number | null {
  const base = parseISO(baselineISO);
  const live = parseISO(liveISO);
  if (!base || !live) return null;
  return diffDays(base, live);
}

// Re-exported, not redefined: calendar-window.ts owns the one implementation.
// Kept exported from here so gantt.tsx / gantt-chrome.tsx keep importing it
// from this module unchanged.
export { addDays };

export function fmtMonth(d: Date, lang: Lang): string {
  return d.toLocaleString(lang === "de" ? "de-DE" : "en-US", {
    month: "short",
    year: "numeric",
  });
}

export function fmtDay(d: Date): string {
  return String(d.getUTCDate());
}

/** YYYY-MM-DD (UTC) for a Date — pure, no mutation of the input. */
export function toISODay(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fmtFull(d: Date, lang: Lang): string {
  return d.toLocaleDateString(lang === "de" ? "de-DE" : "en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

// ---------- bar derivation -------------------------------------------------

/**
 * Compute the [start, end] anchor dates for a task's bar. `predEdges` lets us
 * pull predecessor edges out of an already-built per-task lookup, so callers
 * don't recompute repeatedly.
 */
export function deriveBar(
  task: Task,
  predEdges: ReadonlyMap<number, { start: Date; end: Date }>,
): { start: Date; end: Date } | null {
  const due = parseISO(task.dueDate);
  if (!due) return null;
  const end = parseISO(task.completedDate) ?? due;

  // Priority for the bar's left edge:
  //   1. An explicit `task.startDate` (set by the user via the form or
  //      via Gantt drag-edit) wins. We assume the user knows what they're
  //      doing — predecessor anchors don't override it.
  //   2. Otherwise, derive from predecessor edges if any dependencies are
  //      present in the chart.
  //   3. Otherwise, fall back to `lastUpdateDate`, or `dueDate − 1 day` so
  //      every task gets at least a small visible bar.
  let start: Date | null = null;

  const explicit = parseISO(task.startDate);
  if (explicit) {
    start = explicit;
  } else if (task.dependencies && task.dependencies.length > 0) {
    let latest: Date | null = null;
    for (const dep of task.dependencies) {
      const pe = predEdges.get(dep.taskId);
      if (!pe) continue;
      const anchor = anchorForType(dep.type, pe);
      if (!latest || anchor.getTime() > latest.getTime()) latest = anchor;
    }
    if (latest) start = latest;
  }

  if (!start) {
    const last = parseISO(task.lastUpdateDate);
    start = last ?? new Date(due.getTime() - DAY_MS); // 1-day default span
  }

  // Clamp: start must be <= end. If the source date lands past the due
  // date we still show a 0-day milestone at the end (don't run backwards).
  if (start.getTime() > end.getTime()) start = end;

  return { start, end };
}

/** Natural sort: by start ASC, then end ASC, then id — matches the original
 *  pre-toolbar Gantt order. */
export function naturalCompare(
  a: Task,
  b: Task,
  bars: ReadonlyMap<number, { start: Date; end: Date }>,
): number {
  const ba = bars.get(a.id);
  const bb = bars.get(b.id);
  if (!ba || !bb) return a.id - b.id;
  const ds = ba.start.getTime() - bb.start.getTime();
  if (ds !== 0) return ds;
  const de = ba.end.getTime() - bb.end.getTime();
  if (de !== 0) return de;
  return a.id - b.id;
}

// ---------- row assembly (task + milestone interleaving) ------------------

/** One rendered Gantt row: either a task bar row or a milestone diamond row. */
export type GanttRow =
  | { kind: "task"; task: Task }
  | { kind: "milestone"; milestone: Milestone };

/**
 * Assemble the ordered Gantt row list from the (already filtered + sorted)
 * task list and the (already date-sorted) milestone list.
 *
 * - "below" (default): every task row, then every milestone row — the
 *   historical layout, byte-for-byte the previous ordering.
 * - "inline": each NON-achieved milestone is spliced into the task sequence at
 *   its chronological position — before the first task whose bar end falls
 *   on/after the milestone's date. Achieved milestones (and any milestone with
 *   an unparseable date) fall to the end, matching the below layout so we never
 *   place a diamond at a bad position or crash.
 *
 * Pure: `bars` supplies each task's end date; `sortedMilestones` must already be
 * date-ascending (the caller sorts once). No React, DOM, or `new Date()` of now.
 */
export function buildGanttRows(
  tasks: readonly Task[],
  sortedMilestones: readonly Milestone[],
  placement: MilestonePlacement,
  bars: ReadonlyMap<number, { start: Date; end: Date }>,
): GanttRow[] {
  const taskRows: GanttRow[] = tasks.map((task) => ({ kind: "task", task }));
  if (placement !== "inline") {
    return [
      ...taskRows,
      ...sortedMilestones.map(
        (milestone): GanttRow => ({ kind: "milestone", milestone }),
      ),
    ];
  }

  // Split into date-inlinable (non-achieved, parseable date) and trailing
  // (achieved, or unparseable date). Both keep sortedMilestones' order, which
  // is date-ascending for the inlinable set.
  const inlineMs: Array<{ milestone: Milestone; end: number }> = [];
  const trailingMs: Milestone[] = [];
  for (const m of sortedMilestones) {
    const d = m.achievedDate ? null : parseISO(m.date);
    if (d) inlineMs.push({ milestone: m, end: d.getTime() });
    else trailingMs.push(m);
  }

  const rows: GanttRow[] = [];
  let i = 0;
  for (const task of tasks) {
    const bar = bars.get(task.id);
    const taskEnd = bar ? bar.end.getTime() : null;
    // Flush every pending milestone due on/before this task's end. Skipped when
    // the task has no bar (taskEnd null) so those milestones flow further down.
    while (
      i < inlineMs.length &&
      taskEnd !== null &&
      inlineMs[i].end <= taskEnd
    ) {
      rows.push({ kind: "milestone", milestone: inlineMs[i].milestone });
      i++;
    }
    rows.push({ kind: "task", task });
  }
  // Milestones later than every task (or anchored by a bar-less task).
  for (; i < inlineMs.length; i++) {
    rows.push({ kind: "milestone", milestone: inlineMs[i].milestone });
  }
  // Achieved / unparseable-date milestones stay at the very end.
  for (const m of trailingMs) rows.push({ kind: "milestone", milestone: m });
  return rows;
}

function anchorForType(
  type: DependencyType,
  pe: { start: Date; end: Date },
): Date {
  switch (type) {
    case "FS":
      // This task starts the day after the predecessor finishes.
      return addDays(pe.end, 1);
    case "SS":
      // This task can start when the predecessor starts.
      return pe.start;
    case "FF":
      // This task can finish when the predecessor finishes — start by
      // matching its end.
      return pe.end;
    case "SF":
      // Rare. We use the predecessor's start as our earliest end.
      return pe.start;
  }
}

// ---------- critical path -------------------------------------------------

/** Stable string key for a directed dependency edge. */
export function edgeKey(predId: number, succId: number, type: DependencyType): string {
  return `${predId}->${succId}:${type}`;
}

/**
 * Classical CPM over the as-scheduled bars.
 *
 * Treats each task's bar as ES = bar.start, EF = bar.end, duration = EF − ES
 * (in days). Backward pass computes LF per task; slack = LF − EF. A task is
 * "critical" when slack ≤ 0 — the ≤ form (not ==) absorbs schedules the user
 * has already pushed past the predecessor constraints, which would otherwise
 * read as "negative slack" and silently disappear.
 *
 * Completed tasks are excluded — they can't drive future work. Edges that
 * reference a missing predecessor (filtered out of the chart, or dangling)
 * are skipped, never marked critical.
 *
 * Returns the set of critical task ids and the set of critical edge keys
 * (see `edgeKey`). Caller is responsible for deciding when to paint these.
 */
export function computeCriticalPath(
  tasks: readonly Task[],
  bars: ReadonlyMap<number, { start: Date; end: Date }>,
  completedIds: ReadonlySet<number>,
): { criticalTasks: Set<number>; criticalEdges: Set<string> } {
  // Map for O(1) task lookup by id.
  const byId = new Map<number, Task>();
  for (const t of tasks) byId.set(t.id, t);

  // Adjacency: predecessors (from task.dependencies) + reverse (successors).
  // Both restricted to tasks that have a bar (filtered = absent).
  const preds = new Map<number, Array<{ predId: number; type: DependencyType }>>();
  const succs = new Map<number, Array<{ succId: number; type: DependencyType }>>();
  for (const t of tasks) {
    if (!bars.has(t.id)) continue;
    if (completedIds.has(t.id)) continue;
    const list: Array<{ predId: number; type: DependencyType }> = [];
    for (const dep of t.dependencies ?? []) {
      if (!bars.has(dep.taskId)) continue;
      if (completedIds.has(dep.taskId)) continue;
      if (dep.taskId === t.id) continue; // ignore self-edges
      list.push({ predId: dep.taskId, type: dep.type });
      const sl = succs.get(dep.taskId) ?? [];
      sl.push({ succId: t.id, type: dep.type });
      succs.set(dep.taskId, sl);
    }
    if (list.length > 0) preds.set(t.id, list);
  }

  // Durations (days). Bars whose end < start are clamped to 0 by deriveBar,
  // but be defensive anyway.
  const dur = new Map<number, number>();
  for (const [id, bar] of bars) {
    if (completedIds.has(id)) continue;
    dur.set(id, Math.max(0, diffDays(bar.start, bar.end)));
  }

  // Topological order via Kahn's algorithm. Cycles aren't expected (the
  // dependency editor blocks them in principle), but if one slips through
  // we want to fail closed: leftover tasks stay out of the critical set.
  const inDeg = new Map<number, number>();
  for (const id of dur.keys()) inDeg.set(id, (preds.get(id) ?? []).length);
  const queue: number[] = [];
  for (const [id, deg] of inDeg) {
    if (deg === 0) queue.push(id);
  }
  const topo: number[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as number;
    topo.push(id);
    for (const s of succs.get(id) ?? []) {
      const nd = (inDeg.get(s.succId) ?? 0) - 1;
      inDeg.set(s.succId, nd);
      if (nd === 0) queue.push(s.succId);
    }
  }

  // EF as-scheduled (use bar.end directly — no rescheduling).
  const ef = new Map<number, Date>();
  for (const id of topo) {
    const bar = bars.get(id);
    if (bar) ef.set(id, bar.end);
  }

  // Project end = max EF across the topo set. Falls back to today if there's
  // nothing schedulable.
  let projectEnd: Date | null = null;
  for (const d of ef.values()) {
    if (!projectEnd || d.getTime() > projectEnd.getTime()) projectEnd = d;
  }
  if (!projectEnd) {
    return { criticalTasks: new Set(), criticalEdges: new Set() };
  }

  // Backward pass — reverse topo order. LF(t) starts at projectEnd if t has
  // no successors, otherwise it's the min over successors of the constraint:
  //   FS:  LF(t) ≤ LF(s) − d(s) − 1
  //   SS:  LF(t) ≤ LF(s) − d(s) + d(t)
  //   FF:  LF(t) ≤ LF(s)
  //   SF:  LF(t) ≤ LF(s) + d(t)
  const lfMs = new Map<number, number>();
  const projectEndMs = projectEnd.getTime();
  for (let i = topo.length - 1; i >= 0; i--) {
    const id = topo[i];
    const outs = succs.get(id) ?? [];
    let lf = projectEndMs;
    if (outs.length > 0) {
      let limit = Infinity;
      for (const o of outs) {
        const sLf = lfMs.get(o.succId);
        if (sLf === undefined) continue;
        const sDurDays = dur.get(o.succId) ?? 0;
        const tDurDays = dur.get(id) ?? 0;
        let allowedMs: number;
        switch (o.type) {
          case "FS":
            allowedMs = sLf - sDurDays * DAY_MS - DAY_MS;
            break;
          case "SS":
            allowedMs = sLf - sDurDays * DAY_MS + tDurDays * DAY_MS;
            break;
          case "FF":
            allowedMs = sLf;
            break;
          case "SF":
            allowedMs = sLf + tDurDays * DAY_MS;
            break;
        }
        if (allowedMs < limit) limit = allowedMs;
      }
      if (Number.isFinite(limit)) lf = limit;
    }
    lfMs.set(id, lf);
  }

  // Slack = LF − EF (days, rounded — date math here is in whole-day steps).
  const criticalTasks = new Set<number>();
  for (const [id, efDate] of ef) {
    const lf = lfMs.get(id);
    if (lf === undefined) continue;
    const slackDays = Math.round((lf - efDate.getTime()) / DAY_MS);
    if (slackDays <= 0) criticalTasks.add(id);
  }

  // Critical edges: both endpoints critical AND the gap matches the type's
  // required minimum. Without this check, every dep edge whose endpoints
  // happen to both be critical would light up — including unrelated chains
  // that just happen to share a node.
  const criticalEdges = new Set<string>();
  for (const t of tasks) {
    if (!criticalTasks.has(t.id)) continue;
    for (const dep of t.dependencies ?? []) {
      if (!criticalTasks.has(dep.taskId)) continue;
      const predBar = bars.get(dep.taskId);
      const myBar = bars.get(t.id);
      if (!predBar || !myBar) continue;
      const predDur = dur.get(dep.taskId) ?? 0;
      const myDur = dur.get(t.id) ?? 0;
      // Required gap derived from the same math as the LF constraints above,
      // rewritten as "my dates must satisfy ___".
      let driving = false;
      switch (dep.type) {
        case "FS":
          // myStart should equal predEnd + 1 day.
          driving =
            Math.round(
              (myBar.start.getTime() - predBar.end.getTime()) / DAY_MS,
            ) <= 1;
          break;
        case "SS":
          driving =
            Math.round(
              (myBar.start.getTime() - predBar.start.getTime()) / DAY_MS,
            ) <= 0;
          break;
        case "FF":
          driving =
            Math.round(
              (myBar.end.getTime() - predBar.end.getTime()) / DAY_MS,
            ) <= 0;
          break;
        case "SF":
          driving =
            Math.round(
              (myBar.end.getTime() - predBar.start.getTime()) / DAY_MS,
            ) <= 0;
          break;
      }
      // Reference dur values so eslint doesn't complain about unused locals
      // in branches that don't read them (FF/SF don't need durations).
      void predDur;
      void myDur;
      if (driving) {
        criticalEdges.add(edgeKey(dep.taskId, t.id, dep.type));
      }
    }
  }

  return { criticalTasks, criticalEdges };
}

/**
 * Drag-edit callback: the panel emits a new `{start, end}` for `taskId`
 * when the user releases the bar. Both dates are `YYYY-MM-DD` strings.
 * The parent decides how to persist (typically `setTasks` to update
 * `startDate` + `dueDate`).
 */
export type GanttBarEdit = {
  taskId: number;
  startDate: string;
  dueDate: string;
};

// Absence-band color palette for Gantt row overlays. Faded variants so the
// task bar (which renders on top) remains legible. Matches the calendar
// view's hue choices in resource-calendar.tsx.
export function absenceBandBg(type: AbsenceType): string {
  switch (type) {
    case "vacation":
      return "bg-ui-blue/20 dark:bg-ui-blue/25";
    case "sick":
      return "bg-ui-pink/20 dark:bg-ui-pink/25";
    case "training":
      return "bg-ui-purple/20 dark:bg-ui-purple/25";
    default:
      return "bg-surface-muted";
  }
}

/** Shared visual props for both milestone diamond <rect>s (gutter + timeline).
 *  emerald mirrors healthDot.G (bg-emerald-500 RAG-green in health.ts);
 *  at-risk gets the AIPM pink ring (same token as overdue bars). */
export function milestoneDiamondProps(achieved: boolean, atRisk: boolean) {
  return {
    className: achieved ? "fill-emerald-500/50" : "fill-emerald-500",
    stroke: atRisk ? "var(--ui-pink)" : "none",
    strokeWidth: atRisk ? 2 : 0,
  } as const;
}
