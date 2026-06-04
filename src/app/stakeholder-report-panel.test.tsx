import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { StakeholderReportPanel } from "./stakeholder-report-panel";
import type { Stakeholder, Milestone } from "./types";

const milestones: Milestone[] = [
  { id: 1, name: "Sign-off", date: "2026-04-20", linkedTaskIds: [] },
  { id: 2, name: "Go-Live", date: "2026-09-01", linkedTaskIds: [] },
];
const stakeholders: Stakeholder[] = [
  { id: 1, name: "Elena", category: "Sponsor", influence: "High", interest: "High", raci: { "1": "A", "2": "A" } },
  { id: 2, name: "Fictional", category: "Internal", influence: "High", interest: "Medium", raci: { "1": "A", "2": "A" } },
  { id: 3, name: "David", category: "Customer", influence: "Medium", interest: "Medium", raci: {} },
];

describe("StakeholderReportPanel", () => {
  it("shows the total stakeholder count", () => {
    render(<StakeholderReportPanel embedded lang="en-US" stakeholders={stakeholders} milestones={milestones} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });
  it("flags a milestone with multiple Accountables in RACI coverage", () => {
    render(<StakeholderReportPanel embedded lang="en-US" stakeholders={stakeholders} milestones={milestones} />);
    const go = screen.getByText("Go-Live").closest("tr")!;
    expect(within(go).getByText(/multiple/i)).toBeInTheDocument();
  });
  it("renders an empty state with no stakeholders", () => {
    render(<StakeholderReportPanel embedded lang="en-US" stakeholders={[]} milestones={milestones} />);
    expect(screen.getByText(/no stakeholders/i)).toBeInTheDocument();
  });
  it("flags a milestone with no Accountable in RACI coverage", () => {
    const ms = [{ id: 9, name: "Closeout", date: "2026-12-01", linkedTaskIds: [] }];
    const sh = [
      { id: 1, name: "Elena", category: "Sponsor", influence: "High", interest: "High", raci: { "9": "C" } },
    ] as Stakeholder[];
    render(<StakeholderReportPanel embedded lang="en-US" stakeholders={sh} milestones={ms} />);
    const row = screen.getByText("Closeout").closest("tr")!;
    expect(within(row).getByText(/no accountable/i)).toBeInTheDocument();
  });
});
