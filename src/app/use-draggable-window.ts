"use client";

// useDraggableWindow — give a NON-MODAL floating window (help-menu, notes-window)
// a draggable, viewport-clamped, persisted position. The DRAG/POSITION half of a
// floating window; the SIZE half is `useResizable` (kept separate — attach both to
// the same panel element).
//
// The panel is positioned via inline `left`/`top` from the returned `pos`. On
// first open the hook restores a saved `{x,y}` from `localStorage[storageKey]`
// (or, absent one, asks the caller's `computeInitialPos` for a default), clamps a
// live drag to the viewport, and persists the resting position on drag-end. The
// window-level mousemove/mouseup listeners are attached only for the duration of a
// drag and always torn down on mouseup.
//
// The caller owns WHERE the window first appears (`computeInitialPos`) because the
// two windows differ: help-menu re-applies a top/bottom gutter even to a restored
// position, notes-window just clamps a corner default. Everything else — storage,
// clamping, the button-press drag guard, and the drag lifecycle — is shared.

import { useCallback, useEffect, useRef, useState } from "react";

export type WindowPos = { x: number; y: number };

/**
 * Controls in the title bar that must NEVER arm a window drag. Pressing the ✕ or
 * reset-size button used to arm the drag listeners too, so a click-and-drag from
 * a control moved the window instead of operating it. The selector is broader
 * than today's buttons so a link or field added to a bar later can't silently
 * re-arm it.
 */
const CONTROL_SELECTOR = "button, a, input, select, textarea";

/**
 * Caller policy for the window's first-open position. Receives the restored
 * `saved` position (or `null`), the measured panel size, and a `clamp` helper
 * bound to that size; returns the position to place the window at.
 */
export type ComputeInitialPos = (ctx: {
  saved: WindowPos | null;
  panelW: number;
  panelH: number;
  clamp: (p: WindowPos) => WindowPos;
}) => WindowPos;

export interface UseDraggableWindowOptions {
  /** Whether the window is open; placement runs on the first open. */
  open: boolean;
  /** The panel element ref (the same one passed to `useResizable`), measured for clamping. */
  panelRef: React.RefObject<HTMLDivElement | null>;
  /** Where to place the window on first open (see `ComputeInitialPos`). */
  computeInitialPos: ComputeInitialPos;
  /** Panel width used for clamping before the element has measured (default 480). */
  fallbackWidth?: number;
  /** Panel height used for clamping before the element has measured (default 560). */
  fallbackHeight?: number;
}

export interface UseDraggableWindowResult {
  /** Current position, or `null` before first placement. Feed to inline `left`/`top`. */
  pos: WindowPos | null;
  /** Attach to the title bar's `onMouseDown` — starts a drag unless a control was pressed. */
  onTitleBarMouseDown: (e: React.MouseEvent<HTMLElement>) => void;
  /** Clear the saved position and recompute the default on the next placement. */
  resetPos: () => void;
}

/** Clamp a position so the panel stays fully within the viewport. */
function clampPos(p: WindowPos, panelW: number, panelH: number): WindowPos {
  return {
    x: Math.max(0, Math.min(p.x, window.innerWidth - panelW)),
    y: Math.max(0, Math.min(p.y, window.innerHeight - panelH)),
  };
}

/** Read a persisted `{x,y}` position, or `null` when absent/unparseable/invalid. */
function loadPos(storageKey: string): WindowPos | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const p = JSON.parse(raw) as unknown;
    if (
      p &&
      typeof p === "object" &&
      "x" in p &&
      "y" in p &&
      typeof (p as WindowPos).x === "number" &&
      typeof (p as WindowPos).y === "number"
    ) {
      return p as WindowPos;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Persist a position (non-fatal if storage is unavailable). */
function savePos(storageKey: string, p: WindowPos) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(p));
  } catch {
    // non-fatal
  }
}

export function useDraggableWindow(
  storageKey: string,
  options: UseDraggableWindowOptions,
): UseDraggableWindowResult {
  const {
    open,
    panelRef,
    computeInitialPos,
    fallbackWidth = 480,
    fallbackHeight = 560,
  } = options;

  const [pos, setPos] = useState<WindowPos | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  // Place the window on first open (saved position, else the caller's default).
  // The element may not be mounted yet (help-menu renders its panel only once
  // `pos` is set), so measurement falls back to the caller's fallback size.
  useEffect(() => {
    if (!open || pos !== null) return;
    const el = panelRef.current;
    const panelW = el?.offsetWidth ?? fallbackWidth;
    const panelH = el?.offsetHeight ?? fallbackHeight;
    const saved = loadPos(storageKey);
    setPos(
      computeInitialPos({
        saved,
        panelW,
        panelH,
        clamp: (p) => clampPos(p, panelW, panelH),
      }),
    );
  }, [open, pos, panelRef, storageKey, computeInitialPos, fallbackWidth, fallbackHeight]);

  const onTitleBarMouseDown = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!pos) return;
      if ((e.target as HTMLElement).closest(CONTROL_SELECTOR)) return;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: pos.x,
        origY: pos.y,
      };

      function onMove(mv: MouseEvent) {
        if (!dragRef.current) return;
        const el = panelRef.current;
        const panelW = el?.offsetWidth ?? fallbackWidth;
        const panelH = el?.offsetHeight ?? fallbackHeight;
        setPos(
          clampPos(
            {
              x: dragRef.current.origX + mv.clientX - dragRef.current.startX,
              y: dragRef.current.origY + mv.clientY - dragRef.current.startY,
            },
            panelW,
            panelH,
          ),
        );
      }

      function onUp() {
        if (dragRef.current) {
          setPos((p) => {
            if (p) savePos(storageKey, p);
            return p;
          });
          dragRef.current = null;
        }
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [pos, panelRef, storageKey, fallbackWidth, fallbackHeight],
  );

  const resetPos = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // non-fatal
    }
    setPos(null);
  }, [storageKey]);

  return { pos, onTitleBarMouseDown, resetPos };
}
