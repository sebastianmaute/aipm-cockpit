// src/app/document-asset-usage.ts — pure helpers over a document's blocks
// that count `<img data-asset-id="…">` references. Extracted from
// documents-asset-section.tsx so both the "used in N documents" column and
// the per-document 20-image cap check share ONE extraction rule.
//
// ★★ THAT IS TRUE OF THOSE TWO CONSUMERS ONLY. An earlier wording here said
// the module existed "rather than two regexes that can drift", which reads as
// though this file holds the repo's single rule for asset references. It does
// not: THREE patterns read `data-asset-id`, they are deliberately NOT merged,
// and `assetRefsInDocument` below carries the relationship and the reason.
//
// Pure and i18n-free. Operates on ALREADY-SANITIZED stored HTML (documents
// load through sanitizeDocumentHtml), so a literal `data-asset-id="…"` in
// TEXT content would already have been escaped on the way in — this module
// does not need to guard against that itself.

import type { DocBlock, ProjectDocument } from "./document-model";
import { IMG_TAG_RE } from "./document-export-assets";

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

/** The three ways a document's asset references can be counted, in ONE pass.
 *
 *  ★★★ THE DIVERGENCE IS THE POINT, AND MERGING THE PATTERNS WOULD DESTROY IT.
 *  Two scanners disagree about what an asset reference IS, and each is right
 *  on its own terms: `ASSET_ID_RE` above is tag-AGNOSTIC because a reference
 *  the sanitizer preserved on a non-`img` element still matters for deletion
 *  safety and the usage count, while `IMG_TAG_RE` (document-export-assets.ts)
 *  is tag-ANCHORED because an export must only fetch bytes for something it
 *  can actually draw. What was missing was anywhere that said so — a
 *  `<span data-asset-id>` consumed a cap slot, contributed to no export, and
 *  appeared in none of `inlined`/`omitted`/`missing`. open-followups §218.
 *
 *  ★★ A THIRD pattern exists and deliberately is NOT here: `ASSET_IMG_RE`
 *  (document-model.ts) yields no ids at all — it is `.test()`-only, deciding
 *  whether an image-only paragraph SURVIVES load. It is pinned by the
 *  relationship test in this module's test file instead.
 *
 *  ★ `undrawable` is computed over the WHOLE document, not per block, so an id
 *  that appears on a span in one block and an img in another is drawable and
 *  is correctly absent — otherwise the cap message would over-report. */
export type AssetRefs = {
  /** Ids on ANY element — what the per-document image cap counts. */
  all: ReadonlySet<string>;
  /** Ids on an `<img>` tag — what an export can actually draw. */
  drawable: ReadonlySet<string>;
  /** `all` minus `drawable`: holds a cap slot, exports nothing, in no bucket. */
  undrawable: ReadonlySet<string>;
};

export function assetRefsInDocument(doc: ProjectDocument): AssetRefs {
  const all = new Set<string>();
  const drawable = new Set<string>();
  for (const block of doc.blocks) {
    if (block.type !== "paragraph") continue;
    for (const id of assetIdsInBlock(block)) all.add(id);
    for (const match of block.html.matchAll(IMG_TAG_RE)) {
      if (match[1]) drawable.add(match[1]);
    }
  }
  const undrawable = new Set([...all].filter((id) => !drawable.has(id)));
  return { all, drawable, undrawable };
}
