// src/app/xlsx-extract.ts — SpreadsheetML → Markdown. One table per sheet, with
// shared-string resolution and column-reference gap filling. Values only (no
// formulas/styles). xlsm is identical (the macro blob is ignored). Pure.

import { escapeMarkdownTableCell } from "./md-table-cell";
import { decodeUtf8, extractRuns, unescapeXml } from "./office-xml";
import { forEachOpenTag, forEachTagPair, type TagPairSpec } from "./tag-pair-walk";

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
  const openRe = /<sheet\b/g;
  while (openRe.exec(xml) !== null) {
    const next = readSheetName(xml, openRe.lastIndex);
    if (next === null) return out;
    if (next.name !== null) out.push(unescapeXml(next.name));
    openRe.lastIndex = next.resume;
  }
  return out;
}

/**
 * The end index (the tag-closing ">") of the open tag beginning at `from`
 * (the position right after the tag NAME — e.g. right after "<sheet"),
 * skipping any ">" that sits INSIDE a quoted attribute value instead of
 * stopping there. Real XML allows a literal ">" unescaped in an AttValue
 * (only "<", "&" and the quote character itself are excluded), and a
 * user-typed sheet name can and does contain one (M-7,
 * final-release-review.md) — a naive `indexOf(">", from)` truncates the tag
 * right there. Shared by `readSheetName` (the positional-fallback reader,
 * below) and `sheetTagAttrs` (the rels-mapping reader) rather than a second
 * copy of the quote-tracking scan — dup:check is blocking.
 *
 * Linear: each character between `from` and the real end is visited once.
 * A run with no unquoted ">" anywhere further right returns -1 at end of
 * input, same as `indexOf`'s own miss behaviour — both callers here already
 * short-circuit the walk on -1, so a huge unclosed-tag-soup input is still
 * one O(n) scan overall, not one per open tag (measured: see the
 * "stays linear" / "no '>' at all" tests in xlsx-extract.test.ts).
 */
function quoteAwareTagEnd(xml: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < xml.length; i++) {
    const ch = xml[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

/**
 * The name="…" of the `<sheet` open whose tag text starts at `from`, read as
 * the former `<sheet\b[^>]*\bname="([^"]*)"` regex read it, but linearly —
 * that regex's `[^>]*` ran to the next ">" from EVERY open (§558).
 *
 * The name is looked for before the tag's real end (quote-aware — see
 * `quoteAwareTagEnd`) or end of input, and the RIGHTMOST one wins, as the
 * greedy `[^>]*` backtracked to it — the same choice docx's headingDigit
 * makes. Its value then runs to the closing quote even past a ">", which
 * XML allows unescaped inside an attribute value.
 *
 * `resume` is where the regex resumed: past the value's closing quote, or,
 * with no name in the tag, past its real end — any open inside the tag sees
 * the same end and so no name either. So each character is scanned at most
 * twice: the first open after a name, inside the same tag, rescans that
 * tag's tail, finds no name (the one read was the rightmost) and skips past
 * the real end. Null means no open further right can yield a name.
 *
 * ONE divergence, on malformed input only: when the rightmost name's quote
 * never closes, the regex backtracked to an EARLIER name and read a "value"
 * running into the later `name="`; this stops instead.
 */
function readSheetName(xml: string, from: number): { name: string | null; resume: number } | null {
  const gt = quoteAwareTagEnd(xml, from);
  const tagEnd = gt === -1 ? xml.length : gt;
  const nameRe = /\bname="/g;
  const tag = xml.slice(from, tagEnd);
  let valueStart = -1;
  while (nameRe.exec(tag) !== null) valueStart = from + nameRe.lastIndex;
  if (valueStart === -1) return gt === -1 ? null : { name: null, resume: gt + 1 };
  const quote = xml.indexOf('"', valueStart);
  if (quote === -1) return null;
  return { name: xml.slice(valueStart, quote), resume: quote + 1 };
}

/**
 * The `name=`/`r:id=` values of the `<sheet` open tag beginning at `from`
 * (the position right after "<sheet"), read the same quote-aware way as
 * `readSheetName` (via the shared `quoteAwareTagEnd`) — `sheetEntries`'
 * rels-mapping path needs BOTH attributes, and real Excel writes `name`
 * before `r:id`, so the naive `forEachOpenTag`-truncated tag text this
 * replaces lost r:id too whenever name contained a ">" (M-7): the whole
 * tail of the tag, r:id included, sat past the truncation point, and the
 * sheet silently dropped out of `mapped` rather than merely being
 * mis-titled. Null means no open further right can complete (mirrors
 * `quoteAwareTagEnd`'s -1).
 */
function sheetTagAttrs(
  xml: string,
  from: number,
): { name: string | null; rid: string | null; resume: number } | null {
  const gt = quoteAwareTagEnd(xml, from);
  if (gt === -1) return null;
  const tag = xml.slice(from, gt);
  const nameM = /\bname="([^"]*)"/.exec(tag);
  const ridM = /\br:id="([^"]*)"/.exec(tag);
  return { name: nameM ? nameM[1] : null, rid: ridM ? ridM[1] : null, resume: gt + 1 };
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
    // Both walked tag by tag rather than by `<name\b[^>]*\/?>` regexes, which
    // scan to end of input from every open when no ">" follows (§558).
    const relMap = new Map<string, string>();
    forEachOpenTag(decodeUtf8(rels), "<Relationship\\b", (tag) => {
      const id = /\bId="([^"]*)"/.exec(tag);
      const target = /\bTarget="([^"]*)"/.exec(tag);
      if (id && target) relMap.set(id[1], target[1]);
      return true;
    });
    // The wb <sheet> scan is NOT forEachOpenTag — its tag text is truncated
    // at the first ">", which a name containing one (legal XML) sits inside
    // of, silently losing r:id (written after name by real Excel) along with
    // it (M-7). sheetTagAttrs reads both attributes quote-aware instead.
    const mapped: { name: string; path: string }[] = [];
    const seenPaths = new Set<string>();
    const wbXml = decodeUtf8(wb);
    const sheetOpenRe = /<sheet\b/g;
    while (sheetOpenRe.exec(wbXml) !== null) {
      const tag = sheetTagAttrs(wbXml, sheetOpenRe.lastIndex);
      if (tag === null) break;
      const target = tag.name !== null && tag.rid !== null ? relMap.get(tag.rid) : undefined;
      if (tag.name !== null && target) {
        const path = resolveTarget(target);
        // A worksheet is parsed ONCE: a workbook listing one path under many
        // <sheet> names would otherwise multiply its cost by the list length.
        if (entries.has(path) && !seenPaths.has(path)) {
          seenPaths.add(path);
          mapped.push({ name: unescapeXml(tag.name), path });
        }
      }
      sheetOpenRe.lastIndex = tag.resume;
    }
    if (mapped.length > 0) return mapped;
  }
  const names = sheetNames(entries);
  return paths.map((path, i) => ({ name: names[i] ?? `Sheet${i + 1}`, path }));
}

/** Excel's column count: A..XFD. */
const MAX_XLSX_COLUMNS = 16_384;

/** Cells one sheet may expand to, counting padding (open-followups §579).
 *  `MAX_XLSX_COLUMNS` bounds a ROW; this bounds the SHEET. Without it a row of
 *  about 35 bytes, `<c r="XFD1">`, pads out to 16,384 cells, and a 20 MB
 *  attachment can hold millions of such rows. It is also a legitimate shape
 *  (data in column XFD), so this is a budget, not a malformed-input guard. The
 *  ingest layer then caps the rendered text anyway (`MAX_NODE_EXTRACT_CHARS`,
 *  200,000 chars), so rows past this budget could never reach the model.
 *  Exported for the test. */
export const MAX_XLSX_SHEET_CELLS = 250_000;

/** Appended to a sheet cut at `MAX_XLSX_SHEET_CELLS`. */
export const XLSX_SHEET_TRUNCATED = "_(sheet truncated - exceeded the cell budget)_";

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
  // The first <v>'s text, by two forward indexOf scans. The former
  // `<v>([\s\S]*?)<\/v>` lazy regex was NOT bounded by the cell: one <c> can
  // hold the whole sheet, and with no "</v>" it rescanned to the cell's end
  // from every <v> — quadratic (§558). If the first <v> has no close after
  // it, no later one can either, exactly when the regex found no match.
  const vStart = cXml.indexOf("<v>");
  const vEnd = vStart === -1 ? -1 : cXml.indexOf("</v>", vStart + 3);
  if (vEnd === -1) return "";
  const raw = unescapeXml(cXml.slice(vStart + 3, vEnd));
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
 *
 * ★ The cached `gt` can be reused across TWO DIFFERENT opens (this open's
 * own lookahead can be judged against a ">" an earlier open's lookahead
 * found) — that's the whole point, not a hazard: `indexOf(">", innerStart)`
 * is a pure position fact about the string, not something tied to which
 * tag triggered the scan, so if a later open's `innerStart` is still `<=
 * gt`, there is provably no ">" between the two positions (indexOf would
 * have returned that nearer one first), and the cached value is exactly
 * what a fresh `indexOf` would give. The only way this misjudges a
 * self-close is a SECOND `<name` open appearing before any ">" follows the
 * first (e.g. `<c <c r="A1">...`) — a stray unescaped "<" in attribute
 * position, which only malformed XML can produce. Confirmed this is not a
 * regression: ran the original `<c\b[^>]*\/>|<c\b[\s\S]*?<\/c>` regex and
 * this function side by side against two such malformed fixtures (a bare
 * stray "<c" and one with an intervening attribute) — both produced
 * byte-identical (also-wrong-but-identically-wrong) merged output.
 *
 * ★ ONE deliberate, benign divergence survived a systematic twelve-shape
 * check of that byte-identity claim: the close pattern here is
 * `</name\s*>`, so `</c >` (whitespace before the ">") matches where the
 * original `<\/c>` alternative required an exact `</c>`. NOT tightened —
 * `\s*` is what forEachTagPair (tag-pair-walk.ts) already uses for the same
 * reason, and XML's own ETag grammar explicitly allows whitespace there
 * (`ETag ::= '</' Name S? '>'`), so this walk is MORE spec-compliant than
 * the regex it replaces, not less correct. A real writer emitting `</c >`
 * now gets its cell recognized instead of silently dropped.
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

/** Excel's last row number: a `<row r>` past it is not a real position. */
const MAX_XLSX_ROW = 1_048_576;

/** Padded cell slots across ALL sheets of one workbook. `MAX_XLSX_SHEET_CELLS`
 *  bounds one sheet; thousands of small distinct sheets of wide rows
 *  (`<c r="XFD1">` pads a row to 16,384) add up to gigabytes without this. */
export const MAX_XLSX_TOTAL_CELLS = 2_000_000;

/** Row slots one sheet may take, gaps included — separate from the cell budget,
 *  which a gap row (no cells) never touches. */
const MAX_XLSX_SHEET_ROWS = MAX_XLSX_SHEET_CELLS;

/** Row slots across ALL sheets of one workbook. A sparse worksheet costs one
 *  pointer per gap row, so without this a workbook of many distinct sparse
 *  sheets could still exhaust memory. */
export const MAX_XLSX_TOTAL_ROWS = 1_000_000;

/** Every gap row is this ONE array: a gap holds nothing, and a fresh array per
 *  row was ~1M allocations for a single hostile `<row r>`. Frozen because it is
 *  shared — rows of the grid are only ever read. */
const EMPTY_ROW: string[] = Object.freeze([]) as unknown as string[];

/** The 0-based grid index a `<row r="N">` asks for, or null when it has none or
 *  it is not usable — non-numeric, not after the row before it, or past Excel's
 *  last row — in which case the row simply follows the previous one. */
function rowIndexFromAttr(rowXml: string, rowCount: number): number | null {
  const m = /^<row\b[^>]*?\br="(\d+)"/.exec(rowXml);
  if (m === null) return null;
  const index = Number(m[1]) - 1;
  return index >= rowCount && index < MAX_XLSX_ROW ? index : null;
}

/** Rows as a grid whose index is the sheet's own row number minus one. Excel
 *  omits empty rows from the XML, so a row's `r` decides where it lands and any
 *  gap is filled with empty rows (they hold no cells, so the budget ignores them).
 *  The Markdown path drops blank rows anyway; the forecast import cites cells by
 *  row number and needs them to match what the user sees in Excel (§500). */
function sheetRows(
  xml: string,
  shared: string[],
  limits: { maxRows: number; maxCells: number },
): { rows: string[][]; cellCount: number; truncated: boolean } {
  const rows: string[][] = [];
  let cellCount = 0;
  let truncated = false;
  forEachXmlElement(xml, "row", (rowXml) => {
    const cells: string[] = [];
    forEachXmlElement(rowXml, "c", (cellXml) => {
      const ref = /\br="([A-Z]+\d+)"/.exec(cellXml);
      const idx = ref ? colIndex(ref[1]) : cells.length;
      // Past XFD no real sheet has a cell, and padding out to one (ZZZZZZZ is
      // ~8e9) would exhaust memory, so the cell is dropped instead (§558).
      if (idx >= MAX_XLSX_COLUMNS) return true;
      while (cells.length < idx) cells.push("");
      cells.push(cellValue(cellXml, shared));
      return true;
    });
    // One row is at most MAX_XLSX_COLUMNS, so the overshoot past the budget is
    // bounded by a single row (§579).
    if (cellCount + cells.length > limits.maxCells) {
      truncated = true;
      return false;
    }
    const at = rowIndexFromAttr(rowXml, rows.length) ?? rows.length;
    if (at + 1 > limits.maxRows) {
      truncated = true;
      return false;
    }
    cellCount += cells.length;
    while (rows.length < at) rows.push(EMPTY_ROW);
    rows.push(cells);
    return true;
  });
  return { rows, cellCount, truncated };
}

/** Renders raw grid rows as a Markdown table; cells are escaped HERE, so the
 *  grid itself (`extractXlsxGrid`) carries the values as the sheet holds them.
 *  Exported so the forecast import's prompt text (`sheetToPromptText`) shares
 *  this renderer and its cell budget instead of keeping a second one. */
export function renderSheetMarkdown(rows: string[][], truncatedEarlier: boolean): string {
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  // A sheet cut before its first data row still says it was cut.
  if (nonEmpty.length === 0) return truncatedEarlier ? XLSX_SHEET_TRUNCATED : "";
  // Every rendered row is padded to the widest one, so the budget is on
  // rows x width: a run of one-cell rows followed by one XFD row would
  // otherwise pad every earlier row to 16,384 (§579). The width is the running
  // maximum, so the final width never exceeds what each kept row was checked
  // against. `reduce`-style, not `Math.max(...)`: a spread over a huge row
  // list would blow the call-stack argument limit.
  let width = 0;
  let kept = 0;
  for (const r of nonEmpty) {
    const w = Math.max(width, r.length);
    if ((kept + 1) * w > MAX_XLSX_SHEET_CELLS) break;
    width = w;
    kept += 1;
  }
  const truncated = truncatedEarlier || kept < nonEmpty.length;
  if (kept === 0) return XLSX_SHEET_TRUNCATED;
  const pad = (r: string[]): string[] => {
    const c = r.map(escapeMarkdownTableCell);
    while (c.length < width) c.push("");
    return c;
  };
  const header = pad(nonEmpty[0]);
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
  ];
  for (const r of nonEmpty.slice(1, kept)) lines.push(`| ${pad(r).join(" | ")} |`);
  if (truncated) lines.push("", XLSX_SHEET_TRUNCATED);
  return lines.join("\n");
}

/** Every sheet of an xlsx/xlsm entry map as raw cell rows (values only, not
 *  Markdown-escaped), in workbook order. `extractXlsx` renders from this, so
 *  the Markdown path and the grid path cannot drift. `truncated` means the
 *  sheet was cut at `MAX_XLSX_SHEET_CELLS`. */
export function extractXlsxGrid(
  entries: Map<string, Uint8Array>,
): { name: string; rows: string[][]; truncated: boolean }[] {
  const shared = sharedStrings(entries);
  let slotsLeft = MAX_XLSX_TOTAL_ROWS;
  let cellsLeft = MAX_XLSX_TOTAL_CELLS;
  return sheetEntries(entries).map(({ name, path }) => {
    // Out of slots: the sheet is not read at all, only reported as cut.
    if (slotsLeft <= 0 || cellsLeft <= 0) return { name, rows: [], truncated: true };
    const { rows, cellCount, truncated } = sheetRows(decodeUtf8(entries.get(path)!), shared, {
      maxRows: Math.min(MAX_XLSX_SHEET_ROWS, slotsLeft),
      maxCells: Math.min(MAX_XLSX_SHEET_CELLS, cellsLeft),
    });
    slotsLeft -= rows.length;
    cellsLeft -= cellCount;
    return { name, rows, truncated };
  });
}

/** True when the workbook uses the 1904 date system (`<workbookPr date1904="1"/>`,
 *  old Mac workbooks): its serials count from 1904-01-01, not 1899-12-30. */
export function isDate1904Workbook(entries: Map<string, Uint8Array>): boolean {
  const b = entries.get("xl/workbook.xml");
  if (!b) return false;
  let found = false;
  // The first <workbookPr> only: a workbook has one.
  forEachOpenTag(decodeUtf8(b), "<workbookPr\\b", (tag) => {
    found = /\bdate1904\s*=\s*(["'])(1|true)\1/.test(tag);
    return false;
  });
  return found;
}

/** Extract Markdown from an xlsx/xlsm entry map (one section per sheet). */
export function extractXlsx(entries: Map<string, Uint8Array>): string {
  const sections: string[] = [];
  for (const { name, rows, truncated } of extractXlsxGrid(entries)) {
    const table = renderSheetMarkdown(rows, truncated);
    if (table === "") continue;
    sections.push(`## Sheet: ${name}\n\n${table}`);
  }
  return sections.join("\n\n");
}
