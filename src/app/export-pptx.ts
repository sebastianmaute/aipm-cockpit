// Hand-rolled PPTX (OOXML) builder. Shared helpers in export-ooxml-shared.ts.
// The format-level pieces (shapes, slide wrapper, master/layout/theme, package
// assembly) live in ooxml-pptx-primitives.ts; this file is only about turning
// ExportSections into slides.
import type { ExportCell, ExportSection } from "./export-sections";
import { cellLinkedLines, cellText } from "./export-sections";
import { createLinkSink, type LinkSink } from "./ooxml-links";
// ★ The SHARED TextRun -> PptxRun converter, minting each relationship id
// through the sink. Reused rather than re-derived so this exporter and the
// document renderer cannot disagree about what a run's marks mean.
import { pptxRun } from "./doc-render-pptx-slides";
import type { Lang } from "./i18n";
import {
  COLOR_DARK_BLUE,
  COLOR_GREEN,
  COLOR_MEDIUM_GREY,
  COLOR_PINK,
  PPTX_MAX_ROWS_PER_SECTION,
  todayHuman,
} from "./export-ooxml-shared";
import {
  type PptxParagraph,
  type PptxRun,
  type PptxSlide,
  buildPptxPackage,
  pptxAccentBar,
  pptxBackgroundRect,
  pptxTextBox,
  pptxTitleSubtitleShapes,
  wrapPptxSlide,
} from "./ooxml-pptx-primitives";

// ============================================================================
// PPTX
// ============================================================================

/**
 * Build a `.pptx` Blob with a title slide + one divider+item slide block per
 * ExportSection. Each section is capped at PPTX_MAX_ROWS_PER_SECTION item
 * slides; if truncated, a notice slide is inserted after the section items.
 *
 * Slide dimensions are 16:9 widescreen (9144000 × 5143500 EMUs = standard).
 */
export function buildPptx(sections: ExportSection[], lang: Lang): Blob {
  const slides: PptxSlide[] = [];
  // ★ The three chrome slides hold no CELL, so nothing on them can carry a
  // link: they declare no media and no relationships, exactly as before.
  const chromeSlide = (xml: string): PptxSlide => ({ xml, media: [] });

  // Title slide (always first).
  slides.push(chromeSlide(buildPptxTitleSlide(lang)));

  for (const section of sections) {
    const truncated = section.rows.length > PPTX_MAX_ROWS_PER_SECTION;
    const usedRows = section.rows.slice(0, PPTX_MAX_ROWS_PER_SECTION);

    // Section divider slide.
    slides.push(chromeSlide(buildPptxDividerSlide(section.title, section.rows.length, lang)));

    // One item slide per row.
    for (const row of usedRows) {
      slides.push(buildPptxRowSlide(section.title, section.columns, row, lang));
    }

    // Truncation notice when section exceeds the cap.
    if (truncated) {
      slides.push(
        chromeSlide(
          buildPptxNoticeSlide(
            `Showing the first ${PPTX_MAX_ROWS_PER_SECTION} of ${section.rows.length} ${section.title} rows.`,
            "Export to XLSX for the full list.",
            lang,
          ),
        ),
      );
    }
  }

  // Task 9 gave every slide its own relationships; this exporter authors no
  // images, so every slide declares an empty media list — a ROW slide may
  // still declare external link relationships of its own.
  return buildPptxPackage(slides);
}

// ---- PPTX sub-builders ----------------------------------------------------

function buildPptxTitleSlide(lang: Lang): string {
  const shapes =
    pptxBackgroundRect(COLOR_DARK_BLUE) +
    pptxTitleSubtitleShapes("AI PM Cockpit", `Exported ${todayHuman()}`, lang);

  return wrapPptxSlide(shapes);
}

/** Section-divider slide: full-bleed Dark Blue with the section title. */
function buildPptxDividerSlide(title: string, rowCount: number, lang: Lang): string {
  const shapes =
    pptxBackgroundRect(COLOR_DARK_BLUE) +
    pptxTitleSubtitleShapes(title, `${rowCount} row${rowCount === 1 ? "" : "s"}`, lang);

  return wrapPptxSlide(shapes);
}

/** The paragraph styling a cell VALUE inherits from its slot on the row slide.
 *  ONE shape for both branches below, so the uniform-text paragraph and the
 *  runs it degrades to cannot drift on size, weight or colour. */
type SlotStyle = {
  bold?: boolean;
  italic?: boolean;
  sizeHundredths: number;
  colorRgb?: string;
};

const META_SLOT: SlotStyle = {
  sizeHundredths: 1400,
  colorRgb: COLOR_MEDIUM_GREY,
  italic: true,
};
const TITLE_SLOT: SlotStyle = {
  bold: true,
  sizeHundredths: 3200,
  colorRgb: COLOR_DARK_BLUE,
};
const FIELD_SLOT: SlotStyle = { sizeHundredths: 1600 };

/** ★ The `?? ""` stays OUTSIDE `cellText`: its parameter excludes `undefined`
 *  while a SHORT row hands it one at runtime, and the value must still
 *  normalise to "". */
function slotText(cell: ExportCell): string {
  return String(cellText(cell) ?? "");
}

/** One run of a cell's text wearing its slot's styling.
 *
 *  ★★ A LINKED RUN IS DELIBERATELY LEFT UNCOLOURED. `buildPptxTheme` declares
 *  an `<a:hlink>` colour and the master's `p:clrMap` binds it, so PowerPoint
 *  colours an `<a:hlinkClick>` run from the theme — but ONLY while the run
 *  names no fill of its own. Painting the slot's colour over it would leave the
 *  link followable and indistinguishable from the words around it, which is
 *  §333's defect in the other format. The slot's WEIGHT still applies, so a
 *  link in the bold title stays bold.
 *  ★ A conditional SPREAD, never `colorRgb: undefined`: `pptxRun` keeps
 *  `hyperlinkRelId` ABSENT rather than own-and-undefined on an unlinked run and
 *  a test pins that, so nothing here adds an own key it does not mean. */
function styledRun(run: PptxRun, style: SlotStyle): PptxRun {
  return {
    ...run,
    bold: run.bold === true || style.bold === true,
    italic: run.italic === true || style.italic === true,
    ...(run.hyperlinkRelId === undefined && style.colorRgb !== undefined
      ? { colorRgb: style.colorRgb }
      : {}),
  };
}

/**
 * The paragraphs for one `<literal prefix><cell value>` slot.
 *
 * ★★★ THE UNIFORM-TEXT BRANCH MUST STAY REACHABLE, and that is a byte contract
 * rather than a preference: `pptxTextBox` splits a `{text}` paragraph on "\n"
 * into SEVERAL `<a:p>` and emits exactly ONE for a `{runs}` paragraph. Routing
 * every cell through runs would silently reshape every slide this exporter has
 * ever written. `cellLinkedLines` returns `undefined` for a cell with no link,
 * and that is the whole switch — for PARAGRAPH COUNT.
 * ★★★ IT IS NOT THE WHOLE SWITCH FOR TYPOGRAPHY, and this docblock said it was.
 * Taking the runs branch also turns on every mark `pptxRun` honours — bold,
 * italic, underline, strike, highlight, monospace, sup/sub baseline, and the
 * blockquote/pre LINE styling — none of which the `{text}` branch can express
 * PER RUN. ★★ Read that "per run" literally: a second cold review caught this
 * clause saying "none of which the `{text}` branch can express AT ALL", which
 * is false for bold and italic — the uniform-text member carries `bold?` and
 * `italic?` and the branch below spreads `...style` into them, so a link in the
 * bold title stays bold either way. What that branch cannot do is vary any of
 * them BETWEEN runs of one cell.
 * So ONE link anywhere in a cell re-renders that cell's WHOLE
 * typography, and two rows carrying identical markup render differently when
 * only one of them happens to carry a link. Measured side by side on a
 * RowFields cell: linked gives separate `b="1"` / `<a:latin>` / `<a:highlight>`
 * runs, unlinked gives ONE run per LINE with no per-run marks at all.
 * ★★★ AND FOR ONE LINE KIND IT CHANGES THE TEXT, NOT ONLY THE TYPOGRAPHY.
 * `htmlToRichLines` preserves a `<pre>` block's whitespace on purpose while
 * `descriptionTextWithBreaks` collapses and trims it (`cellLinkedLines`' own
 * docblock names this as the flat projection's loss). So a `<pre>` cell WITH a
 * link keeps its indentation and the same cell WITHOUT one does not — a
 * link-conditional divergence in content, which is a stronger claim than
 * anything the word "typography" covers. Pinned by "diverges from the stored
 * projection for pre, the one kind that keeps whitespace".
 * ★★ That is an improvement in isolation and a link-CONDITIONAL inconsistency
 * in aggregate. Routing unlinked rich cells through runs too would make it
 * uniform, and the byte contract above forbids exactly that today — so the
 * inconsistency is the price of the contract, not an oversight. Do not "fix"
 * one without reckoning with the other.
 * ★ The prefix is a LITERAL — a section title, a column label — never part of
 * the value, so it is one plain run on the FIRST paragraph only. That is where
 * the flat branch's "\n" split leaves it too.
 */
function slotParagraphs(
  prefix: string,
  cell: ExportCell,
  style: SlotStyle,
  links: LinkSink,
): PptxParagraph[] {
  const lines = cellLinkedLines(cell);
  if (lines === undefined) return [{ text: prefix + slotText(cell), ...style }];
  return lines.map((line, i) => ({
    sizeHundredths: style.sizeHundredths,
    runs: [
      ...(i === 0 && prefix !== "" ? [styledRun({ text: prefix }, style)] : []),
      ...line.runs.map((run) => styledRun(pptxRun(run, line.kind, links), style)),
    ],
  }));
}

/**
 * One content slide per row. The first two columns go into a prominent title
 * area; the remaining columns are listed as key: value lines in a meta block.
 * This layout works well for both wide (many-column) and narrow sections.
 *
 * ★★ NOTHING HERE IS FLATTENED, which is why the row slide carries REAL links
 * while `doc-render-pptx.ts`'s table path keeps the inline `text (url)` form
 * (§330): every cell value lands in a paragraph of its own, so the run
 * structure a relationship hangs on survives.
 */
function buildPptxRowSlide(
  sectionTitle: string,
  columns: string[],
  row: ExportCell[],
  lang: Lang,
): PptxSlide {
  // ★★★ ONE SINK PER SLIDE, NEVER ONE PER DECK. A PPTX relationship id is
  // scoped to ONE `ppt/slides/_rels/slideN.xml.rels`, so ids restart at rId2 on
  // every slide; a deck-wide sink would mint rId3 on a second slide that has no
  // rId2, naming a relationship that part does not contain.
  // ★★ `2` is the whole arithmetic: rId1 is this slide's LAYOUT and this
  // exporter authors no media, so nothing else is reserved. `doc-render-pptx.ts`
  // cannot say that — it mints media ids during the render and offsets by a
  // ceiling. Do not copy that expression here.
  const links = createLinkSink(2);

  const firstText = slotText(row[0]);
  const secondText = columns.length > 1 ? slotText(row[1]) : "";
  // ★ WHICH CELL the title shows is decided on the flat text — an empty cell is
  // skipped exactly as it always was — but the paragraphs are built from the
  // CELL, so a link inside the one that wins survives.
  const titleCell: ExportCell = secondText ? row[1] : firstText ? row[0] : "(empty)";

  // ★ Built in the order the slide READS, because the sink mints ids in call
  // order: a debugger opening the rels part beside the slide finds rId2 on the
  // first link a reader meets. Nothing depends on it — a rels part is a lookup
  // table — but the alternative is ids that ascend backwards for no reason.
  const metaParagraphs = slotParagraphs(`${sectionTitle} · `, row[0], META_SLOT, links);
  const titleParagraphs = slotParagraphs("", titleCell, TITLE_SLOT, links);
  // Remaining fields shown as "Label: value" lines, capped at 6 so text fits.
  const metaLines = columns
    .slice(2, 8)
    .flatMap((col, i) =>
      slotText(row[i + 2])
        ? slotParagraphs(`${col}: `, row[i + 2], FIELD_SLOT, links)
        : [],
    );

  const shapes =
    pptxAccentBar(COLOR_GREEN) +
    pptxTextBox({
      id: 2,
      name: "RowMeta",
      lang,
      xEmu: 457200,
      yEmu: 380000,
      cxEmu: 8229600,
      cyEmu: 350000,
      paragraphs: metaParagraphs,
    }) +
    pptxTextBox({
      id: 3,
      name: "RowTitle",
      lang,
      xEmu: 457200,
      yEmu: 750000,
      cxEmu: 8229600,
      cyEmu: 900000,
      paragraphs: titleParagraphs,
    }) +
    (metaLines.length > 0
      ? pptxTextBox({
          id: 4,
          name: "RowFields",
          lang,
          xEmu: 457200,
          yEmu: 1850000,
          cxEmu: 8229600,
          cyEmu: 2800000,
          paragraphs: metaLines,
        })
      : "");

  // ★ `rels()` is `[]` for a row with no link, and `buildPptxPackage`'s
  // contract is that an empty (or omitted) list adds no relationship and no
  // part — so a link-free deck is byte-for-byte what it was.
  return { xml: wrapPptxSlide(shapes), media: [], links: links.rels() };
}

function buildPptxNoticeSlide(line1: string, line2: string, lang: Lang): string {
  const shapes =
    pptxAccentBar(COLOR_PINK) +
    pptxTextBox({
      id: 2,
      name: "Notice1",
      lang,
      xEmu: 685800,
      yEmu: 2000000,
      cxEmu: 7772400,
      cyEmu: 700000,
      paragraphs: [
        {
          text: line1,
          bold: true,
          sizeHundredths: 2800,
          colorRgb: COLOR_DARK_BLUE,
        },
      ],
    }) +
    pptxTextBox({
      id: 3,
      name: "Notice2",
      lang,
      xEmu: 685800,
      yEmu: 2900000,
      cxEmu: 7772400,
      cyEmu: 500000,
      paragraphs: [
        {
          text: line2,
          sizeHundredths: 1800,
          colorRgb: COLOR_MEDIUM_GREY,
          italic: true,
        },
      ],
    });

  return wrapPptxSlide(shapes);
}
