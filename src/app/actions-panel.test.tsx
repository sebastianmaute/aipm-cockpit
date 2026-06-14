import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActionsPanel } from "./actions-panel";
import type { SuggestedAction } from "./next-actions/types";

const mk = (id: string, tier: SuggestedAction["tier"]): SuggestedAction => ({
  id, source: "raid", moduleId: "raid",
  title: { key: "actionRaidTitle", params: [1, id] },
  why: { key: "actionRaidWhySeverity", params: ["High"] },
  score: tier === "now" ? 60 : tier === "soon" ? 30 : 10, tier,
  cta: { kind: "open", view: "raid", id: 1 },
});

describe("ActionsPanel", () => {
  it("renders Now/Soon section headings for present tiers, hides empty ones", () => {
    const { getByText, queryByText } = render(
      <ActionsPanel lang="en-US" actions={[mk("a", "now"), mk("b", "soon")]} onOpen={() => {}} />,
    );
    expect(getByText(/^Now/)).toBeTruthy();
    expect(getByText(/^Soon/)).toBeTruthy();
    expect(queryByText(/^Monitor/)).toBeNull(); // no monitor action → section hidden
  });
  it("shows the empty state when there are no actions", () => {
    const { getByText } = render(<ActionsPanel lang="en-US" actions={[]} onOpen={() => {}} />);
    expect(getByText(/all caught up/i)).toBeTruthy();
  });

  it("collapses the monitor group by default and toggles it", () => {
    const actions = [
      { id: "m1", source: "budget", title: { key: "actionBudgetTitle", params: ["P"] },
        why: { key: "actionBudgetWhyCpi", params: ["0.8"] }, score: 10, tier: "monitor",
        cta: { kind: "open", view: "budget", id: 0 } },
    ] as never;
    render(<ActionsPanel lang="en-US" actions={actions} onOpen={() => {}} />);
    const toggle = screen.getByRole("button", { name: /monitored/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/budget/i)).toBeNull(); // row hidden while collapsed
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});
