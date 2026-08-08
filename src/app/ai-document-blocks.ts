// src/app/ai-document-blocks.ts — the allow-list for MODEL-authored document
// blocks.
//
// ★★★ DOM-BOUND ON PURPOSE, which is why it is NOT in document-model.ts: that
// module is DOM-free by contract (a source scan enforces it). This one calls
// DOMPurify (via sanitizeAiRichText -> sanitizeTemplateHtml) and must never
// enter that import graph.
//
// ★★ TWO LAYERS, both load-bearing. sanitizeProjectDocuments enforces
// STRUCTURE and cannot sanitize — it is DOM-free, so its upgrade path
// (descriptionHtml) passes HTML-shaped input through verbatim. sanitizeAiRichText
// is the actual allow-list, applied to `paragraph.html` BEFORE structure
// validation runs. Layer 1 alone let a model's <script> reach all six storage
// backends for the sibling entities (raid/change/milestone) before
// sanitizeAiRichText existed — see ai-rich-text.ts's own header, verified there
// against sanitizeRaidItem directly.
//
// ★★ CHECKED, NOT ASSUMED: paragraph.html is the ONLY DocBlock field ever
// rendered as HTML. doc-render-html.ts htmlEscape()s heading.text,
// bullets.items and table columns/rows/caption — only the `paragraph` case
// calls sanitizeTemplateHtml and only that block reaches
// dangerouslySetInnerHTML (document-preview.tsx). doc-render-docx.ts and
// doc-render-pptx.ts both route paragraph.html through
// descriptionTextWithBreaks (a plain-text projection, never OOXML markup) and
// treat every other block's fields as plain runs too. So sanitizing only
// `paragraph` blocks is complete — there is no second rich field in the
// DocBlock union that reaches a render sink as markup.
import { sanitizeAiRichText } from "./ai-rich-text";
import { sanitizeProjectDocuments, type DocBlock } from "./document-model";

/** Clean model-supplied blocks BEFORE they reach storage.
 *
 *  ★★ Apply to the model's INPUT, never to a merged/stored document: re-running
 *  the allow-list over already-stored bytes would rewrite content the call
 *  never asked to touch and unwrap a tag an older path legitimately stored
 *  (mirrors the same rule in ai-rich-text.ts's withAiRichFields). */
export function sanitizeAiDocBlocks(raw: unknown): DocBlock[] {
  if (!Array.isArray(raw)) return [];

  const cleaned = raw.map((block) => {
    if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "paragraph") {
      return block;
    }
    const html = (block as { html?: unknown }).html;
    return { ...(block as Record<string, unknown>), html: sanitizeAiRichText(html) };
  });

  // ★ `id`/`title` here are FIXED, always-valid literals, not model input — the
  // model's own document id/title are applied by the caller after this
  // returns. sanitizeDocument's only three rejection paths are a non-object
  // input, an invalid id, or a blank title; none can fire on this literal, so
  // sanitizeProjectDocuments always returns exactly one document and `doc` is
  // never undefined (confirmed against document-model.ts's sanitizeDocument).
  const [doc] = sanitizeProjectDocuments([
    { id: 1, title: "x", blocks: cleaned, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  ]);
  return [...doc.blocks];
}
