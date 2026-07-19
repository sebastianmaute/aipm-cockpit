"use client";

// Shared trigger + popover scaffold for the Action-Center inline CTAs
// (escalate / reschedule / rebaseline). The three popovers repeated an identical
// `<span className="relative"><button aria-haspopup/aria-expanded + stopPropagation>
// <PopoverPanel role="dialog">…` wrapper — only the label, panel width, and the
// panel-readiness gate differed. Each caller keeps its own open-state and bespoke
// prefill/reset logic; only this wrapper (with the ARIA + stopPropagation the row
// click-guard depends on) lives here.

import { type ReactNode, type RefObject } from "react";
import { popoverTriggerClass } from "./action-cta-styles";
import { PopoverPanel } from "./popover-panel";

export function ActionPopoverTrigger({
  label,
  ariaLabel,
  open,
  panelOpen,
  onToggle,
  onClose,
  btnRef,
  prominent,
  panelClassName,
  children,
}: {
  label: string;
  ariaLabel: string;
  /** Raw open state — drives the button's `aria-expanded`. */
  open: boolean;
  /** Gate the PANEL on extra readiness (e.g. a loaded plan / resolvable entity).
   *  Defaults to `open`; the button's aria-expanded still tracks `open`. */
  panelOpen?: boolean;
  onToggle: () => void;
  /** Stable close callback (PopoverPanel requires a stable useCallback). */
  onClose: () => void;
  btnRef: RefObject<HTMLButtonElement | null>;
  prominent?: boolean;
  /** Width/padding for the panel (e.g. "w-64 p-2"). */
  panelClassName: string;
  children: ReactNode;
}) {
  return (
    <span className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className={popoverTriggerClass(prominent)}
      >
        {label}
      </button>
      <PopoverPanel
        open={panelOpen ?? open}
        anchorRef={btnRef}
        onClose={onClose}
        role="dialog"
        ariaLabel={ariaLabel}
        className={panelClassName}
      >
        {children}
      </PopoverPanel>
    </span>
  );
}
