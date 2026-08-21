# Office Document Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AI-Assistant chat and the create-project importer accept Office files (docx/xlsx/xlsm/pptx) by unzipping + text-extracting them to structured Markdown fully client-side (zero dependencies), sent to Claude as a text document block.

**Architecture:** Six new pure, dependency-free, node-testable modules under `src/app/` (`office-xml.ts`, `unzip.ts`, `docx-extract.ts`, `xlsx-extract.ts`, `pptx-extract.ts`, `office-extract.ts`). Wire a new `"office"` `AttachmentKind` into the shared `chat-attachments.ts` classifier + both file-reader call sites (`chat-api.ts readAttachmentData`, `step0-import-panel.tsx readFileData` + its SharePoint bytes path). No new dependency, no new CSP host, no new persisted field, no new AI tool.

**Tech Stack:** TypeScript, native `DecompressionStream("deflate-raw")` for inflate, regex XML text extraction (no DOMParser → pure + node-testable). Vitest for tests. Existing `zip.ts buildZip` synthesizes OOXML test fixtures.

**Conventions (CI landmines):**
- Lint is `--max-warnings=0` with NO unused-arg escape: never name a param `_` (use a real name like `whole`). Remove unused imports immediately.
- No `/s` (dotAll) regex flag (tsc target < es2018) — always use `[\s\S]`.
- Run `npx tsc --noEmit` after editing ANY test (build + vitest do not typecheck tests).
- Pure modules only — no `Date.now()`/`Math.random()`.
- Commit after each task. Attribution is disabled globally — no `Co-Authored-By` trailer.

---

### Task 1: `office-xml.ts` — shared XML text helpers

**Files:**
- Create: `src/app/office-xml.ts`
- Test: `src/app/office-xml.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/office-xml.test.ts
import { describe, expect, it } from "vitest";
import { decodeUtf8, unescapeXml, extractRuns } from "./office-xml";

describe("office-xml", () => {
  it("decodes UTF-8 bytes", () => {
    expect(decodeUtf8(new TextEncoder().encode("héllo"))).toBe("héllo");
  });

  it("unescapes named + numeric XML entities", () => {
    expect(unescapeXml("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;")).toBe(
      `a & b <c> "d" 'e'`,
    );
    expect(unescapeXml("&#65;&#x42;")).toBe("AB");
  });

  it("leaves unknown entities untouched", () => {
    expect(unescapeXml("100&percnt;")).toBe("100&percnt;");
  });

  it("extracts ordered text runs for a tag, unescaping entities", () => {
    const xml = `<w:t>Hello</w:t><w:tab/><w:t xml:space="preserve"> world &amp; more</w:t>`;
    expect(extractRuns(xml, "w:t")).toEqual(["Hello", " world & more"]);
  });

  it("does not confuse a tag with a longer-named sibling", () => {
    // <w:t> must not match <w:tbl ...>
    const xml = `<w:tbl><w:t>cell</w:t></w:tbl>`;
    expect(extractRuns(xml, "w:t")).toEqual(["cell"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/office-xml.test.ts`
Expected: FAIL — cannot find module `./office-xml`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/office-xml.ts — pure, i18n-free shared helpers for OOXML text extraction.

const utf8 = new TextDecoder("utf-8");

/** Decode a byte array as UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string {
  return utf8.decode(bytes);
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Unescape the five predefined XML entities plus numeric (&#NN; / &#xHH;). */
export function unescapeXml(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body] ?? whole;
  });
}

/**
 * Return the ordered inner text of every `<tag ...>...</tag>` occurrence,
 * XML-unescaped. The optional attribute group + closing `>` guard against a
 * prefix collision (`<w:t>` must not match `<w:tbl>`). Self-closing tags and
 * tags with child elements are out of scope — OOXML text tags (w:t/a:t/t) hold
 * pure text.
 */
export function extractRuns(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(unescapeXml(m[1]));
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/office-xml.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect exit 0)
```bash
git add src/app/office-xml.ts src/app/office-xml.test.ts
git commit -m "feat(office): shared XML text-extraction helpers"
```

---

### Task 2: `unzip.ts` — minimal ZIP reader

**Files:**
- Create: `src/app/unzip.ts`
- Test: `src/app/unzip.test.ts`

Uses `zip.ts buildZip` to synthesize fixtures. First inspect its signature:

- [ ] **Step 0: Read `src/app/zip.ts`** to confirm the `buildZip` signature and `ZipEntry` shape (the test below assumes `buildZip(entries: {name, data}[]) => Uint8Array` producing STORED entries). If the real signature differs, adapt the test's fixture construction accordingly (the production code under test does not depend on `zip.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// src/app/unzip.test.ts
import { describe, expect, it } from "vitest";
import { readZipEntries } from "./unzip";
import { buildZip } from "./zip";
import { decodeUtf8 } from "./office-xml";

function zipOf(files: { name: string; text: string }[]): Uint8Array {
  return buildZip(files.map((f) => ({ name: f.name, data: new TextEncoder().encode(f.text) })));
}

describe("readZipEntries", () => {
  it("reads stored entries back by path", async () => {
    const zip = zipOf([
      { name: "a.xml", text: "<root>alpha</root>" },
      { name: "dir/b.txt", text: "beta" },
    ]);
    const entries = await readZipEntries(zip);
    expect(decodeUtf8(entries.get("a.xml")!)).toBe("<root>alpha</root>");
    expect(decodeUtf8(entries.get("dir/b.txt")!)).toBe("beta");
  });

  it("inflates a real deflate-compressed entry", async () => {
    // A minimal ZIP with one deflate (method 8) entry "hello.txt" = "hello world".
    // Captured from a real zip; base64 of the whole archive.
    const b64 =
      "UEsDBBQAAAAIAAAAIQCwUGpZDQAAAAsAAAAJAAAAaGVsbG8udHh0y0jNyclXKM8vykkBAFBLAQIUABQAAAAIAAAAIQCwUGpZDQAAAAsAAAAJAAAAAAAAAAAAAAAAAAAAAABoZWxsby50eHRQSwUGAAAAAAEAAQA3AAAANAAAAAAA";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const entries = await readZipEntries(bytes);
    expect(decodeUtf8(entries.get("hello.txt")!)).toBe("hello world");
  });

  it("throws on non-zip input", async () => {
    await expect(readZipEntries(new TextEncoder().encode("not a zip"))).rejects.toThrow();
  });
});
```

> **Note for implementer:** The base64 deflate fixture above is illustrative. If it does not decode to a valid deflate archive at runtime, regenerate one: in a Node REPL, `zlib.deflateRawSync(Buffer.from("hello world"))` and hand-assemble a local header + central dir, OR use any tool to produce a genuinely deflate-compressed single-entry zip and paste its base64. The test's INTENT — exercise the `method === 8` inflate path via `DecompressionStream` — is what must hold; keep the test, fix the fixture until it passes.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/unzip.test.ts`
Expected: FAIL — cannot find module `./unzip`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/unzip.ts — minimal, dependency-free ZIP reader (central-directory based).
// Supports STORED (method 0) and DEFLATE (method 8, via native DecompressionStream).
// Pure + node-testable: DecompressionStream is a Node 18+ / browser global. Only
// what OOXML needs — no ZIP64, no encryption, no data-descriptor size guessing
// (the central directory carries reliable sizes even when local headers do not).

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;

async function inflateRaw(input: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  void writer.write(input);
  void writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function findEocd(view: DataView): number {
  const len = view.byteLength;
  if (len < 22) return -1;
  const min = Math.max(0, len - 22 - 0xffff);
  for (let i = len - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

/** Read every entry of a ZIP archive into a `path → bytes` map. */
export async function readZipEntries(
  input: ArrayBuffer | Uint8Array,
): Promise<Map<string, Uint8Array>> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");

  const cdCount = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder("utf-8");
  const entries = new Map<string, Uint8Array>();

  let p = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (view.getUint32(p, true) !== CDH_SIG) throw new Error("corrupt central directory");
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    // Local header is 30 fixed bytes + its OWN name/extra lengths (may differ
    // from the central directory's extra length).
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compSize);

    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflateRaw(raw);
    else throw new Error(`unsupported zip compression method ${method}`);

    entries.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/unzip.test.ts`
Expected: PASS (3 tests). If the deflate fixture is invalid, regenerate per the note; do not weaken the test.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect exit 0)
```bash
git add src/app/unzip.ts src/app/unzip.test.ts
git commit -m "feat(office): minimal zero-dep ZIP reader (stored + deflate)"
```

---

### Task 3: `docx-extract.ts` — Word → Markdown

**Files:**
- Create: `src/app/docx-extract.ts`
- Test: `src/app/docx-extract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/docx-extract.test.ts
import { describe, expect, it } from "vitest";
import { extractDocx } from "./docx-extract";

function entries(documentXml: string): Map<string, Uint8Array> {
  return new Map([["word/document.xml", new TextEncoder().encode(documentXml)]]);
}

describe("extractDocx", () => {
  it("renders headings and paragraphs in order", () => {
    const xml = `<w:document><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Project Plan</w:t></w:r></w:p>
      <w:p><w:r><w:t>Line one</w:t></w:r><w:r><w:t xml:space="preserve"> continued</w:t></w:r></w:p>
    </w:body></w:document>`;
    expect(extractDocx(entries(xml))).toBe("# Project Plan\n\nLine one continued");
  });

  it("renders a table as a Markdown table with a header row", () => {
    const xml = `<w:document><w:body><w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>ID</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>R1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Ada</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl></w:body></w:document>`;
    expect(extractDocx(entries(xml))).toBe(
      "| ID | Owner |\n| --- | --- |\n| R1 | Ada |",
    );
  });

  it("escapes pipe characters inside table cells", () => {
    const xml = `<w:document><w:body><w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>a|b</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl></w:body></w:document>`;
    expect(extractDocx(entries(xml))).toContain("a\\|b");
  });

  it("returns empty string when document.xml is missing", () => {
    expect(extractDocx(new Map())).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/docx-extract.test.ts`
Expected: FAIL — cannot find module `./docx-extract`.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/docx-extract.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect exit 0)
```bash
git add src/app/docx-extract.ts src/app/docx-extract.test.ts
git commit -m "feat(office): docx text + table extraction to Markdown"
```

---

### Task 4: `xlsx-extract.ts` — Excel → Markdown

**Files:**
- Create: `src/app/xlsx-extract.ts`
- Test: `src/app/xlsx-extract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/xlsx-extract.test.ts
import { describe, expect, it } from "vitest";
import { extractXlsx } from "./xlsx-extract";

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("extractXlsx", () => {
  it("renders each sheet as a named Markdown table, resolving shared strings", () => {
    const workbook = `<workbook><sheets>
      <sheet name="Risks" sheetId="1" r:id="rId1"/>
    </sheets></workbook>`;
    const shared = `<sst><si><t>ID</t></si><si><t>Risk</t></si><si><t>Late &amp; over</t></si></sst>`;
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
      <row r="2"><c r="A2"><v>1</v></c><c r="B2" t="s"><v>2</v></c></row>
    </sheetData></worksheet>`;
    const entries = new Map<string, Uint8Array>([
      ["xl/workbook.xml", enc(workbook)],
      ["xl/sharedStrings.xml", enc(shared)],
      ["xl/worksheets/sheet1.xml", enc(sheet)],
    ]);
    expect(extractXlsx(entries)).toBe(
      "## Sheet: Risks\n\n| ID | Risk |\n| --- | --- |\n| 1 | Late & over |",
    );
  });

  it("fills gaps from cell references so columns stay aligned", () => {
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c></row>
    </sheetData></worksheet>`;
    const entries = new Map<string, Uint8Array>([
      ["xl/worksheets/sheet1.xml", enc(sheet)],
    ]);
    // 3 columns: A=1, B empty, C=3.
    expect(extractXlsx(entries)).toContain("| 1 |  | 3 |");
  });

  it("returns empty string when there are no worksheets", () => {
    expect(extractXlsx(new Map())).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/xlsx-extract.test.ts`
Expected: FAIL — cannot find module `./xlsx-extract`.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/xlsx-extract.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect exit 0)
```bash
git add src/app/xlsx-extract.ts src/app/xlsx-extract.test.ts
git commit -m "feat(office): xlsx/xlsm per-sheet Markdown table extraction"
```

---

### Task 5: `pptx-extract.ts` — PowerPoint → Markdown

**Files:**
- Create: `src/app/pptx-extract.ts`
- Test: `src/app/pptx-extract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/pptx-extract.test.ts
import { describe, expect, it } from "vitest";
import { extractPptx } from "./pptx-extract";

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("extractPptx", () => {
  it("renders one section per slide in numeric order with bullet paragraphs", () => {
    const slide1 = `<p:sld><p:cSld><p:spTree>
      <a:p><a:r><a:t>Title</a:t></a:r></a:p>
      <a:p><a:r><a:t>Bullet</a:t></a:r><a:r><a:t xml:space="preserve"> one</a:t></a:r></a:p>
    </p:spTree></p:cSld></p:sld>`;
    const slide2 = `<p:sld><p:cSld><p:spTree>
      <a:p><a:r><a:t>Second</a:t></a:r></a:p>
    </p:spTree></p:cSld></p:sld>`;
    const entries = new Map<string, Uint8Array>([
      // deliberately out of insertion order to prove numeric sort
      ["ppt/slides/slide2.xml", enc(slide2)],
      ["ppt/slides/slide1.xml", enc(slide1)],
    ]);
    expect(extractPptx(entries)).toBe(
      "## Slide 1\n- Title\n- Bullet one\n\n## Slide 2\n- Second",
    );
  });

  it("returns empty string when there are no slides", () => {
    expect(extractPptx(new Map())).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/pptx-extract.test.ts`
Expected: FAIL — cannot find module `./pptx-extract`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/pptx-extract.ts — PresentationML slides → Markdown. One "## Slide N"
// section per slide (numeric order); each <a:p> paragraph becomes one bullet.
// Pure.

import { decodeUtf8, extractRuns } from "./office-xml";

function slideNum(path: string): number {
  const m = /slide(\d+)\.xml$/.exec(path);
  return m ? parseInt(m[1], 10) : 0;
}

/** Extract Markdown from a pptx entry map (one section per slide). */
export function extractPptx(entries: Map<string, Uint8Array>): string {
  const slides = [...entries.keys()]
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => slideNum(a) - slideNum(b));
  const sections: string[] = [];
  slides.forEach((path, i) => {
    const xml = decodeUtf8(entries.get(path)!);
    const bullets: string[] = [];
    const pRe = /<a:p\b[\s\S]*?<\/a:p>/g;
    let m: RegExpExecArray | null;
    while ((m = pRe.exec(xml)) !== null) {
      const text = extractRuns(m[0], "a:t").join("").trim();
      if (text !== "") bullets.push(`- ${text}`);
    }
    const heading = `## Slide ${i + 1}`;
    sections.push(bullets.length > 0 ? `${heading}\n${bullets.join("\n")}` : heading);
  });
  return sections.join("\n\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/pptx-extract.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect exit 0)
```bash
git add src/app/pptx-extract.ts src/app/pptx-extract.test.ts
git commit -m "feat(office): pptx per-slide Markdown extraction"
```

---

### Task 6: `office-extract.ts` — dispatcher + format detection + cap

**Files:**
- Create: `src/app/office-extract.ts`
- Test: `src/app/office-extract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/office-extract.test.ts
import { describe, expect, it } from "vitest";
import { officeKindOf, extractOfficeMarkdown, MAX_EXTRACT_CHARS } from "./office-extract";
import { buildZip } from "./zip";

describe("officeKindOf", () => {
  it("maps the four OOXML MIME types", () => {
    expect(
      officeKindOf(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "a.docx",
      ),
    ).toBe("docx");
    expect(
      officeKindOf(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "a.xlsx",
      ),
    ).toBe("xlsx");
    expect(officeKindOf("application/vnd.ms-excel.sheet.macroEnabled.12", "a.xlsm")).toBe("xlsx");
    expect(
      officeKindOf(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "a.pptx",
      ),
    ).toBe("pptx");
  });

  it("falls back to the file extension (incl. xlsm → xlsx)", () => {
    expect(officeKindOf("application/octet-stream", "report.docx")).toBe("docx");
    expect(officeKindOf("", "book.xlsm")).toBe("xlsx");
    expect(officeKindOf("", "deck.pptx")).toBe("pptx");
  });

  it("returns null for non-office types", () => {
    expect(officeKindOf("application/pdf", "a.pdf")).toBeNull();
    expect(officeKindOf("text/plain", "a.txt")).toBeNull();
  });
});

describe("extractOfficeMarkdown", () => {
  function docxZip(documentXml: string): Uint8Array {
    return buildZip([{ name: "word/document.xml", data: new TextEncoder().encode(documentXml) }]);
  }

  it("unzips and extracts a docx to Markdown", async () => {
    const zip = docxZip(
      `<w:document><w:body><w:p><w:r><w:t>Hello world</w:t></w:r></w:p></w:body></w:document>`,
    );
    expect(await extractOfficeMarkdown(zip, "docx")).toBe("Hello world");
  });

  it("returns a placeholder for an empty document", async () => {
    const zip = docxZip(`<w:document><w:body/></w:document>`);
    expect(await extractOfficeMarkdown(zip, "docx")).toContain("no extractable text");
  });

  it("truncates output beyond the character cap", async () => {
    const big = "x".repeat(MAX_EXTRACT_CHARS + 100);
    const zip = docxZip(`<w:document><w:body><w:p><w:r><w:t>${big}</w:t></w:r></w:p></w:body></w:document>`);
    const out = await extractOfficeMarkdown(zip, "docx");
    expect(out.length).toBeLessThan(MAX_EXTRACT_CHARS + 100);
    expect(out).toContain("truncated");
  });

  it("rejects on non-zip bytes", async () => {
    await expect(
      extractOfficeMarkdown(new TextEncoder().encode("nope"), "docx"),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/office-extract.test.ts`
Expected: FAIL — cannot find module `./office-extract`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/office-extract.ts — public entry point for Office (OOXML) ingestion.
// Detects the format, unzips, routes to the per-format extractor, caps output.
// Pure + node-testable.

import { readZipEntries } from "./unzip";
import { extractDocx } from "./docx-extract";
import { extractXlsx } from "./xlsx-extract";
import { extractPptx } from "./pptx-extract";

export type OfficeFormat = "docx" | "xlsx" | "pptx";

/** Hard cap on extracted Markdown so a huge workbook can't blow the token budget. */
export const MAX_EXTRACT_CHARS = 200_000;

const MIME_FORMAT: ReadonlyArray<readonly [string, OfficeFormat]> = [
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.ms-excel.sheet.macroenabled.12", "xlsx"], // xlsm (lowercased)
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
];

const EXT_FORMAT: Record<string, OfficeFormat> = {
  ".docx": "docx",
  ".xlsx": "xlsx",
  ".xlsm": "xlsx",
  ".pptx": "pptx",
};

/** Classify a file as an Office format by MIME (preferred) then extension. */
export function officeKindOf(mimeType: string, fileName: string): OfficeFormat | null {
  const mime = mimeType.trim().toLowerCase();
  for (const [k, v] of MIME_FORMAT) if (k === mime) return v;
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
  return EXT_FORMAT[ext] ?? null;
}

/** Unzip + extract an Office file to structured Markdown. Rejects on a corrupt
 *  or non-OOXML archive (the caller surfaces a read/extract error). */
export async function extractOfficeMarkdown(
  input: ArrayBuffer | Uint8Array,
  fmt: OfficeFormat,
): Promise<string> {
  const entries = await readZipEntries(input);
  const raw =
    fmt === "docx" ? extractDocx(entries) : fmt === "xlsx" ? extractXlsx(entries) : extractPptx(entries);
  let md = raw.trim();
  if (md === "") md = "_(document contained no extractable text)_";
  if (md.length > MAX_EXTRACT_CHARS) {
    md = `${md.slice(0, MAX_EXTRACT_CHARS)}\n\n_(truncated — document exceeded the extraction limit)_`;
  }
  return md;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/office-extract.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect exit 0)
```bash
git add src/app/office-extract.ts src/app/office-extract.test.ts
git commit -m "feat(office): extraction dispatcher, format detection, output cap"
```

---

### Task 7: Wire `chat-attachments.ts` — new `"office"` kind

**Files:**
- Modify: `src/app/chat-attachments.ts`
- Test: `src/app/chat-attachments.test.ts` (extend if present; else create)

- [ ] **Step 1: Write/extend the failing test**

Add these cases (match the existing test file's import style; if no test file exists, create `src/app/chat-attachments.test.ts` importing from `./chat-attachments`):

```ts
import { describe, expect, it } from "vitest";
import { classifyAttachment, buildAttachmentBlock } from "./chat-attachments";

describe("chat-attachments office support", () => {
  it("classifies the four Office formats as 'office'", () => {
    expect(
      classifyAttachment(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "a.docx",
      ),
    ).toBe("office");
    expect(classifyAttachment("application/octet-stream", "b.xlsx")).toBe("office");
    expect(classifyAttachment("", "c.xlsm")).toBe("office");
    expect(classifyAttachment("", "d.pptx")).toBe("office");
  });

  it("builds a text document block for an office attachment (data = extracted Markdown)", () => {
    const block = buildAttachmentBlock("office", "application/octet-stream", "## Sheet: A\n\n| x |");
    expect(block).toEqual({
      type: "document",
      source: { type: "text", media_type: "text/plain", data: "## Sheet: A\n\n| x |" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/chat-attachments.test.ts`
Expected: FAIL — `"office"` not assignable / classify returns null.

- [ ] **Step 3: Edit `chat-attachments.ts`**

1. Add the import near the top (after the header comment block):
```ts
import { officeKindOf } from "./office-extract";
```

2. Widen the kind + error unions:
```ts
export type AttachmentKind = "pdf" | "image" | "text" | "office";
export type AttachmentError = "unsupported-type" | "too-large" | "extract-failed";
```

3. In `classifyAttachment`, add the office check immediately BEFORE the final `return null;` (after the extension fallback block):
```ts
  // --- Office (OOXML: docx/xlsx/xlsm/pptx) — MIME or extension ---
  if (officeKindOf(mimeType, fileName)) return "office";

  return null;
```

4. In `buildAttachmentBlock`, add the office branch BEFORE the trailing `// kind === "text"` block:
```ts
  if (kind === "office") {
    // `data` is already the extracted Markdown (produced by the file reader).
    return {
      type: "document",
      source: { type: "text", media_type: "text/plain", data },
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/chat-attachments.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect exit 0 — a widened `AttachmentKind` may surface non-exhaustive switches at the call sites; those are fixed in Task 8. If tsc reports errors ONLY in `chat-api.ts`/`step0-import-panel.tsx`, that is expected — proceed; if it errors inside `chat-attachments.ts` itself, fix before committing.)
```bash
git add src/app/chat-attachments.ts src/app/chat-attachments.test.ts
git commit -m "feat(office): classify Office files + build text block in chat-attachments"
```

---

### Task 8: Wire the two file readers (`chat-api.ts` + `step0-import-panel.tsx`)

**Files:**
- Modify: `src/app/chat-api.ts` (`readAttachmentData`)
- Modify: `src/app/step0-import-panel.tsx` (`readFileData`, `mimeForKind`, SharePoint bytes path)

No new test file — behavior is covered by the module tests + existing chat/import tests. This task makes the widened `AttachmentKind` compile and routes `"office"` through extraction.

- [ ] **Step 1: Edit `chat-api.ts` `readAttachmentData`**

1. Add imports (top of file, with the other imports):
```ts
import { officeKindOf, extractOfficeMarkdown } from "./office-extract";
```

2. Widen the `kind` parameter and add an office branch at the START of the function body (before the `new Promise` FileReader block):
```ts
export function readAttachmentData(
  file: File,
  kind: "pdf" | "image" | "text" | "office",
): Promise<string> {
  if (kind === "office") {
    const fmt = officeKindOf(file.type, file.name);
    if (!fmt) return Promise.reject(new Error("unknown office format"));
    return file.arrayBuffer().then((buf) => extractOfficeMarkdown(buf, fmt));
  }
  return new Promise((resolve, reject) => {
    // ...existing FileReader body unchanged...
  });
}
```

- [ ] **Step 2: Edit `step0-import-panel.tsx`**

1. Add imports (with the other `./office-extract` / attachment imports):
```ts
import { officeKindOf, extractOfficeMarkdown } from "./office-extract";
```

2. `mimeForKind` — add an office arm (any string; the office block ignores MIME). Change:
```ts
function mimeForKind(kind: AttachmentKind): string {
  if (kind === "pdf") return "application/pdf";
  if (kind === "image") return "image/png";
  return "text/plain"; // text + office (office block is a text document)
}
```
(No code change needed if the final `return "text/plain"` already covers office — verify the switch has no exhaustive `never` check. If it does, add `if (kind === "office") return "text/plain";`.)

3. `readFileData` — add an office branch at the START (before the `new Promise` FileReader block):
```ts
function readFileData(file: File, kind: AttachmentKind): Promise<string> {
  if (kind === "office") {
    const fmt = officeKindOf(file.type, file.name);
    if (!fmt) return Promise.reject(new Error("read"));
    return file.arrayBuffer().then((buf) => extractOfficeMarkdown(buf, fmt));
  }
  return new Promise((resolve, reject) => {
    // ...existing FileReader body unchanged...
  });
}
```

4. SharePoint bytes path (`onSharePointPick`) — the `data` line currently is:
```ts
const data = kind === "text" ? new TextDecoder().decode(bytes) : arrayBufferToBase64(bytes);
```
Change it to handle office (extraction) before the base64 fallback:
```ts
const data =
  kind === "text"
    ? new TextDecoder().decode(bytes)
    : kind === "office"
      ? await extractOfficeMarkdown(bytes, officeKindOf(mime, name)!)
      : arrayBufferToBase64(bytes);
```
> `officeKindOf(mime, name)` is non-null here because `classifyAttachment` already returned `"office"` for this `(mime, name)` pair; the `!` is safe. `bytes` is the `Uint8Array`/`ArrayBuffer` returned by `fetchSharePointFileContent` — `extractOfficeMarkdown` accepts both. This `await` is already inside the `try` block, so an extraction failure surfaces the existing `wizardImportErrorSource` message.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit` (expect exit 0 — all `AttachmentKind` switches now exhaustive)
Run: `npm run lint` (expect 0 warnings — check for unused imports / `_` params introduced)

- [ ] **Step 4: Run the affected suites**

Run: `npx vitest run src/app/chat-api.test.ts src/app/step0-import-panel.test.ts src/app/chat-panel.test.tsx`
Expected: PASS (no regressions; existing read paths unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/app/chat-api.ts src/app/step0-import-panel.tsx
git commit -m "feat(office): route office attachments through extraction in both readers"
```

---

### Task 9: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 0 warnings.

- [ ] **Step 3: Unit suite**

Run: `npm run test:run`
Expected: all pass (6 new test files + existing).

- [ ] **Step 4: Size + duplication gates**

Run: `npm run size:check`
Expected: pass. If a modified file (`chat-attachments.ts`, `chat-api.ts`, `step0-import-panel.tsx`) crossed its baselined size, re-baseline per repo convention (`docs/baselines/file-sizes.json`) and note it in the commit.

Run: `npm run dup:check`
Expected: pass. The six new extractors share the `pad`/table-render shape — if jscpd flags a clone above threshold, extract the shared Markdown-table renderer into `office-xml.ts` (e.g. `toMarkdownTable(rows: string[][]): string`) and have docx/xlsx call it. Prefer this over a baseline bump.

- [ ] **Step 5: Commit any gate fixups**

```bash
git add -A
git commit -m "chore(office): satisfy size/duplication gates"
```
(Skip if nothing changed.)

---

## Manual smoke test (post-implementation, before release)

Run `npm run dev` against a **throwaway** project (never the user's live-data tab). In the AI-Assistant chat, attach a real `.docx`, `.xlsx`, and `.pptx`; confirm the model receives readable Markdown (ask it to "list every risk in the attached file"). Repeat via create-project → import → upload. Confirm a corrupt/renamed file surfaces the read-failed / source-import error, not a crash.

## Release (on the "release" trigger only)

Bump `src/app/version.ts` (APP_VERSION + milestone `Bishop`), add a `CHANGELOG.md` entry, append a `versionHighlightOfficeIngest` key to `APP_HIGHLIGHT_KEYS` + EN/DE strings (i18n.de.ts via node utf8 write with `\r\n` anchors, never the Edit tool). Then push → MR → poll → merge-on-green.
