// Per-device custom color-scheme library (mirrors saved-views.ts). Out of
// exports/Turso; auto-cleared by clearAppConfig's lop-app:* sweep. Untrusted
// input (localStorage + imported JSON) is validated: colors must be hex, the
// logo/favicon re-run through sanitizeBranding, unknown token keys are dropped.
import { type BrandingConfig, sanitizeBranding } from "./settings-types";
import { CORE_TOKENS, ADVANCED_TOKENS } from "./scheme-tokens";
import type { SchemeColorMap } from "./scheme-apply";

export interface ColorScheme {
  id: number;
  name: string;
  colors: SchemeColorMap;
  branding: BrandingConfig;
}
export interface SchemeStore {
  schemes: ColorScheme[];
  activeId: number | null;
}

const KEY = "lop-app:color-schemes";
const MAX_SCHEMES = 30;
const NAME_MAX = 60;
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const VALID_TOKENS = new Set([...CORE_TOKENS, ...ADVANCED_TOKENS].map((t) => t.token));

function cleanColors(raw: unknown): SchemeColorMap {
  const out: SchemeColorMap = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (VALID_TOKENS.has(k) && typeof v === "string" && HEX_RE.test(v)) out[k] = v;
    }
  }
  return out;
}

function cleanScheme(raw: unknown, id: number): ColorScheme | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim().slice(0, NAME_MAX) : "";
  if (!name) return null;
  return {
    id,
    name,
    colors: cleanColors(o.colors),
    branding: sanitizeBranding(o.branding) ?? {},
  };
}

export function loadSchemes(): SchemeStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { schemes: [], activeId: null };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const arr = Array.isArray(parsed.schemes) ? parsed.schemes : [];
    const schemes = arr
      .map((s) => cleanScheme(s, typeof (s as { id?: unknown }).id === "number" ? (s as { id: number }).id : 0))
      .filter((s): s is ColorScheme => s !== null)
      .slice(0, MAX_SCHEMES);
    const activeId = typeof parsed.activeId === "number" ? parsed.activeId : null;
    return { schemes, activeId: schemes.some((s) => s.id === activeId) ? activeId : null };
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

function nextId(schemes: ColorScheme[]): number {
  return schemes.reduce((m, s) => Math.max(m, s.id), 0) + 1;
}

export function addScheme(name: string, colors: SchemeColorMap, branding: BrandingConfig): SchemeStore {
  const cur = loadSchemes();
  const id = nextId(cur.schemes);
  const scheme: ColorScheme = {
    id,
    name: name.trim().slice(0, NAME_MAX) || `Scheme ${id}`,
    colors: cleanColors(colors),
    branding: sanitizeBranding(branding) ?? {},
  };
  const schemes = [...cur.schemes, scheme].slice(-MAX_SCHEMES);
  const next: SchemeStore = { schemes, activeId: id };
  saveSchemes(next);
  return next;
}

export function updateScheme(id: number, patch: Partial<Omit<ColorScheme, "id">>): SchemeStore {
  const cur = loadSchemes();
  const schemes = cur.schemes.map((s) =>
    s.id === id
      ? {
          ...s,
          ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, NAME_MAX) || s.name } : {}),
          ...(patch.colors !== undefined ? { colors: cleanColors(patch.colors) } : {}),
          ...(patch.branding !== undefined ? { branding: sanitizeBranding(patch.branding) ?? {} } : {}),
        }
      : s,
  );
  const next: SchemeStore = { ...cur, schemes };
  saveSchemes(next);
  return next;
}

export function removeScheme(id: number): SchemeStore {
  const cur = loadSchemes();
  const schemes = cur.schemes.filter((s) => s.id !== id);
  const next: SchemeStore = { schemes, activeId: cur.activeId === id ? null : cur.activeId };
  saveSchemes(next);
  return next;
}

export function setActive(id: number | null): SchemeStore {
  const cur = loadSchemes();
  const next: SchemeStore = {
    ...cur,
    activeId: id !== null && cur.schemes.some((s) => s.id === id) ? id : null,
  };
  saveSchemes(next);
  return next;
}

export function exportScheme(scheme: ColorScheme): string {
  return JSON.stringify({ name: scheme.name, colors: scheme.colors, branding: scheme.branding }, null, 2);
}

export function importScheme(raw: string): ColorScheme | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return cleanScheme(parsed, 0);
  } catch {
    return null;
  }
}
