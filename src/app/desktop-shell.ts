// Is the app running inside its own Electron desktop shell, rather than in a
// browser tab?
//
// ★★★ THIS DECIDES WHETHER A CONTROL WOULD BE LYING. Electron refuses a
// renderer-initiated `window.print()` — its binary carries the string
// `Scripted print is not supported` — so every in-pane Print button was
// offering something that could not happen in the packaged app. Printing there
// goes through the desktop shell's own File → Print… item, which calls
// `webContents.print()` from the main process.
//
// ★★ A STRING PARAMETER, not a read of `navigator`, so this is testable with
// no global to stub and no jsdom behaviour to depend on. The caller supplies
// the user agent — and must do so in a hydration-safe way, because the app IS
// server-rendered (`page.tsx` renders the client tree behind `await
// connection()`): reading `navigator` straight from a render body makes the
// server and the client disagree, and the server has no `navigator` at all.
// `task-manager-ui.tsx` uses the `useSyncExternalStore` pattern that
// `global-search-box.tsx` already established for exactly this.
//
// ★★ Case-SENSITIVE, and no version suffix required. Electron's user agent
// always spells it `Electron/<version>`, so matching the bare word survives a
// format change while staying specific enough — no browser puts `Electron` in
// its UA. Matching case-insensitively would be looser for no gain and could
// hit an unrelated device or product name.
export function isDesktopShellUserAgent(userAgent: string): boolean {
  return userAgent.includes("Electron");
}
