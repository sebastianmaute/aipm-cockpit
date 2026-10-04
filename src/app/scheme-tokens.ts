// Editable-token registry for custom color schemes + AA-variant derivation.
// Pure (no DOM). Code-owned built-in schemes (Harbor/Meridian/Umber) live in
// builtin-schemes.ts; Petrol/Mockup ship as importable theme files.
import type { SchemeColorMap } from "./scheme-apply";

// Neutral surface fallback for AA-variant derivation when a scheme omits
// --surface(-muted).
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

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
export function relLuminance([r, g, b]: [number, number, number]): number {
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
// Nudge the base toward `target` contrast against bg (nudgeToAa pins 4.5, the
// AA floor for text; state borders pin 3). Direction is mode-aware:
// a DARK surface (relLuminance < 0.5) LIGHTENS the base toward white; a LIGHT
// surface DARKENS toward black. Dark-on-dark can never reach AA by darkening.
//
// ★★ `lighten` is an explicit OVERRIDE, not a convenience. It defaults to
// `bg`'s own luminance, which is right whenever `bg` IS the surface — but the
// purple variant measures against a TINT composited over the surface, and a 20%
// composite moves luminance far more than 20%. With the direction read off the
// tint while the mode is decided by the surface, the two can disagree: a light
// scheme whose card is mid-grey composites to a tint under 0.5, the loop starts
// LIGHTENING against a light background, runs to its iteration cap and returns
// #ffffff — white text on a light card, ~1.7:1. Both inputs are user-editable
// (ADVANCED_TOKENS), so that is reachable for a custom scheme even though every
// built-in is clear. Whoever decides the mode must also decide the direction.
function nudgeToContrast(
  base: string,
  bg: string,
  target: number,
  lighten = relLuminance(hexToRgb(bg)) < 0.5,
): string {
  const factor = lighten ? 1 / 0.85 : 0.85;
  let [r, g, b] = hexToRgb(base);
  for (let i = 0; i < 20 && ratio(rgbToHex(r, g, b), bg) < target; i++) {
    r = Math.min(255, r * factor);
    g = Math.min(255, g * factor);
    b = Math.min(255, b * factor);
  }
  return rgbToHex(r, g, b);
}

function nudgeToAa(base: string, bg: string, lighten = relLuminance(hexToRgb(bg)) < 0.5): string {
  return nudgeToContrast(base, bg, 4.5, lighten);
}

/** Alpha of the deepest purple tint any `--ui-purple-strong` text sits on: the
 *  RAID "caused this" chips' hover state, which is `hover:bg-ui-purple/20` and
 *  `dark:hover:bg-ui-purple/25`. Mode-aware to MATCH that CSS rather than
 *  applying the stricter dark value to both — over-darkening a light scheme's
 *  purple past what it actually needs is a visible cost for no benefit. Keep in
 *  lockstep with raid-edit-fields.tsx BY HAND: scheme-purple-hover.test.ts
 *  hardcodes its own copy of these alphas and never reads that component, so
 *  changing the chip to hover:bg-ui-purple/30 leaves every test green. */
const PURPLE_TINT_ALPHA_LIGHT = 0.2;
const PURPLE_TINT_ALPHA_DARK = 0.25;

/** Composite a translucent tint over its backdrop — what the browser actually
 *  paints for `bg-ui-purple/25`. */
function compositeOver(fg: string, bg: string, alpha: number): string {
  const F = hexToRgb(fg);
  const B = hexToRgb(bg);
  return rgbToHex(
    F[0] * alpha + B[0] * (1 - alpha),
    F[1] * alpha + B[1] * (1 - alpha),
    F[2] * alpha + B[2] * (1 - alpha),
  );
}

/** One AA-derived token: the scheme colour it starts from, the background it
 *  is measured against, the contrast floor it must clear there, and the nudge
 *  that reaches it. `deriveAaVariants` nudges `base`; `resolveSchemeColors`
 *  holds a scheme's PINNED value to the same `floor` against the same
 *  `reference`, and nudges the PIN when it falls short (open-followups §239).
 *  One list feeds both, so a pin can never be judged against a different
 *  background, or repaired in a different direction, than its derivation. */
interface AaRule {
  token: string;
  base: string;
  reference: string;
  floor: number;
  nudge: (color: string) => string;
}

const AA_TEXT = 4.5;
const STATE_BORDER = 3;

/** A text variant: 4.5 against `reference`. `lighten` is the purple override
 *  described on `nudgeToContrast`; omitted, the mode is read off `reference`. */
function aaTextRule(token: string, base: string, reference: string, lighten?: boolean): AaRule {
  return { token, base, reference, floor: AA_TEXT, nudge: (color) => nudgeToAa(color, reference, lighten) };
}

/** A SC 1.4.11 state border: 3 against `reference` (the `--line` rule). */
function stateBorderRule(token: string, base: string, reference: string): AaRule {
  return { token, base, reference, floor: STATE_BORDER, nudge: (color) => nudgeToContrast(color, reference, STATE_BORDER) };
}

function aaRules(colors: SchemeColorMap): AaRule[] {
  // Derive the -text/-strong variants against --surface-muted when present: it
  // is the "card" background (bg-surface-muted, e.g. Kanban cards) and is always
  // the HARDER of the two (darker than --surface in light schemes, lighter in
  // dark ones), so clearing AA there guarantees AA on the plain --surface too.
  const surface = colors["--surface-muted"] ?? colors["--surface"] ?? FALLBACK_SURFACE;
  const rules: AaRule[] = [];
  // A rule exists whenever its BASE or its PIN does (§239): a pin whose base colour the scheme leaves
  // out is still held to the floor against the same reference, and nudged from itself.
  const baseOr = (base: string, token: string): string | undefined => colors[base] ?? colors[token];
  const greenStrong = baseOr("--ui-green", "--ui-green-strong");
  const pinkStrong = baseOr("--ui-pink", "--ui-pink-strong");
  if (greenStrong) rules.push(aaTextRule("--ui-green-strong", greenStrong, surface));
  if (pinkStrong) rules.push(aaTextRule("--ui-pink-strong", pinkStrong, surface));
  // SC 1.4.11 state borders. Derived here for ToggleButton's dark-blue and pink
  // accents; the third, green, is derived below — see the note there, which is
  // also where the accent set's history lives. §56 measured only the dark-blue
  // one: its pressed border measures 1.03-1.22:1 against --line in the
  // three dark schemes, while the pink accent clears 3:1 in all seven combos
  // (3.04-5.08). Both are derived anyway — for pink the loop exits on its first
  // condition check and returns the base unchanged, so there is no visual change
  // and no cost, but beacon clears the floor by 0.04 and BOTH --ui-pink and
  // --line are user-editable (ADVANCED_TOKENS), so today's pass is a property of
  // the built-in values rather than a guarantee. Deriving makes it structural.
  const line = colors["--line"] ?? surface;
  const darkBlue = baseOr("--ui-dark-blue", "--control-state-border");
  if (darkBlue) {
    rules.push(stateBorderRule("--control-state-border", darkBlue, line));
  }
  const pinkBorder = baseOr("--ui-pink", "--control-state-border-pink");
  if (pinkBorder) {
    rules.push(stateBorderRule("--control-state-border-pink", pinkBorder, line));
  }
  // The accent set is now THREE. Green joined when the dictation mic adopted
  // ToggleButton: its listening cue had been the icon colour alone, and raw
  // --ui-green vs --muted-foreground clears 3:1 in exactly ONE of the seven
  // combos. Keeping the green identity therefore needed a green state border.
  // ★★ Unlike pink, this derivation is NOT a no-op, and it splits by MODE.
  // Raw --ui-green against --line measures 1.53-1.88:1 in the four LIGHT
  // combos (a bright accent on a pale rule) and 4.96-6.90:1 in the three DARK
  // ones. So the loop runs in the light schemes ONLY, landing them at
  // 3.06-3.81, and returns the base unchanged in the dark ones — the mirror of
  // --control-state-border, whose dark-blue fails in the DARK schemes and
  // passes in the light. Green is therefore the one accent whose globals.css
  // fallback is NOT its raw base: see the hardcoded value there.
  const greenBorder = baseOr("--ui-green", "--control-state-border-green");
  if (greenBorder) {
    rules.push(stateBorderRule("--control-state-border-green", greenBorder, line));
  }
  // ★★ --ui-purple-strong is the ONE variant whose reference is NOT the card.
  // Every site that uses it puts it on a PURPLE TINT, not on a plain surface —
  // the RAID "caused this" chips, the chat AI-consent block and the read-only
  // mirror banner are all `bg-ui-purple/10` (the chips deepening to /20 on
  // hover). A tint composited over the card is darker than the card in a light
  // scheme (lighter in a dark one), so deriving against --surface-muted aimed
  // at a background this text never actually sits on, and cleared 4.5 there
  // while landing at 4.22:1 (Meridian light) and 4.35:1 (Umber light) on the
  // hover state. Deriving against the composited tint is not a special case
  // bolted on for one component — it is simply the correct reference for a
  // token with no non-tinted consumers. Held by scheme-purple-hover.test.ts.
  const purple = baseOr("--ui-purple", "--ui-purple-strong");
  if (purple) {
    // ONE mode decision, from the surface, driving BOTH the alpha and the nudge
    // direction. Letting nudgeToAa re-derive direction from the composited tint
    // is what opens the white-on-light-card path described on that function.
    const isDark = relLuminance(hexToRgb(surface)) < 0.5;
    const alpha = isDark ? PURPLE_TINT_ALPHA_DARK : PURPLE_TINT_ALPHA_LIGHT;
    rules.push(aaTextRule("--ui-purple-strong", purple, compositeOver(purple, surface, alpha), isDark));
  }
  for (const [base, token] of [["--rag-red", "--rag-red-text"], ["--rag-amber", "--rag-amber-text"], ["--rag-green", "--rag-green-text"]] as const) {
    const rag = baseOr(base, token);
    if (rag) rules.push(aaTextRule(token, rag, surface));
  }
  return rules;
}

export function deriveAaVariants(colors: SchemeColorMap): SchemeColorMap {
  const out: SchemeColorMap = {};
  for (const rule of aaRules(colors)) out[rule.token] = rule.nudge(rule.base);
  // Not an AA derivation: a plain copy of the text colour, so it has no floor
  // and a pinned value always wins in resolveSchemeColors.
  if (colors["--foreground"]) out["--muted-foreground"] = colors["--foreground"];
  return out;
}

export function resolveSchemeColors(colors: SchemeColorMap): SchemeColorMap {
  // Base-wins, held to the floor (open-followups §239). Derivation FILLS the
  // AA variants a scheme omits, and a pinned value is kept so an imported
  // portable theme (Petrol/Mockup/Beacon) keeps its exact look — but only while
  // it clears the floor its own derivation targets, against the same reference.
  // A pin below it (a hand-edited import, a shipped theme's hand-tuned value,
  // or a base colour edited after the pin was copied) is NUDGED to the floor
  // rather than replaced: its hue is the theme's choice (Petrol's amber text is
  // purple), so only its lightness moves — owner-accepted 2026-10-04. A nudge
  // scales channels, so it cannot always get there (a zero channel never moves,
  // and a channel at 255 cannot rise): when the nudged pin still falls short,
  // the value derived from the base is used, as for a scheme with no pin.
  // `--muted-foreground` has no floor, so its pin always wins.
  const out: SchemeColorMap = { ...deriveAaVariants(colors), ...colors };
  for (const rule of aaRules(colors)) {
    const pin = colors[rule.token];
    if (pin === undefined || ratio(pin, rule.reference) >= rule.floor) continue;
    const nudged = rule.nudge(pin);
    out[rule.token] = ratio(nudged, rule.reference) >= rule.floor ? nudged : rule.nudge(rule.base);
  }
  return out;
}
