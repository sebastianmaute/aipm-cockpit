import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RolesEditor } from "./roles-editor";
import { t } from "./i18n";
import { INNER_TABLE_CLASS } from "./view-styles";
import type { Discipline, Grade, Role } from "./types";

const noop = () => {};
const disciplines: Discipline[] = [{ id: 1, name: "Engineering" }];
const grades: Grade[] = [{ id: 1, name: "Senior" }];
const roles: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 }];

function renderEditor(currency = "EUR") {
  return render(
    <RolesEditor
      lang="en-US"
      currency={currency}
      workdayHours={8}
      roles={roles}
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
    const dt = { effectAllowed: "", getData: () => "", setData: () => {} };
    fireEvent.dragStart(bodyRows[2], { dataTransfer: dt });
    fireEvent.drop(bodyRows[0], { dataTransfer: dt });
    expect(onReorderRoles).toHaveBeenCalledTimes(1);
    expect(onReorderRoles.mock.calls[0][0][0]).toBe(1); // dropped id lands first
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
    render(
      <RolesEditor
        lang="en-US" currency="EUR" workdayHours={8}
        roles={[
          { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 },
          { id: 2, disciplineId: 2, gradeId: 2, internalRate: 50, externalRate: 90 },
        ]}
        disciplines={[{ id: 1, name: "Engineering" }, { id: 2, name: "Design" }]}
        grades={[{ id: 1, name: "Senior" }, { id: 2, name: "Junior" }]}
        onSaveRole={noop} onDeleteRole={noop} onResolveOrCreateRole={() => 0} onReorderRoles={noop}
        onAddDiscipline={() => 0} onRenameDiscipline={noop} onDeleteDiscipline={noop} onReorderDisciplines={noop}
        onAddGrade={() => 0} onRenameGrade={noop} onDeleteGrade={noop} onReorderGrades={noop}
      />,
    );
    // Two rows → two distinct "Hours" radios, each qualified by its row context.
    expect(screen.getByRole("radio", { name: "Engineering / Senior — Hours" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Design / Junior — Hours" })).toBeInTheDocument();
  });

  it("gives each row's delete button a row-unique accessible name (WCAG 2.4.6)", () => {
    render(
      <RolesEditor
        lang="en-US" currency="EUR" workdayHours={8}
        roles={[
          { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 },
          { id: 2, disciplineId: 2, gradeId: 2, internalRate: 50, externalRate: 90 },
        ]}
        disciplines={[{ id: 1, name: "Engineering" }, { id: 2, name: "Design" }]}
        grades={[{ id: 1, name: "Senior" }, { id: 2, name: "Junior" }]}
        onSaveRole={noop} onDeleteRole={noop} onResolveOrCreateRole={() => 0} onReorderRoles={noop}
        onAddDiscipline={() => 0} onRenameDiscipline={noop} onDeleteDiscipline={noop} onReorderDisciplines={noop}
        onAddGrade={() => 0} onRenameGrade={noop} onDeleteGrade={noop} onReorderGrades={noop}
      />,
    );
    // A bare "Delete" repeated per row is a WCAG 2.4.6 fail; each is now qualified
    // by its discipline / grade row context.
    expect(screen.getByRole("button", { name: `${t("en-US", "delete")} – Engineering / Senior` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${t("en-US", "delete")} – Design / Junior` })).toBeInTheDocument();
  });
});
