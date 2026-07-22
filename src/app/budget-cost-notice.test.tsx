import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { CostUnknownNotice } from "./budget-cost-notice";

describe("CostUnknownNotice", () => {
  test("renders nothing when cost is knowable", () => {
    const { container } = render(
      <CostUnknownNotice lang="en-US" reason={null} disciplineNames={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("an empty bucket is told it has no allocations, NOT to fix a rate card", () => {
    render(<CostUnknownNotice lang="en-US" reason="no-rows" disciplineNames={[]} />);
    expect(screen.getByText(/no allocations yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/rate card/i)).not.toBeInTheDocument();
  });

  test("no-rates points at the rate card", () => {
    render(<CostUnknownNotice lang="en-US" reason="no-rates" disciplineNames={[]} />);
    expect(screen.getByText(/no internal rates are set/i)).toBeInTheDocument();
  });

  test("unrated-hours says the figures would be understated", () => {
    render(<CostUnknownNotice lang="en-US" reason="unrated-hours" disciplineNames={[]} />);
    expect(screen.getByText(/understated/i)).toBeInTheDocument();
  });

  test("unpriced-blend names the disciplines", () => {
    render(
      <CostUnknownNotice lang="en-US" reason="unpriced-blend" disciplineNames={["Design", "QA"]} />,
    );
    expect(screen.getByText(/Design, QA/)).toBeInTheDocument();
  });

  test("unpriced-blend with no resolvable names falls back to the rate-card message", () => {
    // Naming nothing would print a dangling "in: ." — the generic message is
    // still true and still actionable.
    render(<CostUnknownNotice lang="en-US" reason="unpriced-blend" disciplineNames={[]} />);
    expect(screen.getByText(/no internal rates are set/i)).toBeInTheDocument();
  });
});
