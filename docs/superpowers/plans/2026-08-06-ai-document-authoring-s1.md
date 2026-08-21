# AI Document Authoring — S1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a canonical block-based document model that persists with the project across all six storage backends, a Documents view to manage those documents, and rendering to HTML / DOCX / PPTX / print-PDF with download.

**Architecture:** A document is JSON at rest — a `ProjectDocument` with a typed `DocBlock[]`. Bytes exist only between the Download click and the browser save dialog, so no backend ever stores a blob. Persistence follows the `insights` pattern (one JSON blob per backend), not the `milestones` pattern (an entity table). Three renderers consume the block array; the HTML renderer is canonical and also feeds the print-PDF path.

**Tech Stack:** TypeScript, Next.js 16, React 19, vitest, Playwright + axe. No new dependencies — ZIP writing (`zip.ts`) and OOXML emit already exist in-repo.

**Spec:** `docs/superpowers/specs/2026-08-06-ai-document-authoring-design.md`

---

## Orientation for someone new to this codebase

Read these before Task 1. They are short and every one of them will bite otherwise.

**Gate exit codes.** Never read a gate's status through a pipe — `npm run test:run | tail -8` exits `0` while tests fail, because that is `tail`'s status. Always:

```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```

**`npm run lint` does not reproduce CI.** It is bare `eslint` with no `--max-warnings`, so it exits 0 with warnings present. The real gate is:

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

An unused import or variable is **fatal** in CI. There is no `argsIgnorePattern`, so even a `_`-prefixed unused parameter fails.

**Typecheck after touching any test.** `next build` does not typecheck `*.test.tsx` and vitest never typechecks. Run `npx tsc --noEmit`.

**The DE i18n file.** `src/app/i18n.de.ts` is CRLF and the Edit tool corrupts umlauts and curls double quotes in it. Add DE strings with a node UTF-8 write, anchoring on `\r\n`, then verify the bytes. EN and DE key sets must be identical — tsc enforces it.

**Immutability is compiler-enforced.** Every `Workspace` array is `ReadonlyArray`. Turso's dirty-table save detects change by **reference equality**, so an in-place `push`/`splice`/`sort` silently skips that table's save. Always replace, never mutate.

**Commit style.** `<type>: <description>`, types `feat|fix|refactor|docs|test|chore|perf|ci`.

---

## File structure

**Created:**

| File | Responsibility |
|---|---|
| `src/app/document-model.ts` | `ProjectDocument`, `DocBlock`, `sanitizeProjectDocuments`. Pure, i18n-free, **DOM-free** |
| `src/app/document-model.test.ts` | Model + sanitizer tests |
| `src/app/document-model.property.test.ts` | Round-trip property test |
| `src/app/document-rich-fields.ts` | `sanitizeDocumentRichFields` — the DOM-bound allow-list for load boundaries |
| `src/app/document-rich-fields.test.ts` | |
| `src/app/ooxml-docx-primitives.ts` | `buildDocxTable` + package skeleton, extracted from `export-docx.ts` |
| `src/app/ooxml-pptx-primitives.ts` | `pptxTextBox`, `wrapPptxSlide`, `buildPptxSlideMaster`, `buildPptxSlideLayout`, `buildPptxTheme`, `pptxBackgroundRect`, `pptxAccentBar`, extracted from `export-pptx.ts` |
| `src/app/doc-render-html.ts` | Blocks → HTML. Canonical renderer; two modes |
| `src/app/doc-render-html.test.ts` | |
| `src/app/doc-render-docx.ts` | Blocks → WordprocessingML `Blob` |
| `src/app/doc-render-docx.test.ts` | |
| `src/app/doc-render-pptx.ts` | Blocks → PresentationML `Blob` |
| `src/app/doc-render-pptx.test.ts` | |
| `src/app/download.ts` | `triggerDownload` + `PRINT_STYLES`, promoted out of `export.ts` |
| `src/app/document-download.ts` | `downloadDocument(doc, format, ws, lang)` |
| `src/app/document-download.test.ts` | |
| `src/app/documents-panel.tsx` | Orchestrator: list state, selection, delete confirm |
| `src/app/documents-list.tsx` | Row table via `SortResizeTh` |
| `src/app/document-preview.tsx` | Read-only render of the selected document |
| `src/app/documents-toolbar.tsx` | Toolbar |
| `src/app/documents-panel.test.tsx` | |
| `src/app/documents-toolbar.test.tsx` | Toolbar order assertions |

**Modified:**

| File | Change |
|---|---|
| `src/app/workspace.ts` | `Workspace.documents?` field; `jsonToWorkspace` sanitize; JSON emit |
| `src/app/browser-backend.ts` | KV key, load, save |
| `src/app/turso-schema.ts` | meta load, `dirty.add("meta")`, meta save |
| `src/app/turso-tenant-schema.ts` | tenant meta save |
| `src/app/csv-codecs-core.ts` | `CSV_SECTION_DOCUMENTS` |
| `src/app/csv-codecs-config.ts` | `documentsToCsv`, emit |
| `src/app/csv-codecs-decode.ts` | decode mode + wiring |
| `src/app/markdown-codecs-core.ts` | `documentsToMarkdown` / `markdownToDocuments`, emit |
| `src/app/markdown-codecs-decode.ts` | decode wiring |
| `src/app/export-docx.ts` | Import extracted primitives |
| `src/app/export-pptx.ts` | Import extracted primitives |
| `src/app/export.ts` | Import `triggerDownload` / `PRINT_STYLES` from `download.ts` |
| `src/app/nav-config.ts` | `AppView`, nav group, `LABEL_KEYS`, **slug alias removal** |
| `src/app/nav-config.test.ts` | Update the alias test |
| `src/app/view-ai-scope.ts` | `documents` entry (tsc-forced) |
| `src/app/help-content.ts` | `HELP_ENTRIES` entry |
| `src/app/i18n.ts` / `i18n.de.ts` | New keys, EN + DE |
| `src/app/workspace-section.tsx` | Render the panel |
| `src/app/entity-persistence-registry.test.ts` | Register `documents` |
| `sample-workspace-small.json` (REPO ROOT, not `public/`) | One seeded document |
| `e2e/a11y.spec.ts` | `A11Y_VIEWS` + `HASH_VIEW` |

---

## Task 1: Document model and sanitizer

**Files:**
- Create: `src/app/document-model.ts`
- Test: `src/app/document-model.test.ts`

This module is **DOM-free**. It is reachable from `scripts/generate-sample-workspace.ts`, which runs under bare node; a DOMPurify call there throws, `jsonToWorkspace`'s catch-all swallows the throw into an empty workspace, and the generator then "successfully" writes near-empty sample files. Do not import `dompurify`, `rich-text-projection.ts`, or anything that touches `window` here.

- [ ] **Step 1: Write the failing test**

Create `src/app/document-model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  sanitizeProjectDocuments,
  MAX_DOCUMENTS,
  MAX_BLOCKS_PER_DOC,
  MAX_TABLE_ROWS,
  type ProjectDocument,
} from "./document-model";

const doc = (over: Partial<ProjectDocument> = {}): ProjectDocument => ({
  id: 1,
  title: "Status report",
  blocks: [{ type: "heading", level: 1, text: "March" }],
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
  ...over,
});

describe("sanitizeProjectDocuments", () => {
  it("returns [] for non-array input", () => {
    expect(sanitizeProjectDocuments(null)).toEqual([]);
    expect(sanitizeProjectDocuments({})).toEqual([]);
    expect(sanitizeProjectDocuments("nope")).toEqual([]);
  });

  it("keeps a well-formed document unchanged", () => {
    expect(sanitizeProjectDocuments([doc()])).toEqual([doc()]);
  });

  it("drops a document with a non-positive or non-finite id", () => {
    expect(sanitizeProjectDocuments([doc({ id: 0 })])).toEqual([]);
    expect(sanitizeProjectDocuments([doc({ id: -3 })])).toEqual([]);
    expect(sanitizeProjectDocuments([doc({ id: Number.NaN })])).toEqual([]);
  });

  it("drops a document with a blank title", () => {
    expect(sanitizeProjectDocuments([doc({ title: "   " })])).toEqual([]);
  });

  it("drops unknown block types but keeps the surrounding blocks", () => {
    const out = sanitizeProjectDocuments([
      doc({
        blocks: [
          { type: "heading", level: 2, text: "A" },
          { type: "bogus" } as never,
          { type: "pageBreak" },
        ],
      }),
    ]);
    expect(out[0].blocks).toEqual([
      { type: "heading", level: 2, text: "A" },
      { type: "pageBreak" },
    ]);
  });

  it("clamps a heading level outside 1..3", () => {
    const out = sanitizeProjectDocuments([
      doc({ blocks: [{ type: "heading", level: 9 as never, text: "X" }] }),
    ]);
    expect(out[0].blocks[0]).toEqual({ type: "heading", level: 3, text: "X" });
  });

  it("drops a dataSection whose key is not a real ExportSectionKey", () => {
    const out = sanitizeProjectDocuments([
      doc({ blocks: [{ type: "dataSection", key: "not-a-section" as never }] }),
    ]);
    expect(out[0].blocks).toEqual([]);
  });

  it("keeps a dataSection with a real key", () => {
    const out = sanitizeProjectDocuments([
      doc({ blocks: [{ type: "dataSection", key: "raid" }] }),
    ]);
    expect(out[0].blocks).toEqual([{ type: "dataSection", key: "raid" }]);
  });

  it("pads short table rows to the column count and caps long ones", () => {
    const out = sanitizeProjectDocuments([
      doc({
        blocks: [
          { type: "table", columns: ["A", "B"], rows: [["1"], ["1", "2", "3"]] },
        ],
      }),
    ]);
    expect(out[0].blocks[0]).toEqual({
      type: "table",
      columns: ["A", "B"],
      rows: [
        ["1", ""],
        ["1", "2"],
      ],
    });
  });

  it("caps the document count, the block count and the table row count", () => {
    const many = Array.from({ length: MAX_DOCUMENTS + 10 }, (_, i) => doc({ id: i + 1 }));
    expect(sanitizeProjectDocuments(many)).toHaveLength(MAX_DOCUMENTS);

    const blocks = Array.from({ length: MAX_BLOCKS_PER_DOC + 10 }, () => ({
      type: "pageBreak" as const,
    }));
    expect(sanitizeProjectDocuments([doc({ blocks })])[0].blocks).toHaveLength(
      MAX_BLOCKS_PER_DOC,
    );

    const rows = Array.from({ length: MAX_TABLE_ROWS + 10 }, () => ["x"]);
    const capped = sanitizeProjectDocuments([
      doc({ blocks: [{ type: "table", columns: ["A"], rows }] }),
    ]);
    expect((capped[0].blocks[0] as { rows: string[][] }).rows).toHaveLength(MAX_TABLE_ROWS);
  });

  it("drops a duplicate id, keeping the first occurrence", () => {
    const out = sanitizeProjectDocuments([doc({ title: "first" }), doc({ title: "second" })]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("first");
  });

  it("does not touch the DOM", () => {
    // Guard: this module must stay usable under bare node (the sample generator).
    // A source scan is the enforcement; see the comment-stripped check below.
    const src = readFileSync(new URL("./document-model.ts", import.meta.url), "utf8");
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/DOMPurify|dompurify|\bwindow\b|\bdocument\b\s*\./);
  });
});
```

Add at the top of the test file:

```ts
import { readFileSync } from "node:fs";
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/app/document-model.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t1.log
```

Expected: FAIL — `Failed to resolve import "./document-model"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/document-model.ts`:

```ts
// src/app/document-model.ts
//
// Canonical model for a project document. A document is JSON at rest; bytes
// (.docx/.pptx/.html/.pdf) are rendered on demand and never stored.
//
// ★★★ DOM-FREE BY CONTRACT. This module is in the import graph of
// scripts/generate-sample-workspace.ts, which runs under bare node. DOMPurify
// binds `window` at module-eval, so a call here throws, jsonToWorkspace's
// catch-all swallows it into an EMPTY workspace, and the generator then
// "successfully" writes near-empty sample files. The HTML allow-list runs at
// the render sink (doc-render-html.ts) and at the whole-object load boundaries
// (document-rich-fields.ts) instead. A source scan in the test enforces this:
// comments may name the library, code may not.

import { EXPORT_SECTION_KEYS, type ExportSectionKey } from "./settings-types";
import { capHtmlText, htmlTextLength } from "./rich-text-plain";

/** Bounds on what a hostile or corrupt import can force. */
export const MAX_DOCUMENTS = 200;
export const MAX_BLOCKS_PER_DOC = 500;
export const MAX_TABLE_ROWS = 500;
export const MAX_TABLE_COLUMNS = 30;
export const MAX_BULLET_ITEMS = 200;
export const MAX_TITLE_CHARS = 200;
export const MAX_TEXT_CHARS = 5_000;
export const MAX_HTML_TEXT_CHARS = 20_000;

export type DocBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; html: string }
  | { type: "bullets"; ordered?: boolean; items: string[] }
  | { type: "table"; caption?: string; columns: string[]; rows: string[][] }
  | { type: "dataSection"; key: ExportSectionKey }
  | { type: "pageBreak" };

export type ProjectDocument = {
  id: number;
  title: string;
  blocks: readonly DocBlock[];
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
};

const SECTION_KEYS: ReadonlySet<string> = new Set(EXPORT_SECTION_KEYS);

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function isoOr(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const t = Date.parse(v);
  return Number.isFinite(t) ? v : fallback;
}

function sanitizeBlock(raw: unknown): DocBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;

  switch (b.type) {
    case "pageBreak":
      return { type: "pageBreak" };

    case "heading": {
      const text = str(b.text, MAX_TEXT_CHARS).trim();
      if (!text) return null;
      const n = Math.floor(Number(b.level));
      const level = (Number.isFinite(n) ? Math.min(3, Math.max(1, n)) : 1) as 1 | 2 | 3;
      return { type: "heading", level, text };
    }

    case "paragraph": {
      // ★ Measure VISIBLE TEXT, not html.length, and cap with capHtmlText — it
      // backs a truncation off one code unit rather than splitting a surrogate
      // pair (a lone surrogate becomes U+FFFD on CSV/MD but survives on
      // JSON/IDB: a backend-dependent corruption). clipText still has that bug.
      const html = typeof b.html === "string" ? b.html : "";
      if (htmlTextLength(html) === 0) return null;
      return { type: "paragraph", html: capHtmlText(html, MAX_HTML_TEXT_CHARS) };
    }

    case "bullets": {
      if (!Array.isArray(b.items)) return null;
      const items = b.items
        .slice(0, MAX_BULLET_ITEMS)
        .map((i) => str(i, MAX_TEXT_CHARS).trim())
        .filter((i) => i !== "");
      if (items.length === 0) return null;
      return b.ordered === true
        ? { type: "bullets", ordered: true, items }
        : { type: "bullets", items };
    }

    case "table": {
      if (!Array.isArray(b.columns)) return null;
      const columns = b.columns
        .slice(0, MAX_TABLE_COLUMNS)
        .map((c) => str(c, MAX_TEXT_CHARS));
      if (columns.length === 0) return null;
      const rawRows = Array.isArray(b.rows) ? b.rows : [];
      const rows = rawRows.slice(0, MAX_TABLE_ROWS).map((r) => {
        const cells = Array.isArray(r) ? r : [];
        const out = cells.slice(0, columns.length).map((c) => str(c, MAX_TEXT_CHARS));
        while (out.length < columns.length) out.push("");
        return out;
      });
      const caption = str(b.caption, MAX_TEXT_CHARS).trim();
      return caption
        ? { type: "table", caption, columns, rows }
        : { type: "table", columns, rows };
    }

    case "dataSection": {
      const key = typeof b.key === "string" ? b.key : "";
      // Ground the key against the real registry — a hallucinated or stale key
      // must never reach buildExportSections.
      if (!SECTION_KEYS.has(key)) return null;
      return { type: "dataSection", key: key as ExportSectionKey };
    }

    default:
      return null;
  }
}

function sanitizeDocument(raw: unknown): ProjectDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;

  const id = Math.floor(Number(d.id));
  if (!Number.isFinite(id) || id <= 0) return null;

  const title = str(d.title, MAX_TITLE_CHARS).trim();
  if (!title) return null;

  const blocks = (Array.isArray(d.blocks) ? d.blocks : [])
    .slice(0, MAX_BLOCKS_PER_DOC)
    .map(sanitizeBlock)
    .filter((b): b is DocBlock => b !== null);

  const createdAt = isoOr(d.createdAt, "");
  return {
    id,
    title,
    blocks,
    createdAt,
    updatedAt: isoOr(d.updatedAt, createdAt),
  };
}

/** The SINGLE validator for the persisted documents array. Every load path
 *  routes through this. */
export function sanitizeProjectDocuments(raw: unknown): ProjectDocument[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: ProjectDocument[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_DOCUMENTS) break;
    const doc = sanitizeDocument(entry);
    if (!doc || seen.has(doc.id)) continue;
    seen.add(doc.id);
    out.push(doc);
  }
  return out;
}

/** max+1 mint, matching every other entity. */
export function nextDocumentId(docs: readonly ProjectDocument[]): number {
  return docs.reduce((max, d) => Math.max(max, d.id), 0) + 1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/app/document-model.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t1.log
```

Expected: PASS, all tests green.

If `capHtmlText` or `htmlTextLength` do not exist under those names in `rich-text-plain.ts`, confirm with `grep -n "export function" src/app/rich-text-plain.ts` and use the real names — the spec names them but the gate that checks doc symbols does not check this plan.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/document-model.ts src/app/document-model.test.ts; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/document-model.ts src/app/document-model.test.ts
git commit -m "feat: canonical project document model and sanitizer"
```

---

## Task 2: Round-trip property test

**Files:**
- Create: `src/app/document-model.property.test.ts`

The persistence layer JSON-stringifies the array on every backend, so the property that matters is: sanitizing a JSON round-trip equals sanitizing the original. This is what catches a codec that silently drops a block type.

- [ ] **Step 1: Write the test**

Create `src/app/document-model.property.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { sanitizeProjectDocuments, type DocBlock } from "./document-model";

// ★ fc.date() can emit an Invalid Date whose .toISOString() throws — that
// passes vitest's type check but fails at runtime. Map an integer ms range.
const isoArb = fc
  .integer({ min: 0, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms).toISOString());

const blockArb: fc.Arbitrary<DocBlock> = fc.oneof(
  fc.record({
    type: fc.constant("heading" as const),
    level: fc.constantFrom(1 as const, 2 as const, 3 as const),
    text: fc.string({ minLength: 1, maxLength: 40 }),
  }),
  fc.record({
    type: fc.constant("bullets" as const),
    items: fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
      minLength: 1,
      maxLength: 5,
    }),
  }),
  fc.record({
    type: fc.constant("table" as const),
    columns: fc.array(fc.string({ minLength: 1, maxLength: 10 }), {
      minLength: 1,
      maxLength: 4,
    }),
    rows: fc.array(fc.array(fc.string({ maxLength: 10 }), { maxLength: 4 }), {
      maxLength: 5,
    }),
  }),
  fc.record({ type: fc.constant("dataSection" as const), key: fc.constantFrom("tasks" as const, "raid" as const) }),
  fc.record({ type: fc.constant("pageBreak" as const) }),
);

const docArb = fc.record({
  id: fc.integer({ min: 1, max: 10_000 }),
  title: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim() !== ""),
  blocks: fc.array(blockArb, { maxLength: 12 }),
  createdAt: isoArb,
  updatedAt: isoArb,
});

describe("document JSON round-trip", () => {
  it("survives JSON.stringify/parse with no change after sanitize", () => {
    fc.assert(
      fc.property(fc.array(docArb, { maxLength: 8 }), (docs) => {
        const once = sanitizeProjectDocuments(docs);
        const twice = sanitizeProjectDocuments(JSON.parse(JSON.stringify(once)));
        expect(twice).toEqual(once);
      }),
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.array(docArb, { maxLength: 8 }), (docs) => {
        const once = sanitizeProjectDocuments(docs);
        expect(sanitizeProjectDocuments(once)).toEqual(once);
      }),
    );
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/app/document-model.property.test.ts > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t2.log
```

Expected: PASS. If it fails, the sanitizer is not idempotent — fix the sanitizer, not the test.

- [ ] **Step 3: Commit**

```bash
git add src/app/document-model.property.test.ts
git commit -m "test: property-test document model round-trip and idempotence"
```

---

## Task 3: Rich-field sanitizer for load boundaries

**Files:**
- Create: `src/app/document-rich-fields.ts`
- Test: `src/app/document-rich-fields.test.ts`

`document-model.ts` cannot run an allow-list (DOM-free). This module can, and runs at the two whole-object load boundaries that cast verbatim: `jsonToWorkspace` and the IDB load.

**It must be `sanitizeTemplateHtml`, not `sanitizeNoteHtml`.** `sanitizeNoteHtml` sets `KEEP_CONTENT:false`, which deletes the *text* inside a non-allow-listed tag — right for the lean note editor, wrong here, where a document legitimately carries `<h3>` and `<table>`.

**It must take exactly one argument.** Every call site is `.map(fn)`, and `.map` passes the index as the second argument — a `(doc, fields)` signature would be fed `0, 1, 2…`, normalise nothing, and leave every test green.

- [ ] **Step 1: Write the failing test**

Create `src/app/document-rich-fields.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanitizeDocumentRichFields } from "./document-rich-fields";
import type { ProjectDocument } from "./document-model";

const base: ProjectDocument = {
  id: 1,
  title: "Doc",
  blocks: [],
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
};

describe("sanitizeDocumentRichFields", () => {
  it("strips a script tag from a paragraph", () => {
    const out = sanitizeDocumentRichFields({
      ...base,
      blocks: [{ type: "paragraph", html: "<p>ok</p><script>alert(1)</script>" }],
    });
    expect((out.blocks[0] as { html: string }).html).not.toMatch(/script/i);
    expect((out.blocks[0] as { html: string }).html).toMatch(/ok/);
  });

  it("KEEPS the text inside a heading tag a model legitimately emits", () => {
    // ★ This is the sanitizeNoteHtml-vs-sanitizeTemplateHtml distinction.
    // sanitizeNoteHtml (KEEP_CONTENT:false) would delete "Section" entirely.
    const out = sanitizeDocumentRichFields({
      ...base,
      blocks: [{ type: "paragraph", html: "<h3>Section</h3>" }],
    });
    expect((out.blocks[0] as { html: string }).html).toMatch(/Section/);
  });

  it("leaves non-paragraph blocks untouched", () => {
    const blocks = [
      { type: "heading" as const, level: 1 as const, text: "T" },
      { type: "pageBreak" as const },
    ];
    expect(sanitizeDocumentRichFields({ ...base, blocks }).blocks).toEqual(blocks);
  });

  it("survives being used directly as a .map callback", () => {
    // ★ .map passes (value, index, array). A second parameter would be fed 0,1,2…
    const docs = [base, { ...base, id: 2 }];
    expect(docs.map(sanitizeDocumentRichFields)).toHaveLength(2);
    expect(docs.map(sanitizeDocumentRichFields)[1].id).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/document-rich-fields.test.ts > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/t3.log
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

First confirm the exported name of the wide allow-list:

```bash
grep -rn "export function sanitizeTemplateHtml\|export function sanitizeNoteHtml" src/app
```

Create `src/app/document-rich-fields.ts`:

```ts
// src/app/document-rich-fields.ts
//
// DOM-bound allow-list for document paragraph HTML. Separate module because
// document-model.ts is DOM-FREE by contract (it runs under bare node in the
// sample generator) and therefore cannot call DOMPurify.
//
// ★★ sanitizeTemplateHtml, NOT sanitizeNoteHtml. The latter sets
// KEEP_CONTENT:false, which deletes the TEXT inside a non-allow-listed tag —
// correct for the lean note editor (whose schema only emits the lean set) and
// wrong here, where a document legitimately carries <h3>/<div>/<table>.

import type { DocBlock, ProjectDocument } from "./document-model";
import { sanitizeTemplateHtml } from "./sanitize-html";

/** ★ ONE argument on purpose: every call site is `.map(fn)`, which passes the
 *  INDEX as the second argument. A (doc, fields) signature would be fed
 *  0, 1, 2…, normalise nothing, and leave every .map-based test green. */
export function sanitizeDocumentRichFields(doc: ProjectDocument): ProjectDocument {
  let changed = false;
  const blocks: DocBlock[] = doc.blocks.map((b) => {
    if (b.type !== "paragraph") return b;
    const html = sanitizeTemplateHtml(b.html);
    if (html === b.html) return b;
    changed = true;
    return { ...b, html };
  });
  return changed ? { ...doc, blocks } : doc;
}
```

If `sanitizeTemplateHtml` lives in a different module than `note-log.ts`, fix the import path to whatever the grep in this step reported.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/app/document-rich-fields.test.ts > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3.log
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/document-rich-fields.ts src/app/document-rich-fields.test.ts
git commit -m "feat: DOM-bound rich-field sanitizer for document load boundaries"
```

---

## Task 4: JSON backend path

**Files:**
- Modify: `src/app/workspace.ts`

`documents` is optional and additive: undefined or empty serializes to nothing, so every existing
file stays byte-identical.

★★ NOTHING GATES THAT ON THIS BACKEND. `golden-workspace.test` pins exact bytes for CSV and
MARKDOWN ONLY — there is no golden JSON fixture, and nothing pins IndexedDB or Turso. Measured by
mutation during execution: making the emit unconditional left `golden-workspace.test` GREEN. So on
JSON, IDB and Turso the byte-stability test written in THIS task is the only net there is; write it
as if nothing else will catch a regression, because nothing else will. This mirrors `insights` exactly — read `workspace.ts:461-464` and `:595-598` before editing.

- [ ] **Step 1: Write the failing test**

Append to `src/app/document-model.test.ts` — no, create a dedicated file `src/app/workspace.documents.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { jsonToWorkspace, workspaceToJson } from "./workspace";

const EMPTY_JSON = JSON.stringify({ tasks: [], raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [], grades: [], plan: {} });

const DOC = {
  id: 1,
  title: "Status report",
  blocks: [{ type: "heading", level: 1, text: "March" }],
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
};

describe("workspace JSON — documents", () => {
  it("round-trips a document", () => {
    const ws = jsonToWorkspace(JSON.stringify({ ...JSON.parse(EMPTY_JSON), documents: [DOC] }));
    expect(ws.documents).toEqual([DOC]);
    const back = jsonToWorkspace(workspaceToJson(ws));
    expect(back.documents).toEqual([DOC]);
  });

  it("emits NO documents key when absent or empty (byte-stable for legacy files)", () => {
    const ws = jsonToWorkspace(EMPTY_JSON);
    expect(ws.documents).toBeUndefined();
    expect(workspaceToJson(ws)).not.toMatch(/"documents"/);
  });

  it("drops a malformed document rather than throwing", () => {
    const ws = jsonToWorkspace(
      JSON.stringify({ ...JSON.parse(EMPTY_JSON), documents: [{ id: 0, title: "" }] }),
    );
    expect(ws.documents).toBeUndefined();
  });

  it("strips script from paragraph html on load", () => {
    const ws = jsonToWorkspace(
      JSON.stringify({
        ...JSON.parse(EMPTY_JSON),
        documents: [{ ...DOC, blocks: [{ type: "paragraph", html: "<p>a</p><script>x()</script>" }] }],
      }),
    );
    const html = (ws.documents?.[0].blocks[0] as { html: string }).html;
    expect(html).not.toMatch(/script/i);
  });
});
```

Confirm the real exported names first:

```bash
grep -n "export function jsonToWorkspace\|export function workspaceToJson" src/app/workspace.ts
```

Use whatever names that reports. `jsonToWorkspace` needs a DOM — vitest runs jsdom, so this is fine here, but never call it from a node script.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/workspace.documents.test.ts > /tmp/t4.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/t4.log
```

Expected: FAIL — `ws.documents` is `undefined` in the round-trip test.

- [ ] **Step 3: Add the field**

In `src/app/workspace.ts`, next to the `insights` field (around line 128), add:

```ts
  /** AI- and user-authored project documents (canonical block model; bytes are
   *  rendered on demand and never stored). Optional & additive: undefined/empty
   *  serializes to nothing (byte-stable). Sanitized by sanitizeProjectDocuments,
   *  then sanitizeDocumentRichFields for the paragraph allow-list. */
  documents?: readonly ProjectDocument[];
```

Add the imports at the top:

```ts
import { sanitizeProjectDocuments, type ProjectDocument } from "./document-model";
import { sanitizeDocumentRichFields } from "./document-rich-fields";
```

- [ ] **Step 4: Wire the emit**

Beside the `insights` emit (around line 464), add:

```ts
      ...(ws.documents && ws.documents.length ? { documents: ws.documents } : {}),
```

- [ ] **Step 5: Wire the load**

Beside the `insights` load (around line 596), add:

```ts
    // Additive: sanitize incoming documents when present. The rich-field pass
    // is SEPARATE because sanitizeProjectDocuments is DOM-free by contract and
    // cannot run the HTML allow-list itself.
    if (p.documents !== undefined) {
      const docs = sanitizeProjectDocuments(p.documents).map(sanitizeDocumentRichFields);
      if (docs.length) raw.documents = docs;
    }
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/app/workspace.documents.test.ts > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add src/app/workspace.ts src/app/workspace.documents.test.ts
git commit -m "feat: persist documents on the JSON workspace path"
```

---

## Task 5: IndexedDB backend path

**Files:**
- Modify: `src/app/browser-backend.ts`

`documents` rides the KV store like `knowledgeItems` and `insights` — **no new object store, no DB version bump**. Read `browser-backend.ts:73-74`, `:143-144`, `:232-237`, `:288-289` and `:421-422` first; the change is one more of each.

- [ ] **Step 1: Write the failing test**

Create `src/app/browser-backend.documents.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";

const DOC = {
  id: 1,
  title: "Deck",
  blocks: [{ type: "pageBreak" as const }],
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
};

describe("IndexedDB backend — documents", () => {
  beforeEach(() => {
    // Follow whatever reset helper the sibling browser-backend tests use;
    // check src/app/browser-backend.test.ts for the established pattern.
  });

  it("saves and reloads documents", async () => {
    // ★ browser-backend exports the CLASS BrowserBackend, NOT save/load
    // functions. Each call constructs one. Verified against the shipped
    // browser-backend.documents.test.ts, which does exactly this.
    const { BrowserBackend } = await import("./browser-backend");
    await new BrowserBackend().save({ ...emptyWs(), documents: [DOC] });
    const back = await new BrowserBackend().load();
    expect(back.documents).toEqual([DOC]);
  });

  it("keeps documents undefined when none were saved", async () => {
    const { BrowserBackend } = await import("./browser-backend");
    const back = await new BrowserBackend().load();
    expect(back.documents).toBeUndefined();
  });
});
```

Before running, get the real exported names and the established reset pattern:

```bash
grep -n "export class BrowserBackend" src/app/browser-backend.ts
sed -n '1,40p' src/app/browser-backend.test.ts
```

Rewrite the test's imports and `beforeEach` to match what those report. Do not invent names.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/browser-backend.documents.test.ts > /tmp/t5.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/t5.log
```

Expected: FAIL — `back.documents` is `undefined` after save.

- [ ] **Step 3: Add the KV key**

Beside `KV_INSIGHTS_KEY` (line 74):

```ts
const KV_DOCUMENTS_KEY = "documents";
```

- [ ] **Step 4: Add the load**

Beside the `insights` local (line 144):

```ts
    let documents: Workspace["documents"] | undefined;
```

Beside the `insights` read (around line 234), following the same shape that file already uses to read a KV blob:

```ts
      // Optional list: junk/empty documents sanitize to [] → keep undefined.
      const docs = sanitizeProjectDocuments(await idbGet(KV_DOCUMENTS_KEY)).map(
        sanitizeDocumentRichFields,
      );
      documents = docs.length ? docs : undefined;
```

Beside line 289:

```ts
    if (documents) raw.documents = documents;
```

Add the imports:

```ts
import { sanitizeProjectDocuments } from "./document-model";
import { sanitizeDocumentRichFields } from "./document-rich-fields";
```

- [ ] **Step 5: Add the save**

Beside the `knowledgeItems` save (line 421):

```ts
      ws.documents && ws.documents.length
        ? idbSet(KV_DOCUMENTS_KEY, ws.documents)
        : idbDelete(KV_DOCUMENTS_KEY),
```

Match the exact idiom the neighbouring lines use — if they use a different delete helper name, use theirs.

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/app/browser-backend.documents.test.ts > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add src/app/browser-backend.ts src/app/browser-backend.documents.test.ts
git commit -m "feat: persist documents on the IndexedDB backend"
```

---

## Task 6: Turso single-DB and tenant paths

**Files:**
- Modify: `src/app/turso-schema.ts`, `src/app/turso-tenant-schema.ts`

Three edits in `turso-schema.ts` (load, dirty-detect, save) and one in the tenant file. Read `turso-schema.ts:191-199`, `:252`, `:342-350` and `turso-tenant-schema.ts:138-140` — the `insights` lines — before editing.

**`documents` does not join `TABLE_NAMES`.** It has no table of its own; it rides `meta`, so `TABLE_NAMES` (derived from `ENTITY_SPECS`) is untouched. The guard test that keeps non-workspace tables out of `TABLE_NAMES` therefore stays green with no change.

- [ ] **Step 1: Write the failing test**

Create `src/app/turso-schema.documents.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { workspaceToStatements, dirtyWorkspaceTables } from "./turso-schema";

const DOC = {
  id: 1,
  title: "Deck",
  blocks: [{ type: "pageBreak" as const }],
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
};

function emptyWs() {
  return {
    tasks: [], raid: [], absences: [], shifts: [], resources: [],
    roles: [], disciplines: [], grades: [], plan: {},
  } as never;
}

describe("turso — documents", () => {
  it("writes a meta row when documents exist", () => {
    const stmts = workspaceToStatements({ ...emptyWs(), documents: [DOC] });
    const json = JSON.stringify(stmts);
    expect(json).toContain('"documents"');
    expect(json).toContain("INSERT INTO meta");
  });

  it("writes no documents meta row when the array is empty", () => {
    expect(JSON.stringify(workspaceToStatements({ ...emptyWs(), documents: [] }))).not.toContain('"documents"');
  });

  it("marks meta dirty when the documents reference changes", () => {
    const prev = { ...emptyWs(), documents: [DOC] };
    const next = { ...emptyWs(), documents: [{ ...DOC, title: "Renamed" }] };
    expect([...dirtyWorkspaceTables(prev, next)]).toContain("meta");
  });

  it("does NOT mark meta dirty when the documents reference is identical", () => {
    // ★ Control: proves the dirty check is reference-based, not a false positive
    // from some other field. Without this the previous assertion passes even if
    // meta is unconditionally dirty.
    const docs = [DOC];
    const prev = { ...emptyWs(), documents: docs };
    const next = { ...emptyWs(), documents: docs };
    expect([...dirtyWorkspaceTables(prev, next)]).not.toContain("meta");
  });
});
```

Verify the real export names before running:

```bash
grep -nE "^export function (workspaceToStatements|dirtyWorkspaceTables)" src/app/turso-schema.ts
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/turso-schema.documents.test.ts > /tmp/t6.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/t6.log
```

Expected: FAIL — no `"documents"` in the statements.

- [ ] **Step 3: Add the load** (`turso-schema.ts`, after the `insights` block ~line 199)

```ts
  const docRow = rowObjects(byTable.get("meta")).find((r) => r.key === "documents");
  if (docRow?.value) {
    try {
      const docs = sanitizeProjectDocuments(JSON.parse(docRow.value)).map(
        sanitizeDocumentRichFields,
      );
      if (docs.length) ws.documents = docs;
    } catch {
      // malformed — leave undefined
    }
  }
```

Add the imports beside the other sanitizer imports:

```ts
import { sanitizeProjectDocuments } from "./document-model";
import { sanitizeDocumentRichFields } from "./document-rich-fields";
```

- [ ] **Step 4: Add the dirty check** (after line 252)

```ts
  if (prev.documents !== next.documents) dirty.add("meta");
```

- [ ] **Step 5: Add the save** (after the `insights` save block ~line 350)

```ts
    if (ws.documents && ws.documents.length) {
      out.push({
        sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
        args: [
          { type: "text", value: "documents" },
          { type: "text", value: JSON.stringify(ws.documents) },
        ],
      });
    }
```

- [ ] **Step 6: Add the tenant save** (`turso-tenant-schema.ts`, after line 140)

```ts
    if (ws.documents && ws.documents.length) {
      out.push(tenantInsert("meta", ["key", "value"], ["documents", JSON.stringify(ws.documents)], projectId));
    }
```

- [ ] **Step 7: Run tests**

```bash
npx vitest run src/app/turso-schema.documents.test.ts src/app/turso-schema.test.ts src/app/turso-migrate.test.ts > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t6.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`. The existing Turso tests must stay green — `TABLE_NAMES` was not touched.

- [ ] **Step 8: Commit**

```bash
git add src/app/turso-schema.ts src/app/turso-tenant-schema.ts src/app/turso-schema.documents.test.ts
git commit -m "feat: persist documents on both Turso backends via the meta blob"
```

---

## Task 7: CSV backend path

**Files:**
- Modify: `src/app/csv-codecs-core.ts`, `src/app/csv-codecs-config.ts`, `src/app/csv-codecs-decode.ts`

Mirror `knowledgeItems`: one `config,<json>` row under its own section header. Read `csv-codecs-config.ts:196-215` (`knowledgeItemsToCsv` / `csvToKnowledgeItems`) and `csv-codecs-decode.ts:132/159/180/209/236/442` first.

Note: unlike `knowledgeItems`, documents are **storage-only** in S1 — there is no `documents` key in `EXPORT_SECTION_KEYS`, so the section is written unconditionally when non-empty rather than gated by an export key. Do not add an export key; `exportWorkspace` is a different feature.

- [ ] **Step 1: Write the failing test**

Create `src/app/csv-codecs.documents.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { workspaceToCsv, csvToWorkspace } from "./csv-codecs";
import { defaultExportConfig } from "./settings-types";

const DOC = {
  id: 1,
  title: "Deck",
  blocks: [{ type: "heading" as const, level: 1 as const, text: "March" }],
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
};

function emptyWs() {
  return {
    tasks: [], raid: [], absences: [], shifts: [], resources: [],
    roles: [], disciplines: [], grades: [], plan: {},
  } as never;
}

describe("CSV codec — documents", () => {
  it("round-trips a document through CSV", () => {
    const csv = workspaceToCsv({ ...emptyWs(), documents: [DOC] }, defaultExportConfig);
    expect(csv).toContain("# DOCUMENTS");
    expect(csvToWorkspace(csv).documents).toEqual([DOC]);
  });

  it("emits no DOCUMENTS section when there are none", () => {
    expect(workspaceToCsv(emptyWs(), defaultExportConfig)).not.toContain("# DOCUMENTS");
  });

  it("round-trips a title containing a comma and a quote", () => {
    // ★ The JSON blob rides in one CSV cell, so cell escaping is the risk.
    const tricky = { ...DOC, title: 'Q1 "review", final' };
    const csv = workspaceToCsv({ ...emptyWs(), documents: [tricky] }, defaultExportConfig);
    expect(csvToWorkspace(csv).documents?.[0].title).toBe('Q1 "review", final');
  });
});
```

Confirm the real entry-point names:

```bash
grep -n "export function workspaceToCsv\|export function csvToWorkspace" src/app/csv-codecs*.ts
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/csv-codecs.documents.test.ts > /tmp/t7.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/t7.log
```

Expected: FAIL — no `# DOCUMENTS` section.

- [ ] **Step 3: Add the section constant** (`csv-codecs-core.ts`, beside line 216)

```ts
export const CSV_SECTION_DOCUMENTS = "# DOCUMENTS";
```

- [ ] **Step 4: Add the codec** (`csv-codecs-config.ts`, beside `knowledgeItemsToCsv`)

```ts
// Documents ride as a single `config,<json>` row like the knowledge items, but
// they are STORAGE-ONLY: there is no `documents` export key, so the section is
// written whenever the array is non-empty rather than gated by ExportConfig.

export function documentsToCsv(docs: readonly ProjectDocument[], neutralize = false): string {
  return ["config", csvCellEscape(JSON.stringify(docs), neutralize)].join(",");
}

export function csvToDocuments(text: string): ProjectDocument[] | undefined {
  const rows = parseCsv(text).filter((r) => r.length >= 2 && r[0] === "config");
  if (rows.length === 0) return undefined;
  try {
    const docs = sanitizeProjectDocuments(JSON.parse(rows[0][1]));
    return docs.length ? docs : undefined;
  } catch {
    return undefined;
  }
}
```

Add imports for `ProjectDocument`, `sanitizeProjectDocuments` and `CSV_SECTION_DOCUMENTS`.

- [ ] **Step 5: Emit the section** (`csv-codecs-config.ts`, beside line 555)

```ts
  if (ws.documents && ws.documents.length)
    csvPush(CSV_SECTION_DOCUMENTS, documentsToCsv(ws.documents, neutralize));
```

- [ ] **Step 6: Decode the section** (`csv-codecs-decode.ts`)

Four edits, mirroring `knowledgeItems`:

```ts
// 1. widen the mode union (line ~137): add `| "documents"`
// 2. beside line 159:
  const documentsLines: string[] = [];
// 3. beside line 180:
    if (trimmed.startsWith(CSV_SECTION_DOCUMENTS)) { mode = "documents"; continue; }
// 4. beside line 209:
    else if (mode === "documents") documentsLines.push(line);
// 5. add to the returned section bag (line ~236):
    documentsText: documentsLines.join("\r\n"),
// 6. add `documentsText: string;` to the section-bag type (line ~132)
// 7. beside line 442:
  if (s.documentsText.trim()) {
    const docs = csvToDocuments(s.documentsText);
    if (docs) ws.documents = docs;
  }
```

- [ ] **Step 7: Run tests**

```bash
npx vitest run src/app/csv-codecs.documents.test.ts src/app/csv-codecs.test.ts > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t7.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 8: Commit**

```bash
git add src/app/csv-codecs-core.ts src/app/csv-codecs-config.ts src/app/csv-codecs-decode.ts src/app/csv-codecs.documents.test.ts
git commit -m "feat: persist documents on the CSV backend"
```

---

## Task 8: Markdown backend path

**Files:**
- Modify: `src/app/markdown-codecs-core.ts`, `src/app/markdown-codecs-decode.ts`

A fenced ` ```json ` block, mirroring `knowledgeItemsToMarkdown` at `markdown-codecs-core.ts:171-184`. **Not** an MD table — `noteLog`, the only JSON-in-cell precedent, is deliberately absent from the Markdown columns, so there is no table pattern to copy.

- [ ] **Step 1: Write the failing test**

Create `src/app/markdown-codecs.documents.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { workspaceToMarkdown, markdownToWorkspace } from "./markdown-codecs";
import { defaultExportConfig } from "./settings-types";

const DOC = {
  id: 1,
  title: "Deck",
  blocks: [{ type: "bullets" as const, items: ["one", "two"] }],
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
};

function emptyWs() {
  return {
    tasks: [], raid: [], absences: [], shifts: [], resources: [],
    roles: [], disciplines: [], grades: [], plan: {},
  } as never;
}

describe("Markdown codec — documents", () => {
  it("round-trips a document", () => {
    const md = workspaceToMarkdown({ ...emptyWs(), documents: [DOC] }, defaultExportConfig);
    expect(md).toContain("## Documents");
    expect(markdownToWorkspace(md).documents).toEqual([DOC]);
  });

  it("emits no Documents block when there are none", () => {
    expect(workspaceToMarkdown(emptyWs(), defaultExportConfig)).not.toContain("## Documents");
  });

  it("round-trips a title containing a pipe and a backtick", () => {
    // ★ The blob sits inside a fenced block, not a table cell, so a pipe must
    // survive verbatim. A table-based codec would need escaping here.
    const tricky = { ...DOC, title: "A | B `code`" };
    const md = workspaceToMarkdown({ ...emptyWs(), documents: [tricky] }, defaultExportConfig);
    expect(markdownToWorkspace(md).documents?.[0].title).toBe("A | B `code`");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/markdown-codecs.documents.test.ts > /tmp/t8.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/t8.log
```

Expected: FAIL — no `## Documents`.

- [ ] **Step 3: Add the codec** (`markdown-codecs-core.ts`, beside line 171)

```ts
export function documentsToMarkdown(docs: readonly ProjectDocument[]): string {
  return ["## Documents", "", "```json", JSON.stringify(docs, null, 2), "```", ""].join("\n");
}

export function markdownToDocuments(md: string): ProjectDocument[] | undefined {
  const m = /## Documents\s*\n+```json\s*\n([\s\S]*?)\n```/.exec(md);
  if (!m) return undefined;
  try {
    const docs = sanitizeProjectDocuments(JSON.parse(m[1]));
    return docs.length ? docs : undefined;
  } catch {
    return undefined;
  }
}
```

Add imports for `ProjectDocument` and `sanitizeProjectDocuments`.

- [ ] **Step 4: Emit the block** (beside line 516)

```ts
  if (ws.documents && ws.documents.length) mdParts.push(documentsToMarkdown(ws.documents));
```

- [ ] **Step 5: Decode** (`markdown-codecs-decode.ts`, beside line 338)

```ts
  const docs = markdownToDocuments(md);
  if (docs) ws.documents = docs;
```

Add `markdownToDocuments` to the import list at line ~64.

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/app/markdown-codecs.documents.test.ts src/app/markdown-codecs.test.ts > /tmp/t8.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t8.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add src/app/markdown-codecs-core.ts src/app/markdown-codecs-decode.ts src/app/markdown-codecs.documents.test.ts
git commit -m "feat: persist documents on the Markdown backend"
```

---

## Task 9: Persistence registry, sample data, golden regen

**Files:**
- Modify: `src/app/entity-persistence-registry.test.ts`, `sample-workspace-small.json`
- Regenerate: `sample-workspace-big.json`, `sample-workspace-huge.json`, `src/app/__fixtures__/golden-*`

★★★ THE SAMPLE FILES LIVE AT THE REPO ROOT, NOT IN `public/`. Earlier drafts of this task said
`public/` in four places, including a verification command that fails today. Getting this wrong is
not a typo: `e2e/seed.ts` reads `sample-workspace-small.json` from `process.cwd()` at MODULE TOP
LEVEL, so "restoring" the samples to `public/` makes that read throw before any test runs and kills
the ENTIRE e2e job — in CI only, with a failure that looks nothing like a moved file. Cheap check
that triggers the read without needing browsers: `npx playwright test e2e/a11y.spec.ts --list`.

All six paths are now wired. This task proves it and seeds sample content so the new view has something to render at axe-scan time.

- [ ] **Step 1: Register documents in the persistence guard**

Read the file first to learn its shape:

```bash
sed -n '1,60p' src/app/entity-persistence-registry.test.ts
```

Add a `documents` entry following the registration shape that file already uses. Its job is to fail
when a field is added to `Workspace` but missed on a backend.

★ "Follow whatever shape it uses" was the whole of this step in the original draft, which is a
pointer rather than an instruction. Concretely: the registry drives one case per persisted field
across the backends, so the entry must name the field AND supply a non-empty sample value — an
entry registered with an empty array passes on every backend without proving anything, since an
absent field and a dropped field serialize identically.

- [ ] **Step 2: Run it and confirm it passes**

```bash
npx vitest run src/app/entity-persistence-registry.test.ts > /tmp/t9.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t9.log
```

Expected: PASS. If it fails, a backend was missed in Tasks 4-8 — fix the backend, not the registry.

- [ ] **Step 3: Seed one document in the sample master**

Find where the sample's top-level keys sit:

```bash
node -e "const w=require('./sample-workspace-small.json');console.log(Object.keys(w).join('\n'))"
```

Add a `documents` key with exactly one document. Keep it small — it is copied 3× and 10× by the generator:

```json
  "documents": [
    {
      "id": 1,
      "title": "Steering update",
      "blocks": [
        { "type": "heading", "level": 1, "text": "Steering update" },
        { "type": "paragraph", "html": "<p>Delivery is on track for the March gate.</p>" },
        { "type": "bullets", "items": ["API integration complete", "UAT window confirmed"] },
        { "type": "pageBreak" },
        { "type": "heading", "level": 1, "text": "Open risks" },
        { "type": "dataSection", "key": "raid" }
      ],
      "createdAt": "2026-08-01T09:00:00.000Z",
      "updatedAt": "2026-08-01T09:00:00.000Z"
    }
  ]
```

- [ ] **Step 4: Check whether the scaler needs to know about documents**

```bash
grep -n "knowledgeItems\|insights" scripts/generate-sample-workspace.ts | head
```

If `scaleWorkspace` explicitly handles those fields, add `documents` the same way (id-offset `k*100000`). If it copies unknown top-level keys through, no change is needed. Decide from what the grep shows, and add a one-line comment recording which it was.

- [ ] **Step 5: Regenerate the scaled samples**

```bash
npx vite-node scripts/generate-sample-workspace.ts > /tmp/gen.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/gen.log
```

Expected: `EXIT=0`.

★ Then **verify the output is not near-empty** — this is the DOM-free failure mode, which fails silently:

```bash
node -e "
for (const f of ['small','big','huge']) {
  const w = require('./sample-workspace-' + f + '.json');
  console.log(f, 'tasks=' + w.tasks.length, 'documents=' + (w.documents||[]).length);
}"
```

Expected: non-zero task counts on all three, and `documents` present. A zero anywhere means something in the import graph touched the DOM.

- [ ] **Step 6: Regenerate the goldens**

```bash
npx vitest run golden-workspace > /tmp/gold.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/gold.log
```

This will FAIL first — that is expected and correct, because the sample input legitimately changed. Regenerate the fixtures using whatever mechanism that test documents (read its header), then re-run until green.

★ Only regenerate because the *input* changed. Never regenerate to mask a format diff.

- [ ] **Step 7: Full suite**

```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```

Expected: `EXIT=0`.

- [ ] **Step 8: Commit**

```bash
git add src/app/entity-persistence-registry.test.ts sample-workspace-*.json src/app/__fixtures__
git commit -m "feat: seed a sample document and regenerate golden fixtures"
```

---

## Task 10: Extract OOXML primitives (refactor, no behaviour change)

**Files:**
- Create: `src/app/ooxml-docx-primitives.ts`, `src/app/ooxml-pptx-primitives.ts`
- Modify: `src/app/export-docx.ts`, `src/app/export-pptx.ts`

Pure move. `export-pptx.ts` is 586 lines against the 800-line ratchet, and three renderers built from the same shapes would trip the blocking `dup:check` gate. The existing `export-ooxml.test.ts` (720 lines) is the safety net: it must stay green **without edits**.

- [ ] **Step 1: Confirm the baseline is green**

```bash
npx vitest run src/app/export-ooxml.test.ts > /tmp/t10.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t10.log
```

Expected: `EXIT=0`. Record the test count — it must be identical at the end.

- [ ] **Step 2: Move the docx primitives AND the package assembly**

Create `src/app/ooxml-docx-primitives.ts`. Move `docxCellRuns` (line 22) and `buildDocxTable` (line 36) verbatim, exporting both. Then extract the package assembly from `buildDocx` (lines 178-211) into a reusable function — everything except the body content is generic:

```ts
/** Assemble a .docx package around a caller-supplied <w:body> content string.
 *  Extracted from buildDocx so the block renderer does not re-declare the
 *  content-types / rels / sectPr boilerplate. `extraStyles` is appended inside
 *  <w:styles> for callers that need styles beyond Title + TableHeader. */
export function buildDocxPackage(bodyXml: string, extraStyles = ""): Blob {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyXml}
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
  </w:style>${extraStyles}
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
```

Then reduce `buildDocx` in `export-docx.ts` to its body content plus a call:

```ts
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
```

- [ ] **Step 3: Move the pptx primitives AND the package assembly**

Create `src/app/ooxml-pptx-primitives.ts`. Move these verbatim, exporting each: `pptxTextBox` (159), `pptxBackgroundRect` (221), `pptxAccentBar` (242), `pptxTitleSubtitleShapes` (268), `wrapPptxSlide` (432), `buildPptxSlideMaster` (459), `buildPptxSlideLayout` (503), `buildPptxTheme` (530).

★ The **entire** package assembly in `buildPptx` (lines 56-146) is generic — it depends only on the slide XML strings, never on `ExportSection`. Extract all of it:

```ts
/** Assemble a .pptx package around a caller-supplied list of slide XML strings.
 *  Everything here — content types, presentation.xml sldIdList, all the rels,
 *  master/layout/theme — depends ONLY on the slide COUNT, so both the section
 *  exporter and the block renderer use this unchanged. */
export function buildPptxPackage(slideXmls: string[]): Blob {
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

  const slideMasterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

  const slideLayoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

  // Every slide shares the same _rels (points at slideLayout1).
  const slideRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

  const entries: ZipEntry[] = [
    { path: "[Content_Types].xml", data: contentTypes },
    { path: "_rels/.rels", data: rootRels },
    { path: "ppt/presentation.xml", data: presentationXml },
    { path: "ppt/_rels/presentation.xml.rels", data: presentationRels },
    { path: "ppt/slideMasters/slideMaster1.xml", data: buildPptxSlideMaster() },
    { path: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: slideMasterRels },
    { path: "ppt/slideLayouts/slideLayout1.xml", data: buildPptxSlideLayout() },
    { path: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: slideLayoutRels },
    { path: "ppt/theme/theme1.xml", data: buildPptxTheme() },
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
```

`buildPptx` in `export-pptx.ts` then reduces to the slide-building loop (lines 29-55) plus `return buildPptxPackage(slideXmls);`.

Leave the section-specific slide builders (`buildPptxTitleSlide`, `buildPptxDividerSlide`, `buildPptxRowSlide`, `buildPptxNoticeSlide`) in `export-pptx.ts` — they are about `ExportSection`, not about PPTX.

- [ ] **Step 4: Verify no behaviour changed**

```bash
npx vitest run src/app/export-ooxml.test.ts > /tmp/t10.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t10.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: all `EXIT=0`, and the same test count as Step 1. **Do not edit `export-ooxml.test.ts`** — if it needs editing, the move was not verbatim.

- [ ] **Step 5: Confirm the size ratchet improved**

```bash
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/size.log
wc -l src/app/export-pptx.ts src/app/export-docx.ts src/app/ooxml-*.ts
```

Expected: `EXIT=0`, and `export-pptx.ts` well below its previous 586.

- [ ] **Step 6: Commit**

```bash
git add src/app/ooxml-docx-primitives.ts src/app/ooxml-pptx-primitives.ts src/app/export-docx.ts src/app/export-pptx.ts
git commit -m "refactor: extract shared OOXML primitives from the export builders"
```

---

## Task 11: Promote triggerDownload and PRINT_STYLES

**Files:**
- Create: `src/app/download.ts`
- Modify: `src/app/export.ts`

`triggerDownload` (`export.ts:58`) and `PRINT_STYLES` (`export.ts:114`) are private. Two callers are about to need them; one blob-URL lifecycle and one print stylesheet, not two that drift.

- [ ] **Step 1: Create the module**

Create `src/app/download.ts` and move `triggerDownload` and `PRINT_STYLES` from `export.ts` verbatim, exporting both. Also move `htmlEscape` (line 75) and `htmlCellWithBreaks` (line 89) — the HTML renderer needs the same escape-then-substitute ordering, and duplicating it is exactly how the `<br>` bug in that function's comment comes back.

Keep the comment on `htmlCellWithBreaks` intact — it records why both orderings other than escape-then-substitute are wrong.

- [ ] **Step 2: Import them back into export.ts**

```ts
import { triggerDownload, PRINT_STYLES, htmlEscape, htmlCellWithBreaks } from "./download";
```

- [ ] **Step 3: Verify nothing changed**

```bash
npx vitest run src/app/export.test.ts src/app/export-ooxml.test.ts > /tmp/t11.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t11.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: all `EXIT=0`, `export.test.ts` unedited.

- [ ] **Step 4: Commit**

```bash
git add src/app/download.ts src/app/export.ts
git commit -m "refactor: promote triggerDownload and print styles to a shared module"
```

---

## Task 12: HTML renderer

**Files:**
- Create: `src/app/doc-render-html.ts`
- Test: `src/app/doc-render-html.test.ts`

The canonical renderer. Two modes: `preview` (a fragment for the in-app view) and `standalone` (a full document with `PRINT_STYLES`, used for the `.html` download **and** the print-PDF).

- [ ] **Step 1: Write the failing test**

Create `src/app/doc-render-html.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderDocumentHtml } from "./doc-render-html";
import type { ProjectDocument } from "./document-model";
import { defaultExportConfig } from "./settings-types";

const ws = {
  tasks: [], raid: [], absences: [], shifts: [], resources: [],
  roles: [], disciplines: [], grades: [], plan: {},
} as never;

const doc = (blocks: ProjectDocument["blocks"]): ProjectDocument => ({
  id: 1,
  title: "Report",
  blocks,
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
});

describe("renderDocumentHtml", () => {
  it("renders headings at the right level", () => {
    const html = renderDocumentHtml(doc([{ type: "heading", level: 2, text: "Scope" }]), ws, "en-US", "preview");
    expect(html).toContain("<h2");
    expect(html).toContain("Scope");
  });

  it("escapes heading text", () => {
    const html = renderDocumentHtml(doc([{ type: "heading", level: 1, text: "<img src=x>" }]), ws, "en-US", "preview");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("sanitizes paragraph html at the sink", () => {
    // ★★ This is the layer that actually holds: the CSV/MD/Turso decoders never
    // sanitize, and document-model.ts is DOM-free and cannot.
    const html = renderDocumentHtml(
      doc([{ type: "paragraph", html: "<p>ok</p><script>alert(1)</script>" }]),
      ws, "en-US", "preview",
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("ok");
  });

  it("keeps a heading tag inside paragraph html (template allow-list, not the note one)", () => {
    const html = renderDocumentHtml(doc([{ type: "paragraph", html: "<h3>Sub</h3>" }]), ws, "en-US", "preview");
    expect(html).toContain("Sub");
  });

  it("renders bullets as ul and ordered bullets as ol", () => {
    expect(renderDocumentHtml(doc([{ type: "bullets", items: ["a"] }]), ws, "en-US", "preview")).toContain("<ul");
    expect(renderDocumentHtml(doc([{ type: "bullets", ordered: true, items: ["a"] }]), ws, "en-US", "preview")).toContain("<ol");
  });

  it("renders a table with a header row", () => {
    const html = renderDocumentHtml(
      doc([{ type: "table", columns: ["Risk", "Owner"], rows: [["Vendor", "AL"]] }]),
      ws, "en-US", "preview",
    );
    expect(html).toContain("<th");
    expect(html).toContain("Vendor");
  });

  it("renders a pageBreak as a break-after element in standalone mode", () => {
    const html = renderDocumentHtml(doc([{ type: "pageBreak" }]), ws, "en-US", "standalone");
    expect(html).toMatch(/page-break/);
  });

  it("resolves a dataSection against the live workspace", () => {
    const wsWithRaid = {
      ...ws,
      raid: [{ id: 1, title: "Vendor delay", category: "Risk", status: "Open" }],
    } as never;
    const html = renderDocumentHtml(doc([{ type: "dataSection", key: "raid" }]), wsWithRaid, "en-US", "preview");
    expect(html).toContain("Vendor delay");
  });

  it("renders an empty dataSection as nothing rather than a bare header", () => {
    const html = renderDocumentHtml(doc([{ type: "dataSection", key: "raid" }]), ws, "en-US", "preview");
    expect(html).not.toContain("<table");
  });

  it("standalone mode emits a full document, preview mode does not", () => {
    expect(renderDocumentHtml(doc([]), ws, "en-US", "standalone")).toMatch(/^<!DOCTYPE html>/);
    expect(renderDocumentHtml(doc([]), ws, "en-US", "preview")).not.toMatch(/DOCTYPE/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/doc-render-html.test.ts > /tmp/t12.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/t12.log
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/app/doc-render-html.ts`:

```ts
// src/app/doc-render-html.ts — blocks → HTML. The CANONICAL renderer: it backs
// the in-app preview, the .html download and the print-PDF path.
//
// ★★ The paragraph sink re-sanitizes. The CSV/MD/Turso decoders hand-build
// entities and never call a sanitizer, and document-model.ts is DOM-free by
// contract, so THIS is the layer that actually holds against stored markup.
// Use sanitizeTemplateHtml (wide allow-list), never sanitizeNoteHtml — the
// latter's KEEP_CONTENT:false deletes the text inside <h3>/<table>.

import type { DocBlock, ProjectDocument } from "./document-model";
import { buildExportSections, type ExportSection } from "./export-sections";
import { sanitizeTemplateHtml } from "./sanitize-html";
import { htmlEscape, htmlCellWithBreaks, PRINT_STYLES } from "./download";
import { defaultExportConfig, EXPORT_SECTION_KEYS, type ExportSectionKey } from "./settings-types";
import type { Workspace } from "./workspace";
import type { Lang } from "./i18n";

export type DocHtmlMode = "preview" | "standalone";

function sectionTable(section: ExportSection): string {
  const head = section.columns.map((c) => `<th>${htmlEscape(c)}</th>`).join("");
  const body = section.rows
    .map((r) => `<tr>${r.map((c) => `<td>${htmlCellWithBreaks(c)}</td>`).join("")}</tr>`)
    .join("\n");
  return `<table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

/** Resolve one dataSection key against the live workspace. Returns null when
 *  the section is empty — an empty section renders as nothing, not as a bare
 *  header with no rows under it. */
function resolveSection(
  key: ExportSectionKey,
  ws: Workspace,
  lang: Lang,
): ExportSection | null {
  const cfg = { ...defaultExportConfig };
  for (const k of EXPORT_SECTION_KEYS) cfg[k] = k === key;
  const sections = buildExportSections(ws, cfg, lang);
  const found = sections.find((s) => s.key === key);
  return found && found.rows.length > 0 ? found : null;
}

function renderBlock(block: DocBlock, ws: Workspace, lang: Lang): string {
  switch (block.type) {
    case "heading":
      return `<h${block.level}>${htmlEscape(block.text)}</h${block.level}>`;

    case "paragraph":
      return sanitizeTemplateHtml(block.html);

    case "bullets": {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items.map((i) => `<li>${htmlEscape(i)}</li>`).join("");
      return `<${tag}>${items}</${tag}>`;
    }

    case "table": {
      const caption = block.caption
        ? `<caption>${htmlEscape(block.caption)}</caption>`
        : "";
      const head = block.columns.map((c) => `<th>${htmlEscape(c)}</th>`).join("");
      const body = block.rows
        .map((r) => `<tr>${r.map((c) => `<td>${htmlCellWithBreaks(c)}</td>`).join("")}</tr>`)
        .join("\n");
      return `<table>${caption}<thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`;
    }

    case "dataSection": {
      const section = resolveSection(block.key, ws, lang);
      if (!section) return "";
      return `<h2>${htmlEscape(section.title)}</h2>${sectionTable(section)}`;
    }

    case "pageBreak":
      return `<div class="page-break"></div>`;
  }
}

export function renderDocumentHtml(
  doc: ProjectDocument,
  ws: Workspace,
  lang: Lang,
  mode: DocHtmlMode,
): string {
  const body = doc.blocks
    .map((b) => renderBlock(b, ws, lang))
    .filter((s) => s !== "")
    .join("\n");

  if (mode === "preview") return body;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${htmlEscape(doc.title)}</title>
  <style>${PRINT_STYLES}
    .page-break { break-after: page; page-break-after: always; height: 0; }
  </style>
</head>
<body>
  <header><h1>${htmlEscape(doc.title)}</h1></header>
  ${body}
  <footer>Acme — AI PM Cockpit</footer>
</body>
</html>`;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/app/doc-render-html.test.ts > /tmp/t12.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t12.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/doc-render-html.ts src/app/doc-render-html.test.ts
git commit -m "feat: render project documents to HTML"
```

---

## Task 13: DOCX renderer

**Files:**
- Create: `src/app/doc-render-docx.ts`
- Test: `src/app/doc-render-docx.test.ts`

★ `paragraph.html` reaches OOXML as **flat text with line breaks**, via `descriptionTextWithBreaks` — the same projection `export-sections.ts` `richCell` already uses. Bold and italic are lost in `.docx`; that is a recorded limitation, not a bug to fix here. That projection is DOM-bound, so this module is browser/jsdom-only and must never be called from a node script.

- [ ] **Step 1: Write the failing test**

Create `src/app/doc-render-docx.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderDocumentDocx } from "./doc-render-docx";
import { readZipEntries } from "./unzip";
import { decodeUtf8 } from "./office-xml";
import type { ProjectDocument } from "./document-model";

const ws = {
  tasks: [], raid: [], absences: [], shifts: [], resources: [],
  roles: [], disciplines: [], grades: [], plan: {},
} as never;

const doc = (blocks: ProjectDocument["blocks"]): ProjectDocument => ({
  id: 1, title: "Report", blocks,
  createdAt: "2026-08-06T00:00:00.000Z", updatedAt: "2026-08-06T00:00:00.000Z",
});

async function documentXml(d: ProjectDocument): Promise<string> {
  const blob = renderDocumentDocx(d, ws, "en-US");
  const entries = await readZipEntries(await blob.arrayBuffer());
  // ★ entries is a Map<string, Uint8Array> keyed by archive path — .get(), not
  // .find((e) => e.path). A Map has no .find, so the array spelling throws.
  const entry = entries.get("word/document.xml");
  if (!entry) throw new Error("word/document.xml missing");
  return decodeUtf8(entry);
}

describe("renderDocumentDocx", () => {
  it("produces a zip containing word/document.xml", async () => {
    const xml = await documentXml(doc([]));
    expect(xml).toContain("<w:document");
  });

  it("maps heading levels to Heading styles", async () => {
    const xml = await documentXml(doc([{ type: "heading", level: 2, text: "Scope" }]));
    expect(xml).toContain('w:val="Heading2"');
    expect(xml).toContain("Scope");
  });

  it("XML-escapes text", async () => {
    const xml = await documentXml(doc([{ type: "heading", level: 1, text: "A & B" }]));
    expect(xml).toContain("A &amp; B");
  });

  it("renders a pageBreak as a page-type break", async () => {
    const xml = await documentXml(doc([{ type: "pageBreak" }]));
    expect(xml).toContain('w:type="page"');
  });

  it("flattens paragraph html to text and keeps the block boundary as a break", async () => {
    // ★ Recorded limitation: bold/italic are lost. What must NOT be lost is the
    // paragraph boundary — three paragraphs must not fuse into one run-on line.
    const xml = await documentXml(doc([{ type: "paragraph", html: "<p>one</p><p>two</p>" }]));
    expect(xml).toContain("one");
    expect(xml).toContain("two");
    expect(xml).toContain("<w:br/>");
    expect(xml).not.toContain("onetwo");
  });

  it("renders a table", async () => {
    const xml = await documentXml(
      doc([{ type: "table", columns: ["Risk"], rows: [["Vendor"]] }]),
    );
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("Vendor");
  });

  it("resolves a dataSection", async () => {
    const wsWithRaid = { ...ws, raid: [{ id: 1, title: "Vendor delay", category: "Risk", status: "Open" }] } as never;
    const blob = renderDocumentDocx(doc([{ type: "dataSection", key: "raid" }]), wsWithRaid, "en-US");
    const entries = await readZipEntries(await blob.arrayBuffer());
    const xml = decodeUtf8(entries.get("word/document.xml")!);
    expect(xml).toContain("Vendor delay");
  });
});
```

`readZipEntries` (in `./unzip`) is `async` and resolves to `Map<string, Uint8Array>`, keyed by
archive path. It takes an `ArrayBuffer | Uint8Array`, so a Blob must go through
`await blob.arrayBuffer()` first. Verified — the command that shows it:

```bash
grep -n "export async function readZipEntries" -A6 src/app/unzip.ts
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/doc-render-docx.test.ts > /tmp/t13.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/t13.log
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/app/doc-render-docx.ts`, using `buildDocxPackage` from Task 10.

★★ **The shipped `styles.xml` declares only `Title` and `TableHeader` — there is no `Heading1/2/3` or `ListParagraph`.** Word resolves those names against its built-in latent styles, so a document referencing them usually renders, but the heading sizes and colours would be Word's defaults rather than the Acme palette, and LibreOffice is less forgiving. Pass the missing styles through `extraStyles`.

```ts
// src/app/doc-render-docx.ts — blocks → WordprocessingML.
//
// ★★ DOM-BOUND, unlike the section-based OOXML builders: descriptionTextWithBreaks
// lives in rich-text-projection.ts, which needs a DOM. Never call this from a
// node script (the sample generator must not touch it).
//
// ★ paragraph.html arrives as FLAT TEXT with "\n" at block boundaries; each "\n"
// becomes a <w:br/> inside one run. Bold/italic are a recorded S1 limitation.

import type { DocBlock, ProjectDocument } from "./document-model";
import { buildDocxTable, buildDocxPackage } from "./ooxml-docx-primitives";
import { xmlEscape, COLOR_DARK_BLUE, COLOR_TEXT } from "./export-ooxml-shared";
import { descriptionTextWithBreaks } from "./rich-text-projection";
import type { Workspace } from "./workspace";
import type { Lang } from "./i18n";
// resolveDataSection is shared with the HTML renderer — export it from
// doc-render-html.ts rather than writing a second copy.
import { resolveDataSection } from "./doc-render-html";

/** ★ The shipped styles.xml has no Heading/List styles. Declare them rather
 *  than relying on Word's latent built-ins, so the palette holds and
 *  LibreOffice renders the same document. Sizes are half-points: 32 = 16pt. */
const DOC_STYLES = `
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="${COLOR_DARK_BLUE}"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="200" w:after="100"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="${COLOR_DARK_BLUE}"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:pPr><w:outlineLvl w:val="2"/><w:spacing w:before="160" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="${COLOR_TEXT}"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph">
    <w:name w:val="List Paragraph"/>
    <w:pPr><w:ind w:left="720"/><w:spacing w:after="60"/></w:pPr>
  </w:style>`;

function textRuns(text: string): string {
  return text
    .split("\n")
    .map((line, i) => (i === 0 ? "" : "<w:br/>") + `<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`)
    .join("");
}

function para(text: string, style?: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${pPr}<w:r>${textRuns(text)}</w:r></w:p>`;
}

function renderBlock(block: DocBlock, ws: Workspace, lang: Lang): string {
  switch (block.type) {
    case "heading":
      return para(block.text, `Heading${block.level}`);
    case "paragraph":
      return para(descriptionTextWithBreaks(block.html));
    case "bullets":
      return block.items.map((i) => para(i, "ListParagraph")).join("");
    case "table":
      return buildDocxTable(block.columns, block.rows);
    case "dataSection": {
      const section = resolveDataSection(block.key, ws, lang);
      if (!section) return "";
      return para(section.title, "Heading2") + buildDocxTable(section.columns, section.rows);
    }
    case "pageBreak":
      return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
  }
}

export function renderDocumentDocx(doc: ProjectDocument, ws: Workspace, lang: Lang): Blob {
  const body =
    para(doc.title, "Title") +
    doc.blocks.map((b) => renderBlock(b, ws, lang)).join("");
  return buildDocxPackage(body, DOC_STYLES);
}
```

A docx missing `[Content_Types].xml` will not open, and the test above only reads `word/document.xml`, so it would not catch a broken package. Add this assertion to close that gap:

```ts
  it("includes the package parts Word requires", async () => {
    const blob = renderDocumentDocx(doc([]), ws, "en-US");
    // ★ readZipEntries resolves to a Map<string, Uint8Array> (path -> bytes),
    // NOT an array of {path, data}. A Map has no .map/.find, so the obvious
    // spellings throw TypeError; take the keys.
    const paths = [...(await readZipEntries(await blob.arrayBuffer())).keys()];
    expect(paths).toContain("[Content_Types].xml");
    expect(paths).toContain("_rels/.rels");
  });
```

Also export `resolveDataSection` from `doc-render-html.ts` (rename the private `resolveSection` and export it) so all three renderers share one resolver.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/app/doc-render-docx.test.ts src/app/doc-render-html.test.ts > /tmp/t13.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t13.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/doc-render-docx.ts src/app/doc-render-docx.test.ts src/app/doc-render-html.ts
git commit -m "feat: render project documents to DOCX"
```

---

## Task 14: PPTX renderer

**Files:**
- Create: `src/app/doc-render-pptx.ts`
- Test: `src/app/doc-render-pptx.test.ts`

Blocks segment into slides at every `pageBreak` **and** every `level: 1` heading, which becomes that slide's title.

- [ ] **Step 1: Write the failing test**

Create `src/app/doc-render-pptx.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderDocumentPptx, segmentIntoSlides } from "./doc-render-pptx";
import { readZipEntries } from "./unzip";
import type { ProjectDocument, DocBlock } from "./document-model";

const ws = {
  tasks: [], raid: [], absences: [], shifts: [], resources: [],
  roles: [], disciplines: [], grades: [], plan: {},
} as never;

const doc = (blocks: ProjectDocument["blocks"]): ProjectDocument => ({
  id: 1, title: "Deck", blocks,
  createdAt: "2026-08-06T00:00:00.000Z", updatedAt: "2026-08-06T00:00:00.000Z",
});

describe("segmentIntoSlides", () => {
  it("starts a new slide at a level-1 heading and uses it as the title", () => {
    const blocks: DocBlock[] = [
      { type: "heading", level: 1, text: "One" },
      { type: "bullets", items: ["a"] },
      { type: "heading", level: 1, text: "Two" },
    ];
    const slides = segmentIntoSlides(blocks);
    expect(slides).toHaveLength(2);
    expect(slides[0].title).toBe("One");
    expect(slides[0].body).toHaveLength(1);
    expect(slides[1].title).toBe("Two");
  });

  it("starts a new slide at a pageBreak without consuming a title", () => {
    const slides = segmentIntoSlides([
      { type: "bullets", items: ["a"] },
      { type: "pageBreak" },
      { type: "bullets", items: ["b"] },
    ]);
    expect(slides).toHaveLength(2);
    expect(slides[1].title).toBe("");
  });

  it("does NOT split on a level-2 heading", () => {
    // ★ Control: without this, a renderer that splits on every heading passes
    // the level-1 test above for the wrong reason.
    const slides = segmentIntoSlides([
      { type: "heading", level: 1, text: "One" },
      { type: "heading", level: 2, text: "Sub" },
    ]);
    expect(slides).toHaveLength(1);
    expect(slides[0].body).toHaveLength(1);
  });

  it("returns no slides for an empty block list", () => {
    expect(segmentIntoSlides([])).toEqual([]);
  });
});

describe("renderDocumentPptx", () => {
  it("emits one slide part per segment plus the package parts", async () => {
    const blob = renderDocumentPptx(
      doc([
        { type: "heading", level: 1, text: "One" },
        { type: "heading", level: 1, text: "Two" },
      ]),
      ws, "en-US",
    );
    // ★ readZipEntries resolves to a Map<string, Uint8Array> (path -> bytes),
    // NOT an array of {path, data}. A Map has no .map/.find, so the obvious
    // spellings throw TypeError; take the keys.
    const paths = [...(await readZipEntries(await blob.arrayBuffer())).keys()];
    expect(paths).toContain("[Content_Types].xml");
    expect(paths.filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))).toHaveLength(3);
  });
});
```

The expected slide count is 3 because a title slide is emitted first — confirm against your implementation and fix the number to whatever it actually is, but assert an exact count, never `toBeGreaterThan`.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/doc-render-pptx.test.ts > /tmp/t14.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/t14.log
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/app/doc-render-pptx.ts`:

```ts
// src/app/doc-render-pptx.ts — blocks → PresentationML.
//
// Segmentation: a new slide starts at every pageBreak and at every level-1
// heading, which becomes that slide's title. Level 2/3 headings stay in the
// body — splitting on every heading would shred a document into one-line slides.

import type { DocBlock, ProjectDocument } from "./document-model";
import {
  wrapPptxSlide, pptxTextBox, pptxBackgroundRect, pptxAccentBar,
  pptxTitleSubtitleShapes, buildPptxPackage,
} from "./ooxml-pptx-primitives";
import { COLOR_WHITE, COLOR_DARK_BLUE } from "./export-ooxml-shared";
import { descriptionTextWithBreaks } from "./rich-text-projection";
import { resolveDataSection } from "./doc-render-html";
import type { Workspace } from "./workspace";
import type { Lang } from "./i18n";

export type DocSlide = { title: string; body: DocBlock[] };

/** Pure: split a block list into slides. Exported for direct unit testing —
 *  the segmentation rule is the part most likely to regress. */
export function segmentIntoSlides(blocks: readonly DocBlock[]): DocSlide[] {
  const slides: DocSlide[] = [];
  let current: DocSlide | null = null;

  const start = (title: string) => {
    current = { title, body: [] };
    slides.push(current);
  };

  for (const b of blocks) {
    if (b.type === "heading" && b.level === 1) {
      start(b.text);
      continue;
    }
    if (b.type === "pageBreak") {
      start("");
      continue;
    }
    if (!current) start("");
    current!.body.push(b);
  }
  return slides;
}

/** Body blocks → the plain lines a slide shows. */
function slideLines(slide: DocSlide, ws: Workspace, lang: Lang): string[] {
  const lines: string[] = [];
  for (const b of slide.body) {
    switch (b.type) {
      case "heading": lines.push(b.text); break;
      case "paragraph": lines.push(...descriptionTextWithBreaks(b.html).split("\n")); break;
      case "bullets": lines.push(...b.items.map((i) => `• ${i}`)); break;
      case "table":
        lines.push(b.columns.join("  |  "));
        lines.push(...b.rows.map((r) => r.join("  |  ")));
        break;
      case "dataSection": {
        const s = resolveDataSection(b.key, ws, lang);
        if (!s) break;
        lines.push(s.title, s.columns.join("  |  "));
        lines.push(...s.rows.map((r) => r.map(String).join("  |  ")));
        break;
      }
      case "pageBreak": break;
    }
  }
  return lines.filter((l) => l.trim() !== "");
}

/** Slide geometry in EMUs (914400 per inch); slides are 9144000 × 5143500. */
const TITLE_BOX = { x: 457200, y: 365760, cx: 8229600, cy: 685800 };
const BODY_BOX = { x: 457200, y: 1188720, cx: 8229600, cy: 3474720 };

// ★ lang is threaded in because pptxTextBox REQUIRES it (see below) — it is
// deliberately not defaulted, so every call site must supply it.
function buildContentSlide(slide: DocSlide, lines: string[], lang: Lang): string {
  const shapes =
    pptxBackgroundRect(COLOR_WHITE) +
    pptxAccentBar(COLOR_DARK_BLUE) +
    (slide.title
      ? pptxTextBox({
          ...TITLE_BOX, id: 2, name: "Title", lang,
          paragraphs: [{ text: slide.title, sizeHundredths: 2800, bold: true, colorRgb: COLOR_DARK_BLUE }],
        })
      : "") +
    pptxTextBox({
      ...BODY_BOX, id: 3, name: "Body", lang,
      paragraphs: lines.map((text) => ({ text, sizeHundredths: 1400 })),
    });
  return wrapPptxSlide(shapes);
}

export function renderDocumentPptx(doc: ProjectDocument, ws: Workspace, lang: Lang): Blob {
  const slideXmls: string[] = [
    // Title slide always first, matching buildPptx.
    wrapPptxSlide(
      pptxBackgroundRect(COLOR_DARK_BLUE) + pptxTitleSubtitleShapes(doc.title, ""),
    ),
  ];
  for (const slide of segmentIntoSlides(doc.blocks)) {
    slideXmls.push(buildContentSlide(slide, slideLines(slide, ws, lang)));
  }
  return buildPptxPackage(slideXmls);
}
```

★★ The `pptxTextBox` option bag above is now VERIFIED against `ooxml-pptx-primitives.ts`, not
guessed. Three things the earlier draft got wrong, each of which fails to compile or silently ships
wrong output:
- there is no `text` option — prose goes in `paragraphs: Array<{ text, bold?, italic?,
  sizeHundredths?, colorRgb? }>`, so multi-line body text is one paragraph PER LINE rather than a
  newline-joined string;
- there is no `sizePt` — the field is `sizeHundredths`, in HUNDREDTHS of a point (2800 = 28pt),
  which is the DrawingML `a:rPr sz` convention. Half-points (`w:sz`, 56 = 28pt) is the
  WordprocessingML convention and differs by 50x, so confusing them ships text at the wrong size
  with no error;
- geometry options are `xEmu`/`yEmu`/`cxEmu`/`cyEmu`, so `TITLE_BOX`/`BODY_BOX` must be declared
  with those names, and `id`, `name` and `lang` are all REQUIRED (`lang` deliberately has no
  default — a hardcoded "en-US" made German decks assert American English).
`pptxTitleSubtitleShapes` was NOT re-verified — read it before use.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/app/doc-render-pptx.test.ts > /tmp/t14.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t14.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 5: Run the duplication gate** — three renderers now exist

```bash
npm run dup:check > /tmp/dup.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dup.log
```

Expected: `EXIT=0`. If it fires, extract the shared shape into the primitives modules — do **not** raise the threshold.

- [ ] **Step 6: Commit**

```bash
git add src/app/doc-render-pptx.ts src/app/doc-render-pptx.test.ts
git commit -m "feat: render project documents to PPTX"
```

---

## Task 15: Download entry point

**Files:**
- Create: `src/app/document-download.ts`
- Test: `src/app/document-download.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/document-download.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadDocument, documentFilename } from "./document-download";
import type { ProjectDocument } from "./document-model";

const ws = {
  tasks: [], raid: [], absences: [], shifts: [], resources: [],
  roles: [], disciplines: [], grades: [], plan: {},
} as never;

const doc: ProjectDocument = {
  id: 1, title: "Q1 Status / Review", blocks: [],
  createdAt: "2026-08-06T00:00:00.000Z", updatedAt: "2026-08-06T00:00:00.000Z",
};

describe("documentFilename", () => {
  it("slugifies the title and appends the date and extension", () => {
    expect(documentFilename(doc, "docx", "2026-08-06")).toBe("q1-status-review-2026-08-06.docx");
  });

  it("falls back to a generic stem when the title slugifies to nothing", () => {
    expect(documentFilename({ ...doc, title: "///" }, "html", "2026-08-06")).toBe("document-2026-08-06.html");
  });
});

describe("downloadDocument", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("triggers an anchor download for html, docx and pptx", () => {
    const clicks: string[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicks.push(this.download); };
    try {
      downloadDocument(doc, "html", ws, "en-US");
      downloadDocument(doc, "docx", ws, "en-US");
      downloadDocument(doc, "pptx", ws, "en-US");
    } finally {
      HTMLAnchorElement.prototype.click = orig;
    }
    expect(clicks).toHaveLength(3);
    expect(clicks[0]).toMatch(/\.html$/);
    expect(clicks[1]).toMatch(/\.docx$/);
    expect(clicks[2]).toMatch(/\.pptx$/);
  });

  it("opens a print tab for pdf and does NOT download", () => {
    const write = vi.fn();
    const open = vi.fn(() => ({ document: { open: vi.fn(), write, close: vi.fn() } }));
    vi.stubGlobal("open", open);
    const clicks: string[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicks.push(this.download); };
    try {
      downloadDocument(doc, "pdf", ws, "en-US");
    } finally {
      HTMLAnchorElement.prototype.click = orig;
    }
    expect(open).toHaveBeenCalled();
    expect(write).toHaveBeenCalled();
    expect(clicks).toHaveLength(0);
  });

  it("falls back to an .html download when the popup is blocked", () => {
    vi.stubGlobal("open", vi.fn(() => null));
    const clicks: string[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicks.push(this.download); };
    try {
      downloadDocument(doc, "pdf", ws, "en-US");
    } finally {
      HTMLAnchorElement.prototype.click = orig;
    }
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatch(/\.html$/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/document-download.test.ts > /tmp/t15.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/t15.log
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/app/document-download.ts`:

```ts
// src/app/document-download.ts — the one place a document becomes bytes.

import type { ProjectDocument } from "./document-model";
import { renderDocumentHtml } from "./doc-render-html";
import { renderDocumentDocx } from "./doc-render-docx";
import { renderDocumentPptx } from "./doc-render-pptx";
import { triggerDownload } from "./download";
import type { Workspace } from "./workspace";
import type { Lang } from "./i18n";

export type DocFormat = "html" | "docx" | "pptx" | "pdf";

export function documentFilename(doc: ProjectDocument, format: DocFormat, today: string): string {
  const slug = doc.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "document"}-${today}.${format}`;
}

export function downloadDocument(
  doc: ProjectDocument,
  format: DocFormat,
  ws: Workspace,
  lang: Lang,
): void {
  if (typeof window === "undefined") return;
  const today = new Date().toISOString().slice(0, 10);

  if (format === "pdf") {
    // ★ Same shape as export.ts exportPdf: a print tab, not a blob. Browsers
    // handle the print dialog more reliably on a top-level window, and the tab
    // gives the user Ctrl+P as a fallback if auto-print did not fire.
    const html = renderDocumentHtml(doc, ws, lang, "standalone");
    const w = window.open("", "_blank");
    if (!w) {
      // Popup blocked — fall back to downloading the HTML so the user can
      // open and print it manually.
      triggerDownload(
        documentFilename(doc, "html", today),
        new Blob([html], { type: "text/html;charset=utf-8" }),
      );
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    return;
  }

  const blob =
    format === "html"
      ? new Blob([renderDocumentHtml(doc, ws, lang, "standalone")], {
          type: "text/html;charset=utf-8",
        })
      : format === "docx"
        ? renderDocumentDocx(doc, ws, lang)
        : renderDocumentPptx(doc, ws, lang);

  triggerDownload(documentFilename(doc, format, today), blob);
}
```

The `standalone` HTML must carry the auto-print script for the PDF path. Move the `window.addEventListener("load", …)` block from `export.ts` `buildPdfHtml` into `renderDocumentHtml`'s standalone branch, guarded so the plain `.html` download does not auto-print — pass a `{ autoPrint?: boolean }` option and set it only from the pdf branch. Update `doc-render-html.test.ts` with:

```ts
  it("includes the auto-print script only when autoPrint is set", () => {
    expect(renderDocumentHtml(doc([]), ws, "en-US", "standalone", { autoPrint: true })).toContain("window.print");
    expect(renderDocumentHtml(doc([]), ws, "en-US", "standalone")).not.toContain("window.print");
  });
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/app/document-download.test.ts src/app/doc-render-html.test.ts > /tmp/t15.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t15.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/document-download.ts src/app/document-download.test.ts src/app/doc-render-html.ts src/app/doc-render-html.test.ts
git commit -m "feat: download a project document as html, docx, pptx or print-pdf"
```

---

## Task 16: Register the Documents view

**Files:**
- Modify: `src/app/nav-config.ts`, `src/app/nav-config.test.ts`, `src/app/view-ai-scope.ts`, `src/app/help-content.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`

★★ **Slug collision.** `nav-config.ts:215-220` already maps the slug `"documents"` to the `knowledge` view — back-compat for `#documents/...` bookmarks from the v0.190 Documents→Knowledge rename. That check runs *before* the `allNavViews()` lookup, so a new `documents` view would be permanently shadowed by its own hash route.

**Resolution: remove the alias.** Its premise ("Documents became Knowledge") stops being true the moment a Documents view exists, and keeping both is the genuinely confusing option. Current version is 0.217.0, 27 minor releases after the rename, and nothing in `src`, `e2e` or `docs` emits `#documents` except the alias's own test and comment. Update the test to pin the new behaviour rather than deleting it.

- [ ] **Step 1: Update the alias test first (it should fail)**

In `src/app/nav-config.test.ts`, replace the block at lines 48-52:

```ts
  it("`documents` slug resolves to the Documents view (the v0.190 knowledge alias was removed)", () => {
    // The alias existed because the Documents view had been RENAMED to Knowledge.
    // A real Documents view now exists, so that redirect is no longer true; it
    // would also permanently shadow the new view's own hash route.
    expect(slugToView("documents")).toBe("documents");
    expect(parseHash("#documents/12")).toEqual({ view: "documents", itemId: 12 });
  });
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/nav-config.test.ts > /tmp/t16.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/t16.log
```

Expected: FAIL — receives `"knowledge"`.

- [ ] **Step 3: Add the view and remove the alias**

In `src/app/nav-config.ts`:

```ts
// 1. Add to the AppView union, after "knowledge":
  | "documents"

// 2. Add to the nav group holding knowledge (line ~91):
      { view: "documents" },

// 3. Add to LABEL_KEYS (line ~128):
  documents: "navDocuments",

// 4. DELETE these three lines from slugToView (215-220):
//    // Back-compat: the Documents view was renamed to Knowledge (v0.190). Old
//    // `#documents/...` bookmarks still resolve to the Knowledge view.
//    if (slug === "documents") return "knowledge";
```

★★★ `nav-config.ts` IS NOT THE ONLY TOTAL MAP OVER `AppView`. `NAV_ICON` in `nav-icons.tsx` is a
`Record<AppView, ComponentType<SVGProps<SVGSVGElement>>>` and MUST get an entry in this same step.
It is rendered as `NAV_ICON[view]`, so a missing key is `undefined` in element position — a
RENDER CRASH at runtime, not merely a tsc error, and it takes the whole shell down rather than
just the new view. Add the icon here, not later.

- [ ] **Step 4: Add the AI scope entry** (tsc will demand it)

In `src/app/view-ai-scope.ts`, beside the `knowledge` entry:

```ts
  documents: {
    purpose:
      "Documents holds project documents the user or the assistant authored — status reports, decks and charters — stored as structured blocks and downloadable as HTML, Word, PowerPoint or PDF.",
    reading:
      "There is no tool for reading or writing documents yet. Say so rather than describing a document you cannot see.",
  },
```

★ No `toolHints`, and **no `ASK_CLAUDE_PROMPTS` chips** — the chip↔capability rule (pinned by `ask-claude-prompts.test.ts`) requires every chipped view to have `toolHints` or a digest behind it. Chips land in S2 with the tools.

- [ ] **Step 5: Add the help entry**

`KNOWN_UNCOVERED` is `[]` (`help-content-gate.test.ts:29`), so a view with no help entry fails that gate. In `src/app/help-content.ts`, add to `HELP_ENTRIES` following the existing shape:

```ts
  { id: "view-documents", group: "features", titleKey: "helpViewDocumentsTitle", bodyKey: "helpViewDocumentsBody", relatedViews: ["documents"], relatedConcepts: [] },
```

Match the `group` value and required key set to whatever the sibling view entries use — read them first.

★★★ THE `documents*` i18n NAMESPACE IS ALREADY OCCUPIED BY THE LEGACY KNOWLEDGE VIEW. Measured:
56 keys already start with `documents` (`grep -cE "^  documents[A-Za-z]*:" src/app/i18n.ts`).
Two of them are exactly the names this task would reach for first, and BOTH already mean something
else — `documentsTitle` is `"Knowledge"` and `documentsEmpty` is `"No linked knowledge."`. Reusing
either does not fail any gate: the key exists in both dictionaries, so tsc and the parity check are
satisfied, and the Documents view simply renders the word "Knowledge" as its title. The names below
(`documentsNoneYet`, `documentsTitleLabel`) are the real ones. **grep any new `documents*` key
before adding it.**

- [ ] **Step 6: Add the EN strings**

In `src/app/i18n.ts`:

```ts
  navDocuments: "Documents",
  helpViewDocumentsTitle: "Documents",
  helpViewDocumentsBody: "Documents holds project documents built from structured blocks — headings, text, bullets, tables and live data sections that pull from the project. Create one, then download it as a web page, a Word document, a PowerPoint deck, or print it to PDF.",
  helpViewDocumentsPrimer: "A place to keep the reports and decks a project produces, alongside the data they report on.",
  documentsNew: "New document",
  documentsDownload: "Download",
  documentsRename: "Rename",
  documentsDuplicate: "Duplicate",
  documentsDelete: "Delete",
  documentsNoneYet: "No documents yet.",
  documentsBlockCount: "Blocks",
  documentsUpdated: "Updated",
  documentsTitleLabel: "Title",
```

- [ ] **Step 7: Add the DE strings via a node write**

★ The Edit tool corrupts umlauts and curls double quotes in `i18n.de.ts`, and the file is CRLF — an LF-anchored replace silently no-ops. Use:

```bash
node -e "
const fs = require('fs');
const p = 'src/app/i18n.de.ts';
let s = fs.readFileSync(p, 'utf8');
const anchor = '  navKnowledge: \"Wissen\",\r\n';
if (!s.includes(anchor)) { console.error('ANCHOR NOT FOUND'); process.exit(1); }
const add = [
  '  navDocuments: \"Dokumente\",',
  '  helpViewDocumentsTitle: \"Dokumente\",',
  '  helpViewDocumentsBody: \"Dokumente enthält Projektdokumente aus strukturierten Blöcken — Überschriften, Text, Aufzählungen, Tabellen und Datenabschnitte, die live aus dem Projekt lesen. Erstellen Sie eines und laden Sie es als Webseite, Word-Dokument oder PowerPoint-Präsentation herunter oder drucken Sie es als PDF.\",',
  '  helpViewDocumentsPrimer: \"Ein Ort für die Berichte und Präsentationen eines Projekts, direkt neben den Daten, über die sie berichten.\",',
  '  documentsNew: \"Neues Dokument\",',
  '  documentsDownload: \"Herunterladen\",',
  '  documentsRename: \"Umbenennen\",',
  '  documentsDuplicate: \"Duplizieren\",',
  '  documentsDelete: \"Löschen\",',
  '  documentsNoneYet: \"Noch keine Dokumente.\",',
  '  documentsBlockCount: \"Blöcke\",',
  '  documentsUpdated: \"Aktualisiert\",',
  '  documentsTitleLabel: \"Titel\",',
].join('\r\n') + '\r\n';
fs.writeFileSync(p, s.replace(anchor, anchor + add), 'utf8');
console.log('OK');
"
```

Then verify the umlauts survived as real bytes and no quote got curled:

```bash
node -e "
const s = require('fs').readFileSync('src/app/i18n.de.ts','utf8');
console.log('umlauts ok:', /Blöcke/.test(s) && /Löschen/.test(s) && /Überschriften/.test(s));
console.log('curly quotes:', /[“”]/.test(s));
"
```

Expected: `umlauts ok: true`, `curly quotes: false`. The `i18n-encoding` test bans ASCII substitutions like `Bloecke`.

- [ ] **Step 8: Run the gates**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/nav-config.test.ts src/app/help-content-gate.test.ts src/app/ask-claude-prompts.test.ts src/app/i18n > /tmp/t16.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t16.log
```

Expected: both `EXIT=0`. tsc enforces both the EN/DE key parity and the total `VIEW_AI_SCOPE` record.

- [ ] **Step 9: Commit**

```bash
git add src/app/nav-config.ts src/app/nav-config.test.ts src/app/view-ai-scope.ts src/app/help-content.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: register the Documents view and retire the legacy documents slug alias"
```

---

## Task 17: Documents panel components

**Files:**
- Create: `src/app/documents-list.tsx`, `src/app/document-preview.tsx`, `src/app/documents-toolbar.tsx`, `src/app/documents-panel.tsx`
- Test: `src/app/documents-panel.test.tsx`, `src/app/documents-toolbar.test.tsx`

Split up front per the gantt pattern. `documents-list`, `document-preview` and `documents-toolbar` are **pure presentational** — data and handlers as props, no context reads.

- [ ] **Step 1: Write the toolbar order test first**

Create `src/app/documents-toolbar.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DocumentsToolbar } from "./documents-toolbar";
import { expectButtonOrder } from "../test/toolbar-order";

const noop = () => {};

function setup() {
  return render(
    <DocumentsToolbar
      lang="en-US"
      onNew={noop}
      onPrint={noop}
      onResetColumns={noop}
      onResetSize={noop}
      canDownload={false}
      onDownload={noop}
    />,
  );
}

describe("DocumentsToolbar", () => {
  it("leads with the primary New document action", () => {
    setup();
    // ★ expectButtonOrder THROWS when a key matches zero or several buttons —
    // a hand-rolled findIndex would silently take the first and could pass
    // against the wrong control.
    expectButtonOrder(["documentsNew", "printHint"]);
  });

  it("ends with the contiguous Print / reset-columns / reset-size group", () => {
    setup();
    expectButtonOrder(["printHint", "colResetWidthsHint", "tableResetSizeHint"], { contiguous: true });
  });

  it("places Download before the trailing group, not inside it", () => {
    setup();
    expectButtonOrder(["documentsDownload", "printHint"]);
    // and the trailing group stays contiguous with Download outside it
    expectButtonOrder(["printHint", "colResetWidthsHint", "tableResetSizeHint"], { contiguous: true });
  });
});
```

Read `src/test/toolbar-order.ts` first for the real signature and how buttons are keyed — match it exactly:

```bash
sed -n '1,60p' src/test/toolbar-order.ts
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/documents-toolbar.test.tsx > /tmp/t17.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/t17.log
```

Expected: FAIL — module not found.

- [ ] **Step 3: Build the toolbar**

Create `src/app/documents-toolbar.tsx`. Order is load-bearing: **New document** (primary, leads) → Download → **Print · reset-columns · reset-size** (contiguous trailing group in an `ml-auto` wrapper). Use `ResetColWidthsIcon` for reset-columns and `ResetSizeIcon` for reset-size — they must be visually distinct or the two adjacent resets are indistinguishable.

Copy the exact structure from an existing toolbar (`raid-panel-toolbar.tsx` is a good model) rather than inventing markup.

- [ ] **Step 4: Build the list**

Create `src/app/documents-list.tsx`. Columns: Title · Blocks · Updated · actions, each header a `SortResizeTh<DocumentSortKey>`.

★ Per-row action buttons need **row-unique** accessible names — `` `${t(lang,"documentsDownload")} – ${doc.title}` `` — not N identical "Download". The axe gate can pass N identical labels when only one row is seeded, so this is a correctness requirement the gate will not catch.

★ If a column is not resizable, omit `onResize` entirely so no handle renders. Never pass a no-op — that draws a grip that looks draggable and does nothing.

- [ ] **Step 5: Build the preview**

Create `src/app/document-preview.tsx`. It renders `renderDocumentHtml(doc, ws, lang, "preview")` through `dangerouslySetInnerHTML`. The renderer already sanitizes at the sink; do not add a second sanitize pass here, and do not remove the one in the renderer.

- [ ] **Step 6: Build the orchestrator**

Create `src/app/documents-panel.tsx`. It holds list state, selection, and the create/rename/duplicate/delete handlers.

★★ Every handler is a **functional setter**:

```tsx
const handleCreate = () => {
  setDocuments((prev) => {
    const now = new Date().toISOString();
    return [...prev, { id: nextDocumentId(prev), title: t(lang, "documentsNew"), blocks: [], createdAt: now, updatedAt: now }];
  });
};
```

Never `setDocuments([...documents, newDoc])` — that drops a concurrent write in the same tick, which is the bulk-edit landmine this codebase has hit before.

★ Delete goes through the shared `TypeToConfirmDialog` if it can destroy more than one document; a single-document delete may use a plain confirm dialog. Do not use `window.confirm`.

- [ ] **Step 7: Write the panel test**

Create `src/app/documents-panel.test.tsx` covering: empty state renders the empty message; create appends one document with a fresh id; rename updates only the targeted document; delete removes only the targeted document; two creates in one tick both land (the functional-setter guard):

```tsx
  it("keeps both documents when two creates land in one tick", () => {
    // ★ A non-functional setter passes every single-create test and fails only
    // here. Seed the collision explicitly.
    let docs: ProjectDocument[] = [];
    const setDocuments = (fn: (prev: ProjectDocument[]) => ProjectDocument[]) => { docs = fn(docs); };
    // ★ The original draft stopped at this comment. Drive it concretely: call
    // the create handler twice against the SAME captured setter, with no
    // render in between, then assert on the accumulated array.
    createDocument(setDocuments);
    createDocument(setDocuments);
    expect(docs).toHaveLength(2);
    expect(new Set(docs.map((d) => d.id)).size).toBe(2);
    // A setter written as setDocuments([...documents, made]) — reading the
    // captured prop instead of prev — yields length 1 here and passes every
    // other test in this file.
  });
```

- [ ] **Step 8: Run tests and gates**

```bash
npx vitest run src/app/documents-panel.test.tsx src/app/documents-toolbar.test.tsx > /tmp/t17.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t17.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"
```

Expected: all `EXIT=0`.

- [ ] **Step 9: Commit**

```bash
git add src/app/documents-panel.tsx src/app/documents-list.tsx src/app/document-preview.tsx src/app/documents-toolbar.tsx src/app/documents-panel.test.tsx src/app/documents-toolbar.test.tsx
git commit -m "feat: Documents panel with list, preview and toolbar"
```

---

## Task 17b: Lift documents into React state (MISSING FROM THE ORIGINAL PLAN)

★★★ NO TASK CREATED THE `documents` STATE SLICE, and nothing downstream reveals the omission.
`Workspace.documents` persists on all six backends after Tasks 4-9, but persisting is not the same
as being IN the app: nothing lifted it into React state or collected it back for save. Task 18 as
originally written would have rendered a Documents view that worked all session and lost every
document on reload — the worst shape of bug, because every test in this plan still passes.

The edit map, by module:
- `workspace-context.tsx` — the slice has to be created, exposed on the context value, included in
  the workspace object the provider assembles, and reset with the others. Follow `knowledgeItems`,
  which is the closest sibling: same optionality, same additive persistence.
- `use-storage-backend.ts` — destructure the setter, hydrate on load, and add `documents` to EVERY
  place a workspace is collected for save. ★★ ONE OF THOSE IS A SAVE-EFFECT DEPENDENCY ARRAY.
  Omitting it there does not break a test and does not warn: the save simply never fires when
  documents are the ONLY thing that changed, so the data is silently lost on reload while every
  other edit saves normally.
- `task-manager.tsx` — a second hydrate site.

Do not take those as a checklist to tick blindly — grep `knowledgeItems` across the three files and
match every site it appears in, because that list is what this correction was derived from.

- [ ] **Step 1: Write the failing test** — a round trip through the provider: seed a workspace with
  one document, assert it reaches the context, mutate via the setter, assert the collected workspace
  carries the change. A test that only reads the context passes with the save wiring absent.
- [ ] **Step 2: Wire the sites above, then re-run.**

---

## Task 18: Wire the panel into the shell

**Files:**
- Modify: `src/app/workspace-section.tsx`, and whichever parent owns `documents` state

- [ ] **Step 1: Render the panel**

In `src/app/workspace-section.tsx`, beside the `knowledge` tabpanel (line ~910):

```tsx
        {activeTab === "documents" && (
          <div id="panel-documents" role="tabpanel" className={panelClass}>
            <DocumentsPanel
              lang={lang}
              documents={documents}
              setDocuments={setDocuments}
              workspace={workspace}
              isReadOnly={isPopout}
            />
          </div>
        )}
```

★ `isReadOnly` is a REAL prop on `DocumentsPanel` (`isReadOnly?: boolean`), added while this slice
was executing — it was assumed by this task before it existed. Passing `isPopout` is correct.

Thread `documents` / `setDocuments` through the props exactly as a sibling entity is threaded — read how `knowledgeItems` reaches its panel and follow that path. ★ Do **not** call `useWorkspace()` inside `ResourcesPanel`; that constraint is specific to that memoized panel and does not apply here, but thread props anyway for consistency.

- [ ] **Step 2: Verify in the browser**

```bash
PORT=3100 npm run dev
```

Open `http://localhost:3100/#documents`. Confirm: the view loads, the sample document appears, preview renders, and each of the four downloads produces a file that opens in its target application. **Open the .docx in Word and the .pptx in PowerPoint** — a malformed OOXML package passes every unit test and fails to open.

```bash
PORT=3100 npm run stop
```

- [ ] **Step 3: Commit**

```bash
git add src/app/workspace-section.tsx
git commit -m "feat: wire the Documents panel into the workspace shell"
```

---

## Task 18b: The download format picker (MISSING FROM THE ORIGINAL PLAN)

★★★ NO TASK OWNED A FORMAT PICKER, so three of the four renderers were unreachable from the UI.
Tasks 12-14 build HTML, DOCX and PPTX renderers and Task 15 routes all four formats including
print-to-PDF — then nothing in Tasks 16-18 gives the user a way to choose one. All four formats
were in the original requirement, so shipping S1 without this delivers one renderer and three
dead modules.

Decide deliberately and record the choice: a split button, a menu on Download, or four buttons.
Whatever it is, it needs a row-unique accessible name per option (the a11y gate scans this view),
keyboard operability, and `ToggleButton` if any option is a pressed state — never a hand-rolled
`aria-pressed`. `downloadDocument(doc, format, ws, lang)` already accepts all four; the picker only
has to supply `format`.

---

## Task 19: Accessibility gate

**Files:**
- Modify: `e2e/a11y.spec.ts`

- [ ] **Step 1: Add the view**

Add `"Documents"` to `A11Y_VIEWS` (line 18), taking it from 16 to 17 views. Add a `HASH_VIEW` entry (line 23) mapping `"Documents"` to `documents` if the sidebar entry may be collapsed at scan time.

- [ ] **Step 2: Run the scan on a fresh isolated server**

★★ Never the reused `:3000` dev server — its stale Tailwind produces phantom transparent-fill failures that a fresh port passes.

```bash
PORT=3100 npm run dev &
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Documents" > /tmp/axe.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/axe.log
PORT=3100 npm run stop
```

Expected: `EXIT=0`.

- [ ] **Step 3: Hand-check what axe cannot see**

Axe passes N identical accessible names when only one row is seeded. With the sample seeding exactly one document, the row-unique labels from Task 17 Step 4 are **not** covered by this green run. Verify by hand: create a second document in the running app and confirm the two Download buttons have distinct accessible names.

- [ ] **Step 4: Run the full e2e suite**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium > /tmp/axe-all.log 2>&1; echo "EXIT=$?"; grep -E "passed|failed" /tmp/axe-all.log
```

Expected: `EXIT=0`, 90 axe scans + 1 guard test = 91 tests.

- [ ] **Step 5: Commit**

```bash
git add e2e/a11y.spec.ts
git commit -m "test: add the Documents view to the axe accessibility gate"
```

---

## Task 20: Full gate run

- [ ] **Step 1: Run every blocking gate, serially**

★ Serially — two vitest processes on one runner is the machine-saturation condition behind the load-sensitive flakes.

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "TEST=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "SHUFFLE=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
npm run test:coverage > /tmp/cov.log 2>&1; echo "COV=$?"; grep -E "All files|Lines|Branch" /tmp/cov.log
npm run size:check > /tmp/size.log 2>&1; echo "SIZE=$?"
npm run dup:check > /tmp/dup.log 2>&1; echo "DUP=$?"
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "SYM=$?"
npm run build > /tmp/build.log 2>&1; echo "BUILD=$?"
```

Expected: every one `=0`.

★ `test:shuffle` is the only local reproduction of the blocking `unit-tests-shuffled` job, and this slice adds many test files — run it.

★ If coverage fails, the new `.ts` modules need more tests. Do **not** add them to `coverage.exclude`: they are logic, not glue. `use-view-digest.ts` is the precedent for testing rather than excluding.

★ If `unit-tests` exits 1 while every test passes, grep the log for `Errors  N error` — that is the setState-after-jsdom-teardown flake, not a real failure.

- [ ] **Step 2: Update the docs**

Add a `documents` row to the persistence discussion in `AGENTS.md` only if a *new* rule was learned. Otherwise add the subsystem detail to `docs/AGENTS/` — the doc set rule is one fact, one file.

★ `docs:symbols:check` only proves a backticked name exists; it never proves a claim is true. Anything written must be true when written.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "docs: record the document authoring subsystem"
```

---

## Definition of done

- [ ] A document survives a save/load round trip on all six backends: JSON, IndexedDB, Turso single, Turso tenant, CSV, Markdown
- [ ] `entity-persistence-registry.test.ts` covers `documents`
- [ ] Downloading produces a `.html`, `.docx` and `.pptx` that open correctly in a browser, Word and PowerPoint respectively; `.pdf` opens a print dialog and falls back to an `.html` download when the popup is blocked
- [ ] A `dataSection` block renders live project data in all three renderers
- [ ] Stored `<script>` in a paragraph never reaches the DOM
- [ ] `document-model.ts` contains no DOM reference, and the sample generator produces non-empty files
- [ ] The Documents view is in `A11Y_VIEWS` and the full axe run is green at 91 tests
- [ ] Row action buttons have row-unique accessible names, verified by hand with two documents present
- [ ] Toolbar order asserted with `expectButtonOrder(..., { contiguous: true })`
- [ ] Every gate in Task 20 exits 0

## Defects found during execution

Every item below was corrected IN PLACE above; this list is the index, not the fix. Written after
S1 shipped, from what actually broke while executing the plan. S2-S4 will be planned from the same
spec, so the PATTERNS matter more than the individual names.

**Wrong API names** — would not compile, or throw at runtime:

| # | Task | Was | Is |
|---|---|---|---|
| 1 | 6 | `saveStatements` | `workspaceToStatements` |
| 2 | 5 | `saveWorkspaceToIdb` / `loadWorkspaceFromIdb` | class `BrowserBackend`, `.save()` / `.load()` |
| 3 | 13, 14 | `readZipEntries(...).map(e => e.path)` | resolves to `Map<string, Uint8Array>`; use `[...m.keys()]` |
| 4 | 14 | `pptxTextBox({x, y, cx, cy, text, sizePt})` | `{id, name, lang, xEmu, yEmu, cxEmu, cyEmu, paragraphs}`, size in HUNDREDTHS of a point |
| 5 | 3, 12 | `sanitizeTemplateHtml` from `./note-log` | from `./sanitize-html` |
| 6 | 17 | `expectButtonOrder(["New document", …])` | takes `TranslationKey`s: `documentsNew`, `documentsDownload`, `printHint`, `colResetWidthsHint`, `tableResetSizeHint` |
| 7 | 16 | help entry `group: "views"` + `primerKey` | `group: "features"`, NO `primerKey` — two independent errors: `"views"` is not a `HelpGroup`, and `help-content.test.ts` rejects a `primerKey` outside `concepts` |
| 8 | 16 | `documentsEmpty`, `documentsTitle` | `documentsNoneYet`, `documentsTitleLabel` — the originals are legacy KNOWLEDGE strings and reusing them fails no gate; the view just renders "Knowledge" |
| 9 | 16 | `NAV_ICON` not mentioned | a THIRD total `Record<AppView, …>`; a missing key is a render crash, not a tsc error |

**Missing work** — the more dangerous category, because nothing failed:

| # | Gap |
|---|---|
| 10 | **No task created the `documents` React state slice.** Persisted on six backends, never lifted into state or collected for save. Task 18 would have shipped a view that loses every document on reload with the whole suite green. Now Task 17b. |
| 11 | **No task owned a download format picker**, leaving three of four renderers unreachable from the UI despite all four being the requirement. Now Task 18b. |
| 12 | Task 9 Step 1 and Task 17 Step 7 were pointers ("follow whatever shape that file uses"), not instructions. Both now specify what the test must actually do. |

**Wrong claim about the gates:**

| # | Claim |
|---|---|
| 13 | `golden-workspace.test` pins CSV and MARKDOWN bytes ONLY. There is no golden JSON fixture and nothing pins IndexedDB or Turso — proved by mutation: an unconditional emit left it green. Any task touching those three paths must treat its OWN tests as the only net. |

**The pattern worth carrying into S2-S4.** Nine of thirteen are a name or a signature the plan
asserted without opening the file, and the two worst are things the plan never thought about at
all. The plan was reliable about INTENT and unreliable about INTERFACE. Two habits follow:
grep every symbol a task names before writing code against it, and when a task says "wire X into
Y", ask what else has to change for X to survive a reload — persistence, state and collection are
three separate jobs and this plan only ever named the first.

★ One caution about this list itself: two items on the brief that produced it turned out to be
wrong when checked against the file (the plan never claimed golden covers JSON/IDB/Turso — that is
an ADDITION, not a correction; and the two "placeholder" steps were under-specified rather than
empty). A defect list is prose and rots exactly like the plan it describes. Re-verify before acting
on any line of it.

## Explicitly out of scope for S1

AI tools of any kind; version history; any block editing; entity attachment; editing uploaded foreign files; bold/italic fidelity in `.docx`/`.pptx`; `.xlsx` output.
