// src/app/doc-render-pptx.ts — blocks → PresentationML (.pptx).
//
// SEGMENTATION (which blocks share a slide): a new slide starts at every
// pageBreak and at every level-1 heading, which becomes that slide's title.
// Level 2/3 headings stay in the body — splitting on every heading would
// shred a document into one-line slides. A segment left with neither a title
// nor a body is dropped rather than emitted as a blank slide.
//
// PAGINATION (what happens when one slide's content does not fit): body lines
// beyond a derived per-slide budget CONTINUE on further slides, each carrying
// the same title plus a numeric `(2/3)` marker. Content is never clipped and
// never silently dropped. The budget and its honest limits are documented at
// BODY_LINES_PER_SLIDE; the short version is that PowerPoint does not shrink
// this text to fit, so unbounded content runs off the slide invisibly.
//
// ★ Both rules are stated here on purpose. They are decisions, not properties
// of the format, and each is pinned by its own tests — segmentation through
// `segmentIntoSlides`, pagination through `paginateLines` and the slide-count
// assertions.
//
// ★★ A slide is TEXT ONLY. PowerPoint's real table (`a:tbl`) is a graphicFrame
// with its own grid model, and the primitives module deliberately carries no
// helper for one; tables and data sections are therefore laid out as aligned
// text lines. That is a recorded S1 limitation, not an oversight — a wrong
// `a:tbl` is a package PowerPoint refuses to open, which is strictly worse
// than plain lines it renders.
//
// ★★★ NOTHING HERE ESCAPES ITS OWN XML, and that is deliberate: `pptxTextBox`
// runs `xmlEscape` over every line AND every run it emits. Escaping here as
// well would DOUBLE-escape, so a user's "&" would read as a literal "&amp;" on
// the slide. The corollary is that every string reaching a slide MUST go
// through `pptxTextBox` — concatenating text into shape XML by hand produces a
// package PowerPoint rejects outright, and it fails silently until someone
// opens it. That is why the styled-run support added for paragraph marks went
// into the PRIMITIVE as a semantic `PptxRun` rather than as run XML built here.
//
// ★★ paragraph.html is PARSED, not projected to flat text. `htmlToRichLines`
// (shared with the DOCX renderer precisely so the two cannot drift) yields one
// RichLine per block boundary carrying styled runs, and each becomes one
// `<a:p>` — so bold/italic/underline/strike/code/highlight/sub/sup survive
// instead of being flattened away. TABLE cells still take the flat projection;
// that is the recorded `a:tbl` limitation above, not this gap.
// ★★ DOM-BOUND as a result: `htmlToRichLines` parses with DOMParser, so this
// module must never be reached from a node script.

import type { DocBlock, ProjectDocument } from "./document-model";
import {
  type PptxParagraph,
  type PptxRun,
  buildPptxPackage,
  pptxAccentBar,
  pptxBackgroundRect,
  pptxTextBox,
  pptxTitleSubtitleShapes,
  wrapPptxSlide,
} from "./ooxml-pptx-primitives";
import {
  COLOR_DARK_BLUE,
  COLOR_GREEN,
  COLOR_WHITE,
  PPTX_MAX_ROWS_PER_SECTION,
} from "./export-ooxml-shared";
import {
  type RichLine,
  type RichLineKind,
  type RunMark,
  type TextRun,
  bulletMarker,
  htmlToRichLines,
} from "./rich-text-runs";
import { descriptionHtml } from "./rich-text-plain";
import { RENDER_SINK } from "./html-start";
// ★★ `resolveDataSection` comes from the NEUTRAL doc-data-section module, NOT
// from a sibling renderer. Importing it from doc-render-docx would typecheck
// and work, and would also drag the DOCX OOXML builders into this graph and
// point the dependency arrow renderer → renderer. That module's own comment
// forbids it; the plan's `from "./doc-render-html"` is wrong for the same
// reason (and that module never exported it — it kept a private copy).
import { resolveDataSection } from "./doc-data-section";
import type { ExportCell } from "./export-sections";
import { cellText } from "./export-sections";
import type { Workspace } from "./workspace";
import type { Lang } from "./i18n";

export type DocSlide = { title: string; body: DocBlock[] };

/**
 * One body line on its way to a slide.
 *
 * ★ A plain `string` for everything that has no styling to carry — headings,
 * bullets, table rows, the deliberate blank line between blocks — so those
 * paths are untouched and their emitted bytes unchanged. A `RichLine` only for
 * a rich `paragraph` block, where the marks have to survive as far as the shape
 * builder. Widening the type rather than replacing it is also what keeps
 * `paginateLines`' exported contract (and its tests) valid for plain strings.
 */
export type SlideLine = string | RichLine;

/** The visible text of a line, for the length/blank decisions that do not care
 *  about styling. ★ An `hr` line has NO runs, so this is "" for one — see
 *  `isBlankLine`, which is where that matters. */
function slideLineText(line: SlideLine): string {
  return typeof line === "string" ? line : line.runs.map((r) => r.text).join("");
}

/** Whether a line is the empty spacing line, as opposed to content.
 *
 *  ★★ THE `hr` ARM IS LOAD-BEARING. A horizontal rule is a RichLine with ZERO
 *  runs, so its text is "" and every blank filter in this file would delete it
 *  — the rule would vanish from the deck with nothing to notice it by, and any
 *  test that only checks the surrounding text would still pass. A rule is
 *  content; it just happens to carry no text of its own until `HR_TEXT` draws
 *  one at emit time. */
function isBlankLine(line: SlideLine): boolean {
  if (typeof line !== "string" && line.kind === "hr") return false;
  return slideLineText(line).trim() === "";
}

/** Column separator for the text-laid-out tables. Wide enough to read as a
 *  column break in a proportional font, where a single "|" does not. */
const CELL_SEP = "  |  ";

/**
 * Pure: split a block list into slides. Exported for direct unit testing — the
 * segmentation rule is the part most likely to regress, and driving it only
 * through the rendered package would test it three layers away.
 *
 * ★ A segment left with NEITHER a title NOR a body is dropped. A pageBreak
 * immediately followed by a level-1 heading otherwise produces a wholly blank
 * slide in the middle of the deck, and nothing downstream removes it. A titled
 * slide with an empty body is kept — that is a section divider, which is
 * legitimate output.
 */
export function segmentIntoSlides(blocks: readonly DocBlock[]): DocSlide[] {
  const slides: DocSlide[] = [];

  for (const block of blocks) {
    if (block.type === "heading" && block.level === 1) {
      slides.push({ title: block.text, body: [] });
      continue;
    }
    if (block.type === "pageBreak") {
      slides.push({ title: "", body: [] });
      continue;
    }
    const current = slides[slides.length - 1];
    // Blocks before any heading or break open an implicit untitled slide.
    if (current === undefined) slides.push({ title: "", body: [block] });
    else current.body.push(block);
  }

  return slides.filter((s) => s.title !== "" || s.body.length > 0);
}

/**
 * Flatten one table cell onto a single line.
 *
 * ★★★ REQUIRED, and the reason is the degrade-to-text decision above. Cells
 * are NOT newline-free: `export-sections` routes every rich column through
 * `descriptionTextWithBreaks` (`richCell`), so a two-paragraph RAID
 * description arrives here as a cell containing "\n". `pptxTextBox` splits its
 * text on "\n" to emit one `<a:p>` per line — so an unflattened cell breaks
 * its row in half and the trailing columns start a new line with no headers
 * above them, silently destroying the column alignment that is the ONLY thing
 * making a text-laid-out table readable.
 *
 * ★★ Collapsing to a space is normally the WRONG projection for an export a
 * human reads — that is why `descriptionTextWithBreaks` exists at all. It is
 * right HERE and only here, because the boundary cannot survive in a row that
 * must stay one line; there is no cell to put a second line inside until a
 * real DrawingML `<a:tbl>` primitive exists (the follow-up slice). Paragraph
 * blocks are unaffected and still keep every boundary.
 */
function flattenCell(cell: ExportCell): string {
  // ★ A rich cell is read through its flat text projection FIRST — this
  // renderer lays out a row as one line of text and has no cell to put a
  // second paragraph inside. Without it `String(cell)` yields "[object
  // Object]" for every rich column a dataSection carries.
  return String(cellText(cell)).replace(/\s*[\r\n]+\s*/g, " ");
}

/** ONE table layout for both the `table` block and a resolved dataSection —
 *  kept shared rather than written twice, which is both the shape the BLOCKING
 *  jscpd gate flags and how the two drift apart on a later fix. */
function tableLines(
  columns: readonly string[],
  rows: readonly (readonly ExportCell[])[],
  caption?: string,
): string[] {
  const lines: string[] = [];
  if (caption) lines.push(flattenCell(caption));
  lines.push(columns.map(flattenCell).join(CELL_SEP));
  for (const row of rows) lines.push(row.map(flattenCell).join(CELL_SEP));
  return lines;
}

/** The lines ONE block contributes. Blank lines inside a block's own output
 *  are artifacts — an empty table row, an editor's empty `<p>` — and the
 *  caller strips them; the deliberate gap BETWEEN blocks is added by the
 *  caller too. ★ A horizontal rule is NOT such an artifact even though it
 *  carries no text: see `isBlankLine`. */
function blockLines(block: DocBlock, ws: Workspace, lang: Lang): SlideLine[] {
  switch (block.type) {
    case "heading":
      return [block.text];

    case "paragraph":
      // One RichLine per block boundary, each carrying its own runs — the
      // parse already does the splitting the flat projection used to need.
      // ★★ Upgrade-aware first: a legacy plain-text value is not markup, and
      // parsing it raw fuses its lines (§118). The sink is "render" — the one
      // that recognises every tag — because htmlToRichLines keeps the text of
      // any tag at all, so an allow-list-derived classifier would escape the
      // whole value instead. Same composition as doc-render-docx's richParas;
      // the reasoning lives on html-start.ts's "render" member.
      return [...htmlToRichLines(descriptionHtml(block.html, RENDER_SINK))];

    case "bullets":
      return block.items.map((item, i) => `${bulletMarker(block.ordered, i)} ${item}`);

    case "table":
      return tableLines(block.columns, block.rows, block.caption);

    case "dataSection": {
      const section = resolveDataSection(block.key, ws, lang);
      // An empty register renders as nothing, not as a bare heading with no
      // rows under it — a fresh project would otherwise grow one per deck.
      if (!section) return [];
      const total = section.rows.length;
      const truncated = total > PPTX_MAX_ROWS_PER_SECTION;
      const rows = truncated ? section.rows.slice(0, PPTX_MAX_ROWS_PER_SECTION) : section.rows;
      const lines = tableLines(section.columns, rows, section.title);
      if (truncated) {
        // ★ Cap and wording mirror export-pptx.ts, which faces the same
        // problem. This notice bounds the PACKAGE; pagination below bounds
        // what fits on a slide — two different jobs, both needed.
        // ★★ It is a MIXED-LANGUAGE sentence in a non-English deck: the frame
        // is hardcoded English like its sibling's, but `section.title` is
        // already LOCALIZED by the registry, so a German deck reads
        // "Showing the first 100 of 125 RAID rows." with a German title
        // spliced in. Wanted: an i18n key. Not done here because that means
        // opening i18n.de.ts, and silently dropping rows is worse than an
        // awkward sentence.
        lines.push(
          `Showing the first ${PPTX_MAX_ROWS_PER_SECTION} of ${total} ${section.title} rows.`,
        );
      }
      return lines;
    }

    case "pageBreak":
      // Consumed by segmentation; unreachable in practice, and if one ever
      // did land here it must contribute nothing rather than a blank line.
      return [];
  }
}

/** Body blocks → the plain lines a slide shows, with one blank line between
 *  blocks.
 *
 *  ★★ That blank line is the point. A blanket trailing
 *  `filter(l => l.trim() !== "")` used to strip EVERY empty line, so two
 *  consecutive paragraphs abutted with no visual gap and read as one. The
 *  distinction that makes stripping safe here: a blank INSIDE one block's
 *  output is an artifact, a blank BETWEEN two blocks is typography. */
function slideLines(slide: DocSlide, ws: Workspace, lang: Lang): SlideLine[] {
  const blocks = slide.body
    .map((block) => blockLines(block, ws, lang).filter((line) => !isBlankLine(line)))
    .filter((lines) => lines.length > 0);
  return blocks.flatMap((lines, i) => (i === 0 ? lines : ["", ...lines]));
}

// Slide geometry in EMUs (914400 per inch); slides are 9144000 × 5143500.
const TITLE_BOX = { xEmu: 457200, yEmu: 365760, cxEmu: 8229600, cyEmu: 685800 };
const BODY_BOX = { xEmu: 457200, yEmu: 1188720, cxEmu: 8229600, cyEmu: 3474720 };

// Sizes are HUNDREDTHS of a point (1800 = 18pt), matching `a:rPr sz`.
const TITLE_SIZE = 2800;
const BODY_SIZE = 1400;

const EMU_PER_POINT = 12700;
/** Typical PowerPoint single-line spacing as a multiple of the font size. */
const LINE_SPACING = 1.2;

/**
 * How many body lines fit on one slide, DERIVED from the box and the font size
 * so that changing either moves the budget with it:
 *
 *   BODY_BOX.cyEmu 3474720 / EMU_PER_POINT 12700 = 273.6pt of height
 *   BODY_SIZE 1400 hundredths = 14pt, × 1.2 spacing  = 16.8pt per line
 *   floor(273.6 / 16.8)                             = 16 lines
 *
 * ★★★ WHY THIS IS NEEDED AT ALL: the body text does not shrink to fit.
 * `bodyPr` emits `wrap="square"` with NO `normAutofit`/`spAutoFit`, so
 * PowerPoint's no-autofit default lets text run straight past the shape
 * instead of scaling it. Overflow is therefore INVISIBLE in the XML and shows
 * up only when a human opens the deck — which is exactly the class of defect
 * no test in this repo can catch, so the renderer has to bound it.
 *
 * ★★ HONEST LIMIT: this counts LINES, not RENDERED lines. `wrap="square"`
 * means one long line wraps and consumes more than one line of height, and
 * nothing here can measure text — jsdom has no layout and the box is never
 * rendered. So the budget is sound for short lines and optimistic for long
 * ones. It converts UNBOUNDED overflow into BOUNDED overflow; it is not a
 * promise that every slide fits, and only opening a real deck can confirm
 * that.
 */
const BODY_LINES_PER_SLIDE = Math.floor(
  BODY_BOX.cyEmu / EMU_PER_POINT / ((BODY_SIZE / 100) * LINE_SPACING),
);

/**
 * Split a slide's lines into per-slide chunks.
 *
 * Returns `[[]]` for an empty list so a titled slide with no body still yields
 * exactly one slide (a section divider); the caller drops the untitled case.
 */
export function paginateLines(lines: readonly SlideLine[], perSlide: number): SlideLine[][] {
  if (lines.length === 0) return [[]];
  const chunks: SlideLine[][] = [];
  for (let i = 0; i < lines.length; i += perSlide) {
    const chunk = lines.slice(i, i + perSlide);
    // A gap between blocks is typography mid-slide and dead space at the top
    // of a continuation, so drop any blank a chunk boundary left leading.
    while (chunk.length > 0 && isBlankLine(chunk[0])) chunk.shift();
    if (chunk.length > 0) chunks.push(chunk);
  }
  return chunks.length > 0 ? chunks : [[]];
}

/**
 * Title for chunk `index` of `total`.
 *
 * ★ The continuation marker is NUMERIC (`(2/3)`), not a word like "(cont.)".
 * Every other string this renderer adds is hardcoded English — see the
 * truncation notice — and a digit pair needs no translation, so this is the
 * one place the mixed-language problem was avoidable for free. It also says
 * more: a reader sees how much is left, not just that something preceded.
 */
function slideTitleFor(title: string, index: number, total: number): string {
  if (title === "" || total <= 1) return title;
  return `${title} (${index + 1}/${total})`;
}

/** `ST_Percentage` values PowerPoint itself writes for the two vertical
 *  alignments. Thousandths of a percent: 30000 = +30%, -25000 = -25%. */
const SUPERSCRIPT_PCT = 30000;
const SUBSCRIPT_PCT = -25000;

/** Highlight fill for a `<mark>` run.
 *
 *  ★★★ DECISION, NOT A DEFAULT — and it deliberately differs from the DOCX
 *  renderer's. That one keeps Word's "yellow" because `w:highlight` takes the
 *  CLOSED `ST_HighlightColor` enum, in which no brand hex is expressible at
 *  all. `<a:highlight>` takes a REAL colour, so that argument does not carry
 *  over and the choice is genuinely open. It goes to the AIPM accent because
 *  this file's OWN palette test enumerates the sanctioned hexes and asserts
 *  that every `<a:srgbClr>` in a slide part is one of them — unlike the
 *  repo-wide palette sweep, which scans CSS and cannot see OOXML, that test is
 *  a real gate over this renderer, and shipping FFFF00 here would mean either
 *  breaking it or carving out an exemption. 84BD00 also measures 7.67:1 against
 *  the body text colour (COLOR_TEXT = 1A1A1A, on the master's body style), so
 *  the highlighted words stay readable rather than merely marked. (WCAG 2.x
 *  relative luminance, recomputed 2026-08-08: 7.674599…, i.e. 7.67 — an earlier
 *  revision quoted 7.8, which rounds the wrong way and was never derived.)
 *  ★ ACCEPTED COST: the same document's highlight is yellow in its .docx and
 *  its printed PDF (where `doc-render-html.ts` leaves `<mark>` to the browser
 *  default) and AIPM green in its .pptx. Symmetry across the three renderings
 *  was the alternative, and it loses to a gate that is actually enforced. */
const HIGHLIGHT_RGB = COLOR_GREEN;

/** Left indent for one step of indentation, in EMUs. 228600 EMU = 0.25" = the
 *  360 twips the DOCX `Quote` and `CodeBlock` styles indent by, so the same
 *  document is indented identically in both formats. A nested list item takes a
 *  MULTIPLE of it — see `pptxIndentFor`. */
const RICH_INDENT_EMU = 228600;

/** A horizontal rule, drawn as text.
 *
 *  ★★ PPTX HAS NO PARAGRAPH BORDER — `<a:pPr>` carries no `w:pBdr` equivalent,
 *  so the DOCX trick (an empty paragraph wearing a bottom border) has nothing
 *  to map onto, and a drawn line SHAPE cannot sit inline in a text box's flow.
 *  Em-dashes are the same degrade-to-text decision this renderer already makes
 *  for tables, and they keep the rule inside the paginated line budget.
 *  ★ The length is FIXED, not measured to the box: nothing here can measure
 *  text (see BODY_LINES_PER_SLIDE), so this is a legible rule at the body size
 *  rather than a promise of full width. */
const HR_TEXT = "—".repeat(24);

/**
 * One parsed run as DrawingML run properties.
 *
 * ★★ ALL EIGHT MARKS ARE REPRESENTED — none is dropped as "no equivalent".
 * `code` and `highlight` were once slated to be emitted unstyled; they have
 * real DrawingML representations (`<a:latin>`, `<a:highlight>`) and get them.
 * ★★ DELIBERATELY NOT the DOCX rank record. There, every mark is a CHILD of
 * `<w:rPr>` and `CT_RPr` is a sequence, so the renderer must sort by rank.
 * Here the properties are ATTRIBUTES (order irrelevant) and the two children
 * are ordered inside the primitive, which owns the schema — so copying the
 * rank table over would be cargo cult.
 * ★ `sup` beats `sub` when a run somehow carries both: there is ONE `baseline`
 * attribute, so it can hold one value, and a silent nothing would be worse.
 * ★ `kind` folds the LINE's styling into every run, because a slide has no
 * style part to declare a `Quote`/`CodeBlock` in — see `DOCX_LINE_STYLE`'s
 * counterpart. Italic mirrors the DOCX `Quote` style; monospace mirrors
 * `CodeBlock`. Both are no-ops on a run that already carries the mark.
 */
function pptxRun(run: TextRun, kind: RichLineKind): PptxRun {
  const has = (mark: RunMark): boolean => run.marks.includes(mark);
  return {
    text: run.text,
    bold: has("bold"),
    italic: has("italic") || kind === "blockquote",
    underline: has("underline"),
    strike: has("strike"),
    baselinePct: has("sup") ? SUPERSCRIPT_PCT : has("sub") ? SUBSCRIPT_PCT : undefined,
    monospace: has("code") || kind === "pre",
    highlightRgb: has("highlight") ? HIGHLIGHT_RGB : undefined,
  };
}

/** One body line as one paragraph for `pptxTextBox`. A plain string keeps the
 *  uniform-text shape it always had — byte-identical, since that branch splits
 *  on "\n" and these lines are already split. */
function bodyParagraph(line: SlideLine): PptxParagraph {
  if (typeof line === "string") return { text: line, sizeHundredths: BODY_SIZE };
  if (line.kind === "hr") return { runs: [{ text: HR_TEXT }], sizeHundredths: BODY_SIZE };
  const runs = line.runs.map((run) => pptxRun(run, line.kind));
  // ★★ The marker is a RUN, not a paragraph property: this path emits no
  // bullet properties at all (see `bulletMarker`), so the ordinal has to be
  // text or it is lost outright. It is its OWN run so it inherits none of the
  // item's marks — a bold list item must not get a bold "1.".
  // ★★ `pptxIndentFor` below is deliberately NOT guarded on `continuation` — a
  // wrapped line keeps the item's indent — but the marker is: one bullet per
  // ITEM, however many lines it wraps to.
  const marked =
    line.kind === "li" && !line.continuation
      ? [{ text: `${bulletMarker(line.ordered, line.index, line.task)} ` }, ...runs]
      : runs;
  return {
    runs: marked,
    sizeHundredths: BODY_SIZE,
    indentEmu: pptxIndentFor(line),
  };
}

/**
 * The left indent one line kind takes.
 *
 * ★★★ THE `heading` ARM IS A FIX, NOT A STYLE CHOICE. This was
 * `kind === "p" ? undefined : RICH_INDENT_EMU`, written when the parser could
 * only ever hand back p/blockquote/pre/hr. Widening `RichLine` to carry
 * `heading` and `li` made that ternary silently indent every section title to
 * the blockquote depth, with tsc, lint and the whole suite green — a heading is
 * a structural marker, not an aside, and lining it up with a block quote is
 * wrong. Pinned by "does not indent a heading line".
 *
 * ★ A list item indents PER DEPTH so nesting is visible; `p` stays flush.
 */
function pptxIndentFor(line: Exclude<SlideLine, string>): number | undefined {
  if (line.kind === "p" || line.kind === "heading") return undefined;
  if (line.kind === "li") return RICH_INDENT_EMU * (line.depth + 1);
  return RICH_INDENT_EMU;
}

function buildContentSlide(title: string, lines: SlideLine[], lang: Lang): string {
  const titleShape = title
    ? pptxTextBox({
        id: 2,
        name: "Title",
        lang,
        ...TITLE_BOX,
        paragraphs: [
          { text: title, bold: true, sizeHundredths: TITLE_SIZE, colorRgb: COLOR_DARK_BLUE },
        ],
      })
    : "";

  // ★ No body shape at all when there are no lines. An empty text box still
  // emits one empty <a:p>, which is a stray blank paragraph on the slide.
  const body = lines.length
    ? pptxTextBox({
        id: 3,
        name: "Body",
        lang,
        ...BODY_BOX,
        // One <a:p> per line. ★ A plain line still goes through the uniform
        // -text branch, which splits `text` on "\n" itself — so a bullet item
        // or table cell that smuggled a newline in behaves exactly as before.
        paragraphs: lines.map(bodyParagraph),
      })
    : "";

  return wrapPptxSlide(
    pptxBackgroundRect(COLOR_WHITE) + pptxAccentBar(COLOR_DARK_BLUE) + titleShape + body,
  );
}

/** Render a document as a .pptx package. The title slide always comes first,
 *  matching `buildPptx`, so a deck is never zero slides even when the document
 *  has no blocks. */
export function renderDocumentPptx(doc: ProjectDocument, ws: Workspace, lang: Lang): Blob {
  const slideXmls: string[] = [
    wrapPptxSlide(
      pptxBackgroundRect(COLOR_DARK_BLUE) + pptxTitleSubtitleShapes(doc.title, "", lang),
    ),
  ];

  for (const slide of segmentIntoSlides(doc.blocks)) {
    const lines = slideLines(slide, ws, lang);
    // A slide whose only block resolved to nothing (an empty dataSection) has
    // no title and no lines left — the same blank-slide defect segmentation
    // drops, caught one stage later because resolution needs the workspace.
    if (!slide.title && lines.length === 0) continue;
    const chunks = paginateLines(lines, BODY_LINES_PER_SLIDE);
    for (const [i, chunk] of chunks.entries()) {
      slideXmls.push(buildContentSlide(slideTitleFor(slide.title, i, chunks.length), chunk, lang));
    }
  }

  return buildPptxPackage(slideXmls);
}
