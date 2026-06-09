// Hand-rolled Office Open XML (OOXML) builders for workspace export.
//
// Why no library: jszip+docx+xlsx+pptx would pull a ~600KB dependency tree
// for what is, structurally, just a few XML strings inside a ZIP. We have
// our own ZIP writer (zip.ts), and the OOXML files we produce here are
// intentionally minimal — Word/Excel/PowerPoint open them, validate them,
// and round-trip them cleanly, but they're not feature-rich documents.
//
// Color usage matches the Acme brand palette:
//   • Dark Blue  #004159 — primary chrome / header backgrounds
//   • Green      #84BD00 — accent / completed badges
//   • Pink       #E5497C — overdue badges
//   • Light Grey #E3E6E6 — alternating row fills, dividers
//   • White      #FFFFFF — header text on dark backgrounds
//
// What each format contains:
//   DOCX — title + one heading+table block per section
//   XLSX — one worksheet per section (frozen header, autofilter, zebra rows)
//   PPTX — title slide + divider+item slides per section (capped per section)
//
// Note: this file deliberately doesn't validate the SchemaSpec exhaustively;
// it produces the subset of OOXML each application needs to open and round-
// trip a basic document. If Office complains in the future, it's almost
// always a missing relationship or a typo in a namespace URI.

import { type ZipEntry, buildZip } from "./zip";
import type { ExportSection } from "./export-sections";

// --- brand palette --------------------------------------------------------
//
// Without the leading `#` so we can drop these straight into OOXML XML
// attributes (`w:fill="004159"` etc.).
const COLOR_DARK_BLUE = "004159";
const COLOR_GREEN = "84BD00";
const COLOR_PINK = "E5497C";
const COLOR_LIGHT_GREY = "E3E6E6";
const COLOR_MEDIUM_GREY = "939598";
const COLOR_WHITE = "FFFFFF";
const COLOR_TEXT = "1A1A1A";

// Per-section row cap for PPTX. Sections with more rows emit a truncation-
// notice slide. 100 keeps the file size manageable and PowerPoint snappy.
const PPTX_MAX_ROWS_PER_SECTION = 100;

// --- shared helpers -------------------------------------------------------

/** XML-escape a string for use in text content or attribute values. */
function xmlEscape(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Today's date as YYYY-MM-DD, used as a header subtitle. */
function todayHuman(): string {
  return new Date().toISOString().slice(0, 10);
}

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

// ============================================================================
// XLSX
// ============================================================================

/**
 * Sanitize a string into a valid Excel worksheet name:
 *   • Remove characters illegal in sheet names: : \ / ? * [ ]
 *   • Truncate to 31 characters (Excel limit).
 */
function sanitizeSheetName(raw: string): string {
  return raw.replace(/[:\\/?*[\]]/g, "").slice(0, 31) || "Sheet";
}

/**
 * Given a desired name and a set of already-used names, return a unique name
 * that is still ≤31 characters. Appends a numeric suffix (_2, _3, …).
 */
function uniqueSheetName(desired: string, used: Set<string>): string {
  if (!used.has(desired)) return desired;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = desired.slice(0, 31 - suffix.length) + suffix;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Build a `.xlsx` Blob with one worksheet per ExportSection.
 *
 * Style choices (preserved from the original single-sheet builder):
 *   • Header row: Dark Blue fill, white bold text, frozen.
 *   • Body rows: alternating Light Grey / white fill.
 *   • Auto-filter on the header range.
 *   • Shared-strings dedup across all sheets.
 */
export function buildXlsx(sections: ExportSection[]): Blob {
  // Shared strings table — a single index shared across all worksheets so
  // identical strings in different sheets don't get duplicated.
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  function s(value: unknown): number {
    const str = String(value ?? "");
    const cached = stringIndex.get(str);
    if (cached !== undefined) return cached;
    const idx = strings.length;
    stringIndex.set(str, idx);
    strings.push(str);
    return idx;
  }

  // Convert column index (0-based) to Excel column letters (A, B, …, AA, …).
  function colLetter(idx: number): string {
    let result = "";
    let n = idx + 1;
    while (n > 0) {
      const r = (n - 1) % 26;
      result = String.fromCharCode(65 + r) + result;
      n = Math.floor((n - 1) / 26);
    }
    return result;
  }

  /** Build one worksheet XML. Captures the shared `s()` / `colLetter()` closures. */
  function buildSheetXml(columns: string[], rows: (string | number)[][]): string {
    const lastCol = colLetter(columns.length - 1);
    const lastRow = rows.length + 1;

    const headerCells = columns
      .map((label, i) => {
        const ref = `${colLetter(i)}1`;
        return `<c r="${ref}" t="s" s="1"><v>${s(label)}</v></c>`;
      })
      .join("");

    const bodyRowsXml = rows
      .map((row, rIdx) => {
        const rowNum = rIdx + 2;
        const styleId = rIdx % 2 === 1 ? 2 : 3;
        const cells = columns
          .map((_, ci) => {
            const ref = `${colLetter(ci)}${rowNum}`;
            return `<c r="${ref}" t="s" s="${styleId}"><v>${s(row[ci])}</v></c>`;
          })
          .join("");
        return `<row r="${rowNum}">${cells}</row>`;
      })
      .join("");

    // Default column width: ~10 chars wide (reasonable for unknown content)
    const defaultWidthChars = 14;
    const colDefs = columns
      .map(
        (_, i) =>
          `<col min="${i + 1}" max="${i + 1}" width="${defaultWidthChars}" customWidth="1"/>`,
      )
      .join("");

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <cols>${colDefs}</cols>
  <sheetData>
    <row r="1">${headerCells}</row>
    ${bodyRowsXml}
  </sheetData>
  <autoFilter ref="A1:${lastCol}${lastRow}"/>
</worksheet>`;
  }

  // Sanitize and deduplicate worksheet names.
  const usedNames = new Set<string>();
  const sheetNames: string[] = sections.map((sec) => {
    const sanitized = sanitizeSheetName(sec.title);
    const name = uniqueSheetName(sanitized, usedNames);
    usedNames.add(name);
    return name;
  });

  // Build all sheet XMLs (shared-strings index is populated as a side-effect).
  const sheetXmls = sections.map((sec) => buildSheetXml(sec.columns, sec.rows));

  // Now that shared strings are fully populated, build the SST XML.
  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">
  ${strings.map((str) => `<si><t xml:space="preserve">${xmlEscape(str)}</t></si>`).join("")}
</sst>`;

  // Styles: indices used in cells: 1 = header, 2 = grey body, 3 = white body.
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><color rgb="FF${COLOR_TEXT}"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF${COLOR_WHITE}"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF${COLOR_DARK_BLUE}"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF${COLOR_LIGHT_GREY}"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  // Workbook: one <sheet> element per section. rId1 = sheet1, rId2 = sheet2, …
  // rId offsets: sheet rIds start at 1; sharedStrings/styles use higher rIds.
  const sheetCount = sections.length;
  const sharedStringsRId = sheetCount + 1;
  const stylesRId = sheetCount + 2;

  const sheetListXml = sheetNames
    .map((name, i) => `<sheet name="${xmlEscape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("\n         ");

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheetListXml}
  </sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetNames
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("\n  ")}
  <Relationship Id="rId${sharedStringsRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId${stylesRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const sheetOverrides = sheetNames
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("\n  ");

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${sheetOverrides}
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const entries: ZipEntry[] = [
    { path: "[Content_Types].xml", data: contentTypes },
    { path: "_rels/.rels", data: rootRels },
    { path: "xl/workbook.xml", data: workbookXml },
    { path: "xl/_rels/workbook.xml.rels", data: workbookRels },
    { path: "xl/sharedStrings.xml", data: sharedStringsXml },
    { path: "xl/styles.xml", data: stylesXml },
  ];
  for (let i = 0; i < sheetXmls.length; i++) {
    entries.push({ path: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXmls[i] });
  }

  return buildZip(
    entries,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

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

  // [Content_Types].xml — one Override per slide plus static parts.
  const slideOverrides = slideXmls
    .map(
      (_, i) =>
        `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join("");

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${slideOverrides}
</Types>`;

  // presentation.xml — sldIdList with sequential IDs starting at 256.
  const sldIds = slideXmls
    .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`)
    .join("");

  const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>${sldIds}</p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;

  const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slideXmls
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`,
    )
    .join("")}
</Relationships>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

  const slideMasterXml = buildPptxSlideMaster();
  const slideMasterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

  const slideLayoutXml = buildPptxSlideLayout();
  const slideLayoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

  const themeXml = buildPptxTheme();

  // Each slide shares the same _rels (points at slideLayout1).
  const slideRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

  const entries: ZipEntry[] = [
    { path: "[Content_Types].xml", data: contentTypes },
    { path: "_rels/.rels", data: rootRels },
    { path: "ppt/presentation.xml", data: presentationXml },
    { path: "ppt/_rels/presentation.xml.rels", data: presentationRels },
    { path: "ppt/slideMasters/slideMaster1.xml", data: slideMasterXml },
    { path: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: slideMasterRels },
    { path: "ppt/slideLayouts/slideLayout1.xml", data: slideLayoutXml },
    { path: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: slideLayoutRels },
    { path: "ppt/theme/theme1.xml", data: themeXml },
  ];
  for (let i = 0; i < slideXmls.length; i++) {
    entries.push({ path: `ppt/slides/slide${i + 1}.xml`, data: slideXmls[i] });
    entries.push({ path: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: slideRels });
  }

  return buildZip(
    entries,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );
}

// ---- PPTX sub-builders ----------------------------------------------------

/**
 * A drawingml text box helper that produces a single `<p:sp>` shape. EMUs
 * (English Metric Units) are the standard PPTX coordinate: 914400 EMUs per
 * inch. Slides are 9144000 × 5143500 EMUs (16:9 widescreen).
 */
function pptxTextBox(opts: {
  id: number;
  name: string;
  xEmu: number;
  yEmu: number;
  cxEmu: number;
  cyEmu: number;
  paragraphs: Array<{
    text: string;
    bold?: boolean;
    italic?: boolean;
    sizeHundredths?: number; // Half-points; 1800 = 18pt, 4400 = 44pt
    colorRgb?: string;
  }>;
}): string {
  const runs = opts.paragraphs
    .map((p) => {
      const rPr =
        `sz="${p.sizeHundredths ?? 1800}"` +
        (p.bold ? ' b="1"' : "") +
        (p.italic ? ' i="1"' : "");
      const color = p.colorRgb
        ? `<a:solidFill><a:srgbClr val="${p.colorRgb}"/></a:solidFill>`
        : "";
      return `<a:p>
  <a:r>
    <a:rPr lang="en-US" ${rPr} dirty="0">${color}</a:rPr>
    <a:t>${xmlEscape(p.text)}</a:t>
  </a:r>
</a:p>`;
    })
    .join("");

  return `<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="${opts.id}" name="${xmlEscape(opts.name)}"/>
    <p:cNvSpPr txBox="1"/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="${opts.xEmu}" y="${opts.yEmu}"/>
      <a:ext cx="${opts.cxEmu}" cy="${opts.cyEmu}"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    <a:noFill/>
  </p:spPr>
  <p:txBody>
    <a:bodyPr wrap="square" rtlCol="0" anchor="t"/>
    <a:lstStyle/>
    ${runs}
  </p:txBody>
</p:sp>`;
}

/** Solid-color background rectangle that fills the slide. */
function pptxBackgroundRect(colorRgb: string): string {
  return `<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="100" name="Background"/>
    <p:cNvSpPr/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="0" y="0"/>
      <a:ext cx="9144000" cy="5143500"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    <a:solidFill><a:srgbClr val="${colorRgb}"/></a:solidFill>
    <a:ln><a:noFill/></a:ln>
  </p:spPr>
  <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>
</p:sp>`;
}

/** A thin accent bar pinned to the top of the slide. */
function pptxAccentBar(colorRgb: string): string {
  return `<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="101" name="Accent"/>
    <p:cNvSpPr/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="0" y="0"/>
      <a:ext cx="9144000" cy="120000"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    <a:solidFill><a:srgbClr val="${colorRgb}"/></a:solidFill>
    <a:ln><a:noFill/></a:ln>
  </p:spPr>
  <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>
</p:sp>`;
}

function buildPptxTitleSlide(): string {
  const shapes =
    pptxBackgroundRect(COLOR_DARK_BLUE) +
    pptxTextBox({
      id: 2,
      name: "Title",
      xEmu: 685800,
      yEmu: 1700000,
      cxEmu: 7772400,
      cyEmu: 900000,
      paragraphs: [
        {
          text: "List of Open Points",
          bold: true,
          sizeHundredths: 4400,
          colorRgb: COLOR_WHITE,
        },
      ],
    }) +
    pptxTextBox({
      id: 3,
      name: "Subtitle",
      xEmu: 685800,
      yEmu: 2700000,
      cxEmu: 7772400,
      cyEmu: 500000,
      paragraphs: [
        {
          text: `Exported ${todayHuman()}`,
          italic: true,
          sizeHundredths: 2400,
          colorRgb: COLOR_LIGHT_GREY,
        },
      ],
    });

  return wrapPptxSlide(shapes);
}

/** Section-divider slide: full-bleed Dark Blue with the section title. */
function buildPptxDividerSlide(title: string, rowCount: number): string {
  const shapes =
    pptxBackgroundRect(COLOR_DARK_BLUE) +
    pptxTextBox({
      id: 2,
      name: "Title",
      xEmu: 685800,
      yEmu: 1700000,
      cxEmu: 7772400,
      cyEmu: 900000,
      paragraphs: [
        {
          text: title,
          bold: true,
          sizeHundredths: 4400,
          colorRgb: COLOR_WHITE,
        },
      ],
    }) +
    pptxTextBox({
      id: 3,
      name: "Subtitle",
      xEmu: 685800,
      yEmu: 2700000,
      cxEmu: 7772400,
      cyEmu: 500000,
      paragraphs: [
        {
          text: `${rowCount} row${rowCount === 1 ? "" : "s"}`,
          italic: true,
          sizeHundredths: 2400,
          colorRgb: COLOR_LIGHT_GREY,
        },
      ],
    });

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

function wrapPptxSlide(shapesXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="9144000" cy="5143500"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="9144000" cy="5143500"/>
        </a:xfrm>
      </p:grpSpPr>
      ${shapesXml}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function buildPptxSlideMaster(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        <a:solidFill><a:srgbClr val="${COLOR_WHITE}"/></a:solidFill>
        <a:effectLst/>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle>
      <a:lvl1pPr algn="l"><a:defRPr sz="4400" b="1"><a:solidFill><a:srgbClr val="${COLOR_DARK_BLUE}"/></a:solidFill></a:defRPr></a:lvl1pPr>
    </p:titleStyle>
    <p:bodyStyle>
      <a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:srgbClr val="${COLOR_TEXT}"/></a:solidFill></a:defRPr></a:lvl1pPr>
    </p:bodyStyle>
    <p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:otherStyle>
  </p:txStyles>
</p:sldMaster>`;
}

function buildPptxSlideLayout(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;
}

function buildPptxTheme(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Acme">
  <a:themeElements>
    <a:clrScheme name="Acme">
      <a:dk1><a:srgbClr val="${COLOR_TEXT}"/></a:dk1>
      <a:lt1><a:srgbClr val="${COLOR_WHITE}"/></a:lt1>
      <a:dk2><a:srgbClr val="${COLOR_DARK_BLUE}"/></a:dk2>
      <a:lt2><a:srgbClr val="${COLOR_LIGHT_GREY}"/></a:lt2>
      <a:accent1><a:srgbClr val="${COLOR_DARK_BLUE}"/></a:accent1>
      <a:accent2><a:srgbClr val="${COLOR_GREEN}"/></a:accent2>
      <a:accent3><a:srgbClr val="60C0DD"/></a:accent3>
      <a:accent4><a:srgbClr val="${COLOR_PINK}"/></a:accent4>
      <a:accent5><a:srgbClr val="AA4899"/></a:accent5>
      <a:accent6><a:srgbClr val="${COLOR_MEDIUM_GREY}"/></a:accent6>
      <a:hlink><a:srgbClr val="${COLOR_DARK_BLUE}"/></a:hlink>
      <a:folHlink><a:srgbClr val="AA4899"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Acme">
      <a:majorFont>
        <a:latin typeface="Titillium Web"/>
        <a:ea typeface=""/>
        <a:cs typeface=""/>
      </a:majorFont>
      <a:minorFont>
        <a:latin typeface="Titillium Web"/>
        <a:ea typeface=""/>
        <a:cs typeface=""/>
      </a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
  <a:objectDefaults/>
  <a:extraClrSchemeLst/>
</a:theme>`;
}
