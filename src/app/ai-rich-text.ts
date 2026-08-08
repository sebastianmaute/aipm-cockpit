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
import { sanitizeDocumentHtml, sanitizeTemplateHtml } from "./sanitize-html";
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

/** The DOCUMENTS variant of the boundary above — model-supplied value -> stored
 *  document-block HTML. Same two layers in the same order and for the same
 *  reasons; only the allow-list differs, and it is the WIDER documents one
 *  (`sanitizeDocumentHtml`: the template tags plus s/code/pre/blockquote/hr/
 *  mark/sub/sup/img). A model writing `<mark>` into a document had it unwrapped
 *  at the write before this existed.
 *
 *  ★★★ A SEPARATE FUNCTION, NOT A PARAMETER ON `sanitizeAiRichText`. The two
 *  boundaries guard different storage: this one only ever sees document blocks,
 *  while `sanitizeAiRichText` also guards the six rich entity description fields
 *  (raid/change/milestone) whose list must NOT widen. Threading the sanitizer
 *  through as an argument would put the wider list one defaulted/mistyped
 *  parameter away from every entity field — the "parameterizing divergent guard
 *  chains is where a config slip silently weakens a guard" rule. Two call sites,
 *  two names, no way to hand entity HTML the document list by accident.
 *
 *  ★★ `raw` is `unknown`, matching the sibling: the caller reads `block.html`
 *  off a model-supplied object, so it is genuinely untyped. Layer 1 coerces a
 *  non-string to "" itself — do not narrow this to `string`.
 *
 *  ★★ The trailing `sanitizeRichText` re-run is why this mirrors the sibling
 *  line-for-line rather than collapsing to a one-liner: the allow-list pass can
 *  empty a value whose only content was a disallowed element (e.g.
 *  "<p><script>x</script></p>"), and the re-run turns the resulting phantom
 *  "<p></p>" back into "".
 *  ★ Be precise about what that buys HERE, because it is NOT what it buys for the
 *  sibling: on this path it is defense-in-depth, not the thing doing the work.
 *  `sanitizeAiDocBlocks`'s structural layer already drops an empty paragraph via
 *  its own `htmlTextLength(html) === 0` check, so the block disappears either way
 *  — MEASURED, not assumed: `htmlTextLength("<p></p>")` is 0 and that input
 *  returns []. It is kept so the two boundaries stay identical in shape and
 *  cannot drift, and so the cap is re-applied after the allow-list. The sibling's
 *  callers have no such structural layer, which is where the empty rule is load
 *  bearing. */
export function sanitizeAiDocumentRichText(raw: unknown): string {
  const upgraded = sanitizeRichText(raw, TEXTAREA_MAX);
  if (!upgraded) return "";
  const clean = sanitizeDocumentHtml(upgraded);
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
