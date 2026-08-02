// Single predicate for "this thrown value is a user/controller cancellation".
// Pure — no React, no i18n, no DOM requirement.
//
// ★★ Reads `.name` DIRECTLY and never `instanceof DOMException`: a
// DOMException is not reliably `instanceof Error`/`instanceof DOMException`
// across the jsdom/Node boundary, so an `instanceof`-gated check can fall
// through to the caller's generic error arm and report a deliberate cancel
// as a failure.
//
// ★★ HONEST SCOPE (corrected in review — the first draft of this comment,
// and open-followups §11 itself, claimed more): in a BROWSER an aborted
// `fetch` rejects with a same-realm DOMException, so the `instanceof
// DOMException` gate this replaced did match, at all four call sites. No
// reachable user-facing failure was demonstrated. This is hardening plus one
// shape for five call sites — do not describe it as a shipped bug fix.
//
// ★ No `instanceof Error` branch: `name` is an ordinary property on
// `Error.prototype`, so the optional read below covers an Error identically
// and no input can tell the two apart. A surviving `instanceof` would also
// read as load-bearing in the one module whose whole point is not to use one.
export function isAbortError(e: unknown): boolean {
  return (e as { name?: unknown } | null | undefined)?.name === "AbortError";
}
