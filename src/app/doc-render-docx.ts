// src/app/doc-render-docx.ts — project document blocks → WordprocessingML.
//
// ★★ DOM-BOUND: htmlToRichLines lives in rich-text-runs.ts, which parses with
// DOMParser. Never call this from a node script (the sample generator must not
// touch it).
// ★★ THIS COMMENT USED TO SAY "unlike the section-based OOXML builders". That
// stopped being true in §141(b): the rich-cell path put the same parse behind
// ooxml-docx-primitives.ts, so `buildDocx` reaches DOMParser too. The parse is
// still inside a function rather than at module eval, so IMPORTING either file
// remains harmless — what is DOM-bound is CALLING the rich path.
//
// ★★ paragraph.html is PARSED, not projected to flat text. `htmlToRichLines`
// yields one RichLine per block boundary, each carrying styled runs, and ONE
// <w:p> is emitted per line — so the block boundary is a real paragraph where it
// used to be a <w:br/> inside a single run, heading level / list numbering /
// alignment survive, and bold/italic/underline/strike/code/highlight/sub/sup
// survive instead of being flattened away.
//
// ★★ THAT RENDERING NO LONGER LIVES HERE. `docxRichParagraphs` and the styles it
// names moved to ooxml-docx-primitives.ts in §141(b), because the SAME builder
// now renders a rich ENTITY field inside a table cell — where the workspace
// exporter, not this file, is the caller. The parse is still shared with the
// PPTX renderer precisely so the two cannot drift.

import type { DocBlock, ProjectDocument } from "./document-model";
import {
  type DocxPageLayout,
  DOC_STYLES,
  buildDocxPackage,
  buildDocxTable,
  docxCellRuns,
  docxContentWidth,
  docxRichParagraphs,
} from "./ooxml-docx-primitives";
import { bulletMarker } from "./rich-text-runs";
import { resolveDataSection } from "./doc-data-section";
import { IMG_TAG_RE } from "./document-export-assets";
import { htmlEscape } from "./download";
import type { Workspace } from "./workspace";
import { t, type Lang } from "./i18n";

/** ★★ A project document is PROSE, so it is PORTRAIT — `doc-render-html.ts`
 *  overrides `@page` to portrait for these same documents and explains why
 *  (prose at full A4 landscape measure reads badly). Without this the SAME
 *  document arrived portrait as HTML/PDF and landscape as .docx.
 *
 *  ★★ ONE constant drives BOTH the page and the tables on purpose. The sectPr
 *  and the table width are the SAME decision — a table measured for the
 *  landscape text column overflows the narrower portrait page, silently, since
 *  it still renders. `docxContentWidth` derives the width from the very
 *  geometry that built the sectPr, so passing `PAGE` to both is enough to keep
 *  them in step; there is no second number to update. */
const PAGE: DocxPageLayout = "portrait";

/** Every table in the document is laid out to the page the document declares. */
const CONTENT_WIDTH = docxContentWidth(PAGE);

/** One paragraph. `docxCellRuns` already maps "\n" to <w:br/> and escapes each
 *  line, so text and table cells cannot diverge on either rule. */
function para(text: string, style?: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${pPr}<w:r>${docxCellRuns(text)}</w:r></w:p>`;
}

// ★★★ Media parts (the real embedded bytes) land in a later slice (S3c-2) —
// this file has no way to attach one yet. `docxRichParagraphs` -> `htmlToRichLines`
// (rich-text-runs.ts) has no `<img>` handling at all, so an `<img data-asset-id>`
// left in `block.html` would reach the DOMParser walk as an unrecognised void
// element and vanish SILENTLY, with nothing in the exported file to say an image
// was ever there. This substitutes a translated placeholder run naming the asset
// instead, on the RAW html BEFORE the parse — so it participates in the walk as
// ordinary text and inherits whatever paragraph/list-item context surrounds it.

/** `assetNames` resolves an id to the asset's display name (`ws.documentAssets`);
 *  a dangling id (row deleted, byte store empty) falls back to the id itself
 *  rather than a blank name. */
function withImagePlaceholders(html: string, assetNames: ReadonlyMap<string, string>, lang: Lang): string {
  return html.replace(IMG_TAG_RE, (_tag, id: string) =>
    htmlEscape(t(lang, "assetExportPlaceholder", assetNames.get(id) ?? id)));
}

function renderBlock(
  block: DocBlock, ws: Workspace, lang: Lang, assetNames: ReadonlyMap<string, string>,
): string {
  switch (block.type) {
    case "heading":
      return para(block.text, `Heading${block.level}`);
    case "paragraph":
      return docxRichParagraphs(withImagePlaceholders(block.html, assetNames, lang));
    case "bullets":
      return block.items
        .map((item, i) => para(`${bulletMarker(block.ordered, i)} ${item}`, "ListParagraph"))
        .join("");
    case "table":
      return (
        (block.caption ? para(block.caption, "Caption") : "") +
        buildDocxTable(block.columns, block.rows, CONTENT_WIDTH)
      );
    case "dataSection": {
      const section = resolveDataSection(block.key, ws, lang);
      if (!section) return "";
      return (
        para(section.title, "Heading2") +
        buildDocxTable(section.columns, section.rows, CONTENT_WIDTH)
      );
    }
    case "pageBreak":
      return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
  }
}

/** Render a project document as a `.docx` Blob. */
export function renderDocumentDocx(
  doc: ProjectDocument,
  ws: Workspace,
  lang: Lang,
): Blob {
  const assetNames = new Map((ws.documentAssets ?? []).map((a) => [a.id, a.name]));
  const body =
    para(doc.title, "Title") +
    doc.blocks.map((b) => renderBlock(b, ws, lang, assetNames)).join("");
  return buildDocxPackage(body, DOC_STYLES, PAGE);
}
