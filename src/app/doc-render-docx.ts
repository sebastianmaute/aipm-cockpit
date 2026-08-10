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
import { descriptionHtml } from "./rich-text-plain";
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
    <w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="${COLOR_DARK_BLUE}"/><w:sz w:val="36"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="${COLOR_DARK_BLUE}"/><w:sz w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:pPr><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="${COLOR_TEXT}"/><w:sz w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph">
    <w:name w:val="List Paragraph"/>
    <w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Caption">
    <w:name w:val="caption"/>
    <w:pPr><w:spacing w:before="120" w:after="60"/></w:pPr>
    <w:rPr><w:i/><w:color w:val="${COLOR_MEDIUM_GREY}"/><w:sz w:val="18"/></w:rPr>
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
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:color w:val="${COLOR_TEXT}"/><w:sz w:val="20"/></w:rPr>
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
 *  ★ `rank` is NOT decoration — the child order of CT_RPr is an `xsd:sequence`
 *  (ECMA-376 EG_RPrBase), so a run whose properties come out in another order is
 *  schema-INVALID. The order is rFonts · b · i · strike · highlight · u ·
 *  vertAlign, and the order the marks ARRIVE in is the HTML nesting order, which
 *  is unrelated (`<sup><code><s>…` hands us vertAlign first). Emitting arrival
 *  order is the obvious implementation and it is wrong; `markedRun` sorts on
 *  this rank.
 *
 *  ★ BE PRECISE ABOUT WHO CARES — the honest answer is narrower than "Word
 *  breaks", and an earlier revision of this comment claimed "Word may reject or
 *  silently ignore" a mis-ordered run. That was measured wrong on 2026-08-08.
 *  dotnet/Open-XML-SDK issue #737 is this exact case (`w:b` and `w:i` swapped
 *  inside `w:rPr`): the Open XML SDK validator raises a schema error, and the
 *  reporter observes that Word opens the file and renders it correctly. ★ That is
 *  one reporter's observation, not a Microsoft statement — enough to retire the old
 *  claim, not enough to promise Word is lenient in every case. So the cost of
 *  getting this wrong is invalidity — rejection by strict validators and by
 *  toolchains built on them — not a Word crash and not a visible rendering
 *  defect. The old wording was wrong in the direction that matters: a reader who
 *  tests it, watches Word open the file happily, and concludes the whole rule is
 *  folklore will then ignore ordering somewhere a strict consumer does reject.
 *  ★ LibreOffice is UNVERIFIED. No evidence either way was found; Word's
 *  leniency is not evidence about it, so do not read it as covering both.
 *  ★ None of this is licence to stop sorting. It costs one sort, validity is
 *  the property being defended, and the corrected order is what the Word-generated
 *  reference template bundled with pandoc emits, in the samples checked (`Heading1Char`,
 *  and spacing-before-outlineLvl across `Heading2`-`Heading9`) — a sample, not a survey.
 *
 *  ★ TWO POSITIONS ARE COUNTER-INTUITIVE, and both were got wrong in the styles
 *  above rather than here: `w:color` is EG_RPrBase 19 while `w:sz` is 24, so
 *  colour comes FIRST; and in CT_PPrBase (also a sequence) `w:outlineLvl` is 31
 *  while `w:spacing` is 22 and `w:ind` is 23, so outline level comes LAST. No
 *  RunMark maps to either element, so this rank table never covered them and
 *  DOC_STYLES drifted independently of this sort — which is exactly how six
 *  style `w:rPr`s and four style `w:pPr`s ended up out of sequence across two
 *  files before 2026-08-08.
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
 *  legal here at all. That, alone, is why yellow stands: it is the closest
 *  member of the enum to the UA default every browser paints `<mark>` with, and
 *  `doc-render-html.ts` emits that very `<mark>` unstyled, so .docx and the
 *  printed PDF agree.
 *
 *  ★★ IT DOES NOT AGREE WITH THE .pptx, AND THAT IS DELIBERATE — the sibling
 *  `HIGHLIGHT_RGB` in `doc-render-pptx.ts` is the AIPM green `COLOR_GREEN`,
 *  because DrawingML's `<a:highlight>` takes a REAL colour (so the "not
 *  expressible" argument above simply does not apply there) and because
 *  `doc-render-pptx.test.ts` enforces a palette check over every `<a:srgbClr>`
 *  in a slide part, which a hardcoded FFFF00 would fail. So the two renderers
 *  differ on the CAPABILITY of their formats, not on taste, and the same
 *  document's highlight is yellow in Word and green in PowerPoint. Read that
 *  sibling's comment before "unifying" them.
 *  ★ Two reasons an earlier revision of this block gave are RETIRED because the
 *  sibling contradicts them: that yellow keeps one document's highlight
 *  consistent across renderings (it does not — the .pptx is green), and that
 *  the palette rule is a chrome-only rule that stops at the reader's document
 *  (it does not — that PPTX test is a real, enforced palette gate over OOXML;
 *  only the repo-wide CSS sweep is blind here).
 *
 *  If a brand tint is ever wanted in Word, it is `<w:shd w:fill="…"/>` (which
 *  sorts between `w:u` and `w:vertAlign`), not a new `w:highlight` value. */
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
  // ★★ UPGRADE-AWARE, per SINK. A legacy plain-text value ("a\nb") is not
  // markup, and handing it straight to the parser fused its lines into one
  // run-on paragraph (open-followups §118). descriptionHtml upgrades it.
  // ★★★ The sink is "render", NOT any allow-list-derived one: htmlToRichLines
  // keeps the text of EVERY tag, so a derived classifier is narrower than this
  // sink and escapes the whole value where the parser would simply have kept
  // the words — measured, "<h3>Sub</h3>" rendered as "Sub" under no classifier
  // and as literal "<p>&lt;h3&gt;…" under "document". See html-start.ts.
  return htmlToRichLines(descriptionHtml(html, "render"))
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
