"use client";

// Reusable segmented control — a row of pill-style buttons where exactly one
// is selected. Replaces a native <select> when the option set is small (3–5)
// and the labels are short. Acts as a radiogroup for assistive tech.
//
// Used by 14 non-test files, 31 invocations (2026-08-06) — the register edit
// modals (absence · budget-bucket · calendar-event · raid-edit), the field
// tier switch (modal-field-controls), task Priority (task-form-fields), the
// view/filter toggles in tasks-section · resources-panel-toolbar ·
// raid-report-panel · activity-log-panel, roles-editor, and the three
// settings sections (appearance carries 7 on its own). ★ Both entries this
// list used to carry were WRONG, not merely stale — Priority had moved out of
// `task-manager.tsx` into `task-form-fields.tsx`, and the RAID controls out of
// `raid-panel.tsx` into `raid-edit-modal.tsx` — so reproduce rather than trust:
//   grep -rln "<SegmentedControl" src/app --include="*.tsx" | grep -v "\.test\." \
//     | grep -v "segmented-control.tsx"
// ★ That trailing filter is required: WITHOUT it this very comment matches and
// the command prints 15, so a reader "corrects" a right number to a wrong one.
// For the 31 invocations, count occurrences rather than files:
//   grep -ro "<SegmentedControl" src/app --include="*.tsx" | grep -v "\.test\." \
//     | grep -v "segmented-control.tsx" | wc -l

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { CheckIcon } from "./icons";
import { handleRadioGroupKeyDown } from "./radio-group-keys";

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
  // APG radiogroup roving — the shared implementation, so every radio group in
  // the app moves the same way (§331). Its notes live with it.
  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    handleRadioGroupKeyDown(e, options.map((o) => o.value), value, onChange);
  }
  const hasSelection = options.some((o) => o.value === value);
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
        // Roving tabindex: the checked radio is the sole Tab-stop; if `value`
        // matches no option (stale/out-of-range), fall back to the first radio
        // so the group is never left keyboard-unreachable.
        const tabStop = selected || (!hasSelection && first);
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={optionAriaLabel ? optionAriaLabel(opt.value) : undefined}
            tabIndex={tabStop ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={[
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium focus:outline-none focus:relative focus:z-10 focus:ring-2 focus:ring-ui-green",
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
            <CheckIcon
              aria-hidden="true"
              data-selected-marker={selected ? "on" : "off"}
              className={`h-3 w-3 shrink-0${selected ? "" : " invisible"}`}
            />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
