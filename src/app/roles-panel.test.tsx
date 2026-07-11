import React from "react";
import { test, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RolesPanel } from "./roles-panel";
import { t } from "./i18n";

const noop = () => {};

function renderPanel() {
  return render(
    <RolesPanel
      lang="en-US"
      currency="EUR"
      workdayHours={8}
      roles={[]}
      disciplines={[]}
      grades={[]}
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

test("RolesPanel renders the roles editor inside a fit-height centered card", () => {
  const { container } = renderPanel();
  const section = container.querySelector("section");
  expect(section?.className).toContain("mx-auto");
  expect(section?.className).toContain("max-h-[calc(100vh-7rem)]");
});

test("RolesPanel is manually resizable and the reset button clears the manual size", () => {
  const { container, getByRole } = renderPanel();
  const section = container.querySelector("section") as HTMLElement;
  // The pane is CSS-resizable.
  expect(section.className).toContain("resize");
  // Simulate a manual resize (CSS resize writes inline width/height).
  section.style.width = "800px";
  section.style.height = "600px";
  // Reset returns it to the content-fit default by clearing the inline size.
  fireEvent.click(getByRole("button", { name: t("en-US", "tableResetSizeHint") }));
  expect(section.style.width).toBe("");
  expect(section.style.height).toBe("");
});
