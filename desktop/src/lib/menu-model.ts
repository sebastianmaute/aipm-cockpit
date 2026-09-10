// The Help menu's contents, as data.
//
// Kept Electron-free so it can be unit-tested: the wiring in main.ts turns
// each id into a click handler, but WHAT the menu offers is decided here.
export type HelpMenuItemId = "help" | "version";

export interface HelpMenuItem {
  id: HelpMenuItemId;
  label: string;
}

export const HELP_MENU_ITEMS: readonly HelpMenuItem[] = [
  { id: "help", label: "Help" },
  { id: "version", label: "Version" },
];

// The app's own help lives at a hash-addressable view, so the menu can open it
// by setting the fragment on the page that is ALREADY loaded.
//
// ★★ Deliberately NOT a full navigation. Reloading the origin would discard
// whatever the user has open and unsaved; assigning the hash fires the
// hashchange the app's own router already listens for. It is also why this
// needs no IPC and no preload: the renderer stays remote content with no Node
// surface, which is the security posture the desktop shell is built around.
export const HELP_VIEW_HASH = "#help";

export function helpHashScript(hash: string = HELP_VIEW_HASH): string {
  // Assigning an IDENTICAL hash fires no hashchange, so a second click while
  // already on Help would do nothing at all. Clearing first guarantees the
  // event, and the app routes an empty fragment back to its default view only
  // on load, not mid-session.
  return `window.location.hash = ""; window.location.hash = ${JSON.stringify(hash)};`;
}

// What the Version dialog says. The version is the packaged app's own
// (app.getVersion(), which reads desktop/package.json -- a version:sync
// satellite, so it cannot drift from src/app/version.ts without failing CI).
//
// ★ The log path is included on purpose: the rollout note tells a user to send
// that file when reporting a problem, and this is the one place in the app
// that can tell them where it is without them knowing what %LOCALAPPDATA% means.
export function formatVersionDetail(version: string, logPath: string): string {
  return `aipm-cockpit ${version}\n\nLog file:\n${logPath}`;
}
