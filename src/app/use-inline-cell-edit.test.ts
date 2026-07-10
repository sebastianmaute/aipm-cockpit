import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInlineCellEdit } from "./use-inline-cell-edit";

describe("useInlineCellEdit", () => {
  it("tracks the active cell + draft, commits, and cancels", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useInlineCellEdit(onCommit));
    act(() => result.current.begin("dueDate", "2026-07-01"));
    expect(result.current.editing).toBe("dueDate");
    expect(result.current.draft).toBe("2026-07-01");
    act(() => result.current.setDraft("2026-07-15"));
    act(() => result.current.commit());
    expect(onCommit).toHaveBeenCalledWith("dueDate", "2026-07-15");
    expect(result.current.editing).toBeNull();
  });

  it("cancel drops the draft without committing", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useInlineCellEdit(onCommit));
    act(() => result.current.begin("priority", "Low"));
    act(() => result.current.cancel());
    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.editing).toBeNull();
  });

  it("commit is a no-op when no cell is active (guards double-commit)", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useInlineCellEdit(onCommit));
    act(() => result.current.commit());
    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.editing).toBeNull();
  });
});
