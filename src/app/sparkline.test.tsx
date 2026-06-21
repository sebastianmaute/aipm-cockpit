import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "./sparkline";
import type { CompletionPoint } from "./completion-trend";

const pts = (vals: number[]): CompletionPoint[] => vals.map((v, i) => ({ label: `0${i}`, percent: v }));

describe("Sparkline", () => {
  test("renders a polyline for >= 2 points", () => {
    const { container } = render(<Sparkline points={pts([10, 40, 30, 80])} />);
    const line = container.querySelector("polyline");
    expect(line).not.toBeNull();
    expect(line!.getAttribute("points")!.trim().split(/\s+/).length).toBe(4);
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
