// Who holds the pinned port?
//
// ★★★ The answer must never be "someone else, so I'll use a different port".
// The port is half the origin; rebinding silently swaps the user's IndexedDB
// store. A foreign holder is a LOUD failure, not a fallback.
export type PortProbe =
  | { reachable: false }
  | { reachable: true; status: number; body: string };

export type PortOwner = "free" | "ours" | "foreign";

// Our server is Next serving src/app/layout.tsx, whose root element carries
// data-app-version. Matched as a real ATTRIBUTE (name, `=`, quote) so a page
// that merely mentions the string in prose is not mistaken for our app.
const OURS_MARKER = /data-app-version\s*=\s*["']/;

export function classifyPortOwner(probe: PortProbe): PortOwner {
  if (!probe.reachable) return "free";
  return OURS_MARKER.test(probe.body) ? "ours" : "foreign";
}
