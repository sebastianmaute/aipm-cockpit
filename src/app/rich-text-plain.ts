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
const BLOCK_TAG = /<\/?(?:p|div|br|li|ul|ol|pre|h[1-6]|blockquote|tr|td|th)\b[^>]*>/gi;
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
 *  ★★ IT IS ALSO QUADRATIC on input with many `<` and no `>` — each opener
 *  scans to end of input for a `>` that is not there (seconds at 128 KB).
 *  ★★★ SO IS `BLOCK_TAG` ABOVE, and this note said it was not. `\b` only saves
 *  it from a tag name that does NOT match its alternation, which is why a
 *  `"<a"` fixture reported it clean; `"<p"` — the likeliest opener in this
 *  corpus — is quadratic on BOTH. Measured, open-followups §251. Do not repair
 *  one of these regexes and leave the other.
 *  ★★ §251 also RETRACTS its own advice against the obvious one-character fix
 *  (excluding `<` from `[^>]*`): the reason given was that it zeroes the
 *  projection for `alt="a>b"`, and that is measurably false — `[^<>]*` leaves
 *  that shape byte-identical. It is now the cheapest known option, with a real
 *  but different trade-off recorded there. Read the entry, not this summary,
 *  before changing either regex.
 *
 *  ★ History: both patterns once carried this same truncation and the safety
 *  was argued as a CANCELLATION between them. That argument was wrong — it held
 *  only for the one shape it was measured on, and real blocks were being
 *  deleted for shapes where the tail after the `>` was itself tag-like. See
 *  `ASSET_IMG_TEST_RE`'s docstring for the measurement. */
const TAG = /<\/?[a-zA-Z][^>]*>/g;
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
 *  projection can look right while the other is broken. */
export function markTaskItems(html: string): string {
  return html.replace(
    /<li\b[^>]*\bdata-type\s*=\s*"taskItem"[^>]*>\s*(?:<p\b[^>]*>)?/gi,
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

/** Cap by text length. Over cap, the value is projected to text, truncated and
 *  re-wrapped, so the result is always well-formed; formatting is lost on
 *  overflow.
 *
 *  ★ The RAID and Change editors warn first via their own CharCounter.
 *  milestone-edit-modal.tsx has no counter, no describeTextCap and no
 *  useAdjustmentTracker — a >5000-character milestone description loses all
 *  markup silently. That trade-off is accepted at that call site; this shared
 *  comment used to promise a warning only two of the three modals give. */
export function capHtmlText(html: string, max: number): string {
  if (!html) return "";
  const text = htmlPlainProjection(html);
  if (text.length <= max) return html;
  // ★★ `slice` counts UTF-16 CODE UNITS, so a cap landing inside an astral
  // character (emoji, rarer CJK, most symbols above the BMP) kept its LONE HIGH
  // SURROGATE. That is not a character: encoding it to UTF-8 replaces it with
  // U+FFFD, permanently. JSON.stringify escapes it as "\ud83d" and survives, so
  // the JSON and IndexedDB backends did NOT corrupt while CSV and Markdown DID —
  // a backend-dependent silent corruption, harder to diagnose than a uniform
  // one. Back the cut off by one so the character is dropped WHOLE.
  //
  // ★★★ `max <= 0` IS NOT ONE CASE, and an earlier revision of this comment got
  // it wrong: it said "charCodeAt(-1) is NaN … so cut stays 0", which is true at
  // max === 0 and FALSE at max < 0. At a negative max `cut` becomes `max`, and
  // `slice`'s end index then counts from the END — so capHtmlText(-1) returned
  // "<p>a\ud800</p>", a LONE SURROGATE, from the very function whose job is to
  // never emit one. Measured, not reasoned. `clipText` (sanitize-core.ts) hit
  // the identical trap and clamps; these two are documented as carrying the same
  // fix, so they must agree at the boundary or the claim is false.
  // ★ Still unreachable from the app — every caller passes TEXTAREA_MAX or
  // MAX_HTML_TEXT_CHARS — but "no caller passes one" is exactly the reasoning
  // this file now records as insufficient twice over.
  if (max <= 0) return "";
  const last = text.charCodeAt(max - 1);
  const cut = last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
  return plainToHtml(text.slice(0, cut));
}

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
  const html = capHtmlText(descriptionHtml(s, sink), max);
  return htmlTextLength(html) === 0 ? "" : html;
}
