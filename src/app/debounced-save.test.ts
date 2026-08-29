import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { scheduleDebouncedSave } from "./debounced-save";

describe("scheduleDebouncedSave", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does not save before the delay elapses", () => {
    const save = vi.fn();
    scheduleDebouncedSave(save, 500);
    vi.advanceTimersByTime(499);
    expect(save).not.toHaveBeenCalled();
  });

  it("saves once the delay elapses", () => {
    const save = vi.fn();
    scheduleDebouncedSave(save, 500);
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending save when cleaned up", () => {
    const save = vi.fn();
    scheduleDebouncedSave(save, 500)();
    vi.advanceTimersByTime(1000);
    expect(save).not.toHaveBeenCalled();
  });

  it("flushes immediately when the page is hidden", () => {
    const save = vi.fn();
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    scheduleDebouncedSave(save, 500);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(save).toHaveBeenCalledTimes(1);
    hidden.mockRestore();
  });

  it("ignores a visibilitychange that did not hide the page", () => {
    const save = vi.fn();
    const visible = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    scheduleDebouncedSave(save, 500);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(save).not.toHaveBeenCalled();
    visible.mockRestore();
  });

  it("flushes on pagehide", () => {
    const save = vi.fn();
    scheduleDebouncedSave(save, 500);
    window.dispatchEvent(new Event("pagehide"));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("never double-fires: a flush after the timer already fired is a no-op", () => {
    const save = vi.fn();
    scheduleDebouncedSave(save, 500);
    vi.advanceTimersByTime(500);
    window.dispatchEvent(new Event("pagehide"));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("never double-fires: the timer after a flush is a no-op", () => {
    const save = vi.fn();
    scheduleDebouncedSave(save, 500);
    window.dispatchEvent(new Event("pagehide"));
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("stops listening after cleanup, so a later pagehide cannot save", () => {
    const save = vi.fn();
    scheduleDebouncedSave(save, 500)();
    window.dispatchEvent(new Event("pagehide"));
    expect(save).not.toHaveBeenCalled();
  });
});
