"use client";

// Canonical icon-only button primitive (design-system). Replaces the bespoke
// `p-0.5`/`p-1`/`px-1` + `rounded`/`rounded-md` + muted/foreground-hover ✕/remove
// buttons scattered across modals and rows. Icon-only controls have NO visible
// text, so `label` (the accessible name) is REQUIRED — the icon child is the
// visible glyph. Composes the shared INTERACTIVE atom (focus ring + transition +
// press). Palette-safe: only sanctioned ui-* / muted tokens, no shadow/gradient.

import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { INTERACTIVE } from "./interaction-styles";

export type IconButtonSize = "xs" | "sm" | "md";
export type IconButtonShape = "square" | "circle";
export type IconButtonVariant = "ghost" | "danger" | "bordered" | "dangerBordered";

// Box by size. `sm`/`md` pad around the icon, which sets its own dimensions.
// ★ `xs` is a FIXED 20px box with no padding (open-followups §110): it exists so a
// control that must match a row of 20px chips (the RACI picker's clear ✕) can be an
// IconButton. A caller `className` cannot do this instead — Tailwind resolves a
// conflict by stylesheet source order, so a caller's `p-0` loses to `p-1` outright.
const SIZE_CLASS: Record<IconButtonSize, string> = {
  xs: "h-5 w-5",
  sm: "p-1",
  md: "p-1.5",
};

// Corner by shape, kept out of BASE_CLASS for the same source-order reason.
const SHAPE_CLASS: Record<IconButtonShape, string> = {
  square: "rounded-md",
  circle: "rounded-full",
};

const VARIANT_CLASS: Record<IconButtonVariant, string> = {
  // Neutral affordance: muted glyph that darkens + tints on hover.
  ghost: "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
  // Destructive affordance (delete/remove): muted at rest, pink on hover.
  danger: "text-muted-foreground hover:bg-ui-pink/10 hover:text-ui-pink-strong",
  // Quiet bordered box — the house style for toolbar reset/utility icons
  // (codifies the recipe ResetSizeButton/ResetColWidthsButton already used).
  bordered:
    "border border-line bg-surface text-muted-foreground hover:bg-surface-muted hover:text-foreground",
  // Destructive AND bordered: a standing destructive affordance in a toolbar,
  // matching Settings → General's "Reset to clean slate". `danger` above is the
  // per-row remove glyph, which stays muted until hover; this one reads as
  // destructive at rest because it wipes everything.
  dangerBordered:
    "border border-ui-pink/50 bg-surface text-ui-pink-strong hover:bg-ui-pink/10",
};

const BASE_CLASS =
  "inline-flex cursor-pointer items-center justify-center disabled:cursor-not-allowed disabled:opacity-50";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** REQUIRED accessible name — icon-only buttons have no visible text. */
  label: string;
  /** The visible glyph/SVG (rendered as-is; pass an aria-hidden icon). */
  children: ReactNode;
  size?: IconButtonSize;
  /** Corner shape. Defaults to `square` (`rounded-md`). */
  shape?: IconButtonShape;
  variant?: IconButtonVariant;
  ref?: Ref<HTMLButtonElement>;
}

/** Shared icon-only button. Defaults to the neutral `ghost` affordance at `sm`
 *  size and `type="button"`. Caller `className` is appended AFTER so layout
 *  tweaks (margins, `shrink-0`) extend without fighting the base. */
export function IconButton({
  label,
  children,
  size = "sm",
  shape = "square",
  variant = "ghost",
  type = "button",
  className,
  ref,
  ...props
}: IconButtonProps) {
  const classes = `${BASE_CLASS} ${SIZE_CLASS[size]} ${SHAPE_CLASS[shape]} ${VARIANT_CLASS[variant]} ${INTERACTIVE}${
    className ? ` ${className}` : ""
  }`;
  return (
    <button ref={ref} type={type} aria-label={label} className={classes} {...props}>
      {children}
    </button>
  );
}
