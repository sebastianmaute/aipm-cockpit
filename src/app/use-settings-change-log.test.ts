// Pins useSettingsChangeLog (use-settings-change-log.ts, §491): the debounced,
// actor-less "settings.updated" row. It is skipped before hydration and on the
// first hydrated run, coalesced over SETTINGS_LOG_DEBOUNCE_MS, suppressed for a
// change the AI already logged (§160: credits are CLEARED, not decremented), and
// cancelled only on unmount. `logActivity` is a mock.
//
// ★★ Fake timers are installed BEFORE renderHook in every test: the logger is
// built during the first render and closes over whatever `setTimeout` was
// global then (task-manager.activity-actor.test.tsx says the same of the real
// component, where a later `vi.useFakeTimers()` passes vacuously).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { SETTINGS_LOG_DEBOUNCE_MS } from "./settings-log";
import type { Settings } from "./settings-types";
import { useSettingsChangeLog, type SettingsChangeLogDeps } from "./use-settings-change-log";

// Only the identity matters to the hook: its effect depends on `settings` and reads nothing in it.
function freshSettings(): Settings {
  return {} as Settings;
}

function mount(initial: Partial<SettingsChangeLogDeps> = {}) {
  const logActivity = vi.fn();
  const deps: SettingsChangeLogDeps = { settings: freshSettings(), hydrated: true, logActivity, ...initial };
  const view = renderHook((d: SettingsChangeLogDeps) => useSettingsChangeLog(d), { initialProps: deps });
  let current = deps;
  /** Rerender with a new settings identity (and any other overrides). */
  const change = (over: Partial<SettingsChangeLogDeps> = {}) => {
    current = { ...current, settings: freshSettings(), ...over };
    view.rerender(current);
  };
  /** Rerender keeping the settings identity (and applying any other overrides). */
  const same = (over: Partial<SettingsChangeLogDeps> = {}) => {
    current = { ...current, ...over };
    view.rerender(current);
  };
  const settle = () => act(() => { vi.advanceTimersByTime(SETTINGS_LOG_DEBOUNCE_MS + 1); });
  return { ...view, logActivity, change, same, settle };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useSettingsChangeLog — when a row is written", () => {
  it("skips the first hydrated run (the loaded value), then logs one actor-less row per later change", () => {
    const h = mount();
    h.settle();
    expect(h.logActivity).not.toHaveBeenCalled();

    h.change();
    h.settle();
    expect(h.logActivity).toHaveBeenCalledTimes(1);
    // Exactly the kind, no args: the row carries no field values (secrets).
    expect(h.logActivity).toHaveBeenCalledWith("settings.updated");
  });

  it("writes nothing while not hydrated, and the hydration flip itself is the skipped first run", () => {
    const h = mount({ hydrated: false });
    h.change();
    h.change();
    h.settle();
    expect(h.logActivity).not.toHaveBeenCalled();

    h.change({ hydrated: true });
    h.settle();
    expect(h.logActivity).not.toHaveBeenCalled();

    h.change();
    h.settle();
    expect(h.logActivity).toHaveBeenCalledTimes(1);
  });

  // ★ `hydrated` must be a dependency on its own. The test above flips it
  // together with a new settings identity, so it cannot tell `[settings, hydrated]`
  // from `[settings]`; here only `hydrated` changes, and that run alone must
  // consume the initial-run skip, leaving the next real change to be logged.
  it("a hydration flip with the SAME settings is the skipped first run", () => {
    const h = mount({ hydrated: false });
    h.same({ hydrated: true });
    h.settle();
    expect(h.logActivity).not.toHaveBeenCalled();

    h.change();
    h.settle();
    expect(h.logActivity).toHaveBeenCalledTimes(1);
  });

  it("waits out the debounce and coalesces a burst into one row", () => {
    const h = mount();
    h.change();
    act(() => { vi.advanceTimersByTime(SETTINGS_LOG_DEBOUNCE_MS - 1); });
    expect(h.logActivity).not.toHaveBeenCalled();
    h.change();
    act(() => { vi.advanceTimersByTime(SETTINGS_LOG_DEBOUNCE_MS - 1); });
    expect(h.logActivity).not.toHaveBeenCalled();
    h.settle();
    expect(h.logActivity).toHaveBeenCalledTimes(1);
  });

  it("does not run on a rerender that keeps the same settings identity", () => {
    const h = mount();
    h.change();
    h.settle();
    h.logActivity.mockClear();
    h.same();
    h.same();
    h.settle();
    expect(h.logActivity).not.toHaveBeenCalled();
  });
});

describe("useSettingsChangeLog — §160 AI credits", () => {
  it("a credited change writes no actor-less row", () => {
    const h = mount();
    act(() => h.result.current.onSettingsLoggedByAi());
    h.change();
    h.settle();
    expect(h.logActivity).not.toHaveBeenCalled();
  });

  it("CLEARS the credits: two credits against one run leave none to eat the user's next change", () => {
    const h = mount();
    act(() => {
      h.result.current.onSettingsLoggedByAi();
      h.result.current.onSettingsLoggedByAi();
    });
    h.change();
    h.settle();
    expect(h.logActivity).not.toHaveBeenCalled();

    h.change();
    h.settle();
    expect(h.logActivity).toHaveBeenCalledTimes(1);
  });

  it("a credited run inside the debounce window keeps the user's pending row", () => {
    const h = mount();
    h.change();
    act(() => { vi.advanceTimersByTime(Math.floor(SETTINGS_LOG_DEBOUNCE_MS / 3)); });
    act(() => h.result.current.onSettingsLoggedByAi());
    h.change();
    h.settle();
    expect(h.logActivity).toHaveBeenCalledTimes(1);
  });
});

describe("useSettingsChangeLog — unmount", () => {
  it("cancels a pending row", () => {
    const h = mount();
    h.change();
    h.unmount();
    h.settle();
    expect(h.logActivity).not.toHaveBeenCalled();
  });
});
