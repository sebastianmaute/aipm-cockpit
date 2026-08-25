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
// load through sanitizeDocumentHtml).
//
// ★★ SANITISING IS NOT A GUARD AGAINST A `data-asset-id` IN TEXT CONTENT —
// prose survives a load verbatim. `ASSET_ID_RE` no longer NEEDS it to be one
// (§231, closed): it requires a start tag. Pinned by "does NOT escape a
// data-asset-id a user merely TYPED as prose, and no longer counts it".
//
// ★★ What sanitising DOES buy is quoting NORMALISATION, which is a different
// property and a real one: DOMPurify re-serialises every attribute with double
// quotes, which is the only reason the double-quote-only patterns here agree
// with the load predicate at all. That ordering is pinned separately by "the
// load path normalises quoting BEFORE anything counts references".

import type { DocBlock, ProjectDocument } from "./document-model";
import { IMG_TAG_RE } from "./document-export-assets";

/** The attribute inside ANY start tag, stepping over quoted attribute values.
 *
 *  ★★★ TAG-AGNOSTIC ON PURPOSE, AND THAT IS THE HALF NOT TO "SIMPLIFY".
 *   A reference the sanitizer preserved on a non-`img` element still matters
 *   for deletion safety and the "used in N documents" count, so a
 *   `<span data-asset-id>` MUST keep counting (open-followups §218). Anchoring
 *   this on `<img` would silently change what the cap counts and what that
 *   column means — "a `<span>` is counted but never drawable" goes red if you
 *   do. Tag-name CASE is not a discriminator either: `<IMG …>` counts here.
 *
 *  ★★ QUOTE-AWARE, sharing the alternation `IMG_TAG_RE` uses: a preceding
 *   `alt="…"` is consumed whole as one alternative, so its contents cannot
 *   supply an opening quote for this attribute. Before that, a crafted alt
 *   ending in `data-asset-id=` produced a phantom id and hid the real one, and
 *   a text node spelling the attribute spent a cap slot (open-followups §231).
 *   The QUANTIFIER is lazy where `IMG_TAG_RE`'s is greedy — see `AssetRefs`.
 *
 *  ★★ `[^\s/>"']*` IS THE TAG NAME, AND THE `"'` IN IT IS NOT DECORATION.
 *   Without them the class can eat a quote, which makes it ambiguous against
 *   branches 2 and 3 of the alternation — the pattern's only backtracking
 *   ambiguity. Measured on `('<a' + '"'.repeat(64)).repeat(m)`: 375 ms at
 *   4 KB and ~7.5x per doubling, against 0.27 ms with the two characters
 *   present; output is identical on all 14 shapes the probes cover. Not
 *   reachable through the loader (DOMPurify serialises from the DOM, so a tag
 *   name is always followed by a space or `>`), but "ALREADY-SANITIZED" is a
 *   comment rather than a check and the tests here scan raw HTML. */
const ASSET_ID_RE =
  /<[a-zA-Z][^\s/>"']*(?:[^>"']|"[^"]*"|'[^']*')*?\bdata-asset-id="([^"]*)"/g;

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
 *  ★★ "THREE" COUNTS REGEXES, NOT READERS. Two more places read the attribute
 *  and neither is a pattern, so neither belongs in that comparison and neither
 *  should be forgotten when changing it: `attachAssetImages`
 *  (document-asset-images.ts) resolves it through the DOM with
 *  `querySelectorAll("img[data-asset-id]")` on rendered markup — `<img>`-only,
 *  but case- and quoting-agnostic, a fourth answer again — and sanitize-html.ts
 *  holds the allow-list VALUE predicate (`ATTR_VALUES`) that decides whether an
 *  id survives sanitising at all, upstream of every reader here. Enumerate with
 *  `grep -rln "data-asset-id" src/app --include=*.ts --include=*.tsx`.
 *
 *  ★ `undrawable` is computed over the WHOLE document, not per block, so an id
 *  that appears on a span in one block and an img in another is drawable and
 *  is correctly absent — otherwise the cap message would over-report.
 *
 *  ★★★ `drawable` IS NOT A SUBSET OF `all`, SO THESE ARE NOT THREE VIEWS OF ONE
 *  SET. The three fields read as a partition — `all`, the drawable part of it,
 *  and the rest — and only `undrawable ⊆ all` is guaranteed, because that one
 *  is BUILT by filtering `all`. `all` and `drawable` come from two DIFFERENT
 *  patterns in two different files, and nothing in the code makes them agree.
 *
 *  Measured 2026-08-25, against the regex literals read out of both source
 *  files. The crafted-`alt` violation is GONE:
 *  `<img alt="data-asset-id=" data-asset-id="real">` used to yield `all` =
 *  [`" data-asset-id="`] with the real id ABSENT, and now yields `["real"]` in
 *  both (open-followups §231, closed). A DIFFERENT violation survives, and it
 *  is why the headline above still stands: on a DUPLICATED attribute,
 *  `<img data-asset-id="a" data-asset-id="b">` yields `all` = ["a"] and
 *  `drawable` = ["b"], because `ASSET_ID_RE` is LAZY and stops at the FIRST
 *  occurrence while `IMG_TAG_RE` is GREEDY and backtracks to the LAST. A full
 *  load collapses that duplicate to `data-asset-id="a"` and the two sets then
 *  agree, so it is reachable ONLY by scanning UN-loaded HTML — which the tests
 *  in this module's test file do. Treat the subset relationship as a measured
 *  fact about one input, never as an invariant.
 *
 *  ★★ CONSEQUENCE FOR CALLERS: anything subtracting these sizes must subtract
 *  `undrawable` from `all` (never `drawable` from `all`, which can go negative).
 *  The cap message in `documents-asset-section.tsx` depends on exactly that.
 *  `undrawable ⊆ all` is pinned by "computes `undrawable` as `all` minus
 *  `drawable`, even when `drawable` holds an id `all` does not" in this
 *  module's test file — which pins the stronger EXACT-SET property, so the
 *  subset relationship follows rather than being asserted separately.
 *
 *  ★ The duplicate-attribute divergence above is pinned by "characterizes the
 *  duplicate-attribute divergence — `all` takes the FIRST, `drawable` the
 *  LAST" in the same file. That test is a CHARACTERIZATION, not a desired
 *  property: if a change makes the two patterns agree it SHOULD go red, and
 *  the answer is to delete it and this note, never to re-fit its expectations. */
export type AssetRefs = {
  /** Ids `ASSET_ID_RE` finds on ANY element — what the per-document image cap
   *  counts. Not GUARANTEED a superset of `drawable`; see the type's note. */
  all: ReadonlySet<string>;
  /** Ids `IMG_TAG_RE` finds on an `<img>` tag — what an export can draw. */
  drawable: ReadonlySet<string>;
  /** `all` MINUS `drawable`, hence always a subset of `all`: holds a cap slot,
   *  exports nothing, lands in no export bucket. */
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
