// src/app/use-gantt-milestone-drag.ts — drag a Gantt milestone to a new date
// (§715 project D), by pointer or by keyboard.
//
// Pointer: the same window-listener shape as `use-gantt-bar-drag.ts` (read its
// header for why window listeners rather than pointer capture). The diamond
// follows the pointer in whole days; the new date commits once, on release.
// Keyboard: ArrowLeft/ArrowRight move one day, with Shift one week, and each
// press commits — there is no "release" to wait for.
import { useEffect, useRef, useState } from "react";
import { addDays, DAY_WIDTH_PX, parseISO } from "./gantt-engine";
import type { Milestone } from "./types";

export const MILESTONE_KEY_STEP_DAYS = 1;
export const MILESTONE_SHIFT_KEY_STEP_DAYS = 7;

export interface MilestoneDragState {
  milestoneId: number;
  deltaDays: number;
}

export interface GanttMilestoneDrag {
  milestoneDrag: MilestoneDragState | null;
  startMilestoneDrag: (e: React.PointerEvent<HTMLElement>, m: Milestone) => void;
  onMilestoneKeyDown: (e: React.KeyboardEvent<HTMLElement>, m: Milestone) => void;
}

/** `iso` (YYYY-MM-DD) moved by `days`; null when `iso` does not parse. */
export function shiftIsoDate(iso: string, days: number): string | null {
  const d = parseISO(iso);
  if (!d) return null;
  return addDays(d, days).toISOString().slice(0, 10);
}

/** Whole days a horizontal pointer travel of `px` stands for. */
export function pxToDays(px: number): number {
  // `|| 0` folds -0 into 0, so a small leftward wobble reads as "no move".
  return Math.round(px / DAY_WIDTH_PX) || 0;
}

/** The day step a key press asks for, or null for any other key. */
export function milestoneKeyStep(key: string, shiftKey: boolean): number | null {
  const step = shiftKey ? MILESTONE_SHIFT_KEY_STEP_DAYS : MILESTONE_KEY_STEP_DAYS;
  if (key === "ArrowRight") return step;
  if (key === "ArrowLeft") return -step;
  return null;
}

export function useGanttMilestoneDrag(
  onMoveMilestone?: (id: number, date: string) => void,
): GanttMilestoneDrag {
  const [milestoneDrag, setMilestoneDrag] = useState<MilestoneDragState | null>(null);
  // Latest callback for the window listeners, which outlive the render that
  // installed them (same reason as the bar-drag hook's `onUpdateBarRef`).
  const onMoveRef = useRef(onMoveMilestone);
  useEffect(() => {
    onMoveRef.current = onMoveMilestone;
  }, [onMoveMilestone]);
  // The live drag's listener teardown, so an unmount mid-drag leaves nothing
  // attached to `window`.
  const detachRef = useRef<(() => void) | null>(null);
  useEffect(() => () => detachRef.current?.(), []);

  function commit(m: Milestone, days: number) {
    if (days === 0) return;
    const date = shiftIsoDate(m.date, days);
    if (date) onMoveRef.current?.(m.id, date);
  }

  function startMilestoneDrag(e: React.PointerEvent<HTMLElement>, m: Milestone) {
    if (!onMoveMilestone || m.achievedDate || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    detachRef.current?.();
    const startX = e.clientX;
    const pointerId = e.pointerId;
    setMilestoneDrag({ milestoneId: m.id, deltaDays: 0 });

    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      setMilestoneDrag({ milestoneId: m.id, deltaDays: pxToDays(ev.clientX - startX) });
    }
    function onEnd(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      detach();
      setMilestoneDrag(null);
      commit(m, pxToDays(ev.clientX - startX));
    }
    function onCancel(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      detach();
      setMilestoneDrag(null);
    }
    function detach() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onCancel);
      detachRef.current = null;
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onCancel);
    detachRef.current = detach;
  }

  function onMilestoneKeyDown(e: React.KeyboardEvent<HTMLElement>, m: Milestone) {
    if (!onMoveMilestone || m.achievedDate) return;
    const step = milestoneKeyStep(e.key, e.shiftKey);
    if (step === null || e.altKey || e.ctrlKey || e.metaKey) return;
    // The chart scrolls horizontally: without this the arrow would scroll it too.
    e.preventDefault();
    commit(m, step);
  }

  return { milestoneDrag, startMilestoneDrag, onMilestoneKeyDown };
}
