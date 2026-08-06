// src/app/doc-render-docx.ts — project document blocks → WordprocessingML.
//
// ★★ DOM-BOUND, unlike the section-based OOXML builders: descriptionTextWithBreaks
// lives in rich-text-projection.ts, which needs a DOM. Never call this from a
// node script (the sample generator must not touch it).
//
// ★ paragraph.html arrives as FLAT TEXT with "\n" at block boundaries; each "\n"
// becomes a <w:br/> inside one run. Bold/italic are a recorded S1 limitation —
// the block BOUNDARY is what must survive, or a three-paragraph description
// reaches the reader as one run-on line.

import type { DocBlock, ProjectDocument } from "./document-model";
import { buildDocxPackage, buildDocxTable, docxCellRuns } from "./ooxml-docx-primitives";
import { COLOR_DARK_BLUE, COLOR_MEDIUM_GREY, COLOR_TEXT } from "./export-ooxml-shared";
import { descriptionTextWithBreaks } from "./rich-text-projection";
import { buildExportSections, type ExportSection } from "./export-sections";
import {
  EXPORT_SECTION_KEYS,
  type ExportConfig,
  type ExportSectionKey,
} from "./settings-types";
import type { Workspace } from "./workspace";
import type { Lang } from "./i18n";

/** ★★ The shipped styles.xml declares ONLY `Title` and `TableHeader`. Word
 *  resolves an undeclared `Heading2` against its LATENT built-ins, so the file
 *  opens — but in Word's own sizes and colours rather than the Acme
 *  palette, and LibreOffice is less forgiving still. Declaring them here is
 *  what keeps a generated document on-brand. Sizes are HALF-POINTS: 36 = 18pt.
 *  Every colour must come from the sanctioned palette constants; a test pins
 *  that, so a hardcoded hex fails rather than silently shipping off-brand. */
export const DOC_STYLES = `
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="${COLOR_DARK_BLUE}"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="200" w:after="100"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="${COLOR_DARK_BLUE}"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:pPr><w:outlineLvl w:val="2"/><w:spacing w:before="160" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="${COLOR_TEXT}"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph">
    <w:name w:val="List Paragraph"/>
    <w:pPr><w:ind w:left="720"/><w:spacing w:after="60"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Caption">
    <w:name w:val="caption"/>
    <w:pPr><w:spacing w:before="120" w:after="60"/></w:pPr>
    <w:rPr><w:i/><w:sz w:val="18"/><w:color w:val="${COLOR_MEDIUM_GREY}"/></w:rPr>
  </w:style>`;

/** One paragraph. `docxCellRuns` already maps "\n" to <w:br/> and escapes each
 *  line, so text and table cells cannot diverge on either rule. */
function para(text: string, style?: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${pPr}<w:r>${docxCellRuns(text)}</w:r></w:p>`;
}

/**
 * Resolve a `dataSection` key to a live ExportSection, grounded in the real
 * registry so a section can never drift from what the workspace exporter emits.
 *
 * Exported because the HTML and PPTX renderers need exactly this; a second copy
 * would be both a drift risk and a `dup:check` clone.
 *
 * Returns `null` when the register is empty — a fresh project would otherwise
 * grow a stray heading and empty table in every generated document.
 */
export function resolveDataSection(
  key: ExportSectionKey,
  ws: Workspace,
  lang: Lang,
): ExportSection | null {
  const cfg = Object.fromEntries(
    EXPORT_SECTION_KEYS.map((k) => [k, k === key]),
  ) as ExportConfig;
  return buildExportSections(ws, cfg, lang).find((s) => s.key === key) ?? null;
}

/** Marker text for a list item. Word renders a real bullet only from a
 *  numbering definition in numbering.xml, which this package does not carry —
 *  so the marker is literal text, and `ordered` still has to be honoured or the
 *  author's choice is silently discarded. */
function bulletMarker(ordered: boolean | undefined, index: number): string {
  return ordered ? `${index + 1}.` : "•";
}

function renderBlock(block: DocBlock, ws: Workspace, lang: Lang): string {
  switch (block.type) {
    case "heading":
      return para(block.text, `Heading${block.level}`);
    case "paragraph":
      return para(descriptionTextWithBreaks(block.html));
    case "bullets":
      return block.items
        .map((item, i) => para(`${bulletMarker(block.ordered, i)} ${item}`, "ListParagraph"))
        .join("");
    case "table":
      return (
        (block.caption ? para(block.caption, "Caption") : "") +
        buildDocxTable(block.columns, block.rows)
      );
    case "dataSection": {
      const section = resolveDataSection(block.key, ws, lang);
      if (!section) return "";
      return para(section.title, "Heading2") + buildDocxTable(section.columns, section.rows);
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
  const body =
    para(doc.title, "Title") +
    doc.blocks.map((b) => renderBlock(b, ws, lang)).join("");
  return buildDocxPackage(body, DOC_STYLES);
}
