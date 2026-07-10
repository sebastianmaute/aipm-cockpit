"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Offset {
  x: number;
  y: number;
}

export interface DragHandleProps {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
}

export interface UseDraggableResult {
  offset: Offset;
  reset: () => void;
  handleProps: DragHandleProps;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Viewport {
  w: number;
  h: number;
}

/** Minimum px of the panel that must remain on-screen so it stays grabbable. */
const MARGIN = 24;

/**
 * Clamp a desired drag offset so the panel (at `rect`, before offset) keeps at
 * least MARGIN px reachable inside the viewport on every edge. Pure + testable.
 */
export function clampOffset(desired: Offset, rect: Rect, vp: Viewport): Offset {
  const minX = MARGIN - (rect.left + rect.width);
  const maxX = vp.w - MARGIN - rect.left;
  const minY = MARGIN - rect.top;
  const maxY = vp.h - MARGIN - rect.top;
  return {
    x: Math.min(Math.max(desired.x, minX), maxX),
    y: Math.min(Math.max(desired.y, minY), maxY),
  };
}

/**
 * Read a persisted `{x,y}` offset from localStorage. Returns `{0,0}` when the
 * key is absent, storage is unavailable, or the stored value is not a finite
 * `{x,y}` object. Pure w.r.t. React (safe in a lazy `useState` initializer).
 */
function loadOffset(storageKey: string | undefined): Offset {
  if (!storageKey || typeof window === "undefined") return { x: 0, y: 0 };
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return { x: 0, y: 0 };
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      if (
        typeof o.x === "number" &&
        Number.isFinite(o.x) &&
        typeof o.y === "number" &&
        Number.isFinite(o.y)
      ) {
        return { x: o.x, y: o.y };
      }
    }
  } catch {
    // Unparseable / storage disabled — fall through to the default.
  }
  return { x: 0, y: 0 };
}

/**
 * Draggable floating panel. Attach `handleProps` to the drag handle (the modal
 * header). The panel element gets `style={{ transform: translate(offset) }}`.
 *
 * Without a `storageKey`, the offset resets to `{0,0}` (centered) each time
 * `open` transitions false→true and nothing persists. With a `storageKey`, the
 * initial offset is restored from `localStorage[storageKey]`, an open
 * transition re-loads that saved offset, and the offset is written back when a
 * drag ends. `reset()` recenters and clears the saved entry.
 */
export function useDraggable(
  open: boolean,
  storageKey?: string,
): UseDraggableResult {
  const [offset, setOffset] = useState<Offset>(() => loadOffset(storageKey));
  // Mirror the live offset so the drag-end handler persists the latest value
  // without depending on `offset` (which would re-create the callbacks mid-drag).
  const offsetRef = useRef<Offset>(offset);
  const dragState = useRef<{ startX: number; startY: number; base: Offset; rect: Rect } | null>(null);

  const reset = useCallback(() => {
    offsetRef.current = { x: 0, y: 0 };
    setOffset({ x: 0, y: 0 });
    if (storageKey && typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // Storage may be unavailable — non-fatal.
      }
    }
  }, [storageKey]);

  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const next = loadOffset(storageKey);
      offsetRef.current = next;
      setOffset(next);
    }
    wasOpen.current = open;
  }, [open, storageKey]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const panel = (e.currentTarget.closest("[data-modal-panel]") as HTMLElement | null) ?? e.currentTarget;
      const r = panel.getBoundingClientRect();
      offsetRef.current = offset;
      dragState.current = {
        startX: e.clientX,
        startY: e.clientY,
        base: offset,
        rect: { left: r.left - offset.x, top: r.top - offset.y, width: r.width, height: r.height },
      };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [offset],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const s = dragState.current;
    if (!s) return;
    const desired = { x: s.base.x + (e.clientX - s.startX), y: s.base.y + (e.clientY - s.startY) };
    const next = clampOffset(desired, s.rect, { w: window.innerWidth, h: window.innerHeight });
    offsetRef.current = next;
    setOffset(next);
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const wasDragging = dragState.current !== null;
      dragState.current = null;
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      if (wasDragging && storageKey && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(offsetRef.current));
        } catch {
          // Storage may be unavailable — drop silently.
        }
      }
    },
    [storageKey],
  );

  return {
    offset,
    reset,
    handleProps: { onPointerDown, onPointerMove, onPointerUp },
  };
}
