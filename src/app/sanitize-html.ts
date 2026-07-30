// src/app/sanitize-html.ts — DOMPurify allow-list for communication-template HTML.
// The allow-list mirrors the Tiptap editor's schema (the only producer of this
// HTML), so sanitizing the editor output is a defense-in-depth storage boundary.
// Merge-field tokens ({{field}}) are plain text and pass through untouched.
import DOMPurify from "dompurify";

const ALLOWED_TAGS = ["p", "br", "strong", "em", "u", "h1", "h2", "ul", "ol", "li", "a"];
const ALLOWED_ATTR = ["href", "target", "rel"];

export function sanitizeTemplateHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // End-anchored so the storage boundary stays airtight on its own (not just
    // behind the editor's isSafeHttpUrl pre-filter): scheme must lead and no
    // angle-brackets/quotes may sneak into the value.
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):[^<>"]*$/i,
  });
}

// ★ narrative-html.ts's HTML_START mirrors this list (minus "#text"): it decides
// whether a stored narrative is already HTML, and recognising a tag THIS list
// omits means the sink below deletes the element and its text. Edit both together.
const NOTE_ALLOWED_TAGS = ["p", "br", "strong", "em", "ul", "ol", "li", "a", "#text"];
const NOTE_ALLOWED_ATTR = ["href", "target", "rel"];

/** Storage-boundary sanitizer for task Description + note-log HTML (lean set:
 *  bold/italic/lists/links). Mirrors the Tiptap editor schema. */
export function sanitizeNoteHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: NOTE_ALLOWED_TAGS,
    ALLOWED_ATTR: NOTE_ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):[^<>"]*$/i,
    // Drop the TEXT of a disallowed block too (not just the tag) — DOMPurify's
    // default unwraps an unknown element but keeps its inner text, which would
    // leak a stray heading/table body into the lean note body.
    KEEP_CONTENT: false,
  });
}

/** Wrap plain text as sanitized lean HTML for the rich `description`/note body.
 *  Escapes &<>, converts newlines to <br>, wraps in a single <p>. Empty→"".
 *  The escape neutralizes every HTML metacharacter, so the only tags in the
 *  result are the <p>/<br> added here — both in the note allow-list — which makes
 *  a DOMPurify pass a provable no-op. Skipping it keeps this function SSR-safe:
 *  DOMPurify needs a DOM/`window` (absent during Next server render), and this is
 *  called at module-eval time by the built-in templates. */
export function plainToHtml(text: string): string {
  if (!text) return "";
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return "<p>" + esc.replace(/\r?\n/g, "<br>") + "</p>";
}

/** Plain-text projection of sanitized HTML — for search/export/preview cells.
 *
 *  ★★ `preserveBreaks` is OPT-IN and the default path is byte-identical. It
 *  exists because the DEFAULT collapse (`\s+` -> " ") destroys a newline that a
 *  caller put in DELIBERATELY: descriptionTextWithBreaks separates block
 *  boundaries with "\n" BEFORE sanitizing (it must — DOMPurify with
 *  ALLOWED_TAGS:[] deletes tags leaving nothing in their place, so the boundary
 *  has to already be in the string), and the default collapse then flattened
 *  every one of them back to a space. Break mode collapses a run CONTAINING a
 *  newline to one "\n" and a purely horizontal run to one " ", the same shape
 *  htmlPlainProjection's break mode uses.
 *
 *  ★★ The LOAD-BEARING property is only that this must not DESTROY a newline —
 *  htmlPlainProjection runs immediately after and re-normalises whatever it
 *  gets, so the two are not required to agree character-for-character, and an
 *  earlier version of this comment claimed they mirrored each other "exactly",
 *  an invariant stronger than the code needs and stronger than any test holds.
 *  The duplication is deliberate: importing rich-text-plain's regexes here would
 *  point the DOM-free module's consumer at the DOM-dependent one. If you tighten
 *  this collapse, the projection still fixes up the result — but do not RELAX it
 *  into anything that can eat a "\n".
 *
 *  ★ As written the two collapses ARE character-identical (same two regexes, same
 *  order) — the looseness above is a PERMISSION, not an observed difference, so
 *  do not go hunting for a divergence here. Where the two genuinely differ is the
 *  projection's extra entity/NBSP decode running BEFORE its collapse: "x\n&nbsp;\ny"
 *  leaves this function untouched and normalises to "x\ny" there. */
export function htmlToText(html: string, opts?: { preserveBreaks?: boolean }): string {
  const stripped = DOMPurify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  if (opts?.preserveBreaks !== true) return stripped.replace(/\s+/g, " ").trim();
  return stripped
    .replace(/[^\S\n]*\n\s*/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}
