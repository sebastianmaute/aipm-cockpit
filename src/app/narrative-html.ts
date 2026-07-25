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

const BLOCK_START = /^\s*<(p|ul|ol|h[1-6]|blockquote|div)\b/i;

/** Stored narrative -> HTML. A legacy plain-text value is escaped and wrapped. */
export function narrativeToHtml(stored: string | undefined): string {
  const s = (stored ?? "").trim();
  if (!s) return "";
  return BLOCK_START.test(s) ? s : plainToHtml(s);
}

/** Editor HTML -> the value to store. Newlines collapse to spaces: the markdown
 *  backend writes the narrative as ONE `- narrative: <value>` line and decodes it
 *  with a single-line regex (markdown-codecs-core.ts), so an embedded newline
 *  would silently truncate the narrative on a round-trip. */
export function normalizeNarrativeHtml(html: string): string {
  return html.replace(/[\r\n]+/g, " ").trim();
}

/** True when the HTML carries no visible text — e.g. the editor's empty `<p></p>`. */
export function isNarrativeEmpty(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim() === "";
}
