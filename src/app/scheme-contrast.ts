// Pure WCAG contrast helpers for the scheme editor (warn-only, non-blocking).
import type { SchemeColorMap } from "./scheme-apply";
import { hexToRgb, relLuminance, resolveSchemeColors } from "./scheme-tokens";

const AA = 4.5;

export function contrastRatio(a: string, b: string): number {
  const la = relLuminance(hexToRgb(a));
  const lb = relLuminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface ContrastPair {
  id: string;
  labelKey: string;
  ratio: number;
  passesAa: boolean;
}

export function checkSchemePairs(colors: SchemeColorMap): ContrastPair[] {
  const c = resolveSchemeColors(colors);
  const bg = c["--background"] ?? "#ffffff";
  const surface = c["--surface"] ?? "#ffffff";
  const defs: { id: string; labelKey: string; fg?: string; on: string }[] = [
    { id: "text-bg", labelKey: "schemePairTextBg", fg: c["--foreground"], on: bg },
    { id: "accent-surface", labelKey: "schemePairAccentSurface", fg: c["--ui-green-strong"] ?? c["--ui-green"], on: surface },
    { id: "rag-red", labelKey: "schemePairRagRed", fg: c["--rag-red-text"], on: surface },
    { id: "rag-amber", labelKey: "schemePairRagAmber", fg: c["--rag-amber-text"], on: surface },
    { id: "rag-green", labelKey: "schemePairRagGreen", fg: c["--rag-green-text"], on: surface },
  ];
  return defs
    .filter((d): d is { id: string; labelKey: string; fg: string; on: string } => !!d.fg)
    .map((d) => {
      const r = contrastRatio(d.fg, d.on);
      return { id: d.id, labelKey: d.labelKey, ratio: Math.round(r * 100) / 100, passesAa: r >= AA };
    });
}
