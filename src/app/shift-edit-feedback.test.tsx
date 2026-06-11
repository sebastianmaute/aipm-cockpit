import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShiftEditModal } from "./shift-edit-modal";
import type { Shift } from "./types";

const SHIFT: Shift = {
  id: 1,
  assignee: "Alice",
  hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0],
};

function setup(over: Partial<React.ComponentProps<typeof ShiftEditModal>> = {}) {
  render(
    <ShiftEditModal
      lang="en-US"
      shift={SHIFT}
      isNew={false}
      existingAssigneeKeys={new Set()}
      resources={[]}
      contacts={[]}
      onCreateResource={vi.fn(() => 1)}
      onSave={vi.fn()}
      onDelete={vi.fn()}
      onClose={vi.fn()}
      {...over}
    />,
  );
}

describe("ShiftEditModal — hours clamp-on-blur feedback", () => {
  it("clamps value to 24 and shows an 'adjusted to max 24' notice on blur with '250'", () => {
    setup();
    // There are 7 number inputs (Sun–Sat). Pick the Monday input (index 1).
    const inputs = screen.getAllByRole("spinbutton");
    const monInput = inputs[1];

    // Type an out-of-range value
    fireEvent.change(monInput, { target: { value: "250" } });
    // Blur triggers clamp + notice
    fireEvent.blur(monInput, { target: { value: "250" } });

    // The inline notice should be visible — confirms clamp was triggered
    expect(screen.getByText(/adjusted to max 24/i)).toBeInTheDocument();
  });

  it("shows no notice when a valid value is entered and blurred", () => {
    setup();
    const inputs = screen.getAllByRole("spinbutton");
    const monInput = inputs[1];

    fireEvent.change(monInput, { target: { value: "8" } });
    fireEvent.blur(monInput, { target: { value: "8" } });

    // No notice element should be rendered (FieldNotice returns null for empty)
    expect(screen.queryByRole("status")).toBeNull();
  });
});
