// Pure policy: what should happen when a page asks to open a new window or
// navigate the top-level frame away from itself. Electron-free on purpose --
// main.ts wires this into `setWindowOpenHandler` / `will-navigate`, but the
// DECISION belongs here so it is unit-testable and covered by the blocking
// root typecheck (main.ts is excluded from it; see menu-model.ts for the
// same split on the Help menu).
export type WindowOpenDecision = "allow-in-app" | "open-external" | "deny";

// ★★★ ORIGIN COMPARISON, NEVER `startsWith`. `new URL(url).origin` is exact
// (scheme + host + port); `url.startsWith(appOrigin)` is a substring test
// that a crafted URL can satisfy without matching the origin at all --
// `http://127.0.0.1:17300@evil.com/` starts with the app's origin string
// (the origin sits before the `@`, so the "userinfo" is actually a
// throwaway username naming the app's own address) but its real origin is
// `http://evil.com`. A `startsWith` policy would let that page render
// in-app, chromeless, indistinguishable from the real app window.
//
// ★ `about:blank` and the empty string are handled BEFORE parsing, not by
// widening the origin check. `window.open("", "_blank")` (the PDF export
// tab and the document-download PDF tab -- see export.ts `exportPdf` and
// document-download.ts `downloadDocument`) yields a page whose `frame.url`
// is empty and whose `frame.origin` inherits the OPENER's origin (verified
// in desktop/node_modules/electron/electron.d.ts's `WebFrameMain.origin`
// comment: "if the frame is a child window opened to about:blank, then
// frame.origin will return the parent frame's origin, while frame.url will
// return the empty string"). Electron's own `HandlerDetails.url` doc says it
// is "the resolved version of the URL passed to window.open()", which for
// an empty string could plausibly resolve to the opener's own document URL
// rather than the literal string "about:blank" -- either shape is handled
// here without relying on which one Electron actually sends.
export function decideWindowOpen(url: string, appOrigin: string): WindowOpenDecision {
  if (url === "" || url === "about:blank") return "allow-in-app";

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Unparsable is not a URL this app knows how to route anywhere safely.
    return "deny";
  }

  if (parsed.origin === appOrigin) return "allow-in-app";

  // ★ `mailto:` alongside http(s): both are legitimate "leave the app"
  // requests. The bulk-inquiry / chat-inquiry mailto links (use-bulk-
  // operations.ts, use-chat-dispatcher.ts) and every external `target=
  // "_blank"` anchor (Version panel's Releases/License/GitHub/LinkedIn,
  // rich-text links, the Timelog/Jira/M365 settings links) land here.
  const scheme = parsed.protocol; // already lower-cased by the URL parser
  if (scheme === "http:" || scheme === "https:" || scheme === "mailto:") {
    return "open-external";
  }

  // file:, javascript:, custom schemes, and anything else this app has no
  // reason to open at all.
  return "deny";
}

// ★ Returns just the origin for logging, never the full URL. An OAuth
// authorize/redirect URL carries a code/state/token in its query string, and
// `will-navigate`/`will-redirect` fire on every hop of a Microsoft sign-in --
// so `launch.log` must never hold one of those in full. `<unparsable>` is
// deliberately not the raw string either: an unparsable "URL" is exactly the
// case most likely to be attacker-controlled noise, and a denied `data:`
// payload can be megabytes.
export function originOnly(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "<unparsable>";
  }
}

// The three Microsoft identity hosts `src/app/use-ms-auth.ts`'s MSAL
// PublicClientApplication can send a sign-in/token/sign-out popup to first
// (authority `https://login.microsoftonline.com/<tenant>`; `login.microsoft.com`
// and `login.live.com` cover personal-account and legacy-tenant redirects
// Microsoft's own libraries use). EXACT hostname match on the DEFAULT port
// only, never a suffix/prefix test -- `not-login.microsoftonline.com.evil.com`
// (a different TLD entirely), `evil-login.microsoftonline.com` /
// `xlogin.microsoftonline.com` / `sso.login.microsoftonline.com` (each a real
// hostname that genuinely ENDS with an entry in this list, so an
// `endsWith(...)` mutant would wrongly accept them) and
// `login.microsoftonline.com:8443` (an explicit non-default port) are all
// pinned as NOT identity hosts in window-open-policy.test.ts.
export const MS_IDENTITY_HOSTS: readonly string[] = [
  "login.microsoftonline.com",
  "login.microsoft.com",
  "login.live.com",
];

// ★★★ m3/n1 FIX (review-3-fix2-report.md). Round 2 computed
// `initiatorIsAppOpener` by comparing `details.initiator` against a latched
// `WebFrameMain` OBJECT by reference. electron.d.ts documents no object-
// identity guarantee for repeated reads of the same underlying frame --
// only that certain PROPERTIES of a frame stay stable. This replaces the
// object comparison with a structural check on properties electron.d.ts
// DOES document:
//   - `frameToken: string` -- "uniquely identifies the frame within its
//     associated renderer process" (electron.d.ts:19236-19240);
//   - `processId: number` -- "the Chromium internal pid of the process
//     which owns this frame" (electron.d.ts:19302-19308);
//   - `detached: boolean` -- "whether the frame is detached from the frame
//     tree. If a frame is accessed while the corresponding page is running
//     any unload listeners, it may become detached" (electron.d.ts:19216-
//     19223) -- a detached frame is mid-teardown, never a live opener;
//   - `url: string` -- "the current URL of the frame" (electron.d.ts:19322-
//     19326), checked as `new URL(initiator.url).origin === appOrigin`.
//     Deliberately `.url`, NOT `.origin`: `WebFrameMain.origin`'s own doc
//     comment (quoted above `decideWindowOpen`) says an about:blank child
//     INHERITS its opener's origin, so an origin-STRING check cannot tell
//     the popup's own frame apart from its opener's -- but `.url` can,
//     because the popup's own `.url` is the empty string (same doc:
//     "frame.url will return the empty string") while a real app frame's
//     is a genuine `APP_ORIGIN` URL.
// `processId`+`frameToken` are latched ONCE at creation as PLAIN VALUES
// (main.ts's `WindowFacts`), never the `WebFrameMain` object itself -- so
// this is correct even if Electron were to hand out a different wrapper for
// the same underlying frame later, which round 2's object comparison
// silently assumed away.
export interface LatchedOpenerFrame {
  processId: number;
  frameToken: string;
}

// A structural subset of `Electron.WebFrameMain` -- an inline shape rather
// than the real Electron type, so this module (and `isAppOpenerFrame`
// below) stay Electron-free and unit-testable without mocking Electron.
// `Electron.WebFrameMain` satisfies this shape structurally.
export interface FrameIdentity {
  detached: boolean;
  processId: number;
  frameToken: string;
  url: string;
}

// Is `initiator` genuinely the SAME frame as the one latched at window
// creation? `null`/`undefined` (no initiator, or facts never latched --
// e.g. the main window) fails closed.
export function isAppOpenerFrame(
  initiator: FrameIdentity | null | undefined,
  latched: LatchedOpenerFrame | null,
  appOrigin: string,
): boolean {
  if (initiator == null || latched === null) return false;
  if (initiator.detached) return false;
  if (initiator.processId !== latched.processId) return false;
  if (initiator.frameToken !== latched.frameToken) return false;
  try {
    return new URL(initiator.url).origin === appOrigin;
  } catch {
    // Covers the empty string too (`new URL("")` throws) -- the exact
    // shape a click inside an about:blank popup/tab's OWN frame reports.
    return false;
  }
}

// Per-webContents navigation context `main.ts` assembles for each
// will-navigate/will-redirect event. This module stays Electron-free, so all
// three are plain booleans main.ts derives from its own state (never a live
// Electron read passed through unexamined):
//
// - `createdAsBlankPopup`: was this window's FIRST committed/initial URL
//   `about:blank` or empty -- the exact shape `window.open("about:blank",
//   ...)` and MSAL's own popup creation take? Latched ONCE at window
//   creation (`did-create-window` on the OPENER, main.ts's `windowFacts`
//   map), never re-derived from a live property later. A same-origin
//   `?popout=` window's first URL is the app's own path, never blank, so
//   this is `false` for it regardless of what it navigates to afterward.
// - `initiatorIsAppOpener`: was THIS specific navigation attempt initiated
//   by the frame that created this window (script running as the opener,
//   e.g. `popupWindow.location.assign(...)`), rather than by this window's
//   OWN document (a user clicking a rendered link, or that document's own
//   script)? Computed per-event by `isAppOpenerFrame` (above) from the
//   navigation's `details.initiator` against the identity latched at
//   creation -- never from `contents.opener` re-read live (see
//   `createdAsBlankPopup`'s sibling concern: COOP on an identity host's
//   response can sever that live property mid-flow, which would wrongly
//   block a FEDERATED hop if this check were required to continue rather
//   than only to ENTER).
// - `inAuthFlow`: is this webContents currently inside a Microsoft sign-in
//   flow? For `will-navigate`, the COMMITTED state (set by main.ts on
//   `did-navigate`, not optimistically at `will-navigate` time -- a will-*
//   decision can still be reversed by a later redirect denial or a load
//   failure before anything commits). For `will-redirect`, main.ts feeds
//   the STAGED value when one exists (`pendingAuthFlow.get(contents) ??
//   authFlowFor(contents)`) -- see the m1 fix at the `will-redirect` wiring:
//   a server redirect that arrives before the FIRST commit belongs to the
//   navigation that just staged that value, not to whatever committed
//   before it.
export interface NavigationContext {
  createdAsBlankPopup: boolean;
  initiatorIsAppOpener: boolean;
  inAuthFlow: boolean;
}

export interface NavigationDecision {
  decision: WindowOpenDecision;
  // The context's `inAuthFlow` value to carry into the NEXT navigation/
  // redirect on this same webContents.
  authFlow: boolean;
}

// ★★★ THE MSAL FIX. `use-ms-auth.ts`'s PublicClientApplication does not set
// `system.navigatePopups`, so it defaults to `true` (verified:
// node_modules/@azure/msal-browser/dist/config/Configuration.mjs). Under
// that default, `PopupClient.initiateAuthRequest` / `.logout` both
// pre-open a popup to `about:blank` (openSizedPopup, PopupClient.mjs:59/91)
// and THEN call `openPopup(urlNavigate, {..., popup: preOpened})`, which --
// because `popupParams.popup` is already set -- takes the
// `popupWindow.location.assign(urlNavigate)` branch (PopupClient.mjs:347),
// never the `this.openSizedPopup(urlNavigate, ...)` branch at :352 that
// would hit `setWindowOpenHandler` directly with a non-blank URL. MEASURED
// against the installed package, not assumed: the only way MSAL reaches the
// direct-open branch is `navigatePopups: false`, which this app's PCA config
// never sets. So `decideWindowOpen` (the window-OPEN decision) needs no auth
// awareness -- the about:blank open it already allows in-app IS the whole
// popup MSAL ever creates for this app. The fix belongs entirely in
// NAVIGATION: the popup's subsequent `location.assign` to
// `login.microsoftonline.com`, and any server redirect after that to a
// federated IdP, both go through `will-navigate`/`will-redirect`, which is
// what this function decides.
//
// ★★★ N-I1 FIX (review-3-fix1-report.md). Round 1 gated entry on
// `isChildWindow` alone (`opener !== null`), which is true for EVERY window
// this app opens -- including its own `?popout=` windows (`broadcast-
// sync.ts`) and the PDF/export `about:blank` tabs (`export.ts`,
// `document-download.ts`). Rich-text links carry no `target`
// (`sanitize-html.ts` strips it), so a stored `https://login.
// microsoftonline.com/...` link clicked inside a popout is a plain
// navigation with `isChildWindow: true` -- round 1 let it enter the flow and
// then rendered whatever page Azure AD (or an attacker's `redirect_uri`)
// sent back, chromeless. ENTRY now requires BOTH `createdAsBlankPopup` AND
// `initiatorIsAppOpener`: an about:blank popup satisfies the first, but a
// click on a link INSIDE that popup is initiated by the popup's own
// document, not its opener, so `initiatorIsAppOpener` is false and entry is
// refused -- exactly the three cases the fix-2 brief requires:
//   - `?popout=` window + identity-host link click -> open-external (fails
//     `createdAsBlankPopup`: its first URL was the app's own path).
//   - PDF/export tab (about:blank) + identity-host link click ->
//     open-external (passes `createdAsBlankPopup`, fails
//     `initiatorIsAppOpener`: the click's initiator is the tab's own frame).
//   - MSAL's own popup (about:blank) + its opener's `location.assign(...)`
//     -> flow (passes both).
// ★ ONCE IN FLOW, NEITHER of the two entry booleans is re-checked --
// `ctx.inAuthFlow` alone continues it. That is deliberate: a federated IdP
// hop is a SERVER redirect with no script initiator of its own to check
// (`will-redirect`'s `details.initiator` describes who started the
// overall navigation, not "who sent the 302"), and requiring the entry
// booleans again on every hop would break exactly the federated/personal-
// account tenants this whole feature exists for.
// ★ THE MAIN WINDOW CAN NEVER ENTER: `main.ts` never records `windowFacts`
// for it (it is built via `new BrowserWindow` + `loadFile`/`loadURL`, never
// `window.open`), so `createdAsBlankPopup` reads `false` by construction --
// no separate "is this the main window" check is needed.
export function decideNavigation(
  url: string,
  appOrigin: string,
  ctx: NavigationContext,
): NavigationDecision {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Nothing navigated; the flow (if any) is exactly as it was.
    return { decision: "deny", authFlow: ctx.inAuthFlow };
  }

  // Returning to the app's own origin is the auth flow's ONE designated
  // exit, regardless of how deep into a federated hop it was.
  if (parsed.origin === appOrigin) return { decision: "allow-in-app", authFlow: false };

  const isHttps = parsed.protocol === "https:";
  // ★ `parsed.port === ""` requires the DEFAULT port for the scheme (443 for
  // https, which the URL parser omits from `.port` when explicit) --
  // `https://login.microsoftonline.com:8443` is not Microsoft's real
  // service on any port other than the default one, so it is never treated
  // as an identity host, entry or continuation alike is unaffected since
  // this term only gates the exact-host ENTRY check below.
  const isIdentityHost =
    isHttps && parsed.port === "" && MS_IDENTITY_HOSTS.includes(parsed.hostname.toLowerCase());
  const canEnterFlow = ctx.createdAsBlankPopup && ctx.initiatorIsAppOpener;

  if ((canEnterFlow && isIdentityHost) || ctx.inAuthFlow) {
    // Entering the flow (a fresh, opener-initiated identity-host hop from a
    // blank popup) or already in it (a federated IdP redirect, which can be
    // ANY https host -- that is the whole reason a company's own ADFS/
    // PingFederate/Okta host has to be allowed sight-unseen once the flow
    // starts). A non-https hop here has no legitimate reason and is refused
    // WITHOUT ending the flow: nothing actually navigated, so the popup is
    // still wherever it was.
    if (isHttps) return { decision: "allow-in-app", authFlow: true };
    return { decision: "deny", authFlow: ctx.inAuthFlow };
  }

  // Outside auth flow (including the main window, which can never enter
  // it): the ordinary leave-the-app policy.
  if (parsed.protocol === "http:" || isHttps || parsed.protocol === "mailto:") {
    return { decision: "open-external", authFlow: false };
  }

  return { decision: "deny", authFlow: false };
}
