// Per-scheme guard for the NON-TEXT state cue used by the dropdown listboxes
// (entity-link-picker, global-search-box): the active/highlighted row is marked
// by `bg-surface-muted` + `font-medium` + `ring-1 ring-inset ring-foreground`.
//
// ★★ Why this file exists rather than a class assertion in the component tests:
// those pin WHICH token is used, which is necessary but says nothing about
// whether the token is actually visible. The first attempt at this cue used
// `ring-ui-green`, which measures 6.0-7.9:1 on the dark row fills and only
// 1.7-2.1:1 on the light ones — a state indicator that effectively vanishes in
// five of the nine shipped combos, with every unit test green. A ratio is the
// only thing that catches that.
//
// ★ WCAG 1.4.11 (non-text contrast) asks 3:1 of a visual state indicator, which
// is the bar used here — this is a ring identifying which option is active, not
// text.
//
// ★★ A second reason for the sweep: the comment justifying the fix originally
// claimed `--foreground` was "12-15:1 in every shipped scheme by construction".
// That is false — AIPM and Mockup light use a mid-grey `#636362` foreground and
// land at 4.79:1. The conclusion survived, the number did not, and nothing in
// the suite could tell the difference. It can now.
import { describe, expect, it } from "vitest";
import { BUILTIN_SCHEMES } from "./builtin-schemes";
import { hexToRgb, resolveSchemeColors } from "./scheme-tokens";
import type { SchemeColorMap } from "./scheme-apply";

/** WCAG relative luminance. Deliberately a second implementation rather than an
 *  import — a guard that reuses the code it checks can only ever agree with it. */
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

/** WCAG 1.4.11 floor for a non-text state indicator. */
const NON_TEXT_AA = 3;

function assertRingVisible(label: string, raw: SchemeColorMap) {
  const resolved = resolveSchemeColors(raw);
  const ring = resolved["--foreground"];
  // The active row's own fill — what the inset ring is drawn against.
  const fill = resolved["--surface-muted"] ?? resolved["--surface"];
  expect(ring, `${label}: --foreground`).toBeTruthy();
  expect(fill, `${label}: --surface-muted`).toBeTruthy();
  const ratio = contrast(ring, fill);
  expect(
    ratio,
    `${label}: ring --foreground ${ring} on active row ${fill} is ${ratio.toFixed(2)}:1`,
  ).toBeGreaterThanOrEqual(NON_TEXT_AA);
}

describe("dropdown active-row ring is visible in every shipped scheme", () => {
  for (const scheme of BUILTIN_SCHEMES) {
    it(`${scheme.name} light`, () => assertRingVisible(`${scheme.id} light`, scheme.light));
    const dark = scheme.dark;
    if (dark) it(`${scheme.name} dark`, () => assertRingVisible(`${scheme.id} dark`, dark));
  }

  // The rejected alternative, kept as an executable record of WHY. If someone
  // reaches for a brand accent again, this documents what it costs.
  it("rejects a brand accent as the cue: --ui-green fails the same bar in light schemes", () => {
    const failures: string[] = [];
    for (const scheme of BUILTIN_SCHEMES) {
      const light = resolveSchemeColors(scheme.light);
      const r = contrast(light["--ui-green"], light["--surface-muted"]);
      if (r < NON_TEXT_AA) failures.push(`${scheme.id}=${r.toFixed(2)}`);
    }
    // All three built-in light schemes must appear — if this ever comes back
    // empty, the premise changed and the comment in entity-link-picker.tsx
    // explaining the choice needs rewriting rather than quietly rotting.
    expect(failures).toHaveLength(BUILTIN_SCHEMES.length);
  });
});
