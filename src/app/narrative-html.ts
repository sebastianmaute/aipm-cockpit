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
import { isHtmlStart } from "./html-start";

/** Stored narrative -> HTML. A legacy plain-text value is escaped and wrapped.
 *
 *  ★★ The "rich" sink is not a stylistic choice — it is the list the actual sink
 *  keeps. The narrative renders through RichTextView -> `sanitizeRichHtml`, whose
 *  allow-list IS `SINK_TAGS.rich`, so the MAP from sink name to tag list cannot
 *  drift (html-start.test.ts pins it empirically, per sanitizer).
 *  ★★★ THAT PINS THE MAP, NOT THIS ARGUMENT, and an earlier revision of this
 *  comment said "the two cannot drift" flatly. They can: the sink is a
 *  hand-written string literal here and nothing checks it against the sanitizer
 *  this value actually reaches. Measured 2026-08-11 — changing "rich" to
 *  "document" on the line below leaves narrative-html.test.ts 14/14 AND
 *  dashboard-sections/dashboard-narrative.test.tsx 20/20 GREEN (the directory
 *  is load-bearing: vitest given a path it cannot resolve runs only the file it
 *  can and still exits 0). Bounded today (the two lists differ
 *  by `img` alone, which a narrative has no way to contain), unbounded in shape.
 *  open-followups §143 owns the general case.
 *  ★★ It used to name the "note" sink, and the risk it guarded was the OPPOSITE
 *  direction: `sanitizeNoteHtml` set KEEP_CONTENT: false, so a classifier WIDER
 *  than its list made the sink delete a heading together with its text — that bug
 *  shipped once, "<h1>Q3</h1><p>ok</p>" rendering as "ok". No sanitizer deletes
 *  text any more, so over-recognising now costs formatting rather than words; the
 *  direction that still bites here is UNDER-recognising, which escapes the whole
 *  value into visible "&lt;h1&gt;" (§107). Deriving from the sink's own list
 *  covers both without a comment anybody has to honour. */
export function narrativeToHtml(stored: string | undefined): string {
  const s = (stored ?? "").trim();
  if (!s) return "";
  return isHtmlStart(s, "rich") ? s : plainToHtml(s);
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
