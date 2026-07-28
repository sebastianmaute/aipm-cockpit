import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShiftEditModal } from "./shift-edit-modal";
import { t } from "./i18n";
import type { Resource, Shift } from "./types";

const SHIFT: Shift = {
  id: 7,
  assignee: "Alice",
  hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0],
};

const RESOURCES: Resource[] = [
  {
    id: 1,
    firstName: "Sample",
    lastName: "Dummy",
    email: "Sample@x.com",
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
  },
];

function setup(over: Partial<React.ComponentProps<typeof ShiftEditModal>> = {}) {
  const onSave = vi.fn();
  render(
    <ShiftEditModal
      lang="en-US"
      shift={SHIFT}
      isNew={false}
      existingAssigneeKeys={new Set()}
      resources={RESOURCES}
      contacts={[]}
      onCreateResource={vi.fn(() => 1)}
      onSave={onSave}
      onDelete={vi.fn()}
      onClose={vi.fn()}
      {...over}
    />,
  );
  return { onSave };
}

describe("ShiftEditModal — assignee ResourcePicker", () => {
  it("picking a registry resource stamps resourceId on save", () => {
    const { onSave } = setup();

    // The assignee field is now a ResourcePicker combobox. Focus + type to
    // surface the "Alex Example" registry suggestion, then pick it.
    const picker = within(
      screen.getByRole("dialog", { name: t("en-US", "shiftEditItem", 7) }),
    ).getByRole("combobox");
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "Sample" } });
    fireEvent.mouseDown(screen.getByText("Alex Example"));

    fireEvent.click(screen.getByRole("button", { name: t("en-US", "shiftSave") }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 1, assignee: "Alex Example" }),
    );
  });
});

describe("ShiftEditModal — panel sizing", () => {
  it("the panel carries a default height and min-height, not just a max, and the form can shrink to scroll", () => {
    // Same class of defect as the shared edit-modal shell and the budget
    // bucket modal: useResizable needs a class-based default height or a
    // dragged height opens dead space. The form also needs min-h-0 flex-1
    // so it is the flex child that actually shrinks and scrolls, rather
    // than the fixed-height panel clipping it.
    setup();
    const panel = document.querySelector("[data-modal-panel]") as HTMLElement;
    expect(panel.className).toContain("h-[560px]");
    expect(panel.className).toContain("min-h-[400px]");
    expect(panel.className).toContain("max-h-[95vh]");
    const form = panel.querySelector("form") as HTMLFormElement;
    expect(form.className).toContain("min-h-0");
    expect(form.className).toContain("flex-1");
  });
});
