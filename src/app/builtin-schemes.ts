// Code-owned built-in color schemes (AIPM / Mockup / Harbor / Meridian / Umber).
// The dark-capable ones ship a light+dark pair over the 21 editable tokens;
// Mockup is light-only. AIPM + Mockup pin their -strong/-text AA variants +
// structural tokens to reproduce the historic globals.css look byte-for-byte.
// Harbor is the fresh-install default. Pure (no DOM). Built-ins are undeletable
// + refreshed from code on every load (reconcile).
import type { ColorScheme, SchemeStore } from "./color-schemes";
import type { SchemeColorMap, SchemeStructuralMap } from "./scheme-apply";
import { ICC_SEED, MOCKUP_SEED, ICC_STRUCTURAL, MOCKUP_STRUCTURAL } from "./scheme-tokens";

// ── AIPM (the historic default look) ──────────────────────────────────────
// Pinned -strong/-text + muted-foreground reproduce globals.css byte-for-byte;
// base-wins resolveSchemeColors keeps them (never re-derived).
export const ICC_LIGHT: SchemeColorMap = {
  ...ICC_SEED,
  "--AIPM-green-strong": "#4d7000", "--AIPM-pink-strong": "#c41e5a", "--AIPM-purple-strong": "#7a2d72",
  "--rag-red-text": "#c41e5a", "--rag-amber-text": "#aa4899", "--rag-green-text": "#4d7000",
  "--muted-foreground": "#636362",
};
export const ICC_DARK: SchemeColorMap = {
  ...ICC_SEED,
  "--background": "#0b0f12", "--foreground": "#e3e6e6", "--surface": "#121619",
  "--surface-muted": "#1b2024", "--line": "#2b3137", "--muted-foreground": "#9ca3a9",
  "--AIPM-green-strong": "#84bd00", "--AIPM-pink-strong": "#e96089", "--AIPM-purple-strong": "#d98cc8",
  "--rag-red-text": "#e96089", "--rag-amber-text": "#aa4899", "--rag-green-text": "#84bd00",
};

// ── Mockup ("Dashboard") — light-only, with structural shadows + gradient ──
export const MOCKUP_LIGHT: SchemeColorMap = {
  ...MOCKUP_SEED,
  "--rag-red-text": "#c0392b", "--rag-amber-text": "#a96a00", "--rag-green-text": "#3d7a00",
};

// ── Harbor ───────────────────────────────────────────────────────────────
export const HARBOR_LIGHT: SchemeColorMap = {
  "--AIPM-dark-blue": "#153a5c", "--AIPM-green": "#2bc4b6", "--background": "#f6f8fa", "--surface": "#ffffff",
  "--foreground": "#15212e", "--rag-red": "#d24a4a", "--rag-amber": "#cf8a1c", "--rag-green": "#2f9d70",
  "--AIPM-pink": "#c24a76", "--AIPM-purple": "#5f57a8", "--AIPM-blue": "#2f6f9e", "--AIPM-medium-grey": "#7d8a97",
  "--AIPM-light-grey": "#c9d3dc", "--surface-muted": "#eef2f6", "--line": "#dbe2ea", "--table-head-bg": "#153a5c",
  "--table-head-fg": "#ffffff", "--table-head-accent": "#2bc4b6", "--segment-track-bg": "#eef2f6",
  "--segment-active-bg": "#153a5c", "--segment-active-fg": "#ffffff",
};
export const HARBOR_DARK: SchemeColorMap = {
  "--AIPM-dark-blue": "#14293d", "--AIPM-green": "#2bc4b6", "--background": "#0e1620", "--surface": "#16212e",
  "--foreground": "#e4edf4", "--rag-red": "#ef7676", "--rag-amber": "#e8b25a", "--rag-green": "#4bc394",
  "--AIPM-pink": "#e88bb0", "--AIPM-purple": "#7a68bd", "--AIPM-blue": "#5aa6d8", "--AIPM-medium-grey": "#8493a1",
  "--AIPM-light-grey": "#aebccb", "--surface-muted": "#1b2836", "--line": "#273746", "--table-head-bg": "#1c3550",
  "--table-head-fg": "#dce8f2", "--table-head-accent": "#5fd0c6", "--segment-track-bg": "#1b2836",
  "--segment-active-bg": "#2b6493", "--segment-active-fg": "#f2f8fc",
};

// ── Meridian ─────────────────────────────────────────────────────────────
export const MERIDIAN_LIGHT: SchemeColorMap = {
  "--AIPM-dark-blue": "#3730a3", "--AIPM-green": "#26d197", "--background": "#f7f8fc", "--surface": "#ffffff",
  "--foreground": "#191a2b", "--rag-red": "#d83a3a", "--rag-amber": "#d18309", "--rag-green": "#16a34a",
  "--AIPM-pink": "#c93a86", "--AIPM-purple": "#7c3aed", "--AIPM-blue": "#4f6bd8", "--AIPM-medium-grey": "#7d8098",
  "--AIPM-light-grey": "#cbcede", "--surface-muted": "#eef0f8", "--line": "#e0e2f0", "--table-head-bg": "#3730a3",
  "--table-head-fg": "#ffffff", "--table-head-accent": "#26d197", "--segment-track-bg": "#eef0f8",
  "--segment-active-bg": "#3730a3", "--segment-active-fg": "#ffffff",
};
export const MERIDIAN_DARK: SchemeColorMap = {
  "--AIPM-dark-blue": "#241f5e", "--AIPM-green": "#10b981", "--background": "#111120", "--surface": "#1a1a2c",
  "--foreground": "#e8e8f5", "--rag-red": "#f27171", "--rag-amber": "#f0b64f", "--rag-green": "#37c46f",
  "--AIPM-pink": "#e87ab8", "--AIPM-purple": "#7d5fd6", "--AIPM-blue": "#818cf8", "--AIPM-medium-grey": "#82849e",
  "--AIPM-light-grey": "#b4b8da", "--surface-muted": "#23233a", "--line": "#31314a", "--table-head-bg": "#2c2b6e",
  "--table-head-fg": "#e2e2f5", "--table-head-accent": "#a5b4fc", "--segment-track-bg": "#23233a",
  "--segment-active-bg": "#6366f1", "--segment-active-fg": "#f5f5ff",
};

// ── Umber ────────────────────────────────────────────────────────────────
export const UMBER_LIGHT: SchemeColorMap = {
  "--AIPM-dark-blue": "#3b332a", "--AIPM-green": "#d19b3c", "--background": "#faf8f4", "--surface": "#ffffff",
  "--foreground": "#2a241d", "--rag-red": "#bd4a30", "--rag-amber": "#c88f17", "--rag-green": "#6c8a35",
  "--AIPM-pink": "#b34a5a", "--AIPM-purple": "#7a5a8a", "--AIPM-blue": "#4a6a8a", "--AIPM-medium-grey": "#9a8f7e",
  "--AIPM-light-grey": "#d8cfc0", "--surface-muted": "#f1ece3", "--line": "#e6ded2", "--table-head-bg": "#3b332a",
  "--table-head-fg": "#f2ebe0", "--table-head-accent": "#d19b3c", "--segment-track-bg": "#f1ece3",
  "--segment-active-bg": "#3b332a", "--segment-active-fg": "#f2ebe0",
};
export const UMBER_DARK: SchemeColorMap = {
  "--AIPM-dark-blue": "#3a3122", "--AIPM-green": "#e6b45c", "--background": "#181410", "--surface": "#221d16",
  "--foreground": "#efe7db", "--rag-red": "#e07a5f", "--rag-amber": "#e0b34a", "--rag-green": "#9cb85e",
  "--AIPM-pink": "#d98a9a", "--AIPM-purple": "#84619e", "--AIPM-blue": "#7a9ab8", "--AIPM-medium-grey": "#8a7f6e",
  "--AIPM-light-grey": "#d5cab6", "--surface-muted": "#2c261e", "--line": "#382f25", "--table-head-bg": "#33291e",
  "--table-head-fg": "#efe4d3", "--table-head-accent": "#e0a94a", "--segment-track-bg": "#2c261e",
  "--segment-active-bg": "#6a5a45", "--segment-active-fg": "#f6efe4",
};

export const BUILTIN_SCHEMES: readonly ColorScheme[] = [
  { id: "AIPM", name: "AIPM", builtIn: true, supportsDark: true, light: ICC_LIGHT, dark: ICC_DARK, structural: ICC_STRUCTURAL, branding: {} },
  { id: "mockup", name: "Dashboard", builtIn: true, supportsDark: false, light: MOCKUP_LIGHT, structural: MOCKUP_STRUCTURAL, branding: {} },
  { id: "harbor", name: "Harbor", builtIn: true, supportsDark: true, light: HARBOR_LIGHT, dark: HARBOR_DARK, branding: {} },
  { id: "meridian", name: "Meridian", builtIn: true, supportsDark: true, light: MERIDIAN_LIGHT, dark: MERIDIAN_DARK, branding: {} },
  { id: "umber", name: "Umber", builtIn: true, supportsDark: true, light: UMBER_LIGHT, dark: UMBER_DARK, branding: {} },
] as const;

export const DEFAULT_SCHEME_ID = "harbor";
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
 *  preserved when it still resolves, else falls back to Harbor. Mirrors
 *  use-operating-guides.reconcileBuiltins. */
export function reconcileBuiltins(store: SchemeStore): SchemeStore {
  const userSchemes = store.schemes.filter((s) => !s.builtIn && !BUILTIN_SCHEME_IDS.has(s.id));
  const schemes = [...BUILTIN_SCHEMES.map(cloneBuiltin), ...userSchemes];
  const activeId = store.activeId && schemes.some((s) => s.id === store.activeId) ? store.activeId : DEFAULT_SCHEME_ID;
  return { schemes, activeId };
}

/** The active scheme (by `activeId`), falling back to Harbor. */
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
