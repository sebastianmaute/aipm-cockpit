# Row-unique accessible names, round 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close `docs/open-followups.md` §247 and §248 — every per-row control in the app gets a
row-UNIQUE accessible name, not merely a row-VARYING one — and translate the hardcoded English
accessible names found while grounding the work.

**Architecture:** Whoever renders a list builds a token map with `buildRowTokens` and passes each
per-item component its own token as a **required** prop. Free-text names go through the tokeniser;
structurally-unique keys (a React key that is the identity) take a plain qualifier instead. Nothing
new is invented — `src/app/row-tokens.ts` and `src/test/row-unique-names.ts` already exist and
`raid-panel-rows.tsx` is the precedent.

**Tech Stack:** Next.js 16.2.11 · React 19.2 · TypeScript · vitest + @testing-library/react ·
Playwright (not used here — axe cannot see this defect class).

**Spec:** `docs/superpowers/specs/2026-08-26-row-unique-names-round-2-design.md` (commit `e7cc82ef`).
**Branch:** `feat/row-unique-names-round-2`, off `main` at `5a864d3e` (0.261.0 "Leckie").
**Target release:** 0.262.0 "Swainston" (spare codename: Marske).

---

## Read this before Task 1

**Five environment facts that have each cost a debug cycle in this repo:**

1. **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` reports `tail`'s
   status — a failing suite reads as green. Redirect, check unpiped, then read the file:
   ```bash
   npx vitest run src/app/task-row.test.tsx > /tmp/t.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t.log
   ```
2. **`src/app/*.ts(x)` is CRLF in the working tree** (`i/lf w/crlf`). A node anchored write whose
   anchor uses `\n` silently matches nothing. Match `\r\n`. Never use `sed -i` — under Git Bash it
   re-lines the whole file to LF invisibly.
3. **Never use the Edit tool on `src/app/i18n.de.ts`.** It corrupts umlauts and curls double quotes.
   Task 16 gives the node procedure.
4. **`npx tsc --noEmit` exits 2 on diagnostics**, not 1.
5. **`npm run lint` exits 1 locally** from gitignored `.demo-tmp/` and `.worktrees/` leftovers. The
   truthful local check is `npx eslint --max-warnings=0 src scripts e2e`.

**The one thing that makes these tests worth writing:** axe flags duplicate accessible names in **no
view, at no seed size**, under any tag the gate requests. There is no gate for this. A vacuous test
here is worse than none, because it reads as coverage.

**Therefore every uniqueness assertion in this plan passes `requireCollisionSeed: true` and states
`roles` explicitly.** `expectRowUniqueNames`' `roles` defaults to `["button"]`; half the controls in
this plan are `combobox` or `textbox`, and taking the default there scans the wrong controls and
passes for nothing.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/app/task-row-context.tsx` | The table row's two React contexts and their hooks, moved out of `task-row.tsx` to buy ratchet headroom. No logic change. |

★ **No new test file accompanies it.** `task-row.test.tsx` already covers the provider-missing throw
and keeps resolving those names through the re-export, so Task 1 adds no test — which is exactly what
makes it a provable pure move.

**Modified — §247 (Tasks surface):** `task-row.tsx` · `task-status-select.tsx` ·
`task-kanban-card.tsx` · `task-kanban-board.tsx` · `task-kanban-swimlanes.tsx` · `tasks-section.tsx`

**Modified — §248 (stragglers):** `change-panel.tsx` · `milestones-panel.tsx` ·
`stakeholders-panel.tsx` · `resource-directory.tsx` · `knowledge-links-field.tsx` ·
`settings-sections/templates-section.tsx` · `learning-insights.tsx` · `timelog-people-table.tsx` ·
`add-first-item-button.tsx` (comment only) · `budget-panel.tsx` (comment only)

**Modified — i18n sweep:** `i18n.ts` · `i18n.de.ts` · `resources-panel-rows.tsx` ·
`stakeholder-recipient-input.tsx` · `chat-prompt-chips.tsx` · `create-project-wizard.tsx` ·
`settings-sections/mode-section.tsx` · `workspace-section-chrome.tsx` · `project-form-fields.tsx`

**Modified — docs/release:** `docs/open-followups.md` · `AGENTS.md` · `CHANGELOG.md` ·
`src/app/version.ts` (+ the eight satellites via `npm run version:sync`)

---

## Task 1: Extract the row context — a pure move

`task-row.tsx` is at **793 lines against a hard 800 cap with no baseline entry**, so it cannot grow
until it shrinks. Nothing else in this plan can start until this lands.

**Files:**
- Create: `src/app/task-row-context.tsx`
- Modify: `src/app/task-row.tsx` (remove lines 33–120 except 88–90; add an import and a re-export)

- [ ] **Step 1: Record the starting size**

```bash
node -e "console.log(require('fs').readFileSync('src/app/task-row.tsx','utf8').split('\n').length)"
```
Expected: `793`. Write it down — Step 6 compares against it.

- [ ] **Step 2: Create `src/app/task-row-context.tsx`**

Copy `RowContextValue` (lines 33–74), `RowContext` (76), the `RowLookupContext` block with its
comment (78–83), `EMPTY_TASK_LOOKUP` (85–86), `RowContextProvider` (92–106), `useTaskRowContext`
(108–113) and `useTaskLookup` (115–120) **verbatim**, with this header:

```tsx
"use client";
// src/app/task-row-context.tsx — the Open Points table row's two React contexts.
//
// Extracted from `task-row.tsx` when that file reached 793 of its hard 800-line
// budget (`scripts/check-file-sizes.mjs`, no baseline entry) and the row-unique
// accessible-name work needed to add a prop to it. Pure move: no behaviour
// change, and `task-row.tsx` re-exports every name below so no importer or test
// mock had to be touched.
//
// ★★ THE RE-EXPORT IS LOAD-BEARING, not tidiness. `tasks-section.test.tsx`
// carries `vi.mock("./task-row", () => ({ RowContextProvider, TaskRow }))` — a
// FULL factory mock with no `importOriginal` — to capture the provider's
// `value` prop. Point `tasks-section.tsx` at this module directly and that mock
// stops intercepting the provider, the real one renders, and the captured value
// stays null. Import the hooks from here in NEW code; leave existing importers
// on `./task-row`.
//
// ★ No cycle results: this module imports only react and type-only modules,
// none of which reach `task-row.tsx`.

import { createContext, useContext, type ReactNode } from "react";
import type { Lang } from "./i18n";
import type { JiraExtraProject } from "./settings-types";
import type { Resource, Task, TaskStatus } from "./types";
```

★ `EMPTY_CONTACTS` (lines 88–90) **stays in `task-row.tsx`** — it is used by the inline assignee
picker inside `TaskRowImpl` (line 511), not by the context.

- [ ] **Step 3: Cut those lines from `task-row.tsx` and add the re-export**

Delete lines 33–86 and 92–120 (keeping 88–90). Add, immediately after the import block:

```tsx
import { useTaskLookup, useTaskRowContext } from "./task-row-context";

// ★★ Re-exported so existing importers and test mocks keep resolving these
// from "./task-row". See the header of `task-row-context.tsx` for why removing
// this breaks `tasks-section.test.tsx`.
export { RowContextProvider, useTaskRowContext, useTaskLookup, type RowContextValue } from "./task-row-context";
```

Then drop `createContext` and `useContext` from the `react` import on line 3 — they are no longer
used in this file. Leave `memo`, `useCallback`, `useEffect`, `useRef`, `useState` and the type
imports alone.

★ `export type { RaidItem };` (line 124) **stays** — it is a marker re-export for `TaskRow`'s prop
consumers, unrelated to the context.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```
Expected: `EXIT=0`. A non-zero exit here almost always means a `Contact`, `ChangeItem` or `Priority`
type import went stale in one of the two files — fix the import list, not the code.

- [ ] **Step 5: Prove the move is pure — NO test file may change**

```bash
npx vitest run src/app/task-row.test.tsx src/app/tasks-section.test.tsx src/app/task-kanban-card.test.tsx src/app/task-kanban-swimlanes.test.tsx src/app/task-kanban.component.test.tsx > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t1.log
git diff --name-only | grep -c "\.test\.tsx"
```
Expected: `EXIT=0`, and the second command prints `0`.

★★ **If any test needs editing to stay green, STOP.** The move was not pure and the diff is wrong —
re-read what changed rather than adjusting the test. The whole value of this commit is that it can be
reviewed by reading two files and trusting the suite.

- [ ] **Step 6: Confirm the headroom actually arrived**

```bash
node -e "console.log(require('fs').readFileSync('src/app/task-row.tsx','utf8').split('\n').length)"
npm run size:check; echo "EXIT=$?"
```
Expected: roughly **708** (≈85 lines removed, one added back for the re-export and one for the
import), and `EXIT=0`. Anything above **780** means too little moved — the rest of this plan adds
~15 lines to this file, so bank the room now.

- [ ] **Step 7: Commit**

```bash
git add src/app/task-row-context.tsx src/app/task-row.tsx
git commit -m "refactor(tasks): extract the row context to buy ratchet headroom

task-row.tsx sat at 793 of its hard 800-line budget with no baseline
entry, so it could not take the rowToken prop the row-unique accessible
name work needs. The two contexts and their hooks move to
task-row-context.tsx; task-row.tsx re-exports them so no importer and no
test mock changes.

Pure move: no test file was touched.
"
```

---

## Task 2: Thread the token to every Tasks per-item component

One commit, because `rowToken` is **required** on `TaskStatusSelect` — every caller must pass it in
the same change or nothing compiles. This task only delivers the token; Tasks 3 and 4 spend it.

**Files:**
- Modify: `src/app/task-status-select.tsx` · `src/app/task-kanban-card.tsx` ·
  `src/app/task-kanban-board.tsx` · `src/app/task-kanban-swimlanes.tsx` · `src/app/tasks-section.tsx`
- Test: `src/app/tasks-section.test.tsx`

- [ ] **Step 1: Write the failing test**

★★★ **SUPERSEDED 2026-08-26, AND THE ORIGINAL IS KEPT BELOW BECAUSE THE ERROR IS THE
LESSON.** The snippet this step used to prescribe called `buildRowTokens` directly on inline
objects. It never rendered `TasksSection`, so it pinned nothing about the wiring — while the
annotation above it claimed exactly that — and it duplicated coverage `row-tokens.test.ts`
already carries in "numbers EVERY colliding row, the first included". It was implemented
faithfully, shipped in `df9b5ff8`, and caught in spec review; the replacement landed in
`7c405fc6`. A test whose comment overclaims its coverage is the precise failure this whole
slice exists to remove, so writing one INTO the plan for it is worth recording.

The original text, for the record:

> ★ This file stubs `TaskRow`, so it pins the WIRING — that `tasks-section` computes and
> passes a distinct token per row — not the rendered labels. Tasks 3 and 4 pin the labels.
> Followed by a `describe("row tokens", ...)` block that called `buildRowTokens(twins)` on two
> inline objects and asserted `"Alpha (1)"` / `"Alpha (2)"` — with no `render()` anywhere in it.

**What to write instead — TWO tests, because there are two maps.** Neither can reach the
other array, so one alone leaves half of Step 6 uncovered.

★ Only `TaskRow` is mocked in `tasks-section.test.tsx`. Board mode therefore renders the REAL
`TaskKanban` → `TaskKanbanCard` → `TaskStatusSelect` chain, which is what makes test (a) an
end-to-end check rather than another assertion about a stub.

**(a) Board path** — seed two tasks sharing a `taskName`, render in board mode (mirror the
existing "board cards show the live resource name" test setup), and assert the two status
`combobox` elements carry DISTINCT accessible names, one containing `(1)` and the other `(2)`.

**(b) Table path** — extend the `vi.mock("./task-row", ...)` stub to destructure `rowToken` and
expose it as `data-row-token` on the mocked `<tr>` (mirroring the `data-deeplink-row`
passthrough already there). Seed two same-named tasks in table mode and assert the two rows
received DIFFERENT tokens — assert distinctness, not merely presence.

★★ **Mutation-prove both before believing either.** Change the `task-kanban-board.tsx`
`rowToken={tokens.get(task.id) ?? task.taskName}` lookup to bare `task.taskName` and confirm (a)
goes red; do the same to the `tableTokens` lookup in `tasks-section.tsx` for (b). Restore with an
anchored inverse edit — `git checkout -- <file>` is DENY-BLOCKED here — then prove
`git status --short` empty. Record the mutant token span in the commit message.

★ Reuse the file's existing task factory. If it has none, build tasks with the same shape the other
`tasks-section.test.tsx` cases use — read the top of the file first.

- [ ] **Step 2: Run it to confirm it fails**

```bash
npx vitest run src/app/tasks-section.test.tsx -t "row tokens" > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Error" /tmp/t2.log
```
Expected: FAIL — `buildRowTokens is not defined`.

- [ ] **Step 3: `task-status-select.tsx` — required `rowToken`**

```tsx
import { rowLabel } from "./row-tokens";

interface TaskStatusSelectProps {
  lang: Lang;
  task: Pick<Task, "id" | "taskName" | "status" | "jiraKey">;
  /** ★★ REQUIRED, deliberately. An optional prop defaulting to `task.taskName`
   *  inside this component would compile at a caller that forgot it and ship
   *  the collision silently; required means tsc enumerates the misses. The
   *  fallback lives at the LIST owner, where the map lookup happens. */
  rowToken: string;
  onStatusChange: (id: number, next: TaskStatus) => void;
}

export function TaskStatusSelect({ lang, task, rowToken, onStatusChange }: TaskStatusSelectProps) {
```

and the label becomes:

```tsx
      aria-label={rowLabel(t(lang, "colTaskStatus"), rowToken)}
```

- [ ] **Step 4: `task-kanban-card.tsx` — accept and forward the token**

Add to `TaskKanbanCardProps`:

```tsx
  /** This card's row-unique display token, from the board's `tokens` map.
   *  ★ PROPS, never context — the board renders cards OUTSIDE RowContextProvider. */
  rowToken: string;
```

Destructure `rowToken` in the signature and forward it:

```tsx
        <TaskStatusSelect lang={lang} task={task} rowToken={rowToken} onStatusChange={onStatusChange} />
```

- [ ] **Step 5: `task-kanban-board.tsx` and `task-kanban-swimlanes.tsx` — take a map**

Add to both prop interfaces (the board component is exported as **`TaskKanban`**, not
`TaskKanbanBoard`):

```tsx
  /** Row-unique display tokens for `tasks`, keyed by task id. Built by the list
   *  owner (`tasks-section.tsx`) because uniqueness is a property of the
   *  rendered list and a card cannot see its siblings. */
  tokens: ReadonlyMap<number, string>;
```

Destructure `tokens` and pass at both `<TaskKanbanCard>` sites:

```tsx
                    rowToken={tokens.get(task.id) ?? task.taskName}
```

- [ ] **Step 6: `tasks-section.tsx` — build both maps and pass them down**

Add the import:

```tsx
import { buildRowTokens } from "./row-tokens";
```

Add near the other `useMemo`s:

```tsx
  // ★★ TWO maps, not one, and this is not redundancy. The table renders
  // `visibleRows` (which also applies hide-finished) while both Kanban views
  // render `healthFilteredTasks`. An occurrence index is only meaningful over
  // the array actually on screen, so a shared map would number the table's rows
  // against tasks the table is not showing.
  const tableTokens = useMemo(
    () => buildRowTokens(visibleRows.map((task) => ({ id: task.id, name: task.taskName }))),
    [visibleRows],
  );
  // ★ Board and swimlanes share this one: both render the whole array on one
  // page, so uniqueness has to span lanes and columns, not sit inside one.
  const boardTokens = useMemo(
    () => buildRowTokens(healthFilteredTasks.map((task) => ({ id: task.id, name: task.taskName }))),
    [healthFilteredTasks],
  );
```

Pass `tokens={boardTokens}` to `<TaskKanbanSwimlanes>` and `<TaskKanban>`, and add to `<TaskRow>`:

```tsx
                  rowToken={tableTokens.get(task.id) ?? task.taskName}
```

- [ ] **Step 7: `task-row.tsx` — accept and forward only**

Add to `TaskRowProps`:

```tsx
  /** This row's row-unique display token, from `tasks-section`'s table map. */
  rowToken: string;
```

Destructure it in `TaskRowImpl` and forward to the status select:

```tsx
              <TaskStatusSelect lang={lang} task={task} rowToken={rowToken} onStatusChange={onStatusChange} />
```

Leave every other `task.taskName` site alone — Task 3 does those.

- [ ] **Step 8: Typecheck, then run the suites**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/tasks-section.test.tsx src/app/task-row.test.tsx src/app/task-kanban-card.test.tsx src/app/task-kanban-swimlanes.test.tsx src/app/task-kanban.component.test.tsx src/app/task-status-select.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t2.log
```
Expected: `EXIT=0` both times.

★ The existing card/row tests will fail to compile until they pass `rowToken`. That is the required
prop doing its job — add `rowToken="Alpha"` (or the fixture's own task name) at each render site in
those tests. This is the one place in the plan where editing existing tests is correct.

- [ ] **Step 9: Commit**

```bash
git add src/app/task-status-select.tsx src/app/task-kanban-card.tsx src/app/task-kanban-board.tsx src/app/task-kanban-swimlanes.tsx src/app/tasks-section.tsx src/app/task-row.tsx src/app/*.test.tsx
git commit -m "feat(a11y): thread row-unique tokens to every Tasks per-item component

tasks-section owns both rendered arrays, so it builds both token maps:
the table renders visibleRows, the two Kanban views render
healthFilteredTasks, and an occurrence index is only meaningful over the
array on screen.

rowToken is required on TaskStatusSelect so tsc enumerates any caller
that forgets it. Refs #247.
"
```

---

## Task 3: Spend the token in `task-row.tsx`

**Files:**
- Modify: `src/app/task-row.tsx`
- Test: `src/app/task-row.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/task-row.test.tsx`, reusing its existing `renderRows` helper:

```tsx
describe("row-unique accessible names (WCAG 2.4.6)", () => {
  it("keeps every control distinct when two tasks share a name", () => {
    const { container } = renderRows(makeContext(), [
      { ...baseTask, id: 1, taskName: "Alpha" },
      { ...baseTask, id: 2, taskName: "Alpha" },
    ]);
    expectRowUniqueNames({
      minControls: 4,
      scope: container,
      roles: ["button", "combobox", "textbox", "checkbox"],
      requireCollisionSeed: true,
    });
  });

  it("leaves the VISIBLE task name unqualified", () => {
    renderRows(makeContext(), [
      { ...baseTask, id: 1, taskName: "Alpha" },
      { ...baseTask, id: 2, taskName: "Alpha" },
    ]);
    // The token is an ACCESSIBLE-name device. A user reads what they typed.
    expect(screen.getAllByText("Alpha", { selector: "button" })).toHaveLength(2);
  });
});
```

★ `renderRows` must pass `rowToken` per row — build it with `buildRowTokens` inside the helper so the
test exercises the real tokeniser rather than a hand-written string.

- [ ] **Step 2: Run it to confirm it fails**

```bash
npx vitest run src/app/task-row.test.tsx -t "WCAG 2.4.6" > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Tests |shared by more than one" /tmp/t3.log
```
Expected: FAIL naming several shared names — the inline-edit labels, `Send inquiry – Alpha`,
`More actions – Alpha`, and the two bare name buttons.

- [ ] **Step 3: Replace every accessible-name site**

Swap `task.taskName` for `rowToken` at all eleven sites. Enumerate them, do not trust this list:

```bash
grep -nE "(aria-label|label|entityTitle|entityName)=.*task\.taskName" src/app/task-row.tsx
```

Then pass `rowToken` into `TaskActionsImpl` — its props become:

```tsx
interface TaskActionsProps { task: Task; isPushing: boolean; rowToken: string; }
function TaskActionsImpl({ task, isPushing, rowToken }: TaskActionsProps) {
```

and its call site in `TaskRowImpl` gains `rowToken={rowToken}`.

- [ ] **Step 4: Fix the name button — the collision no register entry records**

The read-mode name button has **no `aria-label`**, so its accessible name is its content. Add one:

```tsx
          <button
            type="button"
            onClick={handleNameClick}
            onDoubleClick={handleNameDoubleClick}
            // ★★★ Without this the accessible name is the CONTENT — two tasks
            // named "Alpha" render two identically-named buttons, on the most
            // prominent control in the view. Found while grounding this slice;
            // neither §247 nor §248 records it.
            // ★ 2.5.3 holds by CONTAINMENT: visible "Alpha" sits inside the
            // token "Alpha (1)". Set unconditionally — with no collision the
            // token IS the bare name, so this restates the content rather than
            // changing behaviour.
            aria-label={rowToken}
            title={`${task.taskName} — ${t(lang, "clickToEdit")}`}
```

Leave the `title` and the `{task.taskName}` content untouched.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run src/app/task-row.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3.log
```
Expected: `EXIT=0`.

- [ ] **Step 6: Mutation-prove the guard**

Revert ONE site — `aria-label={rowToken}` back to removing the attribute entirely — and confirm RED:

```bash
npx vitest run src/app/task-row.test.tsx -t "WCAG 2.4.6" > /tmp/t3m.log 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=1`, naming `"Alpha" x2`. Restore with an anchored write (not `git checkout --`,
which is deny-blocked here), then prove the tree clean:

```bash
git diff --stat src/app/task-row.tsx
```
Record the mutant's token span in the commit message — "the test failed" is not a proof another
reader can check.

- [ ] **Step 7: Check the ratchet and commit**

```bash
node -e "console.log(require('fs').readFileSync('src/app/task-row.tsx','utf8').split('\n').length)"
npm run size:check; echo "EXIT=$?"
git add src/app/task-row.tsx src/app/task-row.test.tsx
git commit -m "fix(a11y): row-unique names for every Open Points table control

Eleven accessible-name sites keyed on raw task.taskName, plus the name
button itself, which carried no aria-label at all and therefore took its
content as its accessible name.

Mutation-proved: deleting the name button's aria-label turns the new
WCAG 2.4.6 test red with \"Alpha\" x2. Refs #247.
"
```

---

## Task 4: Spend the token in `task-kanban-card.tsx`

**Files:**
- Modify: `src/app/task-kanban-card.tsx`
- Test: `src/app/task-kanban-card.test.tsx` · `src/app/task-kanban-swimlanes.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `task-kanban-card.test.tsx`, reusing its `renderCards` helper:

```tsx
it("keeps every card control distinct when two tasks share a name", () => {
  const { container } = renderCards([
    { ...baseTask, id: 1, taskName: "Alpha" },
    { ...baseTask, id: 2, taskName: "Alpha" },
  ]);
  expectRowUniqueNames({
    minControls: 4,
    scope: container,
    roles: ["button", "combobox"],
    requireCollisionSeed: true,
  });
});
```

In `task-kanban-swimlanes.test.tsx` — ★ seed the twins in **DIFFERENT lanes**, which is the case a
per-column fixture structurally cannot reach:

```tsx
it("keeps names unique when same-named tasks sit in DIFFERENT lanes", () => {
  const twins = [
    { ...baseTask, id: 1, taskName: "Alpha", resourceId: 10 },
    { ...baseTask, id: 2, taskName: "Alpha", resourceId: 20 },
  ];
  const { container } = render(
    <TaskKanbanSwimlanes {...baseProps} tasks={twins}
      tokens={buildRowTokens(twins.map((t) => ({ id: t.id, name: t.taskName })))} />,
  );
  expectRowUniqueNames({
    minControls: 4, scope: container,
    roles: ["button", "combobox"], requireCollisionSeed: true,
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

```bash
npx vitest run src/app/task-kanban-card.test.tsx src/app/task-kanban-swimlanes.test.tsx > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Tests |shared by more than one" /tmp/t4.log
```
Expected: FAIL naming the bare name buttons plus `Ask Claude – Alpha` and the assign select.

- [ ] **Step 3: Replace the four sites**

```tsx
        {/* Name button — same reasoning as task-row.tsx: no aria-label means
            the accessible name is the content, so twins collide. */}
        <button ... aria-label={rowToken} title={`${task.taskName} — ${t(lang, "clickToEdit")}`}>
          {task.taskName}
        </button>
```

```tsx
        <DocumentBadge lang={lang} count={...} entityTitle={rowToken} onOpen={...} />
```

```tsx
            aria-label={rowLabel(t(lang, "inlineAiEdit"), rowToken)}
```

```tsx
          aria-label={t(lang, "assignPersonLabel", rowToken)}
```

★ `DocumentBadge` composes its own name as `` `${documentsLinkedBadge(count)} – ${entityTitle}` ``,
so passing the token is the whole fix; the shared primitive needs no change.

★★ **Do NOT touch `changesLabel`.** It is `t(lang, "taskRowChangesBadge", changeRefs.length)` — it
keys on a change count, not on the task, and rides a non-interactive `<span>` with no role. It is not
a control and not a 2.4.6 site. An early draft of the spec listed it; rewriting it produces a wrong
diff that every test still passes.

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run src/app/task-kanban-card.test.tsx src/app/task-kanban-swimlanes.test.tsx src/app/task-kanban.component.test.tsx > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4.log
```
Expected: `EXIT=0`.

- [ ] **Step 5: Mutation-prove, then commit**

Revert `aria-label={rowToken}` on the name button, confirm RED, restore, prove the diff clean, then:

```bash
git add src/app/task-kanban-card.tsx src/app/task-kanban-card.test.tsx src/app/task-kanban-swimlanes.test.tsx
git commit -m "fix(a11y): row-unique names on the Kanban card

Four sites: the name button (which had no aria-label at all), the
DocumentBadge entityTitle, the inline Ask-Claude trigger and the assign
select. The swimlane test seeds the twins in different lanes, the case a
per-column fixture cannot reach. Refs #247.
"
```

---

## Tasks 5–7: The three register panels

These three are the same shape. **Each is its own task and its own commit** — do not batch them.

| Task | File | Row field | Sites |
|---|---|---|---|
| 5 | `src/app/change-panel.tsx` | `item.title` | `selectItem` checkbox · `InlineAiEditButton` |
| 6 | `src/app/milestones-panel.tsx` | `m.name` | `selectItem` checkbox · `InlineAiEditButton` · the row `title` |
| 7 | `src/app/stakeholders-panel.tsx` | `item.name` | `selectItem` checkbox · `InlineAiEditButton` · the row `title` |

★★ **`InlineAiEditButton` is a second collision site the register never named.** It builds
`` `${t(lang,"inlineAiEdit")} – ${label}` `` internally, so passing the raw field collides exactly as
the checkbox does. Fix it in the same commit — the token map is already in scope, and leaving a
sibling control bare in a file that now has one is the precise pattern §248 exists to record.

For each of Tasks 5, 6 and 7:

- [ ] **Step 1: Write the failing test**

In the file's own test (`change-panel.test.tsx` uses `renderWithProbe`; `milestones-panel.test.tsx`
has `renderMilestones`; `stakeholders-panel.test.tsx` has `renderStakeholders`), seed two rows with
the SAME display name:

```tsx
it("keeps every per-row control distinct when two rows share a name", () => {
  const { container } = renderMilestones([
    { ...baseMilestone, id: 1, name: "Go live" },
    { ...baseMilestone, id: 2, name: "Go live" },
  ]);
  expectRowUniqueNames({
    minControls: 2,
    scope: container,
    roles: ["button", "checkbox"],
    requireCollisionSeed: true,
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** naming `Select Go live x2` and `Ask Claude – Go live x2`.

- [ ] **Step 3: Build the token map over the RENDERED array**

Immediately above the `.map(...)` that renders the rows — over `sorted` in `milestones-panel.tsx`,
over the same filtered/sorted array the other two map:

```tsx
  const rowTokens = useMemo(
    () => buildRowTokens(sorted.map((m) => ({ id: m.id, name: m.name }))),
    [sorted],
  );
```

★★ It must be the array the component actually renders, **sorted and filtered as displayed** — an
occurrence index has to follow what is on screen. `row-tokens.ts` states this as a requirement.

- [ ] **Step 4: Spend it at both sites**

```tsx
  const token = rowTokens.get(m.id) ?? m.name;
  // ...
                      aria-label={t(lang, "selectItem", token)}
  // ...
                          <InlineAiEditButton lang={lang} label={token} onClick={() => onAiEdit(m)} />
```

★ Leave the row's visible `title={m.name}` alone — it is display text, not an accessible name.

- [ ] **Step 5: Run to verify it passes.** Expected `EXIT=0`.

- [ ] **Step 6: Mutate `token` back to the raw field at ONE site, confirm RED, restore, prove clean.**

- [ ] **Step 7: Commit** — `fix(a11y): row-unique names in <panel>. Refs #248.`

---

## Task 8: `resource-directory.tsx` — token AND the untranslated label

This file carries two defects on one line: a row-keyed name **and** hardcoded English.

**Files:**
- Modify: `src/app/resource-directory.tsx` · `src/app/i18n.ts` · `src/app/i18n.de.ts`
- Test: `src/app/resource-directory.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("keeps per-row controls distinct when two resources share a display name", () => {
  const { container } = render(<ResourceDirectory {...baseProps} resources={[
    { ...baseResource, id: 1, firstName: "Jan", lastName: "Novak" },
    { ...baseResource, id: 2, firstName: "Jan", lastName: "Novak" },
  ]} bulkEnabled />);
  expectRowUniqueNames({
    minControls: 2, scope: container,
    roles: ["checkbox", "combobox"], requireCollisionSeed: true,
  });
});

it("translates the role select's accessible name", () => {
  render(<ResourceDirectory {...baseProps} lang="de" resources={[{ ...baseResource, id: 1 }]} />);
  expect(screen.queryByRole("combobox", { name: /^Role for/ })).toBeNull();
});
```

- [ ] **Step 2: Run it, expect FAIL** — `Select Jan Novak x2`, and the German render still showing
  `Role for …`.

- [ ] **Step 3: Add the i18n key** — see Task 16 for the exact node procedure. The key is:

```
resourceRoleForRow: "Role for {0}",          // EN
resourceRoleForRow: "Rolle für {0}",         // DE
```

- [ ] **Step 4: Fix both sites**

The role select lives in the file-local component `DirectoryRoleSelect`, which today takes
`{ resource, roles, disciplines, grades, onAssignRoleById }` and has **no `lang`**. Add both:

```tsx
function DirectoryRoleSelect({
  resource, roles, disciplines, grades, onAssignRoleById, lang, rowToken,
}: {
  resource: Resource;
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  onAssignRoleById: (resourceId: number, roleId: number | null) => void;
  lang: Lang;
  /** ★ The row's token, not `resourceDisplayName(resource)` — this component is
   *  per-item and cannot see whether another row shares the name. */
  rowToken: string;
}) {
```

and the label becomes:

```tsx
        aria-label={t(lang, "resourceRoleForRow", rowToken)}
```

The directory builds the token map over `rows` and passes both props at the `<DirectoryRoleSelect>`
call site:

```tsx
  const rowTokens = useMemo(
    () => buildRowTokens(rows.map((r) => ({ id: r.id, name: resourceDisplayName(r) }))),
    [rows],
  );
```

and the checkbox becomes `aria-label={t(lang, "selectItem", rowTokens.get(r.id) ?? resourceDisplayName(r))}`.

- [ ] **Step 5: Run, verify pass. Step 6: mutate one site, confirm RED, restore. Step 7: commit.**

---

## Tasks 9–12: The four remaining per-row controls

Same shape, one commit each. Test in the file's own `*.test.tsx`, seed two colliding rows, assert with
`requireCollisionSeed: true` and the roles named below, mutate one site to prove RED, restore, commit.

| Task | File | Change | Roles |
|---|---|---|---|
| 9 | `knowledge-links-field.tsx` | token over `value` keyed on `link.url`, name `link.name`; feeds BOTH the anchor and the Remove button | `["link", "button"]` |
| 10 | `settings-sections/templates-section.tsx` | token over `userTemplates`; qualifies the rename input | `["textbox"]` |
| 11 | `learning-insights.tsx` | **no token map** — `kind` is the React key and cannot repeat. Plain qualifier | `["combobox"]` |
| 12 | `timelog-people-table.tsx` | token map keyed on `userId`, name `displayId`; feeds all FOUR labels | `["button", "checkbox", "combobox"]` |

**Task 9 — the anchor is two SCs at once:**

```tsx
                  aria-label={rowLabel(t(lang, "documentsOpen"), token)}
```

★ This closes 2.4.6 **and** 2.5.3 together: the visible text is `link.name` = `"Alpha"` and the name
becomes `"Open in new tab – Alpha"`, which CONTAINS it. Containment survives the escalation too —
`"Open in new tab – Alpha (1)"` still contains `"Alpha"`. ★★ Switch the sibling Remove button to the
token as well; its current `` `${documentsRemove} – ${link.name}` `` is row-QUALIFIED but not
row-UNIQUE, and the file's own comment already reasons about this failure one line below.

**Task 11 — the qualifier, not a token:**

```tsx
                          aria-label={rowLabel(t(lang, "learningColOverride"), sourceLabel(lang, kind))}
```

★★ `kind` is the row key, so it cannot repeat in one render — a token map here would be ceremony. The
discriminator for this whole plan is "can this value repeat in one rendered list", never the call
form. ★ Leave the `<th>` header cell's `learningColOverride` alone; a header is not a control.

**Task 12 — decided against the data:**

```tsx
            const token = rowTokens.get(u.userId) ?? displayId;
            const selectLabel = rowLabel(t(lang, "timelogMatchPeople"), token);
            const clearLabel = rowLabel(t(lang, "timelogMatchClear"), token);
            const rowSelectLabel = t(lang, "selectItem", token);
            const removeLabel = rowLabel(t(lang, "remove"), token);
```

★★ `displayId` is `u.email || String(u.userId)`. `userId` cannot repeat, but `email` is free text
arriving from a system this repo does not own, and **all four labels ride it** — one duplicate email
collides all four at once. The token map costs nothing and is correct regardless of what Timelog
sends. Seed the test with two users sharing an email.

---

## Task 13: The budget DragHandle — a test, not a fix

The qualifier is already correct. The defect is that its comment claimed "pinned by a unit test" when
**nothing** referenced `budgetReorderHandle` anywhere in `src` or `e2e` — a false claim of coverage,
which reads as protection and stops the next audit. A revert to the bare label ships green.

**Files:** Modify `src/app/budget-panel.tsx` (**comment only**) · Test `src/app/budget-panel.test.tsx`

★★ **No source edit beyond the comment.** `budget-panel.tsx` is at 796 of 800.

- [ ] **Step 1: Confirm the gap still exists**

```bash
grep -rln "budgetReorderHandle" src e2e
```
Expected: only `src/app/budget-panel.tsx` and the two i18n dictionaries.

- [ ] **Step 2: Write the test** with two buckets sharing a name, using the file's `renderTotals`
      helper, `roles: ["button"]`, `requireCollisionSeed: true`.

- [ ] **Step 3: Mutate the handle's label to the bare key, confirm RED, restore.** This mutation is
      the whole point of the task — run it before believing the test.

- [ ] **Step 4: Correct the comment** to say what the test actually pins, naming it.

- [ ] **Step 5: Verify the ratchet did not move**

```bash
node -e "console.log(require('fs').readFileSync('src/app/budget-panel.tsx','utf8').split('\n').length)"
npm run size:check; echo "EXIT=$?"
```
Expected: ≤ 800 and `EXIT=0`.

- [ ] **Step 6: Commit.**

---

## Task 14: Record the `AddFirstItemButton` 2.5.3 decision

**Decision: change nothing.** WCAG 2.5.3 concerns the text presented to *identify* the control; the
CTA line is that label and the sentence above it is supplementary description. axe's whole-node
visible-text computation is a tool implementation, not the SC — and `label-content-name-mismatch` is
`experimental`, so the gate never runs it in any view regardless.

**Files:** Modify `src/app/add-first-item-button.tsx` (comment only)

- [ ] **Step 1: Add the comment beside the `text` prop**

```tsx
  /** Optional descriptive line shown above the CTA. Omit for the single-line (budget) variant.
   *
   *  ★★ WCAG 2.5.3, DECIDED 2026-08-26 — do not "fix" this without re-opening
   *  the decision. When `text` is set, the button's VISIBLE text is the
   *  description plus the CTA, while its accessible name is `ariaLabel` (the
   *  category-qualified CTA), so axe's whole-node containment check would fail.
   *  We treat the CTA line as the control's label and the sentence as
   *  supplementary description; axe's whole-node computation is a tool
   *  implementation, not the SC, and the rule is `experimental` so the gate
   *  never runs it in any view.
   *  ★ Rejected: moving the description out of the button (containment then
   *  holds under any reading, but it shrinks the click target — today the whole
   *  dashed box is clickable — for all eight calling panels); and widening
   *  `ariaLabel` to contain both (mechanically conformant, and a very long
   *  spoken name on every empty state, which regresses exactly the users 2.5.3
   *  protects).
   *  ★ Deciding this binds EVERY caller that passes `text`, which is why it
   *  lives here and not at the RAID call site that raised it. */
  text?: string;
```

- [ ] **Step 2: `npx tsc --noEmit`, expect `EXIT=0`. Step 3: commit.**

---

## Task 15: Sweep the remaining hardcoded English accessible names

Found by sweeping while grounding Task 8. **The set is enumerated below — this is not an open-ended
audit.** Reproduce it before starting; if the greps return more than these, stop and report rather
than widening the task:

```bash
grep -rnE '(aria-label|placeholder|title)="[A-Za-z][^"]*"' src/app --include=*.tsx | grep -v '\.test\.'
grep -rnE '(aria-label|placeholder|title)=\{`[^`]*`\}' src/app --include=*.tsx | grep -v '\.test\.' | grep -v 't(lang'
```

| File | String | Key |
|---|---|---|
| `resources-panel-rows.tsx` | `Utilization for {0} in {1}` | NEW `resourceUtilizationForPeriod` |
| `resources-panel-rows.tsx` | `Absence override for {0} in {1}` | NEW `resourceAbsenceOverrideForPeriod` |
| `chat-prompt-chips.tsx` | `Suggested prompts` | NEW `chatSuggestedPrompts` |
| `create-project-wizard.tsx` + `settings-sections/mode-section.tsx` | `Apply Simple preset` | NEW `modeApplySimplePreset` |
| `create-project-wizard.tsx` + `settings-sections/mode-section.tsx` | `Apply Advanced preset` | NEW `modeApplyAdvancedPreset` |
| `workspace-section-chrome.tsx` | `Workspace tabs` | NEW `workspaceTabsLabel` |
| `workspace-section-chrome.tsx` | `Workspace sub-tabs` | NEW `workspaceSubTabsLabel` |
| `stakeholder-recipient-input.tsx` | `Remove {0}` | **existing** `remove` → `rowLabel(t(lang,"remove"), name)` |
| `project-form-fields.tsx` | `placeholder="email"` | **existing** `email` |

**Deliberately EXCLUDED, with reasons — do not "complete the pattern":**

- `budget-panel-totals.tsx`'s `` `budget-${ariaPrefix}` `` and `` `actual-${ariaPrefix}` `` — these are
  structured query handles that existing tests select by. Retranslating them is a separate change with
  its own blast radius. Filed in Task 17.
- Comment text in `dependencies-editor.tsx`, `stakeholder-recipient-input.tsx` and `voice-button.tsx`
  — prose, matched by the grep, not code.
- `placeholder` values that are EXAMPLES rather than labels: `https://acme.atlassian.net`, `ATATT…`,
  `whisper-1`, the Confluence space URL. Example values are correctly untranslated.
- Names composed of already-translated pieces (`` `${addedLabel}: ${line.text}` ``, `` `${restore} – ${h.title}` ``)
  and of pure data (`` `${entry.code} ${entry.label}` ``).

- [ ] **Step 1: Add the seven keys** using the Task 16 procedure.
- [ ] **Step 2: Replace each call site** with `t(lang, "<key>", …)`.
- [ ] **Step 3: Write one test per changed file** asserting the German render does NOT match the
      English string — e.g. `expect(screen.queryByRole("combobox", { name: /^Utilization for/ })).toBeNull()`
      after `await loadI18n("de")`. ★ The DE dictionary is lazy: a test asserting DE output must call
      `loadI18n("de")` (in `beforeAll`) before the assertion or it silently reads EN.
- [ ] **Step 4: `npx tsc --noEmit`** — this is what enforces EN/DE key parity. Expect `EXIT=0`.
- [ ] **Step 5: Commit.**

---

## Task 16: The i18n key procedure (referenced by Tasks 8 and 15)

★★★ **`i18n.ts` and `i18n.de.ts` are CRLF in the working tree** (`i/lf w/crlf`) and the Edit tool
corrupts umlauts and curls double quotes in the German file. Both edits go through an anchored node
write matching `\r\n`.

- [ ] **Step 1: Write the EN block**

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.ts";
const anchor = "  remove: \"Remove\",\r\n";
let s = fs.readFileSync(p, "utf8");
if (s.split(anchor).length !== 2) throw new Error("anchor missing or not unique");
const block =
  "\r\n" +
  "  // Row-unique accessible names, round 2 (0.262.0) — see docs/open-followups.md 247/248.\r\n" +
  "  resourceRoleForRow: \"Role for {0}\",\r\n" +
  "  resourceUtilizationForPeriod: \"Utilization for {0} in {1}\",\r\n" +
  "  resourceAbsenceOverrideForPeriod: \"Absence override for {0} in {1}\",\r\n" +
  "  chatSuggestedPrompts: \"Suggested prompts\",\r\n" +
  "  modeApplySimplePreset: \"Apply Simple preset\",\r\n" +
  "  modeApplyAdvancedPreset: \"Apply Advanced preset\",\r\n" +
  "  workspaceTabsLabel: \"Workspace tabs\",\r\n" +
  "  workspaceSubTabsLabel: \"Workspace sub-tabs\",\r\n";
fs.writeFileSync(p, s.replace(anchor, anchor + block), "utf8");
console.log("EN block written");
'
```

- [ ] **Step 2: Write the DE block** — real umlauts, never `\u00XX` escapes (the `i18n-encoding` test
      BANS them, and it also bans ASCII substitutions like `fuer`):

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
const anchor = "  remove: \"Entfernen\",\r\n";
let s = fs.readFileSync(p, "utf8");
if (s.split(anchor).length !== 2) throw new Error("anchor missing or not unique");
const block =
  "\r\n" +
  "  // Row-unique accessible names, round 2 (0.262.0) — see docs/open-followups.md 247/248.\r\n" +
  "  resourceRoleForRow: \"Rolle für {0}\",\r\n" +
  "  resourceUtilizationForPeriod: \"Auslastung für {0} in {1}\",\r\n" +
  "  resourceAbsenceOverrideForPeriod: \"Abwesenheits-Überschreibung für {0} in {1}\",\r\n" +
  "  chatSuggestedPrompts: \"Vorgeschlagene Prompts\",\r\n" +
  "  modeApplySimplePreset: \"Einfaches Preset anwenden\",\r\n" +
  "  modeApplyAdvancedPreset: \"Erweitertes Preset anwenden\",\r\n" +
  "  workspaceTabsLabel: \"Arbeitsbereich-Tabs\",\r\n" +
  "  workspaceSubTabsLabel: \"Arbeitsbereich-Untertabs\",\r\n";
fs.writeFileSync(p, s.replace(anchor, anchor + block), "utf8");
console.log("DE block written");
'
```

- [ ] **Step 3: Verify the umlauts survived and the line endings did not change**

```bash
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');for(const w of ['Rolle für','Auslastung für','Abwesenheits-Überschreibung'])if(!s.includes(w))throw new Error('corrupted: '+w);console.log('umlauts OK')"
git ls-files --eol src/app/i18n.ts src/app/i18n.de.ts
```
Expected: `umlauts OK`, and both files still `i/lf w/crlf`. **`w/lf` means the file was re-lined —
undo and redo the write.**

- [ ] **Step 4: Parity and encoding gates**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/i18n-encoding.test.ts > /tmp/t16.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t16.log
```
Expected: `EXIT=0` for both. `tsc` is what enforces EN/DE key-set parity.

★ Positional placeholders are **0-based**: `t(lang, key, a, b)` fills `{0}` and `{1}`.

---

## Task 17: Register, docs and the new follow-up

**Files:** Modify `docs/open-followups.md` · `AGENTS.md`

- [ ] **Step 1: Close §247 and §248**

Add `— CLOSED 2026-08-26 (0.262.0)` to both `##` headings. ★★★ Closure lives in the HEADING; a
`**Status:**` body line is invisible to every count. ★ An open-followups heading edit is a
FOUR-place edit — heading, table status, table anchor, and the `isClosed` witness. Verify:

```bash
grep -cE "^## [0-9]+\." docs/open-followups.md
grep -E "^## [0-9]+\." docs/open-followups.md | grep -cv "— CLOSED"
npm run followups:check
```
The open count must drop by exactly 2 from its pre-task value, and the three spellings must agree.

- [ ] **Step 2: Note in §247 the collision it did not record** — the task-name button on both
      surfaces, closed here.

- [ ] **Step 3: Leave §245 and §246 OPEN.** §245 records the sweep's boundary — a property-based scan
      this slice does not perform, so closing it would be the same false claim of coverage that §248's
      DragHandle bullet is about. §246 is the shared-primitive slice.

- [ ] **Step 4: Open the next entry** for what Task 15 excluded. Mint the number by measuring, never
      by trusting this plan:

```bash
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
git fetch origin && git show origin/main:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -1
```
★★ A register number is reserved only once it is on `origin/main` — two branches have minted the same
one before. Take one above the higher of the two. The entry records
`budget-panel-totals.tsx`'s two structured `aria-label`s: untranslated, and selected by existing
tests, so retranslating them has its own blast radius.

- [ ] **Step 5: Update AGENTS.md's a11y bullet** with the rule this slice generalises — the
      free-text vs structurally-unique-key discriminator, and that a per-item component cannot
      disambiguate itself. Keep it short; that file is always loaded and regrows.

```bash
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```
Expected: `EXIT=0` both. ★ `docs:claims:check` is a RATCHET — do not add a new `path:LINE` citation
to `AGENTS.md`. Cite the SYMBOL and a grep.

- [ ] **Step 6: Commit.**

---

## Task 18: Release 0.262.0 "Swainston"

★★★ **Do not run this task without an explicit instruction from the user.** Push, MR and merge each
require it.

- [ ] **Step 1: Merge `origin/main` first** and read what arrived

```bash
git fetch origin && git merge origin/main
git diff HEAD@{1} --stat -- src/app/version.ts .gitlab-ci.yml package.json
```
★ `main` moved under the last two branches mid-review and brought new blocking gates each time. Diff
`version.ts` against `origin/main` before choosing the number — 0.262.0 may already be taken.

- [ ] **Step 2: Confirm the codename is still free**

```bash
grep -c '"Swainston"' CHANGELOG.md   # expect 0; spare: Marske
```

- [ ] **Step 3: Bump and propagate**

Edit `src/app/version.ts` — `APP_VERSION`, `APP_BUILD_DATE`, `APP_MILESTONE` — then:

```bash
npm run version:sync
npm run version:check; echo "EXIT=$?"
```
Expected `EXIT=0`. **Exit 1 is drift; exit 2 means the gate could not do its job** — they demand
opposite responses.

- [ ] **Step 4: Write the `CHANGELOG.md` entry** in user-facing language. ★★ **No
      `[session link removed]…` URL in `CHANGELOG.md` or the MR description.** Commit trailers are
      fine.

- [ ] **Step 5: Run the gates**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src scripts e2e; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```

Then the unit suite **in three shards** — it exceeds the 10-minute tool timeout and its vitest child
**survives the kill**, so never background it and never run two at once:

```bash
npx vitest run --shard=1/3 > /tmp/s1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/s1.log
npx vitest run --shard=2/3 > /tmp/s2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/s2.log
npx vitest run --shard=3/3 > /tmp/s3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/s3.log
```

- [ ] **Step 6: Axe, at one worker**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 > /tmp/axe.log 2>&1; echo "EXIT=$?"
```
★★ Local axe runs at CPU-count while CI runs `workers: 1`; over-subscribed it dies on
`Test timeout of 60000ms exceeded` inside `page.evaluate`, which prints as a failure with no
violation text. A timeout is **contention, not a violation** — read the failure body, not the summary.

- [ ] **Step 7: Push, open the MR, poll the MR-ref pipeline, merge only on green.** Never
      `--auto-merge`. Before merging, verify the pipeline sha, the MR sha and local HEAD all match.

---

## What this plan does NOT do

- **§246** — `InfoTooltip` (139 call sites across 34 files) and `SortResizeTh` (three Reports tables
  sharing generic column labels), plus the undecided roles-editor same-purpose question and a second
  forced split of `budget-panel.tsx`. Its own slice.
- **§245** — the property-based scan of the whole surface.
- **`ManualPercentCell`'s** free-text residual in `budget-panel.tsx` — needs `buildRowTokens` inside a
  file with four lines of headroom. Goes with §246, which opens that file anyway.
- **Eye-verification.** None of this is Turso-gated, so the unit tests genuinely are the coverage —
  but axe cannot see duplicate names in any view, so "every automated layer is green" is a narrower
  statement than it sounds. Say so in the MR.
