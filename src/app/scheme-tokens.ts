// Editable-token registry for custom color schemes + AA-variant derivation.
// Pure (no DOM). Hex values mirror globals.css :root (AIPM) and
// :root[data-style="mockup"] (Mockup).
import type { SchemeColorMap, SchemeStructuralMap } from "./scheme-apply";

export interface TokenSpec {
  token: string;
  labelKey: string;
}

export const CORE_TOKENS: readonly TokenSpec[] = [
  { token: "--AIPM-dark-blue", labelKey: "schemeTokenPrimary" },
  { token: "--AIPM-green", labelKey: "schemeTokenAccent" },
  { token: "--background", labelKey: "schemeTokenBackground" },
  { token: "--surface", labelKey: "schemeTokenSurface" },
  { token: "--foreground", labelKey: "schemeTokenText" },
  { token: "--rag-red", labelKey: "schemeTokenRagRed" },
  { token: "--rag-amber", labelKey: "schemeTokenRagAmber" },
  { token: "--rag-green", labelKey: "schemeTokenRagGreen" },
] as const;

export const ADVANCED_TOKENS: readonly TokenSpec[] = [
  { token: "--AIPM-pink", labelKey: "schemeTokenPink" },
  { token: "--AIPM-purple", labelKey: "schemeTokenPurple" },
  { token: "--AIPM-blue", labelKey: "schemeTokenBlue" },
  { token: "--AIPM-medium-grey", labelKey: "schemeTokenMediumGrey" },
  { token: "--AIPM-light-grey", labelKey: "schemeTokenLightGrey" },
  { token: "--surface-muted", labelKey: "schemeTokenSurfaceMuted" },
  { token: "--line", labelKey: "schemeTokenLine" },
  { token: "--table-head-bg", labelKey: "schemeTokenTableHeadBg" },
  { token: "--table-head-fg", labelKey: "schemeTokenTableHeadFg" },
  { token: "--table-head-accent", labelKey: "schemeTokenTableHeadAccent" },
  { token: "--segment-track-bg", labelKey: "schemeTokenSegmentTrack" },
  { token: "--segment-active-bg", labelKey: "schemeTokenSegmentActiveBg" },
  { token: "--segment-active-fg", labelKey: "schemeTokenSegmentActiveFg" },
] as const;

export const ICC_SEED: SchemeColorMap = {
  "--AIPM-dark-blue": "#004159",
  "--AIPM-green": "#84bd00",
  "--background": "#ffffff",
  "--surface": "#ffffff",
  "--foreground": "#636362",
  "--rag-red": "#ef4444",
  "--rag-amber": "#f59e0b",
  "--rag-green": "#10b981",
  "--AIPM-pink": "#e5497c",
  "--AIPM-purple": "#aa4899",
  "--AIPM-blue": "#60c0dd",
  "--AIPM-medium-grey": "#939598",
  "--AIPM-light-grey": "#e3e6e6",
  "--surface-muted": "#e3e6e6",
  "--line": "#e3e6e6",
  "--table-head-bg": "#004159",
  "--table-head-fg": "#ffffff",
  "--table-head-accent": "#84bd00",
  "--segment-track-bg": "#ffffff",
  "--segment-active-bg": "#004159",
  "--segment-active-fg": "#ffffff",
};

// Mockup overrides over the AIPM base (from :root[data-style="mockup"]). Tokens
// the mockup block does not override keep their AIPM value.
export const MOCKUP_SEED: SchemeColorMap = {
  ...ICC_SEED,
  "--rag-red": "#d64545",
  "--rag-amber": "#f0a020",
  "--rag-green": "#5aa700",
  "--table-head-bg": "#f1f3f4",
  "--table-head-fg": "#3f4448",
  "--table-head-accent": "#3d7a00",
  "--segment-track-bg": "#eef1f3",
  "--segment-active-bg": "#ffffff",
  "--segment-active-fg": "#3d7a00",
};

// Structural (non-color) tokens: shadows, the KPI gradient, delta-chip padding,
// and the opaque RAG chip fills. AIPM reproduces the flat look (no shadow/gradient);
// Mockup adds depth + the red→amber→green gauge gradient.
export const STRUCTURAL_TOKENS: readonly TokenSpec[] = [
  { token: "--shadow-card", labelKey: "schemeTokenShadowCard" },
  { token: "--shadow-control", labelKey: "schemeTokenShadowControl" },
  { token: "--shadow-card-hover", labelKey: "schemeTokenShadowCardHover" },
  { token: "--gradient-kpi", labelKey: "schemeTokenGradientKpi" },
  { token: "--delta-chip-pad", labelKey: "schemeTokenDeltaChipPad" },
  { token: "--rag-green-chip", labelKey: "schemeTokenRagGreenChip" },
  { token: "--rag-red-chip", labelKey: "schemeTokenRagRedChip" },
] as const;

export const ICC_STRUCTURAL: SchemeStructuralMap = {
  "--shadow-card": "none", "--shadow-control": "none", "--shadow-card-hover": "none",
  "--gradient-kpi": "var(--AIPM-green)", "--delta-chip-pad": "0",
  "--rag-green-chip": "transparent", "--rag-red-chip": "transparent",
};
export const MOCKUP_STRUCTURAL: SchemeStructuralMap = {
  "--shadow-card": "0 1px 3px rgba(0, 65, 89, 0.12), 0 1px 2px rgba(0, 65, 89, 0.08)",
  "--shadow-control": "0 1px 2px rgba(0, 65, 89, 0.10)",
  "--shadow-card-hover": "0 4px 10px rgba(0, 65, 89, 0.14), 0 2px 4px rgba(0, 65, 89, 0.10)",
  "--gradient-kpi": "linear-gradient(90deg, var(--rag-red), var(--rag-amber), var(--rag-green))",
  "--delta-chip-pad": "0.125rem 0.375rem", "--rag-green-chip": "#e6f2d8", "--rag-red-chip": "#fae9e9",
};

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
  const surface = colors["--surface-muted"] ?? colors["--surface"] ?? ICC_SEED["--surface"];
  const out: SchemeColorMap = {};
  if (colors["--AIPM-green"]) out["--AIPM-green-strong"] = nudgeToAa(colors["--AIPM-green"], surface);
  if (colors["--AIPM-pink"]) out["--AIPM-pink-strong"] = nudgeToAa(colors["--AIPM-pink"], surface);
  if (colors["--AIPM-purple"]) out["--AIPM-purple-strong"] = nudgeToAa(colors["--AIPM-purple"], surface);
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
