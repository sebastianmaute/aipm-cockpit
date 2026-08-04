import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGanttPrefs } from "./use-gantt-prefs";

describe("useGanttPrefs — showBaseline", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults showBaseline to true", () => {
    const { result } = renderHook(() => useGanttPrefs());
    expect(result.current.prefs.showBaseline).toBe(true);
  });

  it("toggleBaseline flips the flag and persists it", () => {
    const { result } = renderHook(() => useGanttPrefs());
    act(() => result.current.toggleBaseline());
    expect(result.current.prefs.showBaseline).toBe(false);
    const saved = JSON.parse(window.localStorage.getItem("aipm-cockpit:gantt-prefs")!);
    expect(saved.showBaseline).toBe(false);
  });
});

describe("useGanttPrefs — display toggles", () => {
  beforeEach(() => window.localStorage.clear());

  const CASES = [
    ["toggleHolidays", "showHolidays", true],
    ["toggleAbsences", "showAbsences", true],
    ["toggleDependencies", "showDependencies", true],
    ["toggleMilestones", "showMilestones", true],
    ["toggleGrid", "showGrid", false],
  ] as const;

  for (const [toggle, field, initial] of CASES) {
    it(`${toggle} defaults to ${initial}, flips the flag and persists it`, () => {
      const { result } = renderHook(() => useGanttPrefs());
      expect(result.current.prefs[field]).toBe(initial);
      act(() => result.current[toggle]());
      expect(result.current.prefs[field]).toBe(!initial);
      const saved = JSON.parse(
        window.localStorage.getItem("aipm-cockpit:gantt-prefs")!,
      );
      expect(saved[field]).toBe(!initial);
    });
  }
});

describe("useGanttPrefs — v2 status filter", () => {
  beforeEach(() => window.localStorage.clear());

  it("resetFilters restores every status rather than clearing the list", () => {
    const { result } = renderHook(() => useGanttPrefs());
    act(() => result.current.toggleStatus("open"));
    act(() => result.current.toggleStatus("completed"));
    expect(result.current.prefs.statuses).toEqual(["overdue"]);

    act(() => result.current.resetFilters());
    expect([...result.current.prefs.statuses].sort()).toEqual([
      "completed",
      "open",
      "overdue",
    ]);
    // Priorities and assignees keep the empty-means-all semantics.
    expect(result.current.prefs.priorities).toEqual([]);
    expect(result.current.prefs.assignees).toEqual([]);
  });

  it("an emptied status filter round-trips through localStorage", () => {
    // The whole point of the version stamp: unticking every box must survive a
    // reload instead of being re-expanded by the v1 migration.
    const { result } = renderHook(() => useGanttPrefs());
    act(() => result.current.toggleStatus("open"));
    act(() => result.current.toggleStatus("completed"));
    act(() => result.current.toggleStatus("overdue"));
    expect(result.current.prefs.statuses).toEqual([]);

    const reloaded = renderHook(() => useGanttPrefs());
    expect(reloaded.result.current.prefs.statuses).toEqual([]);
  });
});
