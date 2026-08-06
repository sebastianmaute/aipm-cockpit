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
// runs `xmlEscape` over every line it emits. Escaping here as well would
// DOUBLE-escape, so a user's "&" would read as a literal "&amp;" on the slide.
// The corollary is that every string reaching a slide MUST go through
// `pptxTextBox` — concatenating text into shape XML by hand produces a package
// PowerPoint rejects outright, and it fails silently until someone opens it.

import type { DocBlock, ProjectDocument } from "./document-model";
import {
  buildPptxPackage,
  pptxAccentBar,
  pptxBackgroundRect,
  pptxTextBox,
  pptxTitleSubtitleShapes,
  wrapPptxSlide,
} from "./ooxml-pptx-primitives";
import {
  COLOR_DARK_BLUE,
  COLOR_WHITE,
  PPTX_MAX_ROWS_PER_SECTION,
} from "./export-ooxml-shared";
import { descriptionTextWithBreaks } from "./rich-text-projection";
// ★★ `resolveDataSection` comes from the NEUTRAL doc-data-section module, NOT
// from a sibling renderer. Importing it from doc-render-docx would typecheck
// and work, and would also drag the DOCX OOXML builders into this graph and
// point the dependency arrow renderer → renderer. That module's own comment
// forbids it; the plan's `from "./doc-render-html"` is wrong for the same
// reason (and that module never exported it — it kept a private copy).
import { resolveDataSection } from "./doc-data-section";
import type { Workspace } from "./workspace";
import type { Lang } from "./i18n";

export type DocSlide = { title: string; body: DocBlock[] };

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

/** Marker text for a list item. A slide carries no numbering definition, so
 *  the marker is literal text — and `ordered` still has to be honoured, or the
 *  author's choice is silently discarded (the DOCX renderer honours it too). */
function bulletMarker(ordered: boolean | undefined, index: number): string {
  return ordered ? `${index + 1}.` : "•";
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
function flattenCell(cell: string | number): string {
  return String(cell).replace(/\s*[\r\n]+\s*/g, " ");
}

/** ONE table layout for both the `table` block and a resolved dataSection —
 *  kept shared rather than written twice, which is both the shape the BLOCKING
 *  jscpd gate flags and how the two drift apart on a later fix. */
function tableLines(
  columns: readonly string[],
  rows: readonly (readonly (string | number)[])[],
  caption?: string,
): string[] {
  const lines: string[] = [];
  if (caption) lines.push(flattenCell(caption));
  lines.push(columns.map(flattenCell).join(CELL_SEP));
  for (const row of rows) lines.push(row.map(flattenCell).join(CELL_SEP));
  return lines;
}

/** The lines ONE block contributes. Blank lines inside a block's own output
 *  are artifacts — a trailing newline from the projection, an empty table row
 *  — and the caller strips them; the deliberate gap BETWEEN blocks is added by
 *  the caller too. */
function blockLines(block: DocBlock, ws: Workspace, lang: Lang): string[] {
  switch (block.type) {
    case "heading":
      return [block.text];

    case "paragraph":
      // The projection keeps a block boundary as "\n"; splitting here is what
      // stops three paragraphs arriving as one run-on line.
      return descriptionTextWithBreaks(block.html).split("\n");

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
function slideLines(slide: DocSlide, ws: Workspace, lang: Lang): string[] {
  const blocks = slide.body
    .map((block) => blockLines(block, ws, lang).filter((line) => line.trim() !== ""))
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
export function paginateLines(lines: readonly string[], perSlide: number): string[][] {
  if (lines.length === 0) return [[]];
  const chunks: string[][] = [];
  for (let i = 0; i < lines.length; i += perSlide) {
    const chunk = lines.slice(i, i + perSlide);
    // A gap between blocks is typography mid-slide and dead space at the top
    // of a continuation, so drop any blank a chunk boundary left leading.
    while (chunk.length > 0 && chunk[0].trim() === "") chunk.shift();
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

function buildContentSlide(title: string, lines: string[], lang: Lang): string {
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
        // One <a:p> per line: pptxTextBox splits `text` on "\n" itself.
        paragraphs: [{ text: lines.join("\n"), sizeHundredths: BODY_SIZE }],
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
