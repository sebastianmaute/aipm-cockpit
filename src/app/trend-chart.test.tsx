import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TrendChart } from "./trend-chart";

const points = [
  { label: "W22", value: 100, gapBefore: false },
  { label: "W24", value: 80, gapBefore: true },  // a gap precedes this point
];

describe("TrendChart", () => {
  it("renders a polyline and y-axis tick labels", () => {
    const { container } = render(<TrendChart caption="Remaining hours" points={points} />);
    expect(container.querySelector("polyline")).toBeTruthy();
    expect(container.querySelectorAll("text").length).toBeGreaterThan(0);
  });

  it("renders a shaded gap band when a point has gapBefore", () => {
    const { container } = render(<TrendChart caption="Remaining hours" points={points} />);
    expect(container.querySelector('[data-testid="gap-band"]')).toBeTruthy();
  });

  it("shows the gap count in the caption", () => {
    const { getByText } = render(<TrendChart caption="Remaining hours" points={points} gapCount={1} />);
    expect(getByText(/1 gap/i)).toBeTruthy();
  });

  it("renders an empty-state note when there are fewer than 2 points", () => {
    const { getByText } = render(<TrendChart caption="x" points={[{ label: "W1", value: 1, gapBefore: false }]} emptyLabel="Not enough data" />);
    expect(getByText("Not enough data")).toBeTruthy();
  });
});
