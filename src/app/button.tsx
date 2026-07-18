"use client";

// Canonical <Button> primitive (design-system Phase 1b). Replaces the per-file
// PRIMARY_BUTTON_CLASS / SECONDARY_BUTTON_CLASS / DESTRUCTIVE_BUTTON_CLASS
// duplicates that drifted across the create-project / empty-state / projects /
// backend-config surfaces. Every variant composes the shared INTERACTIVE atom
// (canonical 150ms color transition + ui-green focus ring + press feedback) so
// hover/focus/press read identically app-wide. Palette-safe by construction:
// only sanctioned AIPM brand tokens (dark-blue fill, pink destructive, line/
// surface chrome) — no gradients, shadows, or off-palette colors.

import type { ButtonHTMLAttributes, Ref } from "react";
import { INTERACTIVE } from "./interaction-styles";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "xs" | "sm" | "md";

// Variant color/border classes ONLY (no size, no motion — those are shared).
// Values reproduce the current canonical look so migrated buttons don't shift.
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-ui-dark-blue text-white hover:opacity-90",
  secondary: "border border-line bg-surface text-foreground hover:bg-surface-muted",
  ghost: "bg-transparent text-foreground hover:bg-surface-muted",
  destructive:
    "border border-ui-pink/40 bg-surface text-ui-pink-strong hover:bg-ui-pink/10 dark:border-ui-pink/50",
};

// The common CTA paddings in the codebase. md = the large wizard/empty-state
// CTA (px-4 py-2); sm = the compact projects-panel action (px-3 py-1.5); xs =
// the toolbar `+ Add X` control (px-2.5 py-1.5 text-xs, the AddButton look).
const SIZE_CLASS: Record<ButtonSize, string> = {
  xs: "px-2.5 py-1.5 text-xs",
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
};

const BASE_CLASS =
  "rounded-md font-medium disabled:cursor-not-allowed disabled:opacity-50";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Forwarded to the underlying `<button>` (React 19 ref-as-prop). */
  ref?: Ref<HTMLButtonElement>;
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
  ref,
  ...props
}: ButtonProps) {
  const classes = `${BASE_CLASS} ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]} ${INTERACTIVE}${
    className ? ` ${className}` : ""
  }`;
  return <button ref={ref} type={type} className={classes} {...props} />;
}
