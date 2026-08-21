# Field-level Edit Undo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make field edits undoable — inline cell edits, the task status dropdown, and modal/full-page saves across all six edited registers — at per-changed-field granularity, on the existing undo stack.

**Architecture:** Add one `captureFieldEdit` primitive to `useUndoStack` that reverts a row by **merging** a before/after key-patch by id (not whole-row replace). A pure `changedFieldGroups` helper diffs prev→next (array-aware, unlike `diffFields`) and partitions the changed keys into logical field-groups (e.g. `status`+`completedDate` revert together). A thin `captureFieldChanges` wrapper glues them so each wiring site is one call. Wire it at every edit commit point.

**Tech Stack:** TypeScript, React 19, Vitest. Pure engine modules stay i18n-free. CI gates: `npx tsc --noEmit`, `npm run lint` (`--max-warnings=0`), `npm run test:run`, `npm run size:check`.

**Spec:** `docs/superpowers/specs/2026-07-13-field-level-undo-design.md`

---

## File structure

**New files**
- `src/app/undo/field-groups.ts` — pure: `FieldGroup<T>`, per-entity group consts, `pick`, `changedFieldGroups`.
- `src/app/undo/field-groups.test.ts` — unit tests for the pure helper.
- `src/app/undo/capture-field-changes.ts` — `captureFieldChanges` wrapper (diff → partition → loop `captureFieldEdit`).
- `src/app/undo/capture-field-edit.test.tsx` — tests for the new engine method + wrapper.

**Modified files**
- `src/app/undo/use-undo-stack.ts` — add `captureFieldEdit` + merge-by-id runner + `CaptureFieldEditOpts` + `UndoStackApi.captureFieldEdit`.
- `src/app/use-change-log.ts`, `src/app/use-stakeholders.ts`, `src/app/use-resource-planner.ts` — accept `captureFieldEdit?`, capture on update in the save handlers (changes, stakeholders, RAID, resource).
- `src/app/milestones-panel.tsx` — accept `captureFieldEdit?` prop, capture in `save()`.
- `src/app/use-task-submit.ts` — capture per-field in the edit branch.
- `src/app/tasks-section.tsx` — capture in `onInlinePatch`.
- `src/app/task-manager.tsx` — build `captureFieldEdit` deps and pass to every consumer; capture in the status-dropdown handler; thread the milestone prop.

**Convention notes for the implementer**
- CI lint is `--max-warnings=0`: an unused import/var is fatal. Re-check after every edit.
- `react-hooks/exhaustive-deps` rejects an `obj.member` dep — hoist to a local const first.
- `new Date()` is banned in a component **render body**; it is fine inside a callback/runner (these all run on user action).
- Run `npx tsc --noEmit` after editing any `.test.tsx` — build + vitest do NOT typecheck tests.

---

## Task 1: Pure field-group helper

**Files:**
- Create: `src/app/undo/field-groups.ts`
- Test: `src/app/undo/field-groups.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/undo/field-groups.test.ts
import { describe, test, expect } from "vitest";
import { pick, changedFieldGroups, type FieldGroup } from "./field-groups";

interface Row { id: number; a: string; b: string; c: string; tags: string[]; localModifiedAt?: string }

const GROUPS: readonly FieldGroup<Row>[] = [["b", "c"]];

describe("pick", () => {
  test("copies only the named keys", () => {
    const r: Row = { id: 1, a: "x", b: "y", c: "z", tags: [] };
    expect(pick(r, ["a", "c"])).toEqual({ a: "x", c: "z" });
  });
});

describe("changedFieldGroups", () => {
  test("1:1 keys become one entry each", () => {
    const prev: Row = { id: 1, a: "x", b: "y", c: "z", tags: [] };
    const next: Row = { id: 1, a: "X", b: "y", c: "z", tags: [] };
    const out = changedFieldGroups(prev, next, GROUPS);
    expect(out).toEqual([{ before: { a: "x" }, after: { a: "X" } }]);
  });

  test("a grouped key drags its partners into one entry", () => {
    const prev: Row = { id: 1, a: "x", b: "y", c: "z", tags: [] };
    const next: Row = { id: 1, a: "x", b: "Y", c: "z", tags: [] };
    const out = changedFieldGroups(prev, next, GROUPS);
    // b changed → entry carries BOTH b and c (the whole group).
    expect(out).toEqual([{ before: { b: "y", c: "z" }, after: { b: "Y", c: "z" } }]);
  });

  test("array fields are compared structurally (diffFields would skip them)", () => {
    const prev: Row = { id: 1, a: "x", b: "y", c: "z", tags: ["p"] };
    const next: Row = { id: 1, a: "x", b: "y", c: "z", tags: ["p", "q"] };
    const out = changedFieldGroups(prev, next, GROUPS);
    expect(out).toEqual([{ before: { tags: ["p"] }, after: { tags: ["p", "q"] } }]);
  });

  test("id and localModifiedAt are never captured", () => {
    const prev: Row = { id: 1, a: "x", b: "y", c: "z", tags: [], localModifiedAt: "t0" };
    const next: Row = { id: 1, a: "x", b: "y", c: "z", tags: [], localModifiedAt: "t1" };
    expect(changedFieldGroups(prev, next, GROUPS)).toEqual([]);
  });

  test("no changes → no entries", () => {
    const prev: Row = { id: 1, a: "x", b: "y", c: "z", tags: [] };
    expect(changedFieldGroups(prev, { ...prev }, GROUPS)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/undo/field-groups.test.ts`
Expected: FAIL — "Failed to resolve import ./field-groups".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app/undo/field-groups.ts
//
// Pure, i18n-free helpers for per-field edit undo. A FieldGroup lists keys that
// must revert together to keep an invariant (e.g. task status + completedDate).
// changedFieldGroups is array-AWARE on purpose: activity-log's diffFields skips
// non-primitives, but undo must be able to revert labels/dependencies edits too.

export type FieldGroup<T> = readonly (keyof T & string)[];

/** Keys never captured as an editable field: identity + the sync stamp (the
 *  stamp is re-applied by captureFieldEdit's stampField, not undone directly). */
const NEVER_CAPTURE: ReadonlySet<string> = new Set(["id", "localModifiedAt"]);

/** Shallow copy of just the named keys. */
export function pick<T extends object>(row: T, keys: readonly (keyof T & string)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) out[k] = row[k];
  return out;
}

/** Structural inequality for our plain-JSON entity values (primitives + arrays
 *  of primitives + small objects). Object.is fast-path; JSON for the rest. */
function differs(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return false;
  const aObj = typeof a === "object" && a !== null;
  const bObj = typeof b === "object" && b !== null;
  if (aObj || bObj) return JSON.stringify(a) !== JSON.stringify(b);
  return true;
}

/**
 * Diff prev→next and return one {before, after} patch per CHANGED logical field.
 * A changed key that belongs to a multi-key group emits a single entry carrying
 * ALL of that group's keys (so reverting one reverts its partners). Any changed
 * key not named in a group is its own single-key entry. id/localModifiedAt are
 * never captured.
 */
export function changedFieldGroups<T extends { id: number }>(
  prev: T,
  next: T,
  groups: readonly FieldGroup<T>[],
): Array<{ before: Partial<T>; after: Partial<T> }> {
  const grouped = new Set<string>();
  for (const g of groups) for (const k of g) grouped.add(k);

  const out: Array<{ before: Partial<T>; after: Partial<T> }> = [];

  // Multi-key groups first: emit once if ANY member changed.
  for (const g of groups) {
    if (g.some((k) => differs((prev as Record<string, unknown>)[k], (next as Record<string, unknown>)[k]))) {
      out.push({ before: pick(prev, g), after: pick(next, g) });
    }
  }

  // Then every remaining changed key as its own entry.
  const keys = new Set<string>([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    if (NEVER_CAPTURE.has(k) || grouped.has(k)) continue;
    if (differs((prev as Record<string, unknown>)[k], (next as Record<string, unknown>)[k])) {
      out.push({ before: pick(prev, [k as keyof T & string]), after: pick(next, [k as keyof T & string]) });
    }
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/undo/field-groups.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/undo/field-groups.ts src/app/undo/field-groups.test.ts
git commit -m "feat(undo): pure field-group diff helper for per-field undo"
```

---

## Task 2: `captureFieldEdit` engine method

**Files:**
- Modify: `src/app/undo/use-undo-stack.ts`
- Test: `src/app/undo/capture-field-edit.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/undo/capture-field-edit.test.tsx
import { describe, test, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import { useUndoStack } from "./use-undo-stack";

interface Row { id: number; name: string; status: string; done: string; localModifiedAt?: string }

function harness(initial: readonly Row[]) {
  return renderHook(() => {
    const [rows, setRows] = useState<readonly Row[]>(initial);
    const undo = useUndoStack({
      lang: "en-US",
      logActivity: vi.fn(),
      showToast: vi.fn(),
      showToastAction: vi.fn(),
    });
    return { rows, setRows, undo };
  });
}

describe("captureFieldEdit", () => {
  test("undo reverts only the captured keys; redo re-applies them", () => {
    const { result } = harness([{ id: 1, name: "old", status: "To Do", done: "" }]);

    act(() => {
      result.current.setRows((p) => p.map((r) => (r.id === 1 ? { ...r, name: "new" } : r)));
      result.current.undo.captureFieldEdit({
        setter: result.current.setRows,
        kind: "task.updated",
        id: 1,
        before: { name: "old" },
        after: { name: "new" },
      });
    });
    expect(result.current.rows[0].name).toBe("new");

    act(() => result.current.undo.undo());
    expect(result.current.rows[0].name).toBe("old");

    act(() => result.current.undo.redo());
    expect(result.current.rows[0].name).toBe("new");
  });

  test("multi-key group reverts together (status + done)", () => {
    const { result } = harness([{ id: 1, name: "t", status: "Done", done: "2026-01-01" }]);
    act(() => {
      result.current.undo.captureFieldEdit({
        setter: result.current.setRows,
        kind: "task.updated",
        id: 1,
        before: { status: "To Do", done: "" },
        after: { status: "Done", done: "2026-01-01" },
      });
      // simulate the edit already applied above: set state to the "after"
      result.current.setRows((p) => p.map((r) => ({ ...r, status: "Done", done: "2026-01-01" })));
    });
    act(() => result.current.undo.undo());
    expect(result.current.rows[0]).toMatchObject({ status: "To Do", done: "" });
  });

  test("stampField re-stamps localModifiedAt on undo", () => {
    const { result } = harness([{ id: 1, name: "t", status: "x", done: "", localModifiedAt: "t0" }]);
    act(() => {
      result.current.undo.captureFieldEdit({
        setter: result.current.setRows,
        kind: "task.updated",
        id: 1,
        before: { name: "t" },
        after: { name: "t2" },
        stampField: "localModifiedAt",
      });
    });
    act(() => result.current.undo.undo());
    expect(result.current.rows[0].localModifiedAt).not.toBe("t0");
  });

  test("missing id is a no-op (row deleted since)", () => {
    const { result } = harness([{ id: 1, name: "t", status: "x", done: "" }]);
    act(() => {
      result.current.undo.captureFieldEdit({
        setter: result.current.setRows,
        kind: "task.updated",
        id: 99,
        before: { name: "gone" },
        after: { name: "x" },
      });
    });
    act(() => result.current.undo.undo());
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0].name).toBe("t");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/undo/capture-field-edit.test.tsx`
Expected: FAIL — `undo.captureFieldEdit is not a function`.

- [ ] **Step 3: Add the method to `use-undo-stack.ts`**

Add this interface near `CaptureOpts` (after line 36):

```ts
/** A single-field-group edit: revert by MERGING `before`/`after` onto the live
 *  row by id (not a whole-row replace), so independent per-field entries compose
 *  and undo in any LIFO order. `stampField` is re-stamped on undo AND redo. */
export interface CaptureFieldEditOpts<T extends { id: number }> {
  setter: Dispatch<SetStateAction<readonly T[]>>;
  kind: ActivityKind;
  id: number;
  before: Partial<T>;
  after: Partial<T>;
  stampField?: keyof T & string;
}
```

Add to the `UndoStackApi` interface (after the `capture` line, ~line 222):

```ts
  captureFieldEdit: <T extends { id: number }>(opts: CaptureFieldEditOpts<T>) => void;
```

Add the implementation inside `useUndoStack`, right after the `capture` useCallback (after line 323):

```ts
  const captureFieldEdit = useCallback(<T extends { id: number }>(opts: CaptureFieldEditOpts<T>) => {
    const { setter, kind, id, before, after, stampField } = opts;
    const stamp = (row: T): T =>
      stampField ? ({ ...row, [stampField]: new Date().toISOString() } as T) : row;
    const merge = (patch: Partial<T>) =>
      setter((prev) => prev.map((r) => (r.id === id ? stamp({ ...r, ...patch }) : r)));
    // Mutually-recursive, reusable undo↔redo runners (function decls hoist).
    function runUndo(): Runner { merge(before); return runRedo; }
    function runRedo(): Runner { merge(after); return runUndo; }
    pushEntry(kind, 1, runUndo);
  }, [pushEntry]);
```

Add `captureFieldEdit,` to the returned object (in the final `return { ... }`, next to `capture`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/undo/capture-field-edit.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + lint + existing undo tests**

Run: `npx tsc --noEmit && npx eslint src/app/undo/use-undo-stack.ts && npx vitest run src/app/undo/`
Expected: exit 0, all undo tests green.

- [ ] **Step 6: Commit**

```bash
git add src/app/undo/use-undo-stack.ts src/app/undo/capture-field-edit.test.tsx
git commit -m "feat(undo): add captureFieldEdit merge-by-id undo primitive"
```

---

## Task 3: `captureFieldChanges` wrapper

**Files:**
- Create: `src/app/undo/capture-field-changes.ts`
- Test: `src/app/undo/capture-field-edit.test.tsx` (extend)

- [ ] **Step 1: Write the failing test (append to `capture-field-edit.test.tsx`)**

```tsx
import { captureFieldChanges } from "./capture-field-changes";
import type { FieldGroup } from "./field-groups";

describe("captureFieldChanges", () => {
  const GROUPS: readonly FieldGroup<Row>[] = [["status", "done"]];

  test("pushes one entry per changed group; undo reverts all in LIFO order", () => {
    const { result } = harness([{ id: 1, name: "old", status: "To Do", done: "" }]);
    const next: Row = { id: 1, name: "new", status: "Done", done: "2026-01-01" };
    act(() => {
      result.current.setRows(() => [next]);
      captureFieldChanges(result.current.undo.captureFieldEdit, {
        setter: result.current.setRows,
        kind: "task.updated",
        id: 1,
        prev: { id: 1, name: "old", status: "To Do", done: "" },
        next,
        groups: GROUPS,
        stampField: "localModifiedAt",
      });
    });
    // name (1:1) + {status,done} (group) = 2 entries.
    expect(result.current.undo.canUndo).toBe(true);

    act(() => result.current.undo.undo()); // reverts the last-pushed entry
    act(() => result.current.undo.undo()); // reverts the other
    expect(result.current.rows[0]).toMatchObject({ name: "old", status: "To Do", done: "" });
  });

  test("no changes → no entries pushed", () => {
    const { result } = harness([{ id: 1, name: "x", status: "s", done: "" }]);
    act(() => {
      captureFieldChanges(result.current.undo.captureFieldEdit, {
        setter: result.current.setRows,
        kind: "task.updated",
        id: 1,
        prev: { id: 1, name: "x", status: "s", done: "" },
        next: { id: 1, name: "x", status: "s", done: "" },
        groups: [],
      });
    });
    expect(result.current.undo.canUndo).toBe(false);
  });

  test("undefined captureFieldEdit is a safe no-op", () => {
    const prev: Row = { id: 1, name: "x", status: "s", done: "" };
    expect(() =>
      captureFieldChanges(undefined, {
        setter: () => {}, kind: "task.updated", id: 1, prev, next: { ...prev, name: "y" }, groups: [],
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/undo/capture-field-edit.test.tsx`
Expected: FAIL — "Failed to resolve import ./capture-field-changes".

- [ ] **Step 3: Write the wrapper**

```ts
// src/app/undo/capture-field-changes.ts
import type { Dispatch, SetStateAction } from "react";
import type { ActivityKind } from "../activity-log";
import { changedFieldGroups, type FieldGroup } from "./field-groups";
import type { UndoStackApi } from "./use-undo-stack";

export interface CaptureFieldChangesOpts<T extends { id: number }> {
  setter: Dispatch<SetStateAction<readonly T[]>>;
  kind: ActivityKind;
  id: number;
  prev: T;
  next: T;
  groups: readonly FieldGroup<T>[];
  stampField?: keyof T & string;
}

/**
 * Diff prev→next, partition into logical field-groups, and push one undo entry
 * per changed group via captureFieldEdit. A no-op when captureFieldEdit is
 * undefined (popout / caller that opted out) or nothing changed.
 */
export function captureFieldChanges<T extends { id: number }>(
  captureFieldEdit: UndoStackApi["captureFieldEdit"] | undefined,
  opts: CaptureFieldChangesOpts<T>,
): void {
  if (!captureFieldEdit) return;
  const { setter, kind, id, prev, next, groups, stampField } = opts;
  for (const { before, after } of changedFieldGroups(prev, next, groups)) {
    captureFieldEdit({ setter, kind, id, before, after, stampField });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/undo/capture-field-edit.test.tsx`
Expected: PASS (all, incl. 3 new).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/undo/capture-field-changes.ts src/app/undo/capture-field-edit.test.tsx
git commit -m "feat(undo): captureFieldChanges wrapper (diff+partition+capture)"
```

---

## Task 4: Per-entity field-group constants

**Files:**
- Modify: `src/app/undo/field-groups.ts`
- Test: `src/app/undo/field-groups.test.ts` (extend)

- [ ] **Step 1: Write the failing test (append)**

```ts
import {
  TASK_UNDO_GROUPS, CHANGE_UNDO_GROUPS, RAID_UNDO_GROUPS,
  MILESTONE_UNDO_GROUPS, STAKEHOLDER_UNDO_GROUPS, RESOURCE_UNDO_GROUPS,
} from "./field-groups";

describe("per-entity undo groups", () => {
  test("task pairs status+completedDate and the assignee identity", () => {
    expect(TASK_UNDO_GROUPS).toContainEqual(["status", "completedDate"]);
    expect(TASK_UNDO_GROUPS).toContainEqual(["assignee", "assigneeEmail", "resourceId"]);
  });
  test("change pairs status+decisionDate", () => {
    expect(CHANGE_UNDO_GROUPS).toContainEqual(["status", "decisionDate"]);
  });
  test("raid/milestone/stakeholder/resource default to no multi-key groups", () => {
    expect(RAID_UNDO_GROUPS).toEqual([]);
    expect(MILESTONE_UNDO_GROUPS).toEqual([]);
    expect(STAKEHOLDER_UNDO_GROUPS).toEqual([]);
    expect(RESOURCE_UNDO_GROUPS).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/undo/field-groups.test.ts`
Expected: FAIL — exports not defined.

- [ ] **Step 3: Add the constants to `field-groups.ts`**

Append (import the entity types at the top of the file):

```ts
import type { Task, ChangeItem, RaidItem, Milestone, Stakeholder, Resource } from "../types";

/** status⟺completedDate invariant; assignee identity is written as one unit. */
export const TASK_UNDO_GROUPS: readonly FieldGroup<Task>[] = [
  ["status", "completedDate"],
  ["assignee", "assigneeEmail", "resourceId"],
];
/** A change's status transition auto-fills/clears decisionDate together. */
export const CHANGE_UNDO_GROUPS: readonly FieldGroup<ChangeItem>[] = [
  ["status", "decisionDate"],
];
export const RAID_UNDO_GROUPS: readonly FieldGroup<RaidItem>[] = [];
export const MILESTONE_UNDO_GROUPS: readonly FieldGroup<Milestone>[] = [];
export const STAKEHOLDER_UNDO_GROUPS: readonly FieldGroup<Stakeholder>[] = [];
export const RESOURCE_UNDO_GROUPS: readonly FieldGroup<Resource>[] = [];
```

Note: if `tsc` reports a key (e.g. `completedDate`) is not on the entity type, that key is optional on the interface — `keyof T & string` still admits optional keys, so no change is needed; only a genuinely-wrong name fails. Fix any typo to match `types.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/undo/field-groups.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/undo/field-groups.ts src/app/undo/field-groups.test.ts
git commit -m "feat(undo): per-entity field-group constants"
```

---

## Task 5: Wire changes modal-save undo

**Files:**
- Modify: `src/app/use-change-log.ts`
- Modify: `src/app/task-manager.tsx:637`
- Test: `src/app/use-change-log.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/use-change-log.test.ts
import { describe, test, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import { useChangeLog } from "./use-change-log";
import type { ChangeItem } from "./types";

// Minimal workspace-context stub: useChangeLog reads changes/setChanges from it.
vi.mock("./workspace-context", () => {
  let state: readonly ChangeItem[] = [];
  const setState = (u: React.SetStateAction<readonly ChangeItem[]>) => {
    state = typeof u === "function" ? (u as (p: readonly ChangeItem[]) => readonly ChangeItem[])(state) : u;
  };
  return {
    useWorkspace: () => ({ changes: state, setChanges: setState }),
    __seed: (rows: readonly ChangeItem[]) => { state = rows; },
  };
});

test("editing one field pushes a captureFieldEdit for that field", async () => {
  const mod = await import("./workspace-context") as unknown as { __seed: (r: readonly ChangeItem[]) => void };
  const existing = { id: 1, title: "C", description: "old" } as ChangeItem;
  mod.__seed([existing]);
  const captureFieldEdit = vi.fn();
  const { result } = renderHook(() =>
    useChangeLog({ today: "2026-01-01", captureFieldEdit }),
  );
  act(() => result.current.handleSaveChange({ ...existing, description: "new" }, false));
  expect(captureFieldEdit).toHaveBeenCalledTimes(1);
  expect(captureFieldEdit.mock.calls[0][0]).toMatchObject({
    kind: "change.updated", id: 1, before: { description: "old" }, after: { description: "new" },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-change-log.test.ts`
Expected: FAIL — `captureFieldEdit` never called (arg not accepted / no wiring).

- [ ] **Step 3: Implement**

In `use-change-log.ts`, add the import and the arg, then capture on update.

Add to imports:
```ts
import { captureFieldChanges } from "./undo/capture-field-changes";
import { CHANGE_UNDO_GROUPS } from "./undo/field-groups";
```

Add to `UseChangeLogArgs` (after the `capture?` line):
```ts
  /** Capture per-field edits for undo (modal/inline save). */
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
```

In `handleSaveChange`, immediately after the `setChanges(...)` call, in the update branch, add the capture. Replace the existing `if (create) { ... } else if (previous && ...) { ... }` tail with:

```ts
    if (create) {
      args.logActivity?.("change.created", id, item.title);
    } else if (previous) {
      captureFieldChanges(args.captureFieldEdit, {
        setter: setChanges, kind: "change.updated", id,
        prev: previous, next: withStamp, groups: CHANGE_UNDO_GROUPS,
        stampField: "localModifiedAt",
      });
      if (args.logActivityChanges) {
        args.logActivityChanges("change.updated", diffFields(previous, withStamp), id, item.title);
      } else {
        args.logActivity?.("change.updated", id, item.title);
      }
    }
```

In `task-manager.tsx:637`, add `captureFieldEdit: undoApi.captureFieldEdit` to the `useChangeLog({...})` args.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/use-change-log.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 5: Lint**

Run: `npx eslint src/app/use-change-log.ts src/app/use-change-log.test.ts src/app/task-manager.tsx`
Expected: 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-change-log.ts src/app/use-change-log.test.ts src/app/task-manager.tsx
git commit -m "feat(undo): per-field edit undo for changes"
```

---

## Task 6: Wire stakeholders modal-save undo

**Files:**
- Modify: `src/app/use-stakeholders.ts`
- Modify: `src/app/task-manager.tsx:643`
- Test: `src/app/use-stakeholders.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/use-stakeholders.test.ts
import { test, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStakeholders } from "./use-stakeholders";
import type { Stakeholder } from "./types";

vi.mock("./workspace-context", () => {
  let state: readonly Stakeholder[] = [];
  const setState = (u: React.SetStateAction<readonly Stakeholder[]>) => {
    state = typeof u === "function" ? (u as (p: readonly Stakeholder[]) => readonly Stakeholder[])(state) : u;
  };
  return {
    useWorkspace: () => ({ stakeholders: state, setStakeholders: setState }),
    __seed: (rows: readonly Stakeholder[]) => { state = rows; },
  };
});

test("editing a stakeholder field pushes a captureFieldEdit", async () => {
  const mod = await import("./workspace-context") as unknown as { __seed: (r: readonly Stakeholder[]) => void };
  const existing = { id: 1, name: "S", influence: "High" } as Stakeholder;
  mod.__seed([existing]);
  const captureFieldEdit = vi.fn();
  const { result } = renderHook(() => useStakeholders({ today: "2026-01-01", captureFieldEdit }));
  act(() => result.current.handleSaveStakeholder({ ...existing, influence: "Low" } as Stakeholder, false));
  expect(captureFieldEdit).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "stakeholder.updated", id: 1, before: { influence: "High" }, after: { influence: "Low" } }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-stakeholders.test.ts`
Expected: FAIL — capture not called.

- [ ] **Step 3: Implement**

In `use-stakeholders.ts` add imports:
```ts
import { captureFieldChanges } from "./undo/capture-field-changes";
import { STAKEHOLDER_UNDO_GROUPS } from "./undo/field-groups";
```

Add to `UseStakeholdersArgs`:
```ts
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
```

Replace the save tail with:
```ts
    if (create) {
      args.logActivity?.("stakeholder.created", id, item.name);
    } else if (previous) {
      captureFieldChanges(args.captureFieldEdit, {
        setter: setStakeholders, kind: "stakeholder.updated", id,
        prev: previous, next: withStamp, groups: STAKEHOLDER_UNDO_GROUPS,
        stampField: "localModifiedAt",
      });
      if (args.logActivityChanges) {
        args.logActivityChanges("stakeholder.updated", diffFields(previous, withStamp), id, item.name);
      } else {
        args.logActivity?.("stakeholder.updated", id, item.name);
      }
    }
```

In `task-manager.tsx:643`, add `captureFieldEdit: undoApi.captureFieldEdit` to the `useStakeholders({...})` args.

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run src/app/use-stakeholders.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 5: Lint**

Run: `npx eslint src/app/use-stakeholders.ts src/app/use-stakeholders.test.ts src/app/task-manager.tsx`
Expected: 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-stakeholders.ts src/app/use-stakeholders.test.ts src/app/task-manager.tsx
git commit -m "feat(undo): per-field edit undo for stakeholders"
```

---

## Task 7: Wire RAID + resource modal-save undo (`use-resource-planner.ts`)

**Files:**
- Modify: `src/app/use-resource-planner.ts` (`handleSaveRaidItem`, `handleSaveResource`)
- Modify: `src/app/task-manager.tsx:620`
- Test: `src/app/use-resource-planner.undo.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/use-resource-planner.undo.test.tsx
import { test, expect, vi } from "vitest";
// NOTE: use-resource-planner reads many slices from workspace-context; prefer to
// render it through the existing test harness used by its sibling tests. If a
// lighter mock is needed, mirror the workspace-context vi.mock pattern from
// use-change-log.test.ts, seeding `raid` and `resources` arrays and stubbing the
// remaining setters as no-ops.
import { renderHook, act } from "@testing-library/react";
import { useResourcePlanner } from "./use-resource-planner";
import type { RaidItem } from "./types";

test("editing a RAID field pushes a captureFieldEdit", () => {
  const captureFieldEdit = vi.fn();
  const existing = { id: 1, category: "R", title: "Risk", status: "Open", owner: "A" } as RaidItem;
  const { result } = renderHook(() =>
    useResourcePlanner({
      lang: "en-US", today: "2026-01-01", workdayHours: 8, holidaySet: new Set(),
      captureFieldEdit,
      // seed raid=[existing] via the harness/mock; other required args stubbed.
    } as never),
  );
  act(() => result.current.handleSaveRaidItem({ ...existing, owner: "B" } as RaidItem, false));
  expect(captureFieldEdit).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "raid.updated", id: 1, before: { owner: "A" }, after: { owner: "B" } }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-resource-planner.undo.test.tsx`
Expected: FAIL — capture not called.

- [ ] **Step 3: Implement**

In `use-resource-planner.ts` add imports:
```ts
import { captureFieldChanges } from "./undo/capture-field-changes";
import { RAID_UNDO_GROUPS, RESOURCE_UNDO_GROUPS } from "./undo/field-groups";
```

Add to the args interface (near the existing `capture?`/`captureComposite?`):
```ts
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
```
and destructure it as a ref-free `args.captureFieldEdit` at call sites (it is only read inside callbacks, which already read `args`).

In `handleSaveRaidItem`, in the UPDATE path (where `previous` is defined and the row is mapped into state), after the state update and before/around the logging branch, add:
```ts
      if (!create && previous) {
        captureFieldChanges(args.captureFieldEdit, {
          setter: setRaid, kind: "raid.updated", id,
          prev: previous, next: withStamp, groups: RAID_UNDO_GROUPS,
          stampField: "localModifiedAt",
        });
      }
```
(Place it right before the existing `logUpdate("raid.updated", ...)` / status-change logging so it only runs for genuine updates. `withStamp` here must be the final saved object; if the auto-issue path rebuilt the object, use that final value as `next`.)

In `handleSaveResource`, in the UPDATE branch (after computing `previous` + `withStamp`, before `logUpdate("resource.updated", ...)`), add:
```ts
        captureFieldChanges(args.captureFieldEdit, {
          setter: setResources, kind: "resource.updated", id: next.id,
          prev: previous, next: withStamp, groups: RESOURCE_UNDO_GROUPS,
          stampField: "localModifiedAt",
        });
```

In `task-manager.tsx:620`, add `captureFieldEdit: undoApi.captureFieldEdit` to the `useResourcePlanner({...})` args.

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run src/app/use-resource-planner.undo.test.tsx && npx tsc --noEmit`
Expected: PASS, exit 0. (If the light mock proves brittle, wire the test through the harness the sibling `use-resource-planner` tests use.)

- [ ] **Step 5: Lint**

Run: `npx eslint src/app/use-resource-planner.ts src/app/use-resource-planner.undo.test.tsx src/app/task-manager.tsx`
Expected: 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-resource-planner.ts src/app/use-resource-planner.undo.test.tsx src/app/task-manager.tsx
git commit -m "feat(undo): per-field edit undo for RAID and resources"
```

---

## Task 8: Wire milestones modal-save undo

**Files:**
- Modify: `src/app/milestones-panel.tsx` (`save()`, ~line 253; props interface)
- Modify: `src/app/task-manager.tsx` (milestones-panel render + props type)
- Test: `src/app/milestones-panel.test.tsx` (extend)

- [ ] **Step 1: Write the failing test (append to the existing file)**

```tsx
test("editing a milestone field pushes a captureFieldEdit", () => {
  // Render MilestonesPanel with one seeded milestone and a captureFieldEdit spy,
  // open the editor, change the name, and save. Mirror the render/seed helper
  // already used by the other milestones-panel tests. Assert:
  //   expect(captureFieldEdit).toHaveBeenCalledWith(
  //     expect.objectContaining({ kind: "milestone.updated", id: <id>,
  //       before: { name: <old> }, after: { name: <new> } }));
});
```
Replace the comment body with the concrete render using the file's existing helper (seed via `useWorkspace` provider wrapper the sibling tests use; drive the editor through the same DOM queries).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/milestones-panel.test.tsx`
Expected: FAIL — capture spy not called.

- [ ] **Step 3: Implement**

Add imports to `milestones-panel.tsx`:
```ts
import { captureFieldChanges } from "./undo/capture-field-changes";
import { MILESTONE_UNDO_GROUPS } from "./undo/field-groups";
import type { UndoStackApi } from "./undo/use-undo-stack";
```

Add `captureFieldEdit?: UndoStackApi["captureFieldEdit"]` to the panel's props interface and destructure it.

In `save()`, in the update branch (after `setMilestones(...)`, where `previous` is defined), add before the logging branch:
```ts
    if (!create && previous) {
      captureFieldChanges(captureFieldEdit, {
        setter: setMilestones, kind: "milestone.updated", id,
        prev: previous, next: finalItem, groups: MILESTONE_UNDO_GROUPS,
        stampField: "localModifiedAt",
      });
    }
```
Note: `finalItem` here is `{ ...next, id }`. If milestones don't carry `localModifiedAt`, drop `stampField` (tsc will flag it if the key is absent — remove it in that case).

In `task-manager.tsx`, pass `captureFieldEdit={undoApi.captureFieldEdit}` where `<MilestonesPanel .../>` is rendered, and add the prop to its prop type if one is declared locally.

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run src/app/milestones-panel.test.tsx && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 5: Lint**

Run: `npx eslint src/app/milestones-panel.tsx src/app/task-manager.tsx`
Expected: 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/app/milestones-panel.tsx src/app/task-manager.tsx src/app/milestones-panel.test.tsx
git commit -m "feat(undo): per-field edit undo for milestones"
```

---

## Task 9: Wire task modal / full-page save undo

**Files:**
- Modify: `src/app/use-task-submit.ts` (edit branch, lines 170-197)
- Modify: `src/app/task-manager.tsx` (the `useTaskSubmit({...})` call site)
- Test: `src/app/use-task-submit.test.ts` (extend)

- [ ] **Step 1: Write the failing test (append)**

```ts
test("editing task fields pushes one captureFieldEdit per changed group", () => {
  // Using the file's existing useTaskSubmit harness: seed a task, open it via
  // openEditModal, change name + status via setForm, submit, and assert
  // captureFieldEdit was called for the name change AND once for the
  // {status, completedDate} group. Add captureFieldEdit: vi.fn() to the args.
  //   const nameCall = captureFieldEdit.mock.calls.find(c => "name" in c[0].before);
  //   const statusCall = captureFieldEdit.mock.calls.find(c => "status" in c[0].before);
  //   expect(nameCall).toBeTruthy(); expect(statusCall).toBeTruthy();
  //   expect(statusCall[0].after).toHaveProperty("completedDate");
});
```
Replace the comment with the concrete flow using the existing `use-task-submit.test.ts` harness.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-task-submit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add imports:
```ts
import { captureFieldChanges } from "./undo/capture-field-changes";
import { TASK_UNDO_GROUPS } from "./undo/field-groups";
import type { UndoStackApi } from "./undo/use-undo-stack";
```

Add to `UseTaskSubmitArgs`:
```ts
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
```
Destructure `captureFieldEdit` from `args`.

In the edit branch (lines 170-197), `prevTask` is already read and `nextTask` is already computed for the audit log. Right after the `setTasks(...)` call, add:
```ts
        if (prevTask) {
          const nextTaskForUndo = applyStatusChange(
            { ...prevTask, ...payload, localModifiedAt: stamp }, form.status, today,
          );
          captureFieldChanges(captureFieldEdit, {
            setter: setTasks, kind: "task.updated", id: updatedId,
            prev: prevTask, next: nextTaskForUndo, groups: TASK_UNDO_GROUPS,
            stampField: "localModifiedAt",
          });
        }
```
If the audit-log block already computes `nextTask` from `prevTask`, reuse that value instead of recomputing (DRY): move the capture to run alongside `logActivityChanges` using the same `nextTask`.

Add `captureFieldEdit: undoApi.captureFieldEdit` to the `useTaskSubmit({...})` call in `task-manager.tsx`.

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run src/app/use-task-submit.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 5: Lint**

Run: `npx eslint src/app/use-task-submit.ts src/app/use-task-submit.test.ts src/app/task-manager.tsx`
Expected: 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-task-submit.ts src/app/use-task-submit.test.ts src/app/task-manager.tsx
git commit -m "feat(undo): per-field edit undo for task modal save"
```

---

## Task 10: Wire task inline-cell + status-dropdown undo

**Files:**
- Modify: `src/app/tasks-section.tsx` (`onInlinePatch`, lines 298-320)
- Modify: `src/app/task-manager.tsx` (the `onStatusChange` handler)
- Test: `src/app/tasks-section.test.tsx` (extend) and `src/app/task-manager` status test

- [ ] **Step 1: Write the failing test (append to `tasks-section.test.tsx`)**

```tsx
test("an inline patch pushes a captureFieldEdit reverting just that field", () => {
  // Render TasksSection with one seeded task and a captureFieldEdit spy passed
  // through the same prop chain the component already receives. Trigger an inline
  // notes edit (double-click the notes cell → type → blur), then assert:
  //   expect(captureFieldEdit).toHaveBeenCalledWith(expect.objectContaining({
  //     kind: "task.updated", id: <id>,
  //     before: { notes: <old> }, after: { notes: <new> } }));
});
```
Replace the comment with the concrete flow using the file's existing render helper. If `TasksSection` receives `captureFieldEdit` via context/props, thread the spy through the same path task-manager uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/tasks-section.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement inline capture**

`onInlinePatch` currently maps `setTasks` and applies a sanitized `clean` patch. It needs the pre-edit row to build the before-image. Capture the snapshot inside the updater and fire `captureFieldEdit` after commit. Modify `onInlinePatch`:

```ts
  const onInlinePatch = useCallback(
    (taskId: number, patch: Partial<Task>) => {
      let beforeRow: Task | undefined;
      let cleanApplied: Partial<Task> | undefined;
      setTasks((prev) => {
        const knownTaskIds = new Set(prev.map((tk) => tk.id));
        return prev.map((row) => {
          if (row.id !== taskId || row.jiraKey) return row;
          const clean = sanitizeInlinePatch(patch, {
            hasResource: (id) => resourcesById.has(id),
            knownTaskIds,
            ownTaskId: taskId,
          });
          beforeRow = row;
          cleanApplied = clean;
          return { ...row, ...clean, localModifiedAt: new Date().toISOString() };
        });
      });
      if (beforeRow && cleanApplied && Object.keys(cleanApplied).length > 0) {
        const before: Partial<Task> = {};
        for (const k of Object.keys(cleanApplied) as (keyof Task)[]) before[k] = beforeRow[k];
        captureFieldEdit?.({
          setter: setTasks, kind: "task.updated", id: taskId,
          before, after: cleanApplied, stampField: "localModifiedAt",
        });
      }
    },
    [setTasks, resourcesById, captureFieldEdit],
  );
```
Add `captureFieldEdit` to `TasksSectionProps` (or the context the component already consumes) and thread it from task-manager. Note: capturing state read inside a setter updater into an outer `let` is safe here because the updater runs synchronously during the `setTasks` call; React strict-mode double-invoke reassigns the same values (idempotent).

- [ ] **Step 4: Implement status-dropdown capture**

In `task-manager.tsx`, the `onStatusChange(id, next)` handler applies `applyStatusChange`. Before/around the `setTasks` map, snapshot the prev row and capture the `{status, completedDate}` group. Locate the handler and add:

```ts
  const prev = tasksRef.current.find((t) => t.id === id);
  setTasks((rows) => rows.map((r) => (r.id === id && !r.jiraKey ? applyStatusChange({ ...r, localModifiedAt: new Date().toISOString() }, next, today) : r)));
  if (prev && !prev.jiraKey) {
    const after = applyStatusChange({ ...prev }, next, today);
    undoApi.captureFieldEdit({
      setter: setTasks, kind: "task.updated", id,
      before: { status: prev.status, completedDate: prev.completedDate },
      after: { status: after.status, completedDate: after.completedDate },
      stampField: "localModifiedAt",
    });
  }
```
Adapt to the handler's actual local names (it already has `setTasks`, `today`, and a tasks ref). Keep the existing activity log call.

- [ ] **Step 5: Run tests + typecheck + lint**

Run: `npx vitest run src/app/tasks-section.test.tsx src/app/task-manager.characterization.test.tsx && npx tsc --noEmit && npx eslint src/app/tasks-section.tsx src/app/task-manager.tsx`
Expected: PASS, exit 0, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/app/tasks-section.tsx src/app/task-manager.tsx src/app/tasks-section.test.tsx
git commit -m "feat(undo): per-field undo for task inline edits and status dropdown"
```

---

## Task 11: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 2: Lint (full, CI-strict)**

Run: `npm run lint`
Expected: 0 warnings/errors.

- [ ] **Step 3: Unit suite**

Run: `npm run test:run`
Expected: all green (new undo tests included).

- [ ] **Step 4: Size ratchet**

Run: `npm run size:check`
Expected: pass. If a touched file crossed 800 lines, re-baseline via `node scripts/check-file-sizes.mjs --update` and note it in the commit.

- [ ] **Step 5: Duplication gate**

Run: `npm run dup:check`
Expected: pass. The six near-identical save-tail insertions each call the shared `captureFieldChanges` (one line of args), so no new clone should trip the threshold.

- [ ] **Step 6: Manual smoke (dev against a THROWAWAY project, never live data)**

- Inline-edit a task notes cell → Ctrl+Z reverts only notes.
- Change a task status via the dropdown → Ctrl+Z reverts status (and completedDate together).
- Edit 3 fields in the task modal, Save → 3 Ctrl+Z presses revert them one at a time; Ctrl+Y redoes.
- Edit a RAID / change / stakeholder / resource / milestone field in its modal → Ctrl+Z reverts it.
- Confirm a Jira-synced task's edit path pushes nothing.

- [ ] **Step 7: Commit (if re-baseline or smoke fixes were needed)**

```bash
git add -A
git commit -m "chore(undo): verification pass — gates green"
```

---

## Self-review notes

- **Spec coverage:** engine extension (Task 2), field-groups incl. status/completedDate + assignee triple (Tasks 1, 4), per-entity modal wiring all six (Tasks 5-9), inline + status (Task 10), re-stamp `localModifiedAt` (`stampField`, Tasks 2/5-10), Jira-synced no-capture (Task 10 guard + edits blocked upstream), no-op guard (`changedFieldGroups` returns []), bulk-edit excluded (untouched — keeps whole-row `captureBulkUndo`).
- **Type consistency:** `captureFieldEdit` / `CaptureFieldEditOpts` / `captureFieldChanges` / `changedFieldGroups` / `*_UNDO_GROUPS` names are used identically across tasks.
- **Known soft spots for the implementer:** entity save hooks read state via `useWorkspace`/refs — the light `vi.mock` in the test stubs may need to mirror each hook's actual context surface; where a hook has an established harness (resource-planner, use-task-submit, milestones-panel), prefer it over a fresh mock. These are called out inline in Tasks 7-10.
