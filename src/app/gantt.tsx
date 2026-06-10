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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { useResizable } from "./use-resizable";
import { PrintButton, ResetSizeButton, ResizeCornerHint } from "./task-manager-ui";
import { PRIORITIES, type Absence, type Milestone, type Priority, type Task } from "./types";
import { isAchieved, milestoneStatus, MILESTONE_DUE_SOON_WORKDAYS, sortMilestones } from "./milestones";
import {
  absenceBandBg,
  addDays,
  BAR_HEIGHT_PX,
  BAR_VPADDING_PX,
  computeCriticalPath,
  DAY_WIDTH_PX,
  DEFAULT_PREFS,
  deriveBar,
  diffDays,
  EDGE_STROKE_MUTED,
  edgeKey,
  EMPTY_HOLIDAY_SET,
  fmtDay,
  fmtFull,
  fmtMonth,
  type GanttBarEdit,
  type GanttPrefs,
  type GanttSort,
  type GanttStatusFilter,
  HEADER_HEIGHT_PX,
  HEADER_ROW_HEIGHT_PX,
  LEFT_GUTTER_PX,
  loadPrefs,
  MILESTONE_DIAMOND_PX,
  milestoneDiamondProps,
  naturalCompare,
  parseISO,
  priorityFillClass,
  ROW_HEIGHT_PX,
  savePrefs,
  todayUTC,
  toISODay,
} from "./gantt-engine";

// ---------- panel component ------------------------------------------------

export function GanttPanel({
  lang,
  tasks,
  absences,
  milestones = [],
  onUpdateBar,
  onAddTask,
  onEditTask,
  onAddMilestone,
  onEditMilestone,
}: {
  lang: Lang;
  tasks: Task[];
  absences: readonly Absence[];
  milestones?: readonly Milestone[];
  onUpdateBar?: (edit: GanttBarEdit) => void;
  onAddTask?: () => void;
  onEditTask?: (task: Task) => void;
  onAddMilestone?: () => void;
  onEditMilestone?: (m: Milestone) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const didInitialScroll = useRef(false);
  const { ref: ganttRef, reset: resetGanttSize } = useResizable("lop-app:gantt-size");

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
  // YYYY-MM-DD form of the chart's "today", for milestone status math.
  // Computed from a fresh todayUTC() rather than the `today` const above so
  // the React Compiler doesn't treat the shared `today` as passed-and-mutable
  // (which would bail out the component's manual memoization).
  const todayISO = toISODay(todayUTC());

  // Task lookup for milestone at-risk computation (linked-task end vs. date).
  const tasksById = useMemo(() => {
    const m = new Map<number, Task>();
    for (const t of tasks) m.set(t.id, t);
    return m;
  }, [tasks]);

  // Milestones sorted by date then id — the vertical order of their rows.
  const sortedMilestones = useMemo(
    () => sortMilestones(milestones),
    [milestones],
  );

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
    // Fold milestone dates into the range so their diamonds are never
    // clipped. An empty milestones list leaves min/max untouched.
    for (const m of milestones) {
      const d = parseISO(m.date);
      if (!d) continue;
      if (!initialized) {
        min = d;
        max = d;
        initialized = true;
        continue;
      }
      if (d.getTime() < min.getTime()) min = d;
      if (d.getTime() > max.getTime()) max = d;
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
  }, [layout.bars, milestones]);

  const todayOffsetPx =
    LEFT_GUTTER_PX + diffDays(range.min, today) * DAY_WIDTH_PX;
  const timelineWidthPx = range.days * DAY_WIDTH_PX;

  // On mount (and on the first render where layout is meaningful), scroll
  // the chart so today sits in the viewport's horizontal center. Targets
  // scrollRef (the inner overflow-auto container); ganttRef is the outer
  // resizable pane root.
  // Latched so the user's manual scroll position is preserved on later
  // renders.
  useLayoutEffect(() => {
    if (didInitialScroll.current) return;
    const el = scrollRef.current;
    if (!el || todayOffsetPx <= 0) return;
    const target = todayOffsetPx - el.clientWidth / 2;
    el.scrollLeft = Math.max(
      0,
      Math.min(el.scrollWidth - el.clientWidth, target),
    );
    didInitialScroll.current = true;
  }, [scrollRef, todayOffsetPx]);
  const chartWidthPx = LEFT_GUTTER_PX + timelineWidthPx;
  const rowsCount = layout.placeable.length;
  // Total rows rendered in the chart body: task rows first, then one row per
  // sorted milestone. The dependency-edge overlay must span all of them so
  // linked-task -> milestone connectors aren't clipped at the task-row edge.
  const totalRowsCount = rowsCount + sortedMilestones.length;

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
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 print:hidden">
      {onAddTask && (
        <button
          type="button"
          onClick={onAddTask}
          aria-label={t(lang, "addTaskButton")}
          title={t(lang, "addTaskButton")}
          className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90"
        >
          + {t(lang, "addTaskButton")}
        </button>
      )}
      {onAddMilestone && (
        <button
          type="button"
          onClick={onAddMilestone}
          aria-label={t(lang, "ganttAddMilestone")}
          title={t(lang, "ganttAddMilestone")}
          className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90"
        >
          + {t(lang, "ganttAddMilestone")}
        </button>
      )}
      <input
        type="search"
        value={prefs.search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t(lang, "searchPlaceholder")}
        aria-label={t(lang, "searchPlaceholder")}
        title={t(lang, "ganttSearchHint")}
        className="min-w-[12rem] flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      />
      <select
        value={prefs.status}
        onChange={(e) =>
          setStatusFilter(e.target.value as GanttStatusFilter)
        }
        aria-label={t(lang, "ganttFilterStatus")}
        title={t(lang, "ganttStatusFilterHint")}
        className="h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
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
        className="h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
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
        className="h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
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
          className="h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
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
      <PrintButton lang={lang} />
      <ResetSizeButton onClick={resetGanttSize} lang={lang} />
    </div>
  );

  if (rowsCount === 0 && sortedMilestones.length === 0) {
    return (
      <div ref={ganttRef} className={`print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`}>
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
        <ResizeCornerHint lang={lang} />
      </div>
    );
  }

  return (
    <div ref={ganttRef} className={`print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`}>
      {toolbar}
      <div
        ref={scrollRef}
        className="min-h-[240px] w-full min-w-[480px] flex-1 overflow-auto rounded-md border border-line"
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
                height: totalRowsCount * ROW_HEIGHT_PX,
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
            height={totalRowsCount * ROW_HEIGHT_PX}
            viewBox={`0 0 ${chartWidthPx} ${totalRowsCount * ROW_HEIGHT_PX}`}
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
                fill={EDGE_STROKE_MUTED}
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
                    stroke={isCritical ? "rgb(220, 38, 38)" : EDGE_STROKE_MUTED}
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
            {/* Linked-task -> milestone connectors. Informational only:
                a faint, thin line from each linked task's bar end to its
                milestone diamond. Deliberately NOT the critical-path red —
                a muted grey dash (lighter than the non-critical dependency
                edge) so it reads as context, not a schedule driver.
                Linked tasks with no bar (deleted/filtered) are skipped. */}
            {sortedMilestones.flatMap((m, mIdx) => {
              const md = parseISO(m.date);
              if (!md) return [];
              const milestoneX =
                LEFT_GUTTER_PX + diffDays(range.min, md) * DAY_WIDTH_PX;
              const milestoneYMid =
                (rowsCount + mIdx) * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2;
              return (m.linkedTaskIds ?? []).flatMap((taskId) => {
                const bar = layout.bars.get(taskId);
                if (!bar) return [];
                const taskRowIdx = layout.placeable.findIndex(
                  (p) => p.id === taskId,
                );
                if (taskRowIdx < 0) return [];
                const taskEndX =
                  LEFT_GUTTER_PX +
                  (diffDays(range.min, bar.end) + 1) * DAY_WIDTH_PX;
                const taskYMid =
                  taskRowIdx * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2;
                const midX = (taskEndX + milestoneX) / 2;
                const path = `M ${taskEndX} ${taskYMid} C ${midX} ${taskYMid}, ${midX} ${milestoneYMid}, ${milestoneX} ${milestoneYMid}`;
                return (
                  <path
                    key={`m-${m.id}-link-${taskId}`}
                    d={path}
                    data-milestone-connector
                    stroke={EDGE_STROKE_MUTED}
                    strokeOpacity={0.35}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    fill="none"
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

          {/* --- milestone rows: a diamond at each milestone's date ------
              Separate from the task rows above; not part of the
              critical-path / dependency math. Sorted by date then id. */}
          {sortedMilestones.map((m) => {
            const md = parseISO(m.date);
            if (!md) return null;
            const mx = diffDays(range.min, md) * DAY_WIDTH_PX;
            const mstatus = milestoneStatus(
              m,
              tasksById,
              todayISO,
              EMPTY_HOLIDAY_SET,
              MILESTONE_DUE_SOON_WORKDAYS,
            );
            const achieved = isAchieved(m);
            const atRisk = mstatus === "at-risk";
            return (
              <div
                key={`m-${m.id}`}
                role="row"
                className="relative flex border-b border-line"
                style={{ height: ROW_HEIGHT_PX }}
              >
                <div
                  className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 truncate border-r border-line bg-surface pr-3 text-xs"
                  style={{ width: LEFT_GUTTER_PX }}
                  title={`${m.name} · ${m.date}`}
                >
                  {/* Gutter diamond icon — intentionally fixed 16-viewBox size,
                      independent of chart scale (icon, not a chart element). */}
                  <svg
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    className="ml-2 h-3 w-3 shrink-0"
                  >
                    <rect
                      x={2}
                      y={2}
                      width={12}
                      height={12}
                      transform="rotate(45 8 8)"
                      {...milestoneDiamondProps(achieved, atRisk)}
                    />
                  </svg>
                  {onEditMilestone ? (
                    <button
                      type="button"
                      onClick={() => onEditMilestone(m)}
                      title={`${m.name} · ${m.date} — ${t(lang, "clickToEdit")}`}
                      className={`truncate rounded-md border border-transparent px-1 py-0.5 text-left hover:border-AIPM-dark-blue hover:bg-surface-muted ${
                        achieved
                          ? "text-muted-foreground line-through"
                          : "text-foreground"
                      }`}
                    >
                      {m.name}
                    </button>
                  ) : (
                    <span
                      className={`truncate ${
                        achieved
                          ? "text-muted-foreground line-through"
                          : "text-foreground"
                      }`}
                    >
                      {m.name}
                    </span>
                  )}
                </div>
                <div
                  className="relative"
                  style={{ width: timelineWidthPx, height: ROW_HEIGHT_PX }}
                  title={`${m.name} · ${m.date}`}
                >
                  <svg
                    className="h-full w-full overflow-visible"
                    viewBox={`0 0 ${timelineWidthPx} ${ROW_HEIGHT_PX}`}
                    preserveAspectRatio="none"
                  >
                    <rect
                      x={mx - MILESTONE_DIAMOND_PX / 2}
                      y={(ROW_HEIGHT_PX - MILESTONE_DIAMOND_PX) / 2}
                      width={MILESTONE_DIAMOND_PX}
                      height={MILESTONE_DIAMOND_PX}
                      transform={`rotate(45 ${mx} ${ROW_HEIGHT_PX / 2})`}
                      {...milestoneDiamondProps(achieved, atRisk)}
                    />
                  </svg>
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
      <ResizeCornerHint lang={lang} />
    </div>
  );
}
