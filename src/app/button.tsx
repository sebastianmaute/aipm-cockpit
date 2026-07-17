"use client";

// Canonical <Button> primitive (design-system Phase 1b). Replaces the per-file
// PRIMARY_BUTTON_CLASS / SECONDARY_BUTTON_CLASS / DESTRUCTIVE_BUTTON_CLASS
// duplicates that drifted across the create-project / empty-state / projects /
// backend-config surfaces. Every variant composes the shared INTERACTIVE atom
// (canonical 150ms color transition + AIPM-green focus ring + press feedback) so
// hover/focus/press read identically app-wide. Palette-safe by construction:
// only sanctioned AIPM brand tokens (dark-blue fill, pink destructive, line/
// surface chrome) — no gradients, shadows, or off-palette colors.

import type { ButtonHTMLAttributes } from "react";
import { INTERACTIVE } from "./interaction-styles";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md";

// Variant color/border classes ONLY (no size, no motion — those are shared).
// Values reproduce the current canonical look so migrated buttons don't shift.
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-AIPM-dark-blue text-white hover:opacity-90",
  secondary: "border border-line bg-surface text-foreground hover:bg-surface-muted",
  ghost: "bg-transparent text-foreground hover:bg-surface-muted",
  destructive:
    "border border-AIPM-pink/40 bg-surface text-AIPM-pink-strong hover:bg-AIPM-pink/10 dark:border-AIPM-pink/50",
};

// The two common CTA paddings in the codebase. md = the large wizard/empty-state
// CTA (px-4 py-2); sm = the compact projects-panel action (px-3 py-1.5).
const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
};

const BASE_CLASS =
  "rounded-md font-medium disabled:cursor-not-allowed disabled:opacity-50";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Shared button primitive. Defaults to the primary (filled) CTA at md size and
 *  `type="button"` (never an accidental form submit). Caller `className` is
 *  appended AFTER the variant classes so layout tweaks (`w-full`, margins) can
 *  extend without fighting the base. All native button props pass through. */
export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className,
  ...props
}: ButtonProps) {
  const classes = `${BASE_CLASS} ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]} ${INTERACTIVE}${
    className ? ` ${className}` : ""
  }`;
  return <button type={type} className={classes} {...props} />;
}
