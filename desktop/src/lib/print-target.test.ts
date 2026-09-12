// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isPrintCancellation, pickPrintTarget } from "./print-target";

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
    //
    // ★★★ MEASURED, and the earlier claim here was wrong. It named the mutant
    // `focused.isDestroyed() ? main : focused` and said it "would pass every
    // other case here and fail this one" -- reasoned, not run. That form
    // dereferences a null `focused`, so it actually THROWS on four cases and
    // fails one: a stronger kill than claimed, but not the single-case mutant
    // described. The null-safe form a developer would really write,
    //   focused != null && focused.isDestroyed() ? liveWindow(main)
    //                                            : liveWindow(focused ?? main)
    // IS single-case: run against all nine assertions in this file it gives
    // 1 failed / 8 passed, the failure being this test, with no TypeError
    // anywhere. That is the mutant this assertion exists for.
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

describe("isPrintCancellation", () => {
  it("recognises the cancellation string that exists in the Electron binary", () => {
    // ★★★ THE TITLE USED TO SAY "the string Chromium actually sends" and the
    // comment said "MEASURED, NOT ASSUMED". Neither was supportable by the
    // command attached to it. What IS measured:
    //   grep -aoih "print job cancel[a-z]*" \
    //     desktop/node_modules/electron/dist/electron.exe
    // returns one hit, `Print job canceled`. That proves the string is IN THE
    // BINARY -- not that it is the `failureReason` this callback receives on a
    // user cancellation. Nothing runnable here can prove that: the callback
    // needs a real Electron window. STILL UNVERIFIED, and the reason the
    // matcher below is deliberately loose.
    expect(isPrintCancellation("Print job canceled")).toBe(true);
  });

  it("matches the stem, so a reworded reason cannot become an error", () => {
    // ★★ This is the assertion that forbids a `=== "Print job canceled"`
    // mutant, and the argument for it is measured over the same binary:
    // `Printing is already in progress` and `No printers found` -- both
    // plausible from Electron's docs -- have ZERO occurrences, so the reason
    // vocabulary cannot be guessed and today's exact string is not a safe
    // thing to pin.
    // ★★★ THE SENTENCE THAT WAS HERE IS RETRACTED. It claimed "no
    // reason-shaped string in the binary except the cancellation one contains
    // cancel" -- unmeasurable ("reason-shaped" has no definition) and, on the
    // evidence, wrong: the binary holds hundreds of distinct cancel-containing
    // strings. The source comment on isPrintCancellation carries the honest
    // version; round 2 corrected it there and left this copy standing, which
    // is where the next reader met it first.
    expect(isPrintCancellation("Print job cancelled")).toBe(true);
    expect(isPrintCancellation("cancelled by user")).toBe(true);
    expect(isPrintCancellation("CANCELED")).toBe(true);
  });

  it("does NOT swallow a real failure", () => {
    // The whole point of classifying rather than ignoring every failure: a
    // printer that is not there has to reach the log.
    // ★ `Invalid printer settings` IS in the binary (one hit). `No printers
    // found` is NOT -- it is an illustrative fixture, kept because the
    // matcher must reject unfamiliar wording too, not evidence of a real
    // reason string.
    expect(isPrintCancellation("Invalid printer settings")).toBe(false);
    expect(isPrintCancellation("No printers found")).toBe(false);
    expect(isPrintCancellation("")).toBe(false);
  });
});
