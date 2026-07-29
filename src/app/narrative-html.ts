// src/app/narrative-html.ts
//
// Pure helpers for the dashboard status narrative, which became rich text in R3.
// A legacy plain-text narrative is upgraded on READ and never rewritten on disk
// until the user saves, so an untouched project's stored bytes are unchanged.
//
// ★ No DOMPurify call here and none in sanitizeProjectStatus: sanitisation is a
// SINK concern (see RichTextView). DOMPurify has no DOM under bare node, where
// the codecs run in the sample/fixture scripts.
import { plainToHtml } from "./sanitize-html";

/** A stored narrative is already HTML when it OPENS with a tag we recognise.
 *
 *  ★ The INLINE members (strong/em/a/br) matter as much as the block ones: the
 *  lean editor always emits a block wrapper, but an imported or hand-edited
 *  workspace can perfectly well store `<strong>bold</strong> lead`, and treating
 *  that as legacy plain text escaped it into literal `&lt;strong&gt;` markup on
 *  screen.
 *
 *  ★★ The set is EXACTLY sanitize-html.ts's NOTE_ALLOWED_TAGS (minus the `#text`
 *  pseudo-entry) — the sink sanitizer every one of these values is rendered
 *  through — and must stay aligned with it. Recognising a tag the sink STRIPS is
 *  worse than not recognising it at all: `sanitizeNoteHtml` runs KEEP_CONTENT
 *  false, so it deletes such an element together with its TEXT. h1-6, blockquote
 *  and div used to sit here on the theory that a legacy value opening with one
 *  should render "as it is today"; in fact it made `<h1>Q3</h1><p>ok</p>` render
 *  as just "ok" and `<div>Status</div>` render as nothing at all. Left OUT, the
 *  same value is escaped and the user still reads their text — which is what
 *  `<pre>` (never in this set) has correctly done all along.
 *
 *  ★ Anchored at the string start and each name is `\b`-terminated, so a plain
 *  narrative containing a stray `<` ("5 < 10 items", "<3 open") still escapes:
 *  the `<` is not leading, or what follows it is not a tag name. `\b` also keeps
 *  `<abbr>`/`<embed>`/`<pre>` out — they are not `a`/`em`/`p`.
 *
 *  ★★★ The tag must be an OPENING tag AND must actually CLOSE (`[^>]*>`).
 *  Matching a bare opener accepted a
 *  legacy PLAIN value that merely STARTS tag-shaped — "<li 3 items", "<p ok",
 *  "<em dash - not markup" — and passed it through raw instead of escaping it.
 *  The HTML tokenizer DISCARDS an incomplete tag at EOF, so the whole value then
 *  vanished: off the screen, out of search, out of exports, out of the AI
 *  digests. And it vanished SILENTLY, because the length these values report is
 *  non-zero — htmlTextLength/`sanitizeRichText` (which share this constant via
 *  rich-text-plain's descriptionHtml) measured 11 characters for "<li 3 items"
 *  and so KEPT the field, meaning no empty-state fallback ever fired either.
 *  Escaped instead, the user reads their own text — the same resolution the tag
 *  list above reaches for `<h1>`/`<div>`.
 *
 *  ★ RESIDUE, deliberately not chased: "<a href> tags are banned" is genuinely
 *  tag-shaped AND terminated, so it still passes through and the sink eats the
 *  `<a href>`. A heuristic on the opening tag cannot separate that from real
 *  markup; more regex would only move the boundary, not close it.
 *
 *  ★★ A leading CLOSING tag is NOT markup and must stay out (no `\/?`). A stored
 *  value cannot legitimately BEGIN with one — the lean editor cannot emit it and
 *  no well-formed HTML starts that way — so "</p> means close" is by
 *  construction plain text the user typed. Passing it through makes the sink
 *  delete those literal characters: the same silent loss this rule exists to
 *  prevent, in miniature. */
export const HTML_START = /^\s*<(p|br|strong|em|ul|ol|li|a)\b[^>]*>/i;

/** Stored narrative -> HTML. A legacy plain-text value is escaped and wrapped. */
export function narrativeToHtml(stored: string | undefined): string {
  const s = (stored ?? "").trim();
  if (!s) return "";
  return HTML_START.test(s) ? s : plainToHtml(s);
}

/** Editor HTML -> the value to store. Newlines collapse to spaces: the markdown
 *  backend writes the narrative as ONE `- narrative: <value>` line and decodes it
 *  with a single-line regex (markdown-codecs-core.ts), so an embedded newline
 *  would silently truncate the narrative on a round-trip. */
export function normalizeNarrativeHtml(html: string): string {
  return html.replace(/[\r\n]+/g, " ").trim();
}

/** A non-breaking space in every form the editor / a paste can produce: the named
 *  entity, both numeric spellings, and the literal character. The ENTITY forms are
 *  what matter — tag-stripping leaves them as the plain text "&#160;", which
 *  `trim()` cannot touch, so a narrative of blanks counted as non-empty and stored
 *  a value that renders an empty summary card. (The literal U+00A0 branch is
 *  belt-and-braces: `trim()` already drops it, but the emptiness rule should not
 *  depend on which of the three spellings arrived.) */
const NBSP = /&nbsp;|&#0*160;|&#x0*a0;|\u00a0/gi;

/** True when the HTML carries no visible text — e.g. the editor's empty `<p></p>`. */
export function isNarrativeEmpty(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(NBSP, " ").trim() === "";
}
