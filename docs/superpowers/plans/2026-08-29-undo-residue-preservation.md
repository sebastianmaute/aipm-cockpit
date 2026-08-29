# Undo Residue Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close `docs/open-followups.md` §177a, §178, §179 and §180, and settle §181 by measurement.

**Architecture:** Two new pure leaf modules under `src/app/undo/` — one owning the write-through
field list that two modules currently duplicate, one owning a three-way merge that lets an undo
revert only the keys the operation actually wrote. Three existing files gain an import and a call
each; six bulk-edit call sites gain a required argument. No React, no i18n and no DOM enter the new
modules.

**Tech Stack:** TypeScript (strict), React 19, Next 16.2.11, vitest 4.1.8, fast-check, ESLint at
`--max-warnings=0`.

**Spec:** `docs/superpowers/specs/2026-08-29-undo-residue-design.md`

---

## Orientation — read before Task 1

You are working in `C:\Projects\aipm-wt-a`, a git worktree. Run everything from there. Never `cd`
to another checkout.

**The domain in one paragraph.** The app has an undo stack. When the user bulk-edits rows, the stack
captures a *field patch* per row — `{id, before: Partial<T>, after: Partial<T>}` — holding only the
fields the operation changed. Undo writes `before` back over the live row; redo writes `after`. The
bug class this plan closes is that both writes are *wholesale*: they overwrite the entire value of
each captured field, so a concurrent writer that changed a different key of the same object-valued
field loses its change.

**Five landmines specific to this repo. Violating any one of them fails CI or corrupts a file.**

1. **Every file under `src/app/` is CRLF.** The `Edit` tool preserves CRLF; the `Write` tool
   re-lines the whole file to LF. **Use `Edit`, never `Write`, on any existing `src/app` file.** New
   `src/app` files created with `Write` land as LF, which is a pre-existing inconsistency the repo
   tolerates — do not "fix" other files' endings. Never use `sed -i` on a source file: under Git
   Bash it silently re-lines the whole file and `core.autocrlf=true` hides it from `git diff`.
2. **Never read a gate's exit code through a pipe.** `npm run test:run | tail` reports `tail`'s
   status. Redirect to a file, echo `$?` unpiped, then read the file.
3. **`npx tsc --noEmit` exits 2 on diagnostics, not 1.**
4. **Never run two vitest processes at once.** A red run carrying `Failed to start forks worker` is
   machine contention, not a test failure.
5. **`npm run lint` treats every warning as fatal** and exits 1 from stray gitignored directories;
   use `npx eslint src` when you only mean to lint sources.

**File-size ratchet.** `npm run size:check` measures `readFileSync().split("\n").length`, which is
one MORE than `wc -l`. `src/app/undo/use-undo-stack.ts` is at **728** by that measure against a
limit of 800. Read the real number with:

```bash
node -e "console.log(require('fs').readFileSync('src/app/undo/use-undo-stack.ts','utf8').split('\n').length)"
```

**Coverage.** New `.ts` files under `src/app` are coverage-gated. Both new modules are pure, so
cover them fully; do **not** add them to `vitest.config.ts` `coverage.exclude` (that list is for UI
glue).

---

## File Structure

| file | status | responsibility |
|---|---|---|
| `src/app/undo/write-through-fields.ts` | create | Sole authoring site for the write-through field list. Exports the tuple and the derived `Set`. Imports only `../types`. |
| `src/app/undo/write-through-fields.test.ts` | create | Pins that the tuple and the `Set` cannot drift. |
| `src/app/undo/merge-field-value.ts` | create | Pure three-way merge: `mergeFieldValue` and `mergeFieldPatch`. |
| `src/app/undo/merge-field-value.test.ts` | create | The no-race property plus record, array, duplicate and shape-mismatch cases. |
| `src/app/undo/field-groups.ts` | modify | Takes `groups` on `buildBulkFieldEdits` and completes them; imports the write-through set; exports `differs`. |
| `src/app/undo/undo-stack.ts` | modify | `rowsEqualExcept` in the delete filter. |
| `src/app/undo/use-undo-stack.ts` | modify | `captureFieldPart` merges instead of spreading; imports the write-through tuple. |
| `src/app/use-bulk-operations.ts` | modify | passes `TASK_UNDO_GROUPS` |
| `src/app/change-panel.tsx` | modify | passes `CHANGE_UNDO_GROUPS` |
| `src/app/raid-panel.tsx` | modify | passes `RAID_UNDO_GROUPS` |
| `src/app/stakeholders-panel.tsx` | modify | passes `STAKEHOLDER_UNDO_GROUPS` |
| `src/app/milestones-panel.tsx` | modify | passes `MILESTONE_UNDO_GROUPS` |
| `src/app/use-raci-suggest.tsx` | modify | passes `STAKEHOLDER_UNDO_GROUPS` |
| `src/app/use-resource-planner.ts` · `src/app/use-change-log.ts` · `src/app/use-stakeholders.ts` | modify | §181 only, and only if Task 7's probe confirms |
| `docs/open-followups.md` | modify | close §177a, §178, §179, §180; resolve §181 either way |
| `CHANGELOG.md` · `src/app/version.ts` | modify | release entry and version bump |

Dependency direction, one-way and acyclic:

```
use-undo-stack.ts → merge-field-value.ts → field-groups.ts → write-through-fields.ts → types.ts
undo-stack.ts     ────────────────────────────────────────↗
```

---

## Task 1: One source for the write-through field list (§177a)

**Files:**
- Create: `src/app/undo/write-through-fields.ts`
- Create: `src/app/undo/write-through-fields.test.ts`
- Modify: `src/app/undo/use-undo-stack.ts` (remove its private `WRITE_THROUGH_FIELDS`, import instead)
- Modify: `src/app/undo/field-groups.ts` (remove its private `WRITE_THROUGH_KEYS`, import instead)

Two constants hold the same two strings for two different jobs. `WRITE_THROUGH_FIELDS` in
`use-undo-stack.ts` decides what a whole-row undo PRESERVES; `WRITE_THROUGH_KEYS` in
`field-groups.ts` decides what a bulk patch CAPTURES. They were split because `field-groups.ts` must
not import the hook. A leaf module both can import removes that constraint.

- [ ] **Step 1: Write the failing test**

Create `src/app/undo/write-through-fields.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { WRITE_THROUGH_FIELDS, WRITE_THROUGH_KEYS } from "./write-through-fields";

describe("write-through fields", () => {
  it("names the two fields a concurrent writer can set without an undo entry", () => {
    expect(WRITE_THROUGH_FIELDS).toEqual(["noteLog", "outlookEventId"]);
  });

  // The whole point of the module: the Set is DERIVED, so the two views cannot
  // drift the way the two hand-maintained copies could. Mutation that proves it:
  // hardcode the Set to a different literal — this goes red, and nothing else does.
  it("derives the key set from the tuple rather than restating it", () => {
    expect([...WRITE_THROUGH_KEYS].sort()).toEqual([...WRITE_THROUGH_FIELDS].sort());
    expect(WRITE_THROUGH_KEYS.size).toBe(WRITE_THROUGH_FIELDS.length);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/undo/write-through-fields.test.ts
```

Expected: FAIL — `Failed to resolve import "./write-through-fields"`.

- [ ] **Step 3: Create the module**

Create `src/app/undo/write-through-fields.ts`:

```ts
// src/app/undo/write-through-fields.ts
//
// The fields a concurrent, non-undoable writer can set on a row: the notes
// window writes `noteLog`, the background calendar push writes `outlookEventId`,
// and neither pushes an undo entry. Two consumers need this list for opposite
// reasons — `use-undo-stack.ts` PRESERVES them across a whole-row undo,
// `field-groups.ts` EXCLUDES them from a bulk patch's capture — and before this
// module each kept its own hardcoded copy with nothing enforcing they agreed
// (open-followups §177). This is the sole authoring site.
//
// ★ The `satisfies` constraint is load-bearing and must stay on the tuple. The
// list is applied to entity types carrying NEITHER key (roles, grades), which a
// `keyof T` parameter could not accept. `keyof (A | B)` is the keys common to
// ALL members, and a tuple constrains each SLOT separately, so each entry must
// name a field every one of ITS OWN carriers still declares. A rename in
// `types.ts`, or a typo here, is then a compile error on this line rather than a
// silent loss of protection — before the constraint existed, `[]` typechecked
// just as happily.
import type { Absence, ChangeItem, CommitteeMeeting, Milestone, RaidItem, Task } from "../types";

export const WRITE_THROUGH_FIELDS = ["noteLog", "outlookEventId"] as const satisfies readonly [
  keyof (Task | RaidItem | ChangeItem),
  keyof (Task | RaidItem | Milestone | ChangeItem | CommitteeMeeting | Absence),
];

/** The same list as a lookup. DERIVED — never restate the members here. */
export const WRITE_THROUGH_KEYS: ReadonlySet<string> = new Set<string>(WRITE_THROUGH_FIELDS);
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run src/app/undo/write-through-fields.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Point `use-undo-stack.ts` at the module**

In `src/app/undo/use-undo-stack.ts`, delete the whole `const WRITE_THROUGH_FIELDS = [...] as const
satisfies readonly [...]` declaration together with the long doc comment that precedes it (the
comment's content now lives in the new module), and add to the existing import block:

```ts
import { WRITE_THROUGH_FIELDS } from "./write-through-fields";
```

Leave the four `WRITE_THROUGH_FIELDS` use sites untouched — they still read the same name.

If `Absence`, `CommitteeMeeting` or `Milestone` are now unused in that file's `import type { … }
from "../types"` block, remove only the names that became unused. `npm run lint` is fatal on an
unused import.

- [ ] **Step 6: Point `field-groups.ts` at the module**

In `src/app/undo/field-groups.ts`, delete the line

```ts
const WRITE_THROUGH_KEYS: ReadonlySet<string> = new Set(["noteLog", "outlookEventId"]);
```

and add below the existing `import type { CalendarEvent } from "../calendar-event";`:

```ts
import { WRITE_THROUGH_KEYS } from "./write-through-fields";
```

Keep the long doc comment above the deleted line where it is — it documents the FILTER's behaviour
in `buildBulkFieldEdits`, not the constant's membership. Change only its final paragraph, which
currently reads:

```
 * See also `WRITE_THROUGH_FIELDS` in `use-undo-stack.ts` — that constant decides
 * what a whole-row undo PRESERVES; this one decides what a patch CAPTURES.
```

to:

```
 * Both views now come from `write-through-fields.ts`: the tuple decides what a
 * whole-row undo PRESERVES, the derived set decides what a patch CAPTURES. They
 * are one list and can no longer drift (open-followups §177).
```

- [ ] **Step 7: Typecheck and run the undo suite**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/undo > /tmp/undo-t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/undo-t1.log
```

Expected: tsc `EXIT=0`. Vitest `EXIT=0`, all files passed.

- [ ] **Step 8: Confirm the CRLF files stayed CRLF**

```bash
git ls-files --eol src/app/undo/use-undo-stack.ts src/app/undo/field-groups.ts
```

Expected: both report `i/lf    w/crlf`. If either says `w/lf`, you re-lined it — revert and redo the
edit with the `Edit` tool.

- [ ] **Step 9: Commit**

```bash
git add src/app/undo/write-through-fields.ts src/app/undo/write-through-fields.test.ts \
        src/app/undo/use-undo-stack.ts src/app/undo/field-groups.ts
git commit --only src/app/undo/write-through-fields.ts src/app/undo/write-through-fields.test.ts \
        src/app/undo/use-undo-stack.ts src/app/undo/field-groups.ts -m "refactor: give the write-through field list one authoring site

Closes the open-followups 177 duplication half. WRITE_THROUGH_FIELDS
(what a whole-row undo preserves) and WRITE_THROUGH_KEYS (what a bulk
patch captures) held the same two strings in two files with nothing
enforcing they agreed. The set is now derived from the tuple.

The satisfies constraint moves with the declaration unchanged: it is
what makes a rename in types.ts a compile error here rather than a
silent loss of protection.

Leaves 177b, the whole-row capture conversion sweep, open."
```

---

## Task 2: Group completion in the bulk builder (§180)

**Files:**
- Modify: `src/app/undo/field-groups.ts`
- Modify: `src/app/undo/field-groups.test.ts`
- Modify: `src/app/use-bulk-operations.ts`, `src/app/change-panel.tsx`, `src/app/raid-panel.tsx`,
  `src/app/stakeholders-panel.tsx`, `src/app/milestones-panel.tsx`, `src/app/use-raci-suggest.tsx`

`changedFieldGroups` honours `FieldGroup[]` on the single-row path, and every entity already passes
its constant there. `buildBulkFieldEdits` takes no such parameter, so on the bulk path a lone-member
difference captures one half of a coupled pair and the undo restores it alone — leaving
`status: "Done"` with no `completedDate`.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/undo/field-groups.test.ts`:

```ts
describe("buildBulkFieldEdits group completion", () => {
  type Row = { id: number; status: string; completedDate?: string; title: string };
  const GROUPS: readonly FieldGroup<Row>[] = [["status", "completedDate"]];

  it("captures the whole group when only one member differs", () => {
    // The stored row is already split — Done with no completedDate — which is the
    // only way a lone-member difference arises. Reverting `status` alone would
    // leave the pair inconsistent in the other direction.
    const before: Row = { id: 1, status: "Done", title: "a" };
    const after: Row = { id: 1, status: "To Do", title: "a" };
    const [edit] = buildBulkFieldEdits([{ before, after }], GROUPS);
    expect(Object.keys(edit.before).sort()).toEqual(["completedDate", "status"]);
    expect(Object.keys(edit.after).sort()).toEqual(["completedDate", "status"]);
    expect(edit.before.completedDate).toBeUndefined();
  });

  it("leaves an ungrouped changed key alone", () => {
    const before: Row = { id: 1, status: "To Do", title: "a" };
    const after: Row = { id: 1, status: "To Do", title: "b" };
    const [edit] = buildBulkFieldEdits([{ before, after }], GROUPS);
    expect(Object.keys(edit.before)).toEqual(["title"]);
  });

  it("does not let one group's completion trigger another group", () => {
    // `completedDate` is added by the first group. If the second group were tested
    // against the GROWING set rather than the original diff, `note` would join too.
    const groups: readonly FieldGroup<Row & { note?: string }>[] = [
      ["status", "completedDate"],
      ["completedDate", "note"],
    ];
    const before = { id: 1, status: "Done", title: "a" };
    const after = { id: 1, status: "To Do", title: "a" };
    const [edit] = buildBulkFieldEdits([{ before, after }], groups);
    expect(Object.keys(edit.before).sort()).toEqual(["completedDate", "status"]);
  });

  it("keeps an empty group list behaving exactly as before", () => {
    const before: Row = { id: 1, status: "Done", title: "a" };
    const after: Row = { id: 1, status: "To Do", title: "a" };
    const [edit] = buildBulkFieldEdits([{ before, after }], []);
    expect(Object.keys(edit.before)).toEqual(["status"]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
npx vitest run src/app/undo/field-groups.test.ts
```

Expected: FAIL — `buildBulkFieldEdits` takes one argument, so the group cases capture `status` alone.

- [ ] **Step 3: Add the parameter and the completion**

In `src/app/undo/field-groups.ts`, replace the signature line, the `KNOWN GAP` comment block, and
the `out.push` line. The `KNOWN GAP` comment is **deleted, not amended** — it currently instructs the
reader not to fix this, and a prohibition left standing over changed behaviour tells the next person
to revert. Result:

```ts
export function buildBulkFieldEdits<T extends { id: number }>(
  rows: readonly { before: T; after: T }[],
  groups: readonly FieldGroup<T>[],
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
    // Complete every group one changed key belongs to, so a coupled pair reverts
    // together even when only one member differs (open-followups §180). `seed` is
    // the ORIGINAL diff: testing groups against the growing set would let one
    // group's completion trigger the next, which is not the invariant.
    const seed: ReadonlySet<string> = new Set<string>(changed);
    const complete = new Set<string>(changed);
    for (const g of groups) {
      if (!g.some((k) => seed.has(k))) continue;
      for (const k of g) {
        if (NEVER_CAPTURE.has(k) || WRITE_THROUGH_KEYS.has(k)) continue;
        complete.add(k);
      }
    }
    const captured = [...complete] as (keyof T & string)[];
    out.push({ id: before.id, before: pick(before, captured), after: pick(after, captured) });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx vitest run src/app/undo/field-groups.test.ts
```

Expected: PASS. If `FieldGroup` is not already imported in the test file, add it to the existing
`import { pick, changedFieldGroups, buildBulkFieldEdits, type FieldGroup } from "./field-groups";`.

- [ ] **Step 5: Update the six call sites**

Each site gains its entity's constant as a second argument, and the import if it is missing. Make
exactly these six edits:

| file | call becomes | import to add if absent |
|---|---|---|
| `src/app/use-bulk-operations.ts` | `buildBulkFieldEdits(beforeRows.map((row) => ({ before: row, after: patchRow(row) })), TASK_UNDO_GROUPS)` | `import { buildBulkFieldEdits, TASK_UNDO_GROUPS } from "./undo/field-groups";` |
| `src/app/change-panel.tsx` | `buildBulkFieldEdits(rows, CHANGE_UNDO_GROUPS)` | `import { buildBulkFieldEdits, CHANGE_UNDO_GROUPS } from "./undo/field-groups";` |
| `src/app/raid-panel.tsx` | `buildBulkFieldEdits(rows, RAID_UNDO_GROUPS)` | `import { buildBulkFieldEdits, RAID_UNDO_GROUPS } from "./undo/field-groups";` |
| `src/app/stakeholders-panel.tsx` | `buildBulkFieldEdits(rows, STAKEHOLDER_UNDO_GROUPS)` | `import { buildBulkFieldEdits, STAKEHOLDER_UNDO_GROUPS } from "./undo/field-groups";` |
| `src/app/milestones-panel.tsx` | `buildBulkFieldEdits(rows, MILESTONE_UNDO_GROUPS)` | already imports `MILESTONE_UNDO_GROUPS` |
| `src/app/use-raci-suggest.tsx` | `buildBulkFieldEdits(rows, STAKEHOLDER_UNDO_GROUPS)` | `import { buildBulkFieldEdits, STAKEHOLDER_UNDO_GROUPS } from "./undo/field-groups";` |

Locate each with:

```bash
grep -rn "buildBulkFieldEdits(" src/app --include=*.ts --include=*.tsx | grep -v '\.test\.' | grep -v "undo/field-groups"
```

That output also contains COMMENT lines in `raid-panel.tsx` and elsewhere that merely name the
function. Read each hit; edit only the real calls.

- [ ] **Step 6: Typecheck — this is what proves the sweep is complete**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`. A missed call site is a compile error, because the parameter is required. If tsc
exits 2, it names the file and line of the site you missed.

- [ ] **Step 7: Run the affected suites**

```bash
npx vitest run src/app/undo src/app/use-bulk-operations.test.tsx src/app/use-raci-suggest.test.tsx \
  > /tmp/undo-t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/undo-t2.log
```

Expected: `EXIT=0`. If a pre-existing test now captures two keys where it asserted one, read it
before changing it: an assertion pinning the lone-member capture is pinning the defect, and its
docblock should be rewritten to say the pair now travels together, not loosened to accept either.

- [ ] **Step 8: Commit**

```bash
git add src/app/undo/field-groups.ts src/app/undo/field-groups.test.ts src/app/use-bulk-operations.ts \
        src/app/change-panel.tsx src/app/raid-panel.tsx src/app/stakeholders-panel.tsx \
        src/app/milestones-panel.tsx src/app/use-raci-suggest.tsx
git commit --only src/app/undo/field-groups.ts src/app/undo/field-groups.test.ts src/app/use-bulk-operations.ts \
        src/app/change-panel.tsx src/app/raid-panel.tsx src/app/stakeholders-panel.tsx \
        src/app/milestones-panel.tsx src/app/use-raci-suggest.tsx -m "fix: complete coupled field groups on the bulk undo path

Closes open-followups 180. changedFieldGroups honours FieldGroup[] on the
single-row path and every entity already passes its constant there;
buildBulkFieldEdits had no such parameter, so a lone-member difference
captured half a coupled pair and the undo restored it alone, leaving
status Done with no completedDate.

groups is REQUIRED rather than optional. Four of the six call sites pass
an empty list today, so an optional parameter would be omitted at most
sites and a future coupling silently missed by whoever copied a
neighbour. tsc is the sweep's completeness check.

Group completion tests against the ORIGINAL diff, not the growing set,
so one group's completion cannot trigger another.

The KNOWN GAP comment is deleted rather than amended: it forbade this
fix, and a prohibition left standing over changed behaviour instructs
the next reader to revert it."
```

---

## Task 3: Prove the §179 delete-branch defect, and prove the guard it must not break

**Files:**
- Modify: `src/app/undo/undo-stack.test.ts`

This task adds only tests, and one of them is expected to be RED at the end of it. That is the
point: the register's deferral says the obvious fix is wrong, and the two tests are what decide it.
Do not implement anything in this task.

- [ ] **Step 1: Write both tests**

Append to `src/app/undo/undo-stack.test.ts`. Check the file's existing imports first; add
`applyUndoForward` and `applyUndoRestoreWithRemap` to them if absent.

```ts
describe("delete-branch identity under a write-through write (open-followups §179)", () => {
  type Row = { id: number; title: string; noteLog?: { id: string; text: string }[] };
  const PRESERVE = ["noteLog", "outlookEventId"];

  it("removes the row on redo even though a note was added after the restore", () => {
    // The sequence from the register: delete a row, undo it, add a note through
    // the notes window (write-through — no undo entry, so the redo stack
    // survives), then redo. The redo must still remove the row it restored.
    const recovered: Row = { id: 7, title: "Risk A" };
    const live: Row[] = [{ id: 7, title: "Risk A", noteLog: [{ id: "n1", text: "added later" }] }];
    const out = applyUndoForward(live, [{ op: "delete", item: recovered }], PRESERVE);
    expect(out).toEqual([]);
  });

  it("still refuses to remove an unrelated row that merely reused the freed id", () => {
    // This is the guard the relaxation must not break. A capture-bypassing delete
    // freed id 7 and a new row took it; redo must leave that row alone.
    const recovered: Row = { id: 7, title: "Risk A" };
    const live: Row[] = [{ id: 7, title: "Something else entirely" }];
    const out = applyUndoForward(live, [{ op: "delete", item: recovered }], PRESERVE);
    expect(out).toEqual(live);
  });
});
```

- [ ] **Step 2: Run them and record which way each goes**

```bash
npx vitest run src/app/undo/undo-stack.test.ts > /tmp/undo-t3.log 2>&1; echo "EXIT=$?"
grep -E "✓|×|Test Files|Tests " /tmp/undo-t3.log
```

Expected: the first test FAILS (`out` still contains the row — this is the defect), the second
PASSES (the guard works today). `EXIT=1` overall.

**If the first test PASSES**, the defect does not reproduce as the register describes. Stop, do not
implement Task 4, and report the measurement — §179 keeps its deferral and the spec is wrong about
it.

- [ ] **Step 3: Commit both tests, with the first one skipped**

Mark the first test `it.skip` with a comment naming why, so the commit is green and the RED state is
recorded rather than left to rot in a broken suite:

```ts
  // Un-skipped by the §179 fix in the next commit. Left skipped here so this
  // commit records the reproduction without shipping a red suite.
  it.skip("removes the row on redo even though a note was added after the restore", () => {
```

```bash
npx vitest run src/app/undo/undo-stack.test.ts; echo "EXIT=$?"
git add src/app/undo/undo-stack.test.ts
git commit --only src/app/undo/undo-stack.test.ts -m "test: reproduce the 179 delete-branch duplicate, and pin the guard it must not break

Two tests. The first reproduces the register sequence — delete, undo,
write-through note, redo — where whole-row equality fails and the redo
declines to remove the row it restored. It is skipped in this commit and
un-skipped by the fix.

The second pins the reason 179 says the obvious fix is wrong: a redo must
not destroy an unrelated live row that merely reused a freed id. It passes
today and must keep passing."
```

---

## Task 4: Preserve-aware delete identity (§179)

**Files:**
- Modify: `src/app/undo/undo-stack.ts`
- Modify: `src/app/undo/undo-stack.test.ts` (un-skip)

- [ ] **Step 1: Un-skip the reproduction**

In `src/app/undo/undo-stack.test.ts`, change `it.skip("removes the row on redo` back to
`it("removes the row on redo` and delete the two-line comment above it.

- [ ] **Step 2: Run and confirm it fails again**

```bash
npx vitest run src/app/undo/undo-stack.test.ts; echo "EXIT=$?"
```

Expected: `EXIT=1`, one failing test.

- [ ] **Step 3: Add `rowsEqualExcept` and use it in the delete filter**

In `src/app/undo/undo-stack.ts`, immediately after the existing `rowsEqual` function, add:

```ts
/** `rowsEqual`, ignoring the write-through keys at the row's TOP level only —
 *  the identity notion the redo delete-filter needs (open-followups §179).
 *
 *  Whole-row equality was too strict: a note added through the notes window
 *  after an undo restored the row made the live row unequal to the recovered
 *  image, so the redo declined to remove it and the next undo spliced a SECOND
 *  copy in under a fresh id. Id-alone is too loose: the filter exists to stop a
 *  redo destroying an unrelated live row that merely reused a freed id. This
 *  sits between them — a recycled-id row differs on ordinary content fields and
 *  is still caught.
 *
 *  ★ KNOWN RESIDUE: a recycled-id row differing from the recovered image ONLY on
 *  write-through fields is still destroyed. Reaching that needs a new row whose
 *  every other field coincidentally matches a deleted one. */
function rowsEqualExcept(a: unknown, b: unknown, ignore: readonly string[]): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return rowsEqual(a, b);
  }
  if (Array.isArray(a) || Array.isArray(b)) return rowsEqual(a, b);
  const skip = new Set(ignore);
  const ka = Object.keys(a as object).filter((k) => !skip.has(k));
  const kb = Object.keys(b as object).filter((k) => !skip.has(k));
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    rowsEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
```

Then in `applyUndoForward`, change the filter line from

```ts
      return recovered === undefined || !rowsEqual(r, recovered);
```

to

```ts
      return recovered === undefined || !rowsEqualExcept(r, recovered, preserve);
```

- [ ] **Step 4: Run and confirm both tests pass**

```bash
npx vitest run src/app/undo/undo-stack.test.ts; echo "EXIT=$?"
```

Expected: `EXIT=0`, both new tests green.

- [ ] **Step 5: Mutation-test the relaxation**

The risk is that the new predicate ignores too much. Prove the recycled-id guard is what catches it:
temporarily replace the filter body with `return recovered === undefined;` (i.e. always remove by
id), run the suite, and confirm the **recycled-id** test goes red.

```bash
npx vitest run src/app/undo/undo-stack.test.ts; echo "EXIT=$?"
```

Expected under the mutant: `EXIT=1`, and the failing test is
`still refuses to remove an unrelated row that merely reused the freed id`.

Revert the mutant with an anchored `Edit` restoring the exact line from Step 3, then prove the tree
is clean — `git checkout -- <file>` is deny-blocked in this repo, so do not reach for it:

```bash
git diff --stat src/app/undo/undo-stack.ts
```

Expected after reverting: the only changes are Step 3's, not the mutant's.

- [ ] **Step 6: Run the whole undo suite and typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/undo > /tmp/undo-t4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/undo-t4.log
```

Expected: both `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add src/app/undo/undo-stack.ts src/app/undo/undo-stack.test.ts
git commit --only src/app/undo/undo-stack.ts src/app/undo/undo-stack.test.ts -m "fix: make the redo delete-filter identity ignore write-through fields

Closes open-followups 179. The filter confirmed a row's identity by whole-row
deep equality against the capture-time image. A note added through the notes
window after an undo restored the row broke that equality, so the redo
declined to remove the row and the next undo took the id-reuse path and
spliced a second copy in under a fresh id — a duplicate register row from
three keystrokes and one note.

The entry argued the obvious fix was wrong because the guard stops a redo
destroying an unrelated live row that reused a freed id. Equality modulo
write-through fields is strictly between whole-row equality and id-alone, so
that row still differs on ordinary content and is still caught. The
recycled-id test is mutation-proved: replacing the filter with remove-by-id
turns it red and nothing else.

Known residue, recorded at the function: a recycled-id row differing ONLY on
write-through fields is still destroyed, and a note added between undo and
redo is lost because a delete-image has no live row to preserve from."
```

---

## Task 5: The three-way merge module (§178, part 1)

**Files:**
- Create: `src/app/undo/merge-field-value.ts`
- Create: `src/app/undo/merge-field-value.test.ts`
- Modify: `src/app/undo/field-groups.ts` (export `differs`)

This task builds and proves the merge in isolation. Nothing calls it yet.

- [ ] **Step 1: Export `differs` from `field-groups.ts`**

In `src/app/undo/field-groups.ts`, change

```ts
function differs(a: unknown, b: unknown): boolean {
```

to

```ts
export function differs(a: unknown, b: unknown): boolean {
```

The merge module reuses it rather than copying it — `dup:check` compares the total duplicated-line
percentage across the repo, and a second copy of a structural-equality helper is exactly that shape.

- [ ] **Step 2: Write the failing tests**

Create `src/app/undo/merge-field-value.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { mergeFieldValue, mergeFieldPatch } from "./merge-field-value";

describe("mergeFieldValue", () => {
  // THE property that bounds this change's blast radius. When nothing raced —
  // the live value still equals the op's other end — the merge is a plain
  // revert, so every non-racing undo in the app behaves exactly as before.
  it("returns the target verbatim whenever nothing raced", () => {
    let nonTrivial = 0;
    const RUNS = 300;
    const value = fc.oneof(
      fc.integer(),
      fc.string(),
      fc.array(fc.string()),
      fc.dictionary(fc.string(), fc.integer()),
    );
    fc.assert(
      fc.property(value, value, (target, other) => {
        const live = structuredClone(other);
        const out = mergeFieldValue(target, other, live);
        if (JSON.stringify(target) !== JSON.stringify(other)) nonTrivial += 1;
        expect(JSON.stringify(out)).toBe(JSON.stringify(target));
      }),
      { numRuns: RUNS },
    );
    // Anti-vacuity as a FRACTION, never an absolute count: an absolute floor gets
    // easier to clear as numRuns rises, which makes the guard weaker the more you
    // run it.
    expect(nonTrivial / RUNS).toBeGreaterThan(0.5);
  });

  it("keeps a concurrent write to a key the op never touched", () => {
    const target = { m1: "A", m2: "C" };
    const other = { m1: "R", m2: "C" };
    const live = { m1: "R", m2: "C", m3: "I" };
    expect(mergeFieldValue(target, other, live)).toEqual({ m1: "A", m2: "C", m3: "I" });
  });

  it("reverts a key the op did touch even when the concurrent writer also moved it", () => {
    const target = { m1: "A" };
    const other = { m1: "R" };
    const live = { m1: "C" };
    expect(mergeFieldValue(target, other, live)).toEqual({ m1: "A" });
  });

  it("deletes a key the target does not carry", () => {
    const target = {};
    const other = { m1: "R" };
    const live = { m1: "R", m2: "I" };
    expect(mergeFieldValue(target, other, live)).toEqual({ m2: "I" });
  });

  it("removes what the op added and keeps a concurrent addition", () => {
    const target = ["a", "b"];
    const other = ["a", "b", "opAdded"];
    const live = ["a", "b", "opAdded", "userAdded"];
    expect(mergeFieldValue(target, other, live)).toEqual(["a", "b", "userAdded"]);
  });

  it("re-inserts what the op removed, in its original position", () => {
    const target = ["a", "b", "c"];
    const other = ["a", "c"];
    const live = ["a", "c", "userAdded"];
    expect(mergeFieldValue(target, other, live)).toEqual(["a", "b", "c", "userAdded"]);
  });

  it("re-inserts a leading member at the head", () => {
    const target = ["a", "b"];
    const other = ["b"];
    const live = ["b", "userAdded"];
    expect(mergeFieldValue(target, other, live)).toEqual(["a", "b", "userAdded"]);
  });

  it("falls back to the target when either end holds duplicates", () => {
    // Anchoring is ambiguous with duplicates, and a silent wrong answer is worse
    // than today's known-coarse whole-value revert.
    const target = ["a", "a", "b"];
    const other = ["a", "a"];
    const live = ["a", "a", "userAdded"];
    expect(mergeFieldValue(target, other, live)).toEqual(["a", "a", "b"]);
  });

  it("falls back to the target when the shapes disagree", () => {
    expect(mergeFieldValue({ a: 1 }, ["x"], ["y"])).toEqual({ a: 1 });
    expect(mergeFieldValue("scalar", "other", "live")).toBe("scalar");
    expect(mergeFieldValue({ a: 1 }, { a: 2 }, null)).toEqual({ a: 1 });
  });
});

describe("mergeFieldPatch", () => {
  it("merges every captured key and leaves the rest of the row alone", () => {
    const live = { id: 1, raci: { m1: "R", m3: "I" }, title: "live title" };
    const out = mergeFieldPatch(live, { raci: { m1: "A" } }, { raci: { m1: "R" } });
    expect(out).toEqual({ id: 1, raci: { m1: "A", m3: "I" }, title: "live title" });
  });

  it("sets a captured key the target cleared to undefined, matching the old spread", () => {
    const live = { id: 1, completedDate: "2026-01-01", status: "Done" };
    const out = mergeFieldPatch(live, { completedDate: undefined }, { completedDate: "2026-01-01" });
    expect("completedDate" in out).toBe(true);
    expect(out.completedDate).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

```bash
npx vitest run src/app/undo/merge-field-value.test.ts
```

Expected: FAIL — `Failed to resolve import "./merge-field-value"`.

- [ ] **Step 4: Create the module**

Create `src/app/undo/merge-field-value.ts`:

```ts
// src/app/undo/merge-field-value.ts
//
// Pure three-way merge for undo/redo of a field patch. No React, no i18n, no DOM.
//
// A field patch holds {before, after} for exactly the fields an op wrote. Undo
// used to write `before` back WHOLESALE, so a concurrent writer that changed a
// different KEY of the same object-valued field lost its change — the unit of
// preservation was the FIELD, not the key inside it (open-followups §178).
//
// `target` is the end the undo/redo is moving toward; `other` is the opposite
// end. Undo is merge(before, after, live); redo is merge(after, before, live).
// One function, both directions.
import { differs } from "./field-groups";

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasDuplicates(xs: readonly unknown[]): boolean {
  for (let i = 0; i < xs.length; i += 1) {
    for (let j = i + 1; j < xs.length; j += 1) if (!differs(xs[i], xs[j])) return true;
  }
  return false;
}

function mergeRecord(
  target: Record<string, unknown>,
  other: Record<string, unknown>,
  live: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...live };
  for (const k of new Set<string>([...Object.keys(target), ...Object.keys(other)])) {
    if (!differs(target[k], other[k])) continue; // the op never touched it — live wins
    if (k in target) out[k] = target[k];
    else delete out[k];
  }
  return out;
}

/** Order-preserving three-way merge. Drops what the op added, re-inserts what it
 *  removed anchored to its nearest surviving predecessor in `target`, and leaves
 *  concurrent additions in their own relative order.
 *
 *  ★ Duplicates make the anchor ambiguous, so either end holding a repeated
 *  member falls back to the whole-value revert. A silent wrong answer here is
 *  worse than the coarse behaviour this function exists to replace.
 *  ★ When the op REORDERED members and a concurrent write also landed, the result
 *  keeps `live`'s relative order for surviving members rather than `target`'s.
 *  The no-race case is exact — `mergeFieldValue` short-circuits it. */
function mergeArray(
  target: readonly unknown[],
  other: readonly unknown[],
  live: readonly unknown[],
): unknown[] {
  if (hasDuplicates(target) || hasDuplicates(other)) return [...target];
  const inTarget = (v: unknown) => target.some((x) => !differs(x, v));
  const inOther = (v: unknown) => other.some((x) => !differs(x, v));
  const out = live.filter((v) => !(inOther(v) && !inTarget(v)));
  for (let i = 0; i < target.length; i += 1) {
    const m = target[i];
    if (inOther(m)) continue; // the op did not remove it
    if (out.some((v) => !differs(v, m))) continue; // a concurrent writer re-added it
    let at = 0;
    for (let j = i - 1; j >= 0; j -= 1) {
      const idx = out.findIndex((v) => !differs(v, target[j]));
      if (idx !== -1) {
        at = idx + 1;
        break;
      }
    }
    out.splice(at, 0, m);
  }
  return out;
}

/** Merge one captured field's value. See the module header for the direction
 *  convention. */
export function mergeFieldValue(target: unknown, other: unknown, live: unknown): unknown {
  // Nothing raced: a plain revert, identical to the pre-§178 behaviour. This
  // short-circuit is what makes "every non-racing undo is unchanged" true by
  // construction rather than by argument — including for a pure reorder, which
  // the array merge alone would not reproduce exactly.
  if (!differs(live, other)) return target;
  // The op never touched this value (a group-completed key, §180): live wins.
  if (!differs(target, other)) return live;
  if (isPlainRecord(target) && isPlainRecord(other) && isPlainRecord(live)) {
    return mergeRecord(target, other, live);
  }
  if (Array.isArray(target) && Array.isArray(other) && Array.isArray(live)) {
    return mergeArray(target, other, live);
  }
  return target;
}

/** Apply a whole captured patch to a live row, merging each key. Replaces the
 *  `{ ...row, ...patch }` spread the undo runner used to do. */
export function mergeFieldPatch<T extends object>(
  live: T,
  target: Partial<T>,
  other: Partial<T>,
): T {
  const out = { ...live } as Record<string, unknown>;
  const t = target as Record<string, unknown>;
  const o = other as Record<string, unknown>;
  for (const k of new Set<string>([...Object.keys(t), ...Object.keys(o)])) {
    out[k] = mergeFieldValue(t[k], o[k], (live as Record<string, unknown>)[k]);
  }
  return out as T;
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
npx vitest run src/app/undo/merge-field-value.test.ts; echo "EXIT=$?"
```

Expected: `EXIT=0`, all tests green.

- [ ] **Step 6: Mutation-test the two short-circuits**

Each of the two early returns in `mergeFieldValue` is load-bearing, and each has a named mutant:

1. Delete `if (!differs(live, other)) return target;` — expected red: the no-race property test,
   on a reordered-array counterexample.
2. Change `if (!differs(target, other)) return live;` to `return target;` — expected red: the
   `mergeFieldPatch` group-completion behaviour is not covered by a test yet, so **this mutant is
   expected to SURVIVE at this point.** That is a known test gap, not a passing guard. Task 6's RACI
   test does not close it either. Add this test to `merge-field-value.test.ts` before moving on:

```ts
  it("keeps a live value for a captured key both ends agree on", () => {
    // §180 completes a group, so a captured key can be IDENTICAL on both ends.
    // Reverting it would clobber a concurrent write to a field the op never wrote.
    const out = mergeFieldPatch(
      { id: 1, status: "To Do", completedDate: "concurrent" },
      { status: "Done", completedDate: undefined },
      { status: "To Do", completedDate: undefined },
    );
    expect(out.completedDate).toBe("concurrent");
  });
```

Re-run mutant 2 and confirm it now goes red. Revert both mutants with anchored `Edit`s, then:

```bash
git diff --stat src/app/undo/merge-field-value.ts
npx vitest run src/app/undo/merge-field-value.test.ts; echo "EXIT=$?"
```

Expected: the diff shows no mutant residue, `EXIT=0`.

- [ ] **Step 7: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src/app/undo; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 8: Commit**

```bash
git add src/app/undo/merge-field-value.ts src/app/undo/merge-field-value.test.ts src/app/undo/field-groups.ts
git commit --only src/app/undo/merge-field-value.ts src/app/undo/merge-field-value.test.ts src/app/undo/field-groups.ts -m "feat: add a pure three-way merge for undo field patches

First half of open-followups 178. Nothing calls this yet.

A field patch holds both ends of the op, so the keys the op actually
wrote are recoverable at restore time by diffing them — no new patch
model is needed, which is what the register entry assumed. Records merge
per key; arrays merge order-preserving, dropping what the op added and
re-inserting what it removed against its nearest surviving predecessor.

Two fallbacks are deliberate and documented at the source: duplicates in
either end make the anchor ambiguous, and mismatched shapes have no
sensible merge, so both revert the whole value as before.

The no-race short-circuit is what bounds the blast radius: when the live
value still equals the op's other end, the merge is a plain revert, so
every non-racing undo in the app is unchanged. Pinned by a fast-check
property whose anti-vacuity floor is a FRACTION of runs, not a count.

differs is exported rather than copied to keep dup:check flat."
```

---

## Task 6: Wire the merge into the undo runner (§178, part 2)

**Files:**
- Modify: `src/app/undo/use-undo-stack.ts`
- Modify: `src/app/undo/use-undo-stack.test.tsx`

- [ ] **Step 1: Write the failing end-to-end test**

Append to `src/app/undo/use-undo-stack.test.tsx`, inside the existing top-level `describe`. Match
the surrounding tests' setup idiom — read two neighbouring tests before writing this one, and reuse
whatever harness they use to obtain `captureFieldPart` and drive a restore.

```tsx
  it("keeps a concurrently assigned RACI cell when a bulk suggestion is undone", () => {
    // open-followups §178, the reachable case. Suggest RACI writes the whole
    // `raci` map for several stakeholders as one bulk.edit; the user then assigns
    // a cell for a DIFFERENT milestone on one of those rows; Ctrl+Z must revert
    // the suggestion without taking the hand-assigned cell with it.
    type S = { id: number; name: string; raci: Record<string, string> };
    const setter = vi.fn();
    const part = captureFieldPart<S>({
      setter: setter as never,
      edits: [{ id: 1, before: { raci: { m1: "R" } }, after: { raci: { m1: "A" } } }],
    });
    expect(part).not.toBeNull();
    part!.restore();

    const update = setter.mock.calls[0][0] as (prev: readonly S[]) => S[];
    const live: S[] = [{ id: 1, name: "Ada", raci: { m1: "A", m2: "I" } }];
    expect(update(live)).toEqual([{ id: 1, name: "Ada", raci: { m1: "R", m2: "I" } }]);
  });
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/undo/use-undo-stack.test.tsx -t "RACI cell"; echo "EXIT=$?"
```

Expected: `EXIT=1`. The received value is `{ m1: "R" }` — the whole map was replaced and `m2` is
gone. That is the defect.

- [ ] **Step 3: Wire the merge into `captureFieldPart`**

In `src/app/undo/use-undo-stack.ts`, add to the imports:

```ts
import { mergeFieldPatch } from "./merge-field-value";
```

Then replace the body of `captureFieldPart` from `const apply = ...` through the end of `restore`
with:

```ts
  const apply = (
    target: (e: (typeof edits)[number]) => Partial<T>,
    other: (e: (typeof edits)[number]) => Partial<T>,
  ) => {
    setter((prev) =>
      prev.map((row) => {
        const edit = byId.get(row.id);
        if (!edit) return row;
        // Per-key merge, not a wholesale spread: a concurrent writer that changed
        // a different key of a field this op also wrote keeps its change
        // (open-followups §178).
        const merged = mergeFieldPatch(row, target(edit), other(edit));
        return stampField
          ? ({ ...merged, [stampField]: new Date().toISOString() } as T)
          : merged;
      }),
    );
  };
  const restore = (): (() => void) => {
    apply((e) => e.before, (e) => e.after);
    return () => apply((e) => e.after, (e) => e.before);
  };
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run src/app/undo/use-undo-stack.test.tsx -t "RACI cell"; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 5: Check the file-size ratchet before going further**

```bash
node -e "console.log(require('fs').readFileSync('src/app/undo/use-undo-stack.ts','utf8').split('\n').length)"
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/size.log
```

Expected: the count is comfortably under 800 (Task 1 removed a long comment block and this step adds
about six lines), and `EXIT=0`.

- [ ] **Step 6: Run the full unit suite**

```bash
npx vitest run > /tmp/full-t6.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/full-t6.log
```

Expected: `EXIT=0`. If a test fails asserting that an undo replaced a whole object or array, read it
before touching it — a test pinning wholesale replacement is pinning the defect. Rewrite its
docblock to state the new guarantee; do not loosen the assertion to accept either behaviour.

A red run whose output contains `Failed to start forks worker` is machine contention. Re-run with
`--maxWorkers=4` rather than treating it as evidence.

- [ ] **Step 7: Commit**

```bash
git add src/app/undo/use-undo-stack.ts src/app/undo/use-undo-stack.test.tsx
git commit --only src/app/undo/use-undo-stack.ts src/app/undo/use-undo-stack.test.tsx -m "fix: preserve concurrent writes to other keys of a patched field

Closes open-followups 178. captureFieldPart merged a captured patch over the
live row with a wholesale spread, so the unit of preservation was the FIELD
rather than the key inside it. Reachable today on Stakeholder.raci, a
Record keyed by milestone id whose only writer returns a whole new map:
Suggest RACI, assign a cell for a different milestone, Ctrl+Z, and the
hand-assigned cell vanished with the suggestion.

apply now takes BOTH ends of the patch and routes each key through
mergeFieldPatch. Undo is merge(before, after, live); redo is
merge(after, before, live).

The register entry assumed this needed a new patch model and a new restore
runner. It did not — the patch already carried both ends."
```

---

## Task 7: Settle §181 by measurement

**Files:**
- Read only, then EITHER modify `src/app/use-resource-planner.ts`, `src/app/use-change-log.ts`,
  `src/app/use-stakeholders.ts`, `src/app/milestones-panel.tsx` — OR modify nothing.

Four bulk-edit sites omit `stampField: "localModifiedAt"`; tasks passes it. Two texts written in the
same round disagree about which is right, and neither was verified. `stampField` writes a FRESH
timestamp on undo and on redo — it does not restore the row's prior stamp, and is not meant to.

**A no-code-change outcome is a valid result.** Harmonising four registers on an unverified argument
is the failure this entry exists to prevent.

- [ ] **Step 1: Enumerate every read of the field**

```bash
grep -rn "localModifiedAt" src/app --include=*.ts --include=*.tsx | grep -v '\.test\.' \
  | grep -vE "localModifiedAt[[:space:]]*[:=]" > /tmp/lma-reads.txt
wc -l /tmp/lma-reads.txt; cat /tmp/lma-reads.txt
```

- [ ] **Step 2: Classify every line into exactly one bucket**

Write the classification into the register entry as a table. The three buckets:

- **serialization** — the value is only written to or read from a CSV/Markdown/Turso column
- **explicitly ignored** — a consumer names the field in an ignore list
- **behavioural** — a consumer branches on the value in a way a user can observe

Three findings are already in hand and must be confirmed rather than trusted:

```bash
grep -n "localModifiedAt" -B 3 -A 2 src/app/insights/detect.ts
grep -n "IGNORED_FIELDS" -A 2 src/app/version-diff.ts
grep -n "localModifiedAt: undefined" -B 4 src/app/use-jira-sync.ts
```

Expected: `insights/detect.ts` derives RAID staleness from the field, falling back to `raisedDate`
(**behavioural**, and RAID is one of the four omitting registers). `version-diff.ts` lists it in
`IGNORED_FIELDS` (**explicitly ignored**). `use-jira-sync.ts` clears it as a sync marker
(**behavioural**, tasks only).

- [ ] **Step 3: Decide, and record the decision either way**

**If at least one behavioural read is reachable from one of the four registers** — which the
`insights/detect.ts` RAID staleness read appears to be — then the omission is a defect: an undo
leaves the APPLY's stamp on a row whose content moved backwards, so the staleness detector reads a
reverted item as freshly touched. Go to Step 4.

**Otherwise**, stop. Write the classification table into §181, mark it
`**Status:** open — measured <date>, no behavioural read reachable`, change no code, and skip to
Task 8.

- [ ] **Step 4: Write the failing test**

Append to `src/app/use-resource-planner.undo.test.tsx`:

```tsx
  it("stamps localModifiedAt when a bulk RAID edit is undone", () => {
    // open-followups §181. insights/detect.ts derives RAID staleness from
    // localModifiedAt, so an undo that does not re-stamp leaves the APPLY's
    // timestamp on a row whose content moved backwards, and the detector reads a
    // reverted item as freshly touched.
    const before = "2026-01-01T00:00:00.000Z";
    const row = { id: 1, title: "Risk", localModifiedAt: before };
    const stamped = applyBulkRaidUndo([row]);
    expect(stamped[0].localModifiedAt).not.toBe(before);
  });
```

Adapt the harness call to whatever that file already uses to drive a bulk undo — read two
neighbouring tests first. The assertion is what matters: the stamp must move.

- [ ] **Step 5: Run it and confirm it fails**

```bash
npx vitest run src/app/use-resource-planner.undo.test.tsx -t "stamps localModifiedAt"; echo "EXIT=$?"
```

Expected: `EXIT=1` — the stamp is unchanged.

- [ ] **Step 6: Add `stampField` to the four sites**

At each of the four `captureFieldRows` calls, add `stampField: "localModifiedAt",` to the options
object, and **replace** the comment above it that records the open question. Locate them with:

```bash
grep -rnE "captureFieldRows(Ref\.current)?\??\.?\(\{" src/app --include=*.ts --include=*.tsx | grep -v '\.test\.'
grep -rn "No .stampField. here" src/app --include=*.ts --include=*.tsx | grep -v '\.test\.'
```

The replacement comment, at all four:

```ts
    // `stampField` matches the tasks bulk edit: an undo is itself a local
    // modification, and insights/detect.ts derives staleness from this field, so
    // leaving the apply's stamp on a reverted row reads as freshly touched
    // (open-followups §181, measured and closed).
```

- [ ] **Step 7: Run the tests and typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/use-resource-planner.undo.test.tsx src/app/use-change-log.test.ts \
  src/app/use-stakeholders.test.ts src/app/milestones-panel.test.tsx > /tmp/t7.log 2>&1
echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t7.log
```

Expected: both `EXIT=0`. Some of those test files may not exist; drop the ones that do not and note
which.

- [ ] **Step 8: Commit**

```bash
git add -u src/app
git commit --only src/app/use-resource-planner.ts src/app/use-change-log.ts src/app/use-stakeholders.ts \
        src/app/milestones-panel.tsx src/app/use-resource-planner.undo.test.tsx -m "fix: stamp localModifiedAt on the four register bulk undos

Closes open-followups 181, which deliberately declined to pick a side until
somebody established how the field is actually used. Measured: outside
serialization it has two behavioural readers. insights/detect.ts derives RAID
staleness from it, falling back to raisedDate — and RAID is one of the four
registers that omitted the stamp — while use-jira-sync.ts clears it as a sync
marker. version-diff.ts ignores it by name.

So an undo that does not re-stamp leaves the apply's timestamp on a row whose
content moved backwards, and the staleness detector reads a reverted item as
freshly touched. The four now match tasks.

The four source comments recording this as an open question are replaced, not
left standing: a comment describing a question that has since been answered
reads as a live prohibition."
```

---

## Task 8: Register, docs and release

**Files:**
- Modify: `docs/open-followups.md`
- Modify: `CHANGELOG.md`, `src/app/version.ts`

`docs/open-followups.md` and `CHANGELOG.md` are **LF** files. Use `Edit`, not `Write`.

- [ ] **Step 1: Close the entries**

Closing an entry is a FOUR-place edit, and missing one leaves the register self-contradictory:
the `## N.` heading, the entry's `**Status:**` line, its row in the index table, and the table row's
anchor link (the anchor is derived from the heading text, so changing the heading changes it).

For §177: the heading becomes `~~...~~` only for the parts closed. §177 keeps its 177b half, so it
stays **open** — add a paragraph recording that the duplication half is closed and by which commit.

For §178, §179, §180: strike the heading, set `**Status:** **CLOSED** <date> — <what was done>`,
and update the index row's State column to `**CLOSED** <date>`.

For §181: closed if Task 7 reached Step 8, otherwise updated with the measurement table and left
open.

- [ ] **Step 2: Verify the register is internally consistent**

```bash
npm run followups:status:check; echo "EXIT=$?"
grep -c "^## " docs/open-followups.md
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
```

Expected: `EXIT=0`. Exit 1 is drift (a Status line missing or malformed); exit 2 means the gate
could not scan at all, which demands the opposite response — fix the register's structure.

- [ ] **Step 3: Bump the version**

This slice changes behaviour on four registers' undo, so it is not refactor-only and needs a bump.
In `src/app/version.ts` set `APP_VERSION = "0.264.0"`, set `APP_BUILD_DATE` to today, and choose a
new milestone codename (a sci-fi/fantasy author surname not already used in the file's history).
Then propagate rather than hand-editing the five satellite files:

```bash
npm run version:sync
npm run version:check; echo "EXIT=$?"
```

Expected: `EXIT=0`. Exit 1 is drift — re-run `version:sync`. Exit 2 means the gate could not do its
job (a moved file or regex), which is a different problem.

- [ ] **Step 4: Add the CHANGELOG entry**

Add a `0.264.0` section at the top of `CHANGELOG.md`, in the file's existing style. User-facing
bullets only — describe what the user sees, not the register numbers:

- Undoing a bulk RACI suggestion no longer discards a cell you assigned while it was applied.
- Undoing a bulk edit no longer reverts a note or calendar link another part of the app wrote.
- Redoing a deleted register item no longer leaves a duplicate behind when a note was added in between.
- Undoing a bulk status change now restores the completion date with it.

**No `[session link removed]...` URL in `CHANGELOG.md` or in an MR description.**

- [ ] **Step 5: Run the full gate chain**

Run these one at a time, never two vitest processes at once, and never through a pipe:

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src; echo "EXIT=$?"
npm run test:run > /tmp/final-unit.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/final-unit.log
npm run test:coverage > /tmp/final-cov.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/final-cov.log
npm run test:shuffle > /tmp/final-shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/final-shuffle.log
npm run size:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
npm run followups:status:check; echo "EXIT=$?"
npm run version:check; echo "EXIT=$?"
```

All must be `EXIT=0`. `test:coverage` is the one `test:run` does not cover — the two new modules are
coverage-gated and the floors are blocking in CI.

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md CHANGELOG.md src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS
git commit --only docs/open-followups.md CHANGELOG.md src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS -m "docs: close the undo-residue entries and release 0.264.0

Closes open-followups 178, 179, 180 and the duplication half of 177.
181 is settled by measurement rather than argument.

177 stays OPEN for its 177b half — converting the remaining whole-row
capture sites to field patches, a sweep across six subsystems."
```

- [ ] **Step 7: Report, do not push**

Pushing, opening an MR and merging require an explicit instruction. Report the gate results and
stop.

---

## Self-Review

**Spec coverage.** §177a → Task 1. §180 → Task 2. §179 → Tasks 3 and 4 (probe, then fix). §178 →
Tasks 5 and 6 (module, then wiring). §181 → Task 7. Register and release → Task 8. The spec's
"out of scope" list (§177b, deep recursion, the delete-image restore path) has no task, correctly.

**Type consistency.** `mergeFieldValue(target, other, live)` and `mergeFieldPatch(live, target,
other)` keep their argument orders between Tasks 5 and 6 — note they differ deliberately, since the
patch form leads with the row. `rowsEqualExcept(a, b, ignore)` is used only in Task 4.
`buildBulkFieldEdits(rows, groups)` is defined in Task 2 Step 3 and called with two arguments in
every row of Task 2 Step 5's table and in Task 2's tests. `WRITE_THROUGH_FIELDS` (tuple) and
`WRITE_THROUGH_KEYS` (set) keep the names their old call sites already use, so Task 1 changes no use
site.

**Known gap, deliberately left in the plan rather than hidden.** Task 6 Step 1 and Task 7 Step 4
both say to read neighbouring tests and match the file's existing harness idiom, because those two
suites' setup could not be reproduced faithfully from a grep. Every other test in this plan is
complete and runnable as written.

**Ordering constraints, and only these two.** Task 5 must precede Task 6 — the module has to exist
before it is imported. Task 3 must precede Task 4 — the probe decides whether Task 4 is legitimate
at all, and if the reproduction passes, Task 4 must not be written.

Everything else is independent. In particular Task 2 need NOT precede Task 5: Step 6's
group-completion test calls `mergeFieldPatch` directly with a key both ends agree on, so it
exercises the merge's second short-circuit without §180 having landed.
