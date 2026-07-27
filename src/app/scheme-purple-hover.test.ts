// Guard for the translucent-tint-on-HOVER contrast trap, pinned on the one
// token that actually fell into it.
//
// The RAID "caused this" chips (raid-edit-fields.tsx) draw `--ui-purple-strong`
// text on `bg-ui-purple/10`, and the hover state deepens that tint to
// `bg-ui-purple/20` (`/15`→`/25` in dark). `deriveAaVariants` nudges
// `--ui-purple-strong` to clear AA against `--surface-muted`, which is NOT the
// darkest background this text ever sits on — so the derived value could sit
// exactly at the 4.5 threshold at rest and drop under it on hover. It did:
// Meridian light 4.22:1 and Umber light 4.35:1.
//
// ★★ The axe gate cannot catch this, and no amount of view coverage would: axe
// scans the RESTING state only, and these chips live inside an edit modal the
// gate never opens. This test is the only automated coverage that exists.
//
// ★ A repo-wide sweep for the same shape (any `-strong`/`-text` token on a line
// that also changes its background on hover) found 16 sites; the other 15 are
// the `ui-pink-strong` family and clear AA in every built-in combo, worst case
// 4.71:1. Hence one token, not a family.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILTIN_SCHEMES, HARBOR_LIGHT } from "./builtin-schemes";
import { hexToRgb, resolveSchemeColors } from "./scheme-tokens";
import type { SchemeColorMap } from "./scheme-apply";

/** WCAG relative luminance. Mirrors scheme-tokens' private copy — duplicated
 *  deliberately: a guard that reuses the implementation it is checking can only
 *  ever agree with it. */
function relLuminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number {
  const la = relLuminance(hexToRgb(a));
  const lb = relLuminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** What the browser actually paints for `bg-ui-purple/<alpha>` over the card:
 *  a translucent tint composited onto the surface beneath it. */
function composite(fg: string, bg: string, alpha: number): string {
  const F = hexToRgb(fg);
  const B = hexToRgb(bg);
  const mix = (i: number) => Math.round(F[i] * alpha + B[i] * (1 - alpha));
  return `#${[0, 1, 2].map((i) => mix(i).toString(16).padStart(2, "0")).join("")}`;
}

/** The alphas raid-edit-fields uses on hover — the deepest tint the text sits
 *  on. Keep in lockstep with that className. */
const HOVER_ALPHA_LIGHT = 0.2;
const HOVER_ALPHA_DARK = 0.25;

function assertPurpleHoverAa(label: string, raw: SchemeColorMap, isDark: boolean) {
  const resolved = resolveSchemeColors(raw);
  const purple = resolved["--ui-purple"];
  const strong = resolved["--ui-purple-strong"];
  // ★★ `--surface-muted` — the SAME reference `deriveAaVariants` uses, not the
  // plain `--surface` the RAID modal happens to sit on. Two reasons:
  // (1) a guard composited over a LIGHTER backdrop than the code targets is
  //     looser than the code, so reverting the derivation would slip through in
  //     4 of the 6 built-in combos (only Meridian and Umber light would fail);
  //     over the card it catches all six (4.15/4.40/3.76/4.13/3.77/4.11).
  // (2) it is the harder of the two backdrops, so clearing AA here guarantees
  //     it on `--surface` as well — the module's existing rule for every other
  //     AA variant, and what makes the token safe if one of these chips is ever
  //     placed on a muted card.
  const surface = resolved["--surface-muted"] ?? resolved["--surface"];
  expect(purple, `${label}: --ui-purple`).toBeTruthy();
  expect(strong, `${label}: --ui-purple-strong`).toBeTruthy();
  expect(surface, `${label}: --surface-muted`).toBeTruthy();

  const hoverBg = composite(purple, surface, isDark ? HOVER_ALPHA_DARK : HOVER_ALPHA_LIGHT);
  const ratio = contrast(strong, hoverBg);
  expect(
    ratio,
    `${label}: --ui-purple-strong ${strong} on hover tint ${hoverBg} is ${ratio.toFixed(2)}:1`,
  ).toBeGreaterThanOrEqual(4.5);
}

// ★★ The built-in sweep below cannot reach this: every shipped surface is
// either clearly light or clearly dark, so the tint never lands on the wrong
// side of the direction threshold. A USER scheme can — both `--surface-muted`
// and `--ui-purple` are editable, and user schemes are light-only this phase,
// which is the vulnerable mode. Deriving the nudge direction from the composited
// TINT rather than the surface made a mid-grey card produce #ffffff (white text
// on a light card, ~1.7:1) because the loop lightened until it hit its cap.
describe("--ui-purple-strong derivation is mode-stable for custom schemes", () => {
  for (const cardHex of ["#c8c8c8", "#c0c0c0", "#bfbfbf"]) {
    it(`stays dark on a mid-grey card (${cardHex})`, () => {
      const resolved = resolveSchemeColors({
        "--surface": "#ffffff",
        "--surface-muted": cardHex,
        "--ui-purple": "#aa4899",
        "--foreground": "#1a1a1a",
      });
      const strong = resolved["--ui-purple-strong"];
      expect(strong).not.toBe("#ffffff");
      // The real requirement: it must still be legible on the card it was
      // derived against, whichever direction the nudge chose.
      const onCard = contrast(strong, cardHex);
      expect(onCard, `${strong} on ${cardHex} is ${onCard.toFixed(2)}:1`).toBeGreaterThan(3);
    });
  }
});

// globals.css `:root` is the static no-JS / pre-boot fallback, hand-written to
// match what the default scheme derives. Nothing else keeps the two in step:
// `style-tokens.test.ts` pins the `--rag-*-text` family but not this token, so
// the value was free to drift the moment the derivation changed — which it just
// did.
it("globals.css :root fallback matches the Harbor-light derivation", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const match = /--ui-purple-strong:\s*(#[0-9a-fA-F]{6})/.exec(css);
  expect(match, "globals.css declares --ui-purple-strong").toBeTruthy();
  const derived = resolveSchemeColors(HARBOR_LIGHT)["--ui-purple-strong"];
  expect(match![1].toLowerCase()).toBe(derived.toLowerCase());
});

describe("--ui-purple-strong clears AA on the deepened hover tint", () => {
  for (const scheme of BUILTIN_SCHEMES) {
    it(`${scheme.name} light`, () => assertPurpleHoverAa(`${scheme.id} light`, scheme.light, false));
    const dark = scheme.dark;
    if (dark) {
      it(`${scheme.name} dark`, () => assertPurpleHoverAa(`${scheme.id} dark`, dark, true));
    }
  }

  // AIPM and Mockup left the code built-ins and ship as importable theme files,
  // so they are not in BUILTIN_SCHEMES — but a user who imports one from the
  // theme gallery is running it, and it must hold to the same bar.
  for (const file of ["AIPM", "mockup"]) {
    it(`${file}.json`, () => {
      const theme = JSON.parse(readFileSync(`public/themes/${file}.json`, "utf8")) as {
        light?: SchemeColorMap;
        dark?: SchemeColorMap;
      };
      expect(theme.light, `${file}.json has a light map`).toBeTruthy();
      assertPurpleHoverAa(`${file} light`, theme.light!, false);
      if (theme.dark) assertPurpleHoverAa(`${file} dark`, theme.dark, true);
    });
  }
});
