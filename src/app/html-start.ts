// src/app/html-start.ts
//
// "Is this stored value already HTML?" — one classifier per SINK.
//
// ★★★ THE RULE: never recognise more than your own sink KEEPS. A classifier
// narrower than its sink escapes a value the sink would have kept, and the escape
// covers the WHOLE value, permanently (open-followups §107 / §114). A concrete
// case of that direction: an imported or hand-edited value opening
// `<strong>bold</strong> lead` — real HTML the lean editor never produces itself
// (it always emits a block wrapper) but a workspace can perfectly well store —
// used to be classified as plain text and escaped into literal `&lt;strong&gt;`.
// That is why a sink's list carries its INLINE members too, not just its block
// ones. A classifier WIDER than its sink is worse where the sink deletes:
// sanitizeNoteHtml sets KEEP_CONTENT: false, so recognising a tag it strips
// removes the element AND its text — a bug already shipped and fixed once, where
// "<h1>Q3</h1><p>ok</p>" rendered as just "ok" and "<div>Status</div>" rendered
// as nothing.
//
// One shared constant cannot express that rule for four sinks, which is why the
// regexes are DERIVED from each sink's own allow-list rather than hand-mirrored.
//
// ★★ DOM-FREE. This module runs inside the entity sanitizers, which execute under
// bare node in scripts/generate-sample-workspace.ts. It imports tag arrays from
// sanitize-html.ts and calls nothing there — importing is safe, only a DOMPurify
// CALL needs a DOM.
import {
  DOCUMENT_ALLOWED_TAGS,
  NOTE_ALLOWED_TAGS,
  TEMPLATE_ALLOWED_TAGS,
} from "./sanitize-html";

/** A real HTML tag name. Used to drop "#text", which is a DOMPurify allow-list
 *  member but not a tag, and would otherwise enter the alternation as literal
 *  "#text". */
const TAG_NAME = /^[a-z][a-z0-9]*$/;

/** Never matches anything. Returned when no valid tag name survives the filter —
 *  an empty alternation would compile to `<()\b[^>]*>`, which matches "<" followed
 *  by any word character (e.g. "<b>", "<div>") and turns every such stray angle
 *  bracket into "this is HTML". Measured: it does NOT match a bare "<>" — `\b`
 *  needs a word character on at least one side, and there is none between "<"
 *  and ">". */
const NEVER = /(?!)/;

/** Build the "already HTML?" test for one allow-list.
 *
 *  ★ A leading CLOSING tag is deliberately NOT matched (no `\/?`): a stored value
 *  cannot legitimately begin with one — the editors cannot emit it and no
 *  well-formed HTML starts that way — so "</p> means close" is by construction
 *  plain text somebody typed. Passing it through makes the sink delete those
 *  literal characters.
 *
 *  ★ `\b[^>]*>` so void spellings (`<hr/>`, `<img src=…>`) and attribute-bearing
 *  tags match. The `\b` does NOT change the outcome for a tag that IS on the
 *  list — with `strong` and `s` both present, "<strong>" matches either way,
 *  since alternation is leftmost-first and (in every real sink) `strong` is
 *  listed before `s`, so `s` is never even tried. What `\b` actually decides is
 *  an UNLISTED tag that shares a listed one's prefix: without it, the `s`
 *  alternative matches the leading "s" of "<script>", "<section>", "<summary>"
 *  or "<strongish>" and `[^>]*>` swallows the rest of the name as if it were
 *  attributes — misclassifying each as already-HTML. Since `s` is a member of
 *  DOCUMENT_ALLOWED_TAGS, dropping `\b` would make the document and projection
 *  sinks treat a value starting "<script...>" as already-HTML. Measured, not
 *  reasoned — see the "does not let a short tag swallow" test below.
 *
 *  ★★★ The tag must be an OPENING tag that actually CLOSES — `[^>]*>` requires
 *  the terminating `>`. Accepting a bare opener classified a legacy PLAIN value
 *  that merely STARTS tag-shaped ("<li 3 items", "<p ok", "<em dash - not
 *  markup") as already-HTML: passed through raw instead of escaped, the HTML
 *  tokenizer DISCARDS an incomplete tag at EOF, so the whole value vanished —
 *  off the screen, out of search, out of exports, out of the AI digests. And it
 *  vanished SILENTLY: a text-length count taken over the unclosed value is still
 *  non-zero, so no empty-state fallback ever fired either. Escaped instead, the
 *  user reads their own text — the same resolution the sink lists reach for a
 *  tag they don't recognise at all.
 *
 *  ★ RESIDUE, deliberately not chased: a value that is genuinely tag-shaped AND
 *  terminated but is not markup — "<a href> tags are banned" — still passes
 *  through, and the sink eats the "<a href>" fragment. A heuristic on the
 *  opening tag alone cannot separate that from real markup; more regex would
 *  only move the boundary, not close it. */
export function htmlStartRe(tags: readonly string[]): RegExp {
  const names = tags.filter((t) => TAG_NAME.test(t));
  if (names.length === 0) return NEVER;
  return new RegExp(`^\\s*<(${names.join("|")})\\b[^>]*>`, "i");
}

/** Which sink the classified value is on its way to.
 *
 *  ★ "projection" is NOT a sink — descriptionText/descriptionTextWithBreaks strip
 *  every tag. It takes the WIDEST list because the rule above does not bind on a
 *  strip-everything pass: over-recognising costs nothing there, while
 *  under-recognising emits literal "<h1>Title</h1>" as visible text into search,
 *  the AI digests and every export. It is a distinct member from "document" even
 *  though the lists are equal today, so a reader sees WHY it is widest. */
export type RichTextSink = "note" | "template" | "document" | "projection";

export const SINK_TAGS: Record<RichTextSink, readonly string[]> = {
  note: NOTE_ALLOWED_TAGS,
  template: TEMPLATE_ALLOWED_TAGS,
  document: DOCUMENT_ALLOWED_TAGS,
  projection: DOCUMENT_ALLOWED_TAGS,
};

const SINK_RE: Record<RichTextSink, RegExp> = {
  note: htmlStartRe(SINK_TAGS.note),
  template: htmlStartRe(SINK_TAGS.template),
  document: htmlStartRe(SINK_TAGS.document),
  projection: htmlStartRe(SINK_TAGS.projection),
};

/** True when `value` opens with a tag `sink` will keep. */
export function isHtmlStart(value: string, sink: RichTextSink): boolean {
  return SINK_RE[sink].test(value);
}
