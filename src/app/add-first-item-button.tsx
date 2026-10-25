"use client";

import { INTERACTIVE, TRANSITION } from "./interaction-styles";

const RADIUS = { md: "rounded-md", lg: "rounded-lg", xl: "rounded-xl" } as const;
// The click overlay's own corners, so it matches the box. Whole literals: an
// interpolated `after:${…}` emits no CSS.
const OVERLAY_RADIUS = { md: "after:rounded-md", lg: "after:rounded-lg", xl: "after:rounded-xl" } as const;
const PAD = { 6: "p-6", 10: "p-10" } as const;

interface AddFirstItemButtonProps {
  /** Fired when the box is clicked — the panel's create-first-item handler. */
  onAdd: () => void;
  /** Bold "+ New X…" call-to-action line (caller composes the leading "+" + trailing "…"). */
  addLabel: string;
  /** Optional descriptive line shown above the CTA. Omit for the single-line (budget) variant.
   * ★★ WCAG 2.5.3 (label in name): with `text`, the <button> wraps the CTA line ALONE and the
   * description is plain text beside it, so the button's visible text is `addLabel`, which
   * `ariaLabel` contains. An `after:` overlay on the button keeps the whole dashed box the click
   * target, and the box draws the focus ring (`has-[button:focus]`) — one tab stop, as before.
   * Until 2026-10 the button wrapped both lines, a mismatch axe 4.14's
   * `label-content-name-mismatch` flags once an empty state is scanned. */
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
 * two-line flex box (description + CTA button); without, a single centred CTA button (budget).
 */
export function AddFirstItemButton({
  onAdd,
  addLabel,
  text,
  ariaLabel,
  rounded = "lg",
  padding = 10,
}: AddFirstItemButtonProps) {
  const look = `border border-dashed border-line ${RADIUS[rounded]} ${PAD[padding]} text-center text-sm text-muted-foreground hover:border-ui-dark-blue hover:text-ui-dark-blue dark:hover:text-ui-light-grey`;

  if (text === undefined) {
    return (
      <button type="button" onClick={onAdd} aria-label={ariaLabel} className={`w-full ${look} ${INTERACTIVE}`}>
        {addLabel}
      </button>
    );
  }

  return (
    <div
      data-add-first-box
      className={`relative flex w-full cursor-pointer flex-col items-center gap-2 ${look} ${TRANSITION} has-[button:focus]:ring-2 has-[button:focus]:ring-ui-green has-[button:active]:translate-y-px`}
    >
      <span>{text}</span>
      <button
        type="button"
        onClick={onAdd}
        aria-label={ariaLabel}
        className={`font-medium after:absolute after:inset-0 after:content-[''] ${OVERLAY_RADIUS[rounded]} focus:outline-none`}
      >
        {addLabel}
      </button>
    </div>
  );
}
