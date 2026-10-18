import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ForecastP80Line } from "./forecast-p80-line";
import type { ForecastHistoryEntry } from "./forecast-history";
import { formatDayMonth, formatDayMonthYear } from "./forecast-format";
import { localeFor } from "./date-format";

const LOCALE = localeFor("en-US");
const dm = (iso: string) => formatDayMonth(iso, LOCALE);

const entry = (date: string, p80: string | null): ForecastHistoryEntry => ({ date, p50: p80, p80, p95: p80, chanceOnTime: 0.5 });

describe("ForecastP80Line (§502 part 4)", () => {
  it("renders nothing for an empty history", () => {
    const { container } = render(<ForecastP80Line lang="en-US" history={[]} planEnd="2026-12-31" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when every recorded P80 ran past the horizon", () => {
    const { container } = render(<ForecastP80Line lang="en-US" history={[entry("2026-10-01", null)]} planEnd="2026-12-31" />);
    expect(container.innerHTML).toBe("");
  });

  it("draws one point per entry with a P80 and the plan end as a reference line", () => {
    const history = [entry("2026-10-01", "2026-12-20"), entry("2026-10-02", null), entry("2026-10-05", "2027-01-10")];
    render(<ForecastP80Line lang="en-US" history={history} planEnd="2026-12-31" compact />);
    const chart = screen.getByRole("img", { name: "Safe to commit (P80) over time" });
    expect(chart.querySelector("polyline")?.getAttribute("points")?.split(" ")).toHaveLength(2);
    expect(screen.getByTestId("trend-reference").textContent).toBe(`Plan end ${formatDayMonthYear("2026-12-31", LOCALE)}`);
  });

  it("formats the y ticks back to the dates they stand for", () => {
    const history = [entry("2026-10-01", "2026-10-11"), entry("2026-10-02", "2026-10-21")];
    render(<ForecastP80Line lang="en-US" history={history} planEnd="not-a-date" />);
    const ticks = [...document.querySelectorAll("text")].map((n) => n.textContent);
    // y runs 0 (11 Oct, the earliest P80) to 10 days later (21 Oct); no plan end, so no reference line.
    expect(ticks).toEqual(expect.arrayContaining([dm("2026-10-11"), dm("2026-10-16"), dm("2026-10-21")]));
    // Right-aligned text only (the y ticks, and the last x label, 2 Oct); the first x label names 1 Oct, left-aligned.
    const rightAligned = [...document.querySelectorAll('text[text-anchor="end"]')].map((n) => n.textContent);
    expect(rightAligned).not.toContain(dm("2026-10-01"));
    expect(screen.queryByTestId("trend-reference")).toBeNull();
  });

  // M1 — `TrendChart` floors its scale at 0. Measured from the first recording date, a P80 four months out that moved
  // two weeks used about a tenth of the plot; from the earliest plotted date, the movement spans it.
  it("scales to the plotted dates, not the recording dates, so a two-week move fills the plot", () => {
    const history = [entry("2026-10-01", "2027-02-01"), entry("2026-10-02", "2027-02-15")];
    render(<ForecastP80Line lang="en-US" history={history} planEnd="2027-02-10" />);
    const chart = screen.getByRole("img", { name: "Safe to commit (P80) over time" });
    const height = Number(chart.getAttribute("viewBox")!.split(" ")[3]);
    const ys = chart.querySelector("polyline")!.getAttribute("points")!.split(" ").map((p) => Number(p.split(",")[1]));
    expect(Math.abs(ys[0] - ys[1])).toBeGreaterThan(height / 2);
    const ticks = [...document.querySelectorAll("text")].map((n) => n.textContent);
    expect(ticks).toEqual(expect.arrayContaining([dm("2027-02-01"), dm("2027-02-15")]));
  });

  it("starts the scale at the plan end when it is earlier than every P80", () => {
    const history = [entry("2026-10-01", "2026-12-20"), entry("2026-10-02", "2026-12-30")];
    render(<ForecastP80Line lang="en-US" history={history} planEnd="2026-12-10" />);
    const ticks = [...document.querySelectorAll("text")].map((n) => n.textContent);
    expect(ticks).toEqual(expect.arrayContaining([dm("2026-12-10"), dm("2026-12-30")]));
  });

  // Task 11b — the points sit on a calendar-day axis: three recordings with a nine-day hole put the middle one a
  // tenth of the way along, not half way.
  it("places the points by their recorded date, so missing days stretch the axis", () => {
    const history = [entry("2026-10-01", "2026-12-20"), entry("2026-10-02", "2026-12-22"), entry("2026-10-11", "2026-12-24")];
    render(<ForecastP80Line lang="en-US" history={history} planEnd="2026-12-31" />);
    const chart = screen.getByRole("img", { name: "Safe to commit (P80) over time" });
    const xs = chart.querySelector("polyline")!.getAttribute("points")!.split(" ").map((p) => Number(p.split(",")[0]));
    expect((xs[1] - xs[0]) / (xs[2] - xs[0])).toBeCloseTo(0.1, 2);
  });

  it("names the year on the x labels when the history crosses a year boundary", () => {
    const history = [entry("2026-12-30", "2027-02-01"), entry("2027-01-02", "2027-02-03")];
    render(<ForecastP80Line lang="en-US" history={history} planEnd="2027-02-10" />);
    const texts = [...document.querySelectorAll("text")].map((n) => n.textContent);
    expect(texts).toEqual(expect.arrayContaining([formatDayMonthYear("2026-12-30", LOCALE), formatDayMonthYear("2027-01-02", LOCALE)]));
  });

  it("leaves the year off the x labels within one calendar year", () => {
    const history = [entry("2026-10-01", "2026-12-20"), entry("2026-10-05", "2026-12-22")];
    render(<ForecastP80Line lang="en-US" history={history} planEnd="2026-12-31" />);
    const texts = [...document.querySelectorAll("text")].map((n) => n.textContent);
    expect(texts).toEqual(expect.arrayContaining([dm("2026-10-01"), dm("2026-10-05")]));
    expect(texts).not.toContain(formatDayMonthYear("2026-10-01", LOCALE));
  });

  it("says the line is still building with a single recorded day", () => {
    render(<ForecastP80Line lang="en-US" history={[entry("2026-10-01", "2026-12-20")]} planEnd="2026-12-31" />);
    expect(screen.getByText("The line appears once two days have been recorded.")).toBeTruthy();
  });
});
