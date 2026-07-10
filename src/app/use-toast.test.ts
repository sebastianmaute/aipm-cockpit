import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToast } from "./use-toast";

describe("useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("toast is null initially", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toast).toBeNull();
  });

  it("showToast sets toast with correct kind and text", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("info", "hello");
    });
    expect(result.current.toast).not.toBeNull();
    expect(result.current.toast?.kind).toBe("info");
    expect(result.current.toast?.text).toBe("hello");
  });

  it("auto-dismisses toast after 4000ms", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("error", "oops");
    });
    expect(result.current.toast).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current.toast).toBeNull();
  });

  it("calling showToast twice resets the timer", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("info", "first");
    });
    const firstId = result.current.toast?.id;
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      result.current.showToast("info", "second");
    });
    const secondId = result.current.toast?.id;
    expect(secondId).not.toBe(firstId);
    // 2000ms more (4000ms total from first) — timer restarted, still alive
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.toast).not.toBeNull();
    expect(result.current.toast?.text).toBe("second");
    // 2000ms more (4000ms from second showToast) — now dismissed
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.toast).toBeNull();
  });

  it("showToastAction attaches an action to the toast", () => {
    const { result } = renderHook(() => useToast());
    const run = () => {};
    act(() => result.current.showToastAction("info", "Deleted 3 tasks", { labelKey: "undo", run }));
    expect(result.current.toast?.text).toBe("Deleted 3 tasks");
    expect(result.current.toast?.action?.labelKey).toBe("undo");
    expect(result.current.toast?.action?.run).toBe(run);
  });

  it("showToast leaves action undefined (back-compat)", () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.showToast("info", "plain"));
    expect(result.current.toast?.action).toBeUndefined();
  });
});
