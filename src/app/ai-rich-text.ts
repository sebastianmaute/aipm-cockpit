// src/app/ai-rich-text.ts — the write boundaries for a rich field whose value
// came from a MODEL (chat tools, the inline-AI confirm replay, the
// project-proposal seed, AI document authoring) rather than from the editor.
//
// TWO of them, same two layers. ★★★ THE TAG LISTS ARE NEARLY THE SAME NOW AND THE
// CAPS ARE NOT — read the caps as the load-bearing difference:
//   • `sanitizeAiRichText`         -> `sanitizeRichHtml` (RICH_ALLOWED_TAGS), cap
//     `TEXTAREA_MAX` (5 000). Guards Task.description and, via `withAiRichFields`,
//     the six rich raid/change/milestone fields.
//   • `sanitizeAiDocumentRichText` -> `sanitizeDocumentHtml`, cap
//     `MAX_HTML_TEXT_CHARS` (20 000). Guards model-authored document paragraph
//     HTML only.
// ★★ The allow-list gap used to be nine tags (s/code/pre/blockquote/hr/mark/sub/
// sup/img) and is now exactly ONE: `img`, since DOCUMENT_ALLOWED_TAGS spreads
// RICH_ALLOWED_TAGS. Do not read the two as interchangeable anyway — swapping them
// changes the CAP, and exceeding a cap does not merely shorten the value:
// capHtmlText's truncation branch returns `plainToHtml(text.slice(...))`, which
// FLATTENS every mark to escaped plain text. Wiring a document boundary to the
// entity helper therefore loses `<img>` AND flattens anything over 5 000 visible
// characters.
//
// ★★★ Why this exists as its own module rather than living in rich-text-plain.ts:
// it CALLS DOMPurify, and rich-text-plain.ts must never do that — it runs inside
// the entity sanitizers under bare node, where a DOMPurify call throws and
// jsonToWorkspace's catch-all converts the throw into an EMPTY workspace that then
// "successfully" writes near-empty sample files. Every caller here is browser-side
// (a React hook or a browser-only proposal path), so the DOM is there; keeping it
// out of the DOM-free module is what preserves that guarantee.
import { MAX_HTML_TEXT_CHARS } from "./document-model";
import { sanitizeRichText } from "./rich-text-plain";
import { DOCUMENT_SINK, RICH_SINK } from "./html-start";
import { sanitizeDocumentHtml, sanitizeRichHtml } from "./sanitize-html";
import { TEXTAREA_MAX } from "./sanitize";

/** Model-supplied value -> stored rich HTML.
 *
 *  Two layers, in this order and for different reasons:
 *  1. `sanitizeRichText` — UPGRADE-AWARE. A model may send plain prose OR HTML
 *     (it is routinely handed the stored HTML to read and echoes it back), so the
 *     boundary must accept both. `plainToHtml` alone ESCAPES `& < >`, which stored
 *     HTML as "<p>&lt;p&gt;&lt;strong&gt;…" — literal tags in the field, in every
 *     export and in the search index. It also strips control characters, caps on
 *     VISIBLE text and drops a visually-empty value.
 *  2. `sanitizeRichHtml` — the ALLOW-LIST. Layer 1 is DOM-free and therefore
 *     cannot sanitize; on its own it persists `<script>` verbatim. Model output is
 *     influenceable by a document the user uploads, so the value gets an actual
 *     DOMPurify pass before it reaches six storage backends.
 *
 *  ★★★ KEEP_CONTENT must stay at DOMPurify's DEFAULT here, and there is no longer
 *  a sanitizer in this repo that violates that. The retired `sanitizeNoteHtml` set
 *  it to `false`, which deleted the TEXT inside a non-allow-listed tag along with
 *  the tag — wrong here, because a model legitimately emits `<div>`/`<table>` and
 *  the user's words would vanish silently. `sanitizeRichHtml` unwraps instead, so a
 *  disallowed tag loses its markup and keeps its text, while `<script>`/`<style>`
 *  are removed with their contents (DOMPurify does that regardless) and its
 *  end-anchored ALLOWED_URI_REGEXP drops a `javascript:` href.
 *
 *  ★★ A value that STARTS with a tag used to be escaped WHOLE into permanent
 *  visible tags, because one shared 8-tag classifier (p/br/strong/em/ul/ol/li/a,
 *  since retired) answered "is this HTML?" for every sink. Layer 1 now takes the
 *  sink and `isHtmlStart(value, "rich")` derives its test from RICH_ALLOWED_TAGS,
 *  the same list layer 2 keeps, so `<h1>T</h1><p>b</p>` survives as markup
 *  (open-followups.md §107, CLOSED 2026-08-10). A leading `<div>`, `<h5>` or
 *  `<!--comment-->` is not on that list and is still escaped whole.
 *  ★★ The OPPOSITE direction of the same question is a DIFFERENT and STILL-OPEN
 *  defect — open-followups.md §32, plain prose that merely looks tag-shaped taken
 *  for HTML. Do not read §107's closure as closing it. */
export function sanitizeAiRichText(raw: unknown): string {
  const upgraded = sanitizeRichText(raw, TEXTAREA_MAX, RICH_SINK);
  if (!upgraded) return "";
  const clean = sanitizeRichHtml(upgraded);
  // The allow-list pass can empty a value whose only content was a disallowed
  // element (e.g. "<p><script>x</script></p>"), so re-apply the empty rule —
  // otherwise a phantom "<p></p>" reaches the `if (description)` gates.
  return sanitizeRichText(clean, TEXTAREA_MAX, RICH_SINK);
}

/** The DOCUMENTS variant of the boundary above — model-supplied value -> stored
 *  document-block HTML. Same two layers in the same order and for the same
 *  reasons; only the allow-list differs, and it is the WIDER documents one
 *  (`sanitizeDocumentHtml`: the template tags plus s/code/pre/blockquote/hr/
 *  mark/sub/sup/img). A model writing `<mark>` into a document had it unwrapped
 *  at the write before this existed.
 *
 *  ★★★ A SEPARATE FUNCTION, NOT A PARAMETER ON `sanitizeAiRichText`. The two
 *  boundaries guard different storage: this one only ever sees document blocks,
 *  while `sanitizeAiRichText` also guards the six rich entity description fields
 *  (raid/change/milestone) whose list must NOT widen. Threading the sanitizer
 *  through as an argument would put the wider list one defaulted/mistyped
 *  parameter away from every entity field — the "parameterizing divergent guard
 *  chains is where a config slip silently weakens a guard" rule. Two call sites,
 *  two names, no way to hand entity HTML the document list by accident.
 *
 *  ★★ `raw` is `unknown`, matching the sibling: the caller reads `block.html`
 *  off a model-supplied object, so it is genuinely untyped. Layer 1 coerces a
 *  non-string to "" itself — do not narrow this to `string`.
 *
 *  ★★★ THE CAP IS `MAX_HTML_TEXT_CHARS` (20 000), NOT the sibling's
 *  `TEXTAREA_MAX` (5 000), and copying the sibling's number here DEFEATED this
 *  whole boundary above 5 000 characters. Exceeding the cap does not merely
 *  SHORTEN the value: `capHtmlText`'s truncation branch returns
 *  `plainToHtml(text.slice(0, cut))`, which FLATTENS all markup to escaped plain
 *  text. So a model-authored paragraph of 10 006 visible characters carrying a
 *  `<mark>` came out at 4 999 characters with the mark gone — half the text lost
 *  AND the exact tag the wider allow-list exists to preserve. Measured, not
 *  reasoned. `MAX_HTML_TEXT_CHARS` is what `document-model.ts`'s structural
 *  layer already enforces on `paragraph.html` (`sanitizeBlock`, via the same
 *  `capHtmlText`), and `sanitizeAiDocBlocks` runs this boundary FIRST — so the
 *  tighter number silently wins unless the two agree. Keep them on one constant.
 *
 *  ★★ The trailing `sanitizeRichText` re-run is why this mirrors the sibling
 *  line-for-line rather than collapsing to a one-liner: the allow-list pass can
 *  empty a value whose only content was a disallowed element (e.g.
 *  "<p><script>x</script></p>"), and the re-run turns the resulting phantom
 *  "<p></p>" back into "".
 *  ★ Be precise about what that buys HERE, because it is NOT what it buys for the
 *  sibling: on this path it is defense-in-depth, not the thing doing the work.
 *  `sanitizeAiDocBlocks`'s structural layer already drops an empty paragraph via
 *  its own `htmlTextLength(html) === 0` check, so the block disappears either way
 *  — MEASURED, not assumed: `htmlTextLength("<p></p>")` is 0 and that input
 *  returns []. It is kept so the two boundaries stay identical in shape and
 *  cannot drift, and so the cap is re-applied after the allow-list. The sibling's
 *  callers have no such structural layer, which is where the empty rule is load
 *  bearing.
 *
 *  ★★ THE SIBLING'S CLASSIFIER CAVEAT APPLIED HERE TOO, WITH A BIGGER BLAST
 *  RADIUS, AND IT IS NOW CLOSED. While one shared 8-tag classifier answered "is
 *  this HTML?" for every sink, a document paragraph STARTING with any of the nine
 *  tags this wider list adds (`<mark>`, `<s>`, `<code>`, `<pre>`, `<blockquote>`,
 *  `<sub>`, `<sup>`, `<hr>`, `<img>`) failed the test, `plainToHtml` escaped the
 *  WHOLE value, and the tags became permanent literal visible text — measured for
 *  all nine (open-followups.md §114, CLOSED 2026-08-10). `isHtmlStart(value,
 *  "document")` derives its test from `DOCUMENT_ALLOWED_TAGS`, so this
 *  classifier cannot recognise less than layer 2 keeps.
 *  ★ Widening the one shared constant was the naive repair and was never
 *  available: the "note" sink (the dashboard narrative, the note log) is
 *  `KEEP_CONTENT: false` and DELETES an unrecognised tag's text instead of
 *  unwrapping it, so one list cannot serve both. `html-start.ts` states that rule
 *  and its reasoning — read it there rather than re-deriving it here.
 *  ★★ Cite §32 CAREFULLY — same question, OPPOSITE direction, and STILL OPEN.
 *  §32 is the FALSE POSITIVE (plain prose like "<a note about pricing> is
 *  attached" is taken for HTML and the pseudo-tag's words are then deleted); what
 *  §114 closed was the FALSE NEGATIVE (real HTML taken for prose and escaped).
 *  Per-sink derivation closed the false negative only. Do not read a fix for §32
 *  as closing that, and do not close §32 by pointing at §114. */
export function sanitizeAiDocumentRichText(raw: unknown): string {
  const upgraded = sanitizeRichText(raw, MAX_HTML_TEXT_CHARS, DOCUMENT_SINK);
  if (!upgraded) return "";
  const clean = sanitizeDocumentHtml(upgraded);
  return sanitizeRichText(clean, MAX_HTML_TEXT_CHARS, DOCUMENT_SINK);
}

/** The rich fields each AI-writable entity owns.
 *
 *  ★★★ `Task.description` is NOT here: its boundary calls `sanitizeAiRichText`
 *  directly, because the dispatcher builds that patch field-by-field. The other
 *  three hand a WHOLE OBJECT to their entity sanitizer, and those sanitizers are
 *  DOM-FREE (`sanitize-records.ts` → `sanitizeRichText`) so they CANNOT run an
 *  allow-list — which is exactly why the model's value must be cleaned before it
 *  gets there. Verified directly: `sanitizeRaidItem({… description:
 *  "<p>ok</p><script>alert(1)</script>"})` stored that script verbatim. */
export const AI_RICH_FIELDS = {
  raid: ["description", "mitigation"],
  change: ["description", "impactDescription", "resolutionNotes"],
  milestone: ["description"],
} as const;

/** Clean the named rich fields on a MODEL-supplied object, leaving the rest alone.
 *
 *  ★★ Apply this to the model's INPUT/PATCH, never to the merged entity: an update
 *  spreads the already-stored value, and re-running the allow-list over storage
 *  would rewrite bytes this call never asked to touch (and would unwrap a tag some
 *  older path legitimately stored).
 *
 *  ★★ A field the model did not supply is SKIPPED, not blanked — `undefined` has
 *  to stay `undefined` so an update patch keeps meaning "leave this alone".
 *  Without that guard, renaming a RAID item would erase its stored description and
 *  mitigation; both halves are mutation-proved in the tests. */
export function withAiRichFields<T extends object>(raw: T, fields: readonly string[]): T {
  let out: Record<string, unknown> | null = null;
  for (const field of fields) {
    const value = (raw as Record<string, unknown>)[field];
    if (value === undefined) continue;
    out ??= { ...(raw as Record<string, unknown>) };
    out[field] = sanitizeAiRichText(value);
  }
  return (out ?? raw) as T;
}
