import { fireEvent, render, screen, within } from "@testing-library/react";
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
import { loadI18n, t } from "./i18n";

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

  it("names a tooltipped field's control with its label alone (open-followups §386)", () => {
    render(<IdentityPeopleFields {...props} />);

    // Whole-string match. With the tooltip inside the binding <label> the
    // trigger's text joined the control's name, so this found nothing.
    expect(screen.getByRole("textbox", { name: t("en-US", "projectCode") })).toBeInTheDocument();
    // The hint is still reachable, through its own focusable trigger, which is
    // named by the hint itself (§7 A1 — the shared `Field`).
    expect(screen.getByRole("button", { name: t("en-US", "tipProjectCode") })).toBeInTheDocument();
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

// ★★ The email DEFAULTS to blank, and for a long while every fixture in this
// file took that default — which made the whole `cp.email ? …` branch of
// `contactDisplay` unreachable, so a change to it was green by construction.
// Pass a real address whenever the assertion is about the token's INPUT.
const contact = (name: string, email = "", id = 1) => ({ id, name, email, synced: false });

// ★ `names.map((n) => contact(n))`, never `names.map(contact)` — the bare
// reference hands `map`'s INDEX to the email parameter.
const withContacts = (...names: string[]) => ({
  ...props,
  draft: { ...emptyProjectDraft(), contactPersons: names.map((n, i) => contact(n, "", i + 1)) },
});

/** Contacts with explicit addresses, for the cases about the token's INPUT. */
const withContactPeople = (...people: { name: string; email?: string }[]) => ({
  ...props,
  draft: {
    ...emptyProjectDraft(),
    contactPersons: people.map((p, i) => contact(p.name, p.email ?? "", i + 1)),
  },
});

// The contacts list, for the per-row name checks below. The row-uniqueness scan
// itself runs at whole-container scope, the default: it was narrowed to this list
// while three tooltip triggers in the section shared the name "More information",
// and the shared `Field` (§7 A1) now names each trigger by its own hint, so
// nothing outside the list collides. Re-narrow only for a NEW confirmed collision,
// named here (see SCOPE CHOICE in src/test/row-unique-names.ts).
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
    // §537 — by id: the SECOND contact (id 2) is the one left.
    expect(updater(fixture.draft).contactPersons).toEqual([contact("Bob Jones", "", 2)]);
  });

  it("gives duplicate contacts distinct accessible names", () => {
    render(<IdentityPeopleFields {...withContacts("Bob Jones", "Bob Jones")} />);
    // minControls MEASURED: two rows × (Edit, ✕) — §537 added the Edit control,
    //  and it must be row-unique too.
    expectRowUniqueNames({
      minControls: 4,
      roles: ["button"],
      requireCollisionSeed: true,
    });

    // ★ Anti-vacuity, and the mutant it kills is the realistic one: the scan
    // proves only that the two names DIFFER, so it passes against a "fix" that
    // replaced the label with any unique nonsense (`aria-label={String(idx)}`) —
    // the exact shape that resolves a collision by destroying the name. Assert
    // that each name still carries the contact's own display string, and the
    // action verb with it.
    const names = within(contactsList())
      .getAllByRole("button", { name: /^Remove/ })
      .map((b) => b.getAttribute("aria-label") ?? "");
    expect(names).toHaveLength(2);
    for (const n of names) {
      expect(n).toContain("Bob Jones");
      expect(n).toContain(t("en-US", "remove"));
    }
  });

  // ★★★ THESE TWO PIN THE CONDITIONAL, AND NEITHER IS REACHABLE FROM THE
  // DEFAULT FIXTURE — the `contact` helper above says why. The pair is what
  // makes the "only where it buys something" rule a claim a test can falsify:
  // the first fails if the email stops reaching a colliding row, the second
  // fails if it reaches a row that does not need it.
  it("discriminates same-named contacts by address instead of an occurrence index", () => {
    render(
      <IdentityPeopleFields
        {...withContactPeople(
          { name: "Bob Jones", email: "bob@north.example" },
          { name: "Bob Jones", email: "bob@south.example" },
        )}
      />,
    );
    const names = within(contactsList())
      .getAllByRole("button", { name: /^Remove/ })
      .map((b) => b.getAttribute("aria-label") ?? "");
    expect(names).toHaveLength(2);
    expect(names[0]).toContain("bob@north.example");
    expect(names[1]).toContain("bob@south.example");
    // The address IS the discriminator here, so no row is numbered.
    for (const n of names) expect(n).not.toMatch(/\(\d+\)$/);
  });

  it("leaves a contact whose name is already unique bare, address and all", () => {
    render(
      <IdentityPeopleFields
        {...withContactPeople(
          { name: "David Okoro", email: "liam.okoro@northwind.example" },
          { name: "Sofia Ramirez", email: "sofia.ramirez@example.com" },
        )}
      />,
    );
    const names = within(contactsList())
      .getAllByRole("button", { name: /^Remove/ })
      .map((b) => b.getAttribute("aria-label") ?? "");
    expect(names).toHaveLength(2);
    // ★ The cost this asserts the ABSENCE of is what the first cut charged every
    // AT user on every row: "Remove – David Okoro" is 20 characters, and with the
    // address unconditionally appended it was 52.
    for (const n of names) {
      expect(n).not.toContain("@");
      expect(n).not.toMatch(/\(\d+\)$/);
    }
    expect(names[0]).toContain("David Okoro");
    expect(names[1]).toContain("Sofia Ramirez");
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
    expect(heard).toHaveLength(4); // two rows × (Edit, ✕), §537
    expect(new Set(heard).size).toBe(heard.length);
  });
});

describe("contact person add follows the email write rule", () => {
  it("refuses an add with a typed unsafe email, keeps the draft and shows the error", async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn();
    render(<IdentityPeopleFields {...props} setDraft={setDraft} />);
    await user.type(screen.getByRole("combobox", { name: t("en-US", "contactAddManual") }), "Bob Jones");
    const email = screen.getByRole("textbox", { name: `${t("en-US", "contactAddManual")} — ${t("en-US", "email")}` });
    await user.type(email, "a,b@x.com");
    await user.click(screen.getByRole("button", { name: t("en-US", "add") }));
    expect(setDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(t("en-US", "errorEmailDelimiter"));
    expect(email).toHaveValue("a,b@x.com");
  });

  it("adds with a copied unsafe email picked from the address book", async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn();
    render(<IdentityPeopleFields {...props} setDraft={setDraft} addressBook={[{ name: "Bob Jones", email: "a,b@x.com" }] as never} />);
    await user.type(screen.getByRole("combobox", { name: t("en-US", "contactAddManual") }), "Bob");
    await user.click(await screen.findByText("Bob Jones"));
    await user.click(screen.getByRole("button", { name: t("en-US", "add") }));
    expect(setDraft).toHaveBeenCalledTimes(1);
  });

  // Fix round 1, IMPORTANT 3 — the copy-source exemption was unpinned for the
  // REGISTRY-resource source specifically (only the address book was tested).
  it("adds with a copied unsafe email picked from a registry resource", async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn();
    const linked = {
      id: 5, firstName: "Bob", lastName: "Jones", email: "a,b@x.com",
      roleId: null, utilizationMode: "percent" as const, utilization: {},
    };
    render(<IdentityPeopleFields {...props} setDraft={setDraft} resources={[linked]} />);
    await user.type(screen.getByRole("combobox", { name: t("en-US", "contactAddManual") }), "Bob");
    await user.click(await screen.findByText("Bob Jones"));
    await user.click(screen.getByRole("button", { name: t("en-US", "add") }));
    expect(setDraft).toHaveBeenCalledTimes(1);
  });

  // Fix round 2 ruling — judge (and store) the value that would be STORED:
  // `sanitizeContactPerson` caps email at EMAIL_MAX via `sanitizeEmail`, same
  // as every other editor. A >EMAIL_MAX value whose unsafe suffix falls past
  // the cap is added with the SAFE, capped address.
  it("adds a >EMAIL_MAX email capped to a safe value, not the raw typed one", async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn();
    render(<IdentityPeopleFields {...props} setDraft={setDraft} />);
    await user.type(screen.getByRole("combobox", { name: t("en-US", "contactAddManual") }), "Bob Jones");
    const email = screen.getByRole("textbox", { name: `${t("en-US", "contactAddManual")} — ${t("en-US", "email")}` });
    // 314 + "@x.com" (6) = 320 = EMAIL_MAX; the ",evil@evil.com" suffix is
    // entirely past the cap and never reaches the write rule.
    const value = "a".repeat(314) + "@x.com" + ",evil@evil.com";
    fireEvent.change(email, { target: { value } });
    await user.click(screen.getByRole("button", { name: t("en-US", "add") }));
    expect(setDraft).toHaveBeenCalledTimes(1);
    const updater = setDraft.mock.calls[0][0] as (p: ProjectFormDraft) => ProjectFormDraft;
    const result = updater(props.draft).contactPersons;
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe("a".repeat(314) + "@x.com");
  });

  // M-C4 — the add stores the `Name <addr>`-unwrapped address, as every load
  //  (`sanitizeContactPerson`) does, and judges that same value.
  it("M-C4: adds a typed Name <addr> email as addr", async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn();
    render(<IdentityPeopleFields {...props} setDraft={setDraft} />);
    await user.type(screen.getByRole("combobox", { name: t("en-US", "contactAddManual") }), "Bob Jones");
    const email = screen.getByRole("textbox", { name: `${t("en-US", "contactAddManual")} — ${t("en-US", "email")}` });
    fireEvent.change(email, { target: { value: "Bob Jones <bob@x.com>" } });
    await user.click(screen.getByRole("button", { name: t("en-US", "add") }));
    expect(setDraft).toHaveBeenCalledTimes(1);
    const updater = setDraft.mock.calls[0][0] as (p: ProjectFormDraft) => ProjectFormDraft;
    expect(updater(props.draft).contactPersons[0].email).toBe("bob@x.com");
  });
});

// §537 — a contact can be corrected IN PLACE (it used to take remove + re-add),
//  addressed by its id, and the email keeps the add path's write rule.
describe("contact person in-place edit (§537)", () => {
  async function openEdit(user: ReturnType<typeof userEvent.setup>, setDraft = vi.fn()) {
    const fixture = withContactPeople({ name: "Ann Lee", email: "ann@x.com" }, { name: "Bob Jones", email: "bob@x.com" });
    render(<IdentityPeopleFields {...fixture} setDraft={setDraft} />);
    await user.click(screen.getByRole("button", { name: `${t("en-US", "edit")} – Bob Jones` }));
    return { fixture, setDraft };
  }

  it("saves a corrected name and email onto the SAME contact, keeping its id", async () => {
    const user = userEvent.setup();
    const { fixture, setDraft } = await openEdit(user);
    const name = screen.getByRole("textbox", { name: `${t("en-US", "name")} – Bob Jones` });
    const email = screen.getByRole("textbox", { name: `${t("en-US", "email")} – Bob Jones` });
    await user.clear(name);
    await user.type(name, "Robert Jones");
    await user.clear(email);
    await user.type(email, "robert@x.com");
    await user.click(screen.getByRole("button", { name: t("en-US", "contactEditSave") }));
    const updater = setDraft.mock.calls[0][0] as (p: ProjectFormDraft) => ProjectFormDraft;
    expect(updater(fixture.draft).contactPersons).toEqual([
      contact("Ann Lee", "ann@x.com", 1),
      contact("Robert Jones", "robert@x.com", 2),
    ]);
  });

  it("refuses a name another contact already has, and an unsafe typed email", async () => {
    const user = userEvent.setup();
    const { setDraft } = await openEdit(user);
    const name = screen.getByRole("textbox", { name: `${t("en-US", "name")} – Bob Jones` });
    await user.clear(name);
    await user.type(name, "ann lee");
    await user.click(screen.getByRole("button", { name: t("en-US", "contactEditSave") }));
    expect(setDraft).not.toHaveBeenCalled();
    await user.clear(name);
    await user.type(name, "Bob Jones");
    const email = screen.getByRole("textbox", { name: `${t("en-US", "email")} – Bob Jones` });
    await user.clear(email);
    await user.type(email, "a,b@x.com");
    await user.click(screen.getByRole("button", { name: t("en-US", "contactEditSave") }));
    expect(setDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(t("en-US", "errorEmailDelimiter"));
  });

  it("cancel leaves the contact untouched", async () => {
    const user = userEvent.setup();
    const { setDraft } = await openEdit(user);
    await user.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    expect(setDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: `${t("en-US", "edit")} – Bob Jones` })).toBeInTheDocument();
  });
});
