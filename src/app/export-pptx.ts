// Hand-rolled PPTX (OOXML) builder. Shared helpers in export-ooxml-shared.ts.
// The format-level pieces (shapes, slide wrapper, master/layout/theme, package
// assembly) live in ooxml-pptx-primitives.ts; this file is only about turning
// ExportSections into slides.
import type { ExportSection } from "./export-sections";
import {
  COLOR_DARK_BLUE,
  COLOR_GREEN,
  COLOR_MEDIUM_GREY,
  COLOR_PINK,
  PPTX_MAX_ROWS_PER_SECTION,
  todayHuman,
} from "./export-ooxml-shared";
import {
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
export function buildPptx(sections: ExportSection[]): Blob {
  const slideXmls: string[] = [];

  // Title slide (always first).
  slideXmls.push(buildPptxTitleSlide());

  for (const section of sections) {
    const truncated = section.rows.length > PPTX_MAX_ROWS_PER_SECTION;
    const usedRows = section.rows.slice(0, PPTX_MAX_ROWS_PER_SECTION);

    // Section divider slide.
    slideXmls.push(buildPptxDividerSlide(section.title, section.rows.length));

    // One item slide per row.
    for (const row of usedRows) {
      slideXmls.push(buildPptxRowSlide(section.title, section.columns, row));
    }

    // Truncation notice when section exceeds the cap.
    if (truncated) {
      slideXmls.push(
        buildPptxNoticeSlide(
          `Showing the first ${PPTX_MAX_ROWS_PER_SECTION} of ${section.rows.length} ${section.title} rows.`,
          "Export to XLSX for the full list.",
        ),
      );
    }
  }

  return buildPptxPackage(slideXmls);
}

// ---- PPTX sub-builders ----------------------------------------------------

function buildPptxTitleSlide(): string {
  const shapes =
    pptxBackgroundRect(COLOR_DARK_BLUE) +
    pptxTitleSubtitleShapes("AI PM Cockpit", `Exported ${todayHuman()}`);

  return wrapPptxSlide(shapes);
}

/** Section-divider slide: full-bleed Dark Blue with the section title. */
function buildPptxDividerSlide(title: string, rowCount: number): string {
  const shapes =
    pptxBackgroundRect(COLOR_DARK_BLUE) +
    pptxTitleSubtitleShapes(title, `${rowCount} row${rowCount === 1 ? "" : "s"}`);

  return wrapPptxSlide(shapes);
}

/**
 * One content slide per row. The first two columns go into a prominent title
 * area; the remaining columns are listed as key: value lines in a meta block.
 * This layout works well for both wide (many-column) and narrow sections.
 */
function buildPptxRowSlide(
  sectionTitle: string,
  columns: string[],
  row: (string | number)[],
): string {
  const firstValue = String(row[0] ?? "");
  const secondValue = columns.length > 1 ? String(row[1] ?? "") : "";

  // Remaining fields shown as "Label: value" lines.
  const metaLines = columns
    .slice(2, 8) // cap at 6 extra fields so text fits the slide
    .map((col, i) => {
      const val = String(row[i + 2] ?? "");
      return val ? { text: `${col}: ${val}`, sizeHundredths: 1600 as const } : null;
    })
    .filter((p): p is { text: string; sizeHundredths: 1600 } => p !== null);

  const shapes =
    pptxAccentBar(COLOR_GREEN) +
    pptxTextBox({
      id: 2,
      name: "RowMeta",
      xEmu: 457200,
      yEmu: 380000,
      cxEmu: 8229600,
      cyEmu: 350000,
      paragraphs: [
        {
          text: `${sectionTitle} · ${firstValue}`,
          sizeHundredths: 1400,
          colorRgb: COLOR_MEDIUM_GREY,
          italic: true,
        },
      ],
    }) +
    pptxTextBox({
      id: 3,
      name: "RowTitle",
      xEmu: 457200,
      yEmu: 750000,
      cxEmu: 8229600,
      cyEmu: 900000,
      paragraphs: [
        {
          text: secondValue || firstValue || "(empty)",
          bold: true,
          sizeHundredths: 3200,
          colorRgb: COLOR_DARK_BLUE,
        },
      ],
    }) +
    (metaLines.length > 0
      ? pptxTextBox({
          id: 4,
          name: "RowFields",
          xEmu: 457200,
          yEmu: 1850000,
          cxEmu: 8229600,
          cyEmu: 2800000,
          paragraphs: metaLines,
        })
      : "");

  return wrapPptxSlide(shapes);
}

function buildPptxNoticeSlide(line1: string, line2: string): string {
  const shapes =
    pptxAccentBar(COLOR_PINK) +
    pptxTextBox({
      id: 2,
      name: "Notice1",
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
