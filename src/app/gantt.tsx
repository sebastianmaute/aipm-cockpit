"use client";

// Minimal Gantt chart for the workspace.
//
// Design choices:
//   • One row per task, vertical order = sort by start date then by id, so
//     predecessors tend to land above their successors.
//   • A task has no explicit `startDate` field. We derive it:
//       - If the task has predecessor dependencies AND any predecessor is
//         present in the chart, we anchor the bar's start at the latest
//         relevant predecessor edge (FS → predecessor.due + 1d, SS →
//         predecessor.start, FF → predecessor.due, SF → predecessor.start).
//       - Otherwise we fall back to lastUpdateDate (when last touched) or,
//         if that's after dueDate, dueDate itself so the bar collapses to a
//         milestone instead of running backwards.
//     The derived start never goes past the due date.
//   • Bar end = completedDate if set, otherwise dueDate.
//   • Bar color encodes priority. Completed bars are dimmed; overdue open
//     bars get an extra red outline.
//   • A vertical "today" marker spans the full chart height.
//   • Dependency arrows are drawn as SVG paths between predecessor and
//     dependent bars. They're skipped when the predecessor doesn't appear
//     in the chart (e.g. filtered out by a parent component).
//
// Nothing here is animated; this is a static, scrollable readout you can
// glance at. For dynamic editing, the user goes back to the tasks list.

import { useEffect, useMemo, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { isPlainObject } from "./sanitize";
import { useResizable } from "./use-resizable";
import { PRIORITIES, type Absence, type AbsenceType, type DependencyType, type Priority, type Task } from "./types";

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

export type GanttStatusFilter = "all" | "open" | "completed" | "overdue";

type GanttPrefs = {
  sort: GanttSort;
  search: string;
  status: GanttStatusFilter;
  priority: Priority | "All";
  assignee: string;
  /** Task ids in user-defined order (drag-and-drop). Ignored unless
   *  `sort === "custom"`. */
  customOrder: number[];
  /** When true, the chart paints critical-path tasks with a red ring and
   *  the dependency arrows between them in red. Defaults on. */
  showCriticalPath: boolean;
};

const PREFS_KEY = "lop-app:gantt-prefs";

const DEFAULT_PREFS: GanttPrefs = {
  sort: "auto",
  search: "",
  status: "all",
  priority: "All",
  assignee: "All",
  customOrder: [],
  showCriticalPath: true,
};

function loadPrefs(): GanttPrefs {
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
    const status =
      parsed.status === "open" ||
      parsed.status === "completed" ||
      parsed.status === "overdue" ||
      parsed.status === "all"
        ? (parsed.status as GanttStatusFilter)
        : DEFAULT_PREFS.status;
    const priority =
      parsed.priority === "All" ||
      (PRIORITIES as readonly string[]).includes(parsed.priority as string)
        ? (parsed.priority as Priority | "All")
        : DEFAULT_PREFS.priority;
    return {
      sort,
      search: typeof parsed.search === "string" ? parsed.search : "",
      status,
      priority,
      assignee:
        typeof parsed.assignee === "string"
          ? parsed.assignee
          : DEFAULT_PREFS.assignee,
      customOrder: Array.isArray(parsed.customOrder)
        ? parsed.customOrder.filter((n): n is number => typeof n === "number")
        : [],
      // Older saved prefs (pre critical-path feature) won't have this field;
      // missing means "on", matching the new default.
      showCriticalPath:
        typeof parsed.showCriticalPath === "boolean"
          ? parsed.showCriticalPath
          : DEFAULT_PREFS.showCriticalPath,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(p: GanttPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // Quota / disabled — drop silently.
  }
}

const DAY_MS = 86_400_000;
const DAY_WIDTH_PX = 28; // ~one day per column
const ROW_HEIGHT_PX = 32;
const HEADER_ROW_HEIGHT_PX = 22; // each of the two header rows
const HEADER_HEIGHT_PX = HEADER_ROW_HEIGHT_PX * 2;
const LEFT_GUTTER_PX = 240; // task-name column width
const BAR_HEIGHT_PX = 18;
const BAR_VPADDING_PX = (ROW_HEIGHT_PX - BAR_HEIGHT_PX) / 2;

// Priority → bar fill class. Matches the priority pill colors elsewhere.
const priorityFillClass: Record<Priority, string> = {
  Low: "fill-AIPM-medium-grey",
  Medium: "fill-AIPM-blue",
  High: "fill-AIPM-purple",
  Urgent: "fill-AIPM-pink",
};

// ---------- date helpers --------------------------------------------------

function parseISO(s: string | undefined | null): Date | null {
  if (!s) return null;
  // YYYY-MM-DD or full ISO — both work for Date constructor.
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  // Normalize to start of day (UTC) so cross-timezone math is stable.
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function todayUTC(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

function fmtMonth(d: Date, lang: Lang): string {
  return d.toLocaleString(lang === "de" ? "de-DE" : "en-US", {
    month: "short",
    year: "numeric",
  });
}

function fmtDay(d: Date): string {
  return String(d.getUTCDate());
}

function fmtFull(d: Date, lang: Lang): string {
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
function deriveBar(
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
function naturalCompare(
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
function edgeKey(predId: number, succId: number, type: DependencyType): string {
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
function computeCriticalPath(
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

// ---------- panel component ------------------------------------------------

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
function absenceBandBg(type: AbsenceType): string {
  switch (type) {
    case "vacation":
      return "bg-AIPM-blue/20 dark:bg-AIPM-blue/25";
    case "sick":
      return "bg-AIPM-pink/20 dark:bg-AIPM-pink/25";
    case "training":
      return "bg-AIPM-purple/20 dark:bg-AIPM-purple/25";
    default:
      return "bg-surface-muted";
  }
}

export function GanttPanel({
  lang,
  tasks,
  absences,
  onUpdateBar,
  onAddTask,
  onEditTask,
}: {
  lang: Lang;
  tasks: Task[];
  absences: readonly Absence[];
  onUpdateBar?: (edit: GanttBarEdit) => void;
  onAddTask?: () => void;
  onEditTask?: (task: Task) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const { ref: panelRef } = useResizable("lop-app:gantt-size");

  // --- prefs: sort + filters + custom order, persisted in localStorage ---
  const [prefs, setPrefs] = useState<GanttPrefs>(DEFAULT_PREFS);
  const prefsHydratedRef = useRef(false);

  // Mount-time hydration. We intentionally start with DEFAULT_PREFS so the
  // server-rendered HTML and the first client render match; the real values
  // are applied via setState after mount, triggering a single re-render.
  useEffect(() => {
    if (prefsHydratedRef.current) return;
    prefsHydratedRef.current = true;
    setPrefs(loadPrefs());
  }, []);

  // Persist on every change after hydration.
  useEffect(() => {
    if (!prefsHydratedRef.current) return;
    savePrefs(prefs);
  }, [prefs]);

  // Today is used in date math (overdue computation, range padding). It's
  // evaluated once per render — server / client first paint produce the
  // same value as long as they fall on the same UTC day.
  const today = todayUTC();

  // --- bar derivation (unchanged): two passes over the full task list ---
  // We always compute bars for ALL tasks (not just the visible ones) so
  // predecessor anchors still resolve correctly even when the predecessor
  // is currently filtered out.
  const allBars = useMemo(() => {
    const base = new Map<number, { start: Date; end: Date }>();
    for (const task of tasks) {
      const bar = deriveBar(task, base);
      if (bar) base.set(task.id, bar);
    }
    const refined = new Map<number, { start: Date; end: Date }>();
    for (const task of tasks) {
      const bar = deriveBar(task, base);
      if (bar) refined.set(task.id, bar);
    }
    return refined;
  }, [tasks]);

  // Critical path — computed over ALL tasks (not just visible) so filtering
  // doesn't change which chain is binding. Skipped entirely when the toggle
  // is off, so the algorithm never runs in the disabled state.
  const critical = useMemo(() => {
    if (!prefs.showCriticalPath) {
      return { criticalTasks: new Set<number>(), criticalEdges: new Set<string>() };
    }
    const completed = new Set<number>();
    for (const t of tasks) {
      if (t.completedDate) completed.add(t.id);
    }
    return computeCriticalPath(tasks, allBars, completed);
  }, [tasks, allBars, prefs.showCriticalPath]);

  // Assignees for the dropdown — derived from tasks regardless of filter.
  const assigneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      const a = t.assignee?.trim();
      if (a) set.add(a);
    }
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [tasks]);

  // --- filter + sort pipeline -----------------------------------------
  const visible = useMemo(() => {
    const q = prefs.search.trim().toLowerCase();
    const placeable: Task[] = [];
    for (const task of tasks) {
      const bar = allBars.get(task.id);
      if (!bar) continue;

      // Status filter.
      const isComplete = !!task.completedDate;
      const isOverdue = !isComplete && bar.end.getTime() < today.getTime();
      if (prefs.status === "open" && isComplete) continue;
      if (prefs.status === "completed" && !isComplete) continue;
      if (prefs.status === "overdue" && !isOverdue) continue;

      // Priority filter.
      if (prefs.priority !== "All" && task.priority !== prefs.priority)
        continue;

      // Assignee filter.
      if (prefs.assignee !== "All" && task.assignee !== prefs.assignee)
        continue;

      // Full-text search across the same surfaces the tasks-list search uses.
      if (q) {
        const hay = [
          task.taskName,
          task.assignee,
          task.assigneeEmail ?? "",
          task.blockers ?? "",
          task.notes ?? "",
          task.group ?? "",
          (task.labels ?? []).join(" "),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) continue;
      }

      placeable.push(task);
    }

    // Sort.
    if (prefs.sort === "custom") {
      // customOrder gives explicit positions. Tasks not in the array fall
      // back to natural (start-date) order and get appended at the end.
      const indexOf = new Map<number, number>();
      prefs.customOrder.forEach((id, idx) => indexOf.set(id, idx));
      placeable.sort((a, b) => {
        const ia = indexOf.has(a.id) ? (indexOf.get(a.id) as number) : Infinity;
        const ib = indexOf.has(b.id) ? (indexOf.get(b.id) as number) : Infinity;
        if (ia !== ib) return ia - ib;
        // Tie-breaker for tasks not yet in customOrder: natural sort.
        return naturalCompare(a, b, allBars);
      });
    } else if (prefs.sort === "due") {
      placeable.sort((a, b) => {
        const ba = allBars.get(a.id) as { start: Date; end: Date };
        const bb = allBars.get(b.id) as { start: Date; end: Date };
        const d = ba.end.getTime() - bb.end.getTime();
        return d !== 0 ? d : a.id - b.id;
      });
    } else if (prefs.sort === "name") {
      placeable.sort((a, b) =>
        a.taskName.localeCompare(b.taskName, undefined, { sensitivity: "base" }),
      );
    } else if (prefs.sort === "priority") {
      // Urgent first → Low last.
      const rank: Record<Priority, number> = {
        Urgent: 0,
        High: 1,
        Medium: 2,
        Low: 3,
      };
      placeable.sort((a, b) => {
        const d = rank[a.priority] - rank[b.priority];
        return d !== 0 ? d : a.id - b.id;
      });
    } else {
      // "auto" — original natural sort by start, due, id.
      placeable.sort((a, b) => naturalCompare(a, b, allBars));
    }

    return placeable;
  }, [tasks, allBars, prefs, today]);

  // Compatibility alias so the existing chart code keeps reading from
  // `layout.placeable` / `layout.bars`.
  const layout = { placeable: visible, bars: allBars };

  function setSort(sort: GanttSort) {
    setPrefs((p) => ({ ...p, sort }));
  }
  function setSearch(search: string) {
    setPrefs((p) => ({ ...p, search }));
  }
  function setStatusFilter(status: GanttStatusFilter) {
    setPrefs((p) => ({ ...p, status }));
  }
  function setPriorityFilter(priority: Priority | "All") {
    setPrefs((p) => ({ ...p, priority }));
  }
  function setAssigneeFilter(assignee: string) {
    setPrefs((p) => ({ ...p, assignee }));
  }
  function resetFilters() {
    setPrefs((p) => ({
      ...p,
      search: "",
      status: "all",
      priority: "All",
      assignee: "All",
    }));
  }
  function toggleCriticalPath() {
    setPrefs((p) => ({ ...p, showCriticalPath: !p.showCriticalPath }));
  }

  // --- drag-and-drop reordering --------------------------------------
  // Track the id currently being dragged + the row we're hovering over.
  // Both are used purely for visual feedback (drop indicator on the
  // target row). The reordering itself happens on drop.
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);

  // --- bar drag-edit state ---------------------------------------------
  //
  // Three distinct modes:
  //   • "move"         — drag the body of a bar to shift start + end by
  //                      the same number of days (preserves duration).
  //   • "resize-start" — drag the left edge to move only the start.
  //   • "resize-end"   — drag the right edge to move only the end (due).
  //
  // We track the original bar dates at pointerdown and a live `dayDelta`
  // that updates on every pointermove. Rendering uses these to offset
  // the bar in place (cheap — just a few style props), and we commit the
  // new dates to the parent on pointerup.
  type BarDragMode = "move" | "resize-start" | "resize-end";
  type BarDrag = {
    taskId: number;
    mode: BarDragMode;
    startClientX: number;
    initialStart: Date;
    initialEnd: Date;
    /** Captured pointer id so we can release it on pointerup. */
    pointerId: number;
    /** Set when the user actually drags >= 1 day worth of pixels. Used to
     *  decide whether to commit on release or treat it as a click. */
    moved: boolean;
  };
  const [barDrag, setBarDrag] = useState<BarDrag | null>(null);
  const [barDragDeltaDays, setBarDragDeltaDays] = useState(0);

  // Synchronous flag flipped on by the bar's `pointerdown` and off again
  // on `pointerup`/`pointercancel`. The row's `onDragStart` checks this
  // ref and calls `preventDefault()` to suppress native HTML5
  // drag-to-reorder when the user is actually intending a bar drag-edit.
  //
  // Why a ref instead of state? `setState` is async, but `dragstart` fires
  // in the same task as the `pointermove` that triggered it — by which
  // time React hasn't re-rendered yet, so a state-based flag would still
  // read its previous value. A ref is set synchronously and visible
  // immediately to handlers in the same render.
  //
  // Why not just `e.target.closest('[data-gantt-bar="1"]')` in the row's
  // dragstart? Because `dragstart.target` is the draggable element (the
  // row), NOT the element the user mousedowned on. The hit zones inside
  // the bar never appear as `e.target` for a dragstart.
  const interactingWithBarRef = useRef(false);

  // Always-current ref of `onUpdateBar` so the global pointer listeners
  // installed at drag-start can read the latest version on commit, even
  // if the parent re-rendered while the drag was in progress.
  const onUpdateBarRef = useRef(onUpdateBar);
  useEffect(() => {
    onUpdateBarRef.current = onUpdateBar;
  }, [onUpdateBar]);

  /** Apply the current drag in-memory to return what the bar's dates
   *  WOULD be if the user released right now. Centralised so the render
   *  path, the cursor logic, and the commit path agree on the math. */
  function previewDates(drag: BarDrag, deltaDays: number): { start: Date; end: Date } {
    let start = new Date(drag.initialStart);
    let end = new Date(drag.initialEnd);
    if (drag.mode === "move") {
      start = addDays(start, deltaDays);
      end = addDays(end, deltaDays);
    } else if (drag.mode === "resize-start") {
      start = addDays(start, deltaDays);
      // Clamp so start never crosses end.
      if (start.getTime() > end.getTime()) start = end;
    } else {
      end = addDays(end, deltaDays);
      // Clamp so end never crosses start.
      if (end.getTime() < start.getTime()) end = start;
    }
    return { start, end };
  }

  function toIso(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  /**
   * Begin a bar drag-edit.
   *
   * We install pointermove/pointerup/pointercancel listeners on `window`
   * (not on the hit-zone div) for three reasons:
   *
   *  1. The captured-pointer approach failed in practice — React 19's
   *     synthetic event delegation reads handler props from the fiber
   *     tree on every event, and the closure values it sees are stale
   *     for `barDrag` (still `null` from the render BEFORE we called
   *     `setBarDrag`). The pointerup handler would early-return.
   *
   *  2. Window listeners close over a local `currentDrag` variable that's
   *     mutated synchronously in `onMove` — no React state lookup, no
   *     closure staleness.
   *
   *  3. Window listeners work even if the cursor leaves the panel /
   *     viewport entirely during the drag. The previous `setPointerCapture`
   *     dance was supposed to give us this, but only intermittently did.
   *
   * The component still mirrors the drag into React state (`barDrag` /
   * `barDragDeltaDays`) so the rendering layer can compute the in-flight
   * preview bar; but the commit logic on pointerup reads the closed-over
   * local, not state.
   */
  function startBarDrag(
    e: React.PointerEvent<HTMLDivElement>,
    task: Task,
    bar: { start: Date; end: Date },
    mode: BarDragMode,
  ) {
    if (!onUpdateBar) return;
    // Mark "we're driving the bar" SYNCHRONOUSLY so the row's onDragStart
    // can suppress native HTML5 row-reorder when the user moves the
    // cursor enough to trigger dragstart.
    interactingWithBarRef.current = true;
    e.stopPropagation();

    // Local source of truth for this drag. NOT React state — we read it
    // from the listeners directly so closure staleness can't bite us.
    const currentDrag: BarDrag = {
      taskId: task.id,
      mode,
      startClientX: e.clientX,
      initialStart: bar.start,
      initialEnd: bar.end,
      pointerId: e.pointerId,
      moved: false,
    };

    // Mirror into state for the render layer (preview bar position +
    // the dark-blue editing-ring).
    setBarDrag(currentDrag);
    setBarDragDeltaDays(0);

    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== currentDrag.pointerId) return;
      const dd = Math.round(
        (ev.clientX - currentDrag.startClientX) / DAY_WIDTH_PX,
      );
      // Reflect into state so the bar's render path picks up the
      // preview offset. (Cheap — React batches these.)
      setBarDragDeltaDays(dd);
      if (!currentDrag.moved && dd !== 0) {
        currentDrag.moved = true;
        setBarDrag({ ...currentDrag });
      }
    }

    function onEnd(ev: PointerEvent) {
      if (ev.pointerId !== currentDrag.pointerId) return;
      detach();
      const dd = Math.round(
        (ev.clientX - currentDrag.startClientX) / DAY_WIDTH_PX,
      );
      const moved = currentDrag.moved || dd !== 0;
      setBarDrag(null);
      setBarDragDeltaDays(0);
      interactingWithBarRef.current = false;
      if (!moved) return;
      const { start, end } = previewDates(currentDrag, dd);
      onUpdateBarRef.current?.({
        taskId: currentDrag.taskId,
        startDate: toIso(start),
        dueDate: toIso(end),
      });
    }

    function onCancel(ev: PointerEvent) {
      if (ev.pointerId !== currentDrag.pointerId) return;
      detach();
      setBarDrag(null);
      setBarDragDeltaDays(0);
      interactingWithBarRef.current = false;
    }

    function detach() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onCancel);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onCancel);
  }

  function handleDrop(fromId: number, toId: number) {
    setDraggingId(null);
    setDropTargetId(null);
    if (fromId === toId) return;
    setPrefs((prev) => {
      // Use a SEED order = current visible list, so a drag immediately
      // pins the relative position of every other visible row even if
      // they hadn't been moved before.
      const seed =
        prev.customOrder.length > 0
          ? prev.customOrder
          : visible.map((t) => t.id);
      const stripped = seed.filter((id) => id !== fromId);
      const insertAt = stripped.indexOf(toId);
      if (insertAt < 0) {
        // Target not in the seed (shouldn't normally happen).
        stripped.push(fromId);
      } else {
        stripped.splice(insertAt, 0, fromId);
      }
      return { ...prev, sort: "custom", customOrder: stripped };
    });
  }

  // Per-assignee absence lookup (case-folded join key). Built once per
  // absences change so per-row scans don't iterate the full list. Phase 5.
  const absencesByAssigneeKey = useMemo<Map<string, Absence[]>>(() => {
    const m = new Map<string, Absence[]>();
    for (const a of absences) {
      const key = a.assignee.trim().toLowerCase();
      if (!key) continue;
      const list = m.get(key);
      if (list) list.push(a);
      else m.set(key, [a]);
    }
    return m;
  }, [absences]);

  // Date range for the time axis.
  const range = useMemo(() => {
    const today = todayUTC();
    let min: Date = today;
    let max: Date = today;
    let initialized = false;
    for (const bar of layout.bars.values()) {
      if (!initialized) {
        min = bar.start;
        max = bar.end;
        initialized = true;
        continue;
      }
      if (bar.start.getTime() < min.getTime()) min = bar.start;
      if (bar.end.getTime() > max.getTime()) max = bar.end;
    }
    if (!initialized) {
      min = addDays(today, -7);
      max = addDays(today, 14);
    } else {
      // Always include today.
      if (today.getTime() < min.getTime()) min = today;
      if (today.getTime() > max.getTime()) max = today;
      // Padding so the leftmost / rightmost bars don't sit flush against
      // the gutter / chart edge.
      min = addDays(min, -2);
      max = addDays(max, 3);
    }
    const days = Math.max(1, diffDays(min, max) + 1);
    return { min, max, days };
  }, [layout.bars]);

  const todayOffsetPx =
    LEFT_GUTTER_PX + diffDays(range.min, today) * DAY_WIDTH_PX;
  const timelineWidthPx = range.days * DAY_WIDTH_PX;
  const chartWidthPx = LEFT_GUTTER_PX + timelineWidthPx;
  const rowsCount = layout.placeable.length;

  // Pre-compute month spans for the top header row.
  const monthGroups = useMemo(() => {
    const out: Array<{ label: string; widthPx: number }> = [];
    if (range.days === 0) return out;
    let cursor = new Date(range.min);
    while (cursor.getTime() <= range.max.getTime()) {
      // Determine next month boundary.
      const nextMonth = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
      );
      const end =
        nextMonth.getTime() <= range.max.getTime() ? nextMonth : addDays(range.max, 1);
      const widthDays = diffDays(cursor, end);
      out.push({
        label: fmtMonth(cursor, lang),
        widthPx: widthDays * DAY_WIDTH_PX,
      });
      cursor = end;
    }
    return out;
  }, [range, lang]);

  // Differentiate "no tasks at all" from "all tasks filtered out" so the
  // user gets a recoverable empty state when their filters are too tight.
  const filtersActive =
    prefs.search.trim() !== "" ||
    prefs.status !== "all" ||
    prefs.priority !== "All" ||
    prefs.assignee !== "All";

  const toolbar = (
    <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2">
      <input
        type="search"
        value={prefs.search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t(lang, "searchPlaceholder")}
        aria-label={t(lang, "searchPlaceholder")}
        title={t(lang, "ganttSearchHint")}
        className="min-w-[12rem] flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      />
      <select
        value={prefs.status}
        onChange={(e) =>
          setStatusFilter(e.target.value as GanttStatusFilter)
        }
        aria-label={t(lang, "ganttFilterStatus")}
        title={t(lang, "ganttStatusFilterHint")}
        className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      >
        <option value="all">{t(lang, "ganttStatusAll")}</option>
        <option value="open">{t(lang, "ganttStatusOpen")}</option>
        <option value="completed">{t(lang, "ganttStatusCompleted")}</option>
        <option value="overdue">{t(lang, "ganttStatusOverdue")}</option>
      </select>
      <select
        value={prefs.priority}
        onChange={(e) =>
          setPriorityFilter(e.target.value as Priority | "All")
        }
        aria-label={t(lang, "allPriorities")}
        title={t(lang, "priorityFilterHint")}
        className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      >
        <option value="All">{t(lang, "allPriorities")}</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <select
        value={prefs.assignee}
        onChange={(e) => setAssigneeFilter(e.target.value)}
        aria-label={t(lang, "allAssignees")}
        title={t(lang, "assigneeFilterHint")}
        className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      >
        <option value="All">{t(lang, "allAssignees")}</option>
        {assigneeOptions.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="hidden sm:inline">{t(lang, "ganttSortLabel")}</span>
        <select
          value={prefs.sort}
          onChange={(e) => setSort(e.target.value as GanttSort)}
          aria-label={t(lang, "ganttSortLabel")}
          title={t(lang, "ganttSortHint")}
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
        >
          <option value="auto">{t(lang, "ganttSortAuto")}</option>
          <option value="due">{t(lang, "ganttSortDue")}</option>
          <option value="name">{t(lang, "ganttSortName")}</option>
          <option value="priority">{t(lang, "ganttSortPriority")}</option>
          <option value="custom" disabled={prefs.customOrder.length === 0}>
            {t(lang, "ganttSortCustom")}
          </option>
        </select>
      </label>
      {filtersActive && (
        <button
          type="button"
          onClick={resetFilters}
          title={t(lang, "resetFiltersHint")}
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted"
        >
          {t(lang, "ganttResetFilters")}
        </button>
      )}
      <button
        type="button"
        onClick={toggleCriticalPath}
        aria-pressed={prefs.showCriticalPath}
        title={t(lang, "ganttCriticalPathHint")}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-1 ${
          prefs.showCriticalPath
            ? "border-AIPM-pink bg-AIPM-pink/10 text-AIPM-pink hover:bg-AIPM-pink/20 focus:ring-AIPM-pink dark:border-AIPM-pink dark:bg-AIPM-pink/15"
            : "border-line bg-surface text-foreground hover:bg-surface-muted focus:ring-AIPM-green"
        }`}
      >
        {/* Diverging-paths glyph — two lines branching from a common origin. */}
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-3.5 w-3.5"
        >
          <path d="M4 16 L8 10 L12 13 L16 4" />
          <circle cx="4" cy="16" r="1.2" fill="currentColor" />
          <circle cx="16" cy="4" r="1.2" fill="currentColor" />
        </svg>
        <span>{t(lang, "ganttCriticalPath")}</span>
      </button>
      {onAddTask && (
        <button
          type="button"
          onClick={onAddTask}
          aria-label={t(lang, "addTaskButton")}
          title={t(lang, "addTaskButton")}
          className="ml-auto rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90"
        >
          + {t(lang, "addTaskButton")}
        </button>
      )}
    </div>
  );

  if (rowsCount === 0) {
    return (
      <div className="flex h-full min-h-[300px] flex-col">
        {toolbar}
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted-foreground">
          <span>
            {filtersActive ? t(lang, "ganttNoMatches") : t(lang, "ganttEmpty")}
          </span>
          {!filtersActive && onAddTask && (
            <button
              type="button"
              onClick={onAddTask}
              className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue dark:border-AIPM-blue dark:bg-AIPM-blue"
            >
              {t(lang, "addTaskButton")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[300px] flex-col">
      {toolbar}
      <div
        ref={panelRef}
        className="min-h-[240px] w-full min-w-[480px] flex-1 resize overflow-auto rounded-md border border-line"
      >
      <div
        ref={wrapperRef}
        style={{ width: chartWidthPx, minWidth: "100%" }}
        className="relative bg-surface"
      >
        {/* --- top header rows: months + days -------------------------- */}
        <div
          className="sticky top-0 z-20 flex border-b border-line bg-surface-muted text-xs"
          style={{ height: HEADER_HEIGHT_PX }}
        >
          <div
            className="sticky left-0 z-30 flex shrink-0 items-center border-r border-line bg-surface-muted px-3 font-medium uppercase tracking-wide text-muted-foreground"
            style={{ width: LEFT_GUTTER_PX }}
          >
            {t(lang, "task")}
          </div>
          <div
            className="relative flex flex-col"
            style={{ width: timelineWidthPx }}
          >
            <div
              className="flex border-b border-line"
              style={{ height: HEADER_ROW_HEIGHT_PX }}
            >
              {monthGroups.map((g, i) => (
                <div
                  key={i}
                  className="flex items-center justify-center border-r border-line px-1 text-[11px] font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey"
                  style={{ width: g.widthPx }}
                  title={g.label}
                >
                  <span className="truncate">{g.label}</span>
                </div>
              ))}
            </div>
            <div
              className="flex"
              style={{ height: HEADER_ROW_HEIGHT_PX }}
            >
              {Array.from({ length: range.days }).map((_, i) => {
                const d = addDays(range.min, i);
                const isToday = d.getTime() === today.getTime();
                const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
                return (
                  <div
                    key={i}
                    className={`flex items-center justify-center border-r text-[10px] ${
                      isToday
                        ? "border-AIPM-dark-blue bg-AIPM-dark-blue/10 font-semibold text-AIPM-dark-blue"
                        : isWeekend
                          ? "border-line bg-surface-muted/60 text-muted-foreground"
                          : "border-line text-muted-foreground"
                    }`}
                    style={{ width: DAY_WIDTH_PX }}
                  >
                    {fmtDay(d)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* --- rows ----------------------------------------------------- */}
        <div className="relative">
          {/* Today marker — drawn as an absolutely positioned line that
              spans the rows area. Sits behind the bars (z-0) but on top
              of the row backgrounds. */}
          {todayOffsetPx >= LEFT_GUTTER_PX && (
            <div
              aria-hidden
              className="pointer-events-none absolute z-10 w-px bg-AIPM-dark-blue/60"
              style={{
                left: todayOffsetPx,
                top: 0,
                height: rowsCount * ROW_HEIGHT_PX,
              }}
              title={t(lang, "ganttToday")}
            />
          )}

          {/* Dependency arrow layer — sits over the rows but under the bars
              for hover contrast. */}
          <svg
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 z-0"
            width={chartWidthPx}
            height={rowsCount * ROW_HEIGHT_PX}
            viewBox={`0 0 ${chartWidthPx} ${rowsCount * ROW_HEIGHT_PX}`}
          >
            <defs>
              <marker
                id="gantt-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
                fill="rgb(99, 99, 98)"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
              <marker
                id="gantt-arrow-critical"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
                fill="rgb(220, 38, 38)"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {layout.placeable.flatMap((task, rowIdx) => {
              if (!task.dependencies || task.dependencies.length === 0) {
                return [];
              }
              const myBar = layout.bars.get(task.id);
              if (!myBar) return [];
              const myStartX =
                LEFT_GUTTER_PX +
                diffDays(range.min, myBar.start) * DAY_WIDTH_PX;
              const myEndX =
                LEFT_GUTTER_PX +
                (diffDays(range.min, myBar.end) + 1) * DAY_WIDTH_PX;
              const myYMid = rowIdx * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2;
              return task.dependencies.map((dep, depIdx) => {
                const predRowIdx = layout.placeable.findIndex(
                  (p) => p.id === dep.taskId,
                );
                if (predRowIdx < 0) return null;
                const predBar = layout.bars.get(dep.taskId);
                if (!predBar) return null;
                const predStartX =
                  LEFT_GUTTER_PX +
                  diffDays(range.min, predBar.start) * DAY_WIDTH_PX;
                const predEndX =
                  LEFT_GUTTER_PX +
                  (diffDays(range.min, predBar.end) + 1) * DAY_WIDTH_PX;
                const predYMid =
                  predRowIdx * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2;

                // Pick which edges of each bar the arrow connects.
                let x1: number;
                let x2: number;
                switch (dep.type) {
                  case "FS":
                    x1 = predEndX;
                    x2 = myStartX;
                    break;
                  case "SS":
                    x1 = predStartX;
                    x2 = myStartX;
                    break;
                  case "FF":
                    x1 = predEndX;
                    x2 = myEndX;
                    break;
                  case "SF":
                    x1 = predStartX;
                    x2 = myEndX;
                    break;
                }
                // Simple elbow with curved corners.
                const midX = (x1 + x2) / 2;
                const path = `M ${x1} ${predYMid} C ${midX} ${predYMid}, ${midX} ${myYMid}, ${x2} ${myYMid}`;
                const isCritical = critical.criticalEdges.has(
                  edgeKey(dep.taskId, task.id, dep.type),
                );
                return (
                  <path
                    key={`${task.id}-${depIdx}`}
                    d={path}
                    stroke={isCritical ? "rgb(220, 38, 38)" : "rgb(99, 99, 98)"}
                    strokeOpacity={isCritical ? 0.85 : 0.45}
                    strokeWidth={isCritical ? 2 : 1.25}
                    fill="none"
                    markerEnd={
                      isCritical ? "url(#gantt-arrow-critical)" : "url(#gantt-arrow)"
                    }
                  />
                );
              });
            })}
          </svg>

          {layout.placeable.map((task) => {
            const bar = layout.bars.get(task.id);
            if (!bar) return null;
            const isComplete = !!task.completedDate;
            const isOverdue =
              !isComplete && bar.end.getTime() < today.getTime();
            const isDragging = draggingId === task.id;
            const isDropTarget =
              dropTargetId === task.id && draggingId !== task.id;
            return (
              <div
                key={task.id}
                draggable
                onDragStart={(e) => {
                  // If the bar's pointerdown handler just fired (the user
                  // is starting a date drag-edit), suppress native HTML5
                  // drag-to-reorder. The ref is set synchronously in
                  // `startBarDrag` before the browser dispatches dragstart.
                  //
                  // We can't use `e.target.closest('[data-gantt-bar]')`
                  // here because `dragstart.target` is always the
                  // draggable element itself (the row) — not the element
                  // the user mousedowned on.
                  if (interactingWithBarRef.current) {
                    e.preventDefault();
                    return;
                  }
                  // Carry the id on the dataTransfer in case multiple
                  // Gantt panels ever coexist; the local state mirror is
                  // what actually drives the indicator UI.
                  e.dataTransfer.setData("text/plain", String(task.id));
                  e.dataTransfer.effectAllowed = "move";
                  setDraggingId(task.id);
                }}
                onDragOver={(e) => {
                  if (draggingId === null || draggingId === task.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dropTargetId !== task.id) setDropTargetId(task.id);
                }}
                onDragLeave={(e) => {
                  // Only clear the indicator if we're leaving the entire
                  // row, not just crossing one of its child elements.
                  if (
                    e.currentTarget instanceof HTMLElement &&
                    e.relatedTarget instanceof Node &&
                    e.currentTarget.contains(e.relatedTarget)
                  ) {
                    return;
                  }
                  if (dropTargetId === task.id) setDropTargetId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const fromIdRaw = e.dataTransfer.getData("text/plain");
                  const fromId = Number(fromIdRaw);
                  if (Number.isFinite(fromId)) handleDrop(fromId, task.id);
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDropTargetId(null);
                }}
                className={`relative flex border-b border-line ${
                  isDragging ? "opacity-40" : ""
                }`}
                style={{ height: ROW_HEIGHT_PX }}
              >
                {/* Drop indicator — a 2px line that lights up at the
                    target row's top edge while a row is being dragged
                    over it. Sits inside the row so it stays aligned
                    even when the parent scrolls. */}
                {isDropTarget && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute left-0 right-0 top-0 z-20 h-0.5 bg-AIPM-dark-blue"
                  />
                )}
                <div
                  className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 truncate border-r border-line bg-surface pr-3 text-xs"
                  style={{ width: LEFT_GUTTER_PX }}
                  title={task.taskName}
                >
                  <span
                    aria-hidden
                    className="cursor-grab text-muted-foreground hover:text-AIPM-dark-blue active:cursor-grabbing"
                    title={t(lang, "ganttDragHint")}
                  >
                    {/* Grip icon — 6 dots in a 2×3 arrangement, matching
                        the common "drag handle" affordance. */}
                    <svg
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                      className="ml-1 h-4 w-4"
                    >
                      <circle cx="7" cy="5" r="1.4" />
                      <circle cx="13" cy="5" r="1.4" />
                      <circle cx="7" cy="10" r="1.4" />
                      <circle cx="13" cy="10" r="1.4" />
                      <circle cx="7" cy="15" r="1.4" />
                      <circle cx="13" cy="15" r="1.4" />
                    </svg>
                  </span>
                  <span className="font-mono text-muted-foreground">
                    #{task.id}
                  </span>
                  {onEditTask ? (
                    <button
                      type="button"
                      onClick={() => onEditTask(task)}
                      onPointerDown={(e) => e.stopPropagation()}
                      title={`${task.taskName} — ${t(lang, "clickToEdit")}`}
                      className={`truncate rounded-md border border-transparent px-1 py-0.5 text-left hover:border-AIPM-dark-blue hover:bg-surface-muted ${
                        isComplete
                          ? "text-muted-foreground line-through"
                          : "text-foreground"
                      }`}
                    >
                      {task.taskName}
                    </button>
                  ) : (
                    <span
                      className={`truncate ${
                        isComplete
                          ? "text-muted-foreground line-through"
                          : "text-foreground"
                      }`}
                    >
                      {task.taskName}
                    </span>
                  )}
                </div>
                <div
                  className="relative"
                  style={{ width: timelineWidthPx, height: ROW_HEIGHT_PX }}
                >
                  {/*
                    Phase 5 — absence overlay bands. One faded band per
                    absence of this row's assignee that intersects the
                    timeline window. Rendered before the task bar so the
                    bar paints on top; pointer-events disabled so they
                    don't intercept drag-edits.
                  */}
                  {(() => {
                    const rowKey = task.assignee?.trim().toLowerCase();
                    if (!rowKey) return null;
                    const rowAbsences = absencesByAssigneeKey.get(rowKey);
                    if (!rowAbsences) return null;
                    return rowAbsences.map((a) => {
                      const aStart = new Date(a.startDate);
                      const aEnd = new Date(a.endDate);
                      if (
                        Number.isNaN(aStart.valueOf()) ||
                        Number.isNaN(aEnd.valueOf())
                      )
                        return null;
                      // Clip to the visible window.
                      const startClipped =
                        aStart.getTime() < range.min.getTime()
                          ? range.min
                          : aStart;
                      const endClipped =
                        aEnd.getTime() > range.max.getTime() ? range.max : aEnd;
                      if (endClipped.getTime() < startClipped.getTime())
                        return null;
                      const xStart =
                        diffDays(range.min, startClipped) * DAY_WIDTH_PX;
                      const xEnd =
                        (diffDays(range.min, endClipped) + 1) * DAY_WIDTH_PX;
                      const width = Math.max(0, xEnd - xStart);
                      if (width <= 0) return null;
                      return (
                        <div
                          key={a.id}
                          aria-hidden="true"
                          title={`${a.assignee}: ${a.type} ${a.startDate}${
                            a.startDate === a.endDate ? "" : `–${a.endDate}`
                          }${a.note ? ` (${a.note})` : ""}`}
                          className={`pointer-events-none absolute ${absenceBandBg(a.type)}`}
                          style={{
                            left: xStart,
                            width,
                            top: 0,
                            height: ROW_HEIGHT_PX,
                          }}
                        />
                      );
                    });
                  })()}
                  {(() => {
                    // If THIS task's bar is being drag-edited, recompute its
                    // displayed position from the drag preview so the bar
                    // visually tracks the cursor. Otherwise render at the
                    // committed dates from `bar`.
                    let displayStart = bar.start;
                    let displayEnd = bar.end;
                    if (
                      barDrag &&
                      barDrag.taskId === task.id &&
                      onUpdateBar &&
                      !isComplete
                    ) {
                      const preview = previewDates(barDrag, barDragDeltaDays);
                      displayStart = preview.start;
                      displayEnd = preview.end;
                    }
                    const dStartX =
                      diffDays(range.min, displayStart) * DAY_WIDTH_PX;
                    const dEndX =
                      (diffDays(range.min, displayEnd) + 1) * DAY_WIDTH_PX;
                    const dWidth = Math.max(DAY_WIDTH_PX / 2, dEndX - dStartX);

                    // Whether bar-drag editing is allowed for this row.
                    // We block completed tasks (you shouldn't accidentally
                    // change the date of something already done) and any
                    // task that simply lacks an edit callback.
                    const editable = !!onUpdateBar && !isComplete;

                    return (
                      <div
                        // `data-gantt-bar` marker — the row's onDragStart
                        // checks for this attribute on the event target
                        // to suppress native HTML5 row-drag when the user
                        // is actually starting a bar drag-edit. The
                        // `draggable={false}` is belt-and-suspenders;
                        // some browsers honor it, but the dragStart guard
                        // is what does the heavy lifting.
                        data-gantt-bar="1"
                        draggable={false}
                        className={`absolute rounded-md ${
                          isComplete
                            ? "opacity-50"
                            : critical.criticalTasks.has(task.id)
                              ? "ring-2 ring-AIPM-pink"
                              : isOverdue
                                ? "ring-2 ring-AIPM-pink/70"
                                : ""
                        } ${
                          barDrag && barDrag.taskId === task.id
                            ? "ring-2 ring-AIPM-dark-blue/60"
                            : ""
                        }`}
                        style={{
                          left: dStartX,
                          width: dWidth,
                          top: BAR_VPADDING_PX,
                          height: BAR_HEIGHT_PX,
                          touchAction: editable ? "none" : "auto",
                        }}
                        title={
                          editable
                            ? `${task.taskName} · ${fmtFull(displayStart, lang)} → ${fmtFull(displayEnd, lang)} · ${t(lang, "ganttBarDragHint")}`
                            : `${task.taskName} · ${fmtFull(displayStart, lang)} → ${fmtFull(displayEnd, lang)}`
                        }
                      >
                        <svg
                          className="h-full w-full overflow-visible"
                          viewBox={`0 0 ${dWidth} ${BAR_HEIGHT_PX}`}
                          preserveAspectRatio="none"
                        >
                          <rect
                            x={0}
                            y={0}
                            width={dWidth}
                            height={BAR_HEIGHT_PX}
                            rx={4}
                            ry={4}
                            className={priorityFillClass[task.priority]}
                          />
                        </svg>

                        {editable && (
                          <>
                            {/*
                              Three transparent hit zones laid over the bar:
                                • Left edge (6px wide, ew-resize) → resize start
                                • Middle (the rest, grab cursor)  → move both
                                • Right edge (6px wide, ew-resize) → resize end
                              The cursor changes per-zone so the affordance
                              is discoverable without a tooltip.
                            */}
                            {/*
                              Each zone only needs onPointerDown. Once a
                              drag starts, the move/up/cancel listeners
                              live on `window` (installed inside
                              `startBarDrag`), so the cursor can leave the
                              hit zone — or even the panel — without
                              losing the drag.
                            */}
                            <div
                              role="button"
                              aria-label={t(lang, "ganttBarResizeStart")}
                              className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize"
                              onPointerDown={(e) =>
                                startBarDrag(e, task, bar, "resize-start")
                              }
                            />
                            <div
                              role="button"
                              aria-label={t(lang, "ganttBarMove")}
                              className="absolute inset-x-1.5 top-0 z-0 h-full cursor-grab active:cursor-grabbing"
                              onPointerDown={(e) =>
                                startBarDrag(e, task, bar, "move")
                              }
                            />
                            <div
                              role="button"
                              aria-label={t(lang, "ganttBarResizeEnd")}
                              className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-ew-resize"
                              onPointerDown={(e) =>
                                startBarDrag(e, task, bar, "resize-end")
                              }
                            />
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}

          {onAddTask && (
            <div
              role="button"
              tabIndex={0}
              onClick={onAddTask}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onAddTask();
                }
              }}
              className="group relative flex cursor-pointer border-b border-dashed border-line hover:bg-surface-muted"
              style={{ height: ROW_HEIGHT_PX }}
              aria-label={t(lang, "addTaskButton")}
            >
              <div
                className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-line bg-surface px-3 text-xs text-muted-foreground group-hover:text-AIPM-dark-blue"
                style={{ width: LEFT_GUTTER_PX }}
              >
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5 shrink-0">
                  <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                </svg>
                <span>{t(lang, "ganttAddTask")}</span>
              </div>
              <div style={{ width: timelineWidthPx }} />
            </div>
          )}
        </div>

        {/* --- Footer with the date range so it's visible without hover -- */}
        <div
          className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-surface-muted px-3 py-1 text-[11px] text-muted-foreground"
          style={{ minHeight: 22 }}
        >
          <span>
            {t(lang, "ganttRange", fmtFull(range.min, lang), fmtFull(range.max, lang))}
          </span>
        </div>
      </div>
      </div>
    </div>
  );
}
