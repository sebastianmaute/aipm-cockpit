import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Milestone, Task } from "./types";
import * as appForecastModule from "./forecast/app-forecast";
import { useAppForecast } from "./use-app-forecast";

const TASKS: Task[] = [];
const MILESTONES: Milestone[] = [];
const HOLIDAYS: ReadonlySet<string> = new Set();
const ARGS = { tasks: TASKS, milestones: MILESTONES, planEnd: "2026-12-31", today: "2026-10-14", holidaySet: HOLIDAYS };

describe("useAppForecast", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("null while inactive and the engine never runs", () => {
    const spy = vi.spyOn(appForecastModule, "computeAppForecast");
    const { result } = renderHook(() => useAppForecast({ ...ARGS, active: false }));
    expect(result.current).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns the shared run while active", () => {
    const spy = vi.spyOn(appForecastModule, "computeAppForecast");
    const { result } = renderHook(() => useAppForecast({ ...ARGS, active: true }));
    expect(spy).toHaveBeenCalledWith(ARGS);
    // The memoised run every other surface reads for the same references.
    expect(result.current).not.toBeNull();
    expect(result.current).toBe(appForecastModule.computeAppForecast(ARGS));
  });
});
