// src/app/ai-rich-text.ts — the write boundary for a rich field whose value came
// from a MODEL (chat tools, the inline-AI confirm replay, the project-proposal
// seed) rather than from the editor.
//
// ★★★ Why this exists as its own module rather than living in rich-text-plain.ts:
// it CALLS DOMPurify, and rich-text-plain.ts must never do that — it runs inside
// the entity sanitizers under bare node, where a DOMPurify call throws and
// jsonToWorkspace's catch-all converts the throw into an EMPTY workspace that then
// "successfully" writes near-empty sample files. Every caller here is browser-side
// (a React hook or a browser-only proposal path), so the DOM is there; keeping it
// out of the DOM-free module is what preserves that guarantee.
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
 *  superset of the note list). MID-DOCUMENT they degrade — the lean editor drops
 *  them when the field is next opened.
 *  ★★ But a value that STARTS with one never gets here as markup at all:
 *  `HTML_START` recognises only p/br/strong/em/ul/ol/li/a, so `<h1>T</h1><p>b</p>`
 *  fails the HTML test in layer 1 and `plainToHtml` escapes the WHOLE value into
 *  permanent visible tags. Same for a leading `<div>`, `<h3>` or `<!--comment-->`.
 *  That is the `HTML_START` classification family (open-followups.md §32), not
 *  something this boundary can fix — do not read "they degrade" as unconditional. */
export function sanitizeAiRichText(raw: unknown): string {
  const upgraded = sanitizeRichText(raw, TEXTAREA_MAX);
  if (!upgraded) return "";
  const clean = sanitizeTemplateHtml(upgraded);
  // The allow-list pass can empty a value whose only content was a disallowed
  // element (e.g. "<p><script>x</script></p>"), so re-apply the empty rule —
  // otherwise a phantom "<p></p>" reaches the `if (description)` gates.
  return sanitizeRichText(clean, TEXTAREA_MAX);
}

/** The rich fields each AI-writable entity owns.
 *
 *  ★★★ `Task.description` is NOT here: its boundary calls `sanitizeAiRichText`
 *  directly, because the dispatcher builds that patch field-by-field. The other
 *  three hand a WHOLE OBJECT to their entity sanitizer, and those sanitizers are
 *  DOM-FREE (`sanitize-records.ts` → `sanitizeRichText`) so they CANNOT run an
 *  allow-list — which is exactly why the model's value must be cleaned before it
 *  gets there. Verified directly: `sanitizeRaidItem({… description:
 *  "<p>ok</p><script>alert(1)</script>"})` stored that script verbatim. */
export const AI_RICH_FIELDS = {
  raid: ["description", "mitigation"],
  change: ["description", "impactDescription", "resolutionNotes"],
  milestone: ["description"],
} as const;

/** Clean the named rich fields on a MODEL-supplied object, leaving the rest alone.
 *
 *  ★★ Apply this to the model's INPUT/PATCH, never to the merged entity: an update
 *  spreads the already-stored value, and re-running the allow-list over storage
 *  would rewrite bytes this call never asked to touch (and would unwrap a tag some
 *  older path legitimately stored).
 *
 *  ★★ A field the model did not supply is SKIPPED, not blanked — `undefined` has
 *  to stay `undefined` so an update patch keeps meaning "leave this alone".
 *  Without that guard, renaming a RAID item would erase its stored description and
 *  mitigation; both halves are mutation-proved in the tests. */
export function withAiRichFields<T extends object>(raw: T, fields: readonly string[]): T {
  let out: Record<string, unknown> | null = null;
  for (const field of fields) {
    const value = (raw as Record<string, unknown>)[field];
    if (value === undefined) continue;
    out ??= { ...(raw as Record<string, unknown>) };
    out[field] = sanitizeAiRichText(value);
  }
  return (out ?? raw) as T;
}
