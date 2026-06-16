import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfluenceInterestMatrix } from "./influence-interest-matrix";
import { t } from "./i18n";

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

describe("InfluenceInterestMatrix — needs-communication jump", () => {
  const COMMS_LABEL = t("en-US", "stakeholderNeedsComms");

  it("renders a labeled needs-communication button when the stakeholder has a pending comms action", () => {
    render(
      <InfluenceInterestMatrix
        lang="en-US"
        influence="High"
        interest="Medium"
        onPick={vi.fn()}
        stakeholderId={7}
        commsPendingStakeholderIds={new Set([7])}
        onJumpToComms={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: COMMS_LABEL })).toBeInTheDocument();
  });

  it("calls onJumpToComms with the stakeholder id when the icon is clicked", () => {
    const onJumpToComms = vi.fn();
    render(
      <InfluenceInterestMatrix
        lang="en-US"
        influence="High"
        interest="Medium"
        onPick={vi.fn()}
        stakeholderId={7}
        commsPendingStakeholderIds={new Set([7])}
        onJumpToComms={onJumpToComms}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: COMMS_LABEL }));
    expect(onJumpToComms).toHaveBeenCalledWith(7);
  });

  it("renders no needs-communication button when the stakeholder is not in the pending set", () => {
    render(
      <InfluenceInterestMatrix
        lang="en-US"
        influence="High"
        interest="Medium"
        onPick={vi.fn()}
        stakeholderId={7}
        commsPendingStakeholderIds={new Set([99])}
        onJumpToComms={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: COMMS_LABEL })).toBeNull();
  });
});
