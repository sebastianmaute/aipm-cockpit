"use client";
import type { ReactNode } from "react";

// Shared binary on/off toggle button (the gantt toolbar toggle look): a
// bordered chip that gains an accent border + tint when pressed, so the ON
// state is visible at a glance and reflows with the active scheme.
//
// ★★ WCAG 4.1.2 name/state coherence is STRUCTURAL here: the visible label
// (`children`) MUST name what pressed=true ENABLES and NEVER flip with state.
// `aria-pressed` tracks that same state, so "Inline milestones, pressed" ⇒
// inline is on. Do not pass a label that flips to the opposite action.
export type ToggleAccent = "dark-blue" | "pink";

const BASE =
  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2";

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
  title?: string;
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
  disabled,
  className,
}: ToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={pressed}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      className={`${BASE} ${pressed ? PRESSED[accent] : UNPRESSED}${className ? ` ${className}` : ""}`}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
