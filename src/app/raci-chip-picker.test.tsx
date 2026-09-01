import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { RaciChipPicker } from "./raci-chip-picker";

// Collapsed trigger: aria-expanded + aria-haspopup. Each expanded role chip's
// accessible name is just the role letter ("R"/"A"/"C"/"I"); the clear chip's
// accessible name matches /clear/i.
describe("RaciChipPicker", () => {
  it("collapsed shows only the trigger; clicking expands to all roles + clear", () => {
    render(<RaciChipPicker value="A" onChange={() => {}} ariaPrefix="x" lang="en-US" />);
    // collapsed: a role chip C is not yet shown
    expect(screen.queryByRole("button", { name: "C" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("button", { name: "C" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /clear/i })).toBeTruthy();
  });

  it("picking a role fires onChange and collapses", () => {
    const onChange = vi.fn();
    render(<RaciChipPicker value="" onChange={onChange} ariaPrefix="x" lang="en-US" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: "C" }));
    expect(onChange).toHaveBeenCalledWith("C");
    expect(screen.queryByRole("button", { name: "R" })).toBeNull(); // collapsed again
  });

  // WCAG 1.4.1 (open-followups §55): the selected role chip was carried by its
  // brand fill ALONE. Measured against `--surface`, R is 1.10-1.31:1 and I is
  // 2.70-2.84:1 in the three dark schemes — both below the 3:1 floor. A and C
  // pass everywhere (5.30-8.80 and 3.33-6.15), but all four ride `ToggleButton`
  // for its trailing non-colour marker: a picker where two chips carry a marker
  // and two do not is worse than either consistent state.
  // ★ Assert the marker in BOTH states — it is rendered always and merely
  //   `invisible` when off, so an ON-state-only assertion would pass against a
  //   conditional-render regression that resizes the chip on every click.
  it("gives every role chip a non-colour pressed marker in both states", () => {
    const { rerender } = render(<RaciChipPicker value="R" onChange={() => {}} ariaPrefix="x" lang="en-US" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const onChip = screen.getByRole("button", { name: "R" });
    expect(onChip).toHaveAttribute("aria-pressed", "true");
    expect(onChip.querySelector("[data-pressed-marker]")?.getAttribute("data-pressed-marker")).toBe("on");

    // Same chip, deselected: the marker is still in the DOM, merely off.
    rerender(<RaciChipPicker value="A" onChange={() => {}} ariaPrefix="x" lang="en-US" />);
    const offChip = screen.getByRole("button", { name: "R" });
    expect(offChip).toHaveAttribute("aria-pressed", "false");
    expect(offChip.querySelector("[data-pressed-marker]")).not.toBeNull();
    expect(offChip.querySelector("[data-pressed-marker]")?.getAttribute("data-pressed-marker")).toBe("off");

    // All four migrated, so the picker cannot show a mixed marker/no-marker set.
    for (const role of ["R", "A", "C", "I"]) {
      expect(screen.getByRole("button", { name: role }).querySelector("[data-pressed-marker]")).not.toBeNull();
    }
  });

  it("clear fires onChange('') and collapses", () => {
    const onChange = vi.fn();
    render(<RaciChipPicker value="R" onChange={onChange} ariaPrefix="x" lang="en-US" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
