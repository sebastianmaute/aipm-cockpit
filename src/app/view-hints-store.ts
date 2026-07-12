// Per-device dismiss state for the contextual per-view callouts (Help SP2).
// NOT workspace data: a single localStorage key, out of exports/Turso, cleared
// by clearAppConfig's `aipm-cockpit:*` sweep. Popout windows are read-only and never
// persist. Pure + defensive: a malformed/absent store yields no dismissals.

const KEY = "aipm-cockpit:view-hints";

type ViewHintsState = { dismissed: Record<string, true> };

export function loadDismissed(): Record<string, true> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && "dismissed" in v) {
      const d = (v as ViewHintsState).dismissed;
      if (d && typeof d === "object") return d;
    }
  } catch {
    // ignore malformed/unavailable storage
  }
  return {};
}

/** Mark a view's callout dismissed and persist (no-op in popouts). Returns the
 *  new dismissed map so callers can update state without a re-read. */
export function dismissView(view: string, isPopout: boolean): Record<string, true> {
  const next = { ...loadDismissed(), [view]: true as const };
  if (isPopout) return next; // popouts are read-only — never persist
  try {
    localStorage.setItem(KEY, JSON.stringify({ dismissed: next } satisfies ViewHintsState));
  } catch {
    // ignore
  }
  return next;
}
