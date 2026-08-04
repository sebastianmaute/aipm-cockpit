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

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { type Lang, t } from "./i18n";
import { ViewCallout } from "./view-callout";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { AddFirstItemButton } from "./add-first-item-button";
import { useResizable } from "./use-resizable";
import { useGanttBarDrag } from "./use-gantt-bar-drag";
import { useGanttPrefs } from "./use-gantt-prefs";
import { GanttToolbar } from "./gantt-chrome";
import { GanttChart } from "./gantt-chart";
import { dayLeftPx } from "./gantt-overlays";
import { type Absence, type Milestone, type Priority, type Resource, type Task } from "./types";
import { effectivePersonName } from "./resource-foundation";
import { descriptionText } from "./rich-text-projection";
import { sortMilestones } from "./milestones";
import { milestoneStatusBucket, taskStatusBuckets } from "./gantt-status-buckets";
import { isTaskClosed } from "./task-closed";
import {
  addDays,
  ALL_GANTT_STATUSES,
  buildGanttRows,
  clampNameColWidth,
  computeCriticalPath,
  DAY_WIDTH_PX,
  deriveBar,
  diffDays,
  EMPTY_HOLIDAY_SET,
  fmtMonth,
  type GanttBarEdit,
  LEFT_GUTTER_PX,
  naturalCompare,
  parseISO,
  todayUTC,
  toISODay,
} from "./gantt-engine";

// ---------- panel component ------------------------------------------------

export function GanttPanel({
  lang,
  tasks,
  absences,
  resources = [],
  milestones = [],
  onUpdateBar,
  onAddTask,
  onEditTask,
  onAddMilestone,
  onEditMilestone,
  showHints,
  isPopout,
  onLearnMore,
  baselineMilestoneDates,
  holidaySet = EMPTY_HOLIDAY_SET,
  dedupButton,
}: {
  lang: Lang;
  tasks: readonly Task[];
  absences: readonly Absence[];
  resources?: readonly Resource[];
  milestones?: readonly Milestone[];
  onUpdateBar?: (edit: GanttBarEdit) => void;
  onAddTask?: () => void;
  onEditTask?: (task: Task) => void;
  onAddMilestone?: () => void;
  onEditMilestone?: (m: Milestone) => void;
  showHints?: boolean;
  isPopout?: boolean;
  onLearnMore?: (conceptId: string) => void;
  baselineMilestoneDates?: ReadonlyMap<number, string>;
  /**
   * Non-working days (ISO `YYYY-MM-DD`) shaded behind the rows when the View
   * popover's holiday toggle is on. Defaults to the SHARED module-level
   * `EMPTY_HOLIDAY_SET` — an inline `new Set()` would be a fresh identity every
   * render and churn any memo that ever depends on it.
   */
  holidaySet?: ReadonlySet<string>;
  /** AI "Deduplicate & unify" trigger, built by the view wrapper. See GanttToolbar. */
  dedupButton?: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const didInitialScroll = useRef(false);
  const { ref: ganttRef, reset: resetGanttSize } = useResizable("aipm-cockpit:gantt-size");

  // --- resizable task-name (left gutter) column, persisted per-device -------
  const NAME_COL_KEY = "aipm-cockpit:gantt-namecol";
  const [nameColWidth, setNameColWidth] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(NAME_COL_KEY);
      if (raw) return clampNameColWidth(Number(JSON.parse(raw)));
    } catch { /* ignore */ }
    return LEFT_GUTTER_PX;
  });
  const persistNameColWidth = useCallback((w: number) => {
    const c = clampNameColWidth(w);
    setNameColWidth(c);
    try { window.localStorage.setItem(NAME_COL_KEY, JSON.stringify(c)); } catch { /* ignore */ }
  }, []);
  const resetNameColWidth = useCallback(() => {
    setNameColWidth(LEFT_GUTTER_PX);
    try { window.localStorage.removeItem(NAME_COL_KEY); } catch { /* ignore */ }
  }, []);
  // Pointer-drag the gutter's right edge: capture the start x + width on
  // mousedown, then track window mousemove until mouseup (mirrors
  // useColumnResize's dragRef window-listener lifecycle).
  const startNameColResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = nameColWidth;
    function onMove(mv: MouseEvent) {
      persistNameColWidth(startW + mv.clientX - startX);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [nameColWidth, persistNameColWidth]);

  // --- prefs: sort + filters + custom order, persisted in localStorage ---
  // The hook owns the state + hydration/persistence and exposes per-control
  // setters; setPrefs is used directly by the custom-order drag-reorder path.
  const {
    prefs,
    setPrefs,
    setSort,
    setSearch,
    toggleStatus,
    togglePriority,
    toggleAssignee,
    resetFilters,
    toggleCriticalPath,
    toggleBaseline,
    toggleMilestonePlacement,
    toggleHolidays,
    toggleAbsences,
    toggleDependencies,
    toggleMilestones,
    toggleGrid,
  } = useGanttPrefs();

  // The Gantt shows the milestone baseline overlay only when the pinned snapshot
  // carries baseline dates (Turso). Off Turso this is undefined/empty → no toggle.
  const hasBaseline = (baselineMilestoneDates?.size ?? 0) > 0;
  // Hoisted for the range dep array (exhaustive-deps bans `prefs.showBaseline`).
  const showBaselinePref = prefs.showBaseline;

  // Today is used in date math (overdue computation, range padding). It's
  // evaluated once per render — server / client first paint produce the
  // same value as long as they fall on the same UTC day.
  const today = todayUTC();
  // YYYY-MM-DD form of the chart's "today", for milestone status math.
  // Computed from a fresh todayUTC() rather than the `today` const above so
  // the React Compiler doesn't treat the shared `today` as passed-and-mutable
  // (which would bail out the component's manual memoization).
  const todayISO = toISODay(todayUTC());

  // Resource lookup for resolving the LIVE display name of a linked person
  // reference. Kept as its own memo keyed on [resources] so it doesn't bust the
  // [tasks]-keyed search-haystack memo when unrelated state changes.
  const resourcesById = useMemo(
    () => new Map(resources.map((r) => [r.id, r])),
    [resources],
  );

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
      // Closed, not merely delivered: a cancelled task is not a schedule driver.
      if (isTaskClosed(t)) completed.add(t.id);
    }
    return computeCriticalPath(tasks, allBars, completed);
  }, [tasks, allBars, prefs.showCriticalPath]);

  // Assignees for the dropdown — derived from tasks regardless of filter.
  const assigneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      const a = effectivePersonName(t.assignee, t.resourceId, resourcesById).trim();
      if (a) set.add(a);
    }
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [tasks, resourcesById]);

  // Precompute each task's lowercased search haystack keyed on the tasks array
  // ONLY. A search keystroke changes `prefs`, not `tasks`, so the filter loop
  // below reuses these strings instead of re-allocating + re-joining +
  // re-lowercasing every task's fields on every keystroke.
  const haystacks = useMemo(() => {
    const map = new Map<number, string>();
    for (const task of tasks) {
      map.set(
        task.id,
        [
          task.taskName,
          effectivePersonName(task.assignee, task.resourceId, resourcesById),
          task.assigneeEmail ?? "",
          task.blockers ?? "",
          descriptionText(task.description ?? ""),
          task.group ?? "",
          (task.labels ?? []).join(" "),
        ]
          .join(" ")
          .toLowerCase(),
      );
    }
    return map;
  }, [tasks, resourcesById]);

  // --- filter + sort pipeline -----------------------------------------
  const visible = useMemo(() => {
    const q = prefs.search.trim().toLowerCase();
    const placeable: Task[] = [];
    for (const task of tasks) {
      const bar = allBars.get(task.id);
      if (!bar) continue;

      // Status filter — a task shows when it lands in ANY ticked bucket. An
      // EMPTY selection shows nothing (v2 semantics); the chart renders an
      // explicit message rather than a blank grid.
      const buckets = taskStatusBuckets(task, bar, today);
      if (!prefs.statuses.some((s) => buckets.has(s))) continue;

      // Priority filter — multi-select, OR within the filter (empty = all).
      if (prefs.priorities.length > 0 && !prefs.priorities.includes(task.priority))
        continue;

      // Assignee filter — multi-select, OR within (empty = all). Compare against
      // the LIVE resolved name so a renamed linked resource still matches the
      // (resolved) dropdown option.
      if (
        prefs.assignees.length > 0 &&
        !prefs.assignees.includes(
          effectivePersonName(task.assignee, task.resourceId, resourcesById),
        )
      )
        continue;

      // Full-text search across the same surfaces the tasks-list search uses,
      // reading the precomputed haystack (rebuilt only when tasks change).
      if (q) {
        const hay = haystacks.get(task.id) ?? "";
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
  }, [tasks, allBars, prefs, today, haystacks, resourcesById]);

  // Compatibility alias so the existing chart code keeps reading from
  // `layout.placeable` / `layout.bars`.
  const layout = { placeable: visible, bars: allBars };

  // The ordered row list (tasks + milestones). In "below" mode this is every
  // task row then every milestone row (the historical layout); in "inline" mode
  // each non-achieved milestone is spliced into the task rows at its due-date
  // position. Hoisted scalar for the dep array (exhaustive-deps bans
  // `prefs.milestonePlacement`).
  const milestonePlacement = prefs.milestonePlacement;

  // Milestones obey the same status buckets as the tasks, plus the independent
  // "show milestone rows at all" toggle. Both the row list AND the dependency
  // overlay read THIS list, so a hidden milestone can never get a connector
  // drawn to a row index that no longer exists.
  //
  // `statusesKey` is a string, not the array: `prefs.statuses` is a fresh
  // identity every render, and exhaustive-deps rejects an `obj.member` dep.
  const statusesKey = prefs.statuses.join(",");
  const showMilestones = prefs.showMilestones;
  const visibleMilestones = useMemo(() => {
    if (!showMilestones) return [];
    const ticked = new Set(statusesKey ? statusesKey.split(",") : []);
    return sortedMilestones.filter((m) =>
      ticked.has(milestoneStatusBucket(m, todayISO)),
    );
  }, [showMilestones, statusesKey, sortedMilestones, todayISO]);

  const rows = useMemo(
    () => buildGanttRows(visible, visibleMilestones, milestonePlacement, allBars),
    [visible, visibleMilestones, milestonePlacement, allBars],
  );

  // Row index lookups for the dependency-arrow + milestone-connector overlays.
  // Keyed on the FULL row list so both task arrows and milestone connectors
  // point at the right Y regardless of interleaving. Misses read as -1 to keep
  // the original findIndex semantics.
  const taskRowIndexById = useMemo(() => {
    const m = new Map<number, number>();
    rows.forEach((r, idx) => {
      if (r.kind === "task") m.set(r.task.id, idx);
    });
    return m;
  }, [rows]);
  const milestoneRowIndexById = useMemo(() => {
    const m = new Map<number, number>();
    rows.forEach((r, idx) => {
      if (r.kind === "milestone") m.set(r.milestone.id, idx);
    });
    return m;
  }, [rows]);

  // --- drag-and-drop reordering --------------------------------------
  // Track the id currently being dragged + the row we're hovering over.
  // Both are used purely for visual feedback (drop indicator on the
  // target row). The reordering itself happens on drop.
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);

  // --- bar drag-edit (move / resize-start / resize-end) ----------------
  // Owns the in-flight drag state + window pointer listeners; the render
  // layer reads barDrag/barDragDeltaDays to draw the preview bar, calls
  // startBarDrag on a bar's pointerdown, and checks interactingWithBarRef
  // in the row's onDragStart to suppress native HTML5 row-reorder.
  const { barDrag, barDragDeltaDays, interactingWithBarRef, previewDates, startBarDrag } =
    useGanttBarDrag(onUpdateBar);

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
      const key = effectivePersonName(a.assignee, a.resourceId, resourcesById)
        .trim()
        .toLowerCase();
      if (!key) continue;
      const list = m.get(key);
      if (list) list.push(a);
      else m.set(key, [a]);
    }
    return m;
  }, [absences, resourcesById]);

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
    // Fold baseline ghost dates in too (when the overlay is on) so a milestone
    // that slipped far from its committed baseline still has its ghost diamond +
    // connector on the visible axis, not clipped off the left/right edge.
    if (showBaselinePref && baselineMilestoneDates) {
      for (const iso of baselineMilestoneDates.values()) {
        const d = parseISO(iso);
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
  }, [layout.bars, milestones, baselineMilestoneDates, showBaselinePref]);

  // Same expression the holiday shading and the day grid use — shared so the
  // marker cannot drift off the day column it is supposed to sit on.
  const todayOffsetPx = dayLeftPx(diffDays(range.min, today), nameColWidth);
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
  const chartWidthPx = nameColWidth + timelineWidthPx;
  const rowsCount = layout.placeable.length;
  // Total rows rendered in the chart body (task rows + milestone rows, however
  // they're interleaved). The dependency-edge overlay must span all of them so
  // linked-task -> milestone connectors aren't clipped at the task-row edge.
  const totalRowsCount = rows.length;

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
  // The status filter is "active" only when it NARROWS something: under v2 the
  // default is every bucket ticked, so a `length > 0` test would call an
  // untouched project filtered and hide its "add your first task" affordance.
  const filtersActive =
    prefs.search.trim() !== "" ||
    prefs.statuses.length < ALL_GANTT_STATUSES.length ||
    prefs.priorities.length > 0 ||
    prefs.assignees.length > 0;

  // Nothing ticked at all — the filter excludes every row by construction, so
  // say so instead of showing a blank grid the user can't interpret.
  const noStatusSelected = prefs.statuses.length === 0;

  // ONE source for the "why is this empty" copy, shared by the whole-panel
  // early return below and by the chart-body guard. Both branches ask the same
  // question, so a second inline copy of the ternary is how the two drift.
  const emptyMessageKey = noStatusSelected
    ? "ganttNoStatusSelected"
    : filtersActive
      ? "ganttNoMatches"
      : "ganttEmpty";

  // "The chart body would render nothing." Strictly wider than
  // `noStatusSelected`: a non-empty status selection that matches no task AND
  // no milestone lands here too (e.g. only "overdue" ticked, with one future
  // task and one future milestone), and used to fall through to a header and
  // today marker drawn over an unexplained void.
  const rendersNothing = rows.length === 0;

  const toolbar = (
    <GanttToolbar
      lang={lang}
      prefs={prefs}
      assigneeOptions={assigneeOptions}
      filtersActive={filtersActive}
      onAddTask={onAddTask}
      onAddMilestone={onAddMilestone}
      resetGanttSize={resetGanttSize}
      resetNameColWidth={resetNameColWidth}
      setSearch={setSearch}
      toggleStatus={toggleStatus}
      togglePriority={togglePriority}
      toggleAssignee={toggleAssignee}
      setSort={setSort}
      resetFilters={resetFilters}
      toggleCriticalPath={toggleCriticalPath}
      toggleBaseline={toggleBaseline}
      hasBaseline={hasBaseline}
      toggleMilestonePlacement={toggleMilestonePlacement}
      hasMilestones={sortedMilestones.length > 0}
      toggleHolidays={toggleHolidays}
      toggleAbsences={toggleAbsences}
      toggleDependencies={toggleDependencies}
      toggleMilestones={toggleMilestones}
      toggleGrid={toggleGrid}
      dedupButton={dedupButton}
    />
  );

  if (rowsCount === 0 && sortedMilestones.length === 0) {
    return (
      <div ref={ganttRef} className={`print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`}>
        {toolbar}
        {!filtersActive && onAddTask ? (
          // Empty (no tasks) → the whole box is the add affordance, mirroring
          // the budget panel's clickable "+ add bucket" empty state. The
          // descriptive text stays; no separate Add-task button.
          <AddFirstItemButton
            onAdd={onAddTask}
            text={t(lang, "ganttEmpty")}
            addLabel={`+ ${t(lang, "addTaskButton")}…`}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted-foreground">
            <span>{t(lang, emptyMessageKey)}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={ganttRef} className={`print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`}>
      {onLearnMore && (
        <ViewCallout view="gantt" lang={lang} showHints={showHints !== false} isPopout={!!isPopout} onLearnMore={onLearnMore} />
      )}
      {toolbar}
      <GanttChart
        scrollRef={scrollRef}
        lang={lang}
        prefs={prefs}
        range={range}
        monthGroups={monthGroups}
        today={today}
        todayISO={todayISO}
        timelineWidthPx={timelineWidthPx}
        nameColWidth={nameColWidth}
        chartWidthPx={chartWidthPx}
        todayOffsetPx={todayOffsetPx}
        onStartNameColResize={startNameColResize}
        rendersNothing={rendersNothing}
        emptyMessageKey={emptyMessageKey}
        holidaySet={holidaySet}
        totalRowsCount={totalRowsCount}
        rows={rows}
        bars={layout.bars}
        placeable={layout.placeable}
        taskRowIndexById={taskRowIndexById}
        milestoneRowIndexById={milestoneRowIndexById}
        critical={critical}
        visibleMilestones={visibleMilestones}
        absencesByAssigneeKey={absencesByAssigneeKey}
        resourcesById={resourcesById}
        tasksById={tasksById}
        draggingId={draggingId}
        dropTargetId={dropTargetId}
        setDraggingId={setDraggingId}
        setDropTargetId={setDropTargetId}
        handleDrop={handleDrop}
        interactingWithBarRef={interactingWithBarRef}
        barDrag={barDrag}
        barDragDeltaDays={barDragDeltaDays}
        previewDates={previewDates}
        startBarDrag={startBarDrag}
        onUpdateBar={onUpdateBar}
        onEditTask={onEditTask}
        onEditMilestone={onEditMilestone}
        onAddTask={onAddTask}
        baselineMilestoneDates={baselineMilestoneDates}
      />
    </div>
  );
}
