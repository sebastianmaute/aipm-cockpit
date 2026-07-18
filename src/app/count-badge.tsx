"use client";

// Canonical <CountBadge> pill (design-system Phase 3f). Replaces the notification
// count pill that was hand-rolled verbatim across the top bar, sidebar nav and
// classic app header (5 copies, one of which had drifted to `text-ui-white`
// where the others used `text-white`). One pill shape, one tint per `variant`.
//
// Every tint is a sanctioned AIPM brand token, so the primitive is palette-safe
// by construction. Positional classes (absolute offsets, `ml-auto`) are the
// caller's — pass them via `className`, appended after the base + variant.

import type { HTMLAttributes } from "react";

export type CountBadgeVariant = "pink" | "dark-blue" | "grey";

// variant → brand tint (fill + AA-safe white text).
const VARIANT_CLASS: Record<CountBadgeVariant, string> = {
  pink: "bg-ui-pink text-white",
  "dark-blue": "bg-ui-dark-blue text-white",
  grey: "bg-ui-medium-grey text-white",
};

// One canonical count-pill shape for the whole app.
const BASE_CLASS =
  "inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none";

export interface CountBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: CountBadgeVariant;
}

/** Small round count pill (unread/badge counts). The tint tracks `variant`;
 *  `className` extends the base for positioning (e.g. `absolute -right-0.5`,
 *  `ml-auto`). Decorative counts should pass `aria-hidden` — the count is
 *  usually already conveyed by the control's accessible name. */
export function CountBadge({ variant = "pink", className, ...props }: CountBadgeProps) {
  return (
    <span
      className={`${BASE_CLASS} ${VARIANT_CLASS[variant]}${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}
