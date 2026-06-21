// Hand-rolled DOCX (OOXML) builder. Shared ZIP writer + palette live in
// export-ooxml-shared.ts; re-exported via export-ooxml.ts.
import { type ZipEntry, buildZip } from "./zip";
import type { ExportSection } from "./export-sections";
import {
  COLOR_DARK_BLUE,
  COLOR_LIGHT_GREY,
  COLOR_MEDIUM_GREY,
  COLOR_WHITE,
  todayHuman,
  xmlEscape,
} from "./export-ooxml-shared";

// ============================================================================
// DOCX
// ============================================================================

/**
 * Render a DOCX `<w:tbl>` from a list of string column labels and plain-
 * string rows. Used for every section — Tasks, RAID, Milestones, etc.
 *
 * Column widths are distributed evenly across a standard landscape page
 * (≈14 520 twips usable width at 0.5-inch margins on A4 landscape).
 */
function buildDocxTable(columns: string[], rows: (string | number)[][]): string {
  // Fallback width when we have no pixel hint: share page width evenly.
  const PAGE_WIDTH_TWIPS = 14520;
  const colWidth = columns.length > 0
    ? Math.floor(PAGE_WIDTH_TWIPS / columns.length)
    : PAGE_WIDTH_TWIPS;
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
              <w:r><w:t xml:space="preserve">${xmlEscape(row[i] ?? "")}</w:t></w:r>
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

/** Render one ExportSection as a DOCX heading paragraph + table. */
function buildDocxSection(section: ExportSection): string {
  return `
    <w:p>
      <w:pPr><w:pStyle w:val="Title"/></w:pPr>
      <w:r>
        <w:rPr><w:color w:val="${COLOR_DARK_BLUE}"/><w:sz w:val="36"/></w:rPr>
        <w:t>${xmlEscape(section.title)}</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:rPr><w:color w:val="${COLOR_MEDIUM_GREY}"/><w:i/></w:rPr>
        <w:t xml:space="preserve">${section.rows.length} row${section.rows.length === 1 ? "" : "s"}</w:t>
      </w:r>
    </w:p>
    <w:p/>
    ${buildDocxTable(section.columns, section.rows)}
    <w:p/>`;
}

/**
 * Build a `.docx` Blob containing a title paragraph + one heading+table block
 * per ExportSection. Accepts the pre-computed sections list so the caller
 * (exportWorkspace) can compute it once and share it across all three builders.
 */
export function buildDocx(sections: ExportSection[]): Blob {
  const sectionsXml = sections.map(buildDocxSection).join("");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Title"/></w:pPr>
      <w:r>
        <w:rPr><w:color w:val="${COLOR_DARK_BLUE}"/><w:sz w:val="48"/></w:rPr>
        <w:t>List of Open Points</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:rPr><w:color w:val="${COLOR_MEDIUM_GREY}"/><w:i/></w:rPr>
        <w:t xml:space="preserve">Exported ${xmlEscape(todayHuman())}</w:t>
      </w:r>
    </w:p>
    <w:p/>
    ${sectionsXml}
    <w:sectPr>
      <w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>
      <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/>
    </w:sectPr>
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
  </w:style>
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

