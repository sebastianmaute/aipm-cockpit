# Kanban Column Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render at most 100 cards per Kanban status column, with a per-column "Show more" button, so the board opens fast on large projects.

**Architecture:** `TaskKanban` (`task-kanban-board.tsx`) keeps a per-column limit in its own state and slices each column. A render-time reconcile on `flashId` raises a column's limit so a deep-linked card is rendered before the hook's next-frame query. Printing renders everything through a `usePrinting()` hook moved out of `use-task-row-window.ts`.

**Tech Stack:** React 19, TypeScript, vitest + Testing Library, Playwright (opt-in perf probe).

**Spec:** `docs/superpowers/specs/2026-10-08-kanban-column-cap-design.md`

## Global Constraints

- Page size: `export const KANBAN_COLUMN_PAGE = 100` in `task-kanban-board.tsx`.
- At or under the cap a column's markup is unchanged: no button.
- Header count = the column's true total, never the rendered count.
- EN label: `"Show {0} more in {1} ({2} hidden)"` — `{0}` = `min(KANBAN_COLUMN_PAGE, hidden)`, `{1}` = translated column name, `{2}` = hidden count. Key `kanbanShowMore`. DE in `i18n.de.ts`, edited by node utf8 write with `\r\n` anchors, never the Edit tool.
- `src/app` and `e2e` are CRLF: Edit tool or node with `\r\n`; never `sed -i`.
- No `useEffect` setState (`react-hooks/set-state-in-effect` is fatal): the flash expansion is a render-time reconcile with a sentinel seed.
- Button: the shared `Button` (`button.tsx`), never a hand-rolled `<button>`.
- Gates per task: `npx eslint --max-warnings=0 <changed>` and `npx tsc --noEmit`, unpiped. Vitest only under the shared lock: `if mkdir /c/Projects/.vitest-lock; then npx vitest run <files> --maxWorkers=2; rm -rf /c/Projects/.vitest-lock; fi`. Never `--amend`; no `Claude-Session:` trailer.

## Review Focus

1. **A card moved into a capped column by drag or status change** lands past the cap and disappears from view; the header count must still rise. Test in Task 2.
2. **A filter that shrinks a column under its raised limit, then clears**: the column must show `min(limit, total)` cards with the button text recomputed, never a negative hidden count. Test in Task 2.
3. **Deep link to a card in a column the user already expanded** past it: the reconcile must not LOWER the limit. Test in Task 3.
4. **Deep link to a card id not on the board** (filtered out, or another view's id): no limit change, no crash. Test in Task 3.
5. **Swimlane view** must be untouched: `task-kanban-swimlanes.test.tsx` stays green with no edit. Checked in Task 4's verification.

---

### Task 1: `usePrinting()` out of `use-task-row-window.ts`

**Files:**
- Create: `src/app/use-printing.ts`
- Modify: `src/app/use-task-row-window.ts` (remove `printEventActive`, `subscribePrint`, `getPrintSnapshot`, `getServerPrintSnapshot` and their comment block; call `usePrinting()` where `useSyncExternalStore(subscribePrint, …)` is today)
- Test: `src/app/use-task-row-window.test.tsx` (existing print describe, unchanged)

**Interfaces:**
- Produces: `export function usePrinting(): boolean` — true while a print is laid out (matchMedia `print` or between `beforeprint`/`afterprint`), false on the server.

- [ ] **Step 1:** Move the four declarations and their explanatory comment verbatim into `use-printing.ts`; export `usePrinting()` = `useSyncExternalStore(subscribePrint, getPrintSnapshot, getServerPrintSnapshot)`.
- [ ] **Step 2:** In `use-task-row-window.ts` replace the store call with `const printing = usePrinting();`, drop the now-unused imports.
- [ ] **Step 3:** Run `src/app/use-task-row-window.test.tsx` and `use-task-row-window.real-virtualizer.test.tsx` under the lock. Expected: all pass, same counts as before the move.
- [ ] **Step 4:** eslint + tsc on both files; commit `refactor: move the print subscription into usePrinting (§5)`.

### Task 2: cap each column with "Show more"

**Files:**
- Modify: `src/app/task-kanban-board.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Create test: `src/app/task-kanban-board.test.tsx`

**Interfaces:**
- Consumes: `usePrinting()` (Task 1).
- Produces: `export const KANBAN_COLUMN_PAGE = 100`; `TaskKanban` state `limits: Partial<Record<TaskStatus, number>>`; button `data-testid="kanban-show-more-${status}"`.

- [ ] **Step 1: Write failing tests** in `task-kanban-board.test.tsx` (render `TaskKanban` with minimal props; build tasks with a helper `tasksIn(status, n)`):
  - `"renders every card and no button at exactly KANBAN_COLUMN_PAGE"` — 100 To Do tasks → 100 `kanban-card-*` in `kanban-col-To Do`, no `kanban-show-more-To Do`.
  - `"caps at KANBAN_COLUMN_PAGE and names the hidden count"` — 101 → 100 cards; button accessible name `"Show 1 more in To Do (1 hidden)"`.
  - `"each click shows up to one more page"` — 250 → click → 200 cards, name `"Show 50 more in To Do (50 hidden)"`; click → 250, no button.
  - `"header count is the true total while capped"` — 250 → `<h3>` count text `"250"`.
  - `"two capped columns have distinct button names"` — 101 To Do + 101 Done → two buttons, names differ.
  - `"a filter that shrinks then restores a column keeps a sane count"` (Review Focus 2) — click once at 250 (limit 200), rerender with 120 tasks → 120 cards, no button; rerender with 250 → 200 cards, `"(50 hidden)"`.
  - `"a card moved into a capped column raises its header count"` (Review Focus 1) — 101 Done + 1 To Do; rerender with the To Do task's status Done → header `"102"`, still 100 rendered.
  - `"printing renders every card"` — stub `matchMedia` as `use-task-row-window.test.tsx`'s print describe does, flip to print → 250 cards, no button.
  - `"German label"` — `beforeAll(() => loadI18n("de"))`, lang `"de"` → name matches the DE string.
- [ ] **Step 2:** Run under the lock. Expected: FAIL (no cap, no key).
- [ ] **Step 3:** Add `kanbanShowMore` to `i18n.ts` (EN, constraint text) and `i18n.de.ts` (node utf8 write): `"{0} weitere in {1} anzeigen ({2} ausgeblendet)"`.
- [ ] **Step 4:** Implement in `TaskKanban`: `const printing = usePrinting();` `const [limits, setLimits] = useState<Partial<Record<TaskStatus, number>>>({});` per column `limit = printing ? Infinity : limits[status] ?? KANBAN_COLUMN_PAGE`, render `cols[status].slice(0, limit)`, and when `hidden = cols[status].length - shown > 0` render `<Button size="xs">` with `t(lang, "kanbanShowMore", min(KANBAN_COLUMN_PAGE, hidden), statusLabel, hidden)` that sets `limits[status] = (limits[status] ?? KANBAN_COLUMN_PAGE) + KANBAN_COLUMN_PAGE` (functional setter). Header count stays `cols[status].length`.
- [ ] **Step 5:** Run under the lock. Expected: PASS. Also run `task-kanban.component.test.tsx` and `task-kanban-card.test.tsx` — unchanged and green.
- [ ] **Step 6:** Mutation, one at a time, each must turn a named test red, revert, `git diff --stat` clean of the mutant: `slice(0, limit)` → `slice(0, limit + 1)`; header from rendered count; click adds 0; drop `{1}` (column) from the name; `printing ? Infinity` → ignore printing. Record the counts for the register.
- [ ] **Step 7:** eslint + tsc; commit `feat: cap each Kanban column at 100 cards with Show more (§5)`.

### Task 3: deep-link flash expands the target column

**Files:**
- Modify: `src/app/task-kanban-board.tsx`
- Test: `src/app/task-kanban-board.test.tsx`

**Interfaces:**
- Consumes: the `flashId: number | null` prop (exists); Task 2's `limits`.

- [ ] **Step 1: Write failing tests:**
  - `"a flashId past the cap renders that card in the same render"` — 300 To Do, render with `flashId` = the 250th task's id → `kanban-card-<id>` present on first render; limit raised to 300 (`Math.ceil(251 / 100) * 100`).
  - `"a fresh mount with a pending flashId honours it"` — mount directly with that `flashId` (no prior null) → card present.
  - `"a flash never lowers an expanded column"` (Review Focus 3) — 300, click twice (limit 300), rerender with `flashId` = 10th task → still 300 cards.
  - `"an unknown flashId changes nothing"` (Review Focus 4) — `flashId: 999999` → 100 cards, no throw.
- [ ] **Step 2:** Run. Expected: the first two FAIL.
- [ ] **Step 3:** Implement the render-time reconcile in `TaskKanban`: `const [seenFlash, setSeenFlash] = useState<number | null | undefined>(undefined);` (sentinel `undefined`, so a fresh mount honours a pending flash); `if (flashId !== seenFlash) { setSeenFlash(flashId); if (flashId != null) { find status + index of the card in cols; if index >= current limit, setLimits(prev => ({ ...prev, [status]: Math.ceil((index + 1) / KANBAN_COLUMN_PAGE) * KANBAN_COLUMN_PAGE })); } }` and compute this render's limit from the raised value so the card renders now, not next commit. Comment why no `scrollToId` is used (spec, Collisions 3).
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Mutation: drop the reconcile; seed `seenFlash` from the live `flashId`; drop the `index >= current limit` guard, so a flash can LOWER an expanded column. Each red, reverted.
- [ ] **Step 6:** eslint + tsc; commit `feat: a deep link expands its Kanban column to the card (§5)`.

### Task 4: probe after-numbers, axe on the board, register

**Files:**
- Modify: `e2e/perf-task-board.spec.ts`, `docs/open-followups.md` (§5), `CHANGELOG.md` (Unreleased → Changed)

- [ ] **Step 1:** In the probe, replace `cardCount` with a header-total read: sum of each `section[data-testid^="kanban-col-"] h3` count span; add a check that rendered cards per column `<= KANBAN_COLUMN_PAGE` (import the constant). After the 1000-task timings, add one axe scan scoped to the board (`.include("section[data-testid^=\"kanban-col-\"]")`, same tags and blocking filter as `a11y.spec.ts`), asserting at least one `kanban-show-more-*` button is present first.
- [ ] **Step 2:** Run alone: `PORT=3150 PERF=1 npx playwright test e2e/perf-task-board.spec.ts --project=chromium --workers=1`. Expected: 3 passed; record medians.
- [ ] **Step 3:** Run the swimlane and board unit files plus `tasks-section.test.tsx` under the lock (Review Focus 5). Expected: green, swimlane file unedited.
- [ ] **Step 4:** §5: add the after-numbers, narrow the title to the swimlane view, Gantt and the activity log, record the trade-off (a long column ends in a button; find-in-page cannot see hidden cards) and every mutant count; `node scripts/rebuild-followup-index.mjs`; `npm run followups:index:check` exit 0. CHANGELOG: one user-facing line.
- [ ] **Step 5:** eslint + tsc on changed files; commit `test(e2e): board after-numbers and axe with the column cap (§5)`.
