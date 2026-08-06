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
//   grep -rln "<SegmentedControl" src/app --include="*.tsx" | grep -v "\.test\."

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
    const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
    // ★★ Step from the FOCUSED radio, falling back to the checked one. APG
    // defines the move relative to focus, and normally the two agree — the
    // checked radio is the sole Tab-stop, so that is where focus lands. They
    // come apart inside a portaled auto-focusing panel: `PopoverPanel` focuses
    // the FIRST control in document order, which for the field-visibility tier
    // switch is "Simple" while the checked tier is "Advanced". Stepping from
    // `value` there moved TWO positions per keypress, and in "custom" mode
    // (`value` matching no option) `findIndex` returns -1 so a single
    // ArrowRight selected the first option, discarding a hand-picked field set.
    // ★ `indexOf` over THIS group's radios scopes the check by construction —
    // focus in another radiogroup, or nowhere, yields -1 and the fallback.
    const focused = radios.indexOf(document.activeElement as HTMLElement);
    const cur = focused >= 0 ? focused : options.findIndex((o) => o.value === value);
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
    radios[next]?.focus();
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
              "px-3 py-1.5 text-sm font-medium focus:outline-none focus:relative focus:z-10 focus:ring-2 focus:ring-ui-green",
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
