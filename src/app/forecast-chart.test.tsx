import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { ForecastChart } from "./forecast-chart";
import type { ScheduleForecast } from "./forecast";

// 2026-10-14 is a Wednesday.
const TODAY = "2026-10-14";
const NO_HOLIDAYS: ReadonlySet<string> = new Set();

/** A forecast whose every run finishes on `day` working days ahead. */
function finishingOn(day: number): ScheduleForecast {
  return {
    kind: "forecast",
    unit: "tasks",
    backlog: 10,
    when: [
      { p: 50, daysAhead: day, date: null },
      { p: 80, daysAhead: day, date: null },
      { p: 95, daysAhead: day, date: null },
    ],
    howMany: [],
    milestones: [],
    distribution: Int32Array.from({ length: 20 }, () => day), trialDays: Int32Array.from({ length: 20 }, () => day), windowDates: [],
    beyondShare: 0,
    finished: 20,
    windowDays: 20,
    doneWithoutDate: 0,
    trials: 20,
  };
}

function ticks(container: HTMLElement): SVGTextElement[] {
  return [...container.querySelectorAll<SVGTextElement>("[data-tick]")];
}

describe("ForecastChart x-axis ticks", () => {
  test("ticks read day and month while the axis stays in this year", () => {
    const { container } = render(<ForecastChart lang="en-US" forecast={finishingOn(20)} today={TODAY} holidaySet={NO_HOLIDAYS} />);
    expect(ticks(container).map((el) => el.textContent)).toEqual(["Oct 21", "Oct 28", "Nov 4", "Nov 11"]);
  });

  test("ticks carry the year once the axis crosses into another calendar year", () => {
    // 60 working days from 2026-10-14 ends on 2027-01-06.
    const { container } = render(<ForecastChart lang="en-US" forecast={finishingOn(60)} today={TODAY} holidaySet={NO_HOLIDAYS} />);
    const labels = ticks(container).map((el) => el.textContent ?? "");
    expect(labels[0], "a cross-year axis labels every tick with its year").toBe("Oct 21, 2026");
    expect(labels.every((l) => /, 202[67]$/.test(l)), "every tick carries its year").toBe(true);
  });

  test("the last tick at the right edge is anchored end, the others middle", () => {
    const { container } = render(<ForecastChart lang="en-US" forecast={finishingOn(20)} today={TODAY} holidaySet={NO_HOLIDAYS} />);
    const anchors = ticks(container).map((el) => el.getAttribute("text-anchor"));
    expect(anchors, "the edge tick is pulled inward so it is not clipped").toEqual(["middle", "middle", "middle", "end"]);
  });
});
