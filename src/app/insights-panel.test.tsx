import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InsightsPanel } from "./insights-panel";
import { insightTitle } from "./insights/insight-text";
import type { Insight, InsightStatus } from "./insights/insight";

const TODAY = "2026-06-10";

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
    render(<InsightsPanel insights={FIXTURE} lang="en-US" today={TODAY} />);
    expect(rowHasTitle("milestoneSlip")).toBe(true);
    expect(rowHasTitle("overdueTrend")).toBe(true);
    expect(rowHasTitle("stalledWork")).toBe(true);
    expect(rowHasTitle("budgetVariance")).toBe(false);
    expect(rowHasTitle("raidAging")).toBe(false);
  });

  it("the resolved/history toggle reveals resolved + dismissed rows", async () => {
    const user = userEvent.setup();
    render(<InsightsPanel insights={FIXTURE} lang="en-US" today={TODAY} />);
    await user.click(screen.getByRole("checkbox", { name: /resolved/i }));
    expect(rowHasTitle("budgetVariance")).toBe(true);
    expect(rowHasTitle("raidAging")).toBe(true);
  });

  it("the status filter hides non-matching rows", async () => {
    const user = userEvent.setup();
    render(<InsightsPanel insights={FIXTURE} lang="en-US" today={TODAY} />);
    await user.selectOptions(screen.getByLabelText(/filter by status/i), "active");
    expect(rowHasTitle("milestoneSlip")).toBe(true);
    expect(rowHasTitle("overdueTrend")).toBe(false);
    expect(rowHasTitle("stalledWork")).toBe(false);
  });

  it("the type filter hides non-matching types", async () => {
    const user = userEvent.setup();
    render(<InsightsPanel insights={FIXTURE} lang="en-US" today={TODAY} />);
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
        lang="en-US" today={TODAY}
        actions={{
          onAcknowledge, onAct, onDismiss,
          onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
        }}
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
        lang="en-US" today={TODAY}
        actions={{
          onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
          onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
        }}
        isPopout
      />,
    );
    expect(screen.queryByRole("button", { name: /Acknowledge/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dismiss/ })).not.toBeInTheDocument();
  });

  it("renders an EmptyState (read-only) when there are no insights", () => {
    render(<InsightsPanel insights={[]} lang="en-US" today={TODAY} />);
    expect(screen.getByText("No insights yet")).toBeInTheDocument();
    // read-only: no add-first affordance
    expect(screen.queryByRole("button", { name: /add/i })).not.toBeInTheDocument();
  });

  describe("recommendation UI (#6B SP2)", () => {
    it("shows a 'Recommend fix' CTA when the insight has no recommendation yet", async () => {
      const user = userEvent.setup();
      const onGenerateRecommendation = vi.fn();
      const insight = makeInsight({ id: 3, type: "milestoneSlip", status: "active" });
      const title = titleOf("milestoneSlip");
      render(
        <InsightsPanel
          insights={[insight]}
          lang="en-US" today={TODAY}
          actions={{
            onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
            onGenerateRecommendation, onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
          }}
        />,
      );
      const cta = screen.getByRole("button", { name: `Generate recommendation – ${title}` });
      await user.click(cta);
      expect(onGenerateRecommendation).toHaveBeenCalledWith(3);
    });

    it("disables the CTA and shows a generating label while this insight is generating", () => {
      const insight = makeInsight({ id: 3, type: "milestoneSlip", status: "active" });
      const title = titleOf("milestoneSlip");
      render(
        <InsightsPanel
          insights={[insight]}
          lang="en-US" today={TODAY}
          actions={{
            onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
            onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
          }}
          generatingId={3}
        />,
      );
      const cta = screen.getByRole("button", { name: `Generating… – ${title}` });
      expect(cta).toBeDisabled();
    });

    it("shows the AI summary + Review/Reject buttons when a recommendation is proposed", async () => {
      const user = userEvent.setup();
      const onApplyRecommendation = vi.fn();
      const onRejectRecommendation = vi.fn();
      const insight = makeInsight({
        id: 4,
        type: "milestoneSlip",
        status: "active",
        recommendation: {
          summary: "Reassign the overdue task",
          proposedCalls: [],
          generatedAt: "2026-06-10T00:00:00.000Z",
          status: "proposed",
        },
      });
      const title = titleOf("milestoneSlip");
      render(
        <InsightsPanel
          insights={[insight]}
          lang="en-US" today={TODAY}
          actions={{
            onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
            onGenerateRecommendation: vi.fn(), onApplyRecommendation, onRejectRecommendation,
          }}
        />,
      );
      expect(screen.getByText("AI suggests: Reassign the overdue task")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: `Apply recommendation – ${title}` }));
      expect(onApplyRecommendation).toHaveBeenCalledWith(4);
      await user.click(screen.getByRole("button", { name: `Reject – ${title}` }));
      expect(onRejectRecommendation).toHaveBeenCalledWith(4);
    });

    it("shows a muted applied note and no action buttons once applied", () => {
      const insight = makeInsight({
        id: 5,
        type: "milestoneSlip",
        status: "acted",
        recommendation: {
          summary: "Reassign the overdue task",
          proposedCalls: [],
          generatedAt: "2026-06-10T00:00:00.000Z",
          status: "applied",
          appliedAt: "2026-06-11T00:00:00.000Z",
        },
      });
      render(
        <InsightsPanel
          insights={[insight]}
          lang="en-US" today={TODAY}
          actions={{
            onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
            onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
          }}
        />,
      );
      expect(screen.getByText("Recommendation applied.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Apply recommendation/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Reject/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Generate recommendation/ })).not.toBeInTheDocument();
    });

    it("shows a muted rejected note and no action buttons once rejected", () => {
      const insight = makeInsight({
        id: 6,
        type: "milestoneSlip",
        status: "active",
        recommendation: {
          summary: "Reassign the overdue task",
          proposedCalls: [],
          generatedAt: "2026-06-10T00:00:00.000Z",
          status: "rejected",
        },
      });
      render(
        <InsightsPanel
          insights={[insight]}
          lang="en-US" today={TODAY}
          actions={{
            onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
            onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
          }}
        />,
      );
      expect(screen.getByText("Recommendation dismissed.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Apply recommendation/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Reject/ })).not.toBeInTheDocument();
    });

    it("offers a regenerate CTA alongside the rejected note (#6B SP3)", async () => {
      const user = userEvent.setup();
      const onGenerateRecommendation = vi.fn();
      const insight = makeInsight({
        id: 9,
        type: "milestoneSlip",
        status: "active",
        recommendation: {
          summary: "Reassign the overdue task",
          proposedCalls: [],
          generatedAt: "2026-06-10T00:00:00.000Z",
          status: "rejected",
        },
      });
      const title = titleOf("milestoneSlip");
      render(
        <InsightsPanel
          insights={[insight]}
          lang="en-US" today={TODAY}
          actions={{
            onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
            onGenerateRecommendation, onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
          }}
        />,
      );
      expect(screen.getByText("Recommendation dismissed.")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: `Generate recommendation – ${title}` }));
      expect(onGenerateRecommendation).toHaveBeenCalledWith(9);
    });

    it("hides the regenerate CTA on a rejected recommendation when AI is off (#6B SP3)", () => {
      const insight = makeInsight({
        id: 10,
        type: "milestoneSlip",
        status: "active",
        recommendation: {
          summary: "Reassign the overdue task",
          proposedCalls: [],
          generatedAt: "2026-06-10T00:00:00.000Z",
          status: "rejected",
        },
      });
      render(
        <InsightsPanel
          insights={[insight]}
          lang="en-US" today={TODAY}
          actions={{
            onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
            onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
          }}
          aiEnabled={false}
        />,
      );
      expect(screen.getByText("Recommendation dismissed.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Generate recommendation/ })).not.toBeInTheDocument();
    });

    it("renders no recommendation UI in a popout even with a proposed recommendation", () => {
      const insight = makeInsight({
        id: 7,
        type: "milestoneSlip",
        status: "active",
        recommendation: {
          summary: "Reassign the overdue task",
          proposedCalls: [],
          generatedAt: "2026-06-10T00:00:00.000Z",
          status: "proposed",
        },
      });
      render(
        <InsightsPanel
          insights={[insight]}
          lang="en-US" today={TODAY}
          actions={{
            onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
            onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
          }}
          isPopout
        />,
      );
      expect(screen.queryByRole("button", { name: /Apply recommendation/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Reject/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Generate recommendation/ })).not.toBeInTheDocument();
      expect(screen.queryByText("AI suggests: Reassign the overdue task")).not.toBeInTheDocument();
    });
  });

  describe("outcome badge (#6B SP3)", () => {
    it("renders the measured outcome on an acted insight", () => {
      render(
        <InsightsPanel
          insights={[
            makeInsight({
              id: 8,
              status: "acted",
              outcome: {
                direction: "improved",
                baseline: 10,
                current: 4,
                delta: 6,
                measuredAt: "2026-06-10",
              },
            }),
          ]}
          lang="en-US" today={TODAY}
        />,
      );
      expect(screen.getByText("Improved by 6 since you acted")).toBeInTheDocument();
    });

    it("renders no badge on an acted insight with no measured outcome", () => {
      render(
        <InsightsPanel insights={[makeInsight({ id: 8, status: "acted" })]} lang="en-US" today={TODAY} />,
      );
      expect(screen.queryByText(/since you acted/)).toBeNull();
    });
  });

  describe("digest card (#6B SP4)", () => {
    it("mounts the rolling-window digest when there is something to report", () => {
      render(
        <InsightsPanel
          insights={[makeInsight({ id: 9, status: "active", firstSeenAt: TODAY })]}
          lang="en-US" today={TODAY}
        />,
      );
      expect(screen.getByText(/last 7 days/i)).toBeInTheDocument();
    });

    it("renders no digest when there are no insights at all", () => {
      render(<InsightsPanel insights={[]} lang="en-US" today={TODAY} />);
      expect(screen.queryByText(/last 7 days/i)).toBeNull();
    });
  });

  it("renders row actions as bordered secondary buttons, not ghost", () => {
    render(
      <InsightsPanel
        insights={[makeInsight({ id: 11, type: "milestoneSlip", status: "active" })]}
        lang="en-US" today={TODAY}
        actions={{
          onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
          onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
        }}
      />,
    );
    const dismiss = screen.getByRole("button", { name: `Dismiss – ${titleOf("milestoneSlip")}` });
    expect(dismiss.className).toContain("border-line");
    // ★ Word-bounded on purpose. A bare `toContain("bg-surface")` is VACUOUS here:
    //   the ghost variant is `bg-transparent … hover:bg-surface-muted`, which
    //   contains that substring, so the assertion would pass against the exact
    //   markup it exists to reject.
    expect(dismiss.className).toMatch(/(^|\s)bg-surface(\s|$)/);
    // Ghost's defining trait — assert its absence so a revert fails.
    expect(dismiss.className).not.toContain("bg-transparent");
  });
});
