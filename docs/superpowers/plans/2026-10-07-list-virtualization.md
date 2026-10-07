# List Virtualization (Open Points table) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure the Open Points table at 500/1000/2000 tasks, and virtualize it above 200 rows only if the measurement crosses the spec's threshold.

**Architecture:** Phase 0 is an opt-in Playwright probe that reseeds IndexedDB with a scaled workspace and times three interactions. Phase 1 (conditional) keeps the semantic `<table>` and renders a window of rows between two spacer rows, computed by `@tanstack/react-virtual`, switched on above `VIRTUALIZE_MIN_ROWS`.

**Tech Stack:** Next.js 16 / React 19.3, Playwright, vitest + RTL, `@tanstack/react-virtual` 3.14.13 (Phase 1 only).

**Spec:** `docs/superpowers/specs/2026-10-07-list-virtualization-design.md`

## Global Constraints

- Probe is off unless `PERF=1`; CI must skip it (`test.skip(!process.env.PERF, …)`).
- Probe sizes: **500, 1000, 2000** tasks; three runs each; report the **median**.
- Decision: build Phase 1 only if any median at **1000 tasks** exceeds **200 ms**.
- Output: `eye-verify-output/perf/task-table.json` (already git-ignored via `/eye-verify-output/`).
- Phase 1 library: `@tanstack/react-virtual` exact-pinned `3.14.13` (no caret; CONTRIBUTING.md "Dependencies").
- `VIRTUALIZE_MIN_ROWS = 200`; overscan **10** rows.
- Local runs: single spec, `PORT=3150`, `--project=chromium --workers=1`. No full vitest/e2e/build. Vitest through the shared lock (`if mkdir /c/Projects/.vitest-lock; then …; rm -rf /c/Projects/.vitest-lock; fi`).
- `src/app/*.tsx` are CRLF in the working tree: Edit tool or node with `\r\n`, never `sed -i`.
- Commits: conventional, cite §5, no `Claude-Session:` trailer, no URLs, no `Closes #`, never `--amend`.

## Review Focus

1. A probe that times the wrong thing: the table must actually hold N rows when the clock stops — assert the row count before recording.
2. Playwright's `page.clock.install` fakes the page clock — time on the Node side (`performance.now()` in the test process), never in-page.
3. Reseeding over the fixture's 14-task seed must replace, not merge: the scaled workspace's ids are offset (`k*100000`), so the original 14 stay and are part of the count — assert `seed × factor` total.
4. Phase 1: a filter that drops the visible count from above 200 to below it must switch back to the plain path without a stale spacer height.
5. Phase 1: printing with virtualization on must emit every row, including in the Electron print path.

---

## Phase 0

### Task 1: Probe helper — reseed with a scaled workspace

**Files:**
- Modify: `e2e/seed.ts` (export a helper; `seedIndexedDb` and `SEED_LAYOUT` stay private)
- Test: exercised by Task 2's spec (no separate unit test; the spec asserts the row count)

**Interfaces:**
- Produces: `export async function reseedWorkspace(page: Page, ws: Record<string, unknown>): Promise<void>` — runs `page.evaluate(seedIndexedDb, { ws, layout: SEED_LAYOUT })` on the current same-origin page. Must be called BEFORE `gotoApp`.

- [ ] **Step 1:** Add `reseedWorkspace` with a one-line doc comment naming the "call before gotoApp" rule.
- [ ] **Step 2:** `npx tsc --noEmit` → exit 0. `npx eslint --max-warnings=0 e2e/seed.ts` → exit 0.

### Task 2: The opt-in probe

**Files:**
- Create: `e2e/perf-task-table.spec.ts`

**Interfaces:**
- Consumes: `reseedWorkspace` (Task 1), `SEED_WORKSPACE` (`e2e/seed-workspace.ts`), `scaleWorkspace(ws: Workspace, factor: number): Workspace` (`src/app/scale-workspace.ts`), `gotoApp`, `openView`.
- Produces: `eye-verify-output/perf/task-table.json` shaped `{ size: number; tasks: number; openMs: number; statusMs: number; searchMs: number; filterMs: number; scrollMs: number; busyAfterMs: number }[]` (medians). ★ Corrected 2026-10-07: `filterMs` and `busyAfterMs` were added during Phase 1 and `scrollMs` after review; this line listed only the first three timings.

Factors: the seed has 14 tasks, so factors **36, 72, 143** give 504 / 1008 / 2002. Record `tasks` as the counted rows, `size` as the nominal 500/1000/2000.

- [ ] **Step 1:** Write the spec: `test.skip(!process.env.PERF, "perf probe: set PERF=1")`; one `test` per size, serial, 3 iterations each in a fresh page. Settings init script `{ tourSeen: true }` (as the eye-verify kits do).
- [ ] **Step 2:** Per iteration, Node-side timings:
  - `openMs`: from `openView(page, "Open Points")` until `page.locator("tbody tr[data-deeplink-row]")` has count == expected (`expect(...).toHaveCount(expected, { timeout: 120_000 })`).
  - `statusMs`: select a different option in the first row's status select (`getByRole("combobox", { name: /^Status/ }).first()`), until that select's value reads the new status.
  - `searchMs`: `fill` one character `"a"` into `getByRole("searchbox"|"textbox", { name: "Search task name, assignee, blockers, notes…", exact: true })`, until the row count settles (two consecutive equal counts 100 ms apart).
- [ ] **Step 3:** Write the median JSON and `console.log` a table.
- [ ] **Step 4:** Run: `PORT=3150 PERF=1 npx playwright test e2e/perf-task-table.spec.ts --project=chromium --workers=1` → exit 0 and three rows printed. Also run once without `PERF` → all skipped.
- [ ] **Step 5:** Commit `test: opt-in perf probe for the Open Points table at 500/1000/2000 tasks (§5)`.

### Task 3: Record the result and apply the decision rule

**Files:**
- Modify: `docs/open-followups.md` (§5 status), then `node scripts/rebuild-followup-index.mjs`

- [ ] **Step 1:** Add "Update 2026-10-07 (batch 17)" to §5: the three medians per size, machine note (local Windows, dev server), the reproduce command, and the decision.
- [ ] **Step 2:** If no 1000-task median exceeds 200 ms: narrow §5's title/status to "not needed below the measured sizes", stop here (skip Phase 1). Otherwise continue to Task 4.
- [ ] **Step 3:** `npm run followups:index:check` → exit 0; `npm run docs:symbols:check` → exit 0. Commit `docs: record the task-table measurement in §5`.

## Phase 1 (only if Task 3 says so)

### Task 4: Virtualized row window in `tasks-section-rows.tsx`

**Files:**
- Modify: `package.json` / `package-lock.json` (`npm install --save-exact @tanstack/react-virtual@3.14.13`)
- Create: `src/app/use-task-row-window.ts`
- Modify: `src/app/tasks-section-rows.tsx`
- Test: `src/app/use-task-row-window.test.tsx`, `src/app/tasks-section-rows.test.tsx`

**Interfaces:**
- Produces: `export const VIRTUALIZE_MIN_ROWS = 200;` and
  `export function useTaskRowWindow(opts: { count: number; scrollRef: React.RefObject<HTMLElement | null>; estimateRowPx: number }): { enabled: boolean; start: number; end: number; padTop: number; padBottom: number; measure: (el: HTMLElement | null) => void; scrollToIndex: (i: number) => void }` — `enabled` false when `count <= VIRTUALIZE_MIN_ROWS` or while printing (Task 5), and then `start = 0`, `end = count`, pads 0.

- [ ] **Step 1: Tests first** (jsdom has no layout: mock `@tanstack/react-virtual`'s `useVirtualizer` to return a fixed window):
  - `renders every row at 200 rows and no spacer rows` (threshold boundary: 200 → off, 201 → on).
  - `renders only the window plus two aria-hidden spacer rows above 200 rows`, spacer cells carry `colSpan={visibleColumnCount}` and heights `padTop`/`padBottom`.
  - `sets aria-rowcount on the table to rows + 1 and aria-rowindex on each rendered row` (index = position in `visibleRows` + 2, header is row 1).
  - `drops back to the plain path with no spacer when a filter takes the count from 250 to 150` (Review Focus 4).
- [ ] **Step 2:** Run the two files through the vitest lock → FAIL.
- [ ] **Step 3:** Implement the hook over `useVirtualizer({ count, getScrollElement: () => scrollRef.current, estimateSize: () => estimateRowPx, overscan: 10 })`; wire it in `tasks-section-rows.tsx` around `visibleRows.map` (`slice(start, end)`, `measureElement` via `measure`). Pass the table's existing scroll container as `scrollRef` (read `tasks-section.tsx` for it; add a prop only if none reaches the rows file).
- **Corrected after review (2026-10-07):** the hook moved INTO `TasksTable` (it re-rendered the whole pane on every scroll step), takes `{ ids, scrollRef, headRef, estimateRowPx }` and returns `{ enabled, items, padBottom, measure, scrollToIndex }` (each item an index plus the spacer height before it); the pane's deep link reaches `scrollToIndex` through a `rowWindowRef` handle. Correction (a) below is superseded.
- **Corrected during implementation (2026-10-07):** (a) the hook is called in `tasks-section.tsx`, not in the rows file, and reaches `TasksTable` as a `rowWindow` prop — Task 6's deep link lives in the orchestrator and needs `scrollToIndex`, and the rows file stays hook-free as its header promises. The count is 0 in board/swimlane mode, which reuse the same scroll container. (b) Spacer cells span `visibleColumnCount + 1` (the gutter column), like every other full-width row in the table. (c) `aria-rowcount` is rows **+ 2**, not + 1: the trailing "+ Add task" row is a row too, and it carries `aria-rowindex` rows + 2; the header row carries 1. All aria row attributes are set only while windowed, so the plain path renders exactly as before. (d) `TaskRow` gains three optional props (`ariaRowIndex`, `virtualIndex` → `data-index`, `measureRef`), since `aria-rowindex` and the measuring ref must sit on its `<tr>`.
- [ ] **Step 4:** Tests → PASS. Mutation-test: threshold `<=`→`<`, drop each spacer, drop `aria-rowcount`, off-by-one in `aria-rowindex`; each must turn a test red. Revert all.
- [ ] **Step 5:** `npx tsc --noEmit`, `npx eslint --max-warnings=0 <changed>`, `npm run size:check` → exit 0. Commit `feat: virtualize the Open Points table above 200 rows (§5)`.

### Task 5: Print renders every row

**Files:** Modify `src/app/use-task-row-window.ts`; Test `src/app/use-task-row-window.test.tsx`

- [ ] **Step 1: Test** `disables the window while printing`: stub `matchMedia("print")` returning a listener-capable MQL; fire `change` with `matches: true` → `enabled === false`, all rows; fire `false` → window again. Second test: `beforeprint`/`afterprint` events do the same (Review Focus 5 — the Electron shell prints through the browser print path, `docs/AGENTS/desktop.md`).
- [ ] **Step 2:** FAIL → implement a `printing` state set from both sources (render-time safe; subscribe in an effect via `useSyncExternalStore`, since `set-state-in-effect` is banned) → PASS. Mutation: drop either source → red.
- [ ] **Step 3:** Gates as Task 4 Step 5. Commit `feat: print every Open Points row when the table is virtualized (§5)`.

### Task 6: Deep-link to a row outside the window

**Files:** Modify `src/app/use-deeplink-row-flash.ts`, `src/app/tasks-section.tsx` (or wherever the table calls the hook); Test `src/app/use-deeplink-row-flash.test.tsx`

**Interfaces:**
- Changes: `useDeepLinkRowFlash(view: AppView, opts?: { scrollToId?: (id: number) => void })` — when given, called with the target id BEFORE the existing `data-deeplink-row` query, and the query then runs on the next animation frame. The six other callers pass nothing and behave as today.

- [ ] **Step 1: Tests:** `calls scrollToId before querying the row`; `is unchanged without opts` (existing tests stay green). Table-side: a deep link to row 900 of 1000 calls `scrollToIndex(899)`.
- **Corrected during implementation (2026-10-07):** the hook reads `scrollToId` through `useEffectEvent`, so its effect calls the latest callback without re-running on every render. The table's callback (`scrollRowIntoRange`) is declared after `visibleRows` and the row window, below the hook call; that is safe because the hook only calls it from an effect. The table-side test lives in `tasks-section.test.tsx`, which already stubs the deep-link hook — the stub now records the options it is given.
- [ ] **Step 2:** FAIL → implement → PASS. Mutation: skip the call; call after the query → red.
- [ ] **Step 3:** Gates; commit `feat: deep links scroll a virtualized row into range before flashing it (§5)`.

### Task 7: Axe at 1000 rows, column resize, and the after-numbers

**Files:** Modify `e2e/perf-task-table.spec.ts`

- [ ] **Step 1:** Add, under the same `PERF=1` gate: at 1008 tasks run `AxeBuilder` on Open Points (same include/exclude as `e2e/a11y.spec.ts`) → zero violations; drag the first column's resize handle and assert the width persists after scrolling 500 rows.
- **Corrected during implementation (2026-10-07):** (a) the checks run as a `test.step` at the end of the 1008-task timing test, on the same page — a second boot of that workspace missed `gotoApp`'s 5 s once. (b) The axe scan is scoped to the Open Points pane: at 1008 tasks the nav's pink count badge fails color-contrast on its own (pre-existing, recorded in §5). (c) With a row window the probe can no longer count `<tr>`s, so every "holds N rows" wait reads the table's `aria-rowcount`. (d) A `filterMs` column was added, because the Phase 0 search term "a" matches every seed task and so never filters.
- [ ] **Step 2:** Re-run the probe; record before/after medians in §5; narrow §5 to the three remaining lists and add the two accepted trade-offs from the spec (find-in-page, Tab order). Rebuild the index; `followups:index:check` exit 0.
- [ ] **Step 3:** Commit `docs: §5 after-numbers and remaining scope`.
