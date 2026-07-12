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
