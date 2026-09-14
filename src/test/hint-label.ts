import { screen } from "@testing-library/react";
import { expect } from "vitest";

/**
 * For each caption, finds the control its label names and asserts that
 * control's accessible name is EXACTLY the caption.
 * ★ `getByLabelText` matches a label's text content with control content
 *   excluded but an InfoTooltip trigger's glyph INCLUDED, so a hint back inside
 *   the label fails the lookup itself; `toHaveAccessibleName` then pins the
 *   computed name, not just the label text.
 */
export function expectExactLabelNames(captions: readonly string[]): void {
  for (const caption of captions) {
    expect(screen.getByLabelText(caption), caption).toHaveAccessibleName(caption);
  }
}

// Guard for open-followups §386: a `<label>`'s text CONTENT is its control's
// accessible name, so an `InfoTooltip` trigger inside a label that names a
// control joins that name (testing-library computed "Groupi" for "Group").
//
// A label is flagged only when all three hold:
//   1. it contains an InfoTooltip trigger (`data-info-tooltip-trigger`);
//   2. it binds a control (`HTMLLabelElement.control`, implicit or `htmlFor`);
//   3. that control does not name itself with `aria-label`/`aria-labelledby`.
// A self-named control ignores its label's content, so its name is not
// polluted, and it is deliberately not flagged.
//
// ★ This proves the STRUCTURE only. Pair it with an exact-name assertion
//   (`toHaveAccessibleName`) on the controls a test cares about.

/** Text of every label that pollutes a control's name with a hint. */
export function hintPollutedLabels(root: ParentNode = document.body): string[] {
  return Array.from(root.querySelectorAll("label"))
    .filter((label) => {
      if (!label.querySelector("[data-info-tooltip-trigger]")) return false;
      const control = label.control;
      if (!control) return false;
      return !control.hasAttribute("aria-label") && !control.hasAttribute("aria-labelledby");
    })
    .map((label) => (label.textContent ?? "").replace(/\s+/g, " ").trim());
}

/**
 * Asserts no hint sits inside a label that names a control.
 * `minHints` does NOT make this non-vacuous: it counts every
 * `data-info-tooltip-trigger` in `root`, so it only proves SOME trigger
 * rendered somewhere in scope, not that a specific hinted field did. Pair
 * this with `expectExactLabelNames` — `getByLabelText` throws when no
 * control matches a caption, so a fixture that stopped rendering a hinted
 * field fails there, not here.
 */
export function expectNoHintInNamingLabel({
  minHints,
  root = document.body,
}: {
  minHints: number;
  root?: ParentNode;
}): void {
  const hints = root.querySelectorAll("[data-info-tooltip-trigger]").length;
  if (hints < minHints) {
    throw new Error(`expectNoHintInNamingLabel: expected at least ${minHints} InfoTooltip triggers, found ${hints}`);
  }
  expect(hintPollutedLabels(root)).toEqual([]);
}
