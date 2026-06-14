import React from "react";
import { test, expect } from "vitest";
import { render } from "@testing-library/react";
import { RolesPanel } from "./roles-panel";

const noop = () => {};

test("RolesPanel renders the roles editor inside a fit-height centered card", () => {
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
  const section = container.querySelector("section");
  expect(section?.className).toContain("mx-auto");
  expect(section?.className).toContain("max-h-[calc(100vh-7rem)]");
});
