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

  // ── §589: the optional cleanup-flush predicate ────────────────────────────
  // ★ The DEFAULT (no predicate) is already pinned by "cancels the pending save when cleaned up"
  //   and "stops listening after cleanup" above — both call the two-argument form — so there is
  //   deliberately no duplicate of that here. What these add is the third exit's own behaviour.

  it("§589: flushes the pending save on cleanup when the predicate says the target changed", () => {
    const save = vi.fn();
    scheduleDebouncedSave(save, 500, () => true)();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("§589: does not flush on cleanup when the predicate says the target is unchanged", () => {
    const save = vi.fn();
    scheduleDebouncedSave(save, 500, () => false)();
    vi.advanceTimersByTime(1000); // and the cancelled timer must not resurrect it either
    expect(save).not.toHaveBeenCalled();
  });

  // ★★ THE COALESCING GUARANTEE, stated as a test rather than left to the predicate's caller: the
  //    predicate must be consulted ONLY on cleanup. If the timer or a hide listener asked it too,
  //    an ordinary debounced save would start depending on the caller's backend comparison.
  it("§589: consults the predicate only on cleanup — never on the timer or a hide flush", () => {
    const shouldFlush = vi.fn(() => false);
    const save = vi.fn();
    const cleanup = scheduleDebouncedSave(save, 500, shouldFlush);
    vi.advanceTimersByTime(500);
    window.dispatchEvent(new Event("pagehide"));
    expect(shouldFlush).not.toHaveBeenCalled();
    cleanup();
    expect(shouldFlush).toHaveBeenCalledTimes(1);
  });

  it("§589: never double-fires — a cleanup flush after the timer already fired is a no-op", () => {
    const save = vi.fn();
    const cleanup = scheduleDebouncedSave(save, 500, () => true);
    vi.advanceTimersByTime(500);
    cleanup();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("§589: a cleanup flush cancels the timer, so the delay elapsing cannot save again", () => {
    const save = vi.fn();
    scheduleDebouncedSave(save, 500, () => true)();
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  // ★★ DELIBERATELY ABSENT: "a cleanup flush still removes the listeners". Written and dropped —
  //    after a flush `fired` is already true, so a later `pagehide` is a no-op whether the listener
  //    was removed or not. It cannot fail for the reason its title would claim. Listener removal is
  //    isolated by "stops listening after cleanup" above, which takes the NO-flush path.
});
