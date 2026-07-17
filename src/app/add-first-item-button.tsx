"use client";

import { INTERACTIVE } from "./interaction-styles";

const RADIUS = { md: "rounded-md", lg: "rounded-lg", xl: "rounded-xl" } as const;
const PAD = { 6: "p-6", 10: "p-10" } as const;

interface AddFirstItemButtonProps {
  /** Fired when the box is clicked — the panel's create-first-item handler. */
  onAdd: () => void;
  /** Bold "+ New X…" call-to-action line (caller composes the leading "+" + trailing "…"). */
  addLabel: string;
  /** Optional descriptive line shown above the CTA. Omit for the single-line (budget) variant. */
  text?: string;
  ariaLabel?: string;
  /** Dashed-box corner radius — match the panel's own data-view scroller radius. Default "lg". */
  rounded?: keyof typeof RADIUS;
  /** Inner padding. Default 10. */
  padding?: keyof typeof PAD;
}

/**
 * The clickable dashed "add first item" empty-state box shared by the entity panels
 * (budget · gantt · milestones · changes · stakeholders · raid · open-points · knowledge).
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
  const shell = `border border-dashed border-line ${RADIUS[rounded]} ${PAD[padding]} text-center text-sm text-muted-foreground hover:border-AIPM-dark-blue hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey ${INTERACTIVE}`;

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
