// §798 — the countdown behind "Claude is busy, trying again in N s…". Fake timers: no wait here is real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { RETRY_WAIT_TICK_MS, useRetryWait } from "./use-retry-wait";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useRetryWait", () => {
  it("is idle until a wait starts", () => {
    const { result } = renderHook(() => useRetryWait());
    expect(result.current.secondsLeft).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("counts down in whole seconds, rounded up, and ends with the timer cleared", () => {
    const { result } = renderHook(() => useRetryWait());
    act(() => result.current.start(12_000));
    expect(result.current.secondsLeft).toBe(12);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.secondsLeft).toBe(7);
    act(() => {
      vi.advanceTimersByTime(7_000 - RETRY_WAIT_TICK_MS);
    });
    expect(result.current.secondsLeft).toBe(1);
    act(() => {
      vi.advanceTimersByTime(RETRY_WAIT_TICK_MS);
    });
    expect(result.current.secondsLeft).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clear() ends the wait at once and leaves no timer", () => {
    const { result } = renderHook(() => useRetryWait());
    act(() => result.current.start(12_000));
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(vi.getTimerCount()).toBe(1);
    act(() => result.current.clear());
    expect(result.current.secondsLeft).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a second start resets the end time", () => {
    const { result } = renderHook(() => useRetryWait());
    act(() => result.current.start(12_000));
    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    expect(result.current.secondsLeft).toBe(4);
    act(() => result.current.start(30_000));
    expect(result.current.secondsLeft).toBe(30);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.secondsLeft).toBe(20);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("start and clear keep one identity across renders", () => {
    const { result, rerender } = renderHook(() => useRetryWait());
    const { start, clear } = result.current;
    act(() => start(5_000));
    rerender();
    expect(result.current.start).toBe(start);
    expect(result.current.clear).toBe(clear);
  });

  it("unmounting mid-wait leaves no timer", () => {
    const { result, unmount } = renderHook(() => useRetryWait());
    act(() => result.current.start(12_000));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
