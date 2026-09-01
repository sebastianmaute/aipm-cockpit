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
});
