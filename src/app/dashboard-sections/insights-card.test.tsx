import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InsightsCard } from "./insights-card";
import { densityClasses } from "../dashboard-density";
import { loadI18n, t } from "../i18n";
import { insightTitle } from "../insights/insight-text";
import { expectSecondaryButton } from "../../test/button-variant";
import type { Insight, InsightStatus } from "../insights/insight";

const dc = densityClasses("comfortable");

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

describe("InsightsCard", () => {
  it("returns null (renders nothing) when there are no active insights", () => {
    const { container } = render(<InsightsCard insights={[]} lang="en-US" dc={dc} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("excludes resolved and dismissed insights", () => {
    const { container } = render(
      <InsightsCard
        insights={[
          makeInsight({ id: 1, status: "resolved" }),
          makeInsight({ id: 2, status: "dismissed" }),
        ]}
        lang="en-US"
        dc={dc}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders active AND acknowledged insights, sorted by severity (high first)", () => {
    render(
      <InsightsCard
        insights={[
          makeInsight({ id: 1, type: "stalledWork", severity: "low", data: { count: 3 }, entityRef: undefined }),
          makeInsight({ id: 2, type: "milestoneSlip", severity: "high", status: "acknowledged" }),
        ]}
        lang="en-US"
        dc={dc}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // high (milestoneSlip) must come before low (stalledWork)
    expect(within(items[0]).getByText(insightTitle(makeInsight({ type: "milestoneSlip" }), "en-US"))).toBeInTheDocument();
  });

  it("renders a severity dot as a graphic (role=img), not colored text", () => {
    render(<InsightsCard insights={[makeInsight()]} lang="en-US" dc={dc} />);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByRole("img")).toBeInTheDocument();
  });

  it("wires ack/act/dismiss to the matching handler with the insight id and row-unique names", async () => {
    const user = userEvent.setup();
    const onAcknowledge = vi.fn();
    const onAct = vi.fn();
    const onDismiss = vi.fn();
    const insight = makeInsight({ id: 7 });
    const title = insightTitle(insight, "en-US");
    render(
      <InsightsCard
        insights={[insight]}
        lang="en-US"
        dc={dc}
        actions={{
          onAcknowledge, onAct, onDismiss,
          onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: `Acknowledge – ${title}` }));
    await user.click(screen.getByRole("button", { name: `Act – ${title}` }));
    await user.click(screen.getByRole("button", { name: `Dismiss – ${title}` }));
    expect(onAcknowledge).toHaveBeenCalledWith(7);
    expect(onAct).toHaveBeenCalledWith(7);
    expect(onDismiss).toHaveBeenCalledWith(7);
  });

  // ★ "Acknowledge" and "Act" are both one-word verbs for effects the word does
  //   not carry: acknowledging leaves the insight in the list and still OPEN
  //   (`SURFACED_STATUSES` includes "acknowledged"), and the FIRST Act also
  //   captures today's metric as the outcome baseline — a one-shot side effect.
  // ★★ Act also NAVIGATES (`onActInsight` in task-manager.tsx calls requestOpen
  //   for the insight's entityRef). That omission mattered more than the others:
  //   the adjacent "Open" button exists solely to navigate, so a hint silent on
  //   it reads as a promise that Act stays put, and clicking Act on the
  //   Dashboard threw the user into another view mid-triage.
  // ★★ The expected text is hardcoded rather than read through `t(…)`: a
  //   missing key makes `t` echo the key, so a `t`-based assertion would compare
  //   the attribute to itself and pass over a deleted string.
  it("titles Acknowledge and Act with the effect their one-word labels omit", () => {
    const insight = makeInsight({ id: 7 });
    const title = insightTitle(insight, "en-US");
    render(
      <InsightsCard
        insights={[insight]}
        lang="en-US"
        dc={dc}
        actions={{
          onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
          onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
        }}
      />,
    );
    expect(screen.getByRole("button", { name: `Acknowledge – ${title}` })).toHaveAttribute(
      "title",
      "Mark as seen. It stays in the list and still counts as open.",
    );
    expect(screen.getByRole("button", { name: `Act – ${title}` })).toHaveAttribute(
      "title",
      "Record that you acted and capture today's metric as the baseline for measuring the outcome; if the insight points at an item, this also opens it and leaves the current view",
    );
  });

  it("fires the deep-link handler with the entityRef when present", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const insight = makeInsight({ id: 9, entityRef: { view: "raid", id: 55 } });
    const title = insightTitle(insight, "en-US");
    render(<InsightsCard insights={[insight]} lang="en-US" dc={dc} onOpen={onOpen} />);
    await user.click(screen.getByRole("button", { name: `Open – ${title}` }));
    expect(onOpen).toHaveBeenCalledWith({ view: "raid", id: 55 });
  });

  it("hides lifecycle controls in popouts (read-only)", () => {
    render(
      <InsightsCard
        insights={[makeInsight()]}
        lang="en-US"
        dc={dc}
        actions={{
          onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
          onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
        }}
        isPopout
      />,
    );
    expect(screen.queryByRole("button", { name: /Acknowledge/ })).not.toBeInTheDocument();
  });

  describe("recommendation UI (#6B SP2)", () => {
    it("shows a 'Recommend fix' CTA when the insight has no recommendation yet", async () => {
      const user = userEvent.setup();
      const onGenerateRecommendation = vi.fn();
      const insight = makeInsight({ id: 3 });
      const title = insightTitle(insight, "en-US");
      render(
        <InsightsCard
          insights={[insight]}
          lang="en-US"
          dc={dc}
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

    it("hides the Generate CTA when AI is disabled (aiEnabled=false)", () => {
      const insight = makeInsight({ id: 3 });
      render(
        <InsightsCard
          insights={[insight]}
          lang="en-US"
          dc={dc}
          aiEnabled={false}
          actions={{
            onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
            onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
          }}
        />,
      );
      expect(screen.queryByRole("button", { name: /Generate recommendation/ })).not.toBeInTheDocument();
    });

    it("turns the CTA into an OPERABLE Stop while a recommendation is generating", async () => {
      // Was: disabled + a "Generating…" label. The CTA is the shared
      // AiTriggerButton now, so a billed call is never left running with no way
      // to abort it — the control stays enabled and its click cancels.
      //
      // ★ The name is matched EXACTLY. A regex alternation like /generate|stop/i
      //   would also match the IDLE button and stop testing the busy state.
      // ★ The row-unique `– ${title}` suffix is asserted here on purpose: every
      //   row renders this CTA, so an unqualified name is a WCAG 2.4.6
      //   collision the axe gate cannot see.
      const user = userEvent.setup();
      const onCancelGenerate = vi.fn();
      const insight = makeInsight({ id: 3 });
      const title = insightTitle(insight, "en-US");
      render(
        <InsightsCard
          insights={[insight]}
          lang="en-US"
          dc={dc}
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

    it("shows the AI summary + Review/Reject buttons when a recommendation is proposed", async () => {
      const user = userEvent.setup();
      const onApplyRecommendation = vi.fn();
      const onRejectRecommendation = vi.fn();
      const insight = makeInsight({
        id: 4,
        recommendation: {
          summary: "Reassign the overdue task",
          proposedCalls: [],
          generatedAt: "2026-06-10T00:00:00.000Z",
          status: "proposed",
        },
      });
      const title = insightTitle(insight, "en-US");
      render(
        <InsightsCard
          insights={[insight]}
          lang="en-US"
          dc={dc}
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
        recommendation: {
          summary: "Reassign the overdue task",
          proposedCalls: [],
          generatedAt: "2026-06-10T00:00:00.000Z",
          status: "applied",
          appliedAt: "2026-06-11T00:00:00.000Z",
        },
      });
      render(
        <InsightsCard
          insights={[insight]}
          lang="en-US"
          dc={dc}
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
        recommendation: {
          summary: "Reassign the overdue task",
          proposedCalls: [],
          generatedAt: "2026-06-10T00:00:00.000Z",
          status: "rejected",
        },
      });
      render(
        <InsightsCard
          insights={[insight]}
          lang="en-US"
          dc={dc}
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

    it("renders no recommendation UI in a popout even with a proposed recommendation", () => {
      const insight = makeInsight({
        id: 7,
        recommendation: {
          summary: "Reassign the overdue task",
          proposedCalls: [],
          generatedAt: "2026-06-10T00:00:00.000Z",
          status: "proposed",
        },
      });
      render(
        <InsightsCard
          insights={[insight]}
          lang="en-US"
          dc={dc}
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

  // ★★ Pins the ghost→secondary conversion of THIS file's four row-action
  //    Buttons. Without it, reverting `insights-card.tsx` to `variant="ghost"`
  //    left the whole suite green: the only CALL-SITE variant assertion was in
  //    `insights-panel.test.tsx`, over a different component. (`button.test.tsx`
  //    asserts the variants too, but on the primitive — it pins what each
  //    variant EMITS, never which variant a given call site asks for.)
  //    Killing mutation: flip any one of the four `variant="secondary"` props in
  //    `insights-card.tsx` back to `variant="ghost"`.
  // ★ `expectSecondaryButton` is word-bounded because the obvious
  //   `toContain("bg-surface")` form matches ghost's `hover:bg-surface-muted`
  //   and passes against the exact markup it exists to reject. See
  //   `src/test/button-variant.ts`.
  it("renders its row actions as bordered secondary buttons, not ghost", () => {
    const insight = makeInsight({ id: 8 });
    const title = insightTitle(insight, "en-US");
    render(
      <InsightsCard
        insights={[insight]}
        lang="en-US"
        dc={dc}
        onOpen={vi.fn()}
        actions={{
          onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
          onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
        }}
      />,
    );
    // Open needs `entityRef` (the fixture default) AND `onOpen`; Acknowledge
    // needs status "active" (also the default) — so all four render together.
    for (const name of ["Open", "Acknowledge", "Act", "Dismiss"]) {
      expectSecondaryButton(screen.getByRole("button", { name: `${name} – ${title}` }));
    }
    // Ghost's defining trait. Redundant with the helper's positives, but names
    // the failure mode explicitly.
    expect(screen.getByRole("button", { name: `Act – ${title}` }).className).not.toContain("bg-transparent");
  });

  // ★★ The card is UNBOXED and UN-TITLED because the arrangeable tile chrome
  //    (`dashboard-tile.tsx`) draws the border and renders the `<h3>`. It used
  //    to render `<Card boxed><h3>Insights</h3>`, which stacked two borders and
  //    two identical headings inside the tile.
  // ★ There is deliberately no `chromeless`/`heading` opt-out prop, so there is
  //   no second branch to cover: `buildTileBodies` is the component's ONLY call
  //   site. Reproduce with
  //   `grep -rn "InsightsCard" src --include="*.tsx" | grep -v "\.test\."`.
  //   `insights-panel.tsx` renders its own list and merely shares the
  //   `insightsCardTitle` string.
  // Killing mutation: wrap the returned `<ul>` in `<Card boxed>` (root becomes a
  //   bordered DIV) or re-add the `<h3>` (the heading query finds one).
  describe("tile-chrome contract", () => {
    it("renders the list as its own root — no card box of its own", () => {
      const { container } = render(<InsightsCard insights={[makeInsight()]} lang="en-US" dc={dc} />);
      const root = container.firstElementChild!;
      expect(root.tagName).toBe("UL");
      expect(root.className).not.toContain("rounded-lg");
      expect(root.className).not.toContain("border-line");
    });

    it("renders no heading of its own", () => {
      render(<InsightsCard insights={[makeInsight()]} lang="en-US" dc={dc} />);
      expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    });

    // ★★ The REASON the heading could go is that its text DUPLICATED the chrome
    //    title — not that bodies never have headings (`RaidRegisterCard` keeps
    //    "Top open RAID" precisely because it differs from "RAID register").
    //    So pin the duplication: if `dashboardInsights` is ever reworded, this
    //    goes red and the removal has to be reconsidered rather than silently
    //    leaving the tile's list unlabelled.
    it("dropped a heading that duplicated the tile's own title, in BOTH dictionaries", async () => {
      expect(t("en-US", "dashboardInsights")).toBe(t("en-US", "insightsCardTitle"));
      await loadI18n("de");
      expect(t("de", "dashboardInsights")).toBe(t("de", "insightsCardTitle"));
    });
  });
});
