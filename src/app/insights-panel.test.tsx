import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InsightsPanel } from "./insights-panel";
import { insightTitle } from "./insights/insight-text";
import type { Insight, InsightStatus } from "./insights/insight";

function makeInsight(over: Partial<Insight> = {}): Insight {
  return {
    id: 1,
    key: "k1",
    type: "milestoneSlip",
    severity: "high",
    entityRef: { view: "milestones", id: 42 },
    data: { name: "Kickoff", date: "2026-06-01", daysOverdue: 5 },
    status: "active" as InsightStatus,
    firstSeenAt: "2026-06-01T00:00:00.000Z",
    lastSeenAt: "2026-06-10T00:00:00.000Z",
    occurrences: 1,
    ...over,
  };
}

// Distinct-titled fixture covering the full status spectrum.
const FIXTURE: readonly Insight[] = [
  makeInsight({ id: 1, type: "milestoneSlip", status: "active" }),
  makeInsight({ id: 2, type: "overdueTrend", status: "acknowledged", entityRef: undefined, data: { current: 4, delta: 2, prior: 2 } }),
  makeInsight({ id: 3, type: "stalledWork", status: "acted", entityRef: undefined, data: { count: 3 } }),
  makeInsight({ id: 4, type: "budgetVariance", status: "dismissed", entityRef: undefined, data: { name: "CapEx", variancePct: 12, buckets: 2 } }),
  makeInsight({ id: 5, type: "raidAging", status: "resolved", entityRef: { view: "raid", id: 55 }, data: { name: "R-1", daysSinceUpdate: 20, targetDate: "2026-05-01" } }),
];

const titleOf = (type: Insight["type"]) => insightTitle(makeInsight({ type }), "en-US");

// Row titles collide with the type-filter <option> labels (both use the type's
// title text), so assert presence by scanning the rendered list rows only.
const rowHasTitle = (type: Insight["type"]) =>
  screen.queryAllByRole("listitem").some((li) => (li.textContent ?? "").includes(titleOf(type)));

describe("InsightsPanel", () => {
  it("renders open insights (active/acknowledged/acted) and hides resolved+dismissed by default", () => {
    render(<InsightsPanel insights={FIXTURE} lang="en-US" />);
    expect(rowHasTitle("milestoneSlip")).toBe(true);
    expect(rowHasTitle("overdueTrend")).toBe(true);
    expect(rowHasTitle("stalledWork")).toBe(true);
    expect(rowHasTitle("budgetVariance")).toBe(false);
    expect(rowHasTitle("raidAging")).toBe(false);
  });

  it("the resolved/history toggle reveals resolved + dismissed rows", async () => {
    const user = userEvent.setup();
    render(<InsightsPanel insights={FIXTURE} lang="en-US" />);
    await user.click(screen.getByRole("checkbox", { name: /resolved/i }));
    expect(rowHasTitle("budgetVariance")).toBe(true);
    expect(rowHasTitle("raidAging")).toBe(true);
  });

  it("the status filter hides non-matching rows", async () => {
    const user = userEvent.setup();
    render(<InsightsPanel insights={FIXTURE} lang="en-US" />);
    await user.selectOptions(screen.getByLabelText(/filter by status/i), "active");
    expect(rowHasTitle("milestoneSlip")).toBe(true);
    expect(rowHasTitle("overdueTrend")).toBe(false);
    expect(rowHasTitle("stalledWork")).toBe(false);
  });

  it("the type filter hides non-matching types", async () => {
    const user = userEvent.setup();
    render(<InsightsPanel insights={FIXTURE} lang="en-US" />);
    await user.selectOptions(screen.getByLabelText(/filter by type/i), "overdueTrend");
    expect(rowHasTitle("overdueTrend")).toBe(true);
    expect(rowHasTitle("milestoneSlip")).toBe(false);
  });

  it("wires lifecycle controls with row-unique names and calls the handler with the id", async () => {
    const user = userEvent.setup();
    const onAcknowledge = vi.fn();
    const onAct = vi.fn();
    const onDismiss = vi.fn();
    render(
      <InsightsPanel
        insights={[makeInsight({ id: 7, type: "milestoneSlip", status: "active" })]}
        lang="en-US"
        actions={{ onAcknowledge, onAct, onDismiss }}
      />,
    );
    const title = titleOf("milestoneSlip");
    await user.click(screen.getByRole("button", { name: `Acknowledge – ${title}` }));
    await user.click(screen.getByRole("button", { name: `Act – ${title}` }));
    await user.click(screen.getByRole("button", { name: `Dismiss – ${title}` }));
    expect(onAcknowledge).toHaveBeenCalledWith(7);
    expect(onAct).toHaveBeenCalledWith(7);
    expect(onDismiss).toHaveBeenCalledWith(7);
  });

  it("hides lifecycle write controls in popouts (read-only)", () => {
    render(
      <InsightsPanel
        insights={[makeInsight({ id: 1, status: "active" })]}
        lang="en-US"
        actions={{ onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn() }}
        isPopout
      />,
    );
    expect(screen.queryByRole("button", { name: /Acknowledge/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dismiss/ })).not.toBeInTheDocument();
  });

  it("renders an EmptyState (read-only) when there are no insights", () => {
    render(<InsightsPanel insights={[]} lang="en-US" />);
    expect(screen.getByText("No insights yet")).toBeInTheDocument();
    // read-only: no add-first affordance
    expect(screen.queryByRole("button", { name: /add/i })).not.toBeInTheDocument();
  });
});
