// WHICH window a print request should print.
//
// ★★★ EXTRACTED BECAUSE THE DECISION WAS PINNED BY NOTHING. It lived inline in
// main.ts, which is the one file under desktop/src that the blocking root
// typecheck skips and that no unit test can import -- so the mutant
// `const target = win` (restoring the very defect the focus fix repaired)
// survived every gate: 16 test files, 593 tests, both typechecks and eslint,
// all green. `vitest.config.ts` describes desktop/ as holding the shell's PURE
// launch logic; this is that, and `isPrintCancellation` next door is the same
// pattern.
//
// ★★ Structural, not Electron-typed, on purpose: the decision needs exactly
// one capability, so taking `BrowserWindow` here would drag in a type the test
// cannot construct for no gain. main.ts passes real BrowserWindows and the
// generic hands the same type back, so the caller keeps `.webContents`.
export interface PrintableWindow {
  isDestroyed(): boolean;
}

// ★★★ A DESTROYED FOCUSED WINDOW PRINTS NOTHING -- it deliberately does NOT
// fall back to the main window. Falling back would print something the user is
// not looking at, which is exactly the defect this whole path exists to fix;
// refusing costs them one keypress and a log line. The main window is the
// fallback only for the case where there is NO focused window at all.
export function pickPrintTarget<W extends PrintableWindow>(
  focused: W | null | undefined,
  main: W | null | undefined,
): W | null {
  const target = focused ?? main ?? null;
  if (target === null || target.isDestroyed()) return null;
  return target;
}
