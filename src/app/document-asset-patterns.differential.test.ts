// src/app/document-asset-patterns.differential.test.ts — the three patterns
// checked against a REAL HTML PARSER over generated attribute spellings, and
// against the clock over adversarial input.
//
// ★★★ WHY THIS FILE EXISTS. `fix/asset-id-extraction` shipped four spellings of
// `ASSET_IMG_TEST_RE` and THREE of them were defective — twice with a full green
// gate suite behind them, and both times the defect was found by a human cold
// review rather than by anything mechanical:
//
//   [^>]*\b                    data loss on alt="a>b"   + quadratic
//   quote-aware [\s/]          data loss on 4 shapes    + linear
//   union [^>]* | quote-aware  correct                  + quadratic, WORSE than
//                                                         the spelling it replaced
//   union [^<>]* | quote-aware correct                  + linear
//
// Both defect classes are mechanically checkable and neither needs anyone to
// notice: "does the predicate disagree with a parser?" and "does it stay
// linear?". The hand-written divergence table in
// `document-asset-patterns.test.ts` pins SPECIFIC shapes someone thought of;
// this file generates the shapes instead and asks a parser what the answer is.
//
// ★★ THE DIVERGENCE TABLE IS NOT REDUNDANT WITH THIS AND MUST NOT BE DELETED
// FOR IT. It pins what all THREE patterns do, including the deliberate
// disagreements between them (lazy vs greedy, tag-agnostic vs img-anchored)
// which no parser can adjudicate — a parser has no opinion about what a cap
// should count. This file only checks the two properties a parser and a clock
// CAN settle.
//
// ★ Read `ASSET_IMG_TEST_RE`'s docstring before changing any expectation here.

import { describe, it, expect } from "vitest";
import { ANY_TAG_ASSET_ID_RE, IMG_TAG_ASSET_ID_RE, ASSET_IMG_TEST_RE } from "./document-asset-patterns";
// ★ The complexity family below is sized at the REAL storage cap rather than at
// a round number, so it reads the constant instead of restating it — a literal
// here would silently stop tracking the cap the moment it moved.
import { MAX_HTML_TEXT_CHARS } from "./document-model";

const REAL = "realid";

/** What an actual HTML5 parser extracts, which is the ONLY ground truth here.
 *
 *  ★★ `DOMParser`, not `innerHTML` on a detached node: both run the same
 *   tokenizer, but the fragment-parsing algorithm innerHTML uses depends on the
 *   context element, and this corpus deliberately contains malformed tags whose
 *   recovery is what is under test. Parsing a whole document removes that
 *   variable. */
function parserSeesAssetId(html: string): string | null {
  const doc = new DOMParser().parseFromString(`<p>${html}</p>`, "text/html");
  const img = doc.querySelector("img");
  const id = img?.getAttribute("data-asset-id");
  return id ? id : null;
}

const ids = (re: RegExp, html: string): string[] =>
  Array.from(html.matchAll(re), (m) => m[1]).filter((x) => x.length > 0);

/** One generated input, carrying the axis values that produced it so a failure
 *  names the spelling rather than just the string. */
interface Case {
  readonly html: string;
  /** The parser's verdict, resolved ONCE when the corpus is built.
   *
   *  ★★ Not a convenience. Parsing per assertion re-ran ~4 000 `DOMParser`
   *   constructions per test and blew vitest's 20 s timeout — which surfaces as
   *   three FAILED tests carrying no assertion text, i.e. exactly the shape of
   *   a real failure. A cached field keeps the whole file well under one
   *   parse-pass. */
  readonly parserId: string | null;
  /** True when a preceding attribute value contains a bare `<` AND IS UNQUOTED.
   *  That is the one documented, tested loss — see `ASSET_IMG_TEST_RE`'s
   *  docstring: recovering it needs a branch that scans past `<`, and such a
   *  branch is quadratic on input this predicate receives unbounded.
   *
   *  ★★★ THE QUOTING HALF IS LOAD-BEARING AND A FIRST CUT OF THIS FILE GOT IT
   *   WRONG, flagging `alt="a<b"` as a loss too. It is not: branch 2's
   *   `"[^"]*"` alternative consumes a quoted value WHOLE, `<` included, so a
   *   quoted `<` is recovered normally. Only the UNQUOTED form is lost, because
   *   only there does the `<` sit in the branch's own character class. The
   *   error was in the expectation, not the code — and marking 384 correct
   *   verdicts as expected-failures would have turned this suite into an
   *   assertion that the predicate MUST lose them. */
  readonly bareLtInValue: boolean;

  /** True when this row omits the separator before the target attribute — the
   *  `missing-whitespace-between-attributes` recovery that cost four blocks.
   *
   *  ★★★ SET AT GENERATION, NEVER RE-DERIVED FROM THE HTML, and the floor below
   *   used to do the latter. A substring test for `"data-asset-id` also matches
   *   the DECOY row (`alt="data-asset-id=decoy"`), which carries no missing
   *   separator at all — so half the rows the floor counted were the wrong
   *   class. Measured: with the old filter, deleting `""` from `SEPARATORS`
   *   still reported 240 > 20 and stayed green while the corpus lost the very
   *   shape this file exists for. An anti-vacuity floor that can be satisfied
   *   by rows unrelated to its own class is not a floor. */
  readonly missingSeparator: boolean;
}

/** Preceding-attribute spellings, each with whether its VALUE carries a bare `<`.
 *
 *  ★ These are the interesting ones precisely because a parser RECOVERS from
 *   most of them: an unpaired quote, a `>` inside a quoted value, and a missing
 *   separator are all parse errors that still yield the following attribute. */
const PRECEDING: ReadonlyArray<readonly [string, boolean]> = [
  ["", false],
  ['alt="x"', false],
  ["alt='x'", false],
  ["alt=x", false],
  ['alt="a>b"', false],
  ['alt="><c d"', false],
  ['alt="data-asset-id=decoy"', false],
  ['foo-data-asset-id="decoy"', false],
  ["alt=it's", false],
  ["alt=a<b", true],
  // Quoted, so NOT a loss — branch 2 eats the quoted value whole. Kept in the
  // corpus precisely to pin that difference against its unquoted twin above.
  ['alt="a<b"', false],
];

/** True when `preceding` ends in an UNQUOTED attribute value.
 *
 *  ★★★ ONLY WHITESPACE OR `>` TERMINATES AN UNQUOTED VALUE — `/` DOES NOT, and
 *   a first cut of this generator assumed it did. In `<img alt=x/data-asset-id=
 *   "realid">` the tokenizer reads ONE attribute whose value is
 *   `x/data-asset-id="realid"`, so there is no asset reference at all. Emitting
 *   those as ordinary corpus rows made the parser and the patterns disagree for
 *   a reason that has nothing to do with what the row was testing. They are
 *   generated deliberately, by the dedicated test below, instead. */
const endsInUnquotedValue = (preceding: string): boolean =>
  /=[^"']/.test(preceding) && !/["']$/.test(preceding);

/** Separators between the preceding attribute and the target one. The EMPTY one
 *  is the shape that cost four blocks: a parser raises
 *  `missing-whitespace-between-attributes` and reconsumes in
 *  before-attribute-name state, so the attribute is real. */
const SEPARATORS = ["", " ", "  ", "\n", "\t", "/"] as const;
// ★ Two case spellings, not three: the patterns are either case-insensitive
// (the predicate) or literal-lowercase (both extractors), so a third mixed-case
// name adds a few hundred parses and no discrimination. Same reasoning drops
// `"= "` — whitespace after `=` is handled by the same `\s*` as before it.
const NAMES = ["data-asset-id", "DATA-ASSET-ID"] as const;
const EQUALS = ["=", " =", " = "] as const;
const VALUES = [`"${REAL}"`, `'${REAL}'`, REAL] as const;
const CLOSERS = [">", " >", "/>"] as const;

/** Rows a parser reads NO asset reference from at all.
 *
 *  ★★★ WITHOUT THESE THE OVERCOUNT INVARIANT IS ONE-SIDED, and that is not a
 *   theoretical gap — every generated row above carries a real id, so
 *   `parserId` was `"realid"` on all of them and "never invents an id" could
 *   only ever catch *returned the WRONG string*. The failure it is named for —
 *   returning an id where there is none — had no row that could produce it.
 *   §231, the defect that invariant exists for, is exactly that shape.
 *
 *  ★★ They are NOT generated, because the axes cannot make one: a negative row
 *   is defined by the target attribute being absent or misspelled, and every
 *   axis above exists to spell it correctly. Each is a distinct way to be
 *   almost-but-not-an-asset-reference.
 *
 *  ★★★ `<img alt=x/data-asset-id="realid">` IS DELIBERATELY NOT HERE. It also
 *   parses to null, but all three patterns DO report an id for it — the known,
 *   accepted §252 divergence — so adding it would turn the overcount invariant
 *   red over a defect that is already pinned, with its own control, by the
 *   dedicated test below. A negative row belongs here only when the patterns
 *   agree with the parser about it. */
const NEGATIVE: readonly string[] = [
  // A decoy inside a QUOTED value. ★ The predicate answers TRUE here and that
  // is deliberate (branch 1, the documented false-TRUE: the block survives as a
  // source-less image rather than vanishing) — which is why nothing below
  // asserts the predicate on negative rows. Both EXTRACTORS return nothing, so
  // it costs no cap slot and no export, and that is what is pinned.
  '<img alt="data-asset-id=decoy">',
  // The `-` half of the `(?<![-\w])` lookbehind.
  '<img foo-data-asset-id="decoy">',
  // The `\w` half. ★ Its only other cover in the repo is one row in
  // `document-asset-usage.test.ts`; narrowing the lookbehind to `(?<!-)` was
  // green in both pattern files before this row existed.
  '<img xdata-asset-id="a">',
  // The attribute name extended on the RIGHT — guarded by the `=` requirement
  // rather than by a lookahead, so it is worth a row of its own.
  '<img data-asset-idx="a">',
  // An ordinary image, and no image at all: the two shapes a phantom would most
  // plausibly appear on if an anchor were dropped.
  '<img alt="x">',
  "<p>plain</p>",
];

function buildCorpus(): Case[] {
  const out: Case[] = [];
  for (const [preceding, bareLtInValue] of PRECEDING) {
    for (const sep of SEPARATORS) {
      // A separator is only optional AFTER something; `<img` needs one before
      // the first attribute or the tag name itself changes.
      if (preceding === "" && sep === "") continue;
      // After an unquoted value, neither "" nor "/" starts a new attribute —
      // both join the value. Those are not recovery cases, they are a single
      // different attribute, and they get their own test below.
      if ((sep === "" || sep === "/") && endsInUnquotedValue(preceding)) continue;
      for (const name of NAMES) {
        for (const eq of EQUALS) {
          for (const value of VALUES) {
            for (const closer of CLOSERS) {
              // An unquoted value immediately followed by `/>` makes the `/`
              // part of the value per the tokenizer, so the id would not be
              // REAL and the case tests nothing about the patterns.
              if (value === REAL && closer === "/>") continue;
              const html = `<img ${preceding}${sep}${name}${eq}${value}${closer}`;
              out.push({
                html,
                parserId: parserSeesAssetId(html),
                bareLtInValue,
                missingSeparator: sep === "",
              });
            }
          }
        }
      }
    }
  }
  for (const html of NEGATIVE) {
    out.push({
      html,
      parserId: parserSeesAssetId(html),
      bareLtInValue: false,
      missingSeparator: false,
    });
  }
  return out;
}

const CORPUS = buildCorpus();

describe("document-asset-patterns — differential against a real HTML parser", () => {
  it("generates a corpus that actually exercises the recovery paths", () => {
    // ★★★ ANTI-VACUITY, and it is not optional. Every assertion below is of the
    // form "for each case where the PARSER finds an id...". If the generator
    // regressed to producing inputs a parser rejects, all of them would pass
    // over an empty set and this file would be worth nothing while staying
    // green. These floors assert the corpus still contains the shapes the
    // suite is about.
    const withId = CORPUS.filter((c) => c.parserId !== null);
    const missingSeparator = CORPUS.filter(
      (c) => c.missingSeparator && c.parserId !== null,
    );
    const bareLt = CORPUS.filter((c) => c.bareLtInValue && c.parserId !== null);

    expect(CORPUS.length).toBeGreaterThan(500);
    expect(withId.length).toBeGreaterThan(300);
    // The missing-separator recovery is the class that cost four real blocks.
    expect(missingSeparator.length).toBeGreaterThan(20);
    // And the documented loss must be genuinely present, or the "exactly the
    // bare-`<` cases diverge" assertion below is vacuous in its other half.
    expect(bareLt.length).toBeGreaterThan(5);

    // ★★★ EVERY `NEGATIVE` ROW MUST STILL PARSE TO NULL, asserted as an exact
    // count rather than a floor. A row that stops being negative — because the
    // string was edited, or because a spelling turns out to be a real attribute
    // after all — would go on sitting in the corpus while silently ceasing to
    // exercise the overcount invariant's live half. That is the same
    // fails-open shape as the separator floor this file already got wrong once:
    // still counted, no longer counting the right thing.
    const negatives = CORPUS.filter((c) => c.parserId === null);
    expect(negatives.length).toBe(NEGATIVE.length);
  });

  it("never reports 'no image' for a tag a parser reads a real id from", () => {
    // ★★★ THE DATA-LOSS INVARIANT. `sanitizeBlock` deletes a paragraph when the
    // projection is empty AND this predicate says false, so a `false` here on a
    // tag that really does carry an id destroys user content, silently, on
    // every load path. This is the assertion both shipped defects would have
    // failed.
    const lost = CORPUS.filter(
      (c) => !c.bareLtInValue && c.parserId !== null && !ASSET_IMG_TEST_RE.test(c.html),
    );
    expect(lost.map((c) => c.html)).toEqual([]);
  });

  it("loses exactly the documented bare-`<` case and nothing else", () => {
    // ★★ Asserted in BOTH directions on purpose. The first half stops a new
    // loss being waved through as "another known exception"; the second stops
    // someone widening branch 1 back across `<` — which reads like a pure
    // improvement and reintroduces the quadratic pinned below.
    const keptDespiteBareLt = CORPUS.filter(
      (c) => c.bareLtInValue && c.parserId !== null && ASSET_IMG_TEST_RE.test(c.html),
    );
    expect(keptDespiteBareLt.map((c) => c.html)).toEqual([]);
  });

  it("never invents an id the parser does not see", () => {
    // ★★★ THE OVERCOUNT INVARIANT (§231). A phantom id spends a slot of the
    // 20-image cap and, worse, hides the real reference from the duplicate
    // check — which is how the same image could be added twice. Both extractors
    // are allowed to return NOTHING (they are double-quote-only by design and
    // that undercount is documented in the divergence table); neither may
    // return something that is not there.
    // ★★★ THIS IS TWO-SIDED ONLY BECAUSE OF THE `NEGATIVE` ROWS. Over the
    // generated corpus alone every `parserId` is `"realid"`, so the comparison
    // below could catch a WRONG string but never a string where there should be
    // none — which is §231's actual shape, and the reason this invariant was
    // written. The negative rows are the half that makes the name true.
    const phantoms: string[] = [];
    for (const { html, parserId } of CORPUS) {
      for (const [label, re] of [
        ["ANY_TAG", ANY_TAG_ASSET_ID_RE],
        ["IMG_TAG", IMG_TAG_ASSET_ID_RE],
      ] as const) {
        for (const got of ids(re, html)) {
          if (got !== parserId) phantoms.push(`${label} returned ${JSON.stringify(got)} for ${html}`);
        }
      }
    }
    expect(phantoms).toEqual([]);
  });

  it("counts a phantom id after an unquoted value followed by `/` — known, pre-existing", () => {
    // ★★★ A REAL DIVERGENCE, ASSERTED AS-IS RATHER THAN FIXED. All three
    // patterns accept `/` as an attribute separator unconditionally. A parser
    // only ends an attribute value at `/` when the value was QUOTED; after an
    // unquoted one, `/` is an ordinary value character. So here the parser sees
    // a single `alt` whose value happens to contain the text
    // `data-asset-id="realid"`, and no asset reference at all — while the
    // extractors report one.
    //
    // ★★ EFFECT, so nobody has to re-derive it: the cap counts an image that
    // does not exist, and the duplicate check can match against it. That is the
    // §231 class, one shape narrower.
    //
    // ★★★ NOT FIXED ON PURPOSE, and the reason is this branch's own history
    // rather than the defect's size. Distinguishing the two `/` cases needs the
    // pattern to know whether the value it just passed was quoted, which is
    // exactly the kind of narrowing that has now shipped a data-loss bug and a
    // ReDoS on this branch, one per attempt. It is also strictly better than
    // what preceded it (the pre-branch pattern had no tag anchor at all and
    // matched this text anywhere, including in prose). Reaching it needs raw
    // stored html with an unquoted attribute value; DOMPurify quotes values.
    //
    // ★ Asserted rather than skipped so that a future fix has to come here and
    // delete this test deliberately, and so the behaviour cannot drift unseen.
    const html = '<img alt=x/data-asset-id="realid">';
    expect(parserSeesAssetId(html)).toBeNull();
    expect(ids(ANY_TAG_ASSET_ID_RE, html)).toEqual(["realid"]);
    expect(ids(IMG_TAG_ASSET_ID_RE, html)).toEqual(["realid"]);
    expect(ASSET_IMG_TEST_RE.test(html)).toBe(true);

    // The control: quote the value and `/` really is a separator, so the parser
    // and the patterns agree. Without this row the assertions above read as a
    // claim about `/`, when they are a claim about `/` AFTER AN UNQUOTED VALUE.
    const quoted = '<img alt="x"/data-asset-id="realid">';
    expect(parserSeesAssetId(quoted)).toBe("realid");
    expect(ids(ANY_TAG_ASSET_ID_RE, quoted)).toEqual(["realid"]);
  });
});

/** Inputs whose whole purpose is to make a backtracking matcher explore.
 *
 *  ★★★ THE FIRST ENTRY IS THE ONE THAT REACHES THE PREDICATE, AND IT IS NOT
 *   OBVIOUS. The predicate is only ever reached when `htmlTextLength(html) ===
 *   0`, so an adversarial string that PROJECTS to visible text never gets there
 *   — the `&&` short-circuits. `"<img ".repeat(n) + ">"` projects to ZERO,
 *   because `TAG` (`rich-text-plain.ts`) consumes the whole thing as a single
 *   match. That is what makes the quadratic reachable rather than theoretical,
 *   and a timing suite built only from `"<img".repeat(n)` would have said the
 *   shipped regression was fine. ("one huge tag" projects to zero as well, so
 *   the entries reachable THROUGH the short-circuit are the first and the
 *   last-but-one, not the first alone.)
 *  ★★★ READ THAT AS "WHICH FAMILY REACHES THE PREDICATE", NOT "WHICH FAMILY
 *   MATTERS" — the difference decides whether the other three look prunable,
 *   and they are not. Only `ANY_TAG_ASSET_ID_RE` and `IMG_TAG_ASSET_ID_RE` run
 *   OUTSIDE that gate, on every export, with no projection test in front of
 *   them; the bare `"<img".repeat(n)` and `"<a".repeat(n)` families are the
 *   only two that catch widening the tag-name class to `[^\s/>"']*` — the
 *   module docstring's own "first attempt", which is correctness-green in both
 *   test files and measured ~5.9 s at 64 KB here. Pruning to "the one that
 *   matters" would delete the only detector for the mutant the docs name by
 *   hand. */
const ADVERSARIAL: ReadonlyArray<
  readonly [string, (bytes: number) => string, number?]
> = [
  ["<img SP repeated, closed", (n) => "<img ".repeat(Math.round(n / 5)) + ">"],
  ["<img repeated", (n) => "<img".repeat(Math.round(n / 4))],
  ["<img alt= repeated", (n) => "<img alt=".repeat(Math.round(n / 9))],
  ["<a repeated", (n) => "<a".repeat(Math.round(n / 2))],
  ["one huge tag", (n) => `<img alt="${"a".repeat(n)}" x=1>`],
  // ★★★ THE ONLY FAMILY THAT CARRIES THE ATTRIBUTE, AND THE ONLY ONE SIZED TO
  //  A CAP RATHER THAN TO `BYTES`. Every family above stresses the ANCHOR, so
  //  all three patterns bail at or near it and `IMG_TAG_ASSET_ID_RE`'s
  //  distinctive trailing `(?:…)*>` — which must find a closing `>` AFTER the
  //  attribute — is never exercised. It is quadratic there: an UNTERMINATED
  //  `<img` carrying N real `data-asset-id="…"` makes the greedy prefix
  //  backtrack through every occurrence, re-scanning the tail for a `>` that
  //  never comes. Measured on the shipped pattern, `matchAll`: 112 ms at 32 KB,
  //  388 at 64, 1548 at 128, 8029 at 256 — exponent ~2.1. Closing the tag is
  //  1.0 ms at 256 KB, so the trigger is specifically the missing `>`;
  //  `ANY_TAG_ASSET_ID_RE` (lazy, no trailing requirement) and the predicate
  //  are ~0.1 ms throughout.
  //  ★★★ IT IS SIZED AT `MAX_HTML_TEXT_CHARS`, NOT `BYTES`, BECAUSE THAT IS
  //   THE WHOLE PRODUCTION EXPOSURE — and running it at 256 KB would assert a
  //   size no stored block can reach, i.e. fail the branch over a shape the app
  //   cannot hold. `capHtmlText` truncates every paragraph to that cap on BOTH
  //   write paths.
  //   ★★★ AND THE MECHANISM RECORDED HERE WAS INVERTED UNTIL 2026-08-27. It said
  //    the payload "projects to zero visible text, so a visible-text cap would
  //    not have touched it", and that capHtmlText caps "by HTML length rather
  //    than by visible text". Both are false, measured: the payload contains no
  //    `>` at all, so neither TAG nor BLOCK_TAG matches and the projection
  //    returns essentially the whole string — 18958 visible chars at 18959
  //    bytes. capHtmlText measures htmlPlainProjection(html).length, i.e. it IS
  //    a visible-text cap, and that is precisely why it bites here. The row's
  //    OUTCOME was right and its reason was upside down, which is the dangerous
  //    shape: it told the next reader this row is protected by a mechanism that
  //    is not the one protecting it.
  //   Measured end to end —
  //   `sanitizeProjectDocuments` and `normalizeBlockForStorage` both store
  //   20 010 chars of a 262 157-char payload. At that size the quadratic is
  //   ~38 ms, so this row runs with a ~50x margin and goes red if the cap is
  //   raised or the pattern degrades further. The unbounded property itself is
  //   recorded in `docs/open-followups.md` §253 — deliberately NOT fixed here,
  //   because bounding the trailing run is the same narrowing class that
  //   produced §250's two regressions.
  [
    "<img with N data-asset-id, unterminated",
    (n) => "<img " + 'data-asset-id="x" '.repeat(Math.round(n / 19)),
    MAX_HTML_TEXT_CHARS,
  ],
];

describe("document-asset-patterns — complexity", () => {
  // ★★★ THE CEILING IS DELIBERATELY ~1000x THE MEASURED COST, and that is the
  // point rather than sloppiness. Measured linear behaviour is single-digit
  // milliseconds at 1 MB; the shipped quadratic was ~44 SECONDS at 512 KB. Any
  // threshold between those two separates them, so the loosest one that still
  // does is correct — it cannot flake on a loaded machine (this repo's suite
  // runs 16-wide and a starved worker is a known flake source) while still
  // failing instantly on a genuine complexity regression.
  // ★ Do NOT tighten this to track the real number. A perf assertion that is
  // close to the measurement is a flake generator, and a flaky gate gets
  // deleted, which costs the whole check.
  const CEILING_MS = 2000;
  // ★★ 256 KB, not 1 MB, and the reason is FAILURE LEGIBILITY rather than
  // speed. The quadratic that shipped measured ~44 s at 512 KB, so at 1 MB it
  // would blow vitest's 20 s test timeout BEFORE the assertion ran — turning a
  // precise "took 11 000 ms, ceiling 2 000" into a bare timeout that names
  // neither number and reads like a hung worker. At 256 KB the quadratic lands
  // around 11 s: still ~5x over the ceiling, still red, and it says why.
  // ★ The linear cost here is ~1 ms, so the margin is unchanged in the direction
  // that matters.
  const BYTES = 256 * 1024;

  for (const [label, make, bytes] of ADVERSARIAL) {
    it(`stays bounded on ${label}`, () => {
      const input = make(bytes ?? BYTES);
      const started = performance.now();
      ASSET_IMG_TEST_RE.test(input);
      ANY_TAG_ASSET_ID_RE.lastIndex = 0;
      Array.from(input.matchAll(ANY_TAG_ASSET_ID_RE));
      Array.from(input.matchAll(IMG_TAG_ASSET_ID_RE));
      expect(performance.now() - started).toBeLessThan(CEILING_MS);
    });
  }

  // ★★★ A PATTERN-LEVEL BOUND, DELIBERATELY SEPARATE FROM THE ROWS ABOVE. The
  // ADVERSARIAL family is sized to MAX_HTML_TEXT_CHARS because that is the
  // app's real exposure, and at that size the quadratic still fits the ceiling
  // with a ~50x margin — so it cannot pin the pattern's own complexity. This
  // one asserts the MATCHER is linear, at a size no stored block can reach, and
  // it is the only thing that goes red if the quadratic returns. Measured on
  // the shipped pattern 2026-08-27: 143 ms at 32 KB, 529 at 64, 1961 at 128,
  // 16098 at 256 — an exponent above 2. The guarded pattern is 0.2 / 0.4 / 0.6
  // / 2.5 ms across the same four sizes. These are BUDGET numbers off one
  // machine under load: re-measure rather than trusting the cells.
  it("IMG_TAG_ASSET_ID_RE is linear on an unterminated <img carrying repeated ids", () => {
    const unit = 'data-asset-id="x" ';
    const input = "<img " + unit.repeat(Math.round((256 * 1024) / unit.length));
    const started = performance.now();
    Array.from(input.matchAll(IMG_TAG_ASSET_ID_RE));
    expect(performance.now() - started).toBeLessThan(CEILING_MS);
  });
});
