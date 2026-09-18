"use client";

// The tooltip bubble, lifted verbatim out of `info-tooltip.tsx` so the chart
// readout can reuse the one surface instead of hand-rolling a second tooltip
// look. Positioning stays the CALLER's job: `InfoTooltip` clamps against its
// trigger, the chart readout against the chart's own box.
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/** ★ The exact class string `InfoTooltip` shipped; changing it restyles every
 *  tooltip in the app, not just one. */
export const TOOLTIP_SURFACE_CLASS =
  "pointer-events-none fixed z-[100] w-max max-w-[16rem] rounded-md border border-line bg-surface px-2 py-1 text-xs font-normal normal-case text-foreground";

export function TooltipSurface({
  top, left, className, children,
}: { top: number; left: number; className?: string; children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <span
      role="tooltip"
      data-tooltip-portal
      style={{ top, left, transform: "translateX(-50%)" }}
      className={className ? `${TOOLTIP_SURFACE_CLASS} ${className}` : TOOLTIP_SURFACE_CLASS}
    >
      {children}
    </span>,
    document.body,
  );
}
