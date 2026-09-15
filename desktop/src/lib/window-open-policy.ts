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
// Microsoft's own libraries use). EXACT hostname match, never a suffix/prefix
// test -- `login.microsoftonline.com.evil.com` and
// `not-login.microsoftonline.com` are both real hostnames a hostile page
// could present and neither is in this list.
export const MS_IDENTITY_HOSTS: readonly string[] = [
  "login.microsoftonline.com",
  "login.microsoft.com",
  "login.live.com",
];

// Per-webContents navigation context `main.ts` tracks across the lifetime of
// one window (a `WeakMap<WebContents, boolean>`, since this module stays
// Electron-free): whether the webContents is a CHILD (has an `opener`,
// i.e. was created via `window.open()` or a `target=` link -- verified in
// electron.d.ts's `WebContents.opener` doc: "represents the frame that
// opened this WebContents, either with open(), or by navigating a link with
// a target attribute"), and whether it is currently inside a Microsoft
// sign-in flow.
export interface NavigationContext {
  isChildWindow: boolean;
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
// ★ THE MAIN WINDOW NEVER ENTERS AUTH FLOW. `ctx.isChildWindow` gates entry:
// the main window's webContents has no opener, so an identity host reached
// by the main window's OWN top-level frame (which nothing in this app does
// today, but a compromised renderer might try) is just another external
// site -- no special latitude for the app's single trusted window.
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
  const isIdentityHost = isHttps && MS_IDENTITY_HOSTS.includes(parsed.hostname.toLowerCase());

  if (ctx.isChildWindow && (isIdentityHost || ctx.inAuthFlow)) {
    // Entering the flow (a fresh identity-host hop) or already in it (a
    // federated IdP redirect, which can be ANY https host -- that is the
    // whole reason a company's own ADFS/PingFederate/Okta host has to be
    // allowed sight-unseen once the flow starts). A non-https hop here has
    // no legitimate reason and is refused WITHOUT ending the flow: nothing
    // actually navigated, so the popup is still wherever it was.
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
