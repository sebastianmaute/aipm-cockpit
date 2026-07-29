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

/** Plain-text projection WITHOUT DOMPurify — the only projection legal in a
 *  sanitizer. `&amp;` decodes LAST, or "&amp;lt;" would double-decode to "<".
 *  For display/search/export use rich-text-projection.ts's descriptionText,
 *  which goes through the real sanitizer. */
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
  const s = typeof raw === "string" ? raw.replace(CONTROL_CHARS, "") : "";
  const html = capHtmlText(descriptionHtml(s), max);
  return htmlTextLength(html) === 0 ? "" : html;
}
