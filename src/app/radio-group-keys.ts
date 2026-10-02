// src/app/radio-group-keys.ts
//
// The ONE keyboard model for a single-choice group (§331): WAI-ARIA APG
// radiogroup roving. Arrows and Home/End move selection AND focus to the
// adjacent `[role="radio"]` inside the group element the handler is attached
// to, wrapping at the ends. The checked radio is the group's sole Tab-stop —
// that half is the caller's (`tabIndex={checked ? 0 : -1}`, with the first
// radio as the stop when nothing is checked).
// ★ Extracted from `SegmentedControl` so groups that keep their own look (the
// task health chips, the RACI chips) cannot drift into a second interaction
// model for the same visual pattern.
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

const NAV_KEYS = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];

// APG radiogroup roving: arrows (and Home/End) move selection + focus to the
// adjacent radio and wrap; the checked radio is the sole Tab-stop.
export function handleRadioGroupKeyDown<T>(
  e: ReactKeyboardEvent<HTMLElement>,
  values: readonly T[],
  value: T | undefined,
  onChange: (value: T) => void,
): void {
  if (!NAV_KEYS.includes(e.key)) return;
  e.preventDefault();
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
  // ★★ Step from the FOCUSED radio, falling back to the checked one. APG
  // defines the move relative to focus, and normally the two agree — the
  // checked radio is the sole Tab-stop, so that is where focus lands. They
  // come apart inside a portaled auto-focusing panel: `PopoverPanel` focuses
  // the FIRST control in document order, which for the field-visibility tier
  // switch is "Simple" while the checked tier is "Advanced". Stepping from
  // `value` there moved TWO positions per keypress. In "custom" mode (`value`
  // matching no option) `findIndex` returns -1, so the step started from the
  // wrong end of the group as well.
  // ★★ THE TWO-POSITION JUMP WAS THE BUG — the custom-mode DISCARD IS NOT
  // FIXED AND IS NOT A DEFECT. An arrow in a radiogroup IS a selection, so
  // arrowing out of "custom" necessarily replaces the hand-picked set; only
  // WHICH tier it lands on changed. Measured on the field-visibility popover
  // after this fix: opening fresh while already custom focuses "Simple" (the
  // tab-stop, since nothing is checked) and ArrowRight lands on "Advanced";
  // hand-toggling into custom with the popover already open leaves focus on
  // the old radio and ArrowRight lands on "Full". Both discard the set. Do
  // not read this comment as closing that path.
  // ★ `indexOf` over THIS group's radios scopes the check by construction —
  // focus in another radiogroup, or nowhere, yields -1 and the fallback.
  // ★ Behaviour change for ALL consumers, not just the popover: where an
  // `onChange` does NOT update `value` (a guarded, rejected or async change),
  // focus now advances while `value` stays, and the next arrow steps from
  // focus rather than re-deriving from the stale `value`. That is the APG
  // behaviour and it fixes rapid arrowing, which previously stuck whenever
  // `value` had not re-rendered yet. No consumer guards `onChange` today.
  const focused = radios.indexOf(document.activeElement as HTMLElement);
  const cur = focused >= 0 ? focused : values.indexOf(value as T);
  const last = values.length - 1;
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
  onChange(values[next]);
  radios[next]?.focus();
}

/** §331 — the same arrow/Home/End movement for a `menu` of `menuitemradio`s,
 *  where moving must NOT select: a menu item commits (and here, closes the
 *  popover) on activation, so arrowing only moves focus. Used by the RACI chip
 *  picker, whose pick closes it — a radio group there would commit on every
 *  arrow press. The roving `tabIndex` is the caller's, as above. */
export function handleRovingFocusKeyDown(e: ReactKeyboardEvent<HTMLElement>, itemSelector: string): void {
  if (!NAV_KEYS.includes(e.key)) return;
  e.preventDefault();
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(itemSelector));
  if (items.length === 0) return;
  const cur = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
  const last = items.length - 1;
  const next =
    e.key === "Home" ? 0
    : e.key === "End" ? last
    : e.key === "ArrowRight" || e.key === "ArrowDown" ? (cur >= last ? 0 : cur + 1)
    : cur <= 0 ? last : cur - 1;
  items[next].focus();
}
