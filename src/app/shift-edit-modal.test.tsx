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
      knownAssignees={[]}
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
