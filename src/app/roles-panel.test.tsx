import React from "react";
import { test, expect } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { RolesPanel } from "./roles-panel";
import { t } from "./i18n";
import { buttonNames, expectButtonOrder } from "../test/toolbar-order";

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

// §766: half of the content area left the rate card (then a 1,013px table) a
// 420-488px window below 1366px. The pane now takes the whole content width up
// to a cap the rate card fits in, and the cap lives in `width` so a corner drag
// wider than it still wins (`max-w-*` would clamp the inline width).
test("RolesPanel takes the content width up to a cap, not half of it (§766)", () => {
  const { container } = renderPanel();
  const classes = [...(container.querySelector("section")?.classList ?? [])];
  expect(classes).toContain("w-[min(100%,72rem)]");
  expect(classes).not.toContain("w-[50%]");
  expect(classes.some((c) => c.startsWith("max-w-"))).toBe(false);
  expect(classes).toContain("min-w-[420px]");
});

// The toolbar convention: the trailing group is Print · reset-size, contiguous
// and last in the rate-card header. It read reset-size · Print until §766.
test("RolesPanel rate-card toolbar ends with Print then reset-size", () => {
  renderPanel();
  expectButtonOrder(["printHint", "tableResetSizeHint"], { contiguous: true });
  const header = screen.getByRole("heading", { name: t("en-US", "rolesRateCard") }).parentElement as HTMLElement;
  expect(buttonNames(header).slice(-2)).toEqual([t("en-US", "printHint"), t("en-US", "tableResetSizeHint")]);
});
