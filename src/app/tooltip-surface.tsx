"use client";

// The tooltip bubble, lifted verbatim out of `info-tooltip.tsx` so the chart
// readout can reuse the one surface instead of hand-rolling a second tooltip
// look. Positioning stays the CALLER's job: `InfoTooltip` clamps against its
// trigger, the chart readout against the chart's own box.
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/** ★ The exact class string `InfoTooltip` shipped, MINUS its `max-w-[16rem]`.
 *  Width is the CALLER's job (see `className` below): two same-specificity
 *  `max-w-*` utilities landing in one class string are resolved by generated
 *  stylesheet order, not by their order in the attribute, and jsdom has no
 *  layout to catch a wrong winner — so this file must never carry a `max-w`
 *  of its own. `InfoTooltip` now passes `max-w-[16rem]` itself; the chart
 *  readout passes `max-w-[22rem]`. Changing anything else here restyles every
 *  tooltip in the app, not just one. */
export const TOOLTIP_SURFACE_CLASS =
  "pointer-events-none fixed z-[100] w-max rounded-md border border-line bg-surface px-2 py-1 text-xs font-normal normal-case text-foreground";

export function TooltipSurface({
  top, left, className, children, decorative,
}: {
  top: number; left: number; className?: string; children: ReactNode;
  /** True for a surface with NO accessible content of its own (every caller
   *  that relies on a separate live region for its words, e.g. the chart
   *  readout). Renders `aria-hidden="true"` and NO `role` — an aria-hidden
   *  node carrying `role="tooltip"` is a contradiction axe flags as
   *  `aria-tooltip-name` (a tooltip node with no accessible name), since the
   *  role promises a name the hidden content can never supply. Omit (or pass
   *  false) for a surface that IS the accessible content, e.g. `InfoTooltip`,
   *  which keeps today's `role="tooltip"` and no `aria-hidden`. */
  decorative?: boolean;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <span
      {...(decorative ? { "aria-hidden": "true" as const } : { role: "tooltip" })}
      data-tooltip-portal
      style={{ top, left, transform: "translateX(-50%)" }}
      className={className ? `${TOOLTIP_SURFACE_CLASS} ${className}` : TOOLTIP_SURFACE_CLASS}
    >
      {children}
    </span>,
    document.body,
  );
}
