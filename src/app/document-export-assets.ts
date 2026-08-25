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
import { IMG_TAG_RE } from "./document-asset-patterns";

// ★ Re-exported, not declared here: the declaration and its full docstring live
//   in document-asset-patterns.ts beside the two patterns it must be read
//   against (open-followups §209). Kept exported because the three renderers
//   import IMG_TAG_RE from THIS module. ★★ NOT for this file's own
//   `documentAssetIds`, which uses the plain import above — a re-export creates
//   no local binding, which is why both statements name the same module.
export { IMG_TAG_RE } from "./document-asset-patterns";

/** Every asset id the document references, in document order, deduplicated.
 *
 *  ★ Order is load-bearing twice over: it numbers the OOXML media parts
 *  deterministically and it decides which images survive the byte budget.
 *
 *  ★★ There is still no golden PACKAGE over these exports — an earlier wording
 *  here said the determinism kept one "stable", which was never true. What
 *  exists since open-followups §216 closed is an ordered part MANIFEST
 *  (`docs/baselines/ooxml-parts.json`, gated by
 *  `ooxml-package-manifest.test.ts`), and it covers the MEDIA-FREE packages
 *  ONLY — so no BASELINE of any kind reaches the bytes a document WITH images
 *  produces, which is exactly the path this function feeds.
 *
 *  ★★ THAT IS NARROWER THAN "NOTHING READS THOSE BYTES", which is what this
 *  spot said and is false. FIVE test files unzip a media-BEARING package and
 *  assert over it. Three at the RENDERER level: `doc-render-docx.test.ts`
 *  compares the media part against the source PNG byte for byte and pins the
 *  media path list; `doc-render-pptx.test.ts` pins `ppt/media/image1.png` +
 *  `image2.png` and resolves the rels targets onto them;
 *  `document-download.test.ts` asserts a media part's length on a docx the
 *  download surface produced. Two at the BUILDER level:
 *  `ooxml-docx-primitives.test.ts` byte-compares `word/media/image1.png` and,
 *  in sibling tests, pins the `<Default Extension="png"
 *  ContentType="image/png"/>` entry, the `Target="media/image1.png"`
 *  relationship and the once-only extension declaration;
 *  `ooxml-pptx-primitives.test.ts` byte-compares `ppt/media/image1.png` and
 *  pins the per-slide rels target.
 *
 *  ★★ THE BUILDER PAIR WAS MISSING FROM THE COUNT THIS REPLACES, and HOW is
 *  the lesson. The wording before that one excluded them by a QUALIFIER —
 *  "nothing outside each builder's own unit test" — and the fix round that
 *  corrected it dropped the qualifier and substituted a flat "THREE", trading
 *  a wrong-but-qualified claim for a wrong-and-unqualified one that
 *  under-reported existing coverage by two.
 *
 *  ★★ AND THE GREP IT CAME ATTACHED TO SELECTS SOMETHING ELSE. `grep -rln
 *  unzipBytes src` returns eleven files — the helper, the helper's own test,
 *  `zip.test.ts`, the media-FREE manifest gate and this module among them.
 *  No one-line grep answers "unzips a package that HAS media"; the five have
 *  to be read for, which is why they are named above.
 *
 *  What none of the five is, is a baseline: each names a string somebody
 *  thought to check, so a change nobody anticipated passes all five. The
 *  determinism still matters on its own terms: a part path that moved between
 *  runs would be untestable at all. */
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
  inlined: Readonly<Record<string, string>>;
  /** Bytes exist but the budget was already spent. A POLICY decision. */
  omitted: ReadonlySet<string>;
  /** No byte row, or the load failed. A DATA problem — the dangling case. */
  missing: ReadonlySet<string>;
};

/** What every renderer gets when there are no images, or no Turso config.
 *
 *  ★ Shared: it is passed on every export of an image-free document, and a
 *  caller mutating it would poison every later export.
 *
 *  ★★ THE GUARANTEE IS THE READONLY TYPES, NOT `Object.freeze`, and crediting
 *  the wrong mechanism is how the real protection gets deleted as redundant.
 *  Freeze is SHALLOW and a `Set`'s contents are not properties, so it does not
 *  protect the two `Set`s at all. What stops every mutation is `ReadonlySet` /
 *  `Readonly<Record<…>>` on `ExportAssets`, and that is COMPILE-TIME ONLY.
 *  Measured, not reasoned — of the three writes a caller could attempt here,
 *  the freezes stop exactly two: `NO_EXPORT_ASSETS.omitted.add("x")` SUCCEEDS
 *  and leaves the shared value poisoned for every later export, while
 *  replacing `.inlined` (outer freeze) and writing a key on it (the INNER
 *  freeze) both throw. The freezes are therefore a partial runtime backstop
 *  for an untyped caller, nothing more.
 *
 *  ★ `inlined` must NOT be cast back to a mutable `Record` — that cast was
 *  the one way to make a write to this shared value both compile AND throw. */
export const NO_EXPORT_ASSETS: ExportAssets = Object.freeze({
  inlined: Object.freeze({}),
  omitted: new Set<string>(),
  missing: new Set<string>(),
});

/** Base64 length → an UPPER BOUND on the byte count it decodes to, without
 *  decoding it.
 *
 *  ★ It ignores `=` padding, so it over-counts by 1-2 bytes. Deliberate: for a
 *  budget the safe error is upward — over-counting can only omit an image
 *  slightly earlier, never overrun the cap the budget exists to enforce. */
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
  /** ★★★ Asked BEFORE the budget is charged. A renderer declines an id for
   *  reasons this module cannot see — no metadata row, a mime outside the
   *  allowlist, no stored dimensions to build an extent from. Charging those
   *  bytes anyway lets a few unusable assets spend the whole budget and push a
   *  later, perfectly good image into `omitted`: deterministic, wrong, and
   *  invisible to any single layer's tests, because each layer is correct on
   *  its own. Routing them to `missing` first also keeps the three buckets the
   *  WHOLE truth — without it there is a fourth state, inlined-but-unusable,
   *  that no bucket describes and the user is told nothing about. */
  isRenderable?: (id: string) => boolean,
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
    // ★ ORDER IS LOAD-BEARING: after the null check (a null row is `missing`
    // regardless of what the renderer thinks) and before the arithmetic (an
    // id the renderer will decline must never be charged).
    if (isRenderable && !isRenderable(id)) {
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
