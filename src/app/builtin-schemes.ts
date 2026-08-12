// Code-owned built-in color schemes (Harbor / Meridian / Umber / Beacon).
// Harbor/Meridian/Umber each ship a light+dark pair over the 21 editable
// tokens; Beacon is LIGHT-ONLY (no dark map) — the app's generic
// supportsDark-driven mechanism (style-ci.effectiveDark + use-theme's
// apply()) pins light mode whenever it's active. Beacon is the fresh-install
// default. Pure (no DOM). Built-ins are undeletable + refreshed from code on
// every load (reconcile). AIPM and Mockup are no longer code built-ins — they
// ship as importable theme files the user supplies (Settings → Appearance →
// Theme gallery).
import type { ColorScheme, SchemeStore } from "./color-schemes";
import type { SchemeColorMap, SchemeStructuralMap } from "./scheme-apply";

// ── Harbor ───────────────────────────────────────────────────────────────
export const HARBOR_LIGHT: SchemeColorMap = {
  "--ui-dark-blue": "#153a5c", "--ui-green": "#2bc4b6", "--background": "#f6f8fa", "--surface": "#ffffff",
  "--foreground": "#15212e", "--rag-red": "#d24a4a", "--rag-amber": "#cf8a1c", "--rag-green": "#2f9d70",
  "--ui-pink": "#c24a76", "--ui-purple": "#5f57a8", "--ui-blue": "#2f6f9e", "--ui-medium-grey": "#7d8a97",
  "--ui-light-grey": "#c9d3dc", "--surface-muted": "#eef2f6", "--line": "#dbe2ea", "--table-head-bg": "#153a5c",
  "--table-head-fg": "#ffffff", "--table-head-accent": "#2bc4b6", "--segment-track-bg": "#eef2f6",
  "--segment-active-bg": "#153a5c", "--segment-active-fg": "#ffffff",
};
export const HARBOR_DARK: SchemeColorMap = {
  "--ui-dark-blue": "#14293d", "--ui-green": "#2bc4b6", "--background": "#0e1620", "--surface": "#16212e",
  "--foreground": "#e4edf4", "--rag-red": "#ef7676", "--rag-amber": "#e8b25a", "--rag-green": "#4bc394",
  "--ui-pink": "#e88bb0", "--ui-purple": "#7a68bd", "--ui-blue": "#5aa6d8", "--ui-medium-grey": "#8493a1",
  "--ui-light-grey": "#aebccb", "--surface-muted": "#1b2836", "--line": "#273746", "--table-head-bg": "#1c3550",
  "--table-head-fg": "#dce8f2", "--table-head-accent": "#5fd0c6", "--segment-track-bg": "#1b2836",
  "--segment-active-bg": "#2b6493", "--segment-active-fg": "#f2f8fc",
};

// ── Meridian ─────────────────────────────────────────────────────────────
export const MERIDIAN_LIGHT: SchemeColorMap = {
  "--ui-dark-blue": "#3730a3", "--ui-green": "#26d197", "--background": "#f7f8fc", "--surface": "#ffffff",
  "--foreground": "#191a2b", "--rag-red": "#d83a3a", "--rag-amber": "#d18309", "--rag-green": "#16a34a",
  "--ui-pink": "#c93a86", "--ui-purple": "#7c3aed", "--ui-blue": "#4f6bd8", "--ui-medium-grey": "#7d8098",
  "--ui-light-grey": "#cbcede", "--surface-muted": "#eef0f8", "--line": "#e0e2f0", "--table-head-bg": "#3730a3",
  "--table-head-fg": "#ffffff", "--table-head-accent": "#26d197", "--segment-track-bg": "#eef0f8",
  "--segment-active-bg": "#3730a3", "--segment-active-fg": "#ffffff",
};
export const MERIDIAN_DARK: SchemeColorMap = {
  "--ui-dark-blue": "#241f5e", "--ui-green": "#10b981", "--background": "#111120", "--surface": "#1a1a2c",
  "--foreground": "#e8e8f5", "--rag-red": "#f27171", "--rag-amber": "#f0b64f", "--rag-green": "#37c46f",
  "--ui-pink": "#e87ab8", "--ui-purple": "#7d5fd6", "--ui-blue": "#818cf8", "--ui-medium-grey": "#82849e",
  "--ui-light-grey": "#b4b8da", "--surface-muted": "#23233a", "--line": "#31314a", "--table-head-bg": "#2c2b6e",
  "--table-head-fg": "#e2e2f5", "--table-head-accent": "#a5b4fc", "--segment-track-bg": "#23233a",
  // #6366f1 measured 4.12:1 against the #f5f5ff label — under AA for 14px text.
  // Darkened to indigo-600, which lands at 5.80:1, in line with the other dark
  // built-ins (harbor 5.86, umber 5.82).
  "--segment-active-bg": "#4f46e5", "--segment-active-fg": "#f5f5ff",
};

// ── Umber ────────────────────────────────────────────────────────────────
export const UMBER_LIGHT: SchemeColorMap = {
  "--ui-dark-blue": "#3b332a", "--ui-green": "#d19b3c", "--background": "#faf8f4", "--surface": "#ffffff",
  "--foreground": "#2a241d", "--rag-red": "#bd4a30", "--rag-amber": "#c88f17", "--rag-green": "#6c8a35",
  "--ui-pink": "#b34a5a", "--ui-purple": "#7a5a8a", "--ui-blue": "#4a6a8a", "--ui-medium-grey": "#9a8f7e",
  "--ui-light-grey": "#d8cfc0", "--surface-muted": "#f1ece3", "--line": "#e6ded2", "--table-head-bg": "#3b332a",
  "--table-head-fg": "#f2ebe0", "--table-head-accent": "#d19b3c", "--segment-track-bg": "#f1ece3",
  "--segment-active-bg": "#3b332a", "--segment-active-fg": "#f2ebe0",
};
export const UMBER_DARK: SchemeColorMap = {
  "--ui-dark-blue": "#3a3122", "--ui-green": "#e6b45c", "--background": "#181410", "--surface": "#221d16",
  "--foreground": "#efe7db", "--rag-red": "#e07a5f", "--rag-amber": "#e0b34a", "--rag-green": "#9cb85e",
  "--ui-pink": "#d98a9a", "--ui-purple": "#84619e", "--ui-blue": "#7a9ab8", "--ui-medium-grey": "#8a7f6e",
  "--ui-light-grey": "#d5cab6", "--surface-muted": "#2c261e", "--line": "#382f25", "--table-head-bg": "#33291e",
  "--table-head-fg": "#efe4d3", "--table-head-accent": "#e0a94a", "--segment-track-bg": "#2c261e",
  "--segment-active-bg": "#6a5a45", "--segment-active-fg": "#f6efe4",
};

// ── Beacon ───────────────────────────────────────────────────────────────
// Light-only — ported from public/themes/beacon.json's 21 base tokens (the
// file's own 6 additional pinned "-strong"/"-text" tokens are intentionally
// dropped: every other built-in relies on runtime AA derivation
// (deriveAaVariants in scheme-tokens.ts) rather than pinning those, and
// builtin-schemes.test.ts enforces "exactly 21 tokens, no extras" for every
// built-in map).
export const BEACON_LIGHT: SchemeColorMap = {
  "--ui-dark-blue": "#003459", "--ui-green": "#68bd00", "--background": "#ffffff", "--surface": "#ffffff",
  "--foreground": "#646461", "--rag-red": "#d95842", "--rag-amber": "#f4c11c", "--rag-green": "#41a700",
  "--ui-pink": "#e84663", "--ui-purple": "#ae448c", "--ui-blue": "#5daee0", "--ui-medium-grey": "#929499",
  "--ui-light-grey": "#e2e6e7", "--surface-muted": "#e2e6e7", "--line": "#e2e6e7", "--table-head-bg": "#f1f3f4",
  "--table-head-fg": "#3e4349", "--table-head-accent": "#2b7a00", "--segment-track-bg": "#eef1f3",
  "--segment-active-bg": "#ffffff", "--segment-active-fg": "#2b7a00",
};

export const BUILTIN_SCHEMES: readonly ColorScheme[] = [
  { id: "harbor", name: "Harbor", builtIn: true, supportsDark: true, light: HARBOR_LIGHT, dark: HARBOR_DARK, branding: {} },
  { id: "meridian", name: "Meridian", builtIn: true, supportsDark: true, light: MERIDIAN_LIGHT, dark: MERIDIAN_DARK, branding: {} },
  { id: "umber", name: "Umber", builtIn: true, supportsDark: true, light: UMBER_LIGHT, dark: UMBER_DARK, branding: {} },
  { id: "beacon", name: "Beacon", builtIn: true, supportsDark: false, light: BEACON_LIGHT, branding: {} },
] as const;

export const DEFAULT_SCHEME_ID = "beacon";
export const BUILTIN_SCHEME_IDS: ReadonlySet<string> = new Set(BUILTIN_SCHEMES.map((s) => s.id));

/** A fresh copy of a built-in scheme (defensive — callers must not mutate the
 *  shared literal maps). */
function cloneBuiltin(s: ColorScheme): ColorScheme {
  return {
    ...s,
    light: { ...s.light },
    ...(s.dark ? { dark: { ...s.dark } } : {}),
    ...(s.structural ? { structural: { ...s.structural } } : {}),
    branding: { ...s.branding },
  };
}

/** Merge the code-owned built-ins into a loaded store: built-ins are always
 *  re-seeded from code (name/maps/supportsDark refreshed on upgrade, never
 *  persisted-stale), user schemes are kept as-is, and any persisted copy of a
 *  built-in id is dropped in favour of the code version. `activeId` is
 *  preserved when it still resolves, else falls back to the default (Beacon).
 *  Mirrors use-operating-guides.reconcileBuiltins. */
export function reconcileBuiltins(store: SchemeStore): SchemeStore {
  const userSchemes = store.schemes.filter((s) => !s.builtIn && !BUILTIN_SCHEME_IDS.has(s.id));
  const schemes = [...BUILTIN_SCHEMES.map(cloneBuiltin), ...userSchemes];
  const activeId = store.activeId && schemes.some((s) => s.id === store.activeId) ? store.activeId : DEFAULT_SCHEME_ID;
  return { schemes, activeId };
}

/** The active scheme (by `activeId`), falling back to the default (Beacon). */
export function activeSchemeOf(store: SchemeStore): ColorScheme {
  return (
    store.schemes.find((s) => s.id === store.activeId) ??
    BUILTIN_SCHEMES.find((s) => s.id === DEFAULT_SCHEME_ID) ??
    BUILTIN_SCHEMES[0]
  );
}

/** The raw (un-derived) token sub-map for the active scheme + current theme:
 *  the dark map when `isDark` and the scheme is dark-capable, else the light
 *  map. Callers apply `resolveSchemeColors` to add the AA variants. */
export function resolveActiveScheme(store: SchemeStore, isDark: boolean): SchemeColorMap {
  const s = activeSchemeOf(store);
  return isDark && s.supportsDark && s.dark ? s.dark : s.light;
}

/** The active scheme's structural (non-color) token map, or {} if none. */
export function resolveActiveStructural(store: SchemeStore): SchemeStructuralMap {
  return activeSchemeOf(store).structural ?? {};
}
