import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("additive person filter: add narrows columns, remove and clear restore all", () => {
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={milestones} onSave={vi.fn()} />);

    // (a) initially all stakeholder columns show
    expect(screen.getByRole("columnheader", { name: "Sam" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Lee" })).toBeInTheDocument();

    // (b) adding one person narrows visibleStakeholders to just them
    const input = screen.getByRole("combobox", { name: /filter people/i });
    fireEvent.change(input, { target: { value: "Sam" } });
    expect(screen.getByRole("columnheader", { name: "Sam" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Lee" })).not.toBeInTheDocument();

    // (c) removing the chip restores all columns
    fireEvent.click(screen.getByRole("button", { name: /remove sam from filter/i }));
    expect(screen.getByRole("columnheader", { name: "Sam" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Lee" })).toBeInTheDocument();

    // (d) Clear empties the set → all shown again
    fireEvent.change(input, { target: { value: "Lee" } });
    expect(screen.queryByRole("columnheader", { name: "Sam" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /clear filter/i }));
    expect(screen.getByRole("columnheader", { name: "Sam" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Lee" })).toBeInTheDocument();
  });

  // The add field auto-adds on an exact-label onChange match, so the ✕ must go
  // through the state setter and NOT re-enter that handler.
  it("clears the add field without adding anyone", async () => {
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={milestones} onSave={vi.fn()} />);
    const field = screen.getByLabelText("Filter people…") as HTMLInputElement;
    await userEvent.type(field, "Ann");
    await userEvent.click(screen.getByRole("button", { name: "Clear – Filter people…" }));
    // ★ Headline claim FIRST: a weaker assertion placed ahead of it becomes the
    //   reported failure and the real claim never runs. One chip = one added
    //   person, so zero remove-buttons means nobody was added.
    expect(screen.queryAllByRole("button", { name: /from filter/i })).toHaveLength(0);
    expect(field.value).toBe("");
  });

  it("disambiguates duplicate stakeholder names with (#id) so the second is selectable", () => {
    const dup: Stakeholder[] = [
      { id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "High", raci: { "10": "A" } },
      { id: 2, name: "Lee", category: "Internal", influence: "Medium", interest: "High", raci: { "10": "R" } },
      { id: 3, name: "Sam", category: "Internal", influence: "Low", interest: "Low", raci: { "10": "C" } },
    ];
    render(<RaciPanel lang="en-US" stakeholders={dup} milestones={milestones} onSave={vi.fn()} />);

    // The shared name is disambiguated in the picker; the unique one stays bare.
    expect(document.querySelector('option[value="Sam (#1)"]')).not.toBeNull();
    expect(document.querySelector('option[value="Sam (#3)"]')).not.toBeNull();
    expect(document.querySelector('option[value="Lee"]')).not.toBeNull();

    // Selecting the SECOND Sam filters to exactly that one column (was unreachable).
    const input = screen.getByRole("combobox", { name: /filter people/i });
    fireEvent.change(input, { target: { value: "Sam (#3)" } });
    expect(screen.getAllByRole("columnheader", { name: "Sam" })).toHaveLength(1);
    expect(screen.queryByRole("columnheader", { name: "Lee" })).not.toBeInTheDocument();
  });
});
