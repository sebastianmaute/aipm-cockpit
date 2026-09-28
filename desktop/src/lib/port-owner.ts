// Who holds the pinned port?
//
// ★★★ The answer must never be "someone else, so I'll use a different port".
// The port is half the origin; rebinding silently swaps the user's IndexedDB
// store. A foreign holder is a LOUD failure, not a fallback.
export type PortProbe =
  | { reachable: false }
  | { reachable: true; status: number; body: string };

// `stale` (§631): our app answers, but a different build of it. A server left
// behind by a crash can outlive an update, and this launch did not spawn it, so
// it could neither show the build the user installed nor stop that server on
// quit. It is a LOUD failure too, never reused.
export type PortOwner = "free" | "ours" | "stale" | "foreign";

// Our server is Next serving src/app/layout.tsx, whose root element carries
// data-app-version. Matched as a real ATTRIBUTE (name, `=`, quote) so a page
// that merely mentions the string in prose is not mistaken for our app. The
// value is captured up to the SAME quote that opened it.
const OURS_MARKER = /data-app-version\s*=\s*(["'])(.*?)\1/;

/** The `data-app-version` value in a probed page, or null when there is none. */
export function probedAppVersion(body: string): string | null {
  const m = OURS_MARKER.exec(body);
  return m ? m[2] : null;
}

export function classifyPortOwner(probe: PortProbe, expectedVersion: string): PortOwner {
  if (!probe.reachable) return "free";
  const found = probedAppVersion(probe.body);
  if (found === null) return "foreign";
  return found === expectedVersion ? "ours" : "stale";
}
