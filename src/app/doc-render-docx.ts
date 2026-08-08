// src/app/doc-render-docx.ts — project document blocks → WordprocessingML.
//
// ★★ DOM-BOUND, unlike the section-based OOXML builders: htmlToRichLines lives
// in rich-text-runs.ts, which parses with DOMParser. Never call this from a node
// script (the sample generator must not touch it).
//
// ★★ paragraph.html is PARSED, not projected to flat text. `htmlToRichLines`
// yields one RichLine per block boundary, each carrying styled runs, and this
// file emits ONE <w:p> per line — so the block boundary is now a real paragraph
// where it used to be a <w:br/> inside a single run, and bold/italic/underline/
// strike/code/highlight/sub/sup survive instead of being flattened away. The
// parse is shared with the PPTX renderer precisely so the two cannot drift.

import type { DocBlock, ProjectDocument } from "./document-model";
import {
  type DocxPageLayout,
  buildDocxPackage,
  buildDocxTable,
  docxCellRuns,
  docxContentWidth,
} from "./ooxml-docx-primitives";
import { COLOR_DARK_BLUE, COLOR_MEDIUM_GREY, COLOR_TEXT } from "./export-ooxml-shared";
import {
  type RichLineKind,
  type RunMark,
  type TextRun,
  htmlToRichLines,
} from "./rich-text-runs";
import { resolveDataSection } from "./doc-data-section";
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
  </w:style>
  <w:style w:type="paragraph" w:styleId="Quote">
    <w:name w:val="Quote"/>
    <w:pPr>
      <w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="${COLOR_MEDIUM_GREY}"/></w:pBdr>
      <w:spacing w:before="120" w:after="120"/>
      <w:ind w:left="360"/>
    </w:pPr>
    <w:rPr><w:i/><w:color w:val="${COLOR_TEXT}"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="CodeBlock">
    <w:name w:val="Code Block"/>
    <w:pPr>
      <w:spacing w:before="0" w:after="0"/>
      <w:ind w:left="360"/>
    </w:pPr>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/><w:color w:val="${COLOR_TEXT}"/></w:rPr>
  </w:style>`;

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

/** How a mark becomes a Word run property, and WHERE inside `<w:rPr>` it goes.
 *
 *  ★★★ `rank` is NOT decoration — CT_RPr is an XML **sequence**, so Word may
 *  reject or silently ignore a run whose properties are out of schema order.
 *  The order is rFonts · b · i · strike · highlight · u · vertAlign, and the
 *  order the marks ARRIVE in is the HTML nesting order, which is unrelated
 *  (`<sup><code><s>…` hands us vertAlign first). Emitting arrival order is the
 *  obvious implementation and it is wrong; `markedRun` sorts on this rank.
 *
 *  ★ Rank and XML live in ONE record so a new `RunMark` cannot be given a
 *  rendering without also being given a position — and the exhaustive
 *  `Record<RunMark, …>` makes leaving it out a typecheck error.
 *
 *  ★★ `sub` and `sup` deliberately SHARE a rank: they are the same `w:vertAlign`
 *  element, so nothing can sit between them. Array#sort is stable, so a run
 *  carrying both (which no sane markup produces) keeps arrival order.
 *
 *  ★★ HIGHLIGHT — DECISION, NOT OVERSIGHT. `w:highlight` takes Word's fixed
 *  `ST_HighlightColor` enum ("yellow", "cyan", …); it is a CLOSED list of named
 *  values and no AIPM brand colour is expressible in it — an arbitrary hex is not
 *  legal here at all. The repo's palette rule is enforced by a CSS-scanning
 *  gate that cannot see OOXML, so either choice ships silently. Yellow is kept
 *  because (a) it is a document-FORMAT enum, the .docx equivalent of the UA
 *  default every browser paints `<mark>` with — and `doc-render-html.ts` emits
 *  that very `<mark>` unstyled, so a brand-tinted `w:shd` here would make the
 *  SAME document's highlight differ between its PDF and its .docx; (b) the
 *  palette rule governs app chrome, and this is the reader's document, not ours.
 *  If a brand tint is ever wanted, it is `<w:shd w:fill="…"/>` (which sorts
 *  between `w:u` and `w:vertAlign`), not a new `w:highlight` value. */
const DOCX_MARK_RPR: Record<RunMark, { rank: number; xml: string }> = {
  code: { rank: 0, xml: `<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>` },
  bold: { rank: 1, xml: `<w:b/>` },
  italic: { rank: 2, xml: `<w:i/>` },
  strike: { rank: 3, xml: `<w:strike/>` },
  highlight: { rank: 4, xml: `<w:highlight w:val="yellow"/>` },
  underline: { rank: 5, xml: `<w:u w:val="single"/>` },
  sub: { rank: 6, xml: `<w:vertAlign w:val="subscript"/>` },
  sup: { rank: 6, xml: `<w:vertAlign w:val="superscript"/>` },
};

/** One run, carrying its marks.
 *
 *  ★ `docxCellRuns` still does the escaping and the newline→<w:br/> mapping, so
 *  body text and table cells cannot diverge on either. It emits `<w:t>` only —
 *  the `<w:r>` wrapper is the caller's, here and in `para`.
 *  ★ An unmarked run emits NO `<w:rPr>` at all, so plain prose is byte-identical
 *  to what `para` produced before this path existed. */
function markedRun(run: TextRun): string {
  const props = [...run.marks]
    .sort((a, b) => DOCX_MARK_RPR[a].rank - DOCX_MARK_RPR[b].rank)
    .map((mark) => DOCX_MARK_RPR[mark].xml)
    .join("");
  const rPr = props === "" ? "" : `<w:rPr>${props}</w:rPr>`;
  return `<w:r>${rPr}${docxCellRuns(run.text)}</w:r>`;
}

/** The paragraph style a non-`p` line is rendered with. Both are declared in
 *  `DOC_STYLES` — a `w:pStyle` naming a style styles.xml does not carry is
 *  SILENTLY IGNORED by Word, so the line would render as body text while every
 *  assertion about the emitted XML still passed.
 *
 *  ★★ Deliberately NOT `Caption`: that style is the table-caption look (9pt
 *  italic grey) and using it for both would make a quote and a code block
 *  indistinguishable — and would leave code in the body FACE, since `Caption`
 *  sets no `w:rFonts`. `CodeBlock` is the style that carries the monospace. */
const DOCX_LINE_STYLE: Partial<Record<RichLineKind, string>> = {
  blockquote: "Quote",
  pre: "CodeBlock",
};

/** A horizontal rule: an empty paragraph wearing a bottom border.
 *
 *  ★★ An `hr` RichLine carries ZERO runs, so a renderer that maps `line.runs`
 *  gets an empty paragraph and the rule disappears without a trace. This is the
 *  explicit arm that prevents that. */
const HR_PARAGRAPH =
  `<w:p><w:pPr><w:pBdr>` +
  `<w:bottom w:val="single" w:sz="6" w:space="1" w:color="${COLOR_MEDIUM_GREY}"/>` +
  `</w:pBdr></w:pPr></w:p>`;

/** A rich paragraph block as one or more Word paragraphs.
 *
 *  ★ Only ever called for a body-level `paragraph` block, where `<w:p>` is
 *  legal. Table cells never come through here — `buildDocxTable` takes plain
 *  strings — so no `<w:p>`/`<w:pBdr>` emitted here can land somewhere a
 *  paragraph is not allowed. */
function richParas(html: string): string {
  return htmlToRichLines(html)
    .map((line) => {
      if (line.kind === "hr") return HR_PARAGRAPH;
      const style = DOCX_LINE_STYLE[line.kind];
      const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
      return `<w:p>${pPr}${line.runs.map(markedRun).join("")}</w:p>`;
    })
    .join("");
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
      return richParas(block.html);
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
  const body =
    para(doc.title, "Title") +
    doc.blocks.map((b) => renderBlock(b, ws, lang)).join("");
  return buildDocxPackage(body, DOC_STYLES, PAGE);
}
