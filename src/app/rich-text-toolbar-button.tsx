"use client";

// Compact borderless icon button for the rich-text toolbar (tiptap
// simple-editor look). Local to rich-text-toolbar.tsx only — the shared
// ToggleButton (toggle-button.tsx) keeps its bordered-chip look for its
// ~25 other consumers (Gantt View menu, Settings rows, dashboard chips).
//
// ★★ The pressed/expanded state is NOT color-only: `--ui-dark-blue` sits at
// ~1.1-1.3:1 against the dark surface even at full opacity (measured), so a
// background tint alone cannot clear WCAG 1.4.1's 3:1 lightness-delta bar in
// the dark schemes. The trailing marker below carries that burden instead —
// see the design spec (docs/superpowers/specs/2026-08-11-rich-text-toolbar-
// compact-buttons-design.md) for the numbers.

import type { ReactNode, Ref } from "react";
import { type Lang, t } from "./i18n";
import { FOCUS_RING } from "./interaction-styles";

export type ToolbarButtonAccent = "dark-blue" | "pink";
export type ToolbarButtonStateKind = "toggle" | "disclosure" | "action";

const BASE =
  "relative inline-flex h-6 min-w-6 shrink-0 items-center justify-center gap-0.5 rounded-lg px-1";

// Byte-identical to FOCUS_RING, so reuse it directly rather than hand-rolling
// outline-none/ring-2/ring-ui-green again.
const INACTIVE = `text-foreground hover:bg-surface-muted ${FOCUS_RING}`;

// ACTIVE needs a per-accent ring colour, so it can't reuse FOCUS_RING (which
// hardcodes ring-ui-green) — only outline-none/ring-2 are shared with it.
const ACTIVE: Record<ToolbarButtonAccent, string> = {
  "dark-blue":
    "bg-ui-dark-blue/10 text-ui-dark-blue hover:bg-ui-dark-blue/20 focus:outline-none focus:ring-2 focus:ring-ui-dark-blue dark:bg-ui-dark-blue/20 dark:text-ui-light-grey",
  pink: "bg-ui-pink/10 text-ui-dark-blue hover:bg-ui-pink/20 focus:outline-none focus:ring-2 focus:ring-ui-pink dark:bg-ui-pink/15 dark:text-ui-light-grey",
};

type StateAttrs =
  | { "aria-pressed": boolean }
  | { "aria-expanded": boolean; "aria-controls": string | undefined }
  | Record<string, never>;

export interface ToolbarButtonProps {
  /** Drives the shared pressed/expanded visual AND the non-colour marker,
   *  regardless of `stateKind`. */
  active?: boolean;
  onClick: () => void;
  ariaLabel: string;
  title?: string;
  /** Enables the on/off tooltip suffix — "toggle" kind only. */
  lang?: Lang;
  /** Which aria state attribute to emit. Defaults to "action" (Link, Unlink —
   *  no state to announce). */
  stateKind?: ToolbarButtonStateKind;
  accent?: ToolbarButtonAccent;
  /** Suppresses the mousedown default so the click cannot steal focus from the
   *  editor selection the command reads. Opt-in; the heading trigger
   *  deliberately omits it (opening the popover doesn't blur the
   *  contenteditable the way a mark command's focus does). */
  preventFocusSteal?: boolean;
  /** id of the region this trigger reveals — "disclosure" kind only. */
  ariaControls?: string;
  /** Roving tabindex position: 0 for the row's single tab stop, -1 for every
   *  other control. Required for the row's `role="toolbar"` keyboard contract
   *  (open-followups §144a) — a `<button>` is natively tabbable, so omitting
   *  the -1 leaves all fifteen controls in the tab order. */
  tabIndex?: number;
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
}

export function ToolbarButton({
  active = false,
  onClick,
  ariaLabel,
  title,
  lang,
  stateKind = "action",
  accent = "dark-blue",
  preventFocusSteal,
  ariaControls,
  tabIndex,
  ref,
  children,
}: ToolbarButtonProps) {
  const stateText = lang && stateKind === "toggle" ? t(lang, active ? "toggleStateOn" : "toggleStateOff") : "";
  const fullTitle = [title, stateText].filter(Boolean).join(" · ") || undefined;
  const stateAttrs: StateAttrs =
    stateKind === "toggle"
      ? { "aria-pressed": active }
      : stateKind === "disclosure"
        ? { "aria-expanded": active, "aria-controls": ariaControls }
        : {};
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onMouseDown={preventFocusSteal ? (e) => e.preventDefault() : undefined}
      {...stateAttrs}
      tabIndex={tabIndex}
      aria-label={ariaLabel}
      title={fullTitle}
      className={`${BASE} ${active ? ACTIVE[accent] : INACTIVE}`}
    >
      {children}
      {/* Non-colour pressed/expanded cue (WCAG 1.4.1) — an overlay, not a flex
          sibling, so it reserves no width when inactive. bg-current tracks the
          same active-state text colour above, which already has strong
          contrast against every scheme's surface. */}
      <span
        aria-hidden="true"
        data-pressed-marker={active ? "on" : "off"}
        className={`pointer-events-none absolute bottom-0.5 left-1/2 h-0.5 w-2.5 -translate-x-1/2 rounded-full bg-current${active ? "" : " opacity-0"}`}
      />
    </button>
  );
}
