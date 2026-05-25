import { test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RolesModal } from "./roles-modal";
import type { Role, Discipline, Grade } from "./types";

const disciplines: Discipline[] = [{ id: 1, name: "Developer" }];
const grades: Grade[] = [{ id: 1, name: "Senior" }];
const roles: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 90, externalRate: 180 }];

function setup(over: Partial<React.ComponentProps<typeof RolesModal>> = {}) {
  const props = {
    lang: "en-US" as const, open: true, roles, disciplines, grades,
    onSaveRole: vi.fn(), onDeleteRole: vi.fn(), onResolveOrCreateRole: vi.fn(),
    onAddDiscipline: vi.fn(), onRenameDiscipline: vi.fn(),
    onDeleteDiscipline: vi.fn(), onReorderDisciplines: vi.fn(),
    onAddGrade: vi.fn(), onRenameGrade: vi.fn(),
    onDeleteGrade: vi.fn(), onReorderGrades: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<RolesModal {...props} />);
  return props;
}

test("renders existing role combos with their rates", () => {
  setup();
  expect(screen.getAllByText("Developer").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Senior").length).toBeGreaterThan(0);
  expect(screen.getByDisplayValue("90")).toBeInTheDocument();
});

test("editing an internal rate calls onSaveRole with the new value", () => {
  const props = setup();
  fireEvent.change(screen.getByDisplayValue("90"), { target: { value: "100" } });
  expect(props.onSaveRole).toHaveBeenCalledWith(expect.objectContaining({ id: 1, internalRate: 100 }));
});

test("adding a discipline calls onAddDiscipline with the typed name", () => {
  const props = setup();
  fireEvent.change(screen.getByPlaceholderText("Add discipline"), { target: { value: "QA" } });
  fireEvent.click(screen.getByRole("button", { name: "Add discipline" }));
  expect(props.onAddDiscipline).toHaveBeenCalledWith("QA");
});

test("clicking the delete button on a discipline calls onDeleteDiscipline with its id", () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const props = setup();
  // Delete buttons: [0] = role row (rate-card), [1] = discipline RefList, [2] = grade RefList
  const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
  fireEvent.click(deleteButtons[1]);
  expect(props.onDeleteDiscipline).toHaveBeenCalledWith(1);
});
