"use client";

// Canonical <Badge> primitive (design-system Phase 1d). Replaces the ad-hoc
// pill/chip markup that drifted across the app with four font sizes
// (text-[9px]/[10px]/[11px]/text-xs) and four radii (rounded/-sm/-md/-full) for
// otherwise-equivalent labels. Presentational + colour-neutral: the caller
// supplies the tint/text colour via `className` (kept AFTER the base so a
// migrated pill reproduces its exact colour), Badge owns only the two size
// tokens and the one non-pill radius. Palette-safe by construction — it emits
// no colour of its own, so it can never introduce an off-palette value.

import type { HTMLAttributes } from "react";

export type BadgeSize = "sm" | "md";

// The two sanctioned pill sizes. sm collapses the former text-[9px]/[11px]
// pills; md collapses the text-xs pills. Padding pairs each text size so a
// caller never needs to override the base padding (avoiding Tailwind conflicts).
const SIZE_CLASS: Record<BadgeSize, string> = {
  sm: "px-1.5 py-0.5 text-[10px]",
  md: "px-2 py-0.5 text-xs",
};

const BASE_CLASS = "inline-flex items-center";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  size?: BadgeSize;
  /** rounded-full when true; a single non-pill `rounded` otherwise. */
  pill?: boolean;
}

/** Shared inline label/count pill. Defaults to md size and the non-pill radius.
 *  Caller `className` is appended AFTER the size/radius classes so tint + text
 *  colour (and any layout tweak) extend the base without fighting it. All native
 *  span props (title, aria-*, role, onClick, style…) pass through. */
export function Badge({
  size = "md",
  pill = false,
  className,
  ...props
}: BadgeProps) {
  const classes = `${BASE_CLASS} ${pill ? "rounded-full" : "rounded"} ${SIZE_CLASS[size]}${
    className ? ` ${className}` : ""
  }`;
  return <span className={classes} {...props} />;
}
