// Hand-rolled Office Open XML (OOXML) builders for tasks export.
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
//   DOCX — title, intro paragraph, table with all tasks
//   XLSX — one worksheet with frozen header row + autofilter
//   PPTX — title slide + one slide per task (capped at 100 to keep size sane)
//
// Note: this file deliberately doesn't validate the SchemaSpec exhaustively;
// it produces the subset of OOXML each application needs to open and round-
// trip a basic document. If Office complains in the future, it's almost
// always a missing relationship or a typo in a namespace URI.

import { type ZipEntry, buildZip } from "./zip";
import type { RaidItem, Task } from "./types";

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

/** Pull the human row a task should produce in the tabular formats. Order
 *  is the same in DOCX and XLSX so users get a consistent layout. */
function taskRow(task: Task): {
  id: string;
  taskName: string;
  assignee: string;
  email: string;
  due: string;
  status: string;
  priority: string;
  group: string;
  labels: string;
  blockers: string;
  notes: string;
} {
  return {
    id: String(task.id),
    taskName: task.taskName ?? "",
    assignee: task.assignee ?? "",
    email: task.assigneeEmail ?? "",
    due: task.dueDate ?? "",
    status: task.completedDate ? `Completed ${task.completedDate}` : "Open",
    priority: task.priority,
    group: task.group ?? "",
    labels: Array.isArray(task.labels) ? task.labels.join(", ") : "",
    blockers: task.blockers ?? "",
    notes: task.notes ?? "",
  };
}

const TABLE_COLUMNS: Array<{ key: keyof ReturnType<typeof taskRow>; label: string; widthPx: number }> = [
  { key: "id", label: "ID", widthPx: 50 },
  { key: "taskName", label: "Task", widthPx: 240 },
  { key: "assignee", label: "Assignee", widthPx: 130 },
  { key: "email", label: "Email", widthPx: 160 },
  { key: "due", label: "Due", widthPx: 90 },
  { key: "status", label: "Status", widthPx: 130 },
  { key: "priority", label: "Priority", widthPx: 80 },
  { key: "group", label: "Group", widthPx: 110 },
  { key: "labels", label: "Labels", widthPx: 130 },
  { key: "blockers", label: "Blockers", widthPx: 160 },
  { key: "notes", label: "Notes", widthPx: 220 },
];

/** Same idea as `taskRow` — flatten a RaidItem into plain strings for the
 *  tabular formats so the OOXML emitters don't have to know about the type. */
function raidRow(item: RaidItem): {
  id: string;
  category: string;
  title: string;
  severity: string;
  status: string;
  owner: string;
  ownerEmail: string;
  raised: string;
  target: string;
  closed: string;
  linkedTasks: string;
  causedBy: string;
  description: string;
  mitigation: string;
} {
  const categoryLabel: Record<string, string> = {
    R: "Risk",
    A: "Assumption",
    I: "Issue",
    D: "Dependency",
  };
  let severity = item.severity ?? "";
  if (item.category === "R" && item.probability && item.impact) {
    severity = `${severity} (${item.probability}×${item.impact})`;
  }
  return {
    id: String(item.id),
    category: categoryLabel[item.category] ?? item.category,
    title: item.title ?? "",
    severity,
    status: item.status,
    owner: item.owner ?? "",
    ownerEmail: item.ownerEmail ?? "",
    raised: item.raisedDate ?? "",
    target: item.targetDate ?? "",
    closed: item.closedDate ?? "",
    linkedTasks: item.linkedTaskIds.map((id) => `#${id}`).join(", "),
    causedBy: item.causedByRaidIds.map((id) => `#${id}`).join(", "),
    description: item.description ?? "",
    mitigation: item.mitigation ?? "",
  };
}

const RAID_TABLE_COLUMNS: Array<{ key: keyof ReturnType<typeof raidRow>; label: string; widthPx: number }> = [
  { key: "id", label: "ID", widthPx: 50 },
  { key: "category", label: "Category", widthPx: 90 },
  { key: "title", label: "Title", widthPx: 240 },
  { key: "severity", label: "Severity", widthPx: 110 },
  { key: "status", label: "Status", widthPx: 110 },
  { key: "owner", label: "Owner", widthPx: 130 },
  { key: "ownerEmail", label: "Email", widthPx: 160 },
  { key: "raised", label: "Raised", widthPx: 90 },
  { key: "target", label: "Target", widthPx: 90 },
  { key: "closed", label: "Closed", widthPx: 90 },
  { key: "linkedTasks", label: "Linked tasks", widthPx: 130 },
  { key: "causedBy", label: "Caused by", widthPx: 90 },
  { key: "description", label: "Description", widthPx: 200 },
  { key: "mitigation", label: "Mitigation", widthPx: 220 },
];

// ============================================================================
// DOCX
// ============================================================================

/**
 * Render a DOCX `<w:tbl>` from a column spec and a list of plain-string rows.
 * Shared by the tasks and RAID tables so both stay visually identical.
 */
function buildDocxTable<T>(
  columns: Array<{ key: keyof T; label: string; widthPx: number }>,
  rows: T[],
): string {
  // Twips: 1 inch = 1440 twips. ~15 twips per pixel — good enough for visual
  // proportions in print.
  const TWIPS_PER_PX = 15;
  const colWidths = columns.map((c) => Math.round(c.widthPx * TWIPS_PER_PX));

  const tableHeader = `
    <w:tr>
      <w:trPr><w:tblHeader/></w:trPr>
      ${columns
        .map(
          (c, i) => `
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="${colWidths[i]}" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="${COLOR_DARK_BLUE}"/>
          </w:tcPr>
          <w:p>
            <w:pPr><w:pStyle w:val="TableHeader"/></w:pPr>
            <w:r>
              <w:rPr><w:b/><w:color w:val="${COLOR_WHITE}"/></w:rPr>
              <w:t xml:space="preserve">${xmlEscape(c.label)}</w:t>
            </w:r>
          </w:p>
        </w:tc>`,
        )
        .join("")}
    </w:tr>`;

  const tableBody = rows
    .map((r, rowIdx) => {
      const fill = rowIdx % 2 === 1 ? COLOR_LIGHT_GREY : COLOR_WHITE;
      return `
      <w:tr>
        ${columns
          .map(
            (c, i) => `
          <w:tc>
            <w:tcPr>
              <w:tcW w:w="${colWidths[i]}" w:type="dxa"/>
              <w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>
            </w:tcPr>
            <w:p>
              <w:r><w:t xml:space="preserve">${xmlEscape(r[c.key] as unknown as string)}</w:t></w:r>
            </w:p>
          </w:tc>`,
          )
          .join("")}
      </w:tr>`;
    })
    .join("");

  return `<w:tbl>
      <w:tblPr>
        <w:tblStyle w:val="Grid"/>
        <w:tblW w:w="0" w:type="auto"/>
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

/** Build a `.docx` Blob containing a title + intro + tasks table, plus an
 *  optional RAID table after the tasks table when `raid` is non-empty. */
export function buildDocx(tasks: Task[], raid: readonly RaidItem[] = []): Blob {
  const rows = tasks.map(taskRow);
  const raidRows = raid.map(raidRow);

  const tasksTable = buildDocxTable(TABLE_COLUMNS, rows);
  const raidTable =
    raidRows.length > 0
      ? `
    <w:p/>
    <w:p>
      <w:pPr><w:pStyle w:val="Title"/></w:pPr>
      <w:r>
        <w:rPr><w:color w:val="${COLOR_DARK_BLUE}"/><w:sz w:val="36"/></w:rPr>
        <w:t>RAID Log</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:rPr><w:color w:val="${COLOR_MEDIUM_GREY}"/><w:i/></w:rPr>
        <w:t xml:space="preserve">${raidRows.length} item${raidRows.length === 1 ? "" : "s"} · Risks, Assumptions, Issues, Dependencies</w:t>
      </w:r>
    </w:p>
    <w:p/>
    ${buildDocxTable(RAID_TABLE_COLUMNS, raidRows)}`
      : "";

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
        <w:t xml:space="preserve">Exported ${xmlEscape(todayHuman())} · ${rows.length} task${rows.length === 1 ? "" : "s"}</w:t>
      </w:r>
    </w:p>
    <w:p/>
    ${tasksTable}
    ${raidTable}
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
 * Build a `.xlsx` Blob with one worksheet containing all tasks.
 *
 * Style choices:
 *   • Header row: Dark Blue fill, white bold text, frozen.
 *   • Body rows: alternating Light Grey / white fill.
 *   • Auto-filter on the header range so users can sort / filter in Excel.
 */
export function buildXlsx(tasks: Task[], raid: readonly RaidItem[] = []): Blob {
  const rows = tasks.map(taskRow);
  const raidRows = raid.map(raidRow);

  // Build sharedStrings table so we don't repeat long strings inline.
  // Shared across both worksheets.
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
    let s = "";
    let n = idx + 1;
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  /** Render a complete worksheet XML for a column-spec and rows. The shared
   *  `s()` / `colLetter()` closures above are captured here so both sheets
   *  use the same shared-strings index. */
  function buildSheetXml<T>(
    columns: Array<{ key: keyof T; label: string; widthPx: number }>,
    sheetRows: T[],
  ): string {
    const lastCol = colLetter(columns.length - 1);
    const lastRow = sheetRows.length + 1;

    const headerCells = columns
      .map((c, i) => {
        const ref = `${colLetter(i)}1`;
        return `<c r="${ref}" t="s" s="1"><v>${s(c.label)}</v></c>`;
      })
      .join("");

    const bodyRowsXml = sheetRows
      .map((row, rIdx) => {
        const rowNum = rIdx + 2;
        const styleId = rIdx % 2 === 1 ? 2 : 3;
        const cells = columns
          .map((c, ci) => {
            const ref = `${colLetter(ci)}${rowNum}`;
            return `<c r="${ref}" t="s" s="${styleId}"><v>${s(row[c.key])}</v></c>`;
          })
          .join("");
        return `<row r="${rowNum}">${cells}</row>`;
      })
      .join("");

    const colDefs = columns
      .map(
        (c, i) =>
          `<col min="${i + 1}" max="${i + 1}" width="${Math.max(8, c.widthPx / 7).toFixed(1)}" customWidth="1"/>`,
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

  const sheetXml = buildSheetXml(TABLE_COLUMNS, rows);
  const raidSheetXml =
    raidRows.length > 0
      ? buildSheetXml(RAID_TABLE_COLUMNS, raidRows)
      : null;

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">
  ${strings.map((str) => `<si><t xml:space="preserve">${xmlEscape(str)}</t></si>`).join("")}
</sst>`;

  // Styles. Indices used in cells: 1 = header, 2 = grey body, 3 = white body.
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

  // Workbook lists tasks first, then RAID Log when present. Sheet IDs are
  // 1-indexed; r:id values must match the Relationship Ids below.
  const sheetEntries =
    raidSheetXml !== null
      ? `<sheet name="Tasks" sheetId="1" r:id="rId1"/>
         <sheet name="RAID Log" sheetId="2" r:id="rId4"/>`
      : `<sheet name="Tasks" sheetId="1" r:id="rId1"/>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheetEntries}
  </sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  ${raidSheetXml !== null
    ? `<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>`
    : ""}
</Relationships>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  ${raidSheetXml !== null
    ? `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    : ""}
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const entries: ZipEntry[] = [
    { path: "[Content_Types].xml", data: contentTypes },
    { path: "_rels/.rels", data: rootRels },
    { path: "xl/workbook.xml", data: workbookXml },
    { path: "xl/_rels/workbook.xml.rels", data: workbookRels },
    { path: "xl/worksheets/sheet1.xml", data: sheetXml },
    { path: "xl/sharedStrings.xml", data: sharedStringsXml },
    { path: "xl/styles.xml", data: stylesXml },
  ];
  if (raidSheetXml !== null) {
    entries.push({ path: "xl/worksheets/sheet2.xml", data: raidSheetXml });
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
 * Build a `.pptx` Blob with a title slide + one slide per task.
 *
 * For very large task lists we cap the per-task slides at PPTX_MAX_SLIDES
 * (to keep file size manageable and PowerPoint snappy when opening). A
 * footer slide notes how many tasks were truncated, if any.
 *
 * Slide dimensions are 16:9 widescreen (9144000 × 5143500 EMUs = standard).
 */
export function buildPptx(
  tasks: Task[],
  raid: readonly RaidItem[] = [],
): Blob {
  const PPTX_MAX_SLIDES = 100;
  const PPTX_MAX_RAID_SLIDES = 50;
  const truncated = tasks.length > PPTX_MAX_SLIDES;
  const used = tasks.slice(0, PPTX_MAX_SLIDES);
  const raidTruncated = raid.length > PPTX_MAX_RAID_SLIDES;
  const raidUsed = raid.slice(0, PPTX_MAX_RAID_SLIDES);

  // Slide order: title → tasks → (task truncation notice) → RAID divider →
  // RAID items → (RAID truncation notice). Sections are omitted when empty.
  const slideXmls: string[] = [];
  slideXmls.push(buildPptxTitleSlide(tasks.length));
  for (const task of used) {
    slideXmls.push(buildPptxTaskSlide(task));
  }
  if (truncated) {
    slideXmls.push(
      buildPptxNoticeSlide(
        `Showing the first ${PPTX_MAX_SLIDES} of ${tasks.length} tasks.`,
        "Export to XLSX for the full list.",
      ),
    );
  }
  if (raid.length > 0) {
    slideXmls.push(buildPptxRaidDividerSlide(raid.length));
    for (const item of raidUsed) {
      slideXmls.push(buildPptxRaidSlide(item));
    }
    if (raidTruncated) {
      slideXmls.push(
        buildPptxNoticeSlide(
          `Showing the first ${PPTX_MAX_RAID_SLIDES} of ${raid.length} RAID items.`,
          "Export to XLSX for the full list.",
        ),
      );
    }
  }

  // [Content_Types].xml entries — one Override per slide, plus the static
  // layout/master/theme parts.
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

  // Presentation.xml — sldIdList lists slides with sequential ids starting
  // at 256 (PowerPoint's convention; 0–255 are reserved).
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

  // Presentation rels: rId1 = slide master, rId2..N = slides.
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

  // Slide master + layout — minimal but with our color palette wired in.
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

  // Each slide needs its own _rels pointing at the slide layout.
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
    {
      path: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      data: slideMasterRels,
    },
    { path: "ppt/slideLayouts/slideLayout1.xml", data: slideLayoutXml },
    {
      path: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      data: slideLayoutRels,
    },
    { path: "ppt/theme/theme1.xml", data: themeXml },
  ];
  for (let i = 0; i < slideXmls.length; i++) {
    entries.push({
      path: `ppt/slides/slide${i + 1}.xml`,
      data: slideXmls[i],
    });
    entries.push({
      path: `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      data: slideRels,
    });
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
    fontFamily?: string;
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
      const font = p.fontFamily
        ? `<a:latin typeface="${xmlEscape(p.fontFamily)}"/>`
        : "";
      return `<a:p>
  <a:r>
    <a:rPr lang="en-US" ${rPr} dirty="0">${color}${font}</a:rPr>
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

function buildPptxTitleSlide(taskCount: number): string {
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
          text: `${taskCount} task${taskCount === 1 ? "" : "s"} · Exported ${todayHuman()}`,
          italic: true,
          sizeHundredths: 2400,
          colorRgb: COLOR_LIGHT_GREY,
        },
      ],
    });

  return wrapPptxSlide(shapes);
}

function buildPptxTaskSlide(task: Task): string {
  const r = taskRow(task);
  const statusColor = task.completedDate ? COLOR_GREEN : COLOR_PINK;

  const shapes =
    pptxAccentBar(statusColor) +
    pptxTextBox({
      id: 2,
      name: "TaskId",
      xEmu: 457200,
      yEmu: 380000,
      cxEmu: 8229600,
      cyEmu: 350000,
      paragraphs: [
        {
          text: `#${r.id} · ${r.priority} · ${r.status}`,
          sizeHundredths: 1400,
          colorRgb: COLOR_MEDIUM_GREY,
          italic: true,
        },
      ],
    }) +
    pptxTextBox({
      id: 3,
      name: "TaskName",
      xEmu: 457200,
      yEmu: 750000,
      cxEmu: 8229600,
      cyEmu: 900000,
      paragraphs: [
        {
          text: r.taskName || "(no name)",
          bold: true,
          sizeHundredths: 3200,
          colorRgb: COLOR_DARK_BLUE,
        },
      ],
    }) +
    pptxTextBox({
      id: 4,
      name: "Meta",
      xEmu: 457200,
      yEmu: 1850000,
      cxEmu: 8229600,
      cyEmu: 1100000,
      paragraphs: [
        { text: `Assignee: ${r.assignee}`, sizeHundredths: 1600 },
        r.email ? { text: `Email: ${r.email}`, sizeHundredths: 1600 } : null,
        { text: `Due: ${r.due}`, sizeHundredths: 1600 },
        r.group
          ? { text: `Group: ${r.group}`, sizeHundredths: 1600 }
          : null,
        r.labels
          ? { text: `Labels: ${r.labels}`, sizeHundredths: 1600 }
          : null,
      ].filter((p): p is { text: string; sizeHundredths: number } => !!p),
    }) +
    pptxTextBox({
      id: 5,
      name: "Notes",
      xEmu: 457200,
      yEmu: 3300000,
      cxEmu: 8229600,
      cyEmu: 1400000,
      paragraphs: r.notes
        ? [{ text: r.notes, sizeHundredths: 1400, colorRgb: COLOR_TEXT }]
        : [
            {
              text: "(no notes)",
              sizeHundredths: 1400,
              italic: true,
              colorRgb: COLOR_MEDIUM_GREY,
            },
          ],
    });

  return wrapPptxSlide(shapes);
}

/** Section-divider slide announcing the start of the RAID log. Same shape
 *  as the title slide but with a different subtitle. */
function buildPptxRaidDividerSlide(itemCount: number): string {
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
          text: "RAID Log",
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
          text: `${itemCount} item${itemCount === 1 ? "" : "s"} · Risks, Assumptions, Issues, Dependencies`,
          italic: true,
          sizeHundredths: 2400,
          colorRgb: COLOR_LIGHT_GREY,
        },
      ],
    });

  return wrapPptxSlide(shapes);
}

/** One slide per RAID item — category + status header bar, title, severity
 *  + owner + dates meta block, mitigation text. Mirrors `buildPptxTaskSlide`
 *  layout so the deck reads consistently. */
function buildPptxRaidSlide(item: RaidItem): string {
  const r = raidRow(item);
  // Critical/High → pink (urgent), Medium → amber-ish, Low → green.
  const accentColor =
    item.severity === "Critical" || item.severity === "High"
      ? COLOR_PINK
      : item.severity === "Medium"
        ? "F59E0B"
        : COLOR_GREEN;

  const linked = r.linkedTasks ? `Linked: ${r.linkedTasks}` : "";

  const shapes =
    pptxAccentBar(accentColor) +
    pptxTextBox({
      id: 2,
      name: "RaidMeta",
      xEmu: 457200,
      yEmu: 380000,
      cxEmu: 8229600,
      cyEmu: 350000,
      paragraphs: [
        {
          text: `${r.category} · #${r.id} · ${r.severity || ""} · ${r.status}`,
          sizeHundredths: 1400,
          colorRgb: COLOR_MEDIUM_GREY,
          italic: true,
        },
      ],
    }) +
    pptxTextBox({
      id: 3,
      name: "RaidTitle",
      xEmu: 457200,
      yEmu: 750000,
      cxEmu: 8229600,
      cyEmu: 900000,
      paragraphs: [
        {
          text: r.title || "(no title)",
          bold: true,
          sizeHundredths: 3200,
          colorRgb: COLOR_DARK_BLUE,
        },
      ],
    }) +
    pptxTextBox({
      id: 4,
      name: "RaidMetaDetail",
      xEmu: 457200,
      yEmu: 1850000,
      cxEmu: 8229600,
      cyEmu: 1100000,
      paragraphs: [
        r.owner ? { text: `Owner: ${r.owner}`, sizeHundredths: 1600 } : null,
        r.target ? { text: `Target: ${r.target}`, sizeHundredths: 1600 } : null,
        r.raised ? { text: `Raised: ${r.raised}`, sizeHundredths: 1600 } : null,
        linked ? { text: linked, sizeHundredths: 1600 } : null,
      ].filter((p): p is { text: string; sizeHundredths: number } => !!p),
    }) +
    pptxTextBox({
      id: 5,
      name: "RaidMitigation",
      xEmu: 457200,
      yEmu: 3300000,
      cxEmu: 8229600,
      cyEmu: 1400000,
      paragraphs: r.mitigation
        ? [{ text: r.mitigation, sizeHundredths: 1400, colorRgb: COLOR_TEXT }]
        : r.description
          ? [{ text: r.description, sizeHundredths: 1400, colorRgb: COLOR_TEXT }]
          : [
              {
                text: "(no mitigation notes)",
                sizeHundredths: 1400,
                italic: true,
                colorRgb: COLOR_MEDIUM_GREY,
              },
            ],
    });

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
  // A minimal theme. Accent colors map onto the Acme palette so
  // anything in a slide that resolves to a theme accent picks up our brand
  // colors instead of Office's defaults.
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
