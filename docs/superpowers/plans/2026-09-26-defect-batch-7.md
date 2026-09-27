# Defect Batch 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close nine verified user-facing defects (#428, #244, #217, #427, #117, #75, #229, #235, #174) in one PR, one commit per issue, each pinned by a test that is red on the unfixed code and mutation-checked.

**Architecture:** Every fix lands at the narrowest existing seam: two `min-w-0`s and a width floor on the classic header (#428), an `open` option on `useResizable` (#244), one qualifier pair inside the shared `bulk-edit-panel.tsx` (#217), a shared "parsed, but sanitized to nothing" predicate inside `rowsToWorkspace` (#427), a nullable `pctComplete` read back through the existing `numOrNull` (#117), one pure `buildExportWorkspace` both export buttons call (#75), a per-section field→label map the section builders print as headers (#229), a fourth `blocked` asset bucket (#235), and a refusal plus a counter in the paragraph editor (#174).

**Tech Stack:** Next.js 16 / React 19 / TypeScript, vitest 5 + Testing Library, `node:sqlite` statement harness, Playwright (Chromium), Tiptap.

**Spec:** `docs/superpowers/specs/2026-09-26-defect-batch-7-design.md`

## Global Constraints

- Peer session `cockpit-main` owns `scripts/**` and `AGENTS.md` (plus the §617/§618 register PR #429 and the release flow). Nothing in this plan edits either; if a step ever seems to need one, message `cockpit-main` first and wait.
- **CPU lock.** vitest, Playwright, `npm run test:*`, `npm run e2e*`, `npm run build`, `npm run gate:local` and dev servers run ONLY while holding the `LOCK vitest` token agreed with `cockpit-main` (send `LOCK vitest`, wait for its `UNLOCK vitest`, send `UNLOCK vitest` when your process has exited). One such process at a time. Implementers run TARGETED test files only (`npx vitest run <file> …`); the whole suite runs once, in Task 10. `npx tsc --noEmit`, `npx eslint`, `git`, `grep` and `node -e` are not covered by the lock.
- No `APP_VERSION` / `CHANGELOG.md` change.
- Commits cite `§NNN` only — never `Closes #NN` (that goes in the PR body only) — and carry NO `Claude-Session:` or any other trailer. Commit with `git commit --only <paths> -F <msgfile>` (write the message file into your scratchpad with the Write tool). Never `--amend`, never `git stash`, never `git reset`.
- `src/app/*.ts(x)` are CRLF in the working tree (`i/lf w/crlf`). Never `sed -i`. Edit existing files with the Edit tool (it keeps CRLF); new files may be LF. After editing, `git ls-files --eol <file>` must show `w/crlf` for every pre-existing `src/app` file you touched.
- `src/app/i18n.de.ts` is edited ONLY by the node script below, never by the Edit tool (it corrupts umlauts and curls quotes). German strings carry real umlauts, written as `\uXXXX` escapes in the payload JSON so no tool can mangle them. EN (`i18n.ts`) goes through the same script for symmetry.
- EN/DE key parity is enforced by `npx tsc --noEmit` — run it after every i18n insert. `t()` echoes an unknown key, so a test written before its key exists fails by name, which is the intended red.
- Read every exit code unpiped: `cmd > $SCRATCH/x.log 2>&1; echo "EXIT=$?"`, then read the log. `$SCRATCH` = your own scratchpad directory, never `/tmp`. After a vitest run, read the `Test Files N passed (N)` line and check N is the number of files you passed.
- Lint with `npx eslint --max-warnings=0 src` (every warning is fatal).
- Register (`docs/open-followups.md`, LF): closing an entry = heading suffix ` — CLOSED 2026-09-26` (replacing any ` — open` / ` — OPEN` / ` — HALF FIXED …` suffix), `**Status:** CLOSED 2026-09-26 on \`fix/defect-batch-7\` …` naming the tests and the mutants, DELETE its `**Work item:** #NN` line, and rewrite its index-table row (anchor, title, last cell `**CLOSED** 2026-09-26`). Use the real commit date if later, everywhere it appears. Derive the anchor, never type it: `node -e 'console.log("#"+process.argv[1].toLowerCase().replace(/[^a-z0-9 \-]/g,"").replace(/ /g,"-"))' "<heading text without the ## >"`. Cite symbols, never `path:LINE`. Then `npm run followups:status:check`, `npm run followups:index:check`, `npm run followups:workitems:check`, `npm run docs:claims:check` → each `EXIT=0`.
- §617 and §618 exist only on `origin/docs/register-468-538-followups` until PR #429 merges. Before touching either entry: `git fetch origin` and `git show origin/main:docs/open-followups.md | grep -c "^## 61[78]\."` must print `2`; then `git rebase origin/main` (clean tree) and continue. If it prints `0`, do the code steps and leave the register step to Task 10 Step 6.

**i18n insert helper** — save once as `$SCRATCH/i18n-insert.cjs`:

```js
// Insert complete i18n lines after ONE anchor key. CRLF-only, refuses duplicates.
// usage: node i18n-insert.cjs <file> <anchorKey> <payload.json>
// payload.json: JSON array of COMPLETE lines; write non-ASCII as \uXXXX escapes.
const fs = require("fs");
const [file, anchor, payloadPath] = process.argv.slice(2);
const src = fs.readFileSync(file, "utf8");
if (!src.includes("\r\n")) throw new Error(`${file}: expected a CRLF working copy`);
const lines = src.split("\r\n");
const hits = lines.flatMap((l, i) => (l.startsWith(`  ${anchor}:`) ? [i] : []));
if (hits.length !== 1) throw new Error(`${file}: anchor ${anchor} matched ${hits.length} lines`);
const at = /:\s*$/.test(lines[hits[0]]) ? hits[0] + 1 : hits[0]; // value on the next line
const add = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
for (const line of add) {
  const m = /^  ([A-Za-z0-9_]+):/.exec(line);
  if (m && lines.some((l) => l.startsWith(`  ${m[1]}:`))) throw new Error(`${file}: ${m[1]} already exists`);
}
fs.writeFileSync(file, [...lines.slice(0, at + 1), ...add, ...lines.slice(at + 1)].join("\r\n"), "utf8");
console.log(`${file}: inserted ${add.length} line(s) after ${anchor}`);
```

After every insert: `git diff --stat -- src/app/i18n.ts src/app/i18n.de.ts` shows only insertions, and `git ls-files --eol src/app/i18n.ts src/app/i18n.de.ts` shows `w/crlf`.

## Corrections to the spec

1. **#244 — two of the five callers are not affected; three are.** `ShiftEditModal` and `JiraConflictsModal` are mounted only while open: `app-modals.tsx` renders them behind `editingShift &&` and `jiraConflicts.length > 0 &&`, and `jira-conflicts-modal.tsx` passes `<Modal open>`. The affected callers are `task-form-modal.tsx` (mounted by `app-modals.tsx` behind `showTaskFormModal`, which defaults to `true`, and returns `null` on `!taskModalOpen`), `asset-preview-modal.tsx` (mounted by `asset-library.tsx` behind `loadImage &&` and by `document-preview.tsx` behind `tursoConfig !== null &&`, i.e. whenever a loader exists) and `notes-window.tsx` (mounted by `task-manager.tsx` behind `!isPopout`). `shift-edit-modal.tsx` still passes `open: draft !== null` (it mirrors its own `useDraggable` argument and costs nothing); `jira-conflicts-modal.tsx` is left alone.
2. **#428 — the wrapper alone cannot shrink.** It sits in two content-sized ancestors: `AppHeader`'s left column (a bare `<div>` flex item of the `<header>`, so its floor is its min-content) and `shell-chrome.tsx`'s `trailing` row (`flex items-center gap-2`). Both need `min-w-0`, or no class on the wrapper changes anything. And the spec's "flex-basis 24rem" must stay a DEFINITE width: `lg:w-auto` + `lg:basis-96` is the rejected variant, because a content-sized ancestor is sized by the wrapper's max-content, which ignores `flex-basis` and falls to the input's intrinsic ~209px (recorded in `top-bar.test.tsx`'s comment on the two search wrappers). So the wrapper keeps `lg:w-96` as its preferred width and gains `lg:min-w-56`.
3. **#427 — the save pause is Turso-only, so JSON/IndexedDB cannot be "fixed the same way".** `decodeFailedSlices` is filled only by `rowsToWorkspace` and read only by `turso-backend.ts` (`lastDecodeFailures`). `jsonToWorkspace` (`workspace.ts`) and the IndexedDB load (`browser-backend.ts`) have the identical falsy-drop shape but no decode-failure channel at all. This plan fixes Turso only; the other two are an open decision (below).
4. **#427 — two slices do not drop, they substitute.** `sanitizeFeatures` returns `[]` for any non-array and `rowsToWorkspace` assigns it (`f !== undefined`), so a corrupt `features` row silently becomes Simple mode. `project_status` is assigned unconditionally and `sanitizeProjectStatus` returns `{}` for junk. Both are in scope. And "the raw value had content" must be RECURSIVE: a stored status `{"narrative":""}` sanitizes to `{}` and must stay silent, or every project that once cleared its narrative pauses saving.
5. **#117 — no schema or codec write change is needed; only the reader.** `pct_complete` is a TEXT column of the `snapshot` table (`SNAPSHOT_DDL`). The writer already writes `""` for null (`numText`). The reader turns `""` back into `0` (`pctComplete: Number(r.pct_complete || 0)` in `rowsToSnapshots`); it becomes `numOrNull(r.pct_complete)`. Every stored row holds a numeric string, so existing snapshots read back unchanged.
6. **#117 — "the Trends sparkline" is the Dashboard completion-trend sparkline.** `pctComplete` is charted only through `completion-trend.ts` (`fromSnapshots`) → `sparkline.tsx`, framed by `CompletionTrendBody` in `dashboard-tile-bodies.tsx`. The Trends view shows it only as a variance row (`variance-format.ts`). "Baseline selection" is `isKpiCompleteSnapshot` (the auto-flag in `use-snapshots.ts`) plus `pickBaseline`'s earliest-row fallback.
7. **#75 — `ExportConfig` keys ARE `Workspace` field names.** `BUILDERS` in `export-sections.ts` reads `ws[key]` for all fifteen `EXPORT_SECTION_KEYS`, so the builder is a plain field pick. The header button is `ExportMenu`, rendered by `ActionMenus` (`action-menus.tsx`), which is the one place to change for both layouts.
8. **#229 — six English-only titles, not five.** `insightsSection` also hard-codes `"Insights"`. All six have an existing Settings → Export key (`exportLabelBudgets`, `exportLabelRoles`, `exportLabelAbsences`, `exportLabelShifts`, `exportLabelStatus`, `exportLabelInsights`); no title key is new.
9. **#229 — there is no golden file for document headers.** `src/app/__fixtures__/` holds only `golden-workspace.csv` and `golden-workspace.md` (storage), which this change must leave byte-identical. Nothing regenerates; instead the test assertions listed in Task 7 migrate.
10. **#229 — "reuse the table-header key" is wrong for three task columns.** The Open Points table shows effort as formatted hours under `colEstimate` ("Est.") and `colSpent` ("Spent"); the export carries raw MINUTES in `originalEstimateMinutes` / `timeSpentMinutes` / `remainingEstimateMinutes`. Reusing the table keys would mislabel the unit, so they get new "(min)" keys.
11. **#229 — most fields have no table column.** About 45 of the 150 export fields appear in a table. The rest reuse their edit-form label key (`blockers`, `fieldAssigneeEmail`, `changeFieldResolution`, …); only 24 fields that the app labels nowhere get new `exportCol*` keys.
12. **#229 — the status section's row labels are raw keys too** (`ragOverride`, `narrativeUpdatedAt`, …, from `statusToCsv`), unlike `projectSection`, which already translates through `PROJECT_FIELD_I18N_KEYS`. They are labelled here through the dashboard's own override keys.
13. **#229 — documents are affected as well.** `resolveDataSection` (`doc-data-section.ts`) calls the real `buildExportSections`, so a document's embedded data section in HTML/PDF/DOCX/PPTX gets the same labels. That is wanted; it is listed so nobody reads it as a regression.
14. **#235 — the "blocked" predicate already exists.** `isBlockedAssetMime` (`document-asset-upload.ts`) is "the ONE spelling of 'this STORED mime is refused'" (truthy mime and not allowlisted; an empty mime is NOT blocked, per §225). It is reused everywhere; no second predicate. The in-app preview already has `data-asset-blocked` (§230), so `globals.css` needs no change; only the standalone export stylesheet in `doc-render-html.ts` gains a rule.
15. **#235 — DOCX/PPTX do not read the buckets.** Their placeholder comes from `withImagePlaceholders` over the metadata map, for every non-embedded image. The blocked text is therefore decided from metadata there, through one shared helper, not from `ExportAssets`.
16. **#174 — refusing an over-cap commit needs the draft to stay dirty.** `useBlockDraft`'s `commit` calls `markDirty(false)` after every `tryCommit`. For an over-cap paragraph the plan keeps the draft dirty, so a pane that unmounts it without a blur still reaches the unmount flush — which then saves today's flattened form rather than dropping the edit. §185 itself argued against refusal ("the user's text would then be unsaveable"); the refusal here keeps the text on screen and editable, and the unmount fallback is an open decision (below).
17. **#217 — the builders own the value control's name.** `selectField` / `dateField` / `textField` render `aria-label={label}` themselves, so the qualified name reaches them through a new `ariaLabel` render argument. The enable checkbox is named only by `<label htmlFor>` today; it gets its own `aria-label`.

## Review Focus

1. **A legitimately stored value that sanitizes to nothing must NOT pause saving** — `features: []` (Simple mode), `[]` lists, `{}`, and a status holding only blank strings (`{"narrative":""}`). A false report shows "Saving paused" on a healthy project. Task 4 pins each as silent, and pins the recursive content check with its own mutant.
2. **A hostile or disallowed mime in an HTML/PDF export** (`image/svg+xml`, or a quote-injection string) now renders the blocked placeholder instead of an `<img>`. The name must stay escaped and no attribute may reach the output. Task 8 migrates the two existing sink tests to assert no `[onerror]` and no `data:image/svg` anywhere.
3. **German Excel export with an `&` in a sheet name** — "Roles & rates" / "Rollen & Raten" is new as a worksheet title. Task 7 parses the DE `xl/workbook.xml` and checks the sheet name round-trips.
4. **An over-cap paragraph that unmounts without a blur** (narrowing the pane collapses a non-selected row). Task 9 pins that the edit is still saved (flattened, today's fallback) rather than lost.
5. **A snapshot history whose earliest row is a no-scope capture.** `pickBaseline` falls back to the earliest row; its null figure must yield an empty completion variance, never "−40%", and the auto-flag must skip it. Task 5 pins `isKpiCompleteSnapshot` and the null-baseline variance row.

---

### Task 1: #428 / §618 — the classic header search shrinks between `lg` and ~1390px

**Files:**
- Modify: `src/app/app-header.tsx` (the left-column `<div>` directly inside `<header className="mb-8 flex items-start justify-between gap-4">`)
- Modify: `src/app/shell-chrome.tsx` (`buildShellChrome`, the `trailing={…}` row and the search wrapper around `<GlobalSearchConnected>`)
- Test: `src/app/top-bar.test.tsx` (describe "top bar left/right cluster classes (source scan)")
- Create: `e2e/classic-header-fit.spec.ts`
- Modify: `docs/open-followups.md` (§618 → closed; only after the §617/§618 rebase)

**Interfaces:**
- Consumes: `searchWrapperClasses(file)` and `read(file)` already defined inside the source-scan describe of `top-bar.test.tsx`; `test`, `expect`, `gotoApp` from `e2e/seed.ts`.
- Produces: classic search wrapper classes `min-w-0 w-44 max-w-[55vw] sm:w-72 lg:w-96 lg:min-w-56`; nothing else for later tasks.

- [ ] **Step 1: Write the failing unit test.** In `src/app/top-bar.test.tsx`, inside `describe("top bar left/right cluster classes (source scan)", …)`, add after the "keeps each search wrapper sized for its own mount" test:

```ts
  // §618 — the classic search can shrink only if every ancestor between it and
  // the <header> lets it. `lg:w-96` stays a DEFINITE width (it is the flex
  // basis; the rejected `lg:w-auto` variant lost it and collapsed to the
  // input's ~209px intrinsic width even at 1600px), `lg:min-w-56` is the floor,
  // and the two `min-w-0`s let the trailing row and the header's left column
  // shrink below their content at all. jsdom has no layout: the widths are
  // measured in e2e/classic-header-fit.spec.ts.
  it("lets the classic search shrink from its 24rem basis to a 14rem floor (§618)", () => {
    const left = read("app-header.tsx").match(/<header className="[^"]*">\s*<div className="([^"]*)">/);
    expect(left).not.toBeNull();
    expect(left![1].split(/\s+/)).toContain("min-w-0");

    const trailing = read("shell-chrome.tsx").match(
      /trailing=\{\s*<div className="([^"]*)">\s*<div className="[^"]*">\s*<GlobalSearchConnected/,
    );
    expect(trailing).not.toBeNull();
    expect(trailing![1].split(/\s+/)).toContain("min-w-0");

    const classic = searchWrapperClasses("shell-chrome.tsx");
    expect(classic).toHaveLength(1);
    expect(classic[0].split(/\s+/)).toEqual(expect.arrayContaining(["lg:w-96", "lg:min-w-56"]));
  });
```

- [ ] **Step 2: Run it (under the lock).** `npx vitest run src/app/top-bar.test.tsx > $SCRATCH/t1.log 2>&1; echo "EXIT=$?"`. Expected: EXIT=1, the new test fails with `expected null not to be null` (the left column is a bare `<div>`).

- [ ] **Step 3: Write the Playwright measurement.** Create `e2e/classic-header-fit.spec.ts`:

```ts
import { test, expect, gotoApp } from "./seed";

// §618 — MEASURED, not reasoned: jsdom has no layout, so only a real browser
// can say whether the classic header fits. The classic search keeps a 384px
// preferred width (`lg:w-96`) and may shrink to a 224px floor (`lg:min-w-56`).
// Before the fix the header content was 1125px wide at every viewport from lg
// up, so the page scrolled sideways at 1024 and 1100 (scrollWidth 1165).
const WIDTHS = [1024, 1100, 1390, 1600] as const;
const SEARCH_FLOOR_PX = 224;
const SEARCH_BASIS_PX = 384;

test.describe("classic header fits from lg up (§618)", () => {
  test.beforeEach(async ({ page }) => {
    // Settings are a SHALLOW merge over defaults (use-settings.ts), so this one
    // key switches the layout and leaves everything else at its default.
    await page.addInitScript(() => {
      localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ layout: "classic" }));
    });
  });

  for (const width of WIDTHS) {
    test(`no sideways scroll and a usable search at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });
      await gotoApp(page);
      // Positive proof the classic layout took effect: only the classic shell
      // has an h1 literally named "AI PM Cockpit".
      await expect(page.getByRole("heading", { name: "AI PM Cockpit", level: 1, exact: true })).toBeVisible();
      const m = await page.evaluate(() => {
        const h1 = [...document.querySelectorAll("h1")].find((h) => h.textContent === "AI PM Cockpit")!;
        const header = h1.closest("header")!;
        const search = document.querySelector<HTMLElement>('input[role="combobox"][aria-label="Global search"]')!;
        return {
          docScroll: document.documentElement.scrollWidth,
          inner: window.innerWidth,
          headerScroll: header.scrollWidth,
          headerClient: header.clientWidth,
          search: Math.round(search.getBoundingClientRect().width),
        };
      });
      const why = JSON.stringify(m);
      expect(m.docScroll, why).toBeLessThanOrEqual(m.inner);
      expect(m.headerScroll, why).toBeLessThanOrEqual(m.headerClient);
      if (width >= 1390) expect(m.search, why).toBe(SEARCH_BASIS_PX);
      else expect(m.search, why).toBeGreaterThanOrEqual(SEARCH_FLOOR_PX);
    });
  }
});
```

- [ ] **Step 4: Run it red (under the lock).** `npx playwright test e2e/classic-header-fit.spec.ts --project=chromium --workers=1 > $SCRATCH/t1-e2e.log 2>&1; echo "EXIT=$?"`. Expected: EXIT=1; the 1024 and 1100 cases fail on `docScroll` (the issue measured 1165); 1390 and 1600 pass. Record the printed `why` JSON for the register.

- [ ] **Step 5: Implement.** In `src/app/app-header.tsx` replace the first line inside `<header …>`:

```tsx
      <div>
```
with
```tsx
      {/* §618 — min-w-0 lets this column shrink below its content, so the
          search in the row below can give up width from lg up instead of
          pushing the header wider than the window. */}
      <div className="min-w-0">
```

In `src/app/shell-chrome.tsx` replace:

```tsx
        <div className="flex items-center gap-2">
          <div className="min-w-0 w-44 max-w-[55vw] sm:w-72 lg:w-96">
```
with
```tsx
        <div className="flex min-w-0 items-center gap-2">
          {/* §618 — a DEFINITE lg:w-96 is the preferred width and the flex
              basis; lg:min-w-56 is the floor it shrinks to. Not the modern
              mount's w-auto + basis: this row is content-sized, and max-content
              ignores flex-basis (measured: ~209px at 1600). */}
          <div className="min-w-0 w-44 max-w-[55vw] sm:w-72 lg:w-96 lg:min-w-56">
```

Update the CLASSIC bullet of the comment above `it("keeps each search wrapper sized for its own mount, …")` in `top-bar.test.tsx` to read: `CLASSIC: the wrapper sits in a content-sized row under the app title. The same elastic classes there collapse the field to the input's own intrinsic ~209px even on a 1600px window, so it keeps a definite lg:w-96 (the basis) and shrinks only to lg:min-w-56, with min-w-0 on its two ancestors (§618).`

- [ ] **Step 6: Run both green (under the lock, one after the other).** `npx vitest run src/app/top-bar.test.tsx src/app/shell-chrome.test.tsx src/app/app-header.test.tsx > $SCRATCH/t1.log 2>&1; echo "EXIT=$?"` → EXIT=0, `Test Files 3 passed (3)` (drop `app-header.test.tsx` from the list if `ls src/app/app-header.test.tsx` finds none, and expect 2). Then the Playwright command of Step 4 → EXIT=0, 4 passed. **If 1024 still fails** on `docScroll` with the search at 224: STOP and report the `why` JSON to the lead — the floor is an owner decision (see open decisions); do not lower it on your own.

- [ ] **Step 7: Mutants (each applied alone, run, reverted; `git diff --stat` clean after each revert).**
  - M1: remove `className="min-w-0"` from `app-header.tsx` → unit test red (`expected null not to be null`) and Playwright 1024/1100 red on `docScroll`.
  - M2: remove `min-w-0` from the trailing row in `shell-chrome.tsx` → unit test red (`expected [...] to include 'min-w-0'`); Playwright 1024/1100 red.
  - M3: replace `lg:min-w-56` with nothing → unit test red (`arrayContaining`).
  - M4: replace `lg:w-96 lg:min-w-56` with `lg:w-auto lg:min-w-56 lg:basis-96` → Playwright 1600 red (`search` ≠ 384).

- [ ] **Step 8: Typecheck and lint.** `npx tsc --noEmit > $SCRATCH/tsc.log 2>&1; echo "EXIT=$?"` → 0. `npx eslint --max-warnings=0 src e2e/classic-header-fit.spec.ts > $SCRATCH/lint.log 2>&1; echo "EXIT=$?"` → 0.

- [ ] **Step 9: Register (§618; only after the rebase in Global Constraints).** Close §618: Status names `e2e/classic-header-fit.spec.ts` and the top-bar test "lets the classic search shrink from its 24rem basis to a 14rem floor (§618)", the measured before/after JSON from Steps 4 and 6, and mutants M1–M4. Delete `**Work item:** #428`. Rewrite the index row.

- [ ] **Step 10: Commit.** Message file: `fix: let the classic header search shrink so the page stops scrolling sideways (§618)`. `git commit --only src/app/app-header.tsx src/app/shell-chrome.tsx src/app/top-bar.test.tsx e2e/classic-header-fit.spec.ts docs/open-followups.md -F $SCRATCH/msg1.txt` (omit `docs/open-followups.md` if Step 9 was deferred).

---

### Task 2: #244 / §338 — `useResizable` attaches when a mounted-while-closed modal opens

**Files:**
- Modify: `src/app/use-resizable.ts` (`ResizableOptions`, `useResizable`)
- Modify: `src/app/task-form-modal.tsx` (the `useResizable("aipm-cockpit:modal-size:task-form")` call)
- Modify: `src/app/asset-preview-modal.tsx` (the `useResizable(STORAGE_KEY_SIZE)` call)
- Modify: `src/app/notes-window.tsx` (the `useResizable(STORAGE_KEY_SIZE)` call)
- Modify: `src/app/shift-edit-modal.tsx` (the `useResizable("aipm-cockpit:modal-size:shift-edit")` call)
- Test: `src/app/use-resizable.test.tsx`, `src/app/asset-preview-modal.test.tsx` (describe "AssetPreviewModal — shell")
- Modify: `docs/open-followups.md` (§338 → closed)

**Interfaces:**
- Produces: `ResizableOptions { axis?: ResizableAxis; open?: boolean }` — `open` defaults to `true`, so the other ~40 callers are unchanged. `useResizable(storageKey, options?)` returns `{ ref, reset }` as before.

- [ ] **Step 1: Write the failing hook tests.** Append to `src/app/use-resizable.test.tsx`:

```tsx
/** A modal that stays MOUNTED while closed and renders nothing — the shape of
 *  task-form-modal, asset-preview-modal and notes-window. */
function ClosableHarness({ open }: { open: boolean }) {
  const { ref } = useResizable(KEY, { open });
  if (!open) return null;
  return <div ref={ref} data-testid="box" />;
}

describe("useResizable — a component that mounts closed (§338)", () => {
  it("restores the saved size when it opens after mounting closed", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ width: 640, height: 480 }));
    const { rerender, getByTestId } = render(<ClosableHarness open={false} />);
    rerender(<ClosableHarness open />);
    const box = getByTestId("box");
    expect(box.style.width).toBe("640px");
    expect(box.style.height).toBe("480px");
  });

  it("persists a resize made after opening, and restores it on the next open", () => {
    const { rerender, getByTestId, queryByTestId } = render(<ClosableHarness open={false} />);
    rerender(<ClosableHarness open />);
    const box = getByTestId("box");
    stubRect(box, { right: 200, bottom: 200, width: 700, height: 500 });
    box.dispatchEvent(pointer("pointerdown", { clientX: 195, clientY: 195 }));
    window.dispatchEvent(pointer("pointerup"));
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ width: 700, height: 500 });

    rerender(<ClosableHarness open={false} />);
    expect(queryByTestId("box")).toBeNull();
    rerender(<ClosableHarness open />);
    expect(getByTestId("box").style.width).toBe("700px");
    expect(getByTestId("box").style.height).toBe("500px");
  });
});
```

And in `src/app/asset-preview-modal.test.tsx`, inside `describe("AssetPreviewModal — shell", …)`:

```tsx
  // §338 — its callers keep this modal MOUNTED while closed (so its own state
  //  survives), and the size hook's only run used to find no element. A saved
  //  size must still reach the panel when it opens.
  it("restores a saved window size when it opens after mounting closed (§338)", async () => {
    const SIZE_KEY = "aipm-cockpit:modal-size:asset-preview";
    window.localStorage.setItem(SIZE_KEY, JSON.stringify({ width: 777, height: 555 }));
    try {
      const { rerender } = renderModal({ open: false });
      rerender(
        <AssetPreviewModal
          lang="en-US" open onClose={vi.fn()}
          assets={[asset("a", "Alpha"), asset("b", "Beta")]}
          startIndex={0} loadImage={vi.fn(async () => TINY_GIF)}
        />,
      );
      await screen.findByRole("dialog", { name: /Alpha/ });
      const panel = document.querySelector<HTMLElement>("[data-modal-panel]");
      expect(panel).not.toBeNull();
      expect(panel!.style.width).toBe("777px");
      expect(panel!.style.height).toBe("555px");
    } finally {
      window.localStorage.removeItem(SIZE_KEY);
    }
  });
```

- [ ] **Step 2: Run (under the lock).** `npx vitest run src/app/use-resizable.test.tsx src/app/asset-preview-modal.test.tsx > $SCRATCH/t2.log 2>&1; echo "EXIT=$?"` → EXIT=1; the three new tests fail with `expected '' to be '640px'` / `'777px'` (the option is ignored today and the effect never re-runs).

- [ ] **Step 3: Implement the hook.** In `src/app/use-resizable.ts`:

```ts
export interface ResizableOptions {
  axis?: ResizableAxis;
  /** §338 — false while the caller renders NOTHING (a modal that stays mounted
   *  while closed). The attach/restore effect re-runs on every false→true
   *  change, mirroring `useDraggable`'s open transition; without it the
   *  effect's only run found no element and bailed, so no size was ever
   *  restored or saved. Default `true` — an always-rendered caller is
   *  unchanged. */
  open?: boolean;
}

export function useResizable(storageKey: string, options?: ResizableOptions) {
  const axis: ResizableAxis = options?.axis ?? "both";
  const open = options?.open ?? true;
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
```
and change the effect's dependency list from `}, [storageKey, axis]);` to `}, [storageKey, axis, open]);`. Add to the header comment's step 1: `(and again every time \`open\` turns true — §338)`.

- [ ] **Step 4: Pass `open` at the callers.**
  - `task-form-modal.tsx`: `useResizable("aipm-cockpit:modal-size:task-form", { open: taskModalOpen });`
  - `asset-preview-modal.tsx`: `useResizable(STORAGE_KEY_SIZE, { open });`
  - `notes-window.tsx`: `useResizable(STORAGE_KEY_SIZE, { open });`
  - `shift-edit-modal.tsx`: `useResizable("aipm-cockpit:modal-size:shift-edit", { open: draft !== null });` (mirrors its `useDraggable(draft !== null, …)`; today its parent mounts it only while open, so this is defensive).

- [ ] **Step 5: Existing tests to re-run (MIGRATE none expected).** `grep -rln "useResizable" src/app --include=*.test.tsx` lists 12 files; the ones that MOCK the hook (`jira-conflicts-modal.test.tsx`: `useResizable: () => ({ ref: { current: null } })`) are unaffected by a new option. Run, under the lock: `npx vitest run src/app/use-resizable.test.tsx src/app/asset-preview-modal.test.tsx src/app/notes-window.test.tsx src/app/shift-edit-modal.test.tsx src/app/help-menu.test.tsx src/app/budget-bucket-modal.test.tsx > $SCRATCH/t2.log 2>&1; echo "EXIT=$?"` → EXIT=0, `Test Files 6 passed (6)`. Then `npx vitest run src/app/task-form-modal.test.tsx` if `ls` finds it.

- [ ] **Step 6: Mutants.**
  - M1: dependency list back to `[storageKey, axis]` → the three new tests red (`expected '' to be '640px'`).
  - M2: drop `{ open }` from `asset-preview-modal.tsx` → the modal test red.
  - Not a mutant: deleting the `!open ||` guard alone is EQUIVALENT (a closed caller renders no element, so `!el` already bails); the guard is there so the effect body reads `open` for exhaustive-deps. Say so in the register rather than claiming it is pinned.

- [ ] **Step 7:** `npx tsc --noEmit` and `npx eslint --max-warnings=0 src` → EXIT=0 each (exhaustive-deps must accept `open`, which the body now reads).

- [ ] **Step 8: Register (§338).** Close it; name the four callers changed and why `JiraConflictsModal` is not one (Correction 1). Delete `**Work item:** #244`; rewrite the index row.

- [ ] **Step 9: Commit.** `fix: restore and persist modal sizes in modals that stay mounted while closed (§338)`; `git commit --only src/app/use-resizable.ts src/app/use-resizable.test.tsx src/app/task-form-modal.tsx src/app/asset-preview-modal.tsx src/app/asset-preview-modal.test.tsx src/app/notes-window.tsx src/app/shift-edit-modal.tsx docs/open-followups.md -F $SCRATCH/msg2.txt`.

---

### Task 3: #217 / §277 — bulk-edit controls get names of their own

**Files:**
- Modify: `src/app/bulk-edit-panel.tsx` (`BulkField.render`, `selectField`, `dateField`, `textField`, `BulkEditPanel`)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (two keys after `bulkEditNoFields`)
- Test: `src/app/bulk-edit.test.tsx` (describe "BulkEditPanel"), `src/app/stakeholders-panel.test.tsx` (describe "Stakeholders bulk edit")
- MIGRATE: `src/app/stakeholders-panel.test.tsx`, `src/app/change-panel.test.tsx`, `src/app/raid-panel.test.tsx`, `src/app/milestones-panel.test.tsx`, `src/app/bulk-edit.test.tsx` (sites listed in Step 6)
- Modify: `docs/open-followups.md` (§277 → closed)

**Interfaces:**
- Produces: `BulkField.render(p: { value: string; onChange: (v: string) => void; disabled: boolean; id: string; ariaLabel: string })`. i18n keys `bulkEditChangeField` ("Change {0}") and `bulkEditNewValue` ("New {0}").

- [ ] **Step 1: Write the failing tests.** In `src/app/bulk-edit.test.tsx` add imports `import { t } from "./i18n";` and `import { expectRowUniqueNames } from "../test/row-unique-names";`, then inside `describe("BulkEditPanel", …)`:

```tsx
  // §277 — the panel spends each field label on TWO controls, and the owning
  //  panel's sortable column header spends it on a third. Each bulk control
  //  now carries a qualified name of its own.
  test("names the enable checkbox 'Change …' and the value control 'New …' (§277)", () => {
    render(<BulkEditPanel lang="en-US" count={2} fields={FIELDS} onApply={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("checkbox", { name: t("en-US", "bulkEditChangeField", "Status") })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: t("en-US", "bulkEditChangeField", "Target date") })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: t("en-US", "bulkEditNewValue", "Status") })).toBeInTheDocument();
    expect(screen.getByLabelText(t("en-US", "bulkEditNewValue", "Target date"))).toHaveAttribute("type", "date");
    // The bare label belongs to the column header now.
    expect(screen.queryByRole("checkbox", { name: "Status" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Status" })).toBeNull();
    expectRowUniqueNames({ minControls: 3, roles: ["checkbox", "combobox"] });
  });
```

In `src/app/stakeholders-panel.test.tsx` add `within` to the `@testing-library/react` import if absent, and inside `describe("Stakeholders bulk edit", …)`:

```tsx
  it("keeps the bulk controls' names apart from the column headers they share a label with (§277)", () => {
    renderStakeholders({ stakeholders: [sampleStakeholder({ id: 1, name: "Dana" })] });
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "selectItem", "Dana") }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkEdit") }));
    const panel = screen.getByRole("heading", { name: t("en-US", "bulkEditCount", "1") }).parentElement!;
    for (const key of ["stakeholderFieldCategory", "stakeholderFieldInfluence", "stakeholderFieldInterest"] as const) {
      const label = t("en-US", key);
      expect(within(panel).queryAllByRole("checkbox", { name: label })).toHaveLength(0);
      expect(within(panel).queryAllByRole("combobox", { name: label })).toHaveLength(0);
      expect(within(panel).getAllByRole("checkbox", { name: t("en-US", "bulkEditChangeField", label) })).toHaveLength(1);
      expect(within(panel).getAllByRole("combobox", { name: t("en-US", "bulkEditNewValue", label) })).toHaveLength(1);
    }
  });
```

- [ ] **Step 2: Run (under the lock).** `npx vitest run src/app/bulk-edit.test.tsx src/app/stakeholders-panel.test.tsx > $SCRATCH/t3.log 2>&1; echo "EXIT=$?"` → EXIT=1: `Unable to find an accessible element with the role "checkbox" and name "bulkEditChangeField"` (the key does not exist yet, so `t` echoes it) and the stakeholders loop fails on `toHaveLength(0)` (received 1).

- [ ] **Step 3: Add the i18n keys.** Payload `$SCRATCH/t3-en.json`:
```json
["  bulkEditChangeField: \"Change {0}\",", "  bulkEditNewValue: \"New {0}\","]
```
Payload `$SCRATCH/t3-de.json`:
```json
["  bulkEditChangeField: \"{0} ändern\",", "  bulkEditNewValue: \"Neuer Wert für {0}\","]
```
Run `node $SCRATCH/i18n-insert.cjs src/app/i18n.ts bulkEditNoFields $SCRATCH/t3-en.json` and `node $SCRATCH/i18n-insert.cjs src/app/i18n.de.ts bulkEditNoFields $SCRATCH/t3-de.json`; each prints `inserted 2 line(s)`. EN "Change Severity" contains the visible label "Severity" (WCAG 2.5.3 label-in-name); DE "Schweregrad ändern" starts with it.

- [ ] **Step 4: Implement.** In `src/app/bulk-edit-panel.tsx`:
  - `BulkField.render`'s doc and type: `render: (p: { value: string; onChange: (v: string) => void; disabled: boolean; id: string; ariaLabel: string }) => React.ReactNode;` with the doc sentence `\`ariaLabel\` is the value control's accessible name, qualified by the panel ("New <label>") so it never equals the column header's bare label (§277).`
  - In each of `selectField`, `dateField`, `textField`: destructure `ariaLabel` in `render: ({ value, onChange, disabled, id, ariaLabel }) =>` and replace `aria-label={label}` with `aria-label={ariaLabel}`.
  - In `BulkEditPanel`, the checkbox gains a name, and `render` gets the qualified one:

```tsx
              <input
                id={`${id}-enable`}
                type="checkbox"
                // §277 — the visible <label> below reads just the field; the
                // accessible name is qualified so it differs from the value
                // control's and from the column header's sort button.
                aria-label={t(lang, "bulkEditChangeField", f.label)}
                checked={on}
```
```tsx
                {f.render({
                  value: values[f.key] ?? "",
                  onChange: (v) => setValues((s) => ({ ...s, [f.key]: v })),
                  disabled: !on,
                  id,
                  ariaLabel: t(lang, "bulkEditNewValue", f.label),
                })}
```

- [ ] **Step 5: Run the new tests green** (Step 2 command) → EXIT=0 for the new cases; the pre-existing bulk tests fail until Step 6.

- [ ] **Step 6: MIGRATE the existing tests** (they queried the bare label, which no longer names a bulk control). Replace each site exactly:
  - `bulk-edit.test.tsx` "Apply is disabled until a field is enabled": `screen.getByRole("checkbox", { name: "Status" })` → `screen.getByRole("checkbox", { name: t("en-US", "bulkEditChangeField", "Status") })`; its comment "(the enable checkbox is labelled by the field label)" → "(the enable checkbox is named 'Change <field>', §277)".
  - `stakeholders-panel.test.tsx` "applies a bulk influence change to the selected row via onSave": replace the comment and the four lines from `fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "stakeholderFieldInfluence") }));` through `.find((el) => el.id === "bulk-influence")!;` with
    ```tsx
        // enable Influence + set it to High (§277: the bulk controls carry their
        // own qualified names, so no DOM-id workaround is needed any more)
        const influence = t("en-US", "stakeholderFieldInfluence");
        fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "bulkEditChangeField", influence) }));
        const bulkInfluence = screen.getByRole("combobox", { name: t("en-US", "bulkEditNewValue", influence) });
    ```
  - `stakeholders-panel.test.tsx` (the three-row capture test): replace the comment "(the bulk selects share their names with the column header sort controls — disambiguate by the bulk control's id)" and the `for (const [field, id] of [...] as const) { … }` loop with
    ```tsx
        // Tick + set both fields (§277: each bulk control has its own name).
        for (const field of ["stakeholderFieldInfluence", "stakeholderFieldInterest"] as const) {
          const label = t("en-US", field);
          fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "bulkEditChangeField", label) }));
          fireEvent.change(screen.getByRole("combobox", { name: t("en-US", "bulkEditNewValue", label) }), { target: { value: "High" } });
        }
    ```
  - `change-panel.test.tsx`, four sites (the lines `fireEvent.click(getByRole("checkbox", { name: t("en-US", "changeFieldStatus") }));` + `const bulkStatus = getAllByRole("combobox", { name: t("en-US", "changeFieldStatus") })` + `.find((el) => el.id === "bulk-status")!;`), each becomes
    ```tsx
        const status = t("en-US", "changeFieldStatus");
        fireEvent.click(getByRole("checkbox", { name: t("en-US", "bulkEditChangeField", status) }));
        const bulkStatus = getByRole("combobox", { name: t("en-US", "bulkEditNewValue", status) });
    ```
    and each preceding comment about sharing a name / disambiguating by id is replaced by `// §277: the bulk select has its own name.` (if `getByRole` is not destructured in one of those tests, use `screen.getByRole`).
  - `raid-panel.test.tsx`, three sites (two `raidSeverity`, one `raidOwner`): the same shape —
    ```tsx
        const severity = t("en-US", "raidSeverity");
        fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "bulkEditChangeField", severity) }));
        const bulkSeverity = screen.getByRole("combobox", { name: t("en-US", "bulkEditNewValue", severity) });
    ```
    (`owner`/`bulkOwner` for the `raidOwner` site), removing the `getAllByRole(…).find((el) => el.id === …)` chains and their "keep the id" comment.
  - `milestones-panel.test.tsx`, three checkbox sites: `{ name: t("en-US", "milestoneDate") }` → `{ name: t("en-US", "bulkEditChangeField", t("en-US", "milestoneDate")) }` (twice) and `{ name: t("en-US", "achievedDate") }` → `{ name: t("en-US", "bulkEditChangeField", t("en-US", "achievedDate")) }`. The `document.getElementById("bulk-date")` lines stay (ids are unchanged); update their comment "The date input shares its aria-label with the column header sort button" → "The date input is named 'New Target date' (§277); the id query is kept for brevity."
  - Re-find any site this list missed: `grep -rn '"bulk-\|bulkEdit"' src/app --include=*.test.tsx`, then read each bulk test's checkbox/combobox queries.

- [ ] **Step 7: Run green (under the lock).** `npx vitest run src/app/bulk-edit.test.tsx src/app/stakeholders-panel.test.tsx src/app/change-panel.test.tsx src/app/raid-panel.test.tsx src/app/milestones-panel.test.tsx src/app/resource-directory.test.tsx > $SCRATCH/t3.log 2>&1; echo "EXIT=$?"` → EXIT=0, `Test Files 6 passed (6)`.

- [ ] **Step 8: Mutants.**
  - M1: remove the checkbox `aria-label` → bulk-edit test red (`expectRowUniqueNames` reports a duplicate `""`, and `getByRole("checkbox", { name: "Change Status" })` fails); stakeholders §277 test red.
  - M2: `ariaLabel: f.label` in `BulkEditPanel` → bulk-edit test red (`queryByRole("combobox", { name: "Status" })` not null); stakeholders §277 test red on `queryAllByRole("combobox", …)` length 1.
  - M3: in `selectField` only, `aria-label={label}` → bulk-edit test red (combobox named "Status").

- [ ] **Step 9:** `npx tsc --noEmit` → 0; `npx eslint --max-warnings=0 src` → 0.

- [ ] **Step 10: Register (§277).** Close it: one qualifier pair inside `bulk-edit-panel.tsx` (the shape the entry recommended), the DOM-id workarounds removed in four test files, mutants M1–M3. Delete `**Work item:** #217`; index row.

- [ ] **Step 11: Commit.** `fix: give bulk-edit controls names distinct from their column headers (§277)`; `git commit --only src/app/bulk-edit-panel.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/bulk-edit.test.tsx src/app/stakeholders-panel.test.tsx src/app/change-panel.test.tsx src/app/raid-panel.test.tsx src/app/milestones-panel.test.tsx docs/open-followups.md -F $SCRATCH/msg3.txt`.

---

### Task 4: #427 / §617 — a meta slice that sanitizes to nothing is reported, not dropped

**Files:**
- Create: `src/app/meta-slice-decode.ts`, `src/app/meta-slice-decode.test.ts`
- Modify: `src/app/turso-schema.ts` (`rowsToWorkspace`, the meta-row section from `project_status` through `settings_overrides`)
- Test: `src/app/turso-schema.execute.test.ts` (new describe)
- Re-run: `src/app/turso-schema.documents.test.ts`, `src/app/turso-schema.test.ts`, `src/app/turso-backend*.test.ts`
- Modify: `docs/open-followups.md` (§617 → closed; only after the rebase)

**Interfaces:**
- Produces: `hasDecodedContent(raw: unknown): boolean`, `isEmptyDecoded(value: unknown): boolean`, `sanitizedToNothing(raw: unknown, sanitized: unknown): boolean` (all in `meta-slice-decode.ts`). `rowsToWorkspace` keeps its signature; a sanitized-to-nothing slice now lands in `diag.decodeFailedSlices` under its meta KEY (`"project_meta"`, `"features"`, …), which the existing Saving-paused plumbing already reads.

- [ ] **Step 1: Write the failing predicate test.** Create `src/app/meta-slice-decode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hasDecodedContent, isEmptyDecoded, sanitizedToNothing } from "./meta-slice-decode";

describe("hasDecodedContent (§617)", () => {
  it.each([
    [null, false], [undefined, false], ["", false], [[], false], [{}, false],
    [[{}], false], [{ narrative: "" }, false], [{ a: [null, ""] }, false],
    ["x", true], [0, true], [false, true], [[1], true], [{ name: "", code: "APO" }, true],
    [{ deep: { deeper: ["y"] } }, true],
  ] as const)("%j → %s", (raw, expected) => {
    expect(hasDecodedContent(raw)).toBe(expected);
  });
});

describe("isEmptyDecoded (§617)", () => {
  it.each([
    [null, true], [undefined, true], [[], true], [{}, true],
    [[1], false], [{ a: 1 }, false], ["", false], [0, false],
  ] as const)("%j → %s", (value, expected) => {
    expect(isEmptyDecoded(value)).toBe(expected);
  });
});

describe("sanitizedToNothing (§617)", () => {
  it("is true only when content went in and nothing came out", () => {
    expect(sanitizedToNothing([{ bogus: true }], [])).toBe(true);
    expect(sanitizedToNothing({ name: "", code: "APO" }, null)).toBe(true);
    expect(sanitizedToNothing([], [])).toBe(false);          // a stored empty list
    expect(sanitizedToNothing({ narrative: "" }, {})).toBe(false); // blanks only
    expect(sanitizedToNothing([{ id: 1 }], [{ id: 1 }])).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing real-SQL test.** Append to `src/app/turso-schema.execute.test.ts`:

```ts
describe("§617 — a meta slice that parses but sanitizes to nothing is REPORTED, not dropped", () => {
  beforeEach(() => clearDiagLog());

  /** A real single-tenant DB holding an empty workspace, with ONE meta row
   *  replaced by `value` — then loaded through the real SELECTs. */
  function loadWithMetaRow(key: string, value: string, diag: DocTruncationDiag): Workspace {
    const db = new DatabaseSync(":memory:");
    try {
      for (const ddl of SCHEMA_DDL) db.exec(ddl);
      runStatements(db, workspaceToStatements(emptyWorkspace()));
      db.prepare("DELETE FROM meta WHERE key = ?").run(key);
      db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(key, value);
      return rowsToWorkspace(selectAllResults(db), diag);
    } finally {
      db.close();
    }
  }

  const INVALID: readonly (readonly [string, string, keyof Workspace])[] = [
    ["project_status", JSON.stringify({ ragOverride: "purple" }), "status"],
    ["project_meta", JSON.stringify({ name: "", code: "APO" }), "project"],
    ["field_visibility", JSON.stringify({ noSuchModal: { fields: ["x"] } }), "fieldVisibility"],
    ["features", JSON.stringify(["noSuchModule"]), "features"],
    ["steering_committee", JSON.stringify("not a committee"), "steeringCommittee"],
    ["timelog_links", JSON.stringify([1, 2, 3]), "timelogLinks"],
    ["knowledge_items", JSON.stringify([{ bogus: true }]), "knowledgeItems"],
    ["insights", JSON.stringify([{ bogus: true }]), "insights"],
    ["activityLog", JSON.stringify([{ bogus: true }]), "activityLog"],
    ["budgetHistory", JSON.stringify([{ bogus: true }]), "budgetHistory"],
    ["documents", JSON.stringify([{ bogus: true }]), "documents"],
    ["documentVersions", JSON.stringify([{ bogus: true }]), "documentVersions"],
    ["settings_overrides", JSON.stringify({ nextActions: "garbage" }), "settingsOverrides"],
  ];

  it.each(INVALID)("reports %s and leaves the slice at its empty default", (key, value, wsKey) => {
    const diag: DocTruncationDiag = {};
    const ws = loadWithMetaRow(key, value, diag);
    expect(diag.decodeFailedSlices).toEqual([key]);
    expect(ws[wsKey]).toEqual(emptyWorkspace()[wsKey]);
    expect(readDiagLog().some((e) => e.code === "turso.metaSliceUnreadable")).toBe(true);
  });

  // ★ The false-positive half, and the one a user would feel: each of these is a
  //  value a healthy project can hold. Reporting it would pause saving.
  const LEGIT_EMPTY: readonly (readonly [string, string])[] = [
    ["project_status", "{}"],
    ["project_status", JSON.stringify({ narrative: "" })],
    ["project_meta", "{}"],
    ["field_visibility", "{}"],
    ["features", "[]"],
    ["knowledge_items", "[]"],
    ["insights", "[]"],
    ["activityLog", "[]"],
    ["budgetHistory", "[]"],
    ["documents", "[]"],
    ["documentVersions", "[]"],
    ["settings_overrides", "{}"],
  ];

  it.each(LEGIT_EMPTY)("stays silent for %s stored as %s", (key, value) => {
    const diag: DocTruncationDiag = {};
    loadWithMetaRow(key, value, diag);
    expect(diag.decodeFailedSlices ?? []).not.toContain(key);
  });

  it("keeps a stored Simple-mode features list ([]) as Simple mode", () => {
    const ws = loadWithMetaRow("features", "[]", {});
    expect(ws.features).toEqual([]);
  });

  it("loads a valid project_meta row with no report (positive control)", () => {
    const diag: DocTruncationDiag = {};
    const ws = loadWithMetaRow("project_meta", JSON.stringify({ name: "Apollo" }), diag);
    expect(ws.project?.name).toBe("Apollo");
    expect(diag.decodeFailedSlices ?? []).not.toContain("project_meta");
  });
});
```

- [ ] **Step 3: Run (under the lock).** `npx vitest run src/app/meta-slice-decode.test.ts src/app/turso-schema.execute.test.ts > $SCRATCH/t4.log 2>&1; echo "EXIT=$?"` → EXIT=1: the predicate file fails to import (`Failed to resolve import "./meta-slice-decode"`), and every INVALID case fails with `expected undefined to deeply equal [ 'project_status' ]` (etc.). If an INVALID case is already green, the fixture does not reach a sanitize-to-nothing path for that slice — read that sanitizer and fix the fixture before going on.

- [ ] **Step 4: Implement the predicate.** Create `src/app/meta-slice-decode.ts`:

```ts
// src/app/meta-slice-decode.ts — §617: "parsed, but sanitized to nothing".
//
// ★★★ A SANITIZER THAT RETURNS NOTHING WAS INDISTINGUISHABLE FROM AN EMPTY
//  SLICE. `rowsToWorkspace` reported a meta row only when `JSON.parse` or the
//  sanitizer THREW; a sanitizer that returned null / undefined / [] / {} took
//  neither branch, so the slice was dropped with no report — and for
//  `project_meta` the next meta-dirty save deleted the row for good.
// ★★ Reporting on "empty result" alone would be worse than the defect: a stored
//  `[]`, `{}` or a record of blank strings sanitizes to nothing too, and each
//  report pauses saving. So the rule compares the INPUT with the output: only
//  a value that carried something, and lost all of it, is reported.

/** True when a parsed JSON value carries anything a sanitizer could lose: a
 *  non-empty string, any number or boolean, or an array/object holding such a
 *  value at ANY depth. `null`, `""`, `[]`, `{}` and containers of only those
 *  carry nothing. Recursive on purpose — a status of `{"narrative":""}` must
 *  not count as content. */
export function hasDecodedContent(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === "string") return raw !== "";
  if (Array.isArray(raw)) return raw.some(hasDecodedContent);
  if (typeof raw === "object") return Object.values(raw).some(hasDecodedContent);
  return true;
}

/** True when a sanitizer's result holds nothing: null/undefined, an empty
 *  array, or an object with no own keys. */
export function isEmptyDecoded(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/** §617 — the stored value had content and the sanitizer kept none of it. */
export function sanitizedToNothing(raw: unknown, sanitized: unknown): boolean {
  return hasDecodedContent(raw) && isEmptyDecoded(sanitized);
}
```

- [ ] **Step 5: Route every meta slice through one decoder.** In `src/app/turso-schema.ts` add `import { sanitizedToNothing } from "./meta-slice-decode";`. Keep `reportUnreadableSlice` as is. Replace everything from `const statusRow = rowObjects(byTable.get("meta")).find((r) => r.key === "project_status");` through the end of the `settings_overrides` block (the line before `return migrateWorkspaceV10(ws);`) with — keeping the §538 comment above `project_meta` and the documents/documentVersions comments above their two calls:

```ts
  const metaRows = rowObjects(byTable.get("meta"));
  /** §617 — parse and sanitize ONE meta row. A throw is reported as before; a
   *  value that HAD content but sanitized to nothing is now reported too,
   *  instead of being dropped silently (for `project_meta` the next save then
   *  deleted the row for good). Reporting pauses saving, which is what keeps the
   *  stored row. `undefined` = assign nothing. */
  const decodeMeta = <T>(key: string, sanitize: (raw: unknown) => T): T | undefined => {
    const row = metaRows.find((r) => r.key === key);
    if (!row?.value) return undefined;
    try {
      const raw: unknown = JSON.parse(row.value);
      const out = sanitize(raw);
      if (sanitizedToNothing(raw, out)) {
        reportUnreadableSlice(key, new Error("parsed, but sanitized to nothing"));
        return undefined;
      }
      return out;
    } catch (err) {
      reportUnreadableSlice(key, err);
      return undefined;
    }
  };
  const status = decodeMeta("project_status", sanitizeProjectStatus);
  if (status !== undefined) ws.status = status;
  const pm = decodeMeta("project_meta", sanitizeLoadedProjectMeta);
  if (pm) ws.project = pm;
  const fv = decodeMeta("field_visibility", sanitizeFieldVisibility);
  if (fv) ws.fieldVisibility = fv;
  const features = decodeMeta("features", sanitizeFeatures);
  if (features !== undefined) ws.features = features;
  const sc = decodeMeta("steering_committee", sanitizeSteeringCommittee);
  if (sc) ws.steeringCommittee = sc;
  const tl = decodeMeta("timelog_links", sanitizeTimelogLinks);
  if (tl) ws.timelogLinks = tl;
  const ki = decodeMeta("knowledge_items", sanitizeKnowledgeItems);
  if (ki?.length) ws.knowledgeItems = ki;
  const ins = decodeMeta("insights", sanitizeInsights);
  if (ins?.length) ws.insights = ins;
  const log = decodeMeta("activityLog", sanitizeActivityLog);
  if (log?.length) ws.activityLog = log;
  const history = decodeMeta("budgetHistory", sanitizeBudgetHistory);
  if (history?.length) ws.budgetHistory = history;
  const docs = decodeMeta("documents", (raw) =>
    sanitizeProjectDocumentsWithDiag(raw, diag).map(sanitizeDocumentRichFields));
  if (docs?.length) ws.documents = docs;
  const versions = decodeMeta("documentVersions", (raw) =>
    sanitizeDocumentVersionsWithDiag(raw, diag).map((v) => ({
      ...v,
      blocks: sanitizeDocumentRichFields({
        id: v.documentId,
        title: v.title,
        blocks: v.blocks,
        createdAt: v.savedAt,
        updatedAt: v.savedAt,
      }).blocks,
    })));
  if (versions?.length) ws.documentVersions = versions;
  const so = decodeMeta("settings_overrides", sanitizeSettingsOverrides);
  if (so && hasAnyOverride(so)) ws.settingsOverrides = so;
```
The slice ORDER is unchanged, which `turso-schema.documents.test.ts` pins (`["insights", "documents"]`). Every sanitizer passed by reference takes `unknown` today (`sanitizeProjectStatus`, `sanitizeLoadedProjectMeta`, `sanitizeFieldVisibility`, `sanitizeFeatures`, `sanitizeSteeringCommittee`, `sanitizeTimelogLinks`, `sanitizeKnowledgeItems`, `sanitizeInsights`, `sanitizeActivityLog`, `sanitizeBudgetHistory`, `sanitizeSettingsOverrides`); if `tsc` disagrees for one, read its signature — never cast.

- [ ] **Step 6: Run green + the neighbours (under the lock).** `npx vitest run src/app/meta-slice-decode.test.ts src/app/turso-schema.execute.test.ts src/app/turso-schema.documents.test.ts src/app/turso-schema.test.ts > $SCRATCH/t4.log 2>&1; echo "EXIT=$?"` → EXIT=0, `Test Files 4 passed (4)`. Then `ls src/app/turso-backend*.test.ts src/app/use-load-truncation*.test.ts` and run those files → EXIT=0. A newly red test that stores a HOSTILE document payload is expected to keep passing (hostile documents sanitize to a non-empty list); any other new red is a false positive — stop and report it, do not weaken the predicate.

- [ ] **Step 7: Mutants.**
  - M1: `sanitizedToNothing` → `return isEmptyDecoded(sanitized);` → every LEGIT_EMPTY case red (`expected [ 'features' ] not to contain 'features'`), the "Simple mode" test red.
  - M2: in `decodeMeta`, delete the `reportUnreadableSlice(key, …)` line inside the `sanitizedToNothing` branch → every INVALID case red (`expected undefined to deeply equal [ … ]`).
  - M3: `hasDecodedContent`'s object branch → `return Object.keys(raw).length > 0;` → the `{"narrative":""}` LEGIT case red, and the predicate table red on `{ narrative: "" }`.

- [ ] **Step 8: Coverage and gates.** `meta-slice-decode.ts` is a new coverage-gated `.ts`; its own test covers every branch. `npx tsc --noEmit` → 0; `npx eslint --max-warnings=0 src` → 0.

- [ ] **Step 9: Register (§617; after the rebase).** Close it. Status: the slice list, the recursive content rule and why (Review Focus 1), and that JSON/IndexedDB have the same shape but no save-pause channel (Correction 3) — carried by the owner decision, not closed silently. Delete `**Work item:** #427`; index row.

- [ ] **Step 10: Commit.** `fix: report a meta slice that sanitizes to nothing instead of dropping it (§617)`; `git commit --only src/app/meta-slice-decode.ts src/app/meta-slice-decode.test.ts src/app/turso-schema.ts src/app/turso-schema.execute.test.ts docs/open-followups.md -F $SCRATCH/msg4.txt` (omit the register if deferred).

---

### Task 5: #117 / §64 — a snapshot taken with nothing in scope stores no completion figure

**Files:**
- Modify: `src/app/snapshot.ts` (`SnapshotRecord.pctComplete`, `buildSnapshot`, `isKpiCompleteSnapshot`, the `withoutCompletionVariance` doc comment)
- Modify: `src/app/snapshot-schema.ts` (`rowsToSnapshots`)
- Modify: `src/app/completion-trend.ts` (`CompletionPoint.percent`, `fromSnapshots`)
- Modify: `src/app/sparkline.tsx` (`Sparkline`)
- Modify: `src/app/dashboard-tile-bodies.tsx` (`CompletionTrendBody`)
- Test: `src/app/snapshot.test.ts`, `src/app/snapshot-schema.execute.test.ts`, `src/app/completion-trend.test.ts`, `src/app/sparkline.test.tsx`, `src/app/dashboard-panel.test.tsx` (describe "DashboardPanel completion-trend card")
- Modify: `docs/AGENTS/dashboard.md` (the "Completion-trend sparkline" bullet), `docs/open-followups.md` (§64 → closed)

**Interfaces:**
- Produces: `SnapshotRecord.pctComplete: number | null`; `CompletionPoint.percent: number | null`; `isKpiCompleteSnapshot(rec: Pick<SnapshotRecord, "remainingHours" | "pctComplete">)`.
- Consumes: `hasNoActiveScope(progress)` from `dashboard.ts` (value import; `dashboard.ts` imports only a TYPE from `snapshot.ts`, so there is no runtime cycle).

**Every consumer of `pctComplete` (reproduce: `grep -rn "pctComplete" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."`):** `snapshot.ts` (type, capture, `computeVariance` — its `num()` and `worseIfLower` already take null), `snapshot-schema.ts` (write via `numText`, already null-safe; read — changed here), `completion-trend.ts` (changed here), `variance-format.ts` (formats `row.baseline/current`, already null-safe because a missing baseline is null today), `use-snapshots.ts` (comments only), and `SnapshotBucketProgress.pctComplete` in `budget-ev-history.ts` / `snapshot-schema.ts` — a DIFFERENT field (per-bucket), untouched.

- [ ] **Step 1: Write the failing tests.**

`src/app/snapshot.test.ts`, inside `describe("buildSnapshot", …)`:
```ts
  // §64 — an all-cancelled project has no denominator: 0% would read as lost
  //  delivery on the sparkline and could become a baseline's figure.
  it("stores no completion figure (null) while nothing is in scope", () => {
    const noScope = { ...model, progress: { total: 2, inScope: 0, completed: 0, percent: 0, counts: { R: 0, A: 0, G: 0 } } } as unknown as DashboardModel;
    const rec = buildSnapshot({
      model: noScope, tasks: [], milestones: [], planEndDate: "2026-07-31", buckets: [],
      capturedAt: "2026-06-03T09:00:00.000Z", cadence: "weekly", trigger: "manual",
    });
    expect(rec.pctComplete).toBeNull();
  });
```
and a new describe at file end:
```ts
describe("isKpiCompleteSnapshot (§64, §78)", () => {
  it("never lets a no-scope row become the auto baseline", () => {
    expect(isKpiCompleteSnapshot({ remainingHours: 10, pctComplete: null })).toBe(false);
    expect(isKpiCompleteSnapshot({ remainingHours: 10, pctComplete: 0 })).toBe(true);
    expect(isKpiCompleteSnapshot({ remainingHours: null, pctComplete: 40 })).toBe(false);
  });

  it("gives an empty completion variance against a null baseline figure", () => {
    const rows = computeVariance(recWith({ pctComplete: null }), recWith({ pctComplete: 40 }));
    const pct = rows.find((r) => r.key === "pctComplete")!;
    expect(pct).toMatchObject({ baseline: null, current: 40, delta: null, health: null });
  });
});
```
(import `isKpiCompleteSnapshot` and `computeVariance` from `./snapshot` if not already imported.)

`src/app/snapshot-schema.execute.test.ts`, inside `describe("snapshot schema against a fresh (live DDL) database", …)`:
```ts
  it("round-trips a null completion figure as null, not 0 (§64)", () => {
    const db = new DatabaseSync(":memory:");
    try {
      for (const ddl of SNAPSHOT_DDL) db.exec(ddl);
      runStatements(db, appendStatements({ ...rec, pctComplete: null }, "p1"));
      const out = rowsToSnapshots(query(db, "SELECT * FROM snapshot"), query(db, "SELECT * FROM snapshot_series"));
      expect(out[0].pctComplete).toBeNull();
    } finally {
      db.close();
    }
  });
```

`src/app/completion-trend.test.ts`: change the helper to `function snap(capturedAt: string, pct: number | null): SnapshotRecord {` and add inside `describe("computeCompletionTrend", …)`:
```ts
  test("keeps a no-scope snapshot as a gap (null), never 0 (§64)", () => {
    const snapshots = [
      snap("2026-06-10T00:00:00.000Z", 20),
      snap("2026-06-12T00:00:00.000Z", null),
      snap("2026-06-14T00:00:00.000Z", 55),
    ];
    const out = computeCompletionTrend({ snapshots, activity: [], tasks: [], currentDone: 9, currentTotal: 10, today: "2026-06-21" });
    expect(out.map((p) => p.percent)).toEqual([20, null, 55]);
  });

  test("falls back to the activity log when fewer than two snapshots carry a figure (§64)", () => {
    const input = { activity: [ev("2026-06-12T00:00:00.000Z", "task.completed")], tasks: doneBefore(2), currentDone: 3, currentTotal: 10, today: "2026-06-21" };
    const withNull = computeCompletionTrend({ ...input, snapshots: [snap("2026-06-10T00:00:00.000Z", null), snap("2026-06-14T00:00:00.000Z", 40)] });
    expect(withNull).toEqual(computeCompletionTrend({ ...input, snapshots: [] }));
  });
```
(`doneBefore` is the file's existing helper; read its signature first and match it.)

`src/app/sparkline.test.tsx`: change `pts` to take `vals: (number | null)[]`, then add:
```tsx
  // §64 — a null point is a snapshot taken with nothing in scope: it keeps its
  //  place in time but draws nothing, so the line BREAKS instead of dropping to
  //  0 or bridging the gap.
  test("breaks the line at a null point and draws no dot for it", () => {
    const { container } = render(<Sparkline points={pts([10, 20, null, 30, 40])} />);
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
    expect(container.querySelectorAll("[data-sparkline-point]")).toHaveLength(4);
  });

  test("draws a lone real point between two gaps as a dot with no line", () => {
    const { container } = render(<Sparkline points={pts([null, 50, null])} />);
    expect(container.querySelectorAll("polyline")).toHaveLength(0);
    expect(container.querySelectorAll("[data-sparkline-point]")).toHaveLength(1);
  });
```

`src/app/dashboard-panel.test.tsx`: change `function snapRec(capturedAt: string, pct: number)` to `pct: number | null`, then add inside `describe("DashboardPanel completion-trend card", …)`:
```tsx
  // §64 — the edge values and the accessible name read the first and last
  //  points that HAVE a figure; a leading no-scope capture must never print
  //  "null%" or become the "from" figure.
  it("reads its edge values from the first and last points with a figure", () => {
    withTrendOnBoard("p-trend-gap");
    render(
      <DashboardPanel
        {...baseProps}
        projectId="p-trend-gap"
        snapshots={[
          snapRec("2026-06-08T00:00:00.000Z", null),
          snapRec("2026-06-10T00:00:00.000Z", 20),
          snapRec("2026-06-14T00:00:00.000Z", 55),
        ]}
      />,
      { wrapper },
    );
    expect(screen.getByRole("img", { name: "Completion trend: 55% on Jun 14, from 20% on Jun 10" })).toBeInTheDocument();
    const tile = screen.getByTestId("tile-completionTrend");
    expect(within(tile).queryByText(/null/)).toBeNull();
    expect(within(tile).getByText("Jun 10")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run (under the lock).** `npx vitest run src/app/snapshot.test.ts src/app/snapshot-schema.execute.test.ts src/app/completion-trend.test.ts src/app/sparkline.test.tsx src/app/dashboard-panel.test.tsx > $SCRATCH/t5.log 2>&1; echo "EXIT=$?"` → EXIT=1: `expected 0 to be null` (capture and schema read), `expected [20, 0, 55] to deeply equal [20, null, 55]`, `isKpiCompleteSnapshot` returns true for the null row, the sparkline renders 1 polyline, and the dashboard name reads "from 0% on Jun 8".

- [ ] **Step 3: Implement the record and its persistence.**
  - `snapshot.ts`: `import { hasNoActiveScope, type DashboardModel } from "./dashboard";` (replacing the type-only import). In `SnapshotRecord`: `pctComplete: number | null;  // null = captured while nothing was in scope (§64)`. In `buildSnapshot`:
    ```ts
        // §64 — no in-scope task means no denominator: store NO figure rather
        //  than a 0 that reads as lost delivery. Existing rows keep their number.
        pctComplete: hasNoActiveScope(model.progress) ? null : model.progress.percent,
    ```
  - `isKpiCompleteSnapshot`:
    ```ts
    export function isKpiCompleteSnapshot(rec: Pick<SnapshotRecord, "remainingHours" | "pctComplete">): boolean {
      // §64 — a no-scope row has no completion figure, so it can never be the
      //  baseline a later completion variance is measured against.
      return rec.remainingHours !== null && rec.pctComplete !== null;
    }
    ```
    and add to its doc comment: `★ And a known completion figure (§64): a row captured while nothing was in scope stores \`pctComplete: null\`.`
  - In the `withoutCompletionVariance` doc comment replace the ★★★ paragraph ("This is PRESENTATION ONLY … Do not "finish the job" at the record.") with: `★★★ Still needed after §64: rows captured before §64 store 0 for a no-scope project, and the live no-scope gate applies to them. New captures store null, which \`computeVariance\` already turns into an empty row.`
  - `snapshot-schema.ts` in `rowsToSnapshots`: `pctComplete: Number(r.pct_complete || 0),` → `pctComplete: numOrNull(r.pct_complete), // "" = no figure (§64); every older row holds a number`.

- [ ] **Step 4: Implement the series and its drawing.**
  - `completion-trend.ts`: `CompletionPoint.percent` becomes `percent: number | null;` with doc `/** Completion percentage, clamped to [0, 100]; null = a snapshot taken while nothing was in scope (§64) — a GAP, never 0. */`. `fromSnapshots`:
    ```ts
    function fromSnapshots(snapshots: readonly SnapshotRecord[]): CompletionPoint[] {
      if (snapshots.length < 2) return [];
      const sorted = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
      const points = trailing(sorted).map((s) => ({
        date: s.capturedAt.slice(0, 10),
        label: dayLabel(s.capturedAt),
        percent: s.pctComplete === null ? null : clampPctValue(s.pctComplete),
      }));
      // §64 — fewer than two real figures is not a trend; the log reconstruction
      //  takes over exactly as it does for fewer than two snapshots.
      return points.filter((p) => p.percent !== null).length >= 2 ? points : [];
    }
    ```
  - `sparkline.tsx`, replacing the `xy` line and the JSX:
    ```tsx
      // §64 — a null point keeps its x slot (time still passed) but draws
      //  nothing, so the line BREAKS there: one polyline per run of real points.
      const xy = points.map((p, i) =>
        p.percent === null ? null : ([xAt(i).toFixed(1), yAt(p.percent).toFixed(1)] as const));
      const runs = xy.reduce<(readonly (readonly [string, string])[])[]>((acc, pt, i) => {
        if (pt === null) return acc;
        const startsRun = i === 0 || xy[i - 1] === null;
        return startsRun ? [...acc, [pt]] : [...acc.slice(0, -1), [...acc[acc.length - 1], pt]];
      }, []);
    ```
    ```tsx
        <svg viewBox={`0 0 ${W} ${H}`} className={`w-full overflow-visible ${className ?? ""}`} preserveAspectRatio="none" {...a11y}>
          {runs.filter((run) => run.length >= 2).map((run, r) => (
            <polyline key={r} points={run.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" className="stroke-ui-dark-blue" strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
          {xy.map((pt, i) => pt && (
            <path key={i} data-sparkline-point="" d={`M${pt[0]} ${pt[1]}h0`} className="stroke-ui-dark-blue" strokeWidth={6}
              strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
    ```
    and add to the component doc: `★ A null point (§64) is a gap: no dot, and the line breaks there.`
  - `dashboard-tile-bodies.tsx` `CompletionTrendBody`, replacing `const first = points[0]; const last = points[points.length - 1];`:
    ```tsx
      // §64 — the edges and the accessible name read the first and last points
      //  that HAVE a figure; a null point is a gap in the line, never "null%".
      const measured = points.filter((p): p is CompletionPoint & { percent: number } => p.percent !== null);
      if (measured.length < 2) return null;
      const first = measured[0];
      const last = measured[measured.length - 1];
    ```

- [ ] **Step 5: Run green (under the lock)** — the Step 2 command, plus `src/app/completion-trend.property.test.ts src/app/snapshot-schema.test.ts src/app/snapshot-store.test.ts src/app/use-snapshots.test.tsx src/app/trends-panel.test.tsx` → EXIT=0, `Test Files 10 passed (10)`. No existing fixture changes value (all store numbers); widening the type is compile-only. `npx tsc --noEmit` → 0 (it will point at any consumer that still assumes `number`).

- [ ] **Step 6: Mutants.**
  - M1: capture `pctComplete: model.progress.percent` again → "stores no completion figure" red (`expected 0 to be null`).
  - M2: reader back to `Number(r.pct_complete || 0)` → the schema round-trip red.
  - M3: `fromSnapshots` maps `percent: clampPctValue(s.pctComplete ?? 0)` → the gap test red (`[20, 0, 55]`).
  - M4: drop `&& rec.pctComplete !== null` → `isKpiCompleteSnapshot` test red.
  - M5: `CompletionTrendBody` back to `points[0]` → dashboard test red (name reads "from null% on Jun 8").
  - M6: sparkline back to a single polyline over all non-null points → the break test red (1 polyline).

- [ ] **Step 7: Docs.** In `docs/AGENTS/dashboard.md`'s "Completion-trend sparkline" bullet, after "exact `SnapshotRecord.pctComplete` series (Turso path)", add: `— ★ \`pctComplete\` is null for a capture taken while nothing was in scope (§64): \`fromSnapshots\` keeps it as a null point, \`Sparkline\` breaks the line there, \`CompletionTrendBody\` reads its edges from the first/last point WITH a figure, and fewer than two figures falls back to the log`. `npm run docs:symbols:check` → EXIT=0.

- [ ] **Step 8: Register (§64).** Close it: the snapshot half is done for new captures; older stored 0s are unchanged by the recorded decision and still hidden by the live gate. Delete `**Work item:** #117`; index row (the heading suffix `— HALF FIXED post-0.216.0` becomes `— CLOSED 2026-09-26`).

- [ ] **Step 9: Commit.** `fix: store no completion figure for a snapshot taken with nothing in scope (§64)`; `git commit --only src/app/snapshot.ts src/app/snapshot-schema.ts src/app/completion-trend.ts src/app/sparkline.tsx src/app/dashboard-tile-bodies.tsx src/app/snapshot.test.ts src/app/snapshot-schema.execute.test.ts src/app/completion-trend.test.ts src/app/sparkline.test.tsx src/app/dashboard-panel.test.tsx docs/AGENTS/dashboard.md docs/open-followups.md -F $SCRATCH/msg5.txt`.

---

### Task 6: #75 / §463 — both export buttons export every enabled section

**Files:**
- Create: `src/app/export-workspace.ts`, `src/app/export-workspace.test.ts`
- Modify: `src/app/export-menu.tsx` (`ExportMenu` props and `pick`)
- Modify: `src/app/action-menus.tsx` (`ActionMenus`)
- Modify: `src/app/task-manager.tsx` (`handleExportCurrentProject`)
- Modify: `src/app/export.ts` (`exportFilename` doc comment only)
- Test: `src/app/action-menus-sweep.test.ts`, `src/app/export-ooxml.test.ts`
- MIGRATE: `src/app/export-menu.test.tsx` (`renderMenu` and the footer test)
- Modify: `docs/open-followups.md` (§463 → closed)

**Interfaces:**
- Produces: `EXPORT_WORKSPACE_KEYS` (readonly tuple of 19 `Workspace` keys), `type ExportWorkspaceSource = { readonly [K in (typeof EXPORT_WORKSPACE_KEYS)[number]]: Workspace[K] }`, `buildExportWorkspace(src: ExportWorkspaceSource): Workspace`. `ExportMenu` now takes `{ lang, workspace: Workspace, exportConfig?, exportFooter? }`.
- Mapping proof (each `ExportConfig` key → the `Workspace` field of the SAME name read by `BUILDERS` in `export-sections.ts`): `project`→`ws.project`, `tasks`→`ws.tasks`, `raid`→`ws.raid`, `changes`→`ws.changes`, `milestones`→`ws.milestones`, `stakeholders`→`ws.stakeholders`, `budgets`→`ws.budgets`, `resources`→`ws.resources`, `roles`→`ws.roles`, `absences`→`ws.absences`, `shifts`→`ws.shifts`, `calendarEvents`→`ws.calendarEvents`, `status`→`ws.status`, `knowledgeItems`→`ws.knowledgeItems`, `insights`→`ws.insights`. The derived-axis test below proves it per key rather than trusting this list.

- [ ] **Step 1: Write the failing builder test.** Create `src/app/export-workspace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildExportWorkspace, EXPORT_WORKSPACE_KEYS } from "./export-workspace";
import { buildExportSections } from "./export-sections";
import { EXPORT_SECTION_KEYS, type ExportConfig } from "./settings-types";
import { jsonToWorkspace } from "./workspace";

const SAMPLE = jsonToWorkspace(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"));

describe("buildExportWorkspace (§463)", () => {
  // ★ DERIVED from the settings' own key list, so a future Settings → Export
  //  switch whose slice this builder forgets fails here instead of exporting
  //  nothing, silently, from both buttons.
  it("carries a slice for every Settings → Export switch", () => {
    for (const key of EXPORT_SECTION_KEYS) expect(EXPORT_WORKSPACE_KEYS, key).toContain(key);
  });

  it("feeds every section builder, one switch at a time", () => {
    const out = buildExportWorkspace(SAMPLE);
    for (const key of EXPORT_SECTION_KEYS) {
      const only = Object.fromEntries(EXPORT_SECTION_KEYS.map((k) => [k, k === key])) as ExportConfig;
      expect(buildExportSections(out, only, "en-US").map((s) => s.key), key).toEqual([key]);
    }
  });

  it("returns only the export slices (no documents, activity log or settings overrides)", () => {
    expect(Object.keys(buildExportWorkspace(SAMPLE)).sort()).toEqual([...EXPORT_WORKSPACE_KEYS].sort());
  });
});
```

And in `src/app/action-menus-sweep.test.ts`, inside `describe("action menus — single source of truth", …)`:
```ts
  // §463 — the header button and the Projects-panel button used to build two
  //  different object literals, and neither carried calendar events,
  //  knowledge items or insights. Both now go through ONE builder.
  it("builds both export workspaces through buildExportWorkspace", () => {
    expect(read("src/app/action-menus.tsx")).toContain("buildExportWorkspace(");
    const tm = read("src/app/task-manager.tsx");
    const start = tm.indexOf("const handleExportCurrentProject");
    expect(start).toBeGreaterThan(-1);
    expect(tm.slice(start, tm.indexOf("\n  );", start))).toContain("buildExportWorkspace(");
  });
```

- [ ] **Step 2: Run (under the lock).** `npx vitest run src/app/export-workspace.test.ts src/app/action-menus-sweep.test.ts > $SCRATCH/t6.log 2>&1; echo "EXIT=$?"` → EXIT=1: `Failed to resolve import "./export-workspace"` and `expected '…' to contain 'buildExportWorkspace('`.

- [ ] **Step 3: Implement the builder.** Create `src/app/export-workspace.ts`:

```ts
// src/app/export-workspace.ts — §463: the ONE workspace both export buttons export.
//
// ★★★ TWO BUTTONS, TWO LITERALS, THREE DEAD SWITCHES. The header Export menu
//  passed 11 slices and the Projects-panel export 16, and neither passed
//  calendar events, knowledge items or insights — so those Settings → Export
//  switches changed nothing on any format, and a switched-on section vanished
//  with no notice (`buildExportSections` cannot tell an absent slice from an
//  empty one). Both buttons now export this object; the Settings → Export
//  switches decide what is written, as the section builders always did.
// ★ Every `ExportSectionKey` is a `Workspace` field of the same name —
//  `export-workspace.test.ts` derives that per key instead of trusting it.

import type { Workspace } from "./storage";

export const EXPORT_WORKSPACE_KEYS = [
  "tasks", "raid", "absences", "shifts", "resources", "roles", "disciplines", "grades",
  "plan", "budgets", "fxRates", "status", "project", "milestones", "changes", "stakeholders",
  "calendarEvents", "knowledgeItems", "insights",
] as const;

/** Every key REQUIRED (the value may still be undefined), so a caller cannot
 *  forget a slice and compile. */
export type ExportWorkspaceSource = { readonly [K in (typeof EXPORT_WORKSPACE_KEYS)[number]]: Workspace[K] };

export function buildExportWorkspace(src: ExportWorkspaceSource): Workspace {
  return {
    tasks: src.tasks, raid: src.raid, absences: src.absences, shifts: src.shifts,
    resources: src.resources, roles: src.roles, disciplines: src.disciplines, grades: src.grades,
    plan: src.plan, budgets: src.budgets, fxRates: src.fxRates, status: src.status,
    project: src.project, milestones: src.milestones, changes: src.changes,
    stakeholders: src.stakeholders, calendarEvents: src.calendarEvents,
    knowledgeItems: src.knowledgeItems, insights: src.insights,
  };
}
```

- [ ] **Step 4: Use it from both buttons.**
  - `export-menu.tsx`: replace the entity-type import line with `import type { Workspace } from "./storage";`; the props become
    ```tsx
    export function ExportMenu({
      lang,
      workspace,
      exportConfig,
      exportFooter,
    }: {
      lang: Lang;
      /** Built by `buildExportWorkspace` (§463) — the same object the Projects-panel export sends. */
      workspace: Workspace;
      exportConfig?: ExportConfig;
      /** Footer line of the PDF/print export (`exportFooterText(settings.branding)`). */
      exportFooter?: string;
    }) {
    ```
    `pick` calls `void exportWorkspace(workspace, format, exportConfig, lang, exportFooter)`; the subtitle reads `{t(lang, "exportSubtitle", workspace.tasks.length)}`.
  - `action-menus.tsx`: `import { buildExportWorkspace } from "./export-workspace";`, then
    ```tsx
      const workspace = buildExportWorkspace(useWorkspace());
    ```
    replacing the destructure, and `<ExportMenu lang={lang} workspace={workspace} exportConfig={exportConfig} exportFooter={exportFooter} />`. In the component doc comment, "ExportMenu's data comes from `useWorkspace()` here" → "ExportMenu's workspace is `buildExportWorkspace(useWorkspace())` here — the same builder the Projects-panel export uses (§463)".
  - `task-manager.tsx` `handleExportCurrentProject`:
    ```tsx
      const handleExportCurrentProject = useCallback(
        (format: string) => {
          // §463 — the same builder as the header Export menu, so the two buttons
          //  cannot drift apart again.
          const ws = buildExportWorkspace({
            tasks, raid, absences, shifts, resources, roles, disciplines, grades,
            plan, budgets, fxRates, status, project, milestones, changes, stakeholders,
            calendarEvents, knowledgeItems, insights,
          });
          void exportWorkspace(ws, format as ExportFormat, settings.export ?? defaultExportConfig, lang, exportFooter).catch((e) => reportSilentFailure(showToast, lang, "export.failed", e, "guardExportFailed"));
        },
        [tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, milestones, changes, stakeholders, calendarEvents, knowledgeItems, insights, settings.export, exportFooter, lang, showToast],
      );
    ```
    with `import { buildExportWorkspace } from "./export-workspace";`. `calendarEvents`, `knowledgeItems` and `insights` are already in scope (the calendar-events hook result and the `useWorkspace()` destructure).
  - `export.ts` `exportFilename` doc: replace "An export without a project name (the Open Points export menu passes no `project`) keeps that old name unchanged." with "Both export buttons now carry `project` (`buildExportWorkspace`, §463), so both are named after it; a workspace without a project name keeps the old name."

- [ ] **Step 5: MIGRATE `export-menu.test.tsx`.** Add `import { emptyWorkspace } from "./workspace";` and `const WS = { ...emptyWorkspace(), plan: PLAN };`. In `renderMenu` replace the eleven slice props with `workspace={WS}`; in the footer test replace `tasks={[]} … fxRates={null}` with `workspace={WS}`, and add `expect(vi.mocked(exportWorkspace).mock.calls[0][0]).toBe(WS);` after the footer assertion (the menu must export the workspace it was handed, not rebuild one).

- [ ] **Step 6: Add the per-format pins** (green on arrival: they pin that each format carries the three sections once a workspace has them). In `src/app/export-ooxml.test.ts` add `import { readFileSync } from "node:fs"; import { join } from "node:path"; import { jsonToWorkspace } from "./workspace"; import { buildExportWorkspace } from "./export-workspace";`, add `t` to the file's existing `./i18n` import (`import { loadI18n, t } from "./i18n";`), and use the file's own `unzipBlob`:
```ts
describe("§463 — calendar events, knowledge items and insights reach every document format", () => {
  const SAMPLE = buildExportWorkspace(
    jsonToWorkspace(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8")),
  );
  const CASES = [
    ["calendarEvents", "exportLabelCalendarEvents"],
    ["knowledgeItems", "exportLabelKnowledgeItems"],
    ["insights", "exportLabelInsights"],
  ] as const;
  for (const [key, titleKey] of CASES) {
    it(`${key}: present when switched on, absent when switched off`, async () => {
      const title = t("en-US", titleKey);
      const on: ExportConfig = { ...defaultExportConfig, [key]: true };
      const off: ExportConfig = { ...defaultExportConfig, [key]: false };
      expect(buildPdfHtml(SAMPLE, on, "en-US")).toContain(`>${title}</h2>`);
      expect(buildPdfHtml(SAMPLE, off, "en-US")).not.toContain(`>${title}</h2>`);
      const docx = async (cfg: ExportConfig) => (await unzipBlob(buildDocx(buildExportSections(SAMPLE, cfg, "en-US")))).get("word/document.xml")!;
      expect(await docx(on)).toContain(`>${title}<`);
      expect(await docx(off)).not.toContain(`>${title}<`);
      const wb = async (cfg: ExportConfig) => (await unzipBlob(buildXlsx(buildExportSections(SAMPLE, cfg, "en-US")))).get("xl/workbook.xml")!;
      expect(await wb(on)).toContain(`name="${title}"`);
      expect(await wb(off)).not.toContain(`name="${title}"`);
      const slides = async (cfg: ExportConfig) =>
        [...(await unzipBlob(buildPptx(buildExportSections(SAMPLE, cfg, "en-US"), "en-US"))).entries()]
          .filter(([p]) => p.startsWith("ppt/slides/slide")).map(([, x]) => x).join("\n");
      expect(await slides(on)).toContain(title);
      expect(await slides(off)).not.toContain(`>${title}<`);
    });
  }
});
```
If a format escapes or splits the title differently than the probe assumes, read that format's XML for the title and adjust the probe, never the builder.

- [ ] **Step 7: Run green (under the lock).** `npx vitest run src/app/export-workspace.test.ts src/app/action-menus-sweep.test.ts src/app/action-menus.test.tsx src/app/export-menu.test.tsx src/app/export-ooxml.test.ts src/app/export.test.ts src/app/shell-chrome.export-footer.test.tsx > $SCRATCH/t6.log 2>&1; echo "EXIT=$?"` → EXIT=0, `Test Files 7 passed (7)`. `npx tsc --noEmit` → 0 (it catches any other `ExportMenu` caller: `grep -rn "<ExportMenu" src/app` lists only `action-menus.tsx`).

- [ ] **Step 8: Mutants.**
  - M1: delete `insights: src.insights,` from `buildExportWorkspace` → "feeds every section builder" red at `insights` (`[]` vs `["insights"]`) and "returns only the export slices" red.
  - M2: revert `handleExportCurrentProject` to the inline literal → the sweep test red.
  - M3: `ActionMenus` passes `buildExportWorkspace({ ...useWorkspace(), calendarEvents: undefined })` → no unit test sees it; record in the register that the header path is pinned structurally (sweep test) plus by `ExportMenu` exporting the object it is handed (Step 5), and that the content is pinned by the builder test.

- [ ] **Step 9: Register (§463).** Close it; say CSV/Markdown are unchanged storage formats (the project block stays storage-only there, as the entry records), and that the header export is now named after the project. Delete `**Work item:** #75`; index row.

- [ ] **Step 10: Commit.** `fix: export every section the export settings enable, from both export buttons (§463)`; `git commit --only src/app/export-workspace.ts src/app/export-workspace.test.ts src/app/export-menu.tsx src/app/export-menu.test.tsx src/app/action-menus.tsx src/app/action-menus-sweep.test.ts src/app/task-manager.tsx src/app/export.ts src/app/export-ooxml.test.ts docs/open-followups.md -F $SCRATCH/msg6.txt`.

---

### Task 7: #229 / §304 — export headers and section titles are translated labels

**Files:**
- Create: `src/app/export-column-labels.ts`, `src/app/export-column-labels.test.ts`
- Modify: `src/app/export-sections.ts` (every `*Section` builder's `columns` and `title`, `statusSection` rows, `BUILDERS`, new `EXPORT_SECTION_FIELDS` after `RAID_EXPORT_COLUMNS`)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (24 keys after `exportLabelInsights`)
- MIGRATE: `src/app/export-sections.test.ts`, `src/app/export-sections.project.test.ts`, `src/app/export-sections.rich.property.test.ts`, `src/app/doc-data-section.test.ts`, `src/app/export.test.ts` (sites in Step 7)
- Re-run (must stay byte-identical): `src/app/golden-workspace.test.ts`
- Modify: `docs/open-followups.md` (§304 → closed)

**Interfaces:**
- Produces (in `export-column-labels.ts`): `KV_EXPORT_FIELDS`, `KNOWLEDGE_EXPORT_FIELDS`, `INSIGHT_EXPORT_FIELDS`, `CALENDAR_EVENT_EXPORT_FIELDS` (field-id tuples), `EXPORT_COLUMN_LABEL_KEYS: Readonly<Record<ExportSectionKey, Readonly<Record<string, TranslationKey>>>>`, `EXPORT_SECTION_TITLE_KEYS: Readonly<Record<ExportSectionKey, TranslationKey>>`, `STATUS_ROW_LABEL_KEYS: Readonly<Record<string, TranslationKey>>`, `exportColumnLabel(section, field, lang): string`, `exportColumnLabels(section, fields, lang): string[]`. In `export-sections.ts`: `EXPORT_SECTION_FIELDS: Readonly<Record<ExportSectionKey, readonly string[]>>`.
- `ExportSection.columns` keeps its type (`string[]`) and its documented meaning ("header row (display labels)") — now true. Renderers (`export.ts`, `export-docx.ts`, `export-xlsx.ts`, `export-pptx.ts`, `doc-render-*.ts`) are untouched. CSV and Markdown never read `columns`.

**Complete field → label map** (EN / DE values as they are in the dictionaries today, or as added in Step 3). Where the field has a table column the table-header key is reused; otherwise the edit-form key; `exportCol*` only where the app labels the field nowhere.

**tasks** (`CSV_COLUMNS`): `id`→`id` (ID/ID) · `taskName`→`task` (Task/Aufgabe) · `assignee`→`assignee` (Assignee/Zugewiesen an) · `assigneeEmail`→`fieldAssigneeEmail` (Assignee email/E-Mail der zugewiesenen Person) · `startDate`→`start` (Start/Start) · `dueDate`→`due` (Due/Fällig) · `lastUpdateDate`→`lastUpdate` (Last update/Letzte Aktualisierung) · `createdDate`→`colCreatedDate` (Created/Erstellt) · `priority`→`priority` (Priority/Priorität) · `status`→`colTaskStatus` (Status/Status) · `blockers`→`blockers` (Blockers/Blocker) · `description`→`description` (Description/Beschreibung) · `completedDate`→`completedDate` (Completed date/Abgeschlossen am) · `inquiriesSent`→`reportsInquiriesCol` (Inquiries/Abfragen) · `group`→`group` (Group/Gruppe) · `labels`→`labels` (Labels/Labels) · `dependencies`→`dependencies` (Dependencies/Abhängigkeiten) · `jiraKey`→`exportColJiraKey` NEW · `jiraIssueType`→`exportColJiraIssueType` NEW · `lastSyncedAt`→`exportColLastSyncedAt` NEW · `localModifiedAt`→`exportColLocalModifiedAt` NEW · `healthOverride`→`healthOverride` (Health override/Status-Override) · `resourceId`→`exportColResourceId` NEW · `originalEstimateMinutes`→`exportColOriginalEstimateMinutes` NEW · `timeSpentMinutes`→`exportColTimeSpentMinutes` NEW · `remainingEstimateMinutes`→`exportColRemainingEstimateMinutes` NEW · `knowledgeLinks`→`documentLinks` (Knowledge links/Wissenslinks) · `outlookEventId`→`exportColOutlookEventId` NEW · `calendarOptOut`→`exportColCalendarOptOut` NEW · `noteLog`→`noteLogTitle` (Notes log/Notizprotokoll).

**raid** (`RAID_EXPORT_COLUMNS` = `RAID_CSV_COLUMNS` minus `escalations`): `id`→`id` · `category`→`raidCategory` (Category/Kategorie) · `title`→`raidTitle` (Title/Titel) · `description`→`raidDescription` (Description/Beschreibung) · `severity`→`raidSeverity` (Severity/Schweregrad) · `probability`→`raidProbability` (Probability/Eintrittswahrscheinlichkeit) · `impact`→`raidImpact` (Impact/Auswirkung) · `status`→`raidStatus` (Status/Status) · `owner`→`raidOwner` (Owner/Verantwortlich) · `ownerEmail`→`fieldOwnerEmail` (Owner email/E-Mail der verantwortlichen Person) · `ownerResourceId`→`exportColResourceId` NEW · `mitigation`→`mitigation` (Mitigation/Gegenmaßnahme) · `linkedTaskIds`→`raidLinkedTasks` (Linked tasks/Verknüpfte Aufgaben) · `raisedDate`→`raidRaisedDate` (Raised/Erfasst) · `targetDate`→`raidTargetDate` (Target date/Zieltermin) · `closedDate`→`fieldClosedDate` (Closed date/Geschlossen am) · `localModifiedAt`→`exportColLocalModifiedAt` · `causedByRaidIds`→`raidCausedBy` (Caused by/Verursacht durch) · `stakeholderIds`→`linkedStakeholders` (Linked stakeholders/Verknüpfte Stakeholder) · `knowledgeLinks`→`documentLinks` · `outlookEventId`→`exportColOutlookEventId` · `calendarOptOut`→`exportColCalendarOptOut` · `inquiriesSent`→`reportsInquiriesCol` · `noteLog`→`noteLogTitle`.

**milestones**: `id`→`id` · `name`→`milestonesColName` (Milestone/Meilenstein) · `date`→`milestonesColDate` (Date/Datum) · `description`→`milestoneDescription` (Description/Beschreibung) · `achievedDate`→`milestonesColAchieved` (Achieved/Erreicht) · `linkedTaskIds`→`milestoneLinkedTasks` (Linked tasks/Verknüpfte Aufgaben) · `localModifiedAt`→`exportColLocalModifiedAt` · `knowledgeLinks`→`documentLinks` · `outlookEventId`→`exportColOutlookEventId` · `calendarOptOut`→`exportColCalendarOptOut`.

**changes**: `id`→`id` · `title`→`changeFieldTitle` (Title/Titel) · `description`→`changeFieldDescription` (Description/Beschreibung) · `type`→`changeFieldType` (Type/Typ) · `status`→`changeFieldStatus` (Status/Status) · `impact`→`changeFieldImpact` (Impact/Auswirkung) · `impactDescription`→`changeFieldImpactDescription` (Impact description/Auswirkungsbeschreibung) · `scheduleImpactDays`→`changeFieldScheduleImpact` (Schedule impact (days)/Zeitplan-Auswirkung (Tage)) · `costImpact`→`changeFieldCostImpact` (Cost impact/Kostenauswirkung) · `requestedBy`→`changeFieldRequestedBy` (Requested by/Beantragt von) · `raisedDate`→`changeFieldRaisedDate` (Raised/Erstellt) · `decisionBy`→`changeFieldDecisionBy` (Decided by/Entschieden von) · `decisionDate`→`changeFieldDecisionDate` (Decision date/Entscheidungsdatum) · `resolutionNotes`→`changeFieldResolution` (Resolution / rationale/Lösung / Begruendung) · `linkedTaskIds`→`changeFieldLinkedTasks` (Linked tasks/Verknüpfte Aufgaben) · `linkedRaidIds`→`changeFieldLinkedRaid` (Linked RAID items/Verknüpfte RAID-Einträge) · `stakeholderIds`→`linkedStakeholders` · `localModifiedAt`→`exportColLocalModifiedAt` · `knowledgeLinks`→`documentLinks` · `outlookEventId`→`exportColOutlookEventId` · `calendarOptOut`→`exportColCalendarOptOut` · `noteLog`→`noteLogTitle`.

**stakeholders**: `id`→`id` · `name`→`stakeholderFieldName` (Name/Name) · `organization`→`stakeholderFieldOrganization` (Organization/Organisation) · `title`→`stakeholderFieldTitle` (Title / role/Titel / Rolle) · `email`→`stakeholderFieldEmail` (Email/E-Mail) · `category`→`stakeholderFieldCategory` (Category/Kategorie) · `influence`→`stakeholderFieldInfluence` (Influence/Einfluss) · `interest`→`stakeholderFieldInterest` (Interest/Interesse) · `notes`→`stakeholderFieldNotes` (Notes/Notizen) · `resourceId`→`stakeholderFieldResource` (Linked resource/Verknüpfte Ressource) · `raci`→`raci` (RACI/RACI) · `localModifiedAt`→`exportColLocalModifiedAt` · `knowledgeLinks`→`documentLinks`.

**budgets**: `id`→`id` · `name`→`name` (Name/Name) · `poNumber`→`budgetPoNumber` (PO number/Bestellnummer) · `type`→`budgetType` (Type/Typ) · `currency`→`budgetCurrency` (Currency/Währung) · `fixedPriceAmount`→`budgetFixedPriceAmount` (Fixed-price amount/Festpreisbetrag) · `startDate`→`budgetStartDate` (Start date/Startdatum) · `endDate`→`budgetEndDate` (End date/Enddatum) · `successorId`→`budgetSuccessor` (Successor bucket/Nachfolge-Bucket) · `status`→`status` (Status/Status) · `closedDate`→`fieldClosedDate` · `createdDate`→`colCreatedDate` · `fxRateOverride`→`budgetFxOverride` (Manual FX rate/Manueller Wechselkurs) · `allocations`→`budgetAllocations` (Role allocations/Rollen-Zuordnungen) · `localModifiedAt`→`exportColLocalModifiedAt` · `order`→`exportColOrder` NEW · `planningMode`→`exportColPlanningMode` NEW · `disciplineAllocations`→`exportColDisciplineAllocations` NEW · `rateOverrideInternal`→`budgetRateOverrideInternal` (Internal rate override/Interner Satz (Override)) · `rateOverrideExternal`→`budgetRateOverrideExternal` (External rate override/Externer Satz (Override)) · `taskIds`→`budgetLinkedTasks` (Linked tasks/Verknüpfte Aufgaben) · `percentComplete`→`budgetPercentComplete` (Manual % complete/Manueller Fertigstellungsgrad (%)).

**resources**: `id`→`id` · `firstName`→`resourceFirstName` (First name/Vorname) · `lastName`→`resourceLastName` (Last name/Nachname) · `title`→`resourceColTitle` (Title/Titel) · `businessPhone`→`resourceColPhone` (Phone/Telefon) · `location`→`resourceLocation` (Location/Standort) · `department`→`resourceColDepartment` (Department/Abteilung) · `email`→`email` (Email/E-Mail) · `company`→`resourceCompany` (Company/Firma) · `birthday`→`resourceColBirthday` (Birthday/Geburtstag) · `notes`→`resourceNotes` (Notes/Notizen) · `roleId`→`role` (Role/Rolle) · `utilizationMode`→`exportColUtilizationMode` NEW · `utilization`→`utilization` (Utilization/Auslastung) · `absenceOverride`→`exportColAbsenceOverride` NEW · `active`→`resourceActiveLabel` (Active status/Aktiv-Status) · `localModifiedAt`→`exportColLocalModifiedAt` · `emails`→`resourceEmailsLabel` (Additional emails/Weitere E-Mail-Adressen) · `isExternal`→`resourceExternal` (External resource/Externe Ressource).

**roles**: `id`→`id` · `disciplineId`→`rolesDiscipline` (Discipline/Disziplin) · `gradeId`→`rolesGrade` (Grade/Stufe) · `internalRate`→`rolesInternalRate` (Internal /h/Intern /Std) · `externalRate`→`rolesExternalRate` (External /h/Extern /Std) · `internalRateDay`→`rolesInternalRateDay` (Internal /d/Intern /Tag) · `externalRateDay`→`rolesExternalRateDay` (External /d/Extern /Tag) · `rateBasis`→`rolesRateBasis` (Entered in/Eingabe in) · `localModifiedAt`→`exportColLocalModifiedAt` · `order`→`exportColOrder`.

**absences**: `id`→`id` · `assignee`→`absenceAssignee` (Assignee/Zugewiesen an) · `assigneeEmail`→`absenceAssigneeEmail` (Email/E-Mail) · `startDate`→`absenceStart` (Start/Start) · `endDate`→`absenceEnd` (End/Ende) · `type`→`absenceType` (Type/Typ) · `note`→`absenceNote` (Note/Notiz) · `localModifiedAt`→`exportColLocalModifiedAt` · `resourceId`→`exportColResourceId` · `outlookEventId`→`exportColOutlookEventId` · `calendarOptOut`→`exportColCalendarOptOut`.

**shifts** (`SHIFTS_CSV_COLUMNS`, typed `readonly string[]`): `id`→`id` · `assignee`→`shiftAssignee` (Assignee/Zugewiesene Person) · `assigneeEmail`→`shiftAssigneeEmail` (Email/E-Mail) · `resourceId`→`exportColResourceId` · `sunHours`…`satHours`→`shiftDaySun` `shiftDayMon` `shiftDayTue` `shiftDayWed` `shiftDayThu` `shiftDayFri` `shiftDaySat` (Sun/So. … Sat/Sa.) · `note`→`shiftNote` (Note/Notiz) · `localModifiedAt`→`exportColLocalModifiedAt`.

**project** and **status** header (`field`, `value`): `exportColField` NEW, `exportColValue` NEW. **status row labels** (`STATUS_FIELDS`): `ragOverride`→`dashboardOverall` (Overall/Gesamt) · `scheduleOverride`→`dashboardSubSchedule` (Schedule/Zeitplan) · `budgetOverride`→`dashboardSubBudget` (Budget/Budget) · `scopeOverride`→`dashboardSubScope` (Scope/Umfang) · `narrative`→`exportColNarrative` NEW · `narrativeUpdatedAt`→`exportColNarrativeUpdatedAt` NEW.

**knowledgeItems**: `name`→`documentsManualName` (Document name/Dokumentname) · `type`→`documentsManualKind` (Link type/Linktyp) · `url`→`exportColUrl` NEW · `tasks`→`knowledgeLinkedTasks` (Linked tasks/Verknüpfte Aufgaben).

**insights**: `type`→`type` (Type/Typ) · `severity`→`exportColSeverity` NEW · `status`→`status` · `data`→`exportColDetails` NEW · `occurrences`→`exportColOccurrences` NEW · `lastSeen`→`exportColLastSeen` NEW.

**calendarEvents**: `title`→`title` (Title/Titel — the calendar series list's header key) · `first occurrence`→`calendarEventFirstOccurrence` (First occurrence/Erster Termin) · `recurs`→`calendarEventRepeat` (Repeat/Wiederholung) · `location`→`calendarEventLocation` (Location/Ort).

**Titles** (`EXPORT_SECTION_TITLE_KEYS`; the first nine are what the builders already use): `tasks`→`tasks`, `raid`→`tabRaid`, `milestones`→`navMilestones`, `changes`→`navChanges`, `stakeholders`→`navStakeholders`, `resources`→`tabResources`, `project`→`exportLabelProject`, `knowledgeItems`→`exportLabelKnowledgeItems`, `calendarEvents`→`exportLabelCalendarEvents`; CHANGED: `budgets`→`exportLabelBudgets` (Budget/Budget, was "Budgets"), `roles`→`exportLabelRoles` (Roles & rates/Rollen & Raten, was "Roles"), `absences`→`exportLabelAbsences` (Absences/Abwesenheiten), `shifts`→`exportLabelShifts` (Shifts/Schichten), `status`→`exportLabelStatus` (Status report/Statusbericht, was "Project Status"), `insights`→`exportLabelInsights` (Insights/Erkenntnisse).

No two labels collide within one section in either language (checked by script over both dictionaries; the test in Step 1 pins it).

- [ ] **Step 1: Write the failing test.** Create `src/app/export-column-labels.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildExportSections, EXPORT_SECTION_FIELDS } from "./export-sections";
import { EXPORT_COLUMN_LABEL_KEYS, EXPORT_SECTION_TITLE_KEYS, STATUS_ROW_LABEL_KEYS } from "./export-column-labels";
import { EXPORT_SECTION_KEYS, type ExportConfig } from "./settings-types";
import { STATUS_FIELDS } from "./storage";
import { jsonToWorkspace } from "./workspace";
import { buildXlsx } from "./export-ooxml";
import { loadI18n, t } from "./i18n";
import { partText, unzipBytes } from "../test/unzip-bytes";

const ALL_ON = Object.fromEntries(EXPORT_SECTION_KEYS.map((k) => [k, true])) as ExportConfig;
const SAMPLE = jsonToWorkspace(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"));

beforeAll(async () => { await loadI18n("de"); });

describe.each(["en-US", "de"] as const)("export headers are display labels (§304, %s)", (lang) => {
  const sections = () => buildExportSections(SAMPLE, ALL_ON, lang);

  // Anti-vacuity: every section is built, so every assertion below runs on all fifteen.
  it("builds every section from the sample workspace", () => {
    expect(sections().map((s) => s.key)).toEqual([...EXPORT_SECTION_KEYS]);
  });

  it("labels every header through its section's label map, never the raw key", () => {
    for (const s of sections()) {
      const fields = EXPORT_SECTION_FIELDS[s.key];
      expect(s.columns, s.key).toHaveLength(fields.length);
      fields.forEach((field, i) => {
        const key = EXPORT_COLUMN_LABEL_KEYS[s.key][field];
        expect(key, `${s.key}.${field} has no label key`).toBeDefined();
        expect(s.columns[i], `${s.key}.${field}`).toBe(t(lang, key));
        expect(s.columns[i], `${s.key}.${field}`).not.toBe(field);
      });
    }
  });

  it("keeps every header distinct within its section", () => {
    for (const s of sections()) expect(new Set(s.columns).size, s.key).toBe(s.columns.length);
  });

  it("translates every section title", () => {
    for (const s of sections()) expect(s.title, s.key).toBe(t(lang, EXPORT_SECTION_TITLE_KEYS[s.key]));
  });

  it("labels the status section's rows, not just its header", () => {
    const status = sections().find((s) => s.key === "status")!;
    const rowLabels = status.rows.map((r) => r[0]);
    expect(rowLabels.length).toBeGreaterThan(0);
    for (const f of STATUS_FIELDS) expect(rowLabels, f).not.toContain(f);
    expect(rowLabels).toContain(t(lang, STATUS_ROW_LABEL_KEYS.ragOverride));
  });

  // Review Focus 3 — "Roles & rates" is the first sheet name with an ampersand.
  it("keeps the workbook well-formed with the translated sheet names", async () => {
    const wb = partText(await unzipBytes(buildXlsx(sections())), "xl/workbook.xml");
    const doc = new DOMParser().parseFromString(wb, "application/xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    const names = [...doc.getElementsByTagName("sheet")].map((n) => n.getAttribute("name"));
    expect(names).toContain(t(lang, "exportLabelRoles"));
  });
});
```
`unzipBytes` / `partText` are the shared helpers in `src/test/unzip-bytes.ts` (read their signatures before use). `STATUS_FIELDS` is declared in `csv-codecs-config.ts` and reaches `./storage` through `csv-codecs.ts`'s `export *`.

- [ ] **Step 2: Run (under the lock).** `npx vitest run src/app/export-column-labels.test.ts > $SCRATCH/t7.log 2>&1; echo "EXIT=$?"` → EXIT=1: `Failed to resolve import "./export-column-labels"`.

- [ ] **Step 3: Add the 24 keys.** `$SCRATCH/t7-en.json`:
```json
[
  "  exportColField: \"Field\",",
  "  exportColValue: \"Value\",",
  "  exportColJiraKey: \"Jira key\",",
  "  exportColJiraIssueType: \"Jira issue type\",",
  "  exportColLastSyncedAt: \"Last synced\",",
  "  exportColLocalModifiedAt: \"Last modified\",",
  "  exportColResourceId: \"Resource ID\",",
  "  exportColOutlookEventId: \"Outlook event ID\",",
  "  exportColCalendarOptOut: \"Excluded from Outlook sync\",",
  "  exportColOriginalEstimateMinutes: \"Original estimate (min)\",",
  "  exportColTimeSpentMinutes: \"Time spent (min)\",",
  "  exportColRemainingEstimateMinutes: \"Time remaining (min)\",",
  "  exportColOrder: \"Sort order\",",
  "  exportColPlanningMode: \"Planning mode\",",
  "  exportColDisciplineAllocations: \"Discipline allocations\",",
  "  exportColUtilizationMode: \"Utilization mode\",",
  "  exportColAbsenceOverride: \"Absence override\",",
  "  exportColUrl: \"URL\",",
  "  exportColSeverity: \"Severity\",",
  "  exportColDetails: \"Details\",",
  "  exportColOccurrences: \"Occurrences\",",
  "  exportColLastSeen: \"Last seen\",",
  "  exportColNarrative: \"Status narrative\",",
  "  exportColNarrativeUpdatedAt: \"Narrative updated\","
]
```
`$SCRATCH/t7-de.json`:
```json
[
  "  exportColField: \"Feld\",",
  "  exportColValue: \"Wert\",",
  "  exportColJiraKey: \"Jira-Schlüssel\",",
  "  exportColJiraIssueType: \"Jira-Vorgangstyp\",",
  "  exportColLastSyncedAt: \"Zuletzt synchronisiert\",",
  "  exportColLocalModifiedAt: \"Zuletzt geändert\",",
  "  exportColResourceId: \"Ressourcen-ID\",",
  "  exportColOutlookEventId: \"Outlook-Termin-ID\",",
  "  exportColCalendarOptOut: \"Von Outlook-Synchronisierung ausgenommen\",",
  "  exportColOriginalEstimateMinutes: \"Ursprüngliche Schätzung (Min.)\",",
  "  exportColTimeSpentMinutes: \"Aufgewandte Zeit (Min.)\",",
  "  exportColRemainingEstimateMinutes: \"Verbleibende Zeit (Min.)\",",
  "  exportColOrder: \"Reihenfolge\",",
  "  exportColPlanningMode: \"Planungsmodus\",",
  "  exportColDisciplineAllocations: \"Disziplin-Zuordnungen\",",
  "  exportColUtilizationMode: \"Auslastungsmodus\",",
  "  exportColAbsenceOverride: \"Abwesenheits-Überschreibung\",",
  "  exportColUrl: \"URL\",",
  "  exportColSeverity: \"Schweregrad\",",
  "  exportColDetails: \"Details\",",
  "  exportColOccurrences: \"Vorkommen\",",
  "  exportColLastSeen: \"Zuletzt gesehen\",",
  "  exportColNarrative: \"Statusbeschreibung\",",
  "  exportColNarrativeUpdatedAt: \"Statusbeschreibung aktualisiert\","
]
```
Insert both after `exportLabelInsights` with the helper; `npx tsc --noEmit` → 0.

- [ ] **Step 4: Create the label module** `src/app/export-column-labels.ts`:

```ts
// src/app/export-column-labels.ts — §304: the header label every export table
// prints, per section and field, plus the section titles.
//
// ★★★ HEADERS ARE LABELS; FIELDS STAY KEYS. `ExportSection.columns` is the
//  header row PDF, Word, PowerPoint and Excel print, and it was the raw storage
//  key (`dueDate`, `noteLog`) in every language. The builders still map each
//  row by the storage FIELD; only the header text comes from here. CSV and
//  Markdown never read `columns` — they are storage formats and keep raw keys.
// ★★ Reuse the app's TABLE-header key where the field has a column, then its
//  edit-form key, and an `exportCol*` key only where the app labels the field
//  nowhere. ONE deliberate exception: the three task effort columns carry raw
//  MINUTES while the table shows formatted hours under "Est."/"Spent", so they
//  get "(min)" keys instead of mislabelling the unit.
// ★ Each map is a total Record over its `as const` column constant, so a new
//  CSV column fails `tsc` here until it has a label. SHIFTS_CSV_COLUMNS is typed
//  `readonly string[]`, so its totality — and the four hand-written field lists
//  below — are pinned by export-column-labels.test.ts instead.

import type { ExportSectionKey } from "./settings-types";
import { t, type Lang, type TranslationKey } from "./i18n";
import type {
  CSV_COLUMNS, RAID_CSV_COLUMNS, MILESTONES_CSV_COLUMNS, CHANGES_CSV_COLUMNS,
  STAKEHOLDERS_CSV_COLUMNS, BUDGETS_CSV_COLUMNS, RESOURCES_CSV_COLUMNS,
  ROLES_CSV_COLUMNS, ABSENCES_CSV_COLUMNS,
} from "./storage";

type LabelsFor<T extends readonly string[]> = Readonly<Record<T[number], TranslationKey>>;

/** The key/value sections (project, status) print a two-column table. */
export const KV_EXPORT_FIELDS = ["field", "value"] as const;
export const KNOWLEDGE_EXPORT_FIELDS = ["name", "type", "url", "tasks"] as const;
export const INSIGHT_EXPORT_FIELDS = ["type", "severity", "status", "data", "occurrences", "lastSeen"] as const;
/** ★ "first occurrence" is a computed column, not a CalendarEvent field. */
export const CALENDAR_EVENT_EXPORT_FIELDS = ["title", "first occurrence", "recurs", "location"] as const;

const TASK_LABELS: LabelsFor<typeof CSV_COLUMNS> = {
  id: "id", taskName: "task", assignee: "assignee", assigneeEmail: "fieldAssigneeEmail",
  startDate: "start", dueDate: "due", lastUpdateDate: "lastUpdate", createdDate: "colCreatedDate",
  priority: "priority", status: "colTaskStatus", blockers: "blockers", description: "description",
  completedDate: "completedDate", inquiriesSent: "reportsInquiriesCol", group: "group", labels: "labels",
  dependencies: "dependencies", jiraKey: "exportColJiraKey", jiraIssueType: "exportColJiraIssueType",
  lastSyncedAt: "exportColLastSyncedAt", localModifiedAt: "exportColLocalModifiedAt",
  healthOverride: "healthOverride", resourceId: "exportColResourceId",
  originalEstimateMinutes: "exportColOriginalEstimateMinutes", timeSpentMinutes: "exportColTimeSpentMinutes",
  remainingEstimateMinutes: "exportColRemainingEstimateMinutes", knowledgeLinks: "documentLinks",
  outlookEventId: "exportColOutlookEventId", calendarOptOut: "exportColCalendarOptOut", noteLog: "noteLogTitle",
};

const RAID_LABELS: Readonly<Record<Exclude<(typeof RAID_CSV_COLUMNS)[number], "escalations">, TranslationKey>> = {
  id: "id", category: "raidCategory", title: "raidTitle", description: "raidDescription",
  severity: "raidSeverity", probability: "raidProbability", impact: "raidImpact", status: "raidStatus",
  owner: "raidOwner", ownerEmail: "fieldOwnerEmail", ownerResourceId: "exportColResourceId",
  mitigation: "mitigation", linkedTaskIds: "raidLinkedTasks", raisedDate: "raidRaisedDate",
  targetDate: "raidTargetDate", closedDate: "fieldClosedDate", localModifiedAt: "exportColLocalModifiedAt",
  causedByRaidIds: "raidCausedBy", stakeholderIds: "linkedStakeholders", knowledgeLinks: "documentLinks",
  outlookEventId: "exportColOutlookEventId", calendarOptOut: "exportColCalendarOptOut",
  inquiriesSent: "reportsInquiriesCol", noteLog: "noteLogTitle",
};

const MILESTONE_LABELS: LabelsFor<typeof MILESTONES_CSV_COLUMNS> = {
  id: "id", name: "milestonesColName", date: "milestonesColDate", description: "milestoneDescription",
  achievedDate: "milestonesColAchieved", linkedTaskIds: "milestoneLinkedTasks",
  localModifiedAt: "exportColLocalModifiedAt", knowledgeLinks: "documentLinks",
  outlookEventId: "exportColOutlookEventId", calendarOptOut: "exportColCalendarOptOut",
};

const CHANGE_LABELS: LabelsFor<typeof CHANGES_CSV_COLUMNS> = {
  id: "id", title: "changeFieldTitle", description: "changeFieldDescription", type: "changeFieldType",
  status: "changeFieldStatus", impact: "changeFieldImpact", impactDescription: "changeFieldImpactDescription",
  scheduleImpactDays: "changeFieldScheduleImpact", costImpact: "changeFieldCostImpact",
  requestedBy: "changeFieldRequestedBy", raisedDate: "changeFieldRaisedDate", decisionBy: "changeFieldDecisionBy",
  decisionDate: "changeFieldDecisionDate", resolutionNotes: "changeFieldResolution",
  linkedTaskIds: "changeFieldLinkedTasks", linkedRaidIds: "changeFieldLinkedRaid",
  stakeholderIds: "linkedStakeholders", localModifiedAt: "exportColLocalModifiedAt",
  knowledgeLinks: "documentLinks", outlookEventId: "exportColOutlookEventId",
  calendarOptOut: "exportColCalendarOptOut", noteLog: "noteLogTitle",
};

const STAKEHOLDER_LABELS: LabelsFor<typeof STAKEHOLDERS_CSV_COLUMNS> = {
  id: "id", name: "stakeholderFieldName", organization: "stakeholderFieldOrganization",
  title: "stakeholderFieldTitle", email: "stakeholderFieldEmail", category: "stakeholderFieldCategory",
  influence: "stakeholderFieldInfluence", interest: "stakeholderFieldInterest", notes: "stakeholderFieldNotes",
  resourceId: "stakeholderFieldResource", raci: "raci", localModifiedAt: "exportColLocalModifiedAt",
  knowledgeLinks: "documentLinks",
};

const BUDGET_LABELS: LabelsFor<typeof BUDGETS_CSV_COLUMNS> = {
  id: "id", name: "name", poNumber: "budgetPoNumber", type: "budgetType", currency: "budgetCurrency",
  fixedPriceAmount: "budgetFixedPriceAmount", startDate: "budgetStartDate", endDate: "budgetEndDate",
  successorId: "budgetSuccessor", status: "status", closedDate: "fieldClosedDate", createdDate: "colCreatedDate",
  fxRateOverride: "budgetFxOverride", allocations: "budgetAllocations", localModifiedAt: "exportColLocalModifiedAt",
  order: "exportColOrder", planningMode: "exportColPlanningMode",
  disciplineAllocations: "exportColDisciplineAllocations", rateOverrideInternal: "budgetRateOverrideInternal",
  rateOverrideExternal: "budgetRateOverrideExternal", taskIds: "budgetLinkedTasks",
  percentComplete: "budgetPercentComplete",
};

const RESOURCE_LABELS: LabelsFor<typeof RESOURCES_CSV_COLUMNS> = {
  id: "id", firstName: "resourceFirstName", lastName: "resourceLastName", title: "resourceColTitle",
  businessPhone: "resourceColPhone", location: "resourceLocation", department: "resourceColDepartment",
  email: "email", company: "resourceCompany", birthday: "resourceColBirthday", notes: "resourceNotes",
  roleId: "role", utilizationMode: "exportColUtilizationMode", utilization: "utilization",
  absenceOverride: "exportColAbsenceOverride", active: "resourceActiveLabel",
  localModifiedAt: "exportColLocalModifiedAt", emails: "resourceEmailsLabel", isExternal: "resourceExternal",
};

const ROLE_LABELS: LabelsFor<typeof ROLES_CSV_COLUMNS> = {
  id: "id", disciplineId: "rolesDiscipline", gradeId: "rolesGrade", internalRate: "rolesInternalRate",
  externalRate: "rolesExternalRate", internalRateDay: "rolesInternalRateDay",
  externalRateDay: "rolesExternalRateDay", rateBasis: "rolesRateBasis",
  localModifiedAt: "exportColLocalModifiedAt", order: "exportColOrder",
};

const ABSENCE_LABELS: LabelsFor<typeof ABSENCES_CSV_COLUMNS> = {
  id: "id", assignee: "absenceAssignee", assigneeEmail: "absenceAssigneeEmail", startDate: "absenceStart",
  endDate: "absenceEnd", type: "absenceType", note: "absenceNote", localModifiedAt: "exportColLocalModifiedAt",
  resourceId: "exportColResourceId", outlookEventId: "exportColOutlookEventId",
  calendarOptOut: "exportColCalendarOptOut",
};

/** ★ `SHIFTS_CSV_COLUMNS` is `readonly string[]`, so tsc cannot check this one
 *  is total — the label test does. */
const SHIFT_LABELS: Readonly<Record<string, TranslationKey>> = {
  id: "id", assignee: "shiftAssignee", assigneeEmail: "shiftAssigneeEmail", resourceId: "exportColResourceId",
  sunHours: "shiftDaySun", monHours: "shiftDayMon", tueHours: "shiftDayTue", wedHours: "shiftDayWed",
  thuHours: "shiftDayThu", friHours: "shiftDayFri", satHours: "shiftDaySat", note: "shiftNote",
  localModifiedAt: "exportColLocalModifiedAt",
};

const KV_LABELS: LabelsFor<typeof KV_EXPORT_FIELDS> = { field: "exportColField", value: "exportColValue" };

export const EXPORT_COLUMN_LABEL_KEYS: Readonly<Record<ExportSectionKey, Readonly<Record<string, TranslationKey>>>> = {
  project: KV_LABELS,
  status: KV_LABELS,
  tasks: TASK_LABELS,
  raid: RAID_LABELS,
  milestones: MILESTONE_LABELS,
  changes: CHANGE_LABELS,
  stakeholders: STAKEHOLDER_LABELS,
  budgets: BUDGET_LABELS,
  resources: RESOURCE_LABELS,
  roles: ROLE_LABELS,
  absences: ABSENCE_LABELS,
  shifts: SHIFT_LABELS,
  knowledgeItems: {
    name: "documentsManualName", type: "documentsManualKind", url: "exportColUrl", tasks: "knowledgeLinkedTasks",
  } satisfies LabelsFor<typeof KNOWLEDGE_EXPORT_FIELDS>,
  insights: {
    type: "type", severity: "exportColSeverity", status: "status", data: "exportColDetails",
    occurrences: "exportColOccurrences", lastSeen: "exportColLastSeen",
  } satisfies LabelsFor<typeof INSIGHT_EXPORT_FIELDS>,
  calendarEvents: {
    title: "title", "first occurrence": "calendarEventFirstOccurrence", recurs: "calendarEventRepeat",
    location: "calendarEventLocation",
  } satisfies LabelsFor<typeof CALENDAR_EVENT_EXPORT_FIELDS>,
};

/** §304 — every section heading. Six were English literals ("Budgets",
 *  "Roles", "Absences", "Shifts", "Project Status", "Insights"); they reuse the
 *  Settings → Export labels. */
export const EXPORT_SECTION_TITLE_KEYS: Readonly<Record<ExportSectionKey, TranslationKey>> = {
  project: "exportLabelProject", tasks: "tasks", raid: "tabRaid", changes: "navChanges",
  milestones: "navMilestones", stakeholders: "navStakeholders", budgets: "exportLabelBudgets",
  resources: "tabResources", roles: "exportLabelRoles", absences: "exportLabelAbsences",
  shifts: "exportLabelShifts", calendarEvents: "exportLabelCalendarEvents", status: "exportLabelStatus",
  knowledgeItems: "exportLabelKnowledgeItems", insights: "exportLabelInsights",
};

/** §304 — the status section's FIRST COLUMN names a ProjectStatus field, one
 *  per row; the dashboard's own override labels name them. */
export const STATUS_ROW_LABEL_KEYS: Readonly<Record<string, TranslationKey>> = {
  ragOverride: "dashboardOverall", scheduleOverride: "dashboardSubSchedule",
  budgetOverride: "dashboardSubBudget", scopeOverride: "dashboardSubScope",
  narrative: "exportColNarrative", narrativeUpdatedAt: "exportColNarrativeUpdatedAt",
};

/** The header label for one field of one section. An unmapped field falls back
 *  to its raw key — the label test fails on every such fallback, so this is a
 *  visible gap, never a silent one. */
export function exportColumnLabel(section: ExportSectionKey, field: string, lang: Lang): string {
  const key: TranslationKey | undefined = EXPORT_COLUMN_LABEL_KEYS[section][field];
  return key === undefined ? field : t(lang, key);
}

export function exportColumnLabels(section: ExportSectionKey, fields: readonly string[], lang: Lang): string[] {
  return fields.map((f) => exportColumnLabel(section, f, lang));
}
```
If `tsc` rejects `import type { CSV_COLUMNS … }` because `./storage` re-exports them as values only through a barrel, import the same names from `./csv-codecs-core` (where they are declared).

- [ ] **Step 5: Wire the builders.** In `src/app/export-sections.ts`:
  - Import `{ KV_EXPORT_FIELDS, KNOWLEDGE_EXPORT_FIELDS, INSIGHT_EXPORT_FIELDS, CALENDAR_EVENT_EXPORT_FIELDS, EXPORT_SECTION_TITLE_KEYS, STATUS_ROW_LABEL_KEYS, exportColumnLabels } from "./export-column-labels";`.
  - Right after `export const RAID_EXPORT_COLUMNS = …;` add:
    ```ts
    /** §304 — the FIELD each header column carries, in order, per section. The
     *  builders map rows by these; `columns` prints their labels. */
    export const EXPORT_SECTION_FIELDS: Readonly<Record<ExportSectionKey, readonly string[]>> = {
      project: KV_EXPORT_FIELDS, status: KV_EXPORT_FIELDS, tasks: CSV_COLUMNS, raid: RAID_EXPORT_COLUMNS,
      milestones: MILESTONES_CSV_COLUMNS, changes: CHANGES_CSV_COLUMNS, stakeholders: STAKEHOLDERS_CSV_COLUMNS,
      budgets: BUDGETS_CSV_COLUMNS, resources: RESOURCES_CSV_COLUMNS, roles: ROLES_CSV_COLUMNS,
      absences: ABSENCES_CSV_COLUMNS, shifts: SHIFTS_CSV_COLUMNS, calendarEvents: CALENDAR_EVENT_EXPORT_FIELDS,
      knowledgeItems: KNOWLEDGE_EXPORT_FIELDS, insights: INSIGHT_EXPORT_FIELDS,
    };

    /** The translated header row and heading for `key`. */
    function heading(key: ExportSectionKey, lang: Lang): { title: string; columns: string[] } {
      return { title: t(lang, EXPORT_SECTION_TITLE_KEYS[key]), columns: exportColumnLabels(key, EXPORT_SECTION_FIELDS[key], lang) };
    }
    ```
    (`tasksSection` is declared ABOVE `RAID_EXPORT_COLUMNS`; that is fine — builders run long after module init.)
  - In each of the ten column-constant builders delete the `const columns = … as unknown as string[];` line and return `{ key: "<k>", ...heading("<k>", lang), rows }`. Add a `lang: Lang` parameter to `budgetsSection`, `rolesSection`, `absencesSection`, `shiftsSection`.
  - `projectSection`: `return { key: "project", ...heading("project", lang), rows };`
  - `statusSection(status: ProjectStatus, lang: Lang)`: in the `.map`, `return [STATUS_ROW_LABEL_KEYS[field] ? t(lang, STATUS_ROW_LABEL_KEYS[field]) : field, val];` (and the `comma < 0` branch the same way), then `return { key: "status", ...heading("status", lang), rows };`.
  - `knowledgeItemsSection`: `return { key: "knowledgeItems", ...heading("knowledgeItems", lang), rows };`
  - `insightsSection(insights, lang: Lang)`: `return { key: "insights", ...heading("insights", lang), rows };` and delete the "English-only builder (consistent with budgets/roles/absences)" comment's first clause.
  - `calendarEventsSection`: `return { key: "calendarEvents", ...heading("calendarEvents", lang), rows };`
  - `BUILDERS`: pass `lang` to `budgetsSection`, `rolesSection`, `absencesSection`, `shiftsSection`, `insightsSection`, `statusSection`.

- [ ] **Step 6: Run the new test green (under the lock)** (Step 2 command) → EXIT=0.

- [ ] **Step 7: MIGRATE the assertions that read raw keys.** Import `exportColumnLabel` / `exportColumnLabels` from `./export-column-labels` and `t` from `./i18n` where missing.
  - `export-sections.test.ts`: `expect(milSec.columns).toEqual(MILESTONES_CSV_COLUMNS)` → `…toEqual(exportColumnLabels("milestones", MILESTONES_CSV_COLUMNS, "en-US"))`; `expect(taskSec.columns).toEqual(CSV_COLUMNS)` → `exportColumnLabels("tasks", CSV_COLUMNS, "en-US")`; `expect(raidSec.columns).toEqual(RAID_EXPORT_COLUMNS)` → `exportColumnLabels("raid", RAID_EXPORT_COLUMNS, "en-US")`; `expect(raidSec.columns).not.toContain("escalations")` → `expect(RAID_EXPORT_COLUMNS).not.toContain("escalations"); expect(raidSec.columns).toHaveLength(RAID_EXPORT_COLUMNS.length);`; the calendar test's `toEqual(["title", "first occurrence", "recurs", "location"])` → `toEqual(["Title", "First occurrence", "Repeat", "Location"])`; every `columns.indexOf("description")`, `indexOf("taskName")`, `indexOf("noteLog")` → `indexOf(exportColumnLabel("<section>", "<field>", "en-US"))` with the section the surrounding code uses (`"tasks"` / `"raid"` / the loop's `key`); the rich-set loop's `section.columns.indexOf(name)` → `section.columns.indexOf(exportColumnLabel(key, name, "en-US"))`. Re-find with `grep -n "columns" src/app/export-sections.test.ts`.
  - `export-sections.rich.property.test.ts` `cellFor`: `found!.columns.indexOf(column)` → `found!.columns.indexOf(exportColumnLabel(section, column, "en-US"))`.
  - `doc-data-section.test.ts`: `indexOf("title")` / `indexOf("description")` → `indexOf(exportColumnLabel("raid", "title", "en-US"))` / `indexOf(exportColumnLabel("raid", "description", "en-US"))`.
  - `export-sections.project.test.ts`: `toBe("field")` / `toBe("value")` → `toBe(t("en-US", "exportColField"))` / `toBe(t("en-US", "exportColValue"))`; the test title "(field + value)" stays.
  - `export.test.ts`: `expect(html).toContain("Project Status")` and its comment → `expect(html).toContain(t("en-US", "exportLabelStatus"))` / "// Status section heading (§304: `exportLabelStatus`)"; `toContain("<th>description</th>")` → `toContain(\`<th>${t("en-US", "description")}</th>\`)`; `toContain("<th>taskName</th>")` → `toContain(\`<th>${t("en-US", "task")}</th>\`)`; the ★ comment "The section header row emits the raw CSV column KEYS" → "The header row prints each column's display label (§304), so asserting the `<th>` still proves the column under test is real."
  - Then run all export tests (Step 8) and fix any further `columns`-by-raw-key read the same way.

- [ ] **Step 8: Run green (under the lock).** `npx vitest run src/app/export-column-labels.test.ts src/app/export-sections.test.ts src/app/export-sections.project.test.ts src/app/export-sections.rich.property.test.ts src/app/doc-data-section.test.ts src/app/export.test.ts src/app/export-ooxml.test.ts src/app/doc-render-html.test.ts src/app/doc-render-docx.test.ts src/app/doc-render-pptx.test.ts src/app/golden-workspace.test.ts > $SCRATCH/t7.log 2>&1; echo "EXIT=$?"` → EXIT=0, `Test Files 11 passed (11)`. `golden-workspace.test.ts` green with no fixture change proves CSV/Markdown bytes are unchanged; `git status --short src/app/__fixtures__` must print nothing.

- [ ] **Step 9: Mutants.**
  - M1: `raid: RAID_LABELS` → `raid: {}` in `EXPORT_COLUMN_LABEL_KEYS` → label test red, EN and DE (`raid.id has no label key`).
  - M2: `heading()` returns `columns: [...EXPORT_SECTION_FIELDS[key]]` → label test red on every section.
  - M3: `budgetsSection` title back to `"Budgets"` → title test red in DE (`expected 'Budgets' to be 'Budget'`) — and in EN too (`exportLabelBudgets` is "Budget").
  - M4: `statusSection` rows back to the raw `field` → status-rows test red.
  - M5: `SHIFT_LABELS` loses `satHours` → label test red (`shifts.satHours has no label key`), the only guard for that untyped map.

- [ ] **Step 10:** `npx tsc --noEmit` → 0; `npx eslint --max-warnings=0 src` → 0; `npm run size:check` → 0 (`export-sections.ts` grows by ~20 lines, well under 1600).

- [ ] **Step 11: Register (§304).** Close it; record the six titles, the minutes exception, that XLSX gets labels (spec decision), and that documents' data sections now carry labels too. Delete `**Work item:** #229`; index row.

- [ ] **Step 12: Commit.** `fix: translate export column headers and section titles (§304)`; `git commit --only src/app/export-column-labels.ts src/app/export-column-labels.test.ts src/app/export-sections.ts src/app/i18n.ts src/app/i18n.de.ts src/app/export-sections.test.ts src/app/export-sections.project.test.ts src/app/export-sections.rich.property.test.ts src/app/doc-data-section.test.ts src/app/export.test.ts docs/open-followups.md -F $SCRATCH/msg7.txt`.

---

### Task 8: #235 / §320 — a policy-refused image is disclosed as refused, not missing

**Files:**
- Create: `src/app/asset-export-placeholder.ts`, `src/app/asset-export-placeholder.test.ts`
- Modify: `src/app/document-export-assets.ts` (`ExportAssets`, `NO_EXPORT_ASSETS`, `loadExportAssets`)
- Modify: `src/app/document-download.ts` (`assetPolicy`, `assetsFor`)
- Modify: `src/app/doc-render-html.ts` (`inlineDocumentImages`, the standalone stylesheet next to `img[data-asset-missing]`)
- Modify: `src/app/doc-render-docx.ts`, `src/app/doc-render-pptx.ts` (`withImagePlaceholders`)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (one key after `assetExportPlaceholder`)
- Test: `src/app/document-export-assets.test.ts`, `src/app/document-download.test.ts`, `src/app/doc-render-html.test.ts`, `src/app/doc-render-docx.test.ts`, `src/app/doc-render-pptx.test.ts`
- MIGRATE: 17 `ExportAssets` literals (`grep -rn "missing: new Set" src/app --include=*.test.ts --include=*.test.tsx`: `doc-render-html.test.ts` 12, `doc-render-docx.test.ts` 2, `doc-render-pptx.test.ts` 2, `doc-render-pptx-slides.test.ts` 1) and two sink tests in `doc-render-html.test.ts`
- Modify: `docs/AGENTS/documents.md` ("The three-bucket contract"), `docs/open-followups.md` (§320 → closed)

**Interfaces:**
- Produces: `ExportAssets.blocked: ReadonlySet<string>`; `loadExportAssets(doc, load, budgetBytes?, isRenderable?, isBlocked?: (id: string) => boolean)`; `assetExportPlaceholder(id: string, byId: ReadonlyMap<string, DocumentAsset>, lang: Lang): string`. i18n key `assetExportBlocked`.
- Consumes: `isBlockedAssetMime` (`document-asset-upload.ts`) — the existing single spelling of "refused".

- [ ] **Step 1: Write the failing tests.**

`src/app/document-export-assets.test.ts`:
```ts
  // §320 — bytes present, type refused: a THIRD state. It is never charged
  //  against the budget (the ★ above the isRenderable branch stays right) and
  //  never called missing, which told the reader the data was gone.
  it("routes a policy-refused id to blocked, off the budget and out of missing", async () => {
    const load = vi.fn(async () => b64OfBytes(60));
    const out = await loadExportAssets(
      doc([`<p><img data-asset-id="svg"><img data-asset-id="good"></p>`]),
      load, 100, () => true, (id) => id === "svg",
    );
    expect([...out.blocked]).toEqual(["svg"]);
    expect([...out.missing]).toEqual([]);
    expect(Object.keys(out.inlined)).toEqual(["good"]); // 60 of 100: the refused 60 was not charged
    expect([...out.omitted]).toEqual([]);
  });

  it("still calls an id with no byte row missing, whatever its type", async () => {
    const out = await loadExportAssets(doc([`<p><img data-asset-id="x"></p>`]), vi.fn(async () => null), undefined, undefined, () => true);
    expect([...out.missing]).toEqual(["x"]);
    expect([...out.blocked]).toEqual([]);
  });
```

`src/app/document-download.test.ts` (next to "declines a mime outside the upload allowlist on the inline sinks"):
```ts
  it("hands every format a blocked predicate built from the stored mime (§320)", async () => {
    const wsSvg: Workspace = {
      ...ws,
      documentAssets: [{ ...wsWithSizedAsset.documentAssets![0], mime: "image/svg+xml" }],
    };
    for (const format of ["html", "pdf", "docx", "pptx"] as const) {
      vi.mocked(loadExportAssets).mockClear();
      await downloadDocument(docWithImage(), format, wsSvg, "en-US", async () => PNG_B64);
      const isBlocked = loadArgs()[4];
      expect(isBlocked!(ASSET_ID), format).toBe(true);
      expect(isBlocked!("no-such-asset"), format).toBe(false); // no metadata = missing, not blocked
      vi.mocked(loadExportAssets).mockClear();
      await downloadDocument(docWithImage(), format, wsWithSizedAsset, "en-US", async () => PNG_B64);
      expect(loadArgs()[4]!(ASSET_ID), format).toBe(false);
    }
  });
```
(`loadArgs` is the file's existing helper; if it is typed as a 4-tuple, widen its return type to include the 5th argument.)

`src/app/doc-render-html.test.ts`, inside "renderDocumentHtml — S3c-1 image inlining is validated at the SINK" (add a sibling helper beside `renderedImg`):
```ts
  /** The standalone body, parsed. */
  function renderedBody(mime: string, data: string, name = "a1.png"): HTMLElement {
    const wsWithAsset = { ...ws, documentAssets: [{ ...assetMeta("a1", mime), name }] } as Workspace;
    const html = renderDocumentHtml(doc([...withImage]), wsWithAsset, "en-US", "standalone",
      { inlined: { a1: data }, omitted: new Set(), missing: new Set(), blocked: new Set() });
    const host = document.createElement("div");
    host.innerHTML = html.slice(html.indexOf("<body>") + "<body>".length);
    return host;
  }

  // §320 — even when the caller classified nothing (the id sits in `inlined`),
  //  a stored mime outside the allowlist is REFUSED, and the reader is told so.
  it("renders the blocked placeholder for image/svg+xml instead of a missing box", () => {
    const body = renderedBody("image/svg+xml", "QUJD", "diagram.svg");
    const span = body.querySelector("span[data-asset-blocked]");
    expect(span?.textContent).toBe(t("en-US", "assetExportBlocked", "diagram.svg"));
    expect(body.querySelector("img[data-asset-id]")).toBeNull();
    expect(body.innerHTML).not.toContain("data:image/svg");
  });

  it("renders the blocked placeholder from the blocked bucket too", () => {
    const wsWithAsset = { ...ws, documentAssets: [assetMeta("a1", "image/png")] } as Workspace;
    const html = renderDocumentHtml(doc([...withImage]), wsWithAsset, "en-US", "standalone",
      { inlined: {}, omitted: new Set(), missing: new Set(), blocked: new Set(["a1"]) });
    expect(html).toContain('data-asset-blocked="true"');
    expect(html).not.toContain('data-asset-missing="true"');
  });

  it("ships a stylesheet rule for the blocked placeholder", () => {
    const html = renderDocumentHtml(doc([...withImage]), ws, "en-US", "standalone");
    expect(html).toContain("span[data-asset-blocked]");
  });
```

`src/app/doc-render-docx.test.ts` and `src/app/doc-render-pptx.test.ts`, in the describe holding "replaces an <img data-asset-id> with a translated placeholder naming the asset":
`doc-render-docx.test.ts`:
```ts
  it("says the file type was refused, not the generic placeholder, for a blocked mime (§320)", async () => {
    const wsWithAsset = { ...ws, documentAssets: [{ ...assetMeta("a1", "diagram.svg"), mime: "image/svg+xml" }] } as Workspace;
    const [d, w] = docWithImage('<p><img data-asset-id="a1"></p>', wsWithAsset);
    const text = await textOf(d, w);
    expect(text).toContain(t("en-US", "assetExportBlocked", "diagram.svg"));
    expect(text).not.toContain(t("en-US", "assetExportPlaceholder", "diagram.svg"));
  });
```
`doc-render-pptx.test.ts` (its `textOf` takes the HTML directly):
```ts
  it("says the file type was refused, not the generic placeholder, for a blocked mime (§320)", async () => {
    const wsWithAsset = { ...ws, documentAssets: [{ ...assetMeta("a1", "diagram.svg"), mime: "image/svg+xml" }] } as Workspace;
    const text = await textOf('<p><img data-asset-id="a1"></p>', wsWithAsset);
    expect(text).toContain(t("en-US", "assetExportBlocked", "diagram.svg"));
    expect(text).not.toContain(t("en-US", "assetExportPlaceholder", "diagram.svg"));
  });
```

`src/app/asset-export-placeholder.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { assetExportPlaceholder } from "./asset-export-placeholder";
import type { DocumentAsset } from "./document-asset";
import { t } from "./i18n";

const meta = (id: string, name: string, mime: string): DocumentAsset =>
  ({ id, name, mime, size: 3, hash: "h", createdAt: "2026-08-06T00:00:00.000Z" });

describe("assetExportPlaceholder (§320)", () => {
  it("names a refused type, a normal image, and a dangling id differently", () => {
    const byId = new Map([
      ["svg", meta("svg", "d.svg", "image/svg+xml")],
      ["png", meta("png", "p.png", "image/png")],
      ["blank", meta("blank", "b", "")],
    ]);
    expect(assetExportPlaceholder("svg", byId, "en-US")).toBe(t("en-US", "assetExportBlocked", "d.svg"));
    expect(assetExportPlaceholder("png", byId, "en-US")).toBe(t("en-US", "assetExportPlaceholder", "p.png"));
    // §225 — an EMPTY mime is not refused; it renders by sniffing in the preview.
    expect(assetExportPlaceholder("blank", byId, "en-US")).toBe(t("en-US", "assetExportPlaceholder", "b"));
    expect(assetExportPlaceholder("gone", byId, "en-US")).toBe(t("en-US", "assetExportPlaceholder", "gone"));
  });
});
```

- [ ] **Step 2: Run (under the lock).** `npx vitest run src/app/asset-export-placeholder.test.ts src/app/document-export-assets.test.ts src/app/document-download.test.ts src/app/doc-render-html.test.ts src/app/doc-render-docx.test.ts src/app/doc-render-pptx.test.ts > $SCRATCH/t8.log 2>&1; echo "EXIT=$?"` → EXIT=1: unresolved `./asset-export-placeholder`; `out.blocked` is `undefined` (`… is not iterable`); `loadArgs()[4]` undefined; no `span[data-asset-blocked]`; the docx/pptx text holds `[Image: diagram.svg]`.

- [ ] **Step 3: i18n.** `$SCRATCH/t8-en.json`: `["  assetExportBlocked: \"[Image not shown — file type not allowed: {0}]\","]`; `$SCRATCH/t8-de.json`: `["  assetExportBlocked: \"[Bild nicht angezeigt – Dateityp nicht erlaubt: {0}]\","]`; insert both after `assetExportPlaceholder`.

- [ ] **Step 4: Implement.**
  - `src/app/asset-export-placeholder.ts`:
    ```ts
    // src/app/asset-export-placeholder.ts — the text an export shows in place of
    // an image it does not embed (DOCX and PPTX; HTML/PDF use the same key).
    //
    // ★★ §320 — a refused TYPE is not a missing image. `isBlockedAssetMime` is the
    //  one spelling of "this stored mime is refused" (§230/§225: an EMPTY mime is
    //  not refused), so a policy refusal says so, and every other reason keeps
    //  the neutral "[Image: name]".
    import type { DocumentAsset } from "./document-asset";
    import { isBlockedAssetMime } from "./document-asset-upload";
    import { t, type Lang } from "./i18n";

    export function assetExportPlaceholder(id: string, byId: ReadonlyMap<string, DocumentAsset>, lang: Lang): string {
      const meta = byId.get(id);
      const key = isBlockedAssetMime(meta?.mime) ? "assetExportBlocked" : "assetExportPlaceholder";
      return t(lang, key, meta?.name ?? id);
    }
    ```
  - `document-export-assets.ts`: add to `ExportAssets` after `missing`:
    ```ts
      /** Bytes exist and are intact, but the stored type is outside the upload
       *  allowlist (`isBlockedAssetMime`). A POLICY refusal (§320): never charged
       *  against the budget, and never reported as missing. */
      blocked: ReadonlySet<string>;
    ```
    `NO_EXPORT_ASSETS` gains `blocked: new Set<string>(),`. `loadExportAssets` gains a fifth parameter after `isRenderable`:
    ```ts
      /** §320 — asked AFTER the null-row check and BEFORE `isRenderable` and the
       *  budget: an id refused by TYPE lands in `blocked`, never `missing`, and is
       *  never charged. */
      isBlocked?: (id: string) => boolean,
    ```
    add `const blocked = new Set<string>();`, and between the `b64 === null` branch and the `isRenderable` branch:
    ```ts
        if (isBlocked && isBlocked(id)) {
          blocked.add(id);
          continue;
        }
    ```
    and `return { inlined, omitted, missing, blocked };`. Update the file header's "THE SPLIT INTO THREE BUCKETS" to "FOUR BUCKETS" and add one line: `"blocked" (the bytes exist, the type is refused — §320).`
  - `document-download.ts`: `import { isBlockedAssetMime } from "./document-asset-upload";` (next to `isAllowedAssetMime`). `assetPolicy`'s return type becomes `{ budgetBytes: number; isRenderable?: (id: string) => boolean; isBlocked: (id: string) => boolean }`; right after `byId` is built: `const isBlocked = (id: string) => isBlockedAssetMime(byId.get(id)?.mime); // §320 — same rule for every format`; add `isBlocked,` to BOTH returned objects. In `assetsFor`: `const { budgetBytes, isRenderable, isBlocked } = assetPolicy(format, ws); return loadExportAssets(doc, load, budgetBytes, isRenderable, isBlocked);`.
  - `doc-render-html.ts` `inlineDocumentImages`, as the FIRST check in the replace callback:
    ```ts
        // §320 — refused by TYPE, bytes intact. Checked from the bucket AND the
        //  stored mime, because `assetSrcAttr` refused a disallowed mime on its
        //  own and fell through to the missing marker: both sites said "gone".
        //  The name is escaped here exactly as for `omitted` below.
        if (assets.blocked.has(id) || isBlockedAssetMime(mimeById.get(id))) {
          return `<span data-asset-blocked="true">${htmlEscape(t(lang, "assetExportBlocked", nameById.get(id) ?? id))}</span>`;
        }
    ```
    (import `isBlockedAssetMime` beside `isAllowedAssetMime`). In the standalone stylesheet, after the `img[data-asset-missing] { … }` rule, add (keep the comment free of angle-bracketed tag names):
    ```css
        /* §320 — an image whose type the upload policy refuses. Text, not an
           empty box: the bytes exist, so "missing" would be false. Palette-safe:
           currentColor only. */
        span[data-asset-blocked] {
          display: inline-block;
          padding: 0.25rem 0.5rem;
          border: 1px dotted currentColor;
          font-size: 0.85em;
        }
    ```
  - `doc-render-docx.ts` and `doc-render-pptx.ts` `withImagePlaceholders`: body becomes `return html.replace(IMG_TAG_ASSET_ID_RE, (_tag, id: string) => htmlEscape(assetExportPlaceholder(id, byId, lang)));` with `import { assetExportPlaceholder } from "./asset-export-placeholder";`. Output is byte-identical for every non-blocked image.

- [ ] **Step 5: MIGRATE.** Add `blocked: new Set()` to each of the 17 `ExportAssets` literals (tsc lists any missed: `npx tsc --noEmit`). In `doc-render-html.test.ts` rewrite two sink tests whose premise changed:
  - "falls through to data-asset-missing for a quote-injection mime, minting no event handler" → rename "refuses a quote-injection mime as blocked, minting no event handler (§320)" and assert on `renderedBody(hostile, "QUJD")`: `expect(body.querySelector("[onerror]")).toBeNull(); expect(body.querySelector("span[data-asset-blocked]")).not.toBeNull(); expect(body.querySelector("img[data-asset-id]")).toBeNull();`.
  - "falls through for image/svg+xml — escaping alone would still leave an XSS surface" → DELETE (superseded by "renders the blocked placeholder for image/svg+xml instead of a missing box", which asserts no `data:image/svg` anywhere).
  - The non-base64 test ("falls through when data is not base64") keeps its `data-asset-missing` expectation: its mime is allowed, so it is still a data problem.

- [ ] **Step 6: Run green (under the lock)** — Step 2 command plus `src/app/doc-render-pptx-slides.test.ts src/app/document-preview.test.tsx src/app/ooxml-docx-primitives.test.ts src/app/ooxml-pptx-primitives.test.ts` → EXIT=0, `Test Files 10 passed (10)`.

- [ ] **Step 7: Mutants.**
  - M1: in `loadExportAssets`, `blocked.add(id)` → `missing.add(id)` → the bucket test red (`expected [ 'svg' ] … []`).
  - M2: move the `isBlocked` check BELOW the budget arithmetic → "routes a policy-refused id to blocked, off the budget" red (`good` pushed to `omitted`).
  - M3: drop `|| isBlockedAssetMime(mimeById.get(id))` in `inlineDocumentImages` → the svg sink test red (img with `data-asset-missing`).
  - M4: `assetExportPlaceholder` always uses `"assetExportPlaceholder"` → the docx/pptx blocked tests and the helper test red.
  - M5: `isBlockedAssetMime` → `!isAllowedAssetMime` inside `assetExportPlaceholder` → helper test red on the empty-mime row (§225).

- [ ] **Step 8: Docs.** In `docs/AGENTS/documents.md` "The three-bucket contract": rename the heading to "The four-bucket contract"; the signature line becomes `loadExportAssets(doc, load, budgetBytes?, isRenderable?, isBlocked?)` returns `{inlined, omitted, missing, blocked}`; replace the paragraph beginning "★★★ **AND `missing` ABSORBING POLICY IS A DISCLOSURE DEFECT…" with one stating that `blocked` (bytes present, type refused by `isBlockedAssetMime`) is asked after the null-row check and before `isRenderable` and the budget, that HTML/PDF render a `span[data-asset-blocked]` text placeholder (`assetExportBlocked`) from the bucket OR the stored mime, and that DOCX/PPTX choose the same text through `assetExportPlaceholder` — §320. `npm run docs:symbols:check` → EXIT=0.

- [ ] **Step 9:** `npx tsc --noEmit` → 0; `npx eslint --max-warnings=0 src` → 0.

- [ ] **Step 10: Register (§320).** Close it; both sites (bucket and `assetSrcAttr`'s fall-through) are closed, and the OOXML half (a refused image looked like a budget omission) is fixed in the same change. Delete `**Work item:** #235`; index row.

- [ ] **Step 11: Commit.** `fix: tell the reader an export image was refused by type, not missing (§320)`; `git commit --only src/app/asset-export-placeholder.ts src/app/asset-export-placeholder.test.ts src/app/document-export-assets.ts src/app/document-export-assets.test.ts src/app/document-download.ts src/app/document-download.test.ts src/app/doc-render-html.ts src/app/doc-render-html.test.ts src/app/doc-render-docx.ts src/app/doc-render-docx.test.ts src/app/doc-render-pptx.ts src/app/doc-render-pptx.test.ts src/app/doc-render-pptx-slides.test.ts src/app/i18n.ts src/app/i18n.de.ts docs/AGENTS/documents.md docs/open-followups.md -F $SCRATCH/msg8.txt`.

---

### Task 9: #174 / §185 — an over-long paragraph is counted, and refused instead of flattened

**Files:**
- Modify: `src/app/document-block-notices.tsx` (`BlockRefusal`, `BlockRefusalNotice`, new `ParagraphCharCount`, `PARAGRAPH_COUNT_FROM`)
- Modify: `src/app/document-block-editors.tsx` (`useBlockDraft`'s `tryCommit` and `commit`; `ParagraphEditorBody`)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (two keys after `documentsBlockConflictNotSaved`)
- Test: `src/app/document-block-editors.test.tsx` (new describe)
- Modify: `docs/AGENTS/documents.md` (the sentence recording that an over-cap paragraph "came back with every mark flattened"), `docs/open-followups.md` (§185 → closed)

**Interfaces:**
- Produces: `type BlockRefusal = "empty" | "conflict" | { readonly kind: "tooLong"; readonly excess: number }`; `PARAGRAPH_COUNT_FROM = 18_000` (`Math.floor(MAX_HTML_TEXT_CHARS * 0.9)`); `ParagraphCharCount({ lang, visible })`; i18n `documentsParagraphCharCount`, `documentsBlockTooLongNotSaved`.

- [ ] **Step 1: Write the failing tests.** In `src/app/document-block-editors.test.tsx` add imports `import { MAX_HTML_TEXT_CHARS } from "./document-model";` (extend the existing import), `import { PARAGRAPH_COUNT_FROM } from "./document-block-notices";`, `import { htmlTextLength } from "./rich-text-plain";`, then:

```tsx
describe("ParagraphBlockEditor — the visible-character cap (§185)", () => {
  const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
  const bold = (n: number) => `<p><strong>${"a".repeat(n)}</strong></p>`;
  const countText = (n: number) => t(LANG, "documentsParagraphCharCount", fmt(n), fmt(MAX_HTML_TEXT_CHARS));

  it("shows no counter below 90% of the cap", async () => {
    render(<ParagraphBlockEditor lang={LANG} index={20} block={{ type: "paragraph", html: bold(PARAGRAPH_COUNT_FROM - 1) }} onCommit={vi.fn()} />);
    await findParagraphEditable(20);
    expect(screen.queryByText(countText(PARAGRAPH_COUNT_FROM - 1))).toBeNull();
  });

  it("shows the running count from exactly 90% of the cap", async () => {
    render(<ParagraphBlockEditor lang={LANG} index={21} block={{ type: "paragraph", html: bold(PARAGRAPH_COUNT_FROM) }} onCommit={vi.fn()} />);
    await findParagraphEditable(21);
    expect(screen.getByText(countText(PARAGRAPH_COUNT_FROM))).toBeInTheDocument();
  });

  it("refuses an over-cap commit with the notice, keeping the text and its formatting", async () => {
    const onCommit = vi.fn();
    render(<ParagraphBlockEditor lang={LANG} index={22} block={{ type: "paragraph", html: bold(MAX_HTML_TEXT_CHARS - 1) }} onCommit={onCommit} />);
    const editable = await findParagraphEditable(22);
    editable.focus();
    await userEvent.type(editable, "bc");
    editable.blur();
    expect(onCommit).not.toHaveBeenCalled();
    expect(await screen.findByText(t(LANG, "documentsBlockTooLongNotSaved", "1", fmt(MAX_HTML_TEXT_CHARS)))).toBeInTheDocument();
    expect(editable.querySelector("strong")).not.toBeNull();
    expect(editable.textContent).toHaveLength(MAX_HTML_TEXT_CHARS + 1);
  });

  it("commits a paragraph that lands exactly on the cap, formatting intact", async () => {
    const onCommit = vi.fn();
    render(<ParagraphBlockEditor lang={LANG} index={23} block={{ type: "paragraph", html: bold(MAX_HTML_TEXT_CHARS - 1) }} onCommit={onCommit} />);
    const editable = await findParagraphEditable(23);
    editable.focus();
    await userEvent.type(editable, "b");
    editable.blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][1].html).toContain("<strong>");
  });

  // Review Focus 4 — narrowing the pane unmounts a non-selected row with no
  //  blur. The refused edit must not be LOST: the unmount flush still saves
  //  it, in today's flattened form (the one path with no UI to refuse on).
  it("still saves a refused over-cap edit, flattened, if the editor unmounts", async () => {
    const onCommit = vi.fn();
    const { unmount } = render(<ParagraphBlockEditor lang={LANG} index={24} block={{ type: "paragraph", html: bold(MAX_HTML_TEXT_CHARS - 1) }} onCommit={onCommit} />);
    const editable = await findParagraphEditable(24);
    editable.focus();
    await userEvent.type(editable, "bc");
    editable.blur();
    expect(onCommit).not.toHaveBeenCalled();
    unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);
    const html = onCommit.mock.calls[0][1].html as string;
    expect(html).not.toContain("<strong>");
    expect(htmlTextLength(html)).toBe(MAX_HTML_TEXT_CHARS);
  });
});
```

- [ ] **Step 2: Run (under the lock).** `npx vitest run src/app/document-block-editors.test.tsx > $SCRATCH/t9.log 2>&1; echo "EXIT=$?"` → EXIT=1: `PARAGRAPH_COUNT_FROM` is undefined (so `"a".repeat(NaN)` → the count tests fail to find the text), the refusal test sees `onCommit` called once (flattened today), and the unmount test sees 1 call at the blur, not 0.

- [ ] **Step 3: i18n.** `$SCRATCH/t9-en.json`:
```json
[
  "  documentsBlockTooLongNotSaved:",
  "    \"Not saved — this paragraph exceeds the {1}-character limit by {0}. Shorten it to save it; the text and its formatting stay here until you do.\",",
  "  documentsParagraphCharCount: \"{0} / {1} characters\","
]
```
`$SCRATCH/t9-de.json`:
```json
[
  "  documentsBlockTooLongNotSaved:",
  "    \"Nicht gespeichert – dieser Absatz überschreitet das Limit von {1} Zeichen um {0}. Zum Speichern kürzen; Text und Formatierung bleiben bis dahin hier erhalten.\",",
  "  documentsParagraphCharCount: \"{0} / {1} Zeichen\","
]
```
(Corrected 2026-09-26 during execution: the first draft used `{0}` twice; `t()` fills each placeholder once, so the second would have reached the user raw.) Insert both after `documentsBlockConflictNotSaved` (a two-line entry; the helper inserts after its value line).

- [ ] **Step 4: Implement the notice and the counter** in `src/app/document-block-notices.tsx`:
```tsx
import { MAX_HTML_TEXT_CHARS } from "./document-model";
import { t, localeFor, type Lang } from "./i18n";
```
Replace the `BlockRefusal` type and its doc's "TWO REASONS" note:
```tsx
/** Why `useBlockDraft` refused the last commit. `null` = it did not.
 *
 * ★★ THREE REASONS, ONE STATE, mutually exclusive by construction — `tryCommit`
 *  returns on the first that fires. `tooLong` (§185) carries how many visible
 *  characters are over the cap, because "shorten it" with no number is not
 *  actionable at 20 000 characters. */
export type BlockRefusal = "empty" | "conflict" | { readonly kind: "tooLong"; readonly excess: number };

const formatCount = (n: number, lang: Lang): string => new Intl.NumberFormat(localeFor(lang)).format(n);
```
`BlockRefusalNotice` body:
```tsx
  const text = typeof refusal === "object"
    ? t(lang, "documentsBlockTooLongNotSaved", formatCount(refusal.excess, lang), formatCount(MAX_HTML_TEXT_CHARS, lang))
    : t(lang, refusal === "empty" ? "documentsBlockEmptyNotSaved" : "documentsBlockConflictNotSaved");
  return (
    <p role="status" className="text-xs text-ui-pink-strong">
      {text}
    </p>
  );
```
New exports at file end:
```tsx
/** §185 — the counter appears from 90% of the paragraph cap. */
export const PARAGRAPH_COUNT_FROM = Math.floor(MAX_HTML_TEXT_CHARS * 0.9);

/** §185 — a paragraph's VISIBLE-character count against the cap (the same
 *  measure `capHtmlText` uses, never html.length), shown from 90% so going over
 *  is a choice rather than a surprise. Plain text, not a live region: announcing
 *  every keystroke would drown the editor; the refusal notice is the live one. */
export function ParagraphCharCount({ lang, visible }: { lang: Lang; visible: number }) {
  if (visible < PARAGRAPH_COUNT_FROM) return null;
  const over = visible > MAX_HTML_TEXT_CHARS;
  return (
    <p className={`text-xs tabular-nums ${over ? "text-ui-pink-strong" : "text-muted-foreground"}`}>
      {t(lang, "documentsParagraphCharCount", formatCount(visible, lang), formatCount(MAX_HTML_TEXT_CHARS, lang))}
    </p>
  );
}
```

- [ ] **Step 5: Implement the refusal** in `src/app/document-block-editors.tsx`. Imports: `import { BlockReadOnlyNotice, BlockRefusalNotice, ParagraphCharCount, type BlockRefusal } from "./document-block-notices";`, `import { MAX_HTML_TEXT_CHARS } from "./document-model";`, `import { htmlTextLength } from "./rich-text-plain";`. Add, above `useBlockDraft`:
```ts
/** §185 — a paragraph whose VISIBLE text is over the cap. Refused on the
 *  interactive commit path instead of being flattened by `capHtmlText`. */
function paragraphOverCap(block: DocBlock): block is Extract<DocBlock, { type: "paragraph" }> {
  return block.type === "paragraph" && exceedsStorageCaps(block);
}
```
In `tryCommit`, before `const next = normalizeBlockForStorage(raw);`:
```ts
    // ★★★ §185 — REFUSE, NEVER FLATTEN, an over-cap paragraph here. The
    //  normaliser would cap it through `capHtmlText`, whose overflow branch drops
    //  every mark; refusing keeps the text AND its formatting on screen, and the
    //  notice says how much to cut. Only the interactive path can refuse: the
    //  unmount flush below cannot render a notice, so it keeps today's fallback.
    if (paragraphOverCap(raw)) {
      setRefusal({ kind: "tooLong", excess: htmlTextLength(raw.html) - MAX_HTML_TEXT_CHARS });
      return false;
    }
```
In `commit`:
```ts
  const commit = () => {
    if (!dirtyRef.current) return;
    const raw = toBlock(liveValueRef.current);
    tryCommit(raw);
    // ★★ §185 — a refused over-cap paragraph STAYS DIRTY: the edit is not
    //  saved yet, and a pane that unmounts it without a blur must still reach
    //  the unmount flush, which saves the flattened form rather than dropping
    //  the edit. Every other outcome clears the flag exactly as before.
    if (paragraphOverCap(raw)) return;
    markDirty(false);
  };
```
In `ParagraphEditorBody`, after the `<RichTextEditor … />` element and before `{refusal && …}`:
```tsx
      <ParagraphCharCount lang={lang} visible={htmlTextLength(html)} />
```
Update the ★★★ comment above `tryCommit` ("a paragraph over MAX_HTML_TEXT_CHARS came back with every mark flattened to plain text") to add: "— the interactive path now refuses that instead (§185); the unmount flush keeps the flattening as its last resort."

- [ ] **Step 6: Run green (under the lock).** `npx vitest run src/app/document-block-editors.test.tsx src/app/document-editor.test.tsx src/app/documents-panel.test.tsx > $SCRATCH/t9.log 2>&1; echo "EXIT=$?"` → EXIT=0 (use `ls` to confirm the two neighbour files exist and count them in `Test Files N passed`). Existing refusal tests that compare `refusal` to `"empty"`/`"conflict"` keep passing: those two remain strings.

- [ ] **Step 7: Mutants.**
  - M1: delete the `paragraphOverCap` early return in `tryCommit` → "refuses an over-cap commit" red (`onCommit` called once, html without `<strong>`).
  - M2: in `commit`, delete `if (paragraphOverCap(raw)) return;` → "still saves a refused over-cap edit … if the editor unmounts" red (`expected 1 call, received 0`).
  - M3: `ParagraphCharCount`'s `<` → `<=` → "from exactly 90%" red.
  - M4: `excess: htmlTextLength(raw.html) - MAX_HTML_TEXT_CHARS` → `excess: 0` → the refusal text assertion red (`… by 0`).

- [ ] **Step 8: Docs.** In `docs/AGENTS/documents.md`, where it records that a paragraph over `MAX_HTML_TEXT_CHARS` "came back with every mark flattened to plain text", append: "The block editor now shows a visible-character counter from 90% of the cap and REFUSES an over-cap commit with a notice (§185); only the unmount flush, which has no UI, still saves the flattened form. AI-written and imported text keep the old fallback." `npm run docs:symbols:check` → EXIT=0.

- [ ] **Step 9:** `npx tsc --noEmit` → 0; `npx eslint --max-warnings=0 src` → 0 (no `Date`/`setState` in render; `htmlTextLength` in render is a pure call).

- [ ] **Step 10: Register (§185).** Close it with option (a); record the unmount fallback (and that it is an owner decision), that §185's own "refusing makes the text unsaveable" objection is met by keeping the draft editable, and that AI/imported text keeps `capHtmlText`'s fallback (option (b) stays unbuilt). Delete `**Work item:** #174`; index row.

- [ ] **Step 11: Commit.** `fix: warn before and refuse an over-long document paragraph instead of flattening it (§185)`; `git commit --only src/app/document-block-notices.tsx src/app/document-block-editors.tsx src/app/document-block-editors.test.tsx src/app/i18n.ts src/app/i18n.de.ts docs/AGENTS/documents.md docs/open-followups.md -F $SCRATCH/msg9.txt`.

---

### Task 10: Whole-branch verification and PR

- [ ] **Step 1: Rebase if PR #429 has merged since.** `git fetch origin`; if `git show origin/main:docs/open-followups.md | grep -c "^## 61[78]\."` prints `2` and the branch is not yet on it: `git rebase origin/main` (clean tree). Resolve any register conflict by keeping both sides' entries.

- [ ] **Step 2: Static gates (no lock needed).** Each unpiped with `EXIT=0`: `npx tsc --noEmit`, `npx eslint --max-warnings=0 src`, `npm run desktop:typecheck`, `npm run size:check`, `npm run dup:check`, `npm run docs:symbols:check`, `npm run docs:claims:check`, `npm run followups:status:check`, `npm run followups:index:check`, `npm run followups:workitems:check`, `npm run version:check`.

- [ ] **Step 3: Line endings.** `git diff --name-only origin/main...HEAD -- src/app | xargs git ls-files --eol` — every pre-existing file shows `w/crlf`; the new files (`meta-slice-decode*.ts`, `export-workspace*.ts`, `export-column-labels*.ts`, `asset-export-placeholder*.ts`) may show `w/lf`. `git grep -I -l $'\xEF\xBB\xBF' -- src/app` prints nothing (no BOM).

- [ ] **Step 4: Suite and local gate (under the lock, one at a time).** `npm run test:shuffle > $SCRATCH/shuffle.log 2>&1; echo "EXIT=$?"` → 0, then read `Test Files` / `Tests` lines. `npm run gate:local > $SCRATCH/gate.log 2>&1; echo "EXIT=$?"` → 0; record `gate:local PASS at <sha>` (`git rev-parse HEAD`).

- [ ] **Step 5: Browser checks (under the lock).** `npx playwright test e2e/classic-header-fit.spec.ts --project=chromium --workers=1 > $SCRATCH/e2e-428.log 2>&1; echo "EXIT=$?"` → 0 (4 passed). Axe for the views whose controls changed: list titles with `npx playwright test e2e/a11y.spec.ts --list`, then run `npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 -g "<Dashboard|Documents|RAID|Milestones titles from the list>" > $SCRATCH/axe.log 2>&1; echo "EXIT=$?"` → 0. Bulk edit (Changes, Stakeholders, Directory) is eye-verified, not axe-scanned (`docs/AGENTS/features.md`): open each panel's bulk edit in a dev server and read the controls' names in the accessibility tree.

- [ ] **Step 6: Register completeness.** If Tasks 1 or 4 deferred their register step, do it now (the rebase in Step 1 brought §617/§618). Then `grep -n "Work item:\*\* #\(428\|244\|217\|427\|117\|75\|229\|235\|174\)$" docs/open-followups.md` prints nothing, and the four register gates of Step 2 pass again. Commit any register-only change as `docs: close §617 and §618 in the register` with `git commit --only docs/open-followups.md -F $SCRATCH/msg10.txt`.

- [ ] **Step 7: Cold review.** A fresh reviewer (`superpowers:requesting-code-review`) over `git diff origin/main...HEAD`, briefed with this plan's Review Focus list. Every CRITICAL/HIGH finding gets its own commit (same commit rules), then Steps 2–4 again for what it touched.

- [ ] **Step 8: PR — only on the owner's explicit say.** `git push -u origin fix/defect-batch-7`; `gh pr create --base main --title "Defect batch 7: nine user-visible defects" --body-file $SCRATCH/pr.md`. The body lists each issue with its § and one line of what changed, the `gate:local PASS at <sha>` line, the Playwright measurements for #428, the open decisions below with the owner's answers, and ends with `Closes #428`, `Closes #244`, `Closes #217`, `Closes #427`, `Closes #117`, `Closes #75`, `Closes #229`, `Closes #235`, `Closes #174`. Merge only on the owner's say (`gh pr merge --merge --match-head-commit <sha>`), never `--auto`.

## Open decisions for the owner

**Owner answers (2026-09-26):** 1 → Turso only; a new register entry + issue carries JSON/IndexedDB (Task 10 files it: take the next § from `origin/main` at that moment, create the issue only on the owner’s say). 2 → save the flattened form on unmount (as planned). 3 → decided at Task 1 from the measurement. **2026-09-27 (#174):** flatten a refused over-long paragraph on `pagehide` only; a tab switch or minimise keeps the rich draft, its notice and its dirty flag — implemented via a module-level `pageHiding` flag in `debounced-save.ts`.

1. **#427 JSON and IndexedDB.** Both load funnels drop a sanitized-to-nothing slice the same way, but neither has a decode-failure channel or a save pause, so "fix them the same way" means building that plumbing for the file and IndexedDB backends. Proposed: this batch fixes Turso only, and a new register entry (with its own issue) carries the other two. Alternative: log a diagnostic in both funnels now (no data protection, only a trace).
2. **#174 unmount fallback.** When a refused over-cap paragraph unmounts without a blur (a narrowed pane), the plan saves today's flattened form so the edit is not lost. Alternative: discard the uncommitted edit (keeps formatting of the last saved version, loses the new text).
3. **#428 floor at 1024px.** From the issue's numbers the header is 181px too wide at 1024; the search can give 160px (384→224) and the project switcher the rest (it already truncates). If the measurement shows 1024 still overflowing with a 224px floor, the owner picks: a lower floor, or a narrower cap on the project switcher.
