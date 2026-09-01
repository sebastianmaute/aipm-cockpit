"use client";
import { CheckIcon } from "./icons";
import type { ComponentProps, ReactNode } from "react";
import { type Lang, t } from "./i18n";

// Shared binary on/off toggle button (the gantt toolbar toggle look): a
// bordered chip that gains a derived accent border + tint when pressed. The
// border rides `--control-state-border` / `--control-state-border-pink`, each
// nudged to clear 3:1 against the unpressed `--line` (SC 1.4.11) — the raw
// accents did not: `--ui-dark-blue` measured 1.03-1.22:1 against `--line` in
// the three dark schemes, which is invisible to every user, not only to users
// with a colour-vision deficiency. The non-colour cue is the trailing marker
// below, which is a SEPARATE guarantee (SC 1.4.1) and does not substitute for
// this one — open-followups §56 records that reading the glyph as the fix is
// the trap here.
// ★★ NO `dark:border-*` VARIANT. scheme-apply.ts sets these custom properties
//    inline per active scheme AND mode, so one declaration is already
//    mode-correct; a `dark:` variant would re-pin the raw accent in exactly
//    the schemes that fail the floor. Pinned by toggle-button.test.tsx.
//
// ★★ WCAG 4.1.2 name/state coherence is STRUCTURAL here: the visible label
// (`children`) MUST name what pressed=true ENABLES and NEVER flip with state.
// `aria-pressed` tracks that same state, so "Inline milestones, pressed" ⇒
// inline is on. Do not pass a label that flips to the opposite action.
// ★ Three accents, and each exists because some consumer's IDENTITY colour had
// to survive the 1.4.11 fix rather than be replaced by the chrome default.
// Green is the dictation mic's: its listening cue was a green ICON, which
// clears 3:1 against the idle glyph in exactly one of seven combos.
export type ToggleAccent = "dark-blue" | "pink" | "green";

// Geometry family. "chip" is the toolbar look every consumer started with;
// "card" is a full-width, multi-line OPTION card (a title, a description, a
// badge row) — the create-project wizard's Step-2 templates.
// ★★ The card variant lives HERE rather than at the call site because the call
//    site's only way to stretch the children wrapper was `[&>span]:w-full`,
//    i.e. reaching into this component's internal markup. A primitive whose
//    consumers have to know its DOM is not a primitive.
export type ToggleSize = "chip" | "card";

// ★★ `disabled` was accepted by this component from the start but styled NOTHING
//    — no call site had ever passed it, so an inoperable toggle was pixel-identical
//    to a live one. The first real consumer is the Settings auto-sync row, which is
//    inert until its sibling enable toggle is on. Opacity is safe HERE specifically:
//    WCAG 1.4.3 exempts inactive components from contrast, which is NOT true of the
//    enabled-state alpha traps recorded in AGENTS.md — don't generalise it.
const BASE =
  "inline-flex gap-1.5 rounded-md border focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60";

// Geometry only — everything else about the two sizes is identical.
// ★★ `font-medium` is deliberately CHIP-ONLY. On a card the weight belongs to
//    the title span the call site already emits; spreading it over the whole
//    control would bold the description paragraphs too.
const SIZE: Record<ToggleSize, string> = {
  chip: "items-center px-2.5 py-1.5 text-xs font-medium",
  card: "items-start px-3 py-2 text-sm",
};

const UNPRESSED =
  "border-line bg-surface text-foreground hover:bg-surface-muted focus:ring-ui-green";

const PRESSED: Record<ToggleAccent, string> = {
  "dark-blue":
    "border-[var(--control-state-border)] bg-ui-dark-blue/10 text-ui-dark-blue hover:bg-ui-dark-blue/20 focus:ring-ui-dark-blue dark:bg-ui-dark-blue/20 dark:text-ui-light-grey",
  pink: "border-[var(--control-state-border-pink)] bg-ui-pink/10 text-ui-dark-blue hover:bg-ui-pink/20 focus:ring-ui-pink dark:bg-ui-pink/15 dark:text-ui-light-grey",
  green:
    "border-[var(--control-state-border-green)] bg-ui-green/10 text-ui-dark-blue hover:bg-ui-green/20 focus:ring-ui-green dark:bg-ui-green/20 dark:text-ui-light-grey",
};

interface ToggleButtonProps {
  /** ON state — also the value announced via `aria-pressed`. */
  pressed: boolean;
  onToggle: () => void;
  /** Visible label — MUST name what pressed=true ENABLES (see coherence note). */
  children: ReactNode;
  /** Pressed accent family; defaults to the app's dark-blue chrome accent. */
  accent?: ToggleAccent;
  /** Geometry family — a toolbar chip (default) or a full-width, multi-line
   *  option card. `card` also stretches the children wrapper, so no call site
   *  has to reach into this component's markup to do it. */
  size?: ToggleSize;
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
  /** Renders as a disclosure trigger (aria-expanded + aria-controls) instead of
   *  a stateful toggle (aria-pressed). Same visuals, same non-colour marker —
   *  only the announced semantics differ. A disclosure REVEALS content; a
   *  toggle CHANGES state. Defaults to "toggle" so every existing consumer is
   *  byte-identical. */
  variant?: "toggle" | "disclosure";
  /** id of the region this trigger reveals. Required (and meaningful) only
   *  when `variant="disclosure"`. */
  ariaControls?: string;
  /** ★★ Suppresses the mousedown default so the button never takes focus, for
   *  a toggle that acts on ANOTHER element's selection — the rich-text toolbar,
   *  where focusing the chip blurs the contenteditable and destroys the
   *  selection every command reads, and where the commit-on-blur consumers
   *  remount the editor between mousedown and mouseup so no click is ever
   *  dispatched.
   *  ★★★ OPT-IN, and it must stay opt-in. Taking focus on click is the NATIVE
   *  button behaviour and the right default for every other consumer (gantt View
   *  menu, settings rows, dashboard chips): a mouse user who clicks and then
   *  presses Space would otherwise re-fire whatever held focus before. Do not
   *  promote this to unconditional to save a prop at one call site. */
  preventFocusSteal?: boolean;
  /** ★★ Pointer/keyboard handlers for a PRESS-AND-HOLD consumer — dictation's
   *  push-to-talk mic, where the state is "held down", not "clicked on". Such
   *  a control has no click semantic at all (its keydown calls
   *  `preventDefault`, which suppresses the synthetic click), so it passes a
   *  no-op `onToggle` and drives `pressed` from the hold.
   *  ★ Deliberately a NAMED, narrow bag rather than a `...rest` spread: the
   *  primitive must keep sole ownership of every a11y attribute it emits, and
   *  a rest spread would let a call site quietly overwrite `aria-pressed`,
   *  `aria-label` or `type`. Widen the bag if a consumer needs more; do not
   *  replace it with a spread. */
  pressHandlers?: Pick<
    ComponentProps<"button">,
    | "onPointerDown"
    | "onPointerUp"
    | "onPointerLeave"
    | "onPointerCancel"
    | "onKeyDown"
    | "onKeyUp"
  >;
}

export function ToggleButton({
  pressed,
  onToggle,
  children,
  accent = "dark-blue",
  size = "chip",
  icon,
  ariaLabel,
  title,
  lang,
  ariaDescribedBy,
  disabled,
  className,
  variant = "toggle",
  ariaControls,
  preventFocusSteal,
  pressHandlers,
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
  // ★ ALSO SUPPRESSED FOR `variant="disclosure"`. The suffix states on/off
  //    setting language ("click to turn on/off"), which misdescribes a
  //    disclosure trigger that reveals static content rather than changing
  //    application state.
  const stateText =
    lang && !disabled && variant !== "disclosure"
      ? t(lang, pressed ? "toggleStateOn" : "toggleStateOff")
      : "";
  const fullTitle = [title, stateText].filter(Boolean).join(" · ") || undefined;
  return (
    <button
      // ★★★ EVERY ATTRIBUTE THIS PRIMITIVE OWNS MUST COME AFTER THE SPREAD.
      //     JSX is later-wins, so an attribute written BEFORE `{...pressHandlers}`
      //     is overridable by the bag and one written after is not. `type` sat
      //     before it and was the sole unprotected attribute: the `Pick<>` does
      //     not close that, because TypeScript's excess-property check applies
      //     only to FRESH OBJECT LITERALS, so a call site passing a prebuilt
      //     `const bag = {onPointerDown: f, type: "submit" as const}` typechecks
      //     and would turn every toggle inside a <form> into a submit button.
      //     Pinned by toggle-button.test.tsx.
      {...pressHandlers}
      type="button"
      onClick={onToggle}
      onMouseDown={preventFocusSteal ? (e) => e.preventDefault() : undefined}
      {...(variant === "disclosure"
        ? { "aria-expanded": pressed, "aria-controls": ariaControls }
        : { "aria-pressed": pressed })}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      title={fullTitle}
      disabled={disabled}
      className={`${BASE} ${SIZE[size]} ${pressed ? PRESSED[accent] : UNPRESSED}${className ? ` ${className}` : ""}`}
    >
      {icon}
      <span className={size === "card" ? "w-full" : undefined}>{children}</span>
      {/* ★★ THE NON-COLOUR CUE (WCAG 1.4.1). Without it the ON state is carried
          by the accent border+tint ALONE, which a user who cannot distinguish
          those colours reads as an ordinary chip. `aria-pressed` already tells
          assistive tech, so this closes the gap for SIGHTED users specifically.
          ★ The glyph reaches no accessible name because an `<svg>` with no
          `<title>` contributes no text — full stop. The `aria-hidden` below is
          the SOLE source of that attribute, NOT belt-and-braces — lucide adds
          its own default only when the caller passes no a11y prop at all, and
          this component always does. ★ It is a default, not a hard-code
          either: dropping the explicit value would let lucide's own
          conditional default take over instead, since nothing else in `rest`
          supplies an a11y prop — same rendered output, opposite mechanism.
          Keep it; "redundant" is the wrong reading.
          Stated because a test asserting otherwise was written here, and could
          not fail.
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
