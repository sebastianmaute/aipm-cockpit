# AI Document Authoring S2 — AI Tools and Version History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI assistant five document tools, and make every document mutation — AI or user — recoverable through a per-document version history with restore, including restore of deleted documents.

**Architecture:** A new `Workspace.documentVersions` array stores **before-image** snapshots, riding the same Pattern-B meta-blob plumbing `documents` already uses on all six write paths. One pure function, `applyDocMutation`, performs every document mutation and emits the paired `{documents, versions}` result; `workspace-context` composes it into a `mutateDocuments()` callback that both the Documents pane and the AI tools call. The five tools live in their own modules because the three existing chat files are within a few lines of the 800-line ratchet.

**Tech Stack:** TypeScript · React 19 · Next 16 · vitest + fast-check · Playwright/axe · DOMPurify · Tailwind v4

**Spec:** `docs/superpowers/specs/2026-08-06-ai-document-authoring-s2-design.md`

---

## Read this before Task 1

**Gate rules that will bite you (all measured, not guessed):**

1. **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` reports `tail`'s status — it exits 0 while tests fail. Always:
   ```bash
   npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
   ```
2. **The file-size ratchet.** `LIMIT = 800`. A file over 800 that is not in `docs/baselines/file-sizes.json` fails as a NEW oversized file; a baselined file that grows by one line fails too. The baseline holds exactly five files: `chat-panel.tsx` 977, `task-manager.tsx` 2972, `task-row.tsx` 827, `tasks-section.tsx` 1067, `workspace-section.tsx` 965. **`use-chat-dispatcher.ts` is at 796, `chat-tools.ts` at 748, `chat-tool-defs.ts` at 593** — none baselined. Run `npm run size:check` after every task that touches them.
3. **`npm run lint` does NOT reproduce CI.** It is bare `eslint` with no `--max-warnings` flag and exits 0 with warnings present. The real gate is `npx eslint --max-warnings=0 src/app` (no pipe). An unused import is fatal.
4. **`npx tsc --noEmit` after editing any test.** `next build` does not typecheck `*.test.tsx` and vitest never typechecks.
5. **`i18n.de.ts` and `i18n.ts` are CRLF.** The Edit tool corrupts umlauts and curls double quotes in `i18n.de.ts`. Patch it with a node utf8 write whose anchor matches `\r\n`, then re-verify the bytes. DE must use real umlauts — the `i18n-encoding` test bans `fuer`/`druecken` style substitutions and `\u00XX` escapes.
6. **Commit after every task.** No attribution trailers.

**Run this once before starting, to have a green baseline you can trust:**

```bash
npm run test:run > /tmp/baseline.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/baseline.log
npx tsc --noEmit; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
```

Expected: EXIT=0 three times, and roughly `Tests  9586 passed`.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/app/document-versions.ts` | `DocVersion` type, `sanitizeDocumentVersions`, caps, `trimVersions` retention. Pure, **DOM-free by contract** |
| `src/app/document-versions.test.ts` | Unit tests for the above |
| `src/app/document-mutations.ts` | `DocOp`/`DocMutation`/`DocState`/`DocResult` + `applyDocMutation`. Pure, DOM-free |
| `src/app/document-mutations.test.ts` | Unit tests |
| `src/app/document-mutations.property.test.ts` | fast-check: mutate → restore returns the prior state |
| `src/app/ai-document-blocks.ts` | `sanitizeAiDocBlocks` — the model-input allow-list. **DOM-bound** (calls DOMPurify via `sanitizeAiRichText`) |
| `src/app/ai-document-blocks.test.ts` | Unit tests |
| `src/app/chat-dispatcher-types.ts` | `ChatDispatcherArgs`, moved out of `use-chat-dispatcher.ts` purely to buy ratchet headroom |
| `src/app/chat-tool-defs-documents.ts` | `DOCUMENT_TOOL_DEFS` + the shared `DocBlock` JSON-schema helper |
| `src/app/chat-tools-documents.ts` | `DocumentToolDispatcher` type, `isDocumentTool`, `runDocumentTool` + boundary guards |
| `src/app/chat-tools-documents.test.ts` | Guard tests (the four mandatory guards) |
| `src/app/use-document-tools.ts` | The impl hook, spread into the dispatcher. Coverage-**excluded** glue |
| `src/app/documents-history-modal.tsx` | Per-document version list, Preview + Restore |
| `src/app/documents-history-modal.test.tsx` | Component tests |
| `src/app/chat-tool-block.tsx` | `ToolBlock`, extracted from `chat-panel.tsx`, plus the document file card |
| `src/app/chat-tool-block.test.tsx` | Component tests for the card |

**Modified:**

| File | Change |
|---|---|
| `src/app/id-mint-session.ts` | `MintKind` gains `"document"` + `"documentVersion"`; `seedMintFromWorkspace` seeds both |
| `src/app/document-model.ts` | `nextDocumentId` deleted (call sites move to `mintId`) |
| `src/app/workspace.ts:141,183,492,647` | `documentVersions` field, empty-check, `workspaceToJson`, `jsonToWorkspace` |
| `src/app/browser-backend.ts:79,150,259,307,440` | IDB KV entry |
| `src/app/turso-schema.ts:207,269,368` | `meta` row `"documentVersions"`, dirty flag, save |
| `src/app/csv-codecs-sections.ts:51` | `CSV_SECTION_DOCUMENT_VERSIONS` |
| `src/app/csv-codecs-config.ts:250,614` | encode + emit |
| `src/app/csv-codecs-decode.ts:137,187,217,248,464` | decode mode + wire-up |
| `src/app/markdown-codecs-core.ts:201,575` | encode + emit |
| `src/app/markdown-codecs-decode.ts:65,347` | decode wire-up |
| `src/app/workspace-context.tsx:128,163,384` | `documentVersions` state + `mutateDocuments` |
| `src/app/documents-panel.tsx` | Four local helpers removed; routes through `mutateDocuments`; history + deleted controls |
| `src/app/documents-toolbar.tsx` | Deleted toggle |
| `src/app/documents-list.tsx` | History action, deleted-mode rows |
| `src/app/chat-tool-defs.ts:207` | Spread `DOCUMENT_TOOL_DEFS` |
| `src/app/chat-tools.ts:265,498` | `ToolDispatcher` intersection + one delegating case group |
| `src/app/use-chat-dispatcher.ts:70,277` | Args moved out; document tools spread in |
| `src/app/chat-panel.tsx:718,936` | `ToolBlock` extracted out (file shrinks) |
| `src/app/activity-log.ts:12,168` | `ai.documentWrite` |
| `src/app/dashboard-activity-nav.ts` | `ai.documentWrite` → `"documents"` |
| `src/app/dashboard-delta.ts:58` | Explicit `null` classification |
| `src/app/view-ai-scope.ts:170` | Drop the false `reading` line, add `toolHints` |
| `src/app/ask-claude-prompts.ts:54` | `documents` chips |
| `src/app/ask-claude-prompts.test.ts:45` | Pinned view list gains `"documents"` |
| `src/app/i18n.ts` + `src/app/i18n.de.ts` | New strings |
| `src/app/entity-persistence-registry.test.ts:303` | `documentVersions` round-trips |
| `public/sample-workspace-small.json` | One seeded version |
| `AGENTS.md`, `docs/AGENTS/ai-assistant.md` | `nextEntityId` → `mintId`; document tools documented |

---

### Task 1: Document ids stop being reusable

The tombstone derivation in this slice — "a version whose `documentId` is absent from `documents` is a deleted document" — is only sound if a deleted document's id can never be handed to a new document. Today it can: `document-model.ts` `nextDocumentId` is plain max+1 with no session high-water mark, unlike every other entity, which uses `mintId`.

**Files:**
- Modify: `src/app/id-mint-session.ts:12-25` (`MintKind`), `:117-134` (`seedMintFromWorkspace`)
- Modify: `src/app/documents-panel.tsx:18,107,133`
- Modify: `src/app/document-model.ts:208` (delete `nextDocumentId`)
- Modify: `src/app/document-model.test.ts:5,317-324` (delete its tests)
- Test: `src/app/id-mint-session.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/id-mint-session.test.ts`:

```ts
describe("document id reuse", () => {
  it("does not hand a deleted document's id to the next create", () => {
    __resetMintStateForTests();
    const docs = [{ id: 1 }, { id: 2 }];
    const first = mintId("document", docs);
    expect(first).toBe(3);
    // The user deletes #3 and #2; the list max drops back to 1.
    const second = mintId("document", [{ id: 1 }]);
    expect(second).toBe(4);
  });

  it("seeds the document high-water mark from a workspace", () => {
    __resetMintStateForTests();
    seedMintFromWorkspace(
      { documents: [{ id: 9, title: "d", blocks: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" }] },
      "reset",
    );
    expect(mintId("document", [])).toBe(10);
  });

  it("mints version ids independently of document ids", () => {
    __resetMintStateForTests();
    expect(mintId("document", [{ id: 5 }])).toBe(6);
    expect(mintId("documentVersion", [])).toBe(1);
  });
});
```

Make sure the file's import list includes `seedMintFromWorkspace` and `__resetMintStateForTests`.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/id-mint-session.test.ts --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t1.log
```

Expected: FAIL — `"document"` is not assignable to `MintKind`. (`--reporter=basic` does not exist in vitest 4; use `dot`.)

- [ ] **Step 3: Extend `MintKind` and the seeder**

In `src/app/id-mint-session.ts`, add two members to the union after `"calendarEvent"`:

```ts
  | "calendarEvent"
  | "document"
  | "documentVersion";
```

And two lines at the end of `seedMintFromWorkspace`:

```ts
  seedMintKind("document", ws.documents ?? [], mode);
  seedMintKind("documentVersion", ws.documentVersions ?? [], mode);
```

`ws.documentVersions` does not exist yet — that is Task 3. Until then TypeScript will error, so for **this** task write only the `document` line and add the `documentVersion` line in Task 3. Note it in the commit message.

- [ ] **Step 4: Move the panel onto `mintId`**

In `src/app/documents-panel.tsx`, change the import at `:18`:

```ts
import { type ProjectDocument, MAX_TITLE_CHARS } from "./document-model";
import { mintId } from "./id-mint-session";
```

and both mint sites (`:107` in `appendDocument`, `:133` in `duplicateDocument`):

```ts
      id: mintId("document", prev),
```

- [ ] **Step 5: Delete `nextDocumentId` and its tests**

Remove the function at `src/app/document-model.ts:208` and its `describe("nextDocumentId")` block plus the import at `src/app/document-model.test.ts:5`.

- [ ] **Step 6: Run the tests and the typecheck**

```bash
npx vitest run src/app/id-mint-session.test.ts src/app/document-model.test.ts src/app/documents-panel.test.tsx --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t1.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: EXIT=0 both. If a `documents-panel` test asserted a specific new id, it may now expect a different number — that is the intended behaviour change; update the expectation, do not revert the code.

- [ ] **Step 7: Fix the AGENTS claim in the same commit**

`docs/AGENTS/ai-assistant.md` says ids mint via `nextEntityId(ref.current)`. No such function exists anywhere in `src`. Replace both occurrences of `nextEntityId` with `mintId` in that file (and in `AGENTS.md` if `grep -rn nextEntityId AGENTS.md docs/` finds one).

- [ ] **Step 8: Commit**

```bash
git add src/app/id-mint-session.ts src/app/id-mint-session.test.ts src/app/documents-panel.tsx src/app/document-model.ts src/app/document-model.test.ts docs/AGENTS/ai-assistant.md
git commit -m "fix: mint document ids through the session minter so ids are never reused"
```

---

### Task 2: `document-versions.ts` — model, sanitizer, retention

**Files:**
- Create: `src/app/document-versions.ts`
- Test: `src/app/document-versions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/document-versions.test.ts
import { describe, it, expect } from "vitest";
import {
  MAX_VERSIONS_PER_DOC,
  MAX_TOTAL_VERSIONS,
  sanitizeDocumentVersions,
  trimVersions,
  type DocVersion,
} from "./document-versions";

const v = (over: Partial<DocVersion> = {}): DocVersion => ({
  id: 1,
  documentId: 1,
  title: "Status report",
  blocks: [{ type: "heading", level: 1, text: "Week 12" }],
  savedAt: "2026-08-01T09:00:00.000Z",
  source: "ai",
  op: "update",
  ...over,
});

describe("sanitizeDocumentVersions", () => {
  it("keeps a well-formed version", () => {
    expect(sanitizeDocumentVersions([v()])).toEqual([v()]);
  });

  it("drops a version with an unusable documentId", () => {
    expect(sanitizeDocumentVersions([v({ documentId: 0 })])).toEqual([]);
    expect(sanitizeDocumentVersions([v({ documentId: "3" as unknown as number })])).toEqual([]);
  });

  it("drops unknown block types rather than passing them through", () => {
    const dirty = v({ blocks: [{ type: "video", src: "x" }] as unknown as DocVersion["blocks"] });
    expect(sanitizeDocumentVersions([dirty])[0].blocks).toEqual([]);
  });

  it("falls back to a known source and op", () => {
    const [out] = sanitizeDocumentVersions([
      v({ source: "robot" as unknown as DocVersion["source"], op: "explode" as unknown as DocVersion["op"] }),
    ]);
    expect(out.source).toBe("user");
    expect(out.op).toBe("update");
  });

  it("returns [] for non-array input", () => {
    expect(sanitizeDocumentVersions(null)).toEqual([]);
    expect(sanitizeDocumentVersions({ 0: v() })).toEqual([]);
  });
});

describe("trimVersions", () => {
  it("keeps the newest MAX_VERSIONS_PER_DOC for a live document", () => {
    const many = Array.from({ length: MAX_VERSIONS_PER_DOC + 5 }, (_, i) =>
      v({ id: i + 1, savedAt: `2026-08-01T09:${String(i).padStart(2, "0")}:00.000Z` }),
    );
    const kept = trimVersions(many, [1]);
    expect(kept).toHaveLength(MAX_VERSIONS_PER_DOC);
    expect(kept[0].id).toBe(6); // the five oldest went
  });

  // ★ The whole delete-restore feature rests on this one.
  it("never trims the newest version of a document that no longer exists", () => {
    const tombstone = v({ id: 1, documentId: 99, savedAt: "2020-01-01T00:00:00.000Z", op: "delete" });
    const noise = Array.from({ length: MAX_TOTAL_VERSIONS + 10 }, (_, i) =>
      v({ id: i + 2, documentId: 1, savedAt: `2026-08-01T10:${String(i % 60).padStart(2, "0")}:00.000Z` }),
    );
    const kept = trimVersions([tombstone, ...noise], [1]);
    expect(kept.some((k) => k.id === 1)).toBe(true);
    expect(kept.length).toBeLessThanOrEqual(MAX_TOTAL_VERSIONS + 1);
  });

  it("keeps only the newest tombstone per deleted document", () => {
    const older = v({ id: 1, documentId: 99, savedAt: "2026-01-01T00:00:00.000Z" });
    const newer = v({ id: 2, documentId: 99, savedAt: "2026-02-01T00:00:00.000Z", op: "delete" });
    const kept = trimVersions([older, newer], []);
    expect(kept.map((k) => k.id)).toEqual([2]);
  });

  it("returns the same reference when nothing needs trimming", () => {
    const list = [v()];
    expect(trimVersions(list, [1])).toBe(list);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/document-versions.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t2.log
```

Expected: FAIL — cannot resolve `./document-versions`.

- [ ] **Step 3: Write the module**

```ts
// src/app/document-versions.ts — before-image snapshots of document mutations.
//
// ★★★ DOM-FREE BY CONTRACT, exactly like document-model.ts. This module is
// reachable from scripts/generate-sample-workspace.ts, where a DOMPurify call
// throws under bare node, jsonToWorkspace's catch-all swallows the throw, and
// the generator then "successfully" writes near-empty sample files (§36(a)).
// The paragraph HTML allow-list runs at the render sink and at the whole-object
// load boundaries — never here.
import {
  MAX_TITLE_CHARS,
  sanitizeProjectDocuments,
  type DocBlock,
  type ProjectDocument,
} from "./document-model";
import { capHtmlText } from "./rich-text-plain";

export const MAX_VERSIONS_PER_DOC = 20;
export const MAX_TOTAL_VERSIONS = 500;

export type DocVersionSource = "ai" | "user";
export type DocVersionOp = "update" | "rename" | "delete" | "duplicate";

const SOURCES: readonly DocVersionSource[] = ["ai", "user"];
const OPS: readonly DocVersionOp[] = ["update", "rename", "delete", "duplicate"];

/** A snapshot of the state a mutation REPLACED. Restoring writes it back
 *  verbatim, so there is no inversion logic anywhere. */
export type DocVersion = {
  id: number;
  documentId: number;
  title: string;
  blocks: readonly DocBlock[];
  savedAt: string;
  source: DocVersionSource;
  op: DocVersionOp;
};

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/** Single entry point. Per-field validation; unknown shapes are DROPPED, never
 *  passed through. Block validation is delegated to sanitizeProjectDocuments so
 *  a version can never carry a block shape the live model would reject. */
export function sanitizeDocumentVersions(raw: unknown): DocVersion[] {
  if (!Array.isArray(raw)) return [];
  const out: DocVersion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (!isPositiveInt(r.id) || !isPositiveInt(r.documentId)) continue;
    if (typeof r.savedAt !== "string" || !r.savedAt) continue;
    // Borrow the document sanitizer for the blocks: one implementation, so a
    // block shape can never be legal in a version and illegal in a document.
    const [asDoc] = sanitizeProjectDocuments([
      { id: r.documentId, title: r.title, blocks: r.blocks, createdAt: r.savedAt, updatedAt: r.savedAt },
    ]);
    if (!asDoc) continue;
    out.push({
      id: r.id,
      documentId: r.documentId,
      title: capHtmlText(asDoc.title, MAX_TITLE_CHARS),
      blocks: asDoc.blocks,
      savedAt: r.savedAt,
      source: SOURCES.includes(r.source as DocVersionSource) ? (r.source as DocVersionSource) : "user",
      op: OPS.includes(r.op as DocVersionOp) ? (r.op as DocVersionOp) : "update",
    });
  }
  return out;
}

/** Newest first by savedAt, id as the tie-break so the order is total. */
function byNewest(a: DocVersion, b: DocVersion): number {
  return a.savedAt === b.savedAt ? b.id - a.id : (a.savedAt < b.savedAt ? 1 : -1);
}

/**
 * Retention. Oldest-first within a document, then oldest-first globally —
 * WITH ONE EXCEPTION that carries the whole delete-restore feature:
 *
 * ★★★ the newest version of a documentId absent from `liveIds` is NEVER
 * trimmed. That entry IS the tombstone, and "deleted documents" is derived
 * from its existence. Trim it and the document becomes unrecoverable while
 * every other test still passes.
 *
 * Returns the SAME reference when nothing needs dropping — the dirty check on
 * Turso and IndexedDB is reference equality.
 */
export function trimVersions(
  versions: readonly DocVersion[],
  liveIds: readonly number[],
): readonly DocVersion[] {
  const live = new Set(liveIds);
  const byDoc = new Map<number, DocVersion[]>();
  for (const v of versions) {
    const list = byDoc.get(v.documentId);
    if (list) list.push(v);
    else byDoc.set(v.documentId, [v]);
  }

  const protectedIds = new Set<number>();
  const keepable: DocVersion[] = [];
  for (const [documentId, list] of byDoc) {
    const sorted = [...list].sort(byNewest);
    if (!live.has(documentId)) {
      // Deleted: the newest entry is the tombstone and survives everything.
      protectedIds.add(sorted[0].id);
      continue;
    }
    keepable.push(...sorted.slice(0, MAX_VERSIONS_PER_DOC));
  }

  const globallyKept = keepable.sort(byNewest).slice(0, MAX_TOTAL_VERSIONS);
  const keptIds = new Set(globallyKept.map((v) => v.id));
  const next = versions.filter((v) => keptIds.has(v.id) || protectedIds.has(v.id));
  return next.length === versions.length ? versions : next;
}

/** Versions whose document no longer exists — the "deleted documents" list.
 *  DERIVED, never a stored flag: a flag would have to be cleared on restore
 *  and can desync from the documents array. */
export function deletedDocumentVersions(
  versions: readonly DocVersion[],
  documents: readonly ProjectDocument[],
): DocVersion[] {
  const live = new Set(documents.map((d) => d.id));
  const newestByDoc = new Map<number, DocVersion>();
  for (const v of versions) {
    if (live.has(v.documentId)) continue;
    const cur = newestByDoc.get(v.documentId);
    if (!cur || byNewest(v, cur) < 0) newestByDoc.set(v.documentId, v);
  }
  return [...newestByDoc.values()].sort(byNewest);
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/app/document-versions.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t2.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: EXIT=0 both. If `capHtmlText` is not exported from `rich-text-plain`, run `grep -n "export function capHtmlText" src/app/rich-text-plain.ts` and use the real path — do not substitute `clipText`, which splits surrogate pairs (open-followups §22).

- [ ] **Step 5: Add the DOM-free source guard**

Append to `src/app/document-versions.test.ts`, mirroring the guard `document-model.test.ts` already carries:

```ts
import { readFileSync } from "node:fs";

describe("DOM-free contract", () => {
  it("never calls DOMPurify", () => {
    const src = readFileSync("src/app/document-versions.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/DOMPurify|sanitizeNoteHtml|sanitizeTemplateHtml/);
  });
});
```

- [ ] **Step 6: Run and commit**

```bash
npx vitest run src/app/document-versions.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t2.log
git add src/app/document-versions.ts src/app/document-versions.test.ts
git commit -m "feat: add the document version model, sanitizer and retention"
```

---

### Task 3: `Workspace.documentVersions` — JSON path

**Files:**
- Modify: `src/app/workspace.ts:141` (field), `:183` (empty check), `:492` (`workspaceToJson`), `:647` (`jsonToWorkspace`)
- Modify: `src/app/id-mint-session.ts` (the deferred `documentVersion` seed line from Task 1)
- Test: `src/app/workspace.documents.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/workspace.documents.test.ts`:

```ts
describe("documentVersions round-trip", () => {
  const VERSION = {
    id: 1,
    documentId: 7,
    title: "Old title",
    blocks: [{ type: "paragraph" as const, html: "<p>before</p>" }],
    savedAt: "2026-08-01T09:00:00.000Z",
    source: "ai" as const,
    op: "update" as const,
  };

  it("survives workspaceToJson → jsonToWorkspace", () => {
    const ws = { ...emptyWorkspace(), documentVersions: [VERSION] };
    const back = jsonToWorkspace(workspaceToJson(ws));
    expect(back.documentVersions).toEqual([VERSION]);
  });

  it("emits no key at all when empty", () => {
    const json = workspaceToJson({ ...emptyWorkspace(), documentVersions: [] });
    expect(json).not.toContain("documentVersions");
  });

  it("drops junk rather than failing the whole load", () => {
    const ws = { ...emptyWorkspace(), documentVersions: [{ nope: true }] as never };
    expect(jsonToWorkspace(workspaceToJson(ws)).documentVersions).toBeUndefined();
  });
});
```

Use whatever the file's existing helper for an empty workspace is — read the top of `workspace.documents.test.ts` and reuse it rather than inventing `emptyWorkspace()` if it is named differently.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/workspace.documents.test.ts --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t3.log
```

Expected: FAIL — `documentVersions` does not exist on `Workspace`.

- [ ] **Step 3: Add the field**

`src/app/workspace.ts`, immediately after the `documents?` field at `:141`:

```ts
  /** Before-image snapshots of document mutations (AI and user) — the safety
   *  net that makes direct AI document writes acceptable, since chat tool
   *  writes have no undo capture. Optional & additive: undefined/empty
   *  serializes to nothing (byte-stable). Sanitized by
   *  `sanitizeDocumentVersions`; the paragraph HTML allow-list is applied by
   *  `sanitizeDocumentRichFields`, same as `documents`. */
  documentVersions?: readonly DocVersion[];
```

with `import type { DocVersion } from "./document-versions";` and `import { sanitizeDocumentVersions } from "./document-versions";` beside the existing `document-model` imports.

- [ ] **Step 4: Extend the empty check at `:183`**

```ts
    && (ws.documents?.length ?? 0) === 0
    && (ws.documentVersions?.length ?? 0) === 0;
```

- [ ] **Step 5: Emit in `workspaceToJson`, after `:492`**

```ts
      // Additive: only present when versions exist, so files without history
      // stay free of the key. Mirrors `documents` one line above.
      ...(ws.documentVersions && ws.documentVersions.length
        ? { documentVersions: ws.documentVersions }
        : {}),
```

- [ ] **Step 6: Sanitize in `jsonToWorkspace`, after the `documents` block at `:647-661`**

```ts
    if (p.documentVersions !== undefined) {
      try {
        // TWO PASSES, same reasoning as documents: sanitizeDocumentVersions is
        // DOM-free and enforces STRUCTURE only; sanitizeDocumentRichFields
        // applies the paragraph HTML allow-list and needs a DOM.
        const versions = sanitizeDocumentVersions(p.documentVersions).map((v) => ({
          ...v,
          blocks: sanitizeDocumentRichFields({
            id: v.documentId,
            title: v.title,
            blocks: v.blocks,
            createdAt: v.savedAt,
            updatedAt: v.savedAt,
          }).blocks,
        }));
        if (versions.length) raw.documentVersions = versions;
      } catch {
        logDiag("error", "workspace.documentVersionsDropped", {});
      }
    }
```

Read the surrounding `documents` block first and match its exact `logDiag` shape and catch style — do not guess the diagnostic payload.

- [ ] **Step 7: Add the deferred mint seed**

In `src/app/id-mint-session.ts` `seedMintFromWorkspace`, add the line held back in Task 1:

```ts
  seedMintKind("documentVersion", ws.documentVersions ?? [], mode);
```

- [ ] **Step 8: Run tests and typecheck**

```bash
npx vitest run src/app/workspace.documents.test.ts src/app/id-mint-session.test.ts --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t3.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: EXIT=0 both.

- [ ] **Step 9: Commit**

```bash
git add src/app/workspace.ts src/app/workspace.documents.test.ts src/app/id-mint-session.ts
git commit -m "feat: persist documentVersions on the JSON path"
```

---

### Task 4: IndexedDB path

**Files:**
- Modify: `src/app/browser-backend.ts:79,150,259-266,307,440-442`
- Test: `src/app/browser-backend.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/browser-backend.test.ts` (reuse the file's existing backend-construction helper — read the top of the file for it):

```ts
it("round-trips documentVersions through IndexedDB", async () => {
  const backend = makeBackend();
  const version = {
    id: 1,
    documentId: 4,
    title: "Prior",
    blocks: [{ type: "heading" as const, level: 2 as const, text: "Old" }],
    savedAt: "2026-08-02T08:00:00.000Z",
    source: "user" as const,
    op: "rename" as const,
  };
  await backend.save({ ...emptyWorkspace(), documentVersions: [version] });
  const back = await backend.load();
  expect(back.documentVersions).toEqual([version]);
});

it("clears stored versions when the workspace has none", async () => {
  const backend = makeBackend();
  await backend.save({ ...emptyWorkspace(), documentVersions: [{ id: 1, documentId: 4, title: "x", blocks: [], savedAt: "2026-08-02T08:00:00.000Z", source: "user", op: "rename" }] });
  await backend.save({ ...emptyWorkspace(), documentVersions: [] });
  expect((await backend.load()).documentVersions).toBeUndefined();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/browser-backend.test.ts --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t4.log
```

Expected: FAIL — `documentVersions` is undefined after load.

- [ ] **Step 3: Add the KV key and load branch**

`src/app/browser-backend.ts`, beside `KV_DOCUMENTS_KEY` at `:79`:

```ts
const KV_DOCUMENT_VERSIONS_KEY = "documentVersions";
```

Declare beside `:150`:

```ts
    let documentVersions: Workspace["documentVersions"] | undefined;
```

Copy the `documents` load branch at `:259-266` and adapt it — read it first; it reads the KV entry, sanitizes, and keeps `undefined` when empty:

```ts
      // Optional list: junk/empty versions sanitize to [] → keep undefined.
      const rawVersions = await idbGet(KV_DOCUMENT_VERSIONS_KEY);
      if (rawVersions !== undefined) {
        const versions = sanitizeDocumentVersions(rawVersions).map((v) => ({
          ...v,
          blocks: sanitizeDocumentRichFields({
            id: v.documentId, title: v.title, blocks: v.blocks,
            createdAt: v.savedAt, updatedAt: v.savedAt,
          }).blocks,
        }));
        documentVersions = versions.length ? versions : undefined;
      }
```

and at `:307`:

```ts
    if (documentVersions) raw.documentVersions = documentVersions;
```

- [ ] **Step 4: Add the save branch**

Mirror the `documents` save at `:440-442` — delete-on-absent, so cleared history does not linger and reload stale:

```ts
      ws.documentVersions && ws.documentVersions.length
        ? idbSet(KV_DOCUMENT_VERSIONS_KEY, ws.documentVersions)
        : idbDel(KV_DOCUMENT_VERSIONS_KEY),
```

Read the existing lines for the exact delete helper name (`idbDel` vs `idbDelete`) rather than assuming.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run src/app/browser-backend.test.ts --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/t4.log
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/browser-backend.ts src/app/browser-backend.test.ts
git commit -m "feat: persist documentVersions on the IndexedDB path"
```

---

### Task 5: Turso single + tenant

**Files:**
- Modify: `src/app/turso-schema.ts:207-211` (load), `:269` (dirty), `:368-373` (save)
- Test: `src/app/turso-schema.documents.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/turso-schema.documents.test.ts`, mirroring its existing `documents` tests exactly (read them first — they build a `byTable` map of `meta` rows):

```ts
it("loads documentVersions from a meta row", () => {
  const version = {
    id: 1, documentId: 2, title: "Prior", blocks: [],
    savedAt: "2026-08-03T07:00:00.000Z", source: "ai", op: "update",
  };
  const byTable = new Map([["meta", metaRows([{ key: "documentVersions", value: JSON.stringify([version]) }])]]);
  const ws = workspaceFromTables(byTable);
  expect(ws.documentVersions).toEqual([version]);
});

it("marks meta dirty when documentVersions changes by reference", () => {
  const a = [{ id: 1, documentId: 2, title: "x", blocks: [], savedAt: "2026-08-03T07:00:00.000Z", source: "ai" as const, op: "update" as const }];
  const dirty = dirtyTables({ ...empty(), documentVersions: a }, { ...empty(), documentVersions: [...a] });
  expect(dirty.has("meta")).toBe(true);
});

it("keeps documentVersions out of TABLE_NAMES", () => {
  expect(TABLE_NAMES).not.toContain("documentVersions");
  expect(TABLE_NAMES).not.toContain("document_versions");
});
```

Use the file's own helper names for `metaRows`, `workspaceFromTables`, `dirtyTables` and `empty` — read them, do not invent them.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/turso-schema.documents.test.ts --reporter=dot > /tmp/t5.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t5.log
```

- [ ] **Step 3: Load — after the `docRow` block at `:207-211`**

```ts
  const verRow = rowObjects(byTable.get("meta")).find((r) => r.key === "documentVersions");
  if (verRow) {
    try {
      const versions = sanitizeDocumentVersions(JSON.parse(String(verRow.value)));
      if (versions.length) ws.documentVersions = versions;
    } catch {
      // Same degrade-not-throw contract as documents: a corrupt blob costs the
      // history, never the workspace.
    }
  }
```

Read the `docRow` block first and mirror its exact parse/catch shape.

- [ ] **Step 4: Dirty flag — after `:269`**

```ts
  if (prev.documentVersions !== next.documentVersions) dirty.add("meta");
```

- [ ] **Step 5: Save — after the `documents` save at `:368-373`**

```ts
    if (ws.documentVersions && ws.documentVersions.length) {
      /* … same shape as the documents block immediately above … */
        { type: "text", value: "documentVersions" },
        { type: "text", value: JSON.stringify(ws.documentVersions) },
    }
```

Copy the surrounding `documents` block verbatim and change only the two values — the insert helper differs between the single and tenant paths, and both must be covered. Check whether the file has one call site or two (`grep -n '"documents"' src/app/turso-schema.ts`) and mirror every one.

- [ ] **Step 6: Run and commit**

```bash
npx vitest run src/app/turso-schema.documents.test.ts --reporter=dot > /tmp/t5.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/t5.log
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/turso-schema.ts src/app/turso-schema.documents.test.ts
git commit -m "feat: persist documentVersions on both Turso paths"
```

---

### Task 6: CSV path

**Files:**
- Modify: `src/app/csv-codecs-sections.ts:51`, `src/app/csv-codecs-config.ts:250,614`, `src/app/csv-codecs-decode.ts:137,187,217,248,464`
- Test: `src/app/csv-codecs.documents.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/csv-codecs.documents.test.ts`:

```ts
describe("documentVersions CSV section", () => {
  const VERSION = {
    id: 1, documentId: 3, title: "Prior, with comma",
    blocks: [{ type: "paragraph" as const, html: "<p>a</p>" }],
    savedAt: "2026-08-04T07:00:00.000Z", source: "ai" as const, op: "update" as const,
  };

  it("round-trips through the whole workspace CSV", () => {
    const ws = { ...emptyWorkspace(), documentVersions: [VERSION] };
    expect(csvToWorkspace(workspaceToCsv(ws)).documentVersions).toEqual([VERSION]);
  });

  it("emits nothing when there is no history", () => {
    expect(workspaceToCsv({ ...emptyWorkspace(), documentVersions: [] })).not.toContain("DOCUMENT VERSIONS");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/csv-codecs.documents.test.ts --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t6.log
```

- [ ] **Step 3: Add the section marker**

`src/app/csv-codecs-sections.ts`, beside `:51`:

```ts
export const CSV_SECTION_DOCUMENT_VERSIONS = "# DOCUMENT VERSIONS";
```

- [ ] **Step 4: Encode + decode helpers in `csv-codecs-config.ts`, beside `:250-254`**

```ts
export function documentVersionsToCsv(
  versions: readonly DocVersion[],
  neutralize = false,
): string {
  return ["config", csvCellEscape(JSON.stringify(versions), neutralize)].join(",");
}

export function csvToDocumentVersions(text: string): DocVersion[] | undefined {
  const rows = parseCsv(text).filter((r) => r.length >= 2 && r[0] === "config");
  if (rows.length === 0) return undefined;
  try {
    // ★★ DOM-DEPENDENT and SILENT on failure, exactly like csvToDocuments
    // directly above: without a DOM the rich-field pass throws, this catch
    // swallows it, and the history decodes to UNDEFINED with no diagnostic.
    // scripts/generate-sample-workspace.ts installs JSDOM before importing
    // src/app/storage; a new bare-node importer must do the same.
    const versions = sanitizeDocumentVersions(JSON.parse(rows[0][1])).map((v) => ({
      ...v,
      blocks: sanitizeDocumentRichFields({
        id: v.documentId, title: v.title, blocks: v.blocks,
        createdAt: v.savedAt, updatedAt: v.savedAt,
      }).blocks,
    }));
    return versions.length ? versions : undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 5: Emit it, beside `:613-614`**

```ts
  if (config === undefined && ws.documentVersions && ws.documentVersions.length)
    csvPush(CSV_SECTION_DOCUMENT_VERSIONS, documentVersionsToCsv(ws.documentVersions, neutralize));
```

The `config === undefined` gate is what keeps history **storage-only** — it must never appear in a user-facing export.

- [ ] **Step 6: Decode wiring in `csv-codecs-decode.ts`**

Four edits, mirroring `documents` at each site:

```ts
// :137 — in the section-text struct
  documentVersionsText: string;
// :140 — add to the mode union
  | "documentVersions"
// :165
  const documentVersionsLines: string[] = [];
// :187
    if (trimmed.startsWith(CSV_SECTION_DOCUMENT_VERSIONS)) { mode = "documentVersions"; continue; }
// :217
    else if (mode === "documentVersions") documentVersionsLines.push(line);
// :248
    documentVersionsText: documentVersionsLines.join("\r\n"),
// :464 — after the documents block
  if (s.documentVersionsText.trim()) {
    const versions = csvToDocumentVersions(s.documentVersionsText);
    if (versions) ws.documentVersions = versions;
  }
```

★ CSV is CRLF — the join above must stay `"\r\n"`.

★★ Section-marker ORDER matters: `# DOCUMENTS` is a prefix of nothing, but check that `startsWith(CSV_SECTION_DOCUMENTS)` is not tested **before** `CSV_SECTION_DOCUMENT_VERSIONS` in the if-chain, or `# DOCUMENT VERSIONS` never matches — `"# DOCUMENT VERSIONS".startsWith("# DOCUMENTS")` is false, so this is safe as written, but re-read the chain and confirm rather than trusting this note.

- [ ] **Step 7: Run and commit**

```bash
npx vitest run src/app/csv-codecs.documents.test.ts --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/t6.log
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/csv-codecs-sections.ts src/app/csv-codecs-config.ts src/app/csv-codecs-decode.ts src/app/csv-codecs.documents.test.ts
git commit -m "feat: persist documentVersions on the CSV path"
```

---

### Task 7: Markdown path

**Files:**
- Modify: `src/app/markdown-codecs-core.ts:201-205,575`, `src/app/markdown-codecs-decode.ts:65,347`
- Test: `src/app/markdown-codecs.documents.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("documentVersions markdown section", () => {
  const VERSION = {
    id: 1, documentId: 3, title: "Prior", blocks: [],
    savedAt: "2026-08-05T07:00:00.000Z", source: "user" as const, op: "delete" as const,
  };

  it("round-trips", () => {
    const md = documentVersionsToMarkdown([VERSION]);
    expect(markdownToDocumentVersions(md)).toEqual([VERSION]);
  });

  it("puts no fence at column 0 inside the payload", () => {
    const nasty = { ...VERSION, title: "``` not a fence" };
    const md = documentVersionsToMarkdown([nasty]);
    const fenceLines = md.split("\n").filter((l) => l.startsWith("```"));
    expect(fenceLines).toHaveLength(2);
    expect(markdownToDocumentVersions(md)).toEqual([nasty]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/markdown-codecs.documents.test.ts --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t7.log
```

- [ ] **Step 3: Encode + decode, beside `markdown-codecs-core.ts:201`**

````ts
/** Fenced JSON, mirroring {@link documentsToMarkdown}. A nested block array
 *  cannot survive a pipe-delimited table row, and there is no table pattern to
 *  copy. Fence collision is harmless BY CONSTRUCTION: JSON.stringify escapes
 *  U+000A as the two characters \ and n, so no user-typed backtick can land at
 *  column 0, and the reader only accepts a closing fence at line start. */
export function documentVersionsToMarkdown(versions: readonly DocVersion[]): string {
  return ["## Document versions", "", "```json", JSON.stringify(versions, null, 2), "```", ""].join("\n");
}

export function markdownToDocumentVersions(md: string): DocVersion[] | undefined {
  const m = /## Document versions\s*\n+```json\s*\n([\s\S]*?)\n```/.exec(md);
  if (!m) return undefined;
  try {
    // ★★ DOM-DEPENDENT and SILENT, exactly as markdownToDocuments above.
    const versions = sanitizeDocumentVersions(JSON.parse(m[1])).map((v) => ({
      ...v,
      blocks: sanitizeDocumentRichFields({
        id: v.documentId, title: v.title, blocks: v.blocks,
        createdAt: v.savedAt, updatedAt: v.savedAt,
      }).blocks,
    }));
    return versions.length ? versions : undefined;
  } catch {
    return undefined;
  }
}
````

★ The heading must be `## Document versions`, not `## Documents versions` — and note that `markdownToDocuments`' own regex `/## Documents\s*\n+/` requires whitespace-then-newline after `Documents`, so `## Document versions` cannot be captured by it. Verify with the round-trip test in Step 5 that a workspace carrying **both** sections decodes both.

- [ ] **Step 4: Emit + decode wiring**

`markdown-codecs-core.ts` after `:575`:

```ts
  if (config === undefined && ws.documentVersions && ws.documentVersions.length)
    mdParts.push(documentVersionsToMarkdown(ws.documentVersions));
```

`markdown-codecs-decode.ts` — import at `:65` and, after `:347`:

```ts
  const versions = markdownToDocumentVersions(md);
  if (versions) ws.documentVersions = versions;
```

- [ ] **Step 5: Add the both-sections test**

```ts
it("decodes documents and document versions from the same file", () => {
  const ws = {
    ...emptyWorkspace(),
    documents: [{ id: 3, title: "Doc", blocks: [], createdAt: "2026-08-05T07:00:00.000Z", updatedAt: "2026-08-05T07:00:00.000Z" }],
    documentVersions: [VERSION],
  };
  const back = markdownToWorkspace(workspaceToMarkdown(ws));
  expect(back.documents).toHaveLength(1);
  expect(back.documentVersions).toHaveLength(1);
});
```

- [ ] **Step 6: Run and commit**

```bash
npx vitest run src/app/markdown-codecs.documents.test.ts --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/t7.log
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/markdown-codecs-core.ts src/app/markdown-codecs-decode.ts src/app/markdown-codecs.documents.test.ts
git commit -m "feat: persist documentVersions on the Markdown path"
```

---

### Task 8: Registry test, sample data, goldens

**Files:**
- Modify: `src/app/entity-persistence-registry.test.ts:303`
- Modify: `public/sample-workspace-small.json` (confirm the real path with `grep -rn "sample-workspace-small" scripts/ src/ e2e/ | head -3`)
- Regenerate: `public/sample-workspace-big.json`, `-huge.json`, `src/app/__fixtures__/golden-*`

- [ ] **Step 1: Extend the registry test**

Mirror the existing `documents` block at `:303-330`:

```ts
describe("entity persistence registry — documentVersions survive every text backend", () => {
  const seedVersions = () => ({
    ...seedDocs(),
    documentVersions: [{
      id: 1, documentId: 1, title: "Prior title", blocks: [],
      savedAt: "2026-08-06T07:00:00.000Z", source: "ai" as const, op: "update" as const,
    }],
  });

  it("documentVersions survive the CSV round-trip", () => {
    const back = csvToWorkspace(workspaceToCsv(seedVersions()));
    expect(back.documentVersions).toEqual(seedVersions().documentVersions);
  });

  it("documentVersions survive the Markdown round-trip", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(seedVersions()));
    expect(back.documentVersions).toEqual(seedVersions().documentVersions);
  });

  it("documentVersions survive the JSON round-trip", () => {
    const back = jsonToWorkspace(workspaceToJson(seedVersions()));
    expect(back.documentVersions).toEqual(seedVersions().documentVersions);
  });
});
```

- [ ] **Step 2: Seed one version in the sample master**

Find the sample document's `id` in `public/sample-workspace-small.json` and add a sibling top-level key:

```json
  "documentVersions": [
    {
      "id": 1,
      "documentId": <the sample document's id>,
      "title": "Weekly status — draft",
      "blocks": [
        { "type": "heading", "level": 1, "text": "Weekly status" },
        { "type": "paragraph", "html": "<p>First draft, before the numbers landed.</p>" }
      ],
      "savedAt": "2026-08-06T08:00:00.000Z",
      "source": "ai",
      "op": "update"
    }
  ],
```

Not a tombstone — its `documentId` must match a **live** sample document, or the demo data shows a phantom deleted row.

- [ ] **Step 3: Regenerate the derived samples and goldens**

```bash
npx vite-node scripts/generate-sample-workspace.ts; echo "EXIT=$?"
```

Then regenerate the golden fixtures the way the repo already does it — find the command with:

```bash
grep -rn "golden" package.json scripts/*.mjs scripts/*.ts | head
```

- [ ] **Step 4: Verify the goldens changed for the right reason**

```bash
git diff --stat src/app/__fixtures__/
git diff src/app/__fixtures__/ | grep -c "DOCUMENT VERSIONS"
```

Expected: the CSV and MD goldens gained a document-versions section and **nothing else changed**. If any unrelated row moved, stop — that is a real format regression, not a legitimate regen.

- [ ] **Step 5: Run the byte-stability suite**

```bash
npx vitest run src/app/golden-workspace.test.ts src/app/entity-persistence-registry.test.ts --reporter=dot > /tmp/t8.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/t8.log
```

★★ `golden-workspace.test` pins CSV and Markdown bytes **only** — there is no golden JSON and nothing pins IDB or Turso. Tasks 3-5's own tests are the entire net on those three paths.

- [ ] **Step 6: Commit**

```bash
git add src/app/entity-persistence-registry.test.ts public/sample-workspace-*.json src/app/__fixtures__/
git commit -m "test: pin documentVersions across every backend and regenerate goldens"
```

---

### Task 9: `document-mutations.ts` — the single mutation path

**Files:**
- Create: `src/app/document-mutations.ts`, `src/app/document-mutations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/document-mutations.test.ts
import { describe, it, expect } from "vitest";
import { applyDocMutation, type DocState } from "./document-mutations";
import type { ProjectDocument } from "./document-model";

const DOC: ProjectDocument = {
  id: 1,
  title: "Status report",
  blocks: [
    { type: "heading", level: 1, text: "Week 12" },
    { type: "paragraph", html: "<p>on track</p>" },
  ],
  createdAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-01T08:00:00.000Z",
};

const state = (over: Partial<DocState> = {}): DocState => ({
  documents: [DOC],
  versions: [],
  ...over,
});

let nextDoc = 100;
let nextVer = 200;
const ctx = () => ({
  now: "2026-08-06T09:00:00.000Z",
  source: "ai" as const,
  mintDocId: () => nextDoc++,
  mintVersionId: () => nextVer++,
});

describe("applyDocMutation — versions", () => {
  it("create writes no version — nothing was replaced", () => {
    const out = applyDocMutation(state(), { kind: "create", title: "New" }, ctx());
    expect(out.versions).toEqual([]);
    expect(out.documents).toHaveLength(2);
  });

  it("rename snapshots the PRIOR title, not the new one", () => {
    const out = applyDocMutation(state(), { kind: "rename", id: 1, title: "Renamed" }, ctx());
    expect(out.versions).toHaveLength(1);
    expect(out.versions[0].title).toBe("Status report");
    expect(out.versions[0].op).toBe("rename");
    expect(out.documents[0].title).toBe("Renamed");
  });

  it("delete snapshots before removing", () => {
    const out = applyDocMutation(state(), { kind: "delete", id: 1 }, ctx());
    expect(out.documents).toEqual([]);
    expect(out.versions[0].blocks).toEqual(DOC.blocks);
    expect(out.versions[0].op).toBe("delete");
  });

  it("a no-op returns the SAME references and changed:false", () => {
    const s = state();
    const out = applyDocMutation(s, { kind: "rename", id: 999, title: "x" }, ctx());
    expect(out.documents).toBe(s.documents);
    expect(out.versions).toBe(s.versions);
    expect(out.changed).toBe(false);
  });
});

describe("applyDocMutation — ops", () => {
  it("applies ops against the EVOLVING array", () => {
    const out = applyDocMutation(
      state(),
      { kind: "ops", id: 1, ops: [{ op: "delete", index: 0 }, { op: "delete", index: 0 }] },
      ctx(),
    );
    expect(out.documents[0].blocks).toEqual([]);
  });

  it("appends, inserts and replaces", () => {
    const out = applyDocMutation(
      state(),
      {
        kind: "ops",
        id: 1,
        ops: [
          { op: "append", block: { type: "pageBreak" } },
          { op: "insert", index: 0, block: { type: "heading", level: 2, text: "Intro" } },
          { op: "replace", index: 1, block: { type: "heading", level: 3, text: "Week 13" } },
        ],
      },
      ctx(),
    );
    expect(out.documents[0].blocks.map((b) => b.type)).toEqual([
      "heading", "heading", "paragraph", "pageBreak",
    ]);
    expect(out.documents[0].blocks[1]).toEqual({ type: "heading", level: 3, text: "Week 13" });
  });

  it("rejects an out-of-range index and reports it", () => {
    const out = applyDocMutation(state(), { kind: "ops", id: 1, ops: [{ op: "replace", index: 9, block: { type: "pageBreak" } }] }, ctx());
    expect(out.rejected).toHaveLength(1);
    expect(out.changed).toBe(false);
    expect(out.documents).toEqual(state().documents);
  });

  // ★ THE GUARD THAT MATTERS. Seeded with REAL prior blocks, so a
  // preserve-vs-erase bug cannot pass.
  it("leaves stored blocks untouched when every op is rejected", () => {
    const out = applyDocMutation(
      state(),
      { kind: "ops", id: 1, ops: [{ op: "delete", index: 42 }, { op: "replace", index: 7, block: { type: "pageBreak" } }] },
      ctx(),
    );
    expect(out.documents[0].blocks).toEqual(DOC.blocks);
    expect(out.versions).toEqual([]);
  });

  it("replaceAll swaps the whole array and snapshots the prior one", () => {
    const out = applyDocMutation(
      state(),
      { kind: "ops", id: 1, ops: [{ op: "replaceAll", blocks: [{ type: "pageBreak" }] }] },
      ctx(),
    );
    expect(out.documents[0].blocks).toEqual([{ type: "pageBreak" }]);
    expect(out.versions[0].blocks).toEqual(DOC.blocks);
  });
});

describe("applyDocMutation — restore", () => {
  it("restores a live document IN PLACE", () => {
    const renamed = applyDocMutation(state(), { kind: "rename", id: 1, title: "Renamed" }, ctx());
    const restored = applyDocMutation(renamed, { kind: "restore", versionId: renamed.versions[0].id }, ctx());
    expect(restored.documents[0].id).toBe(1);
    expect(restored.documents[0].title).toBe("Status report");
    // Restoring is itself revertible: it snapshots what it replaced.
    expect(restored.versions.some((v) => v.title === "Renamed")).toBe(true);
  });

  it("restores a DELETED document under a NEW id", () => {
    const deleted = applyDocMutation(state(), { kind: "delete", id: 1 }, ctx());
    const restored = applyDocMutation(deleted, { kind: "restore", versionId: deleted.versions[0].id }, ctx());
    expect(restored.documents).toHaveLength(1);
    expect(restored.documents[0].id).not.toBe(1);
    expect(restored.documents[0].blocks).toEqual(DOC.blocks);
  });

  it("does not consume the version it restored", () => {
    const deleted = applyDocMutation(state(), { kind: "delete", id: 1 }, ctx());
    const vid = deleted.versions[0].id;
    const restored = applyDocMutation(deleted, { kind: "restore", versionId: vid }, ctx());
    expect(restored.versions.some((v) => v.id === vid)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/document-mutations.test.ts --reporter=dot > /tmp/t9.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t9.log
```

Expected: FAIL — cannot resolve `./document-mutations`.

- [ ] **Step 3: Write the module**

```ts
// src/app/document-mutations.ts — THE single mutation path for project
// documents. Both the Documents pane and the AI tools call this, so
// "every mutation snapshots" cannot be half-implemented.
//
// ★★★ DOM-FREE BY CONTRACT (same reason as document-model.ts).
// ★★★ NO CLOCK AND NO MINT: `now` and both id minters are injected, so the
// result is a deterministic function of its inputs and the property test can
// drive it.
import { MAX_TITLE_CHARS, type DocBlock, type ProjectDocument } from "./document-model";
import { trimVersions, type DocVersion, type DocVersionSource } from "./document-versions";

export type DocOp =
  | { op: "append"; block: DocBlock }
  | { op: "insert"; index: number; block: DocBlock }
  | { op: "replace"; index: number; block: DocBlock }
  | { op: "delete"; index: number }
  | { op: "replaceAll"; blocks: readonly DocBlock[] };

export type DocMutation =
  | { kind: "create"; title: string; blocks?: readonly DocBlock[] }
  | { kind: "rename"; id: number; title: string }
  | { kind: "duplicate"; id: number; title: string }
  | { kind: "delete"; id: number }
  | { kind: "ops"; id: number; ops: readonly DocOp[]; title?: string }
  | { kind: "restore"; versionId: number };

export type DocState = {
  documents: readonly ProjectDocument[];
  versions: readonly DocVersion[];
};

export type DocResult = DocState & {
  changed: boolean;
  rejected: readonly string[];
  /** The document the mutation landed on — the caller's tool result needs it. */
  documentId: number | null;
};

export type DocContext = {
  now: string;
  source: DocVersionSource;
  mintDocId: () => number;
  mintVersionId: () => number;
};

const unchanged = (s: DocState, rejected: readonly string[] = []): DocResult => ({
  documents: s.documents,
  versions: s.versions,
  changed: false,
  rejected,
  documentId: null,
});

function snapshot(
  doc: ProjectDocument,
  op: DocVersion["op"],
  ctx: DocContext,
): DocVersion {
  return {
    id: ctx.mintVersionId(),
    documentId: doc.id,
    title: doc.title,
    blocks: doc.blocks,
    savedAt: ctx.now,
    source: ctx.source,
    op,
  };
}

/** Apply ops LEFT TO RIGHT against the evolving array. An index is resolved
 *  against the array as it stands at that step, which is the only reading a
 *  model can act on deterministically — `[delete 0, delete 0]` means "the
 *  first two". Returns null when EVERY op was rejected. */
function applyOps(
  blocks: readonly DocBlock[],
  ops: readonly DocOp[],
  rejected: string[],
): readonly DocBlock[] | null {
  let next = [...blocks];
  let applied = 0;
  for (const [i, op] of ops.entries()) {
    switch (op.op) {
      case "append":
        next.push(op.block);
        applied++;
        break;
      case "replaceAll":
        next = [...op.blocks];
        applied++;
        break;
      case "insert":
        if (!Number.isInteger(op.index) || op.index < 0 || op.index > next.length) {
          rejected.push(`op ${i}: insert index ${op.index} out of range 0..${next.length}`);
          break;
        }
        next.splice(op.index, 0, op.block);
        applied++;
        break;
      case "replace":
        if (!Number.isInteger(op.index) || op.index < 0 || op.index >= next.length) {
          rejected.push(`op ${i}: replace index ${op.index} out of range 0..${next.length - 1}`);
          break;
        }
        next[op.index] = op.block;
        applied++;
        break;
      case "delete":
        if (!Number.isInteger(op.index) || op.index < 0 || op.index >= next.length) {
          rejected.push(`op ${i}: delete index ${op.index} out of range 0..${next.length - 1}`);
          break;
        }
        next.splice(op.index, 1);
        applied++;
        break;
    }
  }
  // ★★★ A WHOLLY-REFUSED WRITE MUST NOT MUTATE. Writing the (unchanged or
  // empty) result here would destroy the document while the caller reports
  // only "I couldn't do that" — the set_task_dependencies failure class, and
  // chat tool writes have NO undo capture.
  return applied === 0 ? null : next;
}

function withVersions(
  documents: readonly ProjectDocument[],
  versions: readonly DocVersion[],
  added: DocVersion | null,
): readonly DocVersion[] {
  const all = added ? [...versions, added] : versions;
  return trimVersions(all, documents.map((d) => d.id));
}

export function applyDocMutation(
  state: DocState,
  m: DocMutation,
  ctx: DocContext,
): DocResult {
  const { documents, versions } = state;

  if (m.kind === "create") {
    const doc: ProjectDocument = {
      id: ctx.mintDocId(),
      title: m.title.slice(0, MAX_TITLE_CHARS),
      blocks: m.blocks ?? [],
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
    const nextDocs = [...documents, doc];
    return { documents: nextDocs, versions, changed: true, rejected: [], documentId: doc.id };
  }

  if (m.kind === "restore") {
    const version = versions.find((v) => v.id === m.versionId);
    if (!version) return unchanged(state, [`version #${m.versionId} not found`]);
    const target = documents.find((d) => d.id === version.documentId);
    if (target) {
      // Live document: restore IN PLACE, snapshotting what we replace so the
      // restore is itself revertible.
      const nextDocs = documents.map((d) =>
        d.id === target.id
          ? { ...d, title: version.title, blocks: version.blocks, updatedAt: ctx.now }
          : d,
      );
      return {
        documents: nextDocs,
        versions: withVersions(nextDocs, versions, snapshot(target, "update", ctx)),
        changed: true,
        rejected: [],
        documentId: target.id,
      };
    }
    // Deleted document: recreate under a NEW id. The old id may have been
    // re-minted; the version row is NOT consumed.
    const revived: ProjectDocument = {
      id: ctx.mintDocId(),
      title: version.title,
      blocks: version.blocks,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
    const nextDocs = [...documents, revived];
    return {
      documents: nextDocs,
      versions: withVersions(nextDocs, versions, null),
      changed: true,
      rejected: [],
      documentId: revived.id,
    };
  }

  const target = documents.find((d) => d.id === m.id);
  if (!target) return unchanged(state, [`document #${m.id} not found`]);

  if (m.kind === "rename") {
    if (target.title === m.title) return unchanged(state);
    const nextDocs = documents.map((d) =>
      d.id === m.id ? { ...d, title: m.title.slice(0, MAX_TITLE_CHARS), updatedAt: ctx.now } : d,
    );
    return {
      documents: nextDocs,
      versions: withVersions(nextDocs, versions, snapshot(target, "rename", ctx)),
      changed: true,
      rejected: [],
      documentId: m.id,
    };
  }

  if (m.kind === "duplicate") {
    const copy: ProjectDocument = {
      ...target,
      id: ctx.mintDocId(),
      title: m.title.slice(0, MAX_TITLE_CHARS),
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
    const nextDocs = [...documents, copy];
    // The version is written against the COPY, so its first revert returns it
    // to the copied-from state rather than to nothing.
    return {
      documents: nextDocs,
      versions: withVersions(nextDocs, versions, snapshot(copy, "duplicate", ctx)),
      changed: true,
      rejected: [],
      documentId: copy.id,
    };
  }

  if (m.kind === "delete") {
    const nextDocs = documents.filter((d) => d.id !== m.id);
    return {
      documents: nextDocs,
      versions: withVersions(nextDocs, versions, snapshot(target, "delete", ctx)),
      changed: true,
      rejected: [],
      documentId: m.id,
    };
  }

  // kind === "ops"
  const rejected: string[] = [];
  const nextBlocks = applyOps(target.blocks, m.ops, rejected);
  const titleChanged = m.title !== undefined && m.title !== target.title;
  if (nextBlocks === null && !titleChanged) return unchanged(state, rejected);

  const nextDocs = documents.map((d) =>
    d.id === m.id
      ? {
          ...d,
          title: titleChanged ? m.title!.slice(0, MAX_TITLE_CHARS) : d.title,
          blocks: nextBlocks ?? d.blocks,
          updatedAt: ctx.now,
        }
      : d,
  );
  return {
    documents: nextDocs,
    versions: withVersions(nextDocs, versions, snapshot(target, "update", ctx)),
    changed: true,
    rejected,
    documentId: m.id,
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/app/document-mutations.test.ts --reporter=dot > /tmp/t9.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t9.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: EXIT=0 both.

- [ ] **Step 5: Mutation-test the refusal guard**

Temporarily change `return applied === 0 ? null : next;` to `return next;` and re-run. Expected: the "leaves stored blocks untouched" test FAILS. Revert. If it stays green, the test is vacuous — fix the test before moving on.

- [ ] **Step 6: Commit**

```bash
git add src/app/document-mutations.ts src/app/document-mutations.test.ts
git commit -m "feat: add applyDocMutation, the single document mutation path"
```

---

### Task 10: Property test for mutate-then-restore

**Files:**
- Create: `src/app/document-mutations.property.test.ts`

- [ ] **Step 1: Write the property test**

```ts
// src/app/document-mutations.property.test.ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { applyDocMutation, type DocMutation, type DocState } from "./document-mutations";
import type { DocBlock } from "./document-model";

const blockArb: fc.Arbitrary<DocBlock> = fc.oneof(
  fc.record({ type: fc.constant("heading" as const), level: fc.constantFrom(1 as const, 2 as const, 3 as const), text: fc.string({ maxLength: 40 }) }),
  fc.record({ type: fc.constant("paragraph" as const), html: fc.string({ maxLength: 40 }).map((s) => `<p>${s.replace(/[<>&]/g, "")}</p>`) }),
  fc.record({ type: fc.constant("pageBreak" as const) }),
);

// ★ An integer ms range, NOT a bare fc.date(): fc.date() can emit an Invalid
// Date whose .toISOString() throws.
const isoArb = fc
  .integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) })
  .map((ms) => new Date(ms).toISOString());

describe("mutate then restore returns the prior document state", () => {
  it("holds for rename, delete and ops", () => {
    fc.assert(
      fc.property(
        fc.array(blockArb, { maxLength: 8 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        isoArb,
        fc.constantFrom<"rename" | "delete" | "ops">("rename", "delete", "ops"),
        (blocks, title, now, kind) => {
          let docId = 10;
          let verId = 500;
          const ctx = { now, source: "ai" as const, mintDocId: () => docId++, mintVersionId: () => verId++ };
          const before: DocState = {
            documents: [{ id: 1, title, blocks, createdAt: now, updatedAt: now }],
            versions: [],
          };

          const mutation: DocMutation =
            kind === "rename"
              ? { kind: "rename", id: 1, title: `${title}-changed` }
              : kind === "delete"
                ? { kind: "delete", id: 1 }
                : { kind: "ops", id: 1, ops: [{ op: "replaceAll", blocks: [{ type: "pageBreak" }] }] };

          const after = applyDocMutation(before, mutation, ctx);
          if (!after.changed) return true; // a no-op has nothing to restore

          const newest = after.versions[after.versions.length - 1];
          const restored = applyDocMutation(after, { kind: "restore", versionId: newest.id }, ctx);
          const doc = restored.documents.find((d) => d.id === restored.documentId)!;

          expect(doc.title).toEqual(title);
          expect(doc.blocks).toEqual(blocks);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/app/document-mutations.property.test.ts --reporter=dot > /tmp/t10.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t10.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: EXIT=0. A rare timeout under full-suite parallel load is a load artifact, not a logic bug — the config raises testTimeout to 20s for exactly this. Re-run in isolation before touching the property.

- [ ] **Step 3: Commit**

```bash
git add src/app/document-mutations.property.test.ts
git commit -m "test: property-test document mutate-then-restore"
```

---

### Task 11: `mutateDocuments` in workspace-context

**Files:**
- Modify: `src/app/workspace-context.tsx:128` (type), `:163` (state), `:384` (value)
- Test: `src/app/workspace-context.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing test**

```tsx
// in src/app/workspace-context.test.tsx
import { renderHook, act } from "@testing-library/react";
import { StrictMode } from "react";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";

// ★★★ `wrapper: StrictMode` — NOT ({children}) => <StrictMode>{children}</StrictMode>.
// The composed shape puts a fiber between the root and StrictMode, React does
// not double-invoke, and the test passes with the line it claims to pin
// DELETED. See src/app/strictmode.meta.test.tsx.
it("writes exactly one version per mutation under StrictMode", () => {
  const { result } = renderHook(() => useWorkspace(), {
    wrapper: ({ children }) => <WorkspaceProvider>{children}</WorkspaceProvider>,
    reactStrictMode: true,
  });

  act(() => {
    result.current.mutateDocuments({ kind: "create", title: "Doc" }, "user");
  });
  const id = result.current.documents[0].id;

  act(() => {
    result.current.mutateDocuments({ kind: "rename", id, title: "Renamed" }, "user");
  });

  expect(result.current.documents[0].title).toBe("Renamed");
  expect(result.current.documentVersions).toHaveLength(1);
  expect(result.current.documentVersions[0].title).toBe("Doc");
});

it("snapshots the CURRENT document on a second mutation in the same tick", () => {
  const { result } = renderHook(() => useWorkspace(), {
    wrapper: ({ children }) => <WorkspaceProvider>{children}</WorkspaceProvider>,
  });
  act(() => {
    result.current.mutateDocuments({ kind: "create", title: "A" }, "user");
  });
  const id = result.current.documents[0].id;
  act(() => {
    result.current.mutateDocuments({ kind: "rename", id, title: "B" }, "user");
    result.current.mutateDocuments({ kind: "rename", id, title: "C" }, "user");
  });
  expect(result.current.documents[0].title).toBe("C");
  expect(result.current.documentVersions.map((v) => v.title)).toEqual(["A", "B"]);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/workspace-context.test.tsx --reporter=dot > /tmp/t11.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t11.log
```

- [ ] **Step 3: Add the state slice**

In the `WorkspaceValue` type, beside `documents` at `:128`:

```ts
  /** ★ NON-optional (`[]` when empty), for the same reason `documents` is:
   *  callers spread `prev`, and an `undefined` state would throw. Byte
   *  stability is unaffected — `workspaceToJson` emits the key only when
   *  `length > 0`. */
  documentVersions: readonly DocVersion[];
  setDocumentVersions: Dispatch<SetStateAction<readonly DocVersion[]>>;
  /** THE document mutation entry point — used by the Documents pane AND the AI
   *  tools, so "every mutation snapshots" cannot be half-implemented. Returns
   *  the result synchronously so a tool can report `rejected` without
   *  re-reading state. */
  mutateDocuments: (m: DocMutation, source: DocVersionSource) => DocResult;
```

and the state at `:163`:

```ts
  const [documentVersions, setDocumentVersions] = useState<readonly DocVersion[]>([]);
```

- [ ] **Step 4: Add the refs and the callback**

Inside `WorkspaceProvider`, after the state declarations:

```tsx
  // ★★★ THE SNAPSHOT CANNOT BE COMPUTED INSIDE A FUNCTIONAL SETTER.
  // `setDocuments(prev => …)` and `setDocumentVersions(prev => …)` are separate
  // setters, and the before-image is available in the documents updater while
  // it must land in the versions one. Doing it there makes the updater impure,
  // and React StrictMode double-invokes updaters — appending the version TWICE.
  // So both slices are mirrored into refs and composed here, in the one place
  // that owns both. Same ref discipline use-chat-dispatcher.ts already uses.
  const documentsRef = useRef(documents);
  const documentVersionsRef = useRef(documentVersions);
  useEffect(() => { documentsRef.current = documents; }, [documents]);
  useEffect(() => { documentVersionsRef.current = documentVersions; }, [documentVersions]);

  const mutateDocuments = useCallback(
    (m: DocMutation, source: DocVersionSource): DocResult => {
      const result = applyDocMutation(
        { documents: documentsRef.current, versions: documentVersionsRef.current },
        m,
        {
          now: new Date().toISOString(),
          source,
          mintDocId: () => mintId("document", documentsRef.current),
          mintVersionId: () => mintId("documentVersion", documentVersionsRef.current),
        },
      );
      if (!result.changed) return result;
      // Write the refs BEFORE the setters: a second call in the same tick must
      // see the first one's result, or it snapshots a stale before-image.
      documentsRef.current = result.documents;
      documentVersionsRef.current = result.versions;
      setDocuments(result.documents);
      setDocumentVersions(result.versions);
      return result;
    },
    [],
  );
```

Add `documentVersions`, `setDocumentVersions` and `mutateDocuments` to the provider's `value` object at `:384` and to the memo dependency list beside `documents`.

- [ ] **Step 5: Run tests, lint and size**

```bash
npx vitest run src/app/workspace-context.test.tsx --reporter=dot > /tmp/t11.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t11.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
```

★ `react-hooks/exhaustive-deps` rejects an `obj.member` dependency — if it complains, hoist to a local const. `new Date()` inside the callback is fine (the purity rule bans it in a render body, not a callback).

- [ ] **Step 6: Commit**

```bash
git add src/app/workspace-context.tsx src/app/workspace-context.test.tsx
git commit -m "feat: compose document mutations and their versions in workspace-context"
```

---

### Task 12: Load/save wiring for `documentVersions`

The context state must be filled on load and written on save, exactly where `documents` is. Find both sites first:

```bash
grep -rn "setDocuments\|documents:" src/app/task-manager.tsx src/app/use-workspace-io.ts src/app/use-storage-file-ops.ts 2>/dev/null | head -20
```

**Files:**
- Modify: whichever module the grep shows owns the load-apply and save-assemble for `documents` (do **not** guess — `task-manager.tsx` is baselined at 2972 lines and cannot grow, so if the wiring lives there, the added lines must be offset by removing at least as many, or moved into the hook that owns them)

- [ ] **Step 1: Write the failing test**

Extend the test that already covers `documents` load/save in that module (find it with `grep -rln "documents" src/app/*.test.tsx | head`), asserting `documentVersions` makes the same round trip.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run <that test file> --reporter=dot > /tmp/t12.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t12.log
```

- [ ] **Step 3: Mirror the `documents` wiring**

Add `setDocumentVersions(ws.documentVersions ?? [])` beside the existing `setDocuments(...)` on the load path, and `documentVersions` beside `documents` in the object handed to `save`. Include it in the autosave effect's dependency array — `knowledgeItems` is the precedent to copy.

- [ ] **Step 4: Verify the size ratchet did not break**

```bash
npm run size:check; echo "EXIT=$?"
```

If `task-manager.tsx` grew, move the wiring into the hook that owns storage IO instead. Do not update the baseline.

- [ ] **Step 5: Commit**

```bash
git add -A src/app
git commit -m "feat: load and save documentVersions with the workspace"
```

---

### Task 13: Documents pane routes through `mutateDocuments`

**Files:**
- Modify: `src/app/documents-panel.tsx` (delete `appendDocument`, `duplicateDocument`, `renameDocument`, `removeDocument`; keep `uniqueDocumentTitle` and `sortDocuments`)
- Modify: `src/app/documents-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("records a version when the user renames a document", async () => {
  const user = userEvent.setup();
  renderPanel(); // the file's existing helper — read it and reuse it
  await user.click(screen.getByRole("button", { name: /new document/i }));
  await user.click(screen.getByRole("button", { name: /rename/i }));
  // …the file's existing rename interaction…
  expect(screen.getByRole("button", { name: /history –/i })).toBeInTheDocument();
});
```

Adapt to whatever the panel's existing test harness does — read `documents-panel.test.tsx` before writing this.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/documents-panel.test.tsx --reporter=dot > /tmp/t13.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t13.log
```

- [ ] **Step 3: Replace the four handlers**

```tsx
  const { documents, documentVersions, mutateDocuments } = useWorkspace();

  const handleCreate = () => {
    mutateDocuments(
      { kind: "create", title: uniqueDocumentTitle(documents, t(lang, "documentsNewTitle")) },
      "user",
    );
  };

  const handleDuplicate = (doc: ProjectDocument) => {
    mutateDocuments({ kind: "duplicate", id: doc.id, title: uniqueDocumentTitle(documents, doc.title) }, "user");
  };

  const handleRenameCommit = (id: number, title: string) => {
    if (!title) return;
    mutateDocuments({ kind: "rename", id, title }, "user");
  };

  const handleDelete = (doc: ProjectDocument) => {
    if (!ok) return;                      // keep the existing confirm dialog
    mutateDocuments({ kind: "delete", id: doc.id }, "user");
  };
```

Delete the four exported helpers and their `setDocuments` call sites, plus any now-unused imports — an unused import is a **fatal** lint error under `--max-warnings=0`.

- [ ] **Step 4: Move the helpers' tests**

The four deleted helpers had tests in `documents-panel.test.tsx`. Their behaviour is now covered by `document-mutations.test.ts` — delete the superseded cases rather than leaving them asserting against deleted exports.

- [ ] **Step 5: Run everything the panel touches**

```bash
npx vitest run src/app/documents-panel.test.tsx src/app/document-mutations.test.ts --reporter=dot > /tmp/t13.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t13.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

- [ ] **Step 6: Commit**

```bash
git add src/app/documents-panel.tsx src/app/documents-panel.test.tsx
git commit -m "refactor: route the Documents pane through the shared mutation path"
```

---

### Task 14: `ai-document-blocks.ts` — the model-input allow-list

**Files:**
- Create: `src/app/ai-document-blocks.ts`, `src/app/ai-document-blocks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/ai-document-blocks.test.ts
import { describe, it, expect } from "vitest";
import { sanitizeAiDocBlocks } from "./ai-document-blocks";

describe("sanitizeAiDocBlocks", () => {
  it("strips a script tag from model-authored paragraph HTML", () => {
    const out = sanitizeAiDocBlocks([{ type: "paragraph", html: "<p>hi</p><script>alert(1)</script>" }]);
    expect(JSON.stringify(out)).not.toContain("script");
    expect(JSON.stringify(out)).toContain("hi");
  });

  // ★★★ sanitizeTemplateHtml, NOT sanitizeNoteHtml. Both DELETE an <h3> tag —
  // neither allow-list contains it. What differs is the TEXT inside it:
  // sanitizeNoteHtml sets KEEP_CONTENT:false and deletes the word too.
  it("keeps the text inside a non-allow-listed tag", () => {
    const out = sanitizeAiDocBlocks([{ type: "paragraph", html: "<h3>Section</h3>" }]);
    expect(JSON.stringify(out)).toContain("Section");
  });

  it("upgrades plain text the model sent instead of HTML", () => {
    const out = sanitizeAiDocBlocks([{ type: "paragraph", html: "just words" }]);
    expect(out[0]).toMatchObject({ type: "paragraph" });
    expect(JSON.stringify(out)).toContain("just words");
  });

  it("drops an unknown block type", () => {
    expect(sanitizeAiDocBlocks([{ type: "video", src: "x" }])).toEqual([]);
  });

  it("returns [] for a non-array", () => {
    expect(sanitizeAiDocBlocks("nope")).toEqual([]);
    expect(sanitizeAiDocBlocks(undefined)).toEqual([]);
  });

  it("passes non-paragraph blocks through the structural sanitizer", () => {
    const out = sanitizeAiDocBlocks([{ type: "heading", level: 9, text: "x" }]);
    // level 9 is not in the union — the structural sanitizer decides; assert
    // whatever sanitizeProjectDocuments does, having READ it first.
    expect(out.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/ai-document-blocks.test.ts --reporter=dot > /tmp/t14.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t14.log
```

- [ ] **Step 3: Write the module**

```ts
// src/app/ai-document-blocks.ts — the allow-list for MODEL-authored document
// blocks.
//
// ★★★ DOM-BOUND ON PURPOSE, which is why it is NOT in document-model.ts:
// that module is DOM-free by contract (a source scan enforces it) because the
// sample generator imports it under bare node. This one calls DOMPurify via
// sanitizeAiRichText and must never enter that import graph.
//
// ★★ TWO LAYERS, both load-bearing. sanitizeProjectDocuments enforces
// STRUCTURE and cannot sanitize (it is DOM-free, and descriptionHtml passes
// HTML-shaped input through verbatim). sanitizeAiRichText is the actual
// allow-list. Layer 1 alone let a model's <script> reach all six backends.
import { sanitizeAiRichText } from "./ai-rich-text";
import { sanitizeProjectDocuments, type DocBlock } from "./document-model";

/** Clean model-supplied blocks BEFORE they reach storage.
 *
 *  ★★ Apply to the model's INPUT, never to the merged document: re-running the
 *  allow-list over stored bytes rewrites what the call never asked to touch,
 *  and unwraps a tag an older path legitimately stored. */
export function sanitizeAiDocBlocks(raw: unknown): DocBlock[] {
  if (!Array.isArray(raw)) return [];
  const cleaned = raw.map((b) => {
    if (b && typeof b === "object" && (b as { type?: unknown }).type === "paragraph") {
      const html = (b as { html?: unknown }).html;
      // A model may send EITHER HTML or plain text — never assume plain just
      // because the schema says "text". sanitizeAiRichText is upgrade-aware.
      return { ...(b as object), html: sanitizeAiRichText(html) };
    }
    return b;
  });
  const [doc] = sanitizeProjectDocuments([
    { id: 1, title: "x", blocks: cleaned, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  ]);
  return doc ? [...doc.blocks] : [];
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/app/ai-document-blocks.test.ts --reporter=dot > /tmp/t14.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t14.log
npx tsc --noEmit; echo "EXIT=$?"
```

Confirm `sanitizeAiRichText`'s exact signature first with `grep -n "export function sanitizeAiRichText" src/app/ai-rich-text.ts` and adapt the call if it takes more than one argument.

- [ ] **Step 5: Mutation-test the allow-list**

Temporarily delete the `sanitizeAiRichText` call (return `b` unchanged) and re-run. Expected: the script-tag test FAILS. Revert.

- [ ] **Step 6: Commit**

```bash
git add src/app/ai-document-blocks.ts src/app/ai-document-blocks.test.ts
git commit -m "feat: allow-list model-authored document blocks"
```

---

### Task 15: Buy ratchet headroom in the dispatcher

`use-chat-dispatcher.ts` is at 796 of 800 and is about to gain roughly five lines. Move its args interface out first.

**Files:**
- Create: `src/app/chat-dispatcher-types.ts`
- Modify: `src/app/use-chat-dispatcher.ts:70-99`

- [ ] **Step 1: Record the current size**

```bash
wc -l src/app/use-chat-dispatcher.ts
```

Expected: 796.

- [ ] **Step 2: Move the interface**

Cut `export interface ChatDispatcherArgs { … }` (lines 70-99, **including all its doc comments**) into a new `src/app/chat-dispatcher-types.ts` with the imports it needs, then in `use-chat-dispatcher.ts`:

```ts
import type { ChatDispatcherArgs } from "./chat-dispatcher-types";
export type { ChatDispatcherArgs };
```

The re-export keeps every existing importer compiling unchanged.

- [ ] **Step 3: Verify the shrink and that nothing broke**

```bash
wc -l src/app/use-chat-dispatcher.ts
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
npx vitest run src/app/use-chat-dispatcher.test.tsx --reporter=dot > /tmp/t15.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t15.log
```

Expected: ~766 lines and EXIT=0 four times.

- [ ] **Step 4: Commit**

```bash
git add src/app/chat-dispatcher-types.ts src/app/use-chat-dispatcher.ts
git commit -m "refactor: extract ChatDispatcherArgs to keep the dispatcher under the size ratchet"
```

---

### Task 16: Tool schemas

**Files:**
- Create: `src/app/chat-tool-defs-documents.ts`
- Modify: `src/app/chat-tool-defs.ts:207`
- Test: `src/app/chat-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/chat-tools.test.ts`:

```ts
describe("document tool defs", () => {
  it("registers all five document tools", () => {
    const names = TOOL_DEFS.map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining([
      "list_documents", "get_document", "create_document", "update_document", "delete_document",
    ]));
  });

  it("gives update_document an ops array, not a bare blocks array", () => {
    const def = TOOL_DEFS.find((d) => d.name === "update_document")!;
    const props = def.input_schema.properties as Record<string, unknown>;
    expect(props.ops).toBeDefined();
    expect(props.blocks).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/chat-tools.test.ts --reporter=dot > /tmp/t16.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t16.log
```

- [ ] **Step 3: Write the defs**

```ts
// src/app/chat-tool-defs-documents.ts — Anthropic tool schemas for project
// documents. Pure data; routing lives in chat-tools-documents.ts and the impl
// in use-document-tools.ts.
//
// Split out of chat-tool-defs.ts because that file is at 593 of the 800-line
// ratchet and five more inline schemas would push it over.

/** One DocBlock, shared by create_document and every block-carrying op — one
 *  definition, so the five tools cannot describe different block shapes. */
const docBlockSchema = {
  type: "object" as const,
  description:
    "One document block. heading: {type,level:1-3,text}. paragraph: {type,html} — simple HTML (p, strong, em, ul/ol/li, a); anything else is unwrapped to its text. bullets: {type,items,ordered?}. table: {type,columns,rows,caption?}. dataSection: {type,key} embeds live project data. pageBreak: {type} starts a new page in Word/PDF and a new slide in PowerPoint.",
  properties: {
    type: {
      type: "string" as const,
      enum: ["heading", "paragraph", "bullets", "table", "dataSection", "pageBreak"],
    },
    level: { type: "number" as const, description: "heading only: 1, 2 or 3" },
    text: { type: "string" as const, description: "heading only" },
    html: { type: "string" as const, description: "paragraph only" },
    items: { type: "array" as const, items: { type: "string" as const }, description: "bullets only" },
    ordered: { type: "boolean" as const, description: "bullets only: numbered instead of bulleted" },
    columns: { type: "array" as const, items: { type: "string" as const }, description: "table only" },
    rows: {
      type: "array" as const,
      items: { type: "array" as const, items: { type: "string" as const } },
      description: "table only",
    },
    caption: { type: "string" as const, description: "table only" },
    key: { type: "string" as const, description: "dataSection only: an export section key" },
  },
  required: ["type"],
};

export const DOCUMENT_TOOL_DEFS = [
  {
    name: "list_documents",
    description:
      "List every project document with its id, title, block count and last-updated time. Read this before get_document when you do not know the id.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_document",
    description:
      "Read one document in full, including every block. You MUST call this before update_document so your op indices refer to the blocks that actually exist.",
    input_schema: {
      type: "object" as const,
      properties: { id: { type: "number" as const, description: "The document id" } },
      required: ["id"],
    },
  },
  {
    name: "create_document",
    description:
      "Create a project document. Supply the full block list you want; an empty document is created when blocks is omitted.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" as const },
        blocks: { type: "array" as const, items: docBlockSchema },
      },
      required: ["title"],
    },
  },
  {
    name: "update_document",
    description:
      "Edit a document with a list of block operations. Ops apply LEFT TO RIGHT against the evolving block list, so [{op:'delete',index:0},{op:'delete',index:0}] removes the first TWO blocks. Prefer targeted ops over replaceAll — replaceAll discards every block you do not resend. Call get_document first.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "number" as const },
        title: { type: "string" as const, description: "Optional new title; omit to leave it alone" },
        ops: {
          type: "array" as const,
          description: "The edits to apply, in order",
          items: {
            type: "object" as const,
            properties: {
              op: { type: "string" as const, enum: ["append", "insert", "replace", "delete", "replaceAll"] },
              index: { type: "number" as const, description: "0-based; required for insert, replace and delete" },
              block: docBlockSchema,
              blocks: {
                type: "array" as const,
                items: docBlockSchema,
                description: "replaceAll only: the COMPLETE new block list",
              },
            },
            required: ["op"],
          },
        },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_document",
    description:
      "Delete a project document. The document is recoverable from its version history in the Documents view, but tell the user you have deleted it.",
    input_schema: {
      type: "object" as const,
      properties: { id: { type: "number" as const } },
      required: ["id"],
    },
  },
];
```

- [ ] **Step 4: Spread into `TOOL_DEFS`**

In `src/app/chat-tool-defs.ts`, import at the top and add one line before the closing `];` at `:593`:

```ts
  ...DOCUMENT_TOOL_DEFS,
```

- [ ] **Step 5: Run and check the ratchet**

```bash
npx vitest run src/app/chat-tools.test.ts --reporter=dot > /tmp/t16.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/t16.log
npx tsc --noEmit; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
```

If `TOOL_DEFS`' element type is inferred and the spread breaks it, read how the existing array is typed and match — do not add an `as any`.

- [ ] **Step 6: Commit**

```bash
git add src/app/chat-tool-defs-documents.ts src/app/chat-tool-defs.ts src/app/chat-tools.test.ts
git commit -m "feat: add the five document tool schemas"
```

---

### Task 17: Tool routing and the four guards

**Files:**
- Create: `src/app/chat-tools-documents.ts`, `src/app/chat-tools-documents.test.ts`
- Modify: `src/app/chat-tools.ts:265` (dispatcher type), `:498` (routing)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/chat-tools-documents.test.ts
import { describe, it, expect, vi } from "vitest";
import { runDocumentTool, isDocumentTool, type DocumentToolDispatcher } from "./chat-tools-documents";

const doc = {
  id: 1, title: "Status", blocks: [{ type: "paragraph" as const, html: "<p>kept</p>" }],
  createdAt: "2026-08-01T08:00:00.000Z", updatedAt: "2026-08-01T08:00:00.000Z",
};

function makeDispatcher(over: Partial<DocumentToolDispatcher> = {}): DocumentToolDispatcher {
  return {
    listDocuments: () => [{ id: 1, title: "Status", blockCount: 1, updatedAt: doc.updatedAt }],
    getDocument: () => doc,
    createDocument: vi.fn(() => ({ id: 2, title: "New", blockCount: 0 })),
    updateDocument: vi.fn(() => ({ id: 1, blockCount: 1, applied: 1, rejected: [], removed: 0 })),
    deleteDocument: vi.fn(() => ({ deleted: true, restorableVersionId: 7 })),
    ...over,
  };
}

describe("isDocumentTool", () => {
  it("claims exactly the five names", () => {
    expect(["list_documents", "get_document", "create_document", "update_document", "delete_document"].every(isDocumentTool)).toBe(true);
    expect(isDocumentTool("list_tasks")).toBe(false);
  });
});

describe("boundary guards", () => {
  // ★★★ THE set_task_dependencies CLASS. A non-array must never be read as
  // "clear everything" — a stray string from a sloppy model would erase the
  // document, and chat writes have NO undo capture.
  it("throws on a non-array ops rather than treating it as a clear", async () => {
    const d = makeDispatcher();
    await expect(runDocumentTool(d, "update_document", { id: 1, ops: "delete everything" })).rejects.toThrow(/ops/i);
    expect(d.updateDocument).not.toHaveBeenCalled();
  });

  it("throws when the document does not exist", async () => {
    const d = makeDispatcher({ getDocument: () => null });
    await expect(runDocumentTool(d, "get_document", { id: 9 })).rejects.toThrow(/not found/i);
  });

  it("requires a numeric id", async () => {
    await expect(runDocumentTool(makeDispatcher(), "delete_document", {})).rejects.toThrow(/id must be a number/i);
  });

  // A PARTIAL application resolves and reports what it refused. (A write where
  // applied === 0 throws instead — see the next test.)
  it("surfaces rejected ops alongside a partial application", async () => {
    const d = makeDispatcher({
      updateDocument: vi.fn(() => ({ id: 1, blockCount: 2, applied: 1, rejected: ["op 1: delete index 9 out of range"], removed: 0 })),
    });
    const out = await runDocumentTool(d, "update_document", {
      id: 1, ops: [{ op: "append", block: { type: "pageBreak" } }, { op: "delete", index: 9 }],
    });
    expect(out).toMatchObject({ applied: 1, rejected: ["op 1: delete index 9 out of range"] });
  });

  it("throws when nothing could be applied, so a refusal never reads as success", async () => {
    const d = makeDispatcher({
      updateDocument: vi.fn(() => ({ id: 1, blockCount: 1, applied: 0, rejected: ["op 0: delete index 9 out of range"], removed: 0 })),
    });
    await expect(
      runDocumentTool(d, "update_document", { id: 1, ops: [{ op: "delete", index: 9 }] }),
    ).rejects.toThrow(/no operation could be applied/i);
  });

  it("reports what replaceAll removed", async () => {
    const d = makeDispatcher({
      updateDocument: vi.fn(() => ({ id: 1, blockCount: 1, applied: 1, rejected: [], removed: 4 })),
    });
    const out = await runDocumentTool(d, "update_document", {
      id: 1, ops: [{ op: "replaceAll", blocks: [{ type: "pageBreak" }] }],
    });
    expect(out).toMatchObject({ removed: 4 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/chat-tools-documents.test.ts --reporter=dot > /tmp/t17.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t17.log
```

- [ ] **Step 3: Write the routing module**

```ts
// src/app/chat-tools-documents.ts — routing + boundary validation for the five
// document tools. Split out of chat-tools.ts, which sits at 748 of the
// 800-line ratchet.
import type { DocOp } from "./document-mutations";
import type { ProjectDocument } from "./document-model";

export type DocumentSummary = {
  id: number;
  title: string;
  blockCount: number;
  updatedAt: string;
};

export type DocumentUpdateResult = {
  id: number;
  blockCount: number;
  applied: number;
  /** Human-readable reasons, one per refused op. */
  rejected: readonly string[];
  /** Blocks the write dropped — non-zero only for replaceAll. */
  removed: number;
};

export type DocumentToolDispatcher = {
  listDocuments(): DocumentSummary[];
  getDocument(id: number): ProjectDocument | null;
  createDocument(title: string, blocks: unknown): { id: number; title: string; blockCount: number };
  updateDocument(id: number, ops: readonly DocOp[], title: string | undefined): DocumentUpdateResult | null;
  deleteDocument(id: number): { deleted: boolean; restorableVersionId: number | null };
};

const DOCUMENT_TOOLS = new Set([
  "list_documents",
  "get_document",
  "create_document",
  "update_document",
  "delete_document",
]);

export function isDocumentTool(name: string): boolean {
  return DOCUMENT_TOOLS.has(name);
}

function requireDocId(input: Record<string, unknown>): number {
  const id = Number(input.id);
  if (!Number.isFinite(id)) throw new Error("id must be a number");
  return id;
}

/**
 * ★★★ VALIDATE ops ARRAY-NESS HERE, at the TOOL boundary — never in the pure
 * mutation module. A non-array is byte-identical to a legitimate "no ops" once
 * it reaches applyDocMutation, and malformed model output (a stray string, an
 * omitted field) must never be able to touch a stored document.
 */
function requireOps(input: Record<string, unknown>): readonly DocOp[] {
  if (input.ops === undefined) return [];
  if (!Array.isArray(input.ops)) {
    throw new Error("ops must be an array of block operations");
  }
  return input.ops as readonly DocOp[];
}

export async function runDocumentTool(
  d: DocumentToolDispatcher,
  name: string,
  rawInput: unknown,
): Promise<unknown> {
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;

  switch (name) {
    case "list_documents":
      return d.listDocuments();

    case "get_document": {
      const id = requireDocId(input);
      const doc = d.getDocument(id);
      if (!doc) throw new Error(`document #${id} not found`);
      return doc;
    }

    case "create_document": {
      const title = typeof input.title === "string" ? input.title.trim() : "";
      if (!title) throw new Error("title is required");
      return d.createDocument(title, input.blocks);
    }

    case "update_document": {
      const id = requireDocId(input);
      const ops = requireOps(input);
      const title = typeof input.title === "string" ? input.title : undefined;
      if (ops.length === 0 && title === undefined) {
        throw new Error("supply ops, a title, or both");
      }
      const result = d.updateDocument(id, ops, title);
      if (!result) throw new Error(`document #${id} not found`);
      // ★★ A wholly-refused write reports the refusal and leaves storage
      // untouched — the dispatcher already declined to write. Throwing here
      // makes that visible to the model instead of reading as success.
      if (result.applied === 0 && title === undefined) {
        throw new Error(`no operation could be applied: ${result.rejected.join("; ")}`);
      }
      return result;
    }

    case "delete_document": {
      const id = requireDocId(input);
      const out = d.deleteDocument(id);
      if (!out.deleted) throw new Error(`document #${id} not found`);
      return out;
    }

    default:
      throw new Error(`unknown document tool: ${name}`);
  }
}
```

- [ ] **Step 4: Wire it into `chat-tools.ts`**

At `:265`, intersect the dispatcher type:

```ts
export type ToolDispatcher = {
  /* …unchanged… */
} & DocumentToolDispatcher;
```

and inside `runTool`'s switch, immediately before the `default` case:

```ts
    default:
      if (isDocumentTool(name)) return runDocumentTool(d, name, input);
      /* …the file's existing default behaviour… */
```

Read the existing `default` arm first and preserve whatever it does today.

- [ ] **Step 5: Run and check the ratchet**

```bash
npx vitest run src/app/chat-tools-documents.test.ts src/app/chat-tools.test.ts --reporter=dot > /tmp/t17.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t17.log
npx tsc --noEmit; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
```

- [ ] **Step 6: Commit**

```bash
git add src/app/chat-tools-documents.ts src/app/chat-tools-documents.test.ts src/app/chat-tools.ts
git commit -m "feat: route the document tools with array-ness and refusal guards"
```

---

### Task 18: `use-document-tools.ts` — the implementation

**Files:**
- Create: `src/app/use-document-tools.ts`
- Modify: `src/app/use-chat-dispatcher.ts` (spread), `vitest.config.ts` (`coverage.exclude`)
- Test: `src/app/use-chat-dispatcher.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/use-chat-dispatcher.test.tsx`, following the file's existing render-hook harness:

```tsx
it("creates a document through the tool and stores it", async () => {
  const { result } = renderDispatcher(); // the file's existing helper
  await act(async () => {
    await runTool(result.current, "create_document", {
      title: "Charter",
      blocks: [{ type: "heading", level: 1, text: "Charter" }],
    });
  });
  expect(result.current.listDocuments()).toHaveLength(1);
});

// ★★ TEST AT THE WRITE, NOT AT THE TOOL CALL. Spying on runTool is one hop
// short of this defect — S1's review found exactly this gap, and only on a
// cold read.
it("strips a script tag the model put in a paragraph before storing it", async () => {
  const { result } = renderDispatcher();
  await act(async () => {
    await runTool(result.current, "create_document", {
      title: "Charter",
      blocks: [{ type: "paragraph", html: "<p>ok</p><script>alert(1)</script>" }],
    });
  });
  const stored = result.current.getDocument(result.current.listDocuments()[0].id)!;
  expect(JSON.stringify(stored.blocks)).not.toContain("script");
});

it("refuses every write in a popout", async () => {
  const { result } = renderDispatcher({ isReadOnly: true });
  await expect(runTool(result.current, "delete_document", { id: 1 })).rejects.toThrow();
});

// Seeded with REAL prior blocks — the assertion cannot pass by accident.
it("leaves stored blocks untouched when every op is out of range", async () => {
  const { result } = renderDispatcher();
  await act(async () => {
    await runTool(result.current, "create_document", {
      title: "Doc", blocks: [{ type: "paragraph", html: "<p>keep me</p>" }],
    });
  });
  const id = result.current.listDocuments()[0].id;
  await expect(
    runTool(result.current, "update_document", { id, ops: [{ op: "delete", index: 42 }] }),
  ).rejects.toThrow();
  expect(JSON.stringify(result.current.getDocument(id)!.blocks)).toContain("keep me");
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/use-chat-dispatcher.test.tsx --reporter=dot > /tmp/t18.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t18.log
```

- [ ] **Step 3: Write the hook**

```ts
// src/app/use-document-tools.ts — implementation of the five document tools.
// Dispatcher GLUE: it holds no logic of its own, so it is coverage-excluded,
// the same class as use-chat-dispatcher.ts itself. Every decision lives in
// document-mutations.ts / ai-document-blocks.ts, which ARE gated.
import { useMemo, useRef, useEffect } from "react";
import { sanitizeAiDocBlocks } from "./ai-document-blocks";
import type { DocOp } from "./document-mutations";
import type { DocumentToolDispatcher } from "./chat-tools-documents";
import { useWorkspace } from "./workspace-context";

export function useDocumentTools(isReadOnly: boolean): DocumentToolDispatcher {
  const { documents, documentVersions, mutateDocuments } = useWorkspace();

  // Refs, so the dispatcher identity stays stable and back-to-back tool calls
  // read each other's writes — the pattern use-chat-dispatcher already uses.
  const documentsRef = useRef(documents);
  const versionsRef = useRef(documentVersions);
  useEffect(() => { documentsRef.current = documents; }, [documents]);
  useEffect(() => { versionsRef.current = documentVersions; }, [documentVersions]);

  const readOnlyError = () => new Error("This window is read-only; open the main window to make changes.");

  return useMemo<DocumentToolDispatcher>(
    () => ({
      listDocuments: () =>
        documentsRef.current.map((d) => ({
          id: d.id,
          title: d.title,
          blockCount: d.blocks.length,
          updatedAt: d.updatedAt,
        })),

      getDocument: (id) => documentsRef.current.find((d) => d.id === id) ?? null,

      createDocument: (title, blocks) => {
        if (isReadOnly) throw readOnlyError();
        // ★★ The model may send EITHER HTML or plain text. sanitizeAiDocBlocks
        // is the allow-list; the DOM-free structural sanitizer downstream
        // cannot strip markup.
        const result = mutateDocuments({ kind: "create", title, blocks: sanitizeAiDocBlocks(blocks) }, "ai");
        const doc = result.documents.find((d) => d.id === result.documentId)!;
        documentsRef.current = result.documents;
        versionsRef.current = result.versions;
        return { id: doc.id, title: doc.title, blockCount: doc.blocks.length };
      },

      updateDocument: (id, ops, title) => {
        if (isReadOnly) throw readOnlyError();
        const before = documentsRef.current.find((d) => d.id === id);
        if (!before) return null;
        // Sanitize the blocks the model supplied, op by op. Applied to the
        // model's INPUT only — never to the merged document.
        const cleanOps: DocOp[] = ops.map((op) => {
          if (op.op === "replaceAll") return { ...op, blocks: sanitizeAiDocBlocks(op.blocks) };
          if ("block" in op && op.block) {
            const [block] = sanitizeAiDocBlocks([op.block]);
            return block ? { ...op, block } : op;
          }
          return op;
        });
        const result = mutateDocuments({ kind: "ops", id, ops: cleanOps, title }, "ai");
        documentsRef.current = result.documents;
        versionsRef.current = result.versions;
        const after = result.documents.find((d) => d.id === id);
        const usedReplaceAll = ops.some((o) => o.op === "replaceAll");
        return {
          id,
          blockCount: after?.blocks.length ?? before.blocks.length,
          applied: result.changed ? ops.length - result.rejected.length : 0,
          rejected: result.rejected,
          removed: usedReplaceAll ? Math.max(0, before.blocks.length - (after?.blocks.length ?? 0)) : 0,
        };
      },

      deleteDocument: (id) => {
        if (isReadOnly) throw readOnlyError();
        const result = mutateDocuments({ kind: "delete", id }, "ai");
        documentsRef.current = result.documents;
        versionsRef.current = result.versions;
        const newest = result.versions[result.versions.length - 1];
        return {
          deleted: result.changed,
          restorableVersionId: result.changed && newest ? newest.id : null,
        };
      },
    }),
    [isReadOnly, mutateDocuments],
  );
}
```

- [ ] **Step 4: Spread it into the dispatcher**

In `src/app/use-chat-dispatcher.ts`:

```ts
import { useDocumentTools } from "./use-document-tools";
// …inside useChatDispatcher, before the useMemo:
  const documentTools = useDocumentTools(args.isReadOnly);
// …inside the returned object:
      ...documentTools,
// …and add documentTools to the useMemo dependency array.
```

- [ ] **Step 5: Coverage-exclude the glue**

Add `"src/app/use-document-tools.ts"` to `coverage.exclude` in `vitest.config.ts`, beside the existing dispatcher-glue entries.

- [ ] **Step 6: Run everything**

```bash
npx vitest run src/app/use-chat-dispatcher.test.tsx src/app/chat-tools-documents.test.ts --reporter=dot > /tmp/t18.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t18.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
```

Expected: EXIT=0 four times, and `use-chat-dispatcher.ts` still under 800.

- [ ] **Step 7: Commit**

```bash
git add src/app/use-document-tools.ts src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.test.tsx vitest.config.ts
git commit -m "feat: implement the five document tools"
```

---

### Task 19: Activity kind, AI scope, prompt chips, i18n

**Files:**
- Modify: `src/app/activity-log.ts:12,168`, `src/app/dashboard-activity-nav.ts`, `src/app/dashboard-delta.ts:58`
- Modify: `src/app/view-ai-scope.ts:170-178`, `src/app/ask-claude-prompts.ts:54`, `src/app/ask-claude-prompts.test.ts:45`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Write the failing test**

```ts
// in src/app/ask-claude-prompts.test.ts — extend the pinned list at :45
      "dashboard", "directory", "documents", "gantt", "insights", "knowledge", "manage-roles",
```

and in `src/app/view-ai-scope.test.ts` (create the case if the file exists, else put it in `ask-claude-prompts.test.ts`):

```ts
it("no longer tells the model it cannot touch documents", () => {
  expect(VIEW_AI_SCOPE.documents.reading ?? "").not.toMatch(/no tool/i);
  expect(VIEW_AI_SCOPE.documents.toolHints ?? []).toContain("list_documents");
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/ask-claude-prompts.test.ts --reporter=dot > /tmp/t19.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t19.log
```

- [ ] **Step 3: Update the AI scope at `view-ai-scope.ts:170`**

```ts
  documents: {
    purpose:
      "Documents holds project documents the user or the assistant authored — status reports, decks and charters — stored as structured blocks and downloadable as HTML, Word, PowerPoint or PDF.",
    toolHints: ["list_documents", "get_document", "create_document", "update_document"],
    reading:
      "Read a document with get_document before editing it: update_document ops address blocks by index. Every write is snapshotted, so the user can revert from the Documents view.",
  },
```

Delete the old `reading` line and the `// ★ No toolHints` comment above it — both are now false.

- [ ] **Step 4: Add the chips at `ask-claude-prompts.ts:54`**

```ts
  documents: [
    { labelKey: "aiPromptDraftStatusDocLabel", bodyKey: "aiPromptDraftStatusDocBody" },
    { labelKey: "aiPromptSteeringDeckLabel", bodyKey: "aiPromptSteeringDeckBody" },
  ],
```

Match the `PromptDef` shape the file already uses — read one neighbouring entry first (it may also carry an `autoSend` flag).

- [ ] **Step 5: Add the activity kind**

`activity-log.ts` — a member on the union at `:12` and an entry in `ACTIVITY_KIND_TO_KEY` at `:168`:

```ts
  | "ai.documentWrite"
// and
  "ai.documentWrite": "activityAiDocumentWrite",
```

`dashboard-activity-nav.ts` — map it to the view:

```ts
    case "ai.documentWrite": return "documents";
```

`dashboard-delta.ts:58` `classify` — **explicitly** return `null`; a document write is not a delta-strip verb. Add a one-line comment saying so, or the next reader will "fix" the omission.

- [ ] **Step 6: Add the strings**

EN in `src/app/i18n.ts` (CRLF file — anchor on `\r\n`):

```
activityAiDocumentWrite: "Assistant edited a document",
aiPromptDraftStatusDocLabel: "Draft a status report",
aiPromptDraftStatusDocBody: "Create a project document with this week's status: progress, risks and next steps.",
aiPromptSteeringDeckLabel: "Draft a steering deck",
aiPromptSteeringDeckBody: "Create a steering-committee deck covering scope, schedule, budget and the top risks.",
documentsHistory: "History",
documentsHistoryFor: "History – {0}",
documentsRestore: "Restore",
documentsRestored: "Restored “{0}”",
documentsShowDeleted: "Deleted documents",
documentsNoVersions: "No history yet",
documentsVersionSourceAi: "Assistant",
documentsVersionSourceUser: "You",
```

★ `documentsRestored` uses a real curly quote in the source, not an escape — the `i18n-encoding` test bans `\u00XX` escapes. Write the literal characters.

DE in `src/app/i18n.de.ts` — **write this with a node utf8 script, not the Edit tool**, which corrupts umlauts and curls double quotes:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  versionHistory: \"Versionsverlauf\",\r\n";
if (!s.includes(anchor)) { console.error("ANCHOR NOT FOUND — check CRLF"); process.exit(1); }
s = s.replace(anchor, anchor +
"  activityAiDocumentWrite: \"Assistent hat ein Dokument bearbeitet\",\r\n" +
"  aiPromptDraftStatusDocLabel: \"Statusbericht entwerfen\",\r\n" +
"  aiPromptDraftStatusDocBody: \"Erstelle ein Projektdokument mit dem Status dieser Woche: Fortschritt, Risiken und nächste Schritte.\",\r\n" +
"  aiPromptSteeringDeckLabel: \"Steering-Deck entwerfen\",\r\n" +
"  aiPromptSteeringDeckBody: \"Erstelle eine Steering-Committee-Präsentation zu Umfang, Terminplan, Budget und den größten Risiken.\",\r\n" +
"  documentsHistory: \"Verlauf\",\r\n" +
"  documentsHistoryFor: \"Verlauf – {0}\",\r\n" +
"  documentsRestore: \"Wiederherstellen\",\r\n" +
"  documentsRestored: \"„{0}“ wiederhergestellt\",\r\n" +
"  documentsShowDeleted: \"Gelöschte Dokumente\",\r\n" +
"  documentsNoVersions: \"Noch kein Verlauf\",\r\n" +
"  documentsVersionSourceAi: \"Assistent\",\r\n" +
"  documentsVersionSourceUser: \"Sie\",\r\n");
fs.writeFileSync(p, s, "utf8");
console.log("written");
'
```

Then verify the bytes survived:

```bash
node -e 'const s=require("fs").readFileSync("src/app/i18n.de.ts","utf8"); for (const w of ["nächste","Präsentation","größten","Gelöschte"]) console.log(w, s.includes(w));'
```

Expected: four `true`.

- [ ] **Step 7: Run the i18n and chip gates**

```bash
npx vitest run src/app/ask-claude-prompts.test.ts src/app/i18n-encoding.test.ts src/app/activity-log.test.ts --reporter=dot > /tmp/t19.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t19.log
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 8: Commit**

```bash
git add src/app/activity-log.ts src/app/dashboard-activity-nav.ts src/app/dashboard-delta.ts src/app/view-ai-scope.ts src/app/ask-claude-prompts.ts src/app/ask-claude-prompts.test.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: register document tools with the AI scope, chips and activity log"
```

---

### Task 20: History modal

**Files:**
- Create: `src/app/documents-history-modal.tsx`, `src/app/documents-history-modal.test.tsx`
- Modify: `src/app/documents-list.tsx` (per-row History button), `src/app/documents-panel.tsx` (state + mount)

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/documents-history-modal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentsHistoryModal } from "./documents-history-modal";

const VERSIONS = [
  { id: 2, documentId: 1, title: "Second", blocks: [], savedAt: "2026-08-05T10:00:00.000Z", source: "ai" as const, op: "update" as const },
  { id: 1, documentId: 1, title: "First", blocks: [], savedAt: "2026-08-04T10:00:00.000Z", source: "user" as const, op: "rename" as const },
];

const doc = { id: 1, title: "Status", blocks: [], createdAt: "2026-08-01T08:00:00.000Z", updatedAt: "2026-08-05T10:00:00.000Z" };

it("names the dialog after the document", () => {
  render(<DocumentsHistoryModal open document={doc} versions={VERSIONS} onClose={vi.fn()} onRestore={vi.fn()} lang="en-US" />);
  expect(screen.getByRole("dialog", { name: /History – Status/ })).toBeInTheDocument();
});

it("lists versions newest first with their source", () => {
  render(<DocumentsHistoryModal open document={doc} versions={VERSIONS} onClose={vi.fn()} onRestore={vi.fn()} lang="en-US" />);
  const rows = screen.getAllByRole("listitem");
  expect(rows[0]).toHaveTextContent("Second");
  expect(rows[0]).toHaveTextContent("Assistant");
  expect(rows[1]).toHaveTextContent("You");
});

it("gives each Restore button a version-unique accessible name", () => {
  render(<DocumentsHistoryModal open document={doc} versions={VERSIONS} onClose={vi.fn()} onRestore={vi.fn()} lang="en-US" />);
  const names = screen.getAllByRole("button", { name: /Restore/ }).map((b) => b.getAttribute("aria-label"));
  expect(new Set(names).size).toBe(names.length);
});

it("calls onRestore with the version id", async () => {
  const onRestore = vi.fn();
  const user = userEvent.setup();
  render(<DocumentsHistoryModal open document={doc} versions={VERSIONS} onClose={vi.fn()} onRestore={onRestore} lang="en-US" />);
  await user.click(screen.getAllByRole("button", { name: /Restore/ })[0]);
  expect(onRestore).toHaveBeenCalledWith(2);
});

it("shows an empty state when there is no history", () => {
  render(<DocumentsHistoryModal open document={doc} versions={[]} onClose={vi.fn()} onRestore={vi.fn()} lang="en-US" />);
  expect(screen.getByText(/No history yet/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/documents-history-modal.test.tsx --reporter=dot > /tmp/t20.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t20.log
```

- [ ] **Step 3: Write the component**

```tsx
// src/app/documents-history-modal.tsx — per-document version list.
//
// ★ Every Restore button carries a VERSION-UNIQUE accessible name. N identical
// "Restore" labels is a WCAG 2.4.6 failure that the axe gate cannot catch here
// at all — the modal is closed at scan time.
import { Modal } from "./modal";
import { Button } from "./button";
import { renderDocumentHtml } from "./doc-render-html";
import { t, type Lang } from "./i18n";
import type { ProjectDocument } from "./document-model";
import type { DocVersion } from "./document-versions";

export interface DocumentsHistoryModalProps {
  open: boolean;
  document: ProjectDocument | null;
  versions: readonly DocVersion[];
  onClose: () => void;
  onRestore: (versionId: number) => void;
  lang: Lang;
}

export function DocumentsHistoryModal({
  open, document, versions, onClose, onRestore, lang,
}: DocumentsHistoryModalProps) {
  if (!document) return null;
  const title = t(lang, "documentsHistoryFor", document.title);

  return (
    <Modal open={open} onClose={onClose} ariaLabel={title} lang={lang}>
      <div className="w-full max-w-2xl rounded-lg bg-surface p-4">
        <h2 className="mb-3 text-base font-medium text-foreground">{title}</h2>
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(lang, "documentsNoVersions")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2">
                <span className="min-w-0 text-sm text-foreground">
                  <span className="font-medium">{v.title}</span>
                  {" · "}
                  {new Date(v.savedAt).toLocaleString(lang)}
                  {" · "}
                  {t(lang, v.source === "ai" ? "documentsVersionSourceAi" : "documentsVersionSourceUser")}
                </span>
                <Button
                  size="xs"
                  onClick={() => onRestore(v.id)}
                  aria-label={`${t(lang, "documentsRestore")} – ${v.title} (${v.savedAt})`}
                >
                  {t(lang, "documentsRestore")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
```

Check `Button`'s real import path and prop names (`grep -n "export function Button" src/app/*.tsx`) before using it, and confirm `Modal` takes `ariaLabel` — it does, and exactly one of `ariaLabel`/`ariaLabelledby` is required by its union type.

Note `renderDocumentHtml` is imported for the Preview affordance; if you do not ship Preview in this task, remove the import — an unused import is a fatal lint error.

- [ ] **Step 4: Mount it from the panel**

```tsx
  const [historyFor, setHistoryFor] = useState<number | null>(null);
  const historyDoc = documents.find((d) => d.id === historyFor) ?? null;
  const historyVersions = useMemo(
    () => documentVersions.filter((v) => v.documentId === historyFor)
      .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1)),
    [documentVersions, historyFor],
  );
  // …in the JSX:
  <DocumentsHistoryModal
    open={historyFor !== null}
    document={historyDoc}
    versions={historyVersions}
    onClose={() => setHistoryFor(null)}
    onRestore={(versionId) => {
      mutateDocuments({ kind: "restore", versionId }, "user");
      setHistoryFor(null);
    }}
    lang={lang}
  />
```

- [ ] **Step 5: Add the per-row History button in `documents-list.tsx`**

```tsx
  <IconButton
    onClick={() => onOpenHistory(doc.id)}
    aria-label={`${t(lang, "documentsHistory")} – ${doc.title}`}
    title={t(lang, "documentsHistory")}
  >
    {/* …the icon the file's other row actions use… */}
  </IconButton>
```

Row-**unique** name — N identical "History" labels is a WCAG 2.4.6 failure the gate passes when only one row is seeded.

- [ ] **Step 6: Run and commit**

```bash
npx vitest run src/app/documents-history-modal.test.tsx src/app/documents-panel.test.tsx --reporter=dot > /tmp/t20.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t20.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
git add src/app/documents-history-modal.tsx src/app/documents-history-modal.test.tsx src/app/documents-list.tsx src/app/documents-panel.tsx
git commit -m "feat: add the document version history modal"
```

---

### Task 21: Deleted-documents toggle and toolbar order

**Files:**
- Modify: `src/app/documents-toolbar.tsx`, `src/app/documents-list.tsx`, `src/app/documents-panel.tsx`
- Test: `src/app/documents-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { expectButtonOrder } from "../test/toolbar-order";

it("keeps the toolbar order: primary, then the contiguous trailing group", () => {
  renderPanel();
  expectButtonOrder(
    ["documentsNew", "documentsShowDeleted", "print", "resetColumnWidths", "resetPaneSize"],
    { contiguous: ["print", "resetColumnWidths", "resetPaneSize"] },
  );
});

it("lists deleted documents when the toggle is on", async () => {
  const user = userEvent.setup();
  renderPanel(); // seed one document, delete it
  // …create, then delete via the pane's own controls…
  await user.click(screen.getByRole("button", { name: /Deleted documents/i }));
  expect(screen.getByRole("button", { name: /Restore –/i })).toBeInTheDocument();
});

it("announces the toggle state on the label it enables", async () => {
  renderPanel();
  const toggle = screen.getByRole("button", { name: /Deleted documents/i });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
});
```

★ `expectButtonOrder` takes **`TranslationKey`s, not English strings** — read `src/test/toolbar-order.ts` and use the real key names. `buttonIndex` throws when a key matches zero or several buttons, which is the whole reason to use it instead of a hand-rolled walk.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/documents-panel.test.tsx --reporter=dot > /tmp/t21.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t21.log
```

- [ ] **Step 3: Add the toggle**

In `documents-toolbar.tsx`, before the trailing Print/reset group:

```tsx
      <ToggleButton
        pressed={showDeleted}
        onToggle={() => onShowDeletedChange(!showDeleted)}
        lang={lang}
        title={t(lang, "documentsShowDeleted")}
      >
        {t(lang, "documentsShowDeleted")}
      </ToggleButton>
```

★★ `ToggleButton`, never a hand-rolled `aria-pressed` button — the primitive carries the non-colour `data-pressed-marker` that keeps the pressed state distinguishable in the dark schemes, and its unit test is the only coverage for that (axe has no rule for it).

★ The label is pinned to what the toggle **enables**, so "Deleted documents, pressed" means deleted documents are shown. A label that flips to the opposite action announces the wrong mode (WCAG 4.1.2) and axe passes it.

- [ ] **Step 4: Render the tombstone rows**

In `documents-panel.tsx`:

```tsx
  const deleted = useMemo(
    () => deletedDocumentVersions(documentVersions, documents),
    [documentVersions, documents],
  );
```

and when `showDeleted` is on, render those rows with a Restore action whose accessible name is row-unique (`` `${t(lang,"documentsRestore")} – ${v.title}` ``), calling `mutateDocuments({ kind: "restore", versionId: v.id }, "user")`.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run src/app/documents-panel.test.tsx --reporter=dot > /tmp/t21.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t21.log
npx tsc --noEmit; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
git add src/app/documents-toolbar.tsx src/app/documents-list.tsx src/app/documents-panel.tsx src/app/documents-panel.test.tsx
git commit -m "feat: surface deleted documents and restore them from the pane"
```

---

### Task 22: Extract `ToolBlock`, add the chat document card

`chat-panel.tsx` is baselined at exactly **977** lines and cannot grow by one line, so the extraction comes first and is what makes room for the card.

**Files:**
- Create: `src/app/chat-tool-block.tsx`, `src/app/chat-tool-block.test.tsx`
- Modify: `src/app/chat-panel.tsx:718,936`

- [ ] **Step 1: Extract with no behaviour change**

Move `function ToolBlock({…})` from `chat-panel.tsx:936` (and any helper only it uses) into `src/app/chat-tool-block.tsx`, exporting it. In `chat-panel.tsx` replace the definition with an import.

- [ ] **Step 2: Prove the extraction changed nothing**

```bash
wc -l src/app/chat-panel.tsx
npx vitest run src/app/chat-panel.test.tsx --reporter=dot > /tmp/t22.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/t22.log
npm run size:check; echo "EXIT=$?"
```

Expected: chat-panel well under 977, all its tests still green.

- [ ] **Step 3: Commit the extraction on its own**

```bash
git add src/app/chat-tool-block.tsx src/app/chat-panel.tsx
git commit -m "refactor: extract ToolBlock from chat-panel"
```

- [ ] **Step 4: Write the failing card test**

```tsx
// src/app/chat-tool-block.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolBlock } from "./chat-tool-block";

const result = JSON.stringify({ id: 4, title: "Steering deck", blockCount: 12 });

it("renders a document card for a document tool result", () => {
  render(<ToolBlock name="create_document" input={{ title: "Steering deck" }} result={result} error={false} lang="en-US" />);
  expect(screen.getByText("Steering deck")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /download/i })).toBeInTheDocument();
});

it("falls back to the plain tool block for a non-document tool", () => {
  render(<ToolBlock name="list_tasks" input={{}} result="[]" error={false} lang="en-US" />);
  expect(screen.queryByRole("button", { name: /download/i })).toBeNull();
});

it("renders no card when the tool errored", () => {
  render(<ToolBlock name="create_document" input={{}} result="boom" error lang="en-US" />);
  expect(screen.queryByRole("button", { name: /download/i })).toBeNull();
});
```

- [ ] **Step 5: Run it and watch it fail**

```bash
npx vitest run src/app/chat-tool-block.test.tsx --reporter=dot > /tmp/t22.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t22.log
```

- [ ] **Step 6: Add the card**

Inside `chat-tool-block.tsx`, before the existing generic rendering:

```tsx
  // A document tool that succeeded and returned an id gets a file card instead
  // of a raw JSON blob.
  const card = !error && isDocumentTool(name) ? parseDocumentResult(result) : null;
  if (card) {
    return (
      <DocumentCard
        docId={card.id}
        title={card.title}
        blockCount={card.blockCount}
        lang={lang}
      />
    );
  }
```

with a small local `parseDocumentResult` that `JSON.parse`s inside a `try` and returns `null` on anything unexpected, and a `DocumentCard` that reads `useWorkspace()` for the live document (needed because `dataSection` blocks resolve against the workspace) and calls `downloadDocument(doc, format, ws, lang)` with a format picked from `DOC_FORMATS`.

★ `downloadDocument(doc, format, ws, lang)` is the verified signature (`document-download.ts:124`); `DOC_FORMATS` is exported from `documents-toolbar.tsx:29`.

- [ ] **Step 7: Run and commit**

```bash
npx vitest run src/app/chat-tool-block.test.tsx src/app/chat-panel.test.tsx --reporter=dot > /tmp/t22.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t22.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
git add src/app/chat-tool-block.tsx src/app/chat-tool-block.test.tsx
git commit -m "feat: show a document file card in chat"
```

---

### Task 23: Help prose and subsystem docs

**Files:**
- Modify: `src/app/help-content.ts` (find the real filename with `grep -rln "HELP_ENTRIES" src/app | head -2`)
- Modify: `docs/AGENTS/ai-assistant.md`, `AGENTS.md`

- [ ] **Step 1: Extend the Documents help entry**

The `help-content-gate` is per-**view**, and `documents` is already covered from S1 — nothing goes red if you skip this, which is exactly why it must be done deliberately. Add prose covering: the assistant can create and edit documents; every change is snapshotted; History restores a version; deleted documents are restorable from the toolbar toggle.

- [ ] **Step 2: Update `docs/AGENTS/ai-assistant.md`**

Add the five tools to the AI-write-tools bullet, naming `chat-tool-defs-documents.ts`, `chat-tools-documents.ts`, `use-document-tools.ts`, and stating the two guards (array-ness at the boundary, refusal preserves storage). Note that document blocks go through `sanitizeAiDocBlocks`, **not** `AI_RICH_FIELDS`, and why.

- [ ] **Step 3: Update the Documents bullet in `AGENTS.md`**

Add: `documentVersions` is a second Pattern-B meta blob; `applyDocMutation` is the single mutation path; the tombstone derivation and the retention exception that protects it; and that document ids now mint through `mintId("document", …)`.

- [ ] **Step 4: Run the docs gate**

```bash
npm run docs:symbols:check; echo "EXIT=$?"
```

★ It only proves a backticked **name** exists somewhere in `src`/`scripts`/`e2e` — never that a claim is true — **and it skips every SCREAMING_CASE name entirely**, so `MAX_VERSIONS_PER_DOC` and `DOCUMENT_TOOL_DEFS` are completely ungated. Re-read what you wrote.

- [ ] **Step 5: Commit**

```bash
git add -A src/app docs AGENTS.md
git commit -m "docs: document the S2 document tools and version history"
```

---

### Task 24: Full gate run

- [ ] **Step 1: Run every gate serially, never in parallel**

Two vitest processes on one machine is the saturation condition behind the load-sensitive flakes.

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:scripts:check; echo "EXIT=$?"
npm run test:run > /tmp/final-unit.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Errors" /tmp/final-unit.log
npm run test:coverage > /tmp/final-cov.log 2>&1; echo "EXIT=$?"; grep -E "ERROR|threshold" /tmp/final-cov.log
npm run test:shuffle > /tmp/final-shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/final-shuffle.log
```

★★ Grep the unit log for `Errors  N error` as well as failures — CI's `unit-tests` can exit 1 with **every test passing** (a setState after jsdom teardown).

- [ ] **Step 2: Run the a11y gate on a fresh isolated server**

```bash
PORT=3100 npm run dev &
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Documents" --workers=4; echo "EXIT=$?"
PORT=3100 npm run stop
```

Never the reused `:3000` server — its stale Tailwind produces phantom transparent-fill failures that a fresh port passes.

- [ ] **Step 3: Hand-check what no gate can see**

- The history modal is **closed** at axe-scan time — check its labels and contrast by eye.
- With two or more documents seeded, confirm the History and Restore buttons have distinct accessible names (the gate passes N identical labels when only one row is seeded).
- Toggle Deleted documents on and off and confirm the pressed marker is visible in a dark scheme.

- [ ] **Step 4: Verify the AI path end to end in the running app**

Ask the assistant to draft a status report, then to change one section, then check that History shows two entries and Restore returns the earlier text. **No unit test covers the model actually calling these tools** — the same category as S1's DOCX/PPTX open-in-Office check that 9586 green tests could not support.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: S2 gate run"
```

---

## Self-review against the spec

| Spec section | Task |
|---|---|
| §1 `DocVersion`, caps, sanitizer | 2 |
| §1 retention + tombstone exception | 2 |
| §1 id-reuse correction | 1 |
| §2 six write paths | 3 (JSON) · 4 (IDB) · 5 (Turso ×2) · 6 (CSV) · 7 (MD) |
| §2 sample data + goldens | 8 |
| §3 `applyDocMutation` | 9, 10 |
| §3 `mutateDocuments` + StrictMode reasoning | 11 |
| §3 pane on the shared path | 13 |
| §4 five tools, modules, size budget | 15, 16, 17, 18 |
| §4 four guards | 9 (refusal), 17 (array-ness, id, replaceAll reporting), 18 (isReadOnly) |
| §4 `sanitizeAiDocBlocks` | 14 |
| §5 history modal | 20 |
| §5 deleted toggle + toolbar order | 21 |
| §5 chat file card + `ToolBlock` extraction | 22 |
| §5 registrations | 19, 23 |
| §6 gates | 24 (and inline in every task) |

Load/save wiring (Task 12) is not a numbered spec section but is required for §2 to reach the UI — without it the state slice is filled by nothing.
