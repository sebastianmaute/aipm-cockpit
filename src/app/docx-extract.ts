// src/app/docx-extract.ts — WordprocessingML (word/document.xml) → Markdown.
// Paragraphs, heading levels (w:pStyle "HeadingN"), and tables (w:tbl). Pure.

import { decodeUtf8, extractRuns } from "./office-xml";

function cellText(tcXml: string): string {
  return extractRuns(tcXml, "w:t").join("").trim().replace(/\|/g, "\\|");
}

function renderTable(tblXml: string): string {
  const rows: string[][] = [];
  const trRe = /<w:tr\b[\s\S]*?<\/w:tr>/g;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(tblXml)) !== null) {
    const cells: string[] = [];
    const tcRe = /<w:tc\b[\s\S]*?<\/w:tc>/g;
    let tc: RegExpExecArray | null;
    while ((tc = tcRe.exec(tr[0])) !== null) cells.push(cellText(tc[0]));
    rows.push(cells);
  }
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]): string[] => {
    const c = [...r];
    while (c.length < width) c.push("");
    return c;
  };
  const header = pad(rows[0]);
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
  ];
  for (const r of rows.slice(1)) lines.push(`| ${pad(r).join(" | ")} |`);
  return lines.join("\n");
}

function renderParagraph(pXml: string): string {
  const text = extractRuns(pXml, "w:t").join("").trim();
  if (text === "") return "";
  const h = /<w:pStyle\b[^>]*w:val="(?:Heading|heading)(\d)"/.exec(pXml);
  if (h) {
    const level = Math.min(6, Math.max(1, parseInt(h[1], 10)));
    return `${"#".repeat(level)} ${text}`;
  }
  return text;
}

/** Extract Markdown from a docx's entry map (needs `word/document.xml`). */
export function extractDocx(entries: Map<string, Uint8Array>): string {
  const bytes = entries.get("word/document.xml");
  if (!bytes) return "";
  const doc = decodeUtf8(bytes);
  // Walk top-level tables and paragraphs in document order. A w:tbl is matched
  // (lazily) before w:p so a table's inner paragraphs are consumed as one block.
  const blockRe = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(doc)) !== null) {
    const block = m[0];
    const rendered = block.startsWith("<w:tbl") ? renderTable(block) : renderParagraph(block);
    if (rendered !== "") out.push(rendered);
  }
  return out.join("\n\n");
}
