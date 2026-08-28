import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CustomerFields,
  IdentityPeopleFields,
  OptionalDetailsFields,
  emptyProjectDraft,
} from "./project-form-fields";
import type { ProjectFormDraft } from "./project-form-fields";
import { IDENTITY_TYPES, REGULATORY_REQUIREMENTS } from "./project-options";
import { expectNoLabelBoundToButton, labelsContainingLabels } from "../test/label-binding";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { controlNames } from "../test/toolbar-order";
import { loadI18n } from "./i18n";

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

describe("manual-contact email field", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("translates the placeholder under German", () => {
    render(<IdentityPeopleFields {...props} lang="de" />);
    expect(screen.getByPlaceholderText("E-Mail")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("email")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Contact persons: identity is the ROW, never the NAME
// ---------------------------------------------------------------------------

const contact = (name: string) => ({ name, email: "", synced: false });

const withContacts = (...names: string[]) => ({
  ...props,
  draft: { ...emptyProjectDraft(), contactPersons: names.map(contact) },
});

// ★★ SCOPE IS NARROWED TO THE CONTACTS LIST, and the named collision that
// forces it is `InfoTooltip`: this section renders THREE of them (project name,
// code, manager) plus the contacts one, every button accessibly named "More
// information". Measured at whole-document scope: `"More information" x3`.
// Two consequences, and the second is the dangerous one — it would leave the
// assertion permanently red, AND it satisfies `requireCollisionSeed` all by
// itself, so a `roles` list or fixture that stopped seeding a contact collision
// would still certify as collision-bearing. That masking is exactly what the
// helper's docstring says a narrowed scope is for.
const contactsList = () => screen.getByRole("list");

describe("contact persons", () => {
  // ★★★ THE DATA DEFECT, and the reason this is not a naming ticket. Removal
  // filtered on `c.name !== cp.name`, so with two contacts sharing a name either
  // ✕ deleted BOTH. Asserting merely that `setDraft` fired would pass against
  // that; the survivor COUNT is what separates "removed one" from "removed both".
  it("removes only the clicked contact when two share a name", async () => {
    const setDraft = vi.fn();
    const user = userEvent.setup();
    const fixture = withContacts("Bob Jones", "Bob Jones");
    render(<IdentityPeopleFields {...fixture} setDraft={setDraft} />);

    const removes = screen.getAllByRole("button", { name: /^Remove/ });
    expect(removes).toHaveLength(2);
    await user.click(removes[0]);

    // The handler is a FUNCTIONAL setter (the bulk-edit landmine), so the next
    // state has to be produced by running the updater against the fixture.
    expect(setDraft).toHaveBeenCalledTimes(1);
    const updater = setDraft.mock.calls[0][0] as (p: ProjectFormDraft) => ProjectFormDraft;
    expect(updater(fixture.draft).contactPersons).toEqual([contact("Bob Jones")]);
  });

  it("gives duplicate contacts distinct accessible names", () => {
    render(<IdentityPeopleFields {...withContacts("Bob Jones", "Bob Jones")} />);
    // minControls MEASURED: the list renders exactly the two ✕ buttons.
    expectRowUniqueNames({
      minControls: 2,
      roles: ["button"],
      scope: contactsList(),
      requireCollisionSeed: true,
    });
  });

  // ★★★ `expectRowUniqueNames` CANNOT SEE THIS CASE, and that is a property of
  // the helper, not of the fixture: `controlNames` reads the raw `aria-label`
  // attribute, so "Remove – Bob  Jones" and "Remove – Bob Jones" are two
  // distinct strings to it and the duplicate scan stays silent whether or not
  // the tokeniser ran. A screen reader collapses whitespace runs, hears one
  // name twice, and that is the 2.4.6 failure. Measured, not reasoned: seeded
  // through that helper this assertion passed against the UNFIXED code.
  //
  // ★ The case is reachable through the form as well as through an import: the
  // add guard `hasName` trims but does not collapse internal runs, so "Bob
  // Jones" and "Bob  Jones" are two different names to it. Exact duplicates
  // arrive via `sanitizeProjectMeta`, which does not dedupe an imported project.
  it("distinguishes contacts that differ only by an internal whitespace run", () => {
    render(<IdentityPeopleFields {...withContacts("Bob  Jones", "Bob Jones")} />);
    const heard = controlNames(["button"], contactsList()).map((n) => n.replace(/\s+/g, " "));
    expect(heard).toHaveLength(2);
    expect(new Set(heard).size).toBe(heard.length);
  });
});
