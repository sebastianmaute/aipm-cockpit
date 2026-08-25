import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InsightsPanel } from "./insights-panel";
import { insightTitle } from "./insights/insight-text";
import { t } from "./i18n";
import { expectSecondaryButton } from "../test/button-variant";
import { expectRowUniqueNames } from "../test/row-unique-names";
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

  it("gives two insights of the SAME type distinct row-unique names", () => {
    // ★★ detect.ts mints one milestoneSlip per overdue milestone, so two rows of
    // one type is the ORDINARY case, not a contrived one. The panel's existing
    // FIXTURE is distinct-titled by construction and cannot express the collision.
    render(
      <InsightsPanel
        insights={[
          makeInsight({ id: 7, type: "milestoneSlip" }),
          makeInsight({ id: 8, type: "milestoneSlip" }),
        ]}
        lang="en-US" today={TODAY}
        onOpen={vi.fn()}
        actions={{
          onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
          onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
        }}
      />,
    );
    expectRowUniqueNames({ minRows: 2 });
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

    it("turns the CTA into an OPERABLE Stop while a recommendation is generating", async () => {
      // Was: disabled + a "Generating…" label. The CTA is the shared
      // AiTriggerButton now — a billed call always has a way to abort it.
      // ★ Exact name, never /generate|stop/i: an alternation would also match
      //   the idle button. ★ The `– ${title}` suffix is row-uniqueness (WCAG
      //   2.4.6), which the axe gate is blind to.
      const user = userEvent.setup();
      const onCancelGenerate = vi.fn();
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
          onCancelGenerate={onCancelGenerate}
        />,
      );
      const cta = screen.getByRole("button", { name: `Stop – ${title}` });
      expect(cta).not.toBeDisabled();
      await user.click(cta);
      expect(onCancelGenerate).toHaveBeenCalledTimes(1);
    });

    it("shows Stop on ONLY the generating row, leaving the others runnable", async () => {
      // ★ THE reason `busy` is per-row and not the hook's global in-flight flag.
      //   With the global flag every row here would read "Stop", leaving a user
      //   who wants to generate the OTHER row no way to say so. `onCancel` stays
      //   global and that is still correct: only one generate can be in flight,
      //   so the global cancel IS the running row's call.
      // ★ A one-insight fixture CANNOT observe this — it passes either way.
      const user = userEvent.setup();
      const onGenerateRecommendation = vi.fn();
      const onCancelGenerate = vi.fn();
      const generating = makeInsight({ id: 3, type: "milestoneSlip", status: "active" });
      const idle = makeInsight({ id: 4, type: "stalledWork", status: "active", entityRef: undefined, data: { count: 3 } });
      render(
        <InsightsPanel
          insights={[generating, idle]}
          lang="en-US" today={TODAY}
          actions={{
            onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
            onGenerateRecommendation, onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
          }}
          generatingId={3}
          onCancelGenerate={onCancelGenerate}
        />,
      );
      const generate = t("en-US", "insightGenerateRecommendation");

      // The generating row: named Stop, and its click CANCELS.
      await user.click(screen.getByRole("button", { name: `Stop – ${titleOf("milestoneSlip")}` }));
      expect(onCancelGenerate).toHaveBeenCalledTimes(1);

      // The OTHER row: still named for its idle action, and its click GENERATES
      // for its own id. ★ Asserting only that the label is present would not
      // catch a button that is labelled "Generate" but wired to cancel — the
      // click is what proves the row is actually still runnable.
      await user.click(screen.getByRole("button", { name: `${generate} – ${titleOf("stalledWork")}` }));
      expect(onGenerateRecommendation).toHaveBeenCalledTimes(1);
      expect(onGenerateRecommendation).toHaveBeenCalledWith(4);
      expect(onCancelGenerate).toHaveBeenCalledTimes(1); // unchanged by that click

      // And the idle row is NOT a second Stop.
      expect(screen.queryByRole("button", { name: `Stop – ${titleOf("stalledWork")}` })).toBeNull();
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

  // ★★ These pin the ghost→secondary conversion at call sites that would
  //    otherwise revert silently. `expectSecondaryButton` is word-bounded
  //    because the obvious substring form passes against `ghost` — see
  //    `src/test/button-variant.ts`. The killing mutation for each assertion is
  //    flipping that one call site back to `variant="ghost"`.
  describe("row action button variant", () => {
    const ACTIONS = {
      onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
      onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
    };
    const TITLE = titleOf("milestoneSlip");

    it("renders the panel's own row actions as bordered secondary buttons, not ghost", () => {
      render(
        <InsightsPanel
          insights={[makeInsight({ id: 11, type: "milestoneSlip", status: "active" })]}
          lang="en-US" today={TODAY}
          onOpen={vi.fn()}
          actions={ACTIONS}
        />,
      );
      // All four of `insights-panel.tsx`'s converted Buttons. Open needs an
      // `entityRef` (the fixture default) AND `onOpen`; Acknowledge needs the
      // status to still be "active".
      for (const name of ["Open", "Acknowledge", "Act", "Dismiss"]) {
        expectSecondaryButton(screen.getByRole("button", { name: `${name} – ${TITLE}` }));
      }
      // Ghost's defining trait. Redundant with the helper's two positives, but
      // it names the failure mode this conversion is guarding against.
      expect(screen.getByRole("button", { name: `Dismiss – ${TITLE}` }).className).not.toContain("bg-transparent");
    });

    // `insight-recommendation-controls.tsx` is a SHARED component (this panel +
    // the dashboard InsightsCard) and has no test file of its own, so its three
    // converted Buttons are pinned through the panel that renders it. They are
    // gated on recommendation state, which is why this takes two fixtures.
    it("renders the Generate CTA as a bordered secondary button when there is no recommendation", () => {
      render(
        <InsightsPanel
          insights={[makeInsight({ id: 12, type: "milestoneSlip", status: "active" })]}
          lang="en-US" today={TODAY}
          actions={ACTIONS}
        />,
      );
      // `aiEnabled` is deliberately omitted: undefined means "unknown" and the
      // component treats it as enabled, which is what renders this CTA at all.
      expectSecondaryButton(screen.getByRole("button", { name: `Generate recommendation – ${TITLE}` }));
    });

    it("renders the Apply/Reject controls as bordered secondary buttons when one is proposed", () => {
      render(
        <InsightsPanel
          insights={[makeInsight({
            id: 13, type: "milestoneSlip", status: "active",
            recommendation: {
              summary: "Reassign the overdue task",
              proposedCalls: [],
              generatedAt: "2026-06-10T00:00:00.000Z",
              status: "proposed",
            },
          })]}
          lang="en-US" today={TODAY}
          actions={ACTIONS}
        />,
      );
      // A "proposed" recommendation REPLACES the Generate CTA with these two,
      // so the fixture above cannot reach them.
      expectSecondaryButton(screen.getByRole("button", { name: `Apply recommendation – ${TITLE}` }));
      expectSecondaryButton(screen.getByRole("button", { name: `Reject – ${TITLE}` }));
    });
  });
});
