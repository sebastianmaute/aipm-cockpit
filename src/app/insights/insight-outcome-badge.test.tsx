import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightOutcomeBadge } from "./insight-outcome-badge";
import type { InsightOutcome } from "./insight";

function outcome(patch: Partial<InsightOutcome>): InsightOutcome {
  return {
    direction: "improved",
    baseline: 10,
    current: 4,
    delta: 6,
    measuredAt: "2026-07-20",
    ...patch,
  };
}

describe("InsightOutcomeBadge", () => {
  it("renders the improvement magnitude", () => {
    render(<InsightOutcomeBadge lang="en-US" outcome={outcome({})} />);
    expect(screen.getByText("Improved by 6 since you acted")).toBeTruthy();
  });

  it("renders a POSITIVE magnitude for a worsened outcome (delta is negative)", () => {
    render(
      <InsightOutcomeBadge
        lang="en-US"
        outcome={outcome({ direction: "worsened", baseline: 4, current: 10, delta: -6 })}
      />,
    );
    expect(screen.getByText("Worse by 6 since you acted")).toBeTruthy();
    expect(screen.queryByText(/-6/)).toBeNull();
  });

  it("renders the unchanged wording with no number", () => {
    render(
      <InsightOutcomeBadge
        lang="en-US"
        outcome={outcome({ direction: "unchanged", baseline: 7, current: 7, delta: 0 })}
      />,
    );
    expect(screen.getByText("No change since you acted")).toBeTruthy();
  });

  // The condition cleared a THRESHOLD, so the true current value is unknown —
  // the badge must say the problem is resolved, never invent a magnitude.
  it("states resolution without a magnitude when current/delta are absent", () => {
    render(
      <InsightOutcomeBadge
        lang="en-US"
        outcome={{ direction: "improved", baseline: 10, measuredAt: "2026-07-20" }}
      />,
    );
    expect(screen.getByText("Resolved since you acted")).toBeTruthy();
    expect(screen.queryByText(/Improved by/)).toBeNull();
    expect(screen.queryByText(/10/)).toBeNull();
  });

  it("hides the direction dot from the accessible name", () => {
    const { container } = render(<InsightOutcomeBadge lang="en-US" outcome={outcome({})} />);
    const dot = container.querySelector("[aria-hidden='true']");
    expect(dot).not.toBeNull();
    expect(dot?.textContent).toBe("");
  });
});
