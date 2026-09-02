import { readFileSync } from "node:fs";
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

  test.each(COMBOS)("$id: --control-state-border-green clears 3:1 against --line", ({ colors }) => {
    expect(ratio(colors["--control-state-border-green"]!, colors["--line"]!)).toBeGreaterThanOrEqual(3);
  });

  // The SegmentedControl marker is drawn ON the selected segment, so the colour
  // it must contrast with is that segment's own fill — NOT the track.
  // ★★ The reference to measure against is decided by WHICH FILL the glyph sits
  //    on, never by light-vs-dark. Against the TRACK, --segment-active-fg scores
  //    1.12 harbor-light / 1.14 meridian-light / 1.01 umber-light — those three
  //    pair a DARK active fill with near-white text, so the text all but
  //    disappears into a light track. beacon-light INVERTS that pair (a white
  //    fill with dark-green text) and scores 4.76 against the same track, so
  //    "the light schemes" is the wrong population and beacon is the one a fresh
  //    install runs (DEFAULT_SCHEME_ID). Its 4.76 is incidental, not a design
  //    property: the track is still the wrong reference, the assertion below
  //    still measures against the fill. (Reproduce by mapping COMBOS through
  //    ratio(--segment-active-fg, --segment-track-bg); the dark schemes land at
  //    13.10-14.12.)
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

  // A real DIFFERENTIAL between the stylesheet and the derivation: BOTH sides
  // are read out of globals.css, so neither an edit to a base nor an edit to a
  // fallback can slip past. The pre-boot / no-JS paint is the one path with no
  // runtime derivation behind it — scheme-apply.ts overrides these three inline
  // per scheme AND mode once JS runs, so this static block is all a user gets
  // until then.
  // ★★ The three fallbacks are NOT uniform, which is the whole reason a guard
  //    is wanted: at the AIPM-light base dark-blue and pink already clear 3:1
  //    against --line, so the derivation returns them UNCHANGED and the CSS
  //    hardcodes the raw bases — but raw --ui-green does NOT clear it, so
  //    nudgeToContrast runs and the CSS must hardcode the NUDGED value. Copying
  //    the pattern from the first two onto the third is the trap.
  // ★★ WHAT THIS STILL CANNOT SEE, so do not read it as more than it is:
  //    it never loads the stylesheet in a browser, so it does not prove the
  //    CASCADE applies these fallbacks (a later rule, a wrong selector, or a
  //    :root override elsewhere would defeat them and this stays green). It
  //    proves only that the VALUES in globals.css agree with the derivation and
  //    clear the 1.4.11 floor. It is also blind to any declaration its own
  //    regex cannot see — hence the exactly-one assertion in cssHex, without
  //    which a broken pattern would compare zero pairs and pass.
  test("globals.css --control-state-border* fallbacks match the derivation", () => {
    // Cwd-relative, NOT `new URL(..., import.meta.url)` — under vitest
    // `import.meta.url` is not a file: URL, so readFileSync throws (the same
    // reason document-model.test.ts reads its own source this way).
    const css = readFileSync("src/app/globals.css", "utf8");
    const cssHex = (token: string): string => {
      const found = [
        ...css.matchAll(new RegExp(String.raw`^[ \t]*${token}:[ \t]*(#[0-9a-fA-F]{3,8})[ \t]*;`, "gm")),
      ].map((m) => m[1]!.toLowerCase());
      // ANTI-VACUITY: zero matches (a renamed token, a reformatted declaration,
      // a value moved behind a var()) or several (an ambiguous "the" value) must
      // fail LOUDLY here rather than silently compare nothing below.
      expect(found, `expected exactly one \`${token}:\` hex declaration in globals.css`).toHaveLength(1);
      return found[0]!;
    };

    const derived = resolveSchemeColors({
      "--ui-dark-blue": cssHex("--ui-dark-blue"), "--ui-pink": cssHex("--ui-pink"),
      "--line": cssHex("--line"), "--ui-green": cssHex("--ui-green"),
      "--surface-muted": cssHex("--surface-muted"),
    } as SchemeColorMap);
    // resolveSchemeColors is base-wins, so the five inputs above deliberately
    // EXCLUDE the three --control-state-border* tokens: feeding them in would
    // make the comparison compare each parsed value with itself.
    for (const token of ["--control-state-border", "--control-state-border-pink", "--control-state-border-green"]) {
      expect(cssHex(token), token).toBe(derived[token]);
      expect(ratio(cssHex(token), cssHex("--line")), token).toBeGreaterThanOrEqual(3);
    }
  });
});
