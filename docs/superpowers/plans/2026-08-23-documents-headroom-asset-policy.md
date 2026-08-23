# Documents headroom + asset mime policy — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buy back file-size headroom in the two documents surfaces sitting at the 800-line cap, replace seven hand-restated asset-mime allowlist casts with one shared predicate (giving the one consumer that checks nothing a check), and wire the version-history modal to resolve its images.

**Architecture:** Three sequential parts. Part 1 (Tasks 1–4) is a pure refactor extracting presentational leaves — it must land first, because Parts 2 and 3 add lines to files adjacent to the cap. Part 2 (Tasks 5–6) introduces `isAllowedAssetMime` and converts every call site, then adds the missing check in `attachAssetImages`. Part 3 (Tasks 7–8) memoizes the history modal's `dangerouslySetInnerHTML` object and only then attaches asset images to it. Tasks 9–10 update the register and stamp the release.

**Tech Stack:** Next.js 16.2.11 (exact-pinned), React 19, TypeScript, vitest 4.1.8, Playwright + axe-core 4.12.1, Tailwind v4.

---

## On the "PASTE verbatim" steps

Tasks 1–3 are **moves**, and their steps deliberately give the destination
scaffold plus an exact substitution list instead of reprinting the 60–185 lines
being moved. That is not a placeholder — it is the more precise instruction.
Re-typing those regions would silently rewrite the comment blocks travelling with
them, and those comments carry the reasoning (the implausibility heuristic, the
two-axis labelling rule, the row-unique-name construction) that no gate can
re-derive. **Cut and paste; do not retype.** The listed substitutions are the
only permitted edits, and `git diff` on the pair should show a clean move.

## Ground rules for every task

**These are not optional and every one of them has cost this repo real work.**

1. ★★★ **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` exits **0 while tests are failing** — that is `tail`'s status, and the pipe discards the diagnostic too. Always:
   ```bash
   npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
   ```
   Write `echo "EXIT=$?"` to a file **before** any pipe if you must pipe at all.

2. ★★★ **All four source files touched here are CRLF in the working tree.** A node patch script whose anchor is spelled with `\n` silently no-ops and reports success. Detect the EOL and match `\r\n`. Verify no bare LF was introduced:
   ```js
   const bare = (s.match(/(?<!\r)\n/g) || []).length;   // must be 0 for a CRLF file
   ```

3. ★★★ **`size:check` counts `readFileSync().split("\n").length`, i.e. `wc -l` + 1.** Budgeting from `wc -l` overstates your room by exactly one line. Read the real number with:
   ```bash
   node -e "console.log(require('fs').readFileSync(process.argv[1],'utf8').split('\n').length)" <file>
   ```

4. ★★ **eslint has NO `--max-warnings` gate in CI and `noUnusedLocals` is not set in tsconfig**, so an orphaned import from an extraction **ships green**. Every extraction task below names the exact imports that orphan — they were measured, not guessed. Delete them by hand and re-check both sides of every move.

5. **Never `git commit --amend`** (shared worktree — it has swallowed a stranger's commit). New commits only; scope with `git commit --only <paths>`.

6. **Never bare `git stash` / `git stash pop`** — the stash stack is shared across worktrees.

7. **Never run two vitest processes at once** — machine saturation is the load-sensitive-flake condition behind this repo's rare timeouts.

8. Every commit message ends with:
   ```
   Claude-Session: https://[session link removed]
   ```
   Commit via a Bash heredoc (`git commit -F -`), never a PowerShell here-string.

---

## File structure

**Created:**

| File | Responsibility |
|---|---|
| `src/app/documents-deleted-section.tsx` | Pure presentational: the deleted-versions `<section>` — implausibility warning, empty state, tombstone list with Restore buttons. No state. |
| `src/app/documents-rename-modal.tsx` | Pure presentational: the rename `Modal` and the `RENAME_TITLE_ID` const it solely owns. Draft value and every handler arrive as props. |
| `src/app/bullets-block-editor.tsx` | `BulletsBlockEditor` + the `BulletsDraft` type. Mirrors `document-table-editor.tsx` exactly. |
| `src/app/documents-deleted-section.test.tsx` | Row-unique naming + implausibility guard, which no gate can see. |
| `src/app/documents-rename-modal.test.tsx` | Enter-commits, composing-guard, empty-title drop. |

**Modified:**

| File | Change |
|---|---|
| `src/app/documents-panel.tsx` | 800 → ~700. Loses two JSX regions + four orphaned imports; gains two component imports. |
| `src/app/document-block-editors.tsx` | 800 → ~615. Loses `BulletsBlockEditor` + `BulletsDraft` + two orphaned imports. |
| `src/app/document-editor.tsx` | `BulletsBlockEditor` import moves to the new module. |
| `src/app/document-block-editors.test.tsx` | Same import move. |
| `src/app/document-asset-upload.ts` | Gains `isAllowedAssetMime`; its own cast becomes the helper body. |
| `src/app/doc-render-docx.ts`, `doc-render-html.ts`, `doc-render-pptx-slides.ts`, `document-download.ts`, `documents-asset-section.tsx` | Six casts → calls. |
| `src/app/document-asset-images.ts` | Declines a disallowed mime (behaviour change). |
| `src/app/documents-history-modal.tsx` | Memoized `bodyHtml`; optional asset bag; `attachAssetImages` effect. |
| `docs/open-followups.md` | §206 / §220 / §223 close; §225 opens; §217 gains a line. |

---

## Task 1: Extract the deleted-versions section

**Files:**
- Create: `src/app/documents-deleted-section.tsx`
- Create: `src/app/documents-deleted-section.test.tsx`
- Modify: `src/app/documents-panel.tsx`

**Scene:** `documents-panel.tsx` is at exactly 800 lines with no baseline entry, so it has zero headroom. This task moves the deleted-versions `<section>` out verbatim. It is a **pure move** — no behaviour change, no new strings.

★★★ **The `restoreRejected` paragraph immediately below the section does NOT move.** It sits deliberately *outside* the `showDeleted` block, and `documents-panel.test.tsx` mutation-proves that placement: moving it back inside reddens the modal-refusal case on its own. The history modal is opened from a row control and is independent of the show-deleted toggle, which is OFF by default — so a refusal raised there would set state that nothing renders.

- [ ] **Step 1: Read the exact region to move**

```bash
grep -n "showDeleted && (" src/app/documents-panel.tsx
```
The region runs from that line to its closing `)}`, immediately before the `{/* ★★★ OUTSIDE the \`showDeleted\` block` comment. Take everything between, including all four comment blocks — they carry the reasoning for the implausibility heuristic and the row-unique labelling, and they must travel with the code.

- [ ] **Step 2: Create the new component**

`src/app/documents-deleted-section.tsx`:

```tsx
// The deleted-documents list, extracted from documents-panel.tsx to buy back
// file-size headroom (open-followups §220 — that file sat at EXACTLY the
// 800-line cap with no baseline entry, so any net line failed the gate).
//
// PURE PRESENTATIONAL: data and handlers in as props, no state of its own.
//
// ★★ The `restoreRejected` notice deliberately did NOT come with it. It lives
// OUTSIDE the `showDeleted` block in the orchestrator because the history modal
// is an independent restore surface whose refusals must render with the toggle
// off. `documents-panel.test.tsx` mutation-proves that placement.
import { type Lang, t } from "./i18n";
import type { DocVersion } from "./document-versions";
import { Button } from "./button";

export interface DocumentsDeletedSectionProps {
  lang: Lang;
  /** Tombstone versions of deleted documents, newest first. */
  deleted: readonly DocVersion[];
  /** Count of LIVE documents — drives the implausibility heuristic only. */
  documentCount: number;
  isReadOnly?: boolean;
  onRestore: (versionId: number) => void;
}

export function DocumentsDeletedSection({
  lang, deleted, documentCount, isReadOnly, onRestore,
}: DocumentsDeletedSectionProps) {
  return (
    /* PASTE the <section>…</section> verbatim here, substituting:
         documents.length  ->  documentCount
         handleRestore     ->  onRestore
       Everything else, every comment included, is unchanged. */
  );
}
```

★ Substituting `documents.length` with a `documentCount` number rather than passing the whole array is deliberate: the section needs a count, not the documents, and taking the array would invite a future reader to render from it.

- [ ] **Step 3: Mount it in the orchestrator**

Replace the removed region with:

```tsx
        {showDeleted && (
          <DocumentsDeletedSection
            lang={lang}
            deleted={deleted}
            documentCount={documents.length}
            isReadOnly={isReadOnly}
            onRestore={handleRestore}
          />
        )}
```

Add `import { DocumentsDeletedSection } from "./documents-deleted-section";` beside the other panel imports.

- [ ] **Step 4: Delete the orphaned import — MEASURED, not guessed**

After this task alone, `Button` still has uses in `documents-panel.tsx` (the rename modal, removed in Task 2). Do **not** delete it yet. Confirm with:

```bash
grep -n "\bButton\b" src/app/documents-panel.tsx | grep -v "^[0-9]*:import"
```
Expected: the rename modal's two `<Button>` uses only. If it returns nothing, delete the import now.

- [ ] **Step 5: Write the test**

`src/app/documents-deleted-section.test.tsx`. Two properties, neither of which any gate can see — axe has **no rule** that flags two controls sharing an accessible name, in any view at any seed size:

```tsx
it("gives every Restore button a row-unique accessible name", () => {
  // Two tombstones sharing a title AND a timestamp — the measured real-data
  // collision: two mutations in one tick share `savedAt`, two successive `ops`
  // writes share a title. Only the version id cannot collide.
  render(
    <DocumentsDeletedSection
      lang="en-US"
      deleted={[version({ id: 1, title: "Plan", savedAt: "2026-08-01T09:00" }),
               version({ id: 2, title: "Plan", savedAt: "2026-08-01T09:00" })]}
      documentCount={5}
      onRestore={vi.fn()}
    />,
  );
  const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
  expect(new Set(names).size).toBe(names.length);
});

it("cautions when more documents are deleted than survive, and never hides a row", () => {
  render(
    <DocumentsDeletedSection
      lang="en-US"
      deleted={[version({ id: 1 }), version({ id: 2 }), version({ id: 3 })]}
      documentCount={1}
      onRestore={vi.fn()}
    />,
  );
  expect(screen.getByRole("status")).toBeInTheDocument();
  // Positive observable: the warning must not become a row cap. A user who
  // really did delete most of their documents must still be able to restore
  // them, so all three rows stay.
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
});
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run src/app/documents-deleted-section.test.tsx src/app/documents-panel.test.tsx > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t1.log
```
Expected: EXIT=0. `documents-panel.test.tsx` must pass **unchanged** — this is a pure move, so any edit needed there means behaviour changed and the move is wrong.

- [ ] **Step 7: Verify the mutation actually bites**

Change one `aria-label` in the new component to a bare `t(lang, "documentsRestore")` and re-run. The uniqueness test must go RED. Revert. A passing suite proves only that SOME assertion fired.

- [ ] **Step 8: tsc + eslint + size**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src/app/documents-panel.tsx src/app/documents-deleted-section.tsx; echo "EXIT=$?"
node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"
```

- [ ] **Step 9: Commit**

```bash
git add src/app/documents-deleted-section.tsx src/app/documents-deleted-section.test.tsx src/app/documents-panel.tsx
git commit --only src/app/documents-deleted-section.tsx src/app/documents-deleted-section.test.tsx src/app/documents-panel.tsx -F - <<'MSG'
refactor: extract the deleted-documents section from documents-panel

Pure move, no behaviour change. documents-panel.tsx sat at exactly 800
lines with no baseline entry (open-followups 220), so it had zero
headroom and any net line failed file-size-ratchet outright.

The restoreRejected notice deliberately stayed behind: it sits outside
the showDeleted block because the history modal is an independent restore
surface whose refusals must render with the toggle off, and
documents-panel.test.tsx mutation-proves that placement.

Adds the row-unique-name and implausibility-guard tests that axe cannot
provide -- no axe rule flags two controls sharing an accessible name, in
any view at any seed size.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 2: Extract the rename modal

**Files:**
- Create: `src/app/documents-rename-modal.tsx`
- Create: `src/app/documents-rename-modal.test.tsx`
- Modify: `src/app/documents-panel.tsx`

- [ ] **Step 1: Create the component**

Move the `{renaming && (<Modal …>…</Modal>)}` body and the module-level `RENAME_TITLE_ID` const. The component owns the id because it is its only consumer (`grep -n "RENAME_TITLE_ID" src/app/documents-panel.tsx` returns exactly the declaration plus two uses, both inside the modal).

```tsx
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";
import { Input } from "./form-controls";

const RENAME_TITLE_ID = "documents-rename-title";

export interface DocumentsRenameModalProps {
  lang: Lang;
  /** The in-flight title text. */
  draft: string;
  onDraftChange: (next: string) => void;
  onCancel: () => void;
  onCommit: () => void;
}

export function DocumentsRenameModal({
  lang, draft, onDraftChange, onCancel, onCommit,
}: DocumentsRenameModalProps) {
  /* PASTE the modal body verbatim, substituting:
       renaming.draft                          -> draft
       setRenaming((prev) => …e.target.value…) -> onDraftChange(e.target.value)
       setRenaming(null)                       -> onCancel
       commitRename                            -> onCommit
     Keep the visible <label> and the `isComposing` guard exactly as they are. */
}
```

★ The `onKeyDown` guard must stay `e.key === "Enter" && !e.nativeEvent.isComposing`. Dropping the composing check commits mid-IME-composition, which breaks Japanese/Chinese input and is invisible to every test written in Latin script.

★ The visible `<label>` IS the accessible name. A `placeholder` is not, and a placeholder-only input fails the axe gate while looking labeled.

- [ ] **Step 2: Mount it**

```tsx
      {renaming && (
        <DocumentsRenameModal
          lang={lang}
          draft={renaming.draft}
          onDraftChange={(next) =>
            setRenaming((prev) => (prev ? { ...prev, draft: next } : prev))}
          onCancel={() => setRenaming(null)}
          onCommit={commitRename}
        />
      )}
```

`commitRename`, `renaming` and `setRenaming` all stay in the orchestrator.

- [ ] **Step 3: Delete the four orphaned imports — MEASURED**

`Modal`, `ModalHeader`, `Input` and `Button` now have **zero** remaining uses in `documents-panel.tsx`. Verified on this branch's base by:

```bash
for id in Modal ModalHeader Input Button; do
  echo "--- $id:"; grep -n "\b$id\b" src/app/documents-panel.tsx | grep -v "^[0-9]*:import"
done
```
Expected after this task: all four print nothing. Delete all four import lines.

★★ eslint reports these at severity 1 and CI runs bare `npm run lint` with no `--max-warnings`, and `noUnusedLocals` is not in `tsconfig.json` — so leaving them **ships green**. This step is the only thing that catches them.

- [ ] **Step 4: Write the test**

```tsx
it("commits on Enter but not mid-IME-composition", async () => {
  const onCommit = vi.fn();
  render(<DocumentsRenameModal lang="en-US" draft="Plan" onDraftChange={vi.fn()}
                               onCancel={vi.fn()} onCommit={onCommit} />);
  const input = screen.getByLabelText(/title/i);
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(onCommit).not.toHaveBeenCalled();   // the guard
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onCommit).toHaveBeenCalledTimes(1); // positive observable
});
```

★★ The `isComposing: true` case is an **absence** assertion and is vacuous on its own — the second half is what makes it non-vacuous, because it proves the handler was wired at all. Without it, deleting the whole `onKeyDown` passes.

- [ ] **Step 5: Run, mutate, verify**

```bash
npx vitest run src/app/documents-rename-modal.test.tsx src/app/documents-panel.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t2.log
```
Then delete `&& !e.nativeEvent.isComposing` and confirm the test goes RED. Revert.

- [ ] **Step 6: tsc + eslint + size**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src/app/documents-panel.tsx src/app/documents-rename-modal.tsx; echo "EXIT=$?"
node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"
```
Expected: ~700, comfortably under 800.

- [ ] **Step 7: Commit**

```bash
git commit --only src/app/documents-rename-modal.tsx src/app/documents-rename-modal.test.tsx src/app/documents-panel.tsx -F - <<'MSG'
refactor: extract the rename modal from documents-panel

Pure move. Takes documents-panel.tsx clear of the 800-line cap it was
sitting exactly on (open-followups 220).

Also deletes four imports the move orphaned -- Modal, ModalHeader, Input
and Button now have zero remaining uses in that file. CI runs bare
`npm run lint` with no --max-warnings and tsconfig sets no
noUnusedLocals, so orphaned imports ship green; they were found by
grepping both sides of the move, not by a gate.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 3: Extract the bullets block editor

**Files:**
- Create: `src/app/bullets-block-editor.tsx`
- Modify: `src/app/document-block-editors.tsx`, `src/app/document-editor.tsx`, `src/app/document-block-editors.test.tsx`

**Scene:** `document-block-editors.tsx` is the *other* file at exactly 800 with no baseline entry.

★★★ **Do NOT re-export `BulletsBlockEditor` from `document-block-editors.tsx`.** The new file imports `useBlockDraft` and `BlockEditorProps` back from it, so a re-export makes the two modules import each other. This repo already hand-works-around one runtime import cycle (§92) and does not need a second bought for an import-line convenience.

★ **`document-table-editor.tsx` is exact precedent** — a sibling block editor already in its own file, importing `{ type BlockEditorProps, useBlockDraft } from "./document-block-editors"`, imported directly by `document-editor.tsx`. Mirror it.

- [ ] **Step 1: Move `BulletsDraft` + `BulletsBlockEditor` verbatim**

Locate with `grep -n "type BulletsDraft\|export function BulletsBlockEditor\|export function DataSectionBlockEditor" src/app/document-block-editors.tsx`. The region runs from the `BulletsDraft` type to just before `DataSectionBlockEditor`'s doc comment.

Carry the whole header comment — it documents the two-axis labelling rule (unique across sibling blocks AND across items within one block) that `document-table-editor.tsx` refers back to by name.

New file's imports, measured from the moved body:

```tsx
import { t } from "./i18n";
import type { DocBlock } from "./document-model";
import { type BlockEditorProps, useBlockDraft } from "./document-block-editors";
import { BlockRefusalNotice } from "./document-block-notices";
import { ToggleButton } from "./toggle-button";
import { Button } from "./button";
import { Input } from "./form-controls";
```

- [ ] **Step 2: Delete the two orphaned imports — MEASURED**

`ToggleButton` and `Button` now have **zero** remaining uses in `document-block-editors.tsx`. `Input` keeps one (`HeadingBlockEditor`) and `BlockReadOnlyNotice` keeps one — do not touch those. Verify:

```bash
for id in ToggleButton Button Input BlockReadOnlyNotice; do
  echo "--- $id:"; grep -n "\b$id\b" src/app/document-block-editors.tsx | grep -v "^[0-9]*:import"
done
```
Expected: `ToggleButton` and `Button` print nothing; `Input` prints one `<Input` in the heading editor; `BlockReadOnlyNotice` prints one use plus a comment mention.

- [ ] **Step 3: Move the two consumer imports**

```bash
grep -rn "BulletsBlockEditor" src/app --include=*.ts --include=*.tsx | grep -v "^src/app/bullets-block-editor.tsx:"
```
Two files import it: `document-editor.tsx` and `document-block-editors.test.tsx`. Remove `BulletsBlockEditor,` from each `from "./document-block-editors"` list and add `import { BulletsBlockEditor } from "./bullets-block-editor";`.

★ A third hit, in `document-table-editor.tsx`, is a **comment** referring to the header rule — not an import. Read the hits; do not count them.

- [ ] **Step 4: Run the suite**

```bash
npx vitest run src/app/document-block-editors.test.tsx src/app/document-editor.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t3.log
```
Expected: EXIT=0 with **no test edits beyond the import line**. This is a verbatim move.

★★ A missing test PATH makes vitest exit **0** while reporting "no tests". Confirm the log names both files and a non-zero test count — do not read EXIT=0 alone as proof the suite ran.

- [ ] **Step 5: tsc + eslint + size**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src/app/document-block-editors.tsx src/app/bullets-block-editor.tsx src/app/document-editor.tsx; echo "EXIT=$?"
node -e "console.log(require('fs').readFileSync('src/app/document-block-editors.tsx','utf8').split('\n').length)"
```
Expected: ~615.

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/bullets-block-editor.tsx src/app/document-block-editors.tsx src/app/document-editor.tsx src/app/document-block-editors.test.tsx -F - <<'MSG'
refactor: extract BulletsBlockEditor into its own module

document-block-editors.tsx was the second file sitting at exactly the
800-line cap with no baseline entry (open-followups 220). Mirrors
document-table-editor.tsx exactly: the editor lives in its own file and
imports useBlockDraft and BlockEditorProps one way, with consumers
importing it directly.

Deliberately NOT re-exported from document-block-editors.tsx. That would
make the two modules import each other, and this repo already
hand-works-around one runtime import cycle (open-followups 92).

Also drops ToggleButton and Button, which the move orphaned.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 4: Part 1 checkpoint — full gates

**Files:** none modified. This is a verification gate.

- [ ] **Step 1: Size ratchet**

```bash
npm run size:check; echo "EXIT=$?"
```
Expected: `file-size ratchet ok`, EXIT=0.

★★ **Do NOT run `node scripts/check-file-sizes.mjs --update`.** Re-baselining to admit growth is the exact failure this gate exists to prevent, and §220 says so explicitly.

- [ ] **Step 2: Full unit suite, unpiped**

```bash
npm run test:run > /tmp/full.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/full.log
```

- [ ] **Step 3: Shuffled suite at the CI seed**

```bash
npm run test:shuffle > /tmp/shuf.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuf.log
```
This is the ONLY local reproduction of the `unit-tests-shuffled` gate, and it is BLOCKING in CI. Three new test files landed, so run it.

- [ ] **Step 4: Coverage**

```bash
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"; tail -25 /tmp/cov.log
```
Expected: unchanged. All three new files are `.tsx`, which `vitest.config.ts` excludes wholesale — if coverage moved, something landed in a `.ts` file that should not have.

- [ ] **Step 5: Duplication**

```bash
npm run dup:check; echo "EXIT=$?"
```
★ The gate compares the TOTAL duplicated-**LINE** percentage across all formats against 1.75 — not per-format, not tokens. Extractions can move this in either direction; only the exit code matters.

- [ ] **Step 6: axe on Documents, serially**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Documents" --workers=1; echo "EXIT=$?"
```
★★★ `--workers=1` is mandatory. `playwright.config.ts` sets `workers: process.env.CI ? 1 : undefined`, so local runs go at CPU-count while CI runs serially — over-subscription produces `Test timeout of 60000ms exceeded` failures that name no rule and are **not violations**. Read the failure body, never the summary line.

★ Warm the route first if the server is cold; the 60s per-test timeout also covers the first navigation's Turbopack compile.

★★ A green run here is **silent on duplicate accessible names**. The Restore buttons' row-unique naming is covered by Task 1's unit test and by nothing else.

- [ ] **Step 7: No commit** — this task produces no diff. If any gate is red, fix it in a new commit before proceeding.

---

## Task 5: Introduce `isAllowedAssetMime` and convert every cast

**Files:**
- Modify: `src/app/document-asset-upload.ts` (helper + its own cast)
- Modify: `src/app/doc-render-docx.ts`, `doc-render-html.ts`, `doc-render-pptx-slides.ts`, `document-download.ts`, `documents-asset-section.tsx`
- Test: `src/app/document-asset-upload.test.ts` (or the nearest existing suite per consumer)

**Scene:** §223. The allowlist is hand-restated at every consumer with its own cast, and nothing makes the next consumer correct.

### ★★★ CORRECTIONS — a read-only pre-verification pass falsified part of this task before it was dispatched. Read these BEFORE the steps below; where they conflict, THESE win.

**C1. `CandidateResult` has SIX rejection reasons, not three.** This task's Step 1 test comment implied the union was `format` / `empty` / `tooLargeRaw`. The real type (`document-asset-upload.ts`, `UploadRejection`) is `"format" | "tooLargeRaw" | "tooLargeStored" | "dimensions" | "empty" | "decode"` — the last three come from the later decode/downscale stages. An exhaustive `switch` written from the old three will not compile; a non-exhaustive one silently mishandles three reasons.

**C2. THREE of the seven sites are ALREADY COVERED, and one of those tests is better than what this plan proposed to write.** Do NOT add a duplicate — that mistake was already made once in this slice (see the header of `documents-deleted-section.test.tsx`).
  - `assetPolicy`: `document-download.test.ts` "declines a mime outside the upload allowlist on the inline sinks" already drives `downloadDocument` for html AND pdf and invokes the predicate in BOTH directions. Its own comment explains why both directions are required: `() => false` passes the SVG case alone and `() => true` passes the allowed case alone, so only the pair kills both mutants. A single-direction test would be a REGRESSION in rigour.
  - `pptxEmbedFor`: `doc-render-pptx.test.ts` already asserts `canEmbedPptxAsset(sized({ mime: "image/svg+xml" }))` is false.
  - The extent asymmetry is pinned by `document-download.test.ts` too.

**C3. THE REAL COVERAGE HOLE IS THE MIRROR IMAGE OF WHAT THIS PLAN ASSUMED: `canEmbedDocxAsset` has NO direct test anywhere.** `grep -rn "canEmbedDocxAsset" src/app --include=*.test.ts` returns only comment mentions. Write THAT one. "Seven converted sites, seven assertions" was the wrong target — the right target is: every site ends the task with a test that observes it, whoever wrote it.

**C4. FOUR of the seven sites are not directly callable.** `assetSrcAttr` and `assetPolicy` are module-private and cannot be imported at all; `docxEmbedFor` / `pptxEmbedFor` are reachable only through `canEmbedDocxAsset` / `canEmbedPptxAsset`. Only `checkUploadCandidate` is directly exported. This plan flagged that for `assetPolicy` alone; it applies to four.

**C5. ★★★ THE TWO INTAKE FILTERS ARE DELIBERATELY ASYMMETRIC AND A TIDY-UP BREAKS ONE.** `handlePaste` filters FIRST and calls `preventDefault()` only if a file survived; `handleDrop` calls `preventDefault()` BEFORE filtering. That is correct in both cases — a paste of ordinary text must fall through to the default handler, a drop must not. Substitute the predicate expression INSIDE each `.filter(...)` and change nothing else. Any control-flow assertion must pin the ordering PER HANDLER.

**C6. The two sites' guards are not the same guard.** `assetPolicy` writes `mime !== undefined && includes(mime)`; `assetSrcAttr` opens `if (!data || !mime) return null;`, which also rejects `""`. The helper is behaviour-preserving at both (`""` is not a member either way), but do not describe them as one shape.

**C7. Two MORE hand-restatements of the allowlist exist that this sweep does not reach, and NEITHER is a defect to fix here.**
  - `mediaExtension` (`ooxml-media.ts`) is a literal mime→extension switch, consulted immediately after the allowlist test at BOTH OOXML sites. It cannot be absorbed by a boolean predicate. It is ALREADY DEFENDED: `ooxml-media.test.ts` "covers every mime the upload path admits" loops `ASSET_MIME_ALLOWED` asserting each maps to a non-null extension, with an explicit guard against a vacuous loop. Leave both alone.
  - `readHeaderDimensions` (`document-asset-upload.ts`) dispatches mime→parser by literal comparison. Lower blast radius (a new mime yields null dimensions → a `dimensions` rejection). Out of scope; record it, do not fix it.

**C8. Do not claim the OOXML predicate saves budget.** `assetPolicy`'s doc comment is an explicit correction of that exact false claim: the OOXML branch's budget is `Number.POSITIVE_INFINITY`, so the usual filter-first argument cannot apply to the two sinks that pass the predicate. It buys the three-bucket contract, not headroom. Re-committing that error in a comment or commit message is a documented regression.

**C9. `doc-render-html.ts` carries a ~55-line docstring above the mime check recording two previously-shipped defects at that exact spot, including a base64 alphabet regex that was wrong in both directions. It must travel UNTOUCHED — do not reflow it while editing the line below it.**


- [ ] **Step 1: Write the failing test first**

**Seven converted sites, seven assertions**, sized off the real split: one upload gate, four render/policy guards, two intake filters. They do NOT all fit one table — the four are reachable in three different shapes, `assetPolicy` is module-private and must be driven through its caller, and the two intake filters need a control-flow assertion rather than a return value. Write them as the groups below, and count to seven yourself at the end.

```ts
// `image/svg+xml` is the case that matters: `sanitizeDocumentAsset` is
// mime-GENERIC by contract and does NOT consult the allowlist, so an imported
// or hand-edited workspace really can carry this row.
const DISALLOWED = "image/svg+xml";

// Four of the five converted non-intake sites are directly reachable. Each
// returns its own refusal shape, so assert per row rather than through a shared
// `declined()` helper that would paper over the differences.
it("checkUploadCandidate refuses a disallowed mime by format", () => {
  // Real signature: (file: Pick<File, "type" | "size">) => CandidateResult
  expect(checkUploadCandidate({ type: DISALLOWED, size: 1024 }))
    .toEqual({ ok: false, reason: "format" });
});

it.each([
  ["docxEmbedFor",  () => docxEmbedFor(assetOf(DISALLOWED), bytes)],
  ["pptxEmbedFor",  () => pptxEmbedFor(assetOf(DISALLOWED), bytes)],
  ["assetSrcAttr",  () => assetSrcAttr(DISALLOWED, bytes)],
])("%s returns null for a mime the upload gate would refuse", (_n, run) => {
  expect(run()).toBeNull();
});
```

★★★ **`assetPolicy` is the fifth site and is NOT exported — do not write a test
that calls it directly.** Verified: `grep -n "^export" src/app/document-download.ts`
lists `DocFormat`, `MAX_FILENAME_STEM`, `documentFilename`, `withAutoPrint`,
`downloadDocument` and `reportDownloadFailure`, and none of them is it. Its real
signature is `assetPolicy(format: DocFormat, ws: Workspace): { budgetBytes:
number; isRenderable?: (id: string) => boolean }` — note the predicate is keyed
by asset **id**, not by mime, and it resolves the mime itself through a
`byId` map it builds from `ws.documentAssets`. An earlier draft of this plan
invented `assetPolicy("html").allows(mime)`; that API does not exist in any of
its three parts.

Reach it through its caller instead. Three suites already touch this area —
`document-export-assets.test.ts`, `document-download.test.ts` and
`doc-render-html.test.ts`. Put the case in whichever already builds a workspace
with `documentAssets`, and assert the html/pdf **budget** consequence, which is
the behaviour that branch exists for:

```ts
it("does not charge an unrenderable row against the html budget", async () => {
  // ★★ THIS IS THE POINT OF THE html/pdf BRANCH, and a bare "svg is omitted"
  // assertion misses it. HTML is the ONE sink where the budget can actually be
  // spent, so an unrenderable row COSTS something: its bytes are fetched,
  // charged against the 25 MB budget, push a GOOD image into `omitted`, and
  // then get dropped to a placeholder by `assetSrcAttr` anyway. Asking first is
  // what stops a row that can never be drawn from evicting one that can.
  const ws = workspaceWith([assetRow("svg1", DISALLOWED), assetRow("png1", "image/png")]);
  const out = await loadExportAssets(/* … html … */);
  expect(out.omitted).not.toContain("png1");
});
```

★ Read `assetPolicy`'s own doc comment before writing this — it records the
`Number.POSITIVE_INFINITY` budget for the OOXML branch and why those two sinks
are exempt from the charge this test is about.

The two intake filters need a **control-flow** assertion, not a return value:

```tsx
it("handlePaste does not preventDefault when no file survives the filter", () => {
  // ★★★ THIS IS NOT A STYLE POINT. handlePaste calls e.preventDefault() ONLY
  // when a file survived. Weakening the filter so a disallowed file "survives"
  // would make the editor swallow every ordinary TEXT paste.
  const e = pasteEventWith([fileOf(DISALLOWED)]);
  fireEvent(editor, e);
  expect(e.defaultPrevented).toBe(false);
  expect(uploadAndInsert).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it — expect RED on the sites that have no coverage yet**

```bash
npx vitest run src/app/document-asset-upload.test.ts > /tmp/t5.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t5.log
```

- [ ] **Step 3: Add the helper**

In `document-asset-upload.ts`, immediately below `ASSET_MIME_ALLOWED`:

```ts
/**
 * The single asset-mime policy predicate.
 *
 * ★★★ IT DOES NOT MAKE THE CHECK AUTOMATIC, and must not be sold as though it
 * did. A consumer that calls nothing is still wrong and no gate can see it: the
 * row is well-formed, the mime is a plausible string, and the only symptom is
 * whatever that sink does with bytes it should never have been handed. This
 * exists so the next consumer has something to FIND, and so the seven existing
 * spellings cannot drift apart. Only a test catches a consumer that forgets.
 *
 * ★★ Takes `string | undefined` because `assetPolicy` already had to write the
 * undefined guard by hand; folding it in here is what lets that site become a
 * bare call.
 */
export function isAllowedAssetMime(mime: string | undefined): boolean {
  return mime !== undefined && (ASSET_MIME_ALLOWED as readonly string[]).includes(mime);
}
```

- [ ] **Step 4: Convert all seven sites**

```bash
grep -rn "ASSET_MIME_ALLOWED as readonly string\[\]" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
```
Expected before: 7 hits across 6 files. After: **1** — the helper's own body.

- `checkUploadCandidate` → `if (!isAllowedAssetMime(file.type)) {`
- `docxEmbedFor` / `pptxEmbedFor` → `if (!isAllowedAssetMime(meta.mime)) return null;`
- `assetSrcAttr` → `if (!isAllowedAssetMime(mime)) return null;`
- `assetPolicy` html/pdf branch → `return isAllowedAssetMime(mime);` — the `mime !== undefined &&` prefix folds into the helper.
- `handlePaste` / `handleDrop` → replace the predicate inside each `.filter(...)` **only**. Preserve the early return and the `preventDefault` placement exactly; this is a substitution of one expression, not a rewrite.

★ `asset-library.tsx`'s `accept={ASSET_MIME_ALLOWED.join(",")}` is **untouched** — a genuine affordance, not a policy check.

★ **Do not fold in the extent check.** `canEmbedDocxAsset` / `canEmbedPptxAsset` also require recorded width and height; the html sink deliberately does not, because HTML places no box. One shared *mime* predicate is right; one shared "is this usable" predicate would re-introduce the asymmetry that comment exists to stop.

★ **Do not add a check to `sanitizeDocumentAsset`.** The record is mime-GENERIC by contract and its module header says so — narrowing it at the storage layer would make a stored row unreadable after the policy changed.

- [ ] **Step 5: Run — expect GREEN**

```bash
npx vitest run src/app/document-asset-upload.test.ts src/app/documents-asset-section.test.tsx src/app/doc-render-docx.test.ts src/app/doc-render-pptx.test.ts src/app/document-download.test.ts > /tmp/t5b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5b.log
```
★★ Confirm the log names every file with a non-zero count — a path that does not exist makes vitest exit **0** while reporting "no tests". Adjust paths to the suites that actually exist rather than assuming these names.

- [ ] **Step 6: Mutation check — REQUIRED**

Delete the `isAllowedAssetMime` call from **`docxEmbedFor`** and re-run. The table must go RED on that row and only that row. Revert. Repeat for one intake filter.

★★ A surviving mutant is a QUESTION, not a pass: "equivalent mutant" and "missing test" look identical from the harness. If a row survives, the test does not observe that site — fix the test, do not record it as covered.

- [ ] **Step 7: tsc + eslint, then commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src/app; echo "EXIT=$?"
```

```bash
git commit --only <the seven files + the test> -F - <<'MSG'
refactor: one shared predicate for the asset mime allowlist

Seven hand-written `(ASSET_MIME_ALLOWED as readonly string[]).includes`
casts across six files become calls to isAllowedAssetMime, exported
beside the constant (open-followups 223). The seventh becomes its body.

The helper takes `string | undefined` because assetPolicy already wrote
that guard by hand; folding it in lets that site become a bare call.

It does NOT make the check automatic and is not sold as though it did. A
consumer that calls nothing is still wrong and no gate can see it, so
this lands with a seven-row table -- one per converted site -- plus a
control-flow assertion for the two intake filters, which gate
uploadAndInsert and whose preventDefault placement decides whether the
editor swallows ordinary text pastes.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 6: `attachAssetImages` declines a disallowed mime

**Files:**
- Modify: `src/app/document-asset-images.ts`
- Test: `src/app/document-asset-images.test.ts`

**Scene:** This is the consumer **no search for the constant can find** — it reads the stored mime through `mimeFor` and builds a `Blob` carrying that type, with no allowlist and no cast. It is a **behaviour change**, not a refactor, and cannot ride Task 5's mechanical sweep.

- [ ] **Step 1: Write three failing tests**

```ts
it("declines a mime the upload gate would refuse, and discloses it", async () => {
  const el = subtreeWith("a1");
  await attachAssetImages(el, async () => B64_BYTES, () => "image/svg+xml");
  const img = el.querySelector("img")!;
  expect(img.getAttribute("data-asset-missing")).toBe("true");
  expect(img.hasAttribute("src")).toBe(false);
});

it("still resolves when no metadata row matched the id", async () => {
  // ★★★ CASE 2, AND IT IS THE POINT OF THE `mime !== undefined` GUARD.
  // `undefined` here means there is no mime to check, NOT a refused one.
  // Declining it would regress a case that renders correctly today via <img>
  // content sniffing. A later "simplification" to a bare
  // `!isAllowedAssetMime(mime)` reddens THIS test, which is why it exists.
  const el = subtreeWith("a1");
  await attachAssetImages(el, async () => B64_BYTES, () => undefined);
  const img = el.querySelector("img")!;
  expect(img.getAttribute("src")).toMatch(/^blob:/);
  expect(img.hasAttribute("data-asset-missing")).toBe(false);
});

it("still resolves when no mime lookup was supplied at all", async () => {
  // Case 1: the generic contract. Only one caller passes a lookup today.
  const el = subtreeWith("a1");
  await attachAssetImages(el, async () => B64_BYTES);
  expect(el.querySelector("img")!.getAttribute("src")).toMatch(/^blob:/);
});
```

- [ ] **Step 2: Run — expect the first RED, the other two GREEN**

```bash
npx vitest run src/app/document-asset-images.test.ts > /tmp/t6.log 2>&1; echo "EXIT=$?"; tail -25 /tmp/t6.log
```
Two already-green tests are the regression net for the change about to land — that is the intended shape here, not a mistake.

- [ ] **Step 3: Implement**

In `attachAssetImages`, immediately after the `mimeFor` lookup and **before** the `Blob` is built:

```ts
      const mime = mimeFor?.(id);
      // ★★★ DECLINE A MIME THE UPLOAD GATE WOULD HAVE REFUSED. An imported or
      // hand-edited workspace can carry one: `sanitizeDocumentAsset` is
      // mime-GENERIC by contract and deliberately does not consult the
      // allowlist, so the store admits anything and every consumer must decline
      // it. This one checked nothing, and no search for `ASSET_MIME_ALLOWED`
      // could find it — see open-followups §223.
      //
      // ★★★ `mime !== undefined` IS LOAD-BEARING, NOT DEFENSIVE PADDING.
      // Three cases reach here: no lookup supplied (the generic contract), a
      // lookup that MISSED (no metadata row for this id), and a lookup that hit
      // a disallowed mime. Only the third is a policy refusal. The first two
      // have no mime to check and fall through to the typeless Blob they always
      // built — declining them would regress a case that renders correctly
      // today via <img> content sniffing. The miss case is its own defect and
      // its own register entry (§225), not a silent fix inside a refactor.
      //
      // Returning here routes the element down the SAME `data-asset-missing`
      // path the dangling case uses, so the reader gets the disclosure rather
      // than a bare broken-image icon.
      if (mime !== undefined && !isAllowedAssetMime(mime)) return;
      const blob = mime ? new Blob([bytes], { type: mime }) : new Blob([bytes]);
```

Add `isAllowedAssetMime` to the existing `import { safeBase64ToBytes } from "./document-asset-upload";`.

- [ ] **Step 4: Run — expect all three GREEN**

- [ ] **Step 5: Mutation check — REQUIRED, both directions**

| Mutant | Expected |
|---|---|
| Delete the whole `if` line | test 1 RED |
| Weaken to `if (!isAllowedAssetMime(mime)) return;` | test 2 RED |

★★★ The second mutant is the one that matters. It is the plausible "simplification" a future reader will reach for, it typechecks, and without test 2 it ships green while silently declining every asset whose metadata row is missing. Run both and revert.

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/document-asset-images.ts src/app/document-asset-images.test.ts -F - <<'MSG'
fix: decline an asset mime the upload gate would have refused

attachAssetImages read the stored mime straight off the row and built a
Blob carrying it -- no allowlist, no cast, and so no hit for any search
that spells ASSET_MIME_ALLOWED. It was the consumer open-followups 223
predicted: the store is mime-generic by contract, so every consumer must
decline, and this one checked nothing.

A disallowed mime now routes down the same data-asset-missing disclosure
the dangling case uses, rather than a bare broken-image icon.

The `mime !== undefined` guard is load-bearing. A lookup that MISSED has
no mime to check and keeps today's typeless Blob -- declining it would
regress a case that renders correctly via <img> sniffing. That miss case
is open-followups 225, not a silent fix inside a refactor. Both branches
are mutation-proved.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 7: Memoize the history modal's `dangerouslySetInnerHTML` object

**Files:**
- Modify: `src/app/documents-history-modal.tsx`
- Test: `src/app/documents-history-modal.test.tsx`

**Scene:** This lands **before** Task 8 and as its own commit, so the memo is independently testable and mutation-provable. Wiring images first would make this a bug fix inside a feature commit, where it cannot be seen.

★★★ **React 19 diffs host props by `Object.is` and treats `dangerouslySetInnerHTML` like any other prop.** An inline `{{ __html: html }}` is a NEW object every render, so React re-assigns `innerHTML` — rebuilding the subtree — on EVERY re-render, byte-identical `html` or not. The effect added in Task 8 does NOT re-run, because its deps are unchanged, so every `src` and marker it wrote is gone for good. `document-preview.tsx` carries the measured account of this on its own `bodyHtml` memo. That defect already shipped once and was a showstopper; it is inert here today only because nothing attaches images yet.

- [ ] **Step 1: Write the failing test**

```tsx
it("does not rebuild the preview subtree on an unrelated re-render", () => {
  const { rerender } = render(<HistoryRowHarness version={v} lang="en-US" />);
  const before = screen.getByTestId("preview-body").firstChild;
  // Something changes that `html` does not depend on.
  rerender(<HistoryRowHarness version={v} lang="en-US" isReadOnly />);
  // Identity, not markup: a rebuilt subtree is byte-identical and only the
  // NODE tells you it was replaced. This is exactly how the shipped defect
  // hid -- every visible assertion passed.
  expect(screen.getByTestId("preview-body").firstChild).toBe(before);
});
```

★★ Assert on **node identity**, never on markup. The rebuilt subtree is byte-identical, so an `innerHTML` comparison passes under the defect.

- [ ] **Step 2: Run — expect RED**

- [ ] **Step 3: Implement**

```tsx
  // ★★★ MEMOIZED FOR ITS IDENTITY, NOT THE ALLOCATION. React 19 diffs host
  // props by `Object.is`, so an inline `{{ __html: html }}` is a new object
  // every render and React re-assigns this element's innerHTML -- rebuilding
  // the subtree -- on EVERY re-render, byte-identical `html` or not. The
  // asset-image effect does NOT re-run (its deps are unchanged), so every
  // `src` and every marker it wrote is gone for good. Same defect, same fix and
  // the same measured account as `document-preview.tsx`'s `bodyHtml`, where it
  // shipped once as a showstopper.
  const bodyHtml = useMemo(() => ({ __html: html }), [html]);
```

and `dangerouslySetInnerHTML={bodyHtml}` on the preview div.

- [ ] **Step 4: Run — GREEN. Then mutate:** restore the inline literal and confirm RED. Revert.

- [ ] **Step 5: tsc + commit**

```bash
git commit --only src/app/documents-history-modal.tsx src/app/documents-history-modal.test.tsx -F - <<'MSG'
fix: memoize the history preview's dangerouslySetInnerHTML object

React 19 diffs host props by Object.is and treats
dangerouslySetInnerHTML like any other prop, so an inline object literal
is new every render and React re-assigns innerHTML -- rebuilding the
subtree -- on every re-render, byte-identical html or not.

Harmless today because nothing attaches anything to that subtree. It
stops being harmless in the next commit, which wires asset images here:
the effect's deps would be unchanged, so it would not re-run, and every
src it wrote would be gone for good. That is the measured showstopper
document-preview.tsx already shipped once and carries its own account of.

Pinned by node identity, not markup -- a rebuilt subtree is
byte-identical, which is exactly how the original defect hid.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 8: Wire asset images into the history modal

**Files:**
- Modify: `src/app/documents-history-modal.tsx`, `src/app/documents-panel.tsx`
- Test: `src/app/documents-history-modal.test.tsx`

**Scene:** §206. The modal renders a version's blocks through `renderDocumentHtml` but was never wired to `attachAssetImages`, so a version containing an image block renders that block without its picture. The render happens in **`HistoryRow`** — the preview is a per-row disclosure, and the row is already its own component because the disclosure needs a hook per row.

- [ ] **Step 1: Write the failing test** — a version with an image block resolves to a blob `src` when the bag is supplied, and renders without one (no crash, no marker churn) when it is absent.

- [ ] **Step 2: Add the narrow prop type**

```tsx
/** Read-only asset access for resolving `<img data-asset-id>` in a version
 *  preview.
 *
 *  ★ A NEW, NARROWER type rather than `DocumentAssetPaneProps`, which also
 *  carries `setAssets`. This surface is read-only over assets and must not be
 *  handed a setter: taking the wider type would leave a write capability the
 *  component merely happens not to use, which is how one gets used later
 *  without anyone deciding to. */
export interface HistoryAssetAccess {
  tursoConfig: TursoConfig | null;
  projectId: string;
  assets: readonly DocumentAsset[] | undefined;
}
```

Add `assetAccess?: HistoryAssetAccess` to both `DocumentsHistoryModalProps` and `HistoryRowProps`, and forward it at the `<HistoryRow` mount.

★ Optional for the same reason `ws` is optional: the component's own suite renders it bare throughout, and an absent bag degrades to today's behaviour — blocks render, images do not resolve — rather than to broken markup.

- [ ] **Step 3: Add the effect in `HistoryRow`**

Mirror `document-preview.tsx`: a `bodyRef` on the preview div, a `cancelled` flag because the byte loads resolve asynchronously, and revoke on unmount or when the subtree is replaced.

```tsx
  const repairGeneration = useSyncExternalStore(
    subscribeAssetRepairs, getAssetRepairGeneration, getServerAssetRepairGeneration,
  );

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !assetAccess) return;
    let cancelled = false;
    let detach: (() => void) | null = null;
    const mimeFor = (id: string) => assetAccess.assets?.find((a) => a.id === id)?.mime;
    attachAssetImages(
      el,
      (id) => loadAssetData(assetAccess.tursoConfig, id, assetAccess.projectId),
      mimeFor,
    ).then((d) => {
      if (cancelled) { d(); return; }
      detach = d;
    });
    return () => { cancelled = true; detach?.(); };
  }, [bodyHtml, assetAccess, repairGeneration]);
```

★ The preview div is ALWAYS MOUNTED and merely `hidden`-toggled (the repo's expander convention), and `html` collapses to `""` while collapsed — so the effect runs against an empty subtree until the disclosure opens. `attachAssetImages` returns a no-op teardown when it finds no `img[data-asset-id]`, which it already does today.

★★ Depend on the **memoized `bodyHtml`** from Task 7, not on a fresh object, and subscribe to the repair generation rather than bumping the assets array's identity — the latter would also re-run the effect but marks the workspace dirty and writes every table, which is why the repair signal rides its own wire.

- [ ] **Step 4: Thread the bag from the panel**

`documents-panel.tsx` already holds `assetPane`. Pass the three read-only fields at the `<DocumentsHistoryModal>` mount.

★★ `documents-panel.tsx` is no longer at the cap after Part 1, so this is affordable — but re-measure after the edit:
```bash
node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"
```

- [ ] **Step 5: Run, then mutate** — delete the `attachAssetImages` call and confirm RED; revert.

- [ ] **Step 6: Full gates + axe, then commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src/app; echo "EXIT=$?"
npm run test:run > /tmp/t8.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t8.log
npm run size:check; echo "EXIT=$?"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Documents" --workers=1; echo "EXIT=$?"
```

```bash
git commit --only src/app/documents-history-modal.tsx src/app/documents-panel.tsx src/app/documents-history-modal.test.tsx -F - <<'MSG'
fix: resolve images in the version-history preview

DocumentsHistoryModal rendered a version's blocks through
renderDocumentHtml but was never wired to attachAssetImages, so a version
containing an image block rendered that block without its picture
(open-followups 206). The fix lands in HistoryRow, where the render
actually happens -- the preview is a per-row disclosure.

Takes a new narrow read-only asset bag rather than
DocumentAssetPaneProps, which also carries setAssets: this surface must
not be handed a write capability it merely happens not to use.

Subscribes to the asset-repair generation rather than bumping the assets
array's identity; the latter re-runs the effect but marks the workspace
dirty and writes every table, which is why that signal rides its own wire.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 9: Update the follow-ups register

**Files:** Modify `docs/open-followups.md`

★★★ **This file IS scanned by `docs:claims:check`, which is a RATCHET — a NEW `path:LINE` citation FAILS the gate.** Only `docs/superpowers/` is skipped (`SKIP_DIRS` in `doc-claims-lib.mjs`). Cite **symbols** and grep commands, never line numbers.

★★ The file is **CRLF**. A node patch script whose anchor uses `\n` silently no-ops.

- [ ] **Step 1: Re-check the max register number against `origin/main`**

```bash
git fetch origin main
git show origin/main:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -1
```
Expected 224, so the new entry is **§225**. ★★ A number is reserved only once it is on `origin/main` — two branches in a row have minted the same one. If another branch landed first, renumber.

- [ ] **Step 2: Close §206, §220, §223** — set each `**Status:**` to closed, naming this slice and what actually changed. Do not delete the entries; closed entries are the record.

- [ ] **Step 3: Open §225**

Content: `attachAssetImages` builds a typeless `Blob` when no metadata row matches an asset id, leaving the mime to content sniffing. Record that it is **bounded** by the same argument as §223 — the blob URL is only ever assigned to `<img src>`, and `src/proxy.ts` serves a nonce-based `script-src` with no `'unsafe-inline'` plus `object-src 'none'` (reproduce with `grep -n "script-src\|object-src" src/proxy.ts`) — and that the remaining step, a blob document inheriting its creator's policy, is REASONED from spec, not measured. Record why it was split out: declining it would regress a case that renders correctly today, so it is a decision, not an oversight.

- [ ] **Step 4: Add the §217 line** — scoped into this slice and dropped for want of §219's manual open-in-Word verification, which nothing in this repo can run.

- [ ] **Step 5: Run both doc gates**

```bash
npm run docs:claims:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
```
★★ `docs:claims:check` proves only that a cited line COULD exist, never that it is right. `docs:symbols:check` proves only that a mixed-case NAME exists — it skips `SCREAMING_CASE` entirely, so `ASSET_MIME_ALLOWED` in any of this text is completely ungated.

- [ ] **Step 6: Commit**

---

## Task 10: Release stamp

**Files:** `src/app/version.ts`, `package.json`, `package-lock.json` (×2), `README.md`, five `docs/CODEMAPS/*.md`, `CHANGELOG.md`

★★ **Ten sites carry the version and NO gate checks any of them.** They have drifted for eleven releases before. Bump them all in ONE commit.

- [ ] **Step 1: Re-read the current version from `origin/main` first**

```bash
git fetch origin main
git show origin/main:src/app/version.ts | head -5
```
★★★ Main has shipped mid-branch before. Do not assume 0.256.1 — read it, then stamp the next patch.

- [ ] **Step 2: Patch all ten sites** with a node script that detects EOL per file, asserts each anchor is present AND unique, and fails on a bare LF in a CRLF file.

`APP_MILESTONE` / the codename stays **"Khaw"** — the codename tracks the minor series, and this is a patch.

- [ ] **Step 3: CHANGELOG entry** — user-facing language, no `[session link removed]...` URL. Lead with the six tables' images and the mime hardening; the file split is not a user-facing change and belongs in one closing line at most.

- [ ] **Step 4: No new `versionHighlight*` key**, so `APP_HIGHLIGHT_KEYS` and `i18n.ts` are untouched. Confirm the branch does not touch `i18n.ts` at all:
```bash
git diff origin/main --name-only | grep i18n; echo "EXIT=$?"
```
Expected: no output.

- [ ] **Step 5: Full local chain, every gate unpiped** (the list in the spec's "Gates and ordering"), then commit.

---

## Definition of done

- [ ] `documents-panel.tsx` and `document-block-editors.tsx` both comfortably under 800 by the gate's own `split("\n").length` metric, with **no** new baseline entry.
- [ ] `grep -rn "ASSET_MIME_ALLOWED as readonly string\[\]" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."` returns exactly **one** hit: the helper's body.
- [ ] Every mutation listed in Tasks 1, 2, 5, 6, 7 and 8 was run and observed RED, then reverted. ★★ Sweep for live mutants before reporting — `git status --porcelain -uall` and `git diff origin/main` — a report is a claim about work, not about the tree.
- [ ] tsc 0 · eslint 0 · size ok · full suite green · shuffled suite green · coverage unmoved · dup green · symbols 0 · claims 0 · axe Documents green at `--workers=1`.
- [ ] §206, §220, §223 closed; §225 opened; §217 annotated.
- [ ] All ten version sites stamped in one commit; `i18n.ts` untouched.
