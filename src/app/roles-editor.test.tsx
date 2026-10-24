import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { RolesEditor, ROLES_COL_WIDTHS, rateFieldDisplay } from "./roles-editor";
import { t } from "./i18n";
import { INNER_TABLE_CLASS } from "./view-styles";
import type { Discipline, Grade, Role } from "./types";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { buttonClassFor } from "../test/button-variant";

const noop = () => {};
const disciplines: Discipline[] = [{ id: 1, name: "Engineering" }];
const grades: Grade[] = [{ id: 1, name: "Senior" }];
const roles: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 }];

function renderEditor(currency = "EUR", roleList: Role[] = roles) {
  return render(
    <RolesEditor
      lang="en-US"
      currency={currency}
      workdayHours={8}
      roles={roleList}
      disciplines={disciplines}
      grades={grades}
      onSaveRole={noop}
      onDeleteRole={noop}
      onResolveOrCreateRole={() => 0}
      onAddDiscipline={() => 0}
      onRenameDiscipline={noop}
      onDeleteDiscipline={noop}
      onReorderDisciplines={noop}
      onReorderRoles={noop}
      onAddGrade={() => 0}
      onRenameGrade={noop}
      onDeleteGrade={noop}
      onReorderGrades={noop}
    />,
  );
}

// ★ TWO rows minimum. A row-unique-name test cannot render a collision on a
// one-row fixture, so it would pass on broken code.
function renderTwoRoles(onReorderRoles: (ids: number[]) => void = noop) {
  return render(
    <RolesEditor
      lang="en-US" currency="EUR" workdayHours={8}
      roles={[
        { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 },
        { id: 2, disciplineId: 2, gradeId: 2, internalRate: 50, externalRate: 90 },
      ]}
      disciplines={[{ id: 1, name: "Engineering" }, { id: 2, name: "Design" }]}
      grades={[{ id: 1, name: "Senior" }, { id: 2, name: "Junior" }]}
      onSaveRole={noop} onDeleteRole={noop} onResolveOrCreateRole={() => 0} onReorderRoles={onReorderRoles}
      onAddDiscipline={() => 0} onRenameDiscipline={noop} onDeleteDiscipline={noop} onReorderDisciplines={noop}
      onAddGrade={() => 0} onRenameGrade={noop} onDeleteGrade={noop} onReorderGrades={noop}
    />,
  );
}

/** The reorder grip inside a given rate-card row — the ONLY drag source and the
 *  only keyboard reorder entry point (see the H1 test below). */
const handleIn = (row: HTMLElement) => within(row).getByRole("button", { name: /reorder/i });

describe("RolesEditor rate-card table", () => {
  it("renders rate-card rows in the manual `order` sequence when unsorted, and fires onReorderRoles on drop", () => {
    const orderedRoles: Role[] = [
      { id: 1, disciplineId: 1, gradeId: 1, internalRate: 10, externalRate: 20, order: 2 },
      { id: 2, disciplineId: 1, gradeId: 2, internalRate: 10, externalRate: 20, order: 0 },
      { id: 3, disciplineId: 2, gradeId: 1, internalRate: 10, externalRate: 20, order: 1 },
    ];
    const onReorderRoles = vi.fn();
    render(
      <RolesEditor
        lang="en-US" currency="EUR" workdayHours={8}
        roles={orderedRoles}
        disciplines={[{ id: 1, name: "Eng" }, { id: 2, name: "Ops" }]}
        grades={[{ id: 1, name: "Senior" }, { id: 2, name: "Junior" }]}
        onSaveRole={noop} onDeleteRole={noop} onResolveOrCreateRole={() => 0}
        onReorderRoles={onReorderRoles}
        onAddDiscipline={() => 0} onRenameDiscipline={noop} onDeleteDiscipline={noop} onReorderDisciplines={noop}
        onAddGrade={() => 0} onRenameGrade={noop} onDeleteGrade={noop} onReorderGrades={noop}
      />,
    );
    // order 0,1,2 → role ids 2,3,1 → first data cell text sequence.
    const bodyRows = screen.getAllByRole("row").slice(1, 4); // 3 rate-card rows
    expect(bodyRows[0].textContent).toContain("Eng"); // role 2: Eng/Junior
    expect(bodyRows[1].textContent).toContain("Ops"); // role 3: Ops/Senior
    // Drag role id 1 (last) onto the first row → onReorderRoles gets a new id order.
    // The drag starts on the row's grip (the row itself is the DROP
    // target only — see the arrow-key test at the bottom of this file).
    const dt = { effectAllowed: "", getData: () => "", setData: () => {} };
    fireEvent.dragStart(handleIn(bodyRows[2]), { dataTransfer: dt });
    fireEvent.drop(bodyRows[0], { dataTransfer: dt });
    expect(onReorderRoles).toHaveBeenCalledTimes(1);
    // Ids in view order are [2,3,1]; dragging id 1 UPWARD onto id 2 lands it in
    // id 2's slot → [1,2,3]. Upward drags are unaffected by the move to the
    // shared `reorderIds` splice; a DOWNWARD drag now lands the item in the
    // target's slot instead of before it (see list-reorder.ts).
    expect(onReorderRoles.mock.calls[0][0]).toEqual([1, 2, 3]);
  });

  it("shows the project currency symbol next to the rate fields, not a hard-coded €", () => {
    const eur = renderEditor("EUR");
    expect(eur.container.textContent).toContain("€");
    eur.unmount();
    const usd = renderEditor("USD");
    expect(usd.container.textContent).toContain("$");
    expect(usd.container.textContent).not.toContain("€");
  });

  it("renders no reset-column-widths button (rate-card columns are not resizable)", () => {
    renderEditor();
    expect(
      screen.queryByRole("button", { name: t("en-US", "colResetWidthsHint") }),
    ).toBeNull();
  });

  it("wraps the rate-card table in the shared inner-table scroll card", () => {
    renderEditor();
    const table = screen.getByRole("table");
    const wrapper = table.parentElement;
    // Same scroll-card chrome the directory/workload tables use.
    expect(wrapper?.className).toContain(INNER_TABLE_CLASS);
  });

  it("uses px-3 py-2 cell padding like the directory/workload tables", () => {
    renderEditor();
    const cell = screen.getAllByText("Engineering").map((el) => el.closest("td")).find(Boolean);
    expect(cell?.className).toContain("px-3");
    expect(cell?.className).toContain("py-2");
  });

  it("renders InfoTooltip triggers on column headers (accessible by hint text)", () => {
    renderEditor();
    expect(screen.getByRole("button", { name: t("en-US", "rolesDisciplineHint") })).toBeInTheDocument();
  });

  it("A3: renders a € prefix symbol next to each rate input", () => {
    renderEditor();
    const euros = screen.getAllByText("€");
    // Now four rate inputs (internal/external × hour/day), each with a € prefix.
    expect(euros.length).toBeGreaterThanOrEqual(4);
  });

  it("T13: default hour basis — /h editable, /d read-only, editing /h materializes both units", () => {
    const onSaveRole = vi.fn();
    render(
      <RolesEditor
        lang="en-US" currency="EUR" workdayHours={8}
        roles={[{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 }]}
        disciplines={disciplines} grades={grades}
        onSaveRole={onSaveRole} onDeleteRole={noop} onResolveOrCreateRole={() => 0} onReorderRoles={noop}
        onAddDiscipline={() => 0} onRenameDiscipline={noop} onDeleteDiscipline={noop} onReorderDisciplines={noop}
        onAddGrade={() => 0} onRenameGrade={noop} onDeleteGrade={noop} onReorderGrades={noop}
      />,
    );
    const hourInput = screen.getByRole("spinbutton", { name: /Engineering \/ Senior — Internal \/h/ });
    const dayInput = screen.getByRole("spinbutton", { name: /Engineering \/ Senior — Internal \/d/ });
    expect(hourInput).not.toHaveAttribute("readonly");
    expect(dayInput).toHaveAttribute("readonly");
    // Read-only /d shows derived value 100 * 8 = 800.
    expect((dayInput as HTMLInputElement).value).toBe("800");
    fireEvent.change(hourInput, { target: { value: "120" } });
    expect(onSaveRole).toHaveBeenCalledTimes(1);
    const saved = onSaveRole.mock.calls[0][0] as Role;
    expect(saved.internalRate).toBe(120);
    expect(saved.internalRateDay).toBe(960); // 120 * 8
    expect(saved.rateBasis).toBe("hour");
  });

  it("T13: day basis — /d editable, /h read-only & derived; clearing /d flips to hour", () => {
    const onSaveRole = vi.fn();
    render(
      <RolesEditor
        lang="en-US" currency="EUR" workdayHours={8}
        roles={[{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200, internalRateDay: 800, externalRateDay: 1600, rateBasis: "day" }]}
        disciplines={disciplines} grades={grades}
        onSaveRole={onSaveRole} onDeleteRole={noop} onResolveOrCreateRole={() => 0} onReorderRoles={noop}
        onAddDiscipline={() => 0} onRenameDiscipline={noop} onDeleteDiscipline={noop} onReorderDisciplines={noop}
        onAddGrade={() => 0} onRenameGrade={noop} onDeleteGrade={noop} onReorderGrades={noop}
      />,
    );
    const hourInput = screen.getByRole("spinbutton", { name: /Engineering \/ Senior — Internal \/h/ });
    const dayInput = screen.getByRole("spinbutton", { name: /Engineering \/ Senior — Internal \/d/ });
    expect(dayInput).not.toHaveAttribute("readonly");
    expect(hourInput).toHaveAttribute("readonly");
    // Editing /d re-derives /h.
    fireEvent.change(dayInput, { target: { value: "400" } });
    let saved = onSaveRole.mock.calls[0][0] as Role;
    expect(saved.internalRateDay).toBe(400);
    expect(saved.internalRate).toBe(50); // 400 / 8
    expect(saved.rateBasis).toBe("day");
    // Clearing the editable /d flips the row back to hour basis.
    fireEvent.change(dayInput, { target: { value: "" } });
    saved = onSaveRole.mock.calls[1][0] as Role;
    expect(saved.rateBasis).toBe("hour");
  });

  function renderOneRole(onSaveRole: (role: Role) => void, role: Role, workdayHours = 8) {
    return render(
      <RolesEditor
        lang="en-US" currency="EUR" workdayHours={workdayHours}
        roles={[role]}
        disciplines={disciplines} grades={grades}
        onSaveRole={onSaveRole} onDeleteRole={noop} onResolveOrCreateRole={() => 0} onReorderRoles={noop}
        onAddDiscipline={() => 0} onRenameDiscipline={noop} onDeleteDiscipline={noop} onReorderDisciplines={noop}
        onAddGrade={() => 0} onRenameGrade={noop} onDeleteGrade={noop} onReorderGrades={noop}
      />,
    );
    // Row-qualified radio accessible names (WCAG 2.4.6): "Engineering / Senior — Hours/Days".
  }

  it("Hours/Days switch flips the writable unit, pinning the derived day rates", () => {
    const onSaveRole = vi.fn();
    renderOneRole(onSaveRole, { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 });
    // Default hour basis: the "Hours" radio is checked.
    expect(screen.getByRole("radio", { name: /— Hours$/ })).toHaveAttribute("aria-checked", "true");
    // Switch to Days → row becomes day-basis, day rates pinned from the derived
    // values (100 * 8 = 800 internal, 200 * 8 = 1600 external).
    fireEvent.click(screen.getByRole("radio", { name: /— Days$/ }));
    expect(onSaveRole).toHaveBeenCalledTimes(1);
    const saved = onSaveRole.mock.calls[0][0] as Role;
    expect(saved.rateBasis).toBe("day");
    expect(saved.internalRateDay).toBe(800);
    expect(saved.externalRateDay).toBe(1600);
  });

  it("Hours/Days switch flips a day-basis row back to hour basis", () => {
    const onSaveRole = vi.fn();
    renderOneRole(onSaveRole, { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200, internalRateDay: 800, externalRateDay: 1600, rateBasis: "day" });
    expect(screen.getByRole("radio", { name: /— Days$/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: /— Hours$/ }));
    expect(onSaveRole).toHaveBeenCalledTimes(1);
    expect((onSaveRole.mock.calls[0][0] as Role).rateBasis).toBe("hour");
  });

  it("clicking the already-selected basis is a no-op (no save)", () => {
    const onSaveRole = vi.fn();
    renderOneRole(onSaveRole, { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 });
    // Already hour basis → clicking Hours must not fire a save.
    fireEvent.click(screen.getByRole("radio", { name: /— Hours$/ }));
    expect(onSaveRole).not.toHaveBeenCalled();
  });

  it("switching to Days with an invalid workdayHours falls back to 8 (never zeroes the rate)", () => {
    const onSaveRole = vi.fn();
    // A corrupted setting (0) must not zero the pinned day rate — the guard
    // falls back to 8, so 100/h -> 800/d, not 0.
    renderOneRole(onSaveRole, { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 }, 0);
    fireEvent.click(screen.getByRole("radio", { name: /— Days$/ }));
    const saved = onSaveRole.mock.calls[0][0] as Role;
    expect(saved.internalRateDay).toBe(800);
    expect(saved.internalRate).toBe(100);
  });

  it("gives each row's basis radios a row-unique accessible name (WCAG 2.4.6)", () => {
    renderTwoRoles();
    // Two rows → two distinct "Hours" radios, each qualified by its row context.
    expect(screen.getByRole("radio", { name: "Engineering / Senior — Hours" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Design / Junior — Hours" })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 4, roles: ["radio"] });
  });

  it("gives each row's delete button a row-unique accessible name (WCAG 2.4.6)", () => {
    renderTwoRoles();
    // A bare "Delete" repeated per row is a WCAG 2.4.6 fail; each is now qualified
    // by its discipline / grade row context.
    expect(screen.getByRole("button", { name: `${t("en-US", "delete")} – Engineering / Senior` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${t("en-US", "delete")} – Design / Junior` })).toBeInTheDocument();
    // Scoped to the rate-card table's BODY, not the whole document — but only
    // to keep this assertion about ROW identity. The header collision that
    // originally forced the narrowing (rolesRateBasisHint shared by the two
    // day-rate columns and the Basis column) is FIXED: §246 gave each /d column
    // its own hint, and the whole-container pin at the bottom of this file
    // covers the header now.
    const tbody = screen.getByRole("table").querySelector("tbody")!;
    expectRowUniqueNames({ minControls: 4, scope: tbody });
  });

  // Class A tooltip batch: the row delete is icon-only, so its row-qualified
  // name is repeated as a `title` for the mouse. Sampled row — the batch is not
  // fully pinned; see docs/tooltip-inventory.md.
  it("gives each row's delete button a hover title matching its accessible name", () => {
    renderEditor();
    const expected = `${t("en-US", "delete")} – Engineering / Senior`;
    expect(screen.getByRole("button", { name: expected })).toHaveAttribute("title", expected);
  });

  it("sets drag transfer data on dragstart — Firefox will not start a drag without it", () => {
    // ★ Was missing at BOTH drag sites in this file: the old handlers set only
    // `effectAllowed`. jsdom dispatches the whole drag sequence regardless, so
    // a setData spy is the only thing that can catch the omission.
    renderTwoRoles();
    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    const setData = vi.fn();
    fireEvent.dragStart(handleIn(rows[0]), { dataTransfer: { setData, effectAllowed: "" } });
    expect(setData).toHaveBeenCalled();
  });

  // ★★★ REGRESSION (H1). `handleProps` carries the hook's `onKeyDown`, which
  // `preventDefault()`s ArrowUp/ArrowDown and reorders. React synthetic keydown
  // bubbles from EVERY descendant, so spreading that bag on the <tr> (as this
  // file first did) hijacked the arrow keys of every control inside the row —
  // the four number-input rate spinners, the Hours/Days SegmentedControl (an
  // APG radiogroup that handles the same keys and does NOT stopPropagation, so
  // one ArrowDown produced TWO persisted writes) and the RefList rename caret.
  // The bag now sits on the grip alone.
  it("does not reorder when an arrow key is pressed on a rate input inside the row", () => {
    const onReorderRoles = vi.fn();
    renderTwoRoles(onReorderRoles);
    const rows = screen.getAllByRole("row").slice(1); // drop the header row

    // POSITIVE observable first: without it a handle that reorders nothing at
    // all would satisfy the negative assertions below for the wrong reason.
    fireEvent.keyDown(handleIn(rows[0]), { key: "ArrowDown" });
    expect(onReorderRoles).toHaveBeenCalledTimes(1);
    onReorderRoles.mockClear();

    // Arrow keys on the rate cells are the native number-input spinner.
    const rateInputs = within(rows[0]).getAllByRole("spinbutton");
    expect(rateInputs.length).toBeGreaterThan(0);
    for (const input of rateInputs) {
      fireEvent.keyDown(input, { key: "ArrowUp" });
      fireEvent.keyDown(input, { key: "ArrowDown" });
    }
    expect(onReorderRoles).not.toHaveBeenCalled();

    // Same for the Hours/Days basis control, which owns these keys itself.
    const basis = within(rows[0]).getByRole("radiogroup");
    fireEvent.keyDown(basis, { key: "ArrowDown" });
    expect(onReorderRoles).not.toHaveBeenCalled();
  });

  it("does not reorder a reference list when an arrow key is pressed in its rename input", () => {
    const onReorderDisciplines = vi.fn();
    render(
      <RolesEditor
        lang="en-US" currency="EUR" workdayHours={8}
        roles={roles} disciplines={[{ id: 1, name: "Engineering" }, { id: 2, name: "Design" }]}
        grades={grades}
        onSaveRole={noop} onDeleteRole={noop} onResolveOrCreateRole={() => 0} onReorderRoles={noop}
        onAddDiscipline={() => 0} onRenameDiscipline={noop} onDeleteDiscipline={noop}
        onReorderDisciplines={onReorderDisciplines}
        onAddGrade={() => 0} onRenameGrade={noop} onDeleteGrade={noop} onReorderGrades={noop}
      />,
    );
    const item = screen.getByDisplayValue("Engineering").closest("li")!;
    fireEvent.keyDown(handleIn(item), { key: "ArrowDown" });
    expect(onReorderDisciplines).toHaveBeenCalledTimes(1); // positive observable
    onReorderDisciplines.mockClear();
    fireEvent.keyDown(screen.getByDisplayValue("Engineering"), { key: "ArrowDown" });
    expect(onReorderDisciplines).not.toHaveBeenCalled();
  });

  it("gives every reorder handle a row-unique accessible name (WCAG 2.4.6)", () => {
    // ★ Needs ≥2 rows per list, or the collision cannot render and this passes
    // on broken code. axe cannot detect duplicate accessible names at ANY seed
    // size, in any view — this test is the only possible detector.
    renderTwoRoles();
    const names = screen
      .getAllByRole("button", { name: /reorder/i })
      .map((el) => el.getAttribute("aria-label"));
    expect(names.length).toBeGreaterThan(1);
    expect(new Set(names).size).toBe(names.length);
    // Scoped to the rate-card table's BODY — see the delete-button test above
    // for why the whole document isn't used here (this stays a row-level
    // assertion; the header is pinned separately at the bottom of this file).
    const tbody = screen.getByRole("table").querySelector("tbody")!;
    expectRowUniqueNames({ minControls: 4, scope: tbody });
  });

  it("does not reorder on a drop while a column sort is active", () => {
    // ★★ The product rule behind `disabled: !!sort` — a drag must not fight the
    // sort, because the drop would rewrite `order` against positions the user
    // is not looking at.
    // ★★★ THE DRAG MUST BE STARTED BEFORE THE SORT and that is not a contrived
    // sequence, it is the only one that can TEST the flag: a sorted rate card
    // renders no grip at all (`reorderable = !sort` gates it), so a test
    // that merely renders sorted and fires a drop passes with `disabled` flipped
    // to false — there is no live `dragId` for the drop to commit. Starting the
    // drag first leaves one in hook state across the re-render, so the ONLY
    // thing standing between it and a reorder is `disabled`.
    const onReorderRoles = vi.fn();
    renderTwoRoles(onReorderRoles);
    const dt = { effectAllowed: "", getData: () => "", setData: () => {} };
    const dataRows = () => screen.getAllByRole("row").slice(1, 3);

    // POSITIVE observable: the identical sequence reorders while unsorted.
    fireEvent.dragStart(handleIn(dataRows()[1]), { dataTransfer: dt });
    fireEvent.drop(dataRows()[0], { dataTransfer: dt });
    expect(onReorderRoles).toHaveBeenCalledTimes(1);
    onReorderRoles.mockClear();

    fireEvent.dragStart(handleIn(dataRows()[1]), { dataTransfer: dt });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "rolesDiscipline") }));
    // Sorted by discipline: "Design" (id 2) now leads, so row 1 is a DIFFERENT
    // id from the dragged one — a same-id drop is a no-op in the hook and would
    // make this pass for the wrong reason.
    fireEvent.drop(dataRows()[1], { dataTransfer: dt });
    expect(onReorderRoles).not.toHaveBeenCalled();
    // …and no handle survives the sort in the RATE CARD, so the keyboard path is
    // gone too. Scoped per row: the discipline/grade reference lists below carry
    // their own handles, which stay live and would mask this.
    for (const row of dataRows()) {
      expect(within(row).queryByRole("button", { name: /reorder/i })).toBeNull();
    }
  });
});


describe("RolesEditor sortable column headers", () => {
  // The rate card announced its sort state NOWHERE: four hand-rolled sortable
  // headers and zero aria-sort attributes, the state carried only as a ▲/▼ glyph
  // inside each button's accessible name. axe has NO rule for a missing aria-sort,
  // in any view at any seed size, so these tests are the only detector that will
  // ever exist for it.

  // Scoped to the rate-card table: the discipline and grade reference lists below
  // it render their own rows, and a stray <th> from either would inflate every
  // count here. Anchored on the NON-sortable basis header so the scope itself can
  // never move with the sort state — anchoring it on a sort button made a failure
  // in the swap test surface as "cannot find the Discipline button" instead of the
  // assertion it was there to make.
  const rateCard = () =>
    screen.getByRole("columnheader", { name: new RegExp(t("en-US", "rolesRateBasis"), "i") }).closest("table")!;

  // The <th>'s own accessible name absorbs the InfoTooltip badge beside the label
  // (measured before the change: the discipline header names as "Discipline i"),
  // so the header is reached through its BUTTON rather than matched by name.
  const headerFor = (label: string) =>
    within(rateCard()).getByRole("button", { name: label }).closest("th");

  // A string `name` is an EXACT match, so each lookup also pins that column's i18n
  // label key — a header wired to the wrong string fails here too. The labels stay
  // glyph-free because the primitive's sort arrow is aria-hidden.
  const SORTABLE = [
    ["discipline", t("en-US", "rolesDiscipline"), t("en-US", "rolesDisciplineHint")],
    ["grade", t("en-US", "rolesGrade"), t("en-US", "rolesGradeHint")],
    ["internal", t("en-US", "rolesInternalRate"), t("en-US", "rolesInternalRateHint")],
    ["external", t("en-US", "rolesExternalRate"), t("en-US", "rolesExternalRateHint")],
  ] as const;

  it("announces sort state through aria-sort and keeps each column's hint", async () => {
    renderEditor();
    // Unsorted on mount: `sort` is null, so no column may claim a sort — but every
    // sortable header must SAY so rather than leave the attribute off entirely.
    for (const [, label] of SORTABLE) expect(headerFor(label)).toHaveAttribute("aria-sort", "none");
    // Every hint badge survives the conversion — the hand-rolled span wrapping the
    // button and the InfoTooltip is exactly what the primitive's `hint` prop
    // renders. Matched by the tooltip's accessible name (InfoTooltip is a focusable
    // span with role=button whose aria-label is the hint text), which pins each
    // column's hint KEY too: a header handed a neighbour's hint fails here.
    for (const [, , hint] of SORTABLE) {
      expect(within(rateCard()).getByRole("button", { name: hint })).toBeInTheDocument();
    }

    const btn = () => within(rateCard()).getByRole("button", { name: t("en-US", "rolesDiscipline") });
    await userEvent.click(btn());
    expect(headerFor(t("en-US", "rolesDiscipline"))).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(btn());
    expect(headerFor(t("en-US", "rolesDiscipline"))).toHaveAttribute("aria-sort", "descending");
  });

  // §766: the Hours/Days control is an inline-flex that WRAPS, so in a column too
  // narrow for both options it stacks them and every rate-card row grows from 50px
  // to 82px. Measured in Chromium on 2026-10-23 with wrapping switched off: 152px
  // in English, 164px in German ("Stunden" / "Tage"); the cell adds px-3 (24px).
  // jsdom has no layout, so the width is pinned against that measurement.
  it("gives the basis column room for both options on one line, in German too (§766)", () => {
    expect(ROLES_COL_WIDTHS.basis).toBeGreaterThanOrEqual(164 + 24);
  });

  // ROLES_COL_WIDTHS is a fixed const with no persistence and no setter, so the
  // rate card sorts but does not resize. `onResize` is therefore OMITTED rather
  // than stubbed: a no-op handler still draws a grip that looks draggable and does
  // nothing, the false affordance the primitive documents as worse than no handle.
  it("renders no resize grip - these columns are fixed width", () => {
    renderEditor();
    // POSITIVE observable FIRST. Without it this passes on a table that failed to
    // render at all, which is exactly how a bare absence assertion ships green.
    const table = rateCard();
    for (const [, label] of SORTABLE) expect(headerFor(label)).toBeInTheDocument();
    expect(table.querySelectorAll(".cursor-col-resize")).toHaveLength(0);
  });

  // The explicit <SortKey> generic stops a GARBAGE sortCol, but it cannot stop one
  // real column's key pasted onto another header: every key is still a valid
  // SortKey, tsc exits 0, that column silently missorts, and no gate here sees it.
  //
  // The detector falls out of the primitive's own `active` rule
  // (`sortKey === sortCol && sortDir !== "off"`): two headers sharing one sortCol
  // both light up on a single click. So after clicking a column, EXACTLY one header
  // may report a non-"none" aria-sort, and it must be that column's own. The count
  // alone would miss a swap onto a hidden column; the identity alone would miss the
  // duplicate — both halves are needed.
  it("wires each sortable header to its own column, not a neighbour's", async () => {
    renderEditor();
    const sorted = () =>
      within(rateCard())
        .getAllByRole("columnheader")
        .filter((th) => (th.getAttribute("aria-sort") ?? "none") !== "none");

    for (const [key, label] of SORTABLE) {
      // toggleSort resets the direction to "asc" whenever the KEY changes, so one
      // pass over the four never re-enters the asc/desc flip.
      await userEvent.click(within(rateCard()).getByRole("button", { name: label }));
      // Re-queried after the click rather than reused: a stale node would make the
      // identity check compare against something no longer in the document.
      const own = headerFor(label);
      expect(sorted(), "clicking " + key + " lit up the wrong number of headers").toHaveLength(1);
      expect(sorted()[0], "clicking " + key + " sorted a different column").toBe(own);
      expect(own).toHaveAttribute("aria-sort", "ascending");
    }
  });

  // §246: the two /d columns and Basis all carried `rolesRateBasisHint`, so
  // three InfoTooltip triggers shared one accessible name. This is a
  // DISTINCT-NAME regression pin, so `requireCollisionSeed` stays OFF — there
  // is deliberately no collision left to seed.
  //
  // ★ 21 is the MEASURED count for this fixture (one role, one discipline, one
  // grade), read off the helper's own floor error, not a guess. It is pinned
  // EXACTLY rather than loosely because `roles` is passed explicitly here: a
  // later narrowing of that array would otherwise sail past a slack floor,
  // which is the one failure `minControls` can catch automatically. A new
  // control in this editor turns this red with a message naming both numbers —
  // re-measure and bump it, never lower it to get green.
  it("gives each rate-card header tooltip its own accessible name", () => {
    const { container } = renderEditor();
    expectRowUniqueNames({ minControls: 21, scope: container, roles: ["button"] });
  });
});

// ★★★ §622 class — the discipline/grade rename input is uncontrolled and commits
// only on blur. A window close, reload or navigation never blurs it, so a typed
// rename was LOST. `pagehide` commits it; a tab switch must not (owner rule),
// and a close with nothing typed must rename nothing.
describe("RefList rename commits via pagehide (§622)", () => {
  function refLists(
    onRenameDiscipline: (id: number, name: string) => void,
    onRenameGrade: (id: number, name: string) => void,
    disciplines: Discipline[] = [{ id: 1, name: "Engineering" }, { id: 2, name: "Design" }],
  ) {
    return (
      <RolesEditor
        lang="en-US" currency="EUR" workdayHours={8} roles={[]}
        disciplines={disciplines}
        grades={[{ id: 7, name: "Senior" }]}
        onSaveRole={noop} onDeleteRole={noop} onResolveOrCreateRole={() => 0} onReorderRoles={noop}
        onAddDiscipline={() => 0} onRenameDiscipline={onRenameDiscipline} onDeleteDiscipline={noop} onReorderDisciplines={noop}
        onAddGrade={() => 0} onRenameGrade={onRenameGrade} onDeleteGrade={noop} onReorderGrades={noop}
      />
    );
  }
  const renderRefLists = (onRenameDiscipline: (id: number, name: string) => void, onRenameGrade: (id: number, name: string) => void) =>
    render(refLists(onRenameDiscipline, onRenameGrade));
  const pageHide = () => act(() => { window.dispatchEvent(new Event("pagehide")); });

  it("commits a typed-but-unblurred rename on pagehide, and only the edited row", () => {
    const onRenameDiscipline = vi.fn();
    const onRenameGrade = vi.fn();
    renderRefLists(onRenameDiscipline, onRenameGrade);
    fireEvent.change(screen.getByDisplayValue("Design"), { target: { value: "UX Design" } });
    pageHide();
    expect(onRenameDiscipline).toHaveBeenCalledTimes(1);
    expect(onRenameDiscipline).toHaveBeenCalledWith(2, "UX Design");
    expect(onRenameGrade).not.toHaveBeenCalled();
  });

  it("commits nothing on a tab switch", () => {
    const onRenameDiscipline = vi.fn();
    renderRefLists(onRenameDiscipline, noop);
    fireEvent.change(screen.getByDisplayValue("Design"), { target: { value: "UX Design" } });
    act(() => {
      const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      spy.mockRestore();
    });
    expect(onRenameDiscipline).not.toHaveBeenCalled();
  });

  it("renames nothing on pagehide when no row was edited (or only blanked)", () => {
    const onRenameDiscipline = vi.fn();
    const onRenameGrade = vi.fn();
    renderRefLists(onRenameDiscipline, onRenameGrade);
    pageHide();
    fireEvent.change(screen.getByDisplayValue("Senior"), { target: { value: "   " } });
    pageHide();
    expect(onRenameDiscipline).not.toHaveBeenCalled();
    expect(onRenameGrade).not.toHaveBeenCalled();
  });

  // ★★ Abandon, never clobber: a blur-committed rename must not survive its own
  // commit. An uncontrolled input keeps showing the typed text after a later
  // external rename (a sync) changes `it.name`, so a pagehide that read the DOM
  // would write the OLD typed name back over the newer one.
  it("does not write a blur-committed rename back over a newer external name", () => {
    const onRenameDiscipline = vi.fn();
    const { rerender } = render(refLists(onRenameDiscipline, noop));
    const input = screen.getByDisplayValue("Design");
    fireEvent.change(input, { target: { value: "UX Design" } });
    fireEvent.blur(input);
    expect(onRenameDiscipline).toHaveBeenCalledTimes(1);
    rerender(refLists(onRenameDiscipline, noop, [{ id: 1, name: "Engineering" }, { id: 2, name: "Product Design" }]));
    pageHide();
    expect(onRenameDiscipline).toHaveBeenCalledTimes(1);
  });

  // Same rule for a PAGEHIDE-committed rename: after a bfcache restore, a second
  // pagehide must not replay it over a newer external name.
  it("does not write a pagehide-committed rename back over a newer external name", () => {
    const onRenameDiscipline = vi.fn();
    const { rerender } = render(refLists(onRenameDiscipline, noop));
    fireEvent.change(screen.getByDisplayValue("Design"), { target: { value: "UX Design" } });
    pageHide();
    expect(onRenameDiscipline).toHaveBeenCalledTimes(1);
    rerender(refLists(onRenameDiscipline, noop, [{ id: 1, name: "Engineering" }, { id: 2, name: "Product Design" }]));
    pageHide();
    expect(onRenameDiscipline).toHaveBeenCalledTimes(1);
  });
});

// §669 — two rate-card roles can sit on one discipline and grade, and discipline
// and grade names have no uniqueness rule.
describe("RolesEditor row names (§669)", () => {
  it("names every control of two roles on one discipline and grade apart", () => {
    render(
      <RolesEditor
        lang="en-US" currency="EUR" workdayHours={8}
        roles={[
          { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 },
          { id: 2, disciplineId: 1, gradeId: 1, internalRate: 50, externalRate: 90 },
        ]}
        disciplines={[{ id: 1, name: "Engineering" }, { id: 2, name: "Engineering" }]}
        grades={[{ id: 1, name: "Senior" }, { id: 2, name: "Engineering" }]}
        onSaveRole={noop} onDeleteRole={noop} onResolveOrCreateRole={() => 0} onReorderRoles={noop}
        onAddDiscipline={() => 0} onRenameDiscipline={noop} onDeleteDiscipline={noop} onReorderDisciplines={noop}
        onAddGrade={() => 0} onRenameGrade={noop} onDeleteGrade={noop} onReorderGrades={noop}
      />,
    );
    const table = screen.getByRole("table");
    expect(within(table).getByRole("button", { name: `${t("en-US", "delete")} – Engineering / Senior (2)` })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 4, scope: table, requireCollisionSeed: true });
    expectRowUniqueNames({ minControls: 8, roles: ["textbox", "spinbutton"], scope: table });
    // The two disciplines called "Engineering", and a grade with the same name: the
    // list title leads each row name, so the two lists read apart as well.
    const disc = t("en-US", "rolesDiscipline");
    const grade = t("en-US", "rolesGrade");
    expect(screen.getByRole("button", { name: `${t("en-US", "delete")} – ${disc}: Engineering (2)` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${t("en-US", "delete")} – ${grade}: Engineering` })).toBeInTheDocument();
    // The rename field beside them had no name at all.
    expect(screen.getByRole("textbox", { name: `${t("en-US", "rename")} – ${disc}: Engineering (2)` })).toHaveValue("Engineering");
    expectRowUniqueNames({ minControls: 10 });
    expectRowUniqueNames({ minControls: 4, roles: ["textbox"] });
  });
});

// Review fix (§685): one height per row — the combo selects and their Add
// button are all xs (30px).
describe("RolesEditor combo row heights", () => {
  it("draws the two selects and Add at xs", () => {
    renderEditor();
    const add = screen.getByRole("button", { name: t("en-US", "rolesAddCombo") });
    expect(add.className).toBe(buttonClassFor({ variant: "primary", size: "xs" }));
    const row = add.parentElement as HTMLElement;
    const selects = within(row).getAllByRole("combobox");
    expect(selects).toHaveLength(2);
    for (const s of selects) expect(s.className.split(/\s+/)).toEqual(expect.arrayContaining(["py-1.5", "text-xs"]));
  });
});

describe("RolesEditor reference list row heights", () => {
  it("draws the rename fields, the add field and + at xs, with + as an icon", () => {
    renderEditor();
    const add = screen.getByRole("button", { name: t("en-US", "rolesAddDiscipline") });
    expect(add.className).toBe(buttonClassFor({ variant: "secondary", size: "xs" }));
    // The glyph is an icon, so its size does not follow the 12px xs text.
    expect(add.textContent).toBe("");
    expect(add.querySelector("svg")).not.toBeNull();
    const fields = [
      screen.getByRole("textbox", { name: t("en-US", "rolesAddDiscipline") }),
      ...screen.getAllByRole("textbox", { name: new RegExp(`^${t("en-US", "rename")}`) }),
    ];
    expect(fields.length).toBeGreaterThan(1);
    for (const f of fields) expect(f.className.split(/\s+/)).toEqual(expect.arrayContaining(["py-1.5", "text-xs"]));
  });
});

// §766 review round: the whole rate card fits a 1280×720 window. Measured in Chromium
// on 2026-10-23 against the e2e seed, in English and German, at 1920×1080, 1366×768,
// 1280×720, 1024×576 and 853×480: with these widths and `w-16` rate inputs the table is
// 908px at its narrowest, and the panel shows 1002px of it at 1366 and 916px at 1280, so
// nothing scrolls sideways there (with "€"; "US$" scrolls at 1280). A 64px input
// without a spinner shows up to 7 characters, e.g. "1166.67".
// Below 1280 the table scrolls inside the panel, so the delete column is pinned right
// and each row's ✕ stays in view. jsdom has no layout: these pin the measured inputs.
describe("RolesEditor rate card fits a 1280px window (§766)", () => {
  it("keeps the measured column widths", () => {
    expect(ROLES_COL_WIDTHS).toEqual({
      discipline: 160,
      grade: 100,
      internal: 100,
      external: 100,
      internalDay: 100,
      externalDay: 100,
      basis: 192,
    });
  });

  it("draws every rate input 64px wide", () => {
    renderEditor();
    const inputs = screen.getAllByRole("spinbutton");
    expect(inputs).toHaveLength(roles.length * 4);
    for (const i of inputs) {
      const classes = i.className.split(/\s+/);
      expect(classes).toContain("w-16");
      expect(classes).not.toContain("w-24");
    }
  });

  // §766 peer review: the number spinner took about 15px of a 64px field. It is
  // dropped on these inputs only, and each field, read-only derived ones included,
  // carries its full value in `title` in case a long value still scrolls.
  it("draws the rate inputs without a spinner and titles each with its value", () => {
    renderEditor();
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(inputs.some((i) => i.readOnly)).toBe(true);
    expect(inputs.some((i) => !i.readOnly)).toBe(true);
    for (const i of inputs) {
      expect(i.className.split(/\s+/)).toEqual(expect.arrayContaining([
        "[appearance:textfield]",
        "[&::-webkit-inner-spin-button]:appearance-none",
        "[&::-webkit-outer-spin-button]:appearance-none",
      ]));
      expect(i.value).not.toBe("");
      expect(i.title).toBe(rateFieldDisplay(Number(i.value)));
    }
  });

  // §766: Chromium draws a number field's decimal separator in the browser's own
  // locale, not the app language: measured 2026-10-24, "1166.67" showed as "1166,67"
  // under `--lang=de-DE` and "1166.67" under `--lang=en-US`, whichever app language
  // was set. The title follows the same rule, so it reads like the field.
  it("formats the title the way the field displays it", () => {
    expect(rateFieldDisplay(1166.67, "de-DE")).toBe("1166,67");
    expect(rateFieldDisplay(1166.67, "en-US")).toBe("1166.67");
    expect(rateFieldDisplay(10666.67, "de-DE")).toBe("10666,67");
    expect(rateFieldDisplay(123456, "de-DE")).toBe("123456");
  });

  // The rendered title uses the browser's default locale. Each case forces that
  // default, so the test means the same on a de-DE machine and an en-US CI runner:
  // a title built with String(value) would read "133.33" under de-DE too.
  it.each([
    ["de-DE", "133,33"],
    ["en-US", "133.33"],
  ])("titles a rendered rate field in the browser locale (%s)", (locale, expected) => {
    const RealNumberFormat = Intl.NumberFormat;
    // A `function`, not an arrow: the code calls it with `new`.
    const spy = vi.spyOn(Intl, "NumberFormat").mockImplementation(
      function (loc?: string | string[], opts?: Intl.NumberFormatOptions) {
        return new RealNumberFormat(loc ?? locale, opts);
      } as typeof Intl.NumberFormat,
    );
    try {
      renderEditor("EUR", [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 133.33, externalRate: 200 }]);
      const hourly = screen.getAllByRole("spinbutton")[0] as HTMLInputElement;
      expect(hourly.value).toBe("133.33");
      expect(hourly.title).toBe(expected);
    } finally {
      spy.mockRestore();
    }
  });

  // Guard: the 1280 fit is a budget. Measured 2026-10-24 at 1280×720: the scroller
  // shows 916px and the table is 908px, which is the declared widths (852) plus the
  // 48px delete column plus 8px the table spends outside its declared columns. So
  // the declared widths may grow by 8px at most; 9px more scrolls at 1280. A new
  // column, or a wider one, must re-measure first.
  it("keeps the declared column widths inside the measured 1280 budget", () => {
    const SCROLLER_AT_1280 = 916;
    const DELETE_COL = 48;
    const OUTSIDE_DECLARED = 8;
    renderEditor();
    const headerCells = (document.querySelector("table") as HTMLElement).querySelectorAll("thead th");
    expect(headerCells).toHaveLength(Object.keys(ROLES_COL_WIDTHS).length + 1);
    const declared = Object.values(ROLES_COL_WIDTHS).reduce((a, b) => a + b, 0);
    expect(declared + DELETE_COL + OUTSIDE_DECLARED).toBeLessThanOrEqual(SCROLLER_AT_1280);
  });

  // ★ A sticky offset is measured from the scroller's PADDING edge, and the scroller
  // (INNER_TABLE_CLASS) has `pr-2`. At `right-0` the pinned cells stopped 8px short
  // of the edge and the Hours/Days control scrolled through that strip, beside the ✕
  // (measured at 1024×576, 2026-10-24). `-right-2` cancels the padding exactly.
  it("pins the delete column to the right edge, header included, and not in print", () => {
    expect(INNER_TABLE_CLASS.split(/\s+/)).toContain("pr-2");
    renderEditor();
    const table = document.querySelector("table") as HTMLElement;
    const deletes = within(table).getAllByRole("button", { name: new RegExp(`^${t("en-US", "delete")} – `) });
    expect(deletes).toHaveLength(roles.length);
    for (const d of deletes) {
      const classes = (d.closest("td") as HTMLElement).className.split(/\s+/);
      expect(classes).toEqual(expect.arrayContaining(["sticky", "-right-2", "bg-surface", "print:hidden"]));
      expect(classes).not.toContain("right-0");
    }
    const headerCells = table.querySelectorAll("thead th");
    const last = (headerCells[headerCells.length - 1] as HTMLElement).className.split(/\s+/);
    // In print the body cells are hidden, so the header cell is hidden too.
    expect(last).toEqual(expect.arrayContaining(["sticky", "-right-2", "print:hidden"]));
    expect(last).not.toContain("print:static");
    expect(last).not.toContain("right-0");
  });

  // ★ Focus scrolling ignores a sticky overlay: at 1024×576, with the table scrolled
  // to its start, the pinned column (48px) covered 36px of each External /d input,
  // and Tab into one left it covered (measured 2026-10-24). Scroll padding the pin's
  // width on THIS scroller makes focus and caret scrolling stop clear of it; the
  // shared INNER_TABLE_CLASS stays as it is.
  it("keeps focused cells clear of the pinned column with scroll padding (§766)", () => {
    renderEditor();
    const scroller = (document.querySelector("table") as HTMLElement).parentElement as HTMLElement;
    const classes = scroller.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining([...INNER_TABLE_CLASS.split(/\s+/), "scroll-pr-14"]));
    expect(INNER_TABLE_CLASS).not.toMatch(/scroll-p/);
  });
});
