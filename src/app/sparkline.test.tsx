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

  test("svg is aria-hidden (meaning rides the parent wrapper)", () => {
    const { container } = render(<Sparkline points={pts([10, 20])} />);
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });
});
