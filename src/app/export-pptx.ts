// Hand-rolled PPTX (OOXML) builder. Shared helpers in export-ooxml-shared.ts.
// The format-level pieces (shapes, slide wrapper, master/layout/theme, package
// assembly) live in ooxml-pptx-primitives.ts; this file is only about turning
// ExportSections into slides.
import type { ExportCell, ExportSection } from "./export-sections";
import { cellLinkedLines, cellText, isRichCell } from "./export-sections";
import { createLinkSink, type LinkRel, type LinkSink } from "./ooxml-links";
// ★ The SHARED TextRun -> PptxRun converter, minting each relationship id
// through the sink. Reused rather than re-derived so this exporter and the
// document renderer cannot disagree about what a run's marks mean.
import { pptxRun } from "./doc-render-pptx-slides";
import { t, type Lang } from "./i18n";
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
import { DEFAULT_EXPORT_FOOTER } from "./export-footer";

// ============================================================================
// PPTX
// ============================================================================

/**
 * Build a `.pptx` Blob with a title slide + one divider+item slide block per
 * ExportSection. A one-row section gets a detail slide; a longer one gets
 * summary slides plus a detail slide per row with rich content (§153). Each
 * section is capped at PPTX_MAX_ROWS_PER_SECTION rows; if truncated, a notice
 * slide is inserted after the section items.
 *
 * Slide dimensions are 16:9 widescreen (9144000 × 5143500 EMUs = standard).
 */
export function buildPptx(
  sections: ExportSection[],
  lang: Lang,
  /** The export footer (`exportFooterText(settings.branding)`): printed on every
   *  slide and naming the theme. */
  footer: string = DEFAULT_EXPORT_FOOTER,
): Blob {
  const slides: PptxSlide[] = [];
  // ★ The three chrome slides hold no CELL, so nothing on them can carry a
  // link: they declare no media and no relationships, exactly as before.
  const chromeSlide = (xml: string): PptxSlide => ({ xml, media: [] });

  // Title slide (always first).
  slides.push(chromeSlide(buildPptxTitleSlide(lang, footer)));

  for (const section of sections) {
    const truncated = section.rows.length > PPTX_MAX_ROWS_PER_SECTION;
    const usedRows = section.rows.slice(0, PPTX_MAX_ROWS_PER_SECTION);

    // Section divider slide.
    slides.push(chromeSlide(buildPptxDividerSlide(section.title, section.rows.length, lang, footer)));

    // §153 — a single row keeps its detail slide. Two or more rows read as
    // compact summary slides (several rows per slide), followed by a detail
    // slide ONLY for the rows whose rich fields carry content: those fields are
    // the ones a one-line summary cannot show, and a row without any would
    // only repeat its summary line at a larger size.
    if (usedRows.length === 1) {
      slides.push(...buildPptxRowSlides(section.title, section.columns, usedRows[0]!, lang, footer));
    } else {
      slides.push(...buildPptxSummarySlides(section.title, section.columns, usedRows, lang, footer).map(chromeSlide));
      for (const row of usedRows) {
        if (!hasRichContent(row)) continue;
        slides.push(...buildPptxRowSlides(section.title, section.columns, row, lang, footer));
      }
    }

    // Truncation notice when section exceeds the cap.
    if (truncated) {
      slides.push(
        chromeSlide(
          buildPptxNoticeSlide(
            t(lang, "pptxTruncatedNotice", PPTX_MAX_ROWS_PER_SECTION, section.rows.length, section.title),
            t(lang, "pptxTruncatedHint"),
            lang,
            footer,
          ),
        ),
      );
    }
  }

  // Task 9 gave every slide its own relationships; this exporter authors no
  // images, so every slide declares an empty media list — a ROW slide may
  // still declare external link relationships of its own.
  return buildPptxPackage(slides, footer);
}

// ---- PPTX sub-builders ----------------------------------------------------

function buildPptxTitleSlide(lang: Lang, footer: string): string {
  const shapes =
    pptxBackgroundRect(COLOR_DARK_BLUE) +
    pptxTitleSubtitleShapes("AI PM Cockpit", `Exported ${todayHuman()}`, lang);

  return wrapPptxSlide(shapes, { text: footer, lang, onDark: true });
}

/** Section-divider slide: full-bleed Dark Blue with the section title. */
function buildPptxDividerSlide(title: string, rowCount: number, lang: Lang, footer: string): string {
  const shapes =
    pptxBackgroundRect(COLOR_DARK_BLUE) +
    pptxTitleSubtitleShapes(title, `${rowCount} row${rowCount === 1 ? "" : "s"}`, lang);

  return wrapPptxSlide(shapes, { text: footer, lang, onDark: true });
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

/** Most `<a:p>` one detail slide's RowFields box carries before the row
 *  continues on another slide (§153; §33 introduced the bound as a cap).
 *  The box is 2,800,000 EMU tall and a 16pt line at ~1.2 spacing is ~243,840
 *  EMU, so about 11 unwrapped lines fit; 10 leaves one line of room for
 *  wrapping. Counted in EMITTED paragraphs, not `PptxParagraph`s: a flat
 *  `{text}` paragraph becomes one `<a:p>` per "\n" in `pptxTextBox`, so one
 *  multi-paragraph description is many lines. */
export const MAX_FIELD_PARAGRAPHS = 10;

/** How many `<a:p>` `pptxTextBox` emits for one paragraph. */
function emittedLineCount(p: PptxParagraph): number {
  return "runs" in p ? 1 : p.text.split("\n").length;
}

/**
 * Splits the RowFields paragraphs into pages of at most
 * {@link MAX_FIELD_PARAGRAPHS} emitted lines — every line is kept (§153; this
 * was a cap ending in "…" under §33, which dropped the rest of the row).
 *
 * ★ Under the bound it returns the input UNCHANGED as one page, so every row
 * that fitted before is byte-identical. Over it, a flat `{text}` paragraph is
 * split into one paragraph per line first — which emits exactly the `<a:p>`
 * the unsplit paragraph would have, since `pptxTextBox` splits on "\n" the
 * same way.
 */
function pageFieldParagraphs(paragraphs: readonly PptxParagraph[]): readonly (readonly PptxParagraph[])[] {
  const total = paragraphs.reduce((n, p) => n + emittedLineCount(p), 0);
  if (total <= MAX_FIELD_PARAGRAPHS) return [paragraphs];
  const lines = paragraphs.flatMap((p): PptxParagraph[] =>
    "runs" in p ? [p] : p.text.split("\n").map((line) => ({ ...p, text: line })),
  );
  const pages: PptxParagraph[][] = [];
  for (let i = 0; i < lines.length; i += MAX_FIELD_PARAGRAPHS) {
    pages.push(lines.slice(i, i + MAX_FIELD_PARAGRAPHS));
  }
  return pages;
}

/**
 * Re-mints the relationship ids of ONE slide's paragraphs in a fresh
 * slide-scoped sink, and returns the relationships that slide references.
 *
 * ★★ Why: the row's paragraphs are built once, through one sink, and then
 * split across pages — but a relationship id is scoped to ONE slide's rels
 * part, so each page needs its own ids starting at rId2, and a page must not
 * declare a link that only sits on another page. Walking in reading order
 * through a sink that dedups by target reproduces EXACTLY the ids the build
 * sink minted when the row fits one slide, so that slide is byte-identical.
 */
function localizeLinks(
  groups: readonly (readonly PptxParagraph[])[],
  minted: readonly LinkRel[],
): { groups: PptxParagraph[][]; rels: readonly LinkRel[] } {
  const targetOf = new Map(minted.map((r) => [r.relId, r.target] as const));
  const sink = createLinkSink(2);
  const out = groups.map((paragraphs) =>
    paragraphs.map((p): PptxParagraph => {
      if (!("runs" in p)) return p;
      return {
        ...p,
        runs: p.runs.map((r) => {
          const target = r.hyperlinkRelId === undefined ? undefined : targetOf.get(r.hyperlinkRelId);
          return target === undefined ? r : { ...r, hyperlinkRelId: sink.relIdFor(target) };
        }),
      };
    }),
  );
  return { groups: out, rels: sink.rels() };
}

/** True when any field past the title carries rich text with content — the
 *  fields a summary line leaves out, so the row earns a detail slide (§153). */
function hasRichContent(row: readonly ExportCell[]): boolean {
  return row.slice(2).some((cell) => isRichCell(cell) && cell.text.trim() !== "");
}

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
 *  §336's defect in the other format. The slot's WEIGHT still applies, so a
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
 * The detail slides for one row: the first two columns go into a prominent
 * title area; every remaining non-empty column is listed as a key: value line,
 * continuing onto further slides marked "(2/3)" when they do not fit one
 * (§153 — this used to show six fields and cut the rest with "…").
 *
 * ★★ NOTHING HERE IS FLATTENED, which is why the row slide carries REAL links
 * while `doc-render-pptx.ts`'s table path keeps the inline `text (url)` form
 * (§330): every cell value lands in a paragraph of its own, so the run
 * structure a relationship hangs on survives.
 */
function buildPptxRowSlides(
  sectionTitle: string,
  columns: string[],
  row: ExportCell[],
  lang: Lang,
  footer: string,
): PptxSlide[] {
  // ★★★ IDS ARE SLIDE-SCOPED, NEVER DECK-SCOPED. A PPTX relationship id is
  // scoped to ONE `ppt/slides/_rels/slideN.xml.rels`, so ids restart at rId2 on
  // every slide. This build sink only collects targets; `localizeLinks` re-mints
  // each page's ids in a sink of that page's own.
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

  // ★ Built in the order the slide READS, because ids are minted in call
  // order: a debugger opening the rels part beside the slide finds rId2 on the
  // first link a reader meets.
  const metaParagraphs = slotParagraphs(`${sectionTitle} · `, row[0], META_SLOT, links);
  const titleParagraphs = slotParagraphs("", titleCell, TITLE_SLOT, links);
  // Remaining fields shown as "Label: value" lines — ALL of them (§153).
  const fieldParagraphs = columns
    .slice(2)
    .flatMap((col, i) =>
      slotText(row[i + 2]) ? slotParagraphs(`${col}: `, row[i + 2], FIELD_SLOT, links) : [],
    );
  const pages = pageFieldParagraphs(fieldParagraphs);

  return pages.map((page, n) => {
    const meta = pages.length === 1 ? metaParagraphs : withPageMarker(metaParagraphs, n + 1, pages.length);
    const local = localizeLinks([meta, titleParagraphs, page], links.rels());
    const [metaLines, titleLines, fieldLines] = local.groups as [PptxParagraph[], PptxParagraph[], PptxParagraph[]];
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
        paragraphs: metaLines,
      }) +
      pptxTextBox({
        id: 3,
        name: "RowTitle",
        lang,
        xEmu: 457200,
        yEmu: 750000,
        cxEmu: 8229600,
        cyEmu: 900000,
        paragraphs: titleLines,
      }) +
      (fieldLines.length > 0
        ? pptxTextBox({
            id: 4,
            name: "RowFields",
            lang,
            xEmu: 457200,
            yEmu: 1850000,
            cxEmu: 8229600,
            cyEmu: 2800000,
            paragraphs: fieldLines,
            // Shrink-on-overflow for long WRAPPED lines, which the page
            // bound cannot see. Renderer-dependent, hence the bound as well.
            autofit: "shrink",
          })
        : "");

    // ★ `rels` is `[]` for a page with no link, and `buildPptxPackage`'s
    // contract is that an empty (or omitted) list adds no relationship and no
    // part — so a link-free deck is byte-for-byte what it was.
    return { xml: wrapPptxSlide(shapes, { text: footer, lang, onDark: false }), media: [], links: local.rels };
  });
}

/** The RowMeta paragraphs with a " (n/total)" marker on the last one. */
function withPageMarker(paragraphs: readonly PptxParagraph[], n: number, total: number): PptxParagraph[] {
  const marker = ` (${n}/${total})`;
  return paragraphs.map((p, i) => {
    if (i !== paragraphs.length - 1) return p;
    return "runs" in p
      ? { ...p, runs: [...p.runs, styledRun({ text: marker }, META_SLOT)] }
      : { ...p, text: p.text + marker };
  });
}

/** Rows per summary slide, and the fields each summary line may show. A 14pt
 *  line at ~1.2 spacing is ~213,000 EMU; the 3,300,000 EMU list box holds
 *  about 15, so 8 rows leave each one room to wrap once. */
export const SUMMARY_ROWS_PER_SLIDE = 8;
const SUMMARY_FIELDS = 3;
const SUMMARY_VALUE_MAX = 60;
const SUMMARY_TITLE_SLOT: SlotStyle = { bold: true, sizeHundredths: 2400, colorRgb: COLOR_DARK_BLUE };
const SUMMARY_LINE_SLOT: SlotStyle = { sizeHundredths: 1400 };

/** One field value for a summary line: newlines folded to spaces and long
 *  values shortened — the full value is on the row's detail slide (when it is
 *  rich) and in every other export format. */
function summaryValue(cell: ExportCell): string {
  const flat = slotText(cell).replace(/\s+/g, " ").trim();
  return flat.length > SUMMARY_VALUE_MAX ? `${flat.slice(0, SUMMARY_VALUE_MAX - 1)}…` : flat;
}

/**
 * Compact summary slides for a section of two or more rows (§153): up to
 * {@link SUMMARY_ROWS_PER_SLIDE} rows per slide, one paragraph each — the
 * first two columns in bold, then up to three short NON-rich fields. Rich
 * fields are left to the row's detail slide.
 *
 * ★ Text paragraphs, not a native `a:tbl`: a DrawingML table is a graphic
 * frame whose row heights PowerPoint does not grow to fit wrapped text in
 * every viewer, and nothing in this repo can open a deck to check one. A
 * paragraph list wraps and shrinks (`autofit`) everywhere.
 * ★ No cell here carries a link: only a RICH cell can (`cellLinkedLines`), and
 * rich cells are not on a summary line — so these slides declare no
 * relationships, like the other chrome slides.
 */
function buildPptxSummarySlides(
  sectionTitle: string,
  columns: string[],
  rows: readonly ExportCell[][],
  lang: Lang,
  footer: string,
): string[] {
  const pages = Math.ceil(rows.length / SUMMARY_ROWS_PER_SLIDE);
  const out: string[] = [];
  for (let n = 0; n < pages; n++) {
    const chunk = rows.slice(n * SUMMARY_ROWS_PER_SLIDE, (n + 1) * SUMMARY_ROWS_PER_SLIDE);
    const lines: PptxParagraph[] = chunk.map((row) => {
      const head = [summaryValue(row[0]), columns.length > 1 ? summaryValue(row[1]) : ""]
        .filter((v) => v !== "")
        .join(" · ");
      const fields = columns
        .slice(2)
        .map((col, i) => ({ col, cell: row[i + 2] }))
        .filter(({ cell }) => !isRichCell(cell) && summaryValue(cell) !== "")
        .slice(0, SUMMARY_FIELDS)
        .map(({ col, cell }) => `${col}: ${summaryValue(cell)}`);
      return {
        sizeHundredths: SUMMARY_LINE_SLOT.sizeHundredths,
        runs: [
          { text: head || "(empty)", bold: true },
          ...(fields.length > 0 ? [{ text: ` — ${fields.join("; ")}`, colorRgb: COLOR_MEDIUM_GREY }] : []),
        ],
      };
    });
    const title = pages === 1 ? sectionTitle : `${sectionTitle} (${n + 1}/${pages})`;
    const shapes =
      pptxAccentBar(COLOR_GREEN) +
      pptxTextBox({
        id: 2,
        name: "SummaryTitle",
        lang,
        xEmu: 457200,
        yEmu: 380000,
        cxEmu: 8229600,
        cyEmu: 600000,
        paragraphs: [{ text: title, ...SUMMARY_TITLE_SLOT }],
      }) +
      pptxTextBox({
        id: 3,
        name: "SummaryRows",
        lang,
        xEmu: 457200,
        yEmu: 1100000,
        cxEmu: 8229600,
        cyEmu: 3300000,
        paragraphs: lines,
        autofit: "shrink",
      });
    out.push(wrapPptxSlide(shapes, { text: footer, lang, onDark: false }));
  }
  return out;
}

function buildPptxNoticeSlide(line1: string, line2: string, lang: Lang, footer: string): string {
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

  return wrapPptxSlide(shapes, { text: footer, lang, onDark: false });
}
