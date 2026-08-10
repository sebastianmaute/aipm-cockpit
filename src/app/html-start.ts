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
// One shared constant cannot express that rule for five sinks, which is why four
// of the regexes are DERIVED from their own sink's allow-list rather than
// hand-mirrored. The fifth, "render", has no allow-list to derive from — see the
// note on its SINK_RE member.
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

/** Matches a well-formed opening tag ANYWHERE in the value — the classifier for
 *  the "render" sink, and deliberately UNANCHORED where the four derived ones
 *  are anchored at the start. Named for what it tests: it answers "does this
 *  CONTAIN a tag?", not "does this START with one?". See the SINK_RE member for
 *  why that is the right question there, and `isHtmlStart` for why one function
 *  asks two. */
const CONTAINS_TAG = /<[a-z][a-z0-9]*\b[^>]*>/i;

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
 *  alternative matches the leading "s" of "<script>", "<section>" or
 *  "<summary>" and `[^>]*>` swallows the rest of the name as if it were
 *  attributes — misclassifying each as already-HTML. Since `s` is a member of
 *  DOCUMENT_ALLOWED_TAGS, dropping `\b` would make the document and projection
 *  sinks treat a value starting "<script...>" as already-HTML. Measured, not
 *  reasoned — see the "does not let a short tag swallow" test below.
 *
 *  ★ "<strongish>" belongs to the same class but reaches it by a DIFFERENT
 *  alternative, and an earlier revision listed it beside the three above as if
 *  it did not. Measured with `\b` removed: "<script>", "<section>" and
 *  "<summary>" capture "s", while "<strongish>" captures "strong" — leftmost
 *  alternation reaches `strong` first and never tries `s`. Same wrong outcome,
 *  so `\b` is what fixes both, but a prefix-swallow is not always the SHORTEST
 *  listed tag doing the swallowing. Do not reason about which alternative wins;
 *  run the regex.
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

/** The four sinks whose classifier is DERIVED from an allow-list.
 *
 *  ★★★ "projection" is NOT a sink — descriptionText/descriptionTextWithBreaks
 *  strip every tag, so THE RULE above (never recognise less than your sink keeps)
 *  does not bind here and the list is a straight TRADE between two defects
 *  instead. It takes the WIDEST list, and that is a decision, not a free lunch:
 *
 *    - UNDER-recognising is the §107/§114 direction — a stored "<h1>Title</h1>"
 *      is escaped whole and emits literal "&lt;h1&gt;" as visible text into
 *      search, the AI digests and every export.
 *    - OVER-recognising is the §32 direction — a plain sentence that merely
 *      OPENS tag-shaped is passed through, and the strip pass then eats that
 *      fragment along with its angle brackets. Measured 2026-08-10 through the
 *      real descriptionText: "<mark> means highlight in this project" projects
 *      to "means highlight in this project" — the opening fragment DROPPED.
 *      Widening from 8 tag names to 20 widened that surface: `code`,
 *      `blockquote`, `s` and `h1` all behave the same way now, while "<table>
 *      layouts are deprecated" is untouched because `table` is not on the list.
 *
 *  We take that trade deliberately: under-recognising is the commoner and far
 *  louder failure (an AI-authored heading is real markup a workspace stores every
 *  day; a sentence opening with a bare "<mark>" is rare), and its damage is
 *  visible in every surface at once. §32 stays open and unchanged in kind.
 *
 *  It is a distinct member from "document" even though the lists are equal today,
 *  so a reader sees WHY it is widest. */
export type DerivedSink = "note" | "template" | "document" | "projection";

/** Which sink the classified value is on its way to. "render" is the one member
 *  with no allow-list behind it — see its SINK_RE entry. */
export type RichTextSink = DerivedSink | "render";

export const SINK_TAGS: Record<DerivedSink, readonly string[]> = {
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

  /** ★★★ The one sink NOT derived from an allow-list, and that is FORCED rather
   *  than lazy. Its consumers keep every tag's TEXT: sanitizeDocumentHtml runs
   *  DOMPurify at the KEEP_CONTENT default, which UNWRAPS an unlisted tag and
   *  keeps what is inside it, and htmlToRichLines parses whatever it is given
   *  and keeps the text of any tag at all. By THE RULE at the top of this file
   *  — never recognise LESS than your sink keeps — a render classifier must
   *  therefore recognise EVERY tag. No allow-list can express that; "document"
   *  is the widest one there is and is still too narrow.
   *
   *  Deriving it from a list is strictly WORSE than the sink's own fallback,
   *  because the miss escapes the WHOLE value where the sink would merely have
   *  unwrapped one tag. Measured on the "document" sink: "<h3>Sub</h3>"
   *  rendered as "Sub" before and as "<p>&lt;h3&gt;Sub&lt;/h3&gt;</p>" after,
   *  and "<div>Status</div>" and a stored <table> went the same way. The
   *  upgrade itself is still needed here — that is open-followups §118, where a
   *  legacy plain "a\nb" fused into one run-on line — so the answer is not to
   *  drop the classifier but to ask the other question: "is this plain text at
   *  all?"
   *
   *  ★★★ Which is why it is UNANCHORED. A leading-tag test is still the DERIVED
   *  sinks' question, and asking it here escaped real markup that merely does
   *  not OPEN with a tag: "Intro <strong>bold</strong> tail" reached Word,
   *  PowerPoint, the HTML preview and the PDF as the literal characters
   *  "&lt;strong&gt;". Nothing is stored at a render boundary, so a false NO is
   *  the loud, permanent-looking failure and the one to avoid.
   *
   *  ★★ It is a TRADE, not a free lunch, and it is the factory's RESIDUE
   *  paragraph one step wider: prose that merely MENTIONS a terminated tag
   *  ("we banned <a href> tags") now passes through too, and what the parser
   *  then does to that fragment is NOT uniform — measured through the real
   *  sanitizeDocumentHtml, an UNLISTED tag is eaten ("use <div> for layout" →
   *  "use  for layout"), a LISTED one survives whole ("we banned <hr> rules" →
   *  unchanged), and the <a> case is the worst of the three: "we banned <a
   *  href> tags" → 'we banned <a href=""> tags</a>', a LIVE anchor wrapping the
   *  remainder of the paragraph. Anchored, only a value OPENING that way was
   *  exposed. We take it for the same reason the projection sink takes its
   *  trade — real markup is the commoner input and its damage shows up in every
   *  rendered surface at once.
   *
   *  ★★★ Do NOT "restore" the anchor on the strength of that paragraph. It
   *  compares against the ANCHORED form, which only ever existed inside this
   *  branch; against the merge base the unanchored classifier is a
   *  RESTORATION, not a widening. Measured at 528dd5fe, where these three
   *  renderers called their sanitizer with no classifier at all: every value
   *  CONTAINING a tag renders byte-identically before and after, including all
   *  three cases above. The only behaviour change vs. the merge base is the
   *  §118 fix ("a\nb" → two lines instead of one fused run). Re-anchoring does
   *  not undo a trade — it reintroduces the escaped-markup defect.
   *
   *  It keeps all three guards, because it reuses the same shape: the tag must
   *  actually CLOSE (`[^>]*>`, so "<li 3 items" escapes), it must start with a
   *  LETTER (so "<3 open" and "cost < 5k" escape), and a CLOSING tag is never
   *  matched (so "</p> means close" escapes). */
  render: CONTAINS_TAG,
};

/** True when `value` is already HTML for `sink`.
 *
 *  ★★★ THE NAME IS ONLY HALF TRUE, because this asks TWO questions. For the
 *  four DERIVED sinks it is "does `value` START with a tag this sink keeps?" —
 *  a STORAGE question, where a NO escapes the whole value and that escaped form
 *  is what gets persisted, so a mid-sentence "<" is read conservatively. For
 *  "render" it is "does `value` CONTAIN any tag at all?" — a RENDER question,
 *  where nothing is stored and the consumers keep every tag's text, so the only
 *  failure mode left is escaping real markup and the leading-tag test is simply
 *  the wrong one. The export keeps its name because callers and docs already
 *  use it; the render regex is named for what it actually tests. */
export function isHtmlStart(value: string, sink: RichTextSink): boolean {
  return SINK_RE[sink].test(value);
}
