import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColumnConfigPopover } from "./column-config-popover";
import { t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";

const COLS = [
  { key: "email", labelKey: "stakeholderFieldEmail" as const },
  { key: "title", labelKey: "stakeholderFieldTitle" as const },
];

it("opens the dialog and lists a checkbox per column (checked = visible)", () => {
  render(<ColumnConfigPopover lang="en-US" cols={COLS} hidden={new Set(["email"])} onToggle={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "colConfigTitle") }));
  const email = screen.getByLabelText(t("en-US", "stakeholderFieldEmail")) as HTMLInputElement;
  const title = screen.getByLabelText(t("en-US", "stakeholderFieldTitle")) as HTMLInputElement;
  expect(email.checked).toBe(false); // hidden
  expect(title.checked).toBe(true);
});

it("fires onToggle(key) when a checkbox is clicked", () => {
  const onToggle = vi.fn();
  render(<ColumnConfigPopover lang="en-US" cols={COLS} hidden={new Set()} onToggle={onToggle} />);
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "colConfigTitle") }));
  fireEvent.click(screen.getByLabelText(t("en-US", "stakeholderFieldEmail")));
  expect(onToggle).toHaveBeenCalledWith("email");
});

// §261, third leg. Each toggle used to take its accessible name from its
// wrapping <label>'s text alone — the bare column name — so in every consuming
// panel it read exactly what that column's sort header (and, before tasks 5-7,
// its toolbar filter) read: two controls, one name, genuinely different
// purposes (WCAG 2.4.6). One `aria-label` here closes the leg in all five
// consumers at once.
// ★★★ axe has no rule that flags two controls sharing an accessible name, in
// any view at any seed size, so this unit test is the only detector that can
// exist for it.
it("qualifies every column toggle with its action, keeping the visible label inside the name", () => {
  render(<ColumnConfigPopover lang="en-US" cols={COLS} hidden={new Set()} onToggle={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "colConfigTitle") }));

  for (const { labelKey } of COLS) {
    const visible = t("en-US", labelKey);
    const accessible = t("en-US", "colConfigToggleColumn", visible);
    // Whole-string match (testing-library has no `exact` option), so this
    // fails against the bare column name the <label> alone would have given.
    expect(screen.getByRole("checkbox", { name: accessible })).toBeTruthy();

    // ★★ THIS LINE IS NOT THE 2.5.3 PIN, and reading it as one would be a false
    // coverage claim: BOTH sides derive from the same i18n template — `accessible`
    // is computed HERE as `t("en-US","colConfigToggleColumn", visible)` — so it
    // asserts only that `{0}` survives interpolation. It would still pass if the
    // component dropped the visible label entirely. It is kept because that
    // interpolation is a real precondition of the `getByRole({name: accessible})`
    // lookup ABOVE (which is what actually bites the component), and because it
    // documents the containment RULE that governs the shape of the string:
    // WCAG 2.5.3 (label in name) is CONTAINMENT — case-insensitive and
    // position-independent, per Understanding SC 2.5.3 and axe's own
    // `curatedCompareWith.includes(curatedCompare)`. Deliberately NOT a prefix
    // test: that is stricter than the SC and flags conformant code elsewhere in
    // this app (the dependency type select's "Predecessor type for next link"
    // contains, but is not prefixed by, its visible "Type for next link").
    // ★ The REAL 2.5.3 assertion against the rendered component is the
    // `row?.textContent` check below (the one marked "Anti-vacuity") — that one
    // reads the DOM rather than re-deriving the i18n template.
    expect(accessible.toLowerCase()).toContain(visible.toLowerCase());

    // ★ Anti-vacuity: the qualifier must not have REPLACED the visible text.
    // Speech-input and sighted users both depend on the label still rendering.
    const row = screen.getByRole("checkbox", { name: accessible }).closest("label");
    expect(row?.textContent).toContain(visible);
  }

  // The whole point: the two toggles no longer share a name with anything,
  // including each other. MEASURED against this fixture, not guessed:
  // 1 gear button + 2 checkboxes = 3.
  expectRowUniqueNames({ minControls: 3, roles: ["button", "checkbox"] });
});
