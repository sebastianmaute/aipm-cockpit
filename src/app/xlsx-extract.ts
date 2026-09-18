// src/app/xlsx-extract.ts — SpreadsheetML → Markdown. One table per sheet, with
// shared-string resolution and column-reference gap filling. Values only (no
// formulas/styles). xlsm is identical (the macro blob is ignored). Pure.

import { decodeUtf8, extractRuns, unescapeXml } from "./office-xml";
import { forEachTagPair, type TagPairSpec } from "./tag-pair-walk";

// Walked via forEachTagPair rather than the former `<si\b[\s\S]*?<\/si>`
// lazy pair regex, which is quadratic on repetitive unclosed markup — see
// tag-pair-walk.ts (§558). <si> has no self-closing form in practice (it
// always wraps at least one run/rPr child), so — like docx's w:tc/w:tr —
// this is a plain paired walk with no self-close handling, matching what
// the original regex supported.
const SI_PAIR: TagPairSpec = { openPattern: "<si\\b", closeName: () => "si", hasAttributes: true };

function sharedStrings(entries: Map<string, Uint8Array>): string[] {
  const b = entries.get("xl/sharedStrings.xml");
  if (!b) return [];
  const xml = decodeUtf8(b);
  const out: string[] = [];
  // Each <si> may hold multiple <t> runs (rich text) → join them.
  forEachTagPair(xml, SI_PAIR, (si) => {
    out.push(extractRuns(si.whole, "t").join(""));
    return true;
  });
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

function resolveTarget(target: string): string {
  // rels Target is relative to xl/ (e.g. "worksheets/sheet1.xml") or absolute
  // from the package root (e.g. "/xl/worksheets/sheet1.xml").
  return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
}

/** Ordered {name, path} per sheet. Prefers the workbook→rels mapping (correct
 *  even when sheets were reordered/deleted); falls back to positional pairing of
 *  declaration order with numerically-sorted sheet files when rels are absent. */
function sheetEntries(entries: Map<string, Uint8Array>): { name: string; path: string }[] {
  const paths = worksheetPaths(entries);
  const wb = entries.get("xl/workbook.xml");
  const rels = entries.get("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const relMap = new Map<string, string>();
    const relRe = /<Relationship\b[^>]*\/?>/g;
    const relXml = decodeUtf8(rels);
    let rm: RegExpExecArray | null;
    while ((rm = relRe.exec(relXml)) !== null) {
      const id = /\bId="([^"]*)"/.exec(rm[0]);
      const target = /\bTarget="([^"]*)"/.exec(rm[0]);
      if (id && target) relMap.set(id[1], target[1]);
    }
    const wbXml = decodeUtf8(wb);
    const sRe = /<sheet\b[^>]*\/?>/g;
    const mapped: { name: string; path: string }[] = [];
    let sm: RegExpExecArray | null;
    while ((sm = sRe.exec(wbXml)) !== null) {
      const nameM = /\bname="([^"]*)"/.exec(sm[0]);
      const ridM = /\br:id="([^"]*)"/.exec(sm[0]);
      if (!nameM || !ridM) continue;
      const target = relMap.get(ridM[1]);
      if (!target) continue;
      const path = resolveTarget(target);
      if (entries.has(path)) mapped.push({ name: unescapeXml(nameM[1]), path });
    }
    if (mapped.length > 0) return mapped;
  }
  const names = sheetNames(entries);
  return paths.map((path, i) => ({ name: names[i] ?? `Sheet${i + 1}`, path }));
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
  // Bounded, not ported: cXml is already one <c>...</c> element's own text
  // (sliced out by forEachXmlElement below), so this lazy pair regex runs
  // once per cell against that cell's own short content — there is exactly
  // one <v> to find or none, never a rescan-to-end-of-input over the whole
  // sheet. The quadratic shape needs a lazy pair regex looped over a large
  // shared input with a missing close; neither holds here.
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

/**
 * Walk `<name ...>...</name>` pairs OR self-closing `<name .../>` elements
 * of `name`, in document order, linearly. sheetData genuinely needs both
 * forms — Excel emits a self-closing `<c r="B2"/>` for an empty cell and
 * `<row r="5"/>` for an empty row — so this can't be forEachTagPair
 * (paired-only) directly; it reuses that walk's technique (an open-tag
 * scan plus a per-name close scan, each retired once shown absent
 * anywhere further right) plus a self-close check on the SAME ">" that
 * hasAttributes looks for, cached so a run of opens sharing one distant
 * ">" isn't rescanned by every one of them. That rescan is exactly the
 * O(n^2) this exists to avoid: without the cache, an open whose own tag
 * never closes (no ">" nearby) pays for a fresh `indexOf` out to the next
 * real ">" on every repetition, same shape as the lazy-regex bug (§558).
 *
 * `visit` returning false stops the walk, matching forEachTagPair.
 */
function forEachXmlElement(xml: string, name: string, visit: (whole: string) => boolean): void {
  // Case-sensitive ("g", not "gi") to match the original regexes this
  // replaces — OOXML element names are always lowercase in practice.
  const openRe = new RegExp(`<${name}\\b`, "g");
  let closeRe: RegExp | null = new RegExp(`</${name}\\s*>`, "g");
  let gt = -1; // cached position of the next ">"; valid while innerStart <= gt
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(xml)) !== null) {
    const innerStart = openRe.lastIndex;
    if (innerStart > gt) {
      gt = xml.indexOf(">", innerStart);
      // No ">" anywhere further right - no open tag from here on (self-
      // closing or otherwise) can ever complete. Same abort forEachTagPair
      // takes for the identical reason.
      if (gt === -1) return;
    }
    if (xml[gt - 1] === "/") {
      const end = gt + 1;
      if (!visit(xml.slice(m.index, end))) return;
      openRe.lastIndex = end;
      continue;
    }
    if (closeRe === null) continue; // this name's close is known absent everywhere further right
    closeRe.lastIndex = gt + 1;
    const cm = closeRe.exec(xml);
    if (cm === null) {
      closeRe = null;
      continue;
    }
    const end = cm.index + cm[0].length;
    if (!visit(xml.slice(m.index, end))) return;
    openRe.lastIndex = end;
  }
}

function sheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  forEachXmlElement(xml, "row", (rowXml) => {
    const cells: string[] = [];
    forEachXmlElement(rowXml, "c", (cellXml) => {
      const ref = /\br="([A-Z]+\d+)"/.exec(cellXml);
      const idx = ref ? colIndex(ref[1]) : cells.length;
      while (cells.length < idx) cells.push("");
      cells.push(cellValue(cellXml, shared).replace(/\|/g, "\\|"));
      return true;
    });
    rows.push(cells);
    return true;
  });
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
  const sections: string[] = [];
  for (const { name, path } of sheetEntries(entries)) {
    const table = renderRows(sheetRows(decodeUtf8(entries.get(path)!), shared));
    if (table === "") continue;
    sections.push(`## Sheet: ${name}\n\n${table}`);
  }
  return sections.join("\n\n");
}
