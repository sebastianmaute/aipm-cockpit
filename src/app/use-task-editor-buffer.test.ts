import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useTaskEditorBuffer } from "./use-task-editor-buffer";

describe("useTaskEditorBuffer", () => {
  it("stages raid + links and flushes them against the resolved parent id", () => {
    const applyRaid = vi.fn();
    const applyLink = vi.fn();
    const { result } = renderHook(() => useTaskEditorBuffer({ applyRaid, applyLink }));
    act(() => result.current.stageRaid({ category: "R", title: "Risk A" }));
    act(() => result.current.stageLink({ childId: 42, direction: "predecessor", type: "FS" }));
    act(() => result.current.flush(7));
    expect(applyRaid).toHaveBeenCalledWith(7, { category: "R", title: "Risk A" });
    expect(applyLink).toHaveBeenCalledWith(7, { childId: 42, direction: "predecessor", type: "FS" });
    expect(result.current.pendingRaid).toHaveLength(0);
    expect(result.current.pendingLinks).toHaveLength(0);
  });

  it("discard drops the buffer without applying", () => {
    const applyRaid = vi.fn();
    const applyLink = vi.fn();
    const { result } = renderHook(() => useTaskEditorBuffer({ applyRaid, applyLink }));
    act(() => result.current.stageRaid({ category: "A", title: "x" }));
    act(() => result.current.discard());
    expect(applyRaid).not.toHaveBeenCalled();
    expect(result.current.pendingRaid).toHaveLength(0);
  });

  it("flush applies each staged item exactly once (strict-mode-safe)", () => {
    const applyRaid = vi.fn();
    const applyLink = vi.fn();
    const { result } = renderHook(() => useTaskEditorBuffer({ applyRaid, applyLink }));
    act(() => {
      result.current.stageRaid({ category: "R", title: "one" });
      result.current.stageRaid({ category: "I", title: "two" });
      result.current.stageLink({ childId: 3, direction: "successor", type: "FS" });
    });
    act(() => result.current.flush(99));
    expect(applyRaid).toHaveBeenCalledTimes(2);
    expect(applyLink).toHaveBeenCalledTimes(1);
    expect(result.current.pendingRaid).toHaveLength(0);
    expect(result.current.pendingLinks).toHaveLength(0);
  });
});
