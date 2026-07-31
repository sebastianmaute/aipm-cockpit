// Single predicate for "this thrown value is a user/controller cancellation".
// Pure — no React, no i18n, no DOM requirement.
//
// ★★ Reads `.name` DIRECTLY and never `instanceof DOMException`: a
// DOMException is not reliably `instanceof Error`/`instanceof DOMException`
// across the jsdom/Node boundary, so an `instanceof`-gated check silently
// falls through to the caller's generic error arm and reports a deliberate
// cancel as a failure. That was the defect in `use-tasks-dedup` and
// `use-action-analysis` (open-followups §11); this helper exists so a
// future caller cannot reinvent it.
export function isAbortError(e: unknown): boolean {
  const name = e instanceof Error ? e.name : (e as { name?: unknown } | null | undefined)?.name;
  return name === "AbortError";
}
