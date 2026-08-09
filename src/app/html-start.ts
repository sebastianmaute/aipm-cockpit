// src/app/html-start.ts
//
// "Is this stored value already HTML?" — one classifier per SINK.
//
// ★★★ THE RULE: never recognise more than your own sink KEEPS. A classifier
// narrower than its sink escapes a value the sink would have kept, and the escape
// covers the WHOLE value, permanently (open-followups §107 / §114). A classifier
// WIDER than its sink is worse where the sink deletes: sanitizeNoteHtml sets
// KEEP_CONTENT: false, so recognising a tag it strips removes the element AND its
// text — a bug already shipped and fixed once, where "<h1>Q3</h1><p>ok</p>"
// rendered as just "ok" and "<div>Status</div>" rendered as nothing.
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
 *  an empty alternation would compile to `<()\b[^>]*>`, which matches a bare
 *  "<>" and turns every stray angle bracket into "this is HTML". */
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
 *  tags match. The `\b` is also what stops a short name swallowing a longer one
 *  that shares its prefix: against "<strong>", the `s` alternative fails because
 *  `s` is followed by a word character, and the engine backtracks to `strong`. */
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
