// The Help menu's contents, as data.
//
// Kept Electron-free so it can be unit-tested: the wiring in main.ts turns
// each id into a click handler, but WHAT the menu offers is decided here.
export type HelpMenuItemId = "help" | "version" | "updates";

export interface HelpMenuItem {
  id: HelpMenuItemId;
  label: string;
}

// ★ ORDER IS RENDERED ORDER -- buildMenu maps this array straight into the
// submenu, so an edit here moves the menu under the user's cursor.
//
// ★ "Check for updates…" goes LAST, deliberately: it is the only entry that
// talks to the network, and appending it leaves the two entries that already
// shipped exactly where anyone who has used the app found them. The trailing
// "…" (U+2026, not three periods) is the Windows convention for "this opens
// something" rather than acting immediately.
export const HELP_MENU_ITEMS: readonly HelpMenuItem[] = [
  { id: "help", label: "Help" },
  { id: "version", label: "Version" },
  { id: "updates", label: "Check for updates…" },
];

// WHAT each entry does, named without naming HOW. main.ts owns the how (it
// needs Electron for all three); this owns the decision, so the decision is
// unit-testable and -- the point -- lands in the BLOCKING root `typecheck`
// job. Root tsconfig.json excludes `desktop/src/main.ts` and nothing else
// here, so a mapping written in main.ts is typechecked only by the desktop
// build, which is `allow_failure: true` on a merge request.
export type HelpMenuAction = "open-help" | "show-version" | "check-for-updates";

// ★★★ A `Record` KEYED BY THE UNION, deliberately NOT a switch with a
// `never` default. Both make a new HelpMenuItemId a compile error, but a
// switch needs something in its default branch and the honest something is a
// throw -- and this function is called EAGERLY from buildMenu()'s `.map`
// during start(), not at click time -- so a throw rejects start() and takes
// the WHOLE APP down through main.ts's fail(): a dialog saying "did not
// start", and a quit. A Record has no unreachable branch to fill, so there is
// nothing to throw from.
//
// ★★ PREMISE UPDATED, conclusion unchanged. This used to read "no window, no
// error dialog and nothing in launch.log: the silent non-start fail() exists
// to prevent", which was true while `app.whenReady().then(start)` had no
// `.catch`. It has one now, so such a throw is logged and shown rather than
// silent. It still ends with the user having no app, so the shape below is
// still the right one -- and it has two reasons of its own that never
// depended on that premise: no branch to fill, and exhaustiveness in BOTH
// directions inside the BLOCKING typecheck, which a switch in main.ts could
// not reach at all.
//
// ★ Exhaustive in BOTH directions: a union member with no key fails to
// typecheck, and a key that is not a union member fails as an excess
// property.
const HELP_ACTIONS: Record<HelpMenuItemId, HelpMenuAction> = {
  help: "open-help",
  version: "show-version",
  updates: "check-for-updates",
};

// ★ Returns `undefined` at runtime for an id outside the union -- which the
// type says cannot happen, and only a cast upstream could produce. Callers
// must still have a default branch that DEGRADES rather than throws; main.ts
// logs and hands back a no-op click.
export function helpAction(id: HelpMenuItemId): HelpMenuAction {
  return HELP_ACTIONS[id];
}

// ---------------------------------------------------------------------------
// The File menu.
//
// ★★ A SIBLING TYPE, not a widening of HelpMenuItemId, and that is forced
// rather than stylistic: buildMenu maps HELP_MENU_ITEMS into the HELP
// submenu, so a "print" member added there would render in the wrong menu
// entirely. Same split as the Help side though -- the decision is pure and
// lives in the blocking typecheck, the Electron call lives in main.ts.
//
// ★★★ WHY THIS MENU EXISTS AT ALL: in the packaged app the renderer cannot
// print. Electron refuses a renderer-initiated `window.print()` -- its binary
// carries the string `Scripted print is not supported`, verified with
//   grep -aoh "Scripted print is not supported" \
//     desktop/node_modules/electron/dist/electron.exe
// (from Electron's own print_view_manager_electron.cc, so the refusal is not
// per-window). The main process CAN print, via webContents.print(), and this
// is the route to it; the in-page buttons hide themselves in the shell
// (src/app/desktop-shell.ts) rather than lying.
//
// ★★ IT WAS NOT THE WHOLE FIX -- the two PDF-export renderer print paths
// (src/app/export.ts, src/app/document-download.ts) were inert in the
// packaged app. **docs/open-followups.md §468** routes them through a
// separate main-process route (desktop/src/lib/pdf-export.ts + the
// `did-create-window`/`printToPDF`/save-dialog wiring in main.ts), not this
// menu. That fix has landed, but §468 stays OPEN until the owed
// packaged-app check is done. An earlier version of this comment restated
// that story here, which made a third full copy of it.
export type FileMenuItemId = "print";
export type FileMenuAction = "print-window";

export interface FileMenuItem {
  id: FileMenuItemId;
  label: string;
  // Electron's own accelerator syntax: `CmdOrCtrl` resolves per platform. Kept
  // beside the label because it is part of what the user is shown, and because
  // Ctrl+P is the shortcut they will try before they find the menu.
  accelerator?: string;
}

// ★★ ENGLISH ONLY, and this one is a real (small) loss rather than a neutral
// limitation. The control it replaces was translated -- the in-pane button's
// name came from `t(lang, "printHint")`, EN and DE -- so a German user trades a
// German print affordance for an English-only one. It is consistent with
// HELP_MENU_ITEMS (and with the same cause: the language lives in renderer
// settings and the main process has no reader for it without an IPC channel
// and a preload, which is the Node surface this shell deliberately does not
// expose), so it is not a convention break. Recorded here, next to the
// hardcoded string, because that is where someone able to fix it will look.
export const FILE_MENU_ITEMS: readonly FileMenuItem[] = [
  { id: "print", label: "Print…", accelerator: "CmdOrCtrl+P" },
];

// Same Record-keyed-by-the-union shape as HELP_ACTIONS, for the same reason:
// exhaustive in both directions, and no unreachable branch that would need a
// throw. One member today; the shape is what keeps a second one honest.
const FILE_ACTIONS: Record<FileMenuItemId, FileMenuAction> = {
  print: "print-window",
};

export function fileAction(id: FileMenuItemId): FileMenuAction {
  return FILE_ACTIONS[id];
}

// ---------------------------------------------------------------------------

// The app's own help lives at a hash-addressable view, so the menu can open it
// by setting the fragment on the page that is ALREADY loaded.
//
// ★★ Deliberately NOT a full navigation. Reloading the origin would discard
// whatever the user has open and unsaved; assigning the hash fires the
// hashchange the app's own router already listens for. It is also why this
// needs no IPC and no preload: the renderer stays remote content with no Node
// surface, which is the security posture the desktop shell is built around.
export const HELP_VIEW_HASH = "#help";

// The view a relaunch should land on. `helpHashScript` already takes an
// arbitrary hash, so this needs no second script builder.
export const DASHBOARD_VIEW_HASH = "#dashboard";

export function helpHashScript(hash: string = HELP_VIEW_HASH): string {
  // Assigning an IDENTICAL hash fires no hashchange, so a second click while
  // already on Help would do nothing at all. Clearing first guarantees the
  // event.
  //
  // ★★ THE CLEAR IS NOT INERT MID-SESSION, and this comment used to say it
  // was ("the app routes an empty fragment back to its default view only on
  // load, not mid-session"). `useHashView`'s `apply` decides `blank` from the
  // fragment ALONE -- `raw === "" || raw === "#"` -- and routes a blank one to
  // the dashboard (or open-points when that module is off) on EVERY call, not
  // just the `apply(true)` at mount: the same function is the `hashchange` and
  // `popstate` listener. Its `cold` parameter narrows only the VIEW-ONLY-hash
  // branch, which `!blank` excludes. So clearing mid-session is itself a
  // navigation to the default view; the explicit assignment that follows is
  // what makes the target deliberate rather than incidental. Reproduce with
  // `grep -n "const blank\|cold && !blank\|addEventListener" src/app/use-hash-view.ts`.
  return `window.location.hash = ""; window.location.hash = ${JSON.stringify(hash)};`;
}

// The desktop shell's Help -> Version menu item no longer builds a native
// dialog. It asks the already-loaded page to open the SAME Version panel the
// web app shows (VersionInfoModal, src/app/version-info.tsx) by dispatching a
// DOM CustomEvent on `window` inside the renderer, via executeJavaScript --
// the same mechanism `helpHashScript` above already uses to navigate the Help
// view without a full page reload.
//
// ★★★ THE EVENT NAME IS DECLARED ON BOTH SIDES, not imported once, because
// desktop's tsconfig rootDir is `desktop/src` -- this file cannot import
// anything under `src/app`, and the renderer is remote HTTP content to
// Electron, not a Node module graph, so there is no route back either. The
// app's copy lives in src/app/desktop-shell.ts as
// `DESKTOP_VERSION_REQUEST_EVENT`; menu-model.test.ts's "shared strings with
// the app" describe block reads that file as TEXT and pins the two literals
// equal, so a rename on one side without the other fails a test rather than
// quietly going inert in the packaged app (main.ts is the one desktop file
// the blocking root typecheck skips and no unit test can import).
export const DESKTOP_VERSION_REQUEST_EVENT = "aipm-cockpit-desktop-version-request";

// Builds the script main.ts hands to `webContents.executeJavaScript`. A pure
// function, so it is unit-testable here rather than pinned by nothing (main.ts
// is the file the blocking typecheck skips).
//
// ★★★ JSON.stringify EVERY INTERPOLATED VALUE, not string concatenation. A
// Windows log path holds backslashes (`C:\Users\...\launch.log`), which would
// corrupt or -- worse, with a stray quote -- break out of a hand-built string
// literal. Wrapping the whole `detail` object in one JSON.stringify call
// covers the event name argument too, so there is exactly one non-literal
// value on each side of the CustomEvent constructor and both go through it.
//
// ★★ `open` IS PART OF THE CONTRACT, NOT JUST THE PATH. There are now TWO
// senders: a priming ping fired once per page load (`did-finish-load`, both
// the main window and every popout -- see the `web-contents-created` listener
// in main.ts) with `open: false`, which only lets the page remember the log
// path so it is already known the first time the panel opens; and the actual
// Help -> Version menu click, with `open: true`. The app's root listener
// (use-desktop-version-request.ts) only flips its modal open on the latter.
//
// ★★★ THE RETURN VALUE IS THE FIX FOR THE SILENT NO-OP. `executeJavaScript`
// resolves with the COMPLETION VALUE of the injected script, so wrapping the
// whole thing in one IIFE makes that value `!window.dispatchEvent(ev)` --
// `dispatchEvent` returns `false` only when a listener called
// `preventDefault()` on a `cancelable` event, so `!dispatchEvent(...)` is
// `true` exactly when SOMETHING handled the request. main.ts reads that
// boolean to decide whether to retry on the main window (see
// `requestVersionPanel`). The IIFE also keeps `ev` out of the page's global
// scope: two separate `executeJavaScript` calls both declaring a top-level
// `const` in the SAME global lexical environment throw "already declared" on
// the second one (a documented `Runtime.evaluate`/`executeJavaScript`
// footgun) -- an IIFE gives each call its own function scope instead.
export function versionRequestScript(logPath: string, open: boolean): string {
  return (
    `(() => { const ev = new CustomEvent(${JSON.stringify(DESKTOP_VERSION_REQUEST_EVENT)}, ` +
    `{ cancelable: true, detail: ${JSON.stringify({ logPath, open })} }); ` +
    `return !window.dispatchEvent(ev); })();`
  );
}
