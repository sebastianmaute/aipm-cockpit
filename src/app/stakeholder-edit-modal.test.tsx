import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StakeholderEditModal } from "./stakeholder-edit-modal";
import type { Stakeholder, Milestone } from "./types";

const draft: Stakeholder = {
  id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "Medium", raci: {},
};
const milestones: Milestone[] = [{ id: 10, name: "Go-Live", date: "2026-09-01", linkedTaskIds: [] }];

function setup(over: Partial<React.ComponentProps<typeof StakeholderEditModal>> = {}) {
  const props = {
    lang: "en-US" as const, draft, isNew: true, milestones, resources: [],
    onChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn(), ...over,
  };
  render(<StakeholderEditModal {...props} />);
  return props;
}

describe("StakeholderEditModal", () => {
  it("requires a name to save", () => {
    const p = setup({ draft: { ...draft, name: "" } });
    fireEvent.submit(screen.getByRole("button", { name: /save/i }).closest("form")!);
    expect(p.onSave).not.toHaveBeenCalled();
  });
  it("edits a RACI cell for a milestone", () => {
    const p = setup();
    fireEvent.change(screen.getByLabelText("Go-Live"), { target: { value: "A" } });
    expect(p.onChange).toHaveBeenCalledWith(expect.objectContaining({ raci: { "10": "A" } }));
  });
});
