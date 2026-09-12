// Is a window still usable, or has Electron destroyed it?
//
// ★★★ ONE LIVENESS IDIOM FOR THE WHOLE SHELL, and it is pure so it can be
// tested. main.ts is the file the blocking root typecheck skips and no unit
// test can import, so every decision that lived there was pinned by nothing --
// the `const target = win` mutant (printing the wrong window) survived the
// entire gate suite until the decision moved out here.
//
// ★★ `win` IS ASSIGNED ONCE AND NEVER SET BACK TO NULL (`grep -n "win = "
// desktop/src/main.ts` returns a single line), so a `win?.` optional-chain in
// that file guards only the moments before start() runs. It does NOT guard a
// DESTROYED window, which is the state that actually matters: touching
// `webContents` on one throws SYNCHRONOUSLY, and a menu click is not covered
// by the startup `.catch`. That is why callers ask this instead of `if (win)`.
//
// ★ Structural rather than Electron-typed on purpose: the decision needs
// exactly one capability, so taking `BrowserWindow` would drag in a type the
// test cannot construct for no gain. main.ts passes real BrowserWindows and
// the generic hands the same type back, so the caller keeps `.webContents`.
export interface DestroyableWindow {
  isDestroyed(): boolean;
}

export function liveWindow<W extends DestroyableWindow>(
  candidate: W | null | undefined,
): W | null {
  if (candidate === null || candidate === undefined) return null;
  return candidate.isDestroyed() ? null : candidate;
}
