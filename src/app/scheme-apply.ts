// Runtime application of a custom color scheme's CSS-variable overrides.
// Overrides are set as INLINE styles on <html> — the only palette-guard-safe
// runtime mechanism (it changes token VALUES, never adds Tailwind classes).
// The active map is mirrored to a localStorage boot key so the pre-paint script
// in layout.tsx can apply it before first paint (no flash).

export type SchemeColorMap = Record<string, string>;

export const ACTIVE_SCHEME_COLORS_KEY = "lop-active-scheme-colors";
// Boot-readable flag: does the active custom scheme support a dark map? The
// pre-paint boot script reads this to decide whether `custom` may go dark
// (data-scheme-dark is a runtime attr, not persisted). Written on every apply.
export const SCHEME_SUPPORTS_DARK_KEY = "lop-scheme-supports-dark";

// Tracks which tokens we set last time so a re-apply can clear stale ones.
let lastApplied: string[] = [];

/** Apply (or, with null, remove) the inline token overrides on <html>. */
export function applySchemeColors(colors: SchemeColorMap | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const token of lastApplied) root.style.removeProperty(token);
  lastApplied = [];
  if (!colors) return;
  for (const [token, value] of Object.entries(colors)) {
    root.style.setProperty(token, value);
    lastApplied.push(token);
  }
}

/** Persist the active scheme's resolved color map for the pre-paint boot script. */
export function writeActiveSchemeColors(colors: SchemeColorMap | null): void {
  try {
    if (colors) localStorage.setItem(ACTIVE_SCHEME_COLORS_KEY, JSON.stringify(colors));
    else localStorage.removeItem(ACTIVE_SCHEME_COLORS_KEY);
  } catch {
    /* private mode / quota — runtime apply still works in-memory */
  }
}

/** Persist whether the active custom scheme is dark-capable (boot-readable). */
export function writeSchemeSupportsDark(supports: boolean): void {
  try {
    if (supports) localStorage.setItem(SCHEME_SUPPORTS_DARK_KEY, "1");
    else localStorage.removeItem(SCHEME_SUPPORTS_DARK_KEY);
  } catch {
    /* private mode / quota */
  }
}

/** Read the dark-capable flag for the active custom scheme. */
export function readSchemeSupportsDark(): boolean {
  try {
    return localStorage.getItem(SCHEME_SUPPORTS_DARK_KEY) === "1";
  } catch {
    return false;
  }
}

/** Read the active color map (boot key). Returns null when missing/garbage. */
export function readActiveSchemeColors(): SchemeColorMap | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SCHEME_COLORS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: SchemeColorMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}
