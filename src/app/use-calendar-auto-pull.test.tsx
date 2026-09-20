import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCalendarAutoPull } from "./use-calendar-auto-pull";

const AUTO_PULL_INTERVAL_MS = 15 * 60 * 1000;

// Flush pending microtasks so an awaited pull inside the async tick settles.
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useCalendarAutoPull", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("invokes each pull exactly once on mount when enabled", async () => {
    vi.useFakeTimers();
    const p1 = vi.fn().mockResolvedValue(undefined);
    const p2 = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      renderHook(() => useCalendarAutoPull({ enabled: true, pulls: [p1, p2] }));
    });
    await flush();
    expect(p1).toHaveBeenCalledTimes(1);
    expect(p2).toHaveBeenCalledTimes(1);
  });

  it("invokes nothing on mount when disabled", async () => {
    vi.useFakeTimers();
    const p1 = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      renderHook(() => useCalendarAutoPull({ enabled: false, pulls: [p1] }));
    });
    await flush();
    expect(p1).not.toHaveBeenCalled();
  });

  // §548 — the runner mounts while the load is pending (`enabled` false), so its mount tick is a
  // no-op. The false→true flip when the load settles must pull at once, not wait for the next
  // visibilitychange or the 15-minute interval.
  it("pulls once when enabled flips false→true after mount (§548 — the load settles)", async () => {
    vi.useFakeTimers();
    const p1 = vi.fn().mockResolvedValue(undefined);
    let hook: { rerender: (props: { enabled: boolean }) => void } | undefined;
    await act(async () => {
      hook = renderHook<void, { enabled: boolean }>(({ enabled }) => useCalendarAutoPull({ enabled, pulls: [p1] }), { initialProps: { enabled: false } });
    });
    await flush();
    expect(p1).not.toHaveBeenCalled(); // control: nothing while pending
    await act(async () => { hook!.rerender({ enabled: true }); });
    await flush();
    expect(p1).toHaveBeenCalledTimes(1);
    // A re-render that stays enabled does not pull again.
    await act(async () => { hook!.rerender({ enabled: true }); });
    await flush();
    expect(p1).toHaveBeenCalledTimes(1);
  });

  it("fires each pull again after the 15-minute interval", async () => {
    vi.useFakeTimers();
    const p1 = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      renderHook(() => useCalendarAutoPull({ enabled: true, pulls: [p1] }));
    });
    await flush();
    expect(p1).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(AUTO_PULL_INTERVAL_MS);
    });
    await flush();
    expect(p1).toHaveBeenCalledTimes(2);
  });

  it("re-invokes the pulls on a visibilitychange to visible", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    const p1 = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      renderHook(() => useCalendarAutoPull({ enabled: true, pulls: [p1] }));
    });
    await flush();
    expect(p1).toHaveBeenCalledTimes(1);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(p1).toHaveBeenCalledTimes(2);
  });

  it("guards overlapping ticks — a second tick while one is in flight does not re-invoke", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    // A never-resolving pull keeps the first tick in flight.
    const p1 = vi.fn().mockReturnValue(new Promise<void>(() => {}));
    await act(async () => {
      renderHook(() => useCalendarAutoPull({ enabled: true, pulls: [p1] }));
    });
    await flush();
    expect(p1).toHaveBeenCalledTimes(1);
    // Fire a second tick via the interval while the first is still pending.
    await act(async () => {
      vi.advanceTimersByTime(AUTO_PULL_INTERVAL_MS);
    });
    await flush();
    // Also via a visibility change.
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(p1).toHaveBeenCalledTimes(1);
  });
});
