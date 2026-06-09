import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { createSettingsLogger, SETTINGS_LOG_DEBOUNCE_MS } from "./settings-log";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createSettingsLogger", () => {
  test("SETTINGS_LOG_DEBOUNCE_MS is a positive number", () => {
    expect(typeof SETTINGS_LOG_DEBOUNCE_MS).toBe("number");
    expect(SETTINGS_LOG_DEBOUNCE_MS).toBeGreaterThan(0);
  });

  test("multiple notifyChange() calls within the window collapse into ONE log call", () => {
    const log = vi.fn();
    const logger = createSettingsLogger(log, 500);

    logger.notifyChange();
    logger.notifyChange();
    logger.notifyChange();

    // No log yet — still within debounce window.
    expect(log).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(log).toHaveBeenCalledTimes(1);
  });

  test("a notifyChange() after the first window fires fires again (second call)", () => {
    const log = vi.fn();
    const logger = createSettingsLogger(log, 500);

    logger.notifyChange();
    vi.advanceTimersByTime(500);
    expect(log).toHaveBeenCalledTimes(1);

    logger.notifyChange();
    vi.advanceTimersByTime(500);
    expect(log).toHaveBeenCalledTimes(2);
  });

  test("rapid calls reset the trailing timer — only fires once after the quiet period", () => {
    const log = vi.fn();
    const logger = createSettingsLogger(log, 500);

    logger.notifyChange();
    vi.advanceTimersByTime(400);
    logger.notifyChange(); // resets
    vi.advanceTimersByTime(400);
    // 800 ms total but the timer was reset at 400 ms, so nothing yet.
    expect(log).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100); // now 500 ms past last notifyChange
    expect(log).toHaveBeenCalledTimes(1);
  });

  test("cancel() prevents a pending log from firing", () => {
    const log = vi.fn();
    const logger = createSettingsLogger(log, 500);

    logger.notifyChange();
    vi.advanceTimersByTime(300);
    logger.cancel();
    vi.advanceTimersByTime(500);

    expect(log).not.toHaveBeenCalled();
  });

  test("cancel() is a no-op when no timer is pending", () => {
    const log = vi.fn();
    const logger = createSettingsLogger(log, 500);

    // Nothing scheduled — cancel should not throw.
    expect(() => logger.cancel()).not.toThrow();
    expect(log).not.toHaveBeenCalled();
  });

  test("accepts injected setTimeout/clearTimeout for deterministic testing", () => {
    const log = vi.fn();
    const fakeCbs: Array<() => void> = [];
    const fakeSetTimeout = (...args: Parameters<typeof setTimeout>) => {
      fakeCbs.push(args[0] as () => void);
      return 1 as unknown as ReturnType<typeof setTimeout>;
    };
    const fakeClearTimeout = vi.fn();

    const logger = createSettingsLogger(log, 500, fakeSetTimeout, fakeClearTimeout);

    logger.notifyChange();
    expect(fakeCbs).toHaveLength(1);
    expect(log).not.toHaveBeenCalled();

    fakeCbs[0]();
    expect(log).toHaveBeenCalledTimes(1);
  });
});
