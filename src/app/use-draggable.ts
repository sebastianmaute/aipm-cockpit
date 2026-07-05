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
 * Draggable floating panel. Attach `handleProps` to the drag handle (the modal
 * header). The panel element gets `style={{ transform: translate(offset) }}`.
 * Offset resets to {0,0} (centered) each time `open` transitions false→true.
 */
export function useDraggable(open: boolean): UseDraggableResult {
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; base: Offset; rect: Rect } | null>(null);

  const reset = useCallback(() => setOffset({ x: 0, y: 0 }), []);

  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) setOffset({ x: 0, y: 0 });
    wasOpen.current = open;
  }, [open]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const panel = (e.currentTarget.closest("[data-modal-panel]") as HTMLElement | null) ?? e.currentTarget;
      const r = panel.getBoundingClientRect();
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
    setOffset(clampOffset(desired, s.rect, { w: window.innerWidth, h: window.innerHeight }));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    dragState.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  return {
    offset,
    reset,
    handleProps: { onPointerDown, onPointerMove, onPointerUp },
  };
}
