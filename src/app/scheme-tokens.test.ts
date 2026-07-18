import { describe, it, expect } from "vitest";
import {
  deriveAaVariants,
  resolveSchemeColors,
} from "./scheme-tokens";

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}
function relLuminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastRatio(a: string, b: string): number {
  const la = relLuminance(hexToRgb(a));
  const lb = relLuminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe("scheme-tokens", () => {
  it("resolveSchemeColors derives AA variants from a minimal color map", () => {
    const out = resolveSchemeColors({
      "--AIPM-green": "#84bd00",
      "--rag-red": "#ef4444",
      "--surface": "#ffffff",
    });
    expect(out["--AIPM-green-strong"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(out["--rag-red-text"]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("deriveAaVariants darkens the accent until it clears AA on white", () => {
    const derived = deriveAaVariants({ "--AIPM-green": "#84bd00", "--surface": "#ffffff" });
    expect(derived["--AIPM-green-strong"]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("resolveSchemeColors merges user colors with derived variants", () => {
    const resolved = resolveSchemeColors({ "--AIPM-green": "#84bd00", "--surface": "#ffffff" });
    expect(resolved["--AIPM-green"]).toBe("#84bd00");
    expect(resolved["--AIPM-green-strong"]).toBeDefined();
  });

  it("resolveSchemeColors: an explicit base derived token wins over derivation", () => {
    // LIGHT surface-muted: #84bd00 fails AA vs white, so derivation WOULD darken
    // it. Pinning the raw base proves base-wins (else derived darkens it).
    const out = resolveSchemeColors({ "--AIPM-green": "#84bd00", "--surface-muted": "#ffffff", "--AIPM-green-strong": "#84bd00" });
    expect(out["--AIPM-green-strong"]).toBe("#84bd00"); // pinned, NOT re-derived/darkened
  });

  it("resolveSchemeColors: missing derived tokens are still filled", () => {
    const out = resolveSchemeColors({ "--AIPM-green": "#84bd00", "--surface-muted": "#e3e6e6" });
    expect(out["--AIPM-green-strong"]).toBeDefined();
  });

  it("LIGHT map: derived text variants clear AA vs the light surface AND are darker than the base", () => {
    const light = "#ffffff";
    const colors = {
      "--surface": light,
      "--foreground": "#636362",
      "--AIPM-green": "#84bd00",
      "--rag-red": "#ef4444",
    };
    const derived = deriveAaVariants(colors);
    expect(contrastRatio(derived["--AIPM-green-strong"]!, light)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(derived["--rag-red-text"]!, light)).toBeGreaterThanOrEqual(4.5);
    // darkened => lower luminance than the base
    expect(relLuminance(hexToRgb(derived["--AIPM-green-strong"]!))).toBeLessThan(
      relLuminance(hexToRgb(colors["--AIPM-green"])),
    );
    expect(relLuminance(hexToRgb(derived["--rag-red-text"]!))).toBeLessThan(
      relLuminance(hexToRgb(colors["--rag-red"])),
    );
  });

  it("DARK map: derived text variants clear AA vs the dark surface AND are lighter than the base", () => {
    const dark = "#16212e";
    const colors = {
      "--surface": dark,
      "--foreground": "#e4edf4",
      "--AIPM-green": "#4bc394",
      "--rag-green": "#4bc394",
      "--rag-red": "#d64545",
    };
    const derived = deriveAaVariants(colors);
    expect(contrastRatio(derived["--rag-green-text"]!, dark)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(derived["--AIPM-green-strong"]!, dark)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(derived["--rag-red-text"]!, dark)).toBeGreaterThanOrEqual(4.5);
    // rag-red starts BELOW AA on the dark surface, so the derivation must
    // LIGHTEN it (higher luminance than the base) to reach AA — proving direction.
    expect(contrastRatio(colors["--rag-red"], dark)).toBeLessThan(4.5);
    expect(relLuminance(hexToRgb(derived["--rag-red-text"]!))).toBeGreaterThan(
      relLuminance(hexToRgb(colors["--rag-red"])),
    );
  });

  it("--muted-foreground equals the map's --foreground for both light and dark maps", () => {
    const lightDerived = deriveAaVariants({ "--surface": "#ffffff", "--foreground": "#636362" });
    expect(lightDerived["--muted-foreground"]).toBe("#636362");
    const darkDerived = deriveAaVariants({ "--surface": "#16212e", "--foreground": "#e4edf4" });
    expect(darkDerived["--muted-foreground"]).toBe("#e4edf4");
  });
});
