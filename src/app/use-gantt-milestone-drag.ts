// src/app/use-gantt-milestone-drag.ts — drag a Gantt milestone to a new date
// (§715 project D), by pointer or by keyboard.
//
// Pointer: the same window-listener shape as `use-gantt-bar-drag.ts` (read its
// header for why window listeners rather than pointer capture). The diamond
// follows the pointer in whole days; the new date commits once, on release.
// Escape during the drag cancels it.
//
// Keyboard (the handle is a slider): ArrowRight/ArrowUp move one day later,
// ArrowLeft/ArrowDown one day earlier, Shift+arrow or PageUp/PageDown one week.
// Presses only move the PREVIEW (announced through the slider's value text);
// the date commits ONCE — after a short pause, on Enter, or when focus leaves —
// so a held arrow is one undo step and one activity row, not one per press.
// Escape discards the pending move. Home/End are deliberately not handled: a
// jump to the edge of the chart's range is never a date anyone means.
//
// ★ A commit re-sorts the rows (milestones are ordered by date, and inline
// placement splices them among the tasks). Focus survives that without help:
// React restores focus to a node its commit moved, and the row window keeps a
// focused row mounted. `gantt-view.milestone-move.test.tsx` pins it.
import { useEffect, useRef, useState } from "react";
import { addDays, DAY_WIDTH_PX, parseISO, toISODay } from "./gantt-engine";
import type { Milestone } from "./types";

export const MILESTONE_KEY_STEP_DAYS = 1;
export const MILESTONE_SHIFT_KEY_STEP_DAYS = 7;
/** Idle time after the last arrow press before the keyboard move commits. */
export const MILESTONE_KEY_COMMIT_DELAY_MS = 800;

export interface MilestoneDragState {
  milestoneId: number;
  deltaDays: number;
  /** "keys" while arrow presses are pending: the chart keeps the handle in view. */
  mode: "pointer" | "keys";
}

export interface GanttMilestoneDrag {
  milestoneDrag: MilestoneDragState | null;
  startMilestoneDrag: (e: React.PointerEvent<HTMLElement>, m: Milestone) => void;
  onMilestoneKeyDown: (e: React.KeyboardEvent<HTMLElement>, m: Milestone) => void;
  onMilestoneBlur: (m: Milestone) => void;
}

/** `iso` (YYYY-MM-DD) moved by `days`; null when `iso` does not parse. */
export function shiftIsoDate(iso: string, days: number): string | null {
  const d = parseISO(iso);
  if (!d) return null;
  return toISODay(addDays(d, days));
}

/** Whole days a horizontal pointer travel of `px` stands for. */
export function pxToDays(px: number): number {
  // `|| 0` folds -0 into 0, so a small leftward wobble reads as "no move".
  return Math.round(px / DAY_WIDTH_PX) || 0;
}

/** The day step a key press asks for, or null for any other key. */
export function milestoneKeyStep(key: string, shiftKey: boolean): number | null {
  if (key === "PageUp") return MILESTONE_SHIFT_KEY_STEP_DAYS;
  if (key === "PageDown") return -MILESTONE_SHIFT_KEY_STEP_DAYS;
  const step = shiftKey ? MILESTONE_SHIFT_KEY_STEP_DAYS : MILESTONE_KEY_STEP_DAYS;
  if (key === "ArrowRight" || key === "ArrowUp") return step;
  if (key === "ArrowLeft" || key === "ArrowDown") return -step;
  return null;
}

export function useGanttMilestoneDrag(
  onMoveMilestone?: (id: number, date: string) => void,
): GanttMilestoneDrag {
  const [milestoneDrag, setMilestoneDrag] = useState<MilestoneDragState | null>(null);
  // Latest callback for listeners and timers, which outlive the render that
  // installed them (same reason as the bar-drag hook's `onUpdateBarRef`).
  const onMoveRef = useRef(onMoveMilestone);
  useEffect(() => {
    onMoveRef.current = onMoveMilestone;
  }, [onMoveMilestone]);
  // The live pointer drag's listener teardown.
  const detachRef = useRef<(() => void) | null>(null);
  // The pending keyboard move: the milestone as it was at the FIRST press (the
  // base the days count from) and the days accumulated since.
  const pendingRef = useRef<{ m: Milestone; days: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function commit(m: Milestone, days: number) {
    if (days === 0) return;
    const date = shiftIsoDate(m.date, days);
    if (date) onMoveRef.current?.(m.id, date);
  }

  function clearTimer() {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  /** Commit the pending keyboard move, if any. */
  function flushKeys() {
    const pending = pendingRef.current;
    clearTimer();
    if (!pending) return;
    pendingRef.current = null;
    setMilestoneDrag(null);
    commit(pending.m, pending.days);
  }

  function cancelKeys() {
    clearTimer();
    pendingRef.current = null;
    setMilestoneDrag(null);
  }

  // Unmount: drop pointer listeners; a pending keyboard move still lands — the
  // user chose that date and only left the view.
  useEffect(() => () => {
    detachRef.current?.();
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) commit(pending.m, pending.days);
  }, []);

  function startMilestoneDrag(e: React.PointerEvent<HTMLElement>, m: Milestone) {
    if (!onMoveMilestone || m.achievedDate || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    flushKeys();
    detachRef.current?.();
    const startX = e.clientX;
    const pointerId = e.pointerId;
    setMilestoneDrag({ milestoneId: m.id, deltaDays: 0, mode: "pointer" });

    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      const deltaDays = pxToDays(ev.clientX - startX);
      // Same day as last time: keep the object, so React skips the re-render.
      setMilestoneDrag((p) => (p && p.deltaDays === deltaDays ? p : { milestoneId: m.id, deltaDays, mode: "pointer" }));
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
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      detach();
      setMilestoneDrag(null);
    }
    function detach() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      detachRef.current = null;
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    detachRef.current = detach;
  }

  function onMilestoneKeyDown(e: React.KeyboardEvent<HTMLElement>, m: Milestone) {
    if (!onMoveMilestone || m.achievedDate) return;
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
    // A pending move on ANOTHER milestone lands before this one starts.
    if (pending && pending.m.id !== m.id) flushKeys();
    const base = pendingRef.current ?? { m, days: 0 };
    const next = { m: base.m, days: base.days + step };
    pendingRef.current = next;
    setMilestoneDrag({ milestoneId: m.id, deltaDays: next.days, mode: "keys" });
    clearTimer();
    timerRef.current = setTimeout(() => flushKeys(), MILESTONE_KEY_COMMIT_DELAY_MS);
  }

  function onMilestoneBlur(m: Milestone) {
    if (pendingRef.current?.m.id === m.id) flushKeys();
  }

  return { milestoneDrag, startMilestoneDrag, onMilestoneKeyDown, onMilestoneBlur };
}
