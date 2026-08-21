# Slice A — Budget↔task linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user assign tasks to a budget bucket from the task side (bulk op + task-modal field), edit a bucket's Manual % without opening the bucket modal, and make every budget-bucket write undoable and activity-logged.

**Architecture:** The link lives on the bucket (`BudgetBucket.taskIds`) — already persisted across all six write paths, so there is **no codec, golden-fixture or migration work**. A new pure module owns the move semantics; a new boundary hook replaces the one-line `handleChangeBudgets` and turns every `onChangeBuckets` call into a captured + logged commit; a small glue hook owns the task editor's bucket selection (immediate apply in edit mode, staged until id-mint in create mode, mirroring the editor's existing RAID/link behaviour).

**Tech Stack:** Next.js 16 · React 19 · TypeScript · vitest + @testing-library/react · Playwright/axe · Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-28-slice-a-budget-task-linking-design.md`

---

## Deviations from the spec (decided while planning — flagged, not silent)

1. **Edit mode applies immediately, not on submit.** The spec said the task-modal field applies on
   submit. The editor's *existing* precedent for non-Task side effects (create-RAID, linked tasks —
   `task-manager.tsx:1333-1377`) is "apply immediately in edit mode, stage in create mode", and
   following it avoids a new `use-task-submit` argument. Consequence, identical to RAID/links today:
   **Cancel does not revert a bucket change made in edit mode** — undo does.
2. **Creates are logged but NOT captured for undo.** `buildBeforeImages`
   (`undo/undo-stack.ts:228`) only builds images for `removed` + `edited` rows that exist in the
   pre-op array; there is no "added" op, and **no entity in the app captures a `*.created`**. Budget
   matches that. "All bucket writes undoable" therefore means all *destructive and mutating* writes.

## File structure

**Create**
| File | Responsibility |
|---|---|
| `src/app/budget-task-link.ts` | pure move/lookup semantics for the task side of the link |
| `src/app/budget-task-link.test.ts` | its tests |
| `src/app/use-commit-draft.ts` | shared draft-then-commit input state (blur/Enter commit, Escape revert) |
| `src/app/use-commit-draft.test.tsx` | its tests |
| `src/app/use-budget-buckets.ts` | the single commit boundary: diff → capture → log → `setBudgets` |
| `src/app/use-budget-buckets.test.tsx` | its tests |
| `src/app/use-task-budget-link.ts` | task-editor glue: pending selection, apply-vs-stage, create flush |
| `src/app/use-task-budget-link.test.tsx` | its tests |

**Modify**
`activity-log.ts` (3 kinds + map) · `undo/use-undo-stack.ts` (`budget` entity key) · `i18n.ts` +
`i18n.de.ts` · `task-manager.tsx` (hook wiring) · `workspace-section-types.ts` (`onChangeBudgets`
signature) · `budget-panel.tsx` (commit meta · HoursCell draft · Manual % cell) · `modal-fields.ts`
(task `budgetBucket`) · `task-form-fields.tsx` (the select) · `task-form-modal.tsx` +
`app-modals.tsx` (prop passthrough) · `task-form-context.tsx` (bulk field) · `bulk-edit-modal.tsx`
(bulk row) · `use-bulk-operations.ts` (bulk apply) · `tasks-section.tsx` (buckets → bulk modal) ·
`version.ts` + `CHANGELOG.md`.

## Line-budget rules (read before writing code)

`scripts/check-file-sizes.mjs` counts `split("\n").length` = **`wc -l` + 1**, and fails when a
baselined file **grows at all**.

| File | script count now | cap |
|---|---|---|
| `task-manager.tsx` | 2974 | **2974 — zero headroom** |
| `tasks-section.tsx` | 1070 | 1073 |
| `workspace-section.tsx` | 961 | 966 |
| `budget-panel.tsx` | 684 | 800 |
| `task-form-fields.tsx` | 722 | 800 |
| `app-modals.tsx` | 302 | 800 |
| `task-form-modal.tsx` | 173 | 800 |

`task-manager.tsx` is paid for inside this plan: Task 4 **deletes** `handleChangeBudgets` (−1) and
**collapses** the 4-line `useTaskEditorBuffer({…})` call to 1 line (−3), against +1 hook call, +1
glue-hook call and +1 `budgetLink` prop. Net **−1**. Do not run
`check-file-sizes.mjs --update` — slice F established that every later slice would cite it.

---

## Task 1: Pure link engine

**Files:**
- Create: `src/app/budget-task-link.ts`
- Test: `src/app/budget-task-link.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/budget-task-link.test.ts
import { describe, expect, it } from "vitest";
import { bucketIdForTask, moveTasksToBucket } from "./budget-task-link";
import type { BudgetBucket } from "./types";

const bucket = (id: number, taskIds: number[]): BudgetBucket =>
  ({ id, name: `B${id}`, taskIds } as unknown as BudgetBucket);

const STAMP = "2026-07-28T10:00:00.000Z";

describe("bucketIdForTask", () => {
  it("finds the linking bucket", () => {
    expect(bucketIdForTask([bucket(1, [5]), bucket(2, [7])], 7)).toBe(2);
  });

  it("is null when no bucket links the task", () => {
    expect(bucketIdForTask([bucket(1, [5])], 7)).toBeNull();
  });

  it("returns the FIRST match when a workspace holds a duplicate link", () => {
    expect(bucketIdForTask([bucket(1, [7]), bucket(2, [7])], 7)).toBe(1);
  });
});

describe("moveTasksToBucket", () => {
  it("adds to the target and removes from the previous bucket", () => {
    const before = [bucket(1, [7, 12]), bucket(2, [3])];
    const after = moveTasksToBucket(before, [7], 2, STAMP);
    expect(after[0].taskIds).toEqual([12]);
    expect(after[1].taskIds).toEqual([3, 7]);
  });

  it("moves several tasks out of several source buckets in one call", () => {
    const before = [bucket(1, [7]), bucket(2, [8]), bucket(3, [])];
    const after = moveTasksToBucket(before, [7, 8], 3, STAMP);
    expect(after[0].taskIds).toEqual([]);
    expect(after[1].taskIds).toEqual([]);
    expect(after[2].taskIds).toEqual([7, 8]);
  });

  it("unlinks without adding anywhere when the target is null", () => {
    const after = moveTasksToBucket([bucket(1, [7]), bucket(2, [])], [7], null, STAMP);
    expect(after[0].taskIds).toEqual([]);
    expect(after[1].taskIds).toEqual([]);
  });

  it("returns the SAME ARRAY REFERENCE when the task is already in the target", () => {
    const before = [bucket(1, [3]), bucket(2, [7])];
    // Reference identity, not deep equality: a fresh copy would satisfy toEqual
    // and prove nothing, and the no-op guard is what stops a spurious undo entry.
    expect(moveTasksToBucket(before, [7], 2, STAMP)).toBe(before);
  });

  it("returns the same reference when unlinking a task that is not linked", () => {
    const before = [bucket(1, [3])];
    expect(moveTasksToBucket(before, [7], null, STAMP)).toBe(before);
  });

  it("is a no-op for an unknown target id and LEAVES the existing link intact", () => {
    const before = [bucket(1, [7])];
    const after = moveTasksToBucket(before, [7], 99, STAMP);
    expect(after).toBe(before);
    expect(after[0].taskIds).toEqual([7]);
  });

  it("keeps untouched buckets at their original object identity and stamp", () => {
    const untouched = { ...bucket(1, [3]), localModifiedAt: "2026-01-01T00:00:00.000Z" } as BudgetBucket;
    const before = [untouched, bucket(2, [])];
    const after = moveTasksToBucket(before, [9], 2, STAMP);
    expect(after[0]).toBe(untouched);
    expect(after[1].localModifiedAt).toBe(STAMP);
  });

  it("dedupes repeated ids in the input", () => {
    const after = moveTasksToBucket([bucket(1, [])], [7, 7], 1, STAMP);
    expect(after[0].taskIds).toEqual([7]);
  });

  it("removes a duplicate link from the other bucket while leaving the target untouched", () => {
    const target = bucket(2, [7]);
    const after = moveTasksToBucket([bucket(1, [7]), target], [7], 2, STAMP);
    expect(after[0].taskIds).toEqual([]);
    expect(after[1]).toBe(target);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/budget-task-link.test.ts`
Expected: FAIL — `Failed to resolve import "./budget-task-link"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/budget-task-link.ts
// Pure, i18n-free, clock-free helpers for the TASK side of the budget↔task link.
// The link itself lives on the BUCKET (`BudgetBucket.taskIds`), so every
// task-side control writes `budgets`, never `tasks`.
import type { BudgetBucket } from "./types";

/**
 * The bucket a task is linked to, or null. The task-side controls keep a task in
 * at most one bucket, but a workspace edited through the bucket modal (or
 * imported) can still hold duplicates — resolve those deterministically by array
 * order rather than throwing or picking arbitrarily.
 */
export function bucketIdForTask(
  buckets: readonly BudgetBucket[],
  taskId: number,
): number | null {
  for (const b of buckets) {
    if ((b.taskIds ?? []).includes(taskId)) return b.id;
  }
  return null;
}

/**
 * Move `taskIds` into `target` (null = unlink only), removing them from every
 * other bucket.
 *
 * ★ Returns the INPUT ARRAY BY REFERENCE when nothing changed. That no-op guard
 * is what stops "save an untouched editor" or "assign to the bucket it is
 * already in" from pushing an undo entry and an autosave write — `commitBuckets`
 * detects a no-op by reference. An unknown `target` id is likewise a no-op: it
 * must never degrade into a silent unlink. Only buckets whose `taskIds` actually
 * changed get a new object identity and a fresh `localModifiedAt`.
 */
export function moveTasksToBucket(
  buckets: readonly BudgetBucket[],
  taskIds: readonly number[],
  target: number | null,
  stamp: string,
): readonly BudgetBucket[] {
  const moving = new Set(taskIds);
  if (moving.size === 0) return buckets;
  if (target !== null && !buckets.some((b) => b.id === target)) return buckets;

  let changed = false;
  const next = buckets.map((b) => {
    const current = b.taskIds ?? [];
    let nextIds: number[];
    if (b.id === target) {
      // Keep the target's own order and append only what is missing, so
      // re-assigning a task that is already here is a true no-op.
      const present = new Set(current);
      const toAdd = [...moving].filter((id) => !present.has(id));
      if (toAdd.length === 0) return b;
      nextIds = [...current, ...toAdd];
    } else {
      nextIds = current.filter((id) => !moving.has(id));
      if (nextIds.length === current.length) return b;
    }
    changed = true;
    return { ...b, taskIds: nextIds, localModifiedAt: stamp };
  });
  return changed ? next : buckets;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/budget-task-link.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Prove the no-op guard is load-bearing (mutation check)**

Temporarily change `return changed ? next : buckets;` to `return next;`.
Run the tests again. Expected: the two reference-identity tests FAIL with
`expected [ … ] to be [ … ] // Object.is equality`. **Read the failure text** — it must be those
tests, not a different assertion. Revert the mutation.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/budget-task-link.ts src/app/budget-task-link.test.ts
git commit -m "feat(budget): add the pure task-to-bucket link engine"
```

---

## Task 2: Register `budget` for activity logging and undo

Two registries must move in lockstep. A missing `ENTITY_KEY_SET` entry makes `entityKeyFromKind`
return `null`, and `buildUndoLabel` then returns its generic "Edited N item(s)" fallback **before it
ever reads `opts.name`** — restore keeps working, so no functional test notices. `calendarEvent`
shipped exactly that way and eight reviews missed it.

**Files:**
- Modify: `src/app/activity-log.ts:12-62` (union), `:164-218` (map)
- Modify: `src/app/undo/use-undo-stack.ts:28-71`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/undo/use-undo-stack.test.tsx` (existing sweep — should need no edit)

- [ ] **Step 1: Add the activity kinds**

In `src/app/activity-log.ts`, add to the `ActivityKind` union after the `role.*` entries:

```ts
  | "budget.created"
  | "budget.updated"
  | "budget.deleted"
```

and to `ACTIVITY_KIND_TO_KEY`, after the `"role.deleted"` line:

```ts
  "budget.created": "activityBudgetCreated",
  "budget.updated": "activityBudgetUpdated",
  "budget.deleted": "activityBudgetDeleted",
```

`activityGroupOf` needs **no** change — `budget.*` correctly falls through to `"general"`.

- [ ] **Step 2: Add the undo entity key**

In `src/app/undo/use-undo-stack.ts`:

```ts
export type UndoEntityKey =
  | "task" | "milestone" | "raid" | "change" | "stakeholder"
  | "resource" | "absence" | "shift" | "role" | "discipline" | "grade"
  | "calendarEvent" | "budget";
```

Add `budget: "undoEntityBudget",` to `ENTITY_SINGULAR`, `budget: "undoEntityBudgets",` to
`ENTITY_PLURAL` (bulk shows a count, so it needs the plural), and `"budget"` to the
`ENTITY_KEY_SET` literal array.

- [ ] **Step 3: Add the EN strings**

In `src/app/i18n.ts`, beside the existing `budgetPercentComplete` block:

```ts
  activityBudgetCreated: "Budget bucket created: {0}",
  activityBudgetUpdated: "Budget bucket updated: {0}",
  activityBudgetDeleted: "Budget bucket deleted: {0}",
  taskBudgetBucket: "Budget bucket",
  budgetBucketNone: "— none —",
```

and beside the existing `undoEntity*` block:

```ts
  undoEntityBudget: "budget bucket",
  undoEntityBudgets: "budget buckets",
```

★ Read the neighbouring `undoEntity*` values first and **match their capitalisation** — they are
interpolated mid-sentence, so casing is not free.

- [ ] **Step 4: Add the DE strings via a node utf8 write**

`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts. Write a throwaway node script under the
scratchpad (not the repo) that reads the file as utf8, inserts the block after the matching anchor
line, and writes it back:

```js
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  budgetPercentCompleteHint:";
const line = s.split("\r\n").find((l) => l.startsWith(anchor));
if (!line) throw new Error("anchor not found");
const add = [
  '  activityBudgetCreated: "Budgetposition erstellt: {0}",',
  '  activityBudgetUpdated: "Budgetposition aktualisiert: {0}",',
  '  activityBudgetDeleted: "Budgetposition gelöscht: {0}",',
  '  taskBudgetBucket: "Budgetposition",',
  '  budgetBucketNone: "— keine —",',
  '  undoEntityBudget: "Budgetposition",',
  '  undoEntityBudgets: "Budgetpositionen",',
].join("\r\n");
s = s.replace(line, line + "\r\n" + add);
fs.writeFileSync(p, s, "utf8");
```

Then grep-verify the umlaut survived:

Run: `grep -n "gelöscht: {0}" src/app/i18n.de.ts`
Expected: one hit, with a real `ö` (not `oe`, not a replacement char).

- [ ] **Step 5: Verify the lockstep sweep covers `budget`**

Run: `npx vitest run src/app/undo/use-undo-stack.test.tsx`
Expected: PASS. Then **delete** `"budget"` from `ENTITY_KEY_SET` and re-run.
Expected: FAIL, naming the `budget.*` kinds as resolving to the generic label. Restore the entry.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/activity-log.ts src/app/undo/use-undo-stack.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(budget): register budget activity kinds and the undo entity key"
```

---

## Task 3: The commit boundary hook

**Files:**
- Create: `src/app/use-budget-buckets.ts`
- Test: `src/app/use-budget-buckets.test.tsx`

★ Two traps encoded below. (1) `capture`'s `edited` array must hold the **previous** version of each
edited row — `buildBeforeImages` uses those objects verbatim as the restore images, so passing the
*next* rows makes undo a silent no-op. (2) Created rows must **not** go into `edited`: there is no
before-image for them, and `buildBeforeImages`' `Math.max(0, findIndex(...))` would restore a
phantom row at index 0.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/app/use-budget-buckets.test.tsx
import { describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBudgetBuckets } from "./use-budget-buckets";
import type { BudgetBucket } from "./types";

const bucket = (id: number, name = `B${id}`): BudgetBucket =>
  ({ id, name, taskIds: [] } as unknown as BudgetBucket);

function setup(budgets: readonly BudgetBucket[]) {
  const setBudgets = vi.fn();
  const capture = vi.fn();
  const captureComposite = vi.fn();
  const logActivity = vi.fn();
  const { result } = renderHook(() =>
    useBudgetBuckets({ budgets, setBudgets, capture, captureComposite, logActivity }),
  );
  return { result, setBudgets, capture, captureComposite, logActivity };
}

describe("commitBuckets", () => {
  test("an unchanged array writes nothing, captures nothing and logs nothing", () => {
    const before = [bucket(1)];
    const s = setup(before);
    s.result.current.commitBuckets([...before]);
    expect(s.setBudgets).not.toHaveBeenCalled();
    expect(s.capture).not.toHaveBeenCalled();
    expect(s.logActivity).not.toHaveBeenCalled();
  });

  test("an edit captures the PREVIOUS row image, not the next one", () => {
    const prev = bucket(1, "Design");
    const s = setup([prev]);
    s.result.current.commitBuckets([{ ...prev, name: "Design phase" }]);
    expect(s.capture).toHaveBeenCalledTimes(1);
    const opts = s.capture.mock.calls[0][0];
    expect(opts.edited).toEqual([prev]);
    expect(opts.entityKey).toBe("budget");
    expect(s.setBudgets).toHaveBeenCalledTimes(1);
  });

  test("a delete captures the removed row and logs budget.deleted", () => {
    const gone = bucket(2, "Build");
    const s = setup([bucket(1), gone]);
    s.result.current.commitBuckets([bucket(1)]);
    expect(s.capture.mock.calls[0][0].removed).toEqual([gone]);
    expect(s.logActivity).toHaveBeenCalledWith("budget.deleted", "Build");
  });

  test("a create logs budget.created and captures NOTHING (no before-image exists)", () => {
    const s = setup([bucket(1)]);
    s.result.current.commitBuckets([bucket(1), bucket(2, "New")], { kind: "budget.created", name: "New" });
    expect(s.capture).not.toHaveBeenCalled();
    expect(s.logActivity).toHaveBeenCalledWith("budget.created", "New");
    expect(s.setBudgets).toHaveBeenCalledTimes(1);
  });

  test("explicit meta.kind wins over the derived kind", () => {
    const prev = bucket(1, "Design");
    const s = setup([prev]);
    s.result.current.commitBuckets([{ ...prev, name: "x" }], { kind: "budget.deleted", name: "Design" });
    expect(s.logActivity).toHaveBeenCalledWith("budget.deleted", "Design");
  });

  test("a tasksPart routes through captureComposite instead of capture", () => {
    const prev = bucket(1, "Design");
    const s = setup([prev]);
    const tasksPart = { isPrimary: false, restore: () => () => {} };
    s.result.current.commitBuckets([{ ...prev, name: "x" }], {
      kind: "bulk.edit", primaryCount: 3, tasksPart,
    });
    expect(s.capture).not.toHaveBeenCalled();
    expect(s.captureComposite).toHaveBeenCalledTimes(1);
    const opts = s.captureComposite.mock.calls[0][0];
    expect(opts.primaryCount).toBe(3);
    expect(opts.parts[0]).toBe(tasksPart);
    expect(opts.parts[1]).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/use-budget-buckets.test.tsx`
Expected: FAIL — `Failed to resolve import "./use-budget-buckets"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/use-budget-buckets.ts
// The SINGLE commit boundary for budget buckets. Every write funnels through
// `commitBuckets`, which diffs prev→next, captures an undo entry, logs the
// activity, and only then calls setBudgets.
//
// ★ Handlers are deliberately NOT memoized: they read the live `budgets` from
// the deps object on every render (the deps-object hook convention).
"use client";
import type { Dispatch, SetStateAction } from "react";
import type { ActivityKind } from "./activity-log";
import type { BudgetBucket } from "./types";
import { capturePart, type CompositeFragment, type UndoStackApi } from "./undo/use-undo-stack";

export interface BucketCommitMeta {
  /** Overrides the kind derived from the diff. */
  kind?: ActivityKind;
  /** Bucket name for the undo label + the activity message. */
  name?: string;
  /** When present the commit becomes one COMPOSITE undo entry spanning both
   *  arrays — used by the tasks bulk edit, which edits tasks and re-links
   *  buckets in a single apply. The caller still owns its own setTasks. */
  tasksPart?: CompositeFragment | null;
  /** User-facing row count for a composite entry's toast. */
  primaryCount?: number;
}

interface Deps {
  budgets: readonly BudgetBucket[];
  setBudgets: Dispatch<SetStateAction<readonly BudgetBucket[]>>;
  capture: UndoStackApi["capture"];
  captureComposite: UndoStackApi["captureComposite"];
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
}

export interface BudgetBucketsApi {
  commitBuckets: (next: readonly BudgetBucket[], meta?: BucketCommitMeta) => void;
}

export function useBudgetBuckets(deps: Deps): BudgetBucketsApi {
  const { budgets, setBudgets, capture, captureComposite, logActivity } = deps;

  function commitBuckets(next: readonly BudgetBucket[], meta?: BucketCommitMeta): void {
    const prev = budgets;
    const prevById = new Map(prev.map((b) => [b.id, b]));
    const nextIds = new Set(next.map((b) => b.id));
    const created = next.filter((b) => !prevById.has(b.id));
    const deleted = prev.filter((b) => !nextIds.has(b.id));
    // Edited = same id, different OBJECT. Every producer preserves the identity
    // of untouched buckets, so reference inequality is both cheap and exact —
    // and it avoids a JSON key-order false positive.
    const editedBefore = next
      .filter((b) => { const p = prevById.get(b.id); return p !== undefined && p !== b; })
      .map((b) => prevById.get(b.id)!);

    if (created.length === 0 && deleted.length === 0 && editedBefore.length === 0) return;

    const kind: ActivityKind = meta?.kind
      ?? (deleted.length > 0
        ? "budget.deleted"
        : created.length > 0
          ? "budget.created"
          : "budget.updated");

    // ★ `edited` carries the PREVIOUS images (they are the restore payload), and
    // created rows are excluded entirely — there is no before-image for a row
    // that did not exist, and no entity in the app captures a create.
    const budgetsPart = capturePart<BudgetBucket>({
      setter: setBudgets,
      removed: deleted,
      edited: editedBefore,
      fromArray: prev,
    });

    if (meta?.tasksPart !== undefined && meta.tasksPart !== null) {
      captureComposite({
        kind,
        primaryCount: meta.primaryCount ?? (deleted.length + editedBefore.length),
        parts: [meta.tasksPart, budgetsPart],
        name: meta.name,
      });
    } else if (budgetsPart !== null) {
      capture<BudgetBucket>({
        setter: setBudgets,
        kind,
        removed: deleted,
        edited: editedBefore,
        fromArray: prev,
        name: meta?.name,
        entityKey: "budget",
      });
    }

    logActivity(kind, meta?.name ?? created.length + deleted.length + editedBefore.length);
    setBudgets(next);
  }

  return { commitBuckets };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/use-budget-buckets.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Prove the before-image trap is covered (mutation check)**

Change `.map((b) => prevById.get(b.id)!)` to `.map((b) => b)`. Re-run.
Expected: FAIL on **"an edit captures the PREVIOUS row image"** with
`expected [ { name: 'Design phase' … } ] to deeply equal [ { name: 'Design' … } ]`. Revert.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/use-budget-buckets.ts src/app/use-budget-buckets.test.tsx
git commit -m "feat(budget): add the bucket commit boundary with undo capture and logging"
```

---

## Task 4: Wire the boundary into the app

**Files:**
- Modify: `src/app/workspace-section-types.ts:234`
- Modify: `src/app/budget-panel.tsx:179` (prop type) and the 8 commit call sites
- Modify: `src/app/task-manager.tsx:1322-1325` (collapse), `:1875` (delete), `:2277` (rename)

- [ ] **Step 1: Widen the prop signature**

`src/app/workspace-section-types.ts:234`:

```ts
  onChangeBudgets: (next: BudgetBucket[], meta?: BucketCommitMeta) => void;
```

`src/app/budget-panel.tsx:179`:

```ts
  onChangeBuckets: (next: BudgetBucket[], meta?: BucketCommitMeta) => void;
```

Import the type in both: `import type { BucketCommitMeta } from "./use-budget-buckets";`.
`meta` is **optional**, so every existing caller and test compiles unchanged.

- [ ] **Step 2: Pass intent meta at each `budget-panel.tsx` call site**

```ts
  const addBucket = () => {
    const id = nextBucketId(buckets);
    const fresh = blankBucket(id, plan);
    props.onChangeBuckets([...buckets, fresh], { kind: "budget.created", name: fresh.name });
    setEditingBucketId(id);
  };

  const updateBucket = (id: number, patch: Partial<BudgetBucket>) => {
    const name = buckets.find((b) => b.id === id)?.name;
    props.onChangeBuckets(
      buckets.map((b) => (b.id === id ? { ...b, ...patch, localModifiedAt: stamp() } : b)),
      { kind: "budget.updated", name },
    );
  };
```

`removeBucket` → `{ kind: "budget.deleted", name: buckets.find((b) => b.id === id)?.name }`.
`setCell`, `setDisciplineCell`, `applyBucketOrder`, and the modal save at `:674` → each
`{ kind: "budget.updated", name: <that bucket's name> }` (for `applyBucketOrder`, omit `name` — it
spans buckets).

- [ ] **Step 3: Rewire `task-manager.tsx` (and pay for the whole slice's lines here)**

`task-manager.tsx` has **zero** ratchet headroom, and Tasks 9 + 10 will add 4 lines to it. Reclaim
them now, at the exact site being modified. Replace `:1322-1331` — the 4-line buffer call **and** its
6-line destructure — with three lines:

```tsx
  const { commitBuckets } = useBudgetBuckets({ budgets, setBudgets, capture: undoApi.capture, captureComposite: undoApi.captureComposite, logActivity });
  const editorBuffer = useTaskEditorBuffer({ applyRaid: applyRaidFromTask, applyLink: applyLinkFromTask });
  const { flush: flushEditorBuffer, discard: discardEditorBuffer, stageRaid: stageEditorRaid, stageLink: stageEditorLink } = editorBuffer;
```

Add the import beside the other local hook imports:
`import { useBudgetBuckets } from "./use-budget-buckets";`

Delete line `:1875` (`const handleChangeBudgets = …`) and change `:2277` to
`onChangeBudgets: commitBuckets,`.

Running line arithmetic for the slice (script count = `wc -l` + 1, cap **2974**, now 2974):

| Change | Δ |
|---|---|
| collapse the buffer call + destructure (10 lines → 3) | −7 |
| delete `handleChangeBudgets` | −1 |
| `useBudgetBuckets` import | +1 |
| Task 9: `useTaskBudgetLink` call + import + `budgetLink` prop | +3 |
| Task 10: `commitBuckets` arg on `useBulkOperations` | +1 |
| **net** | **−3 → 2971** |

- [ ] **Step 4: Verify the line budget**

Run: `node scripts/check-file-sizes.mjs`
Expected: exit 0, and `task-manager.tsx` at ~2971. If it reports a violation, do **not** run
`--update` — reclaim by collapsing another multi-line call at a site this slice already touches.

- [ ] **Step 5: Run the affected suites**

Run: `npx vitest run src/app/budget-panel.test.tsx src/app/budget-panel-edit.test.tsx src/app/task-manager.characterization.test.tsx`
Expected: PASS — the prop widening is additive, so no test should need editing. If a test fails on
an argument-count assertion, update that assertion (the second argument is new and intended).

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/workspace-section-types.ts src/app/budget-panel.tsx src/app/task-manager.tsx
git commit -m "feat(budget): route every bucket write through the commit boundary"
```

---

## Task 5: Shared draft-then-commit input state

Both the hour cells (Task 6) and the Manual % cell (Task 7) need identical draft/blur/Enter/Escape
behaviour. `dup:check` is blocking, so extract it once, first.

**Files:**
- Create: `src/app/use-commit-draft.ts`
- Test: `src/app/use-commit-draft.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/app/use-commit-draft.test.tsx
import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCommitDraft } from "./use-commit-draft";

function Harness({ committed, commit }: { committed: string; commit: (raw: string) => void }) {
  const d = useCommitDraft(committed, commit);
  return (
    <input
      aria-label="field"
      value={d.value}
      onChange={(e) => d.onChange(e.target.value)}
      onFocus={d.onFocus}
      onBlur={d.onBlur}
      onKeyDown={d.onKeyDown}
    />
  );
}

describe("useCommitDraft", () => {
  test("typing several characters commits ONCE, on blur", async () => {
    const commit = vi.fn();
    const user = userEvent.setup();
    render(<><Harness committed="0" commit={commit} /><button>away</button></>);
    await user.clear(screen.getByLabelText("field"));
    await user.type(screen.getByLabelText("field"), "40");
    expect(commit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "away" }));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("40");
  });

  test("Enter commits and the following blur does not commit again", async () => {
    const commit = vi.fn();
    const user = userEvent.setup();
    render(<><Harness committed="0" commit={commit} /><button>away</button></>);
    await user.clear(screen.getByLabelText("field"));
    await user.type(screen.getByLabelText("field"), "7{Enter}");
    expect(commit).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "away" }));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  test("Escape reverts to the committed value and commits nothing", async () => {
    const commit = vi.fn();
    const user = userEvent.setup();
    render(<Harness committed="12" commit={commit} />);
    await user.clear(screen.getByLabelText("field"));
    await user.type(screen.getByLabelText("field"), "99{Escape}");
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("field")).toHaveValue("12");
  });

  test("an unchanged value commits nothing on blur", async () => {
    const commit = vi.fn();
    const user = userEvent.setup();
    render(<><Harness committed="5" commit={commit} /><button>away</button></>);
    await user.click(screen.getByLabelText("field"));
    await user.click(screen.getByRole("button", { name: "away" }));
    expect(commit).not.toHaveBeenCalled();
  });

  test("the committed value flows back in after a commit (undo/redo visibility)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness committed="1" commit={() => {}} />);
    await user.clear(screen.getByLabelText("field"));
    await user.type(screen.getByLabelText("field"), "2");
    await user.tab();
    rerender(<Harness committed="9" commit={() => {}} />);
    expect(screen.getByLabelText("field")).toHaveValue("9");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/use-commit-draft.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/app/use-commit-draft.ts
// Draft-then-commit state for a text/number input that writes into workspace
// state. Without it, an `onChange`-committing cell writes once per KEYSTROKE —
// which, now that budget writes are captured and logged, would mean one undo
// entry and one activity row per typed character.
"use client";
import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";

export interface CommitDraft {
  /** The live draft while editing, else the committed value — so an undo/redo
   *  that changes the underlying value is reflected immediately. */
  value: string;
  onChange: (next: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}

export function useCommitDraft(committed: string, commit: (raw: string) => void): CommitDraft {
  const [draft, setDraft] = useState<string | null>(null);
  // Guards a blur that follows an Enter (or an Escape) from committing twice.
  const doneRef = useRef(false);

  const doCommit = (raw: string | null) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setDraft(null);
    if (raw !== null && raw !== committed) commit(raw);
  };

  return {
    value: draft ?? committed,
    onChange: (next) => { doneRef.current = false; setDraft(next); },
    onFocus: () => { doneRef.current = false; },
    onBlur: () => doCommit(draft),
    onKeyDown: (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doCommit(draft);
      } else if (e.key === "Escape") {
        doneRef.current = true; // the blur that follows must not commit
        setDraft(null);
        e.currentTarget.blur();
      }
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/app/use-commit-draft.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add src/app/use-commit-draft.ts src/app/use-commit-draft.test.tsx
git commit -m "feat(ui): add shared draft-then-commit input state"
```

---

## Task 6: Give the hour cells a commit boundary

**Files:**
- Modify: `src/app/budget-panel.tsx:70-130` (`HoursCell`)
- Test: `src/app/budget-panel-edit.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/budget-panel-edit.test.tsx`, reusing the file's existing `Harness` +
`wrapper` (cell labels are `budget-<bucketId>-<roleId>-<periodKey>` /
`actual-<bucketId>-<roleId>-<periodKey>`):

```tsx
  test("typing two digits into an hours cell commits ONCE, on blur", async () => {
    const spy = vi.fn();
    const user = userEvent.setup();
    const initial: BudgetBucket[] = [{
      id: 1, name: "PAM", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } }],
    }];
    render(<Harness initial={initial} onChangeSpy={spy} />, { wrapper });
    const cell = screen.getByLabelText("actual-1-3-2026-01");
    await user.clear(cell);
    await user.type(cell, "40");
    expect(spy).not.toHaveBeenCalled();
    await user.tab();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0][0] as BudgetBucket[])[0].allocations[0].actualHours["2026-01"]).toBe(40);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/budget-panel-edit.test.tsx -t "commits ONCE"`
Expected: FAIL with `expected "spy" to not be called at all, but it was called N times` — the
per-keystroke commit this task removes. **Read the message**: if it fails for any other reason, the
fixture is wrong, not the implementation.

- [ ] **Step 3: Rewrite `HoursCell`'s two inputs**

Inside `HoursCell`, above the `return`:

```tsx
  const budgetDraft = useCommitDraft(displayHours(budget, readOnly), (raw) => onBudget(Number(raw) || 0));
  const actualDraft = useCommitDraft(actual === undefined ? "" : String(actual), (raw) => onActual(Number(raw) || 0));
```

Then the budget input becomes (the readonly branch keeps **no** handlers — it mirrors plan hours and
must stay uncommitted):

```tsx
        <input
          aria-label={`budget-${ariaPrefix}`}
          type="number"
          value={readOnly ? displayHours(budget, readOnly) : budgetDraft.value}
          readOnly={readOnly}
          onChange={readOnly ? undefined : (e) => budgetDraft.onChange(e.target.value)}
          onFocus={readOnly ? undefined : budgetDraft.onFocus}
          onBlur={readOnly ? undefined : budgetDraft.onBlur}
          onKeyDown={readOnly ? undefined : budgetDraft.onKeyDown}
          className={`w-16 rounded border border-line ${readOnly ? "bg-surface-muted text-muted-foreground" : "bg-surface"} px-1 py-0.5 text-right tabular-nums ${FOCUS_RING} ${TRANSITION}`}
        />
```

and the actual input:

```tsx
        <input
          aria-label={`actual-${ariaPrefix}`}
          type="number"
          value={actualDraft.value}
          onChange={(e) => actualDraft.onChange(e.target.value)}
          onFocus={actualDraft.onFocus}
          onBlur={actualDraft.onBlur}
          onKeyDown={actualDraft.onKeyDown}
          className={`w-16 rounded border border-line bg-surface-muted px-1 py-0.5 text-right tabular-nums ${FOCUS_RING} ${TRANSITION}`}
        />
```

Add `import { useCommitDraft } from "./use-commit-draft";`. Both hooks are called
**unconditionally** — only the handler wiring is conditional.

- [ ] **Step 4: Update the one existing test this deliberately breaks**

`budget-panel-edit.test.tsx:80` ("editing an actual-hours cell emits the updated bucket") does
`fireEvent.change(cell, …)` and asserts an immediate emit. Add a blur between the change and the
assertion:

```tsx
    fireEvent.change(cell, { target: { value: "90" } });
    fireEvent.blur(cell);
    const last = spy.mock.calls.at(-1)![0] as BudgetBucket[];
```

That is the intended behaviour change, not a regression to work around.

- [ ] **Step 5: Run the suites**

Run: `npx vitest run src/app/budget-panel-edit.test.tsx src/app/budget-panel.test.tsx`
Expected: PASS. Any other test asserting an emit straight after a cell `change` needs the same
one-line blur.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
npm run lint
git add src/app/budget-panel.tsx src/app/budget-panel-edit.test.tsx
git commit -m "feat(budget): commit hour cells on blur instead of per keystroke"
```

---

## Task 7: Manual % inline cell

**Files:**
- Modify: `src/app/budget-panel.tsx` (bucket card header, around `:496-505`)
- Test: `src/app/budget-panel-edit.test.tsx`

- [ ] **Step 1: Write the failing tests**

First extend the file's `Harness` so it can pass the panel's OPTIONAL `tasks` prop (one new optional
prop, defaulting to undefined so every existing call site is unchanged):

```tsx
function Harness({ initial, onChangeSpy, tasks }: {
  initial: BudgetBucket[];
  onChangeSpy: (next: BudgetBucket[]) => void;
  tasks?: readonly Task[];
}) {
  // …unchanged body, plus `tasks={tasks}` on <BudgetPanel>
```

Then add the tests:

```tsx
  const twoBuckets: BudgetBucket[] = [
    { id: 1, name: "Design", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open", allocations: [], percentComplete: 65 },
    { id: 2, name: "Build", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open", allocations: [] },
  ];

  test("each bucket's manual % input carries a row-UNIQUE accessible name", () => {
    render(<Harness initial={twoBuckets} onChangeSpy={vi.fn()} />, { wrapper });
    expect(screen.getByLabelText("Manual % complete – Design")).toBeInTheDocument();
    expect(screen.getByLabelText("Manual % complete – Build")).toBeInTheDocument();
  });

  test("clearing the manual % writes undefined, not 0", async () => {
    const spy = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={twoBuckets} onChangeSpy={spy} />, { wrapper });
    await user.clear(screen.getByLabelText("Manual % complete – Design"));
    await user.tab();
    const next = spy.mock.calls.at(-1)![0] as BudgetBucket[];
    // Assert the COMMITTED patch, not the rendered value: 0 and undefined both
    // render as an empty box, so a value assertion here would be vacuous.
    expect(next.find((b) => b.name === "Design")!.percentComplete).toBeUndefined();
  });

  test("an out-of-range manual % is clamped to 100", async () => {
    const spy = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={twoBuckets} onChangeSpy={spy} />, { wrapper });
    const cell = screen.getByLabelText("Manual % complete – Build");
    await user.clear(cell);
    await user.type(cell, "180");
    await user.tab();
    const next = spy.mock.calls.at(-1)![0] as BudgetBucket[];
    expect(next.find((b) => b.name === "Build")!.percentComplete).toBe(100);
  });

  test("with no manual value the placeholder shows the task-derived percentage", () => {
    const linked: BudgetBucket[] = [{ ...twoBuckets[1], taskIds: [1, 2] }];
    const tasks = [
      { id: 1, status: "Done" },
      { id: 2, status: "To Do" },
    ] as unknown as Task[];
    render(<Harness initial={linked} onChangeSpy={vi.fn()} tasks={tasks} />, { wrapper });
    expect(screen.getByLabelText("Manual % complete – Build")).toHaveAttribute("placeholder", "50");
  });

  test("with no tasks prop the placeholder is the em dash, never a derived 0", () => {
    const linked: BudgetBucket[] = [{ ...twoBuckets[1], taskIds: [1, 2] }];
    render(<Harness initial={linked} onChangeSpy={vi.fn()} />, { wrapper });
    expect(screen.getByLabelText("Manual % complete – Build")).toHaveAttribute("placeholder", "—");
  });
```

★ The en-dash in `"Manual % complete – Design"` must match the separator the component emits — copy
it from the implementation, do not retype it as a hyphen.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/budget-panel-edit.test.tsx -t "manual %"`
Expected: FAIL — `Unable to find a label with the text of: Manual % complete – Design`.

- [ ] **Step 3: Implement the cell**

In `budget-panel.tsx`, inside the bucket card header block (the `<div>` holding the
`{t(lang, br.type === …)} · {bucket.currency}` line), add after that line:

```tsx
                <ManualPercentCell
                  lang={lang}
                  bucket={bucket}
                  tasks={props.tasks}
                  onCommit={(pct) => updateBucket(bucket.id, { percentComplete: pct })}
                />
```

and add the component beside `HoursCell`:

```tsx
/** The bucket's Manual % complete, editable without opening the bucket modal.
 *  The placeholder shows the task-derived percentage so the override
 *  relationship is visible in place. */
function ManualPercentCell({
  lang, bucket, tasks, onCommit,
}: {
  lang: Lang;
  bucket: BudgetBucket;
  /** OPTIONAL on the panel — a caller that omits it gets no derived hint, never
   *  a misleading 0 %. */
  tasks: readonly Task[] | undefined;
  onCommit: (pct: number | undefined) => void;
}) {
  const derived = bucket.percentComplete === undefined && tasks
    ? bucketPercentComplete({ taskIds: bucket.taskIds, percentComplete: undefined }, tasks)
    : null;
  const draft = useCommitDraft(
    bucket.percentComplete === undefined ? "" : String(bucket.percentComplete),
    (raw) => onCommit(describeClamp(raw, { min: 0, max: 100, round: 2 }).value),
  );
  const label = `${t(lang, "budgetPercentComplete")} – ${bucket.name}`;
  return (
    <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
      {t(lang, "budgetPercentComplete")}
      <InfoTooltip text={t(lang, "budgetPercentCompleteHint")} />
      <input
        aria-label={label}
        type="number"
        min={0}
        max={100}
        step="1"
        placeholder={derived === null ? "—" : String(Math.round(derived))}
        value={draft.value}
        onChange={(e) => draft.onChange(e.target.value)}
        onFocus={draft.onFocus}
        onBlur={draft.onBlur}
        onKeyDown={draft.onKeyDown}
        className={`w-16 rounded border border-line bg-surface px-1 py-0.5 text-right tabular-nums ${FOCUS_RING} ${TRANSITION}`}
      />
      <span aria-hidden="true">%</span>
    </span>
  );
}
```

Add imports: `bucketPercentComplete` from `./budget-earned-value`, `describeClamp` from
`./sanitize-report`, `type Task` from `./types` (check which are already imported first).

★ `describeClamp("")` returns `{ value: undefined }`, which is exactly the clear-to-undefined
semantics required — do **not** coerce it to 0.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/app/budget-panel-edit.test.tsx`
Expected: PASS.

- [ ] **Step 5: Prove the clear-to-undefined test is not vacuous**

Change the commit to `onCommit(describeClamp(raw, …).value ?? 0)`. Re-run.
Expected: FAIL on **"clearing the manual % writes undefined, not 0"** with
`expected 0 to be undefined`. Revert.

- [ ] **Step 6: Duplication + size gates, then commit**

```bash
npm run dup:check
node scripts/check-file-sizes.mjs
npx tsc --noEmit && npm run lint
git add src/app/budget-panel.tsx src/app/budget-panel-edit.test.tsx
git commit -m "feat(budget): edit a bucket's manual % complete inline"
```

---

## Task 8: Task-editor glue hook

**Files:**
- Create: `src/app/use-task-budget-link.ts`
- Test: `src/app/use-task-budget-link.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/app/use-task-budget-link.test.tsx
import { describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTaskBudgetLink } from "./use-task-budget-link";
import type { BudgetBucket } from "./types";

const bucket = (id: number, taskIds: number[] = []): BudgetBucket =>
  ({ id, name: `B${id}`, taskIds } as unknown as BudgetBucket);

function setup(editingId: number | null, buckets = [bucket(1, [7]), bucket(2)]) {
  const commitBuckets = vi.fn();
  const flushEditorBuffer = vi.fn();
  const discardEditorBuffer = vi.fn();
  const { result, rerender } = renderHook(
    (props: { editingId: number | null }) =>
      useTaskBudgetLink({
        enabled: true,
        budgets: buckets,
        editingId: props.editingId,
        commitBuckets,
        flushEditorBuffer,
        discardEditorBuffer,
      }),
    { initialProps: { editingId } },
  );
  return { result, rerender, commitBuckets, flushEditorBuffer, discardEditorBuffer };
}

describe("useTaskBudgetLink", () => {
  test("shows the task's current bucket in edit mode", () => {
    expect(setup(7).result.current.budgetLink!.bucketId).toBe(1);
  });

  test("edit mode applies immediately", () => {
    const s = setup(7);
    act(() => s.result.current.budgetLink!.onChange(2));
    expect(s.commitBuckets).toHaveBeenCalledTimes(1);
    const [next] = s.commitBuckets.mock.calls[0];
    expect(next.find((b: BudgetBucket) => b.id === 2)!.taskIds).toEqual([7]);
    expect(next.find((b: BudgetBucket) => b.id === 1)!.taskIds).toEqual([]);
  });

  test("create mode stages instead of committing, then applies on the minted id", () => {
    const s = setup(null);
    act(() => s.result.current.budgetLink!.onChange(2));
    expect(s.commitBuckets).not.toHaveBeenCalled();
    expect(s.result.current.budgetLink!.bucketId).toBe(2);
    act(() => s.result.current.onTaskCreated(42));
    expect(s.flushEditorBuffer).toHaveBeenCalledWith(42);
    const [next] = s.commitBuckets.mock.calls[0];
    expect(next.find((b: BudgetBucket) => b.id === 2)!.taskIds).toEqual([42]);
  });

  test("a create with no bucket chosen commits nothing", () => {
    const s = setup(null);
    act(() => s.result.current.onTaskCreated(42));
    expect(s.flushEditorBuffer).toHaveBeenCalledWith(42);
    expect(s.commitBuckets).not.toHaveBeenCalled();
  });

  test("discard drops the staged selection and forwards to the buffer", () => {
    const s = setup(null);
    act(() => s.result.current.budgetLink!.onChange(2));
    act(() => s.result.current.onEditorDiscard());
    expect(s.discardEditorBuffer).toHaveBeenCalledTimes(1);
    expect(s.result.current.budgetLink!.bucketId).toBeNull();
  });

  test("budgetLink is undefined when the budget module is off", () => {
    const { result } = renderHook(() =>
      useTaskBudgetLink({
        enabled: false, budgets: [bucket(1)], editingId: 7,
        commitBuckets: vi.fn(), flushEditorBuffer: vi.fn(), discardEditorBuffer: vi.fn(),
      }),
    );
    expect(result.current.budgetLink).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/use-task-budget-link.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/app/use-task-budget-link.ts
// Task-editor glue for the budget-bucket field. Mirrors the editor's existing
// non-Task side effects (create-RAID, linked tasks): EDIT mode applies
// immediately, CREATE mode stages until the new task id is minted.
"use client";
import { useCallback, useRef, useState } from "react";
import { bucketIdForTask, moveTasksToBucket } from "./budget-task-link";
import type { BucketCommitMeta } from "./use-budget-buckets";
import type { BudgetBucket } from "./types";

export interface TaskBudgetLink {
  buckets: readonly BudgetBucket[];
  bucketId: number | null;
  onChange: (bucketId: number | null) => void;
}

interface Deps {
  /** Budget module enabled — off ⇒ no field at all. */
  enabled: boolean;
  budgets: readonly BudgetBucket[];
  editingId: number | null;
  commitBuckets: (next: readonly BudgetBucket[], meta?: BucketCommitMeta) => void;
  flushEditorBuffer: (parentId: number) => void;
  discardEditorBuffer: () => void;
}

export function useTaskBudgetLink(deps: Deps): {
  budgetLink: TaskBudgetLink | undefined;
  onTaskCreated: (newId: number) => void;
  onEditorDiscard: () => void;
} {
  const { enabled, budgets, editingId, commitBuckets, flushEditorBuffer, discardEditorBuffer } = deps;
  // `undefined` = untouched this session; null = explicitly "no bucket".
  const [pending, setPending] = useState<number | null | undefined>(undefined);
  // The side effects below run outside any state updater (strict mode
  // double-invokes updaters), so read the live value from a ref.
  const pendingRef = useRef<number | null | undefined>(undefined);

  const apply = useCallback((taskId: number, bucketId: number | null) => {
    const next = moveTasksToBucket(budgets, [taskId], bucketId, new Date().toISOString());
    if (next === budgets) return; // no-op: nothing to capture, nothing to log
    commitBuckets(next, { kind: "budget.updated", name: budgets.find((b) => b.id === bucketId)?.name });
  }, [budgets, commitBuckets]);

  const onChange = useCallback((bucketId: number | null) => {
    if (editingId !== null) { apply(editingId, bucketId); return; }
    pendingRef.current = bucketId;
    setPending(bucketId);
  }, [editingId, apply]);

  const onTaskCreated = useCallback((newId: number) => {
    flushEditorBuffer(newId);
    const staged = pendingRef.current;
    pendingRef.current = undefined;
    setPending(undefined);
    if (staged !== undefined) apply(newId, staged);
  }, [flushEditorBuffer, apply]);

  const onEditorDiscard = useCallback(() => {
    discardEditorBuffer();
    pendingRef.current = undefined;
    setPending(undefined);
  }, [discardEditorBuffer]);

  const bucketId = pending !== undefined
    ? pending
    : editingId !== null ? bucketIdForTask(budgets, editingId) : null;

  return {
    budgetLink: enabled ? { buckets, bucketId, onChange } : undefined,
    onTaskCreated,
    onEditorDiscard,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/app/use-task-budget-link.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add src/app/use-task-budget-link.ts src/app/use-task-budget-link.test.tsx
git commit -m "feat(tasks): add the task-editor budget-bucket glue hook"
```

---

## Task 9: The task-modal field

**Files:**
- Modify: `src/app/modal-fields.ts:29-44`
- Modify: `src/app/task-form-fields.tsx` (props + the field)
- Modify: `src/app/task-form-modal.tsx:18-48` + its `<TaskFormFields …>` at `:131`
- Modify: `src/app/app-modals.tsx` (props + the `<TaskFormModal …>` at `:166`)
- Modify: `src/app/task-manager.tsx` (hook call, `onTaskCreated`, `onEditorDiscard`, the prop)
- Test: `src/app/task-form-fields.test.tsx`

- [ ] **Step 1: Write the failing test**

Extend the file's existing `Harness(over)` helper with one more optional override —
`budgetLink?: TaskBudgetLink` — forwarded to `<TaskFormFields budgetLink={over.budgetLink} />`, then:

```tsx
  const BUCKETS = [{ id: 1, name: "Design" }, { id: 2, name: "Build" }] as unknown as BudgetBucket[];

  it("renders the budget-bucket select and reports the chosen id", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness budgetLink={{ buckets: BUCKETS, bucketId: 1, onChange }} />, { wrapper: TestProviders });
    await user.selectOptions(screen.getByLabelText("Budget bucket"), "2");
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("reports null when the none option is chosen", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness budgetLink={{ buckets: BUCKETS, bucketId: 1, onChange }} />, { wrapper: TestProviders });
    await user.selectOptions(screen.getByLabelText("Budget bucket"), "");
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("renders no budget field at all when no budgetLink is supplied", () => {
    render(<Harness />, { wrapper: TestProviders });
    expect(screen.queryByLabelText("Budget bucket")).toBeNull();
  });
```

★ `DEFAULT_TIER` is `"advanced"` (`field-visibility.ts:14`), so registering the field at that tier
makes it visible with no `fieldVisibility` config — which is what these bare renders exercise.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/task-form-fields.test.tsx -t "budget-bucket"`
Expected: FAIL — `Unable to find a label with the text of: Budget bucket`.

- [ ] **Step 3: Register the field for visibility**

`src/app/modal-fields.ts`, in `MODAL_FIELDS.task`, after the `dependencies` entry:

```ts
    { id: "budgetBucket", labelKey: "taskBudgetBucket", tier: "advanced" },
```

- [ ] **Step 4: Add the field to `TaskFormFields`**

Props (optional, so the bare-render tests are untouched):

```ts
  /** Budget-bucket link controls. Absent when the budget module is off — this
   *  component must NOT read the workspace context (its own tests render it
   *  bare, where that would throw). */
  budgetLink?: TaskBudgetLink;
```

Add `budgetLink` to the destructured parameter list and
`import type { TaskBudgetLink } from "./use-task-budget-link";`.

Render it next to the other advanced fields (beside `dependencies`):

```tsx
        {budgetLink && isVisible("budgetBucket") && (
          <Field label={t(lang, "taskBudgetBucket")}>
            <Select
              value={budgetLink.bucketId === null ? "" : String(budgetLink.bucketId)}
              onChange={(e) => budgetLink.onChange(e.target.value === "" ? null : Number(e.target.value))}
              className="w-full"
            >
              <option value="">{t(lang, "budgetBucketNone")}</option>
              {budgetLink.buckets.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
        )}
```

`Field` renders a `<label>` wrapping the control, so the select's accessible name is the label text
— no extra `aria-label` needed.

- [ ] **Step 5: Thread the prop through the two shells**

`task-form-modal.tsx`: add `budgetLink?: TaskBudgetLink;` to `TaskFormModalProps`, destructure it,
and pass `budgetLink={budgetLink}` to `<TaskFormFields>`.
`app-modals.tsx`: add `budgetLink?: TaskBudgetLink;` to `AppModalsProps`, destructure it, and pass
`budgetLink={budgetLink}` to `<TaskFormModal>`.

- [ ] **Step 6: Wire `task-manager.tsx`**

Immediately after the `useTaskEditorBuffer` destructure (`:1326-1331`), add one line:

```tsx
  const { budgetLink, onTaskCreated: onTaskCreatedWithBucket, onEditorDiscard: onEditorDiscardWithBucket } = useTaskBudgetLink({ enabled: isModuleEnabled("budget", settings.features), budgets, editingId, commitBuckets, flushEditorBuffer, discardEditorBuffer });
```

Change the two `useTaskSubmit` arguments (`:1403-1404`) to
`onTaskCreated: onTaskCreatedWithBucket,` and `onEditorDiscard: onEditorDiscardWithBucket,`, and add
`budgetLink={budgetLink}` to the `<AppModals …>` call at `:2690`. Add the import.

- [ ] **Step 7: Run the suites and the size gate**

```bash
npx vitest run src/app/task-form-fields.test.tsx src/app/task-form-modal.test.tsx src/app/app-modals.test.tsx
node scripts/check-file-sizes.mjs
```
Expected: PASS and exit 0 (`task-form-fields.tsx` ≤ 800, `task-manager.tsx` ≤ 2974). If
`task-form-fields.tsx` is over, **extract the field into its own small component file** — do not
raise the cap.

- [ ] **Step 8: Prove the create-mode id is the MINTED one**

Add to `src/app/use-task-budget-link.test.tsx`:

```tsx
  test("create mode links the MINTED id even when the open-time id was taken", () => {
    // Seed bucket 2 already holding id 41 (a row a concurrent writer created);
    // the editor was opened when 41 was free.
    const s = setup(null, [bucket(1), bucket(2, [41])]);
    act(() => s.result.current.budgetLink!.onChange(2));
    act(() => s.result.current.onTaskCreated(42));
    const [next] = s.commitBuckets.mock.calls[0];
    expect(next.find((b: BudgetBucket) => b.id === 2)!.taskIds).toEqual([41, 42]);
  });
```

Run: `npx vitest run src/app/use-task-budget-link.test.tsx`
Expected: PASS.

- [ ] **Step 9: Lint and commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/modal-fields.ts src/app/task-form-fields.tsx src/app/task-form-modal.tsx src/app/app-modals.tsx src/app/task-manager.tsx src/app/task-form-fields.test.tsx src/app/use-task-budget-link.test.tsx
git commit -m "feat(tasks): add a budget-bucket field to the task editor"
```

---

## Task 10: The bulk op

**Files:**
- Modify: `src/app/task-form-context.tsx:52-89`
- Modify: `src/app/bulk-edit-modal.tsx` (props + one row)
- Modify: `src/app/use-bulk-operations.ts:157-234`
- Modify: `src/app/tasks-section.tsx:877` (pass buckets)
- Test: `src/app/use-bulk-operations.test.tsx`, `src/app/bulk-edit-modal.test.tsx`

- [ ] **Step 1: Write the failing tests**

The file already has `makeArgs`/`renderBulk` over a `FiltersProvider > WorkspaceProvider >
TaskFormProvider` wrapper, and seeds state through `result.current.workspace.*`. Add
`commitBuckets: vi.fn(),` to `makeArgs`, then:

```tsx
// src/app/use-bulk-operations.test.tsx — new cases
  function seedBucketFixture(commitBuckets = vi.fn()) {
    const r = renderBulk({ commitBuckets });
    act(() => {
      r.result.current.workspace.setTasks([
        { id: 1, taskName: "a", status: "To Do" },
        { id: 2, taskName: "b", status: "To Do" },
        { id: 3, taskName: "c", status: "To Do" },
      ] as unknown as Task[]);
      r.result.current.workspace.setBudgets([
        { id: 1, name: "Design", taskIds: [1, 2] },
        { id: 2, name: "Build", taskIds: [] },
      ] as unknown as BudgetBucket[]);
    });
    act(() => { [1, 2, 3].forEach((id) => r.result.current.bulk.onToggleSelect(id)); });
    return { ...r, commitBuckets };
  }

  function enableBucket(r: ReturnType<typeof seedBucketFixture>, value: string) {
    act(() => {
      r.result.current.taskForm.setBulkEdit((b) => ({
        ...b, budgetBucket: value, enabled: { ...b.enabled, budgetBucket: true },
      }));
    });
  }

  it("bulk-links every selected task to the chosen bucket in ONE commit", () => {
    const r = seedBucketFixture();
    enableBucket(r, "2");
    act(() => { r.result.current.bulk.applyBulkEdit(); });
    expect(r.commitBuckets).toHaveBeenCalledTimes(1);
    const next = r.commitBuckets.mock.calls[0][0] as BudgetBucket[];
    expect(next.find((b) => b.id === 2)!.taskIds).toEqual([1, 2, 3]);
    expect(next.find((b) => b.id === 1)!.taskIds).toEqual([]);
  });

  it("a bucket-only apply leaves the tasks array untouched", () => {
    const r = seedBucketFixture();
    const before = r.result.current.workspace.tasks;
    enableBucket(r, "2");
    act(() => { r.result.current.bulk.applyBulkEdit(); });
    // A no-op task write would bump every selected row's localModifiedAt, which
    // a Jira pull would then revert.
    expect(r.result.current.workspace.tasks).toBe(before);
  });

  it("the none option unlinks the selected tasks", () => {
    const r = seedBucketFixture();
    enableBucket(r, "");
    act(() => { r.result.current.bulk.applyBulkEdit(); });
    const next = r.commitBuckets.mock.calls[0][0] as BudgetBucket[];
    expect(next.find((b) => b.id === 1)!.taskIds).toEqual([]);
  });

  it("a task field plus a bucket change produce ONE composite entry", () => {
    const r = seedBucketFixture();
    act(() => {
      r.result.current.taskForm.setBulkEdit((b) => ({
        ...b, priority: "High", enabled: { ...b.enabled, priority: true },
      }));
    });
    enableBucket(r, "2");
    act(() => { r.result.current.bulk.applyBulkEdit(); });
    expect(r.args.capture).not.toHaveBeenCalled();   // NOT a separate task entry
    const meta = r.commitBuckets.mock.calls[0][1];
    expect(meta.kind).toBe("bulk.edit");
    expect(meta.tasksPart).not.toBeNull();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/use-bulk-operations.test.tsx -t "bucket"`
Expected: FAIL — the `budgetBucket` field does not exist on the draft.

- [ ] **Step 3: Register the bulk field**

`task-form-context.tsx`: add `| "budgetBucket"` to `BulkEditField`, `budgetBucket: false` to
`emptyBulkEdit().enabled`, and `budgetBucket: "" as string` to the draft (empty string = the
`— none —` unlink option; the select's non-empty values are stringified bucket ids).

- [ ] **Step 4: Add the modal row**

`bulk-edit-modal.tsx`: add `budgetBuckets: readonly BudgetBucket[];` to `BulkEditModalProps`,
destructure it, and add after the labels row:

```tsx
        {budgetBuckets.length > 0 && (
          <BulkEditFieldRow
            id="bulk-budget-bucket"
            label={t(lang, "taskBudgetBucket")}
            enabled={bulkEdit.enabled.budgetBucket}
            onToggle={() =>
              setBulkEdit((b) => ({
                ...b,
                enabled: { ...b.enabled, budgetBucket: !b.enabled.budgetBucket },
              }))
            }
          >
            <select
              value={bulkEdit.budgetBucket}
              onChange={(e) => setBulkEdit((b) => ({ ...b, budgetBucket: e.target.value }))}
              disabled={!bulkEdit.enabled.budgetBucket}
              className={`${inputClass} disabled:opacity-50`}
            >
              <option value="">{t(lang, "budgetBucketNone")}</option>
              {budgetBuckets.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </BulkEditFieldRow>
        )}
```

`BulkEditFieldRow` clones a native child to give it the row label as its `aria-label`, so the select
is named without further work.

`tasks-section.tsx:877`: pass `budgetBuckets={budgets}` (it already destructures the workspace
context; add `budgets` to that destructure if absent).

- [ ] **Step 5: Apply the bucket change in `applyBulkEdit`**

In `use-bulk-operations.ts`:

- add `budgets` to the existing `useWorkspace()` destructure at `:57`;
- add to `UseBulkOperationsArgs` (beside `capture`):
  `commitBuckets: (next: readonly BudgetBucket[], meta?: BucketCommitMeta) => void;`
  and destructure it as `const { commitBuckets } = args;`
  (task-manager passes `commitBuckets,` in its `useBulkOperations({…})` call at `:1548` — that is
  the +1 line accounted for in Task 4's arithmetic);
- import `moveTasksToBucket` from `./budget-task-link`, `capturePart` from
  `./undo/use-undo-stack`, and the `BucketCommitMeta` type from `./use-budget-buckets`.

Then inside `applyBulkEdit`, after `const beforeRows = …`:

```ts
    // Bucket links live on the BUCKET, so this writes `budgets`. A task-field
    // patch and a bucket change in the same apply must be ONE undo entry.
    const bucketEnabled = fields.budgetBucket;
    const targetBucketId = bulkEdit.budgetBucket === "" ? null : Number(bulkEdit.budgetBucket);
    const nextBuckets = bucketEnabled
      ? moveTasksToBucket(budgets, [...selectedIds], targetBucketId, stamp)
      : budgets;
    const bucketsChanged = nextBuckets !== budgets;
    // A managed-fields-only edit already writes nothing to tasks; a BUCKET-only
    // edit must behave the same way, or every selected row gets a spurious
    // localModifiedAt that a Jira pull would revert.
    const taskFieldsEnabled = statusEnabled || Object.keys(updates).length > 0;
```

Then gate the existing capture + `setTasks` on `taskFieldsEnabled`:

```ts
    const tasksPart = taskFieldsEnabled && beforeRows.length > 0
      ? capturePart<Task>({ setter: setTasks, edited: beforeRows, fromArray: tasks })
      : null;
    if (tasksPart !== null && !bucketsChanged) {
      captureRef.current({ setter: setTasks, kind: "bulk.edit", edited: beforeRows, fromArray: tasks, entityKey: "task" });
    }
    if (taskFieldsEnabled) {
      setTasks((prev) => /* …the existing updater, unchanged… */);
    }
    if (bucketsChanged) {
      commitBuckets(nextBuckets, { kind: "bulk.edit", primaryCount: count, tasksPart });
    }
```

Add `budgetBucket` to the `useCallback` dependency list via the existing `bulkEdit` dep (it already
covers the whole draft) and add `budgets`/`commitBuckets`.

★ Hoist nothing new into the dep array as `obj.member` — `react-hooks/exhaustive-deps` rejects that
shape and CI lints at `--max-warnings=0`.

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run src/app/use-bulk-operations.test.tsx src/app/bulk-edit-modal.test.tsx`
Expected: PASS.

- [ ] **Step 7: Prove the write direction is covered (mutation check)**

Delete the `if (bucketsChanged) { commitBuckets(…) }` block. Re-run.
Expected: FAIL on **"bulk-links every selected task"** with
`expected "commitBuckets" to be called 1 times, but got 0 times`. Revert. (Slice C shipped a
persistence feature whose write path was never asserted — removing both calls left the whole suite
green.)

- [ ] **Step 8: Lint, size and commit**

```bash
npx tsc --noEmit && npm run lint && node scripts/check-file-sizes.mjs
git add src/app/task-form-context.tsx src/app/bulk-edit-modal.tsx src/app/use-bulk-operations.ts src/app/tasks-section.tsx src/app/task-manager.tsx src/app/use-bulk-operations.test.tsx src/app/bulk-edit-modal.test.tsx
git commit -m "feat(tasks): bulk-assign selected tasks to a budget bucket"
```

---

## Task 11: Full gates

- [ ] **Step 1: Run the whole unit suite with coverage**

```bash
npm run test:coverage
```
Expected: PASS with the floors met (global lines 92 / funcs 91 / branch 80 / stmts 89 plus the
per-engine globs). `budget-task-link.ts`, `use-commit-draft.ts`, `use-budget-buckets.ts` and
`use-task-budget-link.ts` are all directly tested — try them **measured** first. Only if a
new file drags a floor below the line, add it to `vitest.config.ts` `coverage.exclude`, and say so
in the commit message.

- [ ] **Step 2: Lint, typecheck, duplication, size**

```bash
npm run lint && npx tsc --noEmit && npm run dup:check && node scripts/check-file-sizes.mjs
```
Expected: all exit 0. `lint` runs at `--max-warnings=0` — an unused import is fatal.

- [ ] **Step 3: axe on the Budget view**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Budget"
```
Expected: 5/5 (one per colour scheme). The new Manual-% inputs must each have a bucket-qualified
accessible name — axe reports *missing* names, never *duplicate* ones, so a green run is necessary
but not sufficient; confirm the two-bucket unit test from Task 7 is present.

- [ ] **Step 4: axe on Open Points (the bulk modal's view)**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points"
```
Expected: 5/5.

- [ ] **Step 5: Commit any gate fixes**

```bash
git add -A && git commit -m "chore(slice-a): satisfy the quality gates"
```

---

## Task 12: Release chain

- [ ] **Step 1: Pick a free codename**

```bash
grep -c '"' CHANGELOG.md   # sanity: the file exists
grep '"Goss"' CHANGELOG.md # must return NOTHING
```
`Goss` was verified free during slice F. **Grep with the quotes** — a bare grep matches prose.

- [ ] **Step 2: Bump the version**

`src/app/version.ts`: `APP_VERSION` → `0.207.0`, milestone → the chosen codename.

- [ ] **Step 3: Add the CHANGELOG entry**

Follow the format of the 0.206.0 entry exactly (`git show 2a68f061 -- CHANGELOG.md`). Cover: the
task-modal budget-bucket field, the bulk assign/unlink, the inline Manual %, hour cells now
committing on blur, and budget writes becoming undoable + logged.

- [ ] **Step 4: Decide on a highlight key**

```bash
git show 2a68f061 --stat
```
Slices C, D and F shipped with **no** `versionHighlight*` key. This slice adds user-visible controls
*and* changes hour-cell commit behaviour, so it likely warrants one. If added: append the key to
`APP_HIGHLIGHT_KEYS` **and** add EN + DE strings (DE via the node utf8 write, then grep-verify).

- [ ] **Step 5: Full gate re-run and commit**

```bash
npm run lint && npx tsc --noEmit && npm run test:run && npm run build
git add -A && git commit -m "chore(release): 0.207.0 <Codename>"
```

- [ ] **Step 6: Re-archive the slice docs (MANDATORY)**

Build `docs/superpowers/_archive-slice-docs-2026-07-28-slice-a.zip` by merging the previous archive
(`…-slice-f.zip`, 338 entries) with the current working tree — **working tree wins on collision** —
and assert the superset property before trusting it:

```python
import zipfile
old = zipfile.ZipFile("docs/superpowers/_archive-slice-docs-2026-07-28-slice-f.zip")
new = zipfile.ZipFile("docs/superpowers/_archive-slice-docs-2026-07-28-slice-a.zip")
missing = set(old.namelist()) - set(new.namelist())
assert not missing, missing
```

A plain walk-the-tree zip is a strict SUBSET of the old archive and destroys ~300 historical
documents the tree no longer holds.

- [ ] **Step 7: Stop**

Do **not** push, open an MR, or merge. Those happen only on an explicit instruction; "release" is
the trigger for the full push → MR → poll → merge-on-green chain.
