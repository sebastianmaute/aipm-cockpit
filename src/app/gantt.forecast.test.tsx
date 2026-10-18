// §502 part 4 (spec §3.7) — GanttPanel with the shared forecast run: the band and P80 line on the panel's own
// axis, a chance chip on each unfinished milestone the engine gave a chance, and nothing at all while the
// simulation is off (`forecast: null`) or the history is too short.
import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GanttPanel } from "./gantt";
import { formatWhen } from "./forecast-tables";
import { dayLeftPx } from "./gantt-overlays";
import { DAY_WIDTH_PX, LEFT_GUTTER_PX } from "./gantt-engine";
import type { AppForecast, MilestoneChance } from "./forecast/app-forecast";
import type { Milestone, Task } from "./types";

vi.mock("./use-resizable", () => ({
  useResizable: () => ({ ref: { current: null }, size: 400 }),
}));

function dayPlus(n: number): string {
  const x = new Date();
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

// One bar from day -30 to day +30: the axis runs from day -32 (two days' padding) to day +33.
const TASKS: Task[] = [
  { id: 1, taskName: "A", assignee: "x", priority: "Medium", startDate: dayPlus(-30), dueDate: dayPlus(30) } as unknown as Task,
];
const MILESTONES: Milestone[] = [
  { id: 10, name: "Beta", date: dayPlus(10), linkedTaskIds: [1] },
  { id: 11, name: "Late one", date: dayPlus(-5), linkedTaskIds: [1] },
  { id: 12, name: "Signed off", date: dayPlus(12), linkedTaskIds: [1], achievedDate: dayPlus(-1) } as Milestone,
];

function forecast(milestones: readonly MilestoneChance[] = []): AppForecast {
  return {
    kind: "forecast", p50: dayPlus(5), p80: dayPlus(15), p95: dayPlus(25), chanceOnTime: 0.5, estimateCoverage: null,
    windowDays: 60, distribution: new Int32Array(0), trialDays: new Int32Array(0), windowDates: [], trials: 10_000,
    markers: { p50: 5, p80: 15, p95: 25 }, milestones,
  };
}

const PROPS = { lang: "en-US" as const, tasks: TASKS, absences: [] as const, milestones: MILESTONES };

describe("GanttPanel — the forecast layer (§502)", () => {
  test("draws the band from the P50 day and the P80 line on the panel's axis", () => {
    const { container } = render(<GanttPanel {...PROPS} forecast={forecast()} />);
    const band = container.querySelector<HTMLElement>("[data-gantt-forecast-band]");
    const line = container.querySelector<HTMLElement>("[data-gantt-forecast-p80]");
    expect(band?.style.left).toBe(`${dayLeftPx(37, LEFT_GUTTER_PX)}px`);
    expect(line?.style.left).toBe(`${dayLeftPx(47, LEFT_GUTTER_PX)}px`);
  });

  test("draws nothing while the simulation is off (forecast: null)", () => {
    const { container } = render(<GanttPanel {...PROPS} forecast={null} />);
    expect(container.querySelector("[data-gantt-forecast-layer]")).toBeNull();
    expect(container.querySelector("[data-sim-chip]")).toBeNull();
    // Positive control: the chart itself rendered.
    expect(container.querySelector('[data-gantt-row="m-10"]')).not.toBeNull();
  });

  test("gives a screen reader the P80 date once, outside the aria-hidden layer, and nothing while off", () => {
    const label = `P80 ${formatWhen(dayPlus(15), "en-US")}`;
    const { unmount } = render(<GanttPanel {...PROPS} forecast={forecast()} />);
    const sr = screen.getByText(label, { selector: ".sr-only" });
    expect(sr.closest("[aria-hidden]")).toBeNull();
    unmount();
    render(<GanttPanel {...PROPS} forecast={null} />);
    expect(screen.queryByText(label, { selector: ".sr-only" })).toBeNull();
  });

  test("draws nothing below the history floor", () => {
    const insufficient: AppForecast = { kind: "insufficient", finished: 2, neededFinished: 10, days: 3, neededDays: 20 };
    const { container } = render(<GanttPanel {...PROPS} forecast={insufficient} />);
    expect(container.querySelector("[data-gantt-forecast-layer]")).toBeNull();
  });
});

// Important #1 (pre-merge review) — a forecast later than the plan widens the axis; it does not pile up on the edge.
describe("GanttPanel — the axis takes in the forecast (§502)", () => {
  /** The chart's full width (name column + timeline), from the wrapper that carries it. */
  const chartWidth = (c: HTMLElement) => parseFloat(c.querySelector<HTMLElement>('[style*="min-width: 100%"]')!.style.width);
  const late = (): AppForecast => ({
    ...(forecast() as Extract<AppForecast, { kind: "forecast" }>), p50: dayPlus(20), p80: dayPlus(45), p95: dayPlus(60),
  });

  test("a P95 after the last bar: the band ends on its true day, the P80 line sits on its true day", () => {
    const { container } = render(<GanttPanel {...PROPS} forecast={late()} />);
    const band = container.querySelector<HTMLElement>("[data-gantt-forecast-band]")!;
    const line = container.querySelector<HTMLElement>("[data-gantt-forecast-p80]")!;
    // The axis now starts at day -32 still and runs to day +63 (P95 + 3 days' padding): index = day + 32.
    const right = parseFloat(band.style.left) + parseFloat(band.style.width);
    expect(right).toBe(dayLeftPx(60 + 32, LEFT_GUTTER_PX) + DAY_WIDTH_PX);
    expect(line.style.left).toBe(`${dayLeftPx(45 + 32, LEFT_GUTTER_PX)}px`);
  });

  test("off, below the floor or inside the plan, the axis is exactly what it was without a forecast", () => {
    const widthOf = (f: AppForecast | null | undefined) => {
      const { container, unmount } = render(<GanttPanel {...PROPS} forecast={f} />);
      const w = chartWidth(container);
      unmount();
      return w;
    };
    const plain = widthOf(undefined);
    expect(widthOf(null)).toBe(plain);
    expect(widthOf({ kind: "insufficient", finished: 2, neededFinished: 10, days: 3, neededDays: 20 })).toBe(plain);
    expect(widthOf(forecast())).toBe(plain); // P95 at day +25, inside the axis's day +33
    // Positive control: the same observable moves when the forecast runs past the plan (to day +63: 30 more days).
    expect(widthOf(late())).toBe(plain + 30 * DAY_WIDTH_PX);
  });
});

describe("GanttPanel — milestone chance chips (§502)", () => {
  const chances: MilestoneChance[] = [
    { id: 10, state: "chance", chance: 0.31, chancePrioritised: 0.4 },
    { id: 11, state: "overdue" },
    { id: 12, state: "chance", chance: 1, chancePrioritised: 1 },
  ];

  test("an unfinished milestone with a chance shows the percent and the sim badge, and says it once to AT", () => {
    const { container } = render(<GanttPanel {...PROPS} forecast={forecast(chances)} />);
    const row = container.querySelector<HTMLElement>('[data-gantt-row="m-10"]')!;
    const chip = row.querySelector<HTMLElement>("[data-sim-chip]")!;
    expect(chip.textContent).toBe("31%sim");
    expect(chip.getAttribute("aria-hidden")).toBe("true");
    expect(row.querySelector(".sr-only")?.textContent).toBe("31% chance on time, simulated");
  });

  test("only chance rows get a chip: not an overdue one, not a signed-off one", () => {
    const { container } = render(<GanttPanel {...PROPS} forecast={forecast(chances)} />);
    // Positive control: both rows are drawn, so a missing chip is the gate, not a missing row.
    expect(container.querySelector('[data-gantt-row="m-11"]')).not.toBeNull();
    expect(container.querySelector('[data-gantt-row="m-12"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-sim-chip]")).toHaveLength(1);
    expect(container.querySelector('[data-gantt-row="m-11"] [data-sim-chip]')).toBeNull();
    expect(container.querySelector('[data-gantt-row="m-12"] [data-sim-chip]')).toBeNull();
  });
});
