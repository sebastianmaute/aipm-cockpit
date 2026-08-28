import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { StakeholdersPanel } from "./stakeholders-panel";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { t } from "./i18n";
import type { Stakeholder } from "./types";

// The add/edit modal renders ModalFieldControls, which reads field visibility
// from the workspace, so the panel needs a WorkspaceProvider/FiltersProvider.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

const items: Stakeholder[] = [
  { id: 1, name: "Zoe", category: "Customer", influence: "High", interest: "Low", raci: {} },
  { id: 2, name: "Amy", category: "Internal", influence: "Low", interest: "High", raci: {} },
];

function sampleStakeholder(overrides: Partial<Stakeholder> & { name: string }): Stakeholder {
  return {
    id: 99,
    category: "Customer",
    influence: "Medium",
    interest: "Medium",
    raci: {},
    ...overrides,
  };
}

function setup() {
  const props = {
    lang: "en-US" as const, stakeholders: items, resources: [], milestones: [],
    onSave: vi.fn(), onDelete: vi.fn(),
  };
  render(<StakeholdersPanel {...props} />, { wrapper });
  return props;
}

function renderStakeholders(overrides: { stakeholders: Stakeholder[] }) {
  const props = {
    lang: "en-US" as const, resources: [], milestones: [],
    onSave: vi.fn(), onDelete: vi.fn(),
    ...overrides,
  };
  render(<StakeholdersPanel {...props} />, { wrapper });
  return props;
}

describe("StakeholdersPanel", () => {
  it("renders a row per stakeholder", () => {
    setup();
    expect(screen.getByText("Zoe")).toBeInTheDocument();
    expect(screen.getByText("Amy")).toBeInTheDocument();
  });
  it("opens the add modal", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /add stakeholder/i }));
    expect(screen.getByRole("heading", { name: /add stakeholder/i })).toBeInTheDocument();
  });
  it("level chips carry dark-mode variants for legibility", () => {
    renderStakeholders({ stakeholders: [sampleStakeholder({ name: "Test", influence: "High", interest: "Medium" })] });
    const high = screen.getByText(t("en-US", "levelHigh")).closest("span")!;
    const med = screen.getByText(t("en-US", "levelMedium")).closest("span")!;
    expect(high.className).toContain("dark:");
    expect(med.className).toContain("dark:");
  });
  it("clicking a row opens the editor (RAID-style row click)", () => {
    renderStakeholders({ stakeholders: [sampleStakeholder({ name: "Dana" })] });
    const row = screen.getByRole("button", { name: "Dana" }).closest("tr")!;
    expect(row.className).toContain("cursor-pointer");
    expect(row.className).toContain("hover:bg-surface-muted");
    fireEvent.click(row);
    expect(screen.getByRole("heading", { name: /stakeholder/i })).toBeInTheDocument();
  });

  it("clicking the name button opens editor exactly once (stopPropagation prevents double-fire)", () => {
    renderStakeholders({ stakeholders: [sampleStakeholder({ name: "Dana" })] });
    const btn = screen.getByRole("button", { name: "Dana" });
    fireEvent.click(btn);
    // Editor opens — one modal heading, not two
    expect(screen.getAllByRole("heading", { name: /stakeholder/i })).toHaveLength(1);
  });

  it("threads the comms-pending set to the editor matrix: jump-to-Action-Center icon fires onJumpToComms", () => {
    const onJumpToComms = vi.fn();
    const stakeholder = sampleStakeholder({ id: 42, name: "Dana" });
    render(
      <StakeholdersPanel
        lang="en-US"
        stakeholders={[stakeholder]}
        resources={[]}
        milestones={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        commsPendingStakeholderIds={new Set([42])}
        onJumpToComms={onJumpToComms}
      />,
      { wrapper },
    );
    // Open Dana's editor — the matrix renders her selected cell with the icon.
    fireEvent.click(screen.getByRole("button", { name: "Dana" }));
    const icon = screen.getByRole("button", { name: t("en-US", "stakeholderNeedsComms") });
    fireEvent.click(icon);
    expect(onJumpToComms).toHaveBeenCalledWith(42);
  });
});

describe("Stakeholders inline AI edit", () => {
  it("renders the ✨ Ask-Claude button and fires onAiEdit when aiEditEnabled is true", () => {
    const onAiEdit = vi.fn();
    const stakeholder = sampleStakeholder({ id: 7, name: "Dana" });
    render(
      <StakeholdersPanel
        lang="en-US"
        stakeholders={[stakeholder]}
        resources={[]}
        milestones={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onAiEdit={onAiEdit}
        aiEditEnabled={() => true}
      />,
      { wrapper },
    );
    const btn = screen.getByRole("button", {
      name: `${t("en-US", "inlineAiEdit")} – Dana`,
    });
    fireEvent.click(btn);
    expect(onAiEdit).toHaveBeenCalledWith(stakeholder);
  });

  it("hides the ✨ Ask-Claude button when aiEditEnabled returns false", () => {
    render(
      <StakeholdersPanel
        lang="en-US"
        stakeholders={[sampleStakeholder({ id: 8, name: "Dana" })]}
        resources={[]}
        milestones={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onAiEdit={vi.fn()}
        aiEditEnabled={() => false}
      />,
      { wrapper },
    );
    expect(screen.queryByRole("button", { name: /ask claude/i })).not.toBeInTheDocument();
  });
});

describe("Stakeholders column visibility", () => {
  it("hides the email column (header + cell) when unticked in the column config popover", () => {
    renderStakeholders({ stakeholders: [sampleStakeholder({ name: "Ada", email: "ada@example.com" })] });
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("en-US", "colConfigTitle") }));
    fireEvent.click(screen.getByLabelText(t("en-US", "stakeholderFieldEmail")));

    expect(screen.queryByText("ada@example.com")).not.toBeInTheDocument();
  });
});

describe("Stakeholders bulk edit", () => {
  it("applies a bulk influence change to the selected row via onSave", () => {
    const stakeholder = sampleStakeholder({ id: 1, name: "Dana", influence: "Low" });
    const props = renderStakeholders({ stakeholders: [stakeholder] });

    // select the row
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "selectItem", "Dana") }));
    // open the bulk panel
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkEdit") }));
    // enable Influence + set it to High (the bulk select shares its name with the
    // column-header sort control — disambiguate by the bulk control's id)
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "stakeholderFieldInfluence") }));
    const bulkInfluence = screen
      .getAllByRole("combobox", { name: t("en-US", "stakeholderFieldInfluence") })
      .find((el) => el.id === "bulk-influence")!;
    fireEvent.change(bulkInfluence, { target: { value: "High" } });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkApplyCount", "1") }));

    expect(props.onSave).toHaveBeenCalledTimes(1);
    // Bulk apply passes suppressFieldUndo so the looped save skips per-field
    // undo capture: the panel captures the whole op ITSELF, as one set of
    // {before, after} field patches handed to onCaptureBulk (pinned by the test
    // below). Without the flag every row would also be captured a second time by
    // the save handler.
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, influence: "High" }),
      undefined,
      { suppressFieldUndo: true },
    );
  });

  // The capture is the ONLY input to the bulk undo, and nothing pinned it from a
  // panel. The panel hoists `buildBulkFieldEdits(rows)` above the optional
  // `onCaptureBulk?.(build())` call so the builder runs even unwired. Two ticked
  // fields over THREE rows, each row a different shape of overlap with the pick:
  //   Dana  — both picked values are new            → both keys captured, saved
  //   Eve   — ONE of the two is already at target   → one key captured, saved
  //   Finn  — BOTH are already at target            → no patch at all, NOT saved
  // Eve exercises the per-KEY delta; Finn exercises the per-ROW one, and only
  // Finn can tell the write set apart from the selection. Without that row the panel
  // could save every selected row while capturing only the changed ones and
  // every assertion below would still hold.
  it("captures one patch per row it wrote, and neither captures nor writes a row already at every picked value", () => {
    const onSave = vi.fn<(item: Stakeholder, isNew?: boolean, opts?: { suppressFieldUndo?: boolean }) => void>();
    const onCaptureBulk =
      vi.fn<(edits: readonly { id: number; before: Partial<Stakeholder>; after: Partial<Stakeholder> }[]) => void>();
    const stakeholders = [
      sampleStakeholder({ id: 1, name: "Dana", influence: "Low", interest: "Low" }),
      // Interest is ALREADY High — the pick is a no-op for that one field, so it
      // must stay out of this row's patch while influence still lands in it.
      sampleStakeholder({ id: 2, name: "Eve", influence: "Medium", interest: "High" }),
      // BOTH picked values are already stored, and `category` — the third bulk
      // field — is left unticked, so `patch` copies it through untouched. Finn's
      // `after` is therefore value-identical to his `before` on every key,
      // `buildBulkFieldEdits` drops the row, and the panel must not save it.
      sampleStakeholder({ id: 3, name: "Finn", influence: "High", interest: "High" }),
    ];
    render(
      <StakeholdersPanel
        lang="en-US"
        stakeholders={stakeholders}
        resources={[]}
        milestones={[]}
        onSave={onSave}
        onDelete={vi.fn()}
        onCaptureBulk={onCaptureBulk}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "selectItem", "Dana") }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "selectItem", "Eve") }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "selectItem", "Finn") }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkEdit") }));

    // Tick + set both fields (the bulk selects share their names with the column
    // header sort controls — disambiguate by the bulk control's id).
    for (const [field, id] of [
      ["stakeholderFieldInfluence", "bulk-influence"],
      ["stakeholderFieldInterest", "bulk-interest"],
    ] as const) {
      fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", field) }));
      const control = screen.getAllByRole("combobox", { name: t("en-US", field) }).find((el) => el.id === id)!;
      fireEvent.change(control, { target: { value: "High" } });
    }
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkApplyCount", "3") }));

    expect(onCaptureBulk).toHaveBeenCalledTimes(1);
    const edits = onCaptureBulk.mock.calls[0][0];
    const saved = new Map<number, Stakeholder>(onSave.mock.calls.map(([row]) => [row.id, row] as const));

    // THE WRITE SET IS THE CAPTURED SET — three rows selected, two written.
    // Finn is the row that makes this assertion able to fail: with the panel's
    // `wrote.has(after.id)` guard removed that row is saved but not captured, so it
    // appears on the left of this equality and not on the right. `Stakeholder`
    // carries neither `noteLog` nor `outlookEventId`, so no `WRITE_THROUGH_KEYS`
    // exclusion in `buildBulkFieldEdits` can drop a key here and manufacture an
    // empty patch for a row that really did change.
    expect([...saved.keys()].sort()).toEqual([1, 2]);
    expect(edits.map((e) => e.id).sort()).toEqual([1, 2]);
    expect(saved.has(3)).toBe(false);
    expect(edits.some((e) => e.id === 3)).toBe(false);

    // `after` is what the save actually wrote — every captured key, every row.
    for (const e of edits) {
      const row = saved.get(e.id)!;
      for (const [key, value] of Object.entries(e.after)) {
        expect(value).toEqual(row[key as keyof Stakeholder]);
      }
    }

    const dana = edits.find((e) => e.id === 1)!;
    expect(Object.keys(dana.before).sort()).toEqual(["influence", "interest"]);
    expect(dana.before).toEqual({ influence: "Low", interest: "Low" });
    expect(dana.after).toEqual({ influence: "High", interest: "High" });

    const eve = edits.find((e) => e.id === 2)!;
    // Interest was already High, so it is absent here — the patch is the delta,
    // not the row. A whole-row capture would carry name/category/raci as well.
    expect(Object.keys(eve.before)).toEqual(["influence"]);
    expect(eve.before).toEqual({ influence: "Medium" });
    expect(eve.after).toEqual({ influence: "High" });

    // STATEMENT ORDER ONLY, and it is NOT what makes the payload correct.
    // `rows` — both halves of every {before, after} — is materialised before
    // either step, so moving the capture below the loop would leave the payload
    // above byte-identical. (The panel used to carry a "Capture BEFORE the
    // saves" comment claiming otherwise; it was retired with the fix above.)
    // What the loop DOES depend on is `edits`, and that dependency is pinned by
    // the Finn assertions, not by this line.
    expect(onCaptureBulk.mock.invocationCallOrder[0]).toBeLessThan(onSave.mock.invocationCallOrder[0]);
  });
});

describe("Stakeholders sortable headers", () => {
  // axe has NO rule for a missing or wrong aria-sort, in any view at any seed
  // size, so this test is the only detector this panel will ever have.
  //
  // The ANCHORED button name is the load-bearing half: before the conversion
  // the sort glyph sat INSIDE the accessible name, so an unanchored /organization/i
  // would match either way and the test would pass against the defect.
  it("announces sort state through aria-sort across the full asc/desc/none cycle", () => {
    renderStakeholders({ stakeholders: items });
    const header = () => screen.getByRole("columnheader", { name: /organization/i });
    const button = () => screen.getByRole("button", { name: /^organization$/i });

    expect(header()).toHaveAttribute("aria-sort", "none");
    fireEvent.click(button());
    expect(header()).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(button());
    expect(header()).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(button());
    expect(header()).toHaveAttribute("aria-sort", "none");
  });

  // The explicit <StakeholderSortKey> generic on useSortHeaderProps stops a
  // GARBAGE sortCol, but it cannot stop one REAL column's key pasted onto another
  // header: every key is still a valid StakeholderSortKey, `npx tsc --noEmit`
  // exits 0, that column silently missorts, and no gate in this repo can see it.
  //
  // The detector falls out of the primitive's own `active` rule
  // (`sortKey === sortCol && sortDir !== "off"`): two headers sharing one sortCol
  // both light up on a single click. So after clicking a column, EXACTLY one
  // header may report a non-"none" aria-sort, and it must be that column's own.
  // The count alone would miss a paste onto a HIDDEN column; the identity alone
  // would miss the duplicate — both halves are needed.
  //
  // ★ KNOWN LIMIT: this catches a PASTE (which leaves a duplicate), not a full
  //   EXCHANGE of two headers' keys. An exchange leaves no duplicate, so exactly
  //   one header still lights up and it is still the one the label lookup finds.
  it("wires each sortable header to its own column, not a neighbour's", () => {
    renderStakeholders({ stakeholders: items });
    // Scoped to the header ROW, not the table: this panel renders each row's name
    // as a BUTTON, so an unscoped lookup could resolve a column label to a row.
    const headerRow = screen
      .getByRole("button", { name: t("en-US", "stakeholderFieldName") })
      .closest("tr") as HTMLElement;
    const sorted = () =>
      Array.from(headerRow.querySelectorAll("th")).filter(
        (th) => (th.getAttribute("aria-sort") ?? "none") !== "none",
      );
    // Matched by BUTTON, then up to the <th>. Matching a <th> by name would break
    // on `influence` and `interest`, whose InfoTooltip text is absorbed into the
    // header's own accessible name.
    const headerFor = (label: string) =>
      within(headerRow).getByRole("button", { name: label }).closest("th");

    // A string `name` is an EXACT match, so each lookup also pins that column's
    // i18n label key — a header wired to the wrong string fails here too, which
    // nothing else in this suite checks.
    const columns = [
      ["name", t("en-US", "stakeholderFieldName")],
      ["organization", t("en-US", "stakeholderFieldOrganization")],
      ["category", t("en-US", "stakeholderFieldCategory")],
      ["influence", t("en-US", "stakeholderFieldInfluence")],
      ["interest", t("en-US", "stakeholderFieldInterest")],
    ] as const;

    // Positive observable: all five render, and none claims a sort yet.
    for (const [, label] of columns) expect(headerFor(label)).toHaveAttribute("aria-sort", "none");
    expect(sorted()).toHaveLength(0);

    for (const [key, label] of columns) {
      // toggleSort cycles asc → desc → null, but it resets to "asc" whenever the
      // KEY changes, so one pass over five distinct columns never re-enters it.
      fireEvent.click(within(headerRow).getByRole("button", { name: label }));
      // Re-queried AFTER the click. Comparing against a node captured before it
      // could be comparing against something detached, which would make the
      // identity half unfalsifiable.
      const own = headerFor(label);
      expect(sorted(), `clicking ${key} lit up the wrong number of headers`).toHaveLength(1);
      expect(sorted()[0], `clicking ${key} sorted a different column`).toBe(own);
      expect(own).toHaveAttribute("aria-sort", "ascending");
    }
  });
});

// --- row-unique names (WCAG 2.4.6, §247/§248) ------------------------------

describe("row-unique names", () => {
  // Two rows sharing a name — the checkbox / name button / Ask-Claude button
  // all key on item.name, so without a per-row token every one of them would
  // render twice with the identical accessible name. renderStakeholders
  // cannot exercise the Ask-Claude button (gated on onAiEdit/aiEditEnabled),
  // so this renders inline with those wired, rather than growing the shared
  // helper with parameters no other caller needs.
  //
  // Whole-document scope (no `scope` passed): the `stakeholderFieldName`
  // translation now names exactly ONE control in this panel — it named three
  // until §261 — and no crutch is holding anything apart any more.
  //   - PaneSearchInput used to carry this same translation as its
  //     `aria-label`, and was excluded only because `roles` below is
  //     ["button", "checkbox"] while `<input type="search">` computes to role
  //     `searchbox`. That crutch is GONE: §261 moved the search box to
  //     `stakeholderFilterName`, so it no longer shares the name at all.
  //     Pinned by "gives the name filter and its sort header distinct names"
  //     at the bottom of this file, which scans across `searchbox` too —
  //     precisely because this `roles` list cannot see it.
  //   - The Name column's SortResizeTh renders a sort `button` labelled
  //     "Name" — a real `button`, IN `roles`, but it is the only one, so it
  //     never collides with itself.
  //   - ColumnConfigPopover's per-column checklist (STAKEHOLDER_CONFIG_COLS)
  //     renders a `<Checkbox>` for the "name" column — a `checkbox`, also IN
  //     `roles`. It USED to read a bare "Name" from its wrapping <label> and
  //     would have collided with the sort button's "Name" if both were mounted;
  //     that crutch is GONE. The popover still defaults closed
  //     (`PopoverPanel` returns `null`), so this test does not mount it — but
  //     the collision behind it is closed at the source: the toggle now carries
  //     `aria-label={t(lang, "colConfigToggleColumn", …)}`, so it reads "Show
  //     column – Name". Pinned by "gives the name filter and its sort header
  //     distinct names" at the bottom of this file, which DOES open the popover.
  it("keeps every per-row control distinct when two rows share a name", () => {
    const stakeholders = [
      sampleStakeholder({ id: 1, name: "Dana" }),
      sampleStakeholder({ id: 2, name: "Dana" }),
    ];
    render(
      <StakeholdersPanel
        lang="en-US"
        stakeholders={stakeholders}
        resources={[]}
        milestones={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onAiEdit={vi.fn()}
        aiEditEnabled={() => true}
      />,
      { wrapper },
    );
    expectRowUniqueNames({
      minControls: 21,
      roles: ["button", "checkbox"],
      requireCollisionSeed: true,
    });
  });
});

// §261. The toolbar's search box used to read the SAME translation as the
// sortable Name column header ("stakeholderFieldName"), so that one name was
// carried by two controls with genuinely different purposes — filtering the
// register vs. sorting it (WCAG 2.4.6).
// ★ This pair is a different ROLE variant from the other §261 fixes: the
// filter is `PaneSearchInput`'s `<input type="search">`, which computes to
// role `searchbox`, not a `<select>` combobox. A `roles` list omitting
// "searchbox" is structurally incapable of seeing it — which is exactly why
// the "row-unique names" test above could never have caught this.
// ★★★ axe has no rule that flags two controls sharing an accessible name, in
// any view at any seed size, so this unit test is the only detector that can
// exist for it.
describe("StakeholdersPanel — toolbar search vs. Name column header (§261)", () => {
  it("gives the name filter and its sort header distinct names", () => {
    renderStakeholders({ stakeholders: items });

    // Typing is load-bearing, not incidental: `ClearableSearchInput` overlays
    // its ✕ only while the field is non-empty, so an untouched fixture never
    // mounts the clear button and the `clearLabel` half of this fix would go
    // uncovered. "Amy" matches one of the two seeded rows.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Amy" } });

    // Opening the column-config popover is load-bearing, not incidental: its
    // "name" checkbox is the THIRD control carrying `stakeholderFieldName`, and
    // `PopoverPanel` returns null while closed — so a test that left it shut
    // would assert over two thirds of the collision and pass.
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "colConfigTitle") }));

    // Un-narrowed roles and whole-document scope on purpose: this collision is
    // cross-ROLE (searchbox vs. button vs. checkbox), and "searchbox" is the leg
    // every other test in this file deliberately excludes.
    expectRowUniqueNames({
      // MEASURED against this fixture AFTER the "Amy" filter and WITH THE
      // POPOVER OPEN, not guessed and not scaled from the closed-popover
      // figure: 1 searchbox + 16 buttons + 10 checkboxes. The 8 extra
      // checkboxes are STAKEHOLDER_CONFIG_COLS' toggles. `minControls` only
      // proves the scope is non-empty, so it is pinned to the exact count — a
      // loose floor would silently re-admit a narrowed `roles` list (dropping
      // "searchbox" is precisely the narrowing that hid this defect), or a
      // popover that stopped opening.
      minControls: 27,
      roles: ["searchbox", "button", "checkbox"],
    });

    // Anti-vacuity: name each side of the former collision positively, so a
    // "fix" that merely deleted a label could not pass. The clear ✕ the atom
    // overlays inside the field is qualified with the same key, so it is named
    // here too — fixing only the input would leave the ✕ naming the column.
    expect(screen.getByRole("searchbox", { name: t("en-US", "stakeholderFilterName") })).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: `${t("en-US", "clear")} – ${t("en-US", "stakeholderFilterName")}`,
      }),
    ).toBeTruthy();
    // The COLUMN keeps its own name — the filter moved, the header did not.
    // The sort glyph is `aria-hidden`, so the accessible name is the bare label.
    expect(screen.getByRole("button", { name: t("en-US", "stakeholderFieldName") })).toBeTruthy();
    // ...and the column-config toggle names its own action, so the third control
    // carrying `stakeholderFieldName` no longer reads as the column itself.
    expect(
      screen.getByRole("checkbox", {
        name: t("en-US", "colConfigToggleColumn", t("en-US", "stakeholderFieldName")),
      }),
    ).toBeTruthy();
  });

  // ★ THE THIRD LEG IS NOW COVERED, IN THE TEST ABOVE. It used to be deferred:
  // the column-config checkboxes took their accessible name from their wrapping
  // <label>'s text alone, so the one for the "name" column also read "Name" and
  // collided with the sort header. `column-config-popover.tsx` now sets
  // `aria-label={t(lang, "colConfigToggleColumn", t(lang, labelKey))}`, so the
  // test opens the popover with the "colConfigTitle" gear button, scans all 8
  // toggles, and names that one positively.
  // ★★ That aria-label is ALSO what makes those checkboxes VISIBLE to this
  // assertion at all: `controlNames` (`src/test/toolbar-order.ts`) reads
  // `aria-label || textContent`, NOT the real accessible name, and an <input>
  // has no textContent — so before the fix all 8 reported "" and opening the
  // popover would have failed on a spurious `"" x8` duplicate that has nothing
  // to do with §261.
  // ★★ THE TWO HALVES WERE MUTATION-PROVED SEPARATELY, because the first MASKS
  // the second rather than firing alongside it. Deleting the aria-label outright
  // fails on that `"" x8` duplicate — `expectRowUniqueNames` throws before the
  // `getByRole` lookup below is ever reached. Passing the raw column KEY
  // instead of its translation gives distinct, non-empty names, so the scan
  // passes and the test fails on the lookup instead. Only the second mutant
  // proves the §261-specific half; keep both in mind before trusting a red here.
});
