// §742 — a Gantt task bar's three handles are sliders operable from the keyboard, with the milestone drag's keys
// and timing: arrows move the preview, the edit commits once (pause, Enter, blur), Escape cancels.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type React from "react";
import { clampKeyDays, useGanttBarDrag, type BarDrag, type BarDragMode } from "./use-gantt-bar-drag";
import { MILESTONE_KEY_COMMIT_DELAY_MS } from "./use-gantt-milestone-drag";
import { DAY_WIDTH_PX, type GanttBarEdit } from "./gantt-engine";
import type { Task } from "./types";

const TASK = { id: 7, taskName: "Build" } as unknown as Task;
const BAR = { start: new Date("2026-03-10T00:00:00Z"), end: new Date("2026-03-14T00:00:00Z") };

function key(k: string, opts: { shiftKey?: boolean; altKey?: boolean } = {}) {
  const preventDefault = vi.fn();
  const e = { key: k, shiftKey: !!opts.shiftKey, altKey: !!opts.altKey, ctrlKey: false, metaKey: false, preventDefault };
  return e as unknown as React.KeyboardEvent<HTMLElement> & { preventDefault: ReturnType<typeof vi.fn> };
}

function setup(options: { isSwapInFlight?: () => boolean } = {}) {
  const edits: GanttBarEdit[] = [];
  const onUpdateBar = vi.fn((e: GanttBarEdit) => { edits.push(e); });
  const hook = renderHook(() => useGanttBarDrag(onUpdateBar, options));
  const press = (k: string, mode: BarDragMode = "move", opts: { shiftKey?: boolean; altKey?: boolean } = {}) => {
    const e = key(k, opts);
    act(() => { hook.result.current.onBarKeyDown(e, TASK, BAR, mode); });
    return e;
  };
  return { hook, edits, onUpdateBar, press };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("useGanttBarDrag — keyboard (§742)", () => {
  it("arrows move the preview and commit once, after the pause", () => {
    const { hook, edits, press } = setup();
    expect(press("ArrowRight").preventDefault).toHaveBeenCalled();
    press("ArrowRight");
    expect(hook.result.current.barDragDeltaDays).toBe(2);
    expect(hook.result.current.barDrag?.mode).toBe("move");
    expect(edits).toEqual([]);
    act(() => { vi.advanceTimersByTime(MILESTONE_KEY_COMMIT_DELAY_MS); });
    expect(edits).toEqual([{ taskId: 7, startDate: "2026-03-12", dueDate: "2026-03-16" }]);
    expect(hook.result.current.barDrag).toBeNull();
  });

  it("Shift+arrow and PageDown step a week", () => {
    const { edits, press } = setup();
    press("ArrowRight", "move", { shiftKey: true });
    press("PageDown");
    press("ArrowLeft");
    press("Enter");
    expect(edits).toEqual([{ taskId: 7, startDate: "2026-03-09", dueDate: "2026-03-13" }]);
  });

  it("the start handle moves only the start, the end handle only the due date", () => {
    const { edits, press } = setup();
    press("ArrowLeft", "resize-start");
    press("Enter", "resize-start");
    press("ArrowRight", "resize-end");
    press("Enter", "resize-end");
    expect(edits).toEqual([
      { taskId: 7, startDate: "2026-03-09", dueDate: "2026-03-14" },
      { taskId: 7, startDate: "2026-03-10", dueDate: "2026-03-15" },
    ]);
  });

  it("Escape cancels the pending edit and nothing is saved", () => {
    const { hook, edits, press } = setup();
    press("ArrowRight");
    expect(press("Escape").preventDefault).toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(MILESTONE_KEY_COMMIT_DELAY_MS * 2); });
    expect(edits).toEqual([]);
    expect(hook.result.current.barDrag).toBeNull();
  });

  it("leaving the handle commits; leaving another one does not", () => {
    const { hook, edits, press } = setup();
    press("ArrowRight", "resize-end");
    act(() => { hook.result.current.onBarBlur(7, "move"); });
    expect(edits).toEqual([]);
    act(() => { hook.result.current.onBarBlur(7, "resize-end"); });
    expect(edits).toEqual([{ taskId: 7, startDate: "2026-03-10", dueDate: "2026-03-15" }]);
  });

  it("a resize stops at the bar's other end, and a press back moves the edge at once", () => {
    const { hook, edits, press } = setup();
    for (let i = 0; i < 6; i++) press("ArrowLeft", "resize-end");
    expect(hook.result.current.barDragDeltaDays).toBe(-4);
    press("ArrowRight", "resize-end");
    press("Enter", "resize-end");
    expect(edits).toEqual([{ taskId: 7, startDate: "2026-03-10", dueDate: "2026-03-11" }]);
  });

  it("a press on another handle lands the pending edit first and continues from its dates", () => {
    const { edits, press } = setup();
    press("ArrowRight", "move");
    press("ArrowRight", "resize-end");
    press("Enter", "resize-end");
    expect(edits).toEqual([
      { taskId: 7, startDate: "2026-03-11", dueDate: "2026-03-15" },
      { taskId: 7, startDate: "2026-03-11", dueDate: "2026-03-16" },
    ]);
  });

  it("ignores other keys and modified arrows, and saves nothing that changes no date", () => {
    const { edits, press } = setup();
    expect(press("a").preventDefault).not.toHaveBeenCalled();
    expect(press("ArrowRight", "move", { altKey: true }).preventDefault).not.toHaveBeenCalled();
    press("ArrowRight");
    press("ArrowLeft");
    press("Enter");
    expect(edits).toEqual([]);
  });

  it("a pointer drag on the bar lands the pending keys first and starts from the dates they produced", () => {
    const { hook, edits, press } = setup();
    press("ArrowRight");
    const down = { clientX: 100, pointerId: 1, stopPropagation: vi.fn() } as unknown as React.PointerEvent<HTMLDivElement>;
    act(() => { hook.result.current.startBarDrag(down, TASK, BAR, "move"); });
    expect(edits).toEqual([{ taskId: 7, startDate: "2026-03-11", dueDate: "2026-03-15" }]);
    act(() => {
      window.dispatchEvent(Object.assign(new Event("pointermove"), { clientX: 100 + DAY_WIDTH_PX, pointerId: 1 }));
      window.dispatchEvent(Object.assign(new Event("pointerup"), { clientX: 100 + DAY_WIDTH_PX, pointerId: 1 }));
    });
    expect(edits[1]).toEqual({ taskId: 7, startDate: "2026-03-12", dueDate: "2026-03-16" });
  });

  it("a pending edit lands on unmount, unless a project swap is tearing the chart down", () => {
    const kept = setup();
    kept.press("ArrowRight");
    kept.hook.unmount();
    expect(kept.edits).toEqual([{ taskId: 7, startDate: "2026-03-11", dueDate: "2026-03-15" }]);
    const swapped = setup({ isSwapInFlight: () => true });
    swapped.press("ArrowRight");
    swapped.hook.unmount();
    expect(swapped.edits).toEqual([]);
  });

  it("does nothing without an edit callback", () => {
    const hook = renderHook(() => useGanttBarDrag(undefined));
    const e = key("ArrowRight");
    act(() => { hook.result.current.onBarKeyDown(e, TASK, BAR, "move"); });
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(hook.result.current.barDrag).toBeNull();
  });
});

describe("clampKeyDays", () => {
  const drag = (mode: BarDragMode): BarDrag => ({
    taskId: 1, mode, startClientX: 0, initialStart: BAR.start, initialEnd: BAR.end, pointerId: -1, moved: true,
  });
  it("holds a resize at the other end and leaves a move alone", () => {
    expect(clampKeyDays(drag("resize-start"), 9)).toBe(4);
    expect(clampKeyDays(drag("resize-end"), -9)).toBe(-4);
    expect(clampKeyDays(drag("move"), -9)).toBe(-9);
  });
});
