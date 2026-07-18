"use client";

// Shared view-pane toolbar atoms (design-system Phase 3g). The register/directory
// panels repeated the same toolbar row (a `+ Add X` button, a `flex-1` search
// input, then filter selects). These atoms emit the exact prior class strings so
// the migration is pixel-neutral.

import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";

/** The wrapping toolbar row: a wrapping flex line above a pane's data area.
 *  `print:hidden` by default (toolbars don't print); pass `className` to tweak
 *  the bottom margin or drop `print:hidden`. */
export function PaneToolbar({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`mb-2 flex shrink-0 flex-wrap items-center gap-2 print:hidden${className ? ` ${className}` : ""}`}
      {...props}
    >
      {children}
    </div>
  );
}

export interface PaneSearchInputProps
  extends Omit<HTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name (also used as placeholder unless `placeholder` given). */
  ariaLabel: string;
  placeholder?: string;
  /** Minimum-width utility (panels vary: `min-w-[12rem]` default, `min-w-[10rem]`, …). */
  minW?: string;
}

/** The `flex-1` search box shared by the register/directory toolbars. */
export function PaneSearchInput({
  value,
  onChange,
  ariaLabel,
  placeholder,
  minW = "min-w-[12rem]",
  className,
  ...props
}: PaneSearchInputProps) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? ariaLabel}
      aria-label={ariaLabel}
      className={`${minW} flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-ui-dark-blue focus:outline-none ${FOCUS_RING} ${TRANSITION}${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}

/** The primary `+ Add X` toolbar button (dark-blue filled). The `+ ` prefix and
 *  label are the caller's children. Distinct from the dashed empty-state
 *  `AddFirstItemButton`. */
export function AddButton({ className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`rounded-md border border-ui-dark-blue bg-ui-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-ui-dark-blue/90 ${INTERACTIVE}${className ? ` ${className}` : ""}`}
      {...props}
    >
      {children}
    </button>
  );
}
