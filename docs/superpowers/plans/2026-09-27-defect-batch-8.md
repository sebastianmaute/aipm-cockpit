# Defect batch 8 (data loss) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nothing a user typed is lost when the window closes, and a stored setting that loads as unusable pauses saving on every backend instead of being dropped and overwritten.

**Architecture:**
- A new shared hook, `useCommitOnPageHide`, owns the `pagehide` listener. `useBlockDraft` and the dashboard narrative commit their dirty draft through it. A sweep converts any other editor that commits only on blur.
- §620 extends the existing `diag.decodeFailedSlices` channel, which Turso fills today, into `jsonToWorkspace` and `BrowserBackend.load`. The file and SharePoint backends then publish it as `lastDecodeFailures`, and the generic `use-load-truncation` path pauses saving.

**Tech Stack:** Next.js / React 19, TypeScript, vitest + RTL (jsdom), `node:sqlite` fakes.

**Spec:** `docs/superpowers/specs/2026-09-27-defect-batch-8-design.md`

## Global Constraints

- Worktree `C:/Projects/aipm-wt-c`, branch `fix/defect-batch-8`.
- Commits cite `§NNN` only, never `Closes #NN`.
- Commits carry no `Claude-Session:` trailer and no other attribution.
- Commit with `git commit --only <paths> -F <msgfile>`. Never use `--amend`, `git stash`, `git reset` or `git checkout --`.
- `src/app/*` files are CRLF. Never use `sed -i`. After any Write-tool rewrite, check `git ls-files --eol <file>` still shows `w/crlf`. `docs/**` files are LF.
- `i18n.de.ts` is changed only by a node utf8 script, with real umlauts. (No task here needs a new i18n key; if one turns out to be needed, stop and report NEEDS_CONTEXT.)
- Tests run ONLY while the file `C:/Projects/aipm-wt-c/.superpowers/VITEST-GRANTED` exists. Run `npx vitest run <files> --maxWorkers=2` in the FOREGROUND. Never start a background run, and never run two at once.
- After each run, assert the `Test Files N passed` count. A path that is missing drops out of the run and still exits 0.
- Static checks per task:
  - `npx tsc --noEmit` must report 0 errors in total.
  - `npx eslint --max-warnings=0 <touched files>`
- No change to `CHANGELOG.md`, `APP_VERSION`, `scripts/**` or `AGENTS.md`.
- Owner rule (§185, 2026-09-27): a `visibilitychange` (tab switch or minimize) must NOT commit a draft. Only `pagehide` and unmount commit.
- Owner rule (§620, 2026-09-27): an unusable stored slice pauses saving on the file and IndexedDB backends exactly as on Turso (§617).
- The register index is generated. After any heading change run `node scripts/rebuild-followup-index.mjs`; `node scripts/rebuild-followup-index.mjs --check` must exit 0.

## Review Focus

1. **An emptied draft on `pagehide`.** A block cleared to nothing and then closed is refused (not saved as an empty block) and does not throw. It is pinned in Task 1.
2. **A restore or AI write that lands while a draft is dirty, then `pagehide`.** The draft is abandoned; the committed write is not clobbered (`externallyWritten`). It is pinned in Task 1.
3. **A JSON file holding legitimately empty slices** (`features: []`, `steeringCommittee: {}`, `settingsOverrides: {}`, `knowledgeItems: []`, a status of blank strings) must NOT pause saving. A false positive blocks every save for that user. It is pinned in Task 4.
4. **The version-history compare, diff and restore paths** decode old payloads that may hold junk slices. They pass no `diag` and must never raise a pause. It is pinned in Task 4.
5. **Two dirty editors at once on `pagehide`.** Both drafts are committed and persisted. It is pinned in Task 1.

---

### Task 1: `useCommitOnPageHide` + every dirty block draft commits on `pagehide` (§622)

**Files:**
- Create: `src/app/use-commit-on-page-hide.ts`
- Create: `src/app/use-commit-on-page-hide.test.tsx`
- Modify: `src/app/document-block-editors.tsx:424-472` (the §185 `pagehide` block inside `useBlockDraft`)
- Test: `src/app/document-block-editors.test.tsx` (new describe after the §185 describe that ends at `:566`)

**Interfaces:**
- Produces: `export function useCommitOnPageHide(commit: () => void): void`. It commits synchronously inside a `pagehide` event, wrapped in `flushSync`. Tasks 2 and 3 use it.

- [ ] **Step 1: Write the hook's failing test** in `src/app/use-commit-on-page-hide.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { useState } from "react";
import { useCommitOnPageHide } from "./use-commit-on-page-hide";

function Probe({ commit }: { commit: () => void }) {
  useCommitOnPageHide(commit);
  return null;
}

describe("useCommitOnPageHide", () => {
  const firePageHide = () => window.dispatchEvent(new Event("pagehide"));
  const fireHidden = () => {
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    spy.mockRestore();
  };

  it("calls the commit once per pagehide", () => {
    const commit = vi.fn();
    render(<Probe commit={commit} />);
    act(() => firePageHide());
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("does not commit on a tab switch (visibilitychange → hidden)", () => {
    const commit = vi.fn();
    render(<Probe commit={commit} />);
    act(() => fireHidden());
    expect(commit).not.toHaveBeenCalled();
  });

  it("calls the LATEST commit, not the one from mount", () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<Probe commit={first} />);
    view.rerender(<Probe commit={second} />);
    act(() => firePageHide());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops listening after unmount", () => {
    const commit = vi.fn();
    const view = render(<Probe commit={commit} />);
    view.unmount();
    act(() => firePageHide());
    expect(commit).not.toHaveBeenCalled();
  });

  it("renders the state the commit sets before the event returns (flushSync)", () => {
    let seen = "";
    function Setter() {
      const [v, setV] = useState("before");
      seen = v;
      useCommitOnPageHide(() => setV("after"));
      return null;
    }
    render(<Setter />);
    // Read INSIDE the act: an unloading page runs no later task.
    let during = "";
    act(() => { firePageHide(); during = seen; });
    expect(during).toBe("after");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `npx vitest run src/app/use-commit-on-page-hide.test.tsx --maxWorkers=2`. Expected: FAIL with "Failed to resolve import ./use-commit-on-page-hide".

- [ ] **Step 3: Create `src/app/use-commit-on-page-hide.ts`** (CRLF):

```ts
// src/app/use-commit-on-page-hide.ts — §622: commit a local draft on a real unload.
//
// ★★★ A draft that lives only in component state is LOST on a window close,
//  reload or navigation: none of them runs React cleanup, so an unmount flush
//  never fires, and a blur never happens. `pagehide` is the one signal all
//  three send. Every editor that holds a draft until blur registers its commit
//  here (§622, and the dashboard narrative).
// ★★★ NOT `visibilitychange` → hidden, by OWNER DECISION (§185, 2026-09-27):
//  that signal is also a tab switch or a minimise, which must keep the draft.
// ★★ `flushSync` IS THE ORDERING: the workspace save captures its snapshot per
//  effect run, so the commit must re-render the provider and re-run the save
//  effect INSIDE this event. That re-run is written at once because
//  debounced-save.ts knows the page is hiding (`pageHiding`).
// ★ A plain bubble listener on purpose. jsdom (unlike Chromium) invokes a bubble
//  listener that a CAPTURE listener adds at the target, so a capture listener
//  would let tests pass through the save's re-armed listener, which the browser
//  never calls, and hide a broken `pageHiding`.
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";

/** Run `commit` synchronously on every `pagehide` while mounted. The latest
 *  `commit` is used, so it may close over render state. */
export function useCommitOnPageHide(commit: () => void): void {
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => {
    const onPageHide = () => {
      flushSync(() => commitRef.current());
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);
}
```

- [ ] **Step 4: Run the hook test and confirm it passes.** Same command. Expected: 5 passed.

- [ ] **Step 5: Write the failing block-editor tests.** Append a new describe to `src/app/document-block-editors.test.tsx`, directly after the §185 describe (which ends at `:566`):

```tsx
// ★★★ §622 — an ordinary (under-cap) draft that was never blurred was LOST on
//  close, reload or navigation: the §185 `pagehide` flush committed only an
//  over-cap paragraph. Every block type shares `useBlockDraft`, so each is
//  pinned here. A tab switch still commits nothing (owner rule, §185).
describe("useBlockDraft — an unblurred draft on pagehide (§622)", () => {
  const firePageHide = () => window.dispatchEvent(new Event("pagehide"));
  const fireHidden = () => {
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    spy.mockRestore();
  };

  it("paragraph: commits the typed text on pagehide, without a blur", async () => {
    const onCommit = vi.fn();
    render(<ParagraphBlockEditor lang={LANG} index={0} block={{ type: "paragraph", html: "<p>a</p>" }} onCommit={onCommit} />);
    const editable = await findParagraphEditable(0);
    editable.focus();
    await userEvent.type(editable, "bc");
    expect(onCommit).not.toHaveBeenCalled();
    act(() => firePageHide());
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][1].html).toContain("abc");
  });

  it("heading: commits the typed text on pagehide, without a blur", async () => {
    const onCommit = vi.fn();
    render(<HeadingBlockEditor lang={LANG} index={0} block={{ type: "heading", level: 2, text: "Old" }} onCommit={onCommit} />);
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    await userEvent.type(text, "er");
    act(() => firePageHide());
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][1]).toEqual({ type: "heading", level: 2, text: "Older" });
  });

  it("bullets: commits the typed item on pagehide, without a blur", async () => {
    const onCommit = vi.fn();
    render(<BulletsBlockEditor lang={LANG} index={0} block={{ type: "bullets", items: ["one"] }} onCommit={onCommit} />);
    const item = screen.getAllByRole("textbox", { name: /^Item \d+/ })[0];
    await userEvent.type(item, "!");
    act(() => firePageHide());
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][1]).toEqual({ type: "bullets", items: ["one!"] });
  });

  it("table: commits the typed cell on pagehide, without a blur", async () => {
    const onCommit = vi.fn();
    const block: DocBlock = { type: "table", rows: [["a", "b"], ["c", "d"]] } as DocBlock;
    render(<TableBlockEditor lang={LANG} index={0} block={block} onCommit={onCommit} />);
    const cell = screen.getAllByRole("textbox", { name: /^Row \d+, column \d+/ })[0];
    await userEvent.type(cell, "z");
    act(() => firePageHide());
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onCommit.mock.calls[0][1])).toContain("az");
  });

  it("commits nothing on a tab switch; the draft stays dirty for the blur", async () => {
    const onCommit = vi.fn();
    render(<HeadingBlockEditor lang={LANG} index={0} block={{ type: "heading", level: 2, text: "Old" }} onCommit={onCommit} />);
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    await userEvent.type(text, "er");
    act(() => fireHidden());
    expect(onCommit).not.toHaveBeenCalled();
    text.blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("commits once: a later unmount does not commit again", async () => {
    const onCommit = vi.fn();
    const view = render(<HeadingBlockEditor lang={LANG} index={0} block={{ type: "heading", level: 2, text: "Old" }} onCommit={onCommit} />);
    await userEvent.type(screen.getByRole("textbox", { name: headingTextName(0) }), "er");
    act(() => firePageHide());
    view.unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("refuses an emptied draft on pagehide instead of saving an empty block", async () => {
    const onCommit = vi.fn();
    render(<HeadingBlockEditor lang={LANG} index={0} block={{ type: "heading", level: 2, text: "Old" }} onCommit={onCommit} />);
    await userEvent.clear(screen.getByRole("textbox", { name: headingTextName(0) }));
    expect(() => act(() => firePageHide())).not.toThrow();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits BOTH of two dirty editors on one pagehide", async () => {
    const a = vi.fn();
    const b = vi.fn();
    render(
      <>
        <HeadingBlockEditor lang={LANG} index={0} block={{ type: "heading", level: 2, text: "A" }} onCommit={a} />
        <HeadingBlockEditor lang={LANG} index={1} block={{ type: "heading", level: 2, text: "B" }} onCommit={b} />
      </>,
    );
    await userEvent.type(screen.getByRole("textbox", { name: headingTextName(0) }), "1");
    await userEvent.type(screen.getByRole("textbox", { name: headingTextName(1) }), "2");
    act(() => firePageHide());
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
```

Also add a persistence case to the existing §185 describe, so the real `scheduleDebouncedSave` path is proved for an UNDER-cap draft. Its `SaveHarness` starts over the cap, so give it an optional start value:

```tsx
  // In SaveHarness: add a prop `start?: string` and seed with
  //   useState(() => start ?? bold(MAX_HTML_TEXT_CHARS - 1))
  it("persists an UNDER-cap unblurred draft exactly once on pagehide (§622)", async () => {
    const saved: string[] = [];
    const commits: string[] = [];
    render(<SaveHarness tick={0} saved={saved} commits={commits} start="<p>a</p>" />);
    const editable = await findParagraphEditable(44);
    editable.focus();
    await userEvent.type(editable, "bc");
    let savedDuringUnload: string[] = [];
    act(() => { firePageHide(); savedDuringUnload = [...saved]; });
    expect(commits).toHaveLength(1);
    expect(commits[0]).toContain("abc");
    expect(savedDuringUnload.filter((h) => h.includes("abc"))).toHaveLength(1);
  });
```

The concurrent-write case (Review Focus 2) reuses the existing abandon test in this file. `grep -n "externallyWritten\|conflict" src/app/document-block-editors.test.tsx` finds the blur-path version. Add one `pagehide` twin beside it: do the same setup, dispatch `pagehide` instead of `blur()`, and expect no commit.

If a table block's shape differs from `{ type: "table", rows }`, copy the `block` fixture from the existing `describe("TableBlockEditor"` (around `:1070`). Do not invent a shape.

- [ ] **Step 6: Run the tests and confirm they fail.** Run `npx vitest run src/app/document-block-editors.test.tsx --maxWorkers=2`. Expected: the four "commits the typed … on pagehide" cases, "commits BOTH" and the under-cap persistence case FAIL with 0 calls. The tab-switch, unmount and emptied cases may already pass; that is fine, they guard the fix.

- [ ] **Step 7: Implement.** In `src/app/document-block-editors.tsx`, add `import { useCommitOnPageHide } from "./use-commit-on-page-hide";`. Then replace the block from the `// ★★★ §185 — THE UNLOAD EXIT FOR A REFUSED OVER-CAP DRAFT.` comment through the end of the `pagehide` `useEffect` (`:424-472`) with:

```tsx
  // ★★★ §185 + §622 — THE UNLOAD EXIT FOR EVERY DIRTY DRAFT. A window close,
  //  reload or navigation runs no React cleanup, so the unmount flush below
  //  never fires and an unblurred draft would be LOST. `pagehide` commits it:
  //  an over-cap paragraph FLATTENED (the owner's "save flattened, nothing
  //  lost" — no notice can render during an unload), every other draft as is.
  //  §622: this used to return early unless the paragraph was over the cap, so
  //  an ordinary edit in any block type was lost on close.
  //  ★★★ The listener, the `flushSync` ordering and the no-`visibilitychange`
  //   owner rule live in `useCommitOnPageHide`; read its header before changing
  //   this.
  //  ★ The dirty flag is cleared in the same statement as the commit, like every
  //   other `tryCommit` caller (the ★★★ invariant on `preCommitStoredRef`), so the
  //   editor adopts what was saved and the unmount flush stops at its dirty
  //   guard. An emptied draft is refused inside `tryCommit`, and a concurrent
  //   write still abandons it (`externallyWritten`), exactly as on a blur.
  //  Pinned by "persists it flattened exactly once" (§185) and the §622
  //  describe in document-block-editors.test.tsx.
  useCommitOnPageHide(() => {
    if (!dirtyRef.current) return;
    const raw = toBlock(liveValueRef.current);
    tryCommit(raw, paragraphOverCap(raw));
    markDirty(false);
  });
```

Remove the now-unused `flushSync` import from `document-block-editors.tsx` ONLY if `grep -n "flushSync" src/app/document-block-editors.tsx` shows no other use.

- [ ] **Step 8: Run the tests and confirm they pass.** Run `npx vitest run src/app/document-block-editors.test.tsx src/app/use-commit-on-page-hide.test.tsx src/app/debounced-save.test.ts --maxWorkers=2`. Expected: all pass, including the unchanged §185 describe (tab switch, both unload orders, no double commit). Then run tsc and eslint on the three touched source/test files.

- [ ] **Step 9: Mutation check.** Apply each mutant alone, run the two test files, and record red or green. Revert each one before the next, and prove the revert with `git diff --stat`.
  - M1: restore `if (!paragraphOverCap(raw)) return;` after `const raw = …`. Expected red: the four per-type §622 cases, "BOTH" and under-cap persistence.
  - M2: remove `flushSync` in the hook (call `commitRef.current()` directly). Expected red: hook "flushSync" case and the §185 "exactly once" cases.
  - M3: in the hook, also listen for `visibilitychange` and commit. Expected red: hook "tab switch" and §622 "tab switch".
  - M4: drop `markDirty(false)`. Expected red: "commits once: a later unmount…".

- [ ] **Step 10: Commit.**

```
git add src/app/use-commit-on-page-hide.ts src/app/use-commit-on-page-hide.test.tsx
git commit --only src/app/use-commit-on-page-hide.ts src/app/use-commit-on-page-hide.test.tsx src/app/document-block-editors.tsx src/app/document-block-editors.test.tsx -F <msgfile>
```
Message: `fix: §622 commit every dirty block draft on pagehide`

### Task 2: Dashboard narrative commits on `pagehide` (E1)

**Files:**
- Modify: `src/app/dashboard-sections/dashboard-narrative.tsx` (`NarrativeEditor`, `commitNarrative` at `:202-205`)
- Test: `src/app/dashboard-sections/dashboard-narrative.test.tsx`

**Interfaces:**
- Consumes: `useCommitOnPageHide(commit: () => void): void` from Task 1.

- [ ] **Step 1: Write the failing test.** In `dashboard-narrative.test.tsx`, find the existing `NarrativeEditor` tests with `grep -n "NarrativeEditor" src/app/dashboard-sections/dashboard-narrative.test.tsx`. Reuse their render helper and their way of typing into the rich-text editor, and add:
  - "commits the typed narrative on pagehide without a blur": type `" more"`, then `act(() => window.dispatchEvent(new Event("pagehide")))`. The `setStatus` spy (or a harness state) must receive a narrative containing the typed text, exactly once.
  - "commits nothing on a tab switch": type, fire `visibilitychange` with `visibilityState` mocked to `"hidden"`, and expect `setStatus` not to be called.
  - "commits nothing on pagehide when unchanged": render, then fire `pagehide` without typing, and expect no call.

  If the file has no editor-typing helper, copy the `beforeAll` ProseMirror jsdom stubs from `src/app/document-block-editors.test.tsx:32-46`, and find the contenteditable with `screen.findByRole("textbox", { name: t(LANG, "dashboardNarrativePlaceholder") })`.

- [ ] **Step 2: Run the test and confirm it fails.** Run `npx vitest run src/app/dashboard-sections/dashboard-narrative.test.tsx --maxWorkers=2`. Expected: the pagehide case FAILS with 0 calls.

- [ ] **Step 3: Implement.** Add `import { useCommitOnPageHide } from "../use-commit-on-page-hide";`, and directly after `commitNarrative` add:

```tsx
  // ★★★ E1 (§622's class) — the narrative draft lives only in this component
  //  and is committed on blur, Done or Escape. A window close, reload or
  //  navigation does none of those, so the typed summary was LOST. `pagehide`
  //  commits it; a tab switch does not (owner rule, see the hook's header).
  useCommitOnPageHide(commitNarrative);
```

- [ ] **Step 4: Run the test and confirm it passes.** Same command, plus `src/app/use-commit-on-page-hide.test.tsx`. Then run tsc and eslint on the touched files.

- [ ] **Step 5: Mutation check.** M1: remove the `useCommitOnPageHide(commitNarrative);` line. Expected red: the pagehide case. Revert it and prove the revert with `git diff --stat`.

- [ ] **Step 6: Commit.** Use `git commit --only` with the two files. Message: `fix: §622 dashboard narrative commits on pagehide (E1)`. The E1 § number does not exist yet; Task 6 assigns it, so cite §622 here.

### Task 3: Sweep for other blur-only draft editors (§622 class)

**Files:**
- Read: every candidate listed by the command below.
- Modify: each file the sweep labels AFFECTED, and its test file.

**Interfaces:**
- Consumes: `useCommitOnPageHide` from Task 1.
- Produces: the labelled list, written to the report file. Task 6 copies it into the E1 Status line.

- [ ] **Step 1: List the candidates:**

```
cd C:/Projects/aipm-wt-c/src/app
grep -rlE "onBlur=\{" --include=*.tsx . | grep -v "\.test\." | xargs grep -lE "useState\(" | sort
```

There were 23 files at `e6793604d`. `document-block-editors.tsx`, `bullets-block-editor.tsx`, `document-table-editor.tsx` (all through `useBlockDraft`, Task 1) and `dashboard-narrative.tsx` (Task 2) are already covered. Label them `COVERED`.

- [ ] **Step 2: Label every other file.** It is AFFECTED only if ALL of these hold:
  - (a) text the user types lives only in component state;
  - (b) that state reaches the workspace or storage only on blur, Enter or a Save/Done click;
  - (c) no `onChange` path commits it.

  Label it NOT, with the reason, when any conjunct fails. Typical reasons: it commits on every change; it is a filter or search field with nothing to persist; it lives in a modal whose Save is the only intended commit and whose Cancel discards on purpose. Count the conjuncts in the CODE, not in a comment.

  Write a table to the report with one row per file: file, component, verdict, conjunct that fails or evidence line.

- [ ] **Step 3: Check the size.** If more than 4 files are AFFECTED, STOP. Report DONE_WITH_CONCERNS with the table, and do not convert any. The controller rules on which ones ship and which become register entries.

- [ ] **Step 4: Convert each AFFECTED editor (≤ 4).**
  - Write its failing test first: type, fire `pagehide`, and expect the commit. Also fire a tab switch and expect no commit.
  - Add `useCommitOnPageHide(<its existing commit function>)`, placed beside its blur commit with a one-line `// ★ §622 class — …` comment naming why.
  - Run the test red, then green, then do the M1 mutation (remove the hook call) and confirm red.

- [ ] **Step 5: Commit.** If there is nothing to convert, make no commit and record `0 AFFECTED` in the report. Otherwise, one commit per file or one for all: `fix: §622 <component> commits on pagehide`.

### Task 4: `jsonToWorkspace` records a meta slice that sanitizes to nothing (§620)

**Files:**
- Modify: `src/app/workspace.ts` (`jsonToWorkspace`, `:605-800`)
- Test: `src/app/workspace.test.ts` (or the existing test file that covers `jsonToWorkspace`; find it with `grep -rln "jsonToWorkspace(" src/app --include=*.test.ts | head`, and add a new describe to the one that already tests its slice sanitizing)

**Interfaces:**
- Consumes: `sanitizedToNothing(raw, sanitized)` from `src/app/meta-slice-decode.ts`, and `DocTruncationDiag.decodeFailedSlices?: string[]` (already declared; Turso fills it).
- Produces: `jsonToWorkspace(text, { diag })` pushes the JSON key of each dropped slice into `diag.decodeFailedSlices`. There are 13 keys: `status`, `project`, `fieldVisibility`, `features`, `steeringCommittee`, `timelogLinks`, `knowledgeItems`, `insights`, `activityLog`, `budgetHistory`, `documents`, `documentVersions`, `settingsOverrides`. Without `diag`, it behaves exactly as today. Task 5 relies on this.

- [ ] **Step 1: Write the failing tests:**

```ts
describe("jsonToWorkspace — a slice that sanitizes to nothing (§620)", () => {
  const base = { tasks: [], raid: [] };
  const load = (extra: Record<string, unknown>) => {
    const diag: DocTruncationDiag = {};
    const ws = jsonToWorkspace(JSON.stringify({ ...base, ...extra }), { diag });
    return { ws, failed: diag.decodeFailedSlices ?? [] };
  };

  // One junk value per slice: it has content, and its sanitizer keeps none.
  // ★ Verify each value really sanitizes to nothing BEFORE trusting a red:
  //  `sanitizedToNothing(v, sanitizeX(v))` must be true for it. Where a value
  //  here survives its sanitizer, replace it with one that does not, and say so
  //  in the report.
  it.each([
    ["project", { name: 42, bogus: true }],
    ["fieldVisibility", { nope: "x" }],
    ["features", ["no-such-module"]],
    ["steeringCommittee", { members: "not-a-list", x: 1 }],
    ["timelogLinks", { junk: 1 }],
    ["knowledgeItems", [{ nope: 1 }]],
    ["insights", [{ nope: 1 }]],
    ["activityLog", [{ nope: 1 }]],
    ["budgetHistory", [{ nope: 1 }]],
    ["documents", [{ nope: 1 }]],
    ["documentVersions", [{ nope: 1 }]],
    ["settingsOverrides", { unknownKey: 5 }],
  ])("records %s and leaves the slice off", (key, junk) => {
    const { ws, failed } = load({ [key]: junk });
    expect(failed).toEqual([key]);
    expect((ws as unknown as Record<string, unknown>)[key]).toBeUndefined();
  });

  it.each([
    ["features", []],
    ["steeringCommittee", {}],
    ["settingsOverrides", {}],
    ["knowledgeItems", []],
    ["status", { narrative: "" }],
    ["project", {}],
  ])("stays silent for a genuinely empty %s", (key, empty) => {
    expect(load({ [key]: empty }).failed).toEqual([]);
  });

  it("records nothing and changes nothing when no diag is passed", () => {
    const text = JSON.stringify({ ...base, steeringCommittee: { members: "not-a-list", x: 1 } });
    expect(() => jsonToWorkspace(text)).not.toThrow();
    expect(jsonToWorkspace(text).steeringCommittee).toBeUndefined();
  });

  it("records nothing for a valid slice", () => {
    const valid = jsonToWorkspace(workspaceToJson({ ...emptyWorkspace(), features: [] }));
    const diag: DocTruncationDiag = {};
    jsonToWorkspace(workspaceToJson(valid), { diag });
    expect(diag.decodeFailedSlices ?? []).toEqual([]);
  });
});
```

Add a `status` junk row only if a status value exists that `sanitizeProjectStatus` reduces to an object with no own keys. Check it in the test file with `expect(Object.keys(sanitizeProjectStatus(v))).toEqual([])` first. If no such value exists, record in the report that `status` cannot drop on JSON, and leave it out of the `it.each`.

Also add a Review Focus 4 guard in `src/app/use-version-history.test.ts` (or the file that covers `writeVersion`'s diff gate):
- A version payload holding a junk `steeringCommittee` is diffed or restored without any decode failure being recorded.
- Its `jsonToWorkspace` calls take no `diag`. Assert this by grepping in the test: read the source of `use-version-history.ts` with `fs.readFileSync` and expect no `diag` inside any `jsonToWorkspace(` call. That is a structural pin; name it so.

- [ ] **Step 2: Run the tests and confirm they fail.** Expected: each "records …" row FAILS with `[]`. The silent and no-diag cases pass.

- [ ] **Step 3: Implement.** In `jsonToWorkspace`, after `const p = parsed as Record<string, unknown>;`, add:

```ts
    // ★★★ §620 — A SLICE THAT SANITIZES TO NOTHING WAS DROPPED IN SILENCE, and
    //  the next save wrote the file without it — gone for good. Turso reports the
    //  same case since §617 (`decodeMeta` in turso-schema.ts); this is the JSON
    //  half, through the SAME accumulator, so `use-load-truncation` pauses saving
    //  with no new mechanism. Opt-in by `diag`: the version-history diff, import
    //  and the demo seed pass none and never raise a pause.
    //  ★★ `sanitizedToNothing` compares INPUT with output, so a stored `[]`, `{}`
    //   or blank-string record (which also sanitizes to nothing) stays silent.
    const decodeDiag = opts?.diag;
    const noteIfDropped = (key: string, rawValue: unknown, sanitized: unknown): void => {
      if (decodeDiag && sanitizedToNothing(rawValue, sanitized)) {
        (decodeDiag.decodeFailedSlices ??= []).push(key);
      }
    };
```

Then add a `noteIfDropped` call beside each slice, with the RAW value and the value that is actually KEPT (or `undefined` when the key stays off):
- `status`: `noteIfDropped("status", p.status, raw.status);` after the `raw` object literal.
- `project`: inside its `if`, `noteIfDropped("project", p.project, project);`
- `fieldVisibility`: `noteIfDropped("fieldVisibility", p.fieldVisibility, fieldVisibility);`
- `features`: inside its `if`, after the assignment, `noteIfDropped("features", p.features, raw.features);`
- `steeringCommittee`, `timelogLinks`: inside each `if`, with `committee` / `links`.
- `knowledgeItems`, `insights`, `activityLog`, `budgetHistory`: inside each `if`, with `items` / `ins` / `log` / `hist`.
- `documents`: in the `try`, `noteIfDropped("documents", p.documents, docs);`. In the `catch`, after the `if (strict) throw err;` line, add `if (decodeDiag) (decodeDiag.decodeFailedSlices ??= []).push("documents");`. This matches Turso, which reports a throw too.
- `documentVersions`: the same two changes, with `versions`.
- `settingsOverrides`: `noteIfDropped("settingsOverrides", p.settingsOverrides, hasAnyOverride(overrides) ? overrides : undefined);`

Import `sanitizedToNothing` from `./meta-slice-decode`. `calendarEvents` and `documentAssets` are row lists, not meta slices; leave them unchanged (spec scope).

- [ ] **Step 4: Run the tests and confirm they pass.** Then run the tests this change can invalidate:

```
grep -rln "jsonToWorkspace(\|decodeFailedSlices\|lastDecodeFailures" src --include=*.test.ts --include=*.test.tsx
```

Run every hit, plus `turso-backend.test.ts`. Its single-tenant blob path (`turso-backend.ts:284`) now reports too, which is intended.

Label each failing test DELETE, MIGRATE or RECOMPUTE, with a reason, in the report. A test that asserted a junk slice loads silently through a `diag` path is MIGRATE: it now expects the record.

- [ ] **Step 5: Mutation check.** Apply each mutant alone and revert it.
  - M1: make `noteIfDropped` a no-op. Expected red: every "records" row.
  - M2: replace `sanitizedToNothing(rawValue, sanitized)` with `isEmptyDecoded(sanitized)`. Expected red: the "genuinely empty" rows.
  - M3: pass `{ diag: {} }` in one `jsonToWorkspace` call in `use-version-history.ts`. Expected red: the structural pin.

- [ ] **Step 6: Commit.** Message: `fix: §620 jsonToWorkspace records a slice that sanitizes to nothing`

### Task 5: File, SharePoint and IndexedDB backends publish `lastDecodeFailures` (§620)

**Files:**
- Modify: `src/app/local-file-backend.ts` (`resetLoadDiagnostics` `:287-293`, the `loadFrom` `finally` `:267-272`)
- Modify: `src/app/sharepoint-backend.ts` (resets `:116-119`, `finally` `:166-171`)
- Modify: `src/app/browser-backend.ts` (reset `:139`, meta sanitizing `:271-305`, publish `:437-440`)
- Test: `src/app/local-file-backend.test.ts`, `src/app/sharepoint-backend.test.ts`, `src/app/browser-backend.test.ts` (use each file's existing fixture helpers), and `src/app/use-storage-backend.test.tsx` for the pause.

**Interfaces:**
- Consumes: Task 4's recording.
- Produces: `lastDecodeFailures: readonly string[]` on `LocalFileBackend`, `SharePointBackend` and `BrowserBackend`, the optional field that the storage backend interface already declares (`workspace.ts:484`). It is `[]` after a clean load and after every failing exit.

- [ ] **Step 1: Confirm where the pause is decided.** `grep -n "reportFor(\|raiseDecodeFailuresFor(" src/app/use-storage-backend.ts`. Check that every load path, whatever the backend kind, reaches `truncationOps.reportFor(backend)` or `raiseDecodeFailuresFor(backend)`, and quote the lines in the report. If any backend kind's load does not reach either, STOP and report NEEDS_CONTEXT with the lines.

- [ ] **Step 2: Write the failing tests.**
  - For each of the three backends: load a stored workspace whose `steeringCommittee` is `{ members: "not-a-list", x: 1 }` (use the junk value Task 4 settled on). Expect `backend.lastDecodeFailures` to equal `["steeringCommittee"]`. Then load a clean workspace and expect `[]`, which proves the reset.
  - File and SharePoint: a throwing load after a failing one leaves `[]`. Copy the existing stale-diagnostics test for `lastLoadTruncation` in each file, and extend it.
  - IndexedDB: seed the KV store the way the existing `browser-backend.test.ts` seeds a committee, but with the junk value.
  - Pause: in `use-storage-backend.test.tsx`, find the §617 Turso decode-failure pause test (`grep -n "lastDecodeFailures" src/app/use-storage-backend.test.tsx`). Add a twin that uses a file-kind backend fake reporting `lastDecodeFailures: ["steeringCommittee"]`, and expect the same paused state and the same "Save anyway" path.

- [ ] **Step 3: Run the tests and confirm they fail.** Expected: `lastDecodeFailures` is `undefined`.

- [ ] **Step 4: Implement.**

`local-file-backend.ts`:
- Add a field beside `lastLoadTruncation`:

```ts
  /** §620 — meta slices the last load decoded to NOTHING (see `jsonToWorkspace`).
   *  Read by `truncationOps.reportFor`, which pauses saving. Reset and published
   *  exactly like `lastLoadTruncation`, for the same stale-value reason. */
  lastDecodeFailures: readonly string[] = [];
```

- In `resetLoadDiagnostics()`, add `this.lastDecodeFailures = [];`.
- In the `loadFrom` `finally`, add `this.lastDecodeFailures = diag.decodeFailedSlices ?? [];`.

`sharepoint-backend.ts`:
- Add the same field.
- Add `this.lastDecodeFailures = [];` beside the four import-flag resets before `try`.
- Add `this.lastDecodeFailures = diag.decodeFailedSlices ?? [];` in the `finally`.

`browser-backend.ts`:
- Add the same field.
- Add `this.lastDecodeFailures = [];` beside the `lastLoadTruncation` reset at `:139`.
- Directly after `const diag: DocTruncationDiag = {};`, add the same `noteIfDropped` helper as Task 4, bound to `diag`.
- Call it for: `project` (`idbProject` → `project`), `fieldVisibility`, `features` (only when `idbFeatures` is present), `steeringCommittee`, `timelogLinks`, `knowledgeItems` (`idbKnowledgeItems` → `knowledgeItems`), `insights`, `settingsOverrides`, `documents`, `documentVersions`, `activityLog` and `budgetHistory`.
- Use the JSON key names, so the operator log reads the same on both paths.
- `status` is not sanitized on this path (`:267`). Leave it (§470).
- In the publish block at `:437`, add `this.lastDecodeFailures = diag.decodeFailedSlices ?? [];`.

- [ ] **Step 5: Run the tests and confirm they pass.** Run the four test files plus `use-load-truncation.test.ts`, `turso-backend.test.ts` and `use-storage-backend.load-gate.test.tsx`. Then run tsc and eslint on the touched files.

- [ ] **Step 6: Mutation check.** Apply each mutant alone and revert it.
  - M1: drop the `finally` publish in `local-file-backend.ts`. Expected red: its record test.
  - M2: drop the reset in `browser-backend.ts`. Expected red: the clean-reload test.
  - M3: publish `[]` unconditionally in `sharepoint-backend.ts`. Expected red.

- [ ] **Step 7: Commit.** Message: `fix: §620 file, SharePoint and IndexedDB loads report a slice that sanitizes to nothing`

### Task 6: Close-outs, decision comments and register (§98, §241, §242, §620, §622, E1)

**Files:**
- Modify: `src/app/use-version-history.ts` (comments only, beside `isEmptyWorkspacePayload`'s `lists` `:72-86` and the diff gate `:196-210`)
- Modify: `docs/open-followups.md`
- Modify: `docs/superpowers/plans/2026-09-27-defect-batch-8.md` (record the rulings and the E1 number)

- [ ] **Step 1: Add the decision comments** in `use-version-history.ts`.

  Beside the `lists` array:

  ```ts
  // ★★ §242 (closed 2026-09-27) — DELIBERATELY UNCOUNTED: `insights` is
  //  machine-written (auto-detection), so counting it would let a project-switch
  //  transient arm a capture; `documentVersions` is derived from `documents` and
  //  is never the only non-empty slice. Add a new user-authored slice here AND
  //  to `COLLECTION_SPECS` in version-diff.ts, or deliberately to neither.
  ```

  Beside the diff gate:

  ```ts
  // ★★ §241 (closed 2026-09-27) — every payload slice has a `COLLECTION_SPECS`
  //  row (version-diff.ts). `documents` and `documentVersions` are
  //  `restorable:false` on purpose: a document is restored through its own
  //  document history (tombstones, docs/AGENTS/documents.md), not this panel.
  ```

  Verify each claim against the code before writing it: `grep -n "restorable" src/app/version-diff.ts`. This is a comments-only change. Prove it by transpiling before and after with `removeComments` and comparing the output.

- [ ] **Step 2: Reserve the E1 number.** First merge the latest main: `git fetch origin && git merge origin/main`. PR #439 must have landed; if it has not, stop and report. Then compute:

```
git show origin/main:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -1
```

E1 is that number + 1. Record it in the plan's Rulings section below.

- [ ] **Step 3: Update the register** (`docs/open-followups.md`, LF). For each entry below:
  - Replace the heading's open suffix with ` — CLOSED 2026-09-27`.
  - Set `**Status:** CLOSED 2026-09-27 on fix/defect-batch-8 — <evidence>`.
  - DELETE its `**Work item:** #NN` line.

  The entries:
  - §622 (#435): name `useCommitOnPageHide`; the removed over-cap guard; the block types covered; the tests; M1–M4 results.
  - §620 (#433):
    - `jsonToWorkspace` records a dropped slice through `diag.decodeFailedSlices`; name the 13 keys.
    - The file, SharePoint and IndexedDB backends publish `lastDecodeFailures`, and saving pauses as on Turso.
    - IndexedDB `status` is unsanitized and stays with §470.
    - The Turso single-tenant blob path now reports too.
  - §98 (#135): the evidence at `workspace-metrics.ts:106-131`, and the verdict date.
  - §241 (#206) and §242 (#207): the evidence, plus "decision moved into code comments at `use-version-history.ts`".
  - E1: a NEW entry `## <N>. The dashboard status narrative draft is lost on window close — CLOSED 2026-09-27`, with a short defect paragraph and a Status naming Task 2, plus Task 3's sweep table (or "sweep: 0 further editors affected", with the file count). It gets no Work item, because it is closed on creation.

  Then run `node scripts/rebuild-followup-index.mjs` followed by `node scripts/rebuild-followup-index.mjs --check`, which must exit 0. Also run `npm run followups:status:check`, `npm run followups:index:check`, `npm run followups:workitems:check` and `npm run docs:claims:check`. Use the script names from `package.json`; list them with `npm run | grep -i followups`.

- [ ] **Step 4: Commit.** Commit the register and index files: `docs: §622 §620 §98 §241 §242 §<E1> close batch-8 entries`. Commit `use-version-history.ts` separately: `docs: §241 §242 record the version-capture decisions in code`.

## Rulings

(The controller records rulings here during execution: the E1 number, sweep outcome, any fixture changes.)
