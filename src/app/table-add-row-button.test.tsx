import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TableAddRowButton } from "./table-add-row-button";

// §102: the dashed, full-width "+ Add …" row that trails a register table. It was
// hand-rolled twice (Open Points and RAID) with one class string between them.
describe("TableAddRowButton", () => {
  it("renders a dashed full-width row button with the label and fires onClick", () => {
    const onClick = vi.fn();
    render(<TableAddRowButton label="Add task" ariaLabel="Add task – Risk" onClick={onClick} />);
    const btn = screen.getByRole("button", { name: "Add task – Risk" });
    expect(btn).toHaveAttribute("type", "button");
    expect(btn).toHaveTextContent("Add task");
    for (const token of ["w-full", "border-b", "border-dashed", "border-line", "focus:ring-2"]) {
      expect(btn.className.split(/\s+/)).toContain(token);
    }
    // The plus glyph is decoration: the accessible name comes from aria-label alone.
    expect(btn.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("falls back to the label as the accessible name when no ariaLabel is given", () => {
    render(<TableAddRowButton label="Add task" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Add task" })).toBeInTheDocument();
  });
});
