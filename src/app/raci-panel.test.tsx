import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RaciPanel } from "./raci-panel";
import type { Stakeholder, Milestone } from "./types";

const stakeholders: Stakeholder[] = [
  { id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "High", raci: { "10": "A" } },
  { id: 2, name: "Lee", category: "Internal", influence: "Medium", interest: "High", raci: { "10": "A" } },
];
const milestones: Milestone[] = [{ id: 10, name: "Go-Live", date: "2026-09-01", linkedTaskIds: [] }];

describe("RaciPanel", () => {
  it("flags milestones with multiple Accountable", () => {
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={milestones} onSave={vi.fn()} />);
    expect(screen.getByText(/multiple accountable/i)).toBeInTheDocument();
  });
  it("edits a cell and saves the stakeholder", () => {
    const onSave = vi.fn();
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={milestones} onSave={onSave} />);
    // Collapsed trigger aria-label: "{milestone} · {stakeholder} — {currentRoleLabel}".
    // Sam's cell holds "A", so expand it then pick the "R" role chip in the popover.
    const trigger = screen.getByRole("button", { name: /Go-Live · Sam.*Accountable/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "R" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 1, raci: { "10": "R" } }));
  });
  it("shows an empty state when there are no milestones", () => {
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={[]} onSave={vi.fn()} />);
    expect(screen.getByText(/add milestones/i)).toBeInTheDocument();
  });
  it("renders a reset-size button (resizable pane)", () => {
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={milestones} onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: /reset back to the default size/i })).toBeInTheDocument();
  });
});
