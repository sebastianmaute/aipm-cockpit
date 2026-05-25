import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useReminderSnooze } from "./use-reminder-snooze";
import { SNOOZE_1H, getSnoozedUntil } from "./reminder-snooze";

describe("useReminderSnooze", () => {
  beforeEach(() => { window.localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it("is not snoozed initially", () => {
    const { result } = renderHook(() => useReminderSnooze("due"));
    expect(result.current.isSnoozed).toBe(false);
  });
  it("becomes snoozed after snooze() and persists", () => {
    const { result } = renderHook(() => useReminderSnooze("due"));
    act(() => result.current.snooze(SNOOZE_1H));
    expect(result.current.isSnoozed).toBe(true);
    expect(getSnoozedUntil("due")).toBeGreaterThan(Date.now());
  });
  it("auto-clears (re-shows) after the duration elapses", () => {
    const { result } = renderHook(() => useReminderSnooze("due"));
    act(() => result.current.snooze(SNOOZE_1H));
    act(() => { vi.advanceTimersByTime(SNOOZE_1H + 1000); });
    expect(result.current.isSnoozed).toBe(false);
  });
  it("clear() unsnoozes immediately", () => {
    const { result } = renderHook(() => useReminderSnooze("due"));
    act(() => result.current.snooze(SNOOZE_1H));
    act(() => result.current.clear());
    expect(result.current.isSnoozed).toBe(false);
  });
});
