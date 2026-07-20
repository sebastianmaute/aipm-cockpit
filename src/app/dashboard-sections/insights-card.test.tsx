import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InsightsCard } from "./insights-card";
import { densityClasses } from "../dashboard-density";
import { insightTitle } from "../insights/insight-text";
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
        actions={{ onAcknowledge, onAct, onDismiss }}
      />,
    );
    await user.click(screen.getByRole("button", { name: `Acknowledge – ${title}` }));
    await user.click(screen.getByRole("button", { name: `Act – ${title}` }));
    await user.click(screen.getByRole("button", { name: `Dismiss – ${title}` }));
    expect(onAcknowledge).toHaveBeenCalledWith(7);
    expect(onAct).toHaveBeenCalledWith(7);
    expect(onDismiss).toHaveBeenCalledWith(7);
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
        actions={{ onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn() }}
        isPopout
      />,
    );
    expect(screen.queryByRole("button", { name: /Acknowledge/ })).not.toBeInTheDocument();
  });
});
