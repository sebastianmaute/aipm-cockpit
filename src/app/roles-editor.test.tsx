import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RolesEditor } from "./roles-editor";
import { INNER_TABLE_CLASS } from "./view-styles";
import type { Discipline, Grade, Role } from "./types";

const noop = () => {};
const disciplines: Discipline[] = [{ id: 1, name: "Engineering" }];
const grades: Grade[] = [{ id: 1, name: "Senior" }];
const roles: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 }];

function renderEditor() {
  return render(
    <RolesEditor
      lang="en-US"
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
      onAddGrade={() => 0}
      onRenameGrade={noop}
      onDeleteGrade={noop}
      onReorderGrades={noop}
    />,
  );
}

describe("RolesEditor rate-card table", () => {
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

  it("A3: renders a € prefix symbol next to each rate input", () => {
    renderEditor();
    const euros = screen.getAllByText("€");
    // One € for internal rate, one for external rate (aria-hidden, so use getAllByText)
    expect(euros.length).toBeGreaterThanOrEqual(2);
  });
});
