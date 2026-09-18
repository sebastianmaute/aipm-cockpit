"use client";

// Pointer/keyboard state for the budget chart's readout (spec A). Every value
// is computed inside a handler from a live `getBoundingClientRect`, so there is
// no effect that syncs state — `react-hooks/set-state-in-effect` is banned, and
// a rect read during render would be wrong on the first paint anyway.
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { nearestStop } from "./burndown-readout";
import { scaleDate } from "./burndown-geometry";

export type ReadoutAnchor = { top: number; left: number };

/** Half the readout box's max width (`max-w-[22rem]` = 352px). */
const HALF = 176;
/** The box sits this far below the chart box's top edge. */
const ANCHOR_TOP_PX = 8;

export type ChartReadoutApi = {
  stop: string | null;
  anchor: ReadoutAnchor | null;
  close: () => void;
  triggerProps: {
    ref: (el: HTMLElement | null) => void;
    onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    onPointerLeave: (e: PointerEvent<HTMLElement>) => void;
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onClick: (e: MouseEvent<HTMLElement>) => void;
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
    onBlur: () => void;
  };
};

export function useChartReadout({
  stops, xDomain, x0, x1, viewBoxWidth,
}: {
  stops: readonly string[];
  xDomain: readonly [string, string];
  x0: number; x1: number; viewBoxWidth: number;
}): ChartReadoutApi {
  const hostRef = useRef<HTMLElement | null>(null);
  const [stop, setStop] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<ReadoutAnchor | null>(null);

  const close = useCallback(() => { setStop(null); setAnchor(null); }, []);

  /** Screen position of a stop, clamped inside the chart's own box. */
  const anchorFor = useCallback((date: string): ReadoutAnchor | null => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const svgX = scaleDate(date, xDomain, x0, x1);
    const raw = rect.left + (svgX / viewBoxWidth) * rect.width;
    const left = rect.width > HALF * 2
      ? Math.min(Math.max(raw, rect.left + HALF), rect.right - HALF)
      : raw;
    return { top: rect.top + ANCHOR_TOP_PX, left };
  }, [x0, x1, viewBoxWidth, xDomain]);

  const showStop = useCallback((date: string | null) => {
    if (date === null) { close(); return; }
    setStop(date);
    setAnchor(anchorFor(date));
  }, [anchorFor, close]);

  const move = useCallback((clientX: number) => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) { close(); return; }
    const svgX = ((clientX - rect.left) / rect.width) * viewBoxWidth;
    showStop(nearestStop(stops, xDomain, x0, x1, svgX));
  }, [close, showStop, stops, viewBoxWidth, x0, x1, xDomain]);

  const step = useCallback((delta: number | "first" | "last") => {
    if (stops.length === 0) return;
    const at = stop === null ? -1 : stops.indexOf(stop);
    const next = delta === "first" ? 0
      : delta === "last" ? stops.length - 1
      : Math.min(Math.max(at < 0 ? 0 : at + delta, 0), stops.length - 1);
    showStop(stops[next]);
  }, [showStop, stop, stops]);

  // A scroll or resize invalidates the rect the anchor was computed from, and
  // re-anchoring mid-scroll would chase the pointer — close, exactly as
  // `InfoTooltip` does.
  useEffect(() => {
    if (stop === null) return;
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [close, stop]);

  return {
    stop, anchor, close,
    triggerProps: {
      ref: (el) => { hostRef.current = el; },
      onPointerMove: (e) => move(e.clientX),
      // Only a hovering pointer closes on leave. ★ An ALLOW-LIST, not `!== "touch"`: a
      // touch pointer and a non-hovering stylus both fire pointerleave the instant contact
      // ends, which would close the readout a frame after opening it. Anything that is not
      // a mouse therefore closes by blur or Escape instead. An unknown or future
      // pointerType fails safe this way — it leaves the readout open, which a blur clears,
      // rather than making the readout unusable with that device.
      onPointerLeave: (e) => { if (e.pointerType === "mouse") close(); },
      // A tap has no preceding hover, but its pointerdown carries a real
      // coordinate on touch as well as mouse — this is what makes "tap shows
      // it" work without a click-driven toggle. Only the primary button/contact
      // (button 0) opens it, so a right- or middle-click doesn't reposition the
      // readout while a context menu is opening.
      onPointerDown: (e) => { if (e.button === 0) move(e.clientX); },
      onClick: (e) => {
        e.preventDefault();
        // A real pointer click was already handled by onPointerDown/onPointerMove
        // above; the only thing left for onClick is a keyboard or assistive
        // activation, which reports clientX 0 and never fires those handlers.
        if (e.clientX === 0 && stop === null) step("first");
      },
      onKeyDown: (e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
        else if (e.key === "Home") { e.preventDefault(); step("first"); }
        else if (e.key === "End") { e.preventDefault(); step("last"); }
        else if (e.key === "Escape") { close(); }
      },
      // "Tap outside hides it": the wrapper is a focusable button, so tapping
      // elsewhere moves focus off it and this closes — there is no separate
      // outside-pointer listener.
      onBlur: close,
    },
  };
}
