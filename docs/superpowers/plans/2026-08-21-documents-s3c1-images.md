# S3c-1 — Document images, end to end (Turso-gated) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user on a Turso backend can upload an image, see it in a library with usage counts, insert it into a document paragraph, and see it render in the preview and in HTML/PDF export.

**Architecture:** Asset *metadata* is a normal workspace slice carried by one new `ENTITY_SPECS` row (which buys the CSV, Turso single-tenant and Turso multi-tenant paths); Markdown, JSON and IndexedDB are written by hand. Asset *bytes* live in `document_asset_data`, a side table deliberately outside `TABLE_NAMES`, reached by a `*-schema.ts` / `*-store.ts` pair that mirrors `comm-templates-*`. The upload pipeline is pure and i18n-free. Writes go metadata-first, so a failed upload degrades to the already-designed dangling case instead of creating an invisible orphan.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Vitest + Testing Library, Turso libSQL over `/v2/pipeline`, WebCrypto (SHA-256), canvas (downscale).

**Spec:** `docs/superpowers/specs/2026-08-21-documents-s3c1-images-design.md`

**Branch:** `feat/documents-s3c1-images`, already created off `origin/main`; the spec is committed as `688a2cb8`.

---

## Read this before Task 1

Facts verified against the working tree at `688a2cb8`. Do not re-derive them; do not assume the opposite.

- **`<img data-asset-id>` is ALREADY allowed.** `sanitize-html.ts` has
  `DOCUMENT_ALLOWED_TAGS = [...RICH_ALLOWED_TAGS, "img"]` and
  `DOCUMENT_ALLOWED_ATTR = [...ALLOWED_ATTR, "data-asset-id", "alt"]`, and three test files
  already pin it. **No task in this plan edits a sanitizer.** If you find yourself widening
  one, stop — you have taken a wrong turn.
- **`documents-panel.tsx` is at 792 lines against the 800 cap.** The gate counts
  `readFileSync().split("\n").length`, which is `wc -l` **+ 1**. Read the real number with:
  `node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"`
  You have **8 lines**. Task 17 budgets them.
- **`document-block-editors.tsx` is at 800 — zero headroom.** Nothing in this plan adds a
  line to it.
- **`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts in it.** Every DE edit in this
  plan uses a node utf8 write with `\r\n` anchors, then greps to verify.
- **`npx tsc --noEmit` after ANY test edit.** `next build` does not typecheck tests and
  vitest never typechecks.
- **Lint is `--max-warnings=0` in CI.** An unused import, or an `obj.member` expression in a
  hook dep array, is fatal. `react-hooks/set-state-in-effect` is **banned** — Task 19 is
  written imperatively for exactly this reason.
- **Never read a gate's exit code through a pipe.** `npm run test:run | tail` reports
  `tail`'s status. Redirect, echo `$?` unpiped, then grep the file.
- **`npm run lint` is bare `eslint` with no `--max-warnings` flag and exits 0 on warnings.**
  The real gate is `npx eslint --max-warnings=0 src/app`.

## File structure

**Create**

| File | Responsibility |
|---|---|
| `src/app/document-asset.ts` | the `DocumentAsset` type + `sanitizeDocumentAsset`. Pure, i18n-free, DOM-free |
| `src/app/document-asset.test.ts` | its tests |
| `src/app/document-assets-schema.ts` | side-table DDL + statement builders + row decode. Pure |
| `src/app/document-assets-schema.test.ts` | its tests |
| `src/app/document-assets-store.ts` | async CRUD over `runTursoPipeline`, mirroring `comm-templates-store.ts` |
| `src/app/document-assets-store.test.ts` | its tests |
| `src/app/document-asset-upload.ts` | format gate · raw ceiling · header dimension guard · downscale · stored cap · SHA-256 hash. Pure except the canvas/WebCrypto calls it isolates |
| `src/app/document-asset-upload.test.ts` | its tests |
| `src/app/asset-library.tsx` | the one library component, mounted twice |
| `src/app/asset-library.test.tsx` | its tests, including the ≥2-row unique-name test |
| `src/app/asset-library-modal.tsx` | the `Modal` wrapper + the insert trigger the editor uses |
| `src/app/asset-library-modal.test.tsx` | its tests |
| `src/app/document-asset-images.ts` | imperative blob-URL attach/revoke for a rendered preview subtree. No React state |
| `src/app/document-asset-images.test.ts` | its tests |

**Modify**

| File | Change |
|---|---|
| `src/app/csv-codecs-core.ts` | `DOCUMENT_ASSETS_CSV_COLUMNS`, `documentAssetFieldToString`, `buildDocumentAssetFromObj`, `documentAssetsToCsv` |
| `src/app/csv-codecs-sections.ts` | `CSV_SECTION_DOCUMENT_ASSETS` |
| `src/app/csv-codecs-config.ts` | section push |
| `src/app/csv-codecs-decode.ts` | section recognition + mode |
| `src/app/markdown-columns.ts` | `DOCUMENT_ASSETS_MD_COLUMNS` |
| `src/app/markdown-codecs-core.ts` | `documentAssetsToMarkdown` + emit |
| `src/app/markdown-codecs-decode.ts` | section split + aliases + `markdownToDocumentAssets` |
| `src/app/turso-schema.ts` | one `ENTITY_SPECS` row |
| `src/app/workspace.ts` | `documentAssets?` field, JSON write, JSON read, empty/count helpers |
| `src/app/browser-backend.ts` | `KV_DOCUMENT_ASSETS_KEY` load + save |
| `src/app/document-preview.tsx` | attach blob URLs to the rendered subtree |
| `src/app/doc-render-docx.ts`, `src/app/doc-render-pptx.ts` | visible placeholder for `<img data-asset-id>` |
| `src/app/documents-panel.tsx` | mount `AssetLibrary` inline (budgeted: ≤8 lines) |
| `src/app/workspace-section.tsx` | thread `tursoConfig` to the documents panel |
| `src/app/workspace-section-types.ts` | the prop |
| `src/app/rich-text-editor.tsx` | `handlePaste` / `handleDrop` hooks in the existing `editorProps` |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | new keys, EN + DE |
| `src/app/entity-persistence-registry.test.ts` | six-path proof |
| `src/app/turso-schema.test.ts` | `document_asset_data` NOT in `TABLE_NAMES` |
| `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md` | release |

---

# Phase 1 — the model and the six write paths

Nothing in this phase is user-visible. It ends with a metadata slice that round-trips on every backend.

---

### Task 1: `DocumentAsset` — the type and its sanitizer

**Files:**
- Create: `src/app/document-asset.ts`
- Test: `src/app/document-asset.test.ts`

Mirrors `calendar-event.ts`, which is where `sanitizeCalendarEvent` lives — entity sanitizers live in the entity's own module, **not** in the `sanitize.ts` barrel.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/document-asset.test.ts
import { describe, expect, it } from "vitest";
import { sanitizeDocumentAsset, type DocumentAsset } from "./document-asset";

const valid: DocumentAsset = {
  id: "a1",
  name: "chart.png",
  mime: "image/png",
  size: 1024,
  width: 800,
  height: 600,
  hash: "abc123",
  createdAt: "2026-08-21T10:00:00.000Z",
};

describe("sanitizeDocumentAsset", () => {
  it("passes a valid asset through unchanged", () => {
    expect(sanitizeDocumentAsset({ ...valid })).toEqual(valid);
  });

  it("returns null when id is missing or blank", () => {
    expect(sanitizeDocumentAsset({ ...valid, id: "" })).toBeNull();
    expect(sanitizeDocumentAsset({ ...valid, id: undefined })).toBeNull();
  });

  it("returns null for a non-object", () => {
    expect(sanitizeDocumentAsset(null)).toBeNull();
    expect(sanitizeDocumentAsset("nope")).toBeNull();
  });

  it("coerces numeric fields from strings, as the CSV decode path supplies them", () => {
    const out = sanitizeDocumentAsset({ ...valid, size: "1024", width: "800", height: "600" });
    expect(out).toEqual(valid);
  });

  // ★ The store is mime-GENERIC on purpose: format policy lives in the upload
  //   pipeline (Task 11), never here. A PDF row must survive this sanitizer so a
  //   later attachment slice needs no migration.
  it("keeps a non-image mime and omits dimensions", () => {
    const out = sanitizeDocumentAsset({
      id: "p1", name: "spec.pdf", mime: "application/pdf",
      size: 2048, hash: "def456", createdAt: "2026-08-21T10:00:00.000Z",
    });
    expect(out?.mime).toBe("application/pdf");
    expect(out?.width).toBeUndefined();
    expect(out?.height).toBeUndefined();
  });

  it("drops a dimension that is not a finite positive number", () => {
    expect(sanitizeDocumentAsset({ ...valid, width: "abc" })?.width).toBeUndefined();
    expect(sanitizeDocumentAsset({ ...valid, height: -5 })?.height).toBeUndefined();
    expect(sanitizeDocumentAsset({ ...valid, width: Infinity })?.width).toBeUndefined();
  });

  it("floors size at 0 rather than dropping the row", () => {
    expect(sanitizeDocumentAsset({ ...valid, size: -1 })?.size).toBe(0);
    expect(sanitizeDocumentAsset({ ...valid, size: "junk" })?.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/document-asset.test.ts --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t1.log
```

Expected: FAIL — `Failed to resolve import "./document-asset"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/document-asset.ts
//
// The DocumentAsset METADATA record. Bytes live in the `document_asset_data`
// side table (document-assets-schema.ts) and never in the workspace.
//
// ★★ MIME-GENERIC BY CONTRACT. This module admits any mime and treats width and
// height as optional, so the same table, store, dedup and delete serve a later
// attachment slice with no migration. FORMAT POLICY IS THE UPLOAD PIPELINE'S
// JOB (document-asset-upload.ts) — narrowing it here would move a user-facing
// rule into the storage layer, where a stored row could no longer be read back
// after the policy changed.

export interface DocumentAsset {
  /** Referenced from block HTML as `<img data-asset-id="…">`. */
  id: string;
  /** User-editable display name. Rename edits this and nothing else — every
   *  reference is by id and stays correct. */
  name: string;
  mime: string;
  /** Stored byte length, POST-downscale. */
  size: number;
  /** Post-downscale pixel dimensions. Absent for non-raster assets. The OOXML
   *  writers size in EMU from these and cannot backfill without decoding. */
  width?: number;
  height?: number;
  /** SHA-256 over the stored bytes. Drives dedup and refcount-aware delete. */
  hash: string;
  createdAt: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Finite positive number, or undefined. Accepts the strings the CSV and
 *  Markdown decode paths hand over. */
function dim(v: unknown): number | undefined {
  if (v === "" || v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Byte count. Floors at 0 rather than dropping the row: a bad size is a
 *  cosmetic defect in a disclosure total, not a reason to lose the asset. */
function bytes(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function sanitizeDocumentAsset(input: unknown): DocumentAsset | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const id = str(o.id).trim();
  if (!id) return null;
  const width = dim(o.width);
  const height = dim(o.height);
  return {
    id,
    name: str(o.name),
    mime: str(o.mime),
    size: bytes(o.size),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    hash: str(o.hash),
    createdAt: str(o.createdAt),
  };
}
```

- [ ] **Step 4: Run the tests and typecheck**

```bash
npx vitest run src/app/document-asset.test.ts --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t1.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

★ `toEqual` treats `{k: undefined}` and `{}` as equal, so the "omits dimensions" test would pass even if the spread guard were dropped. The `?.width).toBeUndefined()` assertions in "drops a dimension" are what actually pin the guard — keep both.

- [ ] **Step 5: Commit**

```bash
git add src/app/document-asset.ts src/app/document-asset.test.ts
git commit -m "feat: add the DocumentAsset metadata record and its sanitizer"
```

---

### Task 2: CSV codec for `documentAssets`

**Files:**
- Modify: `src/app/csv-codecs-core.ts`
- Modify: `src/app/csv-codecs-sections.ts`
- Modify: `src/app/csv-codecs-config.ts`
- Modify: `src/app/csv-codecs-decode.ts`
- Test: `src/app/csv-codecs.test.ts`

Mirrors `calendarEvents` exactly: columns array, a `fieldToString`, a `buildFromObj`, a `toCsv`, a section constant, a push in config, a mode in decode.

- [ ] **Step 1: Write the failing test**

Append to `src/app/csv-codecs.test.ts`:

```ts
describe("documentAssets CSV", () => {
  const asset = {
    id: "a1", name: "chart.png", mime: "image/png", size: 1024,
    width: 800, height: 600, hash: "abc123", createdAt: "2026-08-21T10:00:00.000Z",
  };

  it("round-trips an asset through the CSV codec", () => {
    const csv = documentAssetsToCsv([asset]);
    const [, row] = csv.split("\r\n");
    const cells = row.split(",");
    const obj: Record<string, string> = {};
    DOCUMENT_ASSETS_CSV_COLUMNS.forEach((c, i) => { obj[c] = cells[i]; });
    expect(buildDocumentAssetFromObj(obj)).toEqual(asset);
  });

  it("emits CRLF line endings, matching every other CSV section", () => {
    expect(documentAssetsToCsv([asset])).toContain("\r\n");
  });

  it("leaves an absent dimension as an empty cell, not the string 'undefined'", () => {
    const pdf = { ...asset, mime: "application/pdf", width: undefined, height: undefined };
    const [, row] = documentAssetsToCsv([pdf]).split("\r\n");
    expect(row).not.toContain("undefined");
  });
});
```

Add to that file's existing import block:

```ts
import {
  DOCUMENT_ASSETS_CSV_COLUMNS, documentAssetsToCsv, buildDocumentAssetFromObj,
} from "./csv-codecs-core";
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/csv-codecs.test.ts -t "documentAssets CSV" --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t2.log
```

Expected: FAIL — `documentAssetsToCsv is not exported`.

- [ ] **Step 3: Add the codec**

In `src/app/csv-codecs-core.ts`, beside `EVENTS_CSV_COLUMNS`:

```ts
export const DOCUMENT_ASSETS_CSV_COLUMNS: Array<keyof DocumentAsset> = [
  "id", "name", "mime", "size", "width", "height", "hash", "createdAt",
];
```

Beside `calendarEventFieldToString`:

```ts
// The default branch already renders `undefined` as "" — spelled out here only
// because an absent width/height is the COMMON case for a non-raster asset, and
// a codec that emitted the string "undefined" would round-trip it back as a
// dimension of NaN.
export function documentAssetFieldToString(a: DocumentAsset, col: string): string {
  const v = (a as unknown as Record<string, unknown>)[col];
  return v == null ? "" : String(v);
}

export function buildDocumentAssetFromObj(obj: Record<string, string>): DocumentAsset | null {
  return sanitizeDocumentAsset(obj);
}

export function documentAssetsToCsv(assets: readonly DocumentAsset[], neutralize = false): string {
  const lines: string[] = [DOCUMENT_ASSETS_CSV_COLUMNS.join(",")];
  for (const a of assets) {
    lines.push(
      DOCUMENT_ASSETS_CSV_COLUMNS.map((c) =>
        csvCellEscape(documentAssetFieldToString(a, c), neutralize),
      ).join(","),
    );
  }
  return lines.join("\r\n");
}
```

Add to that file's imports:

```ts
import { sanitizeDocumentAsset, type DocumentAsset } from "./document-asset";
```

- [ ] **Step 4: Add the section constant**

In `src/app/csv-codecs-sections.ts`, beside `CSV_SECTION_CALENDAR_EVENTS`:

```ts
export const CSV_SECTION_DOCUMENT_ASSETS = "# DOCUMENT ASSETS";
```

- [ ] **Step 5: Wire the encode side**

In `src/app/csv-codecs-config.ts`, add `CSV_SECTION_DOCUMENT_ASSETS` and `documentAssetsToCsv` to the two import blocks, then beside the `calendarEvents` push:

```ts
if (enabled("documentAssets") && ws.documentAssets?.length)
  csvPush(CSV_SECTION_DOCUMENT_ASSETS, documentAssetsToCsv(ws.documentAssets, neutralize));
```

- [ ] **Step 6: Wire the decode side**

In `src/app/csv-codecs-decode.ts`, add `CSV_SECTION_DOCUMENT_ASSETS` to the imports, then beside the `calendarEvents` line:

```ts
if (trimmed.startsWith(CSV_SECTION_DOCUMENT_ASSETS)) { mode = "documentAssets"; continue; }
```

and add a `documentAssets` branch to the same accumulate/assign structure `calendarEvents` uses, decoding rows through `buildDocumentAssetFromObj`. Assign only when the list is non-empty, so an asset-less workspace stays free of the key.

- [ ] **Step 7: Run the tests and typecheck**

```bash
npx vitest run src/app/csv-codecs.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t2.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`. `tsc` will flag `ws.documentAssets` as unknown until Task 5 — if so, do Task 5's field declaration first, then return here.

- [ ] **Step 8: Commit**

```bash
git add src/app/csv-codecs-core.ts src/app/csv-codecs-sections.ts src/app/csv-codecs-config.ts src/app/csv-codecs-decode.ts src/app/csv-codecs.test.ts
git commit -m "feat: add the documentAssets CSV codec and section"
```

---

### Task 3: the `ENTITY_SPECS` row — buys Turso single AND tenant

**Files:**
- Modify: `src/app/turso-schema.ts`
- Test: `src/app/turso-schema.test.ts`

`turso-tenant-schema.ts` builds its DDL and SELECTs by iterating `ENTITY_SPECS`, so this one row covers **both** Turso layouts. That is two of the six paths for one line.

- [ ] **Step 1: Write the failing test**

Append to `src/app/turso-schema.test.ts`:

```ts
describe("documentAssets entity spec", () => {
  it("is registered in ENTITY_SPECS", () => {
    const spec = ENTITY_SPECS.find((s) => s.table === "document_assets");
    expect(spec).toBeDefined();
    expect(spec?.wsKey).toBe("documentAssets");
  });

  it("puts document_assets IN TABLE_NAMES (it is workspace data)", () => {
    expect(TABLE_NAMES).toContain("document_assets");
  });

  // ★★ The BYTES table is the opposite — Task 10 pins that separately.
  it("keeps document_asset_data OUT of TABLE_NAMES", () => {
    expect(TABLE_NAMES).not.toContain("document_asset_data");
  });

  it("derives DDL for the metadata table", () => {
    expect(DDL.some((s) => s.includes("CREATE TABLE IF NOT EXISTS document_assets"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/turso-schema.test.ts -t "documentAssets entity spec" --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t3.log
```

Expected: FAIL — `expected undefined to be defined`.

- [ ] **Step 3: Add the spec row**

In `src/app/turso-schema.ts`, after the `CalendarEvent` row:

```ts
spec<DocumentAsset>({ table: "document_assets", wsKey: "documentAssets", columns: DOCUMENT_ASSETS_CSV_COLUMNS, get: (w) => w.documentAssets ?? [], toRow: documentAssetFieldToString as unknown as (e: DocumentAsset, col: string) => string, fromObj: buildDocumentAssetFromObj }),
```

Add to the imports:

```ts
import { DOCUMENT_ASSETS_CSV_COLUMNS, documentAssetFieldToString, buildDocumentAssetFromObj } from "./csv-codecs";
import type { DocumentAsset } from "./document-asset";
```

★ Import through the `./csv-codecs` **barrel**, matching every other `fieldToString` this file takes.

- [ ] **Step 4: Run the tests and typecheck**

```bash
npx vitest run src/app/turso-schema.test.ts src/app/turso-tenant-schema.test.ts --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t3.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/turso-schema.ts src/app/turso-schema.test.ts
git commit -m "feat: register documentAssets in ENTITY_SPECS, covering both Turso layouts"
```

---

### Task 4: Markdown codec

**Files:**
- Modify: `src/app/markdown-columns.ts`
- Modify: `src/app/markdown-codecs-core.ts`
- Modify: `src/app/markdown-codecs-decode.ts`
- Test: `src/app/markdown-codecs.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/markdown-codecs.test.ts`:

```ts
describe("documentAssets Markdown", () => {
  const asset = {
    id: "a1", name: "chart.png", mime: "image/png", size: 1024,
    width: 800, height: 600, hash: "abc123", createdAt: "2026-08-21T10:00:00.000Z",
  };

  it("round-trips an asset through the Markdown codec", () => {
    const md = workspaceToMarkdown({ ...emptyWorkspace(), documentAssets: [asset] });
    expect(md).toContain("## Document Assets");
    const back = markdownToWorkspace(md);
    expect(back.documentAssets?.[0]).toEqual(asset);
  });

  it("emits no Document Assets section when there are none", () => {
    expect(workspaceToMarkdown(emptyWorkspace())).not.toContain("## Document Assets");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/markdown-codecs.test.ts -t "documentAssets Markdown" --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t4.log
```

Expected: FAIL — the section string is absent.

- [ ] **Step 3: Add the column metadata**

In `src/app/markdown-columns.ts`, beside `EVENTS_MD_COLUMNS`:

```ts
export const DOCUMENT_ASSETS_MD_COLUMNS: Array<{ key: keyof DocumentAsset; label: string }> = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "mime", label: "Type" },
  { key: "size", label: "Size" },
  { key: "width", label: "Width" },
  { key: "height", label: "Height" },
  { key: "hash", label: "Hash" },
  { key: "createdAt", label: "Created" },
];
```

Add `DocumentAsset` to that file's type import block.

- [ ] **Step 4: Add the encoder**

In `src/app/markdown-codecs-core.ts`, beside `calendarEventsToMarkdown`:

```ts
// Reuses documentAssetFieldToString (csv-codecs-core.ts, via the ./csv-codecs
// barrel) rather than re-deriving cell values, so CSV and Markdown cannot drift
// on what a column contains.
function documentAssetsToMarkdown(assets: readonly DocumentAsset[]): string {
  const header = `| ${DOCUMENT_ASSETS_MD_COLUMNS.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${DOCUMENT_ASSETS_MD_COLUMNS.map(() => "---").join(" | ")} |`;
  const lines = ["## Document Assets", "", header, sep];
  for (const a of assets) {
    const row = DOCUMENT_ASSETS_MD_COLUMNS.map((c) =>
      mdEscape(documentAssetFieldToString(a, c.key)),
    ).join(" | ");
    lines.push(`| ${row} |`);
  }
  return lines.join("\n") + "\n";
}
```

and beside the `calendarEvents` emit:

```ts
if (enabled("documentAssets") && ws.documentAssets && ws.documentAssets.length > 0)
  mdParts.push(documentAssetsToMarkdown(ws.documentAssets));
```

- [ ] **Step 5: Add the decoder**

In `src/app/markdown-codecs-decode.ts`: add a `documentAssetsMd: string` field to the section-accumulator type, a `documentAssetsLines` array, the split rule

```ts
if (/^##\s+Document\s+Assets\b/i.test(trimmed)) { target = documentAssetsLines; continue; }
```

the join into the accumulator, and beside `markdownToCalendarEvents`:

```ts
const DOCUMENT_ASSETS_MD_ALIASES: Record<string, string> = Object.fromEntries(
  DOCUMENT_ASSETS_MD_COLUMNS.map((c) => [c.label.toLowerCase().replace(/\s+/g, ""), c.key as string]),
);

function markdownToDocumentAssets(md: string, diag?: ImportDiag): DocumentAsset[] {
  return decodeMdTable(md, DOCUMENT_ASSETS_MD_ALIASES, buildDocumentAssetFromObj, diag);
}
```

and in the workspace assembly:

```ts
documentAssets: s.documentAssetsMd.trim() ? markdownToDocumentAssets(s.documentAssetsMd, diag) : undefined,
```

★ Derive the alias map from `DOCUMENT_ASSETS_MD_COLUMNS` exactly as `EVENTS_MD_ALIASES` does. A hand-written alias map is how the encoder's labels and the decoder's lookups drift apart.

- [ ] **Step 6: Run the tests and typecheck**

```bash
npx vitest run src/app/markdown-codecs.test.ts --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t4.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add src/app/markdown-columns.ts src/app/markdown-codecs-core.ts src/app/markdown-codecs-decode.ts src/app/markdown-codecs.test.ts
git commit -m "feat: add the documentAssets Markdown codec"
```

---

### Task 5: JSON path — the field, the write, the read

**Files:**
- Modify: `src/app/workspace.ts`
- Test: `src/app/workspace.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/workspace.test.ts`:

```ts
describe("documentAssets JSON round-trip", () => {
  const asset = {
    id: "a1", name: "chart.png", mime: "image/png", size: 1024,
    width: 800, height: 600, hash: "abc123", createdAt: "2026-08-21T10:00:00.000Z",
  };

  it("round-trips documentAssets through JSON", () => {
    const json = workspaceToJson({ ...emptyWorkspace(), documentAssets: [asset] });
    expect(jsonToWorkspace(json).documentAssets?.[0]).toEqual(asset);
  });

  it("omits the key entirely when there are no assets (byte-stable)", () => {
    expect(workspaceToJson(emptyWorkspace())).not.toContain("documentAssets");
  });

  it("drops garbage rows individually rather than failing the load", () => {
    const json = JSON.stringify({ documentAssets: [asset, { name: "no id" }, null] });
    expect(jsonToWorkspace(json).documentAssets).toHaveLength(1);
  });

  // ★★ isWorkspaceEmpty feeds the LOAD guard that refuses an incoming empty
  //    workspace. Metadata alone must NOT make a workspace look non-empty —
  //    otherwise a workspace holding only orphaned metadata defeats the guard.
  it("does not count toward isWorkspaceEmpty", () => {
    expect(isWorkspaceEmpty({ ...emptyWorkspace(), documentAssets: [asset] })).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/workspace.test.ts -t "documentAssets JSON round-trip" --reporter=dot > /tmp/t5.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t5.log
```

Expected: FAIL — `documentAssets` is not a known property.

- [ ] **Step 3: Declare the field**

In `src/app/workspace.ts`, after `calendarEvents`:

```ts
  /** Document asset METADATA. Bytes live in the `document_asset_data` side
   *  table and never travel here — a JSON backup re-imported into a different
   *  Turso database therefore yields the dangling case, rendered as such.
   *  Optional & additive: undefined/empty serializes to nothing (byte-stable).
   *  Sanitized by sanitizeDocumentAsset. */
  documentAssets?: readonly DocumentAsset[];
```

Add `import { sanitizeDocumentAsset, type DocumentAsset } from "./document-asset";`.

- [ ] **Step 4: Add the write**

Beside the `calendarEvents` spread in `workspaceToJson`:

```ts
      // Additive: only present when assets exist, so asset-less files stay free
      // of a `documentAssets` key.
      ...(ws.documentAssets && ws.documentAssets.length
        ? { documentAssets: ws.documentAssets }
        : {}),
```

- [ ] **Step 5: Add the read**

Beside the `calendarEvents` block in the parse path:

```ts
    // Additive: garbage rows are dropped individually (sanitizeDocumentAsset
    // never throws), and an all-garbage/empty list stays off the key rather
    // than emitting [].
    if (p.documentAssets !== undefined) {
      const assets = ((p.documentAssets as unknown[]) ?? [])
        .map((a) => sanitizeDocumentAsset(a))
        .filter((a): a is DocumentAsset => a !== null);
      if (assets.length) raw.documentAssets = assets;
    }
```

- [ ] **Step 6: Leave the empty/count helpers ALONE, deliberately**

Do **not** add `documentAssets` to `isWorkspaceEmpty`, to the populated-collection counter, or to the total-record counter.

Metadata without a document referencing it is not user content — it is a library. Counting it would let a workspace holding nothing but orphaned metadata pass the load guard that exists to refuse an accidental empty overwrite, and would make the Layer-B mass-deletion invariant fire on a library cleanup. `documents` **is** counted there and this is the deliberate inversion; the test in Step 1 pins it.

- [ ] **Step 7: Run the tests and typecheck**

```bash
npx vitest run src/app/workspace.test.ts --reporter=dot > /tmp/t5.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t5.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 8: Commit**

```bash
git add src/app/workspace.ts src/app/workspace.test.ts
git commit -m "feat: carry documentAssets metadata through the JSON path"
```

---

### Task 6: IndexedDB path

**Files:**
- Modify: `src/app/browser-backend.ts`
- Test: `src/app/browser-backend.test.ts`

`browser-backend.ts` keeps optional list slices in the kv store under a string key — `KV_CALENDAR_EVENTS_KEY`, `KV_DOCUMENTS_KEY`. This is the sixth path.

- [ ] **Step 1: Write the failing test**

Append to `src/app/browser-backend.test.ts`:

```ts
describe("documentAssets over IndexedDB", () => {
  const asset = {
    id: "a1", name: "chart.png", mime: "image/png", size: 1024,
    width: 800, height: 600, hash: "abc123", createdAt: "2026-08-21T10:00:00.000Z",
  };

  it("round-trips documentAssets through save and load", async () => {
    const backend = new BrowserBackend();
    await backend.save({ ...emptyWorkspace(), documentAssets: [asset] });
    const back = await backend.load();
    expect(back.documentAssets?.[0]).toEqual(asset);
  });

  it("leaves the key undefined when there are no assets", async () => {
    const backend = new BrowserBackend();
    await backend.save(emptyWorkspace());
    expect((await backend.load()).documentAssets).toBeUndefined();
  });

  it("drops garbage rows on load rather than failing", async () => {
    await idbSet("documentAssets", [asset, { name: "no id" }]);
    expect((await new BrowserBackend().load()).documentAssets).toHaveLength(1);
  });
});
```

★ Match the file's existing setup — it uses `fake-indexeddb` via `vitest.setup.ts`, and each test needs the same fresh-database handling the neighbouring tests use. Copy that harness rather than inventing one.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/browser-backend.test.ts -t "documentAssets over IndexedDB" --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t6.log
```

Expected: FAIL — `back.documentAssets` is undefined after a save that set it.

- [ ] **Step 3: Add the key and the load**

In `src/app/browser-backend.ts`, beside `KV_DOCUMENTS_KEY`:

```ts
const KV_DOCUMENT_ASSETS_KEY = "documentAssets";
```

In the load path, beside the `documents` declaration and its two-pass sanitize:

```ts
    let documentAssets: Workspace["documentAssets"] | undefined;
```

```ts
      // Optional list: junk/empty assets sanitize to [] → keep undefined.
      const rawAssets = await idbGet<unknown[]>(KV_DOCUMENT_ASSETS_KEY);
      if (Array.isArray(rawAssets)) {
        const list = rawAssets
          .map((a) => sanitizeDocumentAsset(a))
          .filter((a): a is DocumentAsset => a !== null);
        documentAssets = list.length ? list : undefined;
      }
```

and beside `if (documents) raw.documents = documents;`:

```ts
    if (documentAssets) raw.documentAssets = documentAssets;
```

- [ ] **Step 4: Add the save**

Beside the `documents` save entry:

```ts
      ws.documentAssets && ws.documentAssets.length
        ? idbSet(KV_DOCUMENT_ASSETS_KEY, ws.documentAssets)
        : idbDelete(KV_DOCUMENT_ASSETS_KEY),
```

★ Match the exact delete-when-empty idiom the neighbouring entries use — read the `documents` entry and copy its shape, including whichever delete helper that file imports. Leaving a stale key behind would resurrect deleted assets on the next load.

- [ ] **Step 5: Run the tests and typecheck**

```bash
npx vitest run src/app/browser-backend.test.ts --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t6.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/browser-backend.ts src/app/browser-backend.test.ts
git commit -m "feat: persist documentAssets metadata to IndexedDB"
```

---

### Task 7: prove all six paths, and regenerate the golden fixtures

**Files:**
- Modify: `src/app/entity-persistence-registry.test.ts`
- Modify: `src/app/__fixtures__/golden-*` (regenerated, not hand-edited)

- [ ] **Step 1: Write the six-path test**

Append to `src/app/entity-persistence-registry.test.ts`:

```ts
describe("entity persistence registry — documentAssets across all six write paths", () => {
  const asset = {
    id: "a1", name: "chart.png", mime: "image/png", size: 1024,
    width: 800, height: 600, hash: "abc123", createdAt: "2026-08-21T10:00:00.000Z",
  };
  const ws = { ...emptyWorkspace(), documentAssets: [asset] };

  // Paths 1-3: one ENTITY_SPECS row drives the CSV columns, the Turso
  // single-tenant DDL/insert and the Turso multi-tenant DDL/insert.
  it("1+4+5: the column registry drives CSV and both Turso layouts", () => {
    const spec = ENTITY_SPECS.find((s) => s.table === "document_assets");
    expect(spec?.columns).toEqual(DOCUMENT_ASSETS_CSV_COLUMNS);
    expect(tenantDdl().some((s) => s.includes("document_assets"))).toBe(true);
  });

  it("1: survives the CSV round-trip", () => {
    expect(csvToWorkspace(workspaceToCsv(ws)).documentAssets?.[0]).toEqual(asset);
  });

  it("2: survives the Markdown round-trip", () => {
    expect(markdownToWorkspace(workspaceToMarkdown(ws)).documentAssets?.[0]).toEqual(asset);
  });

  it("3: survives the JSON round-trip", () => {
    expect(jsonToWorkspace(workspaceToJson(ws)).documentAssets?.[0]).toEqual(asset);
  });

  // Path 6 (IndexedDB) is proved in browser-backend.test.ts, which owns the
  // fake-indexeddb harness. Named here so the count reaches six on the page.
});
```

★★ Count to **six** yourself and name where each is proved. This file's name promises more than any one describe block delivers — `activityLog` is exercised here over the two text backends only, and its Turso tenant path was the one that got missed.

- [ ] **Step 2: Run it**

```bash
npx vitest run src/app/entity-persistence-registry.test.ts --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t7.log
```

Expected: PASS. If the tenant assertion fails, the `ENTITY_SPECS` row from Task 3 is missing or misspelled.

- [ ] **Step 3: Check whether the golden fixtures moved**

```bash
npx vitest run src/app/golden-workspace.test.ts --reporter=dot > /tmp/t7g.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t7g.log
```

If green, the sample workspace holds no assets and nothing regenerates — skip to Step 5. If red, the CSV/Markdown byte output changed; that is a **legitimate new-section format change**, so continue.

- [ ] **Step 4: Regenerate, if and only if Step 3 went red**

Regenerate `src/app/__fixtures__/golden-*` from `sample-workspace-small.json` through the serializers, using the command the golden test's own failure message names.

★★★ Verify the regenerated files by **byte count**, not by `git diff` — a golden regen has previously written 378-byte fixtures over 23,916-byte ones and reported success:

```bash
for f in src/app/__fixtures__/golden-*; do echo "$(wc -c < "$f") $f"; done
```

Any fixture that shrank by more than the new section's own size means the regen truncated. Revert and investigate; never commit through it.

- [ ] **Step 5: Commit**

```bash
git add src/app/entity-persistence-registry.test.ts src/app/__fixtures__
git commit -m "test: prove documentAssets survives all six write paths"
```

---

# Phase 2 — the byte store

---

### Task 8: `document-assets-schema.ts` — DDL and statement builders

**Files:**
- Create: `src/app/document-assets-schema.ts`
- Test: `src/app/document-assets-schema.test.ts`

Mirrors `comm-templates-schema.ts`. Pure: builds statements, executes nothing.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/document-assets-schema.test.ts
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_ASSET_DATA_DDL, assetDataSelect, assetDataUpsert,
  assetDataDelete, rowsToAssetData,
} from "./document-assets-schema";

describe("document-assets-schema", () => {
  it("creates the table if it does not exist", () => {
    expect(DOCUMENT_ASSET_DATA_DDL[0]).toContain("CREATE TABLE IF NOT EXISTS document_asset_data");
  });

  it("keys on (id, project_id) so tenant mode cannot collide across projects", () => {
    expect(DOCUMENT_ASSET_DATA_DDL[0]).toContain("PRIMARY KEY (id, project_id)");
  });

  it("selects one asset's bytes, scoped by project", () => {
    const [stmt] = assetDataSelect("a1", "p1");
    expect(stmt.sql).toContain("WHERE id = ? AND project_id = ?");
    expect(stmt.args?.map((a) => a.value)).toEqual(["a1", "p1"]);
  });

  // ★★ INSERT OR REPLACE, never DELETE-then-INSERT: runTursoPipeline only opens
  //    a transaction when the FIRST statement is literally BEGIN, so a
  //    delete/insert pair is two unprotected statements and a failure between
  //    them loses the bytes.
  it("upserts atomically in a single statement", () => {
    const stmts = assetDataUpsert({ id: "a1", projectId: "p1", data: "QUJD" });
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toContain("INSERT OR REPLACE INTO document_asset_data");
  });

  it("binds bytes as a text arg, since SqlArg.value is string-only", () => {
    const [stmt] = assetDataUpsert({ id: "a1", projectId: "p1", data: "QUJD" });
    expect(stmt.args?.every((a) => a.type === "text")).toBe(true);
  });

  it("requires a project id to delete, so a delete cannot reach across projects", () => {
    const [stmt] = assetDataDelete("a1", "p1");
    expect(stmt.sql).toContain("WHERE id = ? AND project_id = ?");
  });

  it("decodes rows back into id/data pairs", () => {
    const res = {
      response: {
        result: {
          cols: [{ name: "id" }, { name: "project_id" }, { name: "data" }],
          rows: [[{ value: "a1" }, { value: "p1" }, { value: "QUJD" }]],
        },
      },
    };
    expect(rowsToAssetData(res)).toEqual([{ id: "a1", projectId: "p1", data: "QUJD" }]);
  });

  it("returns an empty list for an undefined result rather than throwing", () => {
    expect(rowsToAssetData(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/document-assets-schema.test.ts --reporter=dot > /tmp/t8.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t8.log
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/document-assets-schema.ts
//
// DDL and statement builders for `document_asset_data` — the base64 bytes
// behind each DocumentAsset.
//
// ★★★ THIS TABLE IS DELIBERATELY OUTSIDE TABLE_NAMES. The workspace save emits
// a per-table DELETE plus a full re-INSERT for every table it owns, so listing
// this one would wipe the whole image library on every workspace save. The
// metadata rides ENTITY_SPECS (turso-schema.ts); only the bytes live here, and
// they are written one row at a time by document-assets-store.ts. A guard test
// in turso-schema.test.ts pins the exclusion.
//
// ★★ Bytes are base64 TEXT because SqlArg.value is string-only even for
// integers. Measured 2026-08-21: a single-statement pipeline carried a 32 MiB
// text argument with no ceiling found, so the 5 MB stored cap has ~4.8x
// headroom and no chunking is needed. Assets are written ONE PER REQUEST — the
// measurement says nothing about a pipeline batching several.

import { txt, type SqlStmt } from "./turso-schema";
import { rowObjects, type PipelineResultLike } from "./turso-schema";

export interface AssetDataRow {
  id: string;
  /** "" in single-tenant mode. Part of the composite key either way, so one
   *  code path serves both layouts. */
  projectId: string;
  /** base64, no data: prefix. */
  data: string;
}

export const DOCUMENT_ASSET_DATA_DDL: string[] = [
  "CREATE TABLE IF NOT EXISTS document_asset_data ("
    + "id TEXT, project_id TEXT, data TEXT, PRIMARY KEY (id, project_id))",
];

export function assetDataSelect(id: string, projectId: string): SqlStmt[] {
  return [{
    sql: "SELECT id, project_id, data FROM document_asset_data WHERE id = ? AND project_id = ?",
    args: [txt(id), txt(projectId)],
  }];
}

/** Ids only — the library lists names and sizes from the METADATA slice, so it
 *  must never pull bytes to render. */
export function assetDataIdsSelect(projectId: string): SqlStmt[] {
  return [{
    sql: "SELECT id, project_id, '' AS data FROM document_asset_data WHERE project_id = ?",
    args: [txt(projectId)],
  }];
}

export function assetDataUpsert(row: AssetDataRow): SqlStmt[] {
  return [{
    sql: "INSERT OR REPLACE INTO document_asset_data (id, project_id, data) VALUES (?, ?, ?)",
    args: [txt(row.id), txt(row.projectId), txt(row.data)],
  }];
}

export function assetDataDelete(id: string, projectId: string): SqlStmt[] {
  return [{
    sql: "DELETE FROM document_asset_data WHERE id = ? AND project_id = ?",
    args: [txt(id), txt(projectId)],
  }];
}

/** Every row of a project, for the project-deletion cleanup path. */
export function assetDataDeleteAllForProject(projectId: string): SqlStmt[] {
  return [{
    sql: "DELETE FROM document_asset_data WHERE project_id = ?",
    args: [txt(projectId)],
  }];
}

export function rowsToAssetData(res: PipelineResultLike | undefined): AssetDataRow[] {
  return rowObjects(res).map((r) => ({
    id: r.id ?? "",
    projectId: r.project_id ?? "",
    data: r.data ?? "",
  }));
}
```

★ Check the real export names of `txt`, `rowObjects` and `PipelineResultLike` in `turso-schema.ts` before writing the imports, and collapse the two import lines into one. An unused or misnamed import is a fatal lint error.

- [ ] **Step 4: Run the tests and typecheck**

```bash
npx vitest run src/app/document-assets-schema.test.ts --reporter=dot > /tmp/t8.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t8.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/document-assets-schema.ts src/app/document-assets-schema.test.ts
git commit -m "feat: add the document_asset_data side-table schema"
```

---

### Task 9: `document-assets-store.ts` — async CRUD

**Files:**
- Create: `src/app/document-assets-store.ts`
- Test: `src/app/document-assets-store.test.ts`

Mirrors `comm-templates-store.ts` exactly, including prepending the DDL to every call so a fresh database self-heals.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/document-assets-store.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAssetData, saveAssetData, deleteAssetData, loadAssetDataIds } from "./document-assets-store";

vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn() }));
import { runTursoPipeline } from "./turso-pipeline";

const config = { httpUrl: "https://db.example.turso.io", authToken: "t" } as never;

beforeEach(() => { vi.mocked(runTursoPipeline).mockReset(); });

describe("document-assets-store", () => {
  it("prepends the DDL to every call so a fresh database self-heals", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([{}, {}] as never);
    await loadAssetData(config, "a1", "p1");
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(stmts[0].sql).toContain("CREATE TABLE IF NOT EXISTS document_asset_data");
  });

  it("reads the result AFTER the DDL statements, not at index 0", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([
      {},
      { response: { result: { cols: [{ name: "id" }, { name: "project_id" }, { name: "data" }], rows: [[{ value: "a1" }, { value: "p1" }, { value: "QUJD" }]] } } },
    ] as never);
    expect(await loadAssetData(config, "a1", "p1")).toBe("QUJD");
  });

  it("returns null when the asset has no byte row — the dangling case", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([{}, { response: { result: { cols: [], rows: [] } } }] as never);
    expect(await loadAssetData(config, "missing", "p1")).toBeNull();
  });

  it("writes exactly one upsert statement after the DDL", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([{}, {}] as never);
    await saveAssetData(config, { id: "a1", projectId: "p1", data: "QUJD" });
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(stmts).toHaveLength(DOCUMENT_ASSET_DATA_DDL.length + 1);
    expect(stmts[stmts.length - 1].sql).toContain("INSERT OR REPLACE");
  });

  it("deletes scoped to the project", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([{}, {}] as never);
    await deleteAssetData(config, "a1", "p1");
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(stmts[stmts.length - 1].sql).toContain("project_id = ?");
  });

  it("lists ids without pulling any bytes", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([{}, { response: { result: { cols: [{ name: "id" }, { name: "project_id" }, { name: "data" }], rows: [[{ value: "a1" }, { value: "p1" }, { value: "" }]] } } }] as never);
    expect(await loadAssetDataIds(config, "p1")).toEqual(["a1"]);
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(stmts[stmts.length - 1].sql).toContain("'' AS data");
  });
});
```

Add `import { DOCUMENT_ASSET_DATA_DDL } from "./document-assets-schema";` to the test's imports.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/document-assets-store.test.ts --reporter=dot > /tmp/t9.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t9.log
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/document-assets-store.ts — async CRUD for document asset BYTES over
// the shared Turso pipeline. Every call prepends DOCUMENT_ASSET_DATA_DDL
// (CREATE TABLE IF NOT EXISTS), mirroring comm-templates-store.ts, so a
// database that has never held an asset heals itself on first use.
//
// ★★ ONE ASSET PER REQUEST. The 32 MiB ceiling measured on 2026-08-21 was for a
// SINGLE statement; batching several images into one pipeline is unmeasured.
import { runTursoPipeline } from "./turso-pipeline";
import {
  DOCUMENT_ASSET_DATA_DDL, assetDataSelect, assetDataIdsSelect, assetDataUpsert,
  assetDataDelete, assetDataDeleteAllForProject, rowsToAssetData, type AssetDataRow,
} from "./document-assets-schema";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";

const ddl = (): SqlStmt[] => DOCUMENT_ASSET_DATA_DDL.map((sql) => ({ sql }));

/** base64 bytes, or null when no row exists — the dangling case the preview
 *  renders with a missing-asset marker. */
export async function loadAssetData(
  config: TursoConfig | null, id: string, projectId: string,
): Promise<string | null> {
  const results = await runTursoPipeline(config, [...ddl(), ...assetDataSelect(id, projectId)]);
  const rows = rowsToAssetData(results[DOCUMENT_ASSET_DATA_DDL.length]);
  return rows[0]?.data ?? null;
}

/** Ids present in the byte table. The library diffs this against the metadata
 *  slice to mark rows dangling without pulling a single image. */
export async function loadAssetDataIds(
  config: TursoConfig | null, projectId: string,
): Promise<string[]> {
  const results = await runTursoPipeline(config, [...ddl(), ...assetDataIdsSelect(projectId)]);
  return rowsToAssetData(results[DOCUMENT_ASSET_DATA_DDL.length]).map((r) => r.id);
}

export async function saveAssetData(config: TursoConfig | null, row: AssetDataRow): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...assetDataUpsert(row)]);
}

export async function deleteAssetData(
  config: TursoConfig | null, id: string, projectId: string,
): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...assetDataDelete(id, projectId)]);
}

/** Project deletion must clean the side table explicitly — the workspace save
 *  never touches it, so nothing else ever will. */
export async function deleteAllAssetDataForProject(
  config: TursoConfig | null, projectId: string,
): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...assetDataDeleteAllForProject(projectId)]);
}
```

- [ ] **Step 4: Run the tests and typecheck**

```bash
npx vitest run src/app/document-assets-store.test.ts --reporter=dot > /tmp/t9.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t9.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/document-assets-store.ts src/app/document-assets-store.test.ts
git commit -m "feat: add the document asset byte store over the Turso pipeline"
```

---

### Task 10: wire project deletion to clean the side table

**Files:**
- Modify: the project-deletion path (find it with the grep below)
- Test: that path's existing test file

- [ ] **Step 1: Find the deletion path**

```bash
grep -rn "deleteProject\|DELETE FROM projects" src/app --include=*.ts --include=*.tsx | grep -v "\.test\." | head
```

Read the hit and identify where the other side tables are cleaned. If **no** other side table is cleaned there, record that as a pre-existing gap in `docs/open-followups.md` in Task 22 rather than fixing every one of them here — but still add the asset cleanup, because this slice is the one introducing bytes that a user would reasonably expect deleting a project to remove.

- [ ] **Step 2: Write the failing test**

In that path's test file, assert that deleting a project issues a `DELETE FROM document_asset_data WHERE project_id = ?` for the deleted project id, using the same mocking shape the neighbouring tests use.

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run <that test file> --reporter=dot > /tmp/t10.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t10.log
```

Expected: FAIL — no such statement issued.

- [ ] **Step 4: Call the cleanup**

Call `deleteAllAssetDataForProject(config, projectId)` from the deletion path.

★ Make it non-fatal: a failure to clean bytes must not abort the project deletion the user asked for. Leaked bytes are recoverable; a half-deleted project is not.

- [ ] **Step 5: Run the tests and typecheck**

```bash
npx vitest run <that test file> --reporter=dot > /tmp/t10.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t10.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add -A src/app
git commit -m "feat: drop a project's asset bytes when the project is deleted"
```

---

# Phase 3 — the upload pipeline

Pure and i18n-free. Everything here is unit-testable without a browser except the two isolated calls (`createImageBitmap`/canvas, `crypto.subtle`), which live behind seams the tests replace.

---

### Task 11: format gate and raw ceiling

**Files:**
- Create: `src/app/document-asset-upload.ts`
- Test: `src/app/document-asset-upload.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/document-asset-upload.test.ts
import { describe, expect, it } from "vitest";
import {
  ASSET_MIME_ALLOWED, ASSET_RAW_MAX_BYTES, ASSET_STORED_MAX_BYTES,
  ASSET_MAX_SOURCE_DIM, ASSET_DOWNSCALE_W, ASSET_DOWNSCALE_H,
  ASSET_MAX_PER_DOCUMENT, checkUploadCandidate,
} from "./document-asset-upload";

const file = (mime: string, size: number) => ({ type: mime, size, name: "x" }) as File;

describe("checkUploadCandidate", () => {
  it("accepts PNG, JPEG and WebP", () => {
    for (const m of ["image/png", "image/jpeg", "image/webp"]) {
      expect(checkUploadCandidate(file(m, 1024)).ok).toBe(true);
    }
  });

  // ★★ SVG is excluded PERMANENTLY — it is an XSS surface, inheriting the
  //    branding allow-list's reasoning. This is not a cap to relax later.
  it("rejects SVG", () => {
    const r = checkUploadCandidate(file("image/svg+xml", 1024));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("format");
  });

  // ★★ GIF is excluded because downscaling re-encodes and would SILENTLY
  //    destroy animation. Silent destruction of user content is the shape that
  //    already cost this repo a CLOSED follow-up.
  it("rejects GIF", () => {
    expect(checkUploadCandidate(file("image/gif", 1024)).reason).toBe("format");
  });

  it("rejects a file over the raw ceiling before any decode", () => {
    const r = checkUploadCandidate(file("image/png", ASSET_RAW_MAX_BYTES + 1));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("tooLargeRaw");
  });

  it("accepts a file exactly at the raw ceiling", () => {
    expect(checkUploadCandidate(file("image/png", ASSET_RAW_MAX_BYTES)).ok).toBe(true);
  });

  it("rejects an empty file", () => {
    expect(checkUploadCandidate(file("image/png", 0)).reason).toBe("empty");
  });
});

describe("upload constants", () => {
  it("pins the measured budget", () => {
    expect(ASSET_RAW_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(ASSET_STORED_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(ASSET_MAX_SOURCE_DIM).toBe(8000);
    expect(ASSET_DOWNSCALE_W).toBe(1920);
    expect(ASSET_DOWNSCALE_H).toBe(1080);
    expect(ASSET_MAX_PER_DOCUMENT).toBe(20);
  });

  // ★★ The ORDER matters and is the reason the stored cap is applied AFTER
  //    downscale: checking the raw upload against the stored cap would reject
  //    the exact photo that downscaling exists to rescue.
  it("keeps the raw ceiling well above the stored cap", () => {
    expect(ASSET_RAW_MAX_BYTES).toBeGreaterThan(ASSET_STORED_MAX_BYTES);
  });

  it("excludes svg and gif from the allow-list", () => {
    expect(ASSET_MIME_ALLOWED).not.toContain("image/svg+xml");
    expect(ASSET_MIME_ALLOWED).not.toContain("image/gif");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/document-asset-upload.test.ts --reporter=dot > /tmp/t11.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t11.log
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/document-asset-upload.ts
//
// The upload pipeline for document assets. Pure and i18n-free — every rejection
// returns a REASON CODE that the surface translates. FORMAT POLICY LIVES HERE,
// not in the store: document-asset.ts is mime-generic on purpose so a later
// attachment slice reuses the table with no migration.

/** ★★ PNG + JPEG + WebP. WebP is admitted because browsers put WebP on the
 *  clipboard and paste is a shipping entry point — rejecting it would make the
 *  headline gesture fail on real screenshots. SVG is out permanently (XSS
 *  surface). GIF is out because downscaling re-encodes and would silently
 *  destroy animation. */
export const ASSET_MIME_ALLOWED = ["image/png", "image/jpeg", "image/webp"] as const;

/** Bounds what is read into memory at all, before any decode. */
export const ASSET_RAW_MAX_BYTES = 25 * 1024 * 1024;

/** ★★ Applied AFTER downscale. Checking the raw upload against this first would
 *  reject the photo that downscaling exists to rescue — the two rules would
 *  cancel out. Measured 2026-08-21: this rides ~6.7 MiB of base64 in a single
 *  Turso statement, against a ceiling not found below 32 MiB. */
export const ASSET_STORED_MAX_BYTES = 5 * 1024 * 1024;

/** Decompression-bomb guard, read from the HEADER and never by decoding: a
 *  50 KB PNG can expand to 30000x30000. Generous enough that no real camera or
 *  screenshot reaches it. */
export const ASSET_MAX_SOURCE_DIM = 8000;

export const ASSET_DOWNSCALE_W = 1920;
export const ASSET_DOWNSCALE_H = 1080;

/** Per DOCUMENT, distinct images. The only moment images are held together is a
 *  .docx/.pptx export assembled as one in-memory Blob. Per WORKSPACE there is
 *  deliberately no cap — disclosure without enforcement. */
export const ASSET_MAX_PER_DOCUMENT = 20;

export type UploadRejection =
  | "format" | "tooLargeRaw" | "tooLargeStored" | "dimensions" | "empty" | "decode";

export type CandidateResult =
  | { ok: true }
  | { ok: false; reason: UploadRejection };

/** Cheap pre-flight: mime and raw size only. Runs before a single byte is
 *  decoded, which is the whole point of the raw ceiling. */
export function checkUploadCandidate(file: Pick<File, "type" | "size">): CandidateResult {
  if (!(ASSET_MIME_ALLOWED as readonly string[]).includes(file.type)) {
    return { ok: false, reason: "format" };
  }
  if (file.size <= 0) return { ok: false, reason: "empty" };
  if (file.size > ASSET_RAW_MAX_BYTES) return { ok: false, reason: "tooLargeRaw" };
  return { ok: true };
}
```

- [ ] **Step 4: Run the tests and typecheck**

```bash
npx vitest run src/app/document-asset-upload.test.ts --reporter=dot > /tmp/t11.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t11.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/document-asset-upload.ts src/app/document-asset-upload.test.ts
git commit -m "feat: add the asset upload format gate and raw ceiling"
```

---

### Task 12: header-only dimension guard

**Files:**
- Modify: `src/app/document-asset-upload.ts`
- Test: `src/app/document-asset-upload.test.ts`

Reads pixel dimensions from the file header bytes. Never decodes — that is the entire point.

- [ ] **Step 1: Write the failing test**

```ts
describe("readHeaderDimensions", () => {
  // PNG: 8-byte signature, then a 25-byte IHDR whose width/height are big-endian
  // uint32 at offsets 16 and 20.
  function pngHeader(w: number, h: number): Uint8Array {
    const b = new Uint8Array(24);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return b;
  }

  it("reads PNG dimensions from the IHDR", () => {
    expect(readHeaderDimensions(pngHeader(800, 600), "image/png")).toEqual({ width: 800, height: 600 });
  });

  it("returns null for a truncated header rather than throwing", () => {
    expect(readHeaderDimensions(new Uint8Array(4), "image/png")).toBeNull();
  });

  it("returns null when the PNG signature does not match", () => {
    const b = pngHeader(800, 600);
    b[0] = 0x00;
    expect(readHeaderDimensions(b, "image/png")).toBeNull();
  });
});

describe("checkHeaderDimensions", () => {
  it("rejects a decompression bomb before any decode", () => {
    expect(checkHeaderDimensions({ width: 30000, height: 30000 }).reason).toBe("dimensions");
  });

  it("accepts a dimension exactly at the ceiling", () => {
    expect(checkHeaderDimensions({ width: ASSET_MAX_SOURCE_DIM, height: 100 }).ok).toBe(true);
  });

  it("rejects one dimension over the ceiling even when the other is small", () => {
    expect(checkHeaderDimensions({ width: 100, height: ASSET_MAX_SOURCE_DIM + 1 }).ok).toBe(false);
  });

  // ★★ An UNREADABLE header must not be an automatic pass — that would make the
  //    bomb guard trivially bypassable by corrupting one signature byte.
  it("rejects when dimensions could not be read at all", () => {
    expect(checkHeaderDimensions(null).reason).toBe("decode");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/document-asset-upload.test.ts -t "HeaderDimensions" --reporter=dot > /tmp/t12.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t12.log
```

Expected: FAIL — `readHeaderDimensions is not exported`.

- [ ] **Step 3: Implement**

Append to `src/app/document-asset-upload.ts`:

```ts
export interface PixelSize { width: number; height: number }

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Dimensions from the file HEADER, without decoding a single pixel. Returns
 *  null when the header is truncated, the signature does not match, or the
 *  format is one this reader does not parse — the CALLER decides what null
 *  means, and checkHeaderDimensions treats it as a rejection. */
export function readHeaderDimensions(bytes: Uint8Array, mime: string): PixelSize | null {
  if (mime === "image/png") {
    if (bytes.length < 24) return null;
    if (!PNG_SIG.every((b, i) => bytes[i] === b)) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (mime === "image/jpeg") return readJpegDimensions(bytes);
  if (mime === "image/webp") return readWebpDimensions(bytes);
  return null;
}

/** JPEG: walk the marker chain to the first SOFn frame header, whose height and
 *  width are big-endian uint16 at segment offsets 3 and 5. SOF4/SOF8/SOF12 are
 *  not frame headers and are skipped. */
function readJpegDimensions(bytes: Uint8Array): PixelSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    const isSof = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    const len = view.getUint16(i + 2);
    if (isSof) {
      const height = view.getUint16(i + 5);
      const width = view.getUint16(i + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/** WebP: RIFF container. Only the VP8X form carries dimensions at a fixed
 *  offset as 24-bit little-endian minus-one values; the lossy and lossless
 *  forms are parsed by their own chunk layouts. Anything unrecognised returns
 *  null and is rejected, never waved through. */
function readWebpDimensions(bytes: Uint8Array): PixelSize | null {
  if (bytes.length < 30) return null;
  const tag = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  if (tag !== "RIFF" || webp !== "WEBP") return null;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (chunk === "VP8X") {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }
  if (chunk === "VP8 ") {
    const width = view.getUint16(26, true) & 0x3fff;
    const height = view.getUint16(28, true) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === "VP8L") {
    const b = view.getUint32(21, true);
    const width = 1 + (b & 0x3fff);
    const height = 1 + ((b >> 14) & 0x3fff);
    return { width, height };
  }
  return null;
}

/** ★★ null is a REJECTION, not a pass. Treating an unreadable header as
 *  acceptable would make the bomb guard bypassable by corrupting one byte. */
export function checkHeaderDimensions(size: PixelSize | null): CandidateResult {
  if (!size) return { ok: false, reason: "decode" };
  if (size.width > ASSET_MAX_SOURCE_DIM || size.height > ASSET_MAX_SOURCE_DIM) {
    return { ok: false, reason: "dimensions" };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Add JPEG and WebP tests**

Add one round-trip test per format, building a minimal valid header in the test exactly as the PNG helper does — a 0xFFD8 prologue plus an SOF0 segment for JPEG, and a `RIFF....WEBPVP8X` prologue for WebP. Assert the parsed dimensions and one truncated-input null for each.

- [ ] **Step 5: Run the tests and typecheck**

```bash
npx vitest run src/app/document-asset-upload.test.ts --reporter=dot > /tmp/t12.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t12.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/document-asset-upload.ts src/app/document-asset-upload.test.ts
git commit -m "feat: guard asset uploads against decompression bombs from the header"
```

---

### Task 13: downscale, stored cap and keep-original

**Files:**
- Modify: `src/app/document-asset-upload.ts`
- Test: `src/app/document-asset-upload.test.ts`

The canvas work is isolated behind an injectable `encode` seam so the arithmetic is testable in jsdom, which has no canvas.

- [ ] **Step 1: Write the failing test**

```ts
describe("targetSize", () => {
  it("leaves an image already inside the target untouched", () => {
    expect(targetSize({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
  });

  it("scales a wide image down by width, preserving aspect ratio", () => {
    expect(targetSize({ width: 3840, height: 2160 })).toEqual({ width: 1920, height: 1080 });
  });

  it("scales a tall image down by height", () => {
    expect(targetSize({ width: 1080, height: 3840 })).toEqual({ width: 304, height: 1080 });
  });

  it("never returns a zero dimension for an extreme aspect ratio", () => {
    const out = targetSize({ width: 20000, height: 1 });
    expect(out.width).toBe(1920);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });
});

describe("pickSmaller", () => {
  // ★★ Re-encoding a photo to PNG can come out LARGER than the source. Keeping
  //    the original in that case is the rule, not an optimisation.
  it("keeps the original when the re-encode came out larger", () => {
    expect(pickSmaller({ bytes: new Uint8Array(100), mime: "image/jpeg" },
                       { bytes: new Uint8Array(200), mime: "image/png" }).mime).toBe("image/jpeg");
  });

  it("takes the re-encode when it is smaller", () => {
    expect(pickSmaller({ bytes: new Uint8Array(300), mime: "image/jpeg" },
                       { bytes: new Uint8Array(120), mime: "image/png" }).mime).toBe("image/png");
  });

  it("keeps the original on a tie, avoiding a needless re-encode", () => {
    expect(pickSmaller({ bytes: new Uint8Array(100), mime: "image/jpeg" },
                       { bytes: new Uint8Array(100), mime: "image/png" }).mime).toBe("image/jpeg");
  });
});

describe("checkStoredSize", () => {
  it("accepts bytes at the stored cap", () => {
    expect(checkStoredSize(ASSET_STORED_MAX_BYTES).ok).toBe(true);
  });

  it("rejects bytes over the stored cap with its own reason code", () => {
    expect(checkStoredSize(ASSET_STORED_MAX_BYTES + 1).reason).toBe("tooLargeStored");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/document-asset-upload.test.ts -t "targetSize" --reporter=dot > /tmp/t13.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t13.log
```

Expected: FAIL — `targetSize is not exported`.

- [ ] **Step 3: Implement**

Append to `src/app/document-asset-upload.ts`:

```ts
export interface EncodedImage { bytes: Uint8Array; mime: string }

/** Fit inside the downscale target, preserving aspect ratio. Never upscales, and
 *  never returns a zero dimension — a 20000x1 banner must still be one pixel
 *  tall, not zero, or the canvas call throws. */
export function targetSize(src: PixelSize): PixelSize {
  const scale = Math.min(ASSET_DOWNSCALE_W / src.width, ASSET_DOWNSCALE_H / src.height, 1);
  return {
    width: Math.max(1, Math.round(src.width * scale)),
    height: Math.max(1, Math.round(src.height * scale)),
  };
}

/** ★★ Ties keep the ORIGINAL. Re-encoding a photo to PNG can come out larger,
 *  and a re-encode that buys nothing is pure loss — it costs a generation of
 *  quality for zero bytes. */
export function pickSmaller(original: EncodedImage, reencoded: EncodedImage): EncodedImage {
  return reencoded.bytes.length < original.bytes.length ? reencoded : original;
}

export function checkStoredSize(bytes: number): CandidateResult {
  return bytes > ASSET_STORED_MAX_BYTES
    ? { ok: false, reason: "tooLargeStored" }
    : { ok: true };
}
```

- [ ] **Step 4: Add the browser-only downscale behind a seam**

Also append:

```ts
/** The one browser-only step. Injected so the arithmetic above stays testable
 *  in jsdom, which has no canvas. Callers pass the real implementation from
 *  the surface; tests pass a stub. */
export type ImageEncoder = (bytes: Uint8Array, mime: string, size: PixelSize) => Promise<EncodedImage>;

export interface ProcessResult {
  ok: true; image: EncodedImage; size: PixelSize;
}

/** Full pipeline over already-read bytes: header guard, downscale, stored cap,
 *  keep-original. Returns a reason code on every rejection; throws nothing. */
export async function processUpload(
  bytes: Uint8Array, mime: string, encode: ImageEncoder,
): Promise<ProcessResult | { ok: false; reason: UploadRejection }> {
  const header = readHeaderDimensions(bytes, mime);
  const dimCheck = checkHeaderDimensions(header);
  if (!dimCheck.ok) return dimCheck;
  const src = header as PixelSize;
  const target = targetSize(src);

  let chosen: EncodedImage = { bytes, mime };
  let size = src;
  if (target.width !== src.width || target.height !== src.height) {
    const reencoded = await encode(bytes, mime, target);
    chosen = pickSmaller({ bytes, mime }, reencoded);
    // Dimensions are recorded POST-downscale — but only when the downscaled
    // encode was actually the one kept.
    size = chosen === reencoded ? target : src;
  }

  const sizeCheck = checkStoredSize(chosen.bytes.length);
  if (!sizeCheck.ok) return sizeCheck;
  return { ok: true, image: chosen, size };
}
```

- [ ] **Step 5: Test `processUpload` with a stub encoder**

```ts
describe("processUpload", () => {
  const png = (w: number, h: number, pad = 0) => {
    const b = new Uint8Array(24 + pad);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return b;
  };
  const shrink: ImageEncoder = async (_b, mime) => ({ bytes: new Uint8Array(10), mime });
  const grow: ImageEncoder = async (_b, mime) => ({ bytes: new Uint8Array(10_000), mime });

  it("does not call the encoder when the image is already within target", async () => {
    let called = false;
    const spy: ImageEncoder = async (b, m) => { called = true; return { bytes: b, mime: m }; };
    const r = await processUpload(png(800, 600), "image/png", spy);
    expect(called).toBe(false);
    expect(r.ok && r.size).toEqual({ width: 800, height: 600 });
  });

  it("records POST-downscale dimensions when the re-encode is kept", async () => {
    const r = await processUpload(png(3840, 2160, 5000), "image/png", shrink);
    expect(r.ok && r.size).toEqual({ width: 1920, height: 1080 });
  });

  // ★★ This is the trap: if the re-encode was DISCARDED for being larger, the
  //    stored bytes are the ORIGINAL, so the stored dimensions must be the
  //    ORIGINAL's too. Recording the target here would make every OOXML export
  //    size that image wrongly in slice S3c-2.
  it("records SOURCE dimensions when the re-encode was discarded as larger", async () => {
    const r = await processUpload(png(3840, 2160), "image/png", grow);
    expect(r.ok && r.size).toEqual({ width: 3840, height: 2160 });
  });

  it("rejects a bomb without calling the encoder", async () => {
    let called = false;
    const spy: ImageEncoder = async (b, m) => { called = true; return { bytes: b, mime: m }; };
    const r = await processUpload(png(30000, 30000), "image/png", spy);
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 6: Run the tests and typecheck**

```bash
npx vitest run src/app/document-asset-upload.test.ts --reporter=dot > /tmp/t13.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t13.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add src/app/document-asset-upload.ts src/app/document-asset-upload.test.ts
git commit -m "feat: downscale asset uploads and cap the stored bytes"
```

---

### Task 14: content hash and base64

**Files:**
- Modify: `src/app/document-asset-upload.ts`
- Test: `src/app/document-asset-upload.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("bytesToBase64 / base64ToBytes", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("round-trips an empty array", () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });

  // ★ Chunked encoding: String.fromCharCode.apply blows the argument limit on a
  //   multi-megabyte image, which is exactly the size this ships for.
  it("round-trips a payload past the call-argument limit", () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  });

  it("emits no data: prefix — the store holds raw base64", () => {
    expect(bytesToBase64(new Uint8Array([1, 2, 3]))).not.toContain("data:");
  });
});

describe("hashBytes", () => {
  it("returns a stable lowercase hex digest", async () => {
    const h = await hashBytes(new Uint8Array([1, 2, 3]));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashBytes(new Uint8Array([1, 2, 3]))).toBe(h);
  });

  it("gives different bytes different digests", async () => {
    expect(await hashBytes(new Uint8Array([1]))).not.toBe(await hashBytes(new Uint8Array([2])));
  });
});

describe("findDuplicate", () => {
  const assets = [
    { id: "a1", name: "x", mime: "image/png", size: 1, hash: "aaa", createdAt: "" },
    { id: "a2", name: "y", mime: "image/png", size: 1, hash: "bbb", createdAt: "" },
  ];

  it("finds an existing asset with the same hash", () => {
    expect(findDuplicate(assets, "bbb")?.id).toBe("a2");
  });

  it("returns undefined when nothing matches", () => {
    expect(findDuplicate(assets, "ccc")).toBeUndefined();
  });

  // ★ A blank hash must never match. A row whose hash failed to compute would
  //   otherwise dedup against every other such row and serve the wrong image.
  it("never matches on a blank hash", () => {
    const withBlank = [...assets, { id: "a3", name: "z", mime: "image/png", size: 1, hash: "", createdAt: "" }];
    expect(findDuplicate(withBlank, "")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/document-asset-upload.test.ts -t "hashBytes" --reporter=dot > /tmp/t14.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t14.log
```

Expected: FAIL — `hashBytes is not exported`.

- [ ] **Step 3: Implement**

Append to `src/app/document-asset-upload.ts`:

```ts
import type { DocumentAsset } from "./document-asset";

const B64_CHUNK = 0x8000;

/** ★ Chunked: String.fromCharCode.apply overflows its argument limit on a
 *  multi-megabyte payload, which is the size this ships for. Emits RAW base64 —
 *  no `data:` prefix, because the store holds bytes and the preview builds its
 *  own blob URL. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  }
  return btoa(out);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** SHA-256 over the STORED bytes, lowercase hex. Drives dedup and makes delete
 *  refcount-aware: a logo referenced from twenty documents is one row. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** ★ A blank hash never matches. A row whose digest failed to compute would
 *  otherwise dedup against every other such row and serve the wrong image. */
export function findDuplicate(
  assets: readonly DocumentAsset[], hash: string,
): DocumentAsset | undefined {
  if (!hash) return undefined;
  return assets.find((a) => a.hash === hash);
}
```

- [ ] **Step 4: Run the tests and typecheck**

```bash
npx vitest run src/app/document-asset-upload.test.ts --reporter=dot > /tmp/t14.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t14.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`. If `crypto.subtle` is unavailable under the test environment, add the standard node `webcrypto` global the repo's other WebCrypto tests use — check `secrets.test.ts` for the existing shape rather than inventing one.

- [ ] **Step 5: Commit**

```bash
git add src/app/document-asset-upload.ts src/app/document-asset-upload.test.ts
git commit -m "feat: hash and base64-encode asset bytes for dedup and storage"
```

---

# Phase 4 — surfaces

---

### Task 15: the `AssetLibrary` component

**Files:**
- Create: `src/app/asset-library.tsx`
- Test: `src/app/asset-library.test.tsx`

One component, both mountings. Presentational: it takes assets, usage counts, a dangling-id set and callbacks, and owns no storage.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/asset-library.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssetLibrary } from "./asset-library";

const assets = [
  { id: "a1", name: "chart.png", mime: "image/png", size: 2048, width: 800, height: 600, hash: "h1", createdAt: "2026-08-21T10:00:00.000Z" },
  { id: "a2", name: "logo.png", mime: "image/png", size: 1024, width: 100, height: 100, hash: "h2", createdAt: "2026-08-21T10:00:00.000Z" },
];

const base = {
  lang: "en-US" as const,
  assets,
  usage: { a1: 3, a2: 0 },
  danglingIds: new Set<string>(),
  busyId: null,
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onInsert: undefined,
  onUpload: vi.fn(),
};

describe("AssetLibrary", () => {
  // ★★★ THE ONLY DETECTOR THAT WILL EVER EXIST. axe cannot see two controls
  //     sharing an accessible name — in ANY view, at ANY seed size — so this
  //     test, rendering TWO rows, is the entire coverage for WCAG 2.4.6 here.
  it("gives every per-row control a row-unique accessible name", () => {
    render(<AssetLibrary {...base} onInsert={vi.fn()} />);
    for (const verb of [/rename/i, /delete/i, /insert/i]) {
      const names = screen.getAllByRole("button", { name: verb }).map((b) => b.getAttribute("aria-label"));
      expect(new Set(names).size).toBe(names.length);
      expect(names.some((n) => n?.includes("chart.png"))).toBe(true);
      expect(names.some((n) => n?.includes("logo.png"))).toBe(true);
    }
  });

  it("shows how many documents use each asset", () => {
    render(<AssetLibrary {...base} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  // ★★ Not colour alone: the dangling state carries a non-colour marker, the
  //    same rule ResourcePicker's data-dangling-marker follows.
  it("marks a dangling asset with a non-colour cue", () => {
    render(<AssetLibrary {...base} danglingIds={new Set(["a1"])} />);
    const row = screen.getByText("chart.png").closest("tr");
    expect(row?.querySelector("[data-dangling-marker]")).not.toBeNull();
  });

  it("does not mark a healthy asset", () => {
    render(<AssetLibrary {...base} />);
    const row = screen.getByText("logo.png").closest("tr");
    expect(row?.querySelector("[data-dangling-marker]")).toBeNull();
  });

  it("renders no insert control when no insert handler is supplied", () => {
    render(<AssetLibrary {...base} onInsert={undefined} />);
    expect(screen.queryByRole("button", { name: /insert/i })).toBeNull();
  });

  it("disables that row's controls while it is busy, and only that row", () => {
    render(<AssetLibrary {...base} busyId="a1" />);
    expect(screen.getByRole("button", { name: /delete.*chart\.png/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /delete.*logo\.png/i })).toBeEnabled();
  });

  it("calls onDelete with the asset id", async () => {
    const onDelete = vi.fn();
    render(<AssetLibrary {...base} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: /delete.*chart\.png/i }));
    expect(onDelete).toHaveBeenCalledWith("a1");
  });

  it("shows a total size disclosure", () => {
    render(<AssetLibrary {...base} />);
    expect(screen.getByText(/3(\.0)? KB|3072/)).toBeInTheDocument();
  });

  it("renders an empty state rather than a headerless table", () => {
    render(<AssetLibrary {...base} assets={[]} usage={{}} />);
    expect(screen.queryByRole("table")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/asset-library.test.tsx --reporter=dot > /tmp/t15.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t15.log
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Write `src/app/asset-library.tsx` as a presentational component with this exact prop contract:

```ts
export interface AssetLibraryProps {
  lang: Lang;
  assets: readonly DocumentAsset[];
  /** id → number of documents whose blocks reference it. */
  usage: Readonly<Record<string, number>>;
  /** Ids whose metadata exists but whose bytes do not — the dangling case. */
  danglingIds: ReadonlySet<string>;
  /** Id currently mid-write; that row's controls disable, others stay live. */
  busyId: string | null;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Absent in the management mounting — no insert control renders then. */
  onInsert?: (id: string) => void;
  onUpload: (file: File) => void;
}
```

Requirements the tests above pin:

- A `<table>` of assets; **no table at all** when the list is empty (render the empty state instead).
- Every per-row button's `aria-label` is `` `${t(lang, verb)} – ${asset.name}` `` — the row-unique form. Never a bare "Delete".
- The dangling row renders a `<span data-dangling-marker aria-hidden>` warning glyph beside the name, present-and-`invisible` in the healthy state so the row keeps one width.
- The upload control is `FilePickerButton` with `accept={ASSET_MIME_ALLOWED.join(",")}`.
- The library is also a drop target: `onDragOver` preventing default, `onDrop` reading `e.dataTransfer.files` and calling `onUpload` per file.
- A total-size disclosure line summing `assets.map(a => a.size)`. Disclosure only — there is no per-workspace cap to enforce.
- Sortable headers use `SortResizeTh` (never a hand-rolled `<th>` + `SortHeaderButton` trio), passing `onResize` only if the surface stores widths — omit it rather than passing a no-op, which draws a grip that does nothing.
- Delete is confirm-gated via the shared `ConfirmDialog`. The confirm text names the usage count when it is greater than zero, because deleting an in-use asset leaves visible holes in documents.

★★ **Delete marks, it does not cascade.** `onDelete` removes the metadata row and the byte row. It must **not** rewrite any document's blocks — an asset delete is not a document mutation, `applyDocMutation` never fires, no version before-image is captured, and a cascade that stripped blocks would be unrecoverable.

- [ ] **Step 4: Run the tests, typecheck and lint**

```bash
npx vitest run src/app/asset-library.test.tsx --reporter=dot > /tmp/t15.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t15.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/asset-library.tsx; echo "EXIT=$?"
```

Expected: all three `EXIT=0`.

- [ ] **Step 5: Mutation-check the unique-name test**

Temporarily change one row's `aria-label` to a bare `t(lang, "delete")` and re-run. The unique-name test MUST go red. Revert.

★★ A guard test that survives the mutation of the line it guards is not a guard. Verify, then revert — and sweep for live mutants before reporting.

- [ ] **Step 6: Commit**

```bash
git add src/app/asset-library.tsx src/app/asset-library.test.tsx
git commit -m "feat: add the shared asset library component"
```

---

### Task 16: the modal mounting

**Files:**
- Create: `src/app/asset-library-modal.tsx`
- Test: `src/app/asset-library-modal.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/asset-library-modal.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssetLibraryModal } from "./asset-library-modal";

const props = {
  lang: "en-US" as const,
  open: true,
  onClose: vi.fn(),
  assets: [{ id: "a1", name: "chart.png", mime: "image/png", size: 2048, width: 800, height: 600, hash: "h1", createdAt: "" }],
  usage: { a1: 1 },
  danglingIds: new Set<string>(),
  busyId: null,
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onInsert: vi.fn(),
  onUpload: vi.fn(),
};

describe("AssetLibraryModal", () => {
  it("renders the library inside a dialog", () => {
    render(<AssetLibraryModal {...props} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("chart.png")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(<AssetLibraryModal {...props} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // ★★ Insert must CLOSE the modal. Leaving it open after an insert puts the
  //    dialog over the paragraph the user just changed, so they cannot see the
  //    result of their own action.
  it("closes after an insert and forwards the id", async () => {
    const onInsert = vi.fn();
    const onClose = vi.fn();
    render(<AssetLibraryModal {...props} onInsert={onInsert} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /insert.*chart\.png/i }));
    expect(onInsert).toHaveBeenCalledWith("a1");
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/asset-library-modal.test.tsx --reporter=dot > /tmp/t16.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t16.log
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// src/app/asset-library-modal.tsx — the INSERT mounting of AssetLibrary.
//
// ★ The library itself is unchanged between mountings; this file adds only the
// Modal chrome and the close-on-insert wrapper. Two mountings of one component
// is the whole point — a separate "picker" would drift from the manager on
// usage counts, rename and the dangling marker.
"use client";
import { Modal } from "./modal";
import { AssetLibrary, type AssetLibraryProps } from "./asset-library";
import { t, type Lang } from "./i18n";

export interface AssetLibraryModalProps extends AssetLibraryProps {
  open: boolean;
  onClose: () => void;
  onInsert: (id: string) => void;
  lang: Lang;
}

export function AssetLibraryModal({ open, onClose, onInsert, ...rest }: AssetLibraryModalProps) {
  return (
    <Modal open={open} onClose={onClose} lang={rest.lang} title={t(rest.lang, "assetLibraryTitle")}>
      <AssetLibrary
        {...rest}
        onInsert={(id) => { onInsert(id); onClose(); }}
      />
    </Modal>
  );
}
```

★ Check `Modal`'s real prop names before writing this — it takes `open`, `onClose`, `lang`, `children` and a title-ish prop whose exact name you must read off `modal.tsx`. `Modal` **stacks**, so opening this over an already-open dialog is supported; do not add stacking logic of your own.

- [ ] **Step 4: Run the tests, typecheck and lint**

```bash
npx vitest run src/app/asset-library-modal.test.tsx --reporter=dot > /tmp/t16.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t16.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/asset-library-modal.tsx; echo "EXIT=$?"
```

Expected: all three `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/asset-library-modal.tsx src/app/asset-library-modal.test.tsx
git commit -m "feat: mount the asset library in a modal for insertion"
```

---

### Task 17: thread `tursoConfig` and mount the library inline

**Files:**
- Modify: `src/app/workspace-section-types.ts`
- Modify: `src/app/workspace-section.tsx`
- Modify: `src/app/documents-panel.tsx` (**budget: ≤8 lines**)
- Test: `src/app/workspace-section.test.tsx`

`documents-panel.tsx` has no `tursoConfig` today. Thread it exactly as `chatTursoConfig` is threaded to the chat panel.

- [ ] **Step 1: Check the budget before you start**

```bash
node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"
```

Expected: `792`. If the mount needs more than 8 lines, extract the mount into a small `documents-asset-section.tsx` and add a single-line `<DocumentsAssetSection … />` here instead. Do **not** run `check-file-sizes.mjs --update`.

- [ ] **Step 2: Write the failing test**

Append to `src/app/workspace-section.test.tsx`:

```tsx
describe("documents asset library gating", () => {
  // ★★ The gate is `tursoConfig !== null`, NEVER `storageConfig.kind === "turso"`
  //    alone — kind can be set while the config is unset or quarantined.
  it("enables the library when a usable Turso config exists", () => {
    renderSection({ storageConfig: { kind: "turso" }, tursoUrl: "https://db.turso.io", tursoToken: "t" });
    expect(screen.getByRole("button", { name: /upload/i })).toBeEnabled();
  });

  it("disables the library when the kind is turso but the config is unset", () => {
    renderSection({ storageConfig: { kind: "turso" }, tursoUrl: "", tursoToken: "" });
    expect(screen.getByRole("button", { name: /upload/i })).toBeDisabled();
  });

  it("disables the library on a file backend", () => {
    renderSection({ storageConfig: { kind: "file" }, tursoUrl: "", tursoToken: "" });
    expect(screen.getByRole("button", { name: /upload/i })).toBeDisabled();
  });

  // ★★ Documents themselves stay UNIVERSAL — only the asset feature is gated.
  //    Gating the view would drop it from A11Y_VIEWS, which decision 5 rejected.
  it("still renders the documents list on a file backend", () => {
    renderSection({ storageConfig: { kind: "file" }, tursoUrl: "", tursoToken: "" });
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
```

★ Reuse the file's existing render helper and settings-fixture shape rather than inventing `renderSection` — read the neighbouring `chatTursoMode` tests and copy their harness.

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run src/app/workspace-section.test.tsx -t "documents asset library gating" --reporter=dot > /tmp/t17.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t17.log
```

Expected: FAIL — no upload button exists.

- [ ] **Step 4: Thread the prop**

In `src/app/workspace-section.tsx`, reuse the `chatTursoConfig` memo already computed there and pass it to the documents panel:

```tsx
            assetsTursoConfig={chatTursoConfig}
```

★ Reuse it; do not compute a second `getTursoConfig(tursoUrl, tursoToken)`. Two memos over the same inputs is a second source of truth that can drift.

Add the prop to `src/app/workspace-section-types.ts`:

```ts
  /** Non-null only when a USABLE Turso config exists. Gates the document asset
   *  feature — never `storageConfig.kind`, which can be set while the config is
   *  unset or quarantined. */
  assetsTursoConfig: TursoConfig | null;
```

- [ ] **Step 5: Mount the library inline**

In `src/app/documents-panel.tsx`, beside `<DocumentLinksSection …>`, add the mount within the 8-line budget, passing `assetsTursoConfig` through to a `useDocumentAssets` call whose handlers Task 18 supplies.

- [ ] **Step 6: Re-check the budget**

```bash
node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/size.log
```

Expected: the count is ≤800 and `EXIT=0`.

- [ ] **Step 7: Run the tests, typecheck and lint**

```bash
npx vitest run src/app/workspace-section.test.tsx --reporter=dot > /tmp/t17.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t17.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: all three `EXIT=0`.

- [ ] **Step 8: Commit**

```bash
git add src/app/workspace-section.tsx src/app/workspace-section-types.ts src/app/documents-panel.tsx src/app/workspace-section.test.tsx
git commit -m "feat: gate and mount the asset library on the documents panel"
```

---

### Task 18: upload wiring — metadata first, then bytes

**Files:**
- Create: `src/app/use-document-assets.ts`
- Test: `src/app/use-document-assets.test.tsx`

The write-order decision lives here and nowhere else.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/use-document-assets.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDocumentAssets } from "./use-document-assets";

vi.mock("./document-assets-store", () => ({
  saveAssetData: vi.fn(), deleteAssetData: vi.fn(), loadAssetDataIds: vi.fn(),
}));
import { saveAssetData, loadAssetDataIds } from "./document-assets-store";

const config = { httpUrl: "https://db.turso.io", authToken: "t" } as never;

beforeEach(() => {
  vi.mocked(saveAssetData).mockReset().mockResolvedValue(undefined);
  vi.mocked(loadAssetDataIds).mockReset().mockResolvedValue([]);
});

describe("useDocumentAssets — write order", () => {
  // ★★★ METADATA FIRST, THEN BYTES. This is the ONE test that pins the decision
  //     that removes the whole orphan class. Inverting it means a failed upload
  //     leaves an invisible byte row nobody references, and a reclaim action
  //     would have to be built.
  it("commits the metadata row BEFORE writing the bytes", async () => {
    const order: string[] = [];
    const setAssets = vi.fn(() => { order.push("metadata"); });
    vi.mocked(saveAssetData).mockImplementation(async () => { order.push("bytes"); });

    const { result } = renderHook(() => useDocumentAssets({ config, assets: [], setAssets, projectId: "p1" }));
    await act(async () => { await result.current.upload(pngFile()); });

    expect(order).toEqual(["metadata", "bytes"]);
  });

  it("leaves the metadata row in place when the byte write fails", async () => {
    const setAssets = vi.fn();
    vi.mocked(saveAssetData).mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useDocumentAssets({ config, assets: [], setAssets, projectId: "p1" }));
    await act(async () => { await result.current.upload(pngFile()); });

    // The row survives — that IS the dangling case, and it is visible and
    // repairable by re-uploading over the same id.
    expect(setAssets).toHaveBeenCalledTimes(1);
    expect(result.current.error).not.toBeNull();
  });

  it("reuses an existing asset instead of storing a duplicate", async () => {
    const setAssets = vi.fn();
    const existing = [{ id: "a1", name: "x.png", mime: "image/png", size: 3, hash: await knownHash(), createdAt: "" }];
    const { result } = renderHook(() => useDocumentAssets({ config, assets: existing, setAssets, projectId: "p1" }));
    await act(async () => { await result.current.upload(pngFile()); });

    expect(saveAssetData).not.toHaveBeenCalled();
    expect(setAssets).not.toHaveBeenCalled();
    expect(result.current.lastId).toBe("a1");
  });

  it("rejects a disallowed format without touching either store", async () => {
    const setAssets = vi.fn();
    const { result } = renderHook(() => useDocumentAssets({ config, assets: [], setAssets, projectId: "p1" }));
    await act(async () => { await result.current.upload(new File(["x"], "a.gif", { type: "image/gif" })); });

    expect(setAssets).not.toHaveBeenCalled();
    expect(saveAssetData).not.toHaveBeenCalled();
    expect(result.current.error).toBe("format");
  });

  it("reports which assets are dangling by diffing metadata against byte ids", async () => {
    vi.mocked(loadAssetDataIds).mockResolvedValue(["a1"]);
    const assets = [
      { id: "a1", name: "x", mime: "image/png", size: 1, hash: "h1", createdAt: "" },
      { id: "a2", name: "y", mime: "image/png", size: 1, hash: "h2", createdAt: "" },
    ];
    const { result } = renderHook(() => useDocumentAssets({ config, assets, setAssets: vi.fn(), projectId: "p1" }));
    await waitFor(() => expect(result.current.danglingIds.has("a2")).toBe(true));
    expect(result.current.danglingIds.has("a1")).toBe(false);
  });
});
```

Define `pngFile()` and `knownHash()` as local helpers building the same 24-byte PNG header the upload tests use, wrapped in a `File`.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/use-document-assets.test.tsx --reporter=dot > /tmp/t18.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t18.log
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Write `src/app/use-document-assets.ts` as a deps-object hook:

```ts
export interface UseDocumentAssetsDeps {
  config: TursoConfig | null;
  assets: readonly DocumentAsset[];
  setAssets: (next: readonly DocumentAsset[]) => void;
  projectId: string;
}
```

returning `{ upload, remove, rename, danglingIds, busyId, error, lastId }`.

`upload(file)` runs, in this exact order:

1. `checkUploadCandidate(file)` — bail on `format`/`empty`/`tooLargeRaw` with no store call at all.
2. Read the bytes, `processUpload(bytes, file.type, encodeViaCanvas)` — bail on its reason code.
3. `hashBytes(stored)`, then `findDuplicate(assets, hash)` — on a hit, set `lastId` to the existing id and return **without writing anything**.
4. Mint the id, build the `DocumentAsset`, and call `setAssets([...assets, asset])`. **This is the metadata write, and it comes first.**
5. `await saveAssetData(config, { id, projectId, data: bytesToBase64(stored) })`.
6. On a throw from step 5, set `error` and **leave the metadata row alone** — that row is now the dangling case, which is visible, self-describing and repaired by re-uploading over the same id.

★★ `busyId` is set around step 5 and cleared in a `finally`. The measured write is ~1.8s for a 5 MB image, so this is a visible state, not a formality — the library disables that row's controls while it is set.

★★ `encodeViaCanvas` is the browser-only `ImageEncoder` seam from Task 13, defined in this file (not in the pure module) so `document-asset-upload.ts` stays testable in jsdom.

★ `react-hooks/set-state-in-effect` is banned. The dangling diff runs in an effect that `await`s `loadAssetDataIds` and sets state in the **async continuation**, never synchronously in the effect body.

- [ ] **Step 4: Run the tests, typecheck and lint**

```bash
npx vitest run src/app/use-document-assets.test.tsx --reporter=dot > /tmp/t18.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t18.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/use-document-assets.ts; echo "EXIT=$?"
```

Expected: all three `EXIT=0`.

- [ ] **Step 5: Mutation-check the write-order test**

Swap steps 4 and 5 so bytes go first, re-run, and confirm the "commits the metadata row BEFORE writing the bytes" test goes red. Revert.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-document-assets.ts src/app/use-document-assets.test.tsx
git commit -m "feat: upload assets metadata-first so a failed write degrades to dangling"
```

---

### Task 19: insertion — picker, paste and drop

**Files:**
- Modify: `src/app/rich-text-editor.tsx`
- Test: `src/app/rich-text-editor.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe("image paste and drop", () => {
  it("calls onImageFiles for an image on the clipboard and stops the default paste", () => {
    const onImageFiles = vi.fn();
    const { editorProps } = buildEditorProps({ onImageFiles });
    const event = pasteEventWith([new File(["x"], "a.png", { type: "image/png" })]);
    expect(editorProps.handlePaste(null, event)).toBe(true);
    expect(onImageFiles).toHaveBeenCalled();
  });

  // ★★ THE REGRESSION THIS GUARDS: swallowing an ordinary paste would break
  //    every rich field in the app, not just documents. The handler must return
  //    false so ProseMirror's own HTML/text handling runs untouched.
  it("lets an ordinary HTML paste fall through untouched", () => {
    const onImageFiles = vi.fn();
    const { editorProps } = buildEditorProps({ onImageFiles });
    expect(editorProps.handlePaste(null, pasteEventWith([]))).toBe(false);
    expect(onImageFiles).not.toHaveBeenCalled();
  });

  it("ignores a non-image file on the clipboard", () => {
    const onImageFiles = vi.fn();
    const { editorProps } = buildEditorProps({ onImageFiles });
    const event = pasteEventWith([new File(["x"], "a.txt", { type: "text/plain" })]);
    expect(editorProps.handlePaste(null, event)).toBe(false);
    expect(onImageFiles).not.toHaveBeenCalled();
  });

  it("does nothing at all when no handler is supplied", () => {
    const { editorProps } = buildEditorProps({});
    expect(editorProps.handlePaste(null, pasteEventWith([
      new File(["x"], "a.png", { type: "image/png" }),
    ]))).toBe(false);
  });

  it("handles a dropped image file", () => {
    const onImageFiles = vi.fn();
    const { editorProps } = buildEditorProps({ onImageFiles });
    expect(editorProps.handleDrop(null, dropEventWith([
      new File(["x"], "a.png", { type: "image/png" }),
    ]))).toBe(true);
    expect(onImageFiles).toHaveBeenCalled();
  });

  // ★★★ A block REORDER drag carries no files. If this returned true the
  //     gutter's reorder grip would stop working — the two handlers share the
  //     HTML5 drag channel and this is the only thing keeping them apart.
  it("lets a file-less drop through, so block reorder still works", () => {
    const onImageFiles = vi.fn();
    const { editorProps } = buildEditorProps({ onImageFiles });
    expect(editorProps.handleDrop(null, dropEventWith([]))).toBe(false);
    expect(onImageFiles).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/rich-text-editor.test.tsx -t "image paste and drop" --reporter=dot > /tmp/t19.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t19.log
```

Expected: FAIL — `handlePaste` is not defined on `editorProps`.

- [ ] **Step 3: Implement**

Add an optional `onImageFiles?: (files: File[]) => void` prop to `RichTextEditor`, and inside the existing `editorProps` object:

```ts
      // ★★ Returns TRUE only when image files were actually taken. Returning
      // true unconditionally would swallow every ordinary HTML and text paste,
      // which the rich-text sanitizers already own — a regression across every
      // rich field, not just documents.
      handlePaste: (_view, event: ClipboardEvent) => {
        if (!onImageFiles) return false;
        const files = imageFilesFrom(event.clipboardData?.files);
        if (!files.length) return false;
        onImageFiles(files);
        return true;
      },
      // ★★★ A block REORDER drag carries NO files, so this returns false for it
      // and the gutter's reorder grip keeps working. The two share the HTML5
      // drag channel; this check is the only thing separating them.
      handleDrop: (_view, event: DragEvent) => {
        if (!onImageFiles) return false;
        const files = imageFilesFrom(event.dataTransfer?.files);
        if (!files.length) return false;
        event.preventDefault();
        onImageFiles(files);
        return true;
      },
```

with a module-local helper:

```ts
function imageFilesFrom(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) =>
    (ASSET_MIME_ALLOWED as readonly string[]).includes(f.type));
}
```

★ Check the real `handlePaste`/`handleDrop` signatures against the installed Tiptap before writing these — read `node_modules/@tiptap/core/dist/index.d.ts`, not memory.

- [ ] **Step 4: Wire insertion in the documents surface**

In the documents surface, `onImageFiles` calls `upload(file)` from Task 18 and, on success, inserts `<img data-asset-id="{id}" alt="{name}">` at the cursor. Enforce `ASSET_MAX_PER_DOCUMENT` **at insert**: count distinct `data-asset-id` values already in the document's blocks and refuse past 20 with a translated message.

★★ Enforce at write, disclose at load, never truncate silently. Never drop an over-cap image on load.

- [ ] **Step 5: Run the tests, typecheck and lint**

```bash
npx vitest run src/app/rich-text-editor.test.tsx --reporter=dot > /tmp/t19.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t19.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: all three `EXIT=0`.

★★ Tiptap commands are typed by module augmentation, so a toolbar calling a command whose extension only the editor imports is green in vitest and red in tsc. Run tsc, not just the tests.

- [ ] **Step 6: Commit**

```bash
git add src/app/rich-text-editor.tsx src/app/rich-text-editor.test.tsx src/app/documents-panel.tsx
git commit -m "feat: insert images by picker, clipboard paste and drop"
```

---

### Task 20: preview resolves ids to blob URLs

**Files:**
- Create: `src/app/document-asset-images.ts`
- Modify: `src/app/document-preview.tsx`
- Test: `src/app/document-asset-images.test.ts`

Imperative on purpose: `react-hooks/set-state-in-effect` is banned, and this needs no React state at all.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/document-asset-images.test.ts
import { describe, expect, it, vi } from "vitest";
import { attachAssetImages } from "./document-asset-images";

function root(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("attachAssetImages", () => {
  it("sets a blob URL as src for each referenced asset", async () => {
    const el = root('<img data-asset-id="a1">');
    const detach = await attachAssetImages(el, async () => "QUJD");
    expect(el.querySelector("img")?.getAttribute("src")).toMatch(/^blob:/);
    detach();
  });

  // ★★ ~67 MB of base64 in one dangerouslySetInnerHTML string is the reason
  //    this exists. Never inline.
  it("never inlines base64 into src", async () => {
    const el = root('<img data-asset-id="a1">');
    const detach = await attachAssetImages(el, async () => "QUJD");
    expect(el.querySelector("img")?.getAttribute("src")).not.toContain("base64");
    detach();
  });

  it("fetches each distinct id exactly once, however many times it appears", async () => {
    const el = root('<img data-asset-id="a1"><img data-asset-id="a1"><img data-asset-id="a2">');
    const load = vi.fn(async () => "QUJD");
    const detach = await attachAssetImages(el, load);
    expect(load).toHaveBeenCalledTimes(2);
    detach();
  });

  it("marks an image whose bytes are missing, and leaves src unset", async () => {
    const el = root('<img data-asset-id="gone">');
    const detach = await attachAssetImages(el, async () => null);
    const img = el.querySelector("img");
    expect(img?.hasAttribute("src")).toBe(false);
    expect(img?.getAttribute("data-asset-missing")).toBe("true");
    detach();
  });

  it("marks an image whose load threw, rather than propagating", async () => {
    const el = root('<img data-asset-id="boom">');
    const detach = await attachAssetImages(el, async () => { throw new Error("network"); });
    expect(el.querySelector("img")?.getAttribute("data-asset-missing")).toBe("true");
    detach();
  });

  it("revokes every object URL it created when detached", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const el = root('<img data-asset-id="a1"><img data-asset-id="a2">');
    const detach = await attachAssetImages(el, async () => "QUJD");
    detach();
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the subtree references no assets", async () => {
    const load = vi.fn(async () => "QUJD");
    const detach = await attachAssetImages(root("<p>no images</p>"), load);
    expect(load).not.toHaveBeenCalled();
    detach();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/document-asset-images.test.ts --reporter=dot > /tmp/t20.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t20.log
```

Expected: FAIL — module not found. If jsdom lacks `URL.createObjectURL`, stub it in the test file exactly as the repo's other blob tests do.

- [ ] **Step 3: Implement**

```ts
// src/app/document-asset-images.ts
//
// Resolves `<img data-asset-id>` inside an ALREADY-RENDERED subtree to blob
// object URLs.
//
// ★★★ IMPERATIVE ON PURPOSE, TWICE OVER. First, the preview hands one HTML
// string to dangerouslySetInnerHTML, so there is no React element to give a
// src to. Second, `react-hooks/set-state-in-effect` is banned and fatal — this
// needs no state at all, so it cannot trip it.
//
// ★★ NEVER INLINE BASE64. Ten images would put ~67 MB into that one string.

export type AssetByteLoader = (id: string) => Promise<string | null>;

/** Returns a detach function that revokes every URL it created. Call it from
 *  the effect's cleanup — an un-revoked object URL leaks its whole payload for
 *  the lifetime of the document. */
export async function attachAssetImages(
  rootEl: HTMLElement, load: AssetByteLoader,
): Promise<() => void> {
  const imgs = Array.from(rootEl.querySelectorAll<HTMLImageElement>("img[data-asset-id]"));
  if (!imgs.length) return () => {};

  const ids = Array.from(new Set(imgs.map((i) => i.getAttribute("data-asset-id") ?? "")));
  const urls = new Map<string, string>();

  await Promise.all(ids.map(async (id) => {
    try {
      const b64 = await load(id);
      if (!b64) return;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      urls.set(id, URL.createObjectURL(new Blob([bytes])));
    } catch {
      // Swallowed deliberately: a byte row that will not load IS the dangling
      // case, and the marker below is how the user is told. Propagating would
      // take down the whole preview for one missing image.
    }
  }));

  for (const img of imgs) {
    const url = urls.get(img.getAttribute("data-asset-id") ?? "");
    if (url) img.setAttribute("src", url);
    else img.setAttribute("data-asset-missing", "true");
  }

  return () => { for (const url of urls.values()) URL.revokeObjectURL(url); };
}
```

- [ ] **Step 4: Wire it into the preview**

In `src/app/document-preview.tsx`, add a `ref` to the existing `data-document-preview-body` div and an effect keyed on `[html, config]` that calls `attachAssetImages(ref.current, loader)` and revokes on cleanup, guarding against the async result landing after unmount.

★★★ Do **not** add a second sanitize pass, and do **not** touch the `useMemo` above the `!doc` early return — a hook after a conditional return is a rules-of-hooks violation and lint is `--max-warnings=0`.

Style `[data-asset-missing]` in `globals.css` with a visible placeholder: a dashed border and the missing-asset marker glyph. Sanctioned AIPM tokens only — no off-palette colours, gradients or shadows, and no `shadow-*` Tailwind class (the palette sweep scans CSS for `box-shadow` and would not see it).

- [ ] **Step 5: Run the tests, typecheck and lint**

```bash
npx vitest run src/app/document-asset-images.test.ts src/app/document-preview.test.tsx --reporter=dot > /tmp/t20.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t20.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: all three `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/document-asset-images.ts src/app/document-asset-images.test.ts src/app/document-preview.tsx src/app/globals.css
git commit -m "feat: render document images from blob URLs in the preview"
```

---

### Task 21: export — HTML inlines, DOCX and PPTX disclose

**Files:**
- Modify: `src/app/doc-render-html.ts`
- Modify: `src/app/doc-render-docx.ts`
- Modify: `src/app/doc-render-pptx.ts`
- Test: `src/app/doc-render-html.test.ts`, `src/app/doc-render-docx.test.ts`, `src/app/doc-render-pptx.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("images in standalone HTML", () => {
  // A single downloadable file must be self-contained, so standalone is the ONE
  // place base64 is correct. PDF is this same mode through the print dialog —
  // there is no PDF writer and no PDF dependency, and this must not add one.
  it("inlines asset bytes as a data URI in standalone mode", () => {
    const html = renderDocumentHtml(docWithImage(), ws, "en-US", "standalone", { a1: "QUJD" });
    expect(html).toContain("data:image/png;base64,QUJD");
  });

  it("leaves the id unresolved in preview mode, where blob URLs take over", () => {
    const html = renderDocumentHtml(docWithImage(), ws, "en-US", "preview");
    expect(html).toContain('data-asset-id="a1"');
    expect(html).not.toContain("base64");
  });

  it("renders a marker for an asset with no bytes", () => {
    const html = renderDocumentHtml(docWithImage(), ws, "en-US", "standalone", {});
    expect(html).toContain("data-asset-missing");
  });
});

describe("images in DOCX", () => {
  // ★★ A VISIBLE placeholder, never a silent drop. Media parts land in S3c-2.
  it("emits a visible placeholder naming the omitted image", async () => {
    const out = await renderDocumentDocx(docWithImage(), ws, "en-US");
    expect(textOf(out)).toContain("chart.png");
  });

  it("does not silently drop the paragraph the image sat in", async () => {
    const out = await renderDocumentDocx(docWithImage(), ws, "en-US");
    expect(textOf(out)).toContain("Chart");
  });
});
```

Write the PPTX equivalent of both DOCX tests.

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run src/app/doc-render-html.test.ts src/app/doc-render-docx.test.ts src/app/doc-render-pptx.test.ts --reporter=dot > /tmp/t21.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t21.log
```

Expected: FAIL — the renderer takes no asset argument.

- [ ] **Step 3: Implement**

- `renderDocumentHtml` gains an **optional** trailing `assets?: Record<string, string>` (id → base64). In `standalone` mode it rewrites each `<img data-asset-id>` to `src="data:{mime};base64,{data}"`; a missing id gets `data-asset-missing`. In `preview` mode it changes nothing — Task 20 owns that.
- `doc-render-docx.ts` and `doc-render-pptx.ts` replace each `<img data-asset-id>` with a translated placeholder run naming the asset.

★ The argument is optional so every existing call site keeps compiling and behaving identically. Do not make it required.

- [ ] **Step 4: Run the tests, typecheck and lint**

```bash
npx vitest run src/app/doc-render-html.test.ts src/app/doc-render-docx.test.ts src/app/doc-render-pptx.test.ts --reporter=dot > /tmp/t21.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t21.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/doc-render-html.ts src/app/doc-render-docx.ts src/app/doc-render-pptx.ts src/app/doc-render-html.test.ts src/app/doc-render-docx.test.ts src/app/doc-render-pptx.test.ts
git commit -m "feat: inline images in standalone HTML and disclose them in DOCX/PPTX"
```

---

### Task 22: i18n — EN and DE

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`
- Test: `src/app/i18n-encoding.test.ts` (existing gate)

- [ ] **Step 1: Add the EN keys**

Add to `src/app/i18n.ts`, beside the other `documents*` keys:

```ts
  assetLibraryTitle: "Images",
  assetLibraryEmpty: "No images yet. Upload one to use it in a document.",
  assetLibraryUpload: "Upload image",
  assetLibraryTotal: "{0} images, {1} total",
  assetLibraryUsage: "Used in",
  assetLibraryDangling: "Image data is missing — re-upload to repair",
  assetLibraryTursoOnly: "Images need a Turso project. Documents work on every backend.",
  assetLibraryDeleteConfirm: "Delete this image? It is used in {0} document(s), which will show a missing-image marker.",
  assetRejectFormat: "Only PNG, JPEG and WebP images can be uploaded.",
  assetRejectTooLargeRaw: "That file is too large to open.",
  assetRejectTooLargeStored: "That image is still over the size limit after resizing.",
  assetRejectDimensions: "That image's dimensions are too large.",
  assetRejectEmpty: "That file is empty.",
  assetRejectDecode: "That image could not be read.",
  assetPerDocumentCap: "A document can hold at most {0} images.",
  assetOmittedInExport: "[Image omitted: {0}]",
```

- [ ] **Step 2: Add the DE keys via a node utf8 write**

★★★ **Never use the Edit tool on `i18n.de.ts`.** It corrupts umlauts and curls double quotes — including in umlaut-free strings. The file is **CRLF**, so an anchor written with `\n` silently no-ops.

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  documentsAddBlock:";
if (!s.includes(anchor)) { console.error("ANCHOR NOT FOUND"); process.exit(1); }
const block = [
  "  assetLibraryTitle: \"Bilder\",",
  "  assetLibraryEmpty: \"Noch keine Bilder. Laden Sie eines hoch, um es in einem Dokument zu verwenden.\",",
  "  assetLibraryUpload: \"Bild hochladen\",",
  "  assetLibraryTotal: \"{0} Bilder, {1} insgesamt\",",
  "  assetLibraryUsage: \"Verwendet in\",",
  "  assetLibraryDangling: \"Bilddaten fehlen — zum Reparieren erneut hochladen\",",
  "  assetLibraryTursoOnly: \"Bilder benötigen ein Turso-Projekt. Dokumente funktionieren auf jedem Backend.\",",
  "  assetLibraryDeleteConfirm: \"Dieses Bild löschen? Es wird in {0} Dokument(en) verwendet, die dann eine Markierung für ein fehlendes Bild anzeigen.\",",
  "  assetRejectFormat: \"Es können nur PNG-, JPEG- und WebP-Bilder hochgeladen werden.\",",
  "  assetRejectTooLargeRaw: \"Diese Datei ist zu groß zum Öffnen.\",",
  "  assetRejectTooLargeStored: \"Dieses Bild überschreitet auch nach der Verkleinerung die Größenbeschränkung.\",",
  "  assetRejectDimensions: \"Die Abmessungen dieses Bildes sind zu groß.\",",
  "  assetRejectEmpty: \"Diese Datei ist leer.\",",
  "  assetRejectDecode: \"Dieses Bild konnte nicht gelesen werden.\",",
  "  assetPerDocumentCap: \"Ein Dokument kann höchstens {0} Bilder enthalten.\",",
  "  assetOmittedInExport: \"[Bild ausgelassen: {0}]\",",
].join("\r\n") + "\r\n";
s = s.replace(anchor, block + anchor);
fs.writeFileSync(p, s, "utf8");
console.log("written");
'
```

- [ ] **Step 3: Verify the umlauts survived, by byte**

```bash
grep -c "benötigen\|löschen\|können\|größ\|Öffnen\|überschreitet\|höchstens" src/app/i18n.de.ts
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8'); console.log('CRLF ok:', s.includes('assetLibraryTitle: \"Bilder\",\r\n')); console.log('no ASCII subs:', !/fuer|druecken|groesse|oeffnen/.test(s));"
```

Expected: a non-zero grep count, `CRLF ok: true`, `no ASCII subs: true`.

★ The `i18n-encoding` test **bans** `\u00XX` escapes in the file itself — the escapes above are in the *generator*, and what lands on disk is real umlaut bytes. Verify that with the grep, not by reading the script.

- [ ] **Step 4: Run the gates**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/i18n-encoding.test.ts --reporter=dot > /tmp/t22.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t22.log
```

Expected: both `EXIT=0`. `tsc` enforces EN/DE key parity, so a missed key fails here.

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: add EN and DE strings for the document asset library"
```

---

### Task 23: docs, bookkeeping and the S3c label

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/AGENTS/documents.md`
- Modify: `docs/open-followups.md`
- Modify: `docs/work-inventory.md`
- Modify: `docs/superpowers/specs/2026-08-08-documents-roadmap-s3-s4-design.md`

- [ ] **Step 1: Correct the S3c label collision**

In the roadmap spec, correct the header that still reads "design approved, unimplemented" — S3a, S4 and S3b have all shipped. Rename what shipped in 0.252.0 so the label cannot collide again: structural blocks get their own label, images keep S3c.

In `docs/open-followups.md` §113, apply the same correction.

In `docs/work-inventory.md` §3, replace the "Designed but NOT built" row for document images with a pointer to this slice, and mark the "settle the S3c label question first" note discharged.

- [ ] **Step 2: Document the new subsystem**

Add to `docs/AGENTS/documents.md`: the two stores and which is which, the metadata-first write order and *why* it removes the orphan class, the `document_asset_data`-is-not-in-`TABLE_NAMES` rule and its consequence, the measured Turso ceiling with its scope limit, and the fact that the DOCX/PPTX placeholder is interim.

In `AGENTS.md`, add **one line** to the documents bullet pointing at that section. Do not restate it — this file regrew 111% in fifteen days by absorbing exactly this kind of detail.

- [ ] **Step 3: Open follow-ups for what this slice deliberately left**

Add entries for: OOXML media machinery (S3c-2); the asset-library surface being outside axe coverage on a file-mode seed, so its unit tests are the only detector; and any pre-existing side-table cleanup gap Task 10 found.

Number them from the real maximum, not a quoted one:

```bash
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
```

- [ ] **Step 4: Run the doc gates**

```bash
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/sym.log
npm run docs:claims:check > /tmp/claims.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/claims.log
```

Expected: both `EXIT=0`.

★★ `docs:symbols:check` proves only that a backticked NAME exists — never that a claim about it is true — and it skips `SCREAMING_CASE` entirely, so every constant you added is ungated. `docs:claims:check` is a ratchet: do not add a new `path:LINE` citation. Cite the symbol.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md docs/
git commit -m "docs: record the asset subsystem and settle the S3c label collision"
```

---

### Task 24: full gate sweep

- [ ] **Step 1: Run every gate, unpiped, one at a time**

★★★ Never read a gate's exit code through a pipe — you get the pipe's status. And **never run two vitest processes at once**; machine saturation is the load-sensitive-flake condition.

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/cov.log
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/size.log
npm run dup:check > /tmp/dup.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/dup.log
```

All must be `EXIT=0`.

★ `test:shuffle` is the ONLY local reproduction of the `unit-tests-shuffled` CI gate, and this slice adds many test files. Run it.

★★ Coverage: the new **`.ts`** modules (`document-asset.ts`, `document-assets-schema.ts`, `document-assets-store.ts`, `document-asset-upload.ts`, `document-asset-images.ts`) are all coverage-gated. `use-document-assets.ts` is a deps-object hook — but it holds the write-order decision, which is real logic with real tests, so it stays **gated** rather than going into `coverage.exclude`. Exclude glue, not logic.

- [ ] **Step 2: Run the axe gate on Documents, at one worker**

```bash
curl -o /dev/null -s -w "%{time_total}\n" http://localhost:3000/
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Documents" --workers=1 > /tmp/axe.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/axe.log
```

★★★ `--workers=1` is mandatory whenever more than one view matches: CI runs axe serially, local runs it at CPU count, and over-subscription produces `Test timeout of 60000ms exceeded` failures that name no rule and no impact. Read the failure **body** — a real violation names a rule id.

★★ A green run here says **nothing** about duplicate accessible names in the library. Task 15's ≥2-row unit test is the only detector that exists.

- [ ] **Step 3: Eye-verify against a real Turso project**

CI cannot exercise a real Turso database on any path, so this is the only proof the store works end to end. Against a real Turso project, verify: upload by picker, by paste and by drop; the image renders in the preview; rename; delete leaves a visible missing-asset marker rather than stripping the block; HTML/PDF export carries the image; DOCX and PPTX show the placeholder.

- [ ] **Step 4: Prod-CSP smoke**

```bash
npm run build > /tmp/build.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/build.log
npm run e2e:smoke:prod > /tmp/smoke.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/smoke.log
```

★★★ The only local reproduction of the production CSP. This slice creates blob object URLs, and dev grants `'unsafe-inline'` on `style-src-elem` while prod is nonce-only — a whole class of defect is invisible until this runs. Owns port 3200 and refuses to start if something else holds it.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A src/app
git commit -m "fix: address gate findings from the full sweep"
```

---

### Task 25: release

- [ ] **Step 1: Pick and verify a codename**

Sci-fi/fantasy author surname, verified absent:

```bash
grep -ic "<candidate>" CHANGELOG.md
```

Expected: `0`. Try another if not.

- [ ] **Step 2: Bump the version in ALL SEVEN places**

`src/app/version.ts` (`APP_VERSION` + `APP_BUILD_DATE` + milestone) is only the first. **No gate checks the other six**, and they have drifted by up to eleven releases before:

1. `src/app/version.ts`
2. `package.json` `version`
3. `package-lock.json` — **two** occurrences, the root `version` and the `packages[""]` one
4. `README.md` shields badge — version **and** codename
5. `docs/CODEMAPS/*.md` — the `<!-- Generated: … | App <version> "<codename>" … -->` header on **all five**

```bash
grep -n "0\.253\.0" package.json package-lock.json README.md docs/CODEMAPS/*.md src/app/version.ts
```

Every hit must be updated in this same commit.

- [ ] **Step 3: CHANGELOG entry**

Add a `0.254.0` entry. ★★ **No `[session link removed]...` URL in `CHANGELOG.md`** — commit trailers are fine, this file is not.

- [ ] **Step 4: Highlight keys**

If you added a `versionHighlight*` key, append it to `APP_HIGHLIGHT_KEYS` with EN and DE strings, using Task 22's node-write method for the DE side.

- [ ] **Step 5: Verify the bump**

```bash
grep -rn "0\.254\.0" package.json package-lock.json README.md docs/CODEMAPS/*.md src/app/version.ts CHANGELOG.md | wc -l
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: at least 9 hits (version.ts, package.json, two in the lock, README, five codemaps, CHANGELOG) and `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: release 0.254.0 — document images end to end"
```

- [ ] **Step 7: STOP**

Do **not** push, open an MR, or merge. Those happen only on an explicit instruction. When that comes: push → open MR → poll the pipeline → merge **only** after it is green, never with auto-merge.

---

## Self-review

Checked against the spec, section by section.

| Spec section | Task |
|---|---|
| §1 measured Turso ceiling | Task 8 (comment), Task 9 (one-per-request), Task 11 (constants) |
| §2 metadata in `ENTITY_SPECS` | Tasks 2–7 |
| §2 bytes in the side table | Tasks 8–10 |
| §2 mime-generic store | Task 1 (non-image test), Task 8 |
| §2 metadata-first write order | Task 18 (the pinning test + its mutation check) |
| §3 Turso gate on `tursoConfig !== null` | Task 17 |
| §4 one component, two mountings | Tasks 15, 16 |
| §4 entry points: picker, paste, drop ×2 | Tasks 15 (library drop), 19 (picker, paste, editor drop) |
| §4 insertion writes `<img data-asset-id>` | Task 19 |
| §4 no sanitizer change | enforced by the "Read this before Task 1" preamble; no task touches one |
| §4 delete marks, no cascade | Task 15 |
| §5 every guard in the budget table | Tasks 11–14 |
| §5 progress requirement | Task 18 (`busyId`), Task 15 (per-row disable test) |
| §6 preview blob URLs | Task 20 |
| §6 standalone inlines, DOCX/PPTX disclose | Task 21 |
| §7 PDF out, store generic | Task 1 |
| §8 six write paths, goldens, axe blind spots | Tasks 7, 15, 24 |
| §9 out of scope | nothing implements them; Task 23 opens the follow-ups |
| §10 bookkeeping | Task 23 |

**Placeholder scan:** clean. Task 10 and Task 17 Step 5 name a grep instead of a line number because the target path is not yet identified and a guessed path would be worse than an instruction to find it; both give the exact command and the exact decision rule.

**Type consistency:** `DocumentAsset` (Task 1) is used unchanged in Tasks 2, 3, 5, 6, 14, 15. `AssetDataRow` (Task 8) is consumed by Task 9. `CandidateResult` / `UploadRejection` (Task 11) are returned by `checkHeaderDimensions` (12), `checkStoredSize` (13) and `processUpload` (13). `ImageEncoder` (13) is supplied by Task 18. `AssetByteLoader` (20) is local to that module. `ASSET_MIME_ALLOWED` (11) is consumed by Tasks 15 and 19.

**One gap found and closed during review:** Task 13's original `processUpload` recorded the downscale *target* as the stored dimensions unconditionally, which is wrong whenever `pickSmaller` discarded the re-encode — the stored bytes would then be the original at original dimensions, and every OOXML export in S3c-2 would size that image wrongly. Fixed in the implementation and pinned by the "records SOURCE dimensions when the re-encode was discarded as larger" test.
