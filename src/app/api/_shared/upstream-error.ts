// Shared server-side helper for logging an upstream fetch failure across the
// outbound API proxies (/api/jira, /api/timelog, /api/ecb). §566 introduced it
// inside jira/_helpers.ts for the Jira proxy alone; §607 moved it here once the
// Timelog and ECB proxies needed the same fix — only this logging helper moved,
// never the provider-specific SSRF/auth logic each route keeps to itself.

/** §566/§607: what a proxy logs for an upstream failure — a plain object, never the raw error.
 *  ★★ NOT `err.message` alone: Node's `fetch` ALWAYS rejects with `TypeError("fetch failed",
 *  { cause })`, so the message is the same literal for DNS, refused, TLS and timeout alike, and
 *  the reason lives in `cause`. Never the object itself: nothing in it is a credential today,
 *  but its shape is undici's to change. */
export function describeUpstreamError(err: unknown): { message: string; cause?: string; code?: string } {
  const message = err instanceof Error ? err.message : String(err);
  const c = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
  if (c === undefined) return { message };
  const code = typeof (c as { code?: unknown })?.code === "string" ? (c as { code: string }).code : undefined;
  return { message, cause: c instanceof Error ? c.message : String(c), ...(code ? { code } : {}) };
}
