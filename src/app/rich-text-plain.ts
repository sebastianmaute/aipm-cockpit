// src/app/rich-text-plain.ts
//
// DOM-FREE half of the rich-text description layer (RAID description +
// mitigation, Change description + impactDescription + resolutionNotes,
// Milestone description).
//
// ★★★ NOTHING HERE MAY CALL THE HTML SANITISER LIBRARY. These functions run
// inside the entity sanitizers, which execute under bare node in
// scripts/generate-sample-workspace.ts and the fixture flow. That library binds
// its `window` ONCE at module-eval; with no DOM the bind fails, its sanitize()
// throws, and jsonToWorkspace's catch-all silently swallows it into an EMPTY
// workspace — which then "successfully" writes near-empty sample files.
// Sanitisation is a SINK concern: RichTextView re-sanitises at render.
//
// Importing plainToHtml is safe (narrative-html.ts already does): only a CALL
// into that library needs a DOM, and plainToHtml deliberately makes none — it
// escapes &<> and adds only <p>/<br>, both in the note allow-list, which makes
// a sanitize pass a provable no-op.
//
// ★ The guard test (rich-text-plain.test.ts) SCANS THIS SOURCE for the
// library's name, so the comments above name it obliquely on purpose. A blunt
// source scan is what makes the guard impossible to defeat by aliasing an
// import; the cost is that this file cannot spell the word. Don't "fix" the
// wording back — it fails the guard.
import { plainToHtml } from "./sanitize-html";
import { HTML_START } from "./narrative-html";

/** Control characters that must never reach storage. \n (0x0a) and \r (0x0d)
 *  are DELIBERATELY absent: plainToHtml turns them into <br>. Written as \x
 *  escapes — a literal control byte corrupts the file to binary. */
const CONTROL_CHARS = /[\x00-\x09\x0b\x0c\x0e-\x1f]/g;

const TAG = /<[^>]*>/g;
/** A non-breaking space in every spelling the editor or a paste can produce. */
const NBSP = /&nbsp;|&#0*160;|&#x0*a0;/gi;

/** A stored value -> HTML. Already-HTML passes through; legacy plain text is
 *  escaped and wrapped. Idempotent — this runs on every load. */
export function descriptionHtml(stored: string | undefined): string {
  const s = (stored ?? "").trim();
  if (!s) return "";
  return HTML_START.test(s) ? s : plainToHtml(s);
}

/** Plain-text projection WITHOUT the sanitiser library — the only projection
 *  legal in a sanitizer. `&amp;` decodes LAST, or "&amp;lt;" would
 *  double-decode to "<". For display/search/export use
 *  rich-text-projection.ts's descriptionText, which goes through the real
 *  sanitizer. */
export function htmlPlainProjection(html: string): string {
  return html
    .replace(TAG, "")
    .replace(NBSP, " ")
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
  return plainToHtml(text.slice(0, max));
}

/** The single entry point for the entity sanitizers: guard the type, strip
 *  control characters, upgrade legacy plain text, cap by text length. */
export function sanitizeRichText(raw: unknown, max: number): string {
  const s = typeof raw === "string" ? raw.replace(CONTROL_CHARS, "") : "";
  return capHtmlText(descriptionHtml(s), max);
}
