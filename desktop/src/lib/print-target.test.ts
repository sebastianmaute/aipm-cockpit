// @vitest-environment node
import { describe, expect, it } from "vitest";
import { pickPrintTarget } from "./print-target";

/** A stand-in for a BrowserWindow, carrying the one capability the decision needs. */
function win(label: string, destroyed = false) {
  return { label, isDestroyed: () => destroyed };
}

describe("pickPrintTarget", () => {
  it("prints the FOCUSED window when there is one", () => {
    // ★★★ THE MUTANT THIS EXISTS FOR: `const target = win` in main.ts, i.e.
    // ignoring the focused window and always printing the main one. That is
    // the defect the focus fix repaired, and before this file it survived
    // every gate in the repo -- main.ts is untestable and untypechecked by the
    // blocking job. MEASURED this round: planted as
    // `pickPrintTarget(_focused, main) => main`, this case fails and the suite
    // goes red.
    const focused = win("popout");
    const main = win("main");
    expect(pickPrintTarget(focused, main)).toBe(focused);
  });

  it("falls back to the main window when nothing is focused", () => {
    // Reached when the menu item is activated with no window focused. Printing
    // the main view beats doing nothing; see the comment at the call site for
    // why that should be unreachable from the accelerator.
    const main = win("main");
    expect(pickPrintTarget(null, main)).toBe(main);
    expect(pickPrintTarget(undefined, main)).toBe(main);
  });

  it("prints NOTHING when the focused window is destroyed", () => {
    // ★★ NOT a fallback to main, deliberately -- printing a window the user is
    // not looking at is the defect being fixed, so this refuses instead.
    // Mutant: `focused.isDestroyed() ? main : focused` would pass every other
    // case here and fail this one.
    const main = win("main");
    expect(pickPrintTarget(win("gone", true), main)).toBeNull();
  });

  it("prints nothing when the only candidate is destroyed", () => {
    expect(pickPrintTarget(null, win("main", true))).toBeNull();
  });

  it("prints nothing when there is no window at all", () => {
    // The pre-window state: main.ts holds `win = null` until start() runs.
    expect(pickPrintTarget(null, null)).toBeNull();
    expect(pickPrintTarget(undefined, undefined)).toBeNull();
  });

  it("asks each candidate whether it is destroyed, not the other one", () => {
    // ★ Kills a mutant that checks the WRONG object's liveness -- e.g.
    // `main.isDestroyed()` while returning `focused`. Here the focused window
    // is alive and the main one is destroyed, so the only correct answer is
    // the focused one.
    const focused = win("popout");
    expect(pickPrintTarget(focused, win("main", true))).toBe(focused);
  });
});
