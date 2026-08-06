// Hand-rolled DOCX (OOXML) builder. Shared ZIP writer + palette live in
// export-ooxml-shared.ts; re-exported via export-ooxml.ts. The format-level
// pieces (cell runs, table, package assembly) live in ooxml-docx-primitives.ts
// so this file is only about turning ExportSections into a body.
import type { ExportSection } from "./export-sections";
import {
  COLOR_DARK_BLUE,
  COLOR_MEDIUM_GREY,
  todayHuman,
  xmlEscape,
} from "./export-ooxml-shared";
import { buildDocxPackage, buildDocxTable } from "./ooxml-docx-primitives";

// ============================================================================
// DOCX
// ============================================================================

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

  const body = `<w:p>
      <w:pPr><w:pStyle w:val="Title"/></w:pPr>
      <w:r>
        <w:rPr><w:color w:val="${COLOR_DARK_BLUE}"/><w:sz w:val="48"/></w:rPr>
        <w:t>AI PM Cockpit</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:rPr><w:color w:val="${COLOR_MEDIUM_GREY}"/><w:i/></w:rPr>
        <w:t xml:space="preserve">Exported ${xmlEscape(todayHuman())}</w:t>
      </w:r>
    </w:p>
    <w:p/>
    ${sectionsXml}`;

  return buildDocxPackage(body);
}
