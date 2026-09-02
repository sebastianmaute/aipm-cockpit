// Hand-rolled XLSX (OOXML) builder. Shared helpers in export-ooxml-shared.ts.
import { type ZipEntry, buildZip } from "./zip";
import type { ExportCell, ExportSection } from "./export-sections";
import { cellTextWithLinks } from "./export-sections";
import {
  COLOR_DARK_BLUE,
  COLOR_LIGHT_GREY,
  COLOR_TEXT,
  COLOR_WHITE,
  xmlEscape,
} from "./export-ooxml-shared";

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
  function buildSheetXml(columns: string[], rows: ExportCell[][]): string {
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
            // A worksheet cell cannot lay out paragraphs, so a rich cell is
            // read through its flat text projection. `s()` already normalises
            // a missing cell via `?? ""`, which is what a short row relies on.
            // ★ `cellTextWithLinks`, not `cellText`: a shared string holds no
            // hyperlink, so a link's address has to be carried inline as
            // "text (url)" or it is lost outright (§119).
            return `<c r="${ref}" t="s" s="${styleId}"><v>${s(cellTextWithLinks(row[ci]))}</v></c>`;
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

