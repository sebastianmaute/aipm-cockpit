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

  it("prefers an explicit localized gapLabel over the English gapCount suffix", () => {
    const { getByText, queryByText } = render(
      <TrendChart caption="Remaining hours" points={[
        { label: "W22", value: 100, gapBefore: false },
        { label: "W24", value: 80, gapBefore: true },
      ]} gapCount={1} gapLabel="2 Luecken" />,
    );
    expect(getByText(/2 Luecken/)).toBeTruthy();
    expect(queryByText(/1 gap\b/)).toBeNull();
  });

  it("renders an empty-state note when there are fewer than 2 points", () => {
    const { getByText } = render(<TrendChart caption="x" points={[{ label: "W1", value: 1, gapBefore: false }]} emptyLabel="Not enough data" />);
    expect(getByText("Not enough data")).toBeTruthy();
  });

  // 24 weekly labels ("2026-W16") under one 320-unit chart overlapped into an unreadable band.
  const weekly = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ label: `2026-W${String(i + 10).padStart(2, "0")}`, value: i, gapBefore: false }));
  const xLabels = (container: HTMLElement) =>
    [...container.querySelectorAll("text")].map((el) => el.textContent ?? "").filter((s) => s.startsWith("2026-W"));

  it("labels at most six points on a long axis, always the first and the last", () => {
    const { container } = render(<TrendChart caption="Remaining hours" points={weekly(24)} />);
    const labels = xLabels(container);
    expect(labels.length).toBeLessThanOrEqual(6);
    expect(labels.length).toBeGreaterThanOrEqual(4);
    expect(labels[0]).toBe("2026-W10");
    expect(labels.at(-1)).toBe("2026-W33");
  });

  it("labels every point on a short axis", () => {
    const { container } = render(<TrendChart caption="Remaining hours" points={weekly(5)} />);
    expect(xLabels(container)).toEqual(["2026-W10", "2026-W11", "2026-W12", "2026-W13", "2026-W14"]);
  });
});
