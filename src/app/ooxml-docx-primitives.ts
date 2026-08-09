// Format-level DOCX (OOXML) primitives, extracted verbatim from export-docx.ts
// so more than one renderer can build a .docx without re-declaring the package
// boilerplate. Nothing here knows about ExportSection — these are about the
// WordprocessingML format only. Shared ZIP writer + palette live in
// export-ooxml-shared.ts.
import { type ZipEntry, buildZip } from "./zip";
import {
  COLOR_DARK_BLUE,
  COLOR_LIGHT_GREY,
  COLOR_WHITE,
  xmlEscape,
} from "./export-ooxml-shared";

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
 * Render a DOCX `<w:tbl>` from a list of string column labels and plain-
 * string rows. Used for every section — Tasks, RAID, Milestones, etc.
 *
 * Column widths are distributed evenly across `contentWidthTwips`, which
 * defaults to the landscape measure the workspace exporter has always used.
 * A caller emitting a non-landscape `<w:sectPr>` MUST pass
 * `docxContentWidth(itsLayout)` — a table sized for another page overflows
 * this one, and still renders while doing it.
 */
export function buildDocxTable(
  columns: string[],
  rows: (string | number)[][],
  contentWidthTwips: number = docxContentWidth("landscape"),
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
          .map(
            (_, i) => `
          <w:tc>
            <w:tcPr>
              <w:tcW w:w="${colWidths[i]}" w:type="dxa"/>
              <w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>
            </w:tcPr>
            <w:p>
              <w:r>${docxCellRuns(row[i] ?? "")}</w:r>
            </w:p>
          </w:tc>`,
          )
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
 *  ★★ `page` defaults to `landscape` — the workspace exporter calls this with
 *  two arguments and its bytes are pinned by the export-ooxml suite, so the
 *  default is not a preference, it is the contract. */
export function buildDocxPackage(
  bodyXml: string,
  extraStyles = "",
  page: DocxPageLayout = "landscape",
): Blob {
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

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const entries: ZipEntry[] = [
    { path: "[Content_Types].xml", data: contentTypes },
    { path: "_rels/.rels", data: rootRels },
    { path: "word/_rels/document.xml.rels", data: docRels },
    { path: "word/document.xml", data: documentXml },
    { path: "word/styles.xml", data: stylesXml },
  ];

  return buildZip(
    entries,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
}
