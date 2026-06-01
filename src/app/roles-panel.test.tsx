import React from "react";
import { test, expect } from "vitest";
import { render } from "@testing-library/react";
import { RolesPanel } from "./roles-panel";

const noop = () => {};

test("RolesPanel renders the roles editor inside a resizable card", () => {
  const { container } = render(
    <RolesPanel
      lang="en-US"
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
      onAddGrade={() => 0}
      onRenameGrade={noop}
      onDeleteGrade={noop}
      onReorderGrades={noop}
    />,
  );
  expect(container.querySelector(".resize")).toBeTruthy();
});
