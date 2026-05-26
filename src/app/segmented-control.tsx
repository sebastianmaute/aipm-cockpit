"use client";

// Reusable segmented control — a row of pill-style buttons where exactly one
// is selected. Replaces a native <select> when the option set is small (3–5)
// and the labels are short. Acts as a radiogroup for assistive tech.
//
// Used by:
//   • task-manager.tsx — Priority in the add/edit task modal
//   • raid-panel.tsx   — Category, Status, Severity in the RAID edit modal

import type { ReactNode } from "react";

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
  title,
  className = "",
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      title={title}
      aria-disabled={disabled || undefined}
      className={`inline-flex flex-wrap rounded-md border border-zinc-300 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900 ${
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
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={[
              "px-3 py-1.5 text-sm font-medium focus:outline-none focus:relative focus:z-10 focus:ring-1 focus:ring-AIPM-dark-blue",
              first ? "rounded-l-md" : "",
              last ? "rounded-r-md" : "",
              idx > 0 ? "border-l border-zinc-300 dark:border-zinc-700" : "",
              selected
                ? "bg-AIPM-dark-blue text-white"
                : "text-zinc-700 enabled:hover:bg-zinc-100 disabled:cursor-not-allowed dark:text-zinc-200 dark:enabled:hover:bg-zinc-800",
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
