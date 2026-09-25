import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InsightRecommendationControls } from "./insight-recommendation-controls";
import { t } from "./i18n";
import type { Insight, InsightActions, InsightRecommendation } from "./insights/insight";

function actions(): InsightActions {
  return {
    onAcknowledge: vi.fn(),
    onAct: vi.fn(),
    onDismiss: vi.fn(),
    onGenerateRecommendation: vi.fn(),
    onApplyRecommendation: vi.fn(),
    onRejectRecommendation: vi.fn(),
  };
}

function applied(over: Partial<InsightRecommendation> = {}): Insight {
  return {
    id: 7, key: "k", type: "stalledWork", severity: "high", data: {},
    status: "acted", firstSeenAt: "2026-09-01", lastSeenAt: "2026-09-03", occurrences: 1,
    recommendation: {
      summary: "create a task and update another",
      proposedCalls: [],
      generatedAt: "2026-09-03",
      status: "applied",
      appliedAt: "2026-09-03",
      ...over,
    },
  } as Insight;
}

const GENERATE = `${t("en-US", "insightGenerateRecommendation")} – Stalled work`;

// §351: an `applied` recommendation used to read the same whether every call
// landed or some wrote nothing, and was never re-offered. A recorded refusal
// now reads "Partly applied" and brings the Generate CTA back for the rest.
describe("InsightRecommendationControls — partly applied (§351)", () => {
  it("shows the partial note and the Generate CTA when calls were refused", () => {
    const a = actions();
    render(
      <InsightRecommendationControls insight={applied({ refusedCalls: 2 })} title="Stalled work" lang="en-US" actions={a} />,
    );
    expect(screen.getByText(t("en-US", "insightRecommendationAppliedPartial"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "insightRecommendationApplied"))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: GENERATE }));
    expect(a.onGenerateRecommendation).toHaveBeenCalledWith(7);
  });

  it("keeps the plain applied note, with no CTA, when nothing was refused", () => {
    render(<InsightRecommendationControls insight={applied()} title="Stalled work" lang="en-US" actions={actions()} />);
    expect(screen.getByText(t("en-US", "insightRecommendationApplied"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "insightRecommendationAppliedPartial"))).toBeNull();
    expect(screen.queryByRole("button", { name: GENERATE })).toBeNull();
  });

  it("treats refusedCalls: 0 as a full apply", () => {
    render(
      <InsightRecommendationControls insight={applied({ refusedCalls: 0 })} title="Stalled work" lang="en-US" actions={actions()} />,
    );
    expect(screen.getByText(t("en-US", "insightRecommendationApplied"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: GENERATE })).toBeNull();
  });
});
