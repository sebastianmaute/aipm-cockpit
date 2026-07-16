import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_DURATION_MS, useToast } from "./use-toast";

describe("useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("TOAST_DURATION_MS is 7000ms", () => {
    expect(TOAST_DURATION_MS).toBe(7000);
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

  it("preserves the success kind", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("success", "saved");
    });
    expect(result.current.toast?.kind).toBe("success");
  });

  it("auto-dismisses toast after TOAST_DURATION_MS", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("error", "oops");
    });
    expect(result.current.toast).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
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
      vi.advanceTimersByTime(TOAST_DURATION_MS / 2);
    });
    act(() => {
      result.current.showToast("info", "second");
    });
    const secondId = result.current.toast?.id;
    expect(secondId).not.toBe(firstId);
    // Half a duration more — timer restarted, still alive
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS / 2);
    });
    expect(result.current.toast).not.toBeNull();
    expect(result.current.toast?.text).toBe("second");
    // Full duration from the second showToast — now dismissed
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS / 2);
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

  it("pause() stops the auto-dismiss timer so the toast survives", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("info", "sticky");
    });
    act(() => {
      result.current.pause();
    });
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 3);
    });
    expect(result.current.toast).not.toBeNull();
    expect(result.current.toast?.text).toBe("sticky");
  });

  it("resume() re-arms the timer and the toast dismisses", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("info", "hover");
    });
    act(() => {
      result.current.pause();
    });
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 2);
    });
    expect(result.current.toast).not.toBeNull();
    act(() => {
      result.current.resume();
    });
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(result.current.toast).toBeNull();
  });

  it("a new toast resets the paused state", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("info", "first");
    });
    act(() => {
      result.current.pause();
    });
    // Advance so Date.now()-based ids differ (the id-keyed effect re-arms).
    act(() => {
      vi.advanceTimersByTime(1);
    });
    // New toast should auto-dismiss even though we paused the prior one.
    act(() => {
      result.current.showToast("success", "second");
    });
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(result.current.toast).toBeNull();
  });
});
