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
 *  Escapes &<>, converts newlines to <br>, wraps in a single <p>. Empty→"". */
export function plainToHtml(text: string): string {
  if (!text) return "";
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return sanitizeNoteHtml("<p>" + esc.replace(/\r?\n/g, "<br>") + "</p>");
}

/** Plain-text projection of sanitized HTML — for search/export/preview cells. */
export function htmlToText(html: string): string {
  const stripped = DOMPurify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  return stripped.replace(/\s+/g, " ").trim();
}
