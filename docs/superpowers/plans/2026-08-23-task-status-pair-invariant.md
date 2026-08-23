# `status` / `completedDate` Pair Invariant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all four code paths that write `Task.status` and `Task.completedDate` hold the invariant `status === "Done"` ⟺ `completedDate` set, closing `docs/open-followups.md` §182 and §183.

**Architecture:** Two independent fixes, each holding the invariant by the mechanism correct for its own source of truth. Template import gains a new pure engine function `reconcileStatusFromDate` that trusts the DATE. The Jira conflict merge writes `status` alongside `completedDate`, both taken from the side the user picked, using a new `remoteStatus` field on `ConflictItem` filled from the patch the construction site already computes. Neither fix is routed through the other — the spec's Decision 2 section explains why each is wrong for the other's path.

**Tech Stack:** TypeScript, React 19, Next.js 16.2.11, vitest 4.1.8, fast-check, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-23-task-status-pair-invariant-design.md` (committed `ac3c9845`)

**Branch:** `fix/task-status-pair-invariant`, off `origin/main` at `2a1cfdef`

---

## Read this before Task 1

These are the landmines specific to this slice. Each one has cost real work in this repo.

1. **★★★ Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` exits **0 while tests are failing** — that is `tail`'s status, and the pipe also discards the failure diagnostic. Always:
   ```bash
   npx vitest run <file> > /tmp/x.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/x.log
   ```
   Write `echo "EXIT=$?"` **before** any pipe, never after one.

2. **★★★ Every existing conflict fixture in `use-jira-sync.test.tsx` mocks `diffTaskAgainstIssue` to return a `taskName`-only diff** — four sites, verified 2026-08-23. The `completedDate` arm of the merge loop **has never executed under the suite**, despite four `picks` objects naming `completedDate`. A new test that forgets to widen that mock **passes against the unfixed code**. Every merge test in Task 7 must be confirmed RED before Task 8 implements anything.

3. **★★ `vitest` never typechecks and `next build` does not typecheck test files.** Adding a required field to `ConflictItem` breaks the fixture in `jira-conflicts-modal.test.tsx` — that is a tsc-only failure. Run `npx tsc --noEmit` after Task 6, not just vitest.

4. **★★ `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts in it** (and curls double quotes, which bites umlaut-free strings too). Patch it with a node utf8 write and re-verify the bytes. A node replace whose anchor uses `\n` silently no-ops — match `\r\n`. The `i18n-encoding` test BANS ASCII substitutions (`fuer`/`druecken`) and `\u00XX` escapes.

5. **★★ `fc.date()` can emit an Invalid Date** whose `.toISOString()` throws — passes vitest, fails at runtime. Task 3 maps an integer ms range to `new Date(ms)` instead. Do not substitute `fc.date()`.

6. **★ `Lang` is `"en-US" | "en-GB" | "de"` — there is no `"en"`.** Component tests must use `"en-US"`.

7. **★ The DE dictionary is lazy.** A test asserting DE output must call `loadI18n("de")` (e.g. in `beforeAll`) before asserting.

8. **★ No file in this slice is near the size cap.** `task-status.ts` is 40 lines, `templates.ts` 351, `jira-api.ts` 430, `use-jira-sync.ts` 431, `jira-conflicts-modal.tsx` 280, and none has a `docs/baselines/file-sizes.json` entry. `size:check` is not a risk here, but run it at the end anyway.

9. **★ Never run two vitest processes concurrently.** Machine saturation is this repo's load-sensitive-flake condition.

10. **★★ A correction is a NEW claim** and inherits none of the verification of the thing it corrects. In Task 12 (AGENTS.md), run a command against the REPLACEMENT text, not only against the error you found.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/app/task-status.ts` | modify | gains `reconcileStatusFromDate` — the seed/import-only pair repair. Pure, i18n-free, DOM-free. |
| `src/app/task-status.test.ts` | modify | unit + property + idempotence coverage for the new export |
| `src/app/templates.ts` | modify | `sanitizeSeedTask` calls the new function as its last step |
| `src/app/templates.test.ts` | modify | integration proof through the exported `sanitizeTemplates` |
| `src/app/jira-api.ts` | modify | `ConflictItem` gains `remoteStatus: TaskStatus` |
| `src/app/use-jira-sync.ts` | modify | fills `remoteStatus` at construction; merge writes `status` beside `completedDate` |
| `src/app/use-jira-sync.test.tsx` | modify | first-ever coverage of the merge's `completedDate` arm |
| `src/app/i18n.ts` | modify | one new EN key |
| `src/app/i18n.de.ts` | modify | the matching DE key (CRLF + umlaut landmine) |
| `src/app/jira-conflicts-modal.tsx` | modify | the completion row states that the pick also moves status |
| `src/app/jira-conflicts-modal.test.tsx` | modify | fixture gains `remoteStatus`; RTL assertion on the new note |
| `AGENTS.md` | modify | task-status bullet rewritten — all four writers now hold the invariant |
| `docs/open-followups.md` | modify | close §182, §183; open §226 |
| `CHANGELOG.md`, `src/app/version.ts`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md` | modify | 0.257.0 "Shepard" |

No files are created. No file crosses 800 lines.

---

## Task 1: `reconcileStatusFromDate` — the four quadrants

**Files:**
- Modify: `src/app/task-status.ts`
- Test: `src/app/task-status.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/task-status.test.ts`. Note the existing `base()` helper at the top of that file already builds a `Task`; reuse it. Add `reconcileStatusFromDate` to the existing import list from `./task-status`.

```ts
describe("reconcileStatusFromDate", () => {
  it("leaves a consistent Done row untouched", () => {
    const t = base({ status: "Done", completedDate: "2026-03-04" });
    expect(reconcileStatusFromDate(t)).toBe(t); // same reference — nothing changed
  });

  it("leaves a consistent open row untouched", () => {
    const t = base({ status: "In Progress" });
    expect(reconcileStatusFromDate(t)).toBe(t);
  });

  it("a date on a non-Done row forces Done and KEEPS the date", () => {
    const out = reconcileStatusFromDate(base({ status: "To Do", completedDate: "2026-03-04" }));
    expect(out.status).toBe("Done");
    expect(out.completedDate).toBe("2026-03-04");
  });

  it("Done with no date demotes to the default status and invents nothing", () => {
    const out = reconcileStatusFromDate(base({ status: "Done" }));
    expect(out.status).toBe("To Do");
    expect(out.completedDate).toBeFalsy();
  });

  it("treats an empty-string completedDate as absent, like isTaskDelivered does", () => {
    const out = reconcileStatusFromDate(base({ status: "Done", completedDate: "" }));
    expect(out.status).toBe("To Do");
  });

  it("does not mutate its argument", () => {
    const t = base({ status: "To Do", completedDate: "2026-03-04" });
    reconcileStatusFromDate(t);
    expect(t.status).toBe("To Do");
  });

  it("is idempotent", () => {
    for (const t of [
      base({ status: "To Do", completedDate: "2026-03-04" }),
      base({ status: "Done" }),
      base({ status: "Cancelled", completedDate: "2026-03-04" }),
    ]) {
      const once = reconcileStatusFromDate(t);
      expect(reconcileStatusFromDate(once)).toEqual(once);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/task-status.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |reconcileStatusFromDate" /tmp/t1.log | head
```

Expected: `EXIT=1`. The failure is a build/import error — `reconcileStatusFromDate` is not exported — so the whole file fails to collect. That is the correct RED for this step.

- [ ] **Step 3: Implement**

In `src/app/task-status.ts`, add `DEFAULT_TASK_STATUS` to the existing import from `./types` if it is not already there (it is — the file already imports it for `migrateTask`), then append below `migrateTask`:

```ts
/** Force the pair `status === "Done"` ⟺ `completedDate` set by trusting the DATE.
 *
 *  - a `completedDate` present  ⇒ `status` becomes "Done"
 *  - `status === "Done"` with no date ⇒ `status` becomes DEFAULT_TASK_STATUS
 *  - anything else is returned BY REFERENCE, unchanged
 *
 *  Invents no date and deletes none. Emptiness is `!!completedDate`, the same
 *  test `isTaskDelivered` (task-closed.ts) uses — defining "has a date" twice
 *  is how the two would drift.
 *
 *  ★★★ FOR SEED / IMPORT DATA ONLY. Today that is `sanitizeSeedTask`
 *  (templates.ts), whose two reads of the pair are independent. Do NOT call it
 *  on either Jira path: Jira's status comes from `statusCategory`, not from
 *  date presence, so this would rewrite a reopened issue's genuine
 *  "In Progress" into "To Do" purely because it carries no resolution date.
 *  Those paths derive both fields from one `statusKey` read and need nothing
 *  from here (AGENTS.md, task status model).
 *
 *  ★★ Not a load-path repair either. `migrateTask` runs on all six load paths
 *  and only backfills an ABSENT/INVALID status; teaching IT to reconcile would
 *  change every backend's load behaviour and would apply this date-wins rule
 *  to Jira rows, where it is wrong. */
export function reconcileStatusFromDate(task: Task): Task {
  if (task.completedDate) {
    return task.status === "Done" ? task : { ...task, status: "Done" };
  }
  if (task.status === "Done") {
    return { ...task, status: DEFAULT_TASK_STATUS };
  }
  return task;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/task-status.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t1.log
```

Expected: `EXIT=0`, all tests passing.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/task-status.ts src/app/task-status.test.ts
git commit -F - <<'MSGEOF'
feat(tasks): add reconcileStatusFromDate, the seed-only pair repair

Template import reads status and completedDate independently off a raw seed
and nothing reconciles them, so an imported template can store a row that is
open and delivered at once. This is the engine half of that fix.

The rule trusts the DATE: a date present forces Done, a Done with no date
demotes to DEFAULT_TASK_STATUS. Nothing is invented and no date is deleted --
the alternative would have to fabricate a delivery date that then flows into
on-time/late reporting and earned value.

Named narrowly on purpose. A generic reconcileStatusPair is exactly what
someone would later apply to the Jira paths, where deciding status from date
PRESENCE would rewrite a reopened issue's real "In Progress" into "To Do".
MSGEOF
echo "EXIT=$?"
```

---

## Task 2: property test — the invariant holds for every input

**Files:**
- Test: `src/app/task-status.test.ts`

- [ ] **Step 1: Write the property test**

Append to the `describe("reconcileStatusFromDate", ...)` block. Add `import fc from "fast-check";` at the top of the file and `TASK_STATUSES` to the existing `./types` import.

```ts
  it("output always satisfies status===Done ⟺ completedDate set", () => {
    // ★ NOT fc.date(): it can emit an Invalid Date whose .toISOString() throws —
    //   green under vitest, red at runtime. Map an integer ms range instead.
    const isoDay = fc
      .integer({ min: 0, max: 4102444800000 }) // 1970-01-01 .. 2100-01-01
      .map((ms) => new Date(ms).toISOString().slice(0, 10));
    fc.assert(
      fc.property(
        fc.constantFrom(...TASK_STATUSES),
        fc.oneof(fc.constant(undefined), fc.constant(""), isoDay),
        (status, completedDate) => {
          const out = reconcileStatusFromDate(base({ status, completedDate }));
          expect(out.status === "Done").toBe(!!out.completedDate);
        },
      ),
      { numRuns: 300 },
    );
  });
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/app/task-status.test.ts > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t2.log
```

Expected: `EXIT=0`. This property passes immediately — Task 1 already implements it. It is a regression net, not a RED-first test, and that is deliberate: it is the assertion that survives a future refactor of the function body.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`. This catches the `fc` typing mistakes that vitest does not.

- [ ] **Step 4: Commit**

```bash
git add src/app/task-status.test.ts
git commit -m "test(tasks): pin the pair invariant as a property over every status and date"
echo "EXIT=$?"
```

---

## Task 3: mutation check — prove the tests are not vacuous

**Files:**
- Temporarily modify then revert: `src/app/task-status.ts`

This task writes no code. It proves Task 1's tests can actually fail.

- [ ] **Step 1: Land mutant A (the date branch) and assert it landed**

```bash
node -e "
const fs=require('fs'); const p='src/app/task-status.ts';
const s=fs.readFileSync(p,'utf8');
const m=s.replace('  if (task.completedDate) {','  if (false) {');
if (m===s) { console.error('MUTANT DID NOT LAND — anchor not found'); process.exit(1); }
fs.writeFileSync(p,m); console.log('mutant A landed');
"
echo "EXIT=$?"
```

Expected: `mutant A landed`, `EXIT=0`. **If it prints `MUTANT DID NOT LAND`, stop.** A no-op replace followed by a green run reads as proof when it is vacuity — that is the specific failure this step exists to prevent.

- [ ] **Step 2: Run the suite against mutant A**

```bash
npx vitest run src/app/task-status.test.ts > /tmp/mutA.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/mutA.log
```

Expected: `EXIT=1`, with failures. If it is `EXIT=0`, the tests do not cover the date branch — fix the tests before continuing.

- [ ] **Step 3: Revert mutant A**

```bash
git checkout -- src/app/task-status.ts
git diff --stat src/app/task-status.ts; echo "CLEAN_EXIT=$?"
```

Expected: empty diff.

- [ ] **Step 4: Land mutant B (the demote branch), run, revert**

```bash
node -e "
const fs=require('fs'); const p='src/app/task-status.ts';
const s=fs.readFileSync(p,'utf8');
const m=s.replace('    return { ...task, status: DEFAULT_TASK_STATUS };','    return task;');
if (m===s) { console.error('MUTANT DID NOT LAND — anchor not found'); process.exit(1); }
fs.writeFileSync(p,m); console.log('mutant B landed');
"
echo "EXIT=$?"
npx vitest run src/app/task-status.test.ts > /tmp/mutB.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/mutB.log
git checkout -- src/app/task-status.ts
```

Expected: `mutant B landed`, then `EXIT=1` from vitest, then a clean tree.

- [ ] **Step 5: Confirm the tree is clean before moving on**

```bash
git status --porcelain -uall | grep -v "^??"; echo "TRACKED_CHANGES_ABOVE (empty = clean)"
```

Expected: no output. **A live mutant left in the tree is the worst possible state to hand to the next task** — it would be committed as if it were the implementation.

---

## Task 4: wire the repair into template import

**Files:**
- Modify: `src/app/templates.ts`
- Test: `src/app/templates.test.ts`

- [ ] **Step 1: Write the failing integration test**

`sanitizeSeedTask` is not exported, so the test drives it through the exported `sanitizeTemplates`. Append to the existing `describe("sanitizeTemplates", ...)` block in `src/app/templates.test.ts`:

```ts
  it("reconciles an inconsistent seed status/completedDate pair — the date wins", () => {
    const out = sanitizeTemplates([{
      id: "t", name: "T", features: [], fieldVisibility: {},
      seed: { tasks: [
        // (b) a delivery date on an open row → becomes Done, date preserved
        { id: 1, taskName: "date but open", assignee: "", assigneeEmail: "", dueDate: "",
          lastUpdateDate: "", priority: "Low", blockers: "", description: "",
          status: "To Do", completedDate: "2026-03-04" },
        // (a) Done with no date → demoted, nothing invented
        { id: 2, taskName: "done but dateless", assignee: "", assigneeEmail: "", dueDate: "",
          lastUpdateDate: "", priority: "Low", blockers: "", description: "",
          status: "Done" },
      ] },
    }]);
    const tasks = out[0].seed!.tasks!;
    expect(tasks[0].status).toBe("Done");
    expect(tasks[0].completedDate).toBe("2026-03-04"); // a real date is never deleted
    expect(tasks[1].status).toBe("To Do");
    expect(tasks[1].completedDate).toBeFalsy();        // and never invented
  });

  it("leaves an already-consistent seed pair alone", () => {
    const out = sanitizeTemplates([{
      id: "t", name: "T", features: [], fieldVisibility: {},
      seed: { tasks: [
        { id: 1, taskName: "done", assignee: "", assigneeEmail: "", dueDate: "",
          lastUpdateDate: "", priority: "Low", blockers: "", description: "",
          status: "Done", completedDate: "2026-03-04" },
        { id: 2, taskName: "open", assignee: "", assigneeEmail: "", dueDate: "",
          lastUpdateDate: "", priority: "Low", blockers: "", description: "",
          status: "In Progress" },
      ] },
    }]);
    const tasks = out[0].seed!.tasks!;
    expect(tasks[0].status).toBe("Done");
    expect(tasks[0].completedDate).toBe("2026-03-04");
    expect(tasks[1].status).toBe("In Progress");
    expect(tasks[1].completedDate).toBeFalsy();
  });
```

- [ ] **Step 2: Run to verify the first test fails**

```bash
npx vitest run src/app/templates.test.ts > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |date wins" /tmp/t4.log | head
```

Expected: `EXIT=1`. The "date wins" test fails; the "already-consistent" one passes (it is a regression guard, not a RED-first test).

- [ ] **Step 3: Implement**

In `src/app/templates.ts`, add `reconcileStatusFromDate` to the existing import from `./task-status` (the file already imports `migrateTask` from there), then change the single return at the end of `sanitizeSeedTask`.

Find the line that reads exactly:

```ts
  return migrateTask(task);
```

Replace it with:

```ts
  // ★ Reconcile LAST so the pair is the final word. `migrateTask` only backfills
  //   an ABSENT/INVALID status and leaves a valid-but-inconsistent pair alone —
  //   and its `if (statusOk && createdOk)` short-circuit never fires here anyway,
  //   because this function never assigns `createdDate`. Order is therefore
  //   immaterial to the outcome; reconcile-last is chosen for readability.
  return reconcileStatusFromDate(migrateTask(task));
```

- [ ] **Step 4: Run to verify both tests pass**

```bash
npx vitest run src/app/templates.test.ts > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4.log
```

Expected: `EXIT=0`.

- [ ] **Step 5: Confirm no built-in template is affected**

```bash
grep -n completedDate src/app/templates-builtin.ts; echo "EXIT=$? (1 = no hits, which is expected)"
npx vitest run src/app/templates-builtin.test.ts > /tmp/t4b.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t4b.log
```

Expected: no grep hits (`EXIT=1` from grep means "no match", which is the wanted answer here), and the built-in suite green.

- [ ] **Step 6: Commit**

```bash
git add src/app/templates.ts src/app/templates.test.ts
git commit -F - <<'MSGEOF'
fix(templates): reconcile the status/completedDate pair on template import

sanitizeSeedTask read the two fields independently off the raw seed -- status
as a bare cast, completedDate through sanitizeIsoDate -- and migrateTask does
not repair the result: its only status write is guarded `if (!statusOk)`, and a
template's valid status makes statusOk true.

An inconsistent row answers the app's two questions incoherently, because
isTaskClosed reads status and isTaskDelivered reads completedDate. A date on an
open row is counted complete by the dashboard AND kept in the denominator AND
still listed as open by the table; a Done with no date is dropped from both
terms and reported as cancelled scope, raising the completion percentage of
every other row.

Not reachable from shipped data -- no built-in template carries a completedDate
-- but reachable from a hand-edited or third-party template JSON, and from
templateFromWorkspace, which copies live Task objects verbatim and so launders
whatever the workspace already holds.

Closes the first half of open-followups 182.
MSGEOF
echo "EXIT=$?"
```

---

## Task 5: carry the remote status on `ConflictItem`

**Files:**
- Modify: `src/app/jira-api.ts`
- Modify: `src/app/use-jira-sync.ts`
- Modify: `src/app/jira-conflicts-modal.test.tsx`

This task adds the data the merge fix needs. It changes no behaviour on its own.

- [ ] **Step 1: Widen the type**

In `src/app/jira-api.ts`, find `export type ConflictItem = {` and add `remoteStatus` immediately after `remoteDone`:

```ts
export type ConflictItem = {
  taskId: number;
  jiraKey: string;
  jiraIssueType?: string;
  /** Whether the remote issue is currently Done (statusCategory.key === "done"). */
  remoteDone: boolean;
  /** The remote issue's mapped workflow status.
   *  ★★ Carried so the conflict merge can write `status` and `completedDate`
   *  from the SAME side. `status` is deliberately NOT a `ConflictFieldKey` — a
   *  user cannot arbitrate it independently of the date without being able to
   *  construct the very split pair this exists to prevent. */
  remoteStatus: TaskStatus;
  fields: ConflictField[];
};
```

`TaskStatus` is already imported in this file (`import type { Priority, Task, TaskStatus } from "./types";`) — verify with `grep -n "TaskStatus" src/app/jira-api.ts | head -2` rather than assuming.

- [ ] **Step 2: Fill it at the construction site**

In `src/app/use-jira-sync.ts`, find the `conflictItems.push({` call inside the `if (remoteChanged && localChanged) {` branch. It sits two lines below `const patch = issueToTaskFields(issue, todayNow);`. Add one line:

```ts
            conflictItems.push({
              taskId: row.id,
              jiraKey: issue.key,
              jiraIssueType: row.jiraIssueType ?? patch.jiraIssueType,
              remoteDone: isIssueDone(issue),
              // ★ Non-optional by construction: issueToTaskFields returns
              //   `Partial<Task> & { status: TaskStatus }`, so this is the same
              //   single `statusKey` read that produced patch.completedDate.
              remoteStatus: patch.status,
              fields: diffs,
            });
```

- [ ] **Step 3: Typecheck — this is where the test fixture breaks**

```bash
npx tsc --noEmit > /tmp/t5.log 2>&1; echo "EXIT=$?"; head -20 /tmp/t5.log
```

Expected: `EXIT=1`, with an error in `src/app/jira-conflicts-modal.test.tsx` — its `CONFLICT` fixture is a `ConflictItem` literal and now lacks a required property. **This failure is the point of the step.** vitest never typechecks, so without this run the gap ships and only CI sees it.

- [ ] **Step 4: Fix the fixture**

In `src/app/jira-conflicts-modal.test.tsx`, add `remoteStatus` to the `CONFLICT` literal:

```ts
const CONFLICT: ConflictItem = {
  taskId: 42,
  jiraKey: "PROJ-7",
  jiraIssueType: "Story",
  remoteDone: false,
  remoteStatus: "To Do",
  fields: [
    { key: "taskName", localValue: "Local title", remoteValue: "Remote title" },
    { key: "priority", localValue: "High", remoteValue: "Low" },
  ],
};
```

- [ ] **Step 5: Typecheck and run the touched suites**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx vitest run src/app/jira-conflicts-modal.test.tsx src/app/use-jira-sync.test.tsx > /tmp/t5b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5b.log
```

Expected: both `EXIT=0`. Behaviour is unchanged so far — nothing reads `remoteStatus` yet.

- [ ] **Step 6: Commit**

```bash
git add src/app/jira-api.ts src/app/use-jira-sync.ts src/app/jira-conflicts-modal.test.tsx
git commit -F - <<'MSGEOF'
refactor(jira): carry the remote workflow status on ConflictItem

The conflict merge needs the remote status to write it beside the remote
completedDate. The construction site already computes the patch that holds it,
so this is a field, not a fetch.

Non-optional by construction: issueToTaskFields returns
`Partial<Task> & { status: TaskStatus }`, and both members of the pair come out
of one statusKey read there -- which is exactly the property the merge will
inherit in the next commit.

No behaviour change; nothing reads the field yet. The modal test fixture gained
the property because tsc demanded it, which is worth noting: vitest never
typechecks, so a green unit run says nothing about this class of change.
MSGEOF
echo "EXIT=$?"
```

---

## Task 6: the merge's completion arm — RED tests first

**Files:**
- Test: `src/app/use-jira-sync.test.tsx`

**★★★ This is the highest-risk task in the plan.** The merge's `completedDate` arm has never executed under the suite. If these tests are not confirmed RED here, Task 7 could "fix" nothing and every gate would stay green.

- [ ] **Step 1: Add the pair-consistency helper and the completion-conflict setup**

Add these near the existing `setupConflict` helper in `src/app/use-jira-sync.test.tsx` (which is inside the same `describe` block — place them immediately after it):

```ts
  /** The invariant under test, asserted as a property rather than spot-checked
   *  on two fields, so a future field rename cannot quietly skip it. */
  function expectPairConsistent(task: Task) {
    expect(task.status === "Done").toBe(!!task.completedDate);
  }

  /** Queue a conflict whose ONLY differing field is completedDate.
   *  ★★★ The existing setupConflict mocks a taskName-only diff, which is why
   *  this arm of the merge loop has never run. Widening the diff mock is the
   *  whole point of this helper — a test that reuses setupConflict passes
   *  against the unfixed code. */
  async function setupCompletionConflict(
    result: { current: ReturnType<ReturnType<typeof makeProbe>> },
    remote: { status: TaskStatus; completedDate: string | undefined; done: boolean },
    localCompletedDate: string | undefined,
  ) {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    const remoteIssue = {
      key: "TEST-1",
      fields: { summary: "Remote name", updated: "2026-05-10T00:00:00" },
    } as unknown as JiraIssue;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.isIssueDone as ReturnType<typeof vi.fn>).mockReturnValue(remote.done);
    (jiraApi.issueToTaskFields as ReturnType<typeof vi.fn>).mockReturnValue({
      taskName: "Remote name",
      status: remote.status,
      completedDate: remote.completedDate,
    });
    (jiraApi.diffTaskAgainstIssue as ReturnType<typeof vi.fn>).mockReturnValue([
      { key: "completedDate", localValue: localCompletedDate, remoteValue: remote.completedDate },
    ]);
    await act(async () => { await result.current.handleJiraSync(); });
    expect(result.current.jiraConflicts.length).toBeGreaterThan(0);
    // Guard: prove the diff really carries the completion field, so a future
    // edit to the mock cannot silently return this suite to the taskName-only
    // shape that made the arm unreachable.
    expect(result.current.jiraConflicts[0].fields.map((f) => f.key)).toContain("completedDate");
  }
```

Add `TaskStatus` to the existing `import type { ... } from "./types"` line in this test file if it is not already imported.

- [ ] **Step 2: Write the four failing tests**

```ts
  it("conflict (a): local Done, issue reopened, pick remote → status follows Jira, pair consistent", async () => {
    const localTask = makeTask({
      id: 1, jiraKey: "TEST-1", status: "Done", completedDate: "2026-04-01",
      lastSyncedAt: "2026-01-01T00:00:00", localModifiedAt: "2026-05-01T00:00:00",
    });
    const { result } = renderSync([localTask]);
    await setupCompletionConflict(
      result,
      { status: "In Progress", completedDate: undefined, done: false },
      "2026-04-01",
    );
    vi.clearAllMocks();

    const resolution: import("./jira-conflicts-modal").ConflictResolution = {
      taskId: 1, jiraKey: "TEST-1", picks: { completedDate: "remote" },
    };
    await act(async () => { await result.current.handleResolveConflicts([resolution]); });

    const merged = result.current.currentTasks[0];
    expect(merged.completedDate).toBeFalsy();
    expect(merged.status).toBe("In Progress");   // NOT left at the local "Done"
    expectPairConsistent(merged);
  });

  it("conflict (b): local open, issue completed, pick remote → Jira's date, not today", async () => {
    const localTask = makeTask({
      id: 1, jiraKey: "TEST-1", status: "In Progress",
      lastSyncedAt: "2026-01-01T00:00:00", localModifiedAt: "2026-05-01T00:00:00",
    });
    const { result } = renderSync([localTask]);
    await setupCompletionConflict(
      result,
      { status: "Done", completedDate: "2026-05-09", done: true },
      undefined,
    );
    vi.clearAllMocks();

    const resolution: import("./jira-conflicts-modal").ConflictResolution = {
      taskId: 1, jiraKey: "TEST-1", picks: { completedDate: "remote" },
    };
    await act(async () => { await result.current.handleResolveConflicts([resolution]); });

    const merged = result.current.currentTasks[0];
    expect(merged.completedDate).toBe("2026-05-09"); // Jira's resolution date
    expect(merged.status).toBe("Done");              // NOT left at the local "In Progress"
    expectPairConsistent(merged);
  });

  it("conflict (a): pick local → the local pair survives intact", async () => {
    const localTask = makeTask({
      id: 1, jiraKey: "TEST-1", status: "Done", completedDate: "2026-04-01",
      lastSyncedAt: "2026-01-01T00:00:00", localModifiedAt: "2026-05-01T00:00:00",
    });
    const { result } = renderSync([localTask]);
    await setupCompletionConflict(
      result,
      { status: "In Progress", completedDate: undefined, done: false },
      "2026-04-01",
    );
    vi.clearAllMocks();
    (jiraApi.taskFieldsToJiraFields as ReturnType<typeof vi.fn>).mockReturnValue({ summary: "x" });
    (jiraApi.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    (jiraApi.transitionIssueTo as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const resolution: import("./jira-conflicts-modal").ConflictResolution = {
      taskId: 1, jiraKey: "TEST-1", picks: { completedDate: "local" },
    };
    await act(async () => { await result.current.handleResolveConflicts([resolution]); });

    const merged = result.current.currentTasks[0];
    expect(merged.completedDate).toBe("2026-04-01");
    expect(merged.status).toBe("Done");
    expectPairConsistent(merged);
  });

  it("conflict (b): pick local → stays open, no date adopted", async () => {
    const localTask = makeTask({
      id: 1, jiraKey: "TEST-1", status: "In Progress",
      lastSyncedAt: "2026-01-01T00:00:00", localModifiedAt: "2026-05-01T00:00:00",
    });
    const { result } = renderSync([localTask]);
    await setupCompletionConflict(
      result,
      { status: "Done", completedDate: "2026-05-09", done: true },
      undefined,
    );
    vi.clearAllMocks();
    (jiraApi.taskFieldsToJiraFields as ReturnType<typeof vi.fn>).mockReturnValue({ summary: "x" });
    (jiraApi.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const resolution: import("./jira-conflicts-modal").ConflictResolution = {
      taskId: 1, jiraKey: "TEST-1", picks: { completedDate: "local" },
    };
    await act(async () => { await result.current.handleResolveConflicts([resolution]); });

    const merged = result.current.currentTasks[0];
    expect(merged.completedDate).toBeFalsy();
    expect(merged.status).toBe("In Progress");
    expectPairConsistent(merged);
  });
```

- [ ] **Step 3: Run and confirm the two remote-pick tests are RED**

```bash
npx vitest run src/app/use-jira-sync.test.tsx > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |conflict \(a\)|conflict \(b\)" /tmp/t6.log | head -20
```

Expected: `EXIT=1`. Specifically:
- `conflict (a): ... pick remote` **FAILS** — `merged.status` is `"Done"` (the stale local value) where the test wants `"In Progress"`.
- `conflict (b): ... pick remote` **FAILS** — `merged.status` is `"In Progress"` where the test wants `"Done"`.
- Both `pick local` tests **PASS** already — `merged` starts from `original`, so the local pair survives without any fix. They are regression guards.

**If either remote-pick test passes here, stop and investigate.** The most likely cause is that the diff mock was not widened and the `completedDate` arm never ran — the guard assertion in `setupCompletionConflict` should have caught that, so a pass with the guard intact means the merge is behaving differently from this plan's reading of it.

- [ ] **Step 4: Commit the RED tests**

Committing them red is deliberate: the next commit's diff then shows exactly which assertions the fix turns green.

```bash
git add src/app/use-jira-sync.test.tsx
git commit -F - <<'MSGEOF'
test(jira): cover the conflict merge's completedDate arm, which never ran

Every conflict fixture in this file mocked diffTaskAgainstIssue to return a
taskName-only diff -- four sites -- so the completedDate branch of the merge
loop has never executed under the suite, despite four picks objects naming the
field. These four tests are the first to reach it.

The two remote-pick tests are RED and committed RED on purpose, so the fix
commit's diff shows exactly which assertions it turns green. The two local-pick
tests already pass: merged starts from the local row, so that side survives
without any fix, and they exist as regression guards.

setupCompletionConflict asserts the queued conflict really carries the
completion field, so a future edit cannot silently return this suite to the
taskName-only shape that made the arm unreachable in the first place.

Refs open-followups 183.
MSGEOF
echo "EXIT=$?"
```

---

## Task 7: write both halves of the pair from one side

**Files:**
- Modify: `src/app/use-jira-sync.ts`

- [ ] **Step 1: Implement the merge fix**

In `src/app/use-jira-sync.ts`, inside `handleResolveConflicts`, find the `completedDate` branch of the per-field loop:

```ts
        } else if (field.key === "completedDate") {
          merged.completedDate =
            typeof value === "string" && value ? value : undefined;
          completionChanged = true;
```

Replace it with:

```ts
        } else if (field.key === "completedDate") {
          merged.completedDate =
            typeof value === "string" && value ? value : undefined;
          // ★★★ Write BOTH halves of the coupled pair from the side the user
          //   picked. `status` is deliberately not a ConflictFieldKey: offering
          //   it as its own row would let the user pick local for one half and
          //   remote for the other, i.e. construct the split pair by hand.
          //   Taking both from one side inherits the guarantee the pull path
          //   already has — issueToTaskFields derives completedDate and status
          //   from ONE statusKey read, so remoteStatus and the remote date
          //   cannot disagree; the local pair came from applyStatusChange.
          // ★★ NOT applyStatusChange here: it would stamp `today` over Jira's
          //   real resolution date, which is why every Jira write site bypasses
          //   that engine. NOT reconcileStatusFromDate either: it decides status
          //   from date PRESENCE and would rewrite a reopened issue's genuine
          //   "In Progress" into "To Do".
          merged.status = pick === "local" ? original.status : conflict.remoteStatus;
          completionChanged = true;
```

- [ ] **Step 2: Run and confirm all four tests pass**

```bash
npx vitest run src/app/use-jira-sync.test.tsx > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t7.log
```

Expected: `EXIT=0`, with the two previously-red tests now green and every pre-existing test in the file still passing.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 4: Commit**

```bash
git add src/app/use-jira-sync.ts
git commit -F - <<'MSGEOF'
fix(jira): write status and completedDate from the same side on conflict resolve

The conflict merge seeded from the local row and then overwrote per picked
field. completedDate had a branch; status had none and could not have one --
it is not a ConflictFieldKey and diffTaskAgainstIssue never offers it. So the
merge wrote one half of a coupled pair and left the other local.

Both failure directions were the DEFAULT path: the modal seeds every pick to
"remote" and the merge falls back to "remote" again for any omitted key, so
both were reached by opening the modal and pressing confirm without touching
the completion row. Local Done plus a reopened issue gave Done-with-no-date;
local open plus a completed issue gave a completion date on an open row. The
first is dropped from both terms of the completion percentage and reported as
cancelled scope; the second is counted complete by Reports while the table goes
on listing it as open.

The fix takes both halves from the picked side, inheriting the property the
pull path already has: issueToTaskFields derives both fields from one statusKey
read, so they cannot disagree. It does not route through applyStatusChange --
that would stamp today over Jira's resolution date, the reason every other Jira
write site bypasses it -- nor through reconcileStatusFromDate, which decides
status from date presence and would rewrite a reopened issue's real
"In Progress" into "To Do".

Closes open-followups 183.
MSGEOF
echo "EXIT=$?"
```

- [ ] **Step 5: Mutation-check the fix**

Run this **after** the commit, so `git checkout --` restores the committed fix rather than throwing your edit away.

```bash
node -e "
const fs=require('fs'); const p='src/app/use-jira-sync.ts';
const s=fs.readFileSync(p,'utf8');
const m=s.replace('          merged.status = pick === \"local\" ? original.status : conflict.remoteStatus;','          merged.status = original.status;');
if (m===s) { console.error('MUTANT DID NOT LAND — anchor not found'); process.exit(1); }
fs.writeFileSync(p,m); console.log('mutant landed');
"
echo "EXIT=$?"
npx vitest run src/app/use-jira-sync.test.tsx > /tmp/t7m.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t7m.log
git checkout -- src/app/use-jira-sync.ts
git status --porcelain -uall | grep -v "^??"; echo "TRACKED_CHANGES_ABOVE (empty = clean, fix restored)"
```

Expected: `mutant landed`, then vitest `EXIT=1` (the two remote-pick tests fail again), then a clean tree.

★★ The mutant chosen — collapsing the ternary to `original.status` — is the exact pre-fix behaviour, so it proves the new tests detect the defect they were written for. A mutant that merely broke compilation would prove nothing.

---

## Task 8: tell the user the completion pick moves the status

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

- [ ] **Step 1: Add the EN key**

In `src/app/i18n.ts`, find the line `  jiraConflictRemote: "Remote (Jira)",` and add immediately after it:

```ts
  jiraConflictCompletionNote: "The side you choose also sets the task status.",
```

- [ ] **Step 2: Add the DE key with a node utf8 write**

**★★ Do NOT use the Edit tool on `i18n.de.ts`.** It corrupts umlauts and curls double quotes there. The file is CRLF, so the anchor must match `\r\n`.

```bash
node -e "
const fs=require('fs'); const p='src/app/i18n.de.ts';
const s=fs.readFileSync(p,'utf8');
const anchor='  jiraConflictRemote: \"Remote (Jira)\",\r\n';
if (!s.includes(anchor)) { console.error('ANCHOR NOT FOUND — check CRLF'); process.exit(1); }
const add='  jiraConflictCompletionNote: \"Die gew\u00e4hlte Seite legt auch den Status der Aufgabe fest.\",\r\n';
if (s.includes('jiraConflictCompletionNote')) { console.error('ALREADY PRESENT'); process.exit(1); }
fs.writeFileSync(p, s.replace(anchor, anchor+add), 'utf8');
console.log('DE key inserted');
"
echo "EXIT=$?"
```

Expected: `DE key inserted`, `EXIT=0`.

- [ ] **Step 3: Verify the umlaut survived as a real character**

```bash
grep -n "jiraConflictCompletionNote" src/app/i18n.ts src/app/i18n.de.ts
node -e "
const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');
const line=s.split('\r\n').find(l=>l.includes('jiraConflictCompletionNote'));
console.log(JSON.stringify(line));
console.log('has real ä:', line.includes('\u00e4'));
console.log('has ASCII sub:', /ae|ue|oe/.test(line));
"
```

Expected: the DE line prints with a literal `ä`, `has real ä: true`, and no `\u00XX` escape in the file (the `\u00e4` above is in the *node script*, which writes a real character — the stored byte must be the character, not the escape).

- [ ] **Step 4: Typecheck (EN/DE key parity is enforced by tsc)**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`. A key present in one dictionary and not the other fails here.

- [ ] **Step 5: Run the encoding guard**

```bash
npx vitest run src/app/i18n-encoding.test.ts > /tmp/t8.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t8.log
```

Expected: `EXIT=0`. If the file name differs, find it with `ls src/app/i18n*.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n: note that the completion conflict pick also sets the status"
echo "EXIT=$?"
```

---

## Task 9: render the note on the completion row

**Files:**
- Modify: `src/app/jira-conflicts-modal.tsx`
- Test: `src/app/jira-conflicts-modal.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/jira-conflicts-modal.test.tsx`. The existing `CONFLICT` fixture has no `completedDate` field, so this test needs its own — build it inline rather than mutating the shared one.

```ts
it("states on the completion row that the pick also sets the status", () => {
  const conflict: ConflictItem = {
    taskId: 7,
    jiraKey: "PROJ-9",
    remoteDone: true,
    remoteStatus: "Done",
    fields: [
      { key: "taskName", localValue: "Local title", remoteValue: "Remote title" },
      { key: "completedDate", localValue: undefined, remoteValue: "2026-05-09" },
    ],
  };
  setup({ conflicts: [conflict] });
  expect(
    screen.getByText("The side you choose also sets the task status."),
  ).toBeInTheDocument();
});

it("shows no such note when no completion field is in conflict", () => {
  setup(); // the shared CONFLICT fixture carries taskName + priority only
  expect(
    screen.queryByText("The side you choose also sets the task status."),
  ).toBeNull();
});
```

**★ Use the file's existing `setup(over)` helper**, which renders with
`lang="en-US"` and spreads `over` — do not hand-roll a `render` call. The modal's
callback prop is **`onClose`, not `onCancel`**; a hand-rolled render that guesses
`onCancel` fails tsc, which vitest would never have told you.

- [ ] **Step 2: Run to verify the first test fails**

```bash
npx vitest run src/app/jira-conflicts-modal.test.tsx > /tmp/t9.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |also sets" /tmp/t9.log | head
```

Expected: `EXIT=1` — the note is not rendered yet. The second test (absence) passes already; it is the guard that stops the note being rendered unconditionally.

- [ ] **Step 3: Implement**

In `src/app/jira-conflicts-modal.tsx`, find the field-label `<td>`:

```tsx
                        <td className="px-2 py-2 align-top font-medium text-foreground">
                          {t(lang, fieldLabelKey[f.key])}
                          {lockedRemote && (
                            <span className="ml-1 text-muted-foreground">
                              🔒
                            </span>
                          )}
                        </td>
```

Replace it with:

```tsx
                        <td className="px-2 py-2 align-top font-medium text-foreground">
                          {t(lang, fieldLabelKey[f.key])}
                          {lockedRemote && (
                            <span className="ml-1 text-muted-foreground">
                              🔒
                            </span>
                          )}
                          {/* ★★ The completion pick moves `status` as well as the
                              date (both halves come from one side — see the
                              completedDate branch of handleResolveConflicts).
                              Without this line a status change hides behind a
                              date label. */}
                          {f.key === "completedDate" && (
                            <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                              {t(lang, "jiraConflictCompletionNote")}
                            </span>
                          )}
                        </td>
```

- [ ] **Step 4: Run to verify both tests pass**

```bash
npx vitest run src/app/jira-conflicts-modal.test.tsx > /tmp/t9.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t9.log
```

Expected: `EXIT=0`.

- [ ] **Step 5: Check the palette rule by eye-free inspection**

```bash
grep -n "text-\[10px\]\|text-muted-foreground" src/app/jira-conflicts-modal.tsx | head
```

The note uses only `text-muted-foreground`, an existing sanctioned token already used elsewhere in this same file, and adds no colour, gradient or shadow. No new palette token is introduced, so the palette-sweep test is unaffected. The Jira conflicts modal is not in `A11Y_VIEWS`, so no axe run applies.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/jira-conflicts-modal.tsx src/app/jira-conflicts-modal.test.tsx
git commit -F - <<'MSGEOF'
feat(jira): say on the completion row that the pick also sets the status

The completion conflict now writes status alongside the date, both from the
picked side. Rendered as it was, that is a status change hidden behind a date
label -- the user is told they are choosing a completion date and a workflow
status moves too.

Rendered only for the completedDate row, with a test asserting its ABSENCE on a
conflict that has no completion field, so it cannot regress into an
unconditional note.
MSGEOF
echo "EXIT=$?"
```

---

## Task 10: close §182 and §183, open §226

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Confirm the register number before writing it**

```bash
git fetch origin --quiet
git show origin/main:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -1
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
```

Expected: `224` from both. **§225 is claimed by the unpushed branch `feat/timelog-booking-review-tl1` and must NOT be reused here** — a number is reserved only once it is on `origin/main`, and this register already records the same number being minted twice, twice. If `origin/main` now shows 225 or higher, re-derive and use max+1 instead of 226, and update every mention of "226" in this task.

- [ ] **Step 2: Mark §182 closed**

Find the heading line `## 182. Template import can store an inconsistent \`status\`/\`completedDate\` pair, and nothing repairs it — open` and change the trailing `— open` to `— CLOSED 2026-08-23`. Then insert immediately below the heading:

```markdown
**Status:** CLOSED 2026-08-23 by 0.257.0 "Shepard". `sanitizeSeedTask` now ends
`return reconcileStatusFromDate(migrateTask(task));`. The rule trusts the DATE: a
`completedDate` present forces `Done`; `Done` with no date demotes to
`DEFAULT_TASK_STATUS`. Nothing is invented and no date is deleted — the
alternative would have to fabricate a delivery date that then flows into the
on-time/late split and earned value.

★ The third option considered and rejected — that templates carry no completion
at all, since `templateFromWorkspace` re-seeds a NEW project with a date earned
in a DIFFERENT one — is recorded in the design spec rather than lost:
`docs/superpowers/specs/2026-08-23-task-status-pair-invariant-design.md`.

★★ This repairs the WRITER, not the DATA. A workspace that already holds a split
pair from a past import still holds it; nothing reconciles on load, and
deliberately so (see the ★★ against `migrateTask` in the AGENTS.md task-status
bullet).
```

- [ ] **Step 3: Mark §183 closed**

Same treatment on `## 183.` — change `— open` to `— CLOSED 2026-08-23` and insert below the heading:

```markdown
**Status:** CLOSED 2026-08-23 by 0.257.0 "Shepard". The merge's `completedDate`
branch now writes `merged.status` alongside the date, taking both from the side
the user picked: remote from `conflict.remoteStatus` (a new field on
`ConflictItem`, filled from the `issueToTaskFields` patch the construction site
already computes), local from `original.status`.

★ This holds the invariant by the SAME mechanism the pull path already uses —
`issueToTaskFields` derives both fields from one `statusKey` read — rather than
by a new rule. None of the three options weighed in this entry was taken:
adding `status` to `ConflictFieldKey` would let the user construct the split
pair by hand; re-deriving status from the resolved date cannot tell a reopened
issue's "In Progress" from "To Do"; and `applyStatusChange` would stamp `today`
over Jira's resolution date.

★★ The "Not determined" paragraph above is now partly answered: the merge's
`completedDate` arm HAS been exercised, by four tests in `use-jira-sync.test.tsx`
covering both directions at both picks. The `transitionIssueTo` question it
raises is still open.

★★ This repairs the WRITER, not the DATA. A row already split by a past
resolution stays split until its issue changes again and the plain pull branch
rewrites both fields.
```

- [ ] **Step 4: Append §226 at the end of the file**

```markdown
## 226. The conflict path ignores a remote status change when the completion date does not differ

**Status:** open — a gap the §183 fix deliberately did not close.

§183 made the conflict merge write `status` and `completedDate` from one side.
It reaches `status` only through the `completedDate` branch, so it fires only
when a completion conflict is actually queued.

When the remote **status** differs but the **date** does not — local
"In Progress", remote "To Do", neither carrying a `completedDate` — no
completion row is queued, `status` is never written, and the row keeps its local
status indefinitely even though the user picked "remote" for every field they
were shown.

```bash
# status is not a member, so diffTaskAgainstIssue can never offer it
grep -n "export type ConflictFieldKey" -A 10 src/app/jira-api.ts
grep -n "^  check(\"" src/app/jira-api.ts
```

★★ The pair stays internally CONSISTENT throughout, which is why this is not
§183 and why none of §183's consequences apply — no surface disagrees with
another. The defect is staleness, not incoherence.

★ Fixing it means deciding whether `status` should be diffed at all on the
conflict path, which reopens the question §183's fix deliberately closed: a user
cannot arbitrate `status` independently of `completedDate` without being able to
construct the split pair by hand. A fix probably has to keep them as ONE row
whose value is the pair, rather than adding a second row.

★ Not determined: whether this is reachable often enough to matter. A Jira status
move without a resolution-date change is an ordinary transition (To Do → In
Progress), so it is likely common; but it also requires a simultaneous local
edit to queue a conflict at all, and nothing has measured that combination.

★★ **§225 is deliberately absent from this register on this branch.** It is
claimed by `feat/timelog-booking-review-tl1`, which was unpushed when this entry
was written, so the number was not yet reserved on `origin/main` (max 224). The
gap closes when that branch merges. Minting the same number twice is a failure
this register has already recorded happening twice (§202 → §214 → §215).
```

- [ ] **Step 5: Verify the register parses and the doc gates pass**

```bash
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
grep -c "^## 225\." docs/open-followups.md; echo "(0 expected — 225 is reserved elsewhere)"
npm run docs:claims:check > /tmp/t10.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/t10.log
```

Expected: max is `226`, no §225, and `docs:claims:check` `EXIT=0`. That gate is a RATCHET — it fails on any NEW `path:LINE` citation. The text above deliberately cites symbols and greps, never line numbers.

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md
git commit -m "docs: close 182 and 183, open 226 for the status-only conflict gap"
echo "EXIT=$?"
```

---

## Task 11: rewrite the AGENTS.md task-status bullet

**Files:**
- Modify: `AGENTS.md`

The bullet currently states that two of the four writers do NOT hold the invariant. After this slice all four do, so three blocks are now false.

- [ ] **Step 1: Locate the blocks**

```bash
grep -n "IT IS NOT THE SOLE WRITER OF THE PAIR\|THE LOAD-PATH REPAIR IS\|TWO OF THE FOUR WRITERS DO NOT HOLD IT" AGENTS.md
```

Expected: three line numbers inside the `- **Task status model:**` bullet.

- [ ] **Step 2: Replace the first block**

Replace the block that begins `★★★ IT IS NOT THE SOLE WRITER OF THE PAIR, AND THIS BULLET SAID IT WAS.` and ends `(\`docs/open-followups.md\` §183).` with:

```markdown
  ★★★ IT IS NOT THE SOLE WRITER OF THE PAIR. Four paths write it and they hold the invariant by
  THREE DIFFERENT MECHANISMS — copying one path's mechanism to another is how two of them were
  broken, so do not "complete the pattern". **Jira sync's PATCH-application sites** (pull, create,
  read-only): `issueToTaskFields` derives BOTH fields from one `statusKey` read (`completedDate`
  through its `isDone` boolean, `status` through `jiraCategoryToStatus`), so that patch's pair cannot
  drift. **The Jira CONFLICT merge** (`handleResolveConflicts`): its `completedDate` branch writes
  `merged.status` beside the date, both from the side the user picked — remote from
  `conflict.remoteStatus` (carried on `ConflictItem` off that same patch), local from
  `original.status`. **Template import** (`sanitizeSeedTask`): its two reads of the seed are
  independent, so it ends by calling `reconcileStatusFromDate`, which trusts the DATE — a date
  present forces `Done`, a `Done` with no date demotes to `DEFAULT_TASK_STATUS`, and nothing is
  invented or deleted.
  ★★★ DO NOT ROUTE EITHER JIRA PATH THROUGH `applyStatusChange` **OR** THROUGH
  `reconcileStatusFromDate`, however much one writer looks tidier. `applyStatusChange` would stamp
  `today` over Jira's real resolution date. `reconcileStatusFromDate` decides `status` from date
  PRESENCE, so it would rewrite a reopened issue's genuine "In Progress" into "To Do" purely because
  the issue carries no date. Each mechanism is correct for its own source of truth and wrong for the
  other two.
```

- [ ] **Step 3: Replace the third block**

Replace the block beginning `★★ TWO OF THE FOUR WRITERS DO NOT HOLD IT` and ending `into code comments and commit messages.` with:

```markdown
  ★★ ALL FOUR WRITERS HOLD IT SINCE 0.257.0, and that is a claim about the four paths in `src`, NOT
  about the DATA. A workspace blob written by an older build, hand-edited, or imported from a
  third-party template can still carry a split pair, and nothing reconciles it on load. `sanitizeSeedTask`
  (§182) and the Jira conflict merge (§183) were the two that did not hold it; both entries record
  what each used to do and what a split pair costs on the surfaces.
  ★★ Do NOT close the remaining data gap by teaching `migrateTask` to reconcile. It runs on all six
  load paths, so that changes every backend's load behaviour, and it would apply the date-wins rule
  to Jira rows, where it is wrong.
```

- [ ] **Step 4: Correct the one sentence in the second block that is now stale**

Inside the `★★★ THE LOAD-PATH REPAIR IS \`migrateTask\`` block, find the sentence:

```
  The invariant is held by SOME of the WRITERS, not at load — `applyStatusChange` by construction,
  and `issueToTaskFields` because BOTH fields derive from one `statusKey` read (`completedDate` through
  its `isDone` boolean, `status` through `jiraCategoryToStatus`), so THAT PATCH's pair cannot drift.
```

Replace it with:

```
  The invariant is held by the WRITERS, not at load — all four of them since 0.257.0, by the three
  mechanisms listed above.
```

- [ ] **Step 5: Verify no stale claim survives**

```bash
grep -n "TWO OF THE FOUR WRITERS\|THE THIRD\b.*not deliberate\|SOME of the WRITERS" AGENTS.md; echo "EXIT=$? (1 = clean)"
grep -n "reconcileStatusFromDate\|remoteStatus" AGENTS.md
```

Expected: the first grep finds nothing (`EXIT=1`); the second finds the new names.

- [ ] **Step 6: Run the symbol gate**

```bash
npm run docs:symbols:check > /tmp/t11.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/t11.log
```

Expected: `EXIT=0`. This gate fails when a backticked MIXED-CASE name in `AGENTS.md` exists nowhere in `src`/`scripts`/`e2e` — so it proves `reconcileStatusFromDate`, `remoteStatus`, `conflict.remoteStatus` and `handleResolveConflicts` are real. **It does not prove any claim about them is true**, and it skips `SCREAMING_CASE` entirely, so `DEFAULT_TASK_STATUS` in the new text is ungated.

- [ ] **Step 7: Verify the replacement text's own claims**

★★ A correction is a NEW claim and inherits none of the verification of the error it replaces. Run these against the text just written, not against the text it replaced:

```bash
# "both from the side the user picked" — one line, both fields, in the completedDate branch
grep -n "merged.status = pick" -B 2 src/app/use-jira-sync.ts
# "carried on ConflictItem off that same patch"
grep -n "remoteStatus" src/app/jira-api.ts src/app/use-jira-sync.ts
# "sanitizeSeedTask ends by calling reconcileStatusFromDate"
grep -n "return reconcileStatusFromDate" src/app/templates.ts
# "a Done with no date demotes to DEFAULT_TASK_STATUS"
grep -n "DEFAULT_TASK_STATUS" src/app/task-status.ts
```

Each must return the line the sentence describes. If one does not, the sentence is wrong — fix the sentence, not the grep.

- [ ] **Step 8: Commit**

```bash
git add AGENTS.md
git commit -F - <<'MSGEOF'
docs: all four writers of the status/completedDate pair now hold the invariant

The bullet said two of four did not, which was true when written and is no
longer. It now names the THREE mechanisms -- one statusKey read on the Jira
patch sites, one-side-writes-both on the conflict merge, date-wins on template
import -- and says explicitly that neither Jira path may be routed through
applyStatusChange OR reconcileStatusFromDate, since each engine is wrong for
the other's source of truth.

Scoped honestly: holding it in the four writers is a claim about src, not about
the data. Nothing reconciles a split pair on load, and the note against
migrateTask says why that stays true.
MSGEOF
echo "EXIT=$?"
```

---

## Task 12: version bump to 0.257.0 "Shepard"

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md`

**★★ Five of these carry the version and NO gate checks any of them.** Verified drift: `package.json` was stuck six releases behind and `package-lock.json` eleven. Bump them in the same commit or the drift restarts.

- [ ] **Step 1: Re-verify the codename is unused, case-INSENSITIVELY**

```bash
grep -ci "shepard" CHANGELOG.md; echo "(0 expected)"
```

Expected: `0`. **★★ A case-SENSITIVE check is not enough** — it passed "VanderMeer" while `grep -ci` found it at 0.96.0, which is how the spec first named an already-used codename. If this returns non-zero, pick another and update every mention below.

- [ ] **Step 2: Bump `src/app/version.ts`**

Set:
```ts
export const APP_VERSION = "0.257.0";
export const APP_BUILD_DATE = "2026-08-23"; // 0.257.0: status/completedDate pair invariant (Shepard)
export const APP_MILESTONE = "Shepard";
```

★ `APP_MILESTONE` is a separate constant from `APP_VERSION` and has been forgotten before, shipping `0.248.0 "Butcher"` in the top bar. Set all three.

★ No `versionHighlight*` key is required — that list is for user-facing feature highlights and this release ships none. Leave `APP_HIGHLIGHT_KEYS` untouched.

- [ ] **Step 3: Add the CHANGELOG entry**

Insert at the top of the entry list in `CHANGELOG.md`, matching the format of the entry directly below it (read it first — the heading format has changed across the file's history):

```markdown
### Fixed
- **The `status` / `completedDate` pair can no longer be split by template import or by resolving a Jira conflict.** The app asks two different questions about a finished task — `isTaskClosed` reads `status`, `isTaskDelivered` reads `completedDate` — so a row where the two disagree was counted complete on one tile and overdue on another, in the same render. Resolving a Jira conflict hit this on the default path: accepting "remote" for a completion date wrote the date and left the status local, either producing a `Done` row with no date (dropped from both terms of the completion percentage, and reported as cancelled scope, which raised the reported percentage for every other row) or a completion date on a row the task table still listed as open. Importing a template could store the same shape. Both paths now write the two fields together.
```

★ **No `[session link removed]...` URL may appear in `CHANGELOG.md`.**

- [ ] **Step 4: Bump the four ungated version strings**

```bash
node -e "
const fs=require('fs');
const bump=(p,from,to)=>{const s=fs.readFileSync(p,'utf8');
  const n=s.split(from).join(to);
  if(n===s){console.error('NO CHANGE in '+p+' — anchor '+from+' not found');process.exit(1);}
  fs.writeFileSync(p,n);console.log(p+': '+(s.split(from).length-1)+' replacement(s)');};
bump('package.json','\"version\": \"0.256.1\"','\"version\": \"0.257.0\"');
bump('package-lock.json','\"version\": \"0.256.1\"','\"version\": \"0.257.0\"');
"
echo "EXIT=$?"
```

Expected: `package.json: 1 replacement(s)` and `package-lock.json: 2 replacement(s)` — the root `version` and the `packages[""]` one. **If package-lock reports 1, stop and find the second occurrence by hand**; the two have drifted apart before.

- [ ] **Step 5: Bump the README badge and the five codemap headers**

```bash
grep -n "0\.256\.1\|Khaw" README.md docs/CODEMAPS/*.md
```

Update every hit: the README shields badge carries BOTH the version and the codename, and each of the five `docs/CODEMAPS/*.md` files has a `<!-- Generated: … | App <version> "<codename>" … -->` header.

- [ ] **Step 6: Verify no stale version string remains**

```bash
grep -rn "0\.256\.1" package.json package-lock.json README.md docs/CODEMAPS/ src/app/version.ts; echo "EXIT=$? (1 = clean)"
grep -c "0\.257\.0" src/app/version.ts package.json CHANGELOG.md
```

Expected: the first grep finds nothing.

- [ ] **Step 7: Commit**

```bash
git add src/app/version.ts CHANGELOG.md package.json package-lock.json README.md docs/CODEMAPS/
git commit -m "chore(release): 0.257.0 \"Shepard\""
echo "EXIT=$?"
```

---

## Task 13: full gate run

**Files:** none — verification only.

- [ ] **Step 1: Confirm the tree is clean and no mutant survived**

```bash
git status --porcelain -uall | grep -v "^??"; echo "TRACKED_CHANGES_ABOVE (empty = clean)"
grep -rn "if (false) {" src/app/task-status.ts; echo "EXIT=$? (1 = no mutant)"
grep -n "merged.status = original.status;$" src/app/use-jira-sync.ts; echo "EXIT=$? (1 = no mutant)"
```

Expected: clean tree, both greps finding nothing. **★★ A report is a claim about WORK, not about the tree** — sweep for live mutants before reporting anything green.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 3: Lint**

```bash
npm run lint > /tmp/lint.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/lint.log
```

Expected: `EXIT=0`. **★★ There is no `--max-warnings` gate**, so an unused import ships green — check the output by eye for `no-unused-vars` warnings introduced by this slice, particularly in `use-jira-sync.test.tsx` where imports were added.

- [ ] **Step 4: Full unit suite**

```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```

Expected: `EXIT=0`. **Run this in the FOREGROUND.** A backgrounded full suite has been killed mid-run in this repo and the notification reported the trailing pipe's exit code, not vitest's.

- [ ] **Step 5: Shuffled suite**

```bash
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
```

Expected: `EXIT=0`. This is the only local reproduction of CI's `unit-tests-shuffled` gate, and this slice adds tests to three files. A shared-mock leak between the new `setupCompletionConflict` and the existing `setupConflict` would surface here and nowhere else.

- [ ] **Step 6: Coverage**

```bash
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"; grep -E "All files|task-status|templates" /tmp/cov.log | head
```

Expected: `EXIT=0`. `task-status.ts` gained an exported function that is coverage-gated; the floors are global lines 92 / funcs 91 / branch 80 / stmts 89 plus per-engine globs.

- [ ] **Step 7: Doc and size gates**

```bash
npm run docs:symbols:check > /tmp/g1.log 2>&1; echo "SYMBOLS_EXIT=$?"; tail -4 /tmp/g1.log
npm run docs:claims:check  > /tmp/g2.log 2>&1; echo "CLAIMS_EXIT=$?";  tail -6 /tmp/g2.log
npm run size:check         > /tmp/g3.log 2>&1; echo "SIZE_EXIT=$?";    tail -4 /tmp/g3.log
npm run dup:check          > /tmp/g4.log 2>&1; echo "DUP_EXIT=$?";     tail -4 /tmp/g4.log
```

Expected: all four `EXIT=0`.

- [ ] **Step 8: Report**

Report each gate's exit code as measured. Do not summarise a red run as green, and do not report a gate that was not run. If any gate is red, fix it and re-run that gate plus the full suite before reporting.

**Do NOT push, do NOT open an MR, and do NOT merge.** The user has said explicitly: no release, no MR, without their say-so.

---

## Task 14: record the slice in memory

**Files:**
- Create: `C:\Users\sebastian.maute\.claude\projects\C--Projects-aipm-cockpit\memory\task-status-pair-invariant-shepard.md`
- Modify: `C:\Users\sebastian.maute\.claude\projects\C--Projects-aipm-cockpit\memory\MEMORY.md`

- [ ] **Step 1: Write the topic file**

```markdown
---
name: task-status-pair-invariant-shepard
description: 0.257.0 Shepard — closed followups 182 + 183 so all four writers of the status/completedDate pair hold the invariant; opened 226.
metadata:
  type: project
---

Branch `fix/task-status-pair-invariant` off `origin/main` at `2a1cfdef`.
Closes `docs/open-followups.md` §182 (template import) and §183 (Jira conflict
merge); opens §226 (a remote status change with no date change is still ignored
on the conflict path).

★★★ **The merge arm being fixed had NEVER executed under the suite.** All four
existing conflict fixtures in `use-jira-sync.test.tsx` mock
`diffTaskAgainstIssue` to return a `taskName`-only diff, while four `picks`
objects name `completedDate` — so the field looked covered and was not. A new
test that reuses the old helper passes against the unfixed code. The fix's own
tests assert the queued conflict really carries the completion field, so the
suite cannot drift back to the unreachable shape.

★★★ **Three mechanisms, not one.** `applyStatusChange` (construction),
`issueToTaskFields` (both fields from one `statusKey` read), and the new
`reconcileStatusFromDate` (date wins, seed/import only). Each is WRONG for the
others' paths — `applyStatusChange` would stamp `today` over Jira's resolution
date, and `reconcileStatusFromDate` would rewrite a reopened issue's real
"In Progress" into "To Do". The narrow name is the guard.

★★ **The writers hold it; the DATA does not.** Nothing reconciles a split pair
on load, and `migrateTask` must not be taught to — it runs on all six load
paths and would apply date-wins to Jira rows.

★★ A case-SENSITIVE codename check passed "VanderMeer" while `grep -ci` found
it at 0.96.0. Use `grep -ci` for milestone names. See
[[followup-number-reserved-on-origin-main]] for why this slice took §226 and
skipped §225.
```

- [ ] **Step 2: Add the index line**

Add to `MEMORY.md` under "Recent slices (newest first)":

```markdown
- [task-status-pair-invariant-shepard](task-status-pair-invariant-shepard.md) — **0.257.0 "Shepard"** (NOT pushed); §182+§183 closed, §226 opened. ★★★ the merge arm fixed had NEVER run — 4 fixtures all mocked a taskName-only diff while 4 picks objects named the field; ★★★ three mechanisms hold one invariant and each is wrong for the others' paths; ★★ writers hold it, DATA does not.
```

★★ `MEMORY.md` is over its size limit already — keep this to one line under ~200 chars and put every detail in the topic file.

- [ ] **Step 3: Update the header line**

Only if this slice is later merged. While it is unpushed, leave the `main = **0.256.1 "Khaw"**` header alone — it records what is on `origin/main`, not what is on a branch.

---

## Verify commands (run any time)

```bash
# the invariant's four writers
grep -rn "applyStatusChange(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
grep -n "return reconcileStatusFromDate" src/app/templates.ts
grep -n "merged.status = pick" src/app/use-jira-sync.ts
grep -n "status: jiraCategoryToStatus" src/app/jira-api.ts

# the new field, end to end
grep -n "remoteStatus" src/app/jira-api.ts src/app/use-jira-sync.ts src/app/jira-conflicts-modal.test.tsx

# the register
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
grep -c "^## 225\." docs/open-followups.md   # 0 — reserved by the parked TL1 branch

# no live mutant
grep -rn "if (false) {" src/app/task-status.ts
grep -n "merged.status = original.status;$" src/app/use-jira-sync.ts
```
