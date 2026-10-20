// src/app/use-gantt-bar-drag.ts — bar drag-edit interaction for the Gantt chart.
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
//
// Keyboard (§742; each handle is a slider): the milestone drag's keys and timing
// (`use-gantt-milestone-drag.ts`). Arrows move the preview one day, Shift+arrow or
// PageUp/PageDown one week; the edit commits ONCE, after a pause, on Enter or when
// focus leaves, and Escape discards it. A resize stops at the bar's other end.
// A pending keyboard edit lands before a pointer drag on the same bar starts, and
// that drag starts from the dates the keys produced.
import { useEffect, useRef, useState } from "react";
import { addDays, DAY_WIDTH_PX, diffDays, type GanttBarEdit } from "./gantt-engine";
import { MILESTONE_KEY_COMMIT_DELAY_MS, milestoneKeyStep } from "./use-gantt-milestone-drag";
import { type Task } from "./types";

export type BarDragMode = "move" | "resize-start" | "resize-end";
export type BarDrag = {
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

export type GanttBarDrag = {
  barDrag: BarDrag | null;
  barDragDeltaDays: number;
  /** Synchronous "we're driving the bar" flag — read by the row's
   *  `onDragStart` to suppress native HTML5 row-reorder. */
  interactingWithBarRef: React.MutableRefObject<boolean>;
  previewDates: (drag: BarDrag, deltaDays: number) => { start: Date; end: Date };
  startBarDrag: (
    e: React.PointerEvent<HTMLDivElement>,
    task: Task,
    bar: { start: Date; end: Date },
    mode: BarDragMode,
  ) => void;
  /** §742 — a key press on one of a bar's three handles (sliders). */
  onBarKeyDown: (
    e: React.KeyboardEvent<HTMLElement>,
    task: Task,
    bar: { start: Date; end: Date },
    mode: BarDragMode,
  ) => void;
  /** §742 — the handle lost focus: a pending keyboard edit on it commits. */
  onBarBlur: (taskId: number, mode: BarDragMode) => void;
};

export interface GanttBarDragOptions {
  /** As for the milestone drag (`GanttMilestoneDragOptions.isSwapInFlight`): a keyboard edit still pending when the
   *  chart unmounts lands, unless an op replacing this project with another is in flight. */
  isSwapInFlight?: () => boolean;
}

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

/** §742 — the accumulated key days, held where a resize stops at the bar's other end, so a press back the other
 *  way moves the edge at once instead of first unwinding presses that changed nothing. */
export function clampKeyDays(drag: BarDrag, days: number): number {
  const span = diffDays(drag.initialStart, drag.initialEnd);
  if (drag.mode === "resize-start") return Math.min(days, span);
  if (drag.mode === "resize-end") return Math.max(days, -span);
  return days;
}

/** The edit a drag would commit, or null when the dates did not change. */
function editFor(drag: BarDrag, days: number): GanttBarEdit | null {
  const { start, end } = previewDates(drag, days);
  if (start.getTime() === drag.initialStart.getTime() && end.getTime() === drag.initialEnd.getTime()) return null;
  return { taskId: drag.taskId, startDate: toIso(start), dueDate: toIso(end) };
}

export function useGanttBarDrag(
  onUpdateBar?: (edit: GanttBarEdit) => void,
  options: GanttBarDragOptions = {},
): GanttBarDrag {
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
  const isSwapInFlightRef = useRef(options.isSwapInFlight);
  useEffect(() => {
    onUpdateBarRef.current = onUpdateBar;
    isSwapInFlightRef.current = options.isSwapInFlight;
  }, [onUpdateBar, options.isSwapInFlight]);

  // §742 — the pending keyboard edit (which bar, which handle, the days so far) and its commit timer.
  const pendingRef = useRef<{ drag: BarDrag; days: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer() {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  /** Commit the pending keyboard edit, if any. Cleared BEFORE the commit, so a blur it causes finds nothing. */
  function flushKeys() {
    const pending = pendingRef.current;
    clearTimer();
    if (!pending) return;
    pendingRef.current = null;
    setBarDrag(null);
    setBarDragDeltaDays(0);
    const edit = editFor(pending.drag, pending.days);
    if (edit) onUpdateBarRef.current?.(edit);
  }

  function cancelKeys() {
    clearTimer();
    pendingRef.current = null;
    setBarDrag(null);
    setBarDragDeltaDays(0);
  }

  /** The dates a new edit on `taskId` starts from: a pending keyboard edit's preview on the same bar, which is not
   *  rendered yet when it is flushed in the same handler, else the bar as drawn. */
  function baseFor(taskId: number, bar: { start: Date; end: Date }): { start: Date; end: Date } {
    const pending = pendingRef.current;
    return pending && pending.drag.taskId === taskId ? previewDates(pending.drag, pending.days) : bar;
  }

  // Unmount: a pending keyboard edit lands unless a project swap is tearing the chart down. Under StrictMode's
  // mount→unmount→mount nothing is pending yet, so this is inert.
  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending || isSwapInFlightRef.current?.()) return;
    const edit = editFor(pending.drag, pending.days);
    if (edit) onUpdateBarRef.current?.(edit);
  }, []);

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
    // §742 — a pending keyboard edit lands first, and this drag starts from the dates it produced.
    const base = baseFor(task.id, bar);
    flushKeys();
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
      initialStart: base.start,
      initialEnd: base.end,
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

  function onBarKeyDown(
    e: React.KeyboardEvent<HTMLElement>,
    task: Task,
    bar: { start: Date; end: Date },
    mode: BarDragMode,
  ) {
    // A pointer drag owns the preview until it ends; keys wait for it.
    if (!onUpdateBar || interactingWithBarRef.current) return;
    const pending = pendingRef.current;
    if (e.key === "Escape" && pending) {
      e.preventDefault();
      cancelKeys();
      return;
    }
    if (e.key === "Enter" && pending) {
      e.preventDefault();
      flushKeys();
      return;
    }
    const step = milestoneKeyStep(e.key, e.shiftKey);
    if (step === null || e.altKey || e.ctrlKey || e.metaKey) return;
    // The chart scrolls: without this the key would scroll it too.
    e.preventDefault();
    let drag: BarDrag;
    let days: number;
    if (pending !== null && pending.drag.taskId === task.id && pending.drag.mode === mode) {
      drag = pending.drag;
      days = pending.days;
    } else {
      // Another handle's pending edit lands first; one on this same bar is where this edit starts.
      const base = baseFor(task.id, bar);
      flushKeys();
      drag = { taskId: task.id, mode, startClientX: 0, initialStart: base.start, initialEnd: base.end, pointerId: -1, moved: true };
      days = 0;
    }
    days = clampKeyDays(drag, days + step);
    pendingRef.current = { drag, days };
    setBarDrag(drag);
    setBarDragDeltaDays(days);
    clearTimer();
    timerRef.current = setTimeout(flushKeys, MILESTONE_KEY_COMMIT_DELAY_MS);
  }

  function onBarBlur(taskId: number, mode: BarDragMode) {
    const pending = pendingRef.current;
    if (pending && pending.drag.taskId === taskId && pending.drag.mode === mode) flushKeys();
  }

  return { barDrag, barDragDeltaDays, interactingWithBarRef, previewDates, startBarDrag, onBarKeyDown, onBarBlur };
}
