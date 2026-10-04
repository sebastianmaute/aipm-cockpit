import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveAaVariants,
  resolveSchemeColors,
} from "./scheme-tokens";
import { BUILTIN_SCHEMES } from "./builtin-schemes";

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
      "--ui-green": "#84bd00",
      "--rag-red": "#ef4444",
      "--surface": "#ffffff",
    });
    expect(out["--ui-green-strong"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(out["--rag-red-text"]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("deriveAaVariants darkens the accent until it clears AA on white", () => {
    const derived = deriveAaVariants({ "--ui-green": "#84bd00", "--surface": "#ffffff" });
    expect(derived["--ui-green-strong"]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("resolveSchemeColors merges user colors with derived variants", () => {
    const resolved = resolveSchemeColors({ "--ui-green": "#84bd00", "--surface": "#ffffff" });
    expect(resolved["--ui-green"]).toBe("#84bd00");
    expect(resolved["--ui-green-strong"]).toBeDefined();
  });

  it("resolveSchemeColors: an explicit derived token that clears AA wins over derivation", () => {
    // #4d7000 clears 4.5 on white, and derivation from #84bd00 would land on a
    // DIFFERENT value — so equality proves the pin won (base-wins).
    const out = resolveSchemeColors({ "--ui-green": "#84bd00", "--surface-muted": "#ffffff", "--ui-green-strong": "#4d7000" });
    expect(deriveAaVariants({ "--ui-green": "#84bd00", "--surface-muted": "#ffffff" })["--ui-green-strong"]).not.toBe("#4d7000");
    expect(out["--ui-green-strong"]).toBe("#4d7000");
  });

  it("resolveSchemeColors: missing derived tokens are still filled", () => {
    const out = resolveSchemeColors({ "--ui-green": "#84bd00", "--surface-muted": "#e3e6e6" });
    expect(out["--ui-green-strong"]).toBeDefined();
  });

  it("LIGHT map: derived text variants clear AA vs the light surface AND are darker than the base", () => {
    const light = "#ffffff";
    const colors = {
      "--surface": light,
      "--foreground": "#636362",
      "--ui-green": "#84bd00",
      "--rag-red": "#ef4444",
    };
    const derived = deriveAaVariants(colors);
    expect(contrastRatio(derived["--ui-green-strong"]!, light)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(derived["--rag-red-text"]!, light)).toBeGreaterThanOrEqual(4.5);
    // darkened => lower luminance than the base
    expect(relLuminance(hexToRgb(derived["--ui-green-strong"]!))).toBeLessThan(
      relLuminance(hexToRgb(colors["--ui-green"])),
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
      "--ui-green": "#4bc394",
      "--rag-green": "#4bc394",
      "--rag-red": "#d64545",
    };
    const derived = deriveAaVariants(colors);
    expect(contrastRatio(derived["--rag-green-text"]!, dark)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(derived["--ui-green-strong"]!, dark)).toBeGreaterThanOrEqual(4.5);
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

// open-followups §239 — a pin is held to the floor its own derivation targets,
// against the same reference, and nudged (not replaced) when it falls short.
describe("resolveSchemeColors — pinned derived tokens are held to their floor (§239)", () => {
  it("nudges a text pin below 4.5 on the card until it clears, keeping the pin's hue", () => {
    // Petrol's shape: an AMBER status text pinned to a PURPLE. #aa4899 on #e3e6e6 is 4.08.
    const colors = { "--rag-amber": "#f59e0b", "--surface-muted": "#e3e6e6", "--rag-amber-text": "#aa4899" };
    expect(contrastRatio("#aa4899", "#e3e6e6")).toBeLessThan(4.5);
    const out = resolveSchemeColors(colors)["--rag-amber-text"];
    expect(contrastRatio(out, "#e3e6e6")).toBeGreaterThanOrEqual(4.5);
    // Nudged from the PIN, not re-derived from the amber base: still purple.
    expect(out).not.toBe(deriveAaVariants(colors)["--rag-amber-text"]);
    const [r, g, b] = hexToRgb(out);
    expect(r).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(g);
  });

  it("lightens a failing text pin on a DARK card", () => {
    const out = resolveSchemeColors({ "--rag-amber": "#f59e0b", "--surface-muted": "#1b2024", "--rag-amber-text": "#aa4899" })["--rag-amber-text"];
    expect(contrastRatio(out, "#1b2024")).toBeGreaterThanOrEqual(4.5);
    expect(relLuminance(hexToRgb(out))).toBeGreaterThan(relLuminance(hexToRgb("#aa4899")));
  });

  it("holds a state-border pin to 3:1 against --line, not to 4.5", () => {
    // #888888 on white is 3.54: a pass for a border, a fail for text.
    const kept = resolveSchemeColors({ "--ui-dark-blue": "#16212e", "--line": "#ffffff", "--control-state-border": "#888888" });
    expect(kept["--control-state-border"]).toBe("#888888");
    const nudged = resolveSchemeColors({ "--ui-dark-blue": "#16212e", "--line": "#ffffff", "--control-state-border": "#bbbbbb" });
    expect(nudged["--control-state-border"]).not.toBe("#bbbbbb");
    expect(contrastRatio(nudged["--control-state-border"], "#ffffff")).toBeGreaterThanOrEqual(3);
  });

  it("judges a --ui-purple-strong pin against the purple tint, not the plain card", () => {
    // #985089 clears 4.5 on white (5.46) but not on the 20% #aa4899 tint over
    // white, #eedaeb (4.13) — the background every purple-strong text sits on.
    expect(contrastRatio("#985089", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#985089", "#eedaeb")).toBeLessThan(4.5);
    const out = resolveSchemeColors({ "--ui-purple": "#aa4899", "--surface-muted": "#ffffff", "--ui-purple-strong": "#985089" })["--ui-purple-strong"];
    expect(out).not.toBe("#985089");
    expect(contrastRatio(out, "#eedaeb")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps a passing pin byte-for-byte, as written", () => {
    // A nudge re-serialises (lower-case, six digits); a pin that clears its floor
    // must not be touched at all.
    const out = resolveSchemeColors({ "--ui-green": "#84bd00", "--surface-muted": "#ffffff", "--ui-green-strong": "#4D7000" });
    expect(out["--ui-green-strong"]).toBe("#4D7000");
  });

  it("keeps a --muted-foreground pin whatever its contrast — it is a copy, not an AA derivation", () => {
    const out = resolveSchemeColors({ "--foreground": "#111111", "--surface-muted": "#ffffff", "--muted-foreground": "#eeeeee" });
    expect(out["--muted-foreground"]).toBe("#eeeeee");
  });

  it("cannot change a built-in scheme: none pins a floor-checked token", () => {
    // The floor check acts only on a PIN, so this is the property that keeps built-ins unchanged.
    const checked = ["--ui-green-strong", "--ui-pink-strong", "--ui-purple-strong", "--rag-red-text", "--rag-amber-text",
      "--rag-green-text", "--control-state-border", "--control-state-border-pink", "--control-state-border-green"];
    let maps = 0;
    for (const scheme of BUILTIN_SCHEMES) {
      for (const map of [scheme.light, scheme.dark]) {
        if (!map) continue;
        maps += 1;
        for (const token of checked) expect(map, `${scheme.id} ${token}`).not.toHaveProperty(token);
        expect(resolveSchemeColors(map), scheme.id).toEqual({ ...deriveAaVariants(map), ...map });
      }
    }
    expect(maps).toBeGreaterThan(0);
  });

  it("falls back to the base-derived value when nudging the pin cannot reach the floor", () => {
    // #ff0000 on a dark card: lightening scales channels, the zero ones never move and red is
    // already at 255, so the nudged pin stays #ff0000 at about 4.1.
    const colors = { "--rag-red": "#e5484d", "--surface-muted": "#1b2024", "--rag-red-text": "#ff0000" };
    expect(contrastRatio("#ff0000", "#1b2024")).toBeLessThan(4.5);
    const out = resolveSchemeColors(colors)["--rag-red-text"];
    expect(out).toBe(deriveAaVariants(colors)["--rag-red-text"]);
    expect(contrastRatio(out, "#1b2024")).toBeGreaterThanOrEqual(4.5);
  });

  it("uses black or white when neither the pin nor a missing base can reach the floor", () => {
    // No --rag-red: the pin is its own base, so the derived fallback is the same failing nudge.
    const out = resolveSchemeColors({ "--surface-muted": "#1b2024", "--rag-red-text": "#ff0000" })["--rag-red-text"];
    expect(out).toBe("#ffffff");
    expect(contrastRatio(out, "#1b2024")).toBeGreaterThanOrEqual(4.5);
  });

  it("holds a pin to its floor even when the scheme leaves out its base colour", () => {
    // No --rag-red at all: the pin is still measured against the card and nudged from itself.
    expect(contrastRatio("#ff9999", "#ffffff")).toBeLessThan(4.5);
    const out = resolveSchemeColors({ "--surface-muted": "#ffffff", "--rag-red-text": "#ff9999" })["--rag-red-text"];
    expect(out).not.toBe("#ff9999");
    expect(contrastRatio(out, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("every shipped importable theme resolves its status text to AA on its card", () => {
    let checked = 0;
    for (const name of ["beacon", "mockup", "petrol"]) {
      const theme = JSON.parse(readFileSync(join(process.cwd(), "public", "themes", `${name}.json`), "utf8")) as { light: Record<string, string>; dark?: Record<string, string>; supportsDark?: boolean };
      for (const map of theme.supportsDark && theme.dark ? [theme.light, theme.dark] : [theme.light]) {
        const card = map["--surface-muted"] ?? map["--surface"];
        const out = resolveSchemeColors(map);
        for (const token of ["--rag-red-text", "--rag-amber-text", "--rag-green-text", "--ui-green-strong", "--ui-pink-strong"]) {
          expect(contrastRatio(out[token], card), `${name} ${token}`).toBeGreaterThanOrEqual(4.5);
          checked += 1;
        }
      }
    }
    // 3 themes × their modes (petrol has dark) × 5 tokens: an empty scan passes nothing.
    expect(checked).toBe(20);
  });
});
