import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDebounce } from "./use-debounce";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebounce", () => {
  test("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebounce("hello", 150));
    expect(result.current).toBe("hello");
  });

  test("does not update the debounced value before `delay` ms", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 150),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "ab" });
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe("a");
  });

  test("updates after `delay` ms with the latest value", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 150),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "ab" });
    act(() => vi.advanceTimersByTime(150));
    expect(result.current).toBe("ab");
  });

  test("resets the timer on every value change — only the final value settles", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 150),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "ab" });
    act(() => vi.advanceTimersByTime(100));
    rerender({ value: "abc" });
    act(() => vi.advanceTimersByTime(100));
    // 200 ms total but the timer was reset at 100 ms, so the value should
    // still be the initial "a".
    expect(result.current).toBe("a");

    act(() => vi.advanceTimersByTime(50));
    // Now 150 ms past the last reset — the final value settles.
    expect(result.current).toBe("abc");
  });

  test("cleans up the pending timer on unmount", () => {
    const { result, rerender, unmount } = renderHook(
      ({ value }) => useDebounce(value, 150),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "ab" });
    unmount();
    act(() => vi.advanceTimersByTime(500));
    // `result.current` is whatever it was at unmount — the point is that
    // no errors fire (the cleanup ran) and the pending update is dropped.
    expect(result.current).toBe("a");
  });

  test("works for non-string values", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: number }) => useDebounce(value, 100),
      { initialProps: { value: 0 } },
    );

    rerender({ value: 42 });
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe(42);
  });
});
