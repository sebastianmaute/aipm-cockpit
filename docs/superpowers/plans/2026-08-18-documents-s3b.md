# Documents S3b — Block Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a human edit the content of a document's blocks by hand, through the existing versioned `applyDocMutation` write path.

**Architecture:** An explicit edit mode replaces the read-only `DocumentPreview` with a block-list React view. All decision logic (dirty check, image predicate, version coalescing) lives in one pure DOM-free module; the React layer is presentational. Commit happens on blur, per block, only when content changed.

**Tech Stack:** TypeScript, React 19, Tiptap (via the existing shared `RichTextEditor`), vitest + @testing-library/react, fast-check for the property test.

**Spec:** `docs/superpowers/specs/2026-08-18-documents-s3b-design.md`

**Branch:** `feat/documents-s3b`, already created off `main` at 0.246.0 "Bodard" with the spec commit.

---

## Before you start — read this

You are working in a repo with CI gates that fail on things most repos ignore. The ones that will bite this slice:

- **`npm run lint` does NOT reproduce CI.** It is bare `eslint` with no `--max-warnings` flag, so it exits 0 with warnings present. Use `npx eslint --max-warnings=0 src/app`. An unused import or variable is **fatal**.
- **Never read a gate's exit code through a pipe.** `npm run test:run | tail` gives you `tail`'s status. Redirect to a file, echo `$?` unpiped, then read the file.
- **`npx tsc --noEmit` after editing ANY test.** `next build` does not typecheck test files and vitest never typechecks.
- **The file-size gate counts `wc -l` plus one.** `documents-panel.tsx` is at 796 of 800 — it has **four** lines of headroom. Read the real number with:
  `node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"`
- **`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts in it.** Patch it with a node UTF-8 write whose anchor matches `\r\n`. Task 4 shows the exact script.
- **New `.ts` files are coverage-gated.** `document-editor-commit.ts` must carry real tests (it does here). Pure-glue `.tsx`/hook files are excluded — see Task 10.

**Do not run two vitest processes at once**, and do not run the full suite: it does not finish inside the available window on this machine. Run the targeted files each task names.

---

## File Structure

| File | Responsibility | New? |
|---|---|---|
| `src/app/document-editor-commit.ts` | **Pure, DOM-free, i18n-free.** Coalescing decision, image predicate, dirty check, block→`DocOp` | create |
| `src/app/document-editor-commit.test.ts` | unit tests for the above | create |
| `src/app/document-editor-commit.property.test.ts` | version-budget property test | create |
| `src/app/document-block-editors.tsx` | the five per-kind editors, presentational | create |
| `src/app/document-block-editors.test.tsx` | per-kind tests, each rendering ≥2 same-kind blocks | create |
| `src/app/document-editor.tsx` | edit-mode orchestrator: block list, selection, gutter, narrow-pane toolbar docking | create |
| `src/app/document-editor.test.tsx` | orchestrator tests | create |
| `src/app/use-document-editor.ts` | selection + commit wiring | create |
| `src/app/document-mutations.ts` | add `coalesce?` to the `ops` mutation | modify |
| `src/app/document-mutations.test.ts` | coalescing tests | modify |
| `src/app/i18n.ts` / `src/app/i18n.de.ts` | new keys, EN + DE | modify |
| `src/app/documents-panel.tsx` | mode toggle + mount **only** (four lines of headroom) | modify |
| `src/app/documents-panel.test.tsx` | mode toggle test | modify |
| `vitest.config.ts` | `coverage.exclude` entry for `use-document-editor.ts` | modify |

---

## Task 1: `coalesce` on the ops mutation

The `ops` branch of `applyDocMutation` always writes a before-image. Editing twenty blocks would evict a document's entire history against `MAX_VERSIONS_PER_DOC` (20). This adds an opt-in flag that suppresses **only** the before-image.

`withVersions` already accepts `added: DocVersion | undefined`, so this is a one-expression change and retention still re-runs.

**Files:**
- Modify: `src/app/document-mutations.ts` (the `DocMutation` union and the `case "ops"` branch)
- Test: `src/app/document-mutations.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/app/document-mutations.test.ts`. Find the existing `describe` covering `ops` and add these inside it. The helpers `doc(...)`, `ctx(...)` and the fixture style already exist in that file — match whatever it uses; the assertions below are what matters.

```ts
  it("coalesce: true suppresses the before-image but still applies the edit", () => {
    const before: ProjectDocument = {
      id: 1, title: "D", blocks: [{ type: "paragraph", html: "<p>old</p>" }],
      createdAt: "2026-08-18T10:00:00.000Z", updatedAt: "2026-08-18T10:00:00.000Z",
    };
    const state = { documents: [before], versions: [] as readonly DocVersion[] };
    const result = applyDocMutation(
      state,
      { kind: "ops", id: 1, ops: [{ op: "replace", index: 0, block: { type: "paragraph", html: "<p>new</p>" } }], coalesce: true },
      testCtx("2026-08-18T10:00:05.000Z", "user"),
    );

    expect(result.changed).toBe(true);
    expect(result.documents[0].blocks[0]).toEqual({ type: "paragraph", html: "<p>new</p>" });
    // The edit landed; no history entry was created for it.
    expect(result.versions).toHaveLength(0);
  });

  it("coalesce absent writes the before-image, byte-identical to today", () => {
    const before: ProjectDocument = {
      id: 1, title: "D", blocks: [{ type: "paragraph", html: "<p>old</p>" }],
      createdAt: "2026-08-18T10:00:00.000Z", updatedAt: "2026-08-18T10:00:00.000Z",
    };
    const state = { documents: [before], versions: [] as readonly DocVersion[] };
    const result = applyDocMutation(
      state,
      { kind: "ops", id: 1, ops: [{ op: "replace", index: 0, block: { type: "paragraph", html: "<p>new</p>" } }] },
      testCtx("2026-08-18T10:00:05.000Z", "user"),
    );

    expect(result.versions).toHaveLength(1);
    expect(result.versions[0].op).toBe("update");
    // The before-image holds the PRE-edit blocks, not the post-edit ones.
    expect(result.versions[0].blocks[0]).toEqual({ type: "paragraph", html: "<p>old</p>" });
  });

  it("the AI tool path cannot set coalesce — it builds the mutation field by field", () => {
    // use-document-tools.ts constructs `{ kind: "ops", id, ops: cleanOps, title }`
    // with explicit fields and no spread of model-supplied args, so a model
    // cannot suppress version history. This pins that shape: if someone
    // refactors it to spread raw args, this goes red.
    const src = readFileSync(new URL("./use-document-tools.ts", import.meta.url), "utf8");
    const opsCall = src.slice(src.indexOf('kind: "ops"'));
    expect(opsCall.slice(0, 80)).not.toMatch(/\.\.\./);
  });
```

Add `import { readFileSync } from "node:fs";` at the top of the test file if it is not already there, and make sure `ProjectDocument` / `DocVersion` are imported. `testCtx` is whatever the file already uses to build a `DocContext` — reuse it rather than writing a second one; if it is named differently, use that name.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/document-mutations.test.ts --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Tests |FAIL" /tmp/t1.log
```

Expected: FAIL. The first test fails on `coalesce` not existing as a property (a TS error at test time, or `versions` having length 1). The third test should PASS already — it is a characterization of existing safe code.

- [ ] **Step 3: Add the field to the union**

In `src/app/document-mutations.ts`, change the `ops` member of `DocMutation`:

```ts
  | { kind: "ops"; id: number; ops: readonly DocOp[]; title?: string; coalesce?: boolean }
```

- [ ] **Step 4: Suppress the before-image in the ops branch**

In `case "ops":`, replace the single line

```ts
      const before = snapshot(target, "update", ctx);
```

with

```ts
      // ★★ `coalesce` SUPPRESSES THE BEFORE-IMAGE AND NOTHING ELSE. The edit
      //  still lands and retention still re-runs — `withVersions` already takes
      //  an optional `added`, so passing `undefined` is the whole mechanism.
      //  Set by the hand editor when the newest version for this document is
      //  already a `user`/`update` inside the coalescing window, so that a
      //  20-block editing session cannot evict the document's own history
      //  against MAX_VERSIONS_PER_DOC. See document-editor-commit.ts.
      // ★ The AI path never sets it: use-document-tools.ts builds this mutation
      //  field by field, so a model cannot suppress its own audit trail.
      const before = m.coalesce ? undefined : snapshot(target, "update", ctx);
```

No other line in the branch changes: `withVersions(nextDocuments, state.versions, before)` already accepts `undefined`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/app/document-mutations.test.ts --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t1.log
```

Expected: EXIT=0, all tests pass.

- [ ] **Step 6: Verify the AI path is untouched**

```bash
npx vitest run src/app/use-document-tools.test.ts src/app/chat-tools-documents.test.ts --reporter=dot > /tmp/t1b.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t1b.log
```

Expected: EXIT=0. If either file does not exist, skip it — run whichever does.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/document-mutations.ts src/app/document-mutations.test.ts
git commit -m "feat(documents): opt-in coalesce flag suppresses the ops before-image"
```

---

## Task 2: the coalescing decision

Pure function answering "is a before-image warranted for this edit?". This is the logic that can be wrong, so it lives in a DOM-free module with its own tests.

**Files:**
- Create: `src/app/document-editor-commit.ts`
- Test: `src/app/document-editor-commit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/document-editor-commit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldCoalesce, COALESCE_WINDOW_MS } from "./document-editor-commit";
import type { DocVersion } from "./document-versions";

const version = (over: Partial<DocVersion> = {}): DocVersion => ({
  id: 1,
  documentId: 7,
  title: "D",
  blocks: [],
  savedAt: "2026-08-18T10:00:00.000Z",
  source: "user",
  op: "update",
  ...over,
});

const NOW = "2026-08-18T10:00:30.000Z"; // 30s after the fixture's savedAt

describe("shouldCoalesce", () => {
  it("is false when the document has no versions — the first edit of a session always records", () => {
    expect(shouldCoalesce([], 7, NOW)).toBe(false);
  });

  it("is true when the newest version is a recent user update on the same document", () => {
    expect(shouldCoalesce([version()], 7, NOW)).toBe(true);
  });

  it("is false when the newest version belongs to a DIFFERENT document", () => {
    expect(shouldCoalesce([version({ documentId: 99 })], 7, NOW)).toBe(false);
  });

  // The three run-breaking cases. Each records a different actor's change, so
  // it is never the current session's start state.
  it("is false when the newest version is an AI write", () => {
    expect(shouldCoalesce([version({ source: "ai" })], 7, NOW)).toBe(false);
  });

  it("is false when the newest version is not an update", () => {
    for (const op of ["rename", "delete", "duplicate", "restored"] as const) {
      expect(shouldCoalesce([version({ op })], 7, NOW)).toBe(false);
    }
  });

  it("is false when the newest version is outside the window", () => {
    const stale = version({ savedAt: "2026-08-18T09:00:00.000Z" });
    expect(shouldCoalesce([stale], 7, NOW)).toBe(false);
  });

  it("reads the NEWEST version, not the last array element", () => {
    // A caller must not have to pre-sort. Newest here is the AI write, which
    // breaks the run — if this read the last element it would return true.
    const older = version({ id: 1, savedAt: "2026-08-18T10:00:20.000Z", source: "user" });
    const newer = version({ id: 2, savedAt: "2026-08-18T10:00:25.000Z", source: "ai" });
    expect(shouldCoalesce([newer, older], 7, NOW)).toBe(false);
  });

  it("is false on an unparseable savedAt rather than coalescing blindly", () => {
    expect(shouldCoalesce([version({ savedAt: "not a date" })], 7, NOW)).toBe(false);
  });

  it("exposes the window as a named constant", () => {
    expect(COALESCE_WINDOW_MS).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/document-editor-commit.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Error" /tmp/t2.log
```

Expected: FAIL — cannot resolve `./document-editor-commit`.

- [ ] **Step 3: Write the implementation**

Create `src/app/document-editor-commit.ts`:

```ts
// Pure decision layer for the hand block editor.
//
// ★★★ DOM-FREE AND i18n-FREE BY CONTRACT. Nothing here may touch `document`,
//  `window`, DOMPurify or a translation. The React layer renders; this module
//  decides. Keeping it pure is what makes the coalescing rule testable at all.
import type { DocVersion } from "./document-versions";

/** How long after the previous user edit a further edit is treated as the same
 *  editing session. Deliberately short: long enough that typing through a
 *  document is one session, short enough that coming back after a break
 *  records a fresh before-image. */
export const COALESCE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Is a before-image UNWARRANTED for the edit about to be applied?
 *
 * ★★ The property this preserves is that the FIRST before-image of a session
 *  holds the state before the session started — the thing a user actually
 *  reverts to. Twenty keystroke-shaped snapshots would evict that, and every
 *  AI-authored version with it, against MAX_VERSIONS_PER_DOC (20).
 *
 * ★ Coalescing applies ONLY to a run of consecutive `user`/`update` versions on
 *  the SAME document. An AI write, a rename, a delete or a restore in between
 *  ends the run: those record a different actor's change and are never the
 *  current session's start state.
 */
export function shouldCoalesce(
  versions: readonly DocVersion[],
  documentId: number,
  now: string,
): boolean {
  const newest = newestVersion(versions);
  if (!newest) return false;
  if (newest.documentId !== documentId) return false;
  if (newest.source !== "user" || newest.op !== "update") return false;

  const nowMs = Date.parse(now);
  const savedMs = Date.parse(newest.savedAt);
  // ★ An unparseable timestamp must NOT coalesce. Coalescing on a value we
  //  cannot compare would silently drop a before-image on bad data — the
  //  failure that costs history rather than merely an extra version.
  if (Number.isNaN(nowMs) || Number.isNaN(savedMs)) return false;

  return nowMs - savedMs <= COALESCE_WINDOW_MS && nowMs >= savedMs;
}

/** ★ The caller must not have to pre-sort: this picks by `savedAt`, falling
 *  back to the higher id when two entries share a timestamp (two mutations in
 *  one tick carry an IDENTICAL `savedAt` — ids are minted in order). */
function newestVersion(versions: readonly DocVersion[]): DocVersion | undefined {
  let best: DocVersion | undefined;
  for (const v of versions) {
    if (!best) { best = v; continue; }
    if (v.savedAt > best.savedAt || (v.savedAt === best.savedAt && v.id > best.id)) best = v;
  }
  return best;
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run src/app/document-editor-commit.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t2.log
```

Expected: EXIT=0.

- [ ] **Step 5: Mutation-prove the guard**

The obvious fixture — a document with no prior versions — cannot observe a coalescing bug, because every arm agrees there. Prove the tests can actually see the guard by breaking it:

```bash
# Mutant: drop the source/op run-break check.
node -e "
const f='src/app/document-editor-commit.ts';const fs=require('fs');
const s=fs.readFileSync(f,'utf8');
fs.writeFileSync(f, s.replace('if (newest.source !== \"user\" || newest.op !== \"update\") return false;',''),'utf8');"
npx vitest run src/app/document-editor-commit.test.ts --reporter=dot > /tmp/t2m.log 2>&1; echo "MUTANT_EXIT=$?"; grep -E "Tests " /tmp/t2m.log
git checkout src/app/document-editor-commit.ts
npx vitest run src/app/document-editor-commit.test.ts --reporter=dot > /tmp/t2r.log 2>&1; echo "RESTORED_EXIT=$?"
```

Expected: `MUTANT_EXIT=1` with at least the AI-write and non-update tests failing, then `RESTORED_EXIT=0`. **If the mutant survives, the tests are vacuous — fix them before continuing.**

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/document-editor-commit.ts src/app/document-editor-commit.test.ts
git commit -m "feat(documents): pure coalescing decision for hand edits"
```

---

## Task 3: image predicate, dirty check, block→DocOp

Three more pure helpers in the same module.

**Files:**
- Modify: `src/app/document-editor-commit.ts`
- Test: `src/app/document-editor-commit.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/document-editor-commit.test.ts`:

```ts
import { paragraphHasImage, blockChanged, replaceBlockOp } from "./document-editor-commit";
import type { DocBlock } from "./document-model";

describe("paragraphHasImage", () => {
  it("detects an image element in stored paragraph HTML", () => {
    expect(paragraphHasImage('<p>a</p><img src="x.png">')).toBe(true);
    expect(paragraphHasImage('<p>a <img src="x.png"> b</p>')).toBe(true);
  });

  it("is false for HTML with no image", () => {
    expect(paragraphHasImage("<p>a</p>")).toBe(false);
    expect(paragraphHasImage("")).toBe(false);
  });

  it("does not match a word that merely starts with img", () => {
    // The tag boundary matters: "imgur" is not an <img>.
    expect(paragraphHasImage("<p>see imgur.com</p>")).toBe(false);
    expect(paragraphHasImage('<p><a href="https://imgur.com">x</a></p>')).toBe(false);
  });

  it("does not match escaped text that only looks like a tag", () => {
    // Stored HTML is already sanitized, so this is literal text, not an element.
    expect(paragraphHasImage("<p>&lt;img&gt;</p>")).toBe(false);
  });
});

describe("blockChanged", () => {
  it("is false for a block that was focused and left untouched", () => {
    const a: DocBlock = { type: "paragraph", html: "<p>x</p>" };
    expect(blockChanged(a, { type: "paragraph", html: "<p>x</p>" })).toBe(false);
  });

  it("is true when content differs", () => {
    const a: DocBlock = { type: "paragraph", html: "<p>x</p>" };
    expect(blockChanged(a, { type: "paragraph", html: "<p>y</p>" })).toBe(true);
  });

  it("compares nested content, not identity", () => {
    const a: DocBlock = { type: "bullets", items: ["one", "two"] };
    expect(blockChanged(a, { type: "bullets", items: ["one", "two"] })).toBe(false);
    expect(blockChanged(a, { type: "bullets", items: ["one", "three"] })).toBe(true);
  });

  it("treats an absent optional field and an omitted one as equal", () => {
    const a: DocBlock = { type: "bullets", items: ["one"] };
    expect(blockChanged(a, { type: "bullets", items: ["one"], ordered: undefined })).toBe(false);
  });
});

describe("replaceBlockOp", () => {
  it("builds a replace op at the given index", () => {
    const block: DocBlock = { type: "heading", level: 2, text: "H" };
    expect(replaceBlockOp(3, block)).toEqual({ op: "replace", index: 3, block });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/document-editor-commit.test.ts --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Error" /tmp/t3.log
```

Expected: FAIL — the three new exports do not exist.

- [ ] **Step 3: Implement**

Append to `src/app/document-editor-commit.ts`:

```ts
import type { DocBlock } from "./document-model";
import type { DocOp } from "./document-mutations";

/**
 * Does this paragraph's stored HTML contain an image element?
 *
 * ★★★ WHY THIS EXISTS: the shared `RichTextEditor` commits through
 *  `sanitizeRichHtml`, whose allow-list has no `img` — and `img` is a VOID
 *  element, so it does not unwrap to text, it vanishes outright. A document
 *  paragraph CAN hold one today, because model-authored paragraph HTML goes
 *  through `sanitizeDocumentHtml` (DOCUMENT_ALLOWED_TAGS is RICH_ALLOWED_TAGS
 *  plus `img`). So opening such a paragraph in the editor and typing one
 *  character would destroy the image with no error. Those paragraphs render
 *  read-only until S3c makes images first-class.
 *
 * ★ The `\b`-style boundary is load-bearing: without it "imgur" matches and a
 *  paragraph linking to imgur.com becomes uneditable for no reason.
 * ★ Operates on ALREADY-SANITIZED stored HTML, so a tag-shaped string in text
 *  content is escaped (`&lt;img&gt;`) and correctly does not match.
 */
export function paragraphHasImage(html: string): boolean {
  return /<img[\s/>]/i.test(html);
}

/** Did the edited block actually differ from the stored one?
 *
 *  ★ REQUIRED, not an optimisation: without it, focusing a block and leaving it
 *   writes a version whose before-image equals its after-image. */
export function blockChanged(stored: DocBlock, edited: DocBlock): boolean {
  return !deepEqual(stored, edited);
}

/** The single op a block edit produces. Block CONTENT is in scope for this
 *  slice; the SET of blocks is not, so nothing here appends, inserts or
 *  deletes. */
export function replaceBlockOp(index: number, block: DocBlock): DocOp {
  return { op: "replace", index, block };
}

/** ★ An OMITTED optional field and one explicitly set to `undefined` are the
 *  same block — a form control that clears `ordered` must not read as a change. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (ao[k] === undefined && bo[k] === undefined) continue;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/document-editor-commit.test.ts --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t3.log
```

Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/document-editor-commit.ts; echo "EXIT=$?"
git add src/app/document-editor-commit.ts src/app/document-editor-commit.test.ts
git commit -m "feat(documents): image predicate, dirty check and block op builder"
```

---

## Task 4: i18n keys

All strings for edit mode, in both dictionaries. `tsc` enforces key parity, so both files change together or the build fails.

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add the EN keys**

In `src/app/i18n.ts`, find the block of existing `documents*` keys and add these beside them (keeping the file's existing quoting and comma style):

```ts
  documentsEditBlocks: "Edit blocks",
  documentsPreview: "Preview",
  documentsBlockParagraph: "Paragraph",
  documentsBlockHeading: "Heading",
  documentsBlockBullets: "List",
  documentsBlockTable: "Table",
  documentsBlockDataSection: "Project data",
  documentsBlockPageBreak: "Page break",
  documentsHeadingLevel: "Heading level",
  documentsHeadingText: "Heading text",
  documentsParagraphLabel: "Paragraph {0}",
  documentsListOrdered: "Numbered list",
  documentsListItem: "Item {0}",
  documentsAddItem: "Add item",
  documentsRemoveItem: "Remove item {0}",
  documentsMoveItemUp: "Move item {0} up",
  documentsMoveItemDown: "Move item {0} down",
  documentsTableCaption: "Table caption",
  documentsTableCell: "Row {0}, column {1}",
  documentsTableColumnHeader: "Column {0} heading",
  documentsAddRow: "Add row",
  documentsRemoveRow: "Remove row {0}",
  documentsAddColumn: "Add column",
  documentsRemoveColumn: "Remove column {0}",
  documentsDataSectionKey: "Data section",
  documentsBlockImageReadOnly:
    "This paragraph contains an image, so it cannot be edited yet. Editing it here would remove the image.",
  documentsBlockNoEditor: "This block has no editable content.",
```

Note the placeholders are **0-based positional** (`{0}`, `{1}`) and are filled by `t(lang, key, a, b)`.

- [ ] **Step 2: Add the DE keys with a node script**

**Do not use the Edit tool on `i18n.de.ts`** — it corrupts umlauts and curls quotes, and the file is CRLF so a `\n` anchor silently no-ops. Write `/tmp/de-keys.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";

const f = "src/app/i18n.de.ts";
const raw = readFileSync(f, "utf8");
if (!raw.includes("\r\n")) throw new Error("expected CRLF");

// Anchor on an existing documents key so the block lands beside its family.
const anchor = "  documentsNewTitle:";
const idx = raw.indexOf(anchor);
if (idx < 0) throw new Error("anchor not found — pick another documents* key");

const block = [
  '  documentsEditBlocks: "Blöcke bearbeiten",',
  '  documentsPreview: "Vorschau",',
  '  documentsBlockParagraph: "Absatz",',
  '  documentsBlockHeading: "Überschrift",',
  '  documentsBlockBullets: "Liste",',
  '  documentsBlockTable: "Tabelle",',
  '  documentsBlockDataSection: "Projektdaten",',
  '  documentsBlockPageBreak: "Seitenumbruch",',
  '  documentsHeadingLevel: "Überschriftsebene",',
  '  documentsHeadingText: "Überschriftstext",',
  '  documentsParagraphLabel: "Absatz {0}",',
  '  documentsListOrdered: "Nummerierte Liste",',
  '  documentsListItem: "Eintrag {0}",',
  '  documentsAddItem: "Eintrag hinzufügen",',
  '  documentsRemoveItem: "Eintrag {0} entfernen",',
  '  documentsMoveItemUp: "Eintrag {0} nach oben verschieben",',
  '  documentsMoveItemDown: "Eintrag {0} nach unten verschieben",',
  '  documentsTableCaption: "Tabellenbeschriftung",',
  '  documentsTableCell: "Zeile {0}, Spalte {1}",',
  '  documentsTableColumnHeader: "Überschrift Spalte {0}",',
  '  documentsAddRow: "Zeile hinzufügen",',
  '  documentsRemoveRow: "Zeile {0} entfernen",',
  '  documentsAddColumn: "Spalte hinzufügen",',
  '  documentsRemoveColumn: "Spalte {0} entfernen",',
  '  documentsDataSectionKey: "Datenabschnitt",',
  '  documentsBlockImageReadOnly:',
  '    "Dieser Absatz enthält ein Bild und kann noch nicht bearbeitet werden. Eine Bearbeitung würde das Bild entfernen.",',
  '  documentsBlockNoEditor: "Dieser Block hat keinen bearbeitbaren Inhalt.",',
].join("\r\n") + "\r\n";

writeFileSync(f, raw.slice(0, idx) + block + raw.slice(idx), "utf8");
console.log("DE keys inserted");
```

Run it, then verify the umlauts survived:

```bash
node /tmp/de-keys.mjs
node -e "
const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');
for (const ch of ['ä','ö','ü','Ü']) console.log(ch, (s.split(ch).length-1));
console.log('U+FFFD:', s.includes('�'), 'NUL:', s.includes(String.fromCharCode(0)));"
```

Expected: non-zero counts for each umlaut, `U+FFFD: false`, `NUL: false`.

- [ ] **Step 3: Verify parity and the encoding gate**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/i18n-encoding.test.ts --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t4.log
```

Expected: both EXIT=0. `tsc` is what enforces EN/DE key parity; the encoding test bans ASCII substitutions like `fuer`/`ueber`.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(documents): i18n strings for the block editor"
```

---

## Task 5: paragraph editor

First of the five per-kind editors. Mounts the **existing shared** `RichTextEditor` — no variant, no new sanitizer, no new toolbar. Alignment comes free with it via `data-align`.

**Files:**
- Create: `src/app/document-block-editors.tsx`
- Test: `src/app/document-block-editors.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/document-block-editors.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ParagraphBlockEditor } from "./document-block-editors";
import { t } from "./i18n";

const LANG = "en-US" as const;

describe("ParagraphBlockEditor", () => {
  it("renders an editor for a paragraph with no image", () => {
    render(
      <ParagraphBlockEditor
        lang={LANG}
        index={0}
        block={{ type: "paragraph", html: "<p>hello</p>" }}
        onCommit={vi.fn()}
      />,
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.queryByText(t(LANG, "documentsBlockImageReadOnly"))).toBeNull();
  });

  it("renders READ-ONLY with a stated reason when the paragraph holds an image", () => {
    const onCommit = vi.fn();
    render(
      <ParagraphBlockEditor
        lang={LANG}
        index={0}
        block={{ type: "paragraph", html: '<p>a</p><img src="x.png">' }}
        onCommit={onCommit}
      />,
    );
    // The reason is stated, not merely implied by a disabled control.
    expect(screen.getByText(t(LANG, "documentsBlockImageReadOnly"))).toBeInTheDocument();
    // No toolbar means no editor mounted.
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("gives two sibling paragraph editors DISTINCT accessible names", async () => {
    // ★★★ The axe gate cannot see a duplicate accessible name at ANY seed size.
    // This test is the only possible detector, and it needs TWO blocks to
    // express the property at all.
    render(
      <>
        <ParagraphBlockEditor lang={LANG} index={0} block={{ type: "paragraph", html: "<p>one</p>" }} onCommit={vi.fn()} />
        <ParagraphBlockEditor lang={LANG} index={1} block={{ type: "paragraph", html: "<p>two</p>" }} onCommit={vi.fn()} />
      </>,
    );
    const toolbars = screen.getAllByRole("toolbar");
    expect(toolbars).toHaveLength(2);
    const names = toolbars.map((el) => el.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
  });

  it("commits on blur only when the content changed", async () => {
    const onCommit = vi.fn();
    render(
      <ParagraphBlockEditor lang={LANG} index={2} block={{ type: "paragraph", html: "<p>x</p>" }} onCommit={onCommit} />,
    );
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
    editable.focus();
    editable.blur();
    // Focused and left untouched — nothing to save.
    expect(onCommit).not.toHaveBeenCalled();

    editable.focus();
    await userEvent.type(editable, "y");
    editable.blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    const [index, block] = onCommit.mock.calls[0];
    expect(index).toBe(2);
    expect(block.type).toBe("paragraph");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/document-block-editors.test.tsx --reporter=dot > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Error" /tmp/t5.log
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/app/document-block-editors.tsx`:

```tsx
// The five per-kind block editors. PRESENTATIONAL: every one takes its block
// and an `onCommit(index, block)` and holds no workspace knowledge.
//
// ★★ Per-block controls take BLOCK-UNIQUE accessible names. Two controls
//  sharing a name is a WCAG 2.4.6 failure that NO axe rule under the four tags
//  e2e/a11y.spec.ts requests can see, at any seed size — the unit tests beside
//  this file are the only detector that exists.
import { useRef, useState } from "react";
import { RichTextEditor } from "./rich-text-editor";
import { paragraphHasImage, blockChanged } from "./document-editor-commit";
import { t, type Lang } from "./i18n";
import type { DocBlock } from "./document-model";

export type BlockEditorProps<B extends DocBlock = DocBlock> = {
  lang: Lang;
  /** Position in the document — the op index, and what makes labels unique. */
  index: number;
  block: B;
  onCommit: (index: number, block: DocBlock) => void;
};

export function ParagraphBlockEditor({
  lang,
  index,
  block,
  onCommit,
}: BlockEditorProps<Extract<DocBlock, { type: "paragraph" }>>) {
  // ★★★ An image in a document paragraph is REACHABLE TODAY (model-authored
  //  HTML goes through sanitizeDocumentHtml, which admits `img`), and the
  //  shared editor commits through sanitizeRichHtml, which does not. `img` is
  //  a VOID element, so it would not unwrap to text — it would vanish. Render
  //  read-only, and SAY WHY: a disabled control with no reason reads as broken.
  if (paragraphHasImage(block.html)) {
    return (
      <div className="rounded-md border border-line bg-surface-muted p-3">
        <div
          className="prose-sm max-w-none text-foreground"
          dangerouslySetInnerHTML={{ __html: block.html }}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {t(lang, "documentsBlockImageReadOnly")}
        </p>
      </div>
    );
  }
  return <ParagraphEditorBody lang={lang} index={index} block={block} onCommit={onCommit} />;
}

/** Split out so the read-only branch above returns BEFORE any hook runs —
 *  a conditional hook call is a lint error and a React rules violation. */
function ParagraphEditorBody({
  lang,
  index,
  block,
  onCommit,
}: BlockEditorProps<Extract<DocBlock, { type: "paragraph" }>>) {
  const [html, setHtml] = useState(block.html);
  const htmlRef = useRef(block.html);
  htmlRef.current = html;

  const commit = () => {
    const next: DocBlock = { type: "paragraph", html: htmlRef.current };
    if (blockChanged(block, next)) onCommit(index, next);
  };

  return (
    <div onBlur={commit}>
      <RichTextEditor
        value={html}
        onChange={setHtml}
        label={t(lang, "documentsParagraphLabel", String(index + 1))}
        lang={lang}
      />
    </div>
  );
}
```

The `label` is what the shared toolbar turns into its `aria-label`, so a per-index label is what makes sibling toolbars distinguishable — that is the 2.4.6 fix, and it costs one string.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/document-block-editors.test.tsx --reporter=dot > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t5.log
```

Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/document-block-editors.tsx; echo "EXIT=$?"
git add src/app/document-block-editors.tsx src/app/document-block-editors.test.tsx
git commit -m "feat(documents): paragraph block editor with read-only image guard"
```

---

## Task 6: heading editor

`heading.text` is a plain `string`, so there are no marks — a level select and a text input.

**Files:**
- Modify: `src/app/document-block-editors.tsx`, `src/app/document-block-editors.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/document-block-editors.test.tsx`:

```tsx
import { HeadingBlockEditor } from "./document-block-editors";

describe("HeadingBlockEditor", () => {
  it("edits level and text, committing on blur", async () => {
    const onCommit = vi.fn();
    render(
      <HeadingBlockEditor
        lang={LANG}
        index={0}
        block={{ type: "heading", level: 2, text: "Old" }}
        onCommit={onCommit}
      />,
    );
    const text = screen.getByRole("textbox", { name: `${t(LANG, "documentsHeadingText")} 1` });
    await userEvent.clear(text);
    await userEvent.type(text, "New");
    text.blur();
    expect(onCommit).toHaveBeenCalledWith(0, { type: "heading", level: 2, text: "New" });
  });

  it("offers only levels 1-3", () => {
    render(
      <HeadingBlockEditor lang={LANG} index={0} block={{ type: "heading", level: 1, text: "H" }} onCommit={vi.fn()} />,
    );
    const select = screen.getByRole("combobox", { name: `${t(LANG, "documentsHeadingLevel")} 1` });
    expect(within(select).getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual(["1", "2", "3"]);
  });

  it("gives two sibling headings ROW-UNIQUE control names", () => {
    render(
      <>
        <HeadingBlockEditor lang={LANG} index={0} block={{ type: "heading", level: 1, text: "A" }} onCommit={vi.fn()} />
        <HeadingBlockEditor lang={LANG} index={1} block={{ type: "heading", level: 2, text: "B" }} onCommit={vi.fn()} />
      </>,
    );
    const names = screen.getAllByRole("combobox").map((el) => el.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
  });

  it("does not commit when nothing changed", () => {
    const onCommit = vi.fn();
    render(
      <HeadingBlockEditor lang={LANG} index={0} block={{ type: "heading", level: 2, text: "Same" }} onCommit={onCommit} />,
    );
    const text = screen.getByRole("textbox", { name: `${t(LANG, "documentsHeadingText")} 1` });
    text.focus();
    text.blur();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
```

Add `within` to the `@testing-library/react` import at the top of the file.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/document-block-editors.test.tsx --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Error" /tmp/t6.log
```

Expected: FAIL — `HeadingBlockEditor` is not exported.

- [ ] **Step 3: Implement**

Append to `src/app/document-block-editors.tsx`:

```tsx
const HEADING_LEVELS = [1, 2, 3] as const;

export function HeadingBlockEditor({
  lang,
  index,
  block,
  onCommit,
}: BlockEditorProps<Extract<DocBlock, { type: "heading" }>>) {
  const [level, setLevel] = useState<1 | 2 | 3>(block.level);
  const [text, setText] = useState(block.text);

  const commit = (nextLevel: 1 | 2 | 3, nextText: string) => {
    const next: DocBlock = { type: "heading", level: nextLevel, text: nextText };
    if (blockChanged(block, next)) onCommit(index, next);
  };

  // ★ Every label carries the 1-based block position. N identical "Heading
  //  level" labels is a 2.4.6 failure the axe gate cannot see.
  const suffix = ` ${index + 1}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label={t(lang, "documentsHeadingLevel") + suffix}
        className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground"
        value={String(level)}
        onChange={(e) => {
          const next = Number(e.target.value) as 1 | 2 | 3;
          setLevel(next);
          commit(next, text);
        }}
      >
        {HEADING_LEVELS.map((l) => (
          <option key={l} value={String(l)}>{`H${l}`}</option>
        ))}
      </select>
      <input
        type="text"
        aria-label={t(lang, "documentsHeadingText") + suffix}
        className="flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(level, text)}
      />
    </div>
  );
}
```

The level select commits immediately (a `select` has no meaningful "finished editing" blur), while the text input commits on blur. Both route through the same dirty check.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/document-block-editors.test.tsx --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t6.log
```

Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/document-block-editors.tsx src/app/document-block-editors.test.tsx
git commit -m "feat(documents): heading block editor"
```

---

## Task 7: bullets editor

Per-item fields, add/remove/reorder, ordered toggle. This is the first editor with **N controls of the same kind**, so the unique-name test matters most here.

**Files:**
- Modify: `src/app/document-block-editors.tsx`, `src/app/document-block-editors.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/document-block-editors.test.tsx`:

```tsx
import { BulletsBlockEditor } from "./document-block-editors";

describe("BulletsBlockEditor", () => {
  const block = { type: "bullets", items: ["one", "two"] } as const;

  it("gives every per-item control an ITEM-UNIQUE accessible name", () => {
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />);
    const removes = screen.getAllByRole("button", { name: /^Remove item/ });
    expect(removes).toHaveLength(2);
    expect(new Set(removes.map((b) => b.getAttribute("aria-label"))).size).toBe(2);
  });

  it("adds an item", async () => {
    const onCommit = vi.fn();
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("button", { name: t(LANG, "documentsAddItem") }));
    expect(onCommit).toHaveBeenCalledWith(0, { type: "bullets", items: ["one", "two", ""] });
  });

  it("removes an item", async () => {
    const onCommit = vi.fn();
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("button", { name: t(LANG, "documentsRemoveItem", "1") }));
    expect(onCommit).toHaveBeenCalledWith(0, { type: "bullets", items: ["two"] });
  });

  it("moves an item down", async () => {
    const onCommit = vi.fn();
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("button", { name: t(LANG, "documentsMoveItemDown", "1") }));
    expect(onCommit).toHaveBeenCalledWith(0, { type: "bullets", items: ["two", "one"] });
  });

  it("cannot move the first item up or the last item down", () => {
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />);
    expect(screen.getByRole("button", { name: t(LANG, "documentsMoveItemUp", "1") })).toBeDisabled();
    expect(screen.getByRole("button", { name: t(LANG, "documentsMoveItemDown", "2") })).toBeDisabled();
  });

  it("toggles ordered", async () => {
    const onCommit = vi.fn();
    render(<BulletsBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("button", { name: t(LANG, "documentsListOrdered") }));
    expect(onCommit).toHaveBeenCalledWith(0, { type: "bullets", items: ["one", "two"], ordered: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/document-block-editors.test.tsx --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Error" /tmp/t7.log
```

Expected: FAIL — `BulletsBlockEditor` is not exported.

- [ ] **Step 3: Implement**

Append to `src/app/document-block-editors.tsx` (add `ToggleButton` to the imports at the top: `import { ToggleButton } from "./toggle-button";`):

```tsx
export function BulletsBlockEditor({
  lang,
  index,
  block,
  onCommit,
}: BlockEditorProps<Extract<DocBlock, { type: "bullets" }>>) {
  const [items, setItems] = useState<readonly string[]>(block.items);

  const emit = (nextItems: readonly string[], ordered = block.ordered) => {
    const next: DocBlock = ordered
      ? { type: "bullets", items: [...nextItems], ordered }
      : { type: "bullets", items: [...nextItems] };
    setItems(nextItems);
    if (blockChanged(block, next)) onCommit(index, next);
  };

  const move = (from: number, to: number) => {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    emit(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <ToggleButton
        pressed={block.ordered === true}
        onToggle={() => emit(items, block.ordered === true ? undefined : true)}
        lang={lang}
      >
        {t(lang, "documentsListOrdered")}
      </ToggleButton>

      <ul className="flex flex-col gap-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1">
            <input
              type="text"
              aria-label={t(lang, "documentsListItem", String(i + 1))}
              className="flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground"
              value={item}
              onChange={(e) => {
                const next = [...items];
                next[i] = e.target.value;
                setItems(next);
              }}
              onBlur={() => emit(items)}
            />
            <button
              type="button"
              aria-label={t(lang, "documentsMoveItemUp", String(i + 1))}
              disabled={i === 0}
              className="rounded-md border border-line px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => move(i, i - 1)}
            >
              {"↑"}
            </button>
            <button
              type="button"
              aria-label={t(lang, "documentsMoveItemDown", String(i + 1))}
              disabled={i === items.length - 1}
              className="rounded-md border border-line px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => move(i, i + 1)}
            >
              {"↓"}
            </button>
            <button
              type="button"
              aria-label={t(lang, "documentsRemoveItem", String(i + 1))}
              className="rounded-md border border-line px-2 py-1 text-xs"
              onClick={() => emit(items.filter((_, j) => j !== i))}
            >
              {"✕"}
            </button>
          </li>
        ))}
      </ul>

      <div>
        <button
          type="button"
          className="rounded-md border border-line px-2 py-1 text-xs"
          onClick={() => emit([...items, ""])}
        >
          {t(lang, "documentsAddItem")}
        </button>
      </div>
    </div>
  );
}
```

★ The move/remove buttons are real `disabled` attributes, not `aria-disabled` lookalikes — an `aria-disabled` button still fires `onClick`.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/document-block-editors.test.tsx --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t7.log
```

Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/document-block-editors.tsx src/app/document-block-editors.test.tsx
git commit -m "feat(documents): bullets block editor"
```

---

## Task 8: table editor

Per-cell fields plus add/remove row and column. The largest editor — if `document-block-editors.tsx` approaches ~400 lines after this task, extract this one into `document-table-editor.tsx` in the same commit.

**Files:**
- Modify: `src/app/document-block-editors.tsx` (or create `src/app/document-table-editor.tsx` — see above), `src/app/document-block-editors.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/document-block-editors.test.tsx`:

```tsx
import { TableBlockEditor } from "./document-block-editors";

describe("TableBlockEditor", () => {
  const block = {
    type: "table",
    columns: ["Name", "Owner"],
    rows: [["Alpha", "Ada"], ["Beta", "Bob"]],
  } as const;

  it("gives every cell a ROW-AND-COLUMN-unique accessible name", () => {
    render(<TableBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />);
    const cells = screen.getAllByRole("textbox", { name: /^Row \d+, column \d+$/ });
    expect(cells).toHaveLength(4);
    expect(new Set(cells.map((c) => c.getAttribute("aria-label"))).size).toBe(4);
  });

  it("gives every remove-row and remove-column control a unique name", () => {
    render(<TableBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />);
    const rows = screen.getAllByRole("button", { name: /^Remove row/ });
    const cols = screen.getAllByRole("button", { name: /^Remove column/ });
    expect(new Set(rows.map((b) => b.getAttribute("aria-label"))).size).toBe(rows.length);
    expect(new Set(cols.map((b) => b.getAttribute("aria-label"))).size).toBe(cols.length);
  });

  it("adds a row with the right number of cells", async () => {
    const onCommit = vi.fn();
    render(<TableBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("button", { name: t(LANG, "documentsAddRow") }));
    expect(onCommit).toHaveBeenCalledWith(0, {
      type: "table",
      columns: ["Name", "Owner"],
      rows: [["Alpha", "Ada"], ["Beta", "Bob"], ["", ""]],
    });
  });

  it("adds a column to the header AND every row", async () => {
    const onCommit = vi.fn();
    render(<TableBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("button", { name: t(LANG, "documentsAddColumn") }));
    expect(onCommit).toHaveBeenCalledWith(0, {
      type: "table",
      columns: ["Name", "Owner", ""],
      rows: [["Alpha", "Ada", ""], ["Beta", "Bob", ""]],
    });
  });

  it("removes a column from the header AND every row", async () => {
    const onCommit = vi.fn();
    render(<TableBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("button", { name: t(LANG, "documentsRemoveColumn", "1") }));
    expect(onCommit).toHaveBeenCalledWith(0, {
      type: "table",
      columns: ["Owner"],
      rows: [["Ada"], ["Bob"]],
    });
  });

  it("keeps an existing caption when editing cells", async () => {
    const onCommit = vi.fn();
    render(
      <TableBlockEditor
        lang={LANG}
        index={0}
        block={{ ...block, caption: "Q3" }}
        onCommit={onCommit}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: t(LANG, "documentsAddRow") }));
    expect(onCommit.mock.calls[0][1].caption).toBe("Q3");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/document-block-editors.test.tsx --reporter=dot > /tmp/t8.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Error" /tmp/t8.log
```

Expected: FAIL — `TableBlockEditor` is not exported.

- [ ] **Step 3: Implement**

Append to `src/app/document-block-editors.tsx`:

```tsx
export function TableBlockEditor({
  lang,
  index,
  block,
  onCommit,
}: BlockEditorProps<Extract<DocBlock, { type: "table" }>>) {
  const [columns, setColumns] = useState<readonly string[]>(block.columns);
  const [rows, setRows] = useState<readonly (readonly string[])[]>(block.rows);
  const [caption, setCaption] = useState(block.caption ?? "");

  const emit = (
    nextColumns: readonly string[],
    nextRows: readonly (readonly string[])[],
    nextCaption = caption,
  ) => {
    setColumns(nextColumns);
    setRows(nextRows);
    // ★ Caption is OPTIONAL and sparse: an empty one is omitted, so a table
    //  that never had a caption serializes exactly as it did before.
    const next: DocBlock = nextCaption
      ? { type: "table", caption: nextCaption, columns: [...nextColumns], rows: nextRows.map((r) => [...r]) }
      : { type: "table", columns: [...nextColumns], rows: nextRows.map((r) => [...r]) };
    if (blockChanged(block, next)) onCommit(index, next);
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        aria-label={`${t(lang, "documentsTableCaption")} ${index + 1}`}
        className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        onBlur={() => emit(columns, rows)}
      />

      <div className="overflow-x-auto">
        <table className="w-max text-sm">
          <thead>
            <tr>
              {columns.map((col, c) => (
                <th key={c} className="px-1 py-1 text-left font-medium">
                  <input
                    type="text"
                    aria-label={t(lang, "documentsTableColumnHeader", String(c + 1))}
                    className="w-32 rounded-md border border-line bg-surface px-2 py-1 text-foreground"
                    value={col}
                    onChange={(e) => {
                      const next = [...columns];
                      next[c] = e.target.value;
                      setColumns(next);
                    }}
                    onBlur={() => emit(columns, rows)}
                  />
                  <button
                    type="button"
                    aria-label={t(lang, "documentsRemoveColumn", String(c + 1))}
                    className="ml-1 rounded-md border border-line px-2 py-1 text-xs"
                    onClick={() =>
                      emit(
                        columns.filter((_, j) => j !== c),
                        rows.map((r) => r.filter((_, j) => j !== c)),
                      )
                    }
                  >
                    {"✕"}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="px-1 py-1">
                    <input
                      type="text"
                      aria-label={t(lang, "documentsTableCell", String(r + 1), String(c + 1))}
                      className="w-32 rounded-md border border-line bg-surface px-2 py-1 text-foreground"
                      value={cell}
                      onChange={(e) => {
                        const next = rows.map((rr) => [...rr]);
                        next[r][c] = e.target.value;
                        setRows(next);
                      }}
                      onBlur={() => emit(columns, rows)}
                    />
                  </td>
                ))}
                <td className="px-1 py-1">
                  <button
                    type="button"
                    aria-label={t(lang, "documentsRemoveRow", String(r + 1))}
                    className="rounded-md border border-line px-2 py-1 text-xs"
                    onClick={() => emit(columns, rows.filter((_, j) => j !== r))}
                  >
                    {"✕"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-md border border-line px-2 py-1 text-xs"
          onClick={() => emit(columns, [...rows, columns.map(() => "")])}
        >
          {t(lang, "documentsAddRow")}
        </button>
        <button
          type="button"
          className="rounded-md border border-line px-2 py-1 text-xs"
          onClick={() => emit([...columns, ""], rows.map((r) => [...r, ""]))}
        >
          {t(lang, "documentsAddColumn")}
        </button>
      </div>
    </div>
  );
}
```

★ Adding or removing a column touches the header **and every row** in one emit — a column added to only one of the two makes the table ragged, and the renderers assume rectangularity.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/document-block-editors.test.tsx --reporter=dot > /tmp/t8.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t8.log
```

Expected: EXIT=0.

- [ ] **Step 5: Check the file size and split if needed**

```bash
node -e "console.log(require('fs').readFileSync('src/app/document-block-editors.tsx','utf8').split('\n').length)"
```

If this is above 400, move `TableBlockEditor` into a new `src/app/document-table-editor.tsx` and re-export it from `document-block-editors.tsx` so the test imports keep working. Re-run the test file after moving.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
git add src/app/document-block-editors.tsx src/app/document-block-editors.test.tsx
git commit -m "feat(documents): table block editor"
```

---

## Task 9: dataSection editor

A `select` over the 15 `ExportSectionKey`s. Never free text — an arbitrary string would resolve to no section and render nothing.

**Files:**
- Modify: `src/app/document-block-editors.tsx`, `src/app/document-block-editors.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/document-block-editors.test.tsx`:

```tsx
import { DataSectionBlockEditor, PageBreakBlockEditor } from "./document-block-editors";
import { EXPORT_SECTION_KEYS } from "./settings-types";

describe("DataSectionBlockEditor", () => {
  it("offers every export section key and no free text", () => {
    render(
      <DataSectionBlockEditor
        lang={LANG}
        index={0}
        block={{ type: "dataSection", key: EXPORT_SECTION_KEYS[0] }}
        onCommit={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox", { name: `${t(LANG, "documentsDataSectionKey")} 1` });
    expect(within(select).getAllByRole("option")).toHaveLength(EXPORT_SECTION_KEYS.length);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("commits the chosen key", async () => {
    const onCommit = vi.fn();
    render(
      <DataSectionBlockEditor
        lang={LANG}
        index={4}
        block={{ type: "dataSection", key: EXPORT_SECTION_KEYS[0] }}
        onCommit={onCommit}
      />,
    );
    const select = screen.getByRole("combobox", { name: `${t(LANG, "documentsDataSectionKey")} 5` });
    await userEvent.selectOptions(select, EXPORT_SECTION_KEYS[1]);
    expect(onCommit).toHaveBeenCalledWith(4, { type: "dataSection", key: EXPORT_SECTION_KEYS[1] });
  });
});

describe("PageBreakBlockEditor", () => {
  it("states that there is nothing to edit rather than rendering an empty box", () => {
    render(<PageBreakBlockEditor lang={LANG} index={0} block={{ type: "pageBreak" }} onCommit={vi.fn()} />);
    expect(screen.getByText(t(LANG, "documentsBlockNoEditor"))).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/document-block-editors.test.tsx --reporter=dot > /tmp/t9.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Error" /tmp/t9.log
```

Expected: FAIL — neither export exists.

- [ ] **Step 3: Implement**

Append to `src/app/document-block-editors.tsx` (add `import { EXPORT_SECTION_KEYS } from "./settings-types";` at the top):

```tsx
export function DataSectionBlockEditor({
  lang,
  index,
  block,
  onCommit,
}: BlockEditorProps<Extract<DocBlock, { type: "dataSection" }>>) {
  // ★ A `select`, never free text: an arbitrary key resolves to no section and
  //  renders as NOTHING — a silently missing section rather than an error.
  return (
    <select
      aria-label={`${t(lang, "documentsDataSectionKey")} ${index + 1}`}
      className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground"
      value={block.key}
      onChange={(e) => {
        const key = e.target.value as (typeof EXPORT_SECTION_KEYS)[number];
        if (key !== block.key) onCommit(index, { type: "dataSection", key });
      }}
    >
      {EXPORT_SECTION_KEYS.map((k) => (
        <option key={k} value={k}>{k}</option>
      ))}
    </select>
  );
}

/** A page break has no content. It still renders a row in the block list so it
 *  stays reachable and announced — a block that vanishes in edit mode reads as
 *  data loss. */
export function PageBreakBlockEditor({
  lang,
}: BlockEditorProps<Extract<DocBlock, { type: "pageBreak" }>>) {
  return <p className="text-xs text-muted-foreground">{t(lang, "documentsBlockNoEditor")}</p>;
}
```

If `EXPORT_SECTION_KEYS` is not exported from `settings-types.ts`, find where it lives with `grep -rn "EXPORT_SECTION_KEYS" src/app --include="*.ts" | head -3` and import from there.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/document-block-editors.test.tsx --reporter=dot > /tmp/t9.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t9.log
```

Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/document-block-editors.tsx src/app/document-block-editors.test.tsx
git commit -m "feat(documents): dataSection and pageBreak block rows"
```

---

## Task 10: commit wiring hook

Turns an `(index, block)` commit from an editor into a `mutateDocuments` call, applying the coalescing decision.

**Files:**
- Create: `src/app/use-document-editor.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Write the hook**

This file is render-scope glue with no branching logic of its own — every decision it makes is delegated to the pure module tested in Tasks 2 and 3. Create `src/app/use-document-editor.ts`:

```ts
// Render-scope glue between the block editors and the workspace mutation.
//
// ★ EVERY DECISION HERE IS DELEGATED. The coalescing rule, the dirty check and
//  the image predicate all live in document-editor-commit.ts, which is pure and
//  tested. If logic starts accumulating in this file, move it there instead of
//  testing it here.
import { useCallback } from "react";
import { shouldCoalesce, replaceBlockOp } from "./document-editor-commit";
import type { DocBlock } from "./document-model";
import type { DocMutation, DocResult } from "./document-mutations";
import type { DocVersion, DocVersionSource } from "./document-versions";

export type UseDocumentEditorDeps = {
  documentId: number;
  versions: readonly DocVersion[];
  mutateDocuments: (m: DocMutation, source: DocVersionSource) => DocResult;
  /** Injected so the decision is testable without a clock. */
  now?: () => string;
};

export function useDocumentEditor(deps: UseDocumentEditorDeps) {
  const { documentId, versions, mutateDocuments, now } = deps;

  const commitBlock = useCallback(
    (index: number, block: DocBlock): DocResult => {
      const stamp = now ? now() : new Date().toISOString();
      // ★★ Coalesce a RUN of consecutive user edits so a 20-block session
      //  cannot evict this document's history against MAX_VERSIONS_PER_DOC.
      //  The FIRST edit of a session always records, so the pre-session state
      //  stays the revert target.
      const coalesce = shouldCoalesce(versions, documentId, stamp);
      return mutateDocuments(
        { kind: "ops", id: documentId, ops: [replaceBlockOp(index, block)], coalesce },
        "user",
      );
    },
    [documentId, versions, mutateDocuments, now],
  );

  return { commitBlock };
}
```

- [ ] **Step 2: Exclude it from the coverage gate**

It is UI glue with no logic of its own, matching the existing convention for extracted deps-object hooks. In `vitest.config.ts`, find `coverage.exclude` and add an entry beside the existing hook exclusions:

```ts
      "src/app/use-document-editor.ts",
```

★ If you find yourself wanting to test this file, that is the signal it holds logic it should not — move the logic into `document-editor-commit.ts` and delete the exclusion.

- [ ] **Step 3: Verify the gates**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: both EXIT=0.

- [ ] **Step 4: Commit**

```bash
git add src/app/use-document-editor.ts vitest.config.ts
git commit -m "feat(documents): commit wiring for hand block edits"
```

---

## Task 11: the edit-mode orchestrator

Renders the block list, the gutter, and the per-kind editor for each block. Narrow-pane behaviour rides `useMediaQuery`.

**Files:**
- Create: `src/app/document-editor.tsx`
- Test: `src/app/document-editor.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/document-editor.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentEditor } from "./document-editor";
import { t } from "./i18n";
import type { ProjectDocument } from "./document-model";

const LANG = "en-US" as const;

const doc: ProjectDocument = {
  id: 7,
  title: "Status report",
  blocks: [
    { type: "heading", level: 1, text: "Summary" },
    { type: "paragraph", html: "<p>All good</p>" },
    { type: "pageBreak" },
  ],
  createdAt: "2026-08-18T10:00:00.000Z",
  updatedAt: "2026-08-18T10:00:00.000Z",
};

describe("DocumentEditor", () => {
  it("renders one row per block, including blocks with no editor", () => {
    render(<DocumentEditor lang={LANG} doc={doc} onCommitBlock={vi.fn()} />);
    expect(screen.getByText(t(LANG, "documentsBlockHeading"))).toBeInTheDocument();
    expect(screen.getByText(t(LANG, "documentsBlockParagraph"))).toBeInTheDocument();
    // The page break is still listed — a block that vanishes reads as data loss.
    expect(screen.getByText(t(LANG, "documentsBlockPageBreak"))).toBeInTheDocument();
  });

  it("passes the block INDEX through to the commit handler", async () => {
    const onCommitBlock = vi.fn();
    render(<DocumentEditor lang={LANG} doc={doc} onCommitBlock={onCommitBlock} />);
    const text = screen.getByRole("textbox", { name: `${t(LANG, "documentsHeadingText")} 1` });
    await userEvent.type(text, "!");
    text.blur();
    expect(onCommitBlock).toHaveBeenCalledWith(0, expect.objectContaining({ type: "heading" }));
  });

  it("renders NO drag handle — reordering is out of scope for this slice", () => {
    render(<DocumentEditor lang={LANG} doc={doc} onCommitBlock={vi.fn()} />);
    // A handle that does nothing is worse than no handle.
    expect(screen.queryByRole("button", { name: /drag|reorder|move block/i })).toBeNull();
  });

  it("docks ONE toolbar at a narrow pane instead of one per block", () => {
    render(<DocumentEditor lang={LANG} doc={doc} onCommitBlock={vi.fn()} narrow />);
    // jsdom has no layout, so the narrow branch is driven by an injected flag,
    // never by a measured width.
    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/document-editor.test.tsx --reporter=dot > /tmp/t11.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Error" /tmp/t11.log
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/app/document-editor.tsx`:

```tsx
// Edit-mode orchestrator: one row per block, a gutter carrying the kind chip,
// and the per-kind editor.
//
// ★★ IN SCOPE IS BLOCK *CONTENT*; the SET of blocks is not. So there is NO drag
//  handle and no add/remove-block control — a handle that does nothing is worse
//  than no handle. That is the structural slice.
import {
  ParagraphBlockEditor,
  HeadingBlockEditor,
  BulletsBlockEditor,
  TableBlockEditor,
  DataSectionBlockEditor,
  PageBreakBlockEditor,
} from "./document-block-editors";
import { t, type Lang } from "./i18n";
import type { DocBlock, ProjectDocument } from "./document-model";

/** Pane width below which the toolbar docks once instead of per block.
 *  ★ PANE width, not device width — the pane is user-resizable and has a
 *   popout path, so a desktop user reaches this by dragging. */
export const NARROW_PANE_QUERY = "(max-width: 640px)";

export type DocumentEditorProps = {
  lang: Lang;
  doc: ProjectDocument;
  onCommitBlock: (index: number, block: DocBlock) => void;
  /** Injected. ★ jsdom has no layout, so a measured width would be untestable. */
  narrow?: boolean;
};

const KIND_LABEL: Record<DocBlock["type"], string> = {
  paragraph: "documentsBlockParagraph",
  heading: "documentsBlockHeading",
  bullets: "documentsBlockBullets",
  table: "documentsBlockTable",
  dataSection: "documentsBlockDataSection",
  pageBreak: "documentsBlockPageBreak",
};

export function DocumentEditor({ lang, doc, onCommitBlock, narrow = false }: DocumentEditorProps) {
  return (
    <div className="flex flex-col gap-3">
      {doc.blocks.map((block, index) => (
        <div key={index} className="flex gap-2 rounded-md border border-line p-2">
          <div className="shrink-0">
            <span className="rounded-md bg-surface-muted px-2 py-1 text-xs text-muted-foreground">
              {t(lang, KIND_LABEL[block.type])}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <BlockEditor
              lang={lang}
              index={index}
              block={block}
              onCommit={onCommitBlock}
              narrow={narrow}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function BlockEditor({
  lang,
  index,
  block,
  onCommit,
  narrow,
}: {
  lang: Lang;
  index: number;
  block: DocBlock;
  onCommit: (index: number, block: DocBlock) => void;
  narrow: boolean;
}) {
  switch (block.type) {
    case "paragraph":
      // ★ At a narrow pane only the SELECTED block mounts a rich editor, so the
      //  document carries one docked toolbar rather than one per paragraph.
      return narrow && index !== 0 ? (
        <div
          className="prose-sm max-w-none text-foreground"
          dangerouslySetInnerHTML={{ __html: block.html }}
        />
      ) : (
        <ParagraphBlockEditor lang={lang} index={index} block={block} onCommit={onCommit} />
      );
    case "heading":
      return <HeadingBlockEditor lang={lang} index={index} block={block} onCommit={onCommit} />;
    case "bullets":
      return <BulletsBlockEditor lang={lang} index={index} block={block} onCommit={onCommit} />;
    case "table":
      return <TableBlockEditor lang={lang} index={index} block={block} onCommit={onCommit} />;
    case "dataSection":
      return <DataSectionBlockEditor lang={lang} index={index} block={block} onCommit={onCommit} />;
    case "pageBreak":
      return <PageBreakBlockEditor lang={lang} index={index} block={block} onCommit={onCommit} />;
  }
}
```

★ The `switch` is exhaustive over `DocBlock["type"]` with no `default`, so adding a block kind later is a **typecheck error here** rather than a silently missing editor.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/document-editor.test.tsx --reporter=dot > /tmp/t11.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t11.log
```

Expected: EXIT=0. If the narrow-pane test fails because more than one paragraph is in the fixture, adjust the fixture — the assertion (one docked toolbar) is the requirement.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
git add src/app/document-editor.tsx src/app/document-editor.test.tsx
git commit -m "feat(documents): edit-mode block list orchestrator"
```

---

## Task 12: mount it in the panel

The panel gets a mode toggle and a mount, **nothing else**. It is at 796 of 800 lines.

**Files:**
- Modify: `src/app/documents-panel.tsx`, `src/app/documents-panel.test.tsx`

- [ ] **Step 1: Measure the headroom first**

```bash
node -e "console.log('before:', require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"
```

Expected: 796. **You have four lines.** If the change below does not fit, extract something out of the panel in the same commit — do not re-baseline the gate.

- [ ] **Step 2: Write the failing test**

Append to `src/app/documents-panel.test.tsx`, inside the top-level `describe`:

```tsx
  it("toggles between preview and the block editor", async () => {
    renderPanel({ documents: [sampleDoc] });
    await userEvent.click(screen.getByText(sampleDoc.title));

    // Preview is the default.
    expect(screen.queryByRole("textbox", { name: /Heading text/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: t("en-US", "documentsEditBlocks") }));
    expect(await screen.findByRole("button", { name: t("en-US", "documentsPreview") })).toBeInTheDocument();
  });
```

Use whatever the file's existing render helper and fixture are named — `renderPanel` and `sampleDoc` here stand for them. Find them with:
`grep -nE "function renderPanel|const sampleDoc|function setup" src/app/documents-panel.test.tsx | head`

The fixture must contain at least one `heading` block for the assertion above; if the existing one does not, give the test its own document rather than changing the shared fixture.

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run src/app/documents-panel.test.tsx --reporter=dot > /tmp/t12.log 2>&1; echo "EXIT=$?"; grep -E "Tests |FAIL" /tmp/t12.log
```

Expected: FAIL — no such button.

- [ ] **Step 4: Implement**

In `src/app/documents-panel.tsx`, add the import beside the other document imports:

```tsx
import { DocumentEditor, NARROW_PANE_QUERY } from "./document-editor";
import { useDocumentEditor } from "./use-document-editor";
import { useMediaQuery } from "./use-media-query";
```

Add the mode state and the narrow-pane match beside the panel's other `useState` calls:

```tsx
  const [editing, setEditing] = useState(false);
  // ★ The swap hinges on a media query, never on a measured width: jsdom has
  //  no layout, so a width-driven branch would be untestable. The editor takes
  //  the RESULT as a prop, which is what makes its own test injectable.
  const narrowPane = useMediaQuery(NARROW_PANE_QUERY);
```

Wire the commit handler beside the existing `mutate` helper:

```tsx
  const { commitBlock } = useDocumentEditor({
    documentId: selected?.id ?? -1,
    versions: documentVersions,
    mutateDocuments,
  });
```

Replace the `<DocumentPreview lang={lang} doc={selected} ws={ws} />` line with:

```tsx
        {editing && !isReadOnly ? (
          <DocumentEditor
            lang={lang}
            doc={selected}
            onCommitBlock={commitBlock}
            narrow={narrowPane}
          />
        ) : (
          <DocumentPreview lang={lang} doc={selected} ws={ws} />
        )}
```

And add the toggle button to the panel's toolbar, **before** the trailing Print / reset-columns / reset-pane-size group — that group must stay contiguous and last:

```tsx
        <button
          type="button"
          className="rounded-md border border-line px-2 py-1 text-xs"
          onClick={() => setEditing((v) => !v)}
        >
          {t(lang, editing ? "documentsPreview" : "documentsEditBlocks")}
        </button>
```

If `documentVersions` and `mutateDocuments` are not already in scope in the panel, they arrive the same way `mutateDocuments` already does — check the panel's props type and thread them explicitly rather than reaching for a context.

- [ ] **Step 5: Run the panel tests and check the size gate**

```bash
npx vitest run src/app/documents-panel.test.tsx --reporter=dot > /tmp/t12.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t12.log
node -e "console.log('after:', require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"
npm run size:check > /tmp/size.log 2>&1; echo "SIZE_EXIT=$?"; tail -3 /tmp/size.log
```

Expected: tests EXIT=0 and `SIZE_EXIT=0`. If the size gate fails, extract from the panel — never re-baseline.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
git add src/app/documents-panel.tsx src/app/documents-panel.test.tsx
git commit -m "feat(documents): edit-mode toggle in the documents panel"
```

---

## Task 13: version-budget property test

Proves the thing the coalescing rule exists for: an editing session cannot evict the document's history.

**Files:**
- Create: `src/app/document-editor-commit.property.test.ts`

- [ ] **Step 1: Write the test**

Create `src/app/document-editor-commit.property.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { applyDocMutation } from "./document-mutations";
import { shouldCoalesce } from "./document-editor-commit";
import { MAX_VERSIONS_PER_DOC } from "./document-versions";
import type { ProjectDocument } from "./document-model";
import type { DocVersion } from "./document-versions";

const START = Date.parse("2026-08-18T10:00:00.000Z");

describe("version budget under a hand-editing session", () => {
  it("keeps the pre-session before-image and never exceeds the per-document cap", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (edits) => {
        let documents: readonly ProjectDocument[] = [
          {
            id: 1,
            title: "D",
            blocks: [{ type: "paragraph", html: "<p>original</p>" }],
            createdAt: "2026-08-18T09:00:00.000Z",
            updatedAt: "2026-08-18T09:00:00.000Z",
          },
        ];
        let versions: readonly DocVersion[] = [];
        let nextVersionId = 1;

        for (let i = 0; i < edits; i++) {
          // Each edit lands 10s after the previous one — one continuous session.
          const now = new Date(START + i * 10_000).toISOString();
          const coalesce = shouldCoalesce(versions, 1, now);
          const result = applyDocMutation(
            { documents, versions },
            {
              kind: "ops",
              id: 1,
              ops: [{ op: "replace", index: 0, block: { type: "paragraph", html: `<p>edit ${i}</p>` } }],
              coalesce,
            },
            {
              now,
              source: "user",
              mintDocId: () => 99,
              mintVersionId: () => nextVersionId++,
            },
          );
          documents = result.documents;
          versions = result.versions;
        }

        const mine = versions.filter((v) => v.documentId === 1);
        // The cap is never breached...
        expect(mine.length).toBeLessThanOrEqual(MAX_VERSIONS_PER_DOC);
        // ...and the session's FIRST before-image — the pre-session state, the
        // thing worth reverting to — is still reachable however long the
        // session ran.
        expect(mine.some((v) => v.blocks[0] && "html" in v.blocks[0] && v.blocks[0].html === "<p>original</p>")).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/app/document-editor-commit.property.test.ts --reporter=dot > /tmp/t13.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t13.log
```

Expected: EXIT=0.

- [ ] **Step 3: Prove the property can fail**

A property that cannot fail proves nothing. Force `coalesce` off and confirm the pre-session image is evicted:

```bash
node -e "
const f='src/app/document-editor-commit.property.test.ts';const fs=require('fs');
fs.writeFileSync(f, fs.readFileSync(f,'utf8').replace('const coalesce = shouldCoalesce(versions, 1, now);','const coalesce = false;'),'utf8');"
npx vitest run src/app/document-editor-commit.property.test.ts --reporter=dot > /tmp/t13m.log 2>&1; echo "MUTANT_EXIT=$?"
git checkout src/app/document-editor-commit.property.test.ts 2>/dev/null || node -e "
const f='src/app/document-editor-commit.property.test.ts';const fs=require('fs');
fs.writeFileSync(f, fs.readFileSync(f,'utf8').replace('const coalesce = false;','const coalesce = shouldCoalesce(versions, 1, now);'),'utf8');"
npx vitest run src/app/document-editor-commit.property.test.ts --reporter=dot > /tmp/t13r.log 2>&1; echo "RESTORED_EXIT=$?"
```

Expected: `MUTANT_EXIT=1` (with a counterexample at some edit count above the cap), then `RESTORED_EXIT=0`. **If the mutant survives, the property is vacuous** — most likely the edit count never exceeds `MAX_VERSIONS_PER_DOC`; raise the generator's upper bound and re-run.

- [ ] **Step 4: Commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/document-editor-commit.property.test.ts
git commit -m "test(documents): version-budget property for hand-editing sessions"
```

---

## Task 14: full local gate run

**Files:** none — verification only.

- [ ] **Step 1: Run the fast gates, unpiped**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
npm run size:check > /tmp/g-size.log 2>&1; echo "SIZE=$?"; tail -2 /tmp/g-size.log
npm run dup:check > /tmp/g-dup.log 2>&1; echo "DUP=$?"; tail -2 /tmp/g-dup.log
npm run docs:symbols:check > /tmp/g-sym.log 2>&1; echo "SYM=$?"; tail -2 /tmp/g-sym.log
npm run docs:claims:check > /tmp/g-claims.log 2>&1; echo "CLAIMS=$?"; tail -2 /tmp/g-claims.log
```

Expected: every one 0.

- [ ] **Step 2: Run the touched test files together**

```bash
npx vitest run \
  src/app/document-editor-commit.test.ts \
  src/app/document-editor-commit.property.test.ts \
  src/app/document-block-editors.test.tsx \
  src/app/document-editor.test.tsx \
  src/app/document-mutations.test.ts \
  src/app/documents-panel.test.tsx \
  src/app/document-preview.test.tsx \
  src/app/i18n-encoding.test.ts \
  --reporter=dot > /tmp/g-tests.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/g-tests.log
```

Expected: EXIT=0.

★ If you see `Test Files no tests` plus `[vitest-pool]: Failed to start forks worker`, that is a **fork-pool collapse**, not N real failures — re-run, and add `--maxWorkers=4` if it recurs.

★ `document-preview.test.tsx` is in this list deliberately: the preview is not being changed, so it must stay green **unedited**. If it goes red, you changed something you should not have.

- [ ] **Step 3: Report what was NOT run**

The full suite, the shuffled run, coverage floors, e2e, axe and prod-smoke are **not** run locally — the suite does not finish inside the available window on this machine. State this plainly when handing off; CI is the first thing to see them, and `document-editor-commit.ts` is a new coverage-gated engine.

---

## Notes for whoever ships this

- **Do not bump the version or write a CHANGELOG entry** unless the user says "release". That word means push → MR → poll → merge-on-green, and nothing merges before the pipeline is green.
- Eight places carry the version and no gate checks any of them. That is release work, not this slice's.
- The a11y gate scans the Documents view, but only in whatever state the e2e seed produces — edit mode is likely never entered. **The unit tests in Tasks 5–9 are the only detector for duplicate accessible names**, at any seed size.
- Register entries for anything knowingly left open go in `docs/open-followups.md`, numbered from the current max. Get it with:
  `grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1`
