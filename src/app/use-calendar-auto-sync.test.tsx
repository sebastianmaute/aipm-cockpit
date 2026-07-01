import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useCalendarAutoSync } from "./use-calendar-auto-sync";

describe("useCalendarAutoSync", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("fires push once after the debounce when active with a new contentKey", () => {
    const push = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useCalendarAutoSync({ active: true, contentKey: "a", push }));
    expect(push).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4000);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("never fires when inactive", () => {
    const push = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useCalendarAutoSync({ active: false, contentKey: "a", push }));
    vi.advanceTimersByTime(10_000);
    expect(push).not.toHaveBeenCalled();
  });

  it("does not re-fire when the same contentKey re-renders", () => {
    const push = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ k }: { k: string }) => useCalendarAutoSync({ active: true, contentKey: k, push }),
      { initialProps: { k: "a" } },
    );
    vi.advanceTimersByTime(4000);
    expect(push).toHaveBeenCalledTimes(1);
    rerender({ k: "a" });
    vi.advanceTimersByTime(4000);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("fires again for a genuinely new contentKey", () => {
    const push = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ k }: { k: string }) => useCalendarAutoSync({ active: true, contentKey: k, push }),
      { initialProps: { k: "a" } },
    );
    vi.advanceTimersByTime(4000);
    rerender({ k: "b" });
    vi.advanceTimersByTime(4000);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("swallows a rejected push and still advances (fail-once-per-change)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const push = vi.fn().mockRejectedValue(new Error("boom"));
    const { rerender } = renderHook(
      ({ k }: { k: string }) => useCalendarAutoSync({ active: true, contentKey: k, push }),
      { initialProps: { k: "a" } },
    );
    vi.advanceTimersByTime(4000);
    // Flush the rejected promise's .catch so no unhandled rejection escapes.
    await Promise.resolve();
    expect(push).toHaveBeenCalledTimes(1);
    // Same key re-render must NOT re-fire even though the push failed.
    rerender({ k: "a" });
    vi.advanceTimersByTime(4000);
    expect(push).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
