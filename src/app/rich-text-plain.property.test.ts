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
      { numRuns: 50 },
    );
    expect(exercised).toBeGreaterThan(8);
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
        const once = descriptionHtml(stored);
        expect(descriptionHtml(once)).toBe(once);
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
      { numRuns: 50 },
    );
    expect(exercised).toBeGreaterThan(10);
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
        expect(typeof sanitizeRichText(raw, max)).toBe("string");
      }),
      { numRuns: 50 },
    );
  });

  test("sanitizeRichText strips control characters, respects the cap, and is idempotent", () => {
    fc.assert(
      fc.property(htmlishArb, fc.integer({ min: 0, max: 120 }), (raw, max) => {
        const once = sanitizeRichText(raw, max);

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
        expect(sanitizeRichText(once, max)).toBe(once);
      }),
      { numRuns: 50 },
    );
  });
});
