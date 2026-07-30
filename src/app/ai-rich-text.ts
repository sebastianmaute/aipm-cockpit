// src/app/ai-rich-text.ts — the write boundary for a rich field whose value came
// from a MODEL (chat tools, the inline-AI confirm replay, the project-proposal
// seed) rather than from the editor.
//
// ★★★ Why this exists as its own module rather than living in rich-text-plain.ts:
// it CALLS DOMPurify, and rich-text-plain.ts must never do that — it runs inside
// the entity sanitizers under bare node, where a DOMPurify call throws and
// jsonToWorkspace's catch-all converts the throw into an EMPTY workspace that then
// "successfully" writes near-empty sample files. Every caller of this function is
// browser-side (a React hook or a browser-only proposal path), so the DOM is
// there; keeping it out of the DOM-free module is what preserves that guarantee.
import { sanitizeRichText } from "./rich-text-plain";
import { sanitizeTemplateHtml } from "./sanitize-html";
import { TEXTAREA_MAX } from "./sanitize";

/** Model-supplied value -> stored rich HTML.
 *
 *  Two layers, in this order and for different reasons:
 *  1. `sanitizeRichText` — UPGRADE-AWARE. A model may send plain prose OR HTML
 *     (it is routinely handed the stored HTML to read and echoes it back), so the
 *     boundary must accept both. `plainToHtml` alone ESCAPES `& < >`, which stored
 *     HTML as "<p>&lt;p&gt;&lt;strong&gt;…" — literal tags in the field, in every
 *     export and in the search index. It also strips control characters, caps on
 *     VISIBLE text and drops a visually-empty value.
 *  2. `sanitizeTemplateHtml` — the ALLOW-LIST. Layer 1 is DOM-free and therefore
 *     cannot sanitize; on its own it persists `<script>` verbatim. Model output is
 *     influenceable by a document the user uploads, so the value gets an actual
 *     DOMPurify pass before it reaches six storage backends.
 *
 *  ★★★ `sanitizeTemplateHtml`, NOT `sanitizeNoteHtml`, and the difference is
 *  DATA LOSS. `sanitizeNoteHtml` sets `KEEP_CONTENT: false`, which deletes the
 *  TEXT inside a non-allow-listed tag along with the tag — correct for the editor
 *  (whose schema can only emit the lean set) but wrong here, because a model
 *  legitimately emits `<h3>`/`<div>`/`<table>` and the user's words would vanish
 *  silently. `sanitizeTemplateHtml` keeps default KEEP_CONTENT, so a disallowed
 *  tag is unwrapped and its text survives, while `<script>`/`<style>` are removed
 *  with their contents (DOMPurify does that regardless) and its end-anchored
 *  ALLOWED_URI_REGEXP drops a `javascript:` href.
 *
 *  ★ Consequence worth knowing: this admits `u`/`h1`/`h2` (the template list is a
 *  superset of the note list). The lean editor drops them when the field is next
 *  opened, so they degrade rather than corrupt. */
export function sanitizeAiRichText(raw: unknown): string {
  const upgraded = sanitizeRichText(raw, TEXTAREA_MAX);
  if (!upgraded) return "";
  const clean = sanitizeTemplateHtml(upgraded);
  // The allow-list pass can empty a value whose only content was a disallowed
  // element (e.g. "<p><script>x</script></p>"), so re-apply the empty rule —
  // otherwise a phantom "<p></p>" reaches the `if (description)` gates.
  return sanitizeRichText(clean, TEXTAREA_MAX);
}
