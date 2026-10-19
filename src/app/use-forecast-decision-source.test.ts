// §502 part 4 — the exports' forecast decision source: none while the simulation is off, a "calendar loading" one
// while holidays load (Task 11b), and a lazy
// one otherwise (the laziness itself is `forecastDecisionSource`'s, pinned in forecast-decision.test.ts).
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { forecastDecisionSource } from "./forecast-decision";
import { useForecastDecisionSource, type ForecastDecisionSourceDeps } from "./use-forecast-decision-source";
import type { ResourcePlan } from "./types";

vi.mock("./forecast-decision", async (importOriginal) => {
  const real = await importOriginal<typeof import("./forecast-decision")>();
  return { ...real, forecastDecisionSource: vi.fn(real.forecastDecisionSource) };
});

const PLAN = { startDate: "2026-01-01", endDate: "2026-12-23", currency: "EUR" } as ResourcePlan;
const DEPS: ForecastDecisionSourceDeps = {
  simulationActive: true, holidaysReady: true, tasks: [], milestones: [], today: "2026-10-14", holidaySet: new Set(), plan: PLAN,
  directory: { resources: [], roles: [], shifts: [], absences: [], budgets: [], fxRates: null, workdayHours: 8, baseCurrency: "EUR" },
  budgetEnabled: false, scenarios: [], settingsOverrides: undefined,
};

describe("useForecastDecisionSource", () => {
  it("is null exactly while the simulation is off — the one gate that offers the section", () => {
    expect(renderHook(() => useForecastDecisionSource({ ...DEPS, simulationActive: false })).result.current).toBeNull();
    expect(renderHook(() => useForecastDecisionSource(DEPS)).result.current).not.toBeNull();
  });

  it("while the holiday calendar loads, the handle is offered and its decision says so (the section stays, one row)", () => {
    const handle = renderHook(() => useForecastDecisionSource({ ...DEPS, holidaysReady: false })).result.current;
    expect(handle?.source()).toEqual({ insufficient: true, goal: 80, calendarLoading: true });
    expect(handle?.live.input()).toBeNull();
    expect(handle?.live.base()).toEqual({ insufficient: true, goal: 80, calendarLoading: true });
  });

  it("hands the preview the same input identity every time, and the base with nothing searched", () => {
    const handle = renderHook(() => useForecastDecisionSource({ ...DEPS, settingsOverrides: { forecast: { targetConfidence: 95 } } })).result.current;
    expect(handle?.live.goal).toBe(95);
    expect(handle?.live.input()).toBe(handle?.live.input());
    expect(handle?.live.base()).toMatchObject({ insufficient: false, goal: 95, below: [] });
  });

  it("keeps one source across renders, built from the app-wide defaults and the plan end", () => {
    vi.mocked(forecastDecisionSource).mockClear();
    const { result, rerender } = renderHook(() => useForecastDecisionSource(DEPS));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(forecastDecisionSource).toHaveBeenCalledTimes(1);
    const args = vi.mocked(forecastDecisionSource).mock.calls[0][0]();
    expect(args.simulationActive).toBe(true);
    expect(args.input).toMatchObject({ window: 60, unit: "tasks", planEnd: "2026-12-23", budgetFacts: null, costOn: false });
    // Nothing open: the engine answers at once, with nothing below target and no proposal.
    expect(first?.source()).toMatchObject({ insufficient: false, goal: 80, planEnd: "2026-12-23", below: [], proposal: null });
  });
});
