import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CustomerFields, OptionalDetailsFields, emptyProjectDraft } from "./project-form-fields";
import { IDENTITY_TYPES, REGULATORY_REQUIREMENTS } from "./project-options";
import { expectNoLabelBoundToButton, labelsContainingLabels } from "../test/label-binding";

// Render guard for the two CHECKBOX-GRID captions.
//
// ★★★ Why this file exists: these two fields carried the mis-binding defect in
// its non-button form — a caption `<label>` wrapping a grid of checkboxes adopts
// the FIRST checkbox, so clicking "Regulatory" ticked it and the markup nested a
// `<label>` inside a `<label>`. Found by a cold review, and BOTH existing guards
// were structurally blind to it: the source scan treats a leading `<input>` as
// proof of correct binding, and `labelsBoundToButtons` filters on
// `tagName === "BUTTON"`. `labelsContainingLabels` is the check that sees it.
//
// ★ These components take no context and no providers — the whole point is that
// the assertion is about markup, so the cheapest possible mount is the right one.
const props = {
  draft: emptyProjectDraft(),
  setDraft: () => {},
  errorFor: () => null,
  markTouched: () => {},
  lang: "en-US" as const,
  stakeholderNames: [],
  addressBook: [],
  resources: [],
};

describe("project form checkbox-grid captions", () => {
  it("renders Regulatory as a named group, not a label that ticks its first box", () => {
    render(<CustomerFields {...props} />);

    // The fix, asserted positively: a caption that names the block without
    // being a click target. `getByRole` resolves only if `group` was passed.
    expect(screen.getByRole("group", { name: /Regulatory/ })).toBeInTheDocument();

    // ★ Not redundant with the group assertion: a future refactor could keep the
    // group AND reintroduce a wrapping label around the grid.
    expect(labelsContainingLabels()).toEqual([]);
    expectNoLabelBoundToButton();
  });

  it("renders Identity types as a named group", () => {
    render(<OptionalDetailsFields {...props} />);

    expect(screen.getByRole("group", { name: /Identity types/ })).toBeInTheDocument();
    expect(labelsContainingLabels()).toEqual([]);
    expectNoLabelBoundToButton();
  });

  // ★★ The counter-assertion, and the reason this file cannot pass by simply
  // deleting labels: the INNER labels are correct and must stay. A fix that
  // stripped them would satisfy `labelsContainingLabels` while destroying the
  // per-checkbox naming that makes the grid usable at all.
  // ★★★ Assert the EXACT name, never a bare `toHaveAccessibleName()`. The bare
  // form only asks that SOME name exists: measured, renaming every option to one
  // shared string left this green — blessing a WCAG 2.4.6 duplicate-name defect
  // of exactly the kind AGENTS.md calls out for per-row controls.
  it.each([
    ["Identity types", OptionalDetailsFields, IDENTITY_TYPES],
    ["Regulatory", CustomerFields, REGULATORY_REQUIREMENTS],
  ] as const)("binds each %s option label to its own checkbox", (_name, Component, options) => {
    render(<Component {...props} />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBe(options.length);
    for (const option of options) {
      expect(screen.getByRole("checkbox", { name: option })).toBeInTheDocument();
    }
  });
});
