import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ForecastRangeBar } from "./forecast-range-bar";

const EN = "en-US" as const;
const BASE = { lang: EN, p50: "2027-01-28", p80: "2027-02-12", p95: "2027-03-03", planEnd: "2027-02-01", today: "2026-10-16" };

function num(el: Element | null, attr: string): number {
  return Number(el?.getAttribute(attr));
}

describe("ForecastRangeBar", () => {
  it("draws the P80 mark between the band's edges", () => {
    const { container } = render(<ForecastRangeBar {...BASE} />);
    const band = container.querySelector("[data-band]");
    const mark = container.querySelector("[data-p80]");
    const left = num(band, "x");
    const right = left + num(band, "width");
    const x = num(mark, "x1");
    expect(num(band, "width")).toBeGreaterThan(0);
    expect(x).toBeGreaterThan(left);
    expect(x).toBeLessThan(right);
  });

  it("puts the plan-end tick on the same axis, before the band when the plan ends earlier", () => {
    const { container } = render(<ForecastRangeBar {...BASE} />);
    const tick = container.querySelector("[data-plan-end]");
    expect(tick).not.toBeNull();
    expect(num(tick, "x1")).toBeLessThan(num(container.querySelector("[data-p80]"), "x1"));
  });

  it("wears the sim marking: the img sits inside a dashed outline named simulated", () => {
    render(<ForecastRangeBar {...BASE} />);
    const img = screen.getByRole("img");
    expect(img.closest("[data-sim]")).not.toBeNull();
    expect(screen.getByRole("group", { name: "Forecast range, simulated" })).toContainElement(img);
  });

  it("draws no plan-end tick when the plan end is not a valid date", () => {
    const { container } = render(<ForecastRangeBar {...BASE} planEnd="" />);
    expect(container.querySelector("[data-plan-end]")).toBeNull();
    expect(container.querySelector("[data-p80]")).not.toBeNull();
  });

  it("states the four dates in its text alternative", () => {
    render(<ForecastRangeBar {...BASE} />);
    expect(screen.getByRole("img", {
      name: "Half by Jan 28, 2027, 8 in 10 by Feb 12, 2027, almost all by Mar 3, 2027. Plan end Feb 1, 2027.",
    })).toBeInTheDocument();
  });

  it("drops the plan-end sentence when there is no plan end", () => {
    render(<ForecastRangeBar {...BASE} planEnd={null} />);
    expect(screen.getByRole("img", {
      name: "Half by Jan 28, 2027, 8 in 10 by Feb 12, 2027, almost all by Mar 3, 2027.",
    })).toBeInTheDocument();
  });

  it("says beyond the forecast horizon when P95 is, and runs the band to the edge", () => {
    const { container } = render(<ForecastRangeBar {...BASE} p95={null} />);
    expect(screen.getByRole("img", {
      name: "Half by Jan 28, 2027, 8 in 10 by Feb 12, 2027, almost all only beyond the forecast horizon. Plan end Feb 1, 2027.",
    })).toBeInTheDocument();
    const band = container.querySelector("[data-band]");
    expect(band).toHaveAttribute("data-open-end", "true");
    expect(num(band, "x") + num(band, "width")).toBeGreaterThan(num(container.querySelector("[data-p80]"), "x1"));
  });
});
