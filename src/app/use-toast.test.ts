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

  it("auto-dismisses toast after 4000ms", async () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("error", "oops");
    });
    expect(result.current.toast).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current.toast).toBeNull();
  });

  it("calling showToast twice resets the timer", async () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("info", "first");
    });
    const firstId = result.current.toast?.id;
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      result.current.showToast("info", "second");
    });
    const secondId = result.current.toast?.id;
    expect(secondId).not.toBe(firstId);
    // 2000ms more (4000ms total from first) — timer restarted, still alive
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.toast).not.toBeNull();
    expect(result.current.toast?.text).toBe("second");
    // 2000ms more (4000ms from second showToast) — now dismissed
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.toast).toBeNull();
  });
});
