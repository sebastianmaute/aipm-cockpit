// Editable-token registry for custom color schemes + AA-variant derivation.
// Pure (no DOM). Code-owned built-in schemes (Harbor/Meridian/Umber) live in
// builtin-schemes.ts; AIPM/Mockup ship as importable theme files.
import type { SchemeColorMap } from "./scheme-apply";

// Neutral surface fallback for AA-variant derivation when a scheme omits
// --surface(-muted). (Was ICC_SEED["--surface"].)
const FALLBACK_SURFACE = "#ffffff";

export interface TokenSpec {
  token: string;
  labelKey: string;
}

export const CORE_TOKENS: readonly TokenSpec[] = [
  { token: "--ui-dark-blue", labelKey: "schemeTokenPrimary" },
  { token: "--ui-green", labelKey: "schemeTokenAccent" },
  { token: "--background", labelKey: "schemeTokenBackground" },
  { token: "--surface", labelKey: "schemeTokenSurface" },
  { token: "--foreground", labelKey: "schemeTokenText" },
  { token: "--rag-red", labelKey: "schemeTokenRagRed" },
  { token: "--rag-amber", labelKey: "schemeTokenRagAmber" },
  { token: "--rag-green", labelKey: "schemeTokenRagGreen" },
] as const;

export const ADVANCED_TOKENS: readonly TokenSpec[] = [
  { token: "--ui-pink", labelKey: "schemeTokenPink" },
  { token: "--ui-purple", labelKey: "schemeTokenPurple" },
  { token: "--ui-blue", labelKey: "schemeTokenBlue" },
  { token: "--ui-medium-grey", labelKey: "schemeTokenMediumGrey" },
  { token: "--ui-light-grey", labelKey: "schemeTokenLightGrey" },
  { token: "--surface-muted", labelKey: "schemeTokenSurfaceMuted" },
  { token: "--line", labelKey: "schemeTokenLine" },
  { token: "--table-head-bg", labelKey: "schemeTokenTableHeadBg" },
  { token: "--table-head-fg", labelKey: "schemeTokenTableHeadFg" },
  { token: "--table-head-accent", labelKey: "schemeTokenTableHeadAccent" },
  { token: "--segment-track-bg", labelKey: "schemeTokenSegmentTrack" },
  { token: "--segment-active-bg", labelKey: "schemeTokenSegmentActiveBg" },
  { token: "--segment-active-fg", labelKey: "schemeTokenSegmentActiveFg" },
] as const;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function relLuminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a: string, b: string): number {
  const la = relLuminance(hexToRgb(a));
  const lb = relLuminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
// Nudge the base toward AA (ratio >= 4.5) against bg. Direction is mode-aware:
// a DARK surface (relLuminance < 0.5) LIGHTENS the base toward white; a LIGHT
// surface DARKENS toward black. Dark-on-dark can never reach AA by darkening.
function nudgeToAa(base: string, bg: string): string {
  const lighten = relLuminance(hexToRgb(bg)) < 0.5;
  const factor = lighten ? 1 / 0.85 : 0.85;
  let [r, g, b] = hexToRgb(base);
  for (let i = 0; i < 20 && ratio(rgbToHex(r, g, b), bg) < 4.5; i++) {
    r = Math.min(255, r * factor);
    g = Math.min(255, g * factor);
    b = Math.min(255, b * factor);
  }
  return rgbToHex(r, g, b);
}

export function deriveAaVariants(colors: SchemeColorMap): SchemeColorMap {
  // Derive the -text/-strong variants against --surface-muted when present: it
  // is the "card" background (bg-surface-muted, e.g. Kanban cards) and is always
  // the HARDER of the two (darker than --surface in light schemes, lighter in
  // dark ones), so clearing AA there guarantees AA on the plain --surface too.
  const surface = colors["--surface-muted"] ?? colors["--surface"] ?? FALLBACK_SURFACE;
  const out: SchemeColorMap = {};
  if (colors["--ui-green"]) out["--ui-green-strong"] = nudgeToAa(colors["--ui-green"], surface);
  if (colors["--ui-pink"]) out["--ui-pink-strong"] = nudgeToAa(colors["--ui-pink"], surface);
  if (colors["--ui-purple"]) out["--ui-purple-strong"] = nudgeToAa(colors["--ui-purple"], surface);
  if (colors["--rag-red"]) out["--rag-red-text"] = nudgeToAa(colors["--rag-red"], surface);
  if (colors["--rag-amber"]) out["--rag-amber-text"] = nudgeToAa(colors["--rag-amber"], surface);
  if (colors["--rag-green"]) out["--rag-green-text"] = nudgeToAa(colors["--rag-green"], surface);
  if (colors["--foreground"]) out["--muted-foreground"] = colors["--foreground"];
  return out;
}

export function resolveSchemeColors(colors: SchemeColorMap): SchemeColorMap {
  // base-wins: derivation FILLS the AA variants a scheme omits; an explicitly
  // pinned -strong/-text/muted-foreground (built-in AIPM/Mockup) is preserved.
  return { ...deriveAaVariants(colors), ...colors };
}
