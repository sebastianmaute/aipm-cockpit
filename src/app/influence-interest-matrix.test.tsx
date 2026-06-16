import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfluenceInterestMatrix } from "./influence-interest-matrix";

describe("InfluenceInterestMatrix", () => {
  it("renders 9 cells and marks the selected one pressed", () => {
    render(<InfluenceInterestMatrix lang="en-US" influence="High" interest="Medium" onPick={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(9);
    const selected = screen.getByRole("button", { name: /influence high.*interest medium/i });
    expect(selected).toHaveAttribute("aria-pressed", "true");
  });

  it("renders each cell label inside a solid chip wrapper for contrast", () => {
    render(<InfluenceInterestMatrix lang="en-US" influence="High" interest="Medium" onPick={vi.fn()} />);
    const chips = screen.getAllByTestId("ii-cell-chip");
    expect(chips).toHaveLength(9);
    for (const chip of chips) {
      expect(chip).toHaveClass("bg-surface");
      expect(chip).toHaveClass("text-foreground");
    }
  });

  it("calls onPick with the clicked cell's influence and interest", () => {
    const onPick = vi.fn();
    render(<InfluenceInterestMatrix lang="en-US" influence="Low" interest="Low" onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /influence high.*interest high/i }));
    expect(onPick).toHaveBeenCalledWith("High", "High");
  });
});
