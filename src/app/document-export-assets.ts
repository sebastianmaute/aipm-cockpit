// src/app/document-export-assets.ts — the ONE place an export resolves a
// document's image bytes.
//
// ★★★ THE SPLIT INTO THREE BUCKETS IS THE POINT. "omitted" (we chose not to
// include it, budget) and "missing" (there is no byte row) mean different
// things to whoever opens the exported file. Collapsing omitted into missing
// tells a user their image is lost when it is not; collapsing it into inlined
// blows the budget the bucket exists to enforce.

import type { ProjectDocument } from "./document-model";
import type { AssetByteLoader } from "./document-asset-images";

/**
 * The ONE regex for `<img data-asset-id>`.
 *
 * ★★ It lived as THREE separate copies — one each in doc-render-docx.ts,
 * doc-render-pptx.ts and doc-render-html.ts. Three copies of a pattern that
 * defines a storage format is three chances to fix a bug twice.
 *
 * ★★★ It carries /g, so `lastIndex` is shared state. Use it ONLY with
 * `String.replace` (which resets it) or `String.matchAll` (which clones it).
 * A `.test()` or bare `.exec()` in a loop would carry position between
 * unrelated callers — a bug that only shows up once two of them run in one
 * tick, i.e. in production and never in a focused test.
 */
export const IMG_TAG_RE = /<img\b[^>]*\bdata-asset-id="([^"]*)"[^>]*>/g;

/** Every asset id the document references, in document order, deduplicated.
 *
 *  ★ Order is load-bearing twice over: it numbers the OOXML media parts
 *  deterministically (so the golden comparison is stable) and it decides which
 *  images survive the byte budget. */
export function documentAssetIds(doc: ProjectDocument): string[] {
  const ids: string[] = [];
  for (const block of doc.blocks) {
    // Images live in paragraph HTML only — never in a heading, a table cell or
    // a dataSection (spec, "Out of scope").
    if (block.type !== "paragraph") continue;
    for (const match of block.html.matchAll(IMG_TAG_RE)) {
      const id = match[1];
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** Total STORED bytes an export may inline as base64 before it starts omitting.
 *
 *  ★★ A JUDGEMENT CALL, stated as one. The per-document cap is 20 images at
 *  5 MB stored, and base64 inflates by ~33% — so an uncapped worst case is a
 *  single ~133 MB string, which the PDF path then writes into a fresh tab.
 *  25 MB leaves a typical document (a few screenshots) entirely untouched
 *  while making a browser-hanging export impossible. Move it on evidence, not
 *  on taste; it is one constant precisely so that is cheap. */
export const EXPORT_INLINE_BUDGET_BYTES = 25 * 1024 * 1024;

export type ExportAssets = {
  /** id → base64. HTML needs the base64 directly; OOXML decodes it. */
  inlined: Record<string, string>;
  /** Bytes exist but the budget was already spent. A POLICY decision. */
  omitted: ReadonlySet<string>;
  /** No byte row, or the load failed. A DATA problem — the dangling case. */
  missing: ReadonlySet<string>;
};

/** What every renderer gets when there are no images, or no Turso config.
 *
 *  ★ Frozen and shared: it is passed on every export of an image-free
 *  document, and a caller mutating it would poison every later export. */
export const NO_EXPORT_ASSETS: ExportAssets = Object.freeze({
  inlined: Object.freeze({}) as Record<string, string>,
  omitted: new Set<string>(),
  missing: new Set<string>(),
});

/** Base64 length → the byte count it decodes to, without decoding it. */
function decodedByteLength(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}

/**
 * Resolve every image a document references.
 *
 * ★★ Fetches in PARALLEL and applies the budget SERIALLY afterwards. The
 * parallel fetch is what makes a 20-image document tolerable — `loadAssetData`
 * is one asset per request by design. The serial pass is what makes the result
 * deterministic: whether an image is inlined must not depend on which network
 * response arrived first.
 *
 * ★★★ A REJECTED LOAD IS `missing`, NEVER A THROW. The byte store is a network
 * call. An export that throws on a flaky connection loses the user's whole
 * document to save one image — so each id is settled independently and a
 * failure is disclosed in the file instead.
 */
export async function loadExportAssets(
  doc: ProjectDocument,
  load: AssetByteLoader,
  budgetBytes: number = EXPORT_INLINE_BUDGET_BYTES,
): Promise<ExportAssets> {
  const ids = documentAssetIds(doc);
  if (ids.length === 0) return NO_EXPORT_ASSETS;

  const fetched = await Promise.all(
    ids.map(async (id) => {
      try {
        return { id, b64: await load(id) };
      } catch {
        return { id, b64: null };
      }
    }),
  );

  const inlined: Record<string, string> = {};
  const omitted = new Set<string>();
  const missing = new Set<string>();
  let spent = 0;

  for (const { id, b64 } of fetched) {
    // ★ An EMPTY string is a present-but-empty row, distinct from an absent
    // one (see loadAssetData's own comment). It costs nothing, inlines, and
    // the renderers' own validity checks then decline it — which lands it back
    // in the missing presentation without this function having to guess.
    if (b64 === null) {
      missing.add(id);
      continue;
    }
    const bytes = decodedByteLength(b64);
    if (spent + bytes > budgetBytes) {
      omitted.add(id);
      continue;
    }
    spent += bytes;
    inlined[id] = b64;
  }

  return { inlined, omitted, missing };
}
