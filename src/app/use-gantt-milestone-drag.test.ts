import { describe, expect, it, vi } from "vitest";
import type React from "react";
import { act, renderHook } from "@testing-library/react";
import { DAY_WIDTH_PX } from "./gantt-engine";
import { milestoneKeyStep, pxToDays, shiftIsoDate, useGanttMilestoneDrag } from "./use-gantt-milestone-drag";
import type { Milestone } from "./types";

const m: Milestone = { id: 4, name: "Pilot Go-Live", date: "2026-10-23", linkedTaskIds: [] };

function pointerDown(clientX: number, extra: Partial<React.PointerEvent<HTMLElement>> = {}) {
  return {
    clientX, pointerId: 1, button: 0,
    stopPropagation: vi.fn(), preventDefault: vi.fn(),
    ...extra,
  } as unknown as React.PointerEvent<HTMLElement>;
}
function windowPointer(type: string, clientX: number, pointerId = 1) {
  const ev = new Event(type) as Event & { clientX: number; pointerId: number };
  ev.clientX = clientX;
  ev.pointerId = pointerId;
  window.dispatchEvent(ev);
}
function keyDown(key: string, mods: Partial<React.KeyboardEvent<HTMLElement>> = {}) {
  return { key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault: vi.fn(), ...mods } as unknown as React.KeyboardEvent<HTMLElement>;
}

describe("milestone drag date arithmetic", () => {
  it("shifts an ISO date across a month boundary", () => {
    expect(shiftIsoDate("2026-10-30", 3)).toBe("2026-11-02");
    expect(shiftIsoDate("2026-11-02", -3)).toBe("2026-10-30");
  });

  it("returns null for a date that does not parse", () => {
    expect(shiftIsoDate("not-a-date", 1)).toBeNull();
  });

  it("snaps pointer travel to whole days", () => {
    expect(pxToDays(DAY_WIDTH_PX * 3)).toBe(3);
    expect(pxToDays(DAY_WIDTH_PX * 0.6)).toBe(1);
    expect(pxToDays(DAY_WIDTH_PX * 0.4)).toBe(0);
    expect(pxToDays(-DAY_WIDTH_PX * 2)).toBe(-2);
    expect(Object.is(pxToDays(-DAY_WIDTH_PX * 0.2), 0)).toBe(true);
  });

  it("maps the arrow keys to one day, and one week with Shift", () => {
    expect(milestoneKeyStep("ArrowRight", false)).toBe(1);
    expect(milestoneKeyStep("ArrowLeft", false)).toBe(-1);
    expect(milestoneKeyStep("ArrowRight", true)).toBe(7);
    expect(milestoneKeyStep("ArrowLeft", true)).toBe(-7);
    expect(milestoneKeyStep("ArrowUp", false)).toBeNull();
    expect(milestoneKeyStep("Enter", false)).toBeNull();
  });
});

describe("useGanttMilestoneDrag — pointer", () => {
  it("tracks the drag in whole days and commits once, on release", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useGanttMilestoneDrag(onMove));
    act(() => result.current.startMilestoneDrag(pointerDown(100), m));
    expect(result.current.milestoneDrag).toEqual({ milestoneId: 4, deltaDays: 0 });

    act(() => windowPointer("pointermove", 100 + DAY_WIDTH_PX * 5));
    expect(result.current.milestoneDrag).toEqual({ milestoneId: 4, deltaDays: 5 });
    expect(onMove).not.toHaveBeenCalled();

    act(() => windowPointer("pointerup", 100 + DAY_WIDTH_PX * 5));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(4, "2026-10-28");
    expect(result.current.milestoneDrag).toBeNull();

    // The listeners are gone: a later release commits nothing more.
    act(() => windowPointer("pointerup", 100 + DAY_WIDTH_PX * 9));
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("keeps the same drag state while the pointer stays within one day", () => {
    const { result } = renderHook(() => useGanttMilestoneDrag(vi.fn()));
    act(() => result.current.startMilestoneDrag(pointerDown(100), m));
    act(() => windowPointer("pointermove", 100 + DAY_WIDTH_PX * 2));
    const first = result.current.milestoneDrag;
    act(() => windowPointer("pointermove", 100 + DAY_WIDTH_PX * 2 + 3));
    expect(result.current.milestoneDrag).toBe(first);
    act(() => windowPointer("pointerup", 100 + DAY_WIDTH_PX * 2));
  });

  it("commits nothing when released where it started", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useGanttMilestoneDrag(onMove));
    act(() => result.current.startMilestoneDrag(pointerDown(100), m));
    act(() => windowPointer("pointerup", 105));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("commits nothing when the pointer is cancelled", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useGanttMilestoneDrag(onMove));
    act(() => result.current.startMilestoneDrag(pointerDown(100), m));
    act(() => windowPointer("pointermove", 100 + DAY_WIDTH_PX * 4));
    act(() => windowPointer("pointercancel", 100 + DAY_WIDTH_PX * 4));
    expect(onMove).not.toHaveBeenCalled();
    expect(result.current.milestoneDrag).toBeNull();
  });

  it("ignores another pointer's events", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useGanttMilestoneDrag(onMove));
    act(() => result.current.startMilestoneDrag(pointerDown(100), m));
    act(() => windowPointer("pointerup", 100 + DAY_WIDTH_PX * 4, 2));
    expect(onMove).not.toHaveBeenCalled();
    expect(result.current.milestoneDrag).toEqual({ milestoneId: 4, deltaDays: 0 });
  });

  it("does not start on an achieved milestone, a secondary button, or without a handler", () => {
    const onMove = vi.fn();
    const achieved = renderHook(() => useGanttMilestoneDrag(onMove));
    act(() => achieved.result.current.startMilestoneDrag(pointerDown(100), { ...m, achievedDate: "2026-10-20" }));
    expect(achieved.result.current.milestoneDrag).toBeNull();

    const right = renderHook(() => useGanttMilestoneDrag(onMove));
    act(() => right.result.current.startMilestoneDrag(pointerDown(100, { button: 2 }), m));
    expect(right.result.current.milestoneDrag).toBeNull();

    const none = renderHook(() => useGanttMilestoneDrag(undefined));
    act(() => none.result.current.startMilestoneDrag(pointerDown(100), m));
    expect(none.result.current.milestoneDrag).toBeNull();
  });

  it("removes its listeners when unmounted mid-drag", () => {
    const onMove = vi.fn();
    const { result, unmount } = renderHook(() => useGanttMilestoneDrag(onMove));
    act(() => result.current.startMilestoneDrag(pointerDown(100), m));
    unmount();
    windowPointer("pointerup", 100 + DAY_WIDTH_PX * 3);
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe("useGanttMilestoneDrag — keyboard", () => {
  it("moves one day per arrow press and one week with Shift, committing each press", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useGanttMilestoneDrag(onMove));
    const right = keyDown("ArrowRight");
    act(() => result.current.onMilestoneKeyDown(right, m));
    expect(onMove).toHaveBeenLastCalledWith(4, "2026-10-24");
    expect(right.preventDefault).toHaveBeenCalled();

    act(() => result.current.onMilestoneKeyDown(keyDown("ArrowLeft", { shiftKey: true }), m));
    expect(onMove).toHaveBeenLastCalledWith(4, "2026-10-16");
    expect(onMove).toHaveBeenCalledTimes(2);
  });

  it("leaves other keys and modified arrows alone", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useGanttMilestoneDrag(onMove));
    const tab = keyDown("Tab");
    act(() => result.current.onMilestoneKeyDown(tab, m));
    act(() => result.current.onMilestoneKeyDown(keyDown("ArrowRight", { ctrlKey: true }), m));
    expect(onMove).not.toHaveBeenCalled();
    expect(tab.preventDefault).not.toHaveBeenCalled();
  });

  it("does not move an achieved milestone", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useGanttMilestoneDrag(onMove));
    act(() => result.current.onMilestoneKeyDown(keyDown("ArrowRight"), { ...m, achievedDate: "2026-10-20" }));
    expect(onMove).not.toHaveBeenCalled();
  });
});
