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

  it("clear fires onChange('') and collapses", () => {
    const onChange = vi.fn();
    render(<RaciChipPicker value="R" onChange={onChange} ariaPrefix="x" lang="en-US" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  // ★★ SC 1.4.1: the selected chip is marked by a RING (a shape cue), not by
  // the brand fill alone — R measures 1.10-1.31:1 and I 2.70-2.84:1 against
  // --surface in the three dark schemes. Pinned in BOTH states: an on-state-only
  // assertion passes against a regression that rings every chip.
  // ★★★ ASSERT ON `classList` TOKENS, NEVER `className.toContain`. `CHIP_BASE`
  // carries `focus:ring-2`, and the string "focus:ring-2" CONTAINS "ring-2" —
  // so a substring assertion makes the negative half vacuously false for every
  // chip, and the positive half true even with the ring deleted.
  it("rings only the selected role chip, and the ring moves with the value", () => {
    const { rerender } = render(<RaciChipPicker value="R" onChange={() => {}} ariaPrefix="x" lang="en-US" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const chip = (role: string) => screen.getByRole("button", { name: role });

    for (const cls of ["ring-2", "ring-[var(--foreground)]", "ring-offset-2", "ring-offset-[var(--surface)]"]) {
      expect(chip("R").classList.contains(cls)).toBe(true);
    }
    for (const role of ["A", "C", "I"]) expect(chip(role).classList.contains("ring-2")).toBe(false);

    // the ring MOVES — it is not merely present on a hardcoded chip
    rerender(<RaciChipPicker value="A" onChange={() => {}} ariaPrefix="x" lang="en-US" />);
    expect(chip("A").classList.contains("ring-2")).toBe(true);
    expect(chip("R").classList.contains("ring-2")).toBe(false);

    // ★ The 20px circle stays. A ToggleButton migration that would have turned
    // these into stadium pills was reverted by user decision; this pins the
    // geometry so it cannot creep back in.
    for (const role of ["R", "A", "C", "I"]) {
      for (const cls of ["h-5", "w-5", "rounded-full"]) {
        expect(chip(role).classList.contains(cls)).toBe(true);
      }
    }
  });
});
