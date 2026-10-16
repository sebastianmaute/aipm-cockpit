import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type React from "react";
import { act, renderHook } from "@testing-library/react";
import { DAY_WIDTH_PX } from "./gantt-engine";
import {
  MILESTONE_KEY_COMMIT_DELAY_MS, milestoneKeyStep, pxToDays, shiftIsoDate, useGanttMilestoneDrag,
} from "./use-gantt-milestone-drag";
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

  it("maps arrows to one day, Shift+arrow and PageUp/PageDown to one week", () => {
    expect(milestoneKeyStep("ArrowRight", false)).toBe(1);
    expect(milestoneKeyStep("ArrowLeft", false)).toBe(-1);
    expect(milestoneKeyStep("ArrowRight", true)).toBe(7);
    expect(milestoneKeyStep("ArrowLeft", true)).toBe(-7);
    expect(milestoneKeyStep("ArrowUp", false)).toBe(1);
    expect(milestoneKeyStep("ArrowDown", false)).toBe(-1);
    expect(milestoneKeyStep("ArrowUp", true)).toBe(7);
    expect(milestoneKeyStep("PageUp", false)).toBe(7);
    expect(milestoneKeyStep("PageDown", false)).toBe(-7);
    expect(milestoneKeyStep("Home", false)).toBeNull();
    expect(milestoneKeyStep("Enter", false)).toBeNull();
  });
});

describe("useGanttMilestoneDrag — pointer", () => {
  it("tracks the drag in whole days and commits once, on release", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useGanttMilestoneDrag(onMove));
    act(() => result.current.startMilestoneDrag(pointerDown(100), m));
    expect(result.current.milestoneDrag).toEqual({ milestoneId: 4, deltaDays: 0, mode: "pointer" });

    act(() => windowPointer("pointermove", 100 + DAY_WIDTH_PX * 5));
    expect(result.current.milestoneDrag).toEqual({ milestoneId: 4, deltaDays: 5, mode: "pointer" });
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
    expect(result.current.milestoneDrag).toEqual({ milestoneId: 4, deltaDays: 0, mode: "pointer" });
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

describe("useGanttMilestoneDrag — pointer Escape", () => {
  it("cancels the drag without committing", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useGanttMilestoneDrag(onMove));
    act(() => result.current.startMilestoneDrag(pointerDown(100), m));
    act(() => windowPointer("pointermove", 100 + DAY_WIDTH_PX * 4));
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(result.current.milestoneDrag).toBeNull();
    act(() => windowPointer("pointerup", 100 + DAY_WIDTH_PX * 4));
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe("useGanttMilestoneDrag — keyboard", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("previews each press and commits the total once, after a pause", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useGanttMilestoneDrag(onMove));
    const right = keyDown("ArrowRight");
    act(() => result.current.onMilestoneKeyDown(right, m));
    act(() => result.current.onMilestoneKeyDown(keyDown("ArrowRight"), m));
    act(() => result.current.onMilestoneKeyDown(keyDown("ArrowRight", { shiftKey: true }), m));
    expect(right.preventDefault).toHaveBeenCalled();
    expect(result.current.milestoneDrag).toEqual({ milestoneId: 4, deltaDays: 9, mode: "keys" });
    expect(onMove).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(MILESTONE_KEY_COMMIT_DELAY_MS - 1); });
    expect(onMove).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(4, "2026-11-01");
    expect(result.current.milestoneDrag).toBeNull();
  });

  it("restarts the pause on every press", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useGanttMilestoneDrag(onMove));
    act(() => result.current.onMilestoneKeyDown(keyDown("ArrowLeft"), m));
    act(() => { vi.advanceTimersByTime(MILESTONE_KEY_COMMIT_DELAY_MS - 100); });
    act(() => result.current.onMilestoneKeyDown(keyDown("ArrowDown"), m));
    act(() => { vi.advanceTimersByTime(MILESTONE_KEY_COMMIT_DELAY_MS - 100); });
    expect(onMove).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(100); });
    expect(onMove).toHaveBeenCalledWith(4, "2026-10-21");
  });

  it("commits at once on Enter", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useGanttMilestoneDrag(onMove));
    act(() => result.current.onMilestoneKeyDown(keyDown("PageUp"), m));
    const enter = keyDown("Enter");
    act(() => result.current.onMilestoneKeyDown(enter, m));
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(onMove).toHaveBeenCalledWith(4, "2026-10-30");
    act(() => { vi.advanceTimersByTime(MILESTONE_KEY_COMMIT_DELAY_MS); });
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("discards the pending move on Escape", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useGanttMilestoneDrag(onMove));
    act(() => result.current.onMilestoneKeyDown(keyDown("ArrowRight"), m));
    act(() => result.current.onMilestoneKeyDown(keyDown("Escape"), m));
    expect(result.current.milestoneDrag).toBeNull();
    act(() => { vi.advanceTimersByTime(MILESTONE_KEY_COMMIT_DELAY_MS); });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("commits when focus leaves", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useGanttMilestoneDrag(onMove));
    act(() => result.current.onMilestoneKeyDown(keyDown("ArrowRight"), m));
    act(() => result.current.onMilestoneBlur(m));
    expect(onMove).toHaveBeenCalledWith(4, "2026-10-24");
  });

  it("lands a pending move before a key press on another milestone", () => {
    const onMove = vi.fn();
    const other: Milestone = { ...m, id: 9, date: "2026-12-01" };
    const { result } = renderHook(() => useGanttMilestoneDrag(onMove));
    act(() => result.current.onMilestoneKeyDown(keyDown("ArrowRight"), m));
    act(() => result.current.onMilestoneKeyDown(keyDown("ArrowLeft"), other));
    expect(onMove).toHaveBeenCalledWith(4, "2026-10-24");
    expect(result.current.milestoneDrag).toEqual({ milestoneId: 9, deltaDays: -1, mode: "keys" });
  });

  it("still lands a pending move when the chart unmounts", () => {
    const onMove = vi.fn();
    const { result, unmount } = renderHook(() => useGanttMilestoneDrag(onMove));
    act(() => result.current.onMilestoneKeyDown(keyDown("ArrowRight"), m));
    unmount();
    expect(onMove).toHaveBeenCalledWith(4, "2026-10-24");
  });

  it("leaves other keys and modified arrows alone", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useGanttMilestoneDrag(onMove));
    const tab = keyDown("Tab");
    act(() => result.current.onMilestoneKeyDown(tab, m));
    act(() => result.current.onMilestoneKeyDown(keyDown("ArrowRight", { ctrlKey: true }), m));
    act(() => result.current.onMilestoneKeyDown(keyDown("Enter"), m));
    act(() => { vi.advanceTimersByTime(MILESTONE_KEY_COMMIT_DELAY_MS); });
    expect(onMove).not.toHaveBeenCalled();
    expect(tab.preventDefault).not.toHaveBeenCalled();
    expect(result.current.milestoneDrag).toBeNull();
  });

  it("does not move an achieved milestone", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useGanttMilestoneDrag(onMove));
    act(() => result.current.onMilestoneKeyDown(keyDown("ArrowRight"), { ...m, achievedDate: "2026-10-20" }));
    act(() => { vi.advanceTimersByTime(MILESTONE_KEY_COMMIT_DELAY_MS); });
    expect(onMove).not.toHaveBeenCalled();
  });
});
