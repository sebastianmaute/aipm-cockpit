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
