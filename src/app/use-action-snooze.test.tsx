import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useActionSnooze } from "./use-action-snooze";
import { SNOOZE_1H } from "./reminder-snooze";

describe("useActionSnooze", () => {
  beforeEach(() => { window.localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); window.localStorage.clear(); });

  it("adds a snoozed id to dismissed, and removes it after expiry", () => {
    const { result } = renderHook(() => useActionSnooze());
    act(() => result.current.snooze("raid:1:severity", SNOOZE_1H));
    expect(result.current.dismissed.has("raid:1:severity")).toBe(true);
    act(() => { vi.advanceTimersByTime(SNOOZE_1H + 1000); });
    expect(result.current.dismissed.has("raid:1:severity")).toBe(false);
  });
});
