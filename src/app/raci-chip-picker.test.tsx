import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RaciChipPicker } from "./raci-chip-picker";

// The chip's accessible name is its aria-label: `${ariaPrefix} — ${roleLabel}`,
// e.g. "M1 · S1 — Responsible". Match by the role label, NOT the letter.
describe("RaciChipPicker", () => {
  it("renders four chips R/A/C/I", () => {
    const { getByRole } = render(
      <RaciChipPicker value="" onChange={() => {}} ariaPrefix="M1 · S1" lang="en-US" />,
    );
    for (const label of ["Responsible", "Accountable", "Consulted", "Informed"]) {
      expect(getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it("clicking an inactive chip sets that role", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <RaciChipPicker value="" onChange={onChange} ariaPrefix="M1 · S1" lang="en-US" />,
    );
    fireEvent.click(getByRole("button", { name: /Responsible/ }));
    expect(onChange).toHaveBeenCalledWith("R");
  });

  it("clicking the active chip clears it", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <RaciChipPicker value="A" onChange={onChange} ariaPrefix="M1 · S1" lang="en-US" />,
    );
    const a = getByRole("button", { name: /Accountable/ });
    expect(a.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(a);
    expect(onChange).toHaveBeenCalledWith("");
  });
});
