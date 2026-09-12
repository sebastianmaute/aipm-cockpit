// @vitest-environment node
import { describe, expect, it } from "vitest";
import { liveWindow } from "./window-liveness";

/** Stand-in for a BrowserWindow, carrying the one capability the decision needs. */
function win(label: string, destroyed = false) {
  return { label, isDestroyed: () => destroyed };
}

describe("liveWindow", () => {
  it("hands back a window that is still alive", () => {
    const w = win("main");
    expect(liveWindow(w)).toBe(w);
  });

  it("refuses a DESTROYED window", () => {
    // ★★★ THE WHOLE POINT, and what `if (win)` in main.ts could never do. `win`
    // is assigned once and never set back to null, so an optional chain there
    // is always true after start() — while the window it names can be gone.
    // Touching `webContents` on a destroyed one throws SYNCHRONOUSLY inside a
    // click handler, which no `.catch` and no startup handler sees.
    //
    // Mutant, MEASURED not reasoned: removing the token span
    // `candidate.isDestroyed() ? null : ` so the function returns the
    // candidate gives **4 failed / 9 passed** across this file and
    // print-target.test.ts — two here, and two there through
    // `pickPrintTarget`'s delegation. The delegation is why the print
    // decision inherits this guarantee instead of restating it.
    expect(liveWindow(win("gone", true))).toBeNull();
  });

  it("refuses absence, in both spellings", () => {
    // `null` is main.ts's pre-start() state; `undefined` is what
    // BrowserWindow.getFocusedWindow() can hand a caller through
    // pickPrintTarget's optional parameters.
    expect(liveWindow(null)).toBeNull();
    expect(liveWindow(undefined)).toBeNull();
  });

  it("asks the candidate itself, not a cached answer", () => {
    // A window that reports alive then destroyed must be judged per call —
    // kills a mutant that memoises the first answer.
    let destroyed = false;
    const w = { isDestroyed: () => destroyed };
    expect(liveWindow(w)).toBe(w);
    destroyed = true;
    expect(liveWindow(w)).toBeNull();
  });
});
