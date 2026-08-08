import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { sanitizeText, sanitizeMultiline, sanitizeVoiceTranscript, sanitizeLabel } from "./sanitize";

// ★★ The defect these properties pin (open-followups §22): `clipText` truncated
// on UTF-16 CODE UNITS, so a cap landing inside an astral character kept a LONE
// HIGH SURROGATE — U+FFFD on the CSV/Markdown backends, intact on JSON/IndexedDB
// (JSON.stringify escapes it as "\ud83d"). A `fc.string()` almost never contains
// an astral character, so a plain-string arbitrary would make every assertion
// below VACUOUS: it would pass against the unfixed code. Every arbitrary here is
// astral-heavy on purpose, and the lone-surrogate property counts how often the
// cut actually landed mid-pair.

/** True when `s` holds a high surrogate not followed by a low one, or a low
 *  surrogate not preceded by a high one — i.e. a code unit that is not part of
 *  a character and cannot survive UTF-8 encoding. */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : -1;
      if (next < 0xdc00 || next > 0xdfff) return true;
      i++; // consume the well-formed pair
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true; // low surrogate with no high before it
    }
  }
  return false;
}

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;

// Astral (2 code units each) mixed with BMP singles, weighted 3:1 towards astral
// so cuts land mid-pair often. Deliberately whitespace-free: `sanitizeText`
// trims first, and a leading/trailing space would move the cut index away from
// the one the properties reason about.
const astralCharArb = fc
  .integer({ min: 0x10000, max: 0x10ffff })
  .map((cp) => String.fromCodePoint(cp));
const bmpCharArb = fc.constantFrom("a", "Z", "7", "ä", "中", "€");
const charArb = fc.oneof(
  { weight: 3, arbitrary: astralCharArb },
  { weight: 1, arbitrary: bmpCharArb },
);

/** A well-formed astral-heavy string paired with a cap inside its own length,
 *  so the truncation branch is reached on nearly every run. The cap is RANDOM
 *  here, which buys breadth (clean cuts, no-op cuts, boundary cuts) but cannot
 *  guarantee a mid-pair one — see `midPairCutArb`. */
const strAndMaxArb = fc
  .array(charArb, { minLength: 2, maxLength: 40 })
  .map((chars) => chars.join(""))
  .chain((s) => fc.tuple(fc.constant(s), fc.integer({ min: 0, max: s.length })));

/** A cut that PROVABLY lands inside a surrogate pair. The cap is placed at
 *  `head.length + 1` — exactly ONE code unit into the astral character that
 *  follows `head` — so `charCodeAt(max - 1)` is that character's HIGH surrogate
 *  on every run, and `s.length > max` holds because the astral character alone
 *  contributes a second code unit.
 *
 *  ★★ This exists because the anti-vacuity counter must not be seed-dependent.
 *  fast-check reseeds every run, and with the RANDOM cap of `strAndMaxArb` the
 *  measured hit count over 30 runs was 12/10/10/8/10 across five fixed seeds —
 *  a floor set from one lucky observation would go spuriously red on an unlucky
 *  one, and an intermittently-failing property suite gets deleted or skipped by
 *  whoever hits it, costing the fix its only guard. Constructing the mid-pair
 *  cut instead makes the count 30/30 on every seed. */
const midPairCutArb = fc
  .tuple(
    fc.array(charArb, { maxLength: 12 }),
    astralCharArb,
    fc.array(charArb, { maxLength: 12 }),
  )
  .map(([prefix, astral, suffix]) => {
    const head = prefix.join("");
    return [head + astral + suffix.join(""), head.length + 1] as const;
  });

describe("sanitize-core clipText — properties", () => {
  test("never emits a lone surrogate when the cap provably cuts mid-pair", () => {
    let exercised = 0;
    fc.assert(
      fc.property(midPairCutArb, ([s, max]) => {
        // The defect condition: the value is over cap AND the last kept code
        // unit is a high surrogate. Without the fix the output ends on it.
        // `midPairCutArb` makes this true by construction, so the counter below
        // reads 30/30 — but keep it CONDITIONAL, so that if the arbitrary ever
        // regresses the counter drops and the floor catches it. Asserting the
        // condition instead would turn a silent vacuity into a noisy failure of
        // a different property, which is harder to read.
        if (s.length > max && max > 0 && isHighSurrogate(s.charCodeAt(max - 1))) exercised++;

        expect(hasLoneSurrogate(s)).toBe(false); // the input itself is well-formed
        expect(hasLoneSurrogate(sanitizeMultiline(s, max))).toBe(false);
        expect(hasLoneSurrogate(sanitizeText(s, max))).toBe(false);
        return true;
      }),
      { numRuns: 30 },
    );
    // Floor at half the (constructed, seed-independent) 30/30 count. Without
    // this the whole suite would pass against the unfixed `s.slice(0, max)`.
    expect(exercised).toBeGreaterThanOrEqual(15);
  });

  test("never emits a lone surrogate for an arbitrary cap", () => {
    // Breadth companion to the property above: a RANDOM cap, so most runs cut
    // cleanly or not at all. No anti-vacuity counter — `midPairCutArb` carries
    // that claim; this one exists so the clean-cut and no-op paths are covered.
    fc.assert(
      fc.property(strAndMaxArb, ([s, max]) => {
        expect(hasLoneSurrogate(s)).toBe(false);
        expect(hasLoneSurrogate(sanitizeMultiline(s, max))).toBe(false);
        expect(hasLoneSurrogate(sanitizeText(s, max))).toBe(false);
        return true;
      }),
      { numRuns: 30 },
    );
  });

  test("the length cap still holds — backing off must not push the output over", () => {
    fc.assert(
      fc.property(strAndMaxArb, ([s, max]) => {
        expect(sanitizeMultiline(s, max).length).toBeLessThanOrEqual(max);
        expect(sanitizeText(s, max).length).toBeLessThanOrEqual(max);
        return true;
      }),
      { numRuns: 30 },
    );
  });

  test("a value under the cap is returned unchanged (modulo sanitizeText's trim)", () => {
    fc.assert(
      fc.property(strAndMaxArb, ([s, max]) => {
        expect(sanitizeMultiline(s, s.length + max)).toBe(s);
        expect(sanitizeText(s, s.length + max)).toBe(s.trim());
        return true;
      }),
      { numRuns: 30 },
    );
  });

  test("at most ONE extra code unit is lost to the surrogate back-off", () => {
    fc.assert(
      fc.property(strAndMaxArb, ([s, max]) => {
        const kept = Math.min(s.length, max);
        // >= kept - 1: the fix may drop one unit, never two.
        expect(sanitizeMultiline(s, max).length).toBeGreaterThanOrEqual(kept - 1);
        return true;
      }),
      { numRuns: 30 },
    );
  });

  test("non-string input yields \"\" and never throws", () => {
    fc.assert(
      fc.property(
        fc.anything().filter((v) => typeof v !== "string"),
        fc.integer({ min: -5, max: 50 }),
        (v, max) => {
          expect(sanitizeText(v, max)).toBe("");
          expect(sanitizeMultiline(v, max)).toBe("");
          return true;
        },
      ),
      { numRuns: 30 },
    );
  });

  test("max <= 0 yields \"\" and never throws", () => {
    fc.assert(
      fc.property(strAndMaxArb, fc.integer({ min: -10, max: 0 }), ([s], max) => {
        // ★★ Asserted, not reasoned about — and the reasoning WOULD have been
        // wrong. At max === 0 the back-off is inert on its own (charCodeAt(-1)
        // is NaN, NaN fails every comparison) and slice(0, 0) is "". At a
        // NEGATIVE max it is not: slice's end index counts from the END, so
        // slice(0, -1) returns nearly the whole string and can end on a lone
        // surrogate. This property caught that; clipText clamps max <= 0.
        expect(sanitizeMultiline(s, max)).toBe("");
        expect(sanitizeText(s, max)).toBe("");
        return true;
      }),
      { numRuns: 30 },
    );
  });

  test("sanitizeVoiceTranscript (which reaches clipText directly) never emits a lone surrogate", () => {
    let exercised = 0;
    // VOICE_TRANSCRIPT_MAX is 1000 and not exported. A pure-astral string always
    // cuts cleanly at an even index, so vary a BMP prefix to flip the parity and
    // land the cut mid-pair.
    const transcriptArb = fc
      .tuple(fc.integer({ min: 0, max: 5 }), fc.array(astralCharArb, { minLength: 600, maxLength: 700 }))
      .map(([prefix, chars]) => "a".repeat(prefix) + chars.join(""));
    fc.assert(
      fc.property(transcriptArb, (s) => {
        if (s.length > 1000 && isHighSurrogate(s.charCodeAt(999))) exercised++;
        expect(hasLoneSurrogate(s)).toBe(false);
        const out = sanitizeVoiceTranscript(s);
        expect(hasLoneSurrogate(out)).toBe(false);
        expect(out.length).toBeLessThanOrEqual(1000);
        return true;
      }),
      { numRuns: 30 },
    );
    // ★ Floor deliberately left LOW rather than constructed like the property
    // above, because this arbitrary is already stable: measured 13/20/16/19/19
    // mid-pair hits over 30 runs across five fixed seeds (1, 2, 7, 12345,
    // 999983). The parity argument is why — a BMP prefix of 0..5 chars shifts
    // the astral run by one code unit, so roughly half of all prefixes put a
    // HIGH surrogate at index 999, and the astral body is long enough that the
    // cut always lands inside it.
    expect(exercised).toBeGreaterThanOrEqual(3);
  });

  // ★★★ THIS PROPERTY EXISTS BECAUSE FIXING `clipText` ALONE DID NOT CLOSE THE
  // DEFECT CLASS IN THIS FILE. `sanitizeLabel` truncated with a RAW
  // `.trim().slice(0, LABEL_MAX)` — 100 lines below the fix, bypassing
  // `clipText` entirely — and returned a lone high surrogate for a label ending
  // in an emoji at the boundary. A cold review found it AFTER §22 was marked
  // closed, which is the whole lesson: closing an entry named after ONE function
  // says nothing about its siblings, and "the fix reaches 54 call sites" was true
  // and still left this one out, because it was never one of the 54.
  // ★ `describeLabelStrip` (sanitize-report.ts) is the same code by contract —
  // its docstring says "Mirror sanitizeLabel" — and is covered by its own test.
  test("sanitizeLabel never emits a lone surrogate at the cap boundary", () => {
    let exercised = 0;
    // LABEL_MAX is 50 and not exported here. Vary a BMP prefix to flip parity so
    // the cut lands mid-pair, exactly as the transcript arbitrary above does.
    const labelArb = fc
      .tuple(fc.integer({ min: 0, max: 5 }), fc.array(astralCharArb, { minLength: 30, maxLength: 40 }))
      .map(([prefix, chars]) => "a".repeat(prefix) + chars.join(""));
    fc.assert(
      fc.property(labelArb, (s) => {
        if (s.length > 50 && isHighSurrogate(s.charCodeAt(49))) exercised++;
        expect(hasLoneSurrogate(s)).toBe(false); // control: the INPUT is well-formed
        const out = sanitizeLabel(s);
        expect(hasLoneSurrogate(out)).toBe(false);
        expect(out.length).toBeLessThanOrEqual(50);
        return true;
      }),
      { numRuns: 30 },
    );
    expect(exercised).toBeGreaterThanOrEqual(3);
  });
});
