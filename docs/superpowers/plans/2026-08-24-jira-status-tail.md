# Jira / task-status tail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two Jira/status defects that are wrong under any reading, make a remote status change visible to the user instead of dropping it, and ship a counter that measures how many stored task rows carry a split `status`/`completedDate` pair.

**Architecture:** Four independent changes over existing modules — a pure counter in the status engine, a one-expression guard correction in the Jira conflict merge, one function call added to the template apply path, and a widened conflict-diff plus the modal rendering that follows from it. No new modules; no load-path edits; nothing repairs stored data.

**Tech Stack:** TypeScript, React 19, Next.js 16.2.11, vitest 4.1.8 + @testing-library/react, Playwright (unaffected).

**Spec:** `docs/superpowers/specs/2026-08-24-jira-status-tail-design.md`

---

## Domain primer — read this before Task 1

You are working in a project-management app. A `Task` carries two coupled fields:

- `status: TaskStatus` — one of `"To Do" | "In Progress" | "On Hold" | "In Review" | "Cancelled" | "Done"`.
- `completedDate: string | undefined` — an ISO date, or absent.

**The invariant:** `status === "Done"` ⟺ `completedDate` is set. `status` is the source of truth for "done"; `completedDate` is auto-managed to track it. A row breaking that invariant is called a **split pair**.

The invariant is held by the code paths that WRITE tasks, not by the code that LOADS them. `migrateTask` (`src/app/task-status.ts`) runs on every load path but returns early when `status` is a valid string, so a *valid but inconsistent* pair is never repaired. Split pairs can therefore exist in stored data written by older builds, by hand, or by third-party templates. **This plan does not repair them.** It fixes paths that misbehave when handed one, and counts them.

Background reading, in this order:

1. `docs/AGENTS/task-status.md` — the invariant, the five writers, the prohibitions. **Read it fully.**
2. `docs/open-followups.md` §226, §227, §228 — the three follow-ups this plan addresses.
3. `AGENTS.md` — the "Hard constraints" section, especially i18n and the gate list.

**Two prohibitions that will bite you.** Do NOT route any Jira path through `applyStatusChange` (it stamps today's date over Jira's real resolution date). Do NOT route the Jira conflict merge's LOCAL arm through `reconcileStatusFromDate` — that is follow-up §227's open question and is deliberately out of scope here.

### Running the gates

★★★ **Never read a gate's exit code through a pipe** — you get the pipe's status, not the command's. Redirect, check unpiped, then read the file:

```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```

Single-file runs are fine unpiped:

```bash
npx vitest run src/app/task-status.test.ts
npx tsc --noEmit          # exits 2 on diagnostics, not 1
```

`npx tsc --noEmit` after ANY test edit — `next build` does not typecheck test files and vitest never typechecks, so a test-only type error passes both and fails CI.

### Line endings

Every `src/app/*.ts(x)` file is **CRLF** in the working tree. If you patch one with a node script, your anchor must match `\r\n`, not `\n`, or the replace silently no-ops. Never use `sed -i` on a `src/` file — it re-lines the whole file to LF invisibly. `docs/**` and `*.md` are LF.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/app/task-status.ts` | add `countSplitTaskPairs` | pure, i18n-free status engine. Gains one exported function. |
| `src/app/task-status.test.ts` | add tests | pure-engine tests |
| `src/app/use-jira-sync.ts` | guard fix; pass `localStatus` | Jira sync orchestration hook |
| `src/app/use-jira-sync.test.tsx` | add tests; update two stale comments | |
| `src/app/templates.ts` | export `sanitizeSeedTask` | template sanitising |
| `src/app/template-apply.ts` | reconcile seed tasks on apply | template → workspace |
| `src/app/template-apply.test.ts` | add test | |
| `src/app/jira-api.ts` | pair-aware diff; `localStatus` on `ConflictItem` | pure Jira mapping/diff |
| `src/app/jira-api.test.ts` | add tests | |
| `src/app/jira-conflicts-modal.tsx` | render the completion row as a pair | conflict UI |
| `src/app/jira-conflicts-modal.test.tsx` | add test | |
| `src/app/diagnostics-panel.tsx` | optional `splitPairs` prop + row | diagnostics UI (also mounted by recovery) |
| `src/app/diagnostics-panel.test.tsx` | add tests | |
| `src/app/settings-sections/diagnostics-section.tsx` | compute count, log once | the adapter between workspace and panel |
| `src/app/settings-sections/diagnostics-section.test.tsx` | **create** | |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | one new key | EN/DE key sets must stay identical |
| `docs/AGENTS/task-status.md` | correct the guard description | subsystem reference |
| `docs/open-followups.md` | close §226/§228, narrow §227 | follow-up register |

**Decomposition note.** `settings-sections/diagnostics-section.tsx` is currently a six-line pass-through. It becomes the adapter that reads the workspace and hands the panel a number — which is exactly why the count must NOT be read inside `diagnostics-panel.tsx`: that panel is ALSO mounted by `recovery-panel.tsx`, on a separate route with no `WorkspaceProvider` above it. A `useWorkspace()` call inside the panel would throw there.

---

## Task 1: `countSplitTaskPairs` in the status engine

**Files:**
- Modify: `src/app/task-status.ts`
- Test: `src/app/task-status.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/task-status.test.ts`. Match the file's existing import style — it already imports from `./task-status` and `./types`; add `countSplitTaskPairs` to the existing import list rather than adding a second import statement.

```ts
describe("countSplitTaskPairs", () => {
  // The invariant is `status === "Done"` <=> `completedDate` set. These four
  // rows are the complete truth table for that biconditional, and the fifth is
  // the Cancelled case reconcileStatusFromDate handles by clearing the DATE.
  const row = (over: Partial<Task>): Task =>
    ({
      id: 1,
      taskName: "t",
      status: "To Do",
      createdDate: "2026-01-01",
      lastUpdateDate: "2026-01-01",
      ...over,
    }) as Task;

  it("counts nothing when every pair is consistent", () => {
    const tasks = [
      row({ id: 1, status: "Done", completedDate: "2026-01-01" }),
      row({ id: 2, status: "In Progress", completedDate: undefined }),
      row({ id: 3, status: "To Do", completedDate: "" }),
    ];
    expect(countSplitTaskPairs(tasks)).toBe(0);
  });

  it("counts a Done row with no date", () => {
    expect(countSplitTaskPairs([row({ status: "Done", completedDate: undefined })])).toBe(1);
    expect(countSplitTaskPairs([row({ status: "Done", completedDate: "" })])).toBe(1);
  });

  it("counts a dated row that is not Done", () => {
    expect(countSplitTaskPairs([row({ status: "In Progress", completedDate: "2026-01-01" })])).toBe(1);
  });

  it("counts a Cancelled row carrying a stray date", () => {
    // reconcileStatusFromDate repairs this one by CLEARING the date (status
    // wins for Cancelled), but it is still a broken pair and must be counted.
    expect(countSplitTaskPairs([row({ status: "Cancelled", completedDate: "2026-01-01" })])).toBe(1);
  });

  it("counts a Cancelled row with no date as consistent", () => {
    expect(countSplitTaskPairs([row({ status: "Cancelled", completedDate: undefined })])).toBe(0);
  });

  it("sums across a mixed list and returns 0 for an empty one", () => {
    const tasks = [
      row({ id: 1, status: "Done", completedDate: "2026-01-01" }),
      row({ id: 2, status: "Done", completedDate: undefined }),
      row({ id: 3, status: "To Do", completedDate: "2026-02-02" }),
    ];
    expect(countSplitTaskPairs(tasks)).toBe(2);
    expect(countSplitTaskPairs([])).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/task-status.test.ts`
Expected: FAIL — `countSplitTaskPairs is not a function` (or a TS resolution error on the import).

- [ ] **Step 3: Implement**

Append to `src/app/task-status.ts`, after `reconcileStatusFromDate`:

```ts
/** How many rows break the pair invariant `status === "Done"` ⟺ `completedDate` set.
 *
 *  DIAGNOSTIC ONLY — repairs nothing and is on no load path. It exists because
 *  three open follow-ups (§226, §227, §228) all turn on how many stored rows
 *  are actually split, and none of them could be decided without a number.
 *
 *  ★ Written as the negation of the invariant itself, in ONE expression, so it
 *  cannot drift from the property it measures. That also makes it catch the
 *  `Cancelled`-with-a-stray-date row for free: the date is truthy and the
 *  status is not `Done`, so the biconditional fails — which is right, even
 *  though `reconcileStatusFromDate` repairs THAT row by clearing the date
 *  rather than by promoting the status.
 *
 *  ★ Emptiness is `!!completedDate`, the same test `isTaskDelivered`
 *  (task-closed.ts) and `reconcileStatusFromDate` use. Defining "has a date" a
 *  fourth way is how the four would drift. */
export function countSplitTaskPairs(tasks: readonly Task[]): number {
  let n = 0;
  for (const task of tasks) {
    if (!!task.completedDate !== (task.status === "Done")) n++;
  }
  return n;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/task-status.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Mutation-prove the guard**

Change `!==` to `===` in the new function. Run the tests. Expected: RED, on at least the "counts nothing when every pair is consistent" case. **Revert the mutant** with an inverse anchored write, then confirm `git diff --stat src/app/task-status.ts` shows only your intended addition.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/task-status.ts src/app/task-status.test.ts
git commit -m "feat: count split status/completedDate pairs"
```

---

## Task 2: §227a — the Jira transition guard reads `status`, not the date

**Files:**
- Modify: `src/app/use-jira-sync.ts`
- Test: `src/app/use-jira-sync.test.tsx`

**Context.** In `handleResolveConflicts`, after a local pick the hook pushes to Jira and may transition the issue to done. `taskFieldsToJiraFields` pushes `summary`, `priority`, `labels`, `description` and `duedate` — **no status** — so `transitionIssueTo` is the only route by which local completion reaches Jira here. It currently keys on `merged.completedDate`. On a split row that fires while the local row reads "In Progress", moving a real Jira issue to Done.

- [ ] **Step 1: Write the failing test**

Add to the `describe("useJiraSync — handleResolveConflicts", …)` block in `src/app/use-jira-sync.test.tsx`, next to the existing transition tests. It reuses the file's existing `makeTask`, `renderSync`, `setupCompletionConflict` and `picksAll` helpers.

```ts
  it("does not transition the issue when the merged row is not Done, even with a date", async () => {
    // A SPLIT local row: a completedDate beside a non-Done status. Nothing in
    // src writes this since 0.257.0, but an older build, a hand edit or a
    // third-party template can have stored it (open-followups §227).
    // ★ The fixture MUST be split. With a consistent Done+date row the old and
    //   new guards agree, and this test would pass against the unfixed code.
    const localTask = makeTask({
      id: 1, jiraKey: "TEST-1", status: "In Progress", completedDate: "2026-04-01",
      lastSyncedAt: "2026-01-01T00:00:00", localModifiedAt: "2026-05-01T00:00:00",
    });
    const { result } = renderSync([localTask]);
    await setupCompletionConflict(
      result,
      { status: "In Progress", completedDate: undefined, done: false },
      "2026-04-01",
    );
    vi.clearAllMocks();
    (jiraApi.taskFieldsToJiraFields as ReturnType<typeof vi.fn>).mockReturnValue({});
    (jiraApi.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const resolution: import("./jira-conflicts-modal").ConflictResolution = {
      taskId: 1, jiraKey: "TEST-1", picks: picksAll({ completedDate: "local" }),
    };
    await act(async () => { await result.current.handleResolveConflicts([resolution]); });

    const merged = result.current.currentTasks[0];
    expect(merged.status).toBe("In Progress");
    expect(merged.completedDate).toBe("2026-04-01");
    // The field push still happens — only the completion TRANSITION is gated.
    expect(jiraApi.updateIssue).toHaveBeenCalled();
    expect(jiraApi.transitionIssueTo).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/use-jira-sync.test.tsx -t "does not transition the issue when the merged row is not Done"`
Expected: FAIL — `transitionIssueTo` was called once, because the old guard sees a truthy `merged.completedDate`.

- [ ] **Step 3: Implement**

In `src/app/use-jira-sync.ts`, inside the `if (anyLocalPicked)` block, replace:

```ts
          if (completionChanged && merged.completedDate && !conflict.remoteDone) {
```

with:

```ts
          // ★★★ Gate on `status`, NOT on `completedDate`. `status` is the
          //   source of truth for "done" (docs/AGENTS/task-status.md), and
          //   `taskFieldsToJiraFields` pushes no status — so this transition is
          //   the ONLY route by which local completion reaches Jira on this
          //   path. Keying it on the date moved a real issue to Done off a
          //   SPLIT local row whose status still read "In Progress"
          //   (open-followups §227). On a consistent pair the two are
          //   equivalent, so this changes nothing for well-formed rows.
          if (completionChanged && merged.status === "Done" && !conflict.remoteDone) {
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/use-jira-sync.test.tsx`
Expected: PASS — the whole file, including the two pre-existing transition tests. Both stay green: "conflict (a): pick local" merges `status: "Done"`, and "conflict (b): pick local" merges `status: "In Progress"` with no date.

- [ ] **Step 5: Update the two comments this falsifies**

★★ Prose describing the OLD guard survives in the test file and will mislead the next reader.

In `src/app/use-jira-sync.test.tsx`, the comment block above the transition tests currently reads `if (completionChanged && merged.completedDate && !conflict.remoteDone)` and says the guard "needs FOUR things at once: … a truthy merged completedDate …". Rewrite it to quote the new guard and say **a merged status of "Done"** instead of a truthy date.

In the same file, the "conflict (b): pick local" test ends with the inline comment `// Local pick, but the merged completedDate is undefined → guard fails.` Change it to `// Local pick, but the merged status is "In Progress" → guard fails.` — the outcome is unchanged, the REASON is not.

- [ ] **Step 6: Mutation-prove**

Revert the guard to `merged.completedDate`. Run `npx vitest run src/app/use-jira-sync.test.tsx`. Expected: RED on the new test only. **Revert the mutant** and confirm `git diff` shows only the intended change.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/use-jira-sync.ts src/app/use-jira-sync.test.tsx
git commit -m "fix: gate the Jira completion transition on status, not the date"
```

---

## Task 3: §228 — a template applies identically before and after a reload

**Files:**
- Modify: `src/app/templates.ts`, `src/app/template-apply.ts`
- Test: `src/app/template-apply.test.ts`

**Context.** `templateFromWorkspace` puts LIVE `Task` objects into a template seed by reference. `applyTemplate` hands `tpl.seed` straight to `remapSeed`/`appendSeed`, and that file calls no sanitiser at all. `sanitizeSeedTask` — which reconciles the pair — is reached only from the localStorage LOAD path. So save-then-apply in one session copies the seed unreconciled, while the same template after a reload applies repaired.

- [ ] **Step 1: Write the failing test**

Add to `src/app/template-apply.test.ts`. Match the file's existing fixture helpers; if it has no workspace factory, build a minimal one inline as below.

```ts
  it("reconciles a split task pair when applying a template in the same session", () => {
    // templateFromWorkspace puts LIVE Task objects into the seed by reference,
    // so a split row in the workspace reaches applyTemplate unreconciled. The
    // localStorage load path repairs it via sanitizeSeedTask; before this fix
    // the in-session path did not, so one template behaved two ways either
    // side of a refresh (open-followups §228).
    // ★ The fixture MUST be split, or both the fixed and unfixed paths agree.
    const splitTask = {
      id: 1,
      taskName: "Legacy row",
      status: "In Progress",
      completedDate: "2026-01-01",
      createdDate: "2026-01-01",
      lastUpdateDate: "2026-01-01",
    } as unknown as Task;

    const tpl = {
      id: "t1",
      name: "T",
      fieldVisibility: {},
      seed: { tasks: [splitTask] },
    } as unknown as ProjectTemplate;

    const ws = { ...emptyWorkspace(), tasks: [] } as Workspace;
    const out = applyTemplate(ws, tpl, { includeSeed: true });

    expect(out.tasks).toHaveLength(1);
    // Date wins for every status but Cancelled, so the row becomes Done.
    expect(out.tasks[0].status).toBe("Done");
    expect(out.tasks[0].completedDate).toBe("2026-01-01");
  });
```

If `emptyWorkspace()` does not exist in that test file, read the file's existing tests and reuse whatever workspace fixture they already build — do not invent a second one.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/template-apply.test.ts`
Expected: FAIL — `expected 'In Progress' to be 'Done'`.

- [ ] **Step 3: Export the sanitiser**

In `src/app/templates.ts`, change:

```ts
function sanitizeSeedTask(raw: unknown): Task | null {
```

to:

```ts
/** ★ Exported for `template-apply.ts`, so the in-session APPLY path reconciles
 *  through the SAME function as the localStorage LOAD path. Two reconcilers
 *  would drift; one cannot (open-followups §228). */
export function sanitizeSeedTask(raw: unknown): Task | null {
```

- [ ] **Step 4: Reconcile on apply**

In `src/app/template-apply.ts`, add to the imports:

```ts
import { sanitizeSeedTask } from "./templates";
```

★ `templates.ts` does not import `template-apply.ts` (verify with `grep -rn "template-apply" src/app/templates.ts`, which returns nothing), so this value import creates no cycle. The file already imports TYPES from `./templates`; add the value import as a separate statement.

Replace the body of `applyTemplate`:

```ts
export function applyTemplate(
  ws: Workspace,
  tpl: ProjectTemplate,
  opts: ApplyTemplateOptions,
): Workspace {
  const base: Workspace = { ...ws, fieldVisibility: tpl.fieldVisibility };
  if (!opts.includeSeed || !tpl.seed) return base;
  // ★★★ Reconcile the seed's tasks HERE, not in templateFromWorkspace.
  //   templateFromWorkspace puts live Task objects into the seed by reference,
  //   so a template saved and applied in one session used to bypass the pair
  //   reconciler that the localStorage load path applies — one template, two
  //   behaviours, separated by a refresh (open-followups §228). Fixing it at
  //   SAVE would leave templates written by older builds unrepaired; apply is
  //   the only ingress into a workspace.
  const seed = tpl.seed.tasks
    ? { ...tpl.seed, tasks: tpl.seed.tasks.map(sanitizeSeedTask).filter((x): x is Task => x !== null) }
    : tpl.seed;
  return appendSeed(base, remapSeed(ws, seed));
}
```

Add `import type { Task } from "./types";` if `template-apply.ts` does not already import that type.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/template-apply.test.ts src/app/templates.test.ts src/app/use-templates.test.tsx`
Expected: PASS, all three files.

- [ ] **Step 6: Mutation-prove**

Remove the `.map(sanitizeSeedTask)` hop (pass `tpl.seed` through unchanged). Run the tests. Expected: RED on the new test. **Revert the mutant**, confirm `git diff --stat` is clean of it.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/templates.ts src/app/template-apply.ts src/app/template-apply.test.ts
git commit -m "fix: reconcile seed task pairs when a template is applied in-session"
```

---

## Task 4: §226 — queue the completion conflict when either half of the pair differs

**Files:**
- Modify: `src/app/jira-api.ts`, `src/app/use-jira-sync.ts`
- Test: `src/app/jira-api.test.ts`

**Context.** `diffTaskAgainstIssue` queues a conflict row for each of its eight `ConflictFieldKey`s whose local and remote values differ. `status` is deliberately NOT one of those keys — the merge writes it from whichever side the user picked for `completedDate`, so the user arbitrates the pair as one unit and cannot construct a split by hand. But that means a remote status change whose DATE did not move queues nothing. If no other field differs, `diffTaskAgainstIssue` returns empty and **no conflict is queued at all**, so the remote status move is discarded silently.

This task makes the completion row represent the pair in the diff, and carries the local status on the conflict so the modal (Task 5) can render both halves.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/jira-api.test.ts`, in or beside its existing `diffTaskAgainstIssue` describe block.

```ts
  it("queues the completion row when only the STATUS differs", () => {
    // Neither side carries a date, so the date test alone finds nothing and the
    // remote status move was dropped silently (open-followups §226).
    const local = {
      id: 1, taskName: "t", status: "In Progress", completedDate: undefined,
      createdDate: "2026-01-01", lastUpdateDate: "2026-01-01",
    } as unknown as Task;
    const diffs = diffTaskAgainstIssue(local, { status: "To Do", completedDate: undefined });
    expect(diffs.map((d) => d.key)).toContain("completedDate");
  });

  it("queues the completion row when only the DATE differs", () => {
    const local = {
      id: 1, taskName: "t", status: "Done", completedDate: "2026-01-01",
      createdDate: "2026-01-01", lastUpdateDate: "2026-01-01",
    } as unknown as Task;
    const diffs = diffTaskAgainstIssue(local, { status: "Done", completedDate: "2026-02-02" });
    expect(diffs.map((d) => d.key)).toContain("completedDate");
  });

  it("queues nothing when both halves of the pair agree", () => {
    const local = {
      id: 1, taskName: "t", status: "In Progress", completedDate: undefined,
      createdDate: "2026-01-01", lastUpdateDate: "2026-01-01",
    } as unknown as Task;
    const diffs = diffTaskAgainstIssue(local, { status: "In Progress", completedDate: undefined });
    expect(diffs).toHaveLength(0);
  });

  it("does not queue a status difference when the remote patch carries no status", () => {
    // A patch with no `status` says nothing about the remote status; treating
    // `undefined` as a difference would queue a phantom conflict on every sync.
    const local = {
      id: 1, taskName: "t", status: "In Progress", completedDate: undefined,
      createdDate: "2026-01-01", lastUpdateDate: "2026-01-01",
    } as unknown as Task;
    const diffs = diffTaskAgainstIssue(local, { completedDate: undefined });
    expect(diffs).toHaveLength(0);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/jira-api.test.ts`
Expected: FAIL on "queues the completion row when only the STATUS differs" — the returned array is empty. The other three should already pass; they are the regression fence around the change.

- [ ] **Step 3: Make the diff pair-aware**

In `src/app/jira-api.ts`, inside `diffTaskAgainstIssue`, delete the line `check("completedDate");` and put this in its place (keeping it last, after `check("description")`):

```ts
  // ★★★ The completion row represents the PAIR (`status` + `completedDate`),
  //   not the date alone: the merge writes BOTH halves from the side the user
  //   picks, and `status` is deliberately not a ConflictFieldKey. So it must be
  //   queued when EITHER half differs. Testing the date alone dropped a remote
  //   status move whose date had not changed — and when no other field
  //   differed this function returned empty, so no conflict was queued at all
  //   and the move was discarded silently (open-followups §226).
  // ★ `remoteFields.status === undefined` means the patch says nothing about
  //   the remote status; treating that as a difference would queue a phantom
  //   conflict on every sync.
  const statusDiffers =
    remoteFields.status !== undefined && local.status !== remoteFields.status;
  if (fieldsDiffer(local.completedDate, remoteFields.completedDate) || statusDiffers) {
    out.push({
      key: "completedDate",
      localValue: local.completedDate,
      remoteValue: remoteFields.completedDate,
    });
  }
```

- [ ] **Step 4: Carry the local status on the conflict**

In `src/app/jira-api.ts`, add to the `ConflictItem` type, immediately after the `remoteStatus` field and its comment:

```ts
  /** The LOCAL row's workflow status at queue time.
   *  ★ Carried purely so the modal can render the completion row as the PAIR it
   *  actually is. The merge does not read it — the local arm takes `status`
   *  from `original`. Without it a status-only conflict renders two identical
   *  dates and the user cannot see what they are choosing between. */
  localStatus: TaskStatus;
```

In `src/app/use-jira-sync.ts`, at the `conflictItems.push({ … })` site, add `localStatus: row.status,` immediately after the `remoteStatus: patch.status,` line.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/jira-api.test.ts src/app/use-jira-sync.test.tsx`
Expected: PASS, both files.

- [ ] **Step 6: Mutation-prove**

Drop `|| statusDiffers` from the condition. Run `npx vitest run src/app/jira-api.test.ts`. Expected: RED on the status-only test. **Revert the mutant.**

- [ ] **Step 7: Typecheck and commit**

`npx tsc --noEmit` will fail until every construction site of `ConflictItem` supplies `localStatus` — including any in test files. Fix each one it names.

```bash
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/jira-api.ts src/app/jira-api.test.ts src/app/use-jira-sync.ts
git commit -m "fix: queue the Jira completion conflict when either half of the pair differs"
```

---

## Task 5: §226 — the modal renders the completion row as a pair

**Files:**
- Modify: `src/app/jira-conflicts-modal.tsx`
- Test: `src/app/jira-conflicts-modal.test.tsx`

**Context.** The completion row currently renders only the date on each side. After Task 4 it can be queued when the dates are identical, which would render two identical values and give the user nothing to choose between. The row already carries a `jiraConflictCompletionNote` sub-label telling the user the pick moves `status` too — this makes that note legible.

No new i18n key is needed: task statuses already have translated labels via `statusLabelKey`.

- [ ] **Step 1: Write the failing test**

Add to `src/app/jira-conflicts-modal.test.tsx`. Reuse whatever conflict fixture the file already builds; it will need the new `localStatus` field regardless (Task 4 made it required).

```ts
  it("renders both halves of the pair on the completion row", () => {
    const conflicts = [
      {
        taskId: 1,
        jiraKey: "TEST-1",
        remoteDone: false,
        remoteStatus: "To Do" as TaskStatus,
        localStatus: "In Progress" as TaskStatus,
        fields: [
          { key: "completedDate" as const, localValue: undefined, remoteValue: undefined },
        ],
      },
    ] as unknown as ConflictItem[];

    render(
      <JiraConflictsModal
        lang="en-US"
        conflicts={conflicts}
        onResolve={() => {}}
        onClose={() => {}}
      />,
    );

    // Dates are identical (both absent), so the STATUS is the only thing that
    // distinguishes the two choices. Without it the user sees "—" twice.
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("To Do")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/jira-conflicts-modal.test.tsx -t "renders both halves"`
Expected: FAIL — `Unable to find an element with the text: In Progress`.

- [ ] **Step 3: Implement**

In `src/app/jira-conflicts-modal.tsx`, add to the imports:

```ts
import { statusLabelKey } from "./task-status-ui";
import type { TaskStatus } from "./types";
```

Add this component above `JiraConflictsModal`:

```tsx
/** One side's value for one conflict row.
 *  ★ The completion row is the PAIR (`status` + `completedDate`), so it renders
 *  BOTH halves: after the §226 fix it can be queued when the dates are
 *  identical and only the status moved, and a date-only rendering would then
 *  show the user two identical values to choose between. Every other row is a
 *  single field and renders unchanged. */
function ConflictValue({
  lang,
  fieldKey,
  value,
  status,
}: {
  lang: Lang;
  fieldKey: ConflictFieldKey;
  value: string | string[] | undefined;
  status: TaskStatus;
}) {
  if (fieldKey !== "completedDate") {
    return <span className="whitespace-pre-wrap break-words text-foreground">{fmt(value)}</span>;
  }
  return (
    <span className="whitespace-pre-wrap break-words text-foreground">
      <span className="block">{t(lang, statusLabelKey(status))}</span>
      <span className="block text-muted-foreground">{fmt(value)}</span>
    </span>
  );
}
```

Then, in the row rendering, replace the LOCAL cell's value span:

```tsx
                            <span className="whitespace-pre-wrap break-words text-foreground">
                              {fmt(f.localValue)}
                            </span>
```

with:

```tsx
                            <ConflictValue lang={lang} fieldKey={f.key} value={f.localValue} status={c.localStatus} />
```

and the REMOTE cell's value span with:

```tsx
                            <ConflictValue lang={lang} fieldKey={f.key} value={f.remoteValue} status={c.remoteStatus} />
```

★ The remote cell's span is the one immediately after `onChange={() => setPick(c.taskId, f.key, "remote")}`. Read the surrounding JSX before editing — there are two structurally similar cells and swapping them silently inverts the modal.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/jira-conflicts-modal.test.tsx`
Expected: PASS, the whole file. Existing tests that assert on non-completion rows are unaffected because `ConflictValue` returns the identical span for every other key.

- [ ] **Step 5: Mutation-prove**

Change `if (fieldKey !== "completedDate")` to `if (true)`. Run the tests. Expected: RED on the new test. **Revert the mutant.**

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src/app/jira-conflicts-modal.tsx; echo "EXIT=$?"
git add src/app/jira-conflicts-modal.tsx src/app/jira-conflicts-modal.test.tsx
git commit -m "feat: render the Jira completion conflict as a status/date pair"
```

---

## Task 6: surface the split-pair count in Diagnostics

**Files:**
- Modify: `src/app/diagnostics-panel.tsx`, `src/app/settings-sections/diagnostics-section.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/diagnostics-panel.test.tsx`
- Create: `src/app/settings-sections/diagnostics-section.test.tsx`

★★★ **The count must NOT be read inside `diagnostics-panel.tsx`.** That panel is mounted twice: by `settings-sections/diagnostics-section.tsx` (inside `WorkspaceProvider`) and by `recovery-panel.tsx` (a separate route, no provider, reached when the workspace is untrustworthy). A `useWorkspace()` call in the panel would throw in recovery. The section is the adapter.

- [ ] **Step 1: Add the i18n key (EN)**

In `src/app/i18n.ts`, after the `diagnosticsUnitInfo` line, add:

```ts
  diagnosticsSplitPairs: "Tasks with inconsistent completion data: {0}",
```

- [ ] **Step 2: Add the i18n key (DE)**

★★ The Edit tool corrupts `src/app/i18n.de.ts` — it curls double quotes and mangles umlauts, and it bites umlaut-free strings too. The file is CRLF, so a `\n` anchor silently no-ops. Patch it with a node UTF-8 write using a `\r\n` anchor:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
const s = fs.readFileSync(p, "utf8");
const anchor = "  diagnosticsUnitInfo: \"Infos\",\r\n";
if (!s.includes(anchor)) { console.error("ANCHOR NOT FOUND"); process.exit(1); }
if (s.split(anchor).length !== 2) { console.error("ANCHOR NOT UNIQUE"); process.exit(1); }
const add = "  diagnosticsSplitPairs: \"Aufgaben mit inkonsistenten Abschlussdaten: {0}\",\r\n";
fs.writeFileSync(p, s.replace(anchor, anchor + add), "utf8");
console.log("OK");
'
```

Expected output: `OK`. The German string is deliberately umlaut-free, so no encoding repair is needed — but verify anyway:

```bash
npx vitest run src/app/i18n-encoding.test.ts
git diff --stat src/app/i18n.de.ts
```

Expected: PASS, and `1 file changed, 1 insertion(+)`. **A larger insertion count means the file was re-lined — stop and investigate.**

- [ ] **Step 3: Write the failing panel tests**

Add to `src/app/diagnostics-panel.test.tsx`:

```ts
  it("shows the split-pair count when one is supplied", () => {
    render(<DiagnosticsPanel lang="en-US" splitPairs={3} />);
    expect(screen.getByText(/inconsistent completion data: 3/i)).toBeInTheDocument();
  });

  it("shows a zero count as a positive signal", () => {
    // 0 is meaningful in a SUPPORT panel: it distinguishes "measured, clean"
    // from "not measured", which is what the recovery mount below looks like.
    render(<DiagnosticsPanel lang="en-US" splitPairs={0} />);
    expect(screen.getByText(/inconsistent completion data: 0/i)).toBeInTheDocument();
  });

  it("omits the row entirely when no count is supplied", () => {
    // The recovery mount renders the panel with no workspace behind it.
    render(<DiagnosticsPanel lang="en-US" />);
    expect(screen.queryByText(/inconsistent completion data/i)).not.toBeInTheDocument();
  });
```

- [ ] **Step 4: Run to verify they fail**

Run: `npx vitest run src/app/diagnostics-panel.test.tsx`
Expected: FAIL on the first two — the text is not in the document. The third passes already (the regression fence).

- [ ] **Step 5: Implement the panel prop**

In `src/app/diagnostics-panel.tsx`, change the signature:

```tsx
export function DiagnosticsPanel({ lang, splitPairs }: { lang: Lang; splitPairs?: number }) {
```

And add this immediately after the `<p className="text-xs text-muted-foreground">{summaryText}</p>` element (as a sibling, outside whatever conditional wraps that line):

```tsx
      {splitPairs !== undefined && (
        <p className="text-xs text-muted-foreground">
          {t(lang, "diagnosticsSplitPairs", String(splitPairs))}
        </p>
      )}
```

★ The guard is `!== undefined`, never truthiness — `0` is a real, meaningful value here and a `{splitPairs && …}` test would both hide the clean case AND render a bare `0` into the DOM.

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run src/app/diagnostics-panel.test.tsx`
Expected: PASS, all three.

- [ ] **Step 7: Write the failing section test**

Create `src/app/settings-sections/diagnostics-section.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiagnosticsSection } from "./diagnostics-section";
import * as diagnostics from "../diagnostics";

vi.mock("../workspace-context", () => ({
  useWorkspace: () => ({
    tasks: [
      { id: 1, taskName: "a", status: "Done", completedDate: "2026-01-01", createdDate: "2026-01-01", lastUpdateDate: "2026-01-01" },
      { id: 2, taskName: "b", status: "In Progress", completedDate: "2026-01-01", createdDate: "2026-01-01", lastUpdateDate: "2026-01-01" },
    ],
  }),
}));

describe("DiagnosticsSection", () => {
  it("counts the workspace's split pairs and hands them to the panel", () => {
    render(<DiagnosticsSection lang="en-US" />);
    expect(screen.getByText(/inconsistent completion data: 1/i)).toBeInTheDocument();
  });

  it("logs the count to the diagnostic ring when it is non-zero", () => {
    const spy = vi.spyOn(diagnostics, "logDiag");
    render(<DiagnosticsSection lang="en-US" />);
    expect(spy).toHaveBeenCalledWith("warn", "task-pair-split", { count: 1 });
    spy.mockRestore();
  });
});
```

- [ ] **Step 8: Run to verify it fails**

Run: `npx vitest run src/app/settings-sections/diagnostics-section.test.tsx`
Expected: FAIL — the text is absent and `logDiag` was not called.

- [ ] **Step 9: Implement the section**

Replace the whole of `src/app/settings-sections/diagnostics-section.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import type { Lang } from "../i18n";
import { DiagnosticsPanel } from "../diagnostics-panel";
import { useWorkspace } from "../workspace-context";
import { countSplitTaskPairs } from "../task-status";
import { logDiag } from "../diagnostics";

/** Settings → Diagnostics.
 *
 *  ★★★ This wrapper exists to READ THE WORKSPACE so the panel does not have to.
 *  `DiagnosticsPanel` is also mounted by `recovery-panel.tsx`, which runs on a
 *  separate route with no `WorkspaceProvider` above it — a `useWorkspace()`
 *  call inside the panel would throw there. The count is therefore an OPTIONAL
 *  prop: Settings supplies it, recovery omits it, and the row does not render.
 */
export function DiagnosticsSection({ lang }: { lang: Lang }) {
  const { tasks } = useWorkspace();
  const splitPairs = countSplitTaskPairs(tasks);
  const loggedRef = useRef<number | null>(null);

  // ★ Log to the ring so the count reaches the exported diagnostic bundle a
  //   user can send. Firing from here is sufficient: `buildDiagnosticBundle` is
  //   reachable only from the panel's own copy/download buttons, so any export
  //   implies this section mounted.
  // ★ Only when NON-ZERO, and only on a CHANGE. The ring is capped at 200
  //   entries; logging every render would evict everything else in it.
  useEffect(() => {
    if (splitPairs > 0 && loggedRef.current !== splitPairs) {
      loggedRef.current = splitPairs;
      logDiag("warn", "task-pair-split", { count: splitPairs });
    }
  }, [splitPairs]);

  return <DiagnosticsPanel lang={lang} splitPairs={splitPairs} />;
}
```

- [ ] **Step 10: Run to verify it passes**

Run: `npx vitest run src/app/settings-sections/diagnostics-section.test.tsx src/app/diagnostics-panel.test.tsx`
Expected: PASS, both files.

- [ ] **Step 11: Mutation-prove**

Change `splitPairs !== undefined` in the panel to `splitPairs` (truthiness). Run `npx vitest run src/app/diagnostics-panel.test.tsx`. Expected: RED on "shows a zero count as a positive signal". **Revert the mutant.**

- [ ] **Step 12: Typecheck, lint and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src/app/diagnostics-panel.tsx src/app/settings-sections/diagnostics-section.tsx; echo "EXIT=$?"
git add src/app/diagnostics-panel.tsx src/app/settings-sections/diagnostics-section.tsx src/app/settings-sections/diagnostics-section.test.tsx src/app/diagnostics-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: report split status/completedDate pairs in Diagnostics"
```

---

## Task 7: documentation sweep

**Files:**
- Modify: `docs/AGENTS/task-status.md`, `docs/open-followups.md`

★★★ A behaviour change falsifies prose in files nobody assigned you. Sweep for descriptions of the OLD behaviour, do not just edit the sections named here.

- [ ] **Step 1: Find every description of the old guard**

```bash
grep -rn "merged.completedDate" docs/ src/ --include=*.md --include=*.ts --include=*.tsx
grep -rn "PASS-THROUGH" docs/
```

Read every hit. Any that describes the transition guard as keying on the date is now false.

- [ ] **Step 2: Correct `docs/AGENTS/task-status.md`**

Its "The conflict merge is a PASS-THROUGH, not a normaliser" section says the local pick "fires `transitionIssueTo(…, "done")` while the row reads 'In Progress'". That is no longer true — Task 2 fixed it. Rewrite that clause to say the transition now gates on `merged.status === "Done"`, so a split local row no longer moves the Jira issue; the local arm being a pass-through (the `merged.status = original.status` no-op) is STILL true and must stay.

In the same file's "Prohibitions" section, the sentence describing the §227 local-arm hazard stays as written — that question is still open.

- [ ] **Step 3: Close §226 and §228, narrow §227**

In `docs/open-followups.md`:

- §226 heading gains `— CLOSED 2026-08-24`. Add a resolution paragraph: `diffTaskAgainstIssue` now queues the completion row when either half of the pair differs, and the modal renders both halves, so a remote status move is arbitrated by the user rather than dropped. Note that the previous behaviour discarded such a move ENTIRELY when no other field differed, because an empty diff queues no conflict at all.
- §228 heading gains `— CLOSED 2026-08-24`. Resolution: `applyTemplate` maps seed tasks through the now-exported `sanitizeSeedTask`, the same function the localStorage load path uses, so one template behaves identically either side of a reload.
- §227 keeps its heading but is rewritten to cover ONLY the local-arm normalisation question. State that its second-order effect — the Jira transition firing on a split row — is CLOSED (Task 2), and that the remaining decision is deliberately **waiting on what `countSplitTaskPairs` reports**, not merely unmade.

- [ ] **Step 4: Verify the gates that read docs**

```bash
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```

Expected: EXIT=0 for both. `docs:symbols:check` will fail if you backtick a name that does not exist — `countSplitTaskPairs` and `sanitizeSeedTask` both do after Tasks 1 and 3. `docs:claims:check` is a ratchet: do not add any new `path:LINE` citation.

- [ ] **Step 5: Commit**

```bash
git add docs/AGENTS/task-status.md docs/open-followups.md
git commit -m "docs: close open-followups 226 and 228, narrow 227"
```

---

## Task 8: release chain

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md` (five files)

- [ ] **Step 1: Re-verify the codename**

```bash
grep -c "Mandelo" CHANGELOG.md; echo "EXIT=$?"
```

Expected: `0`. ★★ If it is non-zero, an unrelated release consumed it while this slice was in flight — pick another and verify the same way. `docs/open-followups.md` §44 records that exact failure happening.

- [ ] **Step 2: Bump `src/app/version.ts`**

Set `APP_VERSION = "0.258.0"`, `APP_MILESTONE = "Mandelo"`, and `APP_BUILD_DATE` to today's date.

- [ ] **Step 3: Add the `CHANGELOG.md` entry**

Head it `## [0.258.0] - 2026-08-24 "Mandelo"`, above the existing 0.257.1 entry. Cover the four changes in user-facing terms: Jira issues are no longer marked done from a task that is not done; a status change made in Jira is now offered during conflict resolution instead of being dropped; a template applied without reloading now behaves like one applied after a reload; and Settings → Diagnostics reports tasks whose completion data is inconsistent.

★★ **No `[session link removed]...` URL** anywhere in `CHANGELOG.md`.

- [ ] **Step 4: Update the five ungated version sites**

No gate checks any of these; they drift silently.

```bash
grep -n '"version"' package.json
grep -n '"version": "0.257.1"' package-lock.json     # TWO occurrences: root and packages[""]
grep -n "0\.257\.1\|Shepard" README.md
grep -rn "0\.257\.1\|Shepard" docs/CODEMAPS/
```

Set every one to `0.258.0` / `Mandelo`. `package.json` and `package-lock.json` are CRLF — patch with a node UTF-8 write using `\r\n` anchors, never `sed -i`.

- [ ] **Step 5: Verify no version site was missed**

```bash
grep -rn "0\.257\.1" package.json package-lock.json README.md docs/CODEMAPS/ src/app/version.ts; echo "EXIT=$?"
```

Expected: no output, EXIT=1 (grep exits 1 on no match).

- [ ] **Step 6: Run the full gate chain**

Run these ONE AT A TIME — never two vitest processes at once. Write logs to your own session's scratchpad directory, NOT `/tmp`: that path is shared across concurrent Claude sessions on this machine, and a peer's gate log has already overwritten one and been read as this checkout's result. Set it first:

```bash
SCRATCH=<your session scratchpad directory>; mkdir -p "$SCRATCH"
```

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src; echo "EXIT=$?"
npm run test:run > "$SCRATCH/suite.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/suite.log"
npm run test:shuffle > "$SCRATCH/shuffle.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/shuffle.log"
npm run size:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```

Before reading any log, confirm its provenance — `grep "npm notice run" "$SCRATCH/suite.log"` must show `aipm-cockpit@0.258.0`, and the ` RUN v4 ` line must name `C:/Projects/aipm-wt-a`.

★ A vitest red carrying `Failed to start forks worker` is machine contention, not a real failure — re-run with `--maxWorkers=4` when the machine is idle.

- [ ] **Step 7: Run the axe gate for the touched view**

The conflict modal is reachable from an axe-scanned view.

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points" --workers=1
```

★★ `--workers=1` is required whenever more than one view matches — locally Playwright runs at CPU-count while CI runs serially, and over-subscription produces `Test timeout of 60000ms exceeded` inside `page.evaluate`, which prints as a failure with no violation text. That is contention, not a violation.

- [ ] **Step 8: Verify no file was re-lined**

```bash
git diff --stat
git ls-files --eol $(git diff --name-only) | grep -v "i/lf w/crlf" | grep "^i/"
```

Every `src/**` file must read `i/lf w/crlf`. One reading `i/lf w/lf` was re-lined — repair it before committing.

- [ ] **Step 9: Commit**

```bash
git add src/app/version.ts CHANGELOG.md package.json package-lock.json README.md docs/CODEMAPS/
git commit -m "chore: release 0.258.0 \"Mandelo\""
```

- [ ] **Step 10: Stop**

★★★ **Do not push, do not open an MR, do not merge.** This project requires an explicit instruction from the user for each. Report what shipped, what the gates said, and wait.

---

## Self-review

**Spec coverage.** §3.1 → Task 2. §3.2 → Task 3. §3.3 → Tasks 4 and 5. §3.4 → Tasks 1 and 6. §3.5 → Task 7 step 3. §4 (out of scope) → nothing implements it, correctly. §5 (testing) → the split-fixture requirement appears in Tasks 2, 3 and 4 as an inline ★. §6 (release) → Task 8.

**Placeholders.** None. Every code step carries the code; every command carries its expected output.

**Type consistency.** `countSplitTaskPairs(tasks: readonly Task[]): number` is defined in Task 1 and consumed in Task 6 with the same name and arity. `ConflictItem.localStatus: TaskStatus` is added in Task 4 and read in Task 5 as `c.localStatus`. `DiagnosticsPanel`'s `splitPairs?: number` is defined in Task 6 step 5 and passed in step 9. `sanitizeSeedTask` is exported in Task 3 step 3 and imported in step 4. The i18n key `diagnosticsSplitPairs` is added in Task 6 steps 1–2 and used in step 5.

**One gap worth naming.** Task 4 makes `localStatus` required on `ConflictItem`, which will break every existing construction site including ones in test files. Task 4 step 7 says to fix each one `tsc` names rather than listing them, because the list is exactly what the compiler produces and enumerating it here would rot.
