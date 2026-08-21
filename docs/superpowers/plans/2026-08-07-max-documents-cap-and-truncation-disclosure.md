# §100 — Document cap raise + truncation disclosure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise `MAX_DOCUMENTS` 200 → 1000 and make load-time truncation impossible to miss — reported on every backend, with automatic saves paused so the truncation is never committed silently.

**Architecture:** A structurally-typed optional `diag` accumulator is threaded into `sanitizeProjectDocuments`, following the codebase's existing `ImportDiag` idiom. Each of the five load paths hands counts to its backend via a new optional `lastLoadTruncation` field; the single generic load effect in `use-storage-backend.ts` consumes it, raises a persistent banner, and sets a sticky flag the save choke point honours.

**Tech Stack:** TypeScript, React 19, Next.js 16, vitest, Playwright/axe.

**Spec:** `docs/superpowers/specs/2026-08-07-max-documents-cap-and-truncation-disclosure-design.md`

---

## Repo gate rules — read before the first command

These have each cost a real build. Non-negotiable.

1. **NEVER read a gate's exit code through a pipe.** `npm run test:run | tail` reports *tail's* status; `npx eslint … | grep -v x` inverts pass/fail. Redirect, echo `$?` unpiped, then read the file:
   ```bash
   npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
   ```
2. **Backgrounded `cmd > log; echo "EXIT=$?"` reports the echo's status.** Write the real code *into* the log: `{ cmd > log 2>&1; echo "REAL_EXIT=$?" >> log; }`
3. **`npm run lint` does NOT reproduce CI** (bare `eslint`, exits 0 on warnings). The real gate is `npx eslint --max-warnings=0 src/app`.
4. **`--reporter=basic` does not exist in vitest 4.1.8** — use `--reporter=dot`.
5. **Run `npx tsc --noEmit` after editing ANY test.** `next build` does not typecheck tests and vitest never typechecks.
6. **GREP EVERY SYMBOL BEFORE WRITING AGAINST IT.** Prefer `git grep -n` — the Grep tool times out on `src/app` in this repo.
7. **`git add` explicit paths only, and commit with `git commit --only <paths>`.** A bare `git commit` takes the whole index.
8. **No attribution trailers in commit messages.**
9. **`i18n.de.ts` and `i18n.ts` are CRLF.** The Edit tool corrupts umlauts and curls quotes there. Patch via a node utf8 write anchored on `\r\n`, then re-verify.
10. **File-size gate counts `wc -l` + 1.** Check headroom with:
    ```bash
    node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"
    ```

---

## File Structure

| File | Responsibility in this change |
|---|---|
| `src/app/document-model.ts` | Owns `MAX_DOCUMENTS` and `DocTruncationDiag`; counts what the cap dropped. **DOM-FREE BY CONTRACT** — a source scan enforces it. Type-only imports are safe; a runtime import of anything DOM-bound is not. |
| `src/app/document-versions.ts` | Threads the diag through its per-item delegation so per-version block truncation is counted. Also DOM-free. |
| `src/app/csv-codecs-decode.ts` | Declares `ImportDiag`; extends it with the two new optional counters. |
| `src/app/csv-codecs-config.ts` | `csvToDocuments` accepts and forwards the diag. |
| `src/app/markdown-codecs-core.ts` | `markdownToDocuments` accepts and forwards the diag. |
| `src/app/markdown-codecs-decode.ts` | Forwards the workspace-level diag into `markdownToDocuments`. |
| `src/app/workspace.ts` | `jsonToWorkspace` accepts `opts.diag`; `StorageBackend` gains `lastLoadTruncation`. |
| `src/app/turso-schema.ts` | `rowsToWorkspace` accepts a diag. |
| `src/app/turso-backend.ts`, `browser-backend.ts`, `local-file-backend.ts`, `sharepoint-backend.ts` | Each sets `lastLoadTruncation` after a load. |
| `src/app/use-storage-backend.ts` | Single consumer: reads the field, toasts, logs, sets the sticky flag; save choke point honours it; exposes `allowTruncatedSave()`. |
| `src/app/notifications.tsx` | `TruncatedLoadBanner` over the shared `AlertBanner`. |
| `src/app/task-manager.tsx` | Mounts the banner. |
| `src/app/i18n.ts`, `i18n.de.ts` | New keys, EN/DE parity. |

**Why the diag is structurally typed, not inherited:** `document-model.ts` must not gain a runtime dependency on a codec module (`docs/open-followups.md` §92 records an existing `settings-types ⇄ workspace ⇄ document-model` cycle). `DocTruncationDiag` is declared in `document-model.ts`; `ImportDiag` declares the same two optional fields via a **type-only** import, which is erased at compile time and cannot create a cycle.

---

### Task 1: `DocTruncationDiag` and cap counting in the sanitizer

**Files:**
- Modify: `src/app/document-model.ts:33` (the constant), `:193-205` (the sanitizer)
- Test: `src/app/document-model.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/document-model.test.ts`, inside the existing `describe("sanitizeProjectDocuments", …)`:

```typescript
  it("counts entries the cap dropped into an optional diag", () => {
    const many = Array.from({ length: MAX_DOCUMENTS + 5 }, (_, i) => doc({ id: i + 1 }));
    const diag: DocTruncationDiag = {};
    expect(sanitizeProjectDocuments(many, diag)).toHaveLength(MAX_DOCUMENTS);
    expect(diag.truncatedEntries).toBe(5);
  });

  it("leaves the diag untouched when nothing is truncated", () => {
    const diag: DocTruncationDiag = {};
    sanitizeProjectDocuments([doc()], diag);
    expect(diag.truncatedEntries).toBeUndefined();
  });

  it("still truncates when no diag is passed", () => {
    const many = Array.from({ length: MAX_DOCUMENTS + 5 }, (_, i) => doc({ id: i + 1 }));
    expect(sanitizeProjectDocuments(many)).toHaveLength(MAX_DOCUMENTS);
  });

  it("accumulates rather than overwriting, so one diag can span several calls", () => {
    const many = Array.from({ length: MAX_DOCUMENTS + 2 }, (_, i) => doc({ id: i + 1 }));
    const diag: DocTruncationDiag = {};
    sanitizeProjectDocuments(many, diag);
    sanitizeProjectDocuments(many, diag);
    expect(diag.truncatedEntries).toBe(4);
  });
```

Add `DocTruncationDiag` to the existing import block at the top of the file (it currently imports `MAX_DOCUMENTS`, `sanitizeProjectDocuments` and friends from `./document-model`).

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/document-model.test.ts --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Tests |FAIL" /tmp/t1.log
```
Expected: FAIL — `DocTruncationDiag` is not exported.

- [ ] **Step 3: Implement**

In `src/app/document-model.ts`, add above `sanitizeProjectDocuments`:

```typescript
/** Optional accumulator recording what a LOAD-TIME cap silently discarded.
 *  Structurally compatible with `ImportDiag` (csv-codecs-decode.ts) so the
 *  existing CSV/Markdown threading carries it with no extra plumbing, and
 *  declared HERE so this module needs no runtime import of a codec — that
 *  would risk the import cycle recorded in open-followups §92.
 *  ★ `truncatedEntries` counts RAW ARRAY ENTRIES past the cap, not validated
 *  documents. Counting real documents would mean sanitizing the whole tail,
 *  which reintroduces the denial-of-service the cap exists to prevent. It is
 *  therefore an UPPER BOUND — never an undercount — and every user-facing
 *  string says "entries" for that reason. */
export interface DocTruncationDiag {
  truncatedEntries?: number;
  truncatedBlocks?: number;
}
```

Replace the body of `sanitizeProjectDocuments`:

```typescript
export function sanitizeProjectDocuments(
  raw: unknown,
  diag?: DocTruncationDiag,
): ProjectDocument[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: ProjectDocument[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (out.length >= MAX_DOCUMENTS) {
      // Count the untouched tail and stop. `raw.length - i` is O(1) and never
      // understates the loss; sanitizing the tail to get an exact figure is
      // exactly the unbounded work the cap is here to refuse.
      if (diag) diag.truncatedEntries = (diag.truncatedEntries ?? 0) + (raw.length - i);
      break;
    }
    const doc = sanitizeDocument(raw[i]);
    if (!doc || seen.has(doc.id)) continue;
    seen.add(doc.id);
    out.push(doc);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/document-model.test.ts --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t1.log
```
Expected: PASS, exit 0.

- [ ] **Step 5: Confirm the DOM-free contract still holds**

```bash
npx vitest run src/app/document-model.storage-cycle.test.ts --reporter=dot > /tmp/t1b.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t1b.log
```
Expected: PASS. `DocTruncationDiag` is a type, so nothing DOM-bound was added.

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/document-model.ts src/app/document-model.test.ts -F - <<'EOF'
feat: sanitizeProjectDocuments counts what the document cap discarded

The cap has always dropped the tail with a bare `break` and no record, which
is how an over-cap load could destroy documents in silence. An optional
structurally-typed diag now records how many raw entries went unread.

Counts raw ENTRIES, not validated documents: an exact count means sanitizing
the whole tail, which is the unbounded work the cap exists to refuse. The
figure is an upper bound and never an undercount.
EOF
```

---

### Task 2: Count per-version block truncation

`sanitizeDocumentVersions` delegates each item to `sanitizeProjectDocuments`, so a version carrying more than `MAX_BLOCKS_PER_DOC` (500) blocks loads truncated and restoring it hands back a cut-off body.

**Files:**
- Modify: `src/app/document-versions.ts:113-124`
- Test: `src/app/document-versions.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
  it("counts blocks the per-version cap dropped into an optional diag", () => {
    const blocks = Array.from({ length: MAX_BLOCKS_PER_DOC + 25 }, () => ({
      type: "paragraph" as const, html: "<p>x</p>",
    }));
    const diag: DocTruncationDiag = {};
    const out = sanitizeDocumentVersions(
      [{ id: 1, documentId: 1, title: "v", blocks, savedAt: "2026-01-01T00:00:00.000Z" }],
      diag,
    );
    expect(out[0].blocks).toHaveLength(MAX_BLOCKS_PER_DOC);
    expect(diag.truncatedBlocks).toBe(25);
  });

  it("leaves truncatedBlocks undefined for an under-cap version", () => {
    const diag: DocTruncationDiag = {};
    sanitizeDocumentVersions(
      [{ id: 1, documentId: 1, title: "v", blocks: [{ type: "paragraph", html: "<p>x</p>" }], savedAt: "2026-01-01T00:00:00.000Z" }],
      diag,
    );
    expect(diag.truncatedBlocks).toBeUndefined();
  });
```

Import `MAX_BLOCKS_PER_DOC` and `DocTruncationDiag` from `./document-model`.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/document-versions.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Tests |FAIL" /tmp/t2.log
```
Expected: FAIL — `sanitizeDocumentVersions` takes one argument.

- [ ] **Step 3: Implement**

`sanitizeProjectDocuments` slices blocks inside `sanitizeDocument`, so the count must be taken here, where the input length is still visible. In `src/app/document-versions.ts`:

```typescript
export function sanitizeDocumentVersions(
  raw: unknown,
  diag?: DocTruncationDiag,
): DocVersion[] {
```

and replace the delegation at `:122-124` with:

```typescript
    const [asDoc] = sanitizeProjectDocuments([
      { id: r.documentId, title: r.title, blocks: r.blocks, createdAt: r.savedAt, updatedAt: r.savedAt },
    ]);
    // ★ The block count is taken HERE, not inside sanitizeProjectDocuments:
    // that function caps blocks inside sanitizeDocument, by which point the
    // original length is gone. A single-element array can never trip the
    // DOCUMENT cap, so no diag is passed to the delegate — passing one would
    // let a version's own truncation be miscounted as a document truncation.
    if (diag && asDoc && Array.isArray(r.blocks) && r.blocks.length > asDoc.blocks.length) {
      diag.truncatedBlocks =
        (diag.truncatedBlocks ?? 0) + (r.blocks.length - asDoc.blocks.length);
    }
```

Add `type DocTruncationDiag` to the existing `./document-model` import.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/document-versions.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t2.log
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/document-versions.ts src/app/document-versions.test.ts -F - <<'EOF'
feat: count blocks the per-version cap dropped

A version over MAX_BLOCKS_PER_DOC loaded truncated and restoring it returned a
cut-off document body with no indication. The count is taken at the delegation
site because sanitizeDocument caps blocks internally, after the original length
is no longer observable.
EOF
```

---

### Task 3: Extend `ImportDiag` and thread CSV

**Files:**
- Modify: `src/app/csv-codecs-decode.ts:106-108`, `:485`; `src/app/csv-codecs-config.ts:256`, `:276`
- Test: `src/app/csv-codecs.documents.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
  it("reports cap truncation through the workspace-level ImportDiag", () => {
    const docs = Array.from({ length: MAX_DOCUMENTS + 3 }, (_, i) => ({
      id: i + 1, title: `Doc ${i + 1}`, blocks: [], createdAt: ISO, updatedAt: ISO,
    }));
    const csv = workspaceToCsv({ ...emptyWorkspace(), documents: docs } as Workspace);
    const diag = { droppedRows: 0 };
    csvToWorkspace(csv, diag);
    expect(diag.truncatedEntries).toBe(3);
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/csv-codecs.documents.test.ts --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Tests |FAIL" /tmp/t3.log
```
Expected: FAIL — `diag.truncatedEntries` is `undefined`.

- [ ] **Step 3: Implement**

`csv-codecs-decode.ts` — extend the interface:

```typescript
export interface ImportDiag extends DocTruncationDiag {
  droppedRows: number;
}
```

with a **type-only** import at the top: `import type { DocTruncationDiag } from "./document-model";`

Then at `:485`, forward the diag:

```typescript
    const docs = csvToDocuments(s.documentsText, diag);
```

`csv-codecs-config.ts` — accept and forward:

```typescript
export function csvToDocuments(
  text: string,
  diag?: DocTruncationDiag,
): ProjectDocument[] | undefined {
```

and at `:276`:

```typescript
    const docs = sanitizeProjectDocuments(JSON.parse(rows[0][1]), diag).map(sanitizeDocumentRichFields);
```

Add `type DocTruncationDiag` to its existing `./document-model` import.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/csv-codecs.documents.test.ts --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t3.log
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/csv-codecs-decode.ts src/app/csv-codecs-config.ts src/app/csv-codecs.documents.test.ts -F - <<'EOF'
feat: thread document truncation counts through the CSV decoder

ImportDiag extends DocTruncationDiag via a type-only import, so the accumulator
LocalFileBackend and SharePointBackend already create and read now carries
document truncation with no new plumbing at those call sites.
EOF
```

---

### Task 4: Thread Markdown

**Files:**
- Modify: `src/app/markdown-codecs-decode.ts:348`; `src/app/markdown-codecs-core.ts:206`, `:226`
- Test: `src/app/markdown-codecs.documents.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
  it("reports cap truncation through the workspace-level ImportDiag", () => {
    const docs = Array.from({ length: MAX_DOCUMENTS + 3 }, (_, i) => ({
      id: i + 1, title: `Doc ${i + 1}`, blocks: [], createdAt: ISO, updatedAt: ISO,
    }));
    const md = workspaceToMarkdown({ ...emptyWorkspace(), documents: docs } as Workspace);
    const diag = { droppedRows: 0 };
    markdownToWorkspace(md, diag);
    expect(diag.truncatedEntries).toBe(3);
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/markdown-codecs.documents.test.ts --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Tests |FAIL" /tmp/t4.log
```
Expected: FAIL.

- [ ] **Step 3: Implement**

`markdown-codecs-core.ts`:

```typescript
export function markdownToDocuments(
  md: string,
  diag?: DocTruncationDiag,
): ProjectDocument[] | undefined {
```

and at `:226`:

```typescript
    const docs = sanitizeProjectDocuments(JSON.parse(m[1]), diag).map(sanitizeDocumentRichFields);
```

`markdown-codecs-decode.ts:348`:

```typescript
  const docs = markdownToDocuments(md, diag);
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/markdown-codecs.documents.test.ts --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t4.log
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/markdown-codecs-core.ts src/app/markdown-codecs-decode.ts src/app/markdown-codecs.documents.test.ts -F - <<'EOF'
feat: thread document truncation counts through the Markdown decoder
EOF
```

---

### Task 5: Thread JSON

**Files:**
- Modify: `src/app/workspace.ts:564` (signature), `:664` (the call), `:690-692` (versions call)
- Test: `src/app/workspace.documents.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
  it("reports cap truncation through an optional diag", () => {
    const docs = Array.from({ length: MAX_DOCUMENTS + 4 }, (_, i) => ({
      id: i + 1, title: `Doc ${i + 1}`, blocks: [], createdAt: ISO, updatedAt: ISO,
    }));
    const json = workspaceToJson({ ...emptyWorkspace(), documents: docs } as Workspace);
    const diag = { droppedRows: 0 };
    const ws = jsonToWorkspace(json, { diag });
    expect(ws.documents).toHaveLength(MAX_DOCUMENTS);
    expect(diag.truncatedEntries).toBe(4);
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/workspace.documents.test.ts --reporter=dot > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Tests |FAIL" /tmp/t5.log
```
Expected: FAIL — `opts.diag` is not a known property.

- [ ] **Step 3: Implement**

```typescript
export function jsonToWorkspace(
  text: string,
  opts?: { strict?: boolean; diag?: DocTruncationDiag },
): Workspace {
```

At `:664`: `const docs = sanitizeProjectDocuments(p.documents, opts?.diag).map(sanitizeDocumentRichFields);`

At `:692`: `const versions = sanitizeDocumentVersions(p.documentVersions, opts?.diag).map((v) => ({`

Add `type DocTruncationDiag` to the existing `./document-model` import.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/workspace.documents.test.ts --reporter=dot > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t5.log
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/workspace.ts src/app/workspace.documents.test.ts -F - <<'EOF'
feat: jsonToWorkspace accepts an optional truncation diag
EOF
```

---

### Task 6: Thread Turso

**Files:**
- Modify: `src/app/turso-schema.ts:121` (signature), `:211`; `src/app/turso-backend.ts:259,262,282`
- Test: `src/app/turso-schema.documents.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
  it("reports cap truncation through an optional diag", () => {
    const docs = Array.from({ length: MAX_DOCUMENTS + 2 }, (_, i) => ({
      id: i + 1, title: `Doc ${i + 1}`, blocks: [], createdAt: ISO, updatedAt: ISO,
    }));
    const rows = metaRows("documents", JSON.stringify(docs));
    const diag = { droppedRows: 0 };
    const ws = rowsToWorkspace(rows, diag);
    expect(ws.documents).toHaveLength(MAX_DOCUMENTS);
    expect(diag.truncatedEntries).toBe(2);
  });
```

Build `rows` with whatever helper the surrounding tests already use for a `meta` row — grep the file for its existing fixture builder rather than inventing one.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/turso-schema.documents.test.ts --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Tests |FAIL" /tmp/t6.log
```
Expected: FAIL.

- [ ] **Step 3: Implement**

`turso-schema.ts`:

```typescript
export function rowsToWorkspace(
  results: PipelineResultLike[],
  diag?: DocTruncationDiag,
): Workspace {
```

At `:211`: `const docs = sanitizeProjectDocuments(JSON.parse(docRow.value), diag).map(sanitizeDocumentRichFields);`

Do the same for the `documentVersions` meta row in this file — grep for `sanitizeDocumentVersions` within `turso-schema.ts` and pass `diag` there too.

`turso-backend.ts` — create a diag, pass it, publish it:

```typescript
      if (typeof blob === "string" && blob.length > 0) return jsonToWorkspace(blob, { diag });
```
```typescript
    return rowsToWorkspace(relational, diag);
```
```typescript
    const ws = isEmpty ? emptyWorkspace() : rowsToWorkspace(relational, diag);
```

with `const diag: ImportDiag = { droppedRows: 0 };` declared at the top of `load()` and `this.lastLoadTruncation = { entries: diag.truncatedEntries ?? 0, blocks: diag.truncatedBlocks ?? 0 };` before each return. Task 8 defines the field.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/turso-schema.documents.test.ts --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t6.log
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/turso-schema.ts src/app/turso-backend.ts src/app/turso-schema.documents.test.ts -F - <<'EOF'
feat: thread document truncation counts through the Turso decoder

rowsToWorkspace serves Turso single AND tenant -- they share this decoder, so
one change covers two of the six write paths.
EOF
```

---

### Task 7: IndexedDB

**Files:**
- Modify: `src/app/browser-backend.ts:270`
- Test: `src/app/browser-backend.documents.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
  it("publishes cap truncation on lastLoadTruncation", async () => {
    const docs = Array.from({ length: MAX_DOCUMENTS + 6 }, (_, i) => ({
      id: i + 1, title: `Doc ${i + 1}`, blocks: [], createdAt: ISO, updatedAt: ISO,
    }));
    const backend = new BrowserBackend();
    await backend.save({ ...emptyWorkspace(), documents: docs } as Workspace);
    const ws = await backend.load();
    expect(ws.documents).toHaveLength(MAX_DOCUMENTS);
    expect(backend.lastLoadTruncation?.entries).toBe(6);
  });
```

Note: `save` itself caps, so seed the over-cap array into IndexedDB the way the surrounding tests already do — grep this file for its existing direct-seed helper and use that rather than round-tripping through `save`.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/browser-backend.documents.test.ts --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -E "Tests |FAIL" /tmp/t7.log
```
Expected: FAIL.

- [ ] **Step 3: Implement**

In `browser-backend.ts`, declare `const diag: DocTruncationDiag = {};` near the top of `load()`, then at `:270`:

```typescript
        const docs = sanitizeProjectDocuments(idbDocuments, diag).map(sanitizeDocumentRichFields);
```

Pass the same `diag` to this file's `sanitizeDocumentVersions` call, and before `load()` returns:

```typescript
    this.lastLoadTruncation = {
      entries: diag.truncatedEntries ?? 0,
      blocks: diag.truncatedBlocks ?? 0,
    };
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/browser-backend.documents.test.ts --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t7.log
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/browser-backend.ts src/app/browser-backend.documents.test.ts -F - <<'EOF'
feat: IndexedDB publishes document truncation counts
EOF
```

---

### Task 8: `lastLoadTruncation` on the interface, set by every backend

**This task carries the most important test in the slice.** The existing `lastImportDroppedRows` reaches two backends out of six, which is exactly how a disclosure ends up partial. A registry test makes opting out a test failure rather than an oversight.

**Files:**
- Modify: `src/app/workspace.ts:459`; `local-file-backend.ts:119-126`; `sharepoint-backend.ts:107-113`
- Create: `src/app/backend-truncation-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// ★★★ THE ONE-DOOR-OF-N GUARD. Five load paths feed six write paths, and a
// disclosure that reaches only some of them is worse than none: the backends
// it misses look safe. `lastImportDroppedRows` is the cautionary precedent --
// declared on the shared interface, implemented by two backends, and silently
// absent everywhere else for the whole life of the feature.
//
// This is a SOURCE scan on purpose. Instantiating every backend needs live
// IndexedDB, a Turso client and a SharePoint token; the property we care about
// is "the author wired it up", which the source shows directly.
const BACKENDS = [
  "src/app/local-file-backend.ts",
  "src/app/sharepoint-backend.ts",
  "src/app/browser-backend.ts",
  "src/app/turso-backend.ts",
];

describe("every storage backend publishes load truncation", () => {
  it.each(BACKENDS)("%s assigns lastLoadTruncation", (path) => {
    const src = readFileSync(path, "utf8");
    expect(src).toMatch(/this\.lastLoadTruncation\s*=/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/backend-truncation-registry.test.ts --reporter=dot > /tmp/t8.log 2>&1; echo "EXIT=$?"; grep -E "Tests |FAIL" /tmp/t8.log
```
Expected: FAIL for `local-file-backend.ts` and `sharepoint-backend.ts` (Tasks 6 and 7 already did the other two).

- [ ] **Step 3: Implement**

`workspace.ts`, after `lastImportDroppedRows`:

```typescript
  /**
   * Optional: what the LAST {@link load} silently discarded to stay inside the
   * document caps. `entries` counts raw array entries past MAX_DOCUMENTS (an
   * upper bound -- see DocTruncationDiag); `blocks` counts per-version blocks
   * past MAX_BLOCKS_PER_DOC.
   * ★ Every backend must set this. A backend that leaves it undefined reports
   * no truncation and its users lose documents in silence --
   * `backend-truncation-registry.test.ts` fails the build if one is missed.
   */
  lastLoadTruncation?: { entries: number; blocks: number };
```

`local-file-backend.ts` — the diag already exists at `:122`; publish it and cover the JSON branch too:

```typescript
    this.lastImportDroppedRows = 0;
    this.lastLoadTruncation = { entries: 0, blocks: 0 };
    if (!text.trim()) return emptyWorkspace();
    const diag: ImportDiag = { droppedRows: 0 };
    if (this.format === "json") {
      const ws = jsonToWorkspace(text, { strict: true, diag });
      this.lastLoadTruncation = { entries: diag.truncatedEntries ?? 0, blocks: diag.truncatedBlocks ?? 0 };
      return ws;
    }
    const ws =
      this.format === "csv" ? csvToWorkspace(text, diag) : markdownToWorkspace(text, diag);
    this.lastImportDroppedRows = diag.droppedRows;
    this.lastLoadTruncation = { entries: diag.truncatedEntries ?? 0, blocks: diag.truncatedBlocks ?? 0 };
    return ws;
```

Add the field declaration beside `lastImportDroppedRows = 0;`:

```typescript
  /** What the most recent load() discarded to stay inside the document caps. */
  lastLoadTruncation: { entries: number; blocks: number } = { entries: 0, blocks: 0 };
```

Apply the same shape to `sharepoint-backend.ts` (its JSON branch at `:117` gains `{ strict: true, diag }`).

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/backend-truncation-registry.test.ts --reporter=dot > /tmp/t8.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t8.log
```
Expected: PASS, 4/4.

- [ ] **Step 5: Mutation-test the guard**

Delete one `this.lastLoadTruncation =` line, re-run, confirm RED, restore. A registry test that cannot fail is worse than none — it certifies coverage that does not exist.

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/workspace.ts src/app/local-file-backend.ts src/app/sharepoint-backend.ts src/app/backend-truncation-registry.test.ts -F - <<'EOF'
feat: every backend publishes what a load truncated

Adds lastLoadTruncation to the StorageBackend interface and a registry test
that fails when a backend does not set it. The precedent it guards against is
lastImportDroppedRows, which reached two backends out of six for its whole
life without anything noticing.
EOF
```

---

### Task 9: Raise the cap to 1000

Deliberately its own commit: it is the behaviour change, and every task before it was inert plumbing. Landing it separately means a bisect lands on the constant, not on the machinery.

**Files:**
- Modify: `src/app/document-model.ts:33`

- [ ] **Step 1: Change the constant**

```typescript
// ★★ Raised 200 -> 1000 in the §100 fix. ONE constant serves TWO doors: the
// load-time truncation in sanitizeProjectDocuments AND the engine's
// create/duplicate/restore refusals in document-mutations.ts. Splitting it into
// separate load/create limits was considered and rejected -- a load cap higher
// than the create cap means a legitimately-loaded project cannot be edited,
// which is the "one door of two" shape that produced six defects in S2.
export const MAX_DOCUMENTS = 1000;
```

- [ ] **Step 2: Run every document suite**

```bash
npx vitest run src/app/document-model.test.ts src/app/document-model.property.test.ts src/app/document-mutations.test.ts src/app/document-versions.test.ts --reporter=dot > /tmp/t9.log 2>&1; echo "EXIT=$?"; grep -E "Tests |FAIL" /tmp/t9.log
```
Expected: PASS. Tests interpolate `MAX_DOCUMENTS`, so they follow the constant. **Any failure here is a hardcoded `200`** — fix the test to interpolate rather than re-pinning the old number.

- [ ] **Step 3: Commit**

```bash
git commit --only src/app/document-model.ts -F - <<'EOF'
fix: raise the document cap to 1000 so real projects stop losing data

An over-cap load truncated at 200 and the next save committed the truncation,
destroying the excess permanently on all six write paths. Raising the cap
removes the loss for every realistic project while keeping a bound on hostile
input; the disclosure and save guard cover what remains.

Closes the data-loss half of open-followups §100.
EOF
```

---

### Task 10: Consume the report — toast, ring, sticky flag

**Files:**
- Modify: `src/app/use-storage-backend.ts` (load effect ~`:339`, refs ~`:154`)
- Test: `src/app/use-storage-backend.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
  it("warns and pauses saving when a load reports truncation", async () => {
    mockBackend.lastLoadTruncation = { entries: 5, blocks: 0 };
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("5"));
    expect(result.current.loadWasTruncated).toBe(true);
  });

  it("does not warn when a load reports no truncation", async () => {
    mockBackend.lastLoadTruncation = { entries: 0, blocks: 0 };
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    expect(showToast).not.toHaveBeenCalledWith("error", expect.stringContaining("could not be opened"));
    expect(result.current.loadWasTruncated).toBe(false);
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/use-storage-backend.test.tsx --reporter=dot > /tmp/t10.log 2>&1; echo "EXIT=$?"; grep -E "Tests |FAIL" /tmp/t10.log
```
Expected: FAIL — `loadWasTruncated` is not on the hook's result.

- [ ] **Step 3: Implement**

Beside `allowDestructiveRef` (`:154`):

```typescript
  // ★★ STICKY, unlike suppressNextSaveRef beside it. That ref is one-shot and
  // is set by EVERY load, so it cannot protect against this: the truncating
  // load already sets it, it clears on the first debounce cycle, and the loss
  // lands on the NEXT save. This one stays set until the user decides.
  const [loadWasTruncated, setLoadWasTruncated] = useState(false);
  const allowTruncatedSaveRef = useRef(false);
  /** Arm a one-shot bypass so the NEXT save may commit a truncated load. */
  const allowTruncatedSave = () => {
    allowTruncatedSaveRef.current = true;
    setLoadWasTruncated(false);
  };
```

In the load effect, immediately after `logDiag("info", "storage.loaded", …)` at `:340`:

```typescript
        const truncation = backend.lastLoadTruncation;
        const truncatedTotal = (truncation?.entries ?? 0) + (truncation?.blocks ?? 0);
        if (truncatedTotal > 0) {
          logDiag("error", "workspace.documentsTruncated", {
            entries: truncation?.entries ?? 0,
            blocks: truncation?.blocks ?? 0,
          });
          emitToast("error", t(langRef.current, "documentsTruncatedWarning", truncation?.entries ?? 0));
          setLoadWasTruncated(true);
        }
```

Return `loadWasTruncated` and `allowTruncatedSave` from the hook.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/use-storage-backend.test.tsx --reporter=dot > /tmp/t10.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t10.log
```
Expected: PASS. Task 12 adds the i18n key; until then `t()` returns the key name, which still contains no digits — so assert on the interpolated count, as the test above does.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/use-storage-backend.ts src/app/use-storage-backend.test.tsx -F - <<'EOF'
feat: the generic load effect reports document truncation on every backend

Placed here rather than in use-storage-file-ops deliberately: this effect is
the one path every backend passes through. The existing droppedRows toast sits
in use-storage-file-ops, which is why it only ever reached local-file and
SharePoint.
EOF
```

---

### Task 11: The save guard, and the escape that keeps it from being a lockout

**Files:**
- Modify: `src/app/use-storage-backend.ts` (save effect ~`:402`)
- Test: `src/app/use-storage-backend.test.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
  it("refuses an automatic save while a truncated load is unresolved", async () => {
    mockBackend.lastLoadTruncation = { entries: 5, blocks: 0 };
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    mockBackend.save.mockClear();
    act(() => { result.current.setTasks((p) => [...p, makeTask()]); });
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(mockBackend.save).not.toHaveBeenCalled();
  });

  // ★★★ THE TEST THAT SEPARATES A GUARD FROM A LOCKOUT. The user cannot get
  // under the cap by editing -- the excess documents were never loaded -- so
  // without a working escape the guard above is a permanent block on saving,
  // a worse defect than the one being fixed.
  it("allows the save once the user accepts the loss", async () => {
    mockBackend.lastLoadTruncation = { entries: 5, blocks: 0 };
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    mockBackend.save.mockClear();
    act(() => { result.current.allowTruncatedSave(); });
    act(() => { result.current.setTasks((p) => [...p, makeTask()]); });
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(mockBackend.save).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/use-storage-backend.test.tsx --reporter=dot > /tmp/t11.log 2>&1; echo "EXIT=$?"; grep -E "Tests |FAIL" /tmp/t11.log
```
Expected: the first FAILS (save is called), the second passes vacuously.

- [ ] **Step 3: Implement**

In the save effect, immediately before the L3/B invariant block at `:400`:

```typescript
    // ★★ A truncated load must never be committed by an AUTOMATIC save: the
    // excess documents are still in the source file, and writing the truncated
    // set over it is the permanent loss §100 exists about. The user's explicit
    // "save anyway" arms allowTruncatedSaveRef.
    if (loadWasTruncated && !allowTruncatedSaveRef.current) {
      return; // keep baselines so a later change re-evaluates
    }
    allowTruncatedSaveRef.current = false;
```

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run src/app/use-storage-backend.test.tsx --reporter=dot > /tmp/t11.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t11.log
```
Expected: PASS.

- [ ] **Step 5: Mutation-test the guard**

Delete the `if (loadWasTruncated …) return;` block, re-run, confirm the refusal test goes RED, restore.

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/use-storage-backend.ts src/app/use-storage-backend.test.tsx -F - <<'EOF'
feat: pause automatic saves after a truncated load

Holds the source file intact so the excess documents survive until the user
decides. The escape is tested as carefully as the guard: without a working
"save anyway" this would be a permanent lockout, since the user cannot delete
their way under the cap -- the excess documents were never loaded.
EOF
```

---

### Task 12: i18n keys

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add the keys**

Both files are **CRLF** and the Edit tool corrupts umlauts in `i18n.de.ts`. Write with node, anchoring on `\r\n`:

```bash
node -e '
const fs=require("fs");
const add=(p,ins)=>{const s=fs.readFileSync(p,"utf8");const a="  documentsCardMoreReasons:";
if(!s.includes(a))throw new Error("anchor missing in "+p);
fs.writeFileSync(p,s.replace(a,ins+a),"utf8");};
add("src/app/i18n.ts",
  "  documentsTruncatedWarning: \"{0} document entries could not be opened - this project is over the limit. Saving is paused so nothing is overwritten.\",\r\n"+
  "  documentsTruncatedBanner: \"This project holds more documents than can be opened. Saving is paused to protect the file.\",\r\n"+
  "  documentsTruncatedSaveAnyway: \"Save anyway\",\r\n"+
  "  documentsTruncatedBannerAria: \"Document limit warning\",\r\n");
add("src/app/i18n.de.ts",
  "  documentsTruncatedWarning: \"{0} Dokumenteinträge konnten nicht geöffnet werden - dieses Projekt überschreitet das Limit. Das Speichern ist pausiert, damit nichts überschrieben wird.\",\r\n"+
  "  documentsTruncatedBanner: \"Dieses Projekt enthält mehr Dokumente als geöffnet werden können. Das Speichern ist pausiert, um die Datei zu schützen.\",\r\n"+
  "  documentsTruncatedSaveAnyway: \"Trotzdem speichern\",\r\n"+
  "  documentsTruncatedBannerAria: \"Warnung zum Dokumentenlimit\",\r\n");
console.log("ok");'
```

The `\uXXXX` escapes are for **this shell command only** — they produce real umlauts in the file. The `i18n-encoding` test bans literal `\u00XX` sequences in the source, so verify the written bytes are real characters.

- [ ] **Step 2: Verify encoding and parity**

```bash
git grep -n "documentsTruncatedWarning" -- src/app/i18n.ts src/app/i18n.de.ts
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx vitest run src/app/i18n-encoding.test.ts --reporter=dot > /tmp/t12.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t12.log
```
Expected: both files list all four keys, tsc exit 0 (it enforces EN/DE parity), encoding test passes. The DE grep output must show `ä`/`ö`/`ü`, not `fuer`-style substitutes or escapes.

- [ ] **Step 3: Commit**

```bash
git commit --only src/app/i18n.ts src/app/i18n.de.ts -F - <<'EOF'
i18n: strings for the document truncation warning and banner
EOF
```

---

### Task 13: `TruncatedLoadBanner`

**Files:**
- Modify: `src/app/notifications.tsx` (beside `StorageBanner` at `:90`), `src/app/task-manager.tsx` (mount beside `StorageBanner` at `~:2618`)
- Test: `src/app/notifications.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
  it("offers save-anyway and dismiss", async () => {
    const onSaveAnyway = vi.fn();
    const onDismiss = vi.fn();
    render(<TruncatedLoadBanner lang="en-US" onSaveAnyway={onSaveAnyway} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    expect(onSaveAnyway).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/notifications.test.tsx --reporter=dot > /tmp/t13.log 2>&1; echo "EXIT=$?"; grep -E "Tests |FAIL" /tmp/t13.log
```
Expected: FAIL — `TruncatedLoadBanner` is not exported.

- [ ] **Step 3: Implement**

In `notifications.tsx`, directly after `StorageBanner`:

```tsx
export function TruncatedLoadBanner({
  lang, onSaveAnyway, onDismiss,
}: { lang: Lang; onSaveAnyway: () => void; onDismiss: () => void }) {
  return (
    <AlertBanner severity="error" ariaLabel={t(lang, "documentsTruncatedBannerAria")} icon="⚠"
      actions={<>
        <Button variant="primary" size="xs" onClick={onSaveAnyway}>
          {t(lang, "documentsTruncatedSaveAnyway")}
        </Button>
        <DismissButton lang={lang} onClick={onDismiss} />
      </>}>
      <p className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
        {t(lang, "documentsTruncatedBanner")}
      </p>
    </AlertBanner>
  );
}
```

Wraps the shared primitive rather than hand-rolling — a hand-rolled banner would miss the a11y wiring `AlertBanner` already carries.

★ **It must live in `notifications.tsx`.** `AlertBanner` (`:22`) and `DismissButton` (`:14`) are module-private — neither is exported. Putting this component in a new file means either importing an unexported symbol or hand-rolling the banner, and the second is how the a11y wiring gets lost. Verified 2026-08-07 by grep.

In `task-manager.tsx`, beside the existing `<StorageBanner … />`:

```tsx
        {loadWasTruncated && (
          <TruncatedLoadBanner
            lang={lang}
            onSaveAnyway={allowTruncatedSave}
            onDismiss={() => setTruncationBannerDismissed(true)}
          />
        )}
```

Take `loadWasTruncated` and `allowTruncatedSave` from the `useStorageBackend(...)` destructure at `:461`, add `TruncatedLoadBanner` to the `./notifications` import at `:65`, and hold `truncationBannerDismissed` as local state. Gate the render on `loadWasTruncated && !truncationBannerDismissed`.

★ Dismissing hides the banner but must NOT clear `loadWasTruncated` — the save guard stays armed. Only "Save anyway" resolves it.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/notifications.test.tsx --reporter=dot > /tmp/t13.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t13.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/notifications.tsx src/app/task-manager.tsx src/app/notifications.test.tsx -F - <<'EOF'
feat: persistent banner for a truncated load, with an explicit save-anyway

A toast cannot carry this: the state is sticky, and a toast that disappears
leaves the user with a silently unsaveable app. Dismissing hides the banner but
leaves the save guard armed -- only "Save anyway" resolves it.
EOF
```

---

### Task 14: Close §100 in the register

**Files:**
- Modify: `docs/open-followups.md:145` (index row), `:5011` (the entry)

- [ ] **Step 1: Rewrite the entry heading and status**

Change the heading to:

```markdown
## 100. An over-cap load silently and permanently destroyed the excess documents — CLOSED
```

Replace the "The decision this entry exists to force" section with what was decided and why, keeping every measurement above it intact (the probe output, the six-path table, the control paragraph). Those are the evidence and must not be summarised away.

Update the index row at `:145` to `closed`.

- [ ] **Step 2: Verify the docs gate**

```bash
npm run docs:symbols:check > /tmp/t14.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/t14.log
```
Expected: exit 0. Every backticked mixed-case name must exist in `src`.

- [ ] **Step 3: Commit**

```bash
git commit --only docs/open-followups.md -F - <<'EOF'
docs: close open-followups §100

Records the decision (raise to 1000, disclose on every backend, pause automatic
saves) and keeps the original measurements, which are the evidence for it.
EOF
```

---

### Task 15: Full gate run

- [ ] **Step 1: Run every gate, serially**

Run one at a time — two vitest processes on one machine is the saturation condition behind this repo's load-sensitive flakes.

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
npm run size:check > /tmp/g-size.log 2>&1; echo "SIZE=$?"
npm run dup:check > /tmp/g-dup.log 2>&1; echo "DUP=$?"
npm run docs:symbols:check > /tmp/g-sym.log 2>&1; echo "SYM=$?"
npm run test:coverage > /tmp/g-cov.log 2>&1; echo "COV=$?"; grep -E "Test Files|Tests |All files" /tmp/g-cov.log
npm run test:shuffle > /tmp/g-shuf.log 2>&1; echo "SHUF=$?"; grep -E "Test Files|Tests |Errors" /tmp/g-shuf.log
npm run build > /tmp/g-build.log 2>&1; echo "BUILD=$?"; tail -3 /tmp/g-build.log
```

Every line must print `=0`. Coverage floors are lines 92 / funcs 91 / branch 80 / stmts 89.

- [ ] **Step 2: Run the axe gate for Documents on a fresh isolated server**

```bash
PORT=3100 npx playwright test e2e/a11y.spec.ts --project=chromium -g "Documents" > /tmp/g-axe.log 2>&1; echo "AXE=$?"; grep -E "passed|failed" /tmp/g-axe.log
PORT=3100 npm run stop
```
Expected: 5 passed (one per colour scheme), exit 0. A fresh port matters — Playwright's `reuseExistingServer` will otherwise attach to a stale `:3000` whose Tailwind has not regenerated.

- [ ] **Step 3: Report**

Report every exit code as measured. If one is red, fix it before claiming completion — a gate read through a pipe is not a result.

---

## Self-review

**Spec coverage.** Cap raise → Task 9. Counting → Tasks 1–2. Five load paths → Tasks 3–7. Uniform backend field + the one-door guard → Task 8. Single consumer, toast, ring → Task 10. Sticky save guard + escape → Task 11. Banner → Task 13. i18n → Task 12. Register → Task 14. Gates → Task 15. No spec section is unimplemented.

**Placeholders.** None. Every code step carries real code; every command carries its expected output.

**Type consistency.** `DocTruncationDiag` is `{truncatedEntries?, truncatedBlocks?}` throughout (Tasks 1–7). The backend field is `lastLoadTruncation?: {entries, blocks}` throughout (Tasks 6–8, 10) — deliberately a different shape from the diag, converted once at each backend boundary, because the diag accumulates during a decode while the field reports a finished load. `allowTruncatedSave` / `loadWasTruncated` are spelled identically in Tasks 10, 11 and 13.

**Two things the implementer must not "simplify".**
1. `sanitizeProjectDocuments` is called with a diag by the load paths and **without** one by `document-versions.ts`'s per-item delegation (Task 2). That asymmetry is deliberate — passing the diag there would let a version's block truncation be miscounted as a document truncation.
2. Task 8's registry test is a source scan, not a behavioural test, and that is on purpose. Instantiating all four backends needs live IndexedDB, a Turso client and a SharePoint token.
