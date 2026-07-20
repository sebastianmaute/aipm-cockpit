import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightDigestCard } from "./insight-digest-card";
import { computeInsightDigest } from "./digest";
import type { Insight } from "./insight";

const base = {
  key: "k", type: "stalledWork", severity: "medium", data: { count: 5 },
  lastSeenAt: "2026-07-18", occurrences: 1,
} as const;

const TODAY = "2026-07-20";

describe("InsightDigestCard", () => {
  it("renders nothing when the digest is empty", () => {
    const { container } = render(
      <InsightDigestCard digest={computeInsightDigest([], TODAY)} lang="en-US" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the window title and the windowed counts", () => {
    const list = [{ ...base, id: 1, status: "active", firstSeenAt: "2026-07-18" }] as Insight[];
    render(<InsightDigestCard digest={computeInsightDigest(list, TODAY)} lang="en-US" />);
    expect(screen.getByText(/last 7 days/i)).toBeInTheDocument();
    expect(screen.getByText(/1 new/i)).toBeInTheDocument();
  });

  it("renders a win with its outcome badge magnitude", () => {
    const list = [{
      ...base, id: 1, status: "resolved", firstSeenAt: "2026-07-10",
      actedAt: "2026-07-15", resolvedAt: "2026-07-18",
      outcome: { direction: "improved", baseline: 9, current: 2, delta: 7, measuredAt: "2026-07-18" },
    }] as Insight[];
    render(<InsightDigestCard digest={computeInsightDigest(list, TODAY)} lang="en-US" />);
    expect(screen.getByText(/resolved after you acted/i)).toBeInTheDocument();
    // Narrowed from /7/: the mandated card heading is "Last 7 days", so a bare
    // digit query is ambiguous by construction. This asserts the same thing —
    // the badge carries the measured magnitude.
    expect(screen.getByText(/improved by 7/i)).toBeInTheDocument();
  });

  it("renders the direction-only shape without inventing a magnitude", () => {
    const list = [{
      ...base, id: 1, status: "resolved", firstSeenAt: "2026-07-10",
      actedAt: "2026-07-15", resolvedAt: "2026-07-18",
      outcome: { direction: "improved", baseline: 9, measuredAt: "2026-07-18" },
    }] as Insight[];
    render(<InsightDigestCard digest={computeInsightDigest(list, TODAY)} lang="en-US" />);
    // Narrowed from /resolved/i: the wins heading is "Resolved after you acted",
    // so the bare word is ambiguous. Assert the delta-less badge wording AND
    // that no magnitude was invented.
    expect(screen.getByText(/resolved since you acted/i)).toBeInTheDocument();
    expect(screen.queryByText(/improved by/i)).toBeNull();
  });

  it("caps a long win list and shows a NON-interactive +N more", () => {
    const list = Array.from({ length: 8 }, (_, n) => ({
      ...base, id: n + 1, key: `k${n}`, status: "resolved", firstSeenAt: "2026-07-10",
      resolvedAt: "2026-07-18",
      outcome: { direction: "improved", baseline: 9, measuredAt: "2026-07-18" },
    })) as Insight[];
    render(<InsightDigestCard digest={computeInsightDigest(list, TODAY)} lang="en-US" />);
    const more = screen.getByText(/\+3 more/i);
    expect(more).toBeInTheDocument();
    expect(more.closest("button")).toBeNull(); // deliberately not an affordance
  });

  it("gives each deep-link row a row-UNIQUE accessible name", () => {
    // entityRef is required for a row to BE a deep-link (see the guard test
    // below) — without one these rows would render as plain text.
    const mk = (id: number, count: number) => ({
      ...base, id, key: `k${id}`, data: { count },
      entityRef: { view: "milestones", id: 100 + id }, status: "resolved",
      firstSeenAt: "2026-07-10", resolvedAt: "2026-07-18",
      outcome: { direction: "improved", baseline: 9, measuredAt: "2026-07-18" },
    });
    const list = [mk(1, 4), mk(2, 7)] as Insight[];
    render(
      <InsightDigestCard
        digest={computeInsightDigest(list, TODAY)}
        lang="en-US"
        onOpenInsight={vi.fn()}
      />,
    );
    const names = screen.getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(new Set(names).size).toBe(names.length);
  });

  it("renders rows as plain text, not buttons, when no handler is passed", () => {
    const list = [{
      ...base, id: 1, status: "resolved", firstSeenAt: "2026-07-10", resolvedAt: "2026-07-18",
      outcome: { direction: "improved", baseline: 9, measuredAt: "2026-07-18" },
    }] as Insight[];
    render(<InsightDigestCard digest={computeInsightDigest(list, TODAY)} lang="en-US" />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("only makes a row a button when the insight has an entityRef to open", () => {
    // milestoneSlip/raidAging carry an entityRef; stalledWork/overdueTrend/
    // budgetVariance are portfolio-level and carry NONE. A button for the
    // latter would be a dead affordance even with a handler passed.
    const win = (id: number, count: number, entityRef?: Insight["entityRef"]) => ({
      ...base, id, key: `k${id}`, data: { count }, entityRef, status: "resolved",
      firstSeenAt: "2026-07-10", resolvedAt: "2026-07-18",
      outcome: { direction: "improved", baseline: 9, measuredAt: "2026-07-18" },
    });
    const list = [
      win(1, 4),
      win(2, 7, { view: "milestones", id: 42 }),
    ] as Insight[];
    render(
      <InsightDigestCard
        digest={computeInsightDigest(list, TODAY)}
        lang="en-US"
        onOpenInsight={vi.fn()}
      />,
    );
    // Exactly one of the two rows is interactive: the one with an entityRef.
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    // The accessible name is the visible text unless a collision forced a
    // qualifier, so read it the same way a screen reader would.
    const name = buttons[0].getAttribute("aria-label") ?? buttons[0].textContent ?? "";
    expect(name).toContain("7"); // id 2's data.count
  });

  it("labels the open count as a live state, separate from the windowed counts", () => {
    // openNow is deliberately NOT windowed: it is a current state, not an event
    // in the last 7 days. A record whose only activity predates the window must
    // still contribute to "open now" and must not read as this week's news.
    const list = [{ ...base, id: 1, status: "active", firstSeenAt: "2024-01-01" }] as Insight[];
    render(<InsightDigestCard digest={computeInsightDigest(list, TODAY)} lang="en-US" />);
    expect(screen.getByText(/1 open now/i)).toBeInTheDocument();
    expect(screen.queryByText(/1 new/i)).not.toBeInTheDocument();
  });
});

describe("InsightDigestCard row naming", () => {
  const win = (id: number, name: string) => ({
    ...base, id, key: `k${id}`, type: "milestoneSlip",
    data: { name, daysOverdue: 5, date: "2026-07-01" },
    status: "resolved", firstSeenAt: "2026-07-10", resolvedAt: "2026-07-18",
    entityRef: { view: "milestones", id: 100 + id },
    outcome: { direction: "improved", baseline: 9, current: 2, delta: 7, measuredAt: "2026-07-18" },
  });

  // A redundant aria-label that merely repeats the visible text suppresses the
  // natural accessible name and silently drifts if the label shape changes.
  // Only qualify when qualification is actually needed.
  it("adds no aria-label when the visible text is already unique", () => {
    render(
      <InsightDigestCard
        digest={computeInsightDigest([win(1, "Go-live"), win(2, "Pilot")] as Insight[], TODAY)}
        lang="en-US"
        onOpenInsight={vi.fn()}
      />,
    );
    for (const b of screen.getAllByRole("button")) {
      expect(b.getAttribute("aria-label")).toBeNull();
    }
  });

  // Two milestones sharing a name ("Go-live" per workstream is common) render
  // identical text but navigate to DIFFERENT entities — N identical button
  // names is WCAG 2.4.6, and the axe gate passes it because the live demo
  // seeds only one row.
  it("qualifies colliding row names so each button is distinguishable", () => {
    render(
      <InsightDigestCard
        digest={computeInsightDigest([win(1, "Go-live"), win(2, "Go-live")] as Insight[], TODAY)}
        lang="en-US"
        onOpenInsight={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    const names = buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
    expect(new Set(names).size).toBe(2);
    // WCAG 2.5.3: the accessible name must still CONTAIN the visible text.
    for (const b of buttons) {
      const visible = b.textContent ?? "";
      expect(b.getAttribute("aria-label") ?? visible).toContain(visible);
    }
  });
});
