// src/app/gantt-rows.tsx — the per-row render surfaces for the Gantt chart:
// GanttTaskRow (draggable task row + absence bands + drag-editable bar) and
// GanttMilestoneRow (a diamond at the milestone's date). Presentational —
// GanttPanel owns the data, drag state, and handlers and threads them in.
import { Bars2Icon } from "./icons";
import { type Lang, t } from "./i18n";
import { type Absence, type Milestone, type Resource, type Task } from "./types";
import { effectivePersonName } from "./resource-foundation";
import { isAchieved, milestoneStatus, MILESTONE_DUE_SOON_WORKDAYS } from "./milestones";
import { isTaskClosed } from "./task-closed";
import { rowLabel } from "./row-tokens";
import { type BarDrag, type GanttBarDrag } from "./use-gantt-bar-drag";
import { FOCUS_RING } from "./interaction-styles";
import {
  absenceBandBg,
  BAR_HEIGHT_PX,
  BAR_VPADDING_PX,
  DAY_WIDTH_PX,
  diffDays,
  EMPTY_HOLIDAY_SET,
  type GanttBarEdit,
  fmtFull,
  MILESTONE_DIAMOND_PX,
  milestoneSlipDays,
  milestoneDiamondProps,
  parseISO,
  priorityFillClass,
  shiftIsoDate,
  ROW_HEIGHT_PX,
} from "./gantt-engine";
import { CELL_BUTTON } from "./control-classes";
import { ChanceChip } from "./milestone-horizon-strip";
import { chanceText } from "./chance-text";

export function GanttTaskRow({
  rowKey,
  task,
  rowToken,
  bar,
  lang,
  today,
  timelineWidthPx,
  nameColWidth,
  range,
  absencesByAssigneeKey,
  showAbsences,
  resourcesById,
  critical,
  draggingId,
  dropTargetId,
  setDraggingId,
  setDropTargetId,
  handleDrop,
  interactingWithBarRef,
  barDrag,
  barDragDeltaDays,
  previewDates,
  startBarDrag,
  onBarKeyDown,
  onBarBlur,
  onUpdateBar,
  onEditTask,
}: {
  task: Task;
  /**
   * The row's display name, already disambiguated against its siblings by
   * GanttPanel (`buildRowTokens`). With no collision this IS `task.taskName`.
   *
   * ★ A prop rather than something derived here: this component sees one row
   * and cannot know whether another row carries the same name.
   */
  rowToken: string;
  /** The row's key (`ganttRowKey`), set as `data-gantt-row` on the row root: the
   *  Gantt row window (§5) reads it to keep a focused row mounted. */
  rowKey: string;
  bar: { start: Date; end: Date };
  lang: Lang;
  today: Date;
  timelineWidthPx: number;
  nameColWidth: number;
  range: { min: Date; max: Date };
  absencesByAssigneeKey: ReadonlyMap<string, Absence[]>;
  /** View-popover toggle. Defaults ON in prefs, so this is invisible until used. */
  showAbsences: boolean;
  resourcesById: ReadonlyMap<number, Pick<Resource, "firstName" | "lastName">>;
  critical: { criticalTasks: ReadonlySet<number> };
  draggingId: number | null;
  dropTargetId: number | null;
  setDraggingId: (id: number | null) => void;
  setDropTargetId: (id: number | null) => void;
  handleDrop: (fromId: number, toId: number) => void;
  interactingWithBarRef: React.MutableRefObject<boolean>;
  barDrag: BarDrag | null;
  barDragDeltaDays: number;
  previewDates: GanttBarDrag["previewDates"];
  startBarDrag: GanttBarDrag["startBarDrag"];
  onBarKeyDown: GanttBarDrag["onBarKeyDown"];
  onBarBlur: GanttBarDrag["onBarBlur"];
  onUpdateBar?: (edit: GanttBarEdit) => void;
  onEditTask?: (task: Task) => void;
}) {
  // Closed, not merely delivered — a cancelled bar renders struck-through
  // rather than overdue-red, matching the status filter's buckets.
  const isComplete = isTaskClosed(task);
  const isOverdue = !isComplete && bar.end.getTime() < today.getTime();
  const isDragging = draggingId === task.id;
  const isDropTarget = dropTargetId === task.id && draggingId !== task.id;
  return (
    <div
      data-gantt-row={rowKey}
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
          className="pointer-events-none absolute left-0 right-0 top-0 z-20 h-0.5 bg-ui-dark-blue"
        />
      )}
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 truncate border-r border-line bg-surface pr-3 text-xs"
        style={{ width: nameColWidth }}
        title={task.taskName}
      >
        <span
          aria-hidden
          className="cursor-grab text-muted-foreground hover:text-ui-dark-blue dark:hover:text-ui-light-grey active:cursor-grabbing"
          title={t(lang, "ganttDragHint")}
        >
          {/* Grip icon — the common "drag handle" affordance. */}
          <Bars2Icon aria-hidden="true" className="ml-1 h-4 w-4" />
        </span>
        <span className="font-mono text-muted-foreground">
          #{task.id}
        </span>
        {onEditTask ? (
          <button
            type="button"
            onClick={() => onEditTask(task)}
            onPointerDown={(e) => e.stopPropagation()}
            // ★ Set UNCONDITIONALLY, not only under a collision: with no
            // collision the token IS the bare name, so this restates the
            // visible content for the common case. Without it the button takes
            // its name from its CONTENT, and two tasks sharing a name render
            // two identically-named buttons.
            // ★ WCAG 2.5.3 holds by CONTAINMENT — the visible "Alpha" sits
            // inside "Alpha (2)" because `buildRowTokens` APPENDS its suffix.
            // ★ The `#id` span sits OUTSIDE this button, so it disambiguates
            // nothing here.
            aria-label={rowToken}
            title={`${task.taskName} — ${t(lang, "clickToEdit")}`}
            className={`${CELL_BUTTON} truncate px-2 py-0.5 text-left ${
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
          if (!showAbsences) return null;
          const rowKey = effectivePersonName(task.assignee, task.resourceId, resourcesById)
            .trim()
            .toLowerCase();
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
                data-absence={a.id}
                aria-hidden="true"
                title={`${effectivePersonName(a.assignee, a.resourceId, resourcesById)}: ${a.type} ${a.startDate}${
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
          // We block CLOSED tasks — `isTaskClosed` is Done OR
          // Cancelled — on the grounds that neither is still being
          // scheduled, so a stray drag would only ever be an
          // accident. Also blocked: any task lacking an edit callback.
          const editable = !!onUpdateBar && !isComplete;
          // §742 — the sliders' value is a day offset from the chart's first day, like the milestone handle's.
          const sliderMax = Math.round(timelineWidthPx / DAY_WIDTH_PX);

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
                    ? "ring-2 ring-ui-pink"
                    : isOverdue
                      ? "ring-2 ring-ui-pink/70"
                      : ""
              } ${
                barDrag && barDrag.taskId === task.id
                  ? "ring-2 ring-ui-dark-blue/60"
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
                  {/* ★ Each handle's label carries the row token: these three
                      names are the SAME string on every row, so N editable
                      tasks put 3N identically-named controls in one view. The
                      handles render no visible text, so 2.5.3 does not
                      constrain the wording.
                      ★ §742 — each is a focusable SLIDER, like the milestone
                      handle: arrows move the preview, the value text speaks the
                      date(s) it would save, and the edit commits once (on a
                      pause, Enter or blur; Escape cancels). Three tab stops per
                      editable bar: each handle was already exposed as its own
                      control, so each is made operable rather than hidden
                      behind a chord on the move handle. */}
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label={rowLabel(t(lang, "ganttBarResizeStart"), rowToken)}
                    aria-orientation="horizontal"
                    aria-valuemin={0}
                    aria-valuemax={sliderMax}
                    aria-valuenow={diffDays(range.min, displayStart)}
                    aria-valuetext={fmtFull(displayStart, lang)}
                    className={`absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize ${FOCUS_RING}`}
                    onPointerDown={(e) =>
                      startBarDrag(e, task, bar, "resize-start")
                    }
                    onKeyDown={(e) => onBarKeyDown(e, task, bar, "resize-start")}
                    onBlur={() => onBarBlur(task.id, "resize-start")}
                  />
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label={rowLabel(t(lang, "ganttBarMove"), rowToken)}
                    aria-orientation="horizontal"
                    aria-valuemin={0}
                    aria-valuemax={sliderMax}
                    aria-valuenow={diffDays(range.min, displayStart)}
                    aria-valuetext={`${fmtFull(displayStart, lang)} → ${fmtFull(displayEnd, lang)}`}
                    className={`absolute inset-x-1.5 top-0 z-0 h-full cursor-grab active:cursor-grabbing ${FOCUS_RING}`}
                    onPointerDown={(e) =>
                      startBarDrag(e, task, bar, "move")
                    }
                    onKeyDown={(e) => onBarKeyDown(e, task, bar, "move")}
                    onBlur={() => onBarBlur(task.id, "move")}
                  />
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label={rowLabel(t(lang, "ganttBarResizeEnd"), rowToken)}
                    aria-orientation="horizontal"
                    aria-valuemin={0}
                    aria-valuemax={sliderMax}
                    aria-valuenow={diffDays(range.min, displayEnd)}
                    aria-valuetext={fmtFull(displayEnd, lang)}
                    className={`absolute right-0 top-0 z-10 h-full w-1.5 cursor-ew-resize ${FOCUS_RING}`}
                    onPointerDown={(e) =>
                      startBarDrag(e, task, bar, "resize-end")
                    }
                    onKeyDown={(e) => onBarKeyDown(e, task, bar, "resize-end")}
                    onBlur={() => onBarBlur(task.id, "resize-end")}
                  />
                </>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export function GanttMilestoneRow({
  rowKey,
  m,
  date: md,
  rowToken,
  lang,
  range,
  timelineWidthPx,
  nameColWidth,
  tasksById,
  todayISO,
  onEditMilestone,
  baselineDate,
  showBaseline,
  dragDeltaDays = 0,
  onStartDrag,
  onKeyMove,
  onHandleBlur,
  chance,
}: {
  m: Milestone;
  /**
   * The milestone's display name, disambiguated by GanttPanel against every
   * OTHER ROW in the chart — task rows included, since they are siblings in
   * the same view. With no collision this IS `m.name`.
   */
  rowToken: string;
  /** The row's key (`ganttRowKey`), set as `data-gantt-row` on the row root: the
   *  Gantt row window (§5) reads it to keep a focused row mounted. */
  rowKey: string;
  /**
   * The milestone's parsed date, carried on its `GanttRow` (§273). GanttPanel
   * leaves out any milestone whose date does not parse before it builds rows, so
   * this component always has a date to draw at and never renders nothing — a
   * row that rendered nothing would still have been numbered against its twins.
   */
  date: Date;
  lang: Lang;
  range: { min: Date };
  timelineWidthPx: number;
  nameColWidth: number;
  tasksById: ReadonlyMap<number, Task>;
  todayISO: string;
  onEditMilestone?: (m: Milestone) => void;
  baselineDate?: string;
  showBaseline?: boolean;
  /** Whole days this milestone is being dragged by right now (0 = not dragging). */
  dragDeltaDays?: number;
  /** Present when the milestone may be moved on the chart (not in a popout). */
  onStartDrag?: (e: React.PointerEvent<HTMLElement>, m: Milestone) => void;
  onKeyMove?: (e: React.KeyboardEvent<HTMLElement>, m: Milestone) => void;
  onHandleBlur?: (m: Milestone) => void;
  /** The shared forecast run's chance on time (§502), present only for a milestone the run gave
   *  `state: "chance"`; a signed-off milestone shows no chip even then. */
  chance?: number;
}) {
  // While a drag is in flight everything on the row — the diamond, its
  // at-risk colour, the baseline slip — reads the date it WOULD get on release,
  // so moving it before linked work shows the conflict live.
  const liveIso = dragDeltaDays !== 0 ? (shiftIsoDate(m.date, dragDeltaDays) ?? m.date) : m.date;
  const live = liveIso === m.date ? m : { ...m, date: liveIso };
  const liveDate = parseISO(liveIso) ?? md;
  const mx = diffDays(range.min, liveDate) * DAY_WIDTH_PX;
  // Baseline ghost: a hollow diamond at the committed baseline date, a dotted
  // connector to the live diamond, and a signed slip label. Only when enabled,
  // a baseline exists, it is parseable, and the slip is non-zero.
  const bd = showBaseline && baselineDate ? parseISO(baselineDate) : null;
  const slip = bd ? milestoneSlipDays(baselineDate!, live.date) : null;
  const showGhost = bd !== null && slip !== null && slip !== 0;
  const bx = bd ? diffDays(range.min, bd) * DAY_WIDTH_PX : 0;
  const slipLabel = slip !== null ? `${slip > 0 ? "+" : "−"}${Math.abs(slip)}d` : "";
  // The preview date label's side: left of the diamond, or right of it near
  // the first day, where a left label would start under the sticky name
  // column and no scroll could uncover it (the axis stays put rather than
  // grow room for it). On the right it would land on the slip label, so the
  // two are then drawn as ONE label, after the rightmost diamond. On the
  // left it ends before the LEFTMOST diamond, so a ghost left of the live
  // diamond (a later slip) and its connector stay clear of it too.
  const previewLeftEdge = showGhost ? Math.min(mx, bx) : mx;
  const previewSide = dragDeltaDays === 0 ? null : previewLeftEdge < MILESTONE_PREVIEW_LABEL_ROOM_PX ? "right" : "left";
  const previewTakesSlip = previewSide === "right" && showGhost;
  const mstatus = milestoneStatus(
    live,
    tasksById,
    todayISO,
    EMPTY_HOLIDAY_SET,
    MILESTONE_DUE_SOON_WORKDAYS,
  );
  const achieved = isAchieved(m);
  const atRisk = mstatus === "at-risk";
  const movable = !!onStartDrag && !achieved;
  const timelineTitle = showGhost
    ? `${m.name} · ${fmtFull(liveDate, lang)} · baseline ${bd ? fmtFull(bd, lang) : baselineDate} (${slipLabel})`
    : `${m.name} · ${fmtFull(liveDate, lang)}`;
  return (
    <div
      data-gantt-row={rowKey}
      className="relative flex border-b border-line"
      style={{ height: ROW_HEIGHT_PX }}
    >
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 truncate border-r border-line bg-surface pr-3 text-xs"
        style={{ width: nameColWidth }}
        title={`${m.name} · ${fmtFull(liveDate, lang)}`}
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
            // ★ Same rule as the task row's name button: set unconditionally,
            // because without it the accessible name falls back to the CONTENT
            // and two milestones sharing a name render two identical buttons.
            // This row renders no id, so nothing else disambiguates it.
            aria-label={rowToken}
            title={`${m.name} · ${fmtFull(liveDate, lang)} — ${t(lang, "clickToEdit")}`}
            className={`${CELL_BUTTON} truncate px-2 py-0.5 text-left ${
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
        {chance !== undefined && !achieved && (
          // The Dashboard's chip (§502): decorative, said once by the sr-only text beside it.
          <span className="ml-auto shrink-0">
            <ChanceChip lang={lang} chance={chance} />
            <span className="sr-only">{t(lang, "milestoneChanceChipSr", chanceText(lang, chance))}</span>
          </span>
        )}
      </div>
      <div
        className="relative"
        style={{ width: timelineWidthPx, height: ROW_HEIGHT_PX }}
        title={timelineTitle}
      >
        <svg
          className="h-full w-full overflow-visible"
          viewBox={`0 0 ${timelineWidthPx} ${ROW_HEIGHT_PX}`}
          preserveAspectRatio="none"
        >
          {showGhost && (
            <>
              {/* dotted connector baseline -> live, at row mid-height */}
              <line
                x1={bx}
                y1={ROW_HEIGHT_PX / 2}
                x2={mx}
                y2={ROW_HEIGHT_PX / 2}
                stroke="var(--line)"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
              {/* hollow ghost diamond at the baseline date */}
              <rect
                x={bx - MILESTONE_DIAMOND_PX / 2}
                y={(ROW_HEIGHT_PX - MILESTONE_DIAMOND_PX) / 2}
                width={MILESTONE_DIAMOND_PX}
                height={MILESTONE_DIAMOND_PX}
                transform={`rotate(45 ${bx} ${ROW_HEIGHT_PX / 2})`}
                fill="none"
                stroke="var(--line)"
                strokeWidth={1.5}
              />
            </>
          )}
          <rect
            x={mx - MILESTONE_DIAMOND_PX / 2}
            y={(ROW_HEIGHT_PX - MILESTONE_DIAMOND_PX) / 2}
            width={MILESTONE_DIAMOND_PX}
            height={MILESTONE_DIAMOND_PX}
            transform={`rotate(45 ${mx} ${ROW_HEIGHT_PX / 2})`}
            {...milestoneDiamondProps(achieved, atRisk)}
          />
        </svg>
        {showGhost && !previewTakesSlip && (
          <span
            className="pointer-events-none absolute -translate-y-1/2 text-[10px] text-muted-foreground"
            // Right of whichever diamond is rightmost — for a negative (pulled-in)
            // slip the ghost sits right of the live diamond, so anchoring on `mx`
            // alone would overlap it.
            style={{ left: Math.max(mx, bx) + MILESTONE_DIAMOND_PX, top: ROW_HEIGHT_PX / 2 }}
            aria-hidden="true"
          >
            {slipLabel}
          </span>
        )}
        {previewSide !== null && (
          // The date the milestone lands on if released now, on the side
          // `previewSide` picked: left, clear of the ghost and of the slip label on the right.
          <span
            data-gantt-milestone-preview={previewSide}
            className="pointer-events-none absolute -translate-y-1/2 whitespace-nowrap text-[10px] font-medium text-foreground"
            style={{
              ...(previewSide === "right"
                ? { left: (previewTakesSlip ? Math.max(mx, bx) : mx) + MILESTONE_DIAMOND_PX }
                : { right: timelineWidthPx - previewLeftEdge + MILESTONE_DIAMOND_PX }),
              top: ROW_HEIGHT_PX / 2,
            }}
            aria-hidden="true"
          >
            {previewTakesSlip ? `${fmtFull(liveDate, lang)} · ${slipLabel}` : fmtFull(liveDate, lang)}
          </span>
        )}
        {movable && onStartDrag && (
          // ★ Focusable on purpose — the keyboard path to the same move
          // (the task bars' three handles follow it since §742). A SLIDER, not a
          // button: its value text is the date, so a screen reader announces
          // the new date after every arrow press (a button would say nothing,
          // and would promise an Enter/Space action it does not have). The
          // value is the day offset on the timeline. Its name carries the row
          // token: N milestones would otherwise be N identically-named controls.
          // The title repeats the timeline tooltip it covers, plus the hint.
          <div
            role="slider"
            tabIndex={0}
            aria-label={rowLabel(t(lang, "ganttMilestoneMove"), rowToken)}
            // The value is the day offset from the chart's first day, so it
            // shifts when the range does; `aria-valuetext` (the date) is what
            // a screen reader speaks, and that stays exact.
            aria-valuemin={0}
            aria-valuemax={Math.round(timelineWidthPx / DAY_WIDTH_PX)}
            aria-valuenow={diffDays(range.min, liveDate)}
            aria-valuetext={fmtFull(liveDate, lang)}
            aria-orientation="horizontal"
            title={`${timelineTitle} — ${t(lang, "ganttMilestoneMoveHint")}`}
            data-gantt-milestone-handle={m.id}
            className={`absolute top-0 h-full cursor-grab touch-none rounded-sm active:cursor-grabbing ${FOCUS_RING}`}
            style={{ left: mx - MILESTONE_HANDLE_PX / 2, width: MILESTONE_HANDLE_PX }}
            onPointerDown={(e) => onStartDrag(e, m)}
            onKeyDown={(e) => onKeyMove?.(e, m)}
            onBlur={() => onHandleBlur?.(m)}
          />
        )}
      </div>
    </div>
  );
}

/** Hit width of a milestone's drag handle: wider than the diamond so it is easy to grab. */
const MILESTONE_HANDLE_PX = 20;
/** Timeline px a preview date label needs LEFT of its diamond (§715): about
 *  "Oct 12, 2026" at 10px plus the diamond gap. Closer to the first day, the
 *  label goes right of the diamond. */
const MILESTONE_PREVIEW_LABEL_ROOM_PX = 96;
