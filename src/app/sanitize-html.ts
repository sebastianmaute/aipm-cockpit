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
