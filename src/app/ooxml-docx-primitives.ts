// Format-level DOCX (OOXML) primitives, extracted verbatim from export-docx.ts
// so more than one renderer can build a .docx without re-declaring the package
// boilerplate. These are about the WordprocessingML format only. Shared ZIP
// writer + palette live in export-ooxml-shared.ts.
//
// ★★ THE HEADER USED TO SAY "Nothing here knows about ExportSection". That is
// no longer true of the CELL type: §141(b) made a table cell an `ExportCell`,
// so a rich entity field's HTML can be laid out as real paragraphs instead of
// being flattened. It still knows nothing about an ExportSection — which
// columns exist, which of them are rich, and how a row is projected all stay in
// export-sections.ts, which stays DOM-free.
//
// ★★ THIS FILE IS DOM-BOUND as of §141(b): `htmlToRichLines` parses with
// DOMParser. The parse happens inside `docxRichParagraphs`, never at module
// eval, so an import is still harmless — but do not call the rich path from a
// node script, and never move a rich-text PARSE into export-sections.ts.
import { type ZipEntry, buildZip } from "./zip";
import { contentTypeFor, type Extent, type MediaPart } from "./ooxml-media";
import {
  COLOR_DARK_BLUE,
  COLOR_LIGHT_GREY,
  COLOR_MEDIUM_GREY,
  COLOR_TEXT,
  COLOR_WHITE,
  xmlEscape,
} from "./export-ooxml-shared";
import { type ExportCell, cellText, isRichCell } from "./export-sections";
import {
  type Align,
  type RichLine,
  type RichLineKind,
  type RunMark,
  type TextRun,
  bulletMarker,
  htmlToRichLines,
} from "./rich-text-runs";
import { descriptionHtml } from "./rich-text-plain";
import { RENDER_SINK } from "./html-start";
import type { LinkRel, LinkSink } from "./ooxml-links";

/** One cell's text as Word runs, mapping the export projection's newlines to
 *  <w:br/>. A cell with no newline emits exactly the single <w:t> it always
 *  did, so existing output is byte-identical. A run may legally hold several
 *  <w:t> children with <w:br/> between them. */
export function docxCellRuns(value: string | number): string {
  return String(value ?? "")
    .split("\n")
    .map((line) => `<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`)
    .join("<w:br/>");
}

/** ★★ The shipped styles.xml declares ONLY `Title` and `TableHeader`. Word
 *  resolves an undeclared `Heading2` against its LATENT built-ins, so the file
 *  opens — but in Word's own sizes and colours rather than the Acme
 *  palette, and LibreOffice is less forgiving still. Declaring them here is
 *  what keeps a generated document on-brand. Sizes are HALF-POINTS: 36 = 18pt.
 *  Every colour must come from the sanctioned palette constants; a test pins
 *  that, so a hardcoded hex fails rather than silently shipping off-brand.
 *
 *  ★★★ IT LIVES BESIDE THE CODE THAT EMITS THE `w:pStyle`, and that is the
 *  whole point of the move in §141(b). `docxStyleFor` below names `Heading1`-
 *  `Heading4`, `ListParagraph`, `Quote` and `CodeBlock`; a `w:pStyle` naming a
 *  style styles.xml does not carry is SILENTLY IGNORED by Word, so the line
 *  renders as body text while every string assertion about the emitted XML
 *  still passes. Splitting the emitter from the declaration is how that gets
 *  reintroduced. BOTH callers of `buildDocxPackage` must pass this. */
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
  <w:style w:type="paragraph" w:styleId="Heading4">
    <w:name w:val="heading 4"/>
    <w:pPr><w:spacing w:before="140" w:after="70"/><w:outlineLvl w:val="3"/></w:pPr>
    <w:rPr><w:b/><w:i/><w:color w:val="${COLOR_TEXT}"/><w:sz w:val="22"/></w:rPr>
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

/** A run as the RENDERER sees it: the parse-side `href` (a URL) already
 *  resolved through a `LinkSink` into `hyperlinkRelId` (a relationship id).
 *
 *  ★★ THE TWO NAMES ARE DELIBERATELY DIFFERENT. One is an address, the other an
 *  id local to ONE relationship part, and a field carrying both names at
 *  different moments is how a URL ends up interpolated into an `r:id` attribute
 *  — valid XML that resolves to nothing. */
type RenderRun = TextRun & { hyperlinkRelId?: string };

/** Resolve a run's link through the sink, if there is both a link and a sink.
 *
 *  ★ The sink being OPTIONAL is what keeps every pre-existing caller
 *  byte-identical: with no sink, a linked run renders exactly as it did before
 *  links existed. */
function renderRun(run: TextRun, links: LinkSink | undefined): RenderRun {
  if (links === undefined || run.href === undefined) return run;
  return { ...run, hyperlinkRelId: links.relIdFor(run.href) };
}

/** One run, carrying its marks.
 *
 *  ★ `docxCellRuns` still does the escaping and the newline→<w:br/> mapping, so
 *  body text and table cells cannot diverge on either. It emits `<w:t>` only —
 *  the `<w:r>` wrapper is the caller's, here and in `para`.
 *  ★ An unmarked run emits NO `<w:rPr>` at all, so plain prose is byte-identical
 *  to what `para` produced before this path existed.
 *
 *  ★ Each linked run is wrapped INDIVIDUALLY rather than grouping adjacent runs
 *  that share a target. Consecutive `<w:hyperlink>` elements are valid and Word
 *  renders them as separate links to the same place; grouping is an
 *  optimisation with a correctness risk (a mark boundary inside a link) and is
 *  not worth it here. */
function markedRun(run: RenderRun): string {
  const props = [...run.marks]
    .sort((a, b) => DOCX_MARK_RPR[a].rank - DOCX_MARK_RPR[b].rank)
    .map((mark) => DOCX_MARK_RPR[mark].xml)
    .join("");
  const rPr = props === "" ? "" : `<w:rPr>${props}</w:rPr>`;
  const r = `<w:r>${rPr}${docxCellRuns(run.text)}</w:r>`;
  if (run.hyperlinkRelId === undefined) return r;
  // ★★★ `xmlns:r` IS DECLARED HERE, ON THE ELEMENT, and that is load-bearing.
  // `w:document`'s root declares only `xmlns:w` — the media path solves the
  // same problem the same way, declaring xmlns:r locally on `a:blip`. Adding
  // the namespace to the ROOT would change the bytes of EVERY package,
  // including one with no links, breaking the additive contract and moving
  // docs/baselines/ooxml-parts.json.
  return `<w:hyperlink xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${run.hyperlinkRelId}">${r}</w:hyperlink>`;
}

/** The paragraph style a non-`p` line is rendered with. Every id here is
 *  declared in `DOC_STYLES` directly above — a `w:pStyle` naming a style
 *  styles.xml does not carry is SILENTLY IGNORED by Word, so the line would
 *  render as body text while every assertion about the emitted XML still
 *  passed.
 *
 *  ★★ Deliberately NOT `Caption`: that style is the table-caption look (9pt
 *  italic grey) and using it for both would make a quote and a code block
 *  indistinguishable — and would leave code in the body FACE, since `Caption`
 *  sets no `w:rFonts`. `CodeBlock` is the style that carries the monospace.
 *
 *  ★★ `heading` is deliberately ABSENT from this record and resolved by
 *  `docxStyleFor` instead: its style id depends on the line's `level`, which a
 *  kind→id map cannot express. `li` IS here — every depth wears
 *  `ListParagraph` and the depth rides `<w:ind>`, not a per-depth style. */
const DOCX_LINE_STYLE: Partial<Record<RichLineKind, string>> = {
  blockquote: "Quote",
  pre: "CodeBlock",
  li: "ListParagraph",
};

/** The `w:pStyle` a rich line wears, or undefined for plain body text. */
export function docxStyleFor(line: RichLine): string | undefined {
  return line.kind === "heading" ? `Heading${line.level}` : DOCX_LINE_STYLE[line.kind];
}

/** A horizontal rule: an empty paragraph wearing a bottom border.
 *
 *  ★★ An `hr` RichLine carries ZERO runs, so a renderer that maps `line.runs`
 *  gets an empty paragraph and the rule disappears without a trace. This is the
 *  explicit arm that prevents that. */
const HR_PARAGRAPH =
  `<w:p><w:pPr><w:pBdr>` +
  `<w:bottom w:val="single" w:sz="6" w:space="1" w:color="${COLOR_MEDIUM_GREY}"/>` +
  `</w:pBdr></w:pPr></w:p>`;

/** OOXML's ST_Jc spelling for each alignment.
 *
 *  ★★★ `justify` IS `both`. Passing "justify" through emits a value Word does
 *  not recognise and SILENTLY DROPS, so the paragraph renders left-aligned with
 *  every string assertion still green. The other three happen to spell the same
 *  in both vocabularies, which is exactly why a pass-through looks correct. */
const JC_VALUE: Record<Align, string> = {
  left: "left",
  center: "center",
  right: "right",
  justify: "both",
};

/** One list nesting step, in twips. Matches `ListParagraph`'s own `w:ind`, so a
 *  top-level item indents identically whether or not the style resolves. */
const LIST_INDENT_TWIPS = 720;

/** One `RichLine` as one `<w:p>`.
 *
 *  ★★★ `<w:pPr>`'s children are an `xsd:sequence` (CT_PPr), exactly like the
 *  `<w:rPr>` ordering `DOCX_MARK_RPR`'s `rank` exists for. The order below is
 *  pStyle → pBdr → spacing → ind → jc, and a `<w:pPr>` emitted in any other
 *  order makes the part schema-invalid. A string-comparison test passes
 *  whatever the order, so this is pinned by its own assertion.
 *
 *  ★★ The `hr` arm returns FIRST because an `hr` line is deliberately NOT a
 *  `LineBase` — it carries no `align`, so `line.align` below is a type error
 *  until the kind has been narrowed away.
 *
 *  ★★ The list marker is LITERAL TEXT in its own `<w:r>`, not Word numbering.
 *  Real `<w:numPr>` numbering needs a numbering.xml part and an abstract
 *  numbering definition per list; the flat projection and the .pptx renderer
 *  both spell the marker out, and `bulletMarker` is the ONE place that decides
 *  what it says, so the three cannot disagree. Its own run carries no marks —
 *  the marker must not inherit the item's bold. */
export function docxRichParagraph(
  line: RichLine,
  styleOf: (line: RichLine) => string | undefined,
  links?: LinkSink,
): string {
  if (line.kind === "hr") return HR_PARAGRAPH;
  const style = styleOf(line);
  const parts: string[] = [];
  if (style) parts.push(`<w:pStyle w:val="${style}"/>`);
  if (line.kind === "li") {
    parts.push(`<w:ind w:left="${LIST_INDENT_TWIPS * (line.depth + 1)}"/>`);
  }
  if (line.align) parts.push(`<w:jc w:val="${JC_VALUE[line.align]}"/>`);
  const pPr = parts.length > 0 ? `<w:pPr>${parts.join("")}</w:pPr>` : "";
  // ★★ `<w:ind>` above is deliberately NOT guarded on `continuation` — a wrapped
  // line keeps the item's indent — but the MARKER is: one bullet per item that
  // put an `li` line into the output, however many lines it wraps to, and
  // repeating it renders one item as two.
  // ★ NOT "one bullet per ITEM": an item that emits ONLY lines of another kind
  // (`<li><h2>h</h2></li>`, `<li><ul>…</ul></li>`) has no `li` line to mark, so
  // it renders no bullet at all while still spending its ordinal —
  // open-followups §157. `promoteItemHead` (rich-text-runs.ts) covers the case
  // where the item does emit one but its FIRST attempt was dropped.
  const marker =
    line.kind === "li" && !line.continuation
      ? `<w:r>${docxCellRuns(`${bulletMarker(line.ordered, line.index, line.task)} `)}</w:r>`
      : "";
  const runs = line.runs.map((run) => markedRun(renderRun(run, links))).join("");
  return `<w:p>${pPr}${marker}${runs}</w:p>`;
}

/** Rich HTML as one or more Word paragraphs.
 *
 *  ★★ UPGRADE-AWARE, per SINK. A legacy plain-text value ("a\nb") is not
 *  markup, and handing it straight to the parser fuses its lines into one
 *  run-on paragraph (open-followups §118). `descriptionHtml` upgrades it.
 *  ★★★ The sink is `RENDER_SINK`, NOT any allow-list-derived one:
 *  `htmlToRichLines` keeps the text of EVERY tag, so a derived classifier is
 *  narrower than this sink and escapes the whole value where the parser would
 *  simply have kept the words — measured, "<h3>Sub</h3>" rendered as "Sub"
 *  under no classifier and as literal "<p>&lt;h3&gt;…" under "document". See
 *  html-start.ts.
 *
 *  ★★ THE EMPTY GUARD IS STRUCTURAL, not cosmetic. `htmlToRichLines("")`
 *  returns no lines, and a `<w:tc>` with no block-level child is INVALID —
 *  Word refuses the whole file rather than showing an empty cell. Every rich
 *  entity field is optional, so the empty case is the COMMON one.
 *
 *  ★★ `links` is OPTIONAL so every pre-existing caller stays byte-identical: a
 *  sink-less call renders a linked run as the plain run it always was. It is
 *  also the OWNER of the sink for this call — the sink spans one relationship
 *  part, so a caller emitting several fields into ONE document.xml must pass
 *  the SAME sink to each. */
export function docxRichParagraphs(html: string, links?: LinkSink): string {
  const paragraphs = htmlToRichLines(descriptionHtml(html, RENDER_SINK))
    .map((line) => docxRichParagraph(line, docxStyleFor, links))
    .join("");
  return paragraphs === "" ? "<w:p/>" : paragraphs;
}

/** Which way round the emitted `<w:sectPr>` puts the A4 page.
 *
 *  ★★ `landscape` is the DEFAULT everywhere, because it is what the workspace
 *  exporter ships and its output is byte-pinned. `portrait` exists for prose
 *  documents, which read badly at full landscape measure — the same reason
 *  `doc-render-html.ts` overrides `@page` to portrait for the very same
 *  documents. */
export type DocxPageLayout = "landscape" | "portrait";

/** A4 in twips (1/1440 inch). Everything a page needs, in ONE place: the
 *  `<w:sectPr>` bytes AND the width tables are laid out to are both generated
 *  from here, so the two cannot drift apart. A table measured for a page it is
 *  not on runs off the printable area — silently, since it still renders.
 *
 *  `contentWidth` is the page less its own left+right margins. */
interface DocxPageGeometry {
  readonly width: number;
  readonly height: number;
  /** left AND right (they are always equal here). */
  readonly marginX: number;
  /** top AND bottom. */
  readonly marginY: number;
  /** ★★★ LANDSCAPE ONLY, and it is a WART, not a design. The exporter has
   *  always laid its tables out to 14520 while its own page leaves 15398
   *  (16838 − 720 − 720) — 878 twips ≈ 15.5mm of unused measure. The file's
   *  original comment called 14520 "the usable width at 0.5-inch margins on A4
   *  landscape", which is simply WRONG arithmetic; nothing derives it.
   *  It is preserved ONLY because deriving it would change every column width
   *  in every workspace export (n=3: 4840 → 5132), and the exporter's output
   *  is contractually byte-stable. Narrowing the tables can never make them
   *  overflow, so this is a cosmetic debt, not a correctness one — but do not
   *  copy it to a new layout, and do not "tidy" it away either. */
  readonly contentWidthOverride?: number;
}

/** ★★ Portrait is the landscape pair TRANSPOSED, with the wider prose margins
 *  `doc-render-html.ts` already uses for these same documents (18mm ≈ 1020
 *  twips, 16mm ≈ 907) — the export's tight 0.5" measure exists to fit wide
 *  tables on a landscape page and reads badly under prose.
 *
 *  ★★ Do not touch the `landscape` entry: it is the workspace exporter's
 *  shipped bytes, and an edit here re-orients or re-flows every export. */
const PAGE_GEOMETRY: Record<DocxPageLayout, DocxPageGeometry> = {
  landscape: {
    width: 16838,
    height: 11906,
    marginX: 720,
    marginY: 720,
    contentWidthOverride: 14520,
  },
  portrait: { width: 11906, height: 16838, marginX: 907, marginY: 1020 },
};

/** The width a table on this layout must be laid out to. DERIVED from the same
 *  geometry the `<w:sectPr>` is built from — see `contentWidthOverride` for the
 *  one layout that does not derive, and why it cannot. */
export function docxContentWidth(page: DocxPageLayout): number {
  const geometry = PAGE_GEOMETRY[page];
  return geometry.contentWidthOverride ?? geometry.width - 2 * geometry.marginX;
}

/** The `<w:sectPr>` for a layout, generated from its geometry.
 *
 *  ★ `w:orient` interpolates the layout NAME: `DocxPageLayout`'s two members
 *  are exactly the ST_PageOrientation values, so the declared orientation
 *  cannot contradict the declared dimensions. Portrait is written explicitly
 *  even though it is the schema default — both branches then assert
 *  positively, where an absence assertion would also pass after a future edit
 *  dropped the whole `<w:pgSz>`. */
function pageSectPr(page: DocxPageLayout): string {
  const { width, height, marginX, marginY } = PAGE_GEOMETRY[page];
  return `<w:sectPr>
      <w:pgSz w:w="${width}" w:h="${height}" w:orient="${page}"/>
      <w:pgMar w:top="${marginY}" w:right="${marginX}" w:bottom="${marginY}" w:left="${marginX}" w:header="0" w:footer="0" w:gutter="0"/>
    </w:sectPr>`;
}

/**
 * Render a DOCX `<w:tbl>` from a list of string column labels and rows of
 * `ExportCell`. Used for every section — Tasks, RAID, Milestones, etc.
 *
 * Column widths are distributed evenly across `contentWidthTwips`, which
 * defaults to the landscape measure the workspace exporter has always used.
 * A caller emitting a non-landscape `<w:sectPr>` MUST pass
 * `docxContentWidth(itsLayout)` — a table sized for another page overflows
 * this one, and still renders while doing it.
 *
 * ★★ A `RichCell` is LAID OUT (§141(b)); every other cell keeps the exact
 * single-run paragraph it always emitted, so the workspace exporter's bytes
 * are untouched for the columns that are not rich. `isRichCell` is the type
 * guard that splits them — the two branches must stay byte-disjoint, because
 * routing a plain cell through the rich path would send it through DOMParser.
 */
export function buildDocxTable(
  columns: string[],
  rows: ExportCell[][],
  contentWidthTwips: number = docxContentWidth("landscape"),
  /** ★ The sink belongs to the caller, not to the table: one `<w:tbl>` is a
   *  fragment of ONE document.xml, and every rich cell in it mints into that
   *  document's single relationship part. Omitted, a linked cell renders as the
   *  plain run it always did — which is what keeps the byte-pinned workspace
   *  export unchanged until its own caller passes a sink. */
  links?: LinkSink,
): string {
  // Fallback width when we have no pixel hint: share page width evenly.
  const colWidth = columns.length > 0
    ? Math.floor(contentWidthTwips / columns.length)
    : contentWidthTwips;
  const colWidths = columns.map(() => colWidth);

  const tableHeader = `
    <w:tr>
      <w:trPr><w:tblHeader/></w:trPr>
      ${columns
        .map(
          (label, i) => `
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="${colWidths[i]}" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="${COLOR_DARK_BLUE}"/>
          </w:tcPr>
          <w:p>
            <w:pPr><w:pStyle w:val="TableHeader"/></w:pPr>
            <w:r>
              <w:rPr><w:b/><w:color w:val="${COLOR_WHITE}"/></w:rPr>
              <w:t xml:space="preserve">${xmlEscape(label)}</w:t>
            </w:r>
          </w:p>
        </w:tc>`,
        )
        .join("")}
    </w:tr>`;

  const tableBody = rows
    .map((row, rowIdx) => {
      const fill = rowIdx % 2 === 1 ? COLOR_LIGHT_GREY : COLOR_WHITE;
      return `
      <w:tr>
        ${columns
          .map((_, i) => {
            const cell = row[i] ?? "";
            const body = isRichCell(cell)
              ? docxRichParagraphs(cell.html, links)
              : `<w:p>
              <w:r>${docxCellRuns(cellText(cell))}</w:r>
            </w:p>`;
            return `
          <w:tc>
            <w:tcPr>
              <w:tcW w:w="${colWidths[i]}" w:type="dxa"/>
              <w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>
            </w:tcPr>
            ${body}
          </w:tc>`;
          })
          .join("")}
      </w:tr>`;
    })
    .join("");

  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  return `<w:tbl>
      <w:tblPr>
        <w:tblStyle w:val="Grid"/>
        <w:tblW w:w="${totalWidth}" w:type="dxa"/>
        <w:tblBorders>
          <w:top    w:val="single" w:sz="4" w:space="0" w:color="${COLOR_LIGHT_GREY}"/>
          <w:left   w:val="single" w:sz="4" w:space="0" w:color="${COLOR_LIGHT_GREY}"/>
          <w:bottom w:val="single" w:sz="4" w:space="0" w:color="${COLOR_LIGHT_GREY}"/>
          <w:right  w:val="single" w:sz="4" w:space="0" w:color="${COLOR_LIGHT_GREY}"/>
          <w:insideH w:val="single" w:sz="4" w:space="0" w:color="${COLOR_LIGHT_GREY}"/>
          <w:insideV w:val="single" w:sz="4" w:space="0" w:color="${COLOR_LIGHT_GREY}"/>
        </w:tblBorders>
      </w:tblPr>
      <w:tblGrid>
        ${colWidths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}
      </w:tblGrid>
      ${tableHeader}
      ${tableBody}
    </w:tbl>`;
}

/** Assemble a .docx package around a caller-supplied <w:body> content string.
 *  Extracted from buildDocx so a second renderer does not re-declare the
 *  content-types / rels / sectPr boilerplate. `extraStyles` is appended inside
 *  <w:styles> for callers that need styles beyond Title + TableHeader.
 *
 *  ★★ `page` defaults to `landscape` — the workspace exporter's bytes are
 *  pinned by the export-ooxml suite, so the default is not a preference, it is
 *  the contract. ★ That exporter now spells `"landscape"` out rather than
 *  relying on the default, because `links` trails it positionally; the value
 *  is the same one and the obligation is unchanged. */
export function buildDocxPackage(
  bodyXml: string,
  extraStyles = "",
  page: DocxPageLayout = "landscape",
  /** ★★★ ADDITIVE BY CONTRACT: an empty array must add no Default entry, no
   *  part and no relationship, because the workspace exporter shares this
   *  builder and passes an empty array here — it emits no media at all.
   *
   *  ★★ THIS FILE'S OWN TEST IS NO LONGER THE ONLY THING ENFORCING IT, and an
   *  earlier revision of this comment said it was.
   *  `ooxml-package-manifest.test.ts` compares the media-free package against
   *  an ORDERED part manifest committed at `docs/baselines/ooxml-parts.json`,
   *  so a change to the package an image-free document gets goes red naming
   *  the part — including a change nobody thought to assert. Regenerate that
   *  baseline ONLY with `npm run ooxml:manifest`; there is deliberately no
   *  `vitest -u` path. open-followups §216.
   *
   *  ★★ WHAT THE MANIFEST STILL DOES NOT REACH: the media-BEARING package. A
   *  duplicate `<Default Extension="png">` emitted once media IS present — the
   *  OPC violation the comment below warns about — is outside its scope, and
   *  so is the zip CONTAINER (pinned separately by `zip.test.ts`; neither
   *  covers the other).
   *
   *  ★ `export-ooxml.test.ts` is still NOT a gate on any of this, and a reader
   *  who assumes it is looks at something that cannot see it: it asserts part
   *  PRESENCE and document.xml SUBSTRINGS, never package bytes. There is no
   *  .docx byte fixture either (`src/app/__fixtures__/` holds only
   *  golden-workspace.csv and .md) — the manifest was chosen over a committed
   *  package blob deliberately, being diffable and not regenerable by
   *  accident. */
  media: readonly MediaPart[] = [],
  /** ★★★ ADDITIVE BY CONTRACT TOO, and MORE so than `media`: a link has NO
   *  part. An empty array must add no relationship — and a NON-empty one must
   *  still add no zip entry and no content-type Default, which is exactly what
   *  `TargetMode="External"` licenses. */
  links: readonly LinkRel[] = [],
): Blob {
  // ★★ Relationship ids are minted by the CALLER, because the body XML already
  // references them by the time it gets here. rId1 is the styles part; a media
  // part claiming it would replace styles with an image and Word would open a
  // document with no Title style and no error. Cheap to assert, invisible
  // otherwise.
  for (const part of media) {
    if (part.relId === "rId1") {
      throw new Error(`media relId "rId1" is reserved for the styles part (${part.path})`);
    }
  }
  // ★★ ONE namespace, two families. rId1 is the styles part; media and links
  // both mint above it. A DUPLICATE id is valid XML that resolves to whichever
  // relationship appears FIRST — an image silently becoming a link target,
  // with no schema error and no visible symptom. The rId1 check alone could
  // not see that.
  // ★ The rId1 arm here is reachable for a LINK only — the media loop above
  // runs first and keeps its own message, which names the offending part and
  // which a test asserts. Deliberately not merged into one loop: losing that
  // path from the message would make a real failure harder to place.
  const seen = new Set<string>();
  for (const relId of [...media.map((m) => m.relId), ...links.map((l) => l.relId)]) {
    if (relId === "rId1") {
      throw new Error(`relId "rId1" is reserved for the styles part`);
    }
    if (seen.has(relId)) throw new Error(`duplicate relationship id "${relId}"`);
    seen.add(relId);
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyXml}
    ${pageSectPr(page)}
  </w:body>
</w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:pPr><w:spacing w:after="120"/></w:pPr>
    <w:rPr><w:color w:val="${COLOR_DARK_BLUE}"/><w:sz w:val="48"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="TableHeader">
    <w:name w:val="Table Header"/>
    <w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="${COLOR_WHITE}"/></w:rPr>
  </w:style>${extraStyles}
</w:styles>`;

  // ★ One `Default` per DISTINCT extension — OPC forbids repeating one, and a
  // package carrying two `<Default Extension="png">` entries is a file Word
  // refuses to open. Empty media yields the empty string, which is the
  // byte-identity half of the contract above.
  const mediaDefaults = [...new Set(media.map((m) => m.extension))]
    .map((ext) => `\n  <Default Extension="${ext}" ContentType="${contentTypeFor(ext)}"/>`)
    .join("");

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${mediaDefaults}
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  // ★★ The Target is PART-RELATIVE to `word/`, because the relationship part it
  // sits in is `word/_rels/document.xml.rels`. A package-absolute
  // `word/media/image1.png` here resolves to `word/word/media/…` and the image
  // silently does not render.
  const mediaRels = media
    .map(
      (m) =>
        `\n  <Relationship Id="${m.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.path.slice("word/media/".length)}"/>`,
    )
    .join("");

  // ★★ Unlike a media Target, this one is NOT part-relative. A media Target
  // resolves against `word/`; a hyperlink Target is the raw absolute URL, and
  // making it relative would be the same class of silent breakage in the other
  // direction. `TargetMode="External"` is what licenses a relationship with no
  // part in the package at all.
  const linkRels = links
    .map(
      (l) =>
        `\n  <Relationship Id="${l.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(l.target)}" TargetMode="External"/>`,
    )
    .join("");

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${mediaRels}${linkRels}
</Relationships>`;

  const entries: ZipEntry[] = [
    { path: "[Content_Types].xml", data: contentTypes },
    { path: "_rels/.rels", data: rootRels },
    { path: "word/_rels/document.xml.rels", data: docRels },
    { path: "word/document.xml", data: documentXml },
    { path: "word/styles.xml", data: stylesXml },
    ...media.map((m) => ({ path: m.path, data: m.data })),
  ];

  return buildZip(
    entries,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
}

/** One embedded image as an inline drawing, ready to sit inside a `<w:r>`.
 *
 *  ★ `descr` is what Word exposes as alt text, so the asset's name goes there
 *  rather than being dropped — an image with no alternative text is a WCAG
 *  1.1.1 failure in the exported document, and nothing downstream can add it.
 *
 *  ★★ `name` and `descr` are both escaped. `name` is derived from the asset id
 *  (a UUID) and is safe today, but an XML attribute assembled by
 *  interpolation is exactly the shape that stops being safe when someone later
 *  passes the user-supplied asset name. */
export function docxInlineDrawing(opts: {
  relId: string;
  /** Unique within the document — Word tolerates duplicates, Pages does not. */
  id: number;
  name: string;
  descr: string;
  extent: Extent;
}): string {
  const { relId, id, name, descr, extent } = opts;
  return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
  <wp:extent cx="${extent.cxEmu}" cy="${extent.cyEmu}"/>
  <wp:docPr id="${id}" name="${xmlEscape(name)}" descr="${xmlEscape(descr)}"/>
  <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
      <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:nvPicPr>
          <pic:cNvPr id="${id}" name="${xmlEscape(name)}" descr="${xmlEscape(descr)}"/>
          <pic:cNvPicPr/>
        </pic:nvPicPr>
        <pic:blipFill>
          <a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relId}"/>
          <a:stretch><a:fillRect/></a:stretch>
        </pic:blipFill>
        <pic:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="${extent.cxEmu}" cy="${extent.cyEmu}"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </pic:spPr>
      </pic:pic>
    </a:graphicData>
  </a:graphic>
</wp:inline></w:drawing>`;
}
