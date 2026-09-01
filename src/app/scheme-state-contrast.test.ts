import { describe, expect, test } from "vitest";
import { BUILTIN_SCHEMES } from "./builtin-schemes";
import { hexToRgb, relLuminance, resolveSchemeColors } from "./scheme-tokens";
import type { SchemeColorMap } from "./scheme-apply";

function ratio(a: string, b: string): number {
  const la = relLuminance(hexToRgb(a));
  const lb = relLuminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Every built-in scheme in every mode it supports. Beacon is light-only, so
// this is 7 combos, not 8 — derived from BUILTIN_SCHEMES rather than listed, so
// a new built-in is covered the day it lands instead of the day someone
// remembers this file.
const COMBOS: { id: string; colors: SchemeColorMap }[] = BUILTIN_SCHEMES.flatMap((s) => [
  { id: `${s.id}-light`, colors: resolveSchemeColors(s.light) },
  ...(s.dark ? [{ id: `${s.id}-dark`, colors: resolveSchemeColors(s.dark) }] : []),
]);

describe("scheme state contrast", () => {
  // ANTI-VACUITY: if BUILTIN_SCHEMES were ever empty or the flatMap broke, every
  // test.each below would silently run zero times and the suite would be green.
  test("enumerates all seven built-in combos", () => {
    expect(COMBOS.map((c) => c.id)).toEqual([
      "harbor-light", "harbor-dark",
      "meridian-light", "meridian-dark",
      "umber-light", "umber-dark",
      "beacon-light",
    ]);
  });

  // SC 1.4.11 — 3:1 for visual information identifying components AND STATES.
  // The pressed border is compared against the UNPRESSED border it replaces.
  test.each(COMBOS)("$id: --control-state-border clears 3:1 against --line", ({ colors }) => {
    expect(ratio(colors["--control-state-border"]!, colors["--line"]!)).toBeGreaterThanOrEqual(3);
  });

  test.each(COMBOS)("$id: --control-state-border-pink clears 3:1 against --line", ({ colors }) => {
    expect(ratio(colors["--control-state-border-pink"]!, colors["--line"]!)).toBeGreaterThanOrEqual(3);
  });

  // The SegmentedControl marker is drawn ON the selected segment, so the colour
  // it must contrast with is that segment's own fill — NOT the track. Measured
  // against the track, --segment-active-fg scores 1.01-1.14 in the light
  // schemes, which is why the track is the wrong reference.
  test.each(COMBOS)("$id: segment marker clears 3:1 against its own fill", ({ colors }) => {
    expect(
      ratio(colors["--segment-active-fg"]!, colors["--segment-active-bg"]!),
    ).toBeGreaterThanOrEqual(3);
  });

  // SC 1.4.3 — 4.5:1 for text, against --surface-muted (the card, and the
  // harder of the two surfaces, which is why deriveAaVariants uses it).
  test.each(COMBOS)("$id: --ui-pink-strong clears 4.5:1 against --surface-muted", ({ colors }) => {
    expect(
      ratio(colors["--ui-pink-strong"]!, colors["--surface-muted"]!),
    ).toBeGreaterThanOrEqual(4.5);
  });

  // Pins the PROPERTY the globals.css fallback relies on: at the AIPM-light
  // base both accents already clear 3:1 against --line, so the derivation
  // returns them UNCHANGED — which is why the CSS may hardcode the raw bases.
  // ★★ It does NOT read globals.css, so it cannot see drift THERE: edit
  //    --control-state-border in the stylesheet alone and this stays green.
  //    What it does catch is the derivation gaining a nudge at this base,
  //    which is what would make those hardcoded values wrong.
  test("globals.css fallbacks match the derivation for the AIPM-light base", () => {
    const derived = resolveSchemeColors({
      "--ui-dark-blue": "#153a5c", "--ui-pink": "#c24a76", "--line": "#dbe2ea",
      "--surface-muted": "#eef2f6",
    } as SchemeColorMap);
    expect(derived["--control-state-border"]).toBe("#153a5c");
    expect(derived["--control-state-border-pink"]).toBe("#c24a76");
  });
});
