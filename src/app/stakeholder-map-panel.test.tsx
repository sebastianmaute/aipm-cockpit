import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
  it("shows an empty state when there are no stakeholders", () => {
    render(<StakeholderMapPanel lang="en-US" stakeholders={[]} />);
    expect(screen.getByText(/no stakeholders to plot/i)).toBeInTheDocument();
  });
  it("renders a reset-size button (resizable pane)", () => {
    render(<StakeholderMapPanel lang="en-US" stakeholders={items} />);
    expect(screen.getByRole("button", { name: /reset back to the default size/i })).toBeInTheDocument();
  });
});
