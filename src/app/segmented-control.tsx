"use client";

// Reusable segmented control — a row of pill-style buttons where exactly one
// is selected. Replaces a native <select> when the option set is small (3–5)
// and the labels are short. Acts as a radiogroup for assistive tech.
//
// Used by:
//   • task-manager.tsx — Priority in the add/edit task modal
//   • raid-panel.tsx   — Category, Status, Severity in the RAID edit modal

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

const NAV_KEYS = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];

interface SegmentedControlOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: ReadonlyArray<SegmentedControlOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
  /** Per-option accessible name for the individual radio. Use when the same
   *  control is repeated across rows so each radio is uniquely named (WCAG
   *  2.4.6) — the group's `ariaLabel` alone doesn't disambiguate the radios.
   *  When omitted, a radio's accessible name is just its visible label. */
  optionAriaLabel?: (value: T) => string;
  /** Tooltip text for the whole control (rendered as the radiogroup's title). */
  title?: string;
  /** Extra classes for the wrapper (e.g. `w-full` to span its column). */
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  optionAriaLabel,
  title,
  className = "",
}: SegmentedControlProps<T>) {
  // APG radiogroup roving: arrows (and Home/End) move selection + focus to the
  // adjacent radio and wrap; the checked radio is the sole Tab-stop.
  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (!NAV_KEYS.includes(e.key)) return;
    e.preventDefault();
    const cur = options.findIndex((o) => o.value === value);
    const last = options.length - 1;
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? last
          : e.key === "ArrowRight" || e.key === "ArrowDown"
            ? cur >= last
              ? 0
              : cur + 1
            : cur <= 0
              ? last
              : cur - 1;
    onChange(options[next].value);
    const radios = e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]');
    radios[next]?.focus();
  }
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      title={title}
      aria-disabled={disabled || undefined}
      onKeyDown={disabled ? undefined : handleKeyDown}
      className={`inline-flex flex-wrap rounded-md border border-line bg-[var(--segment-track-bg)] ${
        disabled ? "opacity-60" : ""
      } ${className}`}
    >
      {options.map((opt, idx) => {
        const selected = value === opt.value;
        const first = idx === 0;
        const last = idx === options.length - 1;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={optionAriaLabel ? optionAriaLabel(opt.value) : undefined}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={[
              "px-3 py-1.5 text-sm font-medium focus:outline-none focus:relative focus:z-10 focus:ring-2 focus:ring-AIPM-green",
              first ? "rounded-l-md" : "",
              last ? "rounded-r-md" : "",
              idx > 0 ? "border-l border-line" : "",
              selected
                ? "bg-[var(--segment-active-bg)] text-[var(--segment-active-fg)] shadow-[var(--shadow-control)]"
                : "text-foreground enabled:hover:bg-surface-muted disabled:cursor-not-allowed",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
