import { describe, expect, it, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { StakeholderMapPanel } from "./stakeholder-map-panel";
import type { Stakeholder } from "./types";

const items: Stakeholder[] = [
  { id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "High", raci: {} },
  { id: 2, name: "Lee", category: "Internal", influence: "Low", interest: "Low", raci: {} },
];

describe("StakeholderMapPanel", () => {
  it("plots each stakeholder in its quadrant", () => {
    render(<StakeholderMapPanel lang="en-US" stakeholders={items} />);
    const manage = screen.getByTestId("quadrant-manage-closely");
    expect(within(manage).getByText("Sam")).toBeInTheDocument();
    const monitor = screen.getByTestId("quadrant-monitor");
    expect(within(monitor).getByText("Lee")).toBeInTheDocument();
  });
  it("plots non-interactive text chips when no open handler is given", () => {
    render(<StakeholderMapPanel lang="en-US" stakeholders={items} />);
    expect(screen.queryByRole("button", { name: /Sam/ })).toBeNull();
  });
  it("makes chips clickable buttons that open the stakeholder editor when wired", () => {
    const onOpenStakeholder = vi.fn();
    render(
      <StakeholderMapPanel lang="en-US" stakeholders={items} onOpenStakeholder={onOpenStakeholder} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Sam/ }));
    expect(onOpenStakeholder).toHaveBeenCalledWith(1);
  });
  it("shows an empty state when there are no stakeholders", () => {
    render(<StakeholderMapPanel lang="en-US" stakeholders={[]} />);
    expect(screen.getByText(/no stakeholders to plot/i)).toBeInTheDocument();
  });
  it("renders the map in the centered half-size pane (chat sizing)", () => {
    const { container } = render(<StakeholderMapPanel lang="en-US" stakeholders={[]} />);
    const pane = container.querySelector("[data-testid='stakeholder-map-pane']")!;
    expect(pane.className).toContain("mx-auto"); // centered
    expect(pane.className).toContain("w-[50%]");
  });
});
