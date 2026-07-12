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

// Shape guard for boot keys: keys must be CSS custom-property names. Declared
// here (above all consumers) so both the color and structural helpers share it.
const BOOT_TOKEN_RE = /^--[\w-]+$/;
const BOOT_HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

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

export type SchemeStructuralMap = Record<string, string>;
export const ACTIVE_SCHEME_STRUCTURAL_KEY = "lop-active-scheme-structural";

// Raw (non-hex) CSS VALUE guard for structural tokens (shadows/gradient/length/
// keyword). setProperty applies a property VALUE only — it cannot inject a rule/
// selector — so this is defense-in-depth + boot-key tamper hygiene. Allowlist
// charset then denylist dangerous substrings.
const RAW_VALUE_RE = /^[\w\s#.,%()/-]+$/;
// Denylist dangerous substrings. `url` may be followed by whitespace before the
// paren (`url (…)`) — match that too, not just the contiguous `url(`.
const RAW_DENY_RE = /url\s*\(|expression|image-set|[;{}@<>\\]/i;
export function isSafeRawCssValue(v: string): boolean {
  if (typeof v !== "string" || v.length === 0 || v.length > 256) return false;
  if (!RAW_VALUE_RE.test(v)) return false;
  return !RAW_DENY_RE.test(v);
}

let lastStructural: string[] = [];
/** Apply (or, with null, clear) the structural token overrides on <html>. */
export function applySchemeStructural(map: SchemeStructuralMap | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const token of lastStructural) root.style.removeProperty(token);
  lastStructural = [];
  if (!map) return;
  for (const [token, value] of Object.entries(map)) {
    if (BOOT_TOKEN_RE.test(token) && isSafeRawCssValue(value)) {
      root.style.setProperty(token, value);
      lastStructural.push(token);
    }
  }
}

/** Persist the active scheme's structural token map for the pre-paint boot script. */
export function writeActiveSchemeStructural(map: SchemeStructuralMap | null): void {
  try {
    if (map) localStorage.setItem(ACTIVE_SCHEME_STRUCTURAL_KEY, JSON.stringify(map));
    else localStorage.removeItem(ACTIVE_SCHEME_STRUCTURAL_KEY);
  } catch {
    /* private mode / quota */
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

// The boot-key shape guards (BOOT_TOKEN_RE / BOOT_HEX_RE) are declared above so
// this sink can't apply a non-hex (CSS-injection) value even if the localStorage
// entry is tampered with. This is a SHAPE check, not the exact VALID_TOKENS
// allowlist cleanColors uses (which lives in color-schemes.ts) — scheme-apply is
// a lower-level leaf and stays dependency-light on purpose.

/** Read the active color map (boot key). Returns null when missing/garbage.
 *  Values are hex-validated + keys must be CSS custom-property names. */
export function readActiveSchemeColors(): SchemeColorMap | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SCHEME_COLORS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: SchemeColorMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && BOOT_TOKEN_RE.test(k) && BOOT_HEX_RE.test(v)) out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}
