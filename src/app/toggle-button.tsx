"use client";
import { CheckIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { type Lang, t } from "./i18n";

// Shared binary on/off toggle button (the gantt toolbar toggle look): a
// bordered chip that gains an accent border + tint when pressed, so the ON
// state is visible at a glance and reflows with the active scheme.
//
// ★★ WCAG 4.1.2 name/state coherence is STRUCTURAL here: the visible label
// (`children`) MUST name what pressed=true ENABLES and NEVER flip with state.
// `aria-pressed` tracks that same state, so "Inline milestones, pressed" ⇒
// inline is on. Do not pass a label that flips to the opposite action.
export type ToggleAccent = "dark-blue" | "pink";

// ★★ `disabled` was accepted by this component from the start but styled NOTHING
//    — no call site had ever passed it, so an inoperable toggle was pixel-identical
//    to a live one. The first real consumer is the Settings auto-sync row, which is
//    inert until its sibling enable toggle is on. Opacity is safe HERE specifically:
//    WCAG 1.4.3 exempts inactive components from contrast, which is NOT true of the
//    enabled-state alpha traps recorded in AGENTS.md — don't generalise it.
const BASE =
  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60";

const UNPRESSED =
  "border-line bg-surface text-foreground hover:bg-surface-muted focus:ring-ui-green";

const PRESSED: Record<ToggleAccent, string> = {
  "dark-blue":
    "border-ui-dark-blue bg-ui-dark-blue/10 text-ui-dark-blue hover:bg-ui-dark-blue/20 focus:ring-ui-dark-blue dark:border-ui-dark-blue dark:bg-ui-dark-blue/20 dark:text-ui-light-grey",
  pink: "border-ui-pink bg-ui-pink/10 text-ui-dark-blue hover:bg-ui-pink/20 focus:ring-ui-pink dark:border-ui-pink dark:bg-ui-pink/15 dark:text-ui-light-grey",
};

interface ToggleButtonProps {
  /** ON state — also the value announced via `aria-pressed`. */
  pressed: boolean;
  onToggle: () => void;
  /** Visible label — MUST name what pressed=true ENABLES (see coherence note). */
  children: ReactNode;
  /** Pressed accent family; defaults to the app's dark-blue chrome accent. */
  accent?: ToggleAccent;
  /** Optional leading icon (aria-hidden svg), rendered before the label. */
  icon?: ReactNode;
  /** Overrides the accessible name when the visible label needs qualifying. */
  ariaLabel?: string;
  /** Descriptive tooltip. The CURRENT on/off state is appended automatically
   *  when `lang` is passed — see the state-disclosure note above. */
  title?: string;
  /** Enables the on/off suffix in the tooltip. Optional so existing call sites
   *  keep compiling; pass it wherever a `lang` is in scope. */
  lang?: Lang;
  /** id of a node explaining the control — required reading for a `disabled`
   *  toggle, which leaves the tab order and so cannot explain itself. */
  ariaDescribedBy?: string;
  disabled?: boolean;
  /** Extra layout classes appended verbatim (e.g. `w-fit`). */
  className?: string;
}

export function ToggleButton({
  pressed,
  onToggle,
  children,
  accent = "dark-blue",
  icon,
  ariaLabel,
  title,
  lang,
  ariaDescribedBy,
  disabled,
  className,
}: ToggleButtonProps) {
  // ★★ STATE IN THE TOOLTIP. The visible label is PINNED to what pressed=true
  //    enables, so it cannot say which state is live. The tooltip says it in
  //    words. It goes in `title` — the accessible DESCRIPTION — precisely
  //    because the NAME must stay stable; same split `resource-picker` uses for
  //    linked vs dangling. Composed in the PRIMITIVE so no call site hand-rolls it.
  // ★★ This is NOT a screen-reader-free channel, and an earlier comment here
  //    wrongly implied it was ("for a sighted mouse user"). `title` becomes the
  //    accessible description, which NVDA/JAWS read AFTER the name and state —
  //    so a toggle announces its state twice on focus. Harmless (both derive
  //    from the same `pressed`, so they cannot disagree), but real: don't add a
  //    THIRD statement of it.
  // ★★ NOT what closes WCAG 1.4.1 either: `title` is hover-only — no keyboard
  //    focus, unreachable on touch. The non-colour VISUAL cue is the trailing
  //    check marker below.
  // ★★ SUPPRESSED WHILE DISABLED. The suffix ends "— click to turn on", which a
  //    disabled control cannot honour; a screen reader in browse mode announced
  //    "unavailable … click to turn on" on the Settings auto-sync row. The caller
  //    explains the dependency instead (see `ariaDescribedBy`).
  const stateText = lang && !disabled ? t(lang, pressed ? "toggleStateOn" : "toggleStateOff") : "";
  const fullTitle = [title, stateText].filter(Boolean).join(" · ") || undefined;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={pressed}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      title={fullTitle}
      disabled={disabled}
      className={`${BASE} ${pressed ? PRESSED[accent] : UNPRESSED}${className ? ` ${className}` : ""}`}
    >
      {icon}
      <span>{children}</span>
      {/* ★★ THE NON-COLOUR CUE (WCAG 1.4.1). Without it the ON state is carried
          by the accent border+tint ALONE, which a user who cannot distinguish
          those colours reads as an ordinary chip. `aria-pressed` already tells
          assistive tech, so this closes the gap for SIGHTED users specifically.
          ★ The glyph reaches no accessible name because an `<svg>` with no
          `<title>` contributes no text — full stop. The `aria-hidden` below is
          BELT-AND-BRACES against a heroicons change, NOT the mechanism (the
          library already hard-codes it on every icon). Stated because a test
          asserting otherwise was written here, and could not fail.
          ★★ It is rendered in BOTH states and merely `invisible` when off, so
          the button keeps ONE width. Conditional rendering would make the
          button ~20px narrower when off, and these sit in toolbar rows — a
          repeatedly-clicked control that resizes moves its neighbours under
          the pointer. (Reasoned, not measured: jsdom has no layout, so no test
          here can see it either way.) The cost is that reserved slot on every
          toggle, off included.
          ★ `invisible` is visibility:hidden; `opacity-0` would reserve the same
          space and is NOT a bug if someone swaps it. An earlier version of this
          comment defended the choice on a11y-tree grounds, which is inert —
          `aria-hidden` above already excludes the glyph unconditionally, in
          both states, under either class. */}
      <CheckIcon
        aria-hidden="true"
        data-pressed-marker={pressed ? "on" : "off"}
        className={`h-3.5 w-3.5 shrink-0${pressed ? "" : " invisible"}`}
      />
    </button>
  );
}
