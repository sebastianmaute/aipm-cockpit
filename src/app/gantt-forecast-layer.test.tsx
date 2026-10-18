// §502 part 4 (spec §3.7) — the Gantt's forecast band and P80 line: a faint P50–P95 band and a dashed P80
// line on the shared day geometry (`dayLeftPx`), dates past the axis clamped to its edge, all decorative.
import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { GanttForecastLayer } from "./gantt-forecast-layer";
import { dayLeftPx } from "./gantt-overlays";
import { clampedDayIndex, parseISO } from "./gantt-engine";
import { formatWhen } from "./forecast-tables";

const NAME_COL = 200;
const RANGE = { min: parseISO("2026-10-01")!, days: 30 };
const indexOf = (iso: string | null) => clampedDayIndex(RANGE, iso);

function renderLayer(p: { p50: string | null; p80: string | null; p95: string | null }) {
  return render(<GanttForecastLayer lang="en-US" {...p} dayIndexOf={indexOf} nameColWidth={NAME_COL} height={320} />);
}

describe("clampedDayIndex", () => {
  test("an in-range date is its day offset from the first day", () => {
    expect(clampedDayIndex(RANGE, "2026-10-06")).toBe(5);
  });
  test("a date before the first day clamps to 0, after the last day to the last index", () => {
    expect(clampedDayIndex(RANGE, "2026-09-01")).toBe(0);
    expect(clampedDayIndex(RANGE, "2027-03-01")).toBe(29);
  });
  test("null (a percentile past the horizon) is the last day; an unparseable date is null", () => {
    expect(clampedDayIndex(RANGE, null)).toBe(29);
    expect(clampedDayIndex(RANGE, "not-a-date")).toBeNull();
  });
});

describe("GanttForecastLayer", () => {
  test("the band spans the P50 day's start to the end of the P95 day; the line sits on the P80 day", () => {
    const { container } = renderLayer({ p50: "2026-10-06", p80: "2026-10-11", p95: "2026-10-16" });
    const band = container.querySelector<HTMLElement>("[data-gantt-forecast-band]")!;
    const line = container.querySelector<HTMLElement>("[data-gantt-forecast-p80]")!;
    expect(band.style.left).toBe(`${dayLeftPx(5, NAME_COL)}px`);
    expect(band.style.width).toBe(`${dayLeftPx(16, NAME_COL) - dayLeftPx(5, NAME_COL)}px`);
    expect(line.style.left).toBe(`${dayLeftPx(10, NAME_COL)}px`);
    expect(band.style.height).toBe("320px");
  });

  test("the P80 line is dashed in the sanctioned green token, the band a low-opacity token fill", () => {
    const { container } = renderLayer({ p50: "2026-10-06", p80: "2026-10-11", p95: "2026-10-16" });
    const line = container.querySelector<HTMLElement>("[data-gantt-forecast-p80]")!;
    expect(line.className).toContain("border-dashed");
    expect(line.className).toContain("border-ui-green-strong");
    expect(container.querySelector<HTMLElement>("[data-gantt-forecast-band]")!.className).toMatch(/bg-ui-green\/\d+/);
  });

  test("labels the line 'P80 {date}' and keeps the whole layer out of the accessibility tree", () => {
    const { container } = renderLayer({ p50: "2026-10-06", p80: "2026-10-11", p95: "2026-10-16" });
    const layer = container.querySelector<HTMLElement>("[data-gantt-forecast-layer]")!;
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.className).toContain("pointer-events-none");
    expect(layer.textContent).toBe(`P80 ${formatWhen("2026-10-11", "en-US")}`);
  });

  test("dates past the axis clamp to its edge, and a P80 past the horizon reads '> 5 y' on the edge", () => {
    const { container } = renderLayer({ p50: "2026-10-20", p80: null, p95: null });
    const band = container.querySelector<HTMLElement>("[data-gantt-forecast-band]")!;
    const line = container.querySelector<HTMLElement>("[data-gantt-forecast-p80]")!;
    expect(band.style.left).toBe(`${dayLeftPx(19, NAME_COL)}px`);
    expect(band.style.width).toBe(`${dayLeftPx(30, NAME_COL) - dayLeftPx(19, NAME_COL)}px`);
    expect(line.style.left).toBe(`${dayLeftPx(29, NAME_COL)}px`);
    expect(container.textContent).toBe(`P80 ${formatWhen(null, "en-US")}`);
  });

  test("renders nothing when a date does not parse", () => {
    const { container } = renderLayer({ p50: "bad", p80: "2026-10-11", p95: "2026-10-16" });
    expect(container.innerHTML).toBe("");
  });
});
