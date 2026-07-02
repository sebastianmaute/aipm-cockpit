// src/app/outlook-graph.ts — Shared low-level Microsoft Graph plumbing used by
// the calendar write + read paths. Kept dependency-light so both sides import it
// without a cycle. graph.microsoft.com is already CSP-allowlisted.
export const GRAPH = "https://graph.microsoft.com/v1.0";
export const MAX_PAGES = 100;

export class GraphCalendarError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "GraphCalendarError";
  }
}

/** GET an absolute Graph URL, returning the parsed JSON or throwing on non-ok.
 *  Mirrors graph() but for GET (no body), against a full URL (for pagination). */
export async function graphGet<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new GraphCalendarError(res.status, `Graph GET failed (${res.status})`);
  return (await res.json()) as T;
}
