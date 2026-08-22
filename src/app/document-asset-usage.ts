// src/app/document-asset-usage.ts — pure helpers over a document's blocks
// that count `<img data-asset-id="…">` references. Extracted from
// documents-asset-section.tsx so both the "used in N documents" column and
// the per-document 20-image cap check share ONE extraction rule rather than
// two regexes that can drift.
//
// Pure and i18n-free. Operates on ALREADY-SANITIZED stored HTML (documents
// load through sanitizeDocumentHtml), so a literal `data-asset-id="…"` in
// TEXT content would already have been escaped on the way in — this module
// does not need to guard against that itself.

import type { DocBlock, ProjectDocument } from "./document-model";

const ASSET_ID_RE = /data-asset-id="([^"]*)"/g;

function assetIdsInBlock(block: DocBlock): string[] {
  if (block.type !== "paragraph") return [];
  return Array.from(block.html.matchAll(ASSET_ID_RE), (m) => m[1]).filter((id) => id.length > 0);
}

/** Distinct asset ids referenced anywhere in this ONE document's blocks.
 *  Distinct because the 20-image cap counts DISTINCT images, not references —
 *  a document embedding the same image three times still holds one image. */
export function assetIdsInDocument(doc: ProjectDocument): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const block of doc.blocks) {
    for (const id of assetIdsInBlock(block)) ids.add(id);
  }
  return ids;
}

/** id → number of DOCUMENTS whose blocks reference it (not number of
 *  references) — matches what the library's "Used in" column and the delete
 *  confirmation's document count both mean. */
export function countAssetUsage(documents: readonly ProjectDocument[]): Record<string, number> {
  const usage: Record<string, number> = {};
  for (const doc of documents) {
    for (const id of assetIdsInDocument(doc)) usage[id] = (usage[id] ?? 0) + 1;
  }
  return usage;
}
