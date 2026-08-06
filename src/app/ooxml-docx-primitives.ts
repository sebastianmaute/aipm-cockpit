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

/** Usable text width in twips (1/1440 inch) for each layout, i.e. the page
 *  width less this layout's own left+right margins. A table is sized against
 *  this, so it MUST be read from the same layout the `<w:sectPr>` uses —
 *  a table measured for landscape overflows the narrower portrait page.
 *
 *  ★ `landscape` is the shipped 14520 literal, deliberately NOT re-derived:
 *  it is slightly under the 15398 the landscape margins actually leave, and
 *  recomputing it would change the exporter's bytes. `portrait` IS derived:
 *  11906 − 907 − 907 = 10092. */
export const DOCX_CONTENT_WIDTH_TWIPS: Record<DocxPageLayout, number> = {
  landscape: 14520,
  portrait: 10092,
};

/** The `<w:sectPr>` for each layout. Orientation and margins travel TOGETHER
 *  because they are one decision: the exporter's 720-twip (0.5") margins exist
 *  to fit wide tables onto a landscape page, and prose at that measure on
 *  portrait A4 reads badly, so portrait widens to the same 18mm/16mm
 *  `doc-render-html.ts` uses for prose (18mm ≈ 1020 twips, 16mm ≈ 907).
 *
 *  ★ Portrait's dimensions are the landscape ones transposed, and
 *  `w:orient="portrait"` is written EXPLICITLY even though portrait is the
 *  ST_PageOrientation default. Both branches then assert positively — a test
 *  that pinned portrait by the ABSENCE of the attribute would also pass after
 *  a future edit dropped the whole `<w:pgSz>`.
 *
 *  ★★ Do not touch the `landscape` entry: it is the workspace exporter's
 *  shipped bytes, and any edit here re-orients every workspace export. */
const PAGE_SECT_PR: Record<DocxPageLayout, string> = {
  landscape: `<w:sectPr>
      <w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>
      <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/>
    </w:sectPr>`,
  portrait: `<w:sectPr>
      <w:pgSz w:w="11906" w:h="16838" w:orient="portrait"/>
      <w:pgMar w:top="1020" w:right="907" w:bottom="1020" w:left="907" w:header="0" w:footer="0" w:gutter="0"/>
    </w:sectPr>`,
};

/**
 * Render a DOCX `<w:tbl>` from a list of string column labels and plain-
 * string rows. Used for every section — Tasks, RAID, Milestones, etc.
 *
 * Column widths are distributed evenly across `contentWidthTwips`, which
 * defaults to the landscape measure the workspace exporter has always used.
 * A caller emitting a non-landscape `<w:sectPr>` must pass the matching
 * `DOCX_CONTENT_WIDTH_TWIPS` entry.
 */
export function buildDocxTable(
  columns: string[],
  rows: (string | number)[][],
  contentWidthTwips: number = DOCX_CONTENT_WIDTH_TWIPS.landscape,
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
    ${PAGE_SECT_PR[page]}
  </w:body>
</w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:pPr><w:spacing w:after="120"/></w:pPr>
    <w:rPr><w:sz w:val="48"/><w:color w:val="${COLOR_DARK_BLUE}"/></w:rPr>
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
