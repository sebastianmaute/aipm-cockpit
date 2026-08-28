// src/app/rich-text-plain.ts
//
// DOM-FREE half of the rich-text description layer (RAID description +
// mitigation, Change description + impactDescription + resolutionNotes,
// Milestone description).
//
// ★★★ NOTHING HERE MAY CALL DOMPURIFY. These functions run inside the entity
// sanitizers, which execute under bare node in scripts/generate-sample-
// workspace.ts and the fixture flow. DOMPurify binds its `window` ONCE at
// module-eval; with no DOM that bind fails, sanitize() throws, and
// jsonToWorkspace's catch-all silently swallows it into an EMPTY workspace —
// which then "successfully" writes near-empty sample files. Sanitisation is a
// SINK concern: RichTextView re-sanitises at render.
//
// Importing plainToHtml is safe (narrative-html.ts already does): only a CALL
// to DOMPurify needs a DOM, and plainToHtml deliberately makes none — it
// escapes &<> and adds only <p>/<br>, both in the note allow-list, which makes
// a sanitize pass a provable no-op.
import { plainToHtml } from "./sanitize-html";
import { isHtmlStart, type RichTextSink } from "./html-start";
import { logDiag } from "./diagnostics";
import { ASSET_IMG_TAG_RE } from "./document-asset-patterns";

/** Whitespace control characters — TAB (0x09), vertical tab and form feed —
 *  collapse to a SINGLE SPACE instead of being deleted.
 *
 *  ★★ Deleting a tab FUSED the words either side of it: a pasted
 *  "Vendor delay\tMitigation plan" stored as "Vendor delayMitigation plan".
 *  That is the same word-boundary loss BLOCK_TAG below exists to prevent,
 *  reappearing at the WRITE boundary — and it made the two disagree, because
 *  htmlPlainProjection projects a tab to a space (WS_RUN), so the editor's
 *  counter measured a length the stored value no longer had. The modal write
 *  path applies capHtmlText/descriptionHtml but NOT this strip, so a pasted tab
 *  rendered and saved fine and only fused on the next load — permanently.
 *  Mirrors note-log.ts's NEWLINE_TAB.
 *
 *  ★ \n (0x0a) and \r (0x0d) stay OUT of the collapse here, UNLIKE note-log
 *  (whose cell is single-line): plainToHtml turns them into <br>, which is a
 *  real boundary already. */
const WS_CONTROL = /[\t\x0b\x0c]+/g;
/** The remaining control characters carry no text, so they are DELETED. \n and
 *  \r are DELIBERATELY absent for the reason above. Written as \x escapes — a
 *  literal control byte corrupts the file to binary. */
const CONTROL_CHARS = /[\x00-\x08\x0e-\x1f]/g;

/** Block-level and line-break tags, which are WORD BOUNDARIES: they project to a
 *  space, not to nothing. Deleting them outright fused the text either side —
 *  "<p>Vendor delay</p><p>Mitigation plan</p>" read as "Vendor delayMitigation
 *  plan" — and since descriptionHtml turns every legacy newline into a <br>,
 *  that hit the most common shape in existing data. It reaches storage too:
 *  capHtmlText projects, truncates and re-wraps, so on overflow the fused text
 *  is what gets persisted. */
const BLOCK_TAG = /<\/?(?:p|div|br|li|ul|ol|pre|h[1-6]|blockquote|tr|td|th)\b[^<>]*>/gi;
/** The remaining (inline) tags, which project to nothing.
 *  ★★ The leading `[a-zA-Z]` models the HTML tokenizer: a `<` is only a tag
 *  opener when a letter (or `/`) follows it. A bare `<[^>]*>` ate everything
 *  from a literal "<" to the next ">" — "cost < 5k and rising" became "cost" —
 *  and a value left visually empty that way is DROPPED by the `if (description)`
 *  gates in the entity sanitizers.
 *
 *  ★★★ MAKING THIS `[^>]*` QUOTE-AWARE WOULD DELETE IMAGE BLOCKS ON LOAD, and
 *  nothing here would tell you so. `sanitizeBlock` (`document-model.ts`) keeps
 *  an image-only paragraph via `htmlTextLength(html) === 0 &&
 *  !ASSET_IMG_TEST_RE.test(html)`. For `<img alt="a>b" data-asset-id="real">`
 *  THIS projection truncates at the `>` inside the attribute and reports 24
 *  visible characters, so the first term is false and the block is kept. A
 *  quote-aware matcher here would correctly report 0 — and the block's survival
 *  would then rest entirely on the predicate, on every load path at once.
 *  ★★ That predicate handles the shape as of 0.259.2 — it is a UNION of the old
 *  `[^>]*` form and a quote-aware one — so this is a warning rather than a live
 *  coupling: today the guard would still keep the block through its second
 *  term. ★ It is a union rather than the quote-aware regex alone because
 *  quote-awareness ALONE loses four other real shapes; §250 carries them. Do not read that as licence to change this in passing — it
 *  makes a matcher that currently cannot drop a block into one that can, and
 *  the failure is silent, on all six write paths, with nothing in the
 *  truncation diag. Any change here wants the load-path tests in
 *  `document-model.test.ts` run against it, not just this file's own.
 *  ★★★ BOTH RUNS EXCLUDE `<` AND MUST KEEP EXCLUDING IT. `[^>]*` let a single
 *  opener scan to end of input looking for a `>` that is not there, which is
 *  quadratic: measured 2026-08-27 at 128 KB, TAG 6617 ms and BLOCK_TAG 7226 ms
 *  against 8.4 ms for the same bytes with the tags CLOSED. Bounding the run to
 *  one tag is the same fix ASSET_IMG_TEST_RE took for the same reason, and the
 *  principle is stated in ANY_TAG_ASSET_ID_RE's docstring: not crossing a tag
 *  boundary is the property that matters. Pinned by the complexity family in
 *  rich-text-plain.test.ts — a budget test, so re-measure rather than trusting
 *  these cells.
 *  ★★★ IT MOVES TWO SHAPES, NOT ONE, and the second was found by a gate rather
 *  than by planning. (1) A QUOTED attribute value carrying a bare `<`
 *  (`<img alt="a<b" …>`) projects 11 characters instead of 0. (2) An UNQUOTED
 *  one (`<img alt=a<b data-asset-id="real">`) projects 10 instead of 0, because
 *  the `<img alt=a` opener can no longer match and the strip takes
 *  `<b data-asset-id="real">` as a tag in its own right, leaving the head.
 *  ★★ BOTH ARE THE SAFE DIRECTION for sanitizeBlock's drop condition — a
 *  non-zero projection KEEPS the block — and (2) is the more valuable: that
 *  block carries a REAL `data-asset-id` and was DELETED on every load path.
 *  `document-model.test.ts` pinned that deletion as a KNOWN, ACCEPTED LOSS,
 *  accepted ONLY because recovering it needed a predicate branch scanning past
 *  `<`, which is quadratic. This recovers it the opposite way — by bounding the
 *  projection — so the adversarial shape that docstring named,
 *  `"<img ".repeat(n) + ">"`, measures 0.5 / 1.1 / 2.9 ms at 41 / 82 / 164 KB.
 *  Its own comment set that as the acceptance test ("if a future change makes
 *  this block survive, check what it did to the adversarial timing"), so the
 *  test now asserts SURVIVAL.
 *  ★ The cost of both is that the unmatched tag's head is raw markup read as
 *  prose. Neither can reach the EXPORT projections: htmlToText runs DOMPurify
 *  at ALLOWED_TAGS: [] and both of them project its OUTPUT, so no attribute
 *  value survives that far (pinned with a positive control in
 *  rich-text-projection.test.ts).
 *  ★ This does NOT make the run quote-aware, which remains the change the three
 *  stars above forbid: `<` exclusion and quote-awareness are two independent
 *  narrowings with different blast radii, and conflating them is what produced
 *  §250.
 *
 *  ★ History: both patterns once carried this same truncation and the safety
 *  was argued as a CANCELLATION between them. That argument was wrong — it held
 *  only for the one shape it was measured on, and real blocks were being
 *  deleted for shapes where the tail after the `>` was itself tag-like. See
 *  `ASSET_IMG_TEST_RE`'s docstring for the measurement. */
const TAG = /<\/?[a-zA-Z][^<>]*>/g;
/** A non-breaking space in every spelling the editor or a paste can produce. */
const NBSP = /&nbsp;|&#0*160;|&#x0*a0;/gi;
/** Runs of whitespace — including the ones the boundary spaces above introduce
 *  — collapse to one, so a boundary costs exactly the single space it means. */
const WS_RUN = /\s+/g;

/** Break mode's two-stage collapse. A whitespace run CONTAINING a newline
 *  becomes one "\n" — so the close-tag and open-tag boundaries of "</p><p>"
 *  merge into a single break — while a purely horizontal run still becomes one
 *  space. `[^\S\n]` is "whitespace that is not a newline".
 *
 *  ★ Paragraph-vs-<br> is deliberately NOT preserved: this is a plain-text
 *  projection, not a format. One boundary, one break. */
const WS_RUN_WITH_NEWLINE = /[^\S\n]*\n\s*/g;
const WS_RUN_HORIZONTAL = /[^\S\n]+/g;

/** Code points a numeric reference must NOT decode to.
 *
 *  ★★ `&#38;` IS `&`. Decoding it before the named pass turns `&#38;lt;` into
 *  `&lt;`, which the named pass then decodes to `<` — the exact double-decode
 *  that "&amp; decodes LAST" exists to prevent. `&#60;`/`&#62;` would put a tag
 *  delimiter back into a string the TAG pass has already finished with. All
 *  three stay literal text: over-counted, which is the pre-existing behaviour,
 *  but never corrupting. */
const UNSAFE_CODE_POINTS = new Set([0x26, 0x3c, 0x3e]);
/** `&#8212;` / `&#x2014;`, either case. */
const NUMERIC_ENTITY = /&#(x[0-9a-f]+|\d+);/gi;

/** Decode numeric character references to the characters they denote.
 *
 *  Runs AFTER the tag work (so a decoded character can never be read as markup)
 *  and BEFORE the &nbsp;/whitespace passes (so a decoded space collapses like
 *  any other). Anything it declines is returned verbatim — this must never
 *  throw, because it runs inside the entity sanitizers on every load.
 *
 *  ★ NAMED references beyond the small set below are deliberately still
 *  untouched: `&mdash;` continues to count 7. The numeric forms are what an
 *  Office paste actually produces; the named tail is open-followups.md §24's
 *  remainder. */
function decodeNumericEntities(s: string): string {
  return s.replace(NUMERIC_ENTITY, (whole, body: string) => {
    const hex = body[0] === "x" || body[0] === "X";
    const cp = hex ? parseInt(body.slice(1), 16) : parseInt(body, 10);
    if (!Number.isInteger(cp) || cp <= 0 || cp > 0x10ffff) return whole;
    if (UNSAFE_CODE_POINTS.has(cp)) return whole;
    // ★★ A control character CONTROL_CHARS would have deleted must not be
    // reintroduced HERE, downstream of the strip. sanitizeRichText strips
    // controls from the RAW string and only then projects, so "&#7;" survives
    // that pass, decodes to a BEL inside the projection, and on the OVERFLOW
    // path plainToHtml (which escapes only & < >) writes it back into the
    // stored value on all six backends. \t \n \r \x0b \x0c are deliberately
    // absent for the same reason they are absent from CONTROL_CHARS.
    // ★ This range MIRRORS CONTROL_CHARS exactly — it is not "every control
    // character". DEL (0x7f) is outside both, so `&#127;` decodes, exactly as a
    // pasted DEL survives the raw strip. Keep the two in lockstep: widening one
    // without the other makes a reference and a literal behave differently.
    if (cp <= 0x08 || (cp >= 0x0e && cp <= 0x1f)) return whole;
    // ★ Lone surrogates are refused because emitting one reproduces exactly the
    // backend-dependent corruption capHtmlText's own comment documents below: a
    // lone surrogate becomes U+FFFD on CSV/MD but survives on JSON/IDB. (It is
    // NOT that fromCodePoint throws on them — it does not; only the range and
    // integer arms above are throw-guards.)
    if (cp >= 0xd800 && cp <= 0xdfff) return whole;
    return String.fromCodePoint(cp);
  });
}

/** Turn every block boundary into a space, leaving all other markup alone.
 *
 *  ★★ Exported for ONE caller: rich-text-projection's descriptionText, whose
 *  DOMPurify pass (htmlToText, ALLOWED_TAGS: []) deletes tags with nothing in
 *  their place and so fuses the boundary BEFORE htmlPlainProjection can see it.
 *  Running this first is what makes the two projections agree. Keep the rule
 *  here, in the one module that owns BLOCK_TAG — a second copy would drift.
 *
 *  ★ The separator defaults to a space, which is the storage-critical path
 *  (htmlPlainProjection -> capHtmlText -> sanitizeRichText -> every backend).
 *  descriptionTextWithBreaks passes "\n"; nothing else may.
 *
 *  ★★ `sep` is TYPED to those two literals, not to `string`, because it lands in
 *  a String.replace REPLACEMENT position where `$&`, `` $` ``, `$'` and `$$` are
 *  special: `separateBlockBoundaries("<p>a</p><p>b</p>", "$`")` re-injects raw
 *  markup into the value this function exists to de-fuse. A docstring is not a
 *  type on an exported API. */
export function separateBlockBoundaries(html: string, sep: " " | "\n" = " "): string {
  return html.replace(BLOCK_TAG, sep);
}

/** Visible markers for a task item's checked state, used by the plain-text
 *  projections so a flat export states the state instead of dropping it.
 *  ONE definition — both projections call the same helper, so they cannot
 *  drift into two spellings. */
export const TASK_MARK_CHECKED = "[x] ";
export const TASK_MARK_UNCHECKED = "[ ] ";

/** Replaces a task item's opening tag with its state marker.
 *
 *  ★★ DOM-FREE, like everything else in this module — it runs inside the entity
 *  sanitizers' call graph, which executes under bare node in the sample
 *  generator. Regex, not DOMParser.
 *
 *  ★★★ The markers land in a String.replace REPLACEMENT position, where `` $` ``
 *  and `$&` are special. Both constants above are literal square brackets and an
 *  x/space, so neither contains "$" — do NOT parameterise this with a
 *  caller-supplied string without escaping "$" first. (Same trap as
 *  `separateBlockBoundaries`' `sep`, which is typed to two literals for it.)
 *
 *  ★ Applied ONLY at the two projection sites, never inside
 *  htmlPlainProjection: that one feeds htmlTextLength -> capHtmlText ->
 *  sanitizeRichText -> all six backends, so a prefix there would move stored
 *  caps and every byte-stability fixture.
 *
 *  ★★★ IT ALSO SWALLOWS THE ITEM'S LEADING `<p>`, and that is not tidying. A
 *  task item's content sits in a paragraph (`<li …><p>text</p></li>`), which
 *  `separateBlockBoundaries` then replaces with the separator — so in the
 *  EXPORT projection, whose separator is "\n", the marker was severed from its
 *  own text: `[x]\ndone thing`, a checkbox on one line and the task on the
 *  next. Measured, not predicted. Consuming the opening tag here (it runs
 *  BEFORE separateBlockBoundaries and is the only place that still sees it)
 *  keeps marker and text on one line; the item's CLOSING tags still become a
 *  boundary, so items stay on separate lines. The collapsed projection was
 *  never affected — its separator is a space — which is exactly why one
 *  projection can look right while the other is broken.
 *
 *  ★★ ALL THREE ATTRIBUTE RUNS EXCLUDE `<`, for the reason TAG's docstring
 *  gives: an unterminated `<li` otherwise scans to end of input three times
 *  over. Pinned by the complexity family in rich-text-plain.test.ts. */
export function markTaskItems(html: string): string {
  return html.replace(
    /<li\b[^<>]*\bdata-type\s*=\s*"taskItem"[^<>]*>\s*(?:<p\b[^<>]*>)?/gi,
    (tag) => (/\bdata-checked\s*=\s*"true"/i.test(tag) ? TASK_MARK_CHECKED : TASK_MARK_UNCHECKED),
  );
}

/** A stored value -> HTML. Already-HTML passes through; legacy plain text is
 *  escaped and wrapped. Idempotent — this runs on every load.
 *
 *  ★★★ `sink` is REQUIRED and names where the result is going, because the answer
 *  to "is this already HTML?" is different per sink. Passing the wrong one is a
 *  data-integrity bug in both directions: too narrow escapes the whole value
 *  permanently (§107 / §114), too wide lets a KEEP_CONTENT:false sink delete the
 *  text. There is deliberately no default. */
export function descriptionHtml(stored: string | undefined, sink: RichTextSink): string {
  const s = (stored ?? "").trim();
  if (!s) return "";
  return isHtmlStart(s, sink) ? s : plainToHtml(s);
}

/** Plain-text projection WITHOUT DOMPurify — the only projection legal in a
 *  sanitizer. `&amp;` decodes LAST, or "&amp;lt;" would double-decode to "<".
 *  For display/search/export use rich-text-projection.ts's descriptionText,
 *  which goes through the real sanitizer.
 *
 *  ★ ORDER IS LOAD-BEARING. Block tags become spaces BEFORE the inline strip, so
 *  the boundary survives it. Whitespace collapses AFTER the &nbsp; rewrite (or a
 *  run of them would not collapse) but the entity decodes stay AFTER the tag
 *  work, so a decoded `&lt;` can never be re-read as a tag opener — which is
 *  also what keeps `&amp;` decoding LAST meaningful.
 *
 *  Numeric references decode after the tag work and before the whitespace
 *  passes, and refuse to emit & < > — see UNSAFE_CODE_POINTS.
 *
 *  ★★ `preserveBreaks` is OPT-IN and the default path must stay byte-identical:
 *  this function feeds capHtmlText -> sanitizeRichText -> storage, so a change
 *  to the options-less result moves stored bytes on every backend. A hardcoded
 *  byte-stability suite in the test file is the gate. */
export function htmlPlainProjection(html: string, opts?: { preserveBreaks?: boolean }): string {
  const breaks = opts?.preserveBreaks === true;
  const tagless = decodeNumericEntities(
    html.replace(BLOCK_TAG, breaks ? "\n" : " ").replace(TAG, ""),
  ).replace(NBSP, " ");
  const spaced = breaks
    ? tagless.replace(WS_RUN_WITH_NEWLINE, "\n").replace(WS_RUN_HORIZONTAL, " ")
    : tagless.replace(WS_RUN, " ");
  return spaced
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .trim();
}

/** Length of the VISIBLE text — what the cap and the counter both measure, so
 *  markup never eats the user's budget. */
export function htmlTextLength(html: string): number {
  return htmlPlainProjection(html).length;
}

/** How many asset images one degrade carries across.
 *
 *  ★★ THE BOUND LIVES HERE, NOT AT THE CALLERS. A caller-side cap is a bound
 *  this function cannot see, so it stops holding the moment someone adds a
 *  caller — and the whole point of this function is to be the one overflow path
 *  every caller shares. 20 matches the document image cap; exceeding it means
 *  the input was already outside what the app can hold. */
const DEGRADE_IMG_CAP = 20;

/** ★★★ THE MATCHER THIS FUNCTION USES LIVES IN `document-asset-patterns.ts`,
 *  DELIBERATELY, AND MOVING IT BACK RE-OPENS §209. It shipped here as a private
 *  fourth `data-asset-id` spelling and diverged on arrival — bare `[^<>]*` runs
 *  where the three canonical ones are quote-aware, so an image carrying a `>` in
 *  a quoted attribute before the id was silently dropped from a degrade while
 *  every renderer drew it. That is §208's own defect inside §208's fix, and the
 *  differential corpus in `document-asset-patterns.test.ts` — the only gate that
 *  checks this class — could not see it from another module. Read
 *  `ASSET_IMG_TAG_RE`'s docstring there before changing anything here. */

/** The SINGLE overflow path: flatten to text, truncate, carry the images.
 *
 *  ★★★ IT EXISTS BECAUSE THE OLD OVERFLOW BRANCH DELETED IMAGES SILENTLY (§208).
 *  `capHtmlText` used to end in `plainToHtml(text.slice(0, cut))`, which builds
 *  `<p>` + escaped text + `</p>` and therefore discards ALL markup — an
 *  `<img data-asset-id>` in an over-cap paragraph was gone on load, with nothing
 *  in the truncation diag.
 *
 *  ★★★ MARKUP-AWARE TRUNCATION IS NOT AN OPTION HERE AND THAT IS STRUCTURAL, not
 *  a preference: this module is DOM-FREE by contract (see the file header — a
 *  DOMPurify call here makes jsonToWorkspace silently produce an EMPTY
 *  workspace under bare node). Anything that has to understand tree structure to
 *  truncate correctly cannot live in this file. Carrying the images across a
 *  flatten is the most that can be done without a DOM.
 *
 *  ★★ THE SURROGATE AND `max <= 0` GUARDS LIVE HERE NOW, moved from capHtmlText
 *  rather than copied. `slice` counts UTF-16 CODE UNITS, so a cap landing inside
 *  an astral character kept its LONE HIGH SURROGATE — which UTF-8 encoding
 *  replaces with U+FFFD permanently, so CSV and Markdown corrupted while JSON
 *  and IndexedDB did not. And at a NEGATIVE max, `slice`'s end index counts from
 *  the END, so the guard is `max <= 0`, not `max === 0`. `clipText`
 *  (sanitize-core.ts) carries the identical fix and the two are documented as
 *  agreeing at the boundary — a second copy in capHtmlText would quietly turn
 *  that two-way claim into a three-way one. */
export function degradeToPlain(html: string, max: number): string {
  if (!html) return "";
  if (max <= 0) return "";
  // ★★ BREAK OUT OF THE ITERATOR — do NOT `Array.from(...).slice(0, CAP)`. That
  // spelling materialises EVERY match before discarding all but the first CAP,
  // so the cap bounded the OUTPUT while the work stayed unbounded — on the one
  // path whose input is oversized by definition. `matchAll` is lazy, so the
  // break makes the cap bound the scan too.
  // ★★ NOTHING PINS THIS, AND THE COMMENT ABOVE SHOULD NOT BE READ AS COVERAGE.
  // Reverting to `Array.from(...).slice(0, CAP)` leaves every test green. The
  // unterminated-`<img>` budget test cannot see it — that input yields ZERO
  // matches, so both spellings drain the iterator identically. At any reachable
  // size it is probably an EQUIVALENT mutant (the byte ceiling caps input at
  // 161,024 bytes, so ~7,000 possible tags, and materialising 7,000 matches is
  // sub-ms), which is why no test was added. Recorded as unproven rather than
  // claimed — from here, an equivalent mutant and a missing test look the same.
  // ★★ `lastIndex = 0` IS LOAD-BEARING, NOT DEFENSIVE — this comment called it
  // defensive and that undersells it. `matchAll` HONOURS the source regex's
  // lastIndex (measured 2026-08-28: seeded to 25, it yielded 1 match instead of
  // 3) and never mutates it. The pattern is shared and module-level now, so a
  // future `.test()`/`.exec()` consumer ANYWHERE would leave it dirty — those
  // two DO advance it — and this reset is the only thing between that and a
  // silent mid-string scan here. There is no such consumer today.
  // ★ Breaking out of the loop above leaves lastIndex at 0, so the cap cannot
  // strand it either.
  ASSET_IMG_TAG_RE.lastIndex = 0;
  const images: string[] = [];
  for (const m of html.matchAll(ASSET_IMG_TAG_RE)) {
    if (images.length >= DEGRADE_IMG_CAP) break;
    images.push(m[0]);
  }
  const text = htmlPlainProjection(html);
  const last = text.charCodeAt(max - 1);
  const cut = last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
  const body = plainToHtml(text.slice(0, cut));
  return images.length === 0 ? body : `${body}${images.join("")}`;
}

/** Cap by text length. Over cap, the value is projected to text, truncated and
 *  re-wrapped, so the result is always well-formed; formatting is lost on
 *  overflow.
 *
 *  ★ The RAID and Change editors warn first via their own CharCounter.
 *  milestone-edit-modal.tsx has no counter, no describeTextCap and no
 *  useAdjustmentTracker — a >5000-character milestone description loses all
 *  markup silently. That trade-off is accepted at that call site; this shared
 *  comment used to promise a warning only two of the three modals give.
 *
 *  ★★ THE OVERFLOW BRANCH IS degradeToPlain, WHICH IS THE ONLY PLACE THAT
 *  TRUNCATES. The surrogate-pair and `max <= 0` guards moved there with it;
 *  they are not duplicated here, deliberately, because `clipText`
 *  (sanitize-core.ts) is documented as carrying the identical fix and agreeing
 *  with it at the boundary — a third copy makes that claim unverifiable. */
export function capHtmlText(html: string, max: number): string {
  if (!html) return "";
  const text = htmlPlainProjection(html);
  if (text.length <= max) return html;
  return degradeToPlain(html, max);
}

/** Raw-byte ceiling, as a multiple of the VISIBLE-text cap it accompanies.
 *
 *  ★★★ IT EXISTS BECAUSE THE VISIBLE-TEXT CAP BOUNDS THE WRONG THING (§31).
 *  `capHtmlText` measures projected text and returns the html untouched when it
 *  fits, so markup carried no limit at all: `<p>` + `<em></em>` x200000 + `a</p>`
 *  is ONE visible character and 1,800,008 stored bytes, and that value lands in
 *  a Turso row, a CSV cell and a Markdown cell on all six backends.
 *
 *  ★★ K = 32 IS DERIVED, NOT PICKED. Measured html:visible ratios for real
 *  formatting: plain 1.0x, bold-per-word 2.9x, list items 2.8x, links 6.3x,
 *  table cells 6.5x, and the worst legitimate shape found — a highlight with an
 *  inline style on every word — 8.3x. The two abuse shapes are 500,000x
 *  (`<p data-x="A"x500000>a</p>`) and 1,800,000x (the `<em></em>` repeat named
 *  above); both are pinned in rich-text-plain.test.ts. Three orders of
 *  magnitude of clear air is what makes a ratio safe; 32 leaves ~4x headroom
 *  over the worst legitimate case. An independent review then tried to build a
 *  legitimate shape that trips it and reached 14.2x (a 400-row table with a
 *  styled span per cell), so the headroom is ~2.3x against the worst
 *  ADVERSARIALLY-sought legitimate content, not merely against the surveyed
 *  set. The corpus itself tops out at 1.38x, and is too thin to set a constant
 *  from (29 rich fields, 5 of them html).
 *  ★★ "The abuse shapes ABOVE" was wrong — only one of the two appears above
 *  this docstring; the other lives in the register and in a test. Name a shape
 *  or cite where it lives; a positional reference rots the moment either
 *  paragraph moves.
 *  ★ The +1024 keeps a small `max` from rejecting its own wrapper markup, and
 *  it governs the small-`max` regime ALONE — at max 5000 it is 1024 against a
 *  160,000-byte K term and cannot change any verdict, which is why every test
 *  that used max 5000 left it unpinned. `keeps a small-cap value alive on the
 *  floor alone` is the one that holds it. */
const RICH_BYTE_K = 32;
const RICH_BYTE_FLOOR = 1024;
// ★ NOT exported: it shipped `export`ed with zero consumers, and the tests
// deliberately spell `5000 * 32 + 1024` by hand rather than calling it — a test
// that derives both sides of a comparison from one constant pins nothing. Dead
// export surface reads as a supported API; `--max-warnings=0` does not flag an
// unused EXPORT, only an unused local. Export it when something needs to
// predict the ceiling, not before.
const richByteCeiling = (max: number): number => max * RICH_BYTE_K + RICH_BYTE_FLOOR;

/** The single entry point for the entity sanitizers: guard the type, strip
 *  control characters, upgrade legacy plain text, cap by text length, and drop
 *  a visually empty value.
 *
 *  ★★ The empty check is HERE and nowhere else. A value the user cleared in the
 *  editor arrives as "<p></p>" (or "<p><br></p>", or a paragraph of &nbsp;),
 *  all of which are TRUTHY — so every `if (description)` gate in the entity
 *  sanitizers would store a phantom empty paragraph instead of dropping the
 *  field. Returning "" makes all of them drop it automatically, and it covers
 *  the writers that never touch a modal: the AI entity create/update tools, the
 *  inline-AI apply, the project-proposal seed, bulk edit. Guarding at the six
 *  modal save boundaries instead would leave every one of those uncovered.
 *
 *  ★ Measure the VISIBLE text (htmlTextLength), not the markup: a value whose
 *  only content sits inside markup ("<p><strong>x</strong></p>") is NOT empty
 *  and must survive.
 *
 *  ★★★ `sink` is REQUIRED and is forwarded to descriptionHtml — see its comment
 *  for why there is no default. */
export function sanitizeRichText(raw: unknown, max: number, sink: RichTextSink): string {
  const s =
    typeof raw === "string" ? raw.replace(WS_CONTROL, " ").replace(CONTROL_CHARS, "") : "";
  const upgraded = descriptionHtml(s, sink);
  // ★★★ THE CEILING IS CHECKED BEFORE ANYTHING PROJECTS, AND THE ORDER IS THE
  // WHOLE POINT. capHtmlText measures htmlPlainProjection(html) — it projects
  // the FULL raw input before deciding anything, and that projection is the
  // work §251 bounds. A ceiling placed after it would bound what is STORED and
  // bound nothing about what is DONE. So this is a raw `.length` comparison,
  // O(1), and must never call the projection to decide.
  // ★★ The hard clip may cut mid-tag. That is safe ONLY because its output goes
  // straight to degradeToPlain, which flattens to text and cannot re-emit the
  // severed markup — do not reorder these two lines.
  const ceiling = richByteCeiling(max);
  let bounded = upgraded;
  if (upgraded.length > ceiling) {
    bounded = degradeToPlain(upgraded.slice(0, ceiling), max);
    // ★★★ logDiag, DELIBERATELY NOT lastLoadTruncation — AND NOT BECAUSE THE
    // SOURCE NO LONGER HOLDS THE DATA. An earlier revision of this comment said
    // exactly that ("a degrade is idempotent and already committed … protecting
    // data that exists nowhere else") and it is backwards on the only load that
    // matters. sanitizeRichText is a LOAD-path sanitizer (sanitize-records.ts →
    // workspace.ts), so on the FIRST load after this ships the source file or
    // Turso row still holds the full markup — which is precisely the premise
    // mayCommitAfterTruncation is built on, not a refutation of it. "Already
    // committed" only becomes true after the next save has overwritten the
    // source, i.e. after the loss is permanent.
    // ★★ The decision stands; the derivation does not. It is a JUDGEMENT: a
    // degrade is deterministic and reproduces identically on every reload, so
    // blocking every write would strand a user with a workspace the app refuses
    // to save over a value it will keep degrading the same way. The price is
    // that the first save makes it permanent with only this diag entry as the
    // record — visible here so that whoever next lowers RICH_BYTE_K sees what
    // they are trading, rather than inheriting a false reason.
    logDiag("warn", "rich-text-bytes-degraded", {
      before: upgraded.length,
      after: bounded.length,
      ceiling,
    });
  }
  const html = capHtmlText(bounded, max);
  return htmlTextLength(html) === 0 ? "" : html;
}
