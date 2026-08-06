// src/app/document-rich-fields.ts — the DOM-bound allow-list for a document's
// paragraph HTML, run at the whole-object load boundaries that cast verbatim
// (jsonToWorkspace and the IndexedDB load).
//
// ★★★ It is a SEPARATE module from document-model.ts on purpose: that module is
// the DOM-FREE structural validator every load path runs, and structural
// validation is a different job from HTML sanitization. Splitting them lets a
// caller run the structure check anywhere and add the allow-list wherever a DOM
// exists. Same split, same reason, as ai-rich-text.ts vs rich-text-plain.ts.
//
// ★★ The split is NOT because a DOMPurify call would throw for want of a DOM.
// That was the old rationale and it is obsolete — the sample generator installs
// JSDOM before its dynamic imports and decodes with `{ strict: true }`. Adding
// this pass to a load path that lacks it is therefore a normal change, not a
// contract violation: compose it at the CALLER, as
// `sanitizeProjectDocuments(raw).map(sanitizeDocumentRichFields)`.
//
// ★★★ `sanitizeTemplateHtml`, NOT `sanitizeNoteHtml`, and the difference is DATA
// LOSS rather than reach. NEITHER list allows `h3`/`div`/`table` — both delete
// those TAGS. What differs is the TEXT inside them: sanitizeNoteHtml sets
// KEEP_CONTENT:false and deletes it along with the tag (right for the lean note
// editor, whose Tiptap schema can only emit the lean set), while
// sanitizeTemplateHtml keeps DOMPurify's default and UNWRAPS the tag so the
// user's words survive. A document is authored by a model, which legitimately
// emits headings and tables, so silently dropping their prose is unacceptable.
// Mutation-proved: swapping the import turns exactly one test red.
// `<script>`/`<style>` are removed WITH their contents either way, and the
// end-anchored ALLOWED_URI_REGEXP drops a `javascript:` href.

import type { DocBlock, ProjectDocument } from "./document-model";
import { sanitizeTemplateHtml } from "./sanitize-html";

/** Clean the rich (HTML-bearing) fields of one document.
 *
 *  ★★ EXACTLY ONE declared parameter, on purpose: every call site is `.map(fn)`,
 *  and `.map` passes (value, INDEX, array). A `(doc, fields)` signature would be
 *  fed 0, 1, 2… as its field list, normalise nothing, and leave every .map-based
 *  test green. A test pins `.length === 1` because no behavioural assertion can.
 *
 *  ★ Returns the SAME object (and the same block objects) when the allow-list
 *  changed nothing, so a clean load does not churn identities. */
export function sanitizeDocumentRichFields(doc: ProjectDocument): ProjectDocument {
  let changed = false;
  const blocks: DocBlock[] = doc.blocks.map((b) => {
    if (b.type !== "paragraph") return b;
    const html = sanitizeTemplateHtml(b.html);
    if (html === b.html) return b;
    changed = true;
    return { ...b, html };
  });
  return changed ? { ...doc, blocks } : doc;
}
