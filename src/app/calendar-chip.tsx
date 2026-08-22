"use client";

// CalendarChip — the shared primitive for a single recurring-event occurrence
// rendered as a small clickable, draggable chip (the calendar band's ~40px
// day cells, e.g. "09:00 Standup"). Sanctioned NEW primitive: nothing in the
// existing layer covers an interactive chip — Badge is a non-interactive
// <span>. Do not hand-roll a bespoke <button> for this shape elsewhere;
// extend this one instead.

import type React from "react";
import { ArrowUturnRightIcon } from "./icons";
import { INTERACTIVE } from "./interaction-styles";

export interface CalendarChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Full accessible name — the caller guarantees it is row-unique. */
  ariaLabel: string;
  /** Wall-clock start, rendered tabular so chips align across lanes. */
  time: string;
  /** Event title; truncates rather than wrapping (the cell is ~40px). */
  title: string;
  /** Marks an occurrence relocated by a per-occurrence exception. */
  moved?: boolean;
}

const BASE_CLASS =
  "flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-sm border border-line bg-surface py-0.5 pl-1.5 pr-1 text-left border-l-2";

/** Left-stripe colour is the same for both states — the class carries only
 *  colour, never the moved/plain distinction (that would be colour-only,
 *  WCAG 1.4.1). */
const STRIPE_CLASS = "border-l-ui-dark-blue";

/** A moved occurrence must NOT be signalled by colour alone (WCAG 1.4.1) —
 *  the border STYLE switches solid → dashed (a shape/pattern cue, not a
 *  colour) and an aria-hidden glyph is added, matching the resource-picker's
 *  `data-dangling-marker` precedent for the same class of requirement.
 *  ★★ This MUST be an inline style, not a Tailwind class: Tailwind v4 has no
 *  per-side border-*style* utility (`border-l-dashed` is a v3ism that
 *  compiles to nothing under v4 — it silently never renders, which is
 *  exactly the bug this replaced). `border-l-2` already gives the left edge
 *  a solid style via Tailwind's preflight reset, so only the MOVED case
 *  needs an explicit override. */

export function CalendarChip({
  ariaLabel,
  time,
  title,
  moved = false,
  className = "",
  type = "button",
  ...rest
}: CalendarChipProps) {
  return (
    <button
      type={type}
      // `rest` is spread FIRST and `aria-label` set explicitly AFTER, so the
      // accessible name is always exactly `ariaLabel` even if a caller (in
      // error) also passed a raw `aria-label` through the rest props — the
      // label-bleed class of bug this app has hit before must not be
      // reachable here.
      {...rest}
      aria-label={ariaLabel}
      style={moved ? { ...rest.style, borderLeftStyle: "dashed" } : rest.style}
      className={`${BASE_CLASS} ${STRIPE_CLASS} ${INTERACTIVE} ${className}`}
    >
      {moved && (
        <span data-moved-marker aria-hidden="true" className="shrink-0 text-ui-dark-blue">
          <ArrowUturnRightIcon className="h-3 w-3" />
        </span>
      )}
      <span className="shrink-0 text-[11px] font-medium tabular-nums text-foreground">{time}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{title}</span>
    </button>
  );
}
