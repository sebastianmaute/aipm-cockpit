// The non-empty placeholder each addable block kind is inserted with.
//
// ★★★ EVERY SEED MUST SURVIVE A LOAD. `sanitizeBlock` in document-model.ts
//  drops an empty heading, a paragraph whose visible text length is 0, a
//  bullets list with no non-empty item, a table with no columns and a
//  dataSection whose key is not in the registry. An empty seed therefore
//  renders now and is GONE on the next load. document-block-seeds.test.ts
//  asks the real loader rather than restating those rules here.
//
// ★ TRANSLATED, so this is deliberately NOT bound by the i18n-free contract
//  that governs document-model.ts and document-editor-commit.ts. It is the
//  reason the seeds live here and not in the pure decision layer.
import { t, type Lang } from "./i18n";
import type { DocBlock } from "./document-model";
import { plainToHtml } from "./sanitize-html";

/** Menu order. Also the exhaustiveness anchor: `blockSeed`'s switch returns
 *  `DocBlock` with no default arm, so adding a member to `DocBlock` without a
 *  seed is a TS2366 rather than a runtime surprise. */
export const ADDABLE_BLOCK_TYPES = [
  "paragraph", "heading", "bullets", "table", "dataSection", "pageBreak",
] as const satisfies readonly DocBlock["type"][];

export type AddableBlockType = (typeof ADDABLE_BLOCK_TYPES)[number];

export function blockSeed(lang: Lang, type: AddableBlockType): DocBlock {
  switch (type) {
    case "paragraph":
      // ★ `plainToHtml`, not `sanitizeRichText`: the input is a compile-time
      //  i18n literal, provably plain by construction — the same justification
      //  the other surviving `plainToHtml(` call sites carry. Do NOT copy this
      //  to a boundary whose input could already be HTML; there the escape
      //  corrupts the value permanently.
      return { type: "paragraph", html: plainToHtml(t(lang, "documentsNewBlockText")) };
    case "heading":
      return { type: "heading", level: 2, text: t(lang, "documentsNewHeadingText") };
    case "bullets":
      return { type: "bullets", items: [t(lang, "documentsNewItemText")] };
    case "table":
      return {
        type: "table",
        columns: [t(lang, "documentsNewTableColumn1"), t(lang, "documentsNewTableColumn2")],
        rows: [["", ""]],
      };
    case "dataSection":
      // ★★ BY NAME, never `EXPORT_SECTION_KEYS[0]` — reordering that registry
      //  must not silently change what hand-insertion produces.
      return { type: "dataSection", key: "tasks" };
    case "pageBreak":
      return { type: "pageBreak" };
  }
}
