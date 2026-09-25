// Is the app running inside its own Electron desktop shell, rather than in a
// browser tab?
//
// ★★★ THIS DECIDES WHETHER A CONTROL WOULD BE LYING: Electron refuses a
// renderer-initiated `window.print()`, so an in-pane Print button cannot work
// in the packaged app. Printing there is the shell's own File → Print… item.
//
// ★★ IT FIXED ONE OF THREE SUCH PATHS on its own — the other two, the PDF
// exports in `export.ts` and `document-download.ts`, stayed inert until
// **`docs/open-followups.md` §468** closed them via a separate main-process
// route (`desktop/src/lib/pdf-export.ts`; `pdf-export-protocol.ts` is the
// renderer half). Do not restate that story here; an earlier version of this
// header did, and that made three full copies of one narrative.
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

// The DOM CustomEvent name the desktop shell's Help -> Version menu item
// dispatches on `window` (see desktop/src/lib/menu-model.ts
// `versionRequestScript`) to ask the already-loaded page to open the app's
// own Version panel instead of a native dialog. `detail` carries
// `{ logPath, open }` (M-3, final-review-report.md -- this used to say
// `{ logPath: string }` alone; see `versionRequestScript` in
// desktop/src/lib/menu-model.ts and `readDetail` in
// use-desktop-version-request.ts for the real shape, and that hook's own
// docstring for what `open` distinguishes).
//
// ★★★ DECLARED ON BOTH SIDES OF THE BOUNDARY, not imported once, because
// desktop's tsconfig rootDir is `desktop/src` -- it cannot import anything
// under `src/app`, and `src/app` has no route back into `desktop/src` either
// (this is remote content to Electron, loaded over HTTP, not a Node module
// graph). `desktop/src/lib/menu-model.test.ts` reads THIS file as text and
// pins the two string literals equal, so a rename on one side without the
// other fails that test rather than silently going quiet in the packaged app.
export const DESKTOP_VERSION_REQUEST_EVENT = "aipm-cockpit-desktop-version-request";
