"use client";

import { INTERACTIVE } from "./interaction-styles";

const RADIUS = { md: "rounded-md", lg: "rounded-lg", xl: "rounded-xl" } as const;
const PAD = { 6: "p-6", 10: "p-10" } as const;

interface AddFirstItemButtonProps {
  /** Fired when the box is clicked — the panel's create-first-item handler. */
  onAdd: () => void;
  /** Bold "+ New X…" call-to-action line (caller composes the leading "+" + trailing "…"). */
  addLabel: string;
  /** Optional descriptive line shown above the CTA. Omit for the single-line (budget) variant.
   * ★★ 2026-08-26 DECISION — do not "fix" this against WCAG 2.5.3 (label-in-name): when `text`
   * is set, the button's VISIBLE content is `text` + `addLabel`, but its ACCESSIBLE NAME is
   * `ariaLabel` alone (the category-qualified CTA), which does not contain `text`. Under axe's
   * whole-node visible-text computation that reads as a 2.5.3 mismatch. We treat the CTA line as
   * the label and the sentence above it as supplementary description — 2.5.3 concerns the text
   * that IDENTIFIES the control, and axe's whole-node computation is a tool implementation, not
   * the success criterion. The gate can't disagree: the rule is `label-content-name-mismatch`,
   * tagged `experimental`, and axe's default `tagExclude` includes `experimental` — `e2e/a11y.spec.ts`
   * selects rules by tag only (`withTags`, no explicit rule override), so it never runs, in any
   * view, regardless. Two fixes were considered and REJECTED, both because this binds every
   * caller passing `text`, not just the one that raised it: moving the description out of the
   * button would keep containment but shrink the click target (today the whole dashed box is
   * clickable) for every calling panel; widening `ariaLabel` to contain both would be mechanically
   * conformant but produces a very long spoken name on every empty state, regressing the AT users
   * 2.5.3 exists to protect. */
  text?: string;
  ariaLabel?: string;
  /** Dashed-box corner radius — match the panel's own data-view scroller radius. Default "lg". */
  rounded?: keyof typeof RADIUS;
  /** Inner padding. Default 10. */
  padding?: keyof typeof PAD;
}

/**
 * The clickable dashed "add first item" empty-state box shared by the entity panels.
 * Rendered ONLY for a truly-empty register (never filtered-empty); the panel keeps its own
 * empty-vs-filtered branching and swaps this box in for the <table>/rows. With `text` it is a
 * two-line flex box (description + CTA); without, a single centred CTA line (budget).
 */
export function AddFirstItemButton({
  onAdd,
  addLabel,
  text,
  ariaLabel,
  rounded = "lg",
  padding = 10,
}: AddFirstItemButtonProps) {
  const shell = `border border-dashed border-line ${RADIUS[rounded]} ${PAD[padding]} text-center text-sm text-muted-foreground hover:border-ui-dark-blue hover:text-ui-dark-blue dark:hover:text-ui-light-grey ${INTERACTIVE}`;

  if (text === undefined) {
    return (
      <button type="button" onClick={onAdd} aria-label={ariaLabel} className={`w-full ${shell}`}>
        {addLabel}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onAdd}
      aria-label={ariaLabel}
      className={`flex w-full flex-col items-center gap-2 ${shell}`}
    >
      <span>{text}</span>
      <span className="font-medium">{addLabel}</span>
    </button>
  );
}
