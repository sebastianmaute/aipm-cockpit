# Undo Write-Through Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Undoing or redoing a whole-row edit must never revert a field that a different writer changed on that row meanwhile — closing `docs/open-followups.md` §50 for note logs and for `outlookEventId`.

**Architecture:** Two complementary parts. **Part A** gives the pure undo engine a required `preserve` key list so a restored edit-image lets the live row win on those keys — a backstop covering every whole-row path. **Part B** converts the `bulk.edit` capture sites that are really field patches onto the existing `captureFieldPart` merge fragment, so those sites are immune by construction and preserve *every* concurrent edit, not just two named fields.

**Tech Stack:** TypeScript, React 19, Next.js 16, vitest 4 + React Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-18-undo-write-through-fields-design.md`

---

## Orientation for someone new to this codebase

Read these before Task 1. They are short and every task depends on them.

**The undo engine is two layers.**

- `src/app/undo/undo-stack.ts` — **pure**: no React, no i18n, no clock. It transforms arrays. This is where Part A's fix lives.
- `src/app/undo/use-undo-stack.ts` — the React hook that owns the stacks, builds labels, fires toasts, and closes over the state setters. This is where the field list and the new API live.

**Two capture shapes already exist and behave differently.**

- `capture` / `capturePart` build **whole-row before-images** (`BeforeImage<T> = {index, item, op}`). Undo replaces the row with `item`. **This is the bug.**
- `captureFieldEdit` / `captureFieldPart` build **field patches** and undo by merging `{...liveRow, ...patch}`. These are already immune.

**The bug, exactly.** In `undo-stack.ts`, `applyUndoRestoreWithRemap`'s edit branch does `out[out.findIndex(...)] = item`, and `applyUndoForward` (redo) does `out[idx] = item`. Both overwrite the whole live row.

**Repo rules that will bite you on this slice.**

- CI runs `eslint --max-warnings=0`. An unused import or variable is a **fatal build failure**, including `_`-prefixed params. `npm run lint` alone does NOT reproduce this — use `npx eslint --max-warnings=0 src/app`.
- `next build` does not typecheck test files and vitest never typechecks. **Run `npx tsc --noEmit` after editing any test.**
- **Never read a gate's exit code through a pipe.** `npm run test:run | tail -5` reports `tail`'s status. Redirect to a file, echo `$?` unpiped, then read the file.
- **Never run two vitest processes at once** — machine saturation is this repo's known flake condition.
- File-size ratchet: `npm run size:check` counts `readFileSync().split("\n").length`, i.e. `wc -l` **plus one**. Check headroom with:
  `node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"`
- Commit messages: conventional commits. Write them with a Bash heredoc (`git commit -F - <<'EOF'`), not a PowerShell here-string.

---

## File Structure

| File | Change | Responsibility after this slice |
|---|---|---|
| `src/app/undo/undo-stack.ts` | modify | Pure engine. Gains `applyPreserved` and a required `preserve` parameter on the three restore/forward entry points. |
| `src/app/undo/undo-stack.test.ts` | modify | Pure engine tests, incl. the new preserve behaviour in both directions. |
| `src/app/undo/use-undo-stack.ts` | modify | Owns `WRITE_THROUGH_FIELDS`, passes it at the four runner sites, gains `captureFieldRows`, and forwards `entityKey` from `CaptureCompositeOpts`. |
| `src/app/undo/field-groups.ts` | modify | Gains `buildBulkFieldEdits` — the shared before/after patch builder the four panels use. Lives here because `pick`, `valuesDiffer` and `NEVER_CAPTURE` are already here. |
| `src/app/undo/field-groups.test.ts` | modify | Tests for `buildBulkFieldEdits`. |
| `src/app/use-bulk-operations.ts` | modify | Task bulk edit captures field patches; the bucket composite flags its surviving `capturePart` primary. |
| `src/app/use-resource-planner.ts` | modify | `captureRaidBulkUndo` takes edits, not ids. |
| `src/app/use-change-log.ts` | modify | `captureBulkUndo` takes edits, not ids. |
| `src/app/use-stakeholders.ts` | modify | `captureBulkUndo` takes edits, not ids. |
| `src/app/raid-panel.tsx` · `change-panel.tsx` · `stakeholders-panel.tsx` | modify | `applyBulk` computes patched rows first, builds edits, then captures. |
| `src/app/milestones-panel.tsx` | modify | Same, via a new `captureFieldRows` prop. |
| `src/app/task-manager.tsx` | modify | Threads `captureFieldRows` to the milestones pane. |
| `docs/open-followups.md` | modify | §50 closed, §87 corrected, a new entry for Part B's residue. |

**Not touched, deliberately:** `use-alloc-plan.tsx:247` and `use-resource-directory.ts:280` carry `kind: "bulk.edit"` but replace whole rows rather than patching fields. Part A covers them. Converting them is out of scope.

---

## Task 0: Branch

**Files:** none

- [ ] **Step 1: Cut the branch from the merged main**

```bash
git fetch origin
git checkout -b feat/undo-write-through-fields origin/main
git log --oneline -1
```

Expected: `49ed5b56 Merge branch 'feat/changes-registers-timelog-batch' into 'main'`

- [ ] **Step 2: Confirm a clean baseline**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`. If it prints errors under `.next/dev/types/`, a dev server is running — stop it (`npm run stop`), delete `.next` with PowerShell `Remove-Item -Recurse -Force .next`, and re-run. Those are phantom errors, not real ones.

---

# PART A — the engine backstop

## Task 1: `applyPreserved` — the merge primitive

**Files:**
- Modify: `src/app/undo/undo-stack.ts`
- Test: `src/app/undo/undo-stack.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/undo/undo-stack.test.ts`. Add `applyPreserved` to the existing import from `./undo-stack`.

```ts
describe("applyPreserved", () => {
  type Row = { id: number; name: string; noteLog?: string[]; outlookEventId?: string };

  it("returns the image unchanged when there is nothing to preserve", () => {
    const image: Row = { id: 1, name: "before" };
    const live: Row = { id: 1, name: "after" };
    expect(applyPreserved(image, live, [])).toBe(image); // same reference
  });

  it("takes the LIVE value when the live row has the key", () => {
    const image: Row = { id: 1, name: "before", noteLog: ["old"] };
    const live: Row = { id: 1, name: "after", noteLog: ["old", "added since"] };
    expect(applyPreserved(image, live, ["noteLog"])).toEqual({
      id: 1, name: "before", noteLog: ["old", "added since"],
    });
  });

  it("lets an EMPTIER live value win — a cleared field stays cleared", () => {
    const image: Row = { id: 1, name: "before", outlookEventId: "evt-1" };
    const live: Row = { id: 1, name: "after", outlookEventId: undefined };
    const out = applyPreserved(image, live, ["outlookEventId"]);
    expect(out.outlookEventId).toBeUndefined();
    expect(out.name).toBe("before"); // the non-preserved field still reverts
  });

  it("DELETES the key when only the image has it, rather than leaving the stale value", () => {
    const image: Row = { id: 1, name: "before", noteLog: ["stale"] };
    const live: Row = { id: 1, name: "after" };
    const out = applyPreserved(image, live, ["noteLog"]);
    expect("noteLog" in out).toBe(false); // NOT toBeUndefined — that passes against a spread
  });

  it("never INVENTS a key that neither row carries", () => {
    const image: Row = { id: 1, name: "before" };
    const live: Row = { id: 1, name: "after" };
    const out = applyPreserved(image, live, ["noteLog", "outlookEventId"]);
    expect(Object.keys(out).sort()).toEqual(["id", "name"]);
  });

  it("preserves several keys independently in one pass", () => {
    const image: Row = { id: 1, name: "before", noteLog: ["a"], outlookEventId: "evt-1" };
    const live: Row = { id: 1, name: "after", noteLog: ["a", "b"] };
    const out = applyPreserved(image, live, ["noteLog", "outlookEventId"]);
    expect(out.noteLog).toEqual(["a", "b"]);
    expect("outlookEventId" in out).toBe(false);
  });

  it("does not mutate either input", () => {
    const image: Row = { id: 1, name: "before", noteLog: ["a"] };
    const live: Row = { id: 1, name: "after", noteLog: ["a", "b"] };
    applyPreserved(image, live, ["noteLog"]);
    expect(image.noteLog).toEqual(["a"]);
    expect(live.noteLog).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/undo/undo-stack.test.ts --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Tests |applyPreserved" /tmp/t1.log
```

Expected: non-zero exit; the failure names `applyPreserved` as not exported / not a function.

- [ ] **Step 3: Implement it**

In `src/app/undo/undo-stack.ts`, insert directly above `applyUndoRestore`:

```ts
/**
 * Merge one edit-image over the LIVE row, letting the live row win on the
 * `preserve` keys.
 *
 * ★★★ WHY THIS EXISTS. An edit-image is a whole-row snapshot taken when the op
 * ran, so restoring it verbatim also reverts anything a DIFFERENT writer changed
 * on that row meanwhile — a note added through the notes window, an
 * `outlookEventId` stamped by a background calendar push. See open-followups §50.
 *
 * ★★ IT MUST NOT INVENT A KEY. `{ ...image, noteLog: live.noteLog }` adds an
 * explicit `undefined` when NEITHER row carries one, which changes
 * `Object.keys` — and `rowsEqual` below compares key COUNT to confirm a row's
 * identity before redo removes it. No reachable break through that guard has
 * been demonstrated (a fresh capture clears the redo stack, and an id claimed by
 * a delete-image never reaches the edit branch), so this is hazard avoidance in
 * shared machinery rather than a fix for a known defect — do not write a test
 * claiming to reproduce one. The rule: the result carries exactly the keys one of
 * the two rows had.
 *
 * ★ Returns `image` BY REFERENCE when nothing applies, so the common
 * `preserve: []` case allocates nothing. Pure.
 */
export function applyPreserved<T extends { id: number }>(
  image: T,
  live: T,
  preserve: readonly string[],
): T {
  let out: T | null = null;
  for (const key of preserve) {
    const liveHas = Object.prototype.hasOwnProperty.call(live, key);
    const imageHas = Object.prototype.hasOwnProperty.call(image, key);
    if (!liveHas && !imageHas) continue;
    if (out === null) out = { ...image };
    const rec = out as unknown as Record<string, unknown>;
    if (liveHas) rec[key] = (live as unknown as Record<string, unknown>)[key];
    else delete rec[key];
  }
  return out ?? image;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/undo/undo-stack.test.ts --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t1.log
```

Expected: `EXIT=0`, all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/app/undo/undo-stack.ts src/app/undo/undo-stack.test.ts
git commit -F - <<'EOF'
feat(undo): add applyPreserved, the merge primitive for write-through fields

A whole-row edit-image reverts every field it captured, including ones a
different writer changed on that row since. applyPreserved merges the image
over the live row, letting the live row win on named keys.

It deliberately never invents a key: an explicit undefined would change
Object.keys, which rowsEqual reads as a row's identity.

Refs open-followups #50
EOF
```

---

## Task 2: Thread `preserve` through the engine

**Files:**
- Modify: `src/app/undo/undo-stack.ts`
- Test: `src/app/undo/undo-stack.test.ts`

The parameter is **required**, so every existing caller — including all existing tests — must be updated in this task. That is the point: a future call site that forgets it fails typecheck instead of silently reopening §50.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/undo/undo-stack.test.ts`:

```ts
describe("preserve on restore and redo", () => {
  type Row = { id: number; sev: string; noteLog?: string[] };
  const PRESERVE = ["noteLog"];

  it("undo reverts the edited field but keeps a note added since the capture", () => {
    const before: BeforeImage<Row>[] = [
      { index: 0, item: { id: 1, sev: "Low" }, op: "edit" },
    ];
    const live: Row[] = [{ id: 1, sev: "High", noteLog: ["added after the bulk edit"] }];
    const out = applyUndoRestore(live, before, PRESERVE);
    expect(out[0].sev).toBe("Low");
    expect(out[0].noteLog).toEqual(["added after the bulk edit"]);
  });

  it("redo re-applies the edit but keeps a note added since the UNDO", () => {
    const forward: BeforeImage<Row>[] = [
      { index: 0, item: { id: 1, sev: "High", noteLog: ["note A"] }, op: "edit" },
    ];
    const live: Row[] = [{ id: 1, sev: "Low", noteLog: ["note A", "note B"] }];
    const out = applyUndoForward(live, forward, PRESERVE);
    expect(out[0].sev).toBe("High");
    expect(out[0].noteLog).toEqual(["note A", "note B"]);
  });

  it("an empty preserve list is byte-identical to the old whole-row replace", () => {
    const before: BeforeImage<Row>[] = [
      { index: 0, item: { id: 1, sev: "Low" }, op: "edit" },
    ];
    const live: Row[] = [{ id: 1, sev: "High", noteLog: ["lost"] }];
    expect(applyUndoRestore(live, before, [])).toEqual([{ id: 1, sev: "Low" }]);
  });

  it("still skips an edit-image whose id a delete-image owns", () => {
    const before: BeforeImage<Row>[] = [
      { index: 0, item: { id: 1, sev: "Low" }, op: "edit" },
      { index: 0, item: { id: 1, sev: "Gone" }, op: "delete" },
    ];
    const live: Row[] = [{ id: 1, sev: "Live", noteLog: ["n"] }];
    const out = applyUndoRestore(live, before, PRESERVE);
    // The delete branch owns id 1: it re-mints rather than letting the edit revert.
    expect(out.find((r) => r.sev === "Live")).toBeDefined();
  });

  it("redo's rowsEqual identity guard still fires with preserve on (non-regression)", () => {
    // A recovered delete-image whose id a NEW unrelated row now holds must not be
    // removed by redo. Preservation touches only edit-images, so this must not change.
    const forward: BeforeImage<Row>[] = [
      { index: 0, item: { id: 7, sev: "recovered" }, op: "delete" },
    ];
    const live: Row[] = [{ id: 7, sev: "an unrelated new row", noteLog: ["keep me"] }];
    const out = applyUndoForward(live, forward, PRESERVE);
    expect(out).toHaveLength(1);
    expect(out[0].sev).toBe("an unrelated new row");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/undo/undo-stack.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t2.log
```

Expected: non-zero exit. The new tests fail because the third argument is ignored.

- [ ] **Step 3: Add the parameter to the three entry points**

In `src/app/undo/undo-stack.ts`:

```ts
export function applyUndoRestore<T extends { id: number }>(
  current: readonly T[],
  before: readonly BeforeImage<T>[],
  preserve: readonly string[],
): T[] {
  return applyUndoRestoreWithRemap(current, before, preserve).result;
}
```

```ts
export function applyUndoRestoreWithRemap<T extends { id: number }>(
  current: readonly T[],
  before: readonly BeforeImage<T>[],
  preserve: readonly string[],
): { result: T[]; remap: Map<number, number> } {
```

Inside it, replace the edit-branch body:

```ts
  for (const { item, op } of before) {
    if (op !== "edit" || deleteIds.has(item.id)) continue;
    if (present.has(item.id)) {
      const idx = out.findIndex((r) => r.id === item.id);
      out[idx] = applyPreserved(item, out[idx], preserve);
    }
    // absent edit-image → skip (row deleted since; not this op's to restore)
  }
```

And in `applyUndoForward`:

```ts
export function applyUndoForward<T extends { id: number }>(
  current: readonly T[],
  forward: readonly BeforeImage<T>[],
  preserve: readonly string[],
): T[] {
```

with its edit branch becoming:

```ts
  for (const { item, op } of forward) {
    if (op !== "edit" || deletes.has(item.id)) continue; // delete-image owns this id
    const idx = out.findIndex((r) => r.id === item.id);
    if (idx !== -1) out[idx] = applyPreserved(item, out[idx], preserve); // absent edit → skip
  }
```

Also add to each of the three docblocks a line stating that `preserve` names keys on which the LIVE row wins, and pointing at `applyPreserved` for the reasoning. Do not restate the reasoning — one copy, on the helper.

- [ ] **Step 4: Update every existing caller in the test file**

Every pre-existing call to `applyUndoRestore(...)`, `applyUndoRestoreWithRemap(...)` and `applyUndoForward(...)` in `src/app/undo/undo-stack.test.ts` gains a final `[]` argument. Find them with:

```bash
grep -n "applyUndoRestore\|applyUndoForward" src/app/undo/undo-stack.test.ts
```

`[]` is the behaviour-preserving value, so no existing expectation changes.

- [ ] **Step 5: Run the tests and the typechecker**

```bash
npx vitest run src/app/undo/undo-stack.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t2.log
npx tsc --noEmit; echo "TSC=$?"
```

Expected: `EXIT=0`. `TSC` will be **non-zero** — `use-undo-stack.ts` still calls the three functions with two arguments. That is Task 3.

- [ ] **Step 6: Commit**

```bash
git add src/app/undo/undo-stack.ts src/app/undo/undo-stack.test.ts
git commit -F - <<'EOF'
feat(undo): require a preserve key list on the restore and redo primitives

Required rather than optional-with-empty-default: a future call site that
forgets it is then a typecheck error, not a silent return of the whole-row
clobber this closes.

Refs open-followups #50
EOF
```

---

## Task 3: Wire the field list at the four runner sites

**Files:**
- Modify: `src/app/undo/use-undo-stack.ts`

- [ ] **Step 1: Declare the list**

In `src/app/undo/use-undo-stack.ts`, directly below `const UNDO_CAP = 25;`:

```ts
/**
 * Fields written to a live row by something OTHER than the op that captured it.
 * A whole-row undo lets the LIVE value win on these, or it reverts a write the
 * user's undo was never about (open-followups §50).
 *
 * ★★ MEMBERSHIP RULE, not a list of "important" fields: a field belongs here iff
 * some writer OTHER than an entity's own save handler can change it on a row that
 * is not being edited. Today that is the notes window (`noteLog`, on Task, RaidItem
 * and ChangeItem) and the background calendar push/pull (`outlookEventId`, on every
 * calendar-capable entity).
 *
 * ★★ THIS LIST IS THE BACKSTOP, NOT THE PRIMARY FIX. The bulk-edit sites capture
 * FIELD PATCHES and are immune by construction; what this protects is the paths
 * that genuinely replace whole rows — reference-data cascades, the resource
 * directory, task dedup, the alloc plan, and dependency stripping on delete. A new
 * write-through field silently escapes it, which is why the patch capture is
 * preferred wherever the op is a field edit.
 */
const WRITE_THROUGH_FIELDS: readonly string[] = ["noteLog", "outlookEventId"];
```

- [ ] **Step 2: Pass it at all four call sites**

In `fragmentUndoRunner`:

```ts
      const { result, remap } = applyUndoRestoreWithRemap(prev, before, WRITE_THROUGH_FIELDS);
```
```ts
      setter((prev) => applyUndoForward(prev, forward, WRITE_THROUGH_FIELDS));
```

In `capturePart`'s `restore`:

```ts
      const { result, remap } = applyUndoRestoreWithRemap(prev, restoreImages, WRITE_THROUGH_FIELDS);
```
```ts
    return () => { setter((prev) => applyUndoForward(prev, forward, WRITE_THROUGH_FIELDS)); };
```

- [ ] **Step 3: Verify no call site was missed**

```bash
grep -n "applyUndoRestoreWithRemap(\|applyUndoForward(" src/app/undo/use-undo-stack.ts
npx tsc --noEmit; echo "TSC=$?"
```

Expected: four call sites, each ending `WRITE_THROUGH_FIELDS)`, and `TSC=0`.

- [ ] **Step 4: Run the full undo suite**

```bash
npx vitest run src/app/undo --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Test Files" /tmp/t3.log
```

Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/undo/use-undo-stack.ts
git commit -F - <<'EOF'
feat(undo): preserve noteLog and outlookEventId across a whole-row undo

Both are written to live rows by writers other than the op that captured
them: the notes window, and the background calendar push that stamps an
event id. Reverting either loses user-typed text or makes the next push
create a duplicate calendar event.

Refs open-followups #50
EOF
```

---

## Task 4: Prove the wiring on a path Part B will NOT convert

**Files:**
- Test: `src/app/use-task-row-handlers.test.ts`

Part B converts the bulk-edit sites to field patches, after which those sites no longer exercise Part A at all. This test picks a path that **stays** whole-row, so it keeps testing the backstop after Part B lands: deleting a task also strips that id from other tasks' `dependencies[]`, and those dependents are captured as whole-row edit-images (`use-task-row-handlers.ts:343`).

- [ ] **Step 1: Read the existing harness**

```bash
grep -n "describe(\|function render\|renderHook" src/app/use-task-row-handlers.test.ts | head -10
```

The file exists. Use whatever mounting helper it already has rather than adding a second one — and note it is `.ts`, not `.tsx`, so any JSX you need goes through `React.createElement` or belongs in a different file.

★ `onDelete` calls `window.confirm` (`use-task-row-handlers.ts:333`). Stub it (`vi.spyOn(window, "confirm").mockReturnValue(true)`) or the delete never runs and the test passes for the wrong reason.

- [ ] **Step 2: Write the failing test**

```ts
it("undoing a delete keeps a note added to a DEPENDENT since the delete", async () => {
  // Task 2 depends on task 1. Deleting 1 strips that dependency from 2 and
  // captures 2 as a whole-row edit-image — the path Part B leaves alone.
  const tasks: Task[] = [
    makeTask({ id: 1, taskName: "blocker" }),
    makeTask({ id: 2, taskName: "dependent", dependencies: [{ taskId: 1, type: "FS" }] }),
  ];
  const harness = renderHandlers(tasks);

  harness.onDelete(1);

  // The note arrives AFTER the delete — through the notes window, which writes
  // through to the live row and knows nothing about the undo stack.
  harness.setTasks((prev) =>
    prev.map((t) => (t.id === 2 ? { ...t, noteLog: [note("added after the delete")] } : t)),
  );

  harness.undo();

  const dependent = harness.currentTasks().find((t) => t.id === 2)!;
  expect(dependent.noteLog?.map((n) => n.text)).toEqual(["added after the delete"]);
  expect(dependent.dependencies).toEqual([{ taskId: 1, type: "FS" }]); // the strip WAS reverted
});
```

★ The note is seeded **after** the delete. Seed it before and the test passes against unfixed code — that is the §48 trap, which §50 restates and this repo has paid for twice. The second assertion is the anti-vacuity anchor: without it, a test that reverted nothing at all would also pass.

- [ ] **Step 3: Run to verify it fails against Task 3 reverted**

```bash
git stash push src/app/undo/use-undo-stack.ts
npx vitest run src/app/use-task-row-handlers.test.ts --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"
git stash pop
```

Expected: non-zero exit while the wiring is stashed. **This step is the whole value of the test** — if it passes with Task 3 reverted, the fixture is not reaching the code path and must be fixed before continuing.

- [ ] **Step 4: Run it against the real tree**

```bash
npx vitest run src/app/use-task-row-handlers.test.ts --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t4.log
npx tsc --noEmit; echo "TSC=$?"
```

Expected: `EXIT=0`, `TSC=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-task-row-handlers.test.ts
git commit -F - <<'EOF'
test(undo): pin the preserve backstop on a whole-row path

Dependency stripping on delete captures its dependents as whole-row
edit-images and stays that way after the bulk-edit sites move to field
patches, so this test keeps exercising the engine-level guard.

Refs open-followups #50
EOF
```

---

## Task 5: The `outlookEventId` case

**Files:**
- Test: `src/app/use-task-row-handlers.test.ts`

The case with no note log involved, and the one whose damage is outside the app: the row forgets an event that still exists in Outlook, so the next push creates a duplicate.

- [ ] **Step 1: Write the failing test**

```ts
it("undoing a delete keeps an outlookEventId stamped on a dependent since the delete", async () => {
  const tasks: Task[] = [
    makeTask({ id: 1, taskName: "blocker" }),
    makeTask({ id: 2, taskName: "dependent", dependencies: [{ taskId: 1, type: "FS" }] }),
  ];
  const harness = renderHandlers(tasks);

  harness.onDelete(1);

  // What the background calendar push does: stamp the id it got back from Graph.
  harness.setTasks((prev) =>
    prev.map((t) => (t.id === 2 ? { ...t, outlookEventId: "AAMkAG-evt-1" } : t)),
  );

  harness.undo();

  const dependent = harness.currentTasks().find((t) => t.id === 2)!;
  // Reverting this is how the next push creates a SECOND event for the same task.
  expect(dependent.outlookEventId).toBe("AAMkAG-evt-1");
  expect(dependent.dependencies).toEqual([{ taskId: 1, type: "FS" }]);
});
```

- [ ] **Step 2: Verify it fails with the wiring stashed**

```bash
git stash push src/app/undo/use-undo-stack.ts
npx vitest run src/app/use-task-row-handlers.test.ts --reporter=dot > /tmp/t5.log 2>&1; echo "EXIT=$?"
git stash pop
```

Expected: non-zero exit.

- [ ] **Step 3: Verify it passes on the real tree**

```bash
npx vitest run src/app/use-task-row-handlers.test.ts --reporter=dot > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t5.log
```

Expected: `EXIT=0`.

- [ ] **Step 4: Commit**

```bash
git add src/app/use-task-row-handlers.test.ts
git commit -F - <<'EOF'
test(undo): pin that an undo keeps a background-stamped outlookEventId

Reverting it leaves the Outlook event live and the row unaware of it, so
the next push creates a duplicate meeting in the user's real calendar.

Refs open-followups #50
EOF
```

---

# PART B — field-patch captures for the bulk-edit sites

## Task 6: `buildBulkFieldEdits` — the shared patch builder

**Files:**
- Modify: `src/app/undo/field-groups.ts`
- Test: `src/app/undo/field-groups.test.ts`

Four panels build a `patched` row per selection and would otherwise each hand-roll the same before/after extraction. This lives in `field-groups.ts` because `pick`, `valuesDiffer` and the private `NEVER_CAPTURE` set are already there — and because four copies of the same block would push the jscpd duplication gate.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/undo/field-groups.test.ts`:

```ts
describe("buildBulkFieldEdits", () => {
  type Row = { id: number; sev: string; owner?: string; localModifiedAt?: string; noteLog?: string[] };

  it("emits one edit per row carrying only the CHANGED keys", () => {
    const edits = buildBulkFieldEdits<Row>([
      { before: { id: 1, sev: "Low", owner: "ann" }, after: { id: 1, sev: "High", owner: "ann" } },
    ]);
    expect(edits).toEqual([{ id: 1, before: { sev: "Low" }, after: { sev: "High" } }]);
  });

  it("skips a row nothing changed on", () => {
    const edits = buildBulkFieldEdits<Row>([
      { before: { id: 1, sev: "Low" }, after: { id: 1, sev: "Low" } },
      { before: { id: 2, sev: "Low" }, after: { id: 2, sev: "High" } },
    ]);
    expect(edits.map((e) => e.id)).toEqual([2]);
  });

  it("never captures id or localModifiedAt", () => {
    const edits = buildBulkFieldEdits<Row>([
      { before: { id: 1, sev: "Low", localModifiedAt: "t0" }, after: { id: 1, sev: "High", localModifiedAt: "t1" } },
    ]);
    expect(Object.keys(edits[0].before)).toEqual(["sev"]);
  });

  it("does NOT capture a write-through field even when it differs", () => {
    // A note added between the panel reading the row and building the patch must
    // not become part of what undo reverts — that is the whole defect this closes.
    const edits = buildBulkFieldEdits<Row>([
      { before: { id: 1, sev: "Low", noteLog: ["a"] }, after: { id: 1, sev: "High", noteLog: ["a", "b"] } },
    ]);
    expect(Object.keys(edits[0].before)).toEqual(["sev"]);
  });

  it("captures a field set from undefined and one cleared to undefined", () => {
    const edits = buildBulkFieldEdits<Row>([
      { before: { id: 1, sev: "Low" }, after: { id: 1, sev: "Low", owner: "ann" } },
      { before: { id: 2, sev: "Low", owner: "bo" }, after: { id: 2, sev: "Low" } },
    ]);
    expect(edits[0]).toEqual({ id: 1, before: { owner: undefined }, after: { owner: "ann" } });
    expect(edits[1]).toEqual({ id: 2, before: { owner: "bo" }, after: { owner: undefined } });
  });

  it("returns an empty array for an empty input", () => {
    expect(buildBulkFieldEdits<Row>([])).toEqual([]);
  });
});
```

★ The fifth test matters: a bulk edit that CLEARS a field (RAID's target date, a change's impact) must still be undoable, and a naive "only keys present on `after`" implementation drops it.

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/undo/field-groups.test.ts --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero exit, `buildBulkFieldEdits` is not exported.

- [ ] **Step 3: Implement it**

Append to `src/app/undo/field-groups.ts`:

```ts
/**
 * Build the `{id, before, after}` field patches a bulk edit needs, by diffing
 * each row against the row the op is about to write.
 *
 * ★★★ WHY A PATCH AND NOT THE ROW. `capturePart` captures WHOLE rows, so undoing
 * a bulk edit also reverts whatever a concurrent writer changed on those rows —
 * a note added through the notes window, an `outlookEventId` stamped by the
 * background calendar push (open-followups §50). A patch reverts only what the op
 * itself wrote.
 *
 * ★★ `WRITE_THROUGH_KEYS` is excluded even when the two rows DISAGREE on it. The
 * panel reads its rows from a render snapshot, so a note committed between that
 * read and the save legitimately shows up as a difference — and capturing it would
 * reintroduce the very clobber this exists to prevent, one layer up.
 *
 * ★ A key set on a row that lacked it (and one cleared to `undefined`) is captured
 * with an explicit `undefined` on the other side, so a bulk edit that CLEARS a
 * field is undoable. `captureFieldPart` merges the patch, and merging an explicit
 * `undefined` is what restores "absent".
 */
const WRITE_THROUGH_KEYS: ReadonlySet<string> = new Set(["noteLog", "outlookEventId"]);

export function buildBulkFieldEdits<T extends { id: number }>(
  rows: readonly { before: T; after: T }[],
): { id: number; before: Partial<T>; after: Partial<T> }[] {
  const out: { id: number; before: Partial<T>; after: Partial<T> }[] = [];
  for (const { before, after } of rows) {
    const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
    const changed: (keyof T & string)[] = [];
    for (const k of keys) {
      if (NEVER_CAPTURE.has(k) || WRITE_THROUGH_KEYS.has(k)) continue;
      if (differs((before as Record<string, unknown>)[k], (after as Record<string, unknown>)[k])) {
        changed.push(k as keyof T & string);
      }
    }
    if (changed.length === 0) continue;
    out.push({ id: before.id, before: pick(before, changed), after: pick(after, changed) });
  }
  return out;
}
```

★ `pick` copies `row[k]` unconditionally, so a key absent on one side lands as an explicit `undefined` — which is exactly what the clear-a-field case needs.

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run src/app/undo/field-groups.test.ts --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t6.log
npx tsc --noEmit; echo "TSC=$?"
```

Expected: `EXIT=0`, `TSC=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/undo/field-groups.ts src/app/undo/field-groups.test.ts
git commit -F - <<'EOF'
feat(undo): add buildBulkFieldEdits, the shared bulk patch builder

Diffs each selected row against the row the bulk edit is about to write and
emits only the changed keys, excluding identity, the sync stamp, and the
write-through fields a concurrent writer owns.

Refs open-followups #50
EOF
```

---

## Task 7: `captureFieldRows` — one array, N rows, one undo entry

**Files:**
- Modify: `src/app/undo/use-undo-stack.ts`
- Test: `src/app/undo/use-undo-stack.test.tsx`

`captureFieldPart` returns a `CompositeFragment`, and the only way to push one today is `captureComposite` — which drags in the `isPrimary` fallback hazard and the missing `entityKey` for five sites that have no second array. This is the single-array entry point, built on `captureFieldPart` so there is still one merge implementation.

- [ ] **Step 1: Write the failing test**

Append to `src/app/undo/use-undo-stack.test.tsx`. That file has **no** shared render helper — every test does `renderHook(() => useUndoStack(deps))` with a local `let arr` and a closure setter. Follow it, and add this one small helper at the top of the new `describe` so the five tests below do not each repeat the plumbing:

```ts
function mountRows<T extends { id: number }>(initial: readonly T[]) {
  const deps = makeDeps();
  const { result } = renderHook(() => useUndoStack(deps));
  let arr: readonly T[] = initial;
  const setRows = (u: SetStateAction<readonly T[]>) => { arr = typeof u === "function" ? u(arr) : u; };
  return { result, deps, setRows, rows: () => arr };
}
```

```ts
describe("captureFieldRows", () => {
  type Row = { id: number; sev: string; noteLog?: string[] };

  it("reverts only the captured fields and keeps a concurrent write", () => {
    const { result, rows, setRows } = mountRows<Row>([
      { id: 1, sev: "Low" },
      { id: 2, sev: "Low" },
    ]);

    act(() => {
      result.current.captureFieldRows<Row>({
        setter: setRows,
        kind: "bulk.edit",
        entityKey: "raid",
        edits: [
          { id: 1, before: { sev: "Low" }, after: { sev: "High" } },
          { id: 2, before: { sev: "Low" }, after: { sev: "High" } },
        ],
      });
      setRows((prev) => prev.map((r) => ({ ...r, sev: "High" })));
    });

    // The concurrent write the undo must not revert.
    act(() => { setRows((prev) => prev.map((r) => (r.id === 1 ? { ...r, noteLog: ["added"] } : r))); });
    act(() => { result.current.undo(); });

    expect(rows().find((r) => r.id === 1)).toEqual({ id: 1, sev: "Low", noteLog: ["added"] });
    expect(rows().find((r) => r.id === 2)).toEqual({ id: 2, sev: "Low" });
  });

  it("pushes ONE entry for N rows, counted by rows", () => {
    const { result, setRows } = mountRows<Row>([{ id: 1, sev: "Low" }, { id: 2, sev: "Low" }]);
    act(() => {
      result.current.captureFieldRows<Row>({
        setter: setRows, kind: "bulk.edit", entityKey: "raid",
        edits: [
          { id: 1, before: { sev: "Low" }, after: { sev: "High" } },
          { id: 2, before: { sev: "Low" }, after: { sev: "High" } },
        ],
      });
    });
    expect(result.current.stack).toHaveLength(1);
    expect(result.current.stack[0].count).toBe(2);
  });

  it("names the entity in the label, so a bulk edit does not degrade to a generic one", () => {
    const { result, setRows } = mountRows<Row>([{ id: 1, sev: "Low" }, { id: 2, sev: "Low" }]);
    act(() => {
      result.current.captureFieldRows<Row>({
        setter: setRows, kind: "bulk.edit", entityKey: "raid",
        edits: [
          { id: 1, before: { sev: "Low" }, after: { sev: "High" } },
          { id: 2, before: { sev: "Low" }, after: { sev: "High" } },
        ],
      });
    });
    // Exact string, and TWO rows on purpose: this is the label the whole-row path
    // already produces for the same input, pinned by the neighbouring test
    // "labels a bulk edit via the explicit entityKey". Asserting the identical
    // string is what proves the conversion changed the mechanism and not the UI.
    // A `not.toMatch(/item\(s\)/)` would also pass on a label naming the wrong entity.
    expect(result.current.stack[0].label).toBe("Bulk edit 2 RAID items");
  });

  it("pushes nothing for an empty edit list", () => {
    const { result, setRows } = mountRows<Row>([{ id: 1, sev: "Low" }]);
    act(() => {
      result.current.captureFieldRows<Row>({ setter: setRows, kind: "bulk.edit", entityKey: "raid", edits: [] });
    });
    expect(result.current.stack).toHaveLength(0);
  });

  it("redo re-applies the edit and keeps a note added since the undo", () => {
    const { result, rows, setRows } = mountRows<Row>([{ id: 1, sev: "Low" }]);
    act(() => {
      result.current.captureFieldRows<Row>({
        setter: setRows, kind: "bulk.edit", entityKey: "raid",
        edits: [{ id: 1, before: { sev: "Low" }, after: { sev: "High" } }],
      });
      setRows((prev) => prev.map((r) => ({ ...r, sev: "High" })));
    });
    act(() => { setRows((prev) => prev.map((r) => ({ ...r, noteLog: ["note A"] }))); });
    act(() => { result.current.undo(); });
    act(() => { setRows((prev) => prev.map((r) => ({ ...r, noteLog: [...(r.noteLog ?? []), "note B"] }))); });
    act(() => { result.current.redo(); });

    expect(rows()[0].sev).toBe("High");
    expect(rows()[0].noteLog).toEqual(["note A", "note B"]);
  });
});
```

★ `mountRows` is a plain closure, not React state — which is what the existing tests in this file do, and it is deliberate: the assertions read the array synchronously after `act`, with no re-render to wait on.

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/undo/use-undo-stack.test.tsx --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero exit — `captureFieldRows` is not on the API.

- [ ] **Step 3: Implement it**

In `src/app/undo/use-undo-stack.ts`, add the runner beside `compositeUndoRunner`:

```ts
/** Drive ONE `captureFieldPart` fragment as a standalone undo↔redo runner. The
 *  fragment publishes no id-remap (it removes nothing), so the empty box and
 *  `isPrimary: false` are the only correct arguments here. */
function fieldRowsRunner(part: CompositeFragment): Runner {
  const runUndo: Runner = () => {
    const redo = part.restore({ current: EMPTY_REMAP }, false);
    const runRedo: Runner = () => { redo(); return runUndo; };
    return runRedo;
  };
  return runUndo;
}
```

Add the opts type beside `CaptureCompositeOpts`:

```ts
export interface CaptureFieldRowsOpts<T extends { id: number }> {
  setter: Dispatch<SetStateAction<readonly T[]>>;
  kind: ActivityKind;
  /** One entry per affected row; `before`/`after` hold ONLY the written fields. */
  edits: readonly { id: number; before: Partial<T>; after: Partial<T> }[];
  /** Required in practice for `bulk.edit`, which is entity-ambiguous — without it
   *  the label degrades to the generic "Edited N item(s)". */
  entityKey?: UndoEntityKey;
  name?: string;
  stampField?: keyof T & string;
}
```

Add to the `UndoStackApi` interface:

```ts
  captureFieldRows: <T extends { id: number }>(opts: CaptureFieldRowsOpts<T>) => void;
```

And the implementation beside `captureComposite`:

```ts
  const captureFieldRows = useCallback(<T extends { id: number }>(opts: CaptureFieldRowsOpts<T>) => {
    const part = captureFieldPart<T>({ setter: opts.setter, edits: opts.edits, stampField: opts.stampField });
    if (part === null) return;
    pushEntry(opts.kind, opts.edits.length, fieldRowsRunner(part), { name: opts.name, entityKey: opts.entityKey });
  }, [pushEntry]);
```

Return it from the hook alongside `capture`, `captureFieldEdit`, `captureComposite`.

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run src/app/undo/use-undo-stack.test.tsx --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t7.log
npx tsc --noEmit; echo "TSC=$?"
```

Expected: `EXIT=0`, `TSC=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/undo/use-undo-stack.ts src/app/undo/use-undo-stack.test.tsx
git commit -F - <<'EOF'
feat(undo): add captureFieldRows for a single-array bulk field edit

Pushing a captureFieldPart previously meant going through captureComposite,
which carries an isPrimary fallback hazard and cannot express entityKey.
Five bulk-edit sites have one array and need neither.

Refs open-followups #50
EOF
```

---

## Task 8: `entityKey` on `CaptureCompositeOpts`

**Files:**
- Modify: `src/app/undo/use-undo-stack.ts`, `src/app/use-task-submit.ts`
- Test: `src/app/undo/use-undo-stack.test.tsx`

The tasks-plus-bucket-move branch stays a real composite, so it needs this. `use-task-submit.ts:314` records the gap as a known cost and a follow-up; this closes it.

- [ ] **Step 1: Write the failing test**

```ts
it("captureComposite names the entity in its label when given an entityKey", () => {
  const rows = [{ id: 1, sev: "Low" }, { id: 2, sev: "Low" }];
  const { result, setRows } = mountRows<{ id: number; sev: string }>(rows);
  act(() => {
    result.current.captureComposite({
      kind: "bulk.edit",
      primaryCount: 2,
      entityKey: "task",
      parts: [capturePart({ setter: setRows, edited: rows, fromArray: rows })],
    });
  });
  // Before this change the composite path had no way to say "task", so the label
  // fell through buildUndoLabel's `if (!key)` line to the generic form.
  expect(result.current.stack[0].label).toBe("Bulk edit 2 tasks");
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/undo/use-undo-stack.test.tsx --reporter=dot > /tmp/t8.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero exit — `entityKey` is not a property of `CaptureCompositeOpts`, so this is a typecheck failure as well as an assertion one.

- [ ] **Step 3: Implement it**

Add to `CaptureCompositeOpts`:

```ts
  /** Names the entity for the undo LABEL. Required in practice for `bulk.edit`,
   *  which is entity-ambiguous: `buildUndoLabel` resolves the entity from the
   *  kind's prefix, `"bulk"` is not in `ENTITY_KEY_SET`, and without this the
   *  label degrades to the generic "Edited N item(s)". */
  entityKey?: UndoEntityKey;
```

And forward it:

```ts
    pushEntry(opts.kind, opts.primaryCount, compositeUndoRunner(fragments), { name: opts.name, entityKey: opts.entityKey });
```

- [ ] **Step 4: Correct the stale comment in `use-task-submit.ts`**

At `use-task-submit.ts:314`, the comment ends: *"That branch needs an explicit `entityKey`, and `CaptureCompositeOpts` has no such field — `captureComposite` forwards only `{ name }`."* Replace those two clauses with a statement that the field now exists and forwards, and keep the surrounding advice ("do not fix the label by changing the kind") intact — that part is still true. Leave the `★★ KNOWN COST` paragraph above it alone unless this task actually changes that label; if it does not, say so.

- [ ] **Step 5: Run the tests and typecheck**

```bash
npx vitest run src/app/undo src/app/use-task-submit.test.ts --reporter=dot > /tmp/t8.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t8.log
npx tsc --noEmit; echo "TSC=$?"
```

Expected: `EXIT=0`, `TSC=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/undo/use-undo-stack.ts src/app/undo/use-undo-stack.test.tsx src/app/use-task-submit.ts
git commit -F - <<'EOF'
feat(undo): let a composite capture name its entity in the undo label

bulk.edit is entity-ambiguous, so a composite carrying it degraded to
"Edited N item(s)". use-task-submit recorded this as a follow-up; the
comment there is corrected in the same commit.
EOF
```

---

## Task 9: Convert the RAID bulk edit

**Files:**
- Modify: `src/app/raid-panel.tsx:308`, `src/app/use-resource-planner.ts:262`
- Test: `src/app/use-resource-planner.undo.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
it("undoing a RAID bulk edit keeps a note added since the apply", async () => {
  const harness = renderPlanner([
    makeRaid({ id: 1, severity: "Low" }),
    makeRaid({ id: 2, severity: "Low" }),
  ]);

  // What raid-panel's applyBulk does: capture, then save each patched row.
  harness.captureRaidBulkUndo([
    { id: 1, before: { severity: "Low" }, after: { severity: "High" } },
    { id: 2, before: { severity: "Low" }, after: { severity: "High" } },
  ]);
  harness.saveRaid({ ...harness.raidById(1), severity: "High" }, undefined, { suppressFieldUndo: true });
  harness.saveRaid({ ...harness.raidById(2), severity: "High" }, undefined, { suppressFieldUndo: true });

  // The notes window writes through, AFTER the apply.
  harness.setRaid((prev) =>
    prev.map((r) => (r.id === 1 ? { ...r, noteLog: [note("added after the bulk edit")] } : r)),
  );

  harness.undo();

  expect(harness.raidById(1).severity).toBe("Low");            // the edit WAS reverted
  expect(harness.raidById(1).noteLog?.map((n) => n.text)).toEqual(["added after the bulk edit"]);
});
```

★ Both assertions are required. Without the first, a fix that reverted nothing at all would pass.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/use-resource-planner.undo.test.tsx --reporter=dot > /tmp/t9.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero exit — `captureRaidBulkUndo` still takes ids, so this is a typecheck failure too.

- [ ] **Step 3: Change the hook**

In `src/app/use-resource-planner.ts`, replace `captureRaidBulkUndo`:

```ts
  // Called by raid-panel BEFORE its save loop, with the field patches the bulk
  // form is about to write. Field patches rather than whole rows: a whole-row
  // capture reverts anything a concurrent writer changed on these rows meanwhile
  // — a note added through the notes window, an outlookEventId stamped by the
  // background calendar push (open-followups §50).
  const captureRaidBulkUndo = useCallback(
    (edits: readonly { id: number; before: Partial<RaidItem>; after: Partial<RaidItem> }[]) => {
      if (edits.length) captureFieldRowsRef.current?.({ setter: setRaid, kind: "bulk.edit", edits, entityKey: "raid" });
    },
    [setRaid],
  );
```

Add `captureFieldRows` to the hook's deps and mirror it into a ref beside the existing `captureRef`, following the pattern already in this file.

- [ ] **Step 4: Change the panel**

In `src/app/raid-panel.tsx`, restructure `applyBulk` so the patched rows are computed first, the edits derived from them, and the capture made before the saves:

```ts
  const applyBulk = (changes: Record<string, string>) => {
    const patch = (item: RaidItem): RaidItem => {
      let patched: RaidItem = { ...item };
      if (changes.severity !== undefined) patched = { ...patched, severity: changes.severity as RaidSeverity };
      if (changes.targetDate !== undefined) patched = { ...patched, targetDate: changes.targetDate || undefined };
      if (changes.owner !== undefined) {
        const r = changes.owner ? resources.find((x) => String(x.id) === changes.owner) : undefined;
        patched = { ...patched, owner: r ? resourceDisplayName(r) : "", ownerEmail: r?.email, ownerResourceId: r ? r.id : null };
      }
      return patched;
    };
    const rows = Array.from(sel.selectedIds)
      .map((id) => raidById.get(id))
      .filter((item): item is RaidItem => item !== undefined)
      .map((item) => ({ before: item, after: patch(item) }));

    onCaptureBulk?.(buildBulkFieldEdits(rows));
    for (const { after } of rows) onSave(after, undefined, { suppressFieldUndo: true });
    setBulkOpen(false);
    sel.clear();
  };
```

Update the prop type: `onCaptureBulk?: (edits: readonly { id: number; before: Partial<RaidItem>; after: Partial<RaidItem> }[]) => void;` and import `buildBulkFieldEdits` from `./undo/field-groups`.

- [ ] **Step 5: Run the tests and typecheck**

```bash
npx vitest run src/app/use-resource-planner.undo.test.tsx src/app/raid-panel.test.tsx --reporter=dot > /tmp/t9.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t9.log
npx tsc --noEmit; echo "TSC=$?"
```

Expected: `EXIT=0`, `TSC=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-resource-planner.ts src/app/raid-panel.tsx src/app/use-resource-planner.undo.test.tsx
git commit -F - <<'EOF'
fix(undo): stop a RAID bulk edit's undo from destroying notes added since

The capture snapshotted whole rows, so undoing a bulk severity change also
reverted a note the user typed after applying it. It now captures only the
fields the bulk form wrote.

Closes part of open-followups #50
EOF
```

---

## Task 10: Convert the changes bulk edit

**Files:**
- Modify: `src/app/change-panel.tsx:272`, `src/app/use-change-log.ts:135`
- Test: `src/app/use-change-log.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
it("undoing a changes bulk edit keeps a note added since the apply", async () => {
  const harness = renderChangeLog([
    makeChange({ id: 1, impact: "Low" }),
    makeChange({ id: 2, impact: "Low" }),
  ]);

  harness.captureBulkUndo([
    { id: 1, before: { impact: "Low" }, after: { impact: "High" } },
    { id: 2, before: { impact: "Low" }, after: { impact: "High" } },
  ]);
  harness.saveChange({ ...harness.changeById(1), impact: "High" }, undefined, { suppressFieldUndo: true });
  harness.saveChange({ ...harness.changeById(2), impact: "High" }, undefined, { suppressFieldUndo: true });

  harness.setChanges((prev) =>
    prev.map((c) => (c.id === 1 ? { ...c, noteLog: [note("added after the bulk edit")] } : c)),
  );

  harness.undo();

  expect(harness.changeById(1).impact).toBe("Low");
  expect(harness.changeById(1).noteLog?.map((n) => n.text)).toEqual(["added after the bulk edit"]);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/use-change-log.test.tsx --reporter=dot > /tmp/t10.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero exit.

- [ ] **Step 3: Change the hook**

```ts
  // Field patches rather than whole rows — see the note on RAID's equivalent and
  // open-followups §50. ChangeItem carries a noteLog too, as of 0.245.0.
  const captureBulkUndo = useCallback(
    (edits: readonly { id: number; before: Partial<ChangeItem>; after: Partial<ChangeItem> }[]) => {
      if (edits.length) args.captureFieldRows?.({ setter: setChanges, kind: "bulk.edit", edits, entityKey: "change" });
    },
    [setChanges, args],
  );
```

Add `captureFieldRows?: UndoStackApi["captureFieldRows"]` to this hook's args type, and pass it from `task-manager.tsx:698` where `capture` is already passed.

- [ ] **Step 4: Change the panel**

In `src/app/change-panel.tsx`, restructure `applyBulk` the same way:

```ts
  const applyBulk = (patch: Record<string, string>) => {
    const apply = (item: ChangeItem): ChangeItem => {
      let patched: ChangeItem = { ...item };
      // Through applyChangeStatus, exactly like the row select and the modal:
      // setting `status` raw left a bulk-approved row with NO decisionDate.
      if (patch.status !== undefined) patched = applyChangeStatus(patched, patch.status as ChangeStatus, today);
      if (patch.type !== undefined) patched = { ...patched, type: patch.type as ChangeType };
      if (patch.impact !== undefined)
        patched = { ...patched, impact: patch.impact ? (patch.impact as ChangeImpact) : undefined };
      if (patch.requestedBy !== undefined)
        patched = { ...patched, requestedBy: patch.requestedBy || undefined };
      return patched;
    };
    const rows = Array.from(sel.selectedIds)
      .map((id) => changesById.get(id))
      .filter((item): item is ChangeItem => item !== undefined)
      .map((item) => ({ before: item, after: apply(item) }));

    onCaptureBulk?.(buildBulkFieldEdits(rows));
    for (const { after } of rows) onSave(after, undefined, { suppressFieldUndo: true });
    setBulkOpen(false);
    sel.clear();
  };
```

★ `applyChangeStatus` writes `decisionDate` as well as `status`, and `buildBulkFieldEdits` picks up both because it diffs the rows rather than trusting the form's key list. That is why the builder diffs instead of taking a key set — do not "optimise" it into a key-list parameter.

Update the prop type and import `buildBulkFieldEdits`.

- [ ] **Step 5: Run the tests and typecheck**

```bash
npx vitest run src/app/use-change-log.test.tsx src/app/change-panel.test.tsx --reporter=dot > /tmp/t10.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t10.log
npx tsc --noEmit; echo "TSC=$?"
```

Expected: `EXIT=0`, `TSC=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-change-log.ts src/app/change-panel.tsx src/app/task-manager.tsx src/app/use-change-log.test.tsx
git commit -F - <<'EOF'
fix(undo): stop a changes bulk edit's undo from destroying notes added since

ChangeItem gained a note log in 0.245.0, which put the changes register
inside the whole-row undo clobber the other two registers already had.

Closes part of open-followups #50
EOF
```

---

## Task 11: Convert the stakeholders bulk edit

**Files:**
- Modify: `src/app/stakeholders-panel.tsx:197`, `src/app/use-stakeholders.ts:82`, `src/app/task-manager.tsx:703`

Stakeholders carry no `noteLog`, so this task has no note test — it is here because the site is field-patch shaped and leaving one of five on the old mechanism is how the next reader concludes the conversion was abandoned half-way.

- [ ] **Step 1: Change the hook**

```ts
  // Field patches rather than whole rows — see open-followups §50. Stakeholders
  // carry no note log today; the shape is the point, so a write-through field
  // added later is safe by construction rather than by remembering this file.
  const captureBulkUndo = useCallback(
    (edits: readonly { id: number; before: Partial<Stakeholder>; after: Partial<Stakeholder> }[]) => {
      if (edits.length) args.captureFieldRows?.({ setter: setStakeholders, kind: "bulk.edit", edits, entityKey: "stakeholder" });
    },
    [setStakeholders, args],
  );
```

Add `captureFieldRows?: UndoStackApi["captureFieldRows"]` to the args type and pass it from `task-manager.tsx:703`.

- [ ] **Step 2: Change the panel**

```ts
  const applyBulk = (changes: Record<string, string>) => {
    const patch = (item: Stakeholder): Stakeholder => {
      let patched: Stakeholder = { ...item };
      if (changes.category !== undefined) patched = { ...patched, category: changes.category as StakeholderCategory };
      if (changes.influence !== undefined) patched = { ...patched, influence: changes.influence as InfluenceInterest };
      if (changes.interest !== undefined) patched = { ...patched, interest: changes.interest as InfluenceInterest };
      return patched;
    };
    const rows = Array.from(sel.selectedIds)
      .map((id) => stakeholderById.get(id))
      .filter((item): item is Stakeholder => item !== undefined)
      .map((item) => ({ before: item, after: patch(item) }));

    onCaptureBulk?.(buildBulkFieldEdits(rows));
    for (const { after } of rows) onSave(after, undefined, { suppressFieldUndo: true });
    setBulkOpen(false);
    sel.clear();
  };
```

Update the prop type and import `buildBulkFieldEdits`.

- [ ] **Step 3: Run the existing suites unchanged**

```bash
npx vitest run src/app/stakeholders-panel.test.tsx src/app/use-stakeholders.test.tsx --reporter=dot > /tmp/t11.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t11.log
npx tsc --noEmit; echo "TSC=$?"
```

Expected: `EXIT=0`, `TSC=0`. The existing bulk-edit and undo assertions must pass untouched — this is a mechanism change, not a behaviour change, for everything except concurrent writes.

- [ ] **Step 4: Commit**

```bash
git add src/app/use-stakeholders.ts src/app/stakeholders-panel.tsx src/app/task-manager.tsx
git commit -F - <<'EOF'
refactor(undo): capture the stakeholders bulk edit as field patches

No note log on this entity today, so no behaviour change — the shape is
what matters, so a write-through field added later is safe by construction.

Refs open-followups #50
EOF
```

---

## Task 12: Convert the milestones bulk edit

**Files:**
- Modify: `src/app/milestones-panel.tsx:214-216`, `src/app/task-manager.tsx`
- Test: `src/app/milestones-panel.test.tsx`

Milestones carry no `noteLog` but **do** carry `outlookEventId`, and the milestone calendar sync writes it (`use-milestone-calendar-pull.ts:87`). So this one has a real regression test.

- [ ] **Step 1: Write the failing test**

```ts
it("undoing a milestone bulk edit keeps an outlookEventId stamped since the apply", async () => {
  const harness = renderMilestonesPanel([
    makeMilestone({ id: 1, date: "2026-01-01" }),
    makeMilestone({ id: 2, date: "2026-01-01" }),
  ]);

  await harness.applyBulk({ date: "2026-02-01" });

  // What the calendar push does after the apply.
  harness.setMilestones((prev) =>
    prev.map((m) => (m.id === 1 ? { ...m, outlookEventId: "AAMkAG-evt-9" } : m)),
  );

  harness.undo();

  expect(harness.milestoneById(1).date).toBe("2026-01-01");        // the edit WAS reverted
  expect(harness.milestoneById(1).outlookEventId).toBe("AAMkAG-evt-9");
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/milestones-panel.test.tsx --reporter=dot > /tmp/t12.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero exit.

★ If it **passes** before the change, Part A's engine list is already covering it — that is correct and expected, since milestones go through a whole-row `capture` today. Confirm by stashing `src/app/undo/use-undo-stack.ts` and re-running; if it fails only then, keep the test and note in the commit body that it pins Part A here and Part B after.

- [ ] **Step 3: Change the panel**

```ts
  const applyBulk = (changes: Record<string, string>) => {
    const patch = (item: Milestone): Milestone => {
      const patched: Milestone = { ...item };
      // `date` is required — only overwrite when the user supplied a value.
      if (changes.date !== undefined && changes.date) patched.date = changes.date;
      if (changes.achievedDate !== undefined) patched.achievedDate = changes.achievedDate || undefined;
      return patched;
    };
    const rows = Array.from(sel.selectedIds)
      .map((id) => milestoneById.get(id))
      .filter((item): item is Milestone => item !== undefined)
      .map((item) => ({ before: item, after: patch(item) }));

    const edits = buildBulkFieldEdits(rows);
    if (edits.length) captureFieldRows?.({ setter: setMilestones, kind: "bulk.edit", edits, entityKey: "milestone" });
    for (const { after } of rows) save(after, undefined, { suppressFieldUndo: true });
    // …the rest of the existing body, unchanged
  };
```

Add the prop beside the existing `capture`:

```ts
  captureFieldRows?: import("./undo/use-undo-stack").UndoStackApi["captureFieldRows"];
```

and thread it from `task-manager.tsx` wherever `capture` is passed to this panel.

- [ ] **Step 4: Run the tests and typecheck**

```bash
npx vitest run src/app/milestones-panel.test.tsx --reporter=dot > /tmp/t12.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t12.log
npx tsc --noEmit; echo "TSC=$?"
```

Expected: `EXIT=0`, `TSC=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/milestones-panel.tsx src/app/task-manager.tsx src/app/milestones-panel.test.tsx
git commit -F - <<'EOF'
fix(undo): stop a milestone bulk edit's undo from dropping an event id

The calendar sync stamps outlookEventId on live rows, so a whole-row undo
made the row forget an event that still exists in Outlook — and the next
push then created a second one.

Closes part of open-followups #50
EOF
```

---

## Task 13: Convert the tasks bulk edit, both branches

**Files:**
- Modify: `src/app/use-bulk-operations.ts:240-290`
- Test: `src/app/use-bulk-operations.test.tsx`

The hardest of the five: the row patch is **not uniform** (Jira-synced rows take `jiraSafeUpdates` and non-synced take `updates` plus a status transition), and one branch is a real composite with the budget buckets.

- [ ] **Step 1: Write the failing tests**

```ts
it("undoing a task bulk edit keeps a note added since the apply", async () => {
  const harness = renderBulkOps([makeTask({ id: 1, priority: "Low" }), makeTask({ id: 2, priority: "Low" })]);

  await harness.applyBulkEdit({ priority: "High" }, [1, 2]);
  harness.setTasks((prev) =>
    prev.map((t) => (t.id === 1 ? { ...t, noteLog: [note("added after the bulk edit")] } : t)),
  );
  harness.undo();

  expect(harness.taskById(1).priority).toBe("Low");
  expect(harness.taskById(1).noteLog?.map((n) => n.text)).toEqual(["added after the bulk edit"]);
});

it("undoing a bulk edit that ALSO moved buckets keeps the note and reverts both arrays", async () => {
  const harness = renderBulkOps([makeTask({ id: 1, priority: "Low", budgetBucket: 10 })], {
    budgets: [makeBucket({ id: 10 }), makeBucket({ id: 20 })],
  });

  await harness.applyBulkEdit({ priority: "High", budgetBucket: "20" }, [1]);
  harness.setTasks((prev) => prev.map((t) => ({ ...t, noteLog: [note("added after the bulk edit")] })));
  harness.undo();

  expect(harness.taskById(1).priority).toBe("Low");
  expect(harness.taskById(1).budgetBucket).toBe(10);         // the bucket move WAS reverted
  expect(harness.taskById(1).noteLog?.map((n) => n.text)).toEqual(["added after the bulk edit"]);
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/use-bulk-operations.test.tsx --reporter=dot > /tmp/t13.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero exit.

- [ ] **Step 3: Extract the row patch as a pure local function**

The mapping currently lives inline inside `setTasks((prev) => prev.map(...))`. Lift it so the same function produces both the capture patches and the new rows — one definition, so the undo cannot describe something different from what was written:

```ts
    // ONE definition of the row patch, used to derive the undo patches AND to
    // write the rows. Two copies would let the undo revert something other than
    // what was applied.
    const patchRow = (row: Task): Task => {
      if (row.jiraKey) {
        if (!managedEnabled) return { ...row, ...updates, localModifiedAt: stamp };
        if (noLocalForSynced) return row;
        return { ...row, ...jiraSafeUpdates, localModifiedAt: stamp };
      }
      const next = { ...row, ...updates };
      const withStatus = statusEnabled ? applyStatusChange(next, newStatus, editToday) : next;
      return { ...withStatus, localModifiedAt: stamp };
    };
```

Then the setter becomes:

```ts
    setTasks((prev) => prev.map((row) => (targetSet.has(row.id) ? patchRow(row) : row)));
```

- [ ] **Step 4: Derive the edits and swap both capture branches**

First add the dependency, mirroring how `capture` is already handled in this file — `args.capture` at the interface, `useRef(args.capture)` at `:100`, refreshed in an effect at `:109`:

```ts
  // in the args interface, beside `capture`
  captureFieldRows: UndoStackApi["captureFieldRows"];
```
```ts
  const captureFieldRowsRef = useRef(args.captureFieldRows);
  useEffect(() => { captureFieldRowsRef.current = args.captureFieldRows; }, [args.captureFieldRows]);
```

and import `captureFieldPart` from `./undo/use-undo-stack` plus `buildBulkFieldEdits` from `./undo/field-groups`. Then pass `captureFieldRows` from `task-manager.tsx` wherever this hook is constructed.


```ts
    const taskEdits = buildBulkFieldEdits(
      beforeRows.map((row) => ({ before: row, after: patchRow(row) })),
    );
    const tasksPart = taskFieldsEnabled && taskEdits.length > 0
      ? captureFieldPart<Task>({ setter: setTasks, edits: taskEdits, stampField: "localModifiedAt" })
      : null;
    if (tasksPart !== null && !bucketsChanged) {
      captureFieldRowsRef.current({ setter: setTasks, kind: "bulk.edit", edits: taskEdits, entityKey: "task", stampField: "localModifiedAt" });
    }
```

★ `buildBulkFieldEdits` already drops `localModifiedAt` from the patch; `stampField` is what re-stamps it on undo, which is the existing behaviour of every other field-merge path in this file's neighbourhood.

- [ ] **Step 5: Flag the surviving `capturePart` as primary**

`commitBuckets` builds `parts: [meta.tasksPart, budgetsPart]`. With `tasksPart` now a **field** part, the positional fallback in `compositeUndoRunner` would make it the nominal primary — and a field part publishes no id-remap, so every `fkRemapField` cascade would silently read stale ids. In `src/app/use-budget-buckets.ts`, flag the bucket part:

```ts
    const budgetsPart = capturePart<BudgetBucket>({
      setter: setBudgets,
      removed: deleted,
      edited: editedBefore,
      fromArray: prev,
      isPrimary: true,
    });
```

Also pass the entity key through so the label survives the conversion:

```ts
      captureComposite({
        kind,
        primaryCount: meta.primaryCount ?? (deleted.length + editedBefore.length),
        parts: [meta.tasksPart, budgetsPart],
        name,
        entityKey: "budget",
      });
```

★ This is the hazard `captureFieldPart`'s own docblock names: *"Same trap waiting in `use-budget-buckets.ts`: its `parts[0]` is `use-bulk-operations`' whole-row `tasksPart`, an open-followups §50 candidate, and the obvious §50 fix swaps it for a `captureFieldPart` — reproducing this shape beside a real `capturePart`. Flag the remaining part in that same edit."* Do it in this task, not later.

- [ ] **Step 6: Run the tests and typecheck**

```bash
npx vitest run src/app/use-bulk-operations.test.tsx src/app/use-budget-buckets.test.tsx --reporter=dot > /tmp/t13.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t13.log
npx tsc --noEmit; echo "TSC=$?"
```

Expected: `EXIT=0`, `TSC=0`.

- [ ] **Step 7: Commit**

```bash
git add src/app/use-bulk-operations.ts src/app/use-budget-buckets.ts src/app/use-bulk-operations.test.tsx
git commit -F - <<'EOF'
fix(undo): stop a task bulk edit's undo from destroying notes added since

The row patch is now one lifted function feeding both the undo patches and
the written rows, so the undo cannot revert something other than what was
applied. The bucket composite's remaining whole-row part is flagged primary
in the same change, since a field part publishes no id-remap and would
otherwise become the nominal primary by position.

Closes part of open-followups #50
EOF
```

---

## Task 14: Cheap checkpoint only

**Files:** none

The user has asked that only the gates a task actually needs run per task, and that the full
suite run at most once, at the end. So this checkpoint is deliberately thin — lint and
typecheck only. Everything heavy (`test:run`, `test:shuffle`, `test:coverage`, `dup:check`)
runs once in Task 16 Step 5.

- [ ] **Step 1: Lint at the CI gate**

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: `EXIT=0`. `npm run lint` alone does **not** reproduce this gate (it carries no
`--max-warnings` flag and exits 0 with warnings present).

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`.

---

## Task 15: Documentation

**Files:**
- Modify: `docs/open-followups.md`, `src/app/undo/use-undo-stack.ts`

- [ ] **Step 1: Close §50**

Rewrite the §50 heading to `## 50. Undo of a BULK edit reverts write-through fields — CLOSED 2026-08-18` and add a resolution block stating: both mechanisms (the engine preserve list and the field-patch conversion), that the task half is now **verified** rather than suspected (`use-bulk-operations.ts` captured whole `beforeRows`), and that `outlookEventId` was a second member of the class the entry never named — with the duplicate-calendar-event consequence spelled out.

- [ ] **Step 2: Correct `captureFieldPart`'s docblock**

It currently says: *"§50 says the same sequence 'very likely' loses TASK notes too but marks that half UNVERIFIED, so do not cite this as a known task defect."* That is measured false. Replace it with a statement that the task half was verified on 2026-08-18 and both are now closed, and update the paragraph naming the `use-budget-buckets.ts` trap as *"waiting"* — it has been taken, so say so and point at the `isPrimary: true` that closes it.

- [ ] **Step 3: Correct §87**

§87 says *"AI cannot read the activity log — deliberate, no tool exposes it."* B2a (0.241.0) shipped `search_history` and `getActivityLog()` on `ToolDispatcher`. Verify before writing:

```bash
grep -n "search_history" src/app/chat-tool-defs.ts | head -2
grep -rn "getActivityLog" src/app --include=*.ts | grep -v "\.test\." | head -3
```

Rewrite the entry as corrected-with-a-date, keeping the original text below the line — the convention this register already uses — since the *reasoning* about `task-manager.tsx` not growing responsibilities is what B2a had to solve, and deleting it loses why.

- [ ] **Step 4: Record Part B's residue as a new entry**

Append a new numbered entry (take the next free number — derive it, do not assume, with `grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1`) stating: the whole-row edit paths that remain — reference-data cascades, resource directory, task dedup, alloc plan, dependency stripping on delete — still revert every concurrent change outside `WRITE_THROUGH_FIELDS`, and a new write-through field added to an entity escapes the list silently. Name the two ways out (convert those sites to field patches where they are field-shaped, or derive the list rather than hand-maintaining it) and say that this slice deliberately scoped them out.

- [ ] **Step 5: Verify the register's own gates**

```bash
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "SYM=$?"
npm run docs:claims:check > /tmp/claims.log 2>&1; echo "CLAIMS=$?"; grep -E "out-of-range|unresolvable|citation" /tmp/claims.log | head
```

Expected: both `0`. `docs:claims:check` is a **ratchet** — it fails on a NEW `path:LINE` citation. Cite symbols and greps, not line numbers, in anything you add.

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md src/app/undo/use-undo-stack.ts
git commit -F - <<'EOF'
docs(followups): close #50, correct three stale claims it touched

#50 is closed by both mechanisms. Its task half was marked unverified and
is now measured true; captureFieldPart's docblock repeated that and is
corrected, along with the budget-buckets trap it called "waiting" — this
slice took it. #87 predates search_history and is corrected with a date.

The whole-row paths this slice deliberately leaves are recorded as their
own entry rather than folded into the closed one.
EOF
```

---

## Task 16: Release

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md`

- [ ] **Step 1: Pick a codename**

Sci-fi/fantasy author surname, minor-series milestone. **Re-check it against the changelog immediately before use** — a name reserved in advance has already been consumed by an unrelated release once:

```bash
grep -c "YourCandidate" CHANGELOG.md
```

Expected: `0`. If not, pick another.

- [ ] **Step 2: Bump all eight sites**

Current version is `0.245.0`; this is a behaviour fix, so `0.246.0`.

```bash
grep -n "APP_VERSION\|APP_BUILD_DATE" src/app/version.ts
grep -n '"version"' package.json
grep -n '"version": "0.2' package-lock.json | head -4
grep -n "shields.io" README.md | head -3
grep -rn "Generated:" docs/CODEMAPS/*.md
```

Update: `src/app/version.ts` (`APP_VERSION`, `APP_BUILD_DATE`, milestone), `package.json` `version`, **both** `package-lock.json` occurrences (root and `packages[""]`), the README badge (version **and** codename), and the `<!-- Generated: … | App <version> "<codename>" … -->` header on all five codemaps.

- [ ] **Step 3: Write the changelog entry**

Under `## [0.246.0] - 2026-08-18 "<Codename>"`, a `### Fixed` section in the register's user-facing voice — what the user lost, not which function changed. Two entries:

- Undoing a bulk edit destroyed notes written since applying it, on tasks, RAID items and changes. The note came back only on an immediate redo, which also re-applied the edit being undone.
- Undoing a bulk edit could make a task or milestone forget the calendar event it had just been synced to, so the next sync created a second event for the same item.

★ No `[session link removed]...` URL anywhere in `CHANGELOG.md` or an MR description.

- [ ] **Step 4: Verify the version is consistent everywhere**

```bash
grep -rn "0\.245\.0" src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS/ | grep -v "^CHANGELOG"
```

Expected: no output. Any hit is a site that was missed.

- [ ] **Step 5: Final gate run**

This is the ONLY full-suite run in the plan. Run the commands one at a time, never through a
pipe, and never two vitest processes at once.

```bash
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
npx tsc --noEmit; echo "TSC=$?"
npm run test:run > /tmp/final.log 2>&1; echo "TEST=$?"; grep -E "Test Files|Tests " /tmp/final.log
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "SHUF=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
npm run test:coverage > /tmp/cov.log 2>&1; echo "COV=$?"
npm run size:check > /tmp/size.log 2>&1; echo "SIZE=$?"
npm run dup:check > /tmp/dup.log 2>&1; echo "DUP=$?"
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "SYM=$?"
npm run docs:claims:check > /tmp/claims.log 2>&1; echo "CLAIMS=$?"
```

Expected: every one `0`.

Sanity-check `test:run`'s file count against `git ls-files 'src/**/*.test.*' | wc -l` — a vitest
fork-pool collapse reports far fewer files and still reads as an ordinary failure. If files are
missing, re-run with `--maxWorkers=4` rather than chasing the "failures". If `size:check` fails,
reduce the file rather than re-baselining. If `dup:check` fails, the four `applyBulk` bodies are
the likely cause; they are meant to share `buildBulkFieldEdits`, so check each panel calls it
rather than inlining the diff.

- [ ] **Step 6: Commit**

```bash
git add src/app/version.ts CHANGELOG.md package.json package-lock.json README.md docs/CODEMAPS/
git commit -F - <<'EOF'
chore(release): 0.246.0 "<Codename>"
EOF
```

- [ ] **Step 7: STOP**

Do **not** push, open an MR, or merge. This repo's standing rule is that a release happens only on the user's explicit say-so, and "release" means push → MR → poll the pipeline → merge only on green, never `--auto-merge`. Report the branch as ready and wait.

---

## Notes for the implementer

**Things that will look like bugs and are not.**

- After Part B, the three register integration tests from Tasks 9, 10 and 13 pass because of the *field patch*, not the engine list. Part A's coverage lives in Tasks 1, 2, 4 and 5, which is why Tasks 4 and 5 deliberately use a path Part B does not convert. Do not delete them as redundant.
- A local axe or Playwright run is not needed for this slice — nothing here changes rendered output. If you run one anyway, use `--workers=1`; local Playwright defaults to CPU count while CI runs serially, and the contention produces timeouts that read as failures.

**Things that are bugs and will not be caught by any gate.**

- A panel that builds its edits *after* calling `onSave` captures the post-save row as `before`, so the undo is a no-op. The capture must come first, which is why each `applyBulk` computes all rows before the loop.
- A test that seeds the note *before* the bulk apply passes against unfixed code. Every note test in this plan seeds after. If you add one, do the same.
