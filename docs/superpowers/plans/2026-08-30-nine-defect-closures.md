# Nine defect closures — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close nine independently-verified user-visible defects — §36(b), §88, §109 (sub-item),
§120, §128, §148, §271, §276, §296 — each in its own commit, then bump to 0.268.0.

**Architecture:** Nine unrelated fixes sharing no source file. Five are accessible-name defects
closed by shared primitives that already exist and are unused at the call site (`useRowTokens` /
`rowLabel`, `nameContext`, `useId` + `role="group"`, `nameField`). Four are silent losses in async
lifecycles and one export projection. No new modules, no new UI, no data-shape change.

**Tech stack:** Next.js 16.2.11 · React · TypeScript · vitest + Testing Library · Playwright/axe (CI
only).

**Design:** `docs/superpowers/specs/2026-08-30-nine-defect-closures-design.md`. Read it before
starting; it carries the register corrections and the vacuity traps in full.

---

## File structure

Every unit touches one or two source files plus an existing test file. **No two units share a source
file**, so tasks 1–9 may be built in any order and in parallel batches.

| Task | Source | Test (all exist) |
|---|---|---|
| 1 §271 | `src/app/version-diff.ts` | `src/app/version-diff.test.ts` |
| 2 §109 | `src/app/workspace-section-chrome.tsx` | `src/app/workspace-section-chrome.test.tsx` |
| 3 §88 | `src/app/settings-sections/ai-section.tsx` | `src/app/settings-sections/ai-section.test.tsx` |
| 4 §276 | `src/app/projects-panel.tsx` | `src/app/projects-panel.test.tsx` |
| 5 §296 | `src/app/raid-report-panel.tsx`, `src/app/resources-report.tsx` | `src/app/raid-report-panel.test.tsx`, `src/app/resources-report.test.tsx` |
| 6 §128 | `src/app/use-timelog-sync.ts` | `src/app/use-timelog-sync.test.ts` |
| 7 §148 | `src/app/use-chat-threads.ts` | `src/app/use-chat-threads.test.tsx` |
| 8 §120 | `src/app/use-insight-recommend-runner.ts` | `src/app/use-insight-recommend-runner.test.ts` |
| 9 §36b | `src/app/export-sections.ts` | `src/app/export-sections.test.ts` |
| 10 | `docs/open-followups.md` | — |
| 11 | `CHANGELOG.md`, `src/app/version.ts` (+ `version:sync`) | — |

★★★ **Every `src/app/*.ts(x)` is CRLF.** Use `Edit`, never `Write`, on an existing source file —
`Write` re-lines the file to LF, which `git diff` will not show you. `docs/**` and `CHANGELOG.md` are
LF. Never touch `src/app/i18n.de.ts` with `Edit`.

★★★ **Never read a gate's exit code through a pipe.** Redirect, check unpiped, then read the file:
```bash
npx vitest run src/app/<file>.test.ts > "$SCRATCH/t.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t.log"
```
Logs go in the session scratchpad, never `/tmp`. Never run two vitest processes at once — a red
carrying `Failed to start forks worker` is contention; retry, do not debug.

---

## Task 1: §271 — document-version rows are labelled `#<id>`

**Files:**
- Modify: `src/app/version-diff.ts` (the `documentVersions` row of `COLLECTION_SPECS`)
- Test: `src/app/version-diff.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/app/version-diff.test.ts`, add a test asserting a `documentVersions` change carries the
version's title as its `recordLabel`. Build the two workspaces the way the file's existing
`documentVersions` or `documents` tests do (copy the nearest existing fixture shape — do not invent a
new one), with one `DocVersion` whose `title` is `"Q3 report"`, and assert:

```ts
expect(change.recordLabel).toBe("Q3 report");
```

- [ ] **Step 2: Run it and confirm it fails for the stated reason**

```bash
npx vitest run src/app/version-diff.test.ts > "$SCRATCH/t1.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |expected" "$SCRATCH/t1.log"
```
Expected: FAIL, received `"#<id>"` (a `#` followed by the version's numeric id) rather than
`"Q3 report"`. ★ If it fails any other way the fixture is wrong, not the code — fix the fixture
before proceeding.

- [ ] **Step 3: Add the name source**

In `COLLECTION_SPECS`, change the `documentVersions` row from:
```ts
  { key: "documentVersions", label: "Document versions", kind: "list", restorable: false },
```
to:
```ts
  { key: "documentVersions", label: "Document versions", kind: "list", nameField: "title", restorable: false },
```

★ That is the entire fix. Do **not** add tokenising here: `version-diff-view.tsx` already runs
`buildRowTokens` over `recordLabel` and feeds `rowLabel(...)` into every per-row `aria-label`, so
several versions of one document — which share a title by construction — already disambiguate to
` (1)`/` (2)` in the accessible names.

- [ ] **Step 4: Run the test again**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/version-diff.ts src/app/version-diff.test.ts
git commit --only src/app/version-diff.ts src/app/version-diff.test.ts -m "fix: label document-version rows by title instead of #id (§271)"
```

---

## Task 2: §109 — the collapse chevron has no `aria-label`

**Files:**
- Modify: `src/app/workspace-section-chrome.tsx`
- Test: `src/app/workspace-section-chrome.test.tsx`

★★ **Framing, so the commit message does not repeat the register's error:** this button DOES have an
accessible name — `title` is the accname algorithm's last resort — so axe's `button-name` passes it.
The defect is that `title` is hover-only, unreachable on touch, and handled inconsistently by
voice-control stacks. It is *poor*, not *broken*.

- [ ] **Step 1: Write the failing test**

```ts
it("names the collapse control without relying on title", () => {
  // ★ `title` alone IS a valid accessible name (accname's last resort), so this
  //   assertion passes today. The point is the ATTRIBUTE, which is what voice
  //   control and touch AT actually reach — assert on that directly.
  render(/* the existing harness this file already uses */);
  const btn = screen.getByRole("button", { name: /* the collapse string */ });
  expect(btn).toHaveAttribute("aria-label");
});
```

★★★ **VACUITY WARNING.** A `getByRole("button", {name})` assertion ALONE passes today, because
`title` supplies that name — it would be green with the fix reverted. The `toHaveAttribute("aria-label")`
line is the one that fails. Keep both: the role query proves the name still resolves, the attribute
assertion proves *how*.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/workspace-section-chrome.test.tsx > "$SCRATCH/t2.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t2.log"
```
Expected: FAIL on the missing `aria-label` attribute.

- [ ] **Step 3: Add the label**

The button currently reads:
```tsx
        <button
          type="button"
          onClick={() => setWorkspaceCollapsed((v) => !v)}
          aria-expanded={!workspaceCollapsed}
          aria-controls="workspace-panels"
          title={
            workspaceCollapsed
              ? t(lang, "workspaceExpand")
              : t(lang, "workspaceCollapse")
          }
```
Add an `aria-label` carrying the same expression, immediately above `title`, and keep `title` (it is
the visible hover affordance):
```tsx
          aria-label={
            workspaceCollapsed
              ? t(lang, "workspaceExpand")
              : t(lang, "workspaceCollapse")
          }
```
★ No new i18n keys — both strings already exist.

- [ ] **Step 4: Run the test again.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace-section-chrome.tsx src/app/workspace-section-chrome.test.tsx
git commit --only src/app/workspace-section-chrome.tsx src/app/workspace-section-chrome.test.tsx -m "fix: give the workspace collapse control a real aria-label (§109)"
```

---

## Task 3: §88 — the Settings "AI Assistant" sub-heading is a styled `<span>`

**Files:**
- Modify: `src/app/settings-sections/ai-section.tsx`
- Test: `src/app/settings-sections/ai-section.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
it("exposes the AI Assistant section as a named group", () => {
  render(/* the existing harness this file already uses */);
  expect(screen.getByRole("group", { name: t("en-US", "aiAssistant") })).toBeInTheDocument();
});
```
★ `Lang` has no `"en"` — use `"en-US"`.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/settings-sections/ai-section.test.tsx > "$SCRATCH/t3.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t3.log"
```
Expected: FAIL — no such role, the title is a `<span>`.

- [ ] **Step 3: Apply the pattern already used in this same file**

Current:
```tsx
    <div className="mb-4">
      <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
        {t(lang, "aiAssistant")}
        <InfoTooltip text={t(lang, "aiAssistantTooltip")} />
      </span>
```
Mint an id alongside the existing `behaviourHeadingId` (`const aiHeadingId = useId();`) and mirror the
"Assistant behaviour" block: put `role="group"` + `aria-labelledby={aiHeadingId}` on the wrapping
`<div>`, and give the label a `<p id={aiHeadingId}>` carrying `{t(lang, "aiAssistant")}`, keeping the
`InfoTooltip` beside it.

★★ Do NOT use `<h3>`. `AiSection` has four mount surfaces — `backend-setup-wizard.tsx`,
`project-empty-state.tsx`, `settings-menu.tsx`, `settings-view.tsx` — and only `settings-view.tsx`
supplies an `<h2>` ancestor, so a bare `<h3>` breaks the document outline on three of the four.

- [ ] **Step 4: Correct the sibling block's own comment**

The "Assistant behaviour" comment a few lines below says an `<h3>` would be
"tripping axe's heading-order rule". **That is wrong and must be corrected in the same commit**, or
it re-teaches the false claim: `heading-order` is tagged `cat.semantics,best-practice` only, and
`e2e/a11y.spec.ts` requests `wcag2a wcag2aa wcag21a wcag21aa` — so the gate never runs it and CI
stays green either way. Reword to say the `<h3>` would break the document outline for heading
navigation on the three surfaces with no `<h2>` ancestor, which is the real and sufficient reason.
Verify before writing:
```bash
node -e "const a=require('axe-core');const r=a.getRules().find(x=>x.ruleId==='heading-order');console.log(r.tags.join(','))"
```

- [ ] **Step 5: Run the test again.** Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-sections/ai-section.tsx src/app/settings-sections/ai-section.test.tsx
git commit --only src/app/settings-sections/ai-section.tsx src/app/settings-sections/ai-section.test.tsx -m "fix: expose the AI Assistant settings block as a named group (§88)"
```

---

## Task 4: §276 — every archived-project control carries the bare verb

**Files:**
- Modify: `src/app/projects-panel.tsx`
- Test: `src/app/projects-panel.test.tsx`

★★ This collides **unconditionally** — every archived row emits the identical `"Restore"` — so the
primary pin uses rows with DISTINCT names.

- [ ] **Step 1: Write both failing tests, as SEPARATE `it()` blocks**

vitest aborts at the first hard assertion, so two behaviours in one block leaves the second unproved.

```ts
import { expectRowUniqueNames } from "../test/row-unique-names";

it("gives every archived row's controls a row-unique name", () => {
  // Two archived projects with DIFFERENT names. requireCollisionSeed stays OFF:
  // the names differ, so the guard would throw against correct code.
  render(/* panel with two archived projects, names "Apollo" and "Borealis" */);
  expectRowUniqueNames({ minControls: /* exact measured count */, requireCollisionSeed: false });
});

it("numbers archived rows that share a name", () => {
  // Two archived projects with the SAME name -> occurrence suffixes.
  render(/* panel with two archived projects, both named "Apollo" */);
  expectRowUniqueNames({ minControls: /* exact measured count */, requireCollisionSeed: true });
});
```

★★★ `requireCollisionSeed` strips ONLY the occurrence suffix ` (N)`. It is **on** here (this fix
disambiguates with `buildRowTokens`, which emits ` (N)`) and **off** in Task 5 (which disambiguates
with ` – <context>`). Getting these backwards costs a debug cycle.

★ Set `minControls` to the value you actually MEASURE for each fixture, not a round number — a loose
floor lets a silently narrowed `roles` list back in. **To measure it:** pass a deliberately impossible
floor (`minControls: 9999`) and run once; the helper throws and the message names how many controls
the scope actually rendered. Use that exact number. Do not guess and do not round.

- [ ] **Step 2: Run and confirm both fail**

```bash
npx vitest run src/app/projects-panel.test.tsx > "$SCRATCH/t4.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t4.log"
```
Expected: both FAIL, reporting duplicate accessible names `"Restore"` and `"Delete permanently"`.

- [ ] **Step 3: Thread row tokens**

Declare the accessor at **module scope**:
```ts
const nameOfProject = (p: ProjectRegistryEntry) => p.name;
```
★★★ An inline `(p) => p.name` is a fresh closure every render: it defeats `useRowTokens`'s `useMemo`
AND trips `react-hooks/exhaustive-deps`, which is FATAL here under `--max-warnings=0`.

In the component, `const archivedTokens = useRowTokens(archivedProjects ?? [], nameOfProject);` and in
the `.map`, give each button an `aria-label`:
```tsx
aria-label={rowLabel(t(lang, "projectsRestore"), archivedTokens.get(p.id) ?? p.name)}
```
and the same shape with `projectsDeletePermanently` for the destructive button.

★ Do NOT touch the non-archived rows. Their `projectsEdit` / `projectsExport` controls render inside
an `isCurrent ?` branch, so exactly one row shows them and they do not collide.

- [ ] **Step 4: Run the tests again.** Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/projects-panel.tsx src/app/projects-panel.test.tsx
git commit --only src/app/projects-panel.tsx src/app/projects-panel.test.tsx -m "fix: give archived-project row controls row-unique accessible names (§276)"
```

---

## Task 5: §296 — one column label heads several columns in one view

**Files:**
- Modify: `src/app/raid-report-panel.tsx`, `src/app/resources-report.tsx`
- Test: `src/app/raid-report-panel.test.tsx`, `src/app/resources-report.test.tsx`

**The rule:** in each of these theads the FIRST column's label is already the table's own title and
is unique; every OTHER column whose label is shared with a co-rendered table takes
`nameContext={<that table's title>}`. `SortHeaderButton` composes
`aria-label={`${label} – ${nameContext}`}` internally, so WCAG 2.5.3 containment holds by
construction.

★ Do NOT blanket-apply it. AGENTS.md: a single table needs nothing, and qualifying a non-colliding
header adds noise to every screen reader. **Let the test enumerate** — if the list below misses one,
Step 2 goes red and you add it.

**Verified co-render:** `RaidReportPanel`'s `summary` view renders SeverityTable, StatusTable,
OwnerTable, TopOpenTable, CategoryTable and AgingTable together; the `full` view renders only
DetailTable. `ResourcesReport` renders ByPeriodTable, three `ByGroupTable`s and the per-person table
in one `content`.

- [ ] **Step 1: Write the failing tests**

One per file:
```ts
import { expectRowUniqueNames } from "../test/row-unique-names";

it("keeps every sortable header distinct across the co-rendered tables", () => {
  render(/* the panel, summary view, with rows in every table */);
  expectRowUniqueNames({ minControls: /* exact measured count */, requireCollisionSeed: false });
});
```
★★★ `requireCollisionSeed` MUST be `false` here — the guard strips only ` (N)`, and this fix
disambiguates with ` – <context>`, so `true` would throw against correct code.

★ The fixture must populate every table; an empty table renders no headers and the test passes
vacuously.

- [ ] **Step 2: Run both and confirm they fail**

```bash
npx vitest run src/app/raid-report-panel.test.tsx src/app/resources-report.test.tsx > "$SCRATCH/t5.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t5.log"
```
Expected: FAIL, naming the duplicated header names. **Record the reported duplicates** — that list is
the authoritative work list for Step 3.

- [ ] **Step 3: Pass `nameContext` at the colliding headers**

`raid-report-panel.tsx`:
- `RaidCountHead` (rendered by SeverityTable and OwnerTable): add
  `nameContext={t(lang, firstLabelKey)}` to its five NON-first `SortResizeTh` (Risk, Assumption,
  Issue, Dependency, Total). The first already uses `label={t(lang, firstLabelKey)}`.
- `StatusTable`: add `nameContext={t(lang, "raidReportByStatus")}` to its Open column.
- `CategoryTable`: add `nameContext={t(lang, "raidReportByCategory")}` to Open, Closed and Overdue.

★ `AgingTable` uses raw non-sortable `<th>` elements, not `SortResizeTh`, so its "Open" header is not
a control and is out of scope for 2.4.6. Leave it.

`resources-report.tsx`:
- `ByGroupTable`: add `nameContext={title}` to its four NON-first columns (Headcount, Capacity days,
  Internal cost, External cost). The first already uses `label={title}`. One edit fixes all three
  instances.
- `ByPeriodTable` and the per-person table: add `nameContext` of their own titles to whichever of
  their columns Step 2 reported as duplicated.

★ No new i18n keys anywhere in this task — every context string is a title already in scope.

- [ ] **Step 4: Run both tests again.** Expected: PASS. If a name is still duplicated, add the
  `nameContext` the failure names and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/app/raid-report-panel.tsx src/app/resources-report.tsx src/app/raid-report-panel.test.tsx src/app/resources-report.test.tsx
git commit --only src/app/raid-report-panel.tsx src/app/resources-report.tsx src/app/raid-report-panel.test.tsx src/app/resources-report.test.tsx -m "fix: qualify duplicate report column headers with nameContext (§296)"
```

---

## Task 6: §128 — Timelog sync reports "idle" while a superseded run is in flight

**Files:**
- Modify: `src/app/use-timelog-sync.ts` (`runGuarded`'s `finally`)
- Test: `src/app/use-timelog-sync.test.ts`

- [ ] **Step 1: Write the failing test**

Start a `runGuarded` call whose `work` stays pending and rejects on abort. Start a second one,
superseding it. Flush the first's rejection. Assert `busy` is still `true` while the successor is
pending; then resolve the successor and assert `busy` becomes `false`.

★★★ **VACUITY TRAP — the reason this test is easy to get wrong.** The successor's own `setBusy(true)`
makes `busy === true` regardless of the fix. The assertion must be made AFTER the superseded run's
rejection has flushed (await a microtask inside `act`) and WHILE the successor is still pending —
otherwise it passes with the fix reverted. Verify by reverting the fix and watching it go red before
you commit.

★ The first run's `work` must genuinely settle on abort. A mock that ignores the signal never reaches
the `finally` and the test proves nothing.

★ Resolving the successor at the end is not optional — without it the opposite failure (busy stuck on
forever) is untested.

- [ ] **Step 2: Run and confirm it fails**

```bash
npx vitest run src/app/use-timelog-sync.test.ts > "$SCRATCH/t6.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t6.log"
```
Expected: FAIL — `busy` is `false` while the successor is still running.

- [ ] **Step 3: Move the setter inside the existing guard**

From:
```ts
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
```
to:
```ts
    } finally {
      // ★★ BOTH statements are guarded on the SAME identity test, and that is
      //    the point: a SUPERSEDED run must not clear a flag its successor has
      //    already raised. The identity test IS the generation check — the only
      //    writers of `abortRef.current` are this function's own assignment and
      //    this guarded null, and `cancel()` aborts WITHOUT nulling the ref, so
      //    a user-cancelled (not superseded) run still matches here and clears
      //    busy. A superseded run that skips the clear is always followed by a
      //    successor whose own `finally` clears it.
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
```

- [ ] **Step 4: Run the test again.** Expected: PASS. Then revert the fix, re-run, and confirm RED —
  the anti-vacuity proof. Restore the fix.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-timelog-sync.ts src/app/use-timelog-sync.test.ts
git commit --only src/app/use-timelog-sync.ts src/app/use-timelog-sync.test.ts -m "fix: keep the Timelog busy flag raised when a run is superseded (§128)"
```

---

## Task 7: §148 — Retry after a failed load wipes a message the user just sent

**Files:**
- Modify: `src/app/use-chat-threads.ts` (`retryLoad`'s reload branch)
- Test: `src/app/use-chat-threads.test.tsx`

**Read first:** the mount-fetch `useEffect` in the same file. It captures
`const startedOn = threadIdRef.current;` before `loadThreads(...)` and guards BOTH settle branches
with `if (threadIdRef.current !== startedOn)`. The `.then` branch MERGES — keeping locally-held rows
filtered to `th.projectId === projectId && !loaded.some((l) => l.id === th.id)` ahead of `loaded` —
and the `.catch` filters to this project rather than blanking. `retryLoad`'s reload branch has
NEITHER guard.

**The drop path:** initial fetch fails → `pendingRetryRef` empty → Retry falls through to the reload.
A send begun between click and resolve calls `ensureThreadForSend`, which mints an id and writes
`threadIdRef.current` SYNCHRONOUSLY. The resolving reload's `loaded` cannot contain that row, so
`setThreads(loaded)` drops it; `setActiveThreadId` then changes the active id, which makes the
`threadIdRef` sync effect abort the in-flight send; `setHistory`/`setDisplay` replace the user's turn.

- [ ] **Step 1: Write both failing tests, as SEPARATE `it()` blocks**

One for the `.then` settle branch, one for the `.catch`. The `.catch` is the destructive one and a
`.then`-only test leaves it open.

★★★ **VACUITY TRAP.** The failed-initial-fetch precondition must be set up explicitly. Any fixture
that leaves `pendingRetryRef` non-empty returns at the FIRST branch of `retryLoad`, and the test then
passes whichever way the reload is written. Assert you reached the reload.

★★★ The mid-flight mint must move `threadIdRef.current`, not just `activeThreadId` state —
`ensureThreadForSend` sets the ref synchronously and the ref is what the guard reads. A test that
only sets state proves nothing.

- [ ] **Step 2: Run and confirm both fail**

```bash
npx vitest run src/app/use-chat-threads.test.tsx > "$SCRATCH/t7.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t7.log"
```
Expected: FAIL — the just-minted thread is absent from `threads` and the active id has moved.

- [ ] **Step 3: Extract the guard and apply it to the reload branch**

Extract the effect's `startedOn` handling into one helper (module scope, taking `startedOn`,
`projectId` and `loaded`) and call it from BOTH the effect and `retryLoad`, so the two cannot drift.
In `retryLoad`, capture `const startedOn = threadIdRef.current;` immediately before `loadThreads(...)`
and route both settle branches through the helper.

★★ Do NOT close this by reusing the effect's body wholesale. The effect also clears `pendingRetryRef`
and `latestSeqRef` as project-switch semantics, and `retryLoad` must not do that.

- [ ] **Step 4: Run the tests again.** Expected: both PASS. Then revert the fix, re-run, and confirm
  BOTH go red — if only one does, the other is vacuous. Restore the fix.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-chat-threads.ts src/app/use-chat-threads.test.tsx
git commit --only src/app/use-chat-threads.ts src/app/use-chat-threads.test.tsx -m "fix: stop retryLoad dropping a thread minted mid-flight (§148)"
```

---

## Task 8: §120 — navigating away does not stop up to three billed AI calls

**Files:**
- Modify: `src/app/use-insight-recommend-runner.ts`
- Test: `src/app/use-insight-recommend-runner.test.ts`

**Verified state:** the file contains ZERO occurrences of `AbortController` or `signal`. Its tick
awaits `runInsightRecommendation({ apiKey, model, context, index, today })` inside
`for (const insight of candidates)`, where `candidates` is `.slice(0, MAX_BG_RECS_PER_TICK)` and
`MAX_BG_RECS_PER_TICK = 3` (`insights/insight.ts`). The loop is serial. Both effect cleanups only
remove a `visibilitychange` listener and clear an interval.

★ This is a missing THREAD, not a missing capability: `RecommendCallArgs` already declares
`signal?: AbortSignal` and `runInsightRecommendation` forwards it to `runForcedToolCall`.

- [ ] **Step 1: Write the failing test**

```ts
it("aborts an in-flight recommendation when the runner unmounts", async () => {
  let captured: AbortSignal | undefined;
  // mock runInsightRecommendation to capture args.signal and return a pending promise
  const { unmount } = renderHook(/* ... */);
  await /* let the mount tick issue the first call */;
  expect(captured).toBeDefined();
  expect(captured!.aborted).toBe(false);
  unmount();
  expect(captured!.aborted).toBe(true);
});
```

★★★ **VACUITY TRAP.** Asserting on the argument object handed to a MOCKED
`runInsightRecommendation` proves only that a `signal` key was spelled. Capture the signal and assert
`aborted` false → true across the unmount — the shape `use-tasks-dedup.tsx`'s test was
mutation-proved with.

★★★ The mount effect fires a tick immediately, so the test MUST hold the first call pending before
unmounting. If the loop has already finished, the abort lands on nothing and the test passes with the
cleanup deleted.

- [ ] **Step 2: Run and confirm it fails**

```bash
npx vitest run src/app/use-insight-recommend-runner.test.ts > "$SCRATCH/t8.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t8.log"
```
Expected: FAIL — `captured` is `undefined` (no `signal` is passed at all).

- [ ] **Step 3: Thread the signal and exit the loop**

Copy the shape from `src/app/use-abortable-ai.ts` (same shape in `use-alloc-plan.tsx`,
`use-action-analysis.ts`, `use-inline-entity-edit.ts`, `use-raci-suggest.tsx`, `use-tasks-dedup.tsx`):
add `const abortRef = useRef<AbortController | null>(null);`, mint a controller per tick and assign
it, pass `signal: controller.signal` into `runInsightRecommendation`, and add:
```ts
useEffect(() => () => abortRef.current?.abort(), []);
```

★★★ **The signal alone is NOT the fix.** The per-candidate `catch` currently swallows anything that
is not a limit/auth `AiHttpError` and CONTINUES. Without a `break` on abort the loop walks candidates
2 and 3 after unmount; they reject immediately so nothing is billed, but
`applyRecommendationRef.current` is still a post-unmount state write for any call that resolved
before the abort landed. Add the abort check and `break`.

★ `isRunningRef` is cleared only in the `finally`, which still runs — so no deadlock. But do not add
an early return that bypasses that `finally`, or the overlap guard stays armed forever.

- [ ] **Step 4: Run the test again.** Expected: PASS. Then delete the cleanup line alone, re-run, and
  confirm RED. Restore it.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-insight-recommend-runner.ts src/app/use-insight-recommend-runner.test.ts
git commit --only src/app/use-insight-recommend-runner.ts src/app/use-insight-recommend-runner.test.ts -m "fix: abort in-flight insight recommendations on unmount (§120)"
```

---

## Task 9: §36(b) — a note log exports as a raw JSON blob

**Files:**
- Modify: `src/app/export-sections.ts` (the task, RAID and change section builders)
- Test: `src/app/export-sections.test.ts`

**Verified state:** `buildExportSections` builds each section from `<ENTITY>_CSV_COLUMNS` and maps
each cell through `richCell(fieldToString(row, col), col, <ENTITY>_RICH_COLUMNS)`. `noteLog` is in
those column lists, `fieldToString` and its RAID/change siblings return `encodeNoteLog(...)`, and
`encodeNoteLog` is literally `JSON.stringify(log)` (returning `""` when empty). `noteLog` is
correctly in none of the `*_RICH_COLUMNS` sets, so the JSON string passes straight through.

★★ **THREE registers, not two** — Changes carry `noteLog` too. ★★ **FIVE surfaces, not four** — the
four document formats route through this one builder (PDF via `buildPdfHtml`, the HTML renderer's
standalone mode), and `doc-data-section.ts` `resolveDataSection` is a SECOND consumer, so
`dataSection` blocks inside project Documents show the blob as well.

- [ ] **Step 1: Write the failing test**

Assert on **all three** registers in separate `it()` blocks — one is not evidence for the others,
since each has its own `fieldToString`. For each: a row carrying a two-entry note log exports as
readable lines, and the cell does not start with `[{`.

```ts
expect(cell).not.toMatch(/^\[\{/);
expect(cell).toContain("Alice · 2026-08-14 · Chased the vendor");
```

- [ ] **Step 2: Run and confirm all three fail**

```bash
npx vitest run src/app/export-sections.test.ts > "$SCRATCH/t9.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t9.log"
```
Expected: FAIL, received the serialized array.

- [ ] **Step 3: Project the column in the section builders**

In `export-sections.ts` only, map the `noteLog` cell through a local helper that decodes the stored
value and renders one line per entry as `author · date · text`.

★★★ **THE TRAP THAT MAKES AN OBVIOUS FIX A DATA-LOSS BUG.** Do NOT fix this in `encodeNoteLog`,
`fieldToString`, or any `*_CSV_COLUMNS`. Those are the storage serializers for CSV, Markdown AND both
Turso layouts. Emitting readable text there makes `decodeNoteLog` unable to parse it back — silent
note-log loss on the next load — and would force a golden regeneration to mask a real format
regression.

★★ Project from `NoteLogEntry.text`, NEVER `.html`. `.text` is the maintained plain projection,
re-derived after sanitising (§36(a)); `.html` would put raw markup into XLSX and PPTX cells.

★★ The date is the ISO date part of `timestamp` (`slice(0, 10)`), NOT a localized display timestamp.
`buildExportSections(ws, cfg, lang)` receives no timezone, so the UI's
`formatDisplayTimestamp(ts, tz, lang)` is unreachable without a signature change across both
consumers; ISO also matches every neighbouring date column and keeps the test free of timezone and
locale dependency.

★ Use `noteLogNoAuthor` (exists in both `i18n.ts` and `i18n.de.ts`) for a missing author.
`export-sections.ts` already receives `lang` and calls `t(...)`. **If a new key proves necessary** it
lands in BOTH dictionaries, and `i18n.de.ts` must be patched by an anchored node utf8 write matching
`\r\n` — never the `Edit` tool.

★ An empty note log must stay an empty cell: `encodeNoteLog` already returns `""` for empty, and the
projection must not turn that into a stray separator.

- [ ] **Step 4: Run the tests again.** Expected: all three PASS.

- [ ] **Step 5: Confirm the goldens did NOT move**

```bash
npx vitest run src/app/golden-workspace.test.ts > "$SCRATCH/t9g.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t9g.log"
```
Expected: PASS with no fixture regeneration. `golden-workspace.test` pins
`workspaceToCsv`/`workspaceToMarkdown`, which never reach this builder. **If it goes red, the fix
landed in a storage serializer — revert and re-read the trap above.** Never regenerate the fixtures
to make this green.

- [ ] **Step 6: Commit**

```bash
git add src/app/export-sections.ts src/app/export-sections.test.ts
git commit --only src/app/export-sections.ts src/app/export-sections.test.ts -m "fix: export note logs as readable text, not a JSON blob (§36b)"
```

---

## Task 10: Register closures and corrections

**Files:** Modify `docs/open-followups.md` (LF, not CRLF)

- [ ] **Step 1: Close the nine entries, four places each**

Each of §36, §88, §109, §120, §128, §148, §271, §276, §296 needs: the `##` heading marked, the
summary-table status cell, the table anchor (**derived from the heading, so it moves when the heading
does**), and the `**Status:**` witness. A body line must NEVER contain the word CLOSED.

★★ **§36 and §109 resolve in OPPOSITE directions — read each heading, do not pattern-match.**
- §36's heading is `(a) FIXED 2026-08-28; (b) still open, small`. Closing (b) closes the WHOLE entry,
  so it DOES take `— CLOSED`.
- §109's heading is `open, ratchet` and its main tooltip inventory stays open, so it must NOT carry
  `— CLOSED`. Say what landed in other words and keep the open part in the heading.

- [ ] **Step 2: Write the three factual corrections**

- §36: it says "a task or RAID row" and four formats. Correct to three registers (Changes carry
  `noteLog`) and five surfaces (`resolveDataSection` is a second consumer of `buildExportSections`).
- §109: it says the chevron has no accessible name. It has one — `title` is accname's last resort —
  so axe's `button-name` passes it. The defect is poor discoverability, not a gate failure.
- §88: it says an `<h3>` would trip axe's `heading-order`. That rule is `best-practice`-tagged and
  outside the gate's four requested tags, so it never runs. The recommendation stands on the
  screen-reader argument.

- [ ] **Step 3: Fix §163's heading (shipped by the previous slice)**

It reads `— denominator FIXED 2026-08-17, numerator CLOSED 2026-08-30`. It is the ONLY heading in the
file containing CLOSED outside the `— CLOSED` marker shape, so the register's own partial-listing
command mislists a fully-closed entry as an open partial while `isClosed()` counts it closed. Both
halves are fixed — give it the marker shape, and update the summary-table row AND its anchor.

Confirm it is the only one:
```bash
grep -E "^## [0-9]+\." docs/open-followups.md | grep "CLOSED" | grep -v "— CLOSED"
```
Expected after the fix: no output.

- [ ] **Step 4: File two new entries for the deferred items**

Mint numbers ONLY against `origin/main` (`git fetch origin` first) — a register number is reserved
only once it is there.
1. Export section headers are raw field keys (`noteLog`, `dueDate`) while `ExportSection.columns`
   documents itself as "display labels". Affects every register section.
2. Version-diff rows whose `recordLabel` matches render identical VISIBLE text; only the accessible
   name disambiguates. Pre-existing and general, not introduced by §271.

Each needs a `**Status:**` line with an ISO date that either cites an executed command or says
`never machine-verified`. **Do not invent a verification** — `never machine-verified` is conforming
and is the honest answer for an unprobed entry.

★★ **Keep `never machine-verified` unbroken on ONE line.** `followup-status-lib.mjs`'s
`NEVER_VERIFIED_RE` is `/never machine-verified/i` — a literal space, not `\s+` — so a line-wrapped
phrase does not match and `followups:status:check` goes red with `NO_VERIFICATION` while the text
reads correctly to a human. (Verified by reading the regex; reported by a peer session that hit it.)

- [ ] **Step 5: Run the register gates**

```bash
npm run followups:status:check > "$SCRATCH/t10a.log" 2>&1; echo "EXIT=$?"
npm run docs:claims:check     > "$SCRATCH/t10b.log" 2>&1; echo "EXIT=$?"
npm run docs:symbols:check    > "$SCRATCH/t10c.log" 2>&1; echo "EXIT=$?"
```
Expected: all EXIT=0. ★ Exit 1 is DRIFT (fix the content); exit 2 is the gate unable to scan (fix the
gate's input). `docs:claims:check` is a RATCHET — register prose cites SYMBOLS and commands, never
`path:LINE`.

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md
git commit --only docs/open-followups.md -m "docs: close nine defect entries and correct three false claims"
```

---

## Task 11: CHANGELOG and version bump

**Files:** Modify `CHANGELOG.md` (LF), `src/app/version.ts`, then propagate.

- [ ] **Step 1: Bump `src/app/version.ts`**

Set `APP_VERSION = "0.268.0"`, `APP_BUILD_DATE = "2026-08-30"`, and a new milestone codename with a
one-line comment naming this slice, matching the shape of the existing entries.

- [ ] **Step 2: Propagate to the other five places**

```bash
npm run version:sync > "$SCRATCH/t11a.log" 2>&1; echo "EXIT=$?"
npm run version:check > "$SCRATCH/t11b.log" 2>&1; echo "EXIT=$?"
```
Expected: both EXIT=0. ★ NEVER hand-edit the satellites (`package.json`, both `package-lock.json`
entries, the README badge, the five codemap headers). ★ Exit 1 is drift, exit 2 is the gate unable to
scan.

- [ ] **Step 3: Add the CHANGELOG entry**

One `### Fixed` block for the nine, written in user-facing terms — what the user saw, not which
symbol changed. ★ NEVER put a `[session link removed]...` URL in `CHANGELOG.md`.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS
git commit -m "chore: release 0.268.0"
```

---

## Task 12: Review

- [ ] **Step 1: Run the local gates that are cheap and decisive**

```bash
npx tsc --noEmit > "$SCRATCH/tsc.log" 2>&1; echo "EXIT=$?"
npx eslint --max-warnings=0 src; echo "EXIT=$?"
npm run size:check > "$SCRATCH/size.log" 2>&1; echo "EXIT=$?"
```
★ `tsc` exits **2** on diagnostics, not 1. ★ Use `npx eslint src`, not `npm run lint` — the latter
exits 1 from gitignored `.worktrees/` leftovers.

- [ ] **Step 2: Run the touched test files plus a shuffled pass**

```bash
npx vitest run src/app/version-diff.test.ts src/app/workspace-section-chrome.test.tsx src/app/settings-sections/ai-section.test.tsx src/app/projects-panel.test.tsx src/app/raid-report-panel.test.tsx src/app/resources-report.test.tsx src/app/use-timelog-sync.test.ts src/app/use-chat-threads.test.tsx src/app/use-insight-recommend-runner.test.ts src/app/export-sections.test.ts src/app/golden-workspace.test.ts > "$SCRATCH/suite.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/suite.log"
npm run test:shuffle > "$SCRATCH/shuffle.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/shuffle.log"
```
★ The full suite exceeds the 10-minute local cap — leave it and the coverage floors to CI.

- [ ] **Step 3: One cold review of the whole branch**

Dispatch a reviewer with NO session context over `main..HEAD`. Ask it to refute the brief, not
confirm it, and to attach a command to every claim.

- [ ] **Step 4: A DELETION-ONLY correction round**

Fix findings by DELETING the offending text, not rewriting it. An unrestricted correction round
writes new claims that need their own review; a deletion cannot introduce one. This is the shape that
converged on the previous slice.

★★★ **A correction is a NEW claim and inherits none of the verification of the thing it corrects.**
Run a command against the REPLACEMENT text, not only against the error you found.

---

## Task 13: Release — GATED

★★★ **DO NOT EXECUTE THIS TASK UNTIL THE USER SAYS "release".** This plan does not authorise push,
MR or merge. Nothing in tasks 1–12 may push a branch or open an MR.

- [ ] **Step 1:** Push the branch.
- [ ] **Step 2:** Open the MR. ★ NEVER a `[session link removed]...` URL in the MR description.
- [ ] **Step 3:** Poll the pipeline until every job is terminal. Read job states individually — the
  pipeline uses `needs:` DAG ordering, so a later stage starting does NOT mean an earlier one passed.
- [ ] **Step 4:** Confirm the pipeline SHA equals local HEAD equals remote before merging.
- [ ] **Step 5:** Merge only on green:
  ```bash
  glab mr merge <N> --auto-merge=false --yes
  ```
  ★★★ `glab mr merge` DEFAULTS `--auto-merge=true` — omitting the flag is NOT opting out.
- [ ] **Step 6:** Verify the merge introduced nothing neither parent had:
  ```bash
  git diff origin/main <branch-sha> --stat
  ```
  Expected: empty.
