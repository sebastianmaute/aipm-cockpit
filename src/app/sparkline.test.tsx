import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "./sparkline";
import type { CompletionPoint } from "./completion-trend";

/** One point a day from 2026-06-01, unless explicit days are given. */
const pts = (vals: number[], days?: number[]): CompletionPoint[] =>
  vals.map((v, i) => {
    const d = new Date(Date.UTC(2026, 5, 1 + (days ? days[i] : i)));
    const date = d.toISOString().slice(0, 10);
    return { date, label: date.slice(5), percent: v };
  });

/** The polyline's [x, y] pairs. */
const coords = (container: HTMLElement) =>
  container.querySelector("polyline")!.getAttribute("points")!.trim().split(/\s+/).map((pair) => pair.split(",").map(Number));

describe("Sparkline", () => {
  test("renders a polyline for >= 2 points", () => {
    const { container } = render(<Sparkline points={pts([10, 40, 30, 80])} />);
    const line = container.querySelector("polyline");
    expect(line).not.toBeNull();
    expect(line!.getAttribute("points")!.trim().split(/\s+/).length).toBe(4);
  });

  // ★ Points are placed by DATE, not by index: they exist only for days with
  //   task activity, so a three-week gap must LOOK like three weeks.
  test("spaces points by their dates, not evenly by index", () => {
    const { container } = render(<Sparkline points={pts([10, 20, 30], [0, 1, 10])} />);
    const [a, b, c] = coords(container).map(([x]) => x);
    expect(b - a).toBeLessThan((c - b) / 5);   // 1 day vs 9 days
    expect(c - a).toBeGreaterThan(0);          // positive control: the line spans the width
  });

  // ★ Fixed 0–100 scale: a move from 40% to 45% must look like five points,
  //   not fill the whole height as a min–max stretch would draw it.
  test("draws on a fixed 0–100 scale", () => {
    const small = coords(render(<Sparkline points={pts([40, 45])} />).container).map(([, y]) => y);
    const full = coords(render(<Sparkline points={pts([0, 100])} />).container).map(([, y]) => y);
    const fullSpan = Math.abs(full[0] - full[1]);
    expect(Math.abs(small[0] - small[1])).toBeCloseTo(fullSpan * 0.05, 1);
    expect(full[0]).toBeGreaterThan(full[1]);  // 0% is lower down the SVG than 100%
  });

  test("marks every data point with a dot", () => {
    const { container } = render(<Sparkline points={pts([10, 40, 30, 80])} />);
    expect(container.querySelectorAll("[data-sparkline-point]")).toHaveLength(4);
  });

  test("renders nothing for fewer than 2 points", () => {
    const { container } = render(<Sparkline points={pts([42])} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("svg is decorative (aria-hidden) when no ariaLabel is given", () => {
    const { container } = render(<Sparkline points={pts([10, 20])} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
  });

  test("exposes role=img + aria-label when ariaLabel is given (bare-div label is not announced)", () => {
    const { getByRole } = render(<Sparkline points={pts([10, 20])} ariaLabel="Completion trend: 20% now" />);
    const svg = getByRole("img", { name: "Completion trend: 20% now" });
    expect(svg.getAttribute("aria-hidden")).toBeNull();
  });
});
