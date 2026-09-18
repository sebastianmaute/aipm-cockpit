// src/app/docx-extract.ts — WordprocessingML (word/document.xml) → Markdown.
// Paragraphs, heading levels (w:pStyle "HeadingN"), and tables (w:tbl). Pure.
// LIMITATION: nested tables (a w:tbl inside a table cell) are not supported —
// the w:tbl pair spec closes on the inner table's close tag; such docs
// extract partially.

import { decodeUtf8, extractRuns } from "./office-xml";
import { forEachTagPair, type TagPairSpec } from "./tag-pair-walk";

const TC_PAIR: TagPairSpec = { openPattern: "<w:tc\\b", closeName: () => "w:tc", hasAttributes: true };
const TR_PAIR: TagPairSpec = { openPattern: "<w:tr\\b", closeName: () => "w:tr", hasAttributes: true };
// w:tbl and w:p are walked together, in document order, exactly as the
// former `<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>` alternation did —
// a table's inner paragraphs are consumed as part of the table's own pair,
// since the close scan for "w:tbl" runs past them to the table's own close.
const BLOCK_PAIR: TagPairSpec = {
  openPattern: "<w:tbl\\b|<w:p\\b",
  closeName: (openMatch) => (openMatch[0] === "<w:tbl" ? "w:tbl" : "w:p"),
  hasAttributes: true,
};

function cellText(tcXml: string): string {
  return extractRuns(tcXml, "w:t").join("").trim().replace(/\|/g, "\\|");
}

function renderTable(tblXml: string): string {
  const rows: string[][] = [];
  forEachTagPair(tblXml, TR_PAIR, (tr) => {
    const cells: string[] = [];
    forEachTagPair(tr.whole, TC_PAIR, (tc) => {
      cells.push(cellText(tc.whole));
      return true;
    });
    rows.push(cells);
    return true;
  });
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
  // Walk top-level tables and paragraphs in document order — see BLOCK_PAIR.
  const out: string[] = [];
  forEachTagPair(doc, BLOCK_PAIR, (block) => {
    const rendered =
      block.openMatch[0] === "<w:tbl" ? renderTable(block.whole) : renderParagraph(block.whole);
    if (rendered !== "") out.push(rendered);
    return true;
  });
  return out.join("\n\n");
}
