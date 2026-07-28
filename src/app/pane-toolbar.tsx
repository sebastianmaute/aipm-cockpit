"use client";

// Shared view-pane toolbar atoms (design-system Phase 3g). The register/directory
// panels repeated the same toolbar row (a `+ Add X` button, a `flex-1` search
// input, then filter selects). These atoms emit the exact prior class strings so
// the migration is pixel-neutral.

import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { Button } from "./button";
import { ClearableSearchInput } from "./clearable-search-input";

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
  /** Already-translated accessible name for the clear button. REQUIRED and
   *  qualified by the caller (`${t(lang,"clear")} – ${ariaLabel}`): four panels
   *  render this atom and a bare "Clear" would announce identically on any
   *  view showing two of them. axe cannot see duplicate names. */
  clearLabel: string;
  placeholder?: string;
  /** Minimum-width utility (panels vary: `min-w-[12rem]` default, `min-w-[10rem]`, …). */
  minW?: string;
}

/** The `flex-1` search box shared by the register/directory toolbars. */
export function PaneSearchInput({
  value,
  onChange,
  ariaLabel,
  clearLabel,
  placeholder,
  minW = "min-w-[12rem]",
  className,
  ...props
}: PaneSearchInputProps) {
  return (
    // ★ The flex sizing moves to the wrapper because the wrapper is now the
    //   flex child of the toolbar row; the input fills it.
    <ClearableSearchInput
      value={value}
      onClear={() => onChange("")}
      clearLabel={clearLabel}
      className={`${minW} flex-1`}
    >
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? ariaLabel}
        aria-label={ariaLabel}
        // pr-8 ONLY while the ✕ is rendered (the TableFilter precedent): it
        // reserves room for the overlaid button, so applying it unconditionally
        // would shave ~2rem off the visible placeholder in the (common) empty
        // state — worst on the `min-w-[10rem]` milestones field. Empty-state
        // padding therefore stays exactly the pre-clear `px-2.5 py-1.5`.
        className={`w-full rounded-md border border-line bg-surface py-1.5 pl-2.5 ${value ? "pr-8" : "pr-2.5"} text-xs text-foreground placeholder:text-muted-foreground focus:border-ui-dark-blue focus:outline-none [&::-webkit-search-cancel-button]:appearance-none ${FOCUS_RING} ${TRANSITION}${className ? ` ${className}` : ""}`}
        {...props}
      />
    </ClearableSearchInput>
  );
}

/** The primary `+ Add X` toolbar button (dark-blue filled). The `+ ` prefix and
 *  label are the caller's children. A thin wrapper over the shared `<Button>`
 *  primitive at `xs` size, so the toolbar-add control shares the one canonical
 *  primary look (hover/focus/press). Distinct from the dashed empty-state
 *  `AddFirstItemButton`. */
export function AddButton({ className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button variant="primary" size="xs" className={className} {...props}>
      {children}
    </Button>
  );
}
