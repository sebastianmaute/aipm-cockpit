// Editable-token registry for custom color schemes + AA-variant derivation.
// Pure (no DOM). Hex values mirror globals.css :root (AIPM) and
// :root[data-style="mockup"] (Mockup).
import type { SchemeColorMap } from "./scheme-apply";

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
function darkenToAa(base: string, bg: string): string {
  let [r, g, b] = hexToRgb(base);
  for (let i = 0; i < 20 && ratio(rgbToHex(r, g, b), bg) < 4.5; i++) {
    r *= 0.85; g *= 0.85; b *= 0.85;
  }
  return rgbToHex(r, g, b);
}

export function deriveAaVariants(colors: SchemeColorMap): SchemeColorMap {
  const surface = colors["--surface"] ?? ICC_SEED["--surface"];
  const out: SchemeColorMap = {};
  if (colors["--AIPM-green"]) out["--AIPM-green-strong"] = darkenToAa(colors["--AIPM-green"], surface);
  if (colors["--AIPM-pink"]) out["--AIPM-pink-strong"] = darkenToAa(colors["--AIPM-pink"], surface);
  if (colors["--AIPM-purple"]) out["--AIPM-purple-strong"] = darkenToAa(colors["--AIPM-purple"], surface);
  if (colors["--rag-red"]) out["--rag-red-text"] = darkenToAa(colors["--rag-red"], surface);
  if (colors["--rag-amber"]) out["--rag-amber-text"] = darkenToAa(colors["--rag-amber"], surface);
  if (colors["--rag-green"]) out["--rag-green-text"] = darkenToAa(colors["--rag-green"], surface);
  if (colors["--foreground"]) out["--muted-foreground"] = colors["--foreground"];
  return out;
}

export function resolveSchemeColors(colors: SchemeColorMap): SchemeColorMap {
  return { ...colors, ...deriveAaVariants(colors) };
}
