"use client";

// Canonical icon-only button primitive (design-system). Replaces the bespoke
// `p-0.5`/`p-1`/`px-1` + `rounded`/`rounded-md` + muted/foreground-hover ✕/remove
// buttons scattered across modals and rows. Icon-only controls have NO visible
// text, so `label` (the accessible name) is REQUIRED — the icon child is the
// visible glyph. Composes the shared INTERACTIVE atom (focus ring + transition +
// press). Palette-safe: only sanctioned ui-* / muted tokens, no shadow/gradient.

import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { INTERACTIVE } from "./interaction-styles";

export type IconButtonSize = "sm" | "md";
export type IconButtonVariant = "ghost" | "danger";

// Square padding by size (the icon sets its own dimensions).
const SIZE_CLASS: Record<IconButtonSize, string> = {
  sm: "p-1",
  md: "p-1.5",
};

const VARIANT_CLASS: Record<IconButtonVariant, string> = {
  // Neutral affordance: muted glyph that darkens + tints on hover.
  ghost: "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
  // Destructive affordance (delete/remove): muted at rest, pink on hover.
  danger: "text-muted-foreground hover:bg-ui-pink/10 hover:text-ui-pink-strong",
};

const BASE_CLASS = "inline-flex items-center justify-center rounded-md";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** REQUIRED accessible name — icon-only buttons have no visible text. */
  label: string;
  /** The visible glyph/SVG (rendered as-is; pass an aria-hidden icon). */
  children: ReactNode;
  size?: IconButtonSize;
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
  variant = "ghost",
  type = "button",
  className,
  ref,
  ...props
}: IconButtonProps) {
  const classes = `${BASE_CLASS} ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]} ${INTERACTIVE}${
    className ? ` ${className}` : ""
  }`;
  return (
    <button ref={ref} type={type} aria-label={label} className={classes} {...props}>
      {children}
    </button>
  );
}
