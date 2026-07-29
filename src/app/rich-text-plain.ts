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
import { HTML_START } from "./narrative-html";

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
const BLOCK_TAG = /<\/?(?:p|div|br|li|ul|ol|h[1-6]|blockquote|tr|td|th)\b[^>]*>/gi;
/** The remaining (inline) tags, which project to nothing.
 *  ★★ The leading `[a-zA-Z]` models the HTML tokenizer: a `<` is only a tag
 *  opener when a letter (or `/`) follows it. A bare `<[^>]*>` ate everything
 *  from a literal "<" to the next ">" — "cost < 5k and rising" became "cost" —
 *  and a value left visually empty that way is DROPPED by the `if (description)`
 *  gates in the entity sanitizers. */
const TAG = /<\/?[a-zA-Z][^>]*>/g;
/** A non-breaking space in every spelling the editor or a paste can produce. */
const NBSP = /&nbsp;|&#0*160;|&#x0*a0;/gi;
/** Runs of whitespace — including the ones the boundary spaces above introduce
 *  — collapse to one, so a boundary costs exactly the single space it means. */
const WS_RUN = /\s+/g;

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
    // Lone surrogates are not characters and fromCodePoint throws on them.
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
 *  here, in the one module that owns BLOCK_TAG — a second copy would drift. */
export function separateBlockBoundaries(html: string): string {
  return html.replace(BLOCK_TAG, " ");
}

/** A stored value -> HTML. Already-HTML passes through; legacy plain text is
 *  escaped and wrapped. Idempotent — this runs on every load. */
export function descriptionHtml(stored: string | undefined): string {
  const s = (stored ?? "").trim();
  if (!s) return "";
  return HTML_START.test(s) ? s : plainToHtml(s);
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
 *  passes, and refuse to emit & < > — see UNSAFE_CODE_POINTS. */
export function htmlPlainProjection(html: string): string {
  return decodeNumericEntities(html.replace(BLOCK_TAG, " ").replace(TAG, ""))
    .replace(NBSP, " ")
    .replace(WS_RUN, " ")
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
 *  re-wrapped, so the result is always well-formed; formatting is lost only on
 *  overflow, which the editor-side counter warns about first. */
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
  // ★ max <= 0 is unreachable from the app (every caller passes the constant
  // TEXTAREA_MAX) but safe anyway, and covered by a test rather than assumed:
  // charCodeAt(-1) is NaN, every comparison with NaN is false, so cut stays 0
  // and plainToHtml("") returns "".
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
 *  and must survive. */
export function sanitizeRichText(raw: unknown, max: number): string {
  const s =
    typeof raw === "string" ? raw.replace(WS_CONTROL, " ").replace(CONTROL_CHARS, "") : "";
  const html = capHtmlText(descriptionHtml(s), max);
  return htmlTextLength(html) === 0 ? "" : html;
}
