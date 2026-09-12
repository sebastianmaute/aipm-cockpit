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
// leaves the app for an external browser, and appending it leaves the two
// entries that already shipped exactly where anyone who has used the app
// found them. The trailing "…" (U+2026, not three periods) is the Windows
// convention for "this opens something" rather than acting immediately.
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
export type HelpMenuAction = "open-help" | "show-version" | "open-releases";

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
  updates: "open-releases",
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
// ★★ IT IS NOT THE WHOLE FIX -- two renderer print paths remain inert in the
// packaged app, unfixed and out of scope here (they need a main-process route
// such as webContents.printToPDF). **docs/open-followups.md §468** owns that
// story and the command that enumerates the survivors; an earlier version of
// this comment restated all of it, which made a third full copy.
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

// What the Version dialog says. The version is the packaged app's own
// (app.getVersion(), which reads desktop/package.json -- a version:sync
// satellite, so it cannot drift from src/app/version.ts without failing CI).
//
// ★ The log path is included on purpose: the rollout note tells a user to send
// that file when reporting a problem, and this is the one place in the app
// that can tell them where it is without them knowing what %LOCALAPPDATA% means.
//
// ★★ The updates line exists because there is NO auto-updater. Left unsaid, a
// user reasonably assumes the app keeps itself current and runs a stale build
// indefinitely -- silence reads as "nothing to do here". Saying it once, in
// the dialog they already open to answer "what version am I on", costs
// nothing and is the only place the app can say it.
//
// ★ `releasesUrl` is a PARAMETER so a TEST can pass a sentinel and prove no
// hardcoded copy of the real URL is baked in here -- a copy would satisfy
// every "the dialog names the Releases page" assertion while silently
// drifting from constants.ts the moment the project moves.
//
// ★★ NOT for import hygiene, which is what this comment used to claim and
// which is false: constants.ts has no imports of its own and touches no
// Electron API, so importing it would leave this module exactly as
// Electron-free and exactly as testable. The caller (main.ts) already imports
// constants.ts and passes RELEASES_URL.
export function formatVersionDetail(
  version: string,
  logPath: string,
  releasesUrl: string,
): string {
  return (
    `AI PM Cockpit ${version}\n\n` +
    `Log file:\n${logPath}\n\n` +
    `Updates are manual: this app does not check for new versions on its own.\n` +
    `Download the newest version from:\n${releasesUrl}`
  );
}

// What the Version dialog's buttons say and MEAN.
//
// ★ "open-releases" is the SAME string HelpMenuAction uses, so the dialog
// button and the Help menu item land on main.ts's one openReleasesPage()
// helper rather than two copies of the same shell.openExternal call. The
// `Extract` makes that sharing structural instead of coincidental: rename the
// member in HelpMenuAction and this collapses to "dismiss" alone.
//
// ★★ WHERE YOU WILL MEET THAT ERROR: on a BUTTON ROW below, in THIS file --
// `Type '"open-releases"' is not assignable to type '"dismiss"'` -- so it
// fails the BLOCKING root typecheck, not merely main.ts's case (which the
// blocking job never reads). An earlier version of this comment credited the
// weaker of the two.
//
// ★★ WHAT IT DOES NOT BUY: nothing behavioural. The two strings never pass
// between the two types, so no amount of typing stops one being edited and
// the other left alone -- the runtime assertion
// `versionDialogAction(1) === helpAction("updates")` is what pins the
// sharing. This only stops a RENAME from going quietly half-done.
export type VersionDialogAction = "dismiss" | Extract<HelpMenuAction, "open-releases">;

export interface VersionDialogButton {
  label: string;
  action: VersionDialogAction;
}

// ★★★ THE ARRAY INDEX IS THE PROTOCOL. dialog.showMessageBox resolves with a
// NUMBER into this list, so reordering these rows changes what every response
// means. Label and action are one row precisely so a button cannot be added
// with a label and no decision about what it does -- the interface requires
// both, and versionDialogAction reads the action positionally, so the two can
// never disagree about which index is which.
//
// ★ OK stays FIRST: it is the harmless choice and it is where the index of
// the dialog's only button was before this second one existed, so no meaning
// was reassigned.
export const VERSION_DIALOG_BUTTONS: readonly VersionDialogButton[] = [
  { label: "OK", action: "dismiss" },
  { label: "Open releases page", action: "open-releases" },
];

// ★★★ Enter fires `defaultId` and Escape fires `cancelId`. Both point at OK,
// so dismissing this dialog the way a person dismisses any dialog CANNOT
// launch a browser -- an unasked-for window opening because someone tapped
// Enter is exactly the kind of surprise a Version dialog must not produce.
// `cancelId: 0` is also Electron's own default, but stating it keeps the
// guarantee true if the rows are ever reordered.
export const VERSION_DIALOG_DEFAULT_ID = 0;
export const VERSION_DIALOG_CANCEL_ID = 0;

// ★★ An index with no row is a DISMISSAL, never an action.
//
// ★★ The `?.`/`??` look dead against the declared types, and they are not.
// NEITHER tsconfig sets `noUncheckedIndexedAccess`, so `BUTTONS[response]` is
// TYPED as a present row while the number itself arrives from another
// process -- the type is unsound here by configuration, not by accident. The
// second case is a row appended through a cast, widening the array without
// widening the union.
//
// ★★ Do NOT justify this with "the window could close out from under the
// dialog": that was a false reason, and this dialog is parentless anyway (the
// call passes no BrowserWindow). Doing nothing is recoverable -- the user
// clicks again; opening a browser they did not ask for is not.
export function versionDialogAction(response: number): VersionDialogAction {
  return VERSION_DIALOG_BUTTONS[response]?.action ?? "dismiss";
}

// The Version dialog's COMPLETE options object, built here rather than in
// main.ts.
//
// ★★★ THAT IS THE WHOLE POINT, and it closes a half-open guarantee. While
// main.ts assembled this object, the tests could only assert things about
// VERSION_DIALOG_DEFAULT_ID -- main.ts remained free to pass `defaultId: 1`,
// or to omit both keys (on Windows that leaves Escape on index 0 but hands
// Enter to Electron's own default), with every test, lint and the blocking
// typecheck green and Enter opening a browser. main.ts is the ONE desktop
// file the blocking typecheck skips and the one no unit test can import, so
// anything load-bearing has to live on this side of the line.
//
// ★ Deliberately an OPTIONS-OBJECT parameter, not four positional strings: a
// transposition of same-typed arguments is invisible to tsc, and this is the
// repo's own deps-object convention.
//
// ★ Structurally compatible with Electron's MessageBoxOptions without
// importing it -- this module stays Electron-free. `type` is the LITERAL
// "info" because the installed typings declare a union
// ('none'|'info'|'error'|'question'|'warning'), which a plain `string` would
// not satisfy.
export interface VersionDialogOptions {
  type: "info";
  title: string;
  message: string;
  // ★★★ MUTABLE ON PURPOSE, mirroring electron 33.4.11's own
  // `buttons?: string[]` (verified in
  // desktop/node_modules/electron/electron.d.ts). A `readonly string[]`
  // would not assign to that, so it cannot be one here either -- do not
  // hoist the labels to a `readonly` constant and do not add `as const`.
  //
  // ★★ Declaring it HERE is what makes that safe: an attempt to narrow it to
  // readonly now fails in THIS file, inside the blocking root typecheck.
  // While main.ts built the object, the same mistake failed only in the
  // desktop build -- `allow_failure: true` on a merge request.
  buttons: string[];
  defaultId: number;
  cancelId: number;
  noLink: boolean;
}

export function versionDialogOptions(args: {
  title: string;
  version: string;
  logPath: string;
  releasesUrl: string;
}): VersionDialogOptions {
  return {
    type: "info",
    title: args.title,
    message: formatVersionDetail(args.version, args.logPath, args.releasesUrl),
    // A fresh array per call, both to satisfy the mutable declaration above
    // and so a caller that mutates what it was handed cannot affect the next
    // dialog.
    buttons: VERSION_DIALOG_BUTTONS.map((b) => b.label),
    defaultId: VERSION_DIALOG_DEFAULT_ID,
    cancelId: VERSION_DIALOG_CANCEL_ID,
    // Without this, Windows renders any button it does not recognise as a
    // stock one as a large command LINK -- "Open releases page" would read
    // as the primary action instead of OK's peer.
    noLink: true,
  };
}
