// src/app/use-gantt-milestone-drag.ts — drag a Gantt milestone to a new date
// (§715 project D), by pointer or by keyboard.
//
// Pointer: the same window-listener shape as `use-gantt-bar-drag.ts` (read its
// header for why window listeners rather than pointer capture). The diamond
// follows the pointer in whole days; the move commits once, on release.
// Escape during the drag cancels it.
//
// Keyboard (the handle is a slider): ArrowRight/ArrowUp move one day later,
// ArrowLeft/ArrowDown one day earlier, Shift+arrow or PageUp/PageDown one week.
// Presses only move the PREVIEW (announced through the slider's value text);
// the move commits ONCE — after a short pause, on Enter, or when focus leaves —
// so a held arrow is one undo step and one activity row, not one per press.
// Escape discards the pending move. Home/End are deliberately not handled: a
// jump to the edge of the chart's range is never a date anyone means.
//
// ★ What commits is a milestone id and a DAY OFFSET, never a date: the caller
// resolves the offset against the milestone's date at commit time, which is
// also the date the row previews from. A date captured at the first press would
// overwrite any change that landed in between (an AI write, undo, another tab,
// or this hook's own keyboard move saved by a following pointer-down).
//
// ★ A commit re-sorts the rows (milestones are ordered by date, and inline
// placement splices them among the tasks). Focus survives that without help:
// React restores focus to a node its commit moved, and the row window keeps a
// focused row mounted. `gantt-view.milestone-move.test.tsx` pins it.
import { useEffect, useRef, useState } from "react";
import { DAY_WIDTH_PX } from "./gantt-engine";
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

export interface GanttMilestoneDragOptions {
  /**
   * Read when the chart unmounts with a keyboard move still pending. True only
   * while an op that replaces this workspace with another project's is in
   * flight (`isSwapInFlight`, the chat panel's §596 discriminator): the move is
   * then dropped, since it belongs to the outgoing project. Every other unmount
   * lands it — navigation, and also the load-hold (§548) teardowns that keep the
   * project: a same-project Reload, a Save-As, a cancelled file dialog. Whether a
   * move landed during a Reload survives the load that follows is up to that
   * load; this hook cannot see it. The chat panel accepts the same residual.
   */
  isSwapInFlight?: () => boolean;
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

/**
 * `onMoveMilestone(id, days)` receives a day OFFSET; the caller resolves it
 * against the milestone's live date (`moveMilestoneBy`).
 */
export function useGanttMilestoneDrag(
  onMoveMilestone?: (id: number, days: number) => void,
  options: GanttMilestoneDragOptions = {},
): GanttMilestoneDrag {
  const [milestoneDrag, setMilestoneDrag] = useState<MilestoneDragState | null>(null);
  // Latest callbacks for listeners, timers and the unmount cleanup, which
  // outlive the render that installed them.
  const onMoveRef = useRef(onMoveMilestone);
  const isSwapInFlightRef = useRef(options.isSwapInFlight);
  useEffect(() => {
    onMoveRef.current = onMoveMilestone;
    isSwapInFlightRef.current = options.isSwapInFlight;
  }, [onMoveMilestone, options.isSwapInFlight]);
  // The live pointer drag's listener teardown; non-null while one is running.
  const detachRef = useRef<(() => void) | null>(null);
  // The pending keyboard move: which milestone, and the days accumulated.
  const pendingRef = useRef<{ id: number; days: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function commit(id: number, days: number) {
    if (days !== 0) onMoveRef.current?.(id, days);
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
    // Cleared BEFORE the commit: the re-sort it causes can blur the handle, and
    // that blur must find nothing left to flush.
    pendingRef.current = null;
    setMilestoneDrag(null);
    commit(pending.id, pending.days);
  }

  function cancelKeys() {
    clearTimer();
    pendingRef.current = null;
    setMilestoneDrag(null);
  }

  // Unmount: drop pointer listeners; a pending keyboard move lands unless a
  // project swap is tearing the chart down (see `isSwapInFlight`). Under
  // StrictMode's mount→unmount→mount nothing is pending yet, so this is inert.
  useEffect(() => () => {
    detachRef.current?.();
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending && !isSwapInFlightRef.current?.()) commit(pending.id, pending.days);
  }, []);

  function startMilestoneDrag(e: React.PointerEvent<HTMLElement>, m: Milestone) {
    if (!onMoveMilestone || m.achievedDate || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    // A pending keyboard move lands first; the drag then offsets from the
    // date it produced, because the commit resolves against the live date.
    flushKeys();
    detachRef.current?.();
    const id = m.id;
    const startX = e.clientX;
    const pointerId = e.pointerId;
    setMilestoneDrag({ milestoneId: id, deltaDays: 0, mode: "pointer" });

    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      const deltaDays = pxToDays(ev.clientX - startX);
      // Same day as last time: keep the object, so React skips the re-render.
      setMilestoneDrag((p) => (p && p.deltaDays === deltaDays ? p : { milestoneId: id, deltaDays, mode: "pointer" }));
    }
    function onEnd(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      detach();
      setMilestoneDrag(null);
      commit(id, pxToDays(ev.clientX - startX));
    }
    function onCancel(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      detach();
      setMilestoneDrag(null);
    }
    function onKey(ev: KeyboardEvent) {
      // One Escape does one thing: a surface that already handled it wins.
      if (ev.key !== "Escape" || ev.defaultPrevented) return;
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
    // A pointer drag owns the preview until it ends; keys wait for it.
    if (!onMoveMilestone || m.achievedDate || detachRef.current) return;
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
    if (pending && pending.id !== m.id) flushKeys();
    const days = (pendingRef.current?.days ?? 0) + step;
    pendingRef.current = { id: m.id, days };
    setMilestoneDrag({ milestoneId: m.id, deltaDays: days, mode: "keys" });
    clearTimer();
    timerRef.current = setTimeout(flushKeys, MILESTONE_KEY_COMMIT_DELAY_MS);
  }

  function onMilestoneBlur(m: Milestone) {
    if (pendingRef.current?.id === m.id) flushKeys();
  }

  return { milestoneDrag, startMilestoneDrag, onMilestoneKeyDown, onMilestoneBlur };
}
