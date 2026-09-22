# JSON project import, multi-attachment chat, demo refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a project from a native workspace JSON, send several attachments to Claude in one go (with caps and drag-and-drop), and ship a demo/sample that is current and never goes stale.

**Architecture:** Pure i18n-free modules carry every rule (`chat-attachments.ts` caps, `native-workspace-import.ts`, `shift-workspace-dates.ts`, `demo-workspace.ts`); React surfaces (`chat-panel.tsx`, `step0-import-panel.tsx`, `create-project-wizard.tsx`, `task-manager.tsx`) only wire them. The import seeds the ONE existing create builder (`buildNewProjectWorkspace`) so the file and Turso create paths both inherit it.

**Tech Stack:** Next.js (repo-pinned), React, TypeScript, vitest + Testing Library (jsdom), fast-check not needed.

**Spec:** `docs/superpowers/specs/2026-09-18-json-import-multi-attach-demo-refresh-design.md`

## Global Constraints

- Worktree `C:/Projects/aipm-wt-b`, branch `feat/json-import-multi-attach-demo-refresh`. Never touch `C:/Projects/aipm-wt-a` or the main checkout.
- NO full test suite. Per task run only: the touched test files with `npx vitest run <files> --maxWorkers=1 --reporter=dot`, `npx tsc --noEmit`, `npx eslint --max-warnings=0 src`. Never two vitest runs at once. Never read an exit code through a pipe: `cmd > "$LOG" 2>&1; echo "EXIT=$?"`. A tsc pass means **0 errors in total** — a syntax error under `.next/` disables semantic checks, so "0 errors in src/" is not a pass. vitest: assert the `Test Files N` line equals the number of paths you passed (a missing path is dropped at exit 0).
- No hand-rolled UI controls. Use `Button`, `FilePickerButton`, existing primitives. No new visual drop overlay.
- `src/app/*.ts(x)` are CRLF in the working tree: edit with the Edit tool only, never `sed -i`, never Write over an existing file. `docs/**`, `CHANGELOG.md`, `*.json` at repo root are LF.
- **Never Edit or Write `src/app/i18n.de.ts`.** Patch it with a node script doing a utf8 read/replace/write whose anchors use `\r\n`; re-read the changed lines afterwards and confirm real umlauts (ä ö ü ß) and straight ASCII double quotes survived.
- i18n: EN (`i18n.ts`) and DE key sets must stay identical (tsc enforces). Placeholders are 0-based `{0}`/`{1}`; call as `t(lang, key, a, b)`. Tests use `lang="en-US"`.
- `jsonToWorkspace` needs a DOM; vitest's environment is already `jsdom`.
- Commits: explicit paths only, `git commit --only <paths> -F <msgfile>`; never `git add -A`/`.`; never `--amend`; never `npm ci`. Conventional-commit subject. Body ends with the session trailer. Register entries are cited as §N; never write `Closes #NN` in a commit.
- Size ratchet LIMIT 1600 (`scripts/check-file-sizes.mjs`); the gate counts `wc -l`+1. `chat-panel.tsx` is 1399, `create-project-wizard.tsx` 473, `step0-import-panel.tsx` 459 — keep new logic in the pure modules.
- Every new guard is mutation-proved before its task is reported done: break the guard, watch the named test go red, restore, confirm `git diff --stat` shows only intended files. Report each mutant by name.
- Constants (verbatim): `MAX_CHAT_ATTACHMENTS = 10`; `MAX_STAGED_PAYLOAD_BYTES = 30 * 1024 * 1024`; `DEMO_AS_OF = "2026-09-18"`.

---

### Task 1: `.json` is a text attachment

**Files:**
- Modify: `src/app/chat-attachments.ts` (`TEXT_EXTENSIONS`, `ACCEPT_MIMES`, `classifyAttachment` MIME branch)
- Test: `src/app/chat-attachments.test.ts` (exists — append)

**Interfaces:**
- Produces: `classifyAttachment("application/json", x) === "text"`, `classifyAttachment("", "a.json") === "text"`, `ATTACHMENT_ACCEPT` contains `.json` and `application/json`.

- [ ] **Step 1: Write the failing test** — append to `src/app/chat-attachments.test.ts`:

```ts
describe("JSON attachments", () => {
  it("classifies a .json file as text by extension", () => {
    expect(classifyAttachment("", "sample-workspace-small.json")).toBe("text");
  });
  it("classifies application/json as text by MIME", () => {
    expect(classifyAttachment("application/json", "noext")).toBe("text");
  });
  it("offers .json in the shared picker accept list", () => {
    const parts = ATTACHMENT_ACCEPT.split(",");
    expect(parts).toContain(".json");
    expect(parts).toContain("application/json");
  });
});
```

(Import `ATTACHMENT_ACCEPT` / `classifyAttachment` at the top if the file does not already.)

- [ ] **Step 2: Run it — expect 3 failures**

Run: `npx vitest run src/app/chat-attachments.test.ts --maxWorkers=1 --reporter=dot > "$T/t1.log" 2>&1; echo "EXIT=$?"` → `EXIT=1`.

- [ ] **Step 3: Implement**

```ts
export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([".txt", ".md", ".markdown", ".csv", ".vtt", ".json"]);
```
Add `"application/json",` to `ACCEPT_MIMES` after `"text/vtt",`, and extend the MIME text branch:
```ts
    mime === "text/vtt" ||
    mime === "application/json"
```
Update the `chatAttachmentHint` EN copy only in Task 3 (copy lives there).

- [ ] **Step 4: Run — expect pass**, then `npx tsc --noEmit`, eslint. Mutants: drop `".json"` from the set (extension test red); drop the MIME clause (MIME test red).

- [ ] **Step 5: Commit** `feat(attachments): accept .json as a text attachment` — paths: the two files.

---

### Task 2: Pure staging caps

**Files:**
- Modify: `src/app/chat-attachments.ts` (append)
- Test: `src/app/chat-attachments.test.ts` (append)

**Interfaces:**
- Produces:
```ts
export const MAX_CHAT_ATTACHMENTS = 10;
export const MAX_STAGED_PAYLOAD_BYTES = 30 * 1024 * 1024;
export function blocksPayloadBytes(blocks: readonly AttachmentBlock[]): number;
export type StagingCandidate = { name: string; blocks: readonly AttachmentBlock[] };
export type StagingRejection = { name: string; reason: "too-many" | "over-budget" };
export function planStaging(
  stagedCount: number,
  stagedBytes: number,
  candidates: readonly StagingCandidate[],
): { accepted: StagingCandidate[]; rejected: StagingRejection[] };
```

- [ ] **Step 1: Failing tests**

```ts
const textBlock = (n: number): AttachmentBlock => ({
  type: "document",
  source: { type: "text", media_type: "text/plain", data: "x".repeat(n) },
});
const imgBlock = (n: number): AttachmentBlock => ({
  type: "image",
  source: { type: "base64", media_type: "image/png", data: "A".repeat(n) },
});

describe("blocksPayloadBytes", () => {
  it("sums the data length of every block, text and base64 alike", () => {
    expect(blocksPayloadBytes([textBlock(3), imgBlock(5)])).toBe(8);
  });
  it("is 0 for no blocks", () => {
    expect(blocksPayloadBytes([])).toBe(0);
  });
});

describe("planStaging", () => {
  const c = (name: string, bytes: number): StagingCandidate => ({ name, blocks: [textBlock(bytes)] });

  it("accepts up to the count cap, counting what is already staged", () => {
    const cands = Array.from({ length: 5 }, (_, i) => c(`f${i}`, 1));
    const r = planStaging(MAX_CHAT_ATTACHMENTS - 2, 0, cands);
    expect(r.accepted.map((a) => a.name)).toEqual(["f0", "f1"]);
    expect(r.rejected).toEqual([
      { name: "f2", reason: "too-many" },
      { name: "f3", reason: "too-many" },
      { name: "f4", reason: "too-many" },
    ]);
  });

  it("rejects a file that would push the payload over the cap but keeps later ones that fit", () => {
    const r = planStaging(0, MAX_STAGED_PAYLOAD_BYTES - 10, [c("big", 11), c("small", 10)]);
    expect(r.accepted.map((a) => a.name)).toEqual(["small"]);
    expect(r.rejected).toEqual([{ name: "big", reason: "over-budget" }]);
  });

  it("accepts a file that lands exactly on the cap", () => {
    const r = planStaging(0, MAX_STAGED_PAYLOAD_BYTES - 10, [c("exact", 10)]);
    expect(r.accepted.map((a) => a.name)).toEqual(["exact"]);
  });

  it("does not count an over-budget rejection toward the count cap", () => {
    const r = planStaging(MAX_CHAT_ATTACHMENTS - 1, MAX_STAGED_PAYLOAD_BYTES, [c("big", 1), c("ok", 0)]);
    expect(r.accepted.map((a) => a.name)).toEqual(["ok"]);
    expect(r.rejected).toEqual([{ name: "big", reason: "over-budget" }]);
  });
});
```

- [ ] **Step 2: Run — expect failures (not exported).**

- [ ] **Step 3: Implement** (append to `chat-attachments.ts`):

```ts
/** Per-message attachment cap in the AI Assistant. Mirrors the wizard's
 *  `MAX_IMPORT_FILES` so the two multi-file surfaces agree. */
export const MAX_CHAT_ATTACHMENTS = 10;

/** Cap on the staged blocks' combined payload. Measured on what is SENT
 *  (base64 data or extracted text), not raw file bytes — an office/mail file
 *  arrives as extracted text. The Messages API rejects a body over 32 MB (413);
 *  30 MB leaves room for the prompt, system and history. Earlier turns'
 *  attachments re-sent in history are NOT counted here. */
export const MAX_STAGED_PAYLOAD_BYTES = 30 * 1024 * 1024;

export function blocksPayloadBytes(blocks: readonly AttachmentBlock[]): number {
  let total = 0;
  for (const b of blocks) total += b.source.data.length;
  return total;
}

export type StagingCandidate = { name: string; blocks: readonly AttachmentBlock[] };
export type StagingRejection = { name: string; reason: "too-many" | "over-budget" };

/** Decide which newly read files can join the already-staged set. Order is
 *  preserved; a file over budget is skipped without blocking later, smaller ones. */
export function planStaging(
  stagedCount: number,
  stagedBytes: number,
  candidates: readonly StagingCandidate[],
): { accepted: StagingCandidate[]; rejected: StagingRejection[] } {
  const accepted: StagingCandidate[] = [];
  const rejected: StagingRejection[] = [];
  let count = stagedCount;
  let bytes = stagedBytes;
  for (const cand of candidates) {
    if (count >= MAX_CHAT_ATTACHMENTS) {
      rejected.push({ name: cand.name, reason: "too-many" });
      continue;
    }
    const size = blocksPayloadBytes(cand.blocks);
    if (bytes + size > MAX_STAGED_PAYLOAD_BYTES) {
      rejected.push({ name: cand.name, reason: "over-budget" });
      continue;
    }
    accepted.push(cand);
    count += 1;
    bytes += size;
  }
  return { accepted, rejected };
}
```

- [ ] **Step 4: Run — pass.** tsc, eslint. Mutants: `>=` → `>` on the count (first test red); `>` → `>=` on bytes (exact-cap test red); move `count += 1` before the budget check (last test red).

- [ ] **Step 5: Commit** `feat(attachments): pure count and payload caps for staged chat attachments`.

---

### Task 3: Chat panel — caps, drag-and-drop, copy

**Files:**
- Modify: `src/app/chat-panel.tsx` (`handleFiles`, outer container `<div ref={chatRef} …>`)
- Modify: `src/app/i18n.ts`; `src/app/i18n.de.ts` (node script only)
- Test: `src/app/chat-panel.test.tsx` (append inside `describe("Attachment guidance")`, reuse `renderComposer`)

**Interfaces:**
- Consumes: Task 2 `planStaging`, `blocksPayloadBytes`, `MAX_CHAT_ATTACHMENTS`, `MAX_STAGED_PAYLOAD_BYTES`; Task 1 json classification.

- [ ] **Step 1: i18n keys.** EN (`i18n.ts`), replace/add:

```ts
  chatAttach: "Attach documents",
  chatAttachmentTooMany: "{0} was not attached — at most {1} attachments per message",
  chatAttachmentOverBudget: "{0} was not attached — attachments are limited to {1} MB per message",
```
and set `chatAttachmentHint` to:
```ts
    "Attach or drop one or more files: PDF, image (PNG/JPG/GIF/WebP), text (TXT/MD/CSV/VTT/JSON), web page (HTML), Office (DOCX/XLSX/PPTX) or mail (EML/MSG/MHTML) — up to 20 MB each, 64 MB for mail, 10 files and 30 MB per message.",
```
DE via a node utf8 script (anchors on the existing lines, `\r\n`):
```ts
  chatAttach: "Dokumente anhängen",
  chatAttachmentTooMany: "{0} wurde nicht angehängt — höchstens {1} Anhänge pro Nachricht",
  chatAttachmentOverBudget: "{0} wurde nicht angehängt — Anhänge sind auf {1} MB pro Nachricht begrenzt",
  chatAttachmentHint:
    "Eine oder mehrere Dateien anhängen oder hineinziehen: PDF, Bild (PNG/JPG/GIF/WebP), Text (TXT/MD/CSV/VTT/JSON), Webseite (HTML), Office (DOCX/XLSX/PPTX) oder E-Mail (EML/MSG/MHTML) — je bis zu 20 MB, E-Mails bis zu 64 MB, 10 Dateien und 30 MB pro Nachricht.",
```
The existing test `shows the accepted-types + size hint up front` matches `/Attach PDF, image.*up to 20 MB/i` — it will fail on the new copy; update its regex to `/Attach or drop one or more files.*up to 20 MB/i` in this task (it pins the hint, whose wording this task owns).

- [ ] **Step 2: Failing tests** (append; `File`, `fireEvent`, `screen`, `waitFor` already imported in this file — verify):

```ts
  function pick(container: HTMLElement, files: File[]) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files } });
  }
  const txt = (name: string, body = "hello") => new File([body], name, { type: "text/plain" });

  it("stages every valid file from one pick as its own chip", async () => {
    const { container } = renderComposer();
    pick(container, [txt("a.txt"), txt("b.md"), new File(["{}"], "c.json", { type: "application/json" })]);
    for (const n of ["a.txt", "b.md", "c.json"]) {
      expect(await screen.findByRole("button", { name: `Remove ${n}` })).toBeInTheDocument();
    }
  });

  it("stages at most 10 and names every file past the cap", async () => {
    const { container } = renderComposer();
    pick(container, Array.from({ length: 12 }, (_, i) => txt(`f${i}.txt`)));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("f10.txt");
    expect(alert.textContent).toContain("f11.txt");
    expect(alert.textContent).not.toContain("f9.txt");
    expect(screen.getAllByRole("button", { name: /^Remove f\d+\.txt$/ })).toHaveLength(10);
  });

  it("counts already-staged files toward the cap across two picks", async () => {
    const { container } = renderComposer();
    pick(container, Array.from({ length: 9 }, (_, i) => txt(`a${i}.txt`)));
    await screen.findByRole("button", { name: "Remove a8.txt" });
    pick(container, [txt("b0.txt"), txt("b1.txt")]);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("b1.txt");
    expect(screen.getByRole("button", { name: "Remove b0.txt" })).toBeInTheDocument();
  });

  it("stages dropped files exactly like picked ones", async () => {
    const { container } = renderComposer();
    const target = container.firstElementChild as HTMLElement;
    fireEvent.drop(target, { dataTransfer: { files: [txt("dropped.txt")] } });
    expect(await screen.findByRole("button", { name: "Remove dropped.txt" })).toBeInTheDocument();
  });
```
Before writing the chip assertion, READ how a staged chip's remove button is named (`chatAttachmentRemove: "Remove {0}"`) and adjust the query to the real rendered name. For the over-budget path add a unit-level assertion only through Task 2 (a 30 MB fixture in jsdom is slow); do NOT add a 30 MB UI test.

- [ ] **Step 3: Run — expect the new tests to fail** (no cap, no drop).

- [ ] **Step 4: Implement** in `handleFiles` — read every file first, then plan:

```ts
  async function handleFiles(files: FileList | readonly File[] | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const read: StagingCandidate[] = [];
    const summaries = new Map<string, string | null>();
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      const result = await ingestFile(file);
      if (!result.ok) {
        errors.push(attachmentErrorText(result.error, file.name));
        continue;
      }
      summaries.set(file.name, buildAttachmentSummary(lang, file.name, result.node));
      read.push({ name: file.name, blocks: flattenIngestBlocks(result.node) });
    }
    const current = attachmentsRef.current;
    const { accepted, rejected } = planStaging(
      current.length,
      blocksPayloadBytes(current.flatMap((a) => a.blocks)),
      read,
    );
    for (const r of rejected) {
      errors.push(
        r.reason === "too-many"
          ? t(lang, "chatAttachmentTooMany", r.name, MAX_CHAT_ATTACHMENTS)
          : t(lang, "chatAttachmentOverBudget", r.name, MAX_STAGED_PAYLOAD_BYTES / (1024 * 1024)),
      );
    }
    const staged: StagedAttachment[] = accepted.map((a) => ({
      id: `att-${(attachSeqRef.current += 1)}`,
      name: a.name,
      blocks: [...a.blocks],
      summary: summaries.get(a.name) ?? null,
    }));
    if (staged.length > 0) setAttachments((prev) => [...prev, ...staged]);
    if (errors.length > 0) setError(errors.join("\n"));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
```
`attachmentsRef`: `handleFiles` is async, so the closure's `attachments` can be stale across two quick picks. Add `const attachmentsRef = useRef(attachments); attachmentsRef.current = attachments;` next to the `attachments` state ONLY if no such ref exists; the render-time assignment is the repo's existing live-ref idiom (grep `Ref.current = ` in this file first and match it). If react-hooks lint rejects a render-time ref write, instead keep the count/bytes inside the functional `setAttachments(prev => …)` updater and compute errors from its result — decide by running eslint, and note the choice in the report.

Two files with the same name: `summaries` is keyed by name; if two picked files share a name the second summary wins. Acceptable (same file name ⇒ same summary text shape); note in the report.

Drop target — the OUTER container (`<div ref={chatRef} className={CHAT_PANE_CLASS}>`):
```tsx
    <div
      ref={chatRef}
      className={CHAT_PANE_CLASS}
      onDragOver={(e) => {
        if (attachDisabled) return;
        e.preventDefault();
      }}
      onDrop={(e) => {
        if (attachDisabled) return;
        e.preventDefault();
        void handleFiles(Array.from(e.dataTransfer.files));
      }}
    >
```
with `const attachDisabled = busy || apiKeyMissing || guidesPending;` hoisted above the return and reused by the paperclip `disabled`. Add one test: with the composer busy/AI off the drop stages nothing — use the existing test helpers for an API-key-missing render if one exists (grep `apiKeyMissing` / `AI_WITHOUT_KEY` in the test file); if none exists, skip this test and say so.

- [ ] **Step 5: Run the chat-panel + chat-attachments tests, tsc, eslint.** Mutants: remove the `rejected` error push (cap test red); pass `0` instead of `current.length` (two-pick test red); remove `onDrop` (drop test red).

- [ ] **Step 6: Commit** `feat(chat): cap and drag-and-drop for multi-file attachments` — paths: `chat-panel.tsx`, `chat-panel.test.tsx`, `i18n.ts`, `i18n.de.ts`.

---

### Task 4: Native workspace detection + seeded create

**Files:**
- Create: `src/app/native-workspace-import.ts`, `src/app/native-workspace-import.test.ts`
- Modify: `src/app/new-project-workspace.ts`, `src/app/new-project-workspace.test.ts`
- Modify: `src/app/use-storage-file-ops.ts` (`createProject` unsafe-email notice), `src/app/use-storage-turso-ops.ts` (same notice, if it has one — read it)

**Interfaces:**
- Produces:
```ts
export type NativeWorkspaceResult =
  | { kind: "workspace"; workspace: Workspace }
  | { kind: "not-workspace" }
  | { kind: "invalid"; reason: "parse" | "shape" };
export function parseNativeWorkspace(text: string): NativeWorkspaceResult;
export function isJsonFile(file: { name: string; type: string }): boolean;
// NewProjectOpts gains:
  importedWorkspace?: Workspace;
```

- [ ] **Step 1: Failing tests** — `native-workspace-import.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isJsonFile, parseNativeWorkspace } from "./native-workspace-import";

const sample = readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8");

describe("parseNativeWorkspace", () => {
  it("recognises the repo sample as a workspace", () => {
    const r = parseNativeWorkspace(sample);
    expect(r.kind).toBe("workspace");
    if (r.kind === "workspace") expect(r.workspace.tasks.length).toBeGreaterThan(0);
  });
  it("calls arbitrary JSON not-a-workspace (it goes to Claude)", () => {
    expect(parseNativeWorkspace('{"invoice": 42}').kind).toBe("not-workspace");
    expect(parseNativeWorkspace("[1,2,3]").kind).toBe("not-workspace");
  });
  it("calls unparseable text invalid", () => {
    expect(parseNativeWorkspace("{not json")).toEqual({ kind: "invalid", reason: "parse" });
  });
  it("calls a workspace-shaped object with a broken slice invalid", () => {
    expect(parseNativeWorkspace('{"tasks": [], "raid": 7}')).toEqual({ kind: "invalid", reason: "shape" });
  });
});

describe("isJsonFile", () => {
  it("matches by extension or MIME", () => {
    expect(isJsonFile({ name: "a.JSON", type: "" })).toBe(true);
    expect(isJsonFile({ name: "noext", type: "application/json" })).toBe(true);
    expect(isJsonFile({ name: "a.txt", type: "text/plain" })).toBe(false);
  });
});
```

`new-project-workspace.test.ts` — append:
```ts
  it("seeds from an imported workspace, with the wizard's meta winning", () => {
    const imported = { ...emptyWorkspace(), tasks: [makeTask({ id: 7 })], project: { ...META, name: "From file" } };
    const ws = buildNewProjectWorkspace({ ...META, name: "Typed name" }, { importedWorkspace: imported });
    expect(ws.tasks.map((t) => t.id)).toEqual([7]);
    expect(ws.project?.name).toBe("Typed name");
  });
  it("ignores template, AI seed and features when a workspace is imported", () => {
    const imported = { ...emptyWorkspace(), features: ["raid"] as const };
    const ws = buildNewProjectWorkspace(META, {
      importedWorkspace: imported, features: [], aiSeed: { tasks: [] }, includeSeed: true,
    });
    expect(ws.features).toEqual(["raid"]);
  });
```
Use the file's existing `META` / task factory helpers (read the file first and adapt names — do not invent `makeTask` if a different factory exists).

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement** `native-workspace-import.ts`:

```ts
// Pure, i18n-free: decide whether a JSON text is this app's native workspace.
// Uses the SAME strict decoder as "Load project from file", so the two paths
// cannot disagree on what a valid workspace file is.
import { jsonToWorkspace, WorkspaceParseError, type Workspace } from "./workspace";

export type NativeWorkspaceResult =
  | { kind: "workspace"; workspace: Workspace }
  | { kind: "not-workspace" }
  | { kind: "invalid"; reason: "parse" | "shape" };

/** Our shape = a JSON object that carries BOTH `tasks` and `raid` keys (the
 *  pair `jsonToWorkspace` requires). Any other JSON is a document for Claude. */
function looksLikeWorkspace(parsed: unknown): boolean {
  return !!parsed && typeof parsed === "object" && !Array.isArray(parsed)
    && "tasks" in parsed && "raid" in parsed;
}

export function parseNativeWorkspace(text: string): NativeWorkspaceResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "invalid", reason: "parse" };
  }
  if (!looksLikeWorkspace(parsed)) return { kind: "not-workspace" };
  try {
    return { kind: "workspace", workspace: jsonToWorkspace(text, { strict: true }) };
  } catch (err) {
    return { kind: "invalid", reason: err instanceof WorkspaceParseError ? err.reason : "shape" };
  }
}

export function isJsonFile(file: { name: string; type: string }): boolean {
  return file.name.toLowerCase().endsWith(".json") || file.type.trim().toLowerCase() === "application/json";
}
```
Confirm `WorkspaceParseError` is exported from `./workspace` (it is declared `export class` there); if `jsonToWorkspace` is only re-exported via `./storage`, import from `./workspace` anyway — it is defined there.

Note the deliberate ruling: unparseable text is `invalid`, not `not-workspace` — a `.json` that is not JSON is a broken file, and sending it to Claude as a "proposal" would hide that.

`new-project-workspace.ts` — add to `NewProjectOpts`:
```ts
  /** A native workspace the user imported in the create wizard. When set it IS
   *  the new project's content: template, AI seed and features are ignored, and
   *  only the wizard's `meta` replaces the file's own project meta. */
  importedWorkspace?: Workspace;
```
and at the top of `buildNewProjectWorkspace`:
```ts
  if (opts.importedWorkspace) return { ...opts.importedWorkspace, project: meta };
```
`aiSeedUnsafeEmails` stays as is (it already returns null without `aiSeed`).

`use-storage-file-ops.ts` `createProject` — the notice line becomes:
```ts
      const seededEmails = opts.template || opts.importedWorkspace ? summarizeUnsafeEmailRecords(ws) : aiSeedUnsafeEmails(opts);
```
Read `use-storage-turso-ops.ts` around its `buildNewProjectWorkspace` call and apply the identical change if it carries the same notice; if it carries none, add none and say so.

Mint state: `createProject` calls `resetMintState()` before building. Read `id-mint-session.ts` and confirm the next minted ids are derived from the applied workspace (as they must already be for the AI-seed path, which also creates non-empty content after a reset). If they are NOT, stop and report — do not guess a fix.

- [ ] **Step 4: Run both test files, tsc, eslint.** Mutants: drop the `"raid" in parsed` conjunct (arbitrary-JSON test still green? — then add `'{"tasks": []}'` → not-workspace to the test and re-run); remove the `importedWorkspace` early return (seed test red); drop `|| opts.importedWorkspace` — no unit test reaches it; say so in the report rather than claiming it pinned.

- [ ] **Step 5: Commit** `feat(projects): create a project from a native workspace JSON (builder + detector)`.

---

### Task 5: Wizard — import from Step 0 and Step 1

**Files:**
- Modify: `src/app/project-form.tsx` (export `draftFromMeta`)
- Modify: `src/app/step0-import-panel.tsx` (new prop `onImportWorkspace`, JSON routing in `onFile`)
- Modify: `src/app/create-project-wizard.tsx` (state, Step 1 import control + notice, `handleDetails` shortcut)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (node script)
- Test: `src/app/create-project-wizard.test.tsx`, `src/app/step0-import-panel.test.tsx` (append)

**Interfaces:**
- Consumes: Task 4 `parseNativeWorkspace`, `isJsonFile`, `NewProjectOpts.importedWorkspace`.
- Produces: `Step0ImportPanelProps.onImportWorkspace: (ws: Workspace, fileName: string) => void`.

- [ ] **Step 1: i18n.** EN:
```ts
  wizardImportWorkspaceButton: "Import workspace file…",
  wizardImportWorkspaceNotice: "Importing {0}: {1} tasks, {2} RAID items, {3} budgets",
  wizardImportWorkspaceClear: "Clear imported workspace {0}",
  wizardImportWorkspaceInvalid: "{0} looks like a workspace file but could not be read.",
  wizardImportWorkspaceNotWorkspace: "{0} is not a workspace file.",
  wizardImportWorkspaceIgnored: "A workspace file is imported on its own — ignored: {0}",
```
DE (node script):
```ts
  wizardImportWorkspaceButton: "Workspace-Datei importieren…",
  wizardImportWorkspaceNotice: "Import von {0}: {1} Aufgaben, {2} RAID-Einträge, {3} Budgets",
  wizardImportWorkspaceClear: "Importierten Workspace {0} entfernen",
  wizardImportWorkspaceInvalid: "{0} sieht wie eine Workspace-Datei aus, konnte aber nicht gelesen werden.",
  wizardImportWorkspaceNotWorkspace: "{0} ist keine Workspace-Datei.",
  wizardImportWorkspaceIgnored: "Eine Workspace-Datei wird allein importiert — ignoriert: {0}",
```

- [ ] **Step 2: Failing tests.** `create-project-wizard.test.tsx` (use the file's `setup`):

```ts
  const sampleText = readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8");

  it("imports a workspace file from Step 1 and creates the project with its content", async () => {
    const { onCreate } = setup();
    const input = screen.getByRole("button", { name: "Import workspace file…" })
      .parentElement!.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([sampleText], "sample.json", { type: "application/json" })] } });
    expect(await screen.findByText(/Importing sample\.json: \d+ tasks/)).toBeInTheDocument();
    // submit Step 1 with its pre-filled name
    fireEvent.click(screen.getByRole("button", { name: /next|create/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const opts = onCreate.mock.calls[0][2];
    expect(opts.importedWorkspace?.tasks.length).toBeGreaterThan(0);
  });

  it("rejects a JSON that is not a workspace, and creates nothing", async () => {
    const { onCreate } = setup();
    const input = screen.getByRole("button", { name: "Import workspace file…" })
      .parentElement!.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['{"a":1}'], "x.json", { type: "application/json" })] } });
    expect(await screen.findByText("x.json is not a workspace file.")).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });
```
READ the Step 1 form's real submit button label and the FilePickerButton DOM (it renders `<Button>` and a sibling `<input>`) before finalising the two queries; adjust to what renders. Also verify the pre-filled name equals the sample's `project.name`.

`step0-import-panel.test.tsx` (use the file's existing render helper):
```ts
  it("routes a native workspace JSON to onImportWorkspace without a model call", async () => {
    const onIngest = vi.fn();
    const onImportWorkspace = vi.fn();
    renderPanel({ onIngest, onImportWorkspace });
    pickFiles([new File([sampleText], "sample.json", { type: "application/json" })]);
    await waitFor(() => expect(onImportWorkspace).toHaveBeenCalledTimes(1));
    expect(onImportWorkspace.mock.calls[0][1]).toBe("sample.json");
    expect(onIngest).not.toHaveBeenCalled();
  });
  it("sends a non-workspace JSON to Claude like any document", async () => {
    const onIngest = vi.fn().mockResolvedValue(undefined);
    const onImportWorkspace = vi.fn();
    renderPanel({ onIngest, onImportWorkspace });
    pickFiles([new File(['{"invoice":1}'], "inv.json", { type: "application/json" })]);
    await waitFor(() => expect(onIngest).toHaveBeenCalledTimes(1));
    expect(onImportWorkspace).not.toHaveBeenCalled();
  });
```
Adapt `renderPanel` / `pickFiles` to the helpers the file already has (read the "reads multiple valid files into one ingest call" test and copy its shape).

- [ ] **Step 3: Run — fail.**

- [ ] **Step 4: Implement.**

`project-form.tsx`: change `function draftFromMeta` to `export function draftFromMeta` (no other change).

`step0-import-panel.tsx`: add the prop `onImportWorkspace: (ws: Workspace, fileName: string) => void;` (doc: "A native workspace JSON bypasses the model: the wizard imports it."). At the top of `onFile`, after `onResetAi();`, before the loop:
```ts
    const jsonFiles = files.filter(isJsonFile);
    for (const jf of jsonFiles) {
      const parsed = parseNativeWorkspace(await jf.text());
      if (parsed.kind === "workspace") {
        const others = files.filter((f) => f !== jf).map((f) => f.name);
        if (others.length > 0) setImportError(t(lang, "wizardImportWorkspaceIgnored", others.join(", ")));
        onImportWorkspace(parsed.workspace, jf.name);
        return;
      }
      if (parsed.kind === "invalid") {
        setImportError(t(lang, "wizardImportWorkspaceInvalid", jf.name));
        return;
      }
    }
```
(`not-workspace` falls through to the existing ingest loop, where Task 1 made `.json` a text attachment.) Keep `importError` rendering unchanged. `setImportError` for the "ignored" note is shown on Step 0 which unmounts when the wizard advances — so ALSO pass the ignored list to the wizard: change the prop to `onImportWorkspace(ws, fileName, ignored: string[])` and let the wizard show it in its Step 1 notice. Update the test's call-arg assertion accordingly.

`create-project-wizard.tsx`:
- State: `const [imported, setImported] = useState<{ ws: Workspace; fileName: string; ignored: string[] } | null>(null);` and `const [importMsg, setImportMsg] = useState<string | null>(null);`
- `const acceptImport = (ws: Workspace, fileName: string, ignored: string[] = []) => { setImported({ ws, fileName, ignored }); setImportMsg(null); if (ws.project) setDraftPatch(draftFromMeta(ws.project)); setStep(1); };`
- Step 1 file handler:
```ts
  const onWorkspaceFile = async (file: File) => {
    const parsed = parseNativeWorkspace(await file.text());
    if (parsed.kind === "workspace") return acceptImport(parsed.workspace, file.name);
    setImportMsg(t(lang, parsed.kind === "invalid" ? "wizardImportWorkspaceInvalid" : "wizardImportWorkspaceNotWorkspace", file.name));
  };
```
- `step1FooterLeft` keeps the Back button and adds the picker (wrap both in a fragment/`div className="flex items-center gap-2"`):
```tsx
  <FilePickerButton
    label={t(lang, "wizardImportWorkspaceButton")}
    accept="application/json,.json"
    onFile={(f) => { void onWorkspaceFile(f); }}
  />
```
Render it for every Step 1 (not only when AI is enabled) — this is the key-free route. `step1FooterLeft` is currently `undefined` when AI is off; change it to always render the picker.
- Above the Step 1 form: when `imported` is set, a one-line muted notice `t(lang, "wizardImportWorkspaceNotice", imported.fileName, ws.tasks.length, ws.raid.length, ws.budgets?.length ?? 0)`, the ignored list (if any) via `wizardImportWorkspaceIgnored`, and a `Button variant="ghost" size="sm"` whose `aria-label` is `t(lang, "wizardImportWorkspaceClear", imported.fileName)` and visible text `✕` (aria-hidden span) that calls `setImported(null)`. When `importMsg` is set, render it with `role="alert"`. Use the same muted-text classes the wizard already uses for notices (grep the file / step0's skipped notice and copy them — do not invent colours).
- `handleDetails`: when `imported` is set, skip the template/functions steps:
```ts
    if (imported) {
      onCreate(m, fmt, { importedWorkspace: imported.ws, storage: sto });
      return;
    }
```
- Pass `onImportWorkspace={acceptImport}` to `<Step0ImportPanel>`.

- [ ] **Step 5: Run wizard + step0 tests, tsc, eslint.** Check `create-project-wizard.tsx` line count stays < 1599. Mutants: drop the `if (imported)` shortcut (create test red — onCreate never called or called without importedWorkspace); make the Step 1 picker AI-only (a new test rendering with AI off must go red — add `it("offers the workspace import without an API key")` asserting the button exists under the setup's no-key default); remove the step0 JSON pre-loop (routing test red).

- [ ] **Step 6: a11y check** (the new control and the clear button need names): `npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 -g "<the view that hosts the create wizard>"` — find the view name in `e2e/a11y.spec.ts`; if the wizard is not in `A11Y_VIEWS`, say so and rely on the unit-level accessible-name assertions above.

- [ ] **Step 7: Commit** `feat(wizard): create a project from a workspace JSON in Step 0 or Step 1`.

---

### Task 6: `shiftWorkspaceDates` + `demoShiftFor`

**Files:**
- Create: `src/app/shift-workspace-dates.ts`, `src/app/shift-workspace-dates.test.ts`

**Interfaces:**
- Consumes: `periodKeyForDate`, `isoWeekParts` from `./resource-capacity`; `Workspace` from `./workspace`; `PlanGranularity` from `./types`.
- Produces:
```ts
export function demoShiftFor(asOf: string, today: string, granularity: PlanGranularity): number;
export function shiftWorkspaceDates(ws: Workspace, n: number): Workspace;
```

Rules (spec §4a), implemented by a GENERIC walk, not a field list, so a field added tomorrow is shifted without editing this module:
- A string value matching `^\d{4}-\d{2}-\d{2}$` is a date-only value: month unit → add `n` calendar months (day clamped to month length), then roll Sat/Sun forward to Monday; week unit → add `7n` days (no roll needed).
- A string matching `^\d{4}-\d{2}-\d{2}T` is a timestamp: shift its date part the same way but never roll; keep the rest of the string byte-identical.
- An object KEY matching `^\d{4}-\d{2}-\d{2}$` (a dated-actuals day key) shifts as a date-only value; keys colliding after the roll are SUMMED (values are numbers — if a colliding value is not a number, throw: that would be a structure this module does not understand).
- An object key matching `^\d{4}-\d{2}$` (month period) → `+n` months; `^\d{4}-W\d{2}$` (ISO week period) → Monday of that week `+7n` days → `periodKeyForDate(…, "week")`.
- Anything else is copied as is. Arrays and objects are rebuilt (never mutated). `n === 0` returns a deep-equal copy.
- Unit is `ws.plan.granularity`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonToWorkspace, type Workspace } from "./workspace";
import { demoShiftFor, shiftWorkspaceDates } from "./shift-workspace-dates";

const master = jsonToWorkspace(
  readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"),
  { strict: true },
);
const DATE = /^\d{4}-\d{2}-\d{2}/;

function collect(v: unknown, path: string, out: Map<string, string>) {
  if (Array.isArray(v)) { v.forEach((x, i) => collect(x, `${path}[${i}]`, out)); return; }
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) collect(x, `${path}.${DATE.test(k) ? "<key>" : k}`, out);
    return;
  }
  if (typeof v === "string" && DATE.test(v)) out.set(path, v);
}

describe("demoShiftFor", () => {
  it("counts whole calendar months for a month plan", () => {
    expect(demoShiftFor("2026-09-18", "2026-09-30", "month")).toBe(0);
    expect(demoShiftFor("2026-09-18", "2026-12-01", "month")).toBe(3);
    expect(demoShiftFor("2026-09-18", "2027-01-05", "month")).toBe(4);
  });
  it("counts whole ISO weeks for a week plan", () => {
    expect(demoShiftFor("2026-09-18", "2026-09-20", "week")).toBe(0); // same ISO week (Fri → Sun)
    expect(demoShiftFor("2026-09-18", "2026-09-21", "week")).toBe(1);
  });
});

describe("shiftWorkspaceDates", () => {
  it("is the identity for n = 0", () => {
    expect(shiftWorkspaceDates(master, 0)).toEqual(master);
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(master);
    shiftWorkspaceDates(master, 3);
    expect(JSON.stringify(master)).toBe(before);
  });

  it("moves EVERY date-bearing value in the master (discovery, not a field list)", () => {
    const before = new Map<string, string>();
    const after = new Map<string, string>();
    collect(master, "", before);
    collect(shiftWorkspaceDates(master, 3), "", after);
    expect(before.size).toBeGreaterThan(20); // anti-vacuity: the master carries dates
    const unmoved = [...before].filter(([p, v]) => after.get(p) === v).map(([p]) => p);
    expect(unmoved).toEqual([]);
  });

  it("adds months with day clamping and rolls a weekend date-only value to Monday", () => {
    const ws = { ...master, plan: { ...master.plan, granularity: "month" as const, startDate: "2026-01-31", endDate: "2026-03-07" } };
    const out = shiftWorkspaceDates(ws, 1);
    expect(out.plan.startDate).toBe("2026-03-02"); // 01-31 +1m → 02-28 (Sat) → Mon 03-02
    expect(out.plan.endDate).toBe("2026-04-07");   // Tue stays
  });

  it("shifts a timestamp's date part without rolling and keeps the time", () => {
    const ws = { ...master, status: { ...master.status, narrativeUpdatedAt: "2026-01-31T09:15:00.000Z" } } as Workspace;
    expect(shiftWorkspaceDates(ws, 1).status?.narrativeUpdatedAt).toBe("2026-02-28T09:15:00.000Z");
  });

  it("re-keys month periods and sums day keys that collide after the roll", () => {
    const bucket = {
      ...master.budgets![0],
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 10 }, actualHours: { "2026-05-30": 2, "2026-05-31": 3, "2026-06": 1 } }],
    };
    const ws = { ...master, plan: { ...master.plan, granularity: "month" as const }, budgets: [bucket] };
    const a = shiftWorkspaceDates(ws, 1).budgets![0].allocations[0];
    expect(a.budgetHours).toEqual({ "2026-07": 10 });
    // 05-30 (Sat) and 05-31 (Sun) +1m → 06-30 (Tue) and 06-30 (clamped from 06-31 → Tue): summed
    expect(a.actualHours).toEqual({ "2026-06-30": 5, "2026-07": 1 });
  });

  it("re-keys ISO week periods for a week plan", () => {
    const ws = {
      ...master,
      plan: { ...master.plan, granularity: "week" as const },
      budgets: [{ ...master.budgets![0], allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-W52": 4 }, actualHours: {} }] }],
    };
    expect(shiftWorkspaceDates(ws, 2).budgets![0].allocations[0].budgetHours).toEqual({ "2027-W02": 4 });
  });
});
```
Before relying on them, VERIFY the hand-computed expectations by running the implementation's helper on the inputs — in particular 2026-02-28's weekday, 2026-05-30/31, 2026-06-30, and that 2026-W52 +2 weeks is 2027-W02 (2026 has 53 ISO weeks? check with `isoWeekParts`; if 2026 has a W53 the expectation is `2027-W01` — fix the TEST to the truth and say so in the report). A wrong expectation discovered here is a test bug, not an implementation bug.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement** `shift-workspace-dates.ts`:

```ts
// Pure, i18n-free. Moves every date in a workspace by n plan periods — used to
// keep the demo project "live" relative to today. The walk is GENERIC (any
// date-shaped string value or key), so a field added later is shifted without
// touching this module; the discovery test in the .test file enforces that.
import { isoWeekParts, periodKeyForDate } from "./resource-capacity";
import type { PlanGranularity } from "./types";
import type { Workspace } from "./workspace";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})(T.*)$/;
const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const WEEK_KEY = /^(\d{4})-W(\d{2})$/;
const DAY_MS = 86_400_000;

function toUtc(iso: string): Date { return new Date(`${iso}T00:00:00Z`); }
function fromUtc(d: Date): string { return d.toISOString().slice(0, 10); }

function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12; // 0-based
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return fromUtc(new Date(Date.UTC(ny, nm, Math.min(d, last))));
}
function addDays(iso: string, days: number): string { return fromUtc(new Date(toUtc(iso).getTime() + days * DAY_MS)); }
function rollToWeekday(iso: string): string {
  const dow = toUtc(iso).getUTCDay(); // 0 Sun … 6 Sat
  return dow === 6 ? addDays(iso, 2) : dow === 0 ? addDays(iso, 1) : iso;
}
function mondayOf(iso: string): string {
  const dow = toUtc(iso).getUTCDay();
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}
/** Monday of ISO week `week` of ISO year `year` (week 1 holds Jan 4th). */
function isoWeekMonday(year: number, week: number): string {
  return addDays(mondayOf(`${year}-01-04`), (week - 1) * 7);
}

function shiftDate(iso: string, n: number, unit: PlanGranularity, roll: boolean): string {
  if (unit === "week") return addDays(iso, 7 * n);
  const moved = addMonths(iso, n);
  return roll ? rollToWeekday(moved) : moved;
}

function shiftKey(key: string, n: number, unit: PlanGranularity): string {
  if (DATE_ONLY.test(key)) return shiftDate(key, n, unit, true);
  const m = MONTH_KEY.exec(key);
  if (m) return addMonths(`${m[1]}-${m[2]}-01`, n).slice(0, 7);
  const w = WEEK_KEY.exec(key);
  if (w) return periodKeyForDate(addDays(isoWeekMonday(Number(w[1]), Number(w[2])), 7 * n), "week");
  return key;
}

function walk(v: unknown, n: number, unit: PlanGranularity): unknown {
  if (typeof v === "string") {
    if (DATE_ONLY.test(v)) return shiftDate(v, n, unit, true);
    const ts = TIMESTAMP.exec(v);
    return ts ? shiftDate(ts[1], n, unit, false) + ts[2] : v;
  }
  if (Array.isArray(v)) return v.map((x) => walk(x, n, unit));
  if (!v || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    const nk = shiftKey(k, n, unit);
    const nv = walk(x, n, unit);
    if (nk in out) {
      const prev = out[nk];
      if (typeof prev !== "number" || typeof nv !== "number") {
        throw new Error(`shiftWorkspaceDates: non-numeric collision on key ${nk}`);
      }
      out[nk] = prev + nv;
    } else {
      out[nk] = nv;
    }
  }
  return out;
}

export function shiftWorkspaceDates(ws: Workspace, n: number): Workspace {
  return walk(ws, n, ws.plan.granularity) as Workspace;
}

export function demoShiftFor(asOf: string, today: string, granularity: PlanGranularity): number {
  if (granularity === "week") {
    return Math.round((toUtc(mondayOf(today)).getTime() - toUtc(mondayOf(asOf)).getTime()) / (7 * DAY_MS));
  }
  const [ay, am] = asOf.split("-").map(Number);
  const [ty, tm] = today.split("-").map(Number);
  return (ty * 12 + tm) - (ay * 12 + am);
}
```
`isoWeekParts` import: only needed if you use it to verify; if unused, drop it (eslint). The `n === 0` path must still return a deep-equal copy — `addMonths(iso, 0)` returns the same date, but `rollToWeekday` would MOVE a weekend date on n = 0. Guard: `if (n === 0) return structuredClone(ws)` at the top of `shiftWorkspaceDates` (the identity test pins it — and a master date that already falls on a weekend is the case that makes this matter).

- [ ] **Step 4: Run — pass.** Mutants: remove the n=0 guard (identity test red IF the master has a weekend date — if it stays green, the guard is unpinned: add a weekend date-only fixture to the identity test); drop the collision sum (collision test red); drop `DATE_ONLY` key handling (collision test red); make timestamps roll (timestamp test red).

- [ ] **Step 5: Commit** `feat(demo): pure date shift for keeping the demo workspace current`.

---

### Task 7: Refresh the sample master + everything derived from it

This task is judgment-heavy authoring. Edit ONLY `sample-workspace-small.json` by hand (LF, 2-space JSON as today); regenerate everything else.

**Files:**
- Modify: `sample-workspace-small.json`
- Regenerate: `sample-workspace-big.json`, `sample-workspace-huge.json`, `src/app/__fixtures__/golden-workspace.csv`, `src/app/__fixtures__/golden-workspace.md`
- Modify: `src/app/sample-workspace-budget.test.ts`, `src/app/sample-workspace-stakeholders.test.ts`
- Create: `src/app/sample-workspace-coverage.test.ts`
- Check (modify only if falsified): `e2e/seed.ts`, `src/app/version-diff.test.ts`, `src/app/scale-workspace.ts` comments

- [ ] **Step 1: Write the coverage test FIRST** (it states the content contract and fails today):

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonToWorkspace } from "./workspace";
import { isDayKey } from "./actual-hours";

const raw = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"));
const ws = jsonToWorkspace(JSON.stringify(raw), { strict: true });
const AS_OF = "2026-09-18";

describe("sample master is current (as of DEMO_AS_OF)", () => {
  it("is mid-project on DEMO_AS_OF", () => {
    expect(ws.plan.startDate < AS_OF && AS_OF < ws.plan.endDate).toBe(true);
    const buckets = ws.budgets ?? [];
    expect(buckets.some((b) => b.endDate < AS_OF)).toBe(true);
    expect(buckets.some((b) => b.startDate <= AS_OF && AS_OF <= b.endDate)).toBe(true);
    expect(buckets.some((b) => b.startDate > AS_OF)).toBe(true);
  });

  it("exercises the budget features", () => {
    const b = ws.budgets ?? [];
    expect(ws.plan.budgetFollowsPlan).toBe(true);
    expect(ws.fxRates?.rates).toBeDefined();
    expect(ws.roles.every((r) => typeof r.order === "number")).toBe(true);
    expect(ws.roles.some((r) => r.rateBasis === "hour")).toBe(true);
    expect(b.filter((x) => x.type === "fixed").length).toBeGreaterThanOrEqual(2);
    expect(b.filter((x) => (x.disciplineAllocations?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(2);
    expect(b.filter((x) => x.rateOverrideInternal !== undefined).length).toBeGreaterThanOrEqual(2);
    expect(b.filter((x) => x.status === "closed").length).toBeGreaterThanOrEqual(2);
    expect(b.every((x) => typeof x.createdDate === "string")).toBe(true);
    const withDayActuals = b.filter((x) => x.allocations.some((a) => Object.keys(a.actualHours).some(isDayKey)));
    expect(withDayActuals.length).toBeGreaterThanOrEqual(3);
    const dayKeys = new Set(b.flatMap((x) => x.allocations.flatMap((a) => Object.keys(a.actualHours).filter(isDayKey))));
    expect(dayKeys.size).toBeGreaterThanOrEqual(15);
    expect([...dayKeys].every((k) => k <= AS_OF)).toBe(true);
  });

  it("seeds the previously empty slices", () => {
    expect(ws.activityLog?.length ?? 0).toBeGreaterThanOrEqual(10);
    expect(ws.insights?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(ws.knowledgeItems?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(ws.timelogLinks?.userLinks.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(ws.raid.filter((r) => (r.noteLog?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(6);
    expect((ws.changes ?? []).filter((c) => (c.noteLog?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(2);
  });

  it("leaves the deliberately-unseeded slices absent", () => {
    for (const k of ["documentAssets", "features", "fieldVisibility", "settingsOverrides", "budgetHistory"]) {
      expect(raw[k]).toBeUndefined();
    }
  });

  it("loses no record to the sanitizers (file count === decoded count, per slice)", () => {
    for (const k of ["tasks", "raid", "absences", "resources", "roles", "budgets", "milestones", "changes",
      "stakeholders", "activityLog", "insights", "knowledgeItems", "calendarEvents", "documents"] as const) {
      expect([k, ((ws as Record<string, unknown>)[k] as unknown[] | undefined)?.length ?? 0])
        .toEqual([k, (raw[k] as unknown[] | undefined)?.length ?? 0]);
    }
  });
});
```
Check the real names before relying on them: `isDayKey` in `./actual-hours` (the budget test imports it there), `BucketStatus` value for closed (read the type — it may not be `"closed"`), `BudgetType` value for fixed price, `RaidItem.noteLog` / `ChangeItem.noteLog` field names. Adjust the TEST to the real names; never change the product types.

- [ ] **Step 2: Run it — expect red.**

- [ ] **Step 3: Author the master.** Rules:
  - Re-date to mid-project on 2026-09-18: plan 2026-06-01 → 2026-12-18 (month granularity kept); project meta dates to match; tasks spread so some are done (completed before AS_OF), some overdue (due before AS_OF, open), some upcoming; RAID raised dates before AS_OF, targets on both sides; milestones before and after; absences/calendar events around AS_OF; buckets: ≥1 fully past (closed), ≥1 current, ≥1 future; budget/plan month keys re-keyed to the new months.
  - Keep EVERY existing id stable (tests, e2e seed and links depend on them). New records take ids above the current max per entity.
  - Budget additions per the coverage test. `fxRates`: `{ "base": "EUR", "date": "2026-09-17", "fetchedAt": "2026-09-17T16:00:00.000Z", "rates": { "USD": 1.1, "GBP": 0.85 } }` and one bucket in `USD`.
  - Dated actuals: working days only (no Sat/Sun), all ≤ AS_OF, over ≥3 buckets, so the forecast has a slope.
  - `activityLog`: ≥10 entries with ids/kinds/args that `sanitizeActivityEntry` accepts — READ `activity-log.ts` for valid `ActivityKind` values and arg shapes; timestamps ≤ AS_OF.
  - `insights`: ≥3, valid per `sanitizeInsights` (read `insights/insight.ts` + `sanitize-insights.ts` for valid `type`/`severity`/`status`).
  - `knowledgeItems`: ≥3 `url`-kind links (`linkKind: "url"`, `kind: "file"`), https URLs on example.com — NEVER a real company or person.
  - `timelogLinks`: userLinks for the resources carrying dated actuals, projectLinks mapping to buckets, `manual: true`.
  - Rich text in new noteLog entries: the same safe HTML subset existing entries use (copy their shape: `html` + plain `text`).
  - Names, emails: fictional, `example.com` only.
  - The sanitizer-count test is the arbiter: a record that disappears on decode is malformed — fix the record, not the test.

- [ ] **Step 4: Run the coverage test until green.**

- [ ] **Step 5: Regenerate derived files.**
  1. `npx vite-node scripts/generate-sample-workspace.ts > "$T/gen.log" 2>&1; echo "EXIT=$?"` → EXIT=0; read the summary counts.
  2. Goldens — write a throwaway script in the scratchpad (NOT in the repo) that installs jsdom globals exactly like `scripts/generate-sample-workspace.ts`, then `await import("<repo>/src/app/storage")`, loads the master with `jsonToWorkspace(text)` (NON-strict, matching `golden-workspace.test.ts`), and writes `workspaceToCsv(ws)` / `workspaceToMarkdown(ws)` to the two fixture paths with `writeFileSync(path, s, "utf8")` (no newline conversion; the fixtures are `-text` in `.gitattributes`). Run it with `npx vite-node`.
  3. `git diff --stat` must show exactly the master, big, huge, two goldens, and the test files — nothing else.

- [ ] **Step 6: Update content-pinned tests.** Rewrite the pinned values in `sample-workspace-budget.test.ts` and `sample-workspace-stakeholders.test.ts` by re-deriving each from the NEW file (print the actual values with a node one-liner, then decide whether each invariant the test states — no overbooking, chain order, RACI warnings — still holds by design; if an invariant is violated, fix the DATA, not the assertion). Then grep for other sample-coupled numbers: `grep -rn "sample-workspace" src e2e --include=*.ts --include=*.tsx` and read each hit; correct comments/counts the change falsified (`version-diff.test.ts`, `scale-workspace.ts`).

- [ ] **Step 7: Gates.** `npx vitest run src/app/sample-workspace-coverage.test.ts src/app/sample-workspace-budget.test.ts src/app/sample-workspace-stakeholders.test.ts src/app/golden-workspace.test.ts src/app/scale-workspace.test.ts src/app/shift-workspace-dates.test.ts src/app/native-workspace-import.test.ts --maxWorkers=1 --reporter=dot` (drop any path that does not exist and confirm `Test Files N` matches the count passed). `npx playwright test --list > "$T/pw.log" 2>&1; echo "EXIT=$?"` → 0 (proves `e2e/seed.ts` still loads the master). tsc, eslint.

- [ ] **Step 8: Commit** `chore(sample): bring the demo workspace current (budget, activity, insights, knowledge, timelog)` — body states the goldens were regenerated because their INPUT changed (the AGENTS.md rule), and lists every regenerated file.

---

### Task 8: Demo load shifts dates; docs

**Files:**
- Create: `src/app/demo-workspace.ts`, `src/app/demo-workspace.test.ts`
- Modify: `src/app/task-manager.tsx` (`loadDemo`)
- Modify: `docs/AGENTS/features.md` (the guided tour + demo section)

**Interfaces:**
- Consumes: Task 6 `shiftWorkspaceDates`, `demoShiftFor`.
- Produces:
```ts
export const DEMO_AS_OF = "2026-09-18";
export function buildDemoWorkspace(raw: unknown, today: string): Workspace;
```

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDemoWorkspace, DEMO_AS_OF } from "./demo-workspace";

const raw = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"));

describe("buildDemoWorkspace", () => {
  it("is unshifted on DEMO_AS_OF", () => {
    expect(buildDemoWorkspace(raw, DEMO_AS_OF).plan.startDate).toBe(raw.plan.startDate);
  });
  it("keeps today inside the plan window months later", () => {
    const today = "2027-03-10";
    const ws = buildDemoWorkspace(raw, today);
    expect(ws.plan.startDate < today && today < ws.plan.endDate).toBe(true);
  });
  it("rejects a corrupt master loudly (strict decode)", () => {
    expect(() => buildDemoWorkspace({ tasks: 1 }, DEMO_AS_OF)).toThrow();
  });
});
```

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement** `demo-workspace.ts`:

```ts
// Pure: the demo project = the sample master, dates moved so that "today" sits
// where DEMO_AS_OF sits in the authored file. The master is authored as of
// DEMO_AS_OF; update both together when re-authoring it.
import { jsonToWorkspace, type Workspace } from "./workspace";
import { demoShiftFor, shiftWorkspaceDates } from "./shift-workspace-dates";

export const DEMO_AS_OF = "2026-09-18";

export function buildDemoWorkspace(raw: unknown, today: string): Workspace {
  const ws = jsonToWorkspace(JSON.stringify(raw), { strict: true });
  return shiftWorkspaceDates(ws, demoShiftFor(DEMO_AS_OF, today, ws.plan.granularity));
}
```
`task-manager.tsx` `loadDemo` becomes:
```ts
      const mod = await import("../../sample-workspace-small.json");
      const today = new Date().toISOString().slice(0, 10); // callback context — lint-safe
      const ws = buildDemoWorkspace((mod as { default?: unknown }).default ?? mod, today);
      await createDemoProject(ws);
```
(Strict decode is a deliberate change: a corrupt bundled master now surfaces through the existing `tourDemoError` toast instead of creating an empty demo.) Remove the now-unused `jsonToWorkspace` import from task-manager only if nothing else there uses it (grep).

`docs/AGENTS/features.md`: in the guided tour + demo section add a short ★ bullet: the demo is `buildDemoWorkspace` (master + date shift so today sits where `DEMO_AS_OF` sits); re-authoring the master means updating `DEMO_AS_OF` in the same commit; `shiftWorkspaceDates` walks generically (any date-shaped value or key), weekend date-only values roll to Monday under a month plan, colliding day keys are summed; the golden fixtures pin the UNSHIFTED master. Then run `npm run docs:symbols:check > "$T/sym.log" 2>&1; echo "EXIT=$?"` → 0.

- [ ] **Step 4: Run the test, tsc, eslint; task-manager size unchanged in class (it is baselined at 6040).** Mutant: return `ws` unshifted (months-later test red).

- [ ] **Step 5: Commit** `feat(demo): load the demo with dates shifted to today`.

---

### Task 9: Record the two out-of-scope gaps — STOP for the user

Filing GitLab issues is outward-facing: **do not file.** Draft only.

- [ ] **Step 1:** Draft two register entries in the scratchpad (not in the repo): (a) "Load project from file throws in Firefox/Safari — no File System Access API" — cite `fs-access.ts` `pickOpenFileAny`, the `file-system-access-unsupported` error; (b) "Chat history re-sends earlier attachments, so a long thread can exceed the 32 MB request limit" — cite `chat-panel.tsx` `submitPrompt` and `MAX_STAGED_PAYLOAD_BYTES`. Each with a verifiable status line (a backticked command) per `followups:status:check`.
- [ ] **Step 2:** Report to the controller; the controller asks the user before any issue is filed or any § is reserved.

---

## Self-review (done at authoring time)

- Spec coverage: §1 → T1; §2 → T4, T5; §3 → T2, T3; §4a → T6, T8; §4b/4c/4d → T7; §5 → gates per task; §6 → T9. Spec signature `shiftWorkspaceDates(ws, n)` kept (unit derived from `ws.plan.granularity`). Spec's "`createProject` optional seed" is realised as `NewProjectOpts.importedWorkspace` through the shared builder — same effect, and it also covers the Turso create path the spec did not name.
- Ruling vs spec: Step 0 routes an unparseable `.json` to `invalid` (error) rather than to Claude — a broken file must not become a silent proposal.
- Types: `NativeWorkspaceResult`, `StagingCandidate`, `StagingRejection`, `planStaging`, `blocksPayloadBytes`, `DEMO_AS_OF`, `buildDemoWorkspace`, `onImportWorkspace(ws, fileName, ignored)` are used with the same names in every task.
