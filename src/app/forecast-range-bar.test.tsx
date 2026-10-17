import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

  it("without axis the bar is unchanged", () => {
    const { container } = render(<ForecastRangeBar {...BASE} />);
    expect(container.innerHTML).toMatchInlineSnapshot(`"<div role="group" aria-label="Forecast range, simulated" data-sim="true" class="flex items-center gap-1.5 rounded-md border border-dashed border-ui-green-strong px-1.5 py-0.5 dark:border-ui-green"><svg role="img" aria-label="Half by Jan 28, 2027, 8 in 10 by Feb 12, 2027, almost all by Mar 3, 2027. Plan end Feb 1, 2027." viewBox="0 0 240 40" class="h-10 min-w-0 flex-1"><line x1="6" x2="234" y1="28" y2="28" stroke-width="1" class="stroke-ui-dark-blue dark:stroke-ui-light-grey"></line><rect data-band="true" x="177.82608695652175" y="16" width="56.17391304347825" height="10" rx="2" fill-opacity="0.45" class="fill-ui-green-strong dark:fill-ui-green"></rect><line data-p80="true" x1="202.60869565217394" x2="202.60869565217394" y1="12" y2="28" stroke-width="2" class="stroke-ui-dark-blue dark:stroke-ui-light-grey"></line><text data-p80-label="true" x="202.60869565217394" y="10" text-anchor="middle" font-size="8" class="fill-ui-dark-blue dark:fill-ui-light-grey">P80</text><g><line data-plan-end="true" x1="184.43478260869566" x2="184.43478260869566" y1="14" y2="31" stroke-width="1.5" stroke-dasharray="2 2" class="stroke-ui-dark-blue dark:stroke-ui-light-grey"></line><text x="184.43478260869566" y="39" text-anchor="end" font-size="8" class="fill-ui-dark-blue dark:fill-ui-light-grey">Plan end</text></g></svg><span aria-hidden="true" class="rounded bg-ui-green/15 px-1 text-[10px] font-medium leading-4 text-ui-green-strong dark:text-ui-green">sim</span></div>"`);
  });

  it("a shared axis places the same date at the same x in two bars", () => {
    // lo before today, so a bar that ignored the axis start would place every date differently.
    const axis = { lo: "2026-09-01", hi: "2027-06-30" };
    const a = render(<ForecastRangeBar {...BASE} axis={axis} />).container;
    const b = render(<ForecastRangeBar {...BASE} p50="2027-02-12" p80="2027-04-01" p95="2027-06-30" axis={axis} />).container;
    // BASE's P80 is b's P50: on one axis the mark and the band's left edge sit at the same x.
    expect(num(a.querySelector("[data-p80]"), "x1")).toBeCloseTo(num(b.querySelector("[data-band]"), "x"), 6);
    // And the axis is the given one: P80 sits at its share of [lo, hi] across the 240-wide, 6-inset chart.
    const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;
    const share = (day("2027-02-12") - day(axis.lo)) / (day(axis.hi) - day(axis.lo));
    expect(num(a.querySelector("[data-p80]"), "x1")).toBeCloseTo(6 + share * (240 - 12), 6);
    // The plan end is the same date in both, so the same x.
    expect(num(a.querySelector("[data-plan-end]"), "x1")).toBeCloseTo(num(b.querySelector("[data-plan-end]"), "x1"), 6);
    // Positive control: without the axis each bar spans its own dates, so the plan end moves.
    const c = render(<ForecastRangeBar {...BASE} />).container;
    expect(num(c.querySelector("[data-plan-end]"), "x1")).not.toBeCloseTo(num(a.querySelector("[data-plan-end]"), "x1"), 1);
  });

  // Final review Minor 3: on a shared axis an open band and the band whose P95 sets the right edge both end there.
  it("on a shared axis an open band says \"later →\" at the edge in words; the bar that sets the edge does not", () => {
    const axis = { lo: "2026-10-16", hi: "2027-03-03" };
    const open = render(<ForecastRangeBar {...BASE} p95={null} axis={axis} label="Open" />).container;
    const edge = render(<ForecastRangeBar {...BASE} axis={axis} label="Edge" />).container;
    // Both bands end at the same x, so the band alone cannot tell them apart.
    const right = (c: HTMLElement) => num(c.querySelector("[data-band]"), "x") + num(c.querySelector("[data-band]"), "width");
    expect(right(open)).toBeCloseTo(right(edge), 6);
    const cue = open.querySelector("[data-open-end-cue]");
    expect(cue).toHaveTextContent("later →");
    expect(cue).toHaveAttribute("aria-hidden", "true");
    expect(edge.querySelector("[data-open-end-cue]")).toBeNull();
    // Its accessible text is the img's own name, which says beyond the horizon.
    expect(within(screen.getByRole("group", { name: "Open, simulated" })).getByRole("img").getAttribute("aria-label"))
      .toContain("only beyond the forecast horizon");
    // Off a shared axis the open-end pad already shows it, so no cue (the own-axis bar is unchanged).
    expect(render(<ForecastRangeBar {...BASE} p95={null} />).container.querySelector("[data-open-end-cue]")).toBeNull();
  });

  it("names its group with the given label", () => {
    render(<ForecastRangeBar {...BASE} label="Finish range – As is" />);
    expect(screen.getByRole("group", { name: "Finish range – As is, simulated" })).toBeInTheDocument();
  });

  it.each([
    ["at the right edge (P80 = P95, the latest date)", { p50: "2027-01-28", p80: "2027-03-03", p95: "2027-03-03", planEnd: "2027-02-01" }],
    ["at the left edge (P80 = today, the earliest date)", { p50: "2026-10-16", p80: "2026-10-16", p95: "2027-03-03", planEnd: "2027-02-01" }],
  ])("keeps the P80 label inside the chart with the mark %s", (_label, dates) => {
    // "P80" at font size 8 is about 13 units wide: centred on the edge mark it would clip by a unit or so.
    const { container } = render(<ForecastRangeBar {...BASE} {...dates} />);
    const width = Number(container.querySelector("svg")!.getAttribute("viewBox")!.split(" ")[2]);
    const mark = num(container.querySelector("[data-p80]"), "x1");
    const label = num(container.querySelector("[data-p80-label]"), "x");
    expect(Math.min(mark, width - mark)).toBeLessThan(8);
    expect(label).toBeGreaterThanOrEqual(8);
    expect(label).toBeLessThanOrEqual(width - 8);
  });
});
