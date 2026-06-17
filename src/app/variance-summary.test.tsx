import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { VarianceSummary } from "./variance-summary";
import type { VarianceRow } from "./snapshot";

const rows: VarianceRow[] = [
  { key: "remainingCost", baseline: 100, current: 120, delta: 20, health: "A" },
  { key: "pctComplete", baseline: 40, current: 55, delta: 15, health: "G" },
];

describe("VarianceSummary", () => {
  it("renders one labelled row per KPI with a delta", () => {
    render(<VarianceSummary variance={rows} lang="en-US" />);
    expect(screen.getByText("+20")).toBeInTheDocument();
    expect(screen.getByText("+15%")).toBeInTheDocument();
  });
  it("renders nothing when variance is empty", () => {
    const { container } = render(<VarianceSummary variance={[]} lang="en-US" />);
    expect(container.firstChild).toBeNull();
  });
});
