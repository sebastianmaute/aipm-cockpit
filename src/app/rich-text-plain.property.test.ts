import { describe, expect, test } from "vitest";
import fc from "fast-check";
import {
  separateBlockBoundaries,
  descriptionHtml,
  htmlPlainProjection,
  htmlTextLength,
  capHtmlText,
  sanitizeRichText,
} from "./rich-text-plain";

// ---------------------------------------------------------------------------
// Arbitraries
//
// This module is the DOM-FREE half of the rich-text layer and feeds
// sanitizeRichText -> all six storage backends, so every defect it has had was
// a silent DATA-INTEGRITY defect rather than a crash. The generators below are
// therefore built from the shapes that actually reach it — editor markup, an
// Office paste's numeric references, astral characters, stray control bytes —
// rather than from generic random strings, which would almost never produce a
// `&amp;lt;` or land a cap inside a surrogate pair.
// ---------------------------------------------------------------------------

/** Literal characters: ASCII, whitespace (incl. TAB and NEWLINE, which the two
 *  projection modes treat DIFFERENTLY), HTML metacharacters, NBSP, control
 *  bytes, and astral characters whose UTF-16 encoding is a surrogate PAIR. */
const TEXT_UNITS = [
  "a",
  "b",
  "Z",
  "7",
  " ",
  "\t",
  "\n",
  "\r",
  "&",
  "<",
  ">",
  '"',
  "'",
  " ",
  "\x00",
  "\x07",
  "\x1f",
  "é",
  "漢",
  "😀",
  "𝄞",
];

/** Entity spellings that matter to a specific rule in the module:
 *  - `&amp;lt;` is the double-decode shape (`&amp;` MUST decode last).
 *  - `&#38;` IS `&`, so decoding it early recreates the same double-decode.
 *  - `&#7;` / `&#x1f;` are control characters a numeric reference must refuse
 *    to reintroduce downstream of the raw control strip.
 *  - `&#xd800;` is a lone surrogate a reference must refuse to emit. */
const ENTITY_UNITS = [
  "&amp;",
  "&lt;",
  "&gt;",
  "&quot;",
  "&#39;",
  "&apos;",
  "&nbsp;",
  "&#160;",
  "&#x0a0;",
  "&#8212;",
  "&#x2014;",
  "&amp;lt;",
  "&#38;",
  "&#7;",
  "&#0;",
  "&#x1f;",
  "&#10;",
  "&#127;",
  "&#xd800;",
];

/** Markup: block tags (word BOUNDARIES — they project to a separator), inline
 *  tags (project to nothing), and two malformed openers, since `<` followed by
 *  a non-letter is literal text and an UNTERMINATED tag must not be mistaken
 *  for HTML by descriptionHtml. */
const TAG_UNITS = [
  "<p>",
  "</p>",
  "<br>",
  "<div>",
  "</div>",
  "<li>",
  "</li>",
  "<ul>",
  "</ul>",
  "<h1>",
  "</h1>",
  "<strong>",
  "</strong>",
  "<em>",
  "</em>",
  '<span class="x">',
  "</span>",
  "<p ",
  "< 5k",
];

const fromUnits = (units: readonly string[], maxLength: number) =>
  fc.array(fc.constantFrom(...units), { maxLength }).map((parts) => parts.join(""));

/** Realistic stored/editor values: a mixture of all three unit families. */
const htmlishArb = fc
  .array(
    fc.oneof(
      { weight: 4, arbitrary: fc.constantFrom(...TEXT_UNITS) },
      { weight: 2, arbitrary: fc.constantFrom(...TAG_UNITS) },
      { weight: 2, arbitrary: fc.constantFrom(...ENTITY_UNITS) },
    ),
    { maxLength: 40 },
  )
  .map((parts) => parts.join(""));

/** Alphanumeric words — no whitespace, no markup, no entities — so an assertion
 *  about what sits BETWEEN two of them is unambiguous. */
const wordArb = fromUnits(
  ["a", "b", "c", "X", "Y", "0", "1", "9"],
  10,
).filter((w) => w.length > 0);

/** Astral-heavy, and by construction free of LONE surrogates: every astral unit
 *  contributes a complete pair. Only well-formed input can test the back-off,
 *  because capHtmlText cannot repair a lone surrogate the CALLER supplied — it
 *  only promises never to CREATE one. */
const astralArb = fc
  .array(fc.constantFrom("😀", "𝄞", "🜲", "𠜎", "a", "b"), { minLength: 14, maxLength: 30 })
  // The minimum length is load-bearing: fast-check biases hard toward small
  // arrays, and with no floor most runs produced text SHORTER than the cap, so
  // the truncation the property exists to test never ran (the exercised counter
  // caught exactly that — it read 5 of 50).
  .map((parts) => parts.join(""));

/** htmlish content with a block boundary GUARANTEED to survive into the
 *  projection: a non-empty word at each end, so neither `trim()` nor a collapse
 *  can eat the interior separator, and a rich htmlish middle on both sides of it
 *  so the property still covers entity/whitespace/tag interaction rather than a
 *  toy shape. Built because relying on the generator to happen to emit a block
 *  tag made the anti-vacuity counter seed-dependent. */
const boundedBoundaryArb = fc
  .tuple(
    wordArb,
    htmlishArb,
    fc.constantFrom("<p>", "</p>", "<br>", "<div>", "<li>"),
    htmlishArb,
    wordArb,
  )
  .map((parts) => parts.join(""));

/** A high surrogate not followed by a low one, or a low not preceded by a high.
 *  Such a code unit is not a character: encoding it to UTF-8 replaces it with
 *  U+FFFD permanently, which is why CSV and Markdown corrupted while JSON and
 *  IndexedDB (whose escapes survive it) did not — a backend-DEPENDENT loss. */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : -1;
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1; // consume the low half of a well-formed pair
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** A control character CONTROL_CHARS is supposed to have DELETED. Written as a
 *  code-point scan rather than the mirror-image regex on purpose: the literal
 *  form needs an `eslint-disable no-control-regex` directive, which is silently
 *  correct only while that rule stays enabled — if it were ever turned off the
 *  directive becomes UNUSED, and CI's `--max-warnings=0` turns that into a
 *  failure in a file that has nothing wrong with it. The scan depends on no rule
 *  configuration at all.
 *
 *  ★ The range MIRRORS CONTROL_CHARS exactly and deliberately: \t \n \r \x0b
 *  \x0c are whitespace the module keeps (collapsing them to a space), and DEL
 *  (0x7f) sits outside both the strip and the numeric-reference refusal. */
function hasStrippedControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c <= 0x08 || (c >= 0x0e && c <= 0x1f)) return true;
  }
  return false;
}

describe("rich-text-plain — properties", () => {
  // -------------------------------------------------------------------------
  // capHtmlText
  // -------------------------------------------------------------------------

  test("capHtmlText never returns more visible text than the cap allows", () => {
    fc.assert(
      fc.property(htmlishArb, fc.integer({ min: 0, max: 120 }), (html, max) => {
        // The overflow path does NOT return the truncated text — it re-wraps it
        // through plainToHtml, which ESCAPES & < >. If that escape were ever
        // counted as visible text the stored value would exceed the cap the
        // editor's counter promised, so the invariant has to be stated on the
        // RE-PROJECTED result, not on the slice.
        expect(htmlTextLength(capHtmlText(html, max))).toBeLessThanOrEqual(max);
      }),
      { numRuns: 50 },
    );
  });

  test("capHtmlText is the identity — markup and all — while under the cap", () => {
    let exercised = 0;
    fc.assert(
      fc.property(htmlishArb, fc.integer({ min: 0, max: 200 }), (html, max) => {
        // Formatting is lost ONLY on overflow. A cap that silently flattened
        // an under-budget value would strip every user's bold/lists on save.
        fc.pre(htmlTextLength(html) <= max);
        // A precondition that filtered almost everything out would leave this
        // green while testing nothing, so count what survives it. The empty
        // string satisfies the assertion trivially (capHtmlText short-circuits
        // on falsy input), hence the extra non-empty requirement.
        if (html.length > 0) exercised += 1;
        expect(capHtmlText(html, max)).toBe(html);
      }),
      { numRuns: 50 },
    );
    expect(exercised).toBeGreaterThan(15);
  });

  // ★★ THE `min` USED TO BE 1, WHICH MADE THE PROPERTY UNABLE TO REACH THE CASE
  // WHERE ITS OWN NAME WAS FALSE. `capHtmlText(html, -1)` returned
  // "<p>a\ud800</p>" — a lone surrogate — because at a negative max `cut`
  // becomes `max` and `slice`'s end index counts from the END. A cold review
  // found it; the property said "never" while its generator excluded the only
  // inputs that disproved it. The range now spans negatives, so the assertion
  // covers the range the name claims.
  test("capHtmlText never emits a lone surrogate", () => {
    let exercised = 0;
    fc.assert(
      fc.property(astralArb, fc.integer({ min: -4, max: 13 }), (html, max) => {
        const text = htmlPlainProjection(html);
        const head = text.charCodeAt(max - 1);
        // The interesting case is the cut landing INSIDE a surrogate pair; a
        // run that never truncates proves nothing about the back-off, so count
        // only the runs that actually reach it.
        if (text.length > max && head >= 0xd800 && head <= 0xdbff) exercised += 1;
        expect(hasLoneSurrogate(capHtmlText(html, max))).toBe(false);
      }),
      // ★★ THE COUNTER BELOW IS ITSELF A RANDOM VARIABLE, and at `numRuns: 50`
      // with a `> 8` floor it FAILED 1 run in 8 — measured, on a branch that
      // touches neither this file nor anything it imports. Instrumented over 10
      // runs at 50, `exercised` came out 8·10·13·13·14·14·16·17·17·19: mean ~14,
      // sd ~3.3, so the old floor sat ~1.8 sd out and a 6 was ordinary.
      // ★ The fix is SAMPLE SIZE, not a lower bar: at 250 runs the counter was
      //   measured at 64·67·71·77·78 (5 runs), so the 25 floor — 10% of runs,
      //   against the ~28% the generator actually produces — sits ~5 sd below
      //   the observed minimum instead of inside the noise. That is what an
      //   anti-vacuity guard wants: it fires when a generator change stops
      //   producing the truncating case, never for ordinary variance. The whole
      //   file still runs in well under 100ms of test time at 250.
      // ★ The `> 15` floor in the property above was measured in the same 10
      //   runs (41·41·41·41·42·42·44·46·47·49) and is ~8 sd clear, so it is
      //   deliberately left alone.
      { numRuns: 250 },
    );
    expect(exercised).toBeGreaterThan(25);
  });

  // -------------------------------------------------------------------------
  // descriptionHtml
  // -------------------------------------------------------------------------

  test("descriptionHtml is idempotent", () => {
    fc.assert(
      fc.property(fc.oneof(htmlishArb, fc.string({ maxLength: 40 })), (stored) => {
        // This upgrade runs on EVERY load of every rich field, so a
        // non-idempotent step compounds: a value re-escaped once per load would
        // reach the user as literal "&amp;amp;lt;" after a handful of saves.
        const once = descriptionHtml(stored, "rich");
        expect(descriptionHtml(once, "rich")).toBe(once);
      }),
      { numRuns: 50 },
    );
  });

  // -------------------------------------------------------------------------
  // htmlPlainProjection
  // -------------------------------------------------------------------------

  test("a block boundary between two words never fuses them", () => {
    let exercised = 0;
    fc.assert(
      fc.property(wordArb, wordArb, (a, b) => {
        // THE regression: `<[^>]*>` deleted the tag with nothing in its place,
        // so "<p>Vendor delay</p><p>Mitigation plan</p>" stored as
        // "Vendor delayMitigation plan" — and it reached storage, because
        // capHtmlText projects, truncates and re-wraps.
        if (a.length >= 2 && b.length >= 2) exercised += 1;
        expect(htmlPlainProjection(`<p>${a}</p><p>${b}</p>`)).toBe(`${a} ${b}`);
      }),
      { numRuns: 50 },
    );
    // Guards against a degenerate generator: two single-character words would
    // satisfy the assertion while exercising almost none of the collapse.
    // ★ Deliberately left at 50 runs when the separateBlockBoundaries counter
    //   below was raised: over 20,000 independent trials this one is mean 38.1,
    //   sd 2.97, and P(exercised <= 10) is ~1e-17 by exact binomial. Two words
    //   are drawn per run rather than one value, so it saturates far faster
    //   than the single-value counters — a bigger sample would buy nothing.
    // ★★ Quote a PROBABILITY, never a sample minimum. An earlier revision of
    //   this comment said "MIN 25 ... never once came within 15 of the floor",
    //   which is self-refuting on its own numbers (25 is EXACTLY 15 above 10)
    //   and was falsified by the next sample anyway: an independent 20,000-trial
    //   run saw 26 and a 2,000-trial run saw 24. The minimum of a sample is
    //   itself a random variable; the distribution is what holds still.
    expect(exercised).toBeGreaterThan(10);
  });

  test("a literal < is text, not a tag opener", () => {
    fc.assert(
      fc.property(wordArb, wordArb, wordArb, (a, b, c) => {
        // "cost < 5k and rising" became "cost": a bare `<[^>]*>` ate everything
        // from a literal "<" to the next ">", and a value left visually empty
        // that way is DROPPED outright by the `if (description)` gates in the
        // entity sanitizers. The leading [a-zA-Z] in TAG models the real HTML
        // tokenizer — "<" opens a tag only when a letter or "/" follows.
        //
        // ★ BOTH shapes below need a ">" LATER in the string, or the broken
        // regex has nothing to close on and the defect cannot reproduce. That
        // rules out the obvious fixture "<p>cost < 5k</p>": BLOCK_TAG runs
        // FIRST and removes every ">" the block tags brought with them, so the
        // naive spelling of this test passes against the broken code. Measured,
        // not assumed — mutating TAG to /<[^>]*>/g left all ten of the other
        // properties green.

        // (1) a literal ">" supplies the closing delimiter.
        expect(htmlPlainProjection(`${a} < ${b} > ${c}`)).toBe(`${a} < ${b} > ${c}`);

        // (2) the historically faithful shape: an INLINE tag downstream of the
        // literal "<". BLOCK_TAG leaves <strong> alone, so its ">" survives to
        // close the broken match, which then swallows the prose between them.
        expect(htmlPlainProjection(`${a} < ${b} <strong>${c}</strong>`)).toBe(
          `${a} < ${b} ${c}`,
        );
      }),
      { numRuns: 40 },
    );
  });

  test("&amp;lt; decodes exactly once — never through to a tag delimiter", () => {
    fc.assert(
      fc.property(wordArb, wordArb, (before, after) => {
        // `&amp;` MUST decode LAST. Decoding it first turns "&amp;lt;" into
        // "&lt;", which the named pass then turns into "<" — putting a tag
        // delimiter back into a string the tag passes have already finished
        // with. One decode is correct; two is corruption.
        const named = htmlPlainProjection(`${before}&amp;lt;${after}`);
        expect(named).toBe(`${before}&lt;${after}`);
        expect(named).not.toContain("<");

        // `&#38;` is the SAME character in numeric clothing and would reopen the
        // same hole, so UNSAFE_CODE_POINTS refuses it — leaving it LITERAL
        // rather than decoding it to "&". That is deliberately not symmetric
        // with the named form: the reference is over-counted by the length
        // cap (the pre-existing behaviour) but can never corrupt. Asserting the
        // named result here instead was my error, not the module's.
        const numeric = htmlPlainProjection(`${before}&#38;lt;${after}`);
        expect(numeric).toBe(`${before}&#38;lt;${after}`);
        expect(numeric).not.toContain("<");
      }),
      { numRuns: 40 },
    );
  });

  test("separateBlockBoundaries leaves the default projection unchanged", () => {
    let exercised = 0;
    fc.assert(
      fc.property(htmlishArb, (html) => {
        // This is the cross-module contract: rich-text-projection's
        // descriptionText runs separateBlockBoundaries FIRST because its
        // DOMPurify pass would otherwise fuse the boundary before
        // htmlPlainProjection could see it. That only makes the two projections
        // agree if pre-separating is a no-op for THIS one.
        //
        // On an input with NO block tag, separateBlockBoundaries is the identity
        // and the equality is trivially true — so count the runs where it
        // actually rewrote something, or the whole property could pass on a
        // generator that never emits a <p>.
        if (separateBlockBoundaries(html) !== html) exercised += 1;
        expect(htmlPlainProjection(separateBlockBoundaries(html))).toBe(
          htmlPlainProjection(html),
        );
      }),
      // ★★ THE SAME RANDOM-VARIABLE TRAP AS THE astral COUNTER ABOVE, and it
      // reached CI: this test failed once in a full-suite shard on a branch
      // touching neither this file nor anything it imports. Over 200,000
      // independent trials at 50 runs, `exercised` is mean 22.55, sd 3.53, and
      // P(exercised <= 10) = 2.05e-4 — about 1 run in 4,900, matching the exact
      // Binomial(50, 0.4513) tail of 1.91e-4. The old assertion was `> 10`.
      // ★★★ THE PROPERTY IS NOT THE FLAKY PART, AND IT CANNOT BE — it is an
      //   IDENTITY, which is worth knowing before anyone "strengthens" it.
      //   `htmlPlainProjection` BEGINS with the same `replace(BLOCK_TAG, " ")`
      //   that `separateBlockBoundaries` IS, so `proj(sep(x)) === proj(x)`
      //   reduces to BLOCK_TAG-replacement being idempotent — and it is, because
      //   the replacement inserts a space and never a "<" or ">", while every
      //   match spans "<"…">", so no second pass can find a new match. Zero
      //   counterexamples over 20.2M generated inputs plus an exhaustive sweep
      //   of every string of length <= 6 over the tag-forming alphabet.
      // ★★ So the runs do NOT buy the property anything — every mutant this
      //   property can kill dies within 8 runs. They buy the COUNTER, which is
      //   the only detector of the mutant the property CANNOT kill: gutting
      //   `separateBlockBoundaries` to the identity leaves this assertion green
      //   at 5,000 runs. That is what the numbers below are protecting.
      { numRuns: 250 },
    );
    // ★★★ THE FLOOR IS 32% OF RUNS, NOT THE 20% THE OLD ONE WAS, AND THAT IS
    // THE WHOLE POINT — raising `numRuns` while holding the floor at a constant
    // FRACTION makes the guard WEAKER in the middle of its range, because the
    // counter concentrates as n grows. Exact-binomial P(guard fires), healthy
    // rate 0.4654 at n=250 (fast-check biases by run index, so the rate differs
    // from the 0.4513 at n=50):
    //
    //     true rate | OLD 10/50 | a 50/250 floor |  THIS 80/250
    //         0.465 |     0.02% |        1.9e-18 |       2.0e-6   <- healthy
    //         0.350 |     1.60% |         1.5e-7 |       17.69%
    //         0.300 |     7.89% |          0.02% |       77.72%
    //         0.250 |    26.22% |          3.74% |       99.49%
    //         0.200 |    58.36% |         53.78% |      100.00%
    //
    // A 50 floor would have been 100x LESS likely to catch a generator degraded
    // to half its rate than the flaky guard it replaced. 80 instead DOMINATES
    // the old guard on every row: ~100x less likely to fire spuriously when
    // healthy AND strictly more likely to fire at every degraded rate.
    // ★ Reproduce the table rather than trusting it — it is exact binomial, so
    //   it needs no sampling: P(X <= f) for X ~ Bin(n, q), n=250, f=80.
    expect(exercised).toBeGreaterThan(80);
  });

  test("preserveBreaks differs from the default only in newline-vs-space", () => {
    let exercised = 0;
    fc.assert(
      fc.property(boundedBoundaryArb, (html) => {
        // The default path feeds capHtmlText -> sanitizeRichText -> all six
        // backends, so break mode had to be added WITHOUT moving a stored byte.
        // Normalising its newlines back to spaces must recover the default
        // result exactly — otherwise break mode is a second, divergent
        // projection rather than the same one with a different separator.
        const broken = htmlPlainProjection(html, { preserveBreaks: true });
        // Without a newline in the break-mode result the two modes cannot
        // possibly disagree, so those runs prove nothing about the relationship.
        if (broken.includes("\n")) exercised += 1;
        expect(broken.replace(/\n/g, " ")).toBe(htmlPlainProjection(html));
      }),
      { numRuns: 50 },
    );
    // High, and stable, because boundedBoundaryArb GUARANTEES an interior block
    // boundary rather than hoping the generator emits one. Over plain htmlishArb
    // this counter swung between 7 and 18 across seeds — a floor tuned to one
    // sample would have been a seed-dependent flake in CI's random-seed job,
    // which is exactly the failure mode the shuffled-suite gate exists to catch.
    expect(exercised).toBeGreaterThan(40);
  });

  // -------------------------------------------------------------------------
  // sanitizeRichText
  // -------------------------------------------------------------------------

  test("sanitizeRichText never throws and always returns a string", () => {
    fc.assert(
      fc.property(fc.anything(), fc.integer({ min: 0, max: 200 }), (raw, max) => {
        // It runs inside the entity sanitizers on every load path. A throw here
        // is swallowed by jsonToWorkspace's catch-all into an EMPTY workspace,
        // which then "successfully" writes near-empty files — the loudest
        // possible data loss arriving completely silently.
        expect(typeof sanitizeRichText(raw, max, "rich")).toBe("string");
      }),
      { numRuns: 50 },
    );
  });

  test("sanitizeRichText strips control characters, respects the cap, and is idempotent", () => {
    fc.assert(
      fc.property(htmlishArb, fc.integer({ min: 0, max: 120 }), (raw, max) => {
        const once = sanitizeRichText(raw, max, "rich");

        // A control byte must not survive as a LITERAL, and a numeric reference
        // must not reintroduce one downstream of the raw strip: sanitizeRichText
        // strips controls from the RAW string and only then projects, so "&#7;"
        // survives that pass and would decode to a BEL inside the projection —
        // which the overflow path writes straight back out via plainToHtml.
        // The range MIRRORS CONTROL_CHARS: \t \n \r \x0b \x0c are excluded, and
        // so is DEL (0x7f), exactly as a pasted DEL is.
        expect(hasStrippedControlChar(once)).toBe(false);

        expect(htmlTextLength(once)).toBeLessThanOrEqual(max);

        // Idempotent for the same reason descriptionHtml is: this is the load
        // boundary, so any drift compounds once per load rather than once ever.
        expect(sanitizeRichText(once, max, "rich")).toBe(once);
      }),
      { numRuns: 50 },
    );
  });
});
