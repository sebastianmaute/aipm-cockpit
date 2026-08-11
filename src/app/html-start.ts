// src/app/html-start.ts
//
// "Is this stored value already HTML?" — one classifier per SINK.
//
// ★★★ THE RULE: never recognise LESS than your own sink KEEPS. A classifier
// narrower than its sink escapes a value the sink would have kept, and the escape
// covers the WHOLE value, permanently (open-followups §107 / §114). A concrete
// case of that direction: an imported or hand-edited value opening
// `<strong>bold</strong> lead` — real HTML the lean editor never produces itself
// (it always emits a block wrapper) but a workspace can perfectly well store —
// used to be classified as plain text and escaped into literal `&lt;strong&gt;`.
// That is why a sink's list carries its INLINE members too, not just its block
// ones. ★ An earlier revision of this line opened "never recognise MORE", which
// inverts it — while the two back-references further down this file and AGENTS.md
// all state it the way it is stated here.
//
// ★★ Recognising MORE is the other half of the rule, and it USED to be the worse
// half: it is only costly where a sink DELETES instead of unwrapping, and the
// retired `sanitizeNoteHtml` set `KEEP_CONTENT: false`, so recognising a tag it
// stripped removed the element AND its text — a bug shipped and fixed once, where
// "<h1>Q3</h1><p>ok</p>" rendered as just "ok" and "<div>Status</div>" rendered as
// nothing. ★★★ NO SINK DELETES ANY MORE. Both remaining sanitizers run DOMPurify's
// KEEP_CONTENT default, so over-recognising now costs formatting rather than
// words, and that asymmetry is what let the former "note" and "template" members
// merge into the single "rich" sink below: two lists over one question only ever
// cost anything because the narrower of them fed a deleting sanitizer (§137).
// ★★ Do not read "no sink deletes" as licence to widen a classifier freely — the
// "projection" member below documents a real over-recognition cost (§32) that has
// nothing to do with KEEP_CONTENT. Read the rule against a sink's own behaviour,
// never against which members happen to be listed here.
//
// One shared constant cannot express that rule for four sinks, which is why three
// of the regexes are DERIVED from their own sink's allow-list rather than
// hand-mirrored. The fourth, "render", has no allow-list to derive from — see the
// note on its SINK_RE member.
//
// ★★ DOM-FREE. This module runs inside the entity sanitizers, which execute under
// bare node in scripts/generate-sample-workspace.ts. It imports tag arrays from
// sanitize-html.ts and calls nothing there — importing is safe, only a DOMPurify
// CALL needs a DOM.
import { DOCUMENT_ALLOWED_TAGS, RICH_ALLOWED_TAGS } from "./sanitize-html";

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
 *  attributes — misclassifying each as already-HTML. `s` is a member of
 *  RICH_ALLOWED_TAGS, and DOCUMENT_ALLOWED_TAGS spreads that array, so dropping
 *  `\b` would make ALL THREE derived sinks — rich, document AND projection —
 *  treat a value starting "<script...>" as already-HTML. ★★ "rich" is the one
 *  that matters most: it is the STORAGE classifier for the seven rich entity
 *  fields, so a reader asking "is the rich storage path exposed?" must read this
 *  as YES. (It said "the document and projection sinks" while `s` lived only on
 *  DOCUMENT_ALLOWED_TAGS, and the sentence outlived that fact by one commit.)
 *  Measured, not reasoned — see the "does not let a short tag swallow" test below.
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

/** The three sinks whose classifier is DERIVED from an allow-list.
 *
 *  ★★ "rich" is the ONE storage classifier for every rich surface except
 *  documents — the seven rich entity fields (`Task.description` plus the six in
 *  `AI_RICH_FIELDS`), note-log entries, the dashboard narrative, comm templates and
 *  meeting reports. It replaced two members, "note" (8 tag names) and "template"
 *  (11), which asked one question and answered it differently; because the narrow
 *  one fed a KEEP_CONTENT:false sanitizer, the disagreement cost words on every
 *  JSON and IndexedDB load with no human and no save involved (open-followups
 *  §137). Do not reintroduce a second lean member: a surface that needs less
 *  markup should render less, not classify differently.
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
 *      Widening from the 8 tag names the old "note" list carried to the 22 this
 *      one does widened that surface: `code`, `blockquote`, `s` and `h1` all
 *      behave the same way now, while "<table> layouts are deprecated" is
 *      untouched because `table` is not on the list. (The count was 20 before
 *      DOCUMENT_ALLOWED_TAGS began deriving from RICH_ALLOWED_TAGS and gained
 *      `h3`/`h4`.)
 *
 *  We take that trade deliberately: under-recognising is the commoner and far
 *  louder failure (an AI-authored heading is real markup a workspace stores every
 *  day; a sentence opening with a bare "<mark>" is rare), and its damage is
 *  visible in every surface at once. §32 stays open and unchanged in kind.
 *
 *  It is a distinct member from "document" even though the lists are equal today,
 *  so a reader sees WHY it is widest. */
export type DerivedSink = "rich" | "document" | "projection";

/** Which sink the classified value is on its way to. "render" is the one member
 *  with no allow-list behind it — see its SINK_RE entry. */
export type RichTextSink = DerivedSink | "render";

export const SINK_TAGS: Record<DerivedSink, readonly string[]> = {
  rich: RICH_ALLOWED_TAGS,
  document: DOCUMENT_ALLOWED_TAGS,
  projection: DOCUMENT_ALLOWED_TAGS,
};

const SINK_RE: Record<RichTextSink, RegExp> = {
  rich: htmlStartRe(SINK_TAGS.rich),
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
   *  unwrapped one tag. Measured on the "document" sink: "<div>Status</div>"
   *  rendered as "Status" before and as "<p>&lt;div&gt;Status&lt;/div&gt;</p>"
   *  after, and a stored <table> went the same way. ★ That measurement's third
   *  case was "<h3>Sub</h3>"; h3 joined the document list when it began deriving
   *  from RICH_ALLOWED_TAGS, so that value IS recognised there now and is no
   *  longer an instance of the miss — the two that remain are unaffected. The
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
 *  three DERIVED sinks it is "does `value` START with a tag this sink keeps?" —
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
