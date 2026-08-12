// Per-device custom color-scheme library (mirrors saved-views.ts). Out of
// exports/Turso; auto-cleared by clearAppConfig's aipm-cockpit:* sweep. Untrusted
// input (localStorage + imported JSON) is validated: colors must be hex, the
// logo/favicon re-run through sanitizeBranding, unknown token keys are dropped.
import { type BrandingConfig, sanitizeBranding } from "./settings-types";
import { CORE_TOKENS, ADVANCED_TOKENS } from "./scheme-tokens";
import { type SchemeColorMap, type SchemeStructuralMap, STRUCTURAL_TOKENS, isSafeRawCssValue } from "./scheme-apply";

export interface ColorScheme {
  id: string; // user schemes: "u-<n>"; built-in schemes carry a code-owned string id
  name: string;
  builtIn?: boolean;
  supportsDark: boolean;
  light: SchemeColorMap;
  dark?: SchemeColorMap; // present iff supportsDark
  // Built-in schemes may carry a code-owned structural map (padding/radius/etc);
  // user schemes stay color-only and never persist this through the editor.
  structural?: SchemeStructuralMap;
  branding: BrandingConfig;
}
export interface SchemeStore {
  schemes: ColorScheme[];
  activeId: string | null;
}

const KEY = "aipm-cockpit:color-schemes";
const MAX_SCHEMES = 30;
const NAME_MAX = 60;
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const USER_ID_RE = /^u-(\d+)$/;
// Pinned AA/derived tokens a portable theme (AIPM/Mockup) may carry so its exact
// look survives import; the editor still edits only CORE+ADVANCED. Trade-off: a
// scheme seeded from an imported theme keeps these pins on save (base-wins
// resolveSchemeColors never re-derives them), so editing a base colour won't
// refresh the pin — accepted for the faithful-copy intent.
const DERIVED_TOKENS = [
  "--ui-green-strong", "--ui-pink-strong", "--ui-purple-strong",
  "--rag-red-text", "--rag-amber-text", "--rag-green-text", "--muted-foreground",
] as const;
const VALID_TOKENS = new Set([
  ...CORE_TOKENS.map((t) => t.token),
  ...ADVANCED_TOKENS.map((t) => t.token),
  ...DERIVED_TOKENS,
]);
const STRUCTURAL_SET = new Set(STRUCTURAL_TOKENS);

function cleanStructural(raw: unknown): SchemeStructuralMap | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: SchemeStructuralMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (STRUCTURAL_SET.has(k) && typeof v === "string" && isSafeRawCssValue(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanColors(raw: unknown): SchemeColorMap {
  const out: SchemeColorMap = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (VALID_TOKENS.has(k) && typeof v === "string" && HEX_RE.test(v)) out[k] = v;
    }
  }
  return out;
}

export function cleanScheme(raw: unknown, id: string): ColorScheme | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim().slice(0, NAME_MAX) : "";
  if (!name) return null;
  // Migration: legacy flat `colors` becomes `light`.
  const light = cleanColors(o.light ?? o.colors);
  let supportsDark = o.supportsDark === true;
  let dark: SchemeColorMap | undefined = supportsDark ? cleanColors(o.dark) : undefined;
  if (dark && Object.keys(dark).length === 0) {
    supportsDark = false;
    dark = undefined;
  }
  const structural = cleanStructural(o.structural);
  return {
    id,
    name,
    ...(o.builtIn === true ? { builtIn: true } : {}),
    supportsDark,
    light,
    ...(dark ? { dark } : {}),
    ...(structural ? { structural } : {}),
    branding: sanitizeBranding(o.branding) ?? {},
  };
}

function idOf(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return `u-${raw}`;
  return "";
}

export function loadSchemes(): SchemeStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { schemes: [], activeId: null };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const arr = Array.isArray(parsed.schemes) ? parsed.schemes : [];
    const schemes = arr
      .map((s) => cleanScheme(s, idOf((s as { id?: unknown }).id)))
      .filter((s): s is ColorScheme => s !== null)
      .slice(0, MAX_SCHEMES);
    // Preserve the persisted activeId as-is (incl. a built-in id like "harbor"
    // that is NOT in the raw store). reconcileBuiltins is the SOLE validator of
    // activeId against the merged (built-in + user) list — a stale/unknown id
    // resolves to the default scheme there. Validating here would strip every
    // built-in selection on read.
    const activeId =
      typeof parsed.activeId === "string"
        ? parsed.activeId
        : typeof parsed.activeId === "number"
          ? `u-${parsed.activeId}`
          : null;
    return { schemes, activeId };
  } catch {
    return { schemes: [], activeId: null };
  }
}

export function saveSchemes(store: SchemeStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* private mode / quota */
  }
}

export function nextUserId(schemes: ColorScheme[]): string {
  let max = 0;
  for (const s of schemes) {
    const m = USER_ID_RE.exec(s.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `u-${max + 1}`;
}

export function addScheme(name: string, colors: SchemeColorMap, branding: BrandingConfig): SchemeStore {
  const cur = loadSchemes();
  const id = nextUserId(cur.schemes);
  const scheme: ColorScheme = {
    id,
    name: name.trim().slice(0, NAME_MAX) || `Scheme ${id}`,
    supportsDark: false,
    light: cleanColors(colors),
    branding: sanitizeBranding(branding) ?? {},
  };
  const schemes = [...cur.schemes, scheme].slice(-MAX_SCHEMES);
  const next: SchemeStore = { schemes, activeId: id };
  saveSchemes(next);
  return next;
}

export function updateScheme(id: string, patch: Partial<Omit<ColorScheme, "id">>): SchemeStore {
  const cur = loadSchemes();
  const schemes = cur.schemes.map((s) =>
    s.id !== id || s.builtIn
      ? s
      : {
          ...s,
          ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, NAME_MAX) || s.name } : {}),
          ...(patch.light !== undefined ? { light: cleanColors(patch.light) } : {}),
          ...(patch.supportsDark !== undefined ? { supportsDark: patch.supportsDark === true } : {}),
          ...(patch.dark !== undefined ? { dark: cleanColors(patch.dark) } : {}),
          ...(patch.structural !== undefined ? { structural: cleanStructural(patch.structural) } : {}),
          ...(patch.branding !== undefined ? { branding: sanitizeBranding(patch.branding) ?? {} } : {}),
        },
  );
  const next: SchemeStore = { ...cur, schemes };
  saveSchemes(next);
  return next;
}

export function removeScheme(id: string): SchemeStore {
  const cur = loadSchemes();
  const target = cur.schemes.find((s) => s.id === id);
  if (target?.builtIn) return cur; // built-ins are undeletable
  const schemes = cur.schemes.filter((s) => s.id !== id);
  const next: SchemeStore = { schemes, activeId: cur.activeId === id ? null : cur.activeId };
  saveSchemes(next);
  return next;
}

export function setActive(id: string | null): SchemeStore {
  const cur = loadSchemes();
  // Persist any non-empty scheme id (built-in or user) as-is — built-ins are not
  // in the raw store, so validating here would drop them. reconcileBuiltins is
  // the sole validator (unknown id → the default scheme).
  const next: SchemeStore = { ...cur, activeId: typeof id === "string" && id ? id : null };
  saveSchemes(next);
  return next;
}

/** Branding to write into settings when a custom scheme is applied: schemes now
 *  OWN all four branding fields — logo, favicon, slogan and footerSlogan are
 *  REPLACED from the scheme (and cleared when the scheme lacks them). The global
 *  Branding block edits logo/favicon/slogan/footerSlogan only for built-in
 *  schemes (a branded user scheme owns them via the scheme editor). */
export function mergeAppliedBranding(
  current: BrandingConfig | undefined,
  scheme: BrandingConfig,
): BrandingConfig {
  return {
    ...(current ?? {}),
    logo: scheme.logo,
    favicon: scheme.favicon,
    slogan: scheme.slogan,
    footerSlogan: scheme.footerSlogan,
  };
}

export function exportScheme(scheme: ColorScheme): string {
  return JSON.stringify(
    {
      name: scheme.name,
      light: scheme.light,
      ...(scheme.dark ? { dark: scheme.dark } : {}),
      supportsDark: scheme.supportsDark,
      ...(scheme.structural ? { structural: scheme.structural } : {}),
      branding: scheme.branding,
    },
    null,
    2,
  );
}

export function importScheme(raw: string): ColorScheme | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return cleanScheme(parsed, nextUserId(loadSchemes().schemes));
  } catch {
    return null;
  }
}
