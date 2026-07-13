// src/app/xlsx-extract.ts — SpreadsheetML → Markdown. One table per sheet, with
// shared-string resolution and column-reference gap filling. Values only (no
// formulas/styles). xlsm is identical (the macro blob is ignored). Pure.

import { decodeUtf8, extractRuns, unescapeXml } from "./office-xml";

function sharedStrings(entries: Map<string, Uint8Array>): string[] {
  const b = entries.get("xl/sharedStrings.xml");
  if (!b) return [];
  const xml = decodeUtf8(b);
  const out: string[] = [];
  const siRe = /<si\b[\s\S]*?<\/si>/g;
  let m: RegExpExecArray | null;
  // Each <si> may hold multiple <t> runs (rich text) → join them.
  while ((m = siRe.exec(xml)) !== null) out.push(extractRuns(m[0], "t").join(""));
  return out;
}

function sheetNames(entries: Map<string, Uint8Array>): string[] {
  const b = entries.get("xl/workbook.xml");
  if (!b) return [];
  const xml = decodeUtf8(b);
  const out: string[] = [];
  const re = /<sheet\b[^>]*\bname="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(unescapeXml(m[1]));
  return out;
}

function worksheetPaths(entries: Map<string, Uint8Array>): string[] {
  return [...entries.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => sheetIndex(a) - sheetIndex(b));
}

function sheetIndex(path: string): number {
  const m = /sheet(\d+)\.xml$/.exec(path);
  return m ? parseInt(m[1], 10) : 0;
}

function colIndex(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function cellValue(cXml: string, shared: string[]): string {
  const t = /\bt="([^"]*)"/.exec(cXml);
  const type = t ? t[1] : "";
  if (type === "inlineStr") return extractRuns(cXml, "t").join("");
  const v = /<v>([\s\S]*?)<\/v>/.exec(cXml);
  if (!v) return "";
  const raw = unescapeXml(v[1]);
  if (type === "s") {
    const i = parseInt(raw, 10);
    return shared[i] ?? "";
  }
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  return raw;
}

function sheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*\/>|<row\b[\s\S]*?<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml)) !== null) {
    const cells: string[] = [];
    const cRe = /<c\b[^>]*\/>|<c\b[\s\S]*?<\/c>/g;
    let cm: RegExpExecArray | null;
    while ((cm = cRe.exec(rm[0])) !== null) {
      const ref = /\br="([A-Z]+\d+)"/.exec(cm[0]);
      const idx = ref ? colIndex(ref[1]) : cells.length;
      while (cells.length < idx) cells.push("");
      cells.push(cellValue(cm[0], shared).replace(/\|/g, "\\|"));
    }
    rows.push(cells);
  }
  return rows;
}

function renderRows(rows: string[][]): string {
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return "";
  const width = Math.max(...nonEmpty.map((r) => r.length));
  const pad = (r: string[]): string[] => {
    const c = [...r];
    while (c.length < width) c.push("");
    return c;
  };
  const header = pad(nonEmpty[0]);
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
  ];
  for (const r of nonEmpty.slice(1)) lines.push(`| ${pad(r).join(" | ")} |`);
  return lines.join("\n");
}

/** Extract Markdown from an xlsx/xlsm entry map (one section per sheet). */
export function extractXlsx(entries: Map<string, Uint8Array>): string {
  const shared = sharedStrings(entries);
  const names = sheetNames(entries);
  const paths = worksheetPaths(entries);
  const sections: string[] = [];
  paths.forEach((path, i) => {
    const table = renderRows(sheetRows(decodeUtf8(entries.get(path)!), shared));
    if (table === "") return;
    const name = names[i] ?? `Sheet${i + 1}`;
    sections.push(`## Sheet: ${name}\n\n${table}`);
  });
  return sections.join("\n\n");
}
