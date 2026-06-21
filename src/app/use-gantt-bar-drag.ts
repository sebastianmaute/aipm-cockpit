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
import { useEffect, useRef, useState } from "react";
import { addDays, DAY_WIDTH_PX, type GanttBarEdit } from "./gantt-engine";
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
};

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

export function useGanttBarDrag(
  onUpdateBar?: (edit: GanttBarEdit) => void,
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
  useEffect(() => {
    onUpdateBarRef.current = onUpdateBar;
  }, [onUpdateBar]);

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

  return { barDrag, barDragDeltaDays, interactingWithBarRef, previewDates, startBarDrag };
}
