// src/app/doc-render-pptx.ts — blocks → PresentationML (.pptx).
//
// Segmentation: a new slide starts at every pageBreak and at every level-1
// heading, which becomes that slide's title. Level 2/3 headings stay in the
// body — splitting on every heading would shred a document into one-line
// slides.
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

/** ONE table layout for both the `table` block and a resolved dataSection —
 *  kept shared rather than written twice, which is both the shape the BLOCKING
 *  jscpd gate flags and how the two drift apart on a later fix. */
function tableLines(
  columns: readonly string[],
  rows: readonly (readonly (string | number)[])[],
  caption?: string,
): string[] {
  const lines: string[] = [];
  if (caption) lines.push(caption);
  lines.push(columns.join(CELL_SEP));
  for (const row of rows) lines.push(row.map((cell) => String(cell)).join(CELL_SEP));
  return lines;
}

/** Body blocks → the plain lines a slide shows. */
function slideLines(slide: DocSlide, ws: Workspace, lang: Lang): string[] {
  const lines: string[] = [];

  for (const block of slide.body) {
    switch (block.type) {
      case "heading":
        lines.push(block.text);
        break;

      case "paragraph":
        // The projection keeps a block boundary as "\n"; splitting here is what
        // stops three paragraphs arriving as one run-on line.
        lines.push(...descriptionTextWithBreaks(block.html).split("\n"));
        break;

      case "bullets":
        lines.push(...block.items.map((item, i) => `${bulletMarker(block.ordered, i)} ${item}`));
        break;

      case "table":
        lines.push(...tableLines(block.columns, block.rows, block.caption));
        break;

      case "dataSection": {
        const section = resolveDataSection(block.key, ws, lang);
        // An empty register renders as nothing, not as a bare heading with no
        // rows under it — a fresh project would otherwise grow one per deck.
        if (!section) break;
        const total = section.rows.length;
        const truncated = total > PPTX_MAX_ROWS_PER_SECTION;
        const rows = truncated ? section.rows.slice(0, PPTX_MAX_ROWS_PER_SECTION) : section.rows;
        lines.push(...tableLines(section.columns, rows, section.title));
        if (truncated) {
          // ★ Wording and cap mirror export-pptx.ts, which faces the same
          // problem; English like its sibling, since a slide notice has no
          // i18n key yet. Silently dropping rows would be worse.
          lines.push(
            `Showing the first ${PPTX_MAX_ROWS_PER_SECTION} of ${total} ${section.title} rows.`,
          );
        }
        break;
      }

      case "pageBreak":
        // Consumed by segmentation; unreachable in practice, and if one ever
        // did land here it must contribute nothing rather than a blank line.
        break;
    }
  }

  return lines.filter((line) => line.trim() !== "");
}

// Slide geometry in EMUs (914400 per inch); slides are 9144000 × 5143500.
const TITLE_BOX = { xEmu: 457200, yEmu: 365760, cxEmu: 8229600, cyEmu: 685800 };
const BODY_BOX = { xEmu: 457200, yEmu: 1188720, cxEmu: 8229600, cyEmu: 3474720 };

// Sizes are HUNDREDTHS of a point (1800 = 18pt), matching `a:rPr sz`.
const TITLE_SIZE = 2800;
const BODY_SIZE = 1400;

function buildContentSlide(slide: DocSlide, lines: string[]): string {
  const title = slide.title
    ? pptxTextBox({
        id: 2,
        name: "Title",
        ...TITLE_BOX,
        paragraphs: [
          { text: slide.title, bold: true, sizeHundredths: TITLE_SIZE, colorRgb: COLOR_DARK_BLUE },
        ],
      })
    : "";

  // ★ No body shape at all when there are no lines. An empty text box still
  // emits one empty <a:p>, which is a stray blank paragraph on the slide.
  const body = lines.length
    ? pptxTextBox({
        id: 3,
        name: "Body",
        ...BODY_BOX,
        // One <a:p> per line: pptxTextBox splits `text` on "\n" itself.
        paragraphs: [{ text: lines.join("\n"), sizeHundredths: BODY_SIZE }],
      })
    : "";

  return wrapPptxSlide(
    pptxBackgroundRect(COLOR_WHITE) + pptxAccentBar(COLOR_DARK_BLUE) + title + body,
  );
}

/** Render a document as a .pptx package. The title slide always comes first,
 *  matching `buildPptx`, so a deck is never zero slides even when the document
 *  has no blocks. */
export function renderDocumentPptx(doc: ProjectDocument, ws: Workspace, lang: Lang): Blob {
  const slideXmls: string[] = [
    wrapPptxSlide(pptxBackgroundRect(COLOR_DARK_BLUE) + pptxTitleSubtitleShapes(doc.title, "")),
  ];

  for (const slide of segmentIntoSlides(doc.blocks)) {
    const lines = slideLines(slide, ws, lang);
    // A slide whose only block resolved to nothing (an empty dataSection) has
    // no title and no lines left — the same blank-slide defect segmentation
    // drops, caught one stage later because resolution needs the workspace.
    if (!slide.title && lines.length === 0) continue;
    slideXmls.push(buildContentSlide(slide, lines));
  }

  return buildPptxPackage(slideXmls);
}
