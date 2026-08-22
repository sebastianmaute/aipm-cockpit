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
 * The one regex an EXPORT uses for `<img data-asset-id>`. It replaced three
 * identical copies, one per renderer.
 *
 * ★★ It is NOT the only rule in the repo that extracts this attribute, and a
 * reader who assumes it is will fix a bug in one place: `ASSET_ID_RE`
 * (`document-asset-usage.ts`) matches the ATTRIBUTE on any element and backs
 * the 20-image cap; `ASSET_IMG_RE` (`document-model.ts`) is case-insensitive
 * and accepts all three quoting styles because it runs before any allow-list
 * pass. Both differences are deliberate. The consequence to know: a
 * `<span data-asset-id>` counts against the cap and is invisible here.
 *
 * ★★★ QUOTE-AWARE, and it must stay that way. A plain `[^>]*` stops at the
 * first `>` even inside a quoted attribute value, and that is reachable from
 * the product's own rename control: the insert path escapes `>` to `&gt;`, but
 * the HTML serialiser does not re-escape it in an attribute, so a DOM round
 * trip hands back `alt="chart>v2.png"` verbatim. Measured: with `alt` AFTER
 * data-asset-id the match truncates and `v2.png">` survives as visible text in
 * every export; with `alt` BEFORE it the tag is missed entirely, so no bytes
 * load and the image disappears without a word. The three alternation branches
 * start on disjoint character classes, so there is no backtracking risk.
 *
 * ★★★ It carries /g, so `lastIndex` is shared state. Use it ONLY with
 * `String.replace` (which resets it) or `String.matchAll` (which clones it).
 * A `.test()` or bare `.exec()` in a loop would carry position between
 * unrelated callers — a bug that only shows up once two of them run in one
 * tick, i.e. in production and never in a focused test.
 */
export const IMG_TAG_RE =
  /<img\b(?:[^>"']|"[^"]*"|'[^']*')*\bdata-asset-id="([^"]*)"(?:[^>"']|"[^"]*"|'[^']*')*>/g;

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
 *  the wrong mechanism is how the protection gets deleted as redundant.
 *  `Object.freeze` on the outer object does NOT protect the two `Set`s —
 *  `NO_EXPORT_ASSETS.omitted.add("x")` succeeds at runtime. What stops every
 *  mutation is `ReadonlySet` / `Readonly<Record<…>>` on `ExportAssets`, which
 *  is COMPILE-TIME ONLY. The outer freeze is kept as a second line for the
 *  `inlined` field alone (a type-legal write would then throw under module
 *  strict mode instead of silently landing), which is why the field must NOT
 *  be cast back to a mutable `Record`. */
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
