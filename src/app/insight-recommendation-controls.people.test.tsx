import { beforeAll, describe, it, expect, vi } from "vitest";
// AI people protection: an insight about one person gets no recommendation while the project protects its people
// (`insightReachesAi`), so its Generate CTA would be a dead button. Every branch that offers Generate shows a muted
// note instead; an insight about no one, or protection off, keeps the CTA.
import { render, screen } from "@testing-library/react";
import { InsightRecommendationControls } from "./insight-recommendation-controls";
import { loadI18n, t } from "./i18n";
import type { Insight, InsightActions, InsightRecommendation } from "./insights/insight";

beforeAll(() => loadI18n("de"));

function actions(peopleProtected?: boolean): InsightActions {
  return {
    onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
    onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
    ...(peopleProtected === undefined ? {} : { peopleProtected }),
  };
}

const rec = (over: Partial<InsightRecommendation>): InsightRecommendation =>
  ({ summary: "s", proposedCalls: [], generatedAt: "2026-09-03", status: "proposed", ...over }) as InsightRecommendation;

const PERSON_DATA = { person: "#4711", count: 2, threshold: 8 };
function insight(data: Insight["data"], recommendation?: InsightRecommendation): Insight {
  return {
    id: 7, key: "timelog:timelogCapPerDay:4711", type: "timelogCapPerDay", severity: "medium", data,
    status: "active", firstSeenAt: "2026-09-01", lastSeenAt: "2026-09-03", occurrences: 1,
    ...(recommendation ? { recommendation } : {}),
  } as Insight;
}

const GENERATE = `${t("en-US", "insightGenerateRecommendation")} – Row`;
const NOTE = () => t("en-US", "insightRecommendationPeopleProtected");

// The three branches that offer Generate: no recommendation, a rejected one, a partly applied one.
const BRANCHES: readonly [string, InsightRecommendation | undefined][] = [
  ["no recommendation yet", undefined],
  ["a rejected recommendation", rec({ status: "rejected" })],
  ["a partly applied recommendation", rec({ status: "applied", appliedAt: "2026-09-03", refusedCalls: 1 })],
];

describe.each(BRANCHES)("InsightRecommendationControls under people protection — %s", (_name, recommendation) => {
  it("an insight about one person shows the note, not Generate", () => {
    render(<InsightRecommendationControls insight={insight(PERSON_DATA, recommendation)} title="Row" lang="en-US" actions={actions(true)} />);
    expect(screen.getByText(NOTE())).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: GENERATE })).toBeNull();
  });

  it("an insight about no one keeps Generate", () => {
    render(<InsightRecommendationControls insight={insight({ count: 3 }, recommendation)} title="Row" lang="en-US" actions={actions(true)} />);
    expect(screen.getByRole("button", { name: GENERATE })).toBeInTheDocument();
    expect(screen.queryByText(NOTE())).toBeNull();
  });

  it.each([false, undefined])("protection %s keeps Generate for the person's insight", (flag) => {
    render(<InsightRecommendationControls insight={insight(PERSON_DATA, recommendation)} title="Row" lang="en-US" actions={actions(flag)} />);
    expect(screen.getByRole("button", { name: GENERATE })).toBeInTheDocument();
    expect(screen.queryByText(NOTE())).toBeNull();
  });
});

describe("InsightRecommendationControls under people protection — the other branches", () => {
  it("a fully applied recommendation shows its applied note only", () => {
    const applied = rec({ status: "applied", appliedAt: "2026-09-03" });
    render(<InsightRecommendationControls insight={insight(PERSON_DATA, applied)} title="Row" lang="en-US" actions={actions(true)} />);
    expect(screen.getByText(t("en-US", "insightRecommendationApplied"))).toBeInTheDocument();
    expect(screen.queryByText(NOTE())).toBeNull();
  });

  it("a proposed recommendation keeps Reject", () => {
    render(<InsightRecommendationControls insight={insight(PERSON_DATA, rec({}))} title="Row" lang="en-US" actions={actions(true)} />);
    expect(screen.getByRole("button", { name: `${t("en-US", "insightRejectRecommendation")} – Row` })).toBeInTheDocument();
  });

  it("the note has a German text with real umlauts", () => {
    render(<InsightRecommendationControls insight={insight(PERSON_DATA)} title="Row" lang="de" actions={actions(true)} />);
    const de = t("de", "insightRecommendationPeopleProtected");
    expect(de).not.toBe(t("en-US", "insightRecommendationPeopleProtected"));
    expect(de).toMatch(/[äöüß]/);
    expect(screen.getByText(de)).toBeInTheDocument();
  });
});
