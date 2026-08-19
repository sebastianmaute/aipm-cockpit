# Documents S3b Fix Round — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the fifteen findings two cold reviews raised against `feat/documents-s3b` — a silent data-loss path on restore, an unversioned clobber, an editor that can produce blocks the loader discards, four tests that cannot detect what they are named for, six a11y/correctness defects, and the unbuilt narrow-pane docked toolbar the design spec specified — plus the zero-block empty state, which the user asked to close with a working add-block control (Task 15b).

**Architecture:** The draft hook (`useBlockDraft`) gains a render-time reconcile plus commit guards so an external write to a block can neither be clobbered nor silently ignored. Coalescing stops being a content heuristic and becomes an identity check: the editor anchors its run to the exact version id its own last commit produced, so *any* other writer breaks the run. The narrow-pane layout becomes real block selection with one portaled, docked toolbar, driven by a `ResizeObserver` hook measuring the pane element rather than the viewport.

**Tech Stack:** React 19 (function components, `useState`/`useRef`/`useEffect`, render-time reconcile — `react-hooks/set-state-in-effect` is FATAL in CI), TypeScript strict, Tiptap 3 (`RichTextEditor`), vitest + @testing-library/react, i18n EN/DE parity enforced by `tsc`.

---

## Verification of the findings before planning

Every finding below was re-checked against the tree at `7627329d`. **All fifteen reproduce as described**, with two corrections that change how the work must be done:

| # | Verdict | Note |
|---|---|---|
| F1 | **Confirmed** | `document-block-editors.tsx:106`/`:125` seed at mount; the no-deps effect at `:149-152` re-seeds `baselineRef` alone; `commit()` at `:154-161` has neither a dirty guard nor an abandon guard. |
| F2 | **Confirmed** | `document-mutations.ts:434` writes `snapshot(liveDoc, "update", ctx)` and `snapshot` (`:209-227`) takes `source` from `ctx.source`, which the panel funnel hardcodes to `"user"`. `RESTORED_MARKER_OP` is written only at `:527`. `shouldCoalesce` therefore returns `true` after a live-document restore. |
| F3 | **Confirmed** | `document-model.ts:115`/`:127`/`:137` drop empty heading/paragraph/bullets. `removeItem` (`document-block-editors.tsx:388-390`) has no lower bound while `document-table-editor.tsx:131`/`:159` do. |
| F4a–d | **Confirmed** | See each task for the exact vacuity. |
| F5 | **Confirmed** | `documents-toolbar.tsx:155-163` gates only on `isReadOnly`; `document-edit-mode.tsx:59` additionally needs a non-null `doc`. |
| F6 | **Confirmed** | `document-table-editor.tsx:117-139` emits N `<th>`; `:141-167` emits N+1 `<td>` (the extra at `:155`). |
| F7 | **Confirmed** | `toggle-button.tsx:52-55` documents `ariaDescribedBy` as required reading for a disabled toggle; neither the new toggle nor `AddButton` supplies one. **`AddButton` needs no primitive change** — it spreads `...props` onto `<Button>` (`pane-toolbar.tsx:86-92`) and its prop type is `ButtonHTMLAttributes`, so `aria-describedby` already passes through. Both are fixed. |
| F8 | **Confirmed** | `document-block-editors.tsx:259` builds `` const suffix = ` ${index + 1}` `` used at `:264`/`:275`, against the rule stated verbatim at `:337-342` and `:516-521`. |
| F9 | **Confirmed** | `documents-panel.tsx:360` passes raw `mutateDocuments`; the funnel `mutate(m)` is at `:481-497` and is the only place a refusal reaches the user. |
| F10 | **Confirmed** | `document-block-editors.tsx:531-533` renders raw keys. **Cheaper than the finding assumed:** `settings-sections/export-section.tsx:16-32` already holds an exhaustive `Record<ExportSectionKey, TranslationKey>` whose fifteen keys exist in EN *and* DE. No new i18n key is needed — the map is extracted and shared. |
| F11 | **Confirmed** | `documents-panel.tsx` is **799** by `readFileSync().split("\n").length` (the gate's own method, `scripts/check-file-sizes.mjs:21`), not 796. It is absent from `docs/baselines/file-sizes.json` (which holds four entries, none of them a documents file), so 801 fails as a NEW file over the limit. **One** line of headroom. |
| F12 | **Confirmed** | The comment at `document-block-editors.test.tsx:581-586` describes a mechanism the hook does not have. |
| F13 | **Confirmed** | The docked toolbar is unbuilt; `document-editor.tsx:54` collapses every non-first paragraph with no stated reason, and has no image test, so a first paragraph holding an image leaves the document with no editable paragraph at all. |
| F14 | **Confirmed, and D3's cited precedent does not exist.** | `use-media-query.ts:26` reads `window.matchMedia` — viewport. But **there is no `ResizeObserver` anywhere in `src/`**: `grep -rn "ResizeObserver" src/ e2e/` returns exactly two hits, `dashboard-grid.tsx:14` and `e2e/dashboard-grid.spec.ts:17`, and **both are comments stating that the feature deliberately uses none**. So Task 14 writes the repo's first `ResizeObserver`, with no in-repo pattern to copy — and, critically, **jsdom provides no `ResizeObserver` global and `vitest.setup.ts` installs no polyfill**, so the hook MUST feature-detect or every test that renders the Documents panel throws. |
| F15 | **Confirmed** | `e2e/a11y.spec.ts:19` lists `"Documents"`; nothing in `e2e/` mentions `Edit blocks` or `documentsEditBlocks`, so only the read-only preview is ever scanned. |

**Nothing was judged wrong.** F7, F10 and F14 each cost less or more than the finding assumed; the corrections are folded into the tasks.

---

## Cross-cutting constraints the executor must respect

1. **`react-hooks/set-state-in-effect` is FATAL** (`npm run lint` alone does NOT reproduce the gate — use `npx eslint --max-warnings=0 src/app`). Every draft re-seed in this plan is a **render-time reconcile** (`if (prop !== handled) { setState(...) }` guarded by last-seen state), never a `useEffect`.
2. **`react-hooks/refs` bans reading OR writing a ref during render.** The reconcile therefore cannot write `liveValueRef.current` itself; Task 5 mirrors it in the existing after-every-render effect and proves the mirror is a no-op on every other path.
3. **`documents-panel.tsx` is at 799/800.** Task 9 nets it to **798** before Task 13/14 touch it. No task may add a net line to that file without the budget note in its own step.
4. **i18n:** new keys go in BOTH `i18n.ts` and `i18n.de.ts` (tsc enforces parity). `i18n.de.ts` is **CRLF** and the Edit tool corrupts umlauts there — patch it with a node UTF-8 write whose anchor uses `\r\n`, then re-verify with `grep`. Placeholders are 0-based (`{0}`).
5. **Six persistence write paths:** *no task in this plan adds or changes a persisted field.* `DocVersionOp` is deliberately NOT extended (see Task 2's design note), so nothing here touches JSON/CSV/MD/Turso-single/Turso-tenant/IndexedDB, and no golden fixture needs regenerating.
6. **Coverage-gated files:** `use-document-editor.ts` is already in `vitest.config.ts` `coverage.exclude` (line 68). Task 14 adds a NEW `.ts` hook — it is deliberately **tested, not excluded** (see that task).
7. **Never read a gate's exit code through a pipe.** Redirect, check unpiped, then read the file.

### Files two or more tasks touch — SERIALISE these

| File | Tasks (in order) |
|---|---|
| `src/app/document-editor-commit.ts` | T2 → T7 |
| `src/app/document-editor-commit.test.ts` | T2 → T7 |
| `src/app/document-editor-commit.property.test.ts` | T2 → T3 |
| `src/app/document-block-editors.tsx` | T5 → T7 → T11 → T12 |
| `src/app/document-block-editors.test.tsx` | T5 → T6 → T7 → T11 → T12 |
| `src/app/document-table-editor.tsx` | T5 → T10 |
| `src/app/document-editor.tsx` | T5 → T15 |
| `src/app/document-editor.test.tsx` | T5 → T11 → T14b → T15 |
| `src/app/documents-panel.tsx` | T9 → T13 → T14 → T15b |
| `src/app/document-edit-mode.tsx` | T1 → T9 → T14 → T15b |
| `src/app/documents-panel.test.tsx` | T8 → T11 → T13 |
| `src/app/use-document-editor.ts` | T2 → T13 → T15b |
| `src/app/use-document-editor.test.ts` | T8 (creates) → T13 → T15b |
| `src/app/i18n.ts` + `i18n.de.ts` | T7 → T9 → T10 → T15 → T15b — **one writer at a time, always** |

---

## Task 1: Correct three false comments (no behaviour change)

Three comments assert things that are not true. Two are merely stale; the `796` one is wrong in the dangerous direction and would let a contributor spend four lines they do not have.

**Files:**
- Modify: `src/app/document-edit-mode.tsx:5-11`
- Modify: `src/app/document-mutations.ts` (the `coalesce` comment, `"not yet built as of this commit"`)

- [ ] **Step 1: Replace the file-size claim with a reproduce command, not a number**

`document-edit-mode.tsx` currently opens:

```tsx
// `documents-panel.tsx` sits at 796 of the 800-line size-gate cap (four lines
// of headroom — see AGENTS.md's file-size-gate note), so the toggle state,
```

Replace those two lines with:

```tsx
// `documents-panel.tsx` sits within a line or two of the 800-line size-gate
// cap, so the toggle state, the narrow-pane measurement, the commit wiring and
// the preview/editor swap live here instead of inline in the panel.
// ★★★ DO NOT QUOTE THE NUMBER HERE — an earlier revision said "796 … four
//  lines of headroom" when the gate's own method (`readFileSync().split("\n")
//  .length`, check-file-sizes.mjs) reported 799, i.e. ONE. A stale number in
//  the optimistic direction spends headroom that does not exist, and the file
//  is NOT in docs/baselines/file-sizes.json, so 801 fails outright as a NEW
//  file over the limit. Measure it instead:
//    node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"
```

Keep the following lines (`// live here instead of inline in the panel.` is folded into the replacement above; the `.tsx` coverage-exclude sentence stays verbatim).

- [ ] **Step 2: Delete the "not yet built" claim**

In `src/app/document-mutations.ts`, inside the `case "ops"` `coalesce` comment, the sentence reads:

```
      //  against MAX_VERSIONS_PER_DOC. See document-editor-commit.ts — not yet
      //  built as of this commit; it lands in Task 2 of this slice.
```

Replace with:

```
      //  against MAX_VERSIONS_PER_DOC. See document-editor-commit.ts, which
      //  owns the decision (this module only honours the flag).
```

- [ ] **Step 3: Verify nothing else changed**

Run: `git diff --stat`
Expected: exactly two files, comment lines only, no `+`/`-` on any executable line.

- [ ] **Step 4: Commit**

```bash
git add src/app/document-edit-mode.tsx src/app/document-mutations.ts
git commit -m "docs(documents): correct three stale comments in the block-editor slice"
```

**Mutant:** none — comments are ungated by construction, which is exactly why this task exists as a separate, reviewable commit rather than being buried in a behaviour change.

---

## Task 2: F2 — anchor coalescing to the editor's own run

### Design decision (this is the finding's core, recorded here)

Two options were evaluated.

**(a) Give the restore's before-image a distinct `DocVersionOp`.** Cost, measured against the tree:
- `DocVersionOp` union and the `OPS` allowlist (`document-versions.ts:37`, `:40`).
- `VERSION_OP_LABEL` is an **exhaustive** `Record<DocVersionOp, TranslationKey>` (`documents-history-modal.tsx:47-53`), deliberately exhaustive so a sixth op is a compile error — so a new op forces a new `TranslationKey` in **both** `i18n.ts` and `i18n.de.ts`.
- **Persistence:** `sanitizeDocumentVersions` coerces an unrecognised op to `"update"` (`document-versions.ts:165`) rather than dropping the row. So a workspace written by a client that knows the new op and read by one that does not silently degrades the value back to exactly the one that makes coalescing swallow it. The property is not merely lost on the old client — it is lost *invisibly*, on shared project data.
- It does **not** generalise: a future `user`/`update` writer that is not the editor re-opens the identical hole, and the fix would be a seventh op.
- Reusing `RESTORED_MARKER_OP` instead is worse still: `deletedDocumentVersions` filters markers out, so a genuine before-image would vanish from history.

**(b) Anchor the run to the version id the editor's own last commit produced. — CHOSEN.**
`shouldCoalesce` gains a fourth parameter, `lastVersionId: number | null`, and refuses to coalesce unless the newest version *is that exact row*. The hook keeps the anchor in a ref and advances it only when a commit actually lands.

Why (b):
- **It costs nothing outside two files.** No union member, no i18n key, no sanitizer change, no persisted shape change, so none of the six write paths and no golden fixture is touched.
- **It generalises by construction.** A restore, an AI write, a rename, a delete, a second tab, a bulk op, or any future `user`/`update` writer all mint a row the editor did not — so the run breaks for free, with no new case analysis. Option (a) enumerates writers; (b) inverts the question to "was this mine?".
- **It cannot hide a snapshot from history**, which the `RESTORED_MARKER_OP` variant of (a) would.
- **It is strictly safer at the boundary.** Today the *first* edit after mounting the editor coalesces if the newest version merely happens to be a recent `user`/`update` — contradicting the module's own stated property ("the FIRST edit of a session always records"). With a `null` starting anchor the first edit never coalesces, so the docstring becomes true.

Cost of (b), stated honestly:
- One more required argument on a pure function, so all **11** existing `shouldCoalesce(...)` calls in `document-editor-commit.test.ts` and the one in `document-editor-commit.property.test.ts` must pass an anchor. This is churn, not risk — each call gains one literal.
- Slightly more versions in one edge case: editing document A, editing document B, then returning to A starts a fresh run for A. That is correct behaviour (B's write is not A's session start) and is already how the existing `documentId` check behaves.
- The `source`/`op` checks become unreachable-in-practice once the id check passes. They are **kept** — `shouldCoalesce` is a pure exported function whose caller discipline it cannot assume, and two lines is a cheap guard against a mis-passed anchor. The step below states which check is load-bearing so a future reader does not delete the wrong one.

**Files:**
- Modify: `src/app/document-editor-commit.ts`
- Modify: `src/app/use-document-editor.ts`
- Test: `src/app/document-editor-commit.test.ts`
- Test: `src/app/document-editor-commit.property.test.ts` (call-site update only; Task 3 owns its assertion)

- [ ] **Step 1: Write the failing test**

Append to the `describe("shouldCoalesce", ...)` block in `src/app/document-editor-commit.test.ts`, immediately before its closing `});`:

```ts
  // ★★★ THE RUN IS ANCHORED BY IDENTITY, NOT BY CONTENT. A live-document
  //  restore writes `snapshot(liveDoc, "update", ctx)` with `source: "user"`
  //  (document-mutations.ts, `case "restore"`), so it is BYTE-INDISTINGUISHABLE
  //  from one of the editor's own before-images by source+op. Without the id
  //  check the editor coalesces straight onto it, the restored state is
  //  overwritten, and NO history entry records that it ever existed.
  it("does not coalesce onto a user/update version the editor did not mint", () => {
    const mine = version({ id: 4, savedAt: "2026-08-18T10:00:00.000Z" });
    // A restore's before-image: same document, same source, same op, newer.
    const restore = version({ id: 5, savedAt: "2026-08-18T10:00:10.000Z" });
    expect(shouldCoalesce([mine, restore], 7, NOW, 4)).toBe(false);
  });

  it("coalesces onto the version the editor itself last minted", () => {
    const mine = version({ id: 4 });
    expect(shouldCoalesce([mine], 7, NOW, 4)).toBe(true);
  });

  it("does not coalesce when the editor has minted nothing yet", () => {
    // A null anchor is a fresh run: the first edit ALWAYS records, so the
    // pre-session state stays the revert target even when some other writer
    // left a recent user/update sitting there.
    expect(shouldCoalesce([version({ id: 4 })], 7, NOW, null)).toBe(false);
  });

  it("exposes the newest version's id so the caller can anchor its run", () => {
    expect(newestVersionId([])).toBe(null);
    expect(
      newestVersionId([version({ id: 1 }), version({ id: 9, savedAt: "2026-08-18T10:00:05.000Z" })]),
    ).toBe(9);
  });
```

Add `newestVersionId` to the import at the top of that file:

```ts
import {
  shouldCoalesce,
  newestVersionId,
  COALESCE_WINDOW_MS,
  paragraphHasImage,
  blockChanged,
  replaceBlockOp,
} from "./document-editor-commit";
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/document-editor-commit.test.ts --reporter=dot`
Expected: FAIL — `newestVersionId` is not exported, and the 4-argument calls are a TS error the runner surfaces as a failed import.

- [ ] **Step 3: Update the eleven existing calls to pass an anchor**

Every existing `shouldCoalesce(x, 7, NOW)` in `src/app/document-editor-commit.test.ts` becomes a 4-argument call. The anchor to pass is **the id of the version the assertion is about**, so the case each test names is the one thing still deciding the result:

| line (pre-edit) | new call |
|---|---|
| `:27` | `shouldCoalesce([], 7, NOW, null)` |
| `:31` | `shouldCoalesce([version()], 7, NOW, 1)` |
| `:35` | `shouldCoalesce([version({ documentId: 99 })], 7, NOW, 1)` |
| `:41` | `shouldCoalesce([version({ source: "ai" })], 7, NOW, 1)` |
| `:46` | `shouldCoalesce([version({ op })], 7, NOW, 1)` |
| `:52` | `shouldCoalesce([stale], 7, NOW, 1)` |
| `:60` | `shouldCoalesce([newer, older], 7, NOW, 2)` |
| `:64` | `shouldCoalesce([version({ savedAt: "not a date" })], 7, NOW, 1)` |
| `:75` | `shouldCoalesce([higherId, lowerId], 7, NOW, 2)` |
| `:81` | `shouldCoalesce([version({ savedAt })], 7, NOW, 1)` |
| `:87` | `shouldCoalesce([version({ savedAt })], 7, NOW, 1)` |

★ `:60` and `:75` pass `2` deliberately: both fixtures assert that the NEWEST row is read, so the anchor must name the newest row or the id check — not the property under test — would be what returns `false`, and the test would pass for the wrong reason.

- [ ] **Step 4: Implement**

In `src/app/document-editor-commit.ts`, replace the `shouldCoalesce` docblock and body, and export the id helper:

```ts
/**
 * Is a before-image UNWARRANTED for the edit about to be applied?
 *
 * ★★ The property this preserves is that the FIRST before-image of a session
 *  holds the state before the session started — the thing a user actually
 *  reverts to. Twenty keystroke-shaped snapshots would evict that, and every
 *  AI-authored version with it, against MAX_VERSIONS_PER_DOC (20).
 *
 * ★★★ THE RUN IS ANCHORED BY IDENTITY. `lastVersionId` is the id of the
 *  version the CALLER's own last commit produced (`null` before it has
 *  produced one). Coalescing happens only when that exact row is still the
 *  newest — so ANY other writer ends the run, with no per-writer case
 *  analysis: a restore, an AI write, a rename, a delete, a second tab, a
 *  future user/update writer nobody has thought of yet.
 *
 *  This replaced a content test (`source === "user" && op === "update"`), which
 *  a live-document restore defeats: `document-mutations.ts`'s restore-in-place
 *  writes `snapshot(liveDoc, "update", ctx)` and `ctx.source` is `"user"`, so
 *  its before-image is byte-indistinguishable from one of the editor's own.
 *  The editor coalesced onto it and overwrote the restored state with NO
 *  history entry that it had existed. Giving the restore its own DocVersionOp
 *  was rejected: `sanitizeDocumentVersions` coerces an unknown op back to
 *  `"update"`, so an older client reading the same project would silently
 *  re-open the hole on shared data.
 *
 * ★ The source/op checks below are now unreachable whenever the id check
 *  passes (an id the caller minted is by construction a user/update row). They
 *  are KEPT as a guard against a mis-passed anchor — this is an exported pure
 *  function and cannot assume its caller's discipline. The id check is the
 *  load-bearing one; do not delete IT and keep them.
 */
export function shouldCoalesce(
  versions: readonly DocVersion[],
  documentId: number,
  now: string,
  lastVersionId: number | null,
): boolean {
  const newest = newestVersion(versions);
  if (!newest) return false;
  if (newest.documentId !== documentId) return false;
  if (newest.id !== lastVersionId) return false;
  if (newest.source !== "user" || newest.op !== "update") return false;

  const nowMs = Date.parse(now);
  const savedMs = Date.parse(newest.savedAt);
  // ★ An unparseable timestamp must NOT coalesce. Coalescing on a value we
  //  cannot compare would silently drop a before-image on bad data — the
  //  failure that costs history rather than merely an extra version.
  if (Number.isNaN(nowMs) || Number.isNaN(savedMs)) return false;

  return nowMs - savedMs <= COALESCE_WINDOW_MS && nowMs >= savedMs;
}

/** The id a caller should anchor its next `shouldCoalesce` call to, read from
 *  the post-mutation version list. `null` when there are none.
 *
 *  ★ Exported so the caller never re-derives "newest" — `newestVersion`'s
 *   savedAt/id ordering rule lives here and a second copy of it is exactly the
 *   drift this codebase keeps getting bitten by. */
export function newestVersionId(versions: readonly DocVersion[]): number | null {
  return newestVersion(versions)?.id ?? null;
}
```

- [ ] **Step 5: Thread the anchor through the hook**

In `src/app/use-document-editor.ts`, add `newestVersionId` to the import and the anchor ref:

```ts
import { shouldCoalesce, newestVersionId, replaceBlockOp } from "./document-editor-commit";
```

Insert after the `currentDocIdRef` effect (after line 40) :

```ts
  // ★★★ THE COALESCING RUN'S ANCHOR — the id of the version THIS hook's last
  //  landed commit produced. `shouldCoalesce` coalesces only while that row is
  //  still the newest, so any other writer (a restore, an AI write, a second
  //  tab) ends the run and the next edit records a real before-image.
  //  ★ A ref, not state: it is read and written inside an event handler, never
  //   during render, and a re-render on every commit would buy nothing.
  const lastVersionIdRef = useRef<number | null>(null);
```

Replace the body of `commitBlock` from the `const coalesce` line to the end:

```ts
      const coalesce = shouldCoalesce(versions, documentId, stamp, lastVersionIdRef.current);
      const result = mutateDocuments(
        { kind: "ops", id: documentId, ops: [replaceBlockOp(index, block)], coalesce },
        "user",
      );
      // ★★ ADVANCE ONLY ON A LANDED WRITE. A refusal (`changed: false`) leaves
      //  the caller's list untouched, so adopting its newest id would anchor
      //  this run to a row somebody ELSE minted — and the next edit would
      //  coalesce onto it, which is the exact defect this anchor exists to
      //  prevent. A COALESCED write is `changed: true` and mints nothing, so
      //  this correctly re-reads the same anchor.
      if (result.changed) lastVersionIdRef.current = newestVersionId(result.versions);
      return result;
```

- [ ] **Step 6: Update the property test's call site (assertion untouched — Task 3 owns it)**

In `src/app/document-editor-commit.property.test.ts`, the simulation must now track the anchor exactly as the hook does. Replace lines 39-63 (the `let versions` declaration through the end of the `for` loop) with:

```ts
        let versions: readonly DocVersion[] = [];
        let nextVersionId = 1;
        // Mirrors use-document-editor.ts's `lastVersionIdRef`: the property is
        // about the HOOK's behaviour, so the simulation has to carry the same
        // anchor or it is measuring a function no caller uses that way.
        let lastVersionId: number | null = null;

        for (let i = 0; i < edits; i++) {
          // Each edit lands 10s after the previous one — one continuous session.
          const now = new Date(START + i * 10_000).toISOString();
          const coalesce = shouldCoalesce(versions, 1, now, lastVersionId);
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
          if (result.changed) lastVersionId = newestVersionId(result.versions);
        }
```

and extend its import:

```ts
import { shouldCoalesce, newestVersionId, COALESCE_WINDOW_MS } from "./document-editor-commit";
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/app/document-editor-commit.test.ts src/app/document-editor-commit.property.test.ts --reporter=dot`
Expected: PASS, all files.

Then: `npx tsc --noEmit` — expected: exit 0. (`shouldCoalesce`'s new required parameter is a compile error at any call site that was missed; vitest alone would not catch one in a file it did not run.)

- [ ] **Step 8: Commit**

```bash
git add src/app/document-editor-commit.ts src/app/use-document-editor.ts src/app/document-editor-commit.test.ts src/app/document-editor-commit.property.test.ts
git commit -m "fix(documents): anchor edit coalescing to the run's own version id

A live-document restore writes a user/update before-image, which is
byte-indistinguishable from one of the editor's own — so the editor
coalesced onto it and overwrote the restored state with no history entry.
Coalescing now requires the newest version to be the exact row this
editor's last commit produced, so any other writer ends the run."
```

**Mutant this kills:** deleting the single line `if (newest.id !== lastVersionId) return false;` in `shouldCoalesce`. The restore fixture (same documentId, `source: "user"`, `op: "update"`, inside the window) then satisfies every remaining clause and returns `true` — the first new test goes red. Deleting `if (result.changed)` in the hook is killed by nothing here and is deliberately covered by review rather than a test: constructing a refused `ops` mutation at this layer requires an over-cap block list, which is a document-mutations concern already pinned there.

---

## Task 3: F4d — stop the version-budget property deriving its own bound

`MAX_VERSIONS_MINTED = Math.floor(MAX_SPAN_MS / COALESCE_WINDOW_MS) + 1` (`document-editor-commit.property.test.ts:24`) is computed from the constant it is policing, so it tracks that constant in **both** directions. Shrink `COALESCE_WINDOW_MS` to 1s and the bound becomes 391 — larger than `MAX_EDITS`, so the assertion passes with coalescing effectively switched off. The number must be a literal.

**Files:**
- Test: `src/app/document-editor-commit.property.test.ts:10-24, 66-71`

- [ ] **Step 1: Replace the derived bound with a literal and say why**

Replace lines 10-24 with:

```ts
// Edits land 10s apart; the property generates up to 40 of them, so the
// longest possible session spans (40-1)*10s = 390s of wall time. Coalescing
// mints a new version only once the gap since the last-minted version's own
// timestamp exceeds COALESCE_WINDOW_MS (5min = 300000ms) — see
// document-editor-commit.ts's shouldCoalesce. A session of span S therefore
// mints at most floor(S / COALESCE_WINDOW_MS) + 1 versions for this document:
// one at the first edit, then one more each time the elapsed time since the
// last mint crosses another full window. For S=390000 that is
// floor(390000 / 300000) + 1 = 2 — regardless of how many edits (1..40) land
// inside that span, since more edits packed into the same window only add
// MORE coalesced (unminted) writes, never more minted versions.
//
// ★★★ THE BOUND IS A LITERAL, NOT A DERIVATION. It used to read
//  `Math.floor(MAX_SPAN_MS / COALESCE_WINDOW_MS) + 1`, i.e. it was computed
//  from the very constant it polices — so it auto-loosened in BOTH directions.
//  Shrinking COALESCE_WINDOW_MS to 1s moves the bound to 391, which is past
//  MAX_EDITS, and the assertion then passes with coalescing effectively
//  DISABLED. A gate whose threshold follows the thing it measures is not a
//  gate. Recompute the 2 BY HAND if either constant above changes.
const EDIT_SPACING_MS = 10_000;
const MAX_EDITS = 40;
const MAX_VERSIONS_MINTED = 2;
```

★ `MAX_SPAN_MS` is now unused. **Delete its declaration** — CI runs `eslint --max-warnings=0` with no `argsIgnorePattern`, so an unused const is fatal. `EDIT_SPACING_MS` is likewise unused today (the loop body uses the literal `10_000`); make the loop use the constant instead of deleting it, so the comment's arithmetic stays checkable:

in the loop body, replace

```ts
          const now = new Date(START + i * 10_000).toISOString();
```

with

```ts
          const now = new Date(START + i * EDIT_SPACING_MS).toISOString();
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/app/document-editor-commit.property.test.ts --reporter=dot`
Expected: PASS (the value is unchanged at today's constants — this task changes only what the value is DERIVED from).

- [ ] **Step 3: Prove the bound is now load-bearing**

Temporarily change `COALESCE_WINDOW_MS` in `src/app/document-editor-commit.ts` from `5 * 60 * 1000` to `1000`, re-run the command above, and confirm it now **FAILS** (`mine.length` climbs past 2). Revert the constant immediately and re-run to confirm green.

★ **Revert the mutant before committing.** Verify with `git diff src/app/document-editor-commit.ts` — expected: empty.

- [ ] **Step 4: Commit**

```bash
git add src/app/document-editor-commit.property.test.ts
git commit -m "test(documents): hardcode the version-budget bound instead of deriving it"
```

**Mutant this kills:** `COALESCE_WINDOW_MS: 5 * 60 * 1000 → 1000` (a two-token change). Before this task that mutant survives; after it, the property goes red. Measured by Step 3, not asserted from reasoning.

---

## Task 4: F4c — close the direct-field hole in the AI-coalesce guard

`document-mutations.test.ts:220-221` reads the enclosing object literal at `use-document-tools.ts:366` and asserts only `expect(opsLiteral).not.toMatch(/\.\.\./)`. Appending `, coalesce: rawArgs.coalesce` to that literal keeps the test green while letting a model suppress its own audit trail — the exact property the test is named for.

**Files:**
- Test: `src/app/document-mutations.test.ts` (the `"the AI tool path cannot set coalesce"` test)

- [ ] **Step 1: Add the direct-field assertion**

Replace the test body's final assertion line with two:

```ts
    const opsLiteral = findEnclosingObjectLiteral(src, 'kind: "ops"');
    expect(opsLiteral).not.toMatch(/\.\.\./);
    // ★★ THE SPREAD BAN IS HALF THE PROPERTY. A spread is only the SHORTEST
    //  way to smuggle the flag through; `, coalesce: rawArgs.coalesce` is a
    //  direct field and passed the spread check untouched. Name the field.
    expect(opsLiteral).not.toMatch(/coalesce/);
```

and extend the test's leading comment with:

```ts
    // spread BEFORE `kind: "ops"` is caught too, not just one placed after.
    // It ALSO bans the field by name, because the object is built explicitly:
    // a spread is not the only way in.
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/app/document-mutations.test.ts --reporter=dot`
Expected: PASS.

- [ ] **Step 3: Prove it detects the hole**

Temporarily append `, coalesce: false` inside the `{ kind: "ops", id, ops: cleanOps, title }` literal at `src/app/use-document-tools.ts:366`. Re-run Step 2 and confirm it now **FAILS**. Revert and confirm green.

★ **Revert the mutant before committing.** `git diff src/app/use-document-tools.ts` must be empty.

- [ ] **Step 4: Commit**

```bash
git add src/app/document-mutations.test.ts
git commit -m "test(documents): ban the coalesce field by name, not only a spread"
```

**Mutant this kills:** adding the seven-character field name `coalesce` anywhere in that object literal. Verified by Step 3.

---

## Task 5: F1 — the draft must track an external write instead of clobbering it

**This is the CRITICAL finding.** Reproduce: Documents → Edit blocks → History → Restore → click into any field and click out → the pre-restore content is written back over the restored blocks, and (before Task 2) with no version recording that the restore ever happened.

Root cause, verified: `useBlockDraft` seeds `rawValue` (`:106`) and `liveValueRef` (`:125`) **at mount only**, and the no-deps effect (`:149-152`) advances **`baselineRef` alone**. Restore-in-place keeps `liveDoc.id`, so `DocumentEditor`'s `${doc.id}-${index}` keys are unchanged and nothing remounts; `editing` is local state in `document-edit-mode.tsx` and nothing closes edit mode. Both orderings then clobber:

- **clean draft** — the effect advances `baselineRef` to the restored block while the draft still holds the pre-restore value, so the next blur sees `blockChanged(baseline, draft) === true` and commits the STALE draft;
- **dirty draft** — `baselineRef` is frozen, and `commit()` (unlike the unmount path at `:181`) has **no** abandon guard, so the blur commits over the restore.

Per D1 the fix is option B — **guard + draft reconcile**:
1. a **dirty guard** and an **abandon guard** on `commit()` and `commitValue()`;
2. a **render-time reconcile** that re-seeds the draft from a changed `storedBlock` while undirty;
3. a **content refresh for the paragraph editor** — Tiptap binds `content` once at mount (`rich-text-editor.tsx`, `useEditor({ content: value })`), so a changed `value` prop cannot reach a mounted editor. `RichTextEditorHandle` exposes only `appendText`, which cannot replace content, so the refresh is a **remount key** driven by a seed nonce the hook returns.

Two constraints shape the implementation and neither is negotiable:
- `react-hooks/set-state-in-effect` is **fatal** → the reconcile is render-time.
- `react-hooks/refs` bans **writing** a ref during render → the reconcile cannot assign `liveValueRef.current`. It is mirrored in the existing after-every-render effect instead. **That mirror is provably a no-op on every other path:** `setValue` and `commitValue` both assign `liveValueRef.current` and call `setRawValue` with the *same* resolved value, and effects run after the commit of the render that batch produced — so at effect time `rawValue === liveValueRef.current` on every path except a render-time re-seed, which is exactly the one that cannot write the ref itself.

The hook's first parameter changes from a **value** (`initialValue: T`) to a **deriver** (`fromBlock: (block: B) => T`), because the reconcile needs to re-derive the draft from a block, not just from the mount-time value.

★ `fromBlock` can never be handed a wrong-kind block: `BlockEditor` (`document-editor.tsx:108-132`) returns a different component type per `block.type`, so a kind change at a position unmounts one editor and mounts another rather than re-rendering with a mismatched prop.

**Files:**
- Modify: `src/app/document-block-editors.tsx` (the hook + all four in-file call sites)
- Modify: `src/app/document-table-editor.tsx:34-45` (the fifth call site)
- Test: `src/app/document-block-editors.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block at the end of `src/app/document-block-editors.test.tsx`, before the file's final `});` if one closes an outer describe (otherwise at top level):

```ts
describe("useBlockDraft — an external write to the block being edited", () => {
  const heading: Extract<DocBlock, { type: "heading" }> = { type: "heading", level: 1, text: "Alpha" };
  const restored: Extract<DocBlock, { type: "heading" }> = { type: "heading", level: 1, text: "Restored" };

  // ★★★ THE RESTORE CLOBBER, CLEAN-DRAFT ORDERING. Restore-in-place keeps the
  //  document id, so nothing remounts. Before the fix the effect advanced
  //  `baselineRef` to the restored block while the draft still held "Alpha",
  //  so the next blur read them as different and wrote "Alpha" back over the
  //  restore. The draft must ADOPT the new block instead.
  it("adopts a changed storedBlock while the draft is untouched, and commits nothing on blur", () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <HeadingBlockEditor lang={LANG} index={0} block={heading} onCommit={onCommit} />,
    );
    rerender(<HeadingBlockEditor lang={LANG} index={0} block={restored} onCommit={onCommit} />);

    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    expect(text).toHaveValue("Restored");
    text.focus();
    text.blur();
    expect(onCommit).not.toHaveBeenCalled();
  });

  // ★★★ THE SAME CLOBBER, DIRTY-DRAFT ORDERING. Here `baselineRef` is frozen
  //  (that is the concurrent-write signal), and the UNMOUNT path already
  //  abandoned — but `commit()` did not, so a blur wrote the stale draft over
  //  the restore. Losing an unblurred keystroke burst is recoverable; silently
  //  destroying a committed write is not.
  it("abandons a dirty draft on blur when the stored block moved underneath it", async () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <HeadingBlockEditor lang={LANG} index={0} block={heading} onCommit={onCommit} />,
    );
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    await userEvent.type(text, "!"); // dirty, unblurred
    rerender(<HeadingBlockEditor lang={LANG} index={0} block={restored} onCommit={onCommit} />);

    text.blur();
    expect(onCommit).not.toHaveBeenCalled();
  });

  // ★ Tiptap binds `content` ONCE at mount, so the paragraph editor cannot
  //  adopt a new value by prop alone — the hook's seed nonce keys a remount.
  //  Asserting on the rendered TEXT (not a prop) is what makes this able to
  //  fail: a passed-but-ignored `value` prop looks identical from the outside.
  it("re-renders the paragraph editor's content when the stored block is replaced", () => {
    const before: Extract<DocBlock, { type: "paragraph" }> = { type: "paragraph", html: "<p>Alpha</p>" };
    const after: Extract<DocBlock, { type: "paragraph" }> = { type: "paragraph", html: "<p>Restored</p>" };
    const onCommit = vi.fn();
    const { rerender, container } = render(
      <ParagraphBlockEditor lang={LANG} index={0} block={before} onCommit={onCommit} />,
    );
    rerender(<ParagraphBlockEditor lang={LANG} index={0} block={after} onCommit={onCommit} />);
    expect(container.textContent).toContain("Restored");
    expect(container.textContent).not.toContain("Alpha");
  });

  // ★ A blur on an editor nobody touched must not even ASK the toBlock/
  //  blockChanged pair — and, more importantly, must not be able to commit.
  it("commits nothing on a blur with no edit", () => {
    const onCommit = vi.fn();
    render(<HeadingBlockEditor lang={LANG} index={0} block={heading} onCommit={onCommit} />);
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    text.focus();
    text.blur();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
```

★ `headingTextName(0)` is a helper Task 11 introduces; **until Task 11 lands, spell it inline** as `` `${t(LANG, "documentsHeadingText")} 1` `` at all three sites, and Task 11 rewrites them. Add whatever of `HeadingBlockEditor` / `ParagraphBlockEditor` / `DocBlock` / `userEvent` the file does not already import.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/app/document-block-editors.test.tsx --reporter=dot`
Expected: FAIL on the first three (`toHaveValue("Restored")` reports `"Alpha"`; the dirty test sees `onCommit` called once; the paragraph test's `textContent` still contains `"Alpha"`). The fourth already passes — it is the regression guard for the dirty-guard change.

- [ ] **Step 3: Rewrite the hook**

Replace `useBlockDraft`'s signature and body in `src/app/document-block-editors.tsx` (lines 99-191) with:

```ts
export function useBlockDraft<T, B extends DocBlock>(
  fromBlock: (block: B) => T,
  storedBlock: B,
  index: number,
  toBlock: (value: T) => DocBlock,
  onCommit: (index: number, block: DocBlock) => void,
) {
  const [rawValue, setRawValue] = useState(() => fromBlock(storedBlock));

  // Whether the draft has a local edit since the last sync point (mount, a
  // successful commit, or an external storedBlock adoption while
  // untouched — see the reconcile below). Set ONLY by the wrapped setValue
  // this hook returns, never inferred from comparing draft/baseline content:
  // content alone cannot tell "genuinely edited" apart from "untouched, but
  // the baseline moved out from under it", and conflating the two would make
  // an untouched editor's unmount flush try to commit content nobody typed.
  const dirtyRef = useRef(false);

  // A SYNCHRONOUS mirror of the draft's true current value. `rawValue`
  // (React state) is only EVENTUALLY consistent — a `setRawValue` call does
  // not update what a later line in the SAME tick reads, let alone what a
  // second handler invoked later in the same batched event reads. Every
  // value-producing call (`setValue`, `commitValue`) resolves a functional
  // updater against this ref and updates it immediately, so calls stack
  // correctly regardless of render timing.
  const liveValueRef = useRef(rawValue);

  const resolveValue = (next: T | ((prev: T) => T)): T =>
    typeof next === "function" ? (next as (prev: T) => T)(liveValueRef.current) : next;

  const setValue = (next: T | ((prev: T) => T)) => {
    dirtyRef.current = true;
    const resolved = resolveValue(next);
    liveValueRef.current = resolved;
    setRawValue(resolved);
  };

  // The block this draft is currently derived from. Advances to `next` on
  // every successful commit; is RE-SEEDED to the live `storedBlock` on every
  // render where the draft is not dirty; and is deliberately FROZEN the moment
  // `dirtyRef` goes true, so a concurrent write arriving WHILE the user has a
  // pending edit stays visible as a mismatch against the live prop — that
  // mismatch is the concurrent-write guard's whole signal.
  const baselineRef = useRef<DocBlock>(storedBlock);

  // ★★★ RENDER-TIME RECONCILE, NOT AN EFFECT. `react-hooks/set-state-in-effect`
  //  is a FATAL lint error in CI, so adopting a changed prop uses the repo's
  //  standard `if (prop !== handled) { setState(...) }` shape guarded by
  //  last-seen state.
  //
  //  WHY IT EXISTS: a restore-in-place keeps the document id, so
  //  `DocumentEditor`'s `${doc.id}-${index}` keys do not change and NOTHING
  //  remounts. Without this the draft stayed seeded from the pre-restore block
  //  while `baselineRef` advanced past it, and the next blur wrote the stale
  //  draft back over the restored content — silent data loss (F1).
  //
  //  ★ Only while UNDIRTY. A pending user edit is not discarded by a
  //   concurrent write; it is abandoned at commit time instead (see below), so
  //   the user still sees what they typed and can re-apply it.
  //  ★ `fromBlock` cannot receive a wrong-kind block: `BlockEditor` switches
  //   on `block.type` and returns a different component per kind, so a kind
  //   change at one position unmounts this editor rather than re-rendering it.
  const [handledBlock, setHandledBlock] = useState<DocBlock>(storedBlock);
  const [seedNonce, setSeedNonce] = useState(0);
  if (storedBlock !== handledBlock) {
    setHandledBlock(storedBlock);
    if (!dirtyRef.current) {
      setRawValue(fromBlock(storedBlock));
      // Bumped so a consumer whose child binds its content ONCE at mount (the
      // paragraph editor's Tiptap surface) can key a remount off it. A plain
      // value prop cannot reach a mounted editor.
      setSeedNonce((n) => n + 1);
    }
  }

  const latestRef = useRef({ toBlock, onCommit, index, storedBlock: storedBlock as DocBlock });
  useEffect(() => {
    // ★★★ THE ONE LEGAL PLACE TO PROPAGATE A RENDER-TIME RE-SEED.
    //  `react-hooks/refs` bans WRITING a ref during render, so the reconcile
    //  above cannot assign `liveValueRef` itself. This assignment is a NO-OP on
    //  every other path — `setValue`/`commitValue` set the ref and the state to
    //  the SAME resolved value, and effects run after the commit of whatever
    //  render that batch produced, so `rawValue === liveValueRef.current`
    //  already. Do not "simplify" it away: the re-seed is the one path where
    //  they differ, and it is the path this whole reconcile exists for.
    liveValueRef.current = rawValue;
    if (!dirtyRef.current) baselineRef.current = storedBlock;
    latestRef.current = { toBlock, onCommit, index, storedBlock };
  });

  /** Shared by `commit` and `commitValue`. Returns true when the write landed. */
  const tryCommit = (next: DocBlock): boolean => {
    if (!blockChanged(baselineRef.current, next)) return false;
    // ★★★ ABANDON RATHER THAN CLOBBER — and this now applies to a BLUR too,
    //  which is a change of policy from the first cut. It used to hold only on
    //  the unmount path, on the reasoning that a deliberate commit may
    //  last-write-wins. That reasoning does not survive the restore case: the
    //  user's "deliberate" act is clicking OUT of a field, which they do
    //  reflexively and which carries no intent to overwrite a restore that
    //  landed while the field was focused. Losing an unblurred keystroke burst
    //  is recoverable (re-type it); destroying a committed write is not — AI
    //  and restore writes carry no undo.
    if (blockChanged(baselineRef.current, latestRef.current.storedBlock)) return false;
    baselineRef.current = next;
    onCommit(index, next);
    return true;
  };

  const commit = () => {
    // ★ DIRTY GUARD. Without it every focusout on an untouched editor ran the
    //  full toBlock/blockChanged pair against a baseline that may have moved,
    //  which is how the clean-draft ordering of F1 wrote a stale value.
    if (!dirtyRef.current) return;
    tryCommit(toBlock(liveValueRef.current));
    dirtyRef.current = false;
  };

  const commitValue = (next: T | ((prev: T) => T)) => {
    // ★ NO dirty guard here, deliberately: a structural click (add/remove/
    //  move/toggle, or picking a select option) IS the edit, and demanding a
    //  prior `setValue` would make the first click a no-op. The abandon guard
    //  inside tryCommit still applies.
    const resolved = resolveValue(next);
    liveValueRef.current = resolved;
    setRawValue(resolved);
    tryCommit(toBlock(resolved));
    dirtyRef.current = false;
  };

  useEffect(() => {
    return () => {
      if (!dirtyRef.current) return; // never edited (or already committed) — nothing pending
      const latest = latestRef.current;
      const next = latest.toBlock(liveValueRef.current);
      if (!blockChanged(baselineRef.current, next)) return; // dirty flag set, but content is a no-op (e.g. reverted)
      if (blockChanged(baselineRef.current, latest.storedBlock)) return; // concurrent write since baseline froze — abandon
      latest.onCommit(latest.index, next);
    };
    // Deliberately mount-only: the effect body does nothing, and only its
    // cleanup — which fires exactly once, at real unmount — matters. No
    // exhaustive-deps disable needed: everything the cleanup reads comes
    // through a ref, which the rule does not treat as a dependency.
  }, []);

  return { value: rawValue, setValue, commit, commitValue, seedNonce };
}
```

★ The unmount cleanup deliberately keeps its own inline copy of the two guards rather than calling `tryCommit`: it must read everything through `latestRef` (the render-scope `index`/`onCommit` are stale at unmount), and folding the two would make one of them wrong. Leave the duplication and this note.

- [ ] **Step 4: Correct the hook's docblock**

The docblock at lines 31-98 asserts the OPPOSITE of what the hook now does in two places. Replace its `★★★ THE CONTRACT` section (the numbered items 1 and 2) with:

```
 * ★★★ THE CONTRACT, PRECISELY (three rules):
 *
 * 1. UNMOUNT FLUSH. A pending, genuinely-changed draft with no blur is real
 *    data loss: leaving edit mode, navigating away, or a block-list
 *    re-render dropping this block all skip the DOM blur event `commit`
 *    relies on, discarding the user's edit with no warning. The mount-only
 *    effect below flushes such a draft on teardown — but ONLY if `dirtyRef`
 *    is set (the wrapped `setValue` below sets it on every draft edit), so
 *    an editor that was never touched, or one whose blur already committed
 *    (which resets `dirtyRef`), flushes nothing.
 *
 * 2. CONCURRENT-WRITE GUARD, ON EVERY COMMIT PATH. If `storedBlock` moved
 *    since the draft's baseline froze — a restore, a concurrent AI write,
 *    another client — the commit ABANDONS rather than silently destroying
 *    that write. ★★★ THIS APPLIES TO A BLUR TOO. An earlier revision of this
 *    comment said a deliberate commit "MAY overwrite whatever is stored —
 *    last-write-wins is defensible there", and that was the bug: the user's
 *    deliberate act is clicking OUT of a field, which carries no intent to
 *    overwrite a restore that landed while it was focused. Losing an
 *    unblurred keystroke burst is recoverable; destroying a committed write
 *    is not, since AI and restore writes carry no undo.
 *
 * 3. UNDIRTY ADOPTION. While the draft is untouched it TRACKS `storedBlock`
 *    via the render-time reconcile, so an external write reaches the field
 *    the user is looking at. Without this the draft went stale while
 *    `baselineRef` advanced past it, and the next blur wrote the stale value
 *    back — the F1 clobber.
```

- [ ] **Step 5: Update the five call sites**

`document-block-editors.tsx` — heading (`:249-255`):

```ts
  const { value, setValue, commit } = useBlockDraft(
    (b: Extract<DocBlock, { type: "heading" }>): HeadingDraft => ({ level: b.level, text: b.text }),
    block,
    index,
    (v): DocBlock => ({ type: "heading", level: v.level, text: v.text }),
    onCommit,
  );
```

paragraph (`:309-315`) — now also returning `seedNonce`, and keying the editor with it:

```ts
  const { value: html, setValue: setHtml, commit, seedNonce } = useBlockDraft(
    (b: Extract<DocBlock, { type: "paragraph" }>): string => b.html,
    block,
    index,
    (nextHtml): DocBlock => ({ type: "paragraph", html: nextHtml }),
    onCommit,
  );

  return (
    <div onBlur={commit}>
      {/* ★★★ KEYED ON THE SEED NONCE. Tiptap binds `content` ONCE at mount
          (`useEditor({ content: value })` in rich-text-editor.tsx), so a
          changed `value` prop CANNOT reach a mounted editor — the only two
          ways in are the imperative handle (which offers `appendText` alone,
          and cannot replace content) and a remount. The nonce bumps only when
          the hook adopts an external write while undirty, so ordinary typing
          never remounts and never loses the caret. */}
      <RichTextEditor
        key={seedNonce}
        value={html}
        onChange={setHtml}
        label={t(lang, "documentsParagraphLabel", String(index + 1))}
        lang={lang}
      />
    </div>
  );
```

bullets (`:360-369`):

```ts
  const { value, setValue, commit, commitValue } = useBlockDraft(
    (b: Extract<DocBlock, { type: "bullets" }>): BulletsDraft => ({
      items: b.items,
      ordered: b.ordered === true,
    }),
    block,
    index,
    (v): DocBlock =>
      v.ordered
        ? { type: "bullets", items: [...v.items], ordered: true }
        : { type: "bullets", items: [...v.items] },
    onCommit,
  );
```

dataSection (`:508-514`):

```ts
  const { value, commitValue } = useBlockDraft(
    (b: Extract<DocBlock, { type: "dataSection" }>): ExportSectionKey => b.key,
    block,
    index,
    (key): DocBlock => ({ type: "dataSection", key }),
    onCommit,
  );
```

`document-table-editor.tsx` (`:34-45`):

```ts
  const { value, setValue, commit, commitValue } = useBlockDraft(
    (b: Extract<DocBlock, { type: "table" }>): TableDraft => ({
      caption: b.caption ?? "",
      columns: b.columns,
      rows: b.rows,
    }),
    block,
    index,
    // ★ Caption is OPTIONAL and sparse: an empty one is omitted, so a table
    //  that never had a caption serializes exactly as it did before.
    (v): DocBlock =>
      v.caption
        ? { type: "table", caption: v.caption, columns: [...v.columns], rows: v.rows.map((r) => [...r]) }
        : { type: "table", columns: [...v.columns], rows: v.rows.map((r) => [...r]) },
    onCommit,
  );
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/app/document-block-editors.test.tsx src/app/document-editor.test.tsx src/app/documents-panel.test.tsx --reporter=dot`
Expected: PASS. Then `npx tsc --noEmit` (exit 0) and `npx eslint --max-warnings=0 src/app/document-block-editors.tsx src/app/document-table-editor.tsx` (exit 0, checked **unpiped**).

★ If eslint objects to the render-time `setSeedNonce`/`setHandledBlock` pair, the shape is wrong, not the rule — the setters must be called from the render body under a `!==` guard, exactly as written, with no `useEffect` anywhere near them.

- [ ] **Step 7: Prove each new test kills its mutant**

Run the four one at a time, reverting between:

| Mutant (smallest token change) | Test that must go red |
|---|---|
| delete `setRawValue(fromBlock(storedBlock));` from the reconcile | *adopts a changed storedBlock…* (`toHaveValue` reports `"Alpha"`) |
| delete `if (blockChanged(baselineRef.current, latestRef.current.storedBlock)) return false;` from `tryCommit` | *abandons a dirty draft on blur…* (`onCommit` called once) |
| delete `key={seedNonce}` from `<RichTextEditor>` | *re-renders the paragraph editor's content…* (`textContent` still `"Alpha"`) |
| delete `if (!dirtyRef.current) return;` from `commit` | *commits nothing on a blur with no edit* — ★ **check this one honestly**: with the abandon guard in place it may survive, because `blockChanged(baseline, next)` is already false on an untouched editor. **If it survives, say so in the commit message and keep the test as a regression guard rather than claiming it pins the guard** — a surviving mutant is a question, not a licence to delete the guard (the guard is what stops an untouched blur consulting a baseline that has moved). Do not weaken the assertion to manufacture a kill.

- [ ] **Step 8: Commit**

```bash
git add src/app/document-block-editors.tsx src/app/document-table-editor.tsx src/app/document-block-editors.test.tsx
git commit -m "fix(documents): stop a block draft clobbering an external write

A restore-in-place keeps the document id, so no block editor remounts.
The draft was seeded at mount only while baselineRef advanced past it, so
the next blur wrote the pre-restore content back over the restored blocks.
The draft now adopts a changed storedBlock while untouched (render-time
reconcile), and every commit path abandons rather than clobbering when the
stored block moved under a dirty draft."
```

---

## Task 6: F12 — correct the comment that explains the wrong mechanism

`document-block-editors.test.tsx:581-586` explains its `rerender` with a mechanism the hook does not have. **Sequenced after Task 5 deliberately**, because Task 5 changes what the true mechanism is: the effect no longer merely re-seeds `baselineRef` behind a cleared `dirtyRef` — the render-time reconcile also re-derives the draft.

**Files:**
- Test: `src/app/document-block-editors.test.tsx` (the comment above *"flushes a pending item-text edit on unmount after a structural action already committed"*)

- [ ] **Step 1: Replace the explanation with what actually happens**

Replace the `★ The rerender with the post-add block…` paragraph with:

```ts
  //  ★★ WHY THE `rerender`, PRECISELY. It is NOT a nicety and it is not the
  //   mechanism an earlier revision of this comment described. `commitValue`
  //   clears `dirtyRef`, so on the NEXT render two things fire against the
  //   still-ORIGINAL `block` prop: the render-time reconcile re-derives the
  //   draft from it (undoing the add on screen), and the after-every-render
  //   effect re-seeds `baselineRef` to it. Feeding the committed block back
  //   down — which is exactly what a real parent does after `onCommit` — is
  //   what stops this isolated fixture fighting its own commit.
```

- [ ] **Step 2: Run**

Run: `npx vitest run src/app/document-block-editors.test.tsx --reporter=dot`
Expected: PASS (comment-only change).

- [ ] **Step 3: Commit**

```bash
git add src/app/document-block-editors.test.tsx
git commit -m "test(documents): explain the rerender by the mechanism the hook has"
```

**Mutant:** none — this is a comment. It is a separate commit precisely because a comment change buried in Task 5 would be invisible in review.

---

## Task 7: F3 — never commit a block the loader will discard

`document-model.ts` drops an empty heading (`:115`), a paragraph with no visible text (`:127`) and an empty bullets list (`:137`). The editor can produce all three, the commit lands, the block renders for the rest of the session, and it is **gone on next load** — and this slice ships no add-block control to recreate it.

Two fixes, mirroring what the repo already does:
1. **A lower bound on `removeItem`**, exactly as `document-table-editor.tsx:131`/`:159` bound remove-column/remove-row.
2. **A commit refusal for a block the loader would discard**, with a visible reason — because "a disabled control with no reason reads as broken" (`document-block-editors.tsx:290-294`), and a silent refusal is the same defect one layer down.

The predicate **delegates to the real loader** rather than restating its three rules. Restating them is the "one rule at two places" drift this codebase keeps getting bitten by, and `sanitizeDocumentVersions` already establishes the delegation pattern for exactly this reason ("*one implementation, not two that can drift*", `document-versions.ts:90-94`). `sanitizeBlock` is not exported; `sanitizeProjectDocuments` is.

**Files:**
- Modify: `src/app/document-editor-commit.ts` (new pure predicate — **serialise after Task 2**)
- Modify: `src/app/document-block-editors.tsx` (the bound + the notice — **serialise after Task 5**)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (one new key)
- Test: `src/app/document-editor-commit.test.ts`, `src/app/document-block-editors.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/document-editor-commit.test.ts`:

```ts
describe("blockSurvivesLoad", () => {
  // Mirrors document-model.ts's three drop rules WITHOUT restating them — it
  // asks the real loader. A block the editor can produce but the loader
  // discards is silent data loss: it renders for the session and is gone on
  // the next load, and this slice ships no add-block control to recreate it.
  it("rejects the three shapes sanitizeProjectDocuments drops", () => {
    expect(blockSurvivesLoad({ type: "heading", level: 1, text: "   " })).toBe(false);
    expect(blockSurvivesLoad({ type: "paragraph", html: "<p></p>" })).toBe(false);
    expect(blockSurvivesLoad({ type: "bullets", items: [] })).toBe(false);
    expect(blockSurvivesLoad({ type: "bullets", items: ["", "  "] })).toBe(false);
  });

  it("accepts every block kind that survives a load", () => {
    expect(blockSurvivesLoad({ type: "heading", level: 2, text: "Q3" })).toBe(true);
    expect(blockSurvivesLoad({ type: "paragraph", html: "<p>x</p>" })).toBe(true);
    expect(blockSurvivesLoad({ type: "bullets", items: ["a"] })).toBe(true);
    expect(blockSurvivesLoad({ type: "pageBreak" })).toBe(true);
    expect(blockSurvivesLoad({ type: "dataSection", key: "tasks" })).toBe(true);
    expect(blockSurvivesLoad({ type: "table", columns: ["c"], rows: [["v"]] })).toBe(true);
  });
});
```

and add `blockSurvivesLoad` to that file's import list.

Append to `src/app/document-block-editors.test.tsx`:

```ts
describe("blocks the loader would discard", () => {
  it("cannot remove the last bullet item", () => {
    const single: Extract<DocBlock, { type: "bullets" }> = { type: "bullets", items: ["only"] };
    render(<BulletsBlockEditor lang={LANG} index={0} block={single} onCommit={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: qualified(t(LANG, "documentsRemoveItem", "1")) }),
    ).toBeDisabled();
  });

  it("refuses to commit an emptied heading and says why", async () => {
    const onCommit = vi.fn();
    const block: Extract<DocBlock, { type: "heading" }> = { type: "heading", level: 1, text: "Alpha" };
    render(<HeadingBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    const text = screen.getByRole("textbox", { name: `${t(LANG, "documentsHeadingText")} 1` });
    await userEvent.clear(text);
    text.blur();
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(t(LANG, "documentsBlockEmptyNotSaved"))).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/app/document-editor-commit.test.ts src/app/document-block-editors.test.tsx --reporter=dot`
Expected: FAIL — `blockSurvivesLoad` is not exported; the remove button is enabled; `onCommit` is called with the empty heading.

- [ ] **Step 3: Add the pure predicate**

Append to `src/app/document-editor-commit.ts`:

```ts
/** A canonical ISO stamp for the throwaway document the predicate below
 *  builds. `sanitizeProjectDocuments` validates `createdAt`/`updatedAt`, so a
 *  non-canonical value would make every block look invalid. */
const PROBE_STAMP = "2000-01-01T00:00:00.000Z";

/**
 * Would this block survive a load?
 *
 * ★★★ IT ASKS THE REAL LOADER, and that is the whole point. `document-model.ts`
 *  drops an empty heading, a paragraph with no visible text and an empty
 *  bullets list — three rules that a second copy here would drift from the
 *  moment a fourth is added. `sanitizeDocumentVersions` delegates to the same
 *  function for the same reason ("one implementation, not two that can
 *  drift"), so this follows an established pattern rather than inventing one.
 *
 * ★ Both modules are DOM-FREE by contract, so this import cannot break either.
 *  Do NOT reach for DOMPurify here: `document-editor-commit.ts` is DOM-free
 *  and i18n-free by contract (see this file's header).
 */
export function blockSurvivesLoad(block: DocBlock): boolean {
  const [doc] = sanitizeProjectDocuments([
    { id: 1, title: "probe", blocks: [block], createdAt: PROBE_STAMP, updatedAt: PROBE_STAMP },
  ]);
  return doc?.blocks.length === 1;
}
```

with the import added at the top of that file:

```ts
import { sanitizeProjectDocuments } from "./document-model";
```

★ `document-editor-commit.ts` already imports `type DocBlock` from `./document-model`; this makes it a runtime import. That is safe — `document-model.ts` is DOM-free by contract with a source-scan test enforcing it — but re-run `npx vitest run src/app/document-model.test.ts src/app/document-mutations.test.ts` in Step 6 to confirm no cycle surfaced (`document-model.ts` documents a runtime cycle with `settings-types.ts`).

- [ ] **Step 4: Add the i18n key**

`src/app/i18n.ts`, next to `documentsBlockNoEditor`:

```ts
  documentsBlockEmptyNotSaved:
    "Empty content is not saved — this block keeps the text it had.",
```

`src/app/i18n.de.ts`, at the matching position:

```ts
  documentsBlockEmptyNotSaved:
    "Leerer Inhalt wird nicht gespeichert – dieser Block behält seinen bisherigen Text.",
```

★★ `i18n.de.ts` is **CRLF** and the Edit tool corrupts umlauts there ("behält" carries one, and the string uses an en dash). Patch it with a node UTF-8 write whose anchor uses `\r\n`, then verify:

```bash
node -e "const fs=require('fs');const p='src/app/i18n.de.ts';let s=fs.readFileSync(p,'utf8');const a='  documentsBlockNoEditor:';if(!s.includes(a))throw new Error('anchor missing');s=s.replace(a,'  documentsBlockEmptyNotSaved:\r\n    \"Leerer Inhalt wird nicht gespeichert – dieser Block behält seinen bisherigen Text.\",\r\n'+a);fs.writeFileSync(p,s,'utf8');"
grep -n "documentsBlockEmptyNotSaved" src/app/i18n.de.ts
```

Expected: the grep prints the line with a real `ä` and a real `–`. The `i18n-encoding` test BANS ASCII substitutions (`behaelt`) and `\u00XX` escapes **in the file** — the escapes above live in the shell command that writes real characters, which is the documented way to get them there.

- [ ] **Step 5: Wire the guard and the notice**

In `src/app/document-block-editors.tsx`, import the predicate:

```ts
import { paragraphHasImage, blockChanged, blockSurvivesLoad } from "./document-editor-commit";
```

In `useBlockDraft`, add a `dropped` state and check it inside `tryCommit`, replacing that function with:

```ts
  const [dropped, setDropped] = useState(false);

  /** Shared by `commit` and `commitValue`. Returns true when the write landed. */
  const tryCommit = (next: DocBlock): boolean => {
    if (!blockChanged(baselineRef.current, next)) { setDropped(false); return false; }
    // ★★★ NEVER COMMIT A BLOCK THE LOADER DISCARDS. An emptied heading, a
    //  paragraph with no visible text or a bullets list with nothing in it all
    //  commit fine, render for the rest of the session, and are GONE on the
    //  next load — and this slice ships no add-block control to recreate one.
    //  Refusing is right; refusing SILENTLY is the same "disabled control with
    //  no reason" defect the image guard exists to avoid, so the consumer
    //  renders `documentsBlockEmptyNotSaved` while this is true.
    if (!blockSurvivesLoad(next)) { setDropped(true); return false; }
    setDropped(false);
    if (blockChanged(baselineRef.current, latestRef.current.storedBlock)) return false;
    baselineRef.current = next;
    onCommit(index, next);
    return true;
  };
```

and return it: `return { value: rawValue, setValue, commit, commitValue, seedNonce, dropped };`

Add the notice to the heading, paragraph and bullets editors. Heading — destructure `dropped` and wrap the return:

```tsx
  return (
    <div className="flex flex-col gap-1" onBlur={commit}>
      <div className="flex flex-wrap items-center gap-2">
        {/* …the existing select and input, unchanged… */}
      </div>
      {dropped && <BlockDroppedNotice lang={lang} />}
    </div>
  );
```

★ The `onBlur` moves to the NEW outer div so the notice stays inside the blur group — a notice rendered outside it would be unreachable by the focusout that produced it.

Bullets and paragraph take the same `{dropped && <BlockDroppedNotice lang={lang} />}` as the last child of their existing outer `<div onBlur={commit}>`.

Add the shared notice beside `BlockReadOnlyNotice`:

```tsx
/** Shown when a commit was refused because the block would not survive a load
 *  (`blockSurvivesLoad`). ★ Never silent: a refusal with no reason reads
 *  exactly like a broken editor — the same principle as the image guard. */
function BlockDroppedNotice({ lang }: { lang: Lang }) {
  return <p className="text-xs text-ui-pink">{t(lang, "documentsBlockEmptyNotSaved")}</p>;
}
```

- [ ] **Step 6: Add the bullets lower bound**

In `BulletsBlockEditor`, the remove button gains a bound matching the table editor's:

```tsx
            <button
              type="button"
              aria-label={qualify(t(lang, "documentsRemoveItem", String(i + 1)))}
              // ★ Mirrors document-table-editor.tsx's remove-row/remove-column
              //  bounds. Removing the last item produces `items: []`, which
              //  document-model.ts drops on load — the block would render for
              //  the session and vanish, with no add-block control to bring it
              //  back. A real `disabled` attribute, never `aria-disabled`:
              //  the lookalike still fires onClick.
              disabled={value.items.length <= 1}
              className="rounded-md border border-line px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => removeItem(i)}
            >
```

- [ ] **Step 7: Run everything this touched**

Run: `npx vitest run src/app/document-editor-commit.test.ts src/app/document-block-editors.test.tsx src/app/document-model.test.ts src/app/document-mutations.test.ts src/app/i18n.test.ts --reporter=dot`
Expected: PASS.
Then `npx tsc --noEmit` (exit 0 — this is what enforces EN/DE key parity) and `npx eslint --max-warnings=0 src/app` (exit 0, **unpiped**).

- [ ] **Step 8: Commit**

```bash
git add src/app/document-editor-commit.ts src/app/document-block-editors.tsx src/app/document-editor-commit.test.ts src/app/document-block-editors.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "fix(documents): refuse to commit a block the loader would discard"
```

**Mutants these kill:**
- `disabled={value.items.length <= 1}` → `<= 0`: *cannot remove the last bullet item* goes red.
- delete `if (!blockSurvivesLoad(next)) { setDropped(true); return false; }`: *refuses to commit an emptied heading* goes red on `expect(onCommit).not.toHaveBeenCalled()`.
- `setDropped(true)` → `setDropped(false)`: the same test goes red on the `getByText` assertion — so the refusal and its explanation are pinned **separately**, and a silent refusal cannot pass.

---

## Task 8: F4a — make the document-switch tests detect what they are named for

`documents-panel.test.tsx`'s last test asserts `expect(committedIds).not.toContain(docB.id)`, which is **vacuous twice over**:
- `.not.toContain` passes on an **empty** array, so it stays green with the unmount flush deleted, with `key={index}` restored, and with `use-document-editor.ts:49`'s guard deleted (the `7627329d` commit message records that last one);
- `userEvent.click` on doc B's button **blurs the input first**, so `commit()` fires while doc A is still selected and the "pending unblurred" premise never holds.

The repair is two tests, because one cannot reach both mutants:
- the panel test asserts the **positive** and reaches the switch **without a prior blur** (`fireEvent.click` dispatches a click and moves no focus, so the input stays focused and dirty);
- a hook-level test kills the `documentId !== currentDocIdRef.current` guard, which the panel test structurally cannot: at unmount-cleanup time React has not yet run the parent's `[documentId]` effect, so `currentDocIdRef` still holds doc A's id and the guard does not fire either way.

**Files:**
- Test: `src/app/documents-panel.test.tsx` (the final test)
- Create: `src/app/use-document-editor.test.ts`

- [ ] **Step 1: Rewrite the panel test**

Replace the whole `it("never commits a pending unblurred edit against the newly-selected document's id", ...)` block with:

```tsx
  // ★★★ ASSERT THE POSITIVE. `.not.toContain` passes on an EMPTY array, so the
  //  first cut of this test stayed green with the unmount flush deleted, with
  //  `key={index}` restored, AND with use-document-editor's document-switch
  //  guard deleted. The flush MUST happen, and it must land on doc A.
  //  ★★ `fireEvent.click`, never `userEvent.click`: userEvent moves focus, so
  //   it blurs the input BEFORE the switch and commits through the ordinary
  //   blur path — the "pending unblurred edit" this test is named for never
  //   exists. fireEvent dispatches the click alone and leaves focus put.
  it("flushes a pending unblurred edit to the OLD document on a switch, never the new one", async () => {
    const { mutateDocuments } = renderWithSpy();
    await userEvent.click(screen.getByRole("button", { name: docA.title }));
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "documentsEditBlocks") }));
    const text = await screen.findByRole("textbox", { name: `${t("en-US", "documentsHeadingText")} 1` });
    await userEvent.type(text, "!"); // dirty, unblurred — and still focused

    fireEvent.click(screen.getByRole("button", { name: docB.title }));

    const committed = mutateDocuments.mock.calls.map(([m]) => m as { id?: number; ops?: unknown[] });
    const ids = committed.map((m) => m.id);
    expect(ids).toContain(docA.id);
    expect(ids).not.toContain(docB.id);
    // ...and it carried the EDITED text, not docA's stored text — otherwise a
    // flush that wrote the wrong content would still satisfy the id assertions.
    const op = committed.find((m) => m.id === docA.id)?.ops?.[0] as
      | { block?: { text?: string } }
      | undefined;
    expect(op?.block?.text).toBe("Alpha!");
  });
```

Add `fireEvent` to the `@testing-library/react` import in that file.

- [ ] **Step 2: Create the hook guard test**

Create `src/app/use-document-editor.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDocumentEditor } from "./use-document-editor";
import type { DocMutation, DocResult } from "./document-mutations";
import type { DocVersionSource } from "./document-versions";

const NOW = "2026-08-18T10:00:00.000Z";

function result(): DocResult {
  return { documents: [], versions: [], changed: true, rejected: [], documentId: 1 };
}

describe("useDocumentEditor — the document-switch guard", () => {
  // ★★★ THE ONLY TEST THAT CAN KILL THIS GUARD. At the panel level the block
  //  editor's unmount CLEANUP runs before the parent's [documentId] effect, so
  //  `currentDocIdRef` still holds the OLD id and the guard never fires — the
  //  panel test passes with the guard deleted. Driving the hook directly is
  //  what makes a genuinely STALE commitBlock closure reachable: capture it for
  //  document 1, rerender at document 2 (letting the effect run), then call the
  //  closure that document 1 minted.
  it("abandons a commit from a closure minted for a document that is no longer selected", () => {
    const mutateDocuments = vi.fn(
      (_m: DocMutation, _source: DocVersionSource): DocResult => result(),
    );
    const { result: hook, rerender } = renderHook(
      ({ documentId }: { documentId: number }) =>
        useDocumentEditor({ documentId, versions: [], mutateDocuments, now: () => NOW }),
      { initialProps: { documentId: 1 } },
    );
    const staleCommit = hook.current.commitBlock;

    rerender({ documentId: 2 });

    expect(staleCommit(0, { type: "heading", level: 1, text: "x" })).toBeUndefined();
    expect(mutateDocuments).not.toHaveBeenCalled();
  });

  it("commits normally through a closure minted for the selected document", () => {
    const mutateDocuments = vi.fn(
      (_m: DocMutation, _source: DocVersionSource): DocResult => result(),
    );
    const { result: hook } = renderHook(() =>
      useDocumentEditor({ documentId: 1, versions: [], mutateDocuments, now: () => NOW }),
    );
    hook.current.commitBlock(0, { type: "heading", level: 1, text: "x" });
    expect(mutateDocuments).toHaveBeenCalledTimes(1);
    expect(mutateDocuments.mock.calls[0][0]).toMatchObject({ kind: "ops", id: 1 });
  });
});
```

★ **Lint watch:** CI runs `eslint --max-warnings=0` with **no** `argsIgnorePattern`, so `_m`/`_source` are fatal as *unused parameters* if the rule is configured for parameters. If eslint objects, drop the parameter list entirely — `vi.fn((): DocResult => result())` is assignable to the two-argument type and the test asserts on `mock.calls`, not on the parameters.

★ `use-document-editor.ts` is in `vitest.config.ts` `coverage.exclude` (line 68). Testing an excluded file is fine and raises no floor; the exclusion is about the *gate*, not about testability.

- [ ] **Step 3: Run**

Run: `npx vitest run src/app/documents-panel.test.tsx src/app/use-document-editor.test.ts --reporter=dot`
Expected: PASS.

- [ ] **Step 4: Prove the mutants die**

| Mutant | Test that goes red |
|---|---|
| `document-editor.tsx`: `key={`${doc.id}-${index}`}` → `key={index}` | panel test — nothing remounts, no flush, `ids` is empty, `toContain(docA.id)` fails |
| `document-block-editors.tsx`: delete the unmount `useEffect`'s `return () => {…}` | panel test — same, `ids` empty |
| `use-document-editor.ts`: delete `if (documentId !== currentDocIdRef.current) return undefined;` | hook test — `mutateDocuments` called once |

Run each, confirm red, revert, confirm green. `git diff` must be empty before Step 5.

- [ ] **Step 5: Commit**

```bash
git add src/app/documents-panel.test.tsx src/app/use-document-editor.test.ts
git commit -m "test(documents): assert the positive on the document-switch flush

.not.toContain passes on an empty array, so the old test was green with the
unmount flush deleted, with key={index} restored, and with the hook's
document-switch guard deleted. Split into a panel test that asserts the
flush LANDED on doc A with the edited text, and a hook test that is the only
thing able to reach a genuinely stale commitBlock closure."
```

---

## Task 9: F5 + F7 — the Edit-blocks toggle must not lie, and a disabled toggle must explain itself

**F5:** `documents-toolbar.tsx:155-163` gates only on `disabled={isReadOnly}`, but `document-edit-mode.tsx:59` also needs a non-null `doc`. With zero documents the toggle presses, reports `aria-pressed="true"`, and nothing happens — WCAG 4.1.2 plus a false affordance. The sibling Download button already implements the convention (`canDownload={selected !== null}` at `documents-panel.tsx:570` → `disabled={!canDownload}` at `documents-toolbar.tsx:114`).

**F7:** `toggle-button.tsx:52-55` documents `ariaDescribedBy` as *required reading* for a disabled toggle ("it leaves the tab order and so cannot explain itself"), and `:119-122` suppresses the state suffix while disabled, so a disabled toggle with no description announces a bare name and nothing else. **Both the new toggle and the pre-existing `AddButton` are fixed** — they are disabled by overlapping conditions, so fixing one and leaving the other produces a toolbar where one inert control explains itself and its neighbour does not, which is worse than either state. This costs no primitive change: `AddButton` spreads `...props` onto `<Button>` and its prop type is `ButtonHTMLAttributes`, so `aria-describedby` passes straight through.

Because the toggle now has **two** disabling reasons with different explanations, the description text is derived, not fixed.

### Line budget for `documents-panel.tsx` — read this before editing

The file is at **799 of 800** and is **not** baselined, so 801 fails outright. This task must not spend the one remaining line, and Tasks 13 and 14 both want to touch the file afterwards. It therefore **pays for itself and one more**: the three edit-mode toolbar props collapse into a single bag, following AGENTS.md's own extraction convention ("threads ONE `EntityCalendarProps` on the pane contract, never five flat props").

- `editing={editing}` + `onToggleEditing={toggleEditing}` (2 lines) → `{...editToolbar}` (1 line) = **−1**
- `canEdit` rides inside the bag = **+0**

Net: **799 → 798**, two lines of headroom for Tasks 13/14. Verify after the edit with:

```bash
node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"
```

**Files:**
- Modify: `src/app/documents-toolbar.tsx`
- Modify: `src/app/document-edit-mode.tsx`
- Modify: `src/app/documents-panel.tsx` (net −1 line)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (two new keys)
- Test: `src/app/documents-toolbar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/documents-toolbar.test.tsx` (reuse the file's existing render helper; the props below name the bag Step 3 introduces):

```tsx
describe("the Edit blocks toggle", () => {
  // ★★★ A TOGGLE THAT PRESSES AND DOES NOTHING IS A LIE. With no documents
  //  selected, `DocumentEditModeBody` short-circuits on `doc === null` and
  //  renders the preview — so the pressed state announced the block editor as
  //  active while nothing had changed (WCAG 4.1.2). axe passes it: a name
  //  exists and aria-pressed is a legal attribute. Only this test can see it.
  it("is disabled when no document is selected", () => {
    renderToolbar({ editToolbar: { editing: false, onToggleEditing: () => {}, canEdit: false } });
    expect(screen.getByRole("button", { name: t(LANG, "documentsEditBlocks") })).toBeDisabled();
  });

  it("is enabled once a document is selected", () => {
    renderToolbar({ editToolbar: { editing: false, onToggleEditing: () => {}, canEdit: true } });
    expect(screen.getByRole("button", { name: t(LANG, "documentsEditBlocks") })).toBeEnabled();
  });

  // ★★ A DISABLED TOGGLE LEAVES THE TAB ORDER AND `ToggleButton` SUPPRESSES ITS
  //  state suffix while disabled, so without a description it announces a bare
  //  name and nothing about WHY it is inert. The two reasons differ, so the
  //  text is derived rather than fixed.
  it("explains why it is disabled — no document vs a read-only mirror", () => {
    const { rerender } = renderToolbar({
      editToolbar: { editing: false, onToggleEditing: () => {}, canEdit: false },
    });
    const noDoc = screen.getByRole("button", { name: t(LANG, "documentsEditBlocks") });
    expect(noDoc).toHaveAccessibleDescription(t(LANG, "documentsEditBlocksNoDocument"));

    rerenderToolbar(rerender, {
      isReadOnly: true,
      editToolbar: { editing: false, onToggleEditing: () => {}, canEdit: true },
    });
    expect(
      screen.getByRole("button", { name: t(LANG, "documentsEditBlocks") }),
    ).toHaveAccessibleDescription(t(LANG, "documentsReadOnlyMirror"));
  });

  it("explains why the New document button is inert in a read-only mirror", () => {
    renderToolbar({ isReadOnly: true });
    expect(
      screen.getByRole("button", { name: new RegExp(t(LANG, "documentsNew")) }),
    ).toHaveAccessibleDescription(t(LANG, "documentsReadOnlyMirror"));
  });
});
```

★ If the file has no `renderToolbar`/`rerenderToolbar` helper, write one that spreads a complete default prop set and merges the overrides — do **not** duplicate the full prop object four times (the duplication gate compares total duplicated lines across the whole repo).

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/app/documents-toolbar.test.tsx --reporter=dot`
Expected: FAIL — `editToolbar` is not a prop, the toggle is enabled, and neither control has an accessible description.

- [ ] **Step 3: Add the two i18n keys**

`src/app/i18n.ts`, beside the other `documents*` keys:

```ts
  documentsEditBlocksNoDocument: "Select a document to edit its blocks.",
  documentsReadOnlyMirror: "This window is a read-only mirror.",
```

`src/app/i18n.de.ts` (CRLF + umlaut rules from Task 7 Step 4 apply — patch by node write, then grep):

```ts
  documentsEditBlocksNoDocument: "Wählen Sie ein Dokument aus, um seine Blöcke zu bearbeiten.",
  documentsReadOnlyMirror: "Dieses Fenster ist eine schreibgeschützte Spiegelung.",
```

- [ ] **Step 4: Reshape the toolbar props**

In `src/app/documents-toolbar.tsx`, replace the `editing` / `onToggleEditing` prop pair with a bag:

```ts
/** The pane's edit-mode controls, threaded as ONE object rather than three
 *  flat props (AGENTS.md's extraction convention — the same reason a
 *  calendar-capable entity threads one `EntityCalendarProps`). Built by
 *  `useDocumentEditMode`, so the panel does not have to keep three names in
 *  step. */
export interface DocumentsEditToolbarProps {
  /** Whether the block editor is showing (vs the read-only preview). ★ The
   *  label is PINNED to "Edit blocks" in both states — it does NOT flip to
   *  "Preview" — so `aria-pressed` tracks what the label names, mirroring the
   *  deleted-documents toggle. A flipped label would announce the WRONG mode
   *  as active (WCAG 4.1.2), which axe cannot catch (see AGENTS.md). */
  editing: boolean;
  onToggleEditing: () => void;
  /** False when nothing is selected. ★★ `DocumentEditModeBody` needs a
   *  non-null `doc` as well as `!isReadOnly`, so a toggle gated on isReadOnly
   *  ALONE pressed, reported aria-pressed="true", and did nothing — a lie the
   *  a11y gate passes because a name exists. Mirrors `canDownload`. */
  canEdit: boolean;
}
```

Replace the two fields in `DocumentsToolbarProps` with `editToolbar: DocumentsEditToolbarProps;`, destructure `editToolbar` instead of `editing`/`onToggleEditing`, and render:

```tsx
      <ToggleButton
        pressed={editToolbar.editing}
        onToggle={editToolbar.onToggleEditing}
        lang={lang}
        title={t(lang, "documentsEditBlocks")}
        disabled={editDisabledReason !== undefined}
        ariaDescribedBy={editDisabledReason !== undefined ? EDIT_DISABLED_HINT_ID : undefined}
      >
        {t(lang, "documentsEditBlocks")}
      </ToggleButton>
      {/* ★★ The description node for BOTH inert controls. `ToggleButton`
          suppresses its on/off tooltip suffix while disabled and a disabled
          control leaves the tab order, so without this the toggle announces a
          bare name and nothing about why it cannot be used. Rendered
          unconditionally so the id an `aria-describedby` points at always
          resolves — a dangling idref announces nothing and axe does not flag
          it. `sr-only`, because the reason is redundant beside a control a
          sighted user can see is greyed out. */}
      <span id={EDIT_DISABLED_HINT_ID} className="sr-only">
        {editDisabledReason ?? ""}
      </span>
      <span id={NEW_DISABLED_HINT_ID} className="sr-only">
        {isReadOnly ? t(lang, "documentsReadOnlyMirror") : ""}
      </span>
```

with, above the `return`:

```tsx
  // ★ TWO reasons, different text. Read-only wins: in a popout mirror nothing
  //  is editable regardless of selection, so naming the selection would send
  //  the user to pick a row that changes nothing.
  const editDisabledReason = isReadOnly
    ? t(lang, "documentsReadOnlyMirror")
    : editToolbar.canEdit
      ? undefined
      : t(lang, "documentsEditBlocksNoDocument");
```

and, at module scope:

```tsx
// ★ Module-scope constants, not `useId`: this toolbar is rendered once per
//  pane and the ids are referenced from two places in the same subtree.
const EDIT_DISABLED_HINT_ID = "documents-edit-blocks-disabled-hint";
const NEW_DISABLED_HINT_ID = "documents-new-disabled-hint";
```

Give `AddButton` its description:

```tsx
      <AddButton
        onClick={onNew}
        disabled={isReadOnly}
        aria-describedby={isReadOnly ? NEW_DISABLED_HINT_ID : undefined}
      >
        {t(lang, "documentsNew")}
      </AddButton>
```

★ Control ORDER is load-bearing and pinned by this file's own tests: the two `sr-only` spans are **not** buttons and cannot displace the trailing `Print · reset-columns · reset-size` group, but run the order assertions in Step 6 rather than assuming it.

- [ ] **Step 5: Build the bag in the hook and consume it in the panel**

`src/app/document-edit-mode.tsx` — `useDocumentEditMode` returns the bag:

```ts
export function useDocumentEditMode(deps: UseDocumentEditModeDeps) {
  const [editing, setEditing] = useState(false);
  const toggleEditing = useCallback(() => setEditing((v) => !v), []);
  const narrowPane = useMediaQuery(NARROW_PANE_QUERY);
  const { commitBlock } = useDocumentEditor(deps);
  // ★ `documentId` is `selected?.id ?? -1` at the call site, so a real
  //  selection is the only thing that yields a positive id. Deriving canEdit
  //  HERE rather than passing a fourth thing down keeps the panel's toolbar
  //  call one prop wide — and the panel sits one line under the 800-line gate.
  const editToolbar = { editing, onToggleEditing: toggleEditing, canEdit: deps.documentId > 0 };
  return { editing, narrowPane, commitBlock, editToolbar };
}
```

`src/app/documents-panel.tsx`:
- line 360 destructure → `const { editing, narrowPane, commitBlock, editToolbar } = useDocumentEditMode({ … });` (still one line; `toggleEditing` is no longer destructured)
- in the `<DocumentsToolbar …>` JSX, **delete** the `editing={editing}` and `onToggleEditing={toggleEditing}` lines and **insert one** `{...editToolbar}` in their place.

- [ ] **Step 6: Run and re-measure the file**

```bash
npx vitest run src/app/documents-toolbar.test.tsx src/app/documents-panel.test.tsx src/app/i18n.test.ts --reporter=dot
npx tsc --noEmit; echo "EXIT=$?"
node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"
```

Expected: tests PASS, tsc `EXIT=0`, and the line count prints **798**. If it prints anything above 799, stop and find the extra line before continuing — Tasks 13 and 14 are budgeted against 798.

- [ ] **Step 7: Commit**

```bash
git add src/app/documents-toolbar.tsx src/app/document-edit-mode.tsx src/app/documents-panel.tsx src/app/documents-toolbar.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "fix(documents): disable Edit blocks with no document, and explain both inert controls"
```

**Mutants these kill:**
- `disabled={editDisabledReason !== undefined}` → `disabled={isReadOnly}`: *is disabled when no document is selected* goes red.
- swap the two branches of `editDisabledReason`: the read-only/no-document description test goes red on whichever half is wrong — the two reasons are asserted **separately**, so a single generic string cannot satisfy both.
- delete `aria-describedby` from `AddButton`: the fourth test goes red.

---

## Task 10: F6 — the table editor emits a ragged table

`document-table-editor.tsx` maps `value.columns` to N `<th>` (`:117-139`) while every `<tbody><tr>` renders N `<td>` **plus an unpaired action `<td>`** (`:155`). The column count disagrees with the header and the action column has no header at all. The repo already has the pattern for exactly this — `documents-list.tsx:124-134` gives its icon-button column a raw `<th>` with an `sr-only` label and its **own** key ("It read `documentsNew` … so a screen-reader user heard the column of Download/Rename/Duplicate/Delete controls announced as 'New document'").

**Files:**
- Modify: `src/app/document-table-editor.tsx` (**serialise after Task 5**)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/document-block-editors.test.tsx` (the table editor's tests live there — **serialise after Task 7**)

- [ ] **Step 1: Write the failing test**

Append to the table editor's `describe` in `src/app/document-block-editors.test.tsx`:

```tsx
  // ★★ THE ACTION COLUMN HAD NO HEADER, so every body row carried one more
  //  <td> than the header had <th>. Header/body column counts must agree —
  //  the renderers assume rectangularity, and a screen reader navigating the
  //  grid lands in a column with no name.
  it("gives the remove-row column a header, so the header and body agree on width", () => {
    const table: Extract<DocBlock, { type: "table" }> = {
      type: "table",
      columns: ["A", "B"],
      rows: [["1", "2"], ["3", "4"]],
    };
    const { container } = render(
      <TableBlockEditor lang={LANG} index={0} block={table} onCommit={vi.fn()} />,
    );
    const headerCells = container.querySelectorAll("thead th");
    const firstBodyRowCells = container.querySelectorAll("tbody tr:first-child td");
    expect(headerCells).toHaveLength(firstBodyRowCells.length);
    // ...and the extra header is NAMED, not an empty cell.
    expect(screen.getByText(t(LANG, "documentsTableRowActions"))).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/document-block-editors.test.tsx -t "remove-row column a header" --reporter=dot`
Expected: FAIL — `2` header cells vs `3` body cells.

- [ ] **Step 3: Add the i18n key**

`src/app/i18n.ts`:

```ts
  documentsTableRowActions: "Row actions",
```

`src/app/i18n.de.ts` (no umlaut in this one, but the file is still CRLF — use the node write):

```ts
  documentsTableRowActions: "Zeilenaktionen",
```

- [ ] **Step 4: Add the header cell**

In `src/app/document-table-editor.tsx`, after the `value.columns.map(...)` inside `<thead><tr>`:

```tsx
              {/* ★★ PAIRS WITH THE PER-ROW REMOVE BUTTON'S <td>. Without it
                  every body row was one cell wider than the header — a ragged
                  table the renderers' rectangularity assumption does not
                  cover, and a grid column a screen reader enters unnamed.
                  ★ `sr-only` because the column shows one icon-only button
                  whose own name already says what it does; same convention as
                  documents-list.tsx's action column.
                  ★ Its OWN key — reusing `documentsRemoveRow` would announce
                  the COLUMN as "Remove row {0}", i.e. name a column after a
                  single one of its buttons.
                  ★ NOT block-qualified: a <th> is scoped by its own table
                  element, so unlike the per-row CONTROLS it cannot collide
                  with a sibling table block's header. */}
              <th className="px-1 py-1 text-left font-medium">
                <span className="sr-only">{t(lang, "documentsTableRowActions")}</span>
              </th>
```

- [ ] **Step 5: Run**

Run: `npx vitest run src/app/document-block-editors.test.tsx src/app/i18n.test.ts --reporter=dot` then `npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/document-table-editor.tsx src/app/document-block-editors.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "fix(documents): give the table editor's action column a header"
```

**Mutant this kills:** deleting the new `<th>`. Header cells drop to 2 against 3 body cells and the length assertion goes red; deleting only the `<span>` inside it kills the `getByText` half, so the cell's **presence** and its **name** are pinned separately.

---

## Task 11: F8 — the heading editor's labels use a bare trailing digit

`document-block-editors.tsx:259` builds `` const suffix = ` ${index + 1}` `` and appends it at `:264`/`:275`, producing "Heading level 1" / "Heading text 1" at index 0. The trailing digit collides semantically with the heading LEVEL — the select's own options are literally `H1`/`H2`/`H3`, so "Heading level 1" reads as *level one*, not *block one*. Three other places in this same slice state the opposite rule verbatim (`document-table-editor.tsx:8-10`, `document-block-editors.tsx:337-342` and `:516-521`: "never a bare trailing digit (rejected in review)").

This is a **cross-file accessible-name rename**: 16 call sites across three test files read the old name.

**Files:**
- Modify: `src/app/document-block-editors.tsx:257-279` (**serialise after Tasks 5 and 7**)
- Test: `src/app/document-block-editors.test.tsx` (6 sites), `src/app/document-editor.test.tsx` (5 sites), `src/app/documents-panel.test.tsx` (3 sites)

- [ ] **Step 1: Write the failing test**

Append to the heading editor's `describe` in `src/app/document-block-editors.test.tsx`:

```tsx
  // ★★★ A BARE TRAILING DIGIT IS AMBIGUOUS HERE IN A WAY IT IS NOT ELSEWHERE.
  //  The select's options are H1/H2/H3, so "Heading level 1" reads as LEVEL
  //  one, not BLOCK one — the qualifier and the control's own subject collide.
  //  Three other editors in this slice already state this rule verbatim; this
  //  one shipped against it.
  it("qualifies both heading controls with the en-dash block convention, not a bare digit", () => {
    const block: Extract<DocBlock, { type: "heading" }> = { type: "heading", level: 2, text: "Q3" };
    render(<HeadingBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />);
    const expected = `${t(LANG, "documentsBlockN", "1")}`;
    const select = screen.getByRole("combobox", {
      name: `${t(LANG, "documentsHeadingLevel")} – ${expected}`,
    });
    const text = screen.getByRole("textbox", {
      name: `${t(LANG, "documentsHeadingText")} – ${expected}`,
    });
    expect(select).toBeInTheDocument();
    expect(text).toBeInTheDocument();
    // The old bare-digit form must be GONE, or both spellings would resolve and
    // the rename would be cosmetic.
    expect(screen.queryByRole("textbox", { name: `${t(LANG, "documentsHeadingText")} 1` })).toBeNull();
  });
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/document-block-editors.test.tsx -t "en-dash block convention" --reporter=dot`
Expected: FAIL — neither qualified name resolves.

- [ ] **Step 3: Implement**

Replace lines 257-279 of `src/app/document-block-editors.tsx`:

```tsx
  // ★★★ EN-DASH BLOCK QUALIFIER, never a bare trailing digit — the convention
  //  the bullets, table and dataSection editors already state verbatim. It
  //  matters MORE here than anywhere else in the slice: this block's select
  //  offers H1/H2/H3, so "Heading level 1" reads as the LEVEL, and a user
  //  cannot tell the qualifier from the control's own subject. N identical
  //  "Heading text" labels across sibling heading blocks is a WCAG 2.4.6
  //  failure no axe rule under the four tags e2e/a11y.spec.ts requests can
  //  see, at any seed size — this file's multi-block tests are the only
  //  detector that exists.
  const blockQualifier = t(lang, "documentsBlockN", String(index + 1));
  const qualify = (label: string) => `${label} – ${blockQualifier}`;

  return (
    <div className="flex flex-wrap items-center gap-2" onBlur={commit}>
      <select
        aria-label={qualify(t(lang, "documentsHeadingLevel"))}
        className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground"
        value={String(value.level)}
        onChange={(e) => setValue({ ...value, level: Number(e.target.value) as HeadingLevel })}
      >
        {HEADING_LEVELS.map((l) => (
          <option key={l} value={String(l)}>{`H${l}`}</option>
        ))}
      </select>
      <input
        type="text"
        aria-label={qualify(t(lang, "documentsHeadingText"))}
        className="flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground"
        value={value.text}
        onChange={(e) => setValue({ ...value, text: e.target.value })}
      />
    </div>
  );
```

★ If Task 7 already wrapped this return in an outer `<div className="flex flex-col gap-1" onBlur={commit}>` for the dropped-block notice, keep that wrapper and move `onBlur` off the inner row — do **not** end up with two `onBlur` handlers, which would double every commit.

- [ ] **Step 4: Update the 16 reader sites**

Introduce one shared helper per test file rather than spelling the template 16 times (the duplication gate compares total duplicated lines repo-wide). In each of `document-block-editors.test.tsx`, `document-editor.test.tsx` and `documents-panel.test.tsx`, add near the top:

```ts
/** The heading editor's accessible names, 0-based block index in, en-dash
 *  qualified name out. Spelled once so a convention change is one edit. */
const headingTextName = (index: number) =>
  `${t(LANG, "documentsHeadingText")} – ${t(LANG, "documentsBlockN", String(index + 1))}`;
const headingLevelName = (index: number) =>
  `${t(LANG, "documentsHeadingLevel")} – ${t(LANG, "documentsBlockN", String(index + 1))}`;
```

(in `documents-panel.test.tsx` the lang literal is `"en-US"` rather than a `LANG` const — use whatever that file already uses).

Then replace, mechanically:

| File | Lines (pre-edit) | Replace with |
|---|---|---|
| `document-block-editors.test.tsx` | `:307`, `:366`, `:383` | `headingLevelName(0)` |
| `document-block-editors.test.tsx` | `:332`, `:348`, `:384` | `headingTextName(0)` |
| `document-block-editors.test.tsx` | the three sites Task 5 added | `headingTextName(0)` |
| `document-editor.test.tsx` | `:34`, `:111`, `:115`, `:127`, `:132` | `headingTextName(0)` |
| `documents-panel.test.tsx` | `:2003`, `:2008`, `:2021` (and the sites Task 8 rewrote) | `headingTextName(0)` |

Sweep for stragglers afterwards — the grep must return **only** `i18n.ts`, `i18n.de.ts` and the two helper definitions per test file:

```bash
grep -rn 'documentsHeadingText")} 1\|documentsHeadingLevel")} 1' src/
```

- [ ] **Step 5: Run**

Run: `npx vitest run src/app/document-block-editors.test.tsx src/app/document-editor.test.tsx src/app/documents-panel.test.tsx --reporter=dot`
Expected: PASS. Then `npx tsc --noEmit` — required, because vitest never typechecks and an invalid `getByRole` option is a tsc-only failure.

- [ ] **Step 6: Commit**

```bash
git add src/app/document-block-editors.tsx src/app/document-block-editors.test.tsx src/app/document-editor.test.tsx src/app/documents-panel.test.tsx
git commit -m "fix(documents): qualify the heading editor's labels with the en-dash block convention"
```

**Mutant this kills:** reverting either `aria-label` to `t(lang, …) + suffix`. The `queryByRole(... " 1")` half of the new test then resolves a node and `toBeNull()` fails, so a *partial* revert (one of the two controls) dies too.

---

## Task 12: F10 — the data-section select shows raw registry keys

`document-block-editors.tsx:531-533` renders `<option key={k} value={k}>{k}</option>` — fifteen raw `ExportSectionKey`s (`project`, `raid`, `knowledgeItems`…) as user-visible, untranslated text, in a slice where every other visible string goes through `t()`.

**The finding assumed a translated label might cost fifteen new i18n keys. It costs none.** `settings-sections/export-section.tsx:16-32` already holds an exhaustive `Record<ExportSectionKey, TranslationKey>` and all fifteen keys exist in EN and DE. The map is extracted to a shared module so both surfaces read one source.

The extraction target is a new module rather than `settings-types.ts`, because `document-model.ts` documents a runtime import cycle through `settings-types.ts` and widening what that module pulls in is the wrong direction. It is also **not** imported from `settings-sections/export-section.tsx` by the editor — that would drag a settings UI component (with `FieldHint`, `FOCUS_RING`) into the documents editor's graph for one constant.

**Files:**
- Create: `src/app/export-section-labels.ts`
- Modify: `src/app/settings-sections/export-section.tsx`
- Modify: `src/app/document-block-editors.tsx` (**serialise after Tasks 5, 7, 11**)
- Test: `src/app/document-block-editors.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to the dataSection editor's `describe` in `src/app/document-block-editors.test.tsx`:

```tsx
  // ★ Raw registry keys ("knowledgeItems") were rendered as user-visible text.
  //  Every option must carry the same translated label Settings → Export shows
  //  for the same section, so the two surfaces cannot name one thing twice.
  it("renders translated option labels, not raw registry keys", () => {
    const block: Extract<DocBlock, { type: "dataSection" }> = { type: "dataSection", key: "tasks" };
    render(<DataSectionBlockEditor lang={LANG} index={0} block={block} onCommit={vi.fn()} />);
    const select = screen.getByRole("combobox");
    expect(select).toHaveTextContent(t(LANG, "exportLabelKnowledgeItems"));
    expect(select).not.toHaveTextContent("knowledgeItems");
  });
```

★ `knowledgeItems` is chosen deliberately: it is the one key whose raw form and translated label ("Knowledge items") differ by more than capitalisation, so the negative assertion can actually fail. A key like `tasks` → "Tasks" would make `not.toHaveTextContent("tasks")` fail against the *correct* code.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/document-block-editors.test.tsx -t "translated option labels" --reporter=dot`
Expected: FAIL — the select's text contains `knowledgeItems`.

- [ ] **Step 3: Create the shared map**

`src/app/export-section-labels.ts`:

```ts
// The user-visible label for each ExportSectionKey.
//
// ★ Extracted from settings-sections/export-section.tsx so the Settings
//  checkbox list and the documents `dataSection` block editor cannot name the
//  same section two different ways. Deliberately NOT put in settings-types.ts:
//  document-model.ts documents a runtime import cycle through that module, and
//  widening what it pulls in is the wrong direction.
//
// ★ EXHAUSTIVE by type. A sixteenth EXPORT_SECTION_KEYS entry is a compile
//  error here rather than a section that silently renders its raw key.
import type { TranslationKey } from "./i18n";
import type { ExportSectionKey } from "./settings-types";

export const EXPORT_SECTION_LABEL_KEYS: Record<ExportSectionKey, TranslationKey> = {
  project: "exportLabelProject",
  tasks: "exportLabelTasks",
  raid: "exportLabelRaid",
  changes: "exportLabelChanges",
  milestones: "exportLabelMilestones",
  stakeholders: "exportLabelStakeholders",
  budgets: "exportLabelBudgets",
  resources: "exportLabelResources",
  roles: "exportLabelRoles",
  absences: "exportLabelAbsences",
  shifts: "exportLabelShifts",
  calendarEvents: "exportLabelCalendarEvents",
  status: "exportLabelStatus",
  knowledgeItems: "exportLabelKnowledgeItems",
  insights: "exportLabelInsights",
};
```

★ **Coverage:** this is a new `.ts` file and therefore coverage-gated. It holds one constant and no functions, so it contributes lines that are covered by any test importing it (both of its consumers have tests) and zero uncovered functions. It is **not** added to `coverage.exclude`.

- [ ] **Step 4: Point both consumers at it**

`src/app/settings-sections/export-section.tsx`: delete the local `LABEL_KEYS` constant (lines 16-32) and its now-unused `TranslationKey` import if nothing else needs it, add

```ts
import { EXPORT_SECTION_LABEL_KEYS } from "../export-section-labels";
```

and change `t(lang, LABEL_KEYS[key])` to `t(lang, EXPORT_SECTION_LABEL_KEYS[key])`.

★ CI runs `eslint --max-warnings=0` — an import left unused after deleting `LABEL_KEYS` is **fatal**, so re-check the file's imports.

`src/app/document-block-editors.tsx`: add the import and translate the options:

```tsx
      {EXPORT_SECTION_KEYS.map((k) => (
        <option key={k} value={k}>
          {t(lang, EXPORT_SECTION_LABEL_KEYS[k])}
        </option>
      ))}
```

- [ ] **Step 5: Run**

Run: `npx vitest run src/app/document-block-editors.test.tsx src/app/settings-sections --reporter=dot` then `npx tsc --noEmit` and `npx eslint --max-warnings=0 src/app` (unpiped).
Expected: PASS / exit 0 / exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/export-section-labels.ts src/app/settings-sections/export-section.tsx src/app/document-block-editors.tsx src/app/document-block-editors.test.tsx
git commit -m "fix(documents): translate the data-section select's options"
```

**Mutant this kills:** reverting the option body to `{k}`. The `toHaveTextContent(t(LANG, "exportLabelKnowledgeItems"))` assertion goes red.

---

## Task 13: F9 — route block commits through the panel's single mutation funnel

`documents-panel.tsx:360` passes raw `mutateDocuments` into `useDocumentEditMode`, bypassing the funnel at `:481-497` whose own comment says "**A REFUSAL REACHES THE USER FROM HERE, not from each call site**" — and which was written precisely because "the shape that reads like 'a mutation returns nothing' invites a call site to discard one". `use-document-editor.ts:64` returns the `DocResult`, but `document-edit-mode.tsx:44` types `onCommitBlock` as `=> void`, so it is discarded.

Reachable refusals today: `document #<id> not found` (a concurrent delete) and `replace index out of range` (the block list shrank). Both drop typed text with no message.

The fix inverts the dependency: the hook stops choosing the source, and the panel's funnel — which already hardcodes `"user"` and already owns the refusal display — becomes the single writer.

**Files:**
- Modify: `src/app/use-document-editor.ts`
- Modify: `src/app/document-edit-mode.tsx`
- Modify: `src/app/documents-panel.tsx:360` (**net 0 lines** — an identifier swap on an existing line)
- Test: `src/app/use-document-editor.test.ts`, `src/app/documents-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/documents-panel.test.tsx` (inside the edit-mode describe that `renderWithSpy` serves):

```tsx
  // ★★★ A REFUSAL MUST REACH THE USER. The panel funnel (`mutate`) is the ONE
  //  place that renders one — its own comment says so — and the block editor
  //  was wired straight past it to `mutateDocuments`. A concurrent delete then
  //  refused the commit with "document #N not found" and the user's typing
  //  vanished in silence.
  it("shows the refusal when a block commit is rejected", async () => {
    const box: Box = { docs: [docA], versions: [] };
    const realMutate = boxMutator(box);
    const mutateDocuments = vi.fn((m: DocMutation, source: DocVersionSource): DocResult => {
      // The document is deleted out from under the open editor, exactly as a
      // second tab or an AI delete would do it.
      if (m.kind === "ops") box.docs = [];
      return realMutate(m, source);
    });
    render(
      <PanelHost>
        <DocumentsPanel
          lang="en-US"
          documents={[docA]}
          mutateDocuments={mutateDocuments}
          documentVersions={[]}
          ws={emptyWorkspace()}
          onResetSize={() => {}}
        />
      </PanelHost>,
    );
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "documentsEditBlocks") }));
    const text = await screen.findByRole("textbox", { name: headingTextName(0) });
    await userEvent.type(text, "!");
    text.blur();

    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });
```

★ `headingTextName` is Task 11's helper — spell the name inline if Task 11 has not landed yet.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/documents-panel.test.tsx -t "shows the refusal" --reporter=dot`
Expected: FAIL — no refusal text renders.

- [ ] **Step 3: Narrow the hook's dependency**

In `src/app/use-document-editor.ts`:

```ts
export type UseDocumentEditorDeps = {
  documentId: number;
  versions: readonly DocVersion[];
  /** ★★★ ONE ARGUMENT, DELIBERATELY. This is the PANEL'S FUNNEL, not the raw
   *  workspace mutator: the funnel hardcodes the `"user"` source, clears the
   *  previous refusal, keeps `freshRef` current AND — the reason this is not a
   *  style choice — is the one place a refusal reaches the user. Widening this
   *  back to `(m, source)` is what let a call site be wired straight past it,
   *  so a concurrent delete refused the commit and the typing vanished with
   *  nothing said. Keep the source out of this contract. */
  mutateDocuments: (m: DocMutation) => DocResult;
  /** Injected so the decision is testable without a clock. */
  now?: () => string;
};
```

and drop the `"user"` argument from the call inside `commitBlock`:

```ts
      const result = mutateDocuments({
        kind: "ops",
        id: documentId,
        ops: [replaceBlockOp(index, block)],
        coalesce,
      });
```

★ `DocVersionSource` may now be unused in that file's imports — remove it if so (`--max-warnings=0`).

- [ ] **Step 4: Point the panel at the funnel**

`src/app/documents-panel.tsx` line 360 — replace `mutateDocuments` with `mutate` in the deps object. **Same line, no net change.**

```tsx
  const { editing, narrowPane, commitBlock, editToolbar } = useDocumentEditMode({ documentId: selected?.id ?? -1, versions: documentVersions, mutateDocuments: mutate });
```

★ `mutate` is a hoisted `function` declaration (`:481`), so referencing it at `:360` is legal. It is recreated every render, so `commitBlock`'s `useCallback` no longer memoizes anything — that is harmless (the handler is called from an event, never used as a dependency or a render-time identity) and is worth less than the funnel. **Do not** wrap `mutate` in a `useCallback` to "fix" it: it closes over `documents`, `freshRef` and two setters, and a stale one would resurrect the very bug the funnel exists to prevent.

- [ ] **Step 5: Update the hook's tests**

In `src/app/use-document-editor.test.ts` (Task 8), change both `vi.fn` signatures to one argument:

```ts
    const mutateDocuments = vi.fn((_m: DocMutation): DocResult => result());
```

(or the no-parameter form if eslint objects, as noted in Task 8).

- [ ] **Step 6: Run**

Run: `npx vitest run src/app/documents-panel.test.tsx src/app/use-document-editor.test.ts --reporter=dot` then `npx tsc --noEmit`
Expected: PASS, exit 0.
Then re-measure: `node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"` → **798**.

- [ ] **Step 7: Commit**

```bash
git add src/app/use-document-editor.ts src/app/documents-panel.tsx src/app/use-document-editor.test.ts src/app/documents-panel.test.tsx
git commit -m "fix(documents): route block commits through the panel's mutation funnel

The block editor was wired straight to mutateDocuments, past the funnel whose
own comment says a refusal reaches the user from there. A concurrent delete
refused the commit and the typing vanished in silence. The hook's dependency
is narrowed to one argument so the source and the refusal display cannot be
bypassed again."
```

**Mutant this kills:** reverting `mutateDocuments: mutate` to `mutateDocuments`. Two guards fire, and it is worth knowing which is which. **tsc** rejects it — TypeScript allows a function with FEWER parameters where more are expected, never the reverse, so the panel's two-argument `(m, source) => DocResult` is not assignable to the narrowed one-argument type. **The test** is what covers the case tsc cannot see: a wrapper such as `(m) => mutateDocuments(m, "user")` typechecks perfectly and still bypasses the funnel, and only the refusal assertion goes red on it. Confirm both by running the revert AND the wrapper variant.

---

## Task 14: F14 — measure the PANE, not the viewport

`use-media-query.ts:26` is `window.matchMedia(query).matches` — **viewport** width. So `document-editor.tsx:20-26`'s docstring ("PANE width, not device width — the pane is user-resizable and has a popout path, so a desktop user reaches this by dragging") names a trigger that cannot fire: dragging the pane narrow on a wide screen changes nothing, and a phone-width viewport collapses the editor even if the pane is the whole screen.

Per D3 this becomes a `ResizeObserver` hook measuring the pane element, with `DocumentEditor` keeping `narrow` as a **prop** so its own tests stay injectable.

### ★★★ D3's cited precedent does not exist — verify before copying anything

D3 says to follow "the existing precedent in `src/app/dashboard-grid.tsx`". **There is none.** Reproduce:

```bash
grep -rn "ResizeObserver" src/ e2e/
```

returns exactly two lines — `src/app/dashboard-grid.tsx:14` and `e2e/dashboard-grid.spec.ts:17` — and **both are comments stating the feature deliberately uses no ResizeObserver** (it does the whole responsive clamp in Tailwind classes). This task therefore writes the repo's **first** `ResizeObserver`, with no in-repo shape to copy, which raises two things a copied pattern would have handled for free:

1. **jsdom has no `ResizeObserver` global and `vitest.setup.ts` installs no polyfill.** An unguarded `new ResizeObserver(...)` throws in **every** test that renders the Documents panel. The hook feature-detects, exactly as `useMediaQuery` guards `window.matchMedia`.
2. **A zero width is not a narrow pane.** An unmeasured or detached element reports `0`, and treating that as narrow collapses the editor at mount, before the first measurement lands.

### Coverage decision

`use-narrow-element.ts` is a new `.ts` file and therefore coverage-gated. It is **tested, not excluded.** AGENTS.md's rule is "exclude glue, not logic", and this hook holds three real decisions — the feature guard, the zero-width guard, and the threshold comparison — each of which has already been got wrong in this repo's history in some form. `use-view-digest.ts` is the in-repo precedent for a coverage-gated hook that earns its tests.

**Files:**
- Create: `src/app/use-narrow-element.ts`
- Create: `src/app/use-narrow-element.test.tsx`
- Modify: `src/app/document-edit-mode.tsx`
- Modify: `src/app/document-editor.tsx` (delete the dead `NARROW_PANE_QUERY` and correct the docstring)
- Modify: `src/app/documents-panel.tsx` (**net 0 lines** — a `ref` attribute on an existing element)

- [ ] **Step 1: Write the failing test**

`src/app/use-narrow-element.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useNarrowElement } from "./use-narrow-element";

// ★★★ jsdom HAS NO ResizeObserver AND vitest.setup.ts INSTALLS NO POLYFILL.
//  The hook feature-detects for exactly this reason; this fake is what lets
//  the measuring branch be exercised at all. It captures the callback so the
//  test can DRIVE it — jsdom has no layout, so nothing will ever call it for
//  us and a test waiting for a real measurement would hang or pass vacuously.
type Cb = (entries: { contentRect: { width: number } }[]) => void;
let fire: Cb | undefined;
let observed: Element[] = [];
let disconnects = 0;

class FakeResizeObserver {
  constructor(cb: Cb) { fire = cb; }
  observe(el: Element) { observed.push(el); }
  disconnect() { disconnects += 1; }
  unobserve() {}
}

function Probe({ max }: { max: number }) {
  const { ref, narrow } = useNarrowElement(max);
  return <div ref={ref} data-testid="pane">{narrow ? "narrow" : "wide"}</div>;
}

describe("useNarrowElement", () => {
  beforeEach(() => {
    fire = undefined;
    observed = [];
    disconnects = 0;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("observes the element the ref is attached to", () => {
    render(<Probe max={640} />);
    expect(observed).toEqual([screen.getByTestId("pane")]);
  });

  it("reports wide until a measurement says otherwise", () => {
    render(<Probe max={640} />);
    expect(screen.getByTestId("pane")).toHaveTextContent("wide");
  });

  it("reports narrow at or below the threshold and wide above it", () => {
    render(<Probe max={640} />);
    act(() => fire?.([{ contentRect: { width: 640 } }]));
    expect(screen.getByTestId("pane")).toHaveTextContent("narrow");
    act(() => fire?.([{ contentRect: { width: 641 } }]));
    expect(screen.getByTestId("pane")).toHaveTextContent("wide");
  });

  // ★★ A ZERO WIDTH IS NOT A NARROW PANE. An unmeasured or detached element
  //  reports 0; treating that as "<= 640" would collapse the editor before the
  //  first real measurement lands, and again any time the pane is hidden.
  it("treats a zero width as NOT narrow", () => {
    render(<Probe max={640} />);
    act(() => fire?.([{ contentRect: { width: 0 } }]));
    expect(screen.getByTestId("pane")).toHaveTextContent("wide");
  });

  it("disconnects on unmount", () => {
    const { unmount } = render(<Probe max={640} />);
    unmount();
    expect(disconnects).toBe(1);
  });

  // ★★★ THE FEATURE GUARD. Without it every test that renders the Documents
  //  panel throws in jsdom, and so does any browser without the API.
  it("renders without throwing when ResizeObserver does not exist", () => {
    vi.unstubAllGlobals();
    // @ts-expect-error — deliberately removing a global the hook must survive.
    delete globalThis.ResizeObserver;
    expect(() => render(<Probe max={640} />)).not.toThrow();
    expect(screen.getByTestId("pane")).toHaveTextContent("wide");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/use-narrow-element.test.tsx --reporter=dot`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the hook**

`src/app/use-narrow-element.ts`:

```ts
"use client";
import { useEffect, useState } from "react";

/**
 * Is the element this ref is attached to at or below `maxWidthPx` wide?
 *
 * ★★★ MEASURES THE ELEMENT, NOT THE VIEWPORT — which is the whole reason it
 *  exists. The Documents pane is user-resizable and has a popout path, so a
 *  desktop user reaches a narrow pane by DRAGGING, and a viewport media query
 *  (`use-media-query.ts`, still correct for its own consumers) cannot see that
 *  at all: it fired on device width, so dragging the pane narrow on a wide
 *  screen changed nothing and a phone-width viewport collapsed a full-width
 *  pane. The docstring on `document-editor.tsx` claimed pane width for a
 *  viewport query for the whole of the S3b slice.
 *
 * ★★★ THIS IS THE REPO'S FIRST ResizeObserver. `dashboard-grid.tsx` mentions
 *  one only to say it deliberately has none (its responsive clamp is pure
 *  Tailwind), so there is no in-repo shape to copy and both guards below had
 *  to be reasoned rather than inherited:
 *
 *  1. FEATURE GUARD. jsdom provides no `ResizeObserver` and `vitest.setup.ts`
 *     installs no polyfill, so an unguarded `new ResizeObserver(...)` throws in
 *     EVERY test that renders the consuming panel. Degrading to `false` (wide)
 *     is the safe default: the per-block layout works at any width, the docked
 *     one is the accommodation.
 *  2. ZERO-WIDTH GUARD. An unmeasured, hidden or detached element reports 0.
 *     Treating that as "<= maxWidthPx" would collapse the editor at mount,
 *     before any real measurement, and again whenever the pane is hidden.
 *
 * ★ The ref is a CALLBACK ref stored in STATE, not a `useRef`. The effect has
 *  to re-subscribe when the node changes, and a ref object's mutation does not
 *  re-run an effect — `react-hooks/refs` also bans reading one during render,
 *  so there would be no legal way to depend on it.
 *
 * ★ `setNarrow` is called from the OBSERVER CALLBACK, not from the effect
 *  body, so `react-hooks/set-state-in-effect` (fatal in CI) does not apply. If
 *  it ever flags this, the fix is to keep the call in the callback, never to
 *  disable the rule.
 */
export function useNarrowElement(maxWidthPx: number) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setNarrow(width > 0 && width <= maxWidthPx);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, maxWidthPx]);

  return { ref: setNode, narrow };
}
```

- [ ] **Step 4: Swap the consumer over**

`src/app/document-edit-mode.tsx` — replace the `useMediaQuery` import and call:

```ts
import { DocumentEditor, NARROW_PANE_PX } from "./document-editor";
import { useNarrowElement } from "./use-narrow-element";
```

```ts
  // ★ Measures the PANE element (the caller attaches `paneRef` to it), never
  //  the viewport — the pane is user-resizable, so device width is the wrong
  //  question. `DocumentEditor` takes the RESULT as a prop, which is what
  //  keeps ITS OWN test injectable: jsdom has no layout, so a component that
  //  measured for itself would be untestable.
  const { ref: paneRef, narrow: narrowPane } = useNarrowElement(NARROW_PANE_PX);
```

and add `paneRef` to the returned object.

`src/app/document-editor.tsx` — replace the dead query constant:

```ts
/** Pane width, in px, at or below which the toolbar docks once instead of
 *  rendering per block.
 *  ★ PANE width, not device width — the pane is user-resizable and has a
 *   popout path, so a desktop user reaches this by dragging. Measured by
 *   `use-narrow-element.ts` (a ResizeObserver over the pane element) and
 *   passed down as `narrow`; this component never measures anything itself.
 *  ★★ It used to be a `matchMedia` string consumed by `use-media-query.ts`,
 *   which reads the VIEWPORT — so the "reaches this by dragging" claim above
 *   was false for the whole S3b slice. */
export const NARROW_PANE_PX = 640;
```

`src/app/documents-panel.tsx` — destructure `paneRef` on line 360 (same line) and attach it to the existing wrapper around `DocumentEditModeBody` (**edit the existing element's attributes; add no line**):

```tsx
      <div ref={paneRef} className="flex min-h-0 flex-1 flex-col gap-3">
```

★ Attach it to the element that actually resizes with the pane — the flex column that holds the list and the editor body. If that element is not the one wrapping `DocumentEditModeBody` at line ~704, attach it to the one that is; the measurement is only meaningful on the box the editor renders inside.

- [ ] **Step 5: Run**

```bash
npx vitest run src/app/use-narrow-element.test.tsx src/app/document-editor.test.tsx src/app/documents-panel.test.tsx --reporter=dot
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"
```

Expected: PASS, `EXIT=0` twice, **798**.

★ `use-media-query.ts` stays — `modern-shell.tsx` and `use-sidebar-collapsed.ts` still consume it. Do **not** delete it.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-narrow-element.ts src/app/use-narrow-element.test.tsx src/app/document-edit-mode.tsx src/app/document-editor.tsx src/app/documents-panel.tsx
git commit -m "fix(documents): measure the pane, not the viewport, for the narrow layout"
```

**Mutants these kill:**
- `width > 0 &&` deleted → *treats a zero width as NOT narrow* goes red.
- `<=` → `<` → *reports narrow at or below the threshold* goes red on the 640 case.
- `typeof ResizeObserver === "undefined"` deleted → *renders without throwing* goes red (it throws).
- `observer.disconnect()` return deleted → *disconnects on unmount* goes red.

---

## Task 14b: F4b — make the narrow-toolbar test non-vacuous BEFORE rewriting it

`document-editor.test.tsx:46-51` asserts `expect(screen.getAllByRole("toolbar")).toHaveLength(1)` against a fixture with **exactly one paragraph** — so it is satisfied with the narrow branch deleted entirely. Fix it against **today's** code first, so Task 15's rewrite starts from a test that can fail, and so the collapse behaviour is pinned across the change.

**Files:**
- Test: `src/app/document-editor.test.tsx:46-51` (**serialise after Task 11**)

- [ ] **Step 1: Give the fixture a second paragraph**

Replace the test with:

```tsx
  // ★★★ TWO PARAGRAPHS, NOT ONE. With a single-paragraph fixture this assertion
  //  is satisfied by the WIDE branch as well — one paragraph mounts one editor
  //  and therefore one toolbar either way — so it passed with the narrow branch
  //  deleted outright. A count assertion needs a fixture in which the two
  //  branches DISAGREE.
  it("docks ONE toolbar at a narrow pane instead of one per block", () => {
    const twoParagraphs: ProjectDocument = {
      ...doc,
      blocks: [
        { type: "heading", level: 1, text: "Summary" },
        { type: "paragraph", html: "<p>First</p>" },
        { type: "paragraph", html: "<p>Second</p>" },
      ],
    };
    const { rerender } = render(
      <DocumentEditor lang={LANG} doc={twoParagraphs} onCommitBlock={vi.fn()} narrow />,
    );
    // jsdom has no layout, so the narrow branch is driven by an injected flag,
    // never by a measured width.
    expect(screen.getAllByRole("toolbar")).toHaveLength(1);

    // The wide branch is what proves the fixture can tell them apart.
    rerender(<DocumentEditor lang={LANG} doc={twoParagraphs} onCommitBlock={vi.fn()} />);
    expect(screen.getAllByRole("toolbar")).toHaveLength(2);
  });
```

- [ ] **Step 2: Run**

Run: `npx vitest run src/app/document-editor.test.tsx --reporter=dot`
Expected: PASS against today's code.

- [ ] **Step 3: Prove it is no longer vacuous**

Temporarily change `document-editor.tsx:54` to `const firstParagraphIndex = -1;` (deleting the narrow branch). Re-run — expected: **FAIL** at `toHaveLength(1)` (it finds 2). Revert; confirm green; `git diff src/app/document-editor.tsx` must be empty.

- [ ] **Step 4: Commit**

```bash
git add src/app/document-editor.test.tsx
git commit -m "test(documents): give the narrow-toolbar test a fixture that can fail"
```

**Mutant this kills:** neutralising `firstParagraphIndex` (any change making every paragraph render live at `narrow`). Measured by Step 3.

---

## Task 15: F13 — build the specced docked toolbar and remove the silent read-only collapse

`docs/superpowers/specs/2026-08-18-documents-s3b-design.md:129-130` specifies: "at a narrow pane the toolbar docks once above the document and acts on the selected block". It was not built. Instead `document-editor.tsx:54` computes `firstParagraphIndex` and every **other** paragraph renders read-only **with no stated reason** — the exact opposite of the principle stated two files away for the image case ("a disabled control with no reason reads as broken", `document-block-editors.tsx:290-294`). And `:54` has no image test, so **if the first paragraph holds an image, `ParagraphBlockEditor` returns the read-only notice and NO paragraph in the document is editable at all.**

### Design

Three parts, in this order:

1. **Selection.** `DocumentEditor` holds `selectedParagraph` state (narrow mode only), defaulting to the first paragraph block. Only the selected paragraph mounts a live editor; every other paragraph renders read-only **with a stated reason and a control that selects it**. Non-paragraph editors (heading, bullets, table, dataSection) stay live at every width — they carry no 20-control toolbar, so there is nothing to dock and nothing to crowd.
2. **The dock.** `DocumentEditor` renders a container **above** the block list and the selected paragraph's `RichTextEditor` portals its toolbar into it. This needs one new **opt-in** prop on `RichTextEditor`; every existing call site stays byte-identical.
3. **The image bug disappears by construction** — selection is user-driven, so a first paragraph holding an image no longer strands the whole document; its read-only notice already states its own reason.

**Why a portal rather than lifting the editor instance:** `RichTextEditor` owns the app's **only** `useEditor` call and carries documented CSP-nonce and null-editor-guard landmines. Lifting the Tiptap instance out to render the toolbar as a sibling would touch every one of those. A portal target prop moves the toolbar's DOM position and nothing else.

**★★ The recorded portal landmine (`ui-flyout-budget-autoscroll-yoachim`: "portaling a menu BREAKS Tab") is checked, not ignored.** It bites when a portal moves content **out of** its logical tab position. Here the dock sits **above** the block list in DOM order, which is the position the spec asks for, so tab order reads dock → blocks. Step 1 asserts that DOM order so a regression is visible.

**★ Known, accepted consequence:** React propagates events through the **React** tree, so a `focusout` inside the portaled toolbar bubbles to `ParagraphEditorBody`'s `<div onBlur={commit}>`. With Task 5's dirty guard an untouched blur returns immediately; a dirty one commits early and the user's next toolbar command re-dirties it. Coalescing (Task 2) folds the extra commit into the same version. Recorded here so a reviewer does not read it as a bug.

**Files:**
- Modify: `src/app/rich-text-editor.tsx` (one opt-in prop)
- Modify: `src/app/document-editor.tsx` (**serialise after Tasks 5 and 14**)
- Modify: `src/app/document-block-editors.tsx` (thread the portal target — **serialise after Tasks 5, 7, 11, 12**)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (two new keys)
- Test: `src/app/document-editor.test.tsx` (**serialise after Task 14b**)

- [ ] **Step 1: Write the failing tests**

Replace Task 14b's narrow test and add the rest, in `src/app/document-editor.test.tsx`:

```tsx
  describe("at a narrow pane", () => {
    const threeBlocks: ProjectDocument = {
      ...doc,
      blocks: [
        { type: "heading", level: 1, text: "Summary" },
        { type: "paragraph", html: "<p>First</p>" },
        { type: "paragraph", html: "<p>Second</p>" },
      ],
    };

    it("docks ONE toolbar instead of one per block", () => {
      const { rerender } = render(
        <DocumentEditor lang={LANG} doc={threeBlocks} onCommitBlock={vi.fn()} narrow />,
      );
      expect(screen.getAllByRole("toolbar")).toHaveLength(1);
      // The wide branch is what proves the fixture can tell the two apart.
      rerender(<DocumentEditor lang={LANG} doc={threeBlocks} onCommitBlock={vi.fn()} />);
      expect(screen.getAllByRole("toolbar")).toHaveLength(2);
    });

    // ★★ THE DOCK IS ABOVE THE DOCUMENT, which is both the spec's wording and
    //  what keeps the portal from breaking Tab: content moved BELOW its
    //  logical position is the recorded failure mode.
    it("renders the docked toolbar before the block list in DOM order", () => {
      const { container } = render(
        <DocumentEditor lang={LANG} doc={threeBlocks} onCommitBlock={vi.fn()} narrow />,
      );
      const toolbar = screen.getByRole("toolbar");
      const firstRow = container.querySelectorAll("[data-block-row]")[0];
      expect(toolbar.compareDocumentPosition(firstRow)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    // ★★★ THE SILENT COLLAPSE WAS THE DEFECT, not the collapse itself. An
    //  unselected paragraph rendering read-only with no reason and no way back
    //  is the "disabled control with no reason reads as broken" failure this
    //  slice states two files away for the image case.
    it("says why an unselected paragraph is read-only, and offers a way in", async () => {
      render(<DocumentEditor lang={LANG} doc={threeBlocks} onCommitBlock={vi.fn()} narrow />);
      expect(screen.getByText(t(LANG, "documentsBlockCollapsedNarrow"))).toBeInTheDocument();
      const select = screen.getByRole("button", {
        name: `${t(LANG, "documentsBlockSelect")} – ${t(LANG, "documentsBlockN", "3")}`,
      });
      await userEvent.click(select);
      // Selection MOVED: the second paragraph is now live and the first is not.
      expect(
        screen.getByRole("textbox", { name: t(LANG, "documentsParagraphLabel", "3") }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("textbox", { name: t(LANG, "documentsParagraphLabel", "2") }),
      ).toBeNull();
    });

    // ★★★ THE IMAGE BUG. `firstParagraphIndex` had no image test, so a first
    //  paragraph holding one made ParagraphBlockEditor return its read-only
    //  notice and left the document with NO editable paragraph anywhere.
    it("leaves another paragraph reachable when the first holds an image", () => {
      const withImage: ProjectDocument = {
        ...doc,
        blocks: [
          { type: "paragraph", html: '<p>Chart</p><img data-asset-id="a1" alt="chart">' },
          { type: "paragraph", html: "<p>Editable</p>" },
        ],
      };
      render(<DocumentEditor lang={LANG} doc={withImage} onCommitBlock={vi.fn()} narrow />);
      expect(
        screen.getByRole("button", {
          name: `${t(LANG, "documentsBlockSelect")} – ${t(LANG, "documentsBlockN", "2")}`,
        }),
      ).toBeInTheDocument();
    });

    // Non-paragraph editors carry no rich toolbar, so there is nothing to dock
    // and nothing to crowd — they stay live at every width.
    it("leaves non-paragraph editors live", () => {
      render(<DocumentEditor lang={LANG} doc={threeBlocks} onCommitBlock={vi.fn()} narrow />);
      expect(screen.getByRole("textbox", { name: headingTextName(0) })).toBeEnabled();
    });
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/app/document-editor.test.tsx --reporter=dot`
Expected: FAIL on every test in the new describe bar the last.

- [ ] **Step 3: Add the two i18n keys**

`src/app/i18n.ts`:

```ts
  documentsBlockSelect: "Edit this block",
  documentsBlockCollapsedNarrow:
    "Only the selected block is editable while the pane is narrow.",
```

`src/app/i18n.de.ts` (CRLF + umlauts — node write, then grep; "ausgewählte" carries one):

```ts
  documentsBlockSelect: "Diesen Block bearbeiten",
  documentsBlockCollapsedNarrow:
    "Nur der ausgewählte Block ist bearbeitbar, solange der Bereich schmal ist.",
```

- [ ] **Step 4: Give `RichTextEditor` an opt-in portal target**

In `src/app/rich-text-editor.tsx`, add to `RichTextEditorProps`:

```ts
  /** Renders the toolbar into this element instead of inline above the
   *  contenteditable. ★★ OPT-IN, and it must stay opt-in: every other surface
   *  wants the toolbar attached to its own editor, and a portal moves DOM
   *  position, which is the recorded way to break Tab order. The one consumer
   *  (the documents block editor at a narrow pane) docks it ABOVE the document,
   *  i.e. the position it already occupies logically. */
  toolbarContainer?: HTMLElement | null;
```

Add the import `import { createPortal } from "react-dom";` and replace the toolbar line (keeping the existing comment block above it verbatim):

```tsx
      {editor &&
        (() => {
          const toolbar = (
            <RichTextToolbar editor={editor} lang={lang} label={label} onAddLink={addLink} />
          );
          return props.toolbarContainer ? createPortal(toolbar, props.toolbarContainer) : toolbar;
        })()}
```

★ The element is built **once** into a local rather than written twice — the duplication gate compares total duplicated lines across the whole repo, and a 1-line JSX element repeated is not worth the risk of it being the line that crosses the threshold.

- [ ] **Step 5: Thread the target through the block editors**

`src/app/document-block-editors.tsx` — add an optional field to `BlockEditorProps`:

```ts
  /** Narrow-pane docking: the paragraph editor portals its toolbar here.
   *  Absent at a wide pane and for every non-paragraph editor. */
  toolbarContainer?: HTMLElement | null;
```

`ParagraphBlockEditor` and `ParagraphEditorBody` forward it; `ParagraphEditorBody` passes `toolbarContainer={toolbarContainer}` to `<RichTextEditor>`. Nothing else changes.

- [ ] **Step 6: Rewrite `DocumentEditor`**

Replace `document-editor.tsx`'s component (keeping `NARROW_PANE_PX`, `KIND_LABEL` and `BlockEditor`'s exhaustiveness note):

```tsx
export function DocumentEditor({ lang, doc, onCommitBlock, narrow = false }: DocumentEditorProps) {
  // ★★★ THE DOCK. A callback ref in STATE, not a `useRef`: the portal target
  //  must exist before the child renders into it, and a ref object's mutation
  //  triggers no re-render (nor may a ref be read during render at all —
  //  react-hooks/refs). The state assignment on mount gives the second render
  //  a real element to portal into.
  const [dock, setDock] = useState<HTMLElement | null>(null);

  // ★★★ SELECTION, not "the first paragraph". The previous cut collapsed every
  //  paragraph but `doc.blocks.findIndex(b => b.type === "paragraph")` with no
  //  stated reason and no way in — and, because that index had no image test, a
  //  first paragraph holding an image (which ParagraphBlockEditor renders
  //  read-only) left the document with NO editable paragraph anywhere. The
  //  spec asks for "the toolbar docks once above the document and acts on the
  //  SELECTED block"; selection is what makes every paragraph reachable and
  //  what makes the image case a non-event.
  //  ★ `null` means "not chosen yet" and resolves to the first paragraph, so a
  //   document whose blocks change under a selection cannot strand it.
  const [chosen, setChosen] = useState<number | null>(null);
  const firstParagraph = doc.blocks.findIndex((b) => b.type === "paragraph");
  const selected =
    chosen !== null && doc.blocks[chosen]?.type === "paragraph" ? chosen : firstParagraph;

  return (
    <div className="flex flex-col gap-3">
      {/* ★ Rendered only at a narrow pane, and ALWAYS when narrow — an empty
          dock is a stable 0-height box, whereas mounting it conditionally on a
          paragraph existing would move every row the moment one is added. */}
      {narrow && <div ref={setDock} className="sticky top-0 z-10 bg-surface" />}
      {doc.blocks.map((block, index) => (
        // ★★★ The key carries `doc.id`, not just `index` — otherwise switching
        //  the SELECTED document while edit mode is open lets React reuse this
        //  row's editor instance for the new document (same position, same
        //  block type), leaving a stale useBlockDraft mounted over the wrong
        //  document. A blur (or an unblurred edit's unmount flush) then writes
        //  the OLD document's content into the NEW one.
        <div
          key={`${doc.id}-${index}`}
          data-block-row=""
          className="flex gap-2 rounded-md border border-line p-2"
        >
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
              collapseParagraph={narrow && index !== selected}
              onSelect={() => setChosen(index)}
              toolbarContainer={narrow && index === selected ? dock : null}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
```

and in `BlockEditor`'s `"paragraph"` case, replace the bare collapsed render with one that explains itself and offers a way in:

```tsx
    case "paragraph":
      return collapseParagraph ? (
        <div className="flex flex-col gap-2">
          {/* ★★★ Re-sanitize AT THE SINK (`sanitizeDocumentHtml`, never
              `sanitizeRichHtml` — it drops `<img>`) — mirrors
              `BlockReadOnlyNotice` in document-block-editors.tsx. This branch
              reaches `dangerouslySetInnerHTML` with STORED html; an earlier
              layer regressing must not turn this collapsed view into a
              stored-XSS sink. */}
          <div
            className="prose-sm max-w-none text-foreground"
            dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(block.html) }}
          />
          <p className="text-xs text-muted-foreground">
            {t(lang, "documentsBlockCollapsedNarrow")}
          </p>
          {/* ★★ The reason AND the way out. A read-only render with neither is
              the "disabled control with no reason reads as broken" defect this
              slice states for the image case — and before selection existed
              there was no way back into these paragraphs at all.
              ★ BLOCK-UNIQUE accessible name via the en-dash `documentsBlockN`
              convention: N buttons named "Edit this block" is a WCAG 2.4.6
              failure no axe rule under the gate's four tags can see, at any
              seed size. The VISIBLE label stays unqualified. */}
          <button
            type="button"
            aria-label={`${t(lang, "documentsBlockSelect")} – ${t(lang, "documentsBlockN", String(index + 1))}`}
            className="w-fit rounded-md border border-line px-2 py-1 text-xs"
            onClick={onSelect}
          >
            {t(lang, "documentsBlockSelect")}
          </button>
        </div>
      ) : (
        <ParagraphBlockEditor
          lang={lang}
          index={index}
          block={block}
          onCommit={onCommit}
          toolbarContainer={toolbarContainer}
        />
      );
```

with `onSelect: () => void;` and `toolbarContainer: HTMLElement | null;` added to `BlockEditor`'s props type, and `useState` imported from react.

★ Every other `case` in `BlockEditor` is unchanged — non-paragraph editors ignore both new props.

- [ ] **Step 7: Run**

```bash
npx vitest run src/app/document-editor.test.tsx src/app/document-block-editors.test.tsx src/app/documents-panel.test.tsx src/app/rich-text-editor.test.tsx src/app/i18n.test.ts --reporter=dot
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: PASS, `EXIT=0` twice.

★ Run the **whole** rich-text suite, not just the documents files: `RichTextEditor` is shared by ten-plus surfaces and the toolbar render path changed shape. `npx vitest run src/app --reporter=dot -t "rich"` is not sufficient — run `npx vitest run src/app/rich-text-toolbar.test.tsx src/app/rich-text-editor.test.tsx src/app/note-log-panel.test.tsx src/app/change-edit-modal.test.tsx --reporter=dot` as well.

- [ ] **Step 8: Prove the mutants die**

| Mutant | Test that goes red |
|---|---|
| `collapseParagraph={narrow && index !== selected}` → `{false}` | *docks ONE toolbar* (finds 2 at narrow) |
| delete `toolbarContainer={…}` from the paragraph case | *renders the docked toolbar before the block list* (the toolbar follows the first row instead) |
| delete the `<p>{t(lang,"documentsBlockCollapsedNarrow")}</p>` | *says why an unselected paragraph is read-only* |
| delete the `onClick={onSelect}` handler | same test — selection does not move, the paragraph-3 textbox is absent |
| `selected` → `firstParagraph` (i.e. drop `chosen`) | *says why…* and *leaves another paragraph reachable when the first holds an image* |

- [ ] **Step 9: Commit**

```bash
git add src/app/rich-text-editor.tsx src/app/document-editor.tsx src/app/document-block-editors.tsx src/app/document-editor.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(documents): dock one toolbar over the selected block at a narrow pane

Builds the narrow-pane layout the design spec specified and never got. The
previous cut collapsed every paragraph but the first with no stated reason
and no way in — and, because that index had no image test, a first paragraph
holding an image left the document with no editable paragraph at all."
```

---

## Task 15b: The zero-block empty state — explain it AND offer a working add-block control

**User decision: option (c)** — an explanatory line **plus** a working control, not the explanatory line alone this plan first recommended. The recommendation rested on a cost estimate that was wrong, and the correction is worth recording: **the write path already exists.**

```
src/app/document-mutations.ts:45  | { op: "append"; block: DocBlock }
src/app/document-mutations.ts:46  | { op: "insert"; index: number; block: DocBlock }
```

Both are members of `DocOp`, both are handled in `applyOps` (`:317`, `:333`), and both are exercised — `document-mutations.test.ts:481` runs `it.each(["append","insert","replace"])` and `document-mutations.property.test.ts:48` includes them in `OpKind`. So this task builds a **UI control emitting an existing op through the mutation path the block editors already use**, not a new op path. Verified against the tree, not taken on trust.

### The four design choices, settled here rather than at implementation time

**1. Which op, and which starting block kind — `append`, and a `paragraph`.**
An empty document has no index to insert at, so `insert` has nothing meaningful to take; `append` is the only op whose contract is satisfied by an empty block list.

The kind is a `paragraph`: it is the block every editor path already handles, it is the one the narrow-pane docking work (Task 15) is built around, and it is what a document normally opens with.

★★★ **But it must NOT be an EMPTY paragraph, and this is the trap.** `document-model.ts:127` drops a paragraph whose `htmlTextLength` is 0 — so appending `{ type: "paragraph", html: "" }` creates a block that renders now and is **gone on the next load**, which is precisely the failure Task 7 exists to prevent. Seeding it three tasks after banning it would be incoherent. The appended block therefore carries a translated placeholder, and the user replaces it. The alternative — appending empty and relying on the user typing before the next save — was rejected: the window is small but real, and "usually fine" is what F3 already caught once.

**2. Empty-state only — and that is a boundary, not an omission.**
The control renders **only** when `doc.blocks.length === 0`. A general add-block affordance (per-position insert, a kind picker, delete, reorder) is the **structural slice**, which `document-editor.tsx`'s own header comment scopes out of S3b ("IN SCOPE IS BLOCK *CONTENT*; the SET of blocks is not… That is the structural slice"). It does **not** belong in Task 15 either: Task 15 is narrow-pane selection among blocks that exist, and folding block creation into it would put two independent changes behind one review. State the boundary; build one control.

**3. Coalescing — the append records its own before-image, and the typing that follows folds into it.**
Two separate questions, and the answers differ:

- **Does the append coalesce into a preceding run? NO.** The mutation is built without a `coalesce` field, so `document-mutations.ts`'s `const before = m.coalesce ? undefined : snapshot(...)` writes the before-image unconditionally. Creating a block is a structural change and the pre-append state is exactly what a user reverting an accidental add wants back. (This matters little for a document that was empty, and a great deal if a general add-block ever reuses this path — so the property is established now, not later.)
- **Do the user's first edits to the new block coalesce onto it? YES**, and it costs no extra code. `appendBlock` advances `lastVersionIdRef` exactly as `commitBlock` does, so the append's version becomes the run's anchor and the typing that follows folds in. That is right: the append's before-image **already is** the pre-session state, so a second version would capture a half-typed placeholder — a revert target nobody wants — and would spend one of `MAX_VERSIONS_PER_DOC` (20) on it.

★ Note that this falls out of Task 2's anchor design rather than being special-cased: the append is one of this hook's own commits, so it advances the anchor for the same reason every other commit does.

**4. What this covers, and what it does NOT.**
It covers a document reduced to **zero blocks** — that document now has a way back. It does **not** cover a **bullets block** reduced to zero items; that stays where it already is in this plan, closed by Task 7's `disabled={value.items.length <= 1}` bound on the remove button. **The two must not merge:** they are different objects (a document's block list vs one block's item list), fixed by different mechanisms (a create affordance vs a lower bound), and treating the new control as covering both would invite someone to relax Task 7's bound on the grounds that "you can just add it back" — which you cannot, because there is no add-bullets-block control and this task deliberately does not build one.

### Size budget

`documents-panel.tsx` is at **799** at branch point and Task 9 nets it to **798**. This task spends **zero** lines there:
- `appendBlock` is returned by `useDocumentEditor` and destructured on the **existing** line 360 alongside `commitBlock`;
- `onAppendBlock` is added to the **existing** single-line `<DocumentEditModeBody … />` element (line ~705).

Re-verify after editing — the whole budget rests on both staying one line each:

```bash
node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"
```

Expected: **798**. The growth lands in `document-editor.tsx` (~134 at branch point, ~250 after Task 15) and `use-document-editor.ts` (74), both far from the cap.

**Files:**
- Modify: `src/app/use-document-editor.ts` (**serialise after Tasks 2 and 13**)
- Modify: `src/app/document-edit-mode.tsx` (**after Tasks 1, 9, 14**)
- Modify: `src/app/document-editor.tsx` (**after Task 15** — this edits the component Task 15 produced)
- Modify: `src/app/documents-panel.tsx` (**after Tasks 9, 13, 14** — zero net lines)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (three new keys)
- Test: `src/app/document-editor.test.tsx`, `src/app/use-document-editor.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/document-editor.test.tsx`:

```tsx
describe("a document with no blocks", () => {
  const empty: ProjectDocument = {
    id: 11,
    title: "Empty",
    blocks: [],
    createdAt: "2026-08-18T10:00:00.000Z",
    updatedAt: "2026-08-18T10:00:00.000Z",
  };

  // ★★ An empty <div> with no message and no affordance reads as broken — the
  //  same principle this slice states for the image case and for the collapsed
  //  narrow-pane paragraph.
  it("says the document has no blocks yet", () => {
    render(
      <DocumentEditor lang={LANG} doc={empty} onCommitBlock={vi.fn()} onAppendBlock={vi.fn()} />,
    );
    expect(screen.getByText(t(LANG, "documentsNoBlocks"))).toBeInTheDocument();
  });

  // ★★★ THE APPENDED PARAGRAPH CARRIES SEEDED TEXT, NOT AN EMPTY ONE.
  //  document-model.ts drops a paragraph whose visible text length is 0, so an
  //  empty seed would create a block that renders now and is GONE on the next
  //  load — the exact failure Task 7 of this round exists to prevent.
  it("appends a paragraph carrying real text", async () => {
    const onAppendBlock = vi.fn();
    render(
      <DocumentEditor lang={LANG} doc={empty} onCommitBlock={vi.fn()} onAppendBlock={onAppendBlock} />,
    );
    await userEvent.click(screen.getByRole("button", { name: t(LANG, "documentsAddBlock") }));
    expect(onAppendBlock).toHaveBeenCalledTimes(1);
    const block = onAppendBlock.mock.calls[0][0] as { type: string; html: string };
    expect(block.type).toBe("paragraph");
    expect(htmlTextLength(block.html)).toBeGreaterThan(0);
    expect(block.html).toContain(t(LANG, "documentsNewBlockText"));
  });

  // ★ The control is EMPTY-STATE ONLY. A general add-block affordance is the
  //  structural slice (document-editor.tsx's own header scopes the block SET
  //  out of S3b), and it is deliberately not built here.
  it("renders no add-block control once the document has a block", () => {
    render(<DocumentEditor lang={LANG} doc={doc} onCommitBlock={vi.fn()} onAppendBlock={vi.fn()} />);
    expect(screen.queryByRole("button", { name: t(LANG, "documentsAddBlock") })).toBeNull();
    expect(screen.queryByText(t(LANG, "documentsNoBlocks"))).toBeNull();
  });
});
```

Add `import { htmlTextLength } from "./rich-text-plain";` to that file — asserting on the **loader's own measure** rather than on a string length is what makes the seeded-text assertion mean "this survives a load" instead of "this is non-empty".

Append to `src/app/use-document-editor.test.ts`:

```ts
describe("useDocumentEditor — appendBlock", () => {
  // ★★★ AN APPEND NEVER COALESCES INTO A PRECEDING RUN. Creating a block is a
  //  structural change and the pre-append state is what a user reverting an
  //  accidental add wants back, so the mutation carries NO coalesce field and
  //  document-mutations.ts writes the before-image unconditionally.
  it("emits an append with no coalesce flag", () => {
    const mutateDocuments = vi.fn((_m: DocMutation): DocResult => result());
    const { result: hook } = renderHook(() =>
      useDocumentEditor({ documentId: 1, versions: [], mutateDocuments, now: () => NOW }),
    );
    hook.current.appendBlock({ type: "paragraph", html: "<p>seed</p>" });
    const sent = mutateDocuments.mock.calls[0][0];
    expect(sent).toMatchObject({ kind: "ops", id: 1, ops: [{ op: "append" }] });
    expect(sent).not.toHaveProperty("coalesce");
  });

  // Same guard as commitBlock: a closure minted for a document that is no
  // longer selected must abandon rather than land on whichever is selected now.
  it("abandons an append from a closure minted for a document that is no longer selected", () => {
    const mutateDocuments = vi.fn((_m: DocMutation): DocResult => result());
    const { result: hook, rerender } = renderHook(
      ({ documentId }: { documentId: number }) =>
        useDocumentEditor({ documentId, versions: [], mutateDocuments, now: () => NOW }),
      { initialProps: { documentId: 1 } },
    );
    const staleAppend = hook.current.appendBlock;
    rerender({ documentId: 2 });
    expect(staleAppend({ type: "paragraph", html: "<p>seed</p>" })).toBeUndefined();
    expect(mutateDocuments).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/app/document-editor.test.tsx src/app/use-document-editor.test.ts --reporter=dot`
Expected: FAIL — `onAppendBlock` is not a prop, `appendBlock` is not returned, and none of the three strings exist.

- [ ] **Step 3: Add the three i18n keys**

`src/app/i18n.ts`, beside the other `documents*` keys:

```ts
  documentsNoBlocks: "This document has no blocks yet.",
  documentsAddBlock: "Add a paragraph",
  documentsNewBlockText: "New paragraph",
```

`src/app/i18n.de.ts`:

```ts
  documentsNoBlocks: "Dieses Dokument hat noch keine Blöcke.",
  documentsAddBlock: "Absatz hinzufügen",
  documentsNewBlockText: "Neuer Absatz",
```

★★ **Two of the three DE strings carry umlauts** ("Blöcke", "hinzufügen") and `i18n.de.ts` is **CRLF** — the Edit tool corrupts umlauts there *and* curls double quotes. Patch by node UTF-8 write with a `\r\n` anchor, then re-verify the bytes:

```bash
node -e "const fs=require('fs');const p='src/app/i18n.de.ts';let s=fs.readFileSync(p,'utf8');const a='  documentsBlockNoEditor:';if(!s.includes(a))throw new Error('anchor missing');const add='  documentsNoBlocks: \"Dieses Dokument hat noch keine Blöcke.\",\r\n  documentsAddBlock: \"Absatz hinzufügen\",\r\n  documentsNewBlockText: \"Neuer Absatz\",\r\n';fs.writeFileSync(p,s.replace(a,add+a),'utf8');"
grep -n "documentsNoBlocks\|documentsAddBlock\|documentsNewBlockText" src/app/i18n.de.ts
```

Expected: three lines printing real `ö` and `ü`, with straight `"` quotes. The `i18n-encoding` test bans ASCII substitutions (`Bloecke`, `hinzufuegen`) and `\u00XX` escapes **in the file** — the command above writes real characters.

★ If Task 7 already inserted a key at the `documentsBlockNoEditor` anchor, anchor on a different existing key; the command throws rather than silently no-opping if the anchor is missing, which is the point of the guard.

- [ ] **Step 4: Add `appendBlock` to the hook**

In `src/app/use-document-editor.ts`, after `commitBlock`:

```ts
  const appendBlock = useCallback(
    (block: DocBlock): DocResult | undefined => {
      // Same abandon-rather-than-clobber guard as commitBlock: this closure was
      // built for `documentId`, and if the panel has moved on, appending here
      // would add a block to whichever document happens to be selected now.
      if (documentId !== currentDocIdRef.current) return undefined;
      // ★★★ NO `coalesce` FIELD, DELIBERATELY. document-mutations.ts reads
      //  `m.coalesce ? undefined : snapshot(target, "update", ctx)`, so omitting
      //  it writes the before-image unconditionally. Creating a block is a
      //  structural change and the pre-append state is exactly what a user
      //  reverting an accidental add wants back — an append must never fold
      //  into a preceding editing run.
      const result = mutateDocuments({ kind: "ops", id: documentId, ops: [{ op: "append", block }] });
      // ★★ ...but it DOES become the run's anchor, so the typing that follows
      //  folds into it. That is not a special case: the append is one of THIS
      //  hook's own commits, so it advances the anchor for the same reason
      //  every other one does. And it is right — the append's before-image
      //  already IS the pre-session state, so a second version would capture a
      //  half-typed placeholder, which is a revert target nobody wants and one
      //  of only MAX_VERSIONS_PER_DOC (20) slots spent.
      if (result.changed) lastVersionIdRef.current = newestVersionId(result.versions);
      return result;
    },
    [documentId, mutateDocuments],
  );

  return { commitBlock, appendBlock };
```

- [ ] **Step 5: Thread it down**

`src/app/document-edit-mode.tsx`:
- `const { commitBlock, appendBlock } = useDocumentEditor(deps);` and add `appendBlock` to the returned object;
- add `onAppendBlock: (block: DocBlock) => void;` to `DocumentEditModeBodyProps`, destructure it, and pass it: `<DocumentEditor lang={lang} doc={doc} onCommitBlock={onCommitBlock} onAppendBlock={onAppendBlock} narrow={narrow} />`.

`src/app/documents-panel.tsx` — **both edits stay on their existing lines**:
- line 360: `const { editing, narrowPane, commitBlock, appendBlock, editToolbar, paneRef } = useDocumentEditMode({ … });`
- line ~705: add `onAppendBlock={appendBlock}` to the existing `<DocumentEditModeBody … />` element.

- [ ] **Step 6: Build the empty state**

`src/app/document-editor.tsx` — add to `DocumentEditorProps`:

```ts
  /** Appends a block. Reached only from the zero-block empty state: the block
   *  SET is otherwise out of scope for this slice (see this file's header). */
  onAppendBlock: (block: DocBlock) => void;
```

and, inside the component Task 15 produced, insert the empty branch as the **first** child of the outer `<div className="flex flex-col gap-3">`, before the `{narrow && <div ref={setDock} …/>}` line:

```tsx
      {doc.blocks.length === 0 && (
        <div className="flex flex-col items-start gap-2 rounded-md border border-line p-3">
          <p className="text-sm text-muted-foreground">{t(lang, "documentsNoBlocks")}</p>
          {/* ★★★ THE SEED IS NOT EMPTY. document-model.ts drops a paragraph
              whose visible text length is 0, so an empty seed would create a
              block that renders now and is GONE on the next load — the exact
              failure this round's "never commit a block the loader discards"
              task exists to prevent. The user replaces the placeholder.
              ★ `plainToHtml`, not `sanitizeRichText`: the input is a
              compile-time i18n literal, so it is provably plain by
              construction — the same justification the other remaining
              `plainToHtml(` call sites carry. Do NOT copy this to a boundary
              whose input could already be HTML; there the escape corrupts it
              permanently.
              ★ No `aria-label`: the visible text IS the accessible name, so
              WCAG 2.5.3 holds by construction and there is nothing to keep in
              step. This control renders once, so it needs no block qualifier. */}
          <button
            type="button"
            className="rounded-md border border-line px-2 py-1 text-xs"
            onClick={() =>
              onAppendBlock({ type: "paragraph", html: plainToHtml(t(lang, "documentsNewBlockText")) })
            }
          >
            {t(lang, "documentsAddBlock")}
          </button>
        </div>
      )}
```

with `import { plainToHtml } from "./sanitize-html";` added and `onAppendBlock` destructured from the props.

★ **`plainToHtml` lives in `sanitize-html.ts`, not `rich-text-plain.ts`** — verified with `grep -rn "export function plainToHtml" src/app/`. The two are easy to confuse because AGENTS.md discusses them in one breath. `document-editor.tsx` already imports `sanitizeDocumentHtml` from that module, so this adds no new dependency edge. (`htmlTextLength`, used by the test in Step 1, *is* in `rich-text-plain.ts`.)

★ Everything else Task 15 wrote is untouched: `doc.blocks.map(...)` renders nothing for an empty list, so the two branches cannot both show.

- [ ] **Step 7: Run**

```bash
npx vitest run src/app/document-editor.test.tsx src/app/use-document-editor.test.ts src/app/documents-panel.test.tsx src/app/i18n.test.ts --reporter=dot
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"
```

Expected: PASS, `EXIT=0` twice, **798**.

★ `tsc` is what enforces EN/DE key parity — a DE dictionary missing one of the three is a compile error, never a test failure.

- [ ] **Step 8: Prove the mutants die**

| Mutant (smallest token change) | Test that goes red |
|---|---|
| `html: plainToHtml(t(lang, "documentsNewBlockText"))` → `html: ""` | *appends a paragraph carrying real text* — `htmlTextLength` is 0 |
| `{ op: "append", block }` → `{ op: "append", block }, coalesce: true` added to the mutation | *emits an append with no coalesce flag* |
| delete `if (documentId !== currentDocIdRef.current) return undefined;` from `appendBlock` | *abandons an append from a closure minted for…* |
| `doc.blocks.length === 0` → `doc.blocks.length >= 0` | *renders no add-block control once the document has a block* |
| delete the `<p>{t(lang,"documentsNoBlocks")}</p>` | *says the document has no blocks yet* — so the message and the control are pinned **separately**, and a control with no explanation cannot pass |

Run each, confirm red, revert, confirm green. `git status --porcelain -uall` must be clean before Step 9.

- [ ] **Step 9: Commit**

```bash
git add src/app/use-document-editor.ts src/app/document-edit-mode.tsx src/app/document-editor.tsx src/app/documents-panel.tsx src/app/document-editor.test.tsx src/app/use-document-editor.test.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(documents): explain the zero-block empty state and offer a way out

A document with no blocks rendered an empty div with no message and no
affordance. It now says so and offers one append — the op already existed
and was already tested; only the control was missing. The seeded paragraph
carries real text on purpose: the loader drops an empty one, so an empty
seed would create a block that vanishes on the next load."
```

---

## Task 16: F15 — record the block editor's a11y-scan gap in the register

`e2e/a11y.spec.ts:19` lists `"Documents"` in `A11Y_VIEWS`, but `grep -rn "Edit blocks\|documentsEditBlocks" e2e/` returns nothing, so the scan only ever renders the read-only **preview**. The whole block editor — five editors, the table grid, every per-block control, N rich-text toolbars, and now the docked toolbar — is unscanned.

### Recommendation: RECORD the gap, do not add the scan in this round

The two options were weighed and the register entry wins, for three reasons that are specific to this round rather than general reluctance:

1. **The surface is being restructured by Task 15 in this very branch.** A scan seeded now pins the pre-selection shape; adding it after Task 15 pins a surface whose first cold review has not happened yet.
2. **AGENTS.md's a11y bullet requires the resulting scan count to be MEASURED in the same commit** ("Don't derive these numbers, MEASURE them … `npx playwright test e2e/a11y.spec.ts --list` prints the total"), and the current tally (109 scans + 1 guard = 110 tests) would change. This plan is written under an absolute constraint against running any gate, playwright included, so the number cannot be produced here — and writing an unmeasured count into AGENTS.md is precisely the failure that file documents four times over.
3. **A meaningful scan needs seed work too.** `e2e/seed.ts` seeds `documents` from the sample workspace; whether that document carries a table, a bullets list and a `dataSection` block determines whether the scan sees anything beyond a heading and a paragraph. That is a seed-data slice, not a one-line spec change.

What the gate could not catch anyway is worth stating in the entry: axe under the four tags `e2e/a11y.spec.ts` requests has **no** rule for two controls sharing an accessible name, at any seed size — which is the dominant risk class on this surface (per-block controls repeated across sibling blocks). The unit tests in `document-block-editors.test.tsx` and `document-editor.test.tsx` remain the only possible detector for that, scan or no scan.

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Find the next free number**

```bash
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
```

★ The second extract is required — `sort -n` cannot parse a leading `## `, and a `§` grep finds only cross-references. Use `<max> + 1` below; the plan deliberately quotes no number, because it would be stale by the time this task runs.

- [ ] **Step 2: Append the entry**

```markdown
## <N>. The Documents block editor is in A11Y_VIEWS but is never scanned

"Documents" is in `A11Y_VIEWS` (`e2e/a11y.spec.ts`), but nothing in `e2e/`
enters edit mode — `grep -rn "Edit blocks\|documentsEditBlocks" e2e/` returns
nothing. Every axe scan of that view therefore renders the read-only
`DocumentPreview`. The block editor is entirely unscanned: five per-kind
editors, the table grid, every per-block control, N rich-text toolbars, and
the narrow-pane docked toolbar.

★★ Same blind-spot CLASS as the Turso-gated views and the Resources →
Calendar sub-tab: the view is listed, so a green run reads as coverage, and
the empty/preview state is what the gate actually sees. Compounding it,
`e2e/seed.ts` seeds `documents` from the sample workspace, so even an
edit-mode scan would only cover the block KINDS that sample happens to carry.

★★★ AND THE GATE COULD NOT CATCH THE DOMINANT RISK HERE ANYWAY. This surface
repeats controls across sibling blocks (and across rows and columns inside a
table block), and axe 4.12.1 has NO rule under the four tags the spec requests
that flags two controls sharing an accessible name, at any seed size — see
AGENTS.md's a11y hard-constraint section for the measurement. The multi-block
unit tests in `document-block-editors.test.tsx` and `document-editor.test.tsx`
are the only detector that exists for that class, and closing this item would
not change that.

**To close:** seed a document carrying every `DocBlock` kind, click the
"Edit blocks" toggle before the scan in `e2e/a11y.spec.ts`, and — in the SAME
commit — re-measure the spec's test total with
`npx playwright test e2e/a11y.spec.ts --list` and update AGENTS.md's count.
Deliberately deferred out of the S3b fix round: the surface was being
restructured by that round's docked-toolbar task, and the count could not be
measured under its constraints.
```

- [ ] **Step 3: Verify the doc-claims gate is not newly loaded**

The entry above cites **no** `path:LINE` citation, deliberately — `npm run docs:claims:check` is a RATCHET that fails on a NEW one. Confirm by eye that no `file.ts:123` form crept in, then:

Run: `node scripts/check-doc-claims.mjs; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 4: Commit**

```bash
git add docs/open-followups.md
git commit -m "docs: record that the Documents block editor is never a11y-scanned"
```

---

## Task 17: Sync the subsystem docs to what this round changed

Three claims in the loaded/subsystem docs are made false by this round. AGENTS.md prose is ungated except for backticked mixed-case symbol NAMES, so nothing will catch these.

**Files:**
- Modify: `docs/AGENTS/documents.md`
- Modify: `AGENTS.md` (only if a claim below appears there — grep first)

- [ ] **Step 1: Find every affected claim**

```bash
grep -n "shouldCoalesce\|coalesc\|NARROW_PANE_QUERY\|useMediaQuery\|firstParagraph" AGENTS.md docs/AGENTS/documents.md docs/CODEMAPS/*.md
```

- [ ] **Step 2: Correct each hit**

For each, apply the change the round actually made:
- **coalescing** — it is no longer "a run of consecutive `user`/`update` versions"; it is "a run anchored to the version id the editor's own last commit produced, so any other writer ends it". Say *why* the content test was insufficient (a live-document restore writes a `user`/`update` before-image) or a future reader will restore it.
- **`NARROW_PANE_QUERY`** — the symbol is gone; it is `NARROW_PANE_PX`, measured by `useNarrowElement` over the pane element. ★ A backticked `NARROW_PANE_QUERY` left anywhere in AGENTS.md or `docs/AGENTS/*.md` **fails `npm run docs:symbols:check`**, which is BLOCKING — this is the one class of doc rot that IS gated, so grep for it specifically.
- **the narrow-pane collapse** — it is selection-driven now, with a stated reason and a select control; the "first paragraph" rule is gone.

- [ ] **Step 3: Run the two doc gates**

```bash
node scripts/check-agents-symbols.mjs; echo "EXIT=$?"
node scripts/check-doc-claims.mjs; echo "EXIT=$?"
```

Expected: `EXIT=0` twice. ★ Check them **unpiped** — a piped exit code is the pipe's, and this repo has shipped a "green" claim off that mistake more than once.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs/AGENTS/documents.md docs/CODEMAPS
git commit -m "docs: sync the documents subsystem docs to the S3b fix round"
```

---

## Final gate run (not a task — do this before reporting the branch ready)

Redirect, check the exit code **unpiped**, then read the file. Never pipe a gate.

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
npm run size:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"
```

★ **`test:shuffle` is not optional** — this round adds test files and reorders assertions inside three existing ones, and it is the only local reproduction of the BLOCKING `unit-tests-shuffled` gate.
★ **Never run two vitest processes at once.** Machine saturation is this repo's documented load-sensitive-flake condition; a "failure" produced that way is not a failure.
★ If the full suite exceeds the 10-minute ceiling, **shard it in the foreground** rather than backgrounding it — a backgrounded run reports the trailing `echo`'s exit code, not vitest's.
★ `size:check` matters more than usual here: `documents-panel.tsx` must land at **798**, and `document-block-editors.tsx` (546 at branch point) grows in Tasks 5, 7, 11, 12 and 15.

**Not runnable locally, and owed before merge:** `e2e`, the axe gate, and `e2e:smoke:prod` (the only check that sees the production CSP). Task 15 adds a `createPortal` to the app's only Tiptap surface; the prod CSP is nonce-only on `style-src-elem` and a rich-text regression there is invisible in dev. Do not report the branch clean on unit gates alone.

---

## DECISIONS — all three questions answered; no open questions remain

1. **The zero-block empty state: option (c) — explanatory line PLUS a working add-block control.** Built in **Task 15b**.

   ★★ **The plan's original recommendation of (b) rested on a wrong cost estimate and is retracted.** It said (c) "needs an `insert` op path". It does not: `append` and `insert` are both already members of `DocOp` (`document-mutations.ts:45-46`), both handled in `applyOps` (`:317`, `:333`), and both already exercised by `document-mutations.test.ts:481`'s `it.each(["append","insert","replace"])` and by `document-mutations.property.test.ts:48`'s `OpKind`. The write path was done; only the control was missing. Recording the retraction rather than quietly deleting it, because the same estimate would otherwise be made again by whoever plans the structural slice.

   The four design choices (op, kind, scope, coalescing) are settled inside Task 15b, along with the trap that nearly made this a data-loss feature: an **empty** appended paragraph is dropped by `document-model.ts:127` on the next load, so the seed carries translated text.

2. **Narrow-pane wording: accepted as proposed** — "Edit this block" (`documentsBlockSelect`), with the reason "Only the selected block is editable while the pane is narrow." (`documentsBlockCollapsedNarrow`). No change to Task 15.

3. **Task 5's blur-policy change: accepted.** A blur now ABANDONS rather than last-write-wins when the stored block moved under a dirty draft. **Kept flagged as user-visible:** an unblurred keystroke burst is discarded when a restore or an AI write lands mid-edit. That is the documented trade (recoverable loss beats unrecoverable), and no design change follows — it is recorded here so it is not rediscovered as a bug report.

★ Independently re-verified by the team lead and unchanged: the D3 ResizeObserver precedent does not exist — both `ResizeObserver` hits in the tree are comments saying the feature deliberately uses none. Task 14 stands as written.

---

## Self-review

**Spec coverage.** Every finding F1–F15 maps to a task: F1→T5, F2→T2, F3→T7, F4a→T8, F4b→T14b, F4c→T4, F4d→T3, F5+F7→T9, F6→T10, F8→T11, F9→T13, F10→T12, F11+F12→T1/T6, F13→T15, F14→T14, F15→T16. The spec gap (D2) is built in T15; D3's ResizeObserver decision is honoured in T14 **with its cited precedent corrected** — `dashboard-grid.tsx` contains no ResizeObserver, only two comments saying it deliberately has none. The zero-block empty state, first written up as an open question, is now **Task 15b** under the user's option (c).

**Placeholder scan.** No "TBD", no "similar to Task N", no "add appropriate error handling". Every code step carries the code. Two deliberate forward references are marked inline and both say what to do until the later task lands: `headingTextName` (Task 11's helper, used by Tasks 5, 8 and 13 — spell it inline until then) and `renderToolbar` (Task 9's own helper, written in that task).

**Type consistency.** `useBlockDraft` is `<T, B extends DocBlock>(fromBlock, storedBlock, index, toBlock, onCommit)` and returns `{ value, setValue, commit, commitValue, seedNonce, dropped }` — the same shape at all five call sites and in every later task. `shouldCoalesce(versions, documentId, now, lastVersionId)` is four arguments everywhere after Task 2, including the property test. `UseDocumentEditorDeps.mutateDocuments` is `(m: DocMutation) => DocResult` from Task 13 onward, and Task 8's test file is updated in Task 13 Step 5 rather than left stale. `NARROW_PANE_QUERY` (a string) becomes `NARROW_PANE_PX` (a number) in Task 14 and is consumed as a number in `useNarrowElement(NARROW_PANE_PX)`. `useNarrowElement` returns `{ ref, narrow }`; `useDocumentEditMode` returns `{ editing, narrowPane, commitBlock, editToolbar, paneRef }` from Task 14 on — note `toggleEditing` leaves that return shape in Task 9 (it moves inside `editToolbar`), so any later reader of it must use `editToolbar.onToggleEditing`.

**Gate exposure declared.** No task touches the six persistence write paths, and `DocVersionOp` is deliberately not extended, so no golden fixture is regenerated. **Task 15b emits an `append` op but adds no field and no op** — `DocOp` already carries it, so the persisted shape is unchanged there too. Five tasks touch the i18n pair and must be serialised against each other (T7, T9, T10, T15, T15b — **nine** new keys in total, EN and DE: 1 + 2 + 1 + 2 + 3). One new coverage-gated `.ts` file is added and deliberately tested rather than excluded (T14); one more (T12) is a constant-only module. `documents-panel.tsx` is tracked at every touch and lands at **798**, with T13, T14 and T15b each spending zero net lines there.

**Type consistency, second pass (Task 15b).** `useDocumentEditor` returns `{ commitBlock, appendBlock }` from T15b on, and `useDocumentEditMode` returns `{ editing, narrowPane, commitBlock, appendBlock, editToolbar, paneRef }`. `appendBlock` has the same `(block: DocBlock) => DocResult | undefined` shape family as `commitBlock`'s `(index, block) => DocResult | undefined`, and `DocumentEditorProps.onAppendBlock` is `(block: DocBlock) => void` — the panel discards the result there for the same reason the block editors do, and the refusal still surfaces because T13 routed the whole hook through the panel's funnel. `plainToHtml` is imported from `sanitize-html.ts` (verified), `htmlTextLength` from `rich-text-plain.ts`.




