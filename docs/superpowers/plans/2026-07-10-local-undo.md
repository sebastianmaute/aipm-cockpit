# Local Undo for Destructive Edits — Implementation Plan (audit #11)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local, in-memory, multi-level (~10) undo for every destructive edit (deletes, clear-all, bulk-edit) across every entity, on every backend.

**Architecture:** One pure primitive `applyUndoRestore` (upsert before-images by `id`) reverses all three op-types; correct under interleaving. A stateful `useUndoStack()` hook **in task-manager** (NOT a context provider — the entity hooks run in task-manager's body, above any return-tree provider, so a provider would be unreachable). `capture` is threaded into each entity hook's existing args object (mirrors the already-threaded `logActivity`). Three surfaces: toast Undo button, Ctrl/⌘Z, top-bar control.

**Tech Stack:** Next.js (forked) · React · TypeScript · vitest · Playwright/axe.

**Spec:** `docs/superpowers/specs/2026-07-10-local-undo-design.md`

### Architecture refinement vs spec (read first)
The spec described an `UndoProvider` + `useUndo()` context. Planning found a **provider-ordering trap**: task-manager calls the entity hooks (`useBulkOperations`, `useTaskRowHandlers`, `useResourcePlanner`, `useChangeLog`, `useStakeholders`) in its function body — *above* whatever it renders in its return tree. A context provider in the return tree cannot be consumed by those hook calls. So this plan uses a **plain `useUndoStack()` hook** in task-manager and threads `capture` down through the same args/props channels the codebase already uses for `logActivity`/`showToast`. Behavior, coverage, and surfaces are identical to the approved spec.

### Critical correctness note — task-delete cascade
`useTaskRowHandlers.onDelete` (`use-task-row-handlers.ts:268`) deletes a task **and strips the deleted id from every other task's `dependencies[]`**. A faithful undo must capture the deleted task **plus** the dependents it edited. The `before` list for a task delete is therefore `[doomed, ...tasks.filter(t => t.dependencies?.some(d => d.taskId === id))]`. The upsert restores all of them.

### React-purity landmines (CI-fatal)
- **Never call a side effect (`restore()`, toast, log) inside a `setState` updater** — React strict-mode double-invokes updaters → double restore. Read the latest stack via a `stackRef`, run the side effect **outside** the updater, then `setStack(next)`.
- No `Date.now()`/`new Date()` in a render body. `capture`/`undo` run in event handlers → `new Date().toISOString()` there is fine.
- `capture` identity must be stable (threaded into hook deps) → `useCallback` reading deps via a ref.

---

## File Structure

**Create:**
- `undo/undo-stack.ts` — pure engine: `applyUndoRestore`, `pushUndo`, `popUndo`, `dropEntry`, types.
- `undo/use-undo-stack.ts` — the stateful hook: `capture`/`undo`/`undoById`/`stack`/`canUndo`.
- `undo/undo-control.tsx` — presentational top-bar button.
- `use-undo-hotkey.ts` — global Ctrl/⌘Z keydown.
- Tests beside each.

**Modify:**
- `use-toast.ts`, `toast-context.tsx`, `app-modals.tsx` — toast `action` support.
- `activity-log.ts` — `"undo"` kind.
- `use-task-row-handlers.ts`, `use-bulk-operations.ts`, `use-change-log.ts`, `use-stakeholders.ts`, `use-resource-planner.ts` — thread + call `capture`.
- `milestones-panel.tsx`, `change-panel.tsx`, `stakeholders-panel.tsx`, `raid-panel.tsx` — thread + call `capture` for panel-level bulk-edit + milestone delete.
- `workspace-section-types.ts`, `workspace-section.tsx` — thread `capture` to the panels that need it.
- `task-manager.tsx` — call `useUndoStack()`, thread `capture`, mount hotkey, wire the control into both headers.
- `i18n.ts`, `i18n.de.ts` — new keys.

---

## Task 1: Pure engine `undo-stack.ts`

**Files:**
- Create: `src/app/undo/undo-stack.ts`
- Test: `src/app/undo/undo-stack.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/undo/undo-stack.test.ts
import { describe, it, expect } from "vitest";
import { applyUndoRestore, pushUndo, popUndo, dropEntry, type UndoEntry } from "./undo-stack";

type Row = { id: number; name: string };

describe("applyUndoRestore", () => {
  it("re-inserts deleted rows at their original index", () => {
    const current: Row[] = [{ id: 1, name: "a" }, { id: 3, name: "c" }];
    const before = [{ index: 1, item: { id: 2, name: "b" } }];
    expect(applyUndoRestore(current, before)).toEqual([
      { id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" },
    ]);
  });

  it("reverts an edited row to its before-image (present → replace)", () => {
    const current: Row[] = [{ id: 1, name: "EDITED" }, { id: 2, name: "b" }];
    const before = [{ index: 0, item: { id: 1, name: "a" } }];
    expect(applyUndoRestore(current, before)).toEqual([
      { id: 1, name: "a" }, { id: 2, name: "b" },
    ]);
  });

  it("restores a fully-cleared array (clear-all)", () => {
    const before = [
      { index: 0, item: { id: 1, name: "a" } },
      { index: 1, item: { id: 2, name: "b" } },
    ];
    expect(applyUndoRestore<Row>([], before)).toEqual([
      { id: 1, name: "a" }, { id: 2, name: "b" },
    ]);
  });

  it("leaves rows the op never touched intact (interleaving)", () => {
    // op deleted id:2; user then edited id:1 to "EDITED-LATER"; undo must keep that edit
    const current: Row[] = [{ id: 1, name: "EDITED-LATER" }, { id: 3, name: "c" }];
    const before = [{ index: 1, item: { id: 2, name: "b" } }];
    expect(applyUndoRestore(current, before)).toEqual([
      { id: 1, name: "EDITED-LATER" }, { id: 2, name: "b" }, { id: 3, name: "c" },
    ]);
  });

  it("clamps a stale index to the array end", () => {
    const current: Row[] = [{ id: 1, name: "a" }];
    const before = [{ index: 99, item: { id: 2, name: "b" } }];
    expect(applyUndoRestore(current, before)).toEqual([
      { id: 1, name: "a" }, { id: 2, name: "b" },
    ]);
  });
});

describe("stack ops", () => {
  const mk = (id: number): UndoEntry => ({
    meta: { id, kind: "task.deleted", count: 1, timestamp: "t" },
    restore: () => {},
  });

  it("pushUndo evicts the oldest past the cap", () => {
    let s: readonly UndoEntry[] = [];
    for (let i = 1; i <= 12; i++) s = pushUndo(s, mk(i), 10);
    expect(s).toHaveLength(10);
    expect(s[0].meta.id).toBe(3);   // 1,2 evicted
    expect(s[9].meta.id).toBe(12);  // newest on top (end)
  });

  it("popUndo returns the top entry and the rest", () => {
    const s = [mk(1), mk(2)];
    const popped = popUndo(s);
    expect(popped?.entry.meta.id).toBe(2);
    expect(popped?.rest).toEqual([mk(1)]);
    expect(popped?.rest[0].meta.id).toBe(1);
  });

  it("popUndo returns null on empty", () => {
    expect(popUndo([])).toBeNull();
  });

  it("dropEntry removes a specific entry by id", () => {
    const s = [mk(1), mk(2), mk(3)];
    expect(dropEntry(s, 2).map((e) => e.meta.id)).toEqual([1, 3]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/app/undo/undo-stack.test.ts`
Expected: FAIL — "Cannot find module './undo-stack'".

- [ ] **Step 3: Implement**

```ts
// src/app/undo/undo-stack.ts
// Pure, i18n-free, clock-free engine for the local undo stack. One primitive
// (applyUndoRestore) reverses delete / bulk-edit / clear-all by upserting
// captured before-images by id — so undo touches only the rows the op touched
// and survives edits made to OTHER rows between the op and the undo.
import type { ActivityKind } from "../activity-log";

/** A captured pre-op snapshot of one row plus its position in the source array. */
export type BeforeImage<T> = { index: number; item: T };

/** Display data for one undoable op (toast text, top-bar badge, React key). */
export interface UndoMeta {
  id: number;
  kind: ActivityKind;
  count: number;
  timestamp: string;
}

/** One stack entry: display meta + the impure restore thunk (closes over the setter). */
export interface UndoEntry {
  meta: UndoMeta;
  restore: () => void;
}

/**
 * Upsert before-images into `current` by id: a still-present row is reverted to
 * its before-image (bulk-edit); an absent row is re-inserted at its original
 * index, clamped to the array end (delete / clear-all). Pure.
 */
export function applyUndoRestore<T extends { id: number }>(
  current: readonly T[],
  before: readonly BeforeImage<T>[],
): T[] {
  const present = new Set(current.map((r) => r.id));
  const out = current.slice();
  for (const { index, item } of before) {
    if (present.has(item.id)) {
      out[out.findIndex((r) => r.id === item.id)] = item;
    } else {
      out.splice(Math.min(index, out.length), 0, item);
      present.add(item.id);
    }
  }
  return out;
}

/** Push an entry on top (end); evict the oldest (front) past `cap`. Pure. */
export function pushUndo(
  stack: readonly UndoEntry[],
  entry: UndoEntry,
  cap: number,
): UndoEntry[] {
  const next = [...stack, entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Remove and return the top entry (end) plus the remaining stack, or null. Pure. */
export function popUndo(
  stack: readonly UndoEntry[],
): { entry: UndoEntry; rest: UndoEntry[] } | null {
  if (stack.length === 0) return null;
  return { entry: stack[stack.length - 1], rest: stack.slice(0, -1) };
}

/** Return the stack without the entry whose meta.id === id. Pure. */
export function dropEntry(
  stack: readonly UndoEntry[],
  id: number,
): UndoEntry[] {
  return stack.filter((e) => e.meta.id !== id);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/app/undo/undo-stack.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: exit 0.

```bash
git add src/app/undo/undo-stack.ts src/app/undo/undo-stack.test.ts
git commit -m "feat(undo): pure undo-stack engine (applyUndoRestore + stack ops)"
```

---

## Task 2: Toast `action` support

**Files:**
- Modify: `src/app/use-toast.ts`
- Modify: `src/app/toast-context.tsx`
- Modify: `src/app/app-modals.tsx:82` (prop type), `:224-239` (render)
- Modify: `src/app/task-manager.tsx:169` (destructure `showToastAction`), `:2005`+ / `:2153` (thread)
- Test: `src/app/use-toast.test.ts` (extend), `src/app/toast-context.test.tsx` (extend)

- [ ] **Step 1: Write the failing test (`use-toast.test.ts`)**

Append:

```ts
import { renderHook, act } from "@testing-library/react";
import { useToast } from "./use-toast";

it("showToastAction attaches an action to the toast", () => {
  const { result } = renderHook(() => useToast());
  const run = () => {};
  act(() => result.current.showToastAction("info", "Deleted 3 tasks", { labelKey: "undo", run }));
  expect(result.current.toast?.text).toBe("Deleted 3 tasks");
  expect(result.current.toast?.action?.labelKey).toBe("undo");
  expect(result.current.toast?.action?.run).toBe(run);
});

it("showToast leaves action undefined (back-compat)", () => {
  const { result } = renderHook(() => useToast());
  act(() => result.current.showToast("info", "plain"));
  expect(result.current.toast?.action).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/app/use-toast.test.ts`
Expected: FAIL — `showToastAction` is not a function.

- [ ] **Step 3: Implement `use-toast.ts`**

```ts
// src/app/use-toast.ts
"use client";
import { useCallback, useEffect, useState } from "react";
import type { TranslationKey } from "./i18n";

export type ToastAction = { labelKey: TranslationKey; run: () => void };
type Toast = { kind: "info" | "error"; text: string; id: number; action?: ToastAction };

export function useToast(): {
  toast: Toast | null;
  showToast: (kind: "info" | "error", text: string) => void;
  showToastAction: (kind: "info" | "error", text: string, action: ToastAction) => void;
} {
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on toast.id so a new toast restarts the timer
  }, [toast?.id]);

  const showToast = useCallback((kind: "info" | "error", text: string) => {
    setToast({ kind, text, id: Date.now() });
  }, []);

  const showToastAction = useCallback(
    (kind: "info" | "error", text: string, action: ToastAction) => {
      setToast({ kind, text, id: Date.now(), action });
    },
    [],
  );

  return { toast, showToast, showToastAction };
}
```

- [ ] **Step 4: Implement `toast-context.tsx`** (widen value to an object; keep `useToastContext()` back-compat)

```tsx
// src/app/toast-context.tsx
"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { ToastAction } from "./use-toast";

type ShowToast = (kind: "info" | "error", text: string) => void;
type ShowToastAction = (kind: "info" | "error", text: string, action: ToastAction) => void;

interface ToastApi {
  showToast: ShowToast;
  showToastAction: ShowToastAction;
}

const noop: ShowToast = () => {};
const noopAction: ShowToastAction = () => {};
const ToastContext = createContext<ToastApi>({ showToast: noop, showToastAction: noopAction });

export function ToastProvider({ value, children }: { value: ToastApi; children: ReactNode }) {
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

/** Ambient showToast (back-compat — most callers use only this). */
export function useToastContext(): ShowToast {
  return useContext(ToastContext).showToast;
}

/** Ambient showToastAction (undo capture uses this). */
export function useToastAction(): ShowToastAction {
  return useContext(ToastContext).showToastAction;
}
```

- [ ] **Step 5: Update the `ToastProvider` mount(s)**

`grep -rn "ToastProvider" src/app` to find mounts. Each `<ToastProvider value={showToast}>` becomes `<ToastProvider value={{ showToast, showToastAction }}>`. In `task-manager.tsx:169` destructure the new fn:

```tsx
const { toast, showToast, showToastAction } = useToast();
```

- [ ] **Step 6: Render the action button in `app-modals.tsx`**

Widen the prop type at `:82`:

```ts
toast: { kind: "info" | "error"; text: string; action?: { labelKey: import("./i18n").TranslationKey; run: () => void } } | null;
```

Replace the toast body (`:236-238` `{toast.text}`) with:

```tsx
<div className="flex items-center gap-3">
  <span>{toast.text}</span>
  {toast.action && (
    <button
      type="button"
      onClick={toast.action.run}
      className={`shrink-0 font-medium underline underline-offset-2 ${INTERACTIVE}`}
    >
      {t(lang, toast.action.labelKey)}
    </button>
  )}
</div>
```

Ensure `INTERACTIVE` (from `./interaction-styles`), `t`, and `lang` are in scope in `app-modals.tsx` (grep — `t`/`lang` already are; add the `INTERACTIVE` import if missing).

- [ ] **Step 7: Run the toast + a quick context test**

Run: `npm run test:run -- src/app/use-toast.test.ts src/app/toast-context.test.tsx`
Expected: PASS. Fix any `toast-context.test.tsx` that constructed `value={fn}` → `value={{ showToast: fn, showToastAction: fn }}`.

- [ ] **Step 8: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: exit 0 (fixes any other `ToastProvider value=` / `useToastContext` shape mismatch — `useToastContext` return is unchanged so consumers are unaffected).

```bash
git add src/app/use-toast.ts src/app/toast-context.tsx src/app/app-modals.tsx src/app/task-manager.tsx src/app/use-toast.test.ts src/app/toast-context.test.tsx
git commit -m "feat(toast): optional action button (showToastAction)"
```

---

## Task 3: `"undo"` activity kind

**Files:**
- Modify: `src/app/activity-log.ts:12-52` (union), `:154-195` (map)
- Test: `src/app/activity-log.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
it("supports the undo kind", () => {
  const log = appendActivity([], "undo", 3);
  expect(log[0].kind).toBe("undo");
  expect(ACTIVITY_KIND_TO_KEY["undo"]).toBe("activityUndo");
});
```
(Ensure `ACTIVITY_KIND_TO_KEY` is imported in the test.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/app/activity-log.test.ts`
Expected: FAIL — `"undo"` not assignable / map key missing.

- [ ] **Step 3: Implement**

Add `| "undo"` to the `ActivityKind` union (after `"ai.inlineEdit"` at `:52`). Add to `ACTIVITY_KIND_TO_KEY` (`:194`):

```ts
  "ai.inlineEdit": "activityAiInlineEdit",
  "undo": "activityUndo",
};
```

(`activityGroupOf` needs no change — `"undo"` has no known prefix → falls through to `"general"`, which is correct.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/app/activity-log.test.ts`
Expected: PASS. (`i18n` key `activityUndo` is added in Task 10 — tsc will flag it until then; that's expected, keep going.)

- [ ] **Step 5: Commit**

```bash
git add src/app/activity-log.ts src/app/activity-log.test.ts
git commit -m "feat(activity): add undo activity kind"
```

---

## Task 4: `useUndoStack()` hook

**Files:**
- Create: `src/app/undo/use-undo-stack.ts`
- Test: `src/app/undo/use-undo-stack.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/undo/use-undo-stack.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUndoStack } from "./use-undo-stack";

type Row = { id: number; name: string };

function makeDeps(overrides: Partial<Parameters<typeof useUndoStack>[0]> = {}) {
  return {
    lang: "en-US" as const,
    logActivity: vi.fn(),
    showToast: vi.fn(),
    showToastAction: vi.fn(),
    ...overrides,
  };
}

describe("useUndoStack", () => {
  it("capture pushes an entry, fires an action toast, and sets canUndo", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    let arr: readonly Row[] = [{ id: 1, name: "a" }, { id: 2, name: "b" }];
    const setter = vi.fn((u: (p: readonly Row[]) => readonly Row[]) => { arr = u(arr); });
    act(() => {
      result.current.capture({ setter, kind: "task.deleted", before: [{ id: 2, name: "b" }], fromArray: arr });
    });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.stack).toHaveLength(1);
    expect(deps.showToastAction).toHaveBeenCalledWith("info", expect.any(String), expect.objectContaining({ labelKey: "undo" }));
  });

  it("undo restores via the setter, logs, toasts, and empties the stack", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    let arr: readonly Row[] = [{ id: 1, name: "a" }];
    const setter = (u: (p: readonly Row[]) => readonly Row[]) => { arr = u(arr); };
    act(() => {
      // simulate: row 2 was just deleted; before-image restores it at index 1
      result.current.capture({ setter, kind: "task.deleted", before: [{ id: 2, name: "b" }], fromArray: [{ id: 1, name: "a" }, { id: 2, name: "b" }] });
    });
    act(() => result.current.undo());
    expect(arr).toEqual([{ id: 1, name: "a" }, { id: 2, name: "b" }]);
    expect(deps.logActivity).toHaveBeenCalledWith("undo", 1);
    expect(deps.showToast).toHaveBeenCalledWith("info", expect.any(String));
    expect(result.current.canUndo).toBe(false);
  });

  it("undoById restores and drops that specific entry", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    const setterA = vi.fn();
    const setterB = vi.fn();
    let capturedId = 0;
    (deps.showToastAction as ReturnType<typeof vi.fn>).mockImplementation((_k, _t, a) => { capturedId = 0; a.run; });
    act(() => {
      result.current.capture({ setter: setterA, kind: "task.deleted", before: [{ id: 1, name: "a" }], fromArray: [{ id: 1, name: "a" }] });
      result.current.capture({ setter: setterB, kind: "change.deleted", before: [{ id: 9, name: "x" }], fromArray: [{ id: 9, name: "x" }] });
    });
    const firstId = result.current.stack[0].id;
    act(() => result.current.undoById(firstId));
    expect(setterA).toHaveBeenCalledTimes(1);
    expect(result.current.stack.map((m) => m.id)).not.toContain(firstId);
    void capturedId;
  });

  it("undo on an empty stack is a no-op", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    act(() => result.current.undo());
    expect(deps.logActivity).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/app/undo/use-undo-stack.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/app/undo/use-undo-stack.ts
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { t, type Lang } from "../i18n";
import type { ActivityKind } from "../activity-log";
import type { ToastAction } from "../use-toast";
import {
  applyUndoRestore,
  pushUndo,
  popUndo,
  dropEntry,
  type BeforeImage,
  type UndoEntry,
  type UndoMeta,
} from "./undo-stack";

const UNDO_CAP = 10;

export interface CaptureOpts<T extends { id: number }> {
  setter: Dispatch<SetStateAction<readonly T[]>>;
  kind: ActivityKind;
  /** The rows the op touched (deleted rows, or pre-edit before-images). */
  before: readonly T[];
  /** The array as it was BEFORE the op — used to resolve each row's index. */
  fromArray: readonly T[];
}

export interface UndoStackApi {
  capture: <T extends { id: number }>(opts: CaptureOpts<T>) => void;
  undo: () => void;
  undoById: (id: number) => void;
  stack: readonly UndoMeta[];
  canUndo: boolean;
}

export interface UseUndoStackDeps {
  lang: Lang;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  showToastAction: (kind: "info" | "error", text: string, action: ToastAction) => void;
}

export function useUndoStack(deps: UseUndoStackDeps): UndoStackApi {
  const [stack, setStack] = useState<readonly UndoEntry[]>([]);
  const stackRef = useRef(stack);
  useEffect(() => { stackRef.current = stack; }, [stack]);
  const depsRef = useRef(deps);
  useEffect(() => { depsRef.current = deps; }, [deps]);
  const idRef = useRef(0);

  // Run an entry's restore + side effects OUTSIDE any setState updater (strict
  // mode double-invokes updaters → double restore). Caller passes the new stack.
  const commitRestore = useCallback((entry: UndoEntry, nextStack: readonly UndoEntry[]) => {
    entry.restore();
    const { lang, logActivity, showToast } = depsRef.current;
    logActivity("undo", entry.meta.count);
    showToast("info", t(lang, "undoRestored", entry.meta.count));
    setStack(nextStack);
  }, []);

  const undoById = useCallback((id: number) => {
    const s = stackRef.current;
    const entry = s.find((e) => e.meta.id === id);
    if (!entry) return;
    commitRestore(entry, dropEntry(s, id));
  }, [commitRestore]);

  const undo = useCallback(() => {
    const popped = popUndo(stackRef.current);
    if (!popped) return;
    commitRestore(popped.entry, popped.rest);
  }, [commitRestore]);

  const capture = useCallback(<T extends { id: number }>(opts: CaptureOpts<T>) => {
    const { setter, kind, before, fromArray } = opts;
    if (before.length === 0) return;
    const images: BeforeImage<T>[] = before.map((item) => ({
      index: Math.max(0, fromArray.findIndex((r) => r.id === item.id)),
      item,
    }));
    const id = (idRef.current += 1);
    const meta: UndoMeta = { id, kind, count: before.length, timestamp: new Date().toISOString() };
    const restore = () => setter((prev) => applyUndoRestore(prev, images));
    setStack((s) => pushUndo(s, { meta, restore }, UNDO_CAP));
    const { lang, showToastAction } = depsRef.current;
    const isDelete = kind.endsWith(".deleted");
    const text = t(lang, isDelete ? "undoToastDelete" : "undoToastEdit", before.length);
    showToastAction("info", text, { labelKey: "undo", run: () => undoById(id) });
  }, [undoById]);

  const metas = useMemo(() => stack.map((e) => e.meta), [stack]);

  return { capture, undo, undoById, stack: metas, canUndo: stack.length > 0 };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/app/undo/use-undo-stack.test.tsx`
Expected: PASS. (`i18n` keys `undoRestored`/`undoToastDelete`/`undoToastEdit` land in Task 10; tsc flags them until then.)

- [ ] **Step 5: Commit**

```bash
git add src/app/undo/use-undo-stack.ts src/app/undo/use-undo-stack.test.tsx
git commit -m "feat(undo): useUndoStack hook (capture/undo/undoById)"
```

---

## Task 5: Global Ctrl/⌘Z hotkey

**Files:**
- Create: `src/app/use-undo-hotkey.ts`
- Test: `src/app/use-undo-hotkey.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/use-undo-hotkey.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUndoHotkey } from "./use-undo-hotkey";

function press(key: string, opts: Partial<KeyboardEventInit> = {}) {
  const ev = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...opts });
  document.dispatchEvent(ev);
  return ev;
}

describe("useUndoHotkey", () => {
  it("calls undo on Ctrl+Z and prevents default", () => {
    const undo = vi.fn();
    renderHook(() => useUndoHotkey(undo));
    const ev = press("z");
    expect(undo).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("ignores Ctrl+Shift+Z (redo — out of scope)", () => {
    const undo = vi.fn();
    renderHook(() => useUndoHotkey(undo));
    press("z", { shiftKey: true });
    expect(undo).not.toHaveBeenCalled();
  });

  it("does NOT fire while focus is in a text field (native undo wins)", () => {
    const undo = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    renderHook(() => useUndoHotkey(undo));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(undo).not.toHaveBeenCalled();
    input.remove();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/app/use-undo-hotkey.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/app/use-undo-hotkey.ts
"use client";
import { useEffect, useRef } from "react";

/** Editable targets where the browser's native undo must win. */
function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Global Ctrl/⌘+Z → `undo()` (stack top). Ignores Shift (redo is out of scope)
 * and any keystroke inside a text field so native field-undo is untouched.
 * Mirrors the app's ⌘K search shortcut. `undo` is read via a ref so the
 * listener is attached once.
 */
export function useUndoHotkey(undo: () => void): void {
  const undoRef = useRef(undo);
  useEffect(() => { undoRef.current = undo; }, [undo]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return;
      if (e.key !== "z" && e.key !== "Z") return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      undoRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/app/use-undo-hotkey.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-undo-hotkey.ts src/app/use-undo-hotkey.test.ts
git commit -m "feat(undo): global Ctrl/Cmd+Z hotkey (text-field guarded)"
```

---

## Task 6: Top-bar undo control

**Files:**
- Create: `src/app/undo/undo-control.tsx`
- Test: `src/app/undo/undo-control.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/undo/undo-control.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UndoControl } from "./undo-control";

describe("UndoControl", () => {
  it("renders nothing when the stack is empty", () => {
    const { container } = render(<UndoControl lang="en-US" depth={0} onUndo={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a labeled button with the depth and fires onUndo", async () => {
    const onUndo = vi.fn();
    render(<UndoControl lang="en-US" depth={3} onUndo={onUndo} />);
    const btn = screen.getByRole("button", { name: /undo/i });
    expect(btn).toHaveAttribute("aria-label");
    await userEvent.click(btn);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/app/undo/undo-control.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// src/app/undo/undo-control.tsx
"use client";
import { t, type Lang } from "../i18n";
import { INTERACTIVE } from "../interaction-styles";

interface UndoControlProps {
  lang: Lang;
  /** Undo-stack depth; 0 → control renders nothing. */
  depth: number;
  onUndo: () => void;
}

/**
 * Top-bar undo button. Self-hides on an empty stack. Wired into BOTH header
 * mounts (buildShellChrome + AppHeader). In the top bar → axe-scanned every
 * view, so it carries an explicit aria-label. Not rendered in popouts (the
 * caller gates on !isPopout).
 */
export function UndoControl({ lang, depth, onUndo }: UndoControlProps) {
  if (depth <= 0) return null;
  return (
    <button
      type="button"
      onClick={onUndo}
      aria-label={t(lang, "undoTooltip")}
      title={t(lang, "undoTooltip")}
      className={`inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm text-muted-foreground hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey ${INTERACTIVE}`}
    >
      {/* Undo arrow (decorative — aria-label carries the name) */}
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 14L4 9l5-5" />
        <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
      </svg>
      <span>{t(lang, "undo")}</span>
      <span className="rounded-full bg-AIPM-medium-grey px-1.5 text-xs text-white">{depth}</span>
    </button>
  );
}
```

(Verify `border-line`, `text-muted-foreground`, `bg-AIPM-medium-grey` are sanctioned tokens — they are used elsewhere per AGENTS.md. No shadow/gradient.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/app/undo/undo-control.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/undo/undo-control.tsx src/app/undo/undo-control.test.tsx
git commit -m "feat(undo): top-bar undo control"
```

---

## Task 7: Mount in task-manager (hook + hotkey + both headers)

**Files:**
- Modify: `src/app/task-manager.tsx` (~`:169`, ~`:2005` buildShellChrome, after the hook block)
- Modify: `src/app/shell-chrome.tsx` (accept + place an `undoControl` element in both header mounts)
- Modify: `src/app/app-header.tsx` (accept + render the element in the classic header trailing slot)
- Test: none new here (covered by hook/control tests + the wiring is exercised in Tasks 8-11 regressions); run existing suites.

- [ ] **Step 1: Call `useUndoStack` in task-manager**

After `const { toast, showToast, showToastAction } = useToast();` and the `useActivityLog()` block (so `logActivity` exists), add:

```tsx
import { useUndoStack } from "./undo/use-undo-stack";
import { useUndoHotkey } from "./use-undo-hotkey";
import { UndoControl } from "./undo/undo-control";
// …
const undoApi = useUndoStack({ lang, logActivity, showToast, showToastAction });
useUndoHotkey(undoApi.undo);
```

- [ ] **Step 2: Build the control element (gated on !isPopout)**

```tsx
const undoControlEl = isPopout ? null : (
  <UndoControl lang={lang} depth={undoApi.stack.length} onUndo={undoApi.undo} />
);
```

- [ ] **Step 3: Thread into `buildShellChrome`**

Pass `undoControl: undoControlEl` in the `buildShellChrome({ … })` call (`:2005`). In `shell-chrome.tsx`, add `undoControl?: React.ReactNode` to its params and render it in the `topBarMenus` cluster AND in the `appHeaderEl` (`<AppHeader … undoControl={undoControl} />`) so both layouts show it. Place it left of the existing trailing controls (near the search box / Ask-Claude), consistent with the display-tz switcher precedent.

- [ ] **Step 4: Render in `app-header.tsx`**

Add `undoControl?: React.ReactNode` to `AppHeaderProps` and render `{undoControl}` in the trailing controls row (beside the existing `trailing` slot).

- [ ] **Step 5: Thread `capture` for later tasks**

Pass `undoApi.capture` into the entity-hook args that Tasks 8-11 consume. Concretely add `capture: undoApi.capture` to the args objects of:
`useBulkOperations({...})`, `useTaskRowHandlers({...})`, `useResourcePlanner({...})` (`:593`), `useChangeLog({...})` (`:596`), `useStakeholders({...})` (`:602`). (The hooks accept it in Tasks 8-11; adding the prop now is harmless — TS will flag until each hook's args type is widened, so it's cleanest to add each prop in its own task. **Defer the actual prop-passing to each entity task** to keep tsc green between commits.)

- [ ] **Step 6: Verify build + a11y**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` (spot-check the top bar with the control mounted — it's empty-stack/hidden at scan time, but confirm no regression). Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/task-manager.tsx src/app/shell-chrome.tsx src/app/app-header.tsx
git commit -m "feat(undo): mount stack + hotkey + top-bar control in both headers"
```

---

## Task 8: Capture task deletes, clear-all, bulk-edit

**Files:**
- Modify: `src/app/use-task-row-handlers.ts` (args + `onDelete`)
- Modify: `src/app/use-bulk-operations.ts` (args + `handleClearAll` + `applyBulkEdit`)
- Modify: `src/app/task-manager.tsx` (pass `capture` into both hooks' args)
- Test: `src/app/use-task-row-handlers.test.ts`, `src/app/use-bulk-operations.test.tsx` (extend)

- [ ] **Step 1: Write failing tests**

In `use-task-row-handlers.test.ts` — a delete captures the doomed task AND dependents:

```ts
it("captures the deleted task plus dependents whose dependency was stripped", () => {
  const capture = vi.fn();
  // build args with capture + a tasksRef holding: #2 (doomed) and #3 depending on #2
  // (reuse the file's existing arg factory; add capture + stub window.confirm → true)
  // …invoke onDelete(2)…
  expect(capture).toHaveBeenCalledWith(expect.objectContaining({
    kind: "task.deleted",
    before: expect.arrayContaining([
      expect.objectContaining({ id: 2 }),
      expect.objectContaining({ id: 3 }),
    ]),
  }));
});
```

In `use-bulk-operations.test.tsx` — clear-all captures all tasks; bulk-edit captures the selected rows' before-images:

```ts
it("handleClearAll captures every task before clearing", () => {
  // seed 3 tasks; call handleClearAll; expect capture before-images length 3
});
it("applyBulkEdit captures the selected rows' pre-edit images", () => {
  // select 2 rows; enable a field; apply; expect capture before = the 2 pre-edit rows
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:run -- src/app/use-task-row-handlers.test.ts src/app/use-bulk-operations.test.tsx`
Expected: FAIL — `capture` undefined / not called.

- [ ] **Step 3: Implement `use-task-row-handlers.ts`**

Add to `UseTaskRowHandlersArgs`:

```ts
capture: <T extends { id: number }>(opts: { setter: React.Dispatch<React.SetStateAction<readonly T[]>>; kind: import("./activity-log").ActivityKind; before: readonly T[]; fromArray: readonly T[] }) => void;
```

Destructure `capture` from `args`. In `onDelete` (`:268`), BEFORE `setTasks`:

```ts
const arr = tasksRef.current;
const doomed = arr.find((tk) => tk.id === id);
if (doomed) {
  const dependents = arr.filter((tk) => tk.dependencies?.some((d) => d.taskId === id));
  capture({ setter: setTasks, kind: "task.deleted", before: [doomed, ...dependents], fromArray: arr });
}
```

(Import the `CaptureOpts` type instead of inlining if cleaner: `import type { CaptureOpts } from "./undo/use-undo-stack";` and type `capture: <T extends {id:number}>(o: CaptureOpts<T>) => void`.)

- [ ] **Step 4: Implement `use-bulk-operations.ts`**

Add `capture` to `UseBulkOperationsArgs` (same signature). In `handleClearAll` (`:207`), BEFORE `setTasks([])`:

```ts
if (tasks.length > 0) capture({ setter: setTasks, kind: "task.deleted", before: tasks, fromArray: tasks });
```

In `applyBulkEdit` (`:143`), after the guards pass and BEFORE `setTasks((prev) => …)` — capture the selected rows' pre-edit images (skip fully-untouched synced rows for count parity is unnecessary; capture all selected, revert is idempotent):

```ts
const beforeRows = tasks.filter((r) => selectedIds.has(r.id));
if (beforeRows.length > 0) capture({ setter: setTasks, kind: "bulk.edit", before: beforeRows, fromArray: tasks });
```

Add `capture` to the two hooks' `useCallback` dep arrays where referenced.

- [ ] **Step 5: Pass `capture` from task-manager**

Add `capture: undoApi.capture` to the `useBulkOperations({...})` and `useTaskRowHandlers({...})` args objects.

- [ ] **Step 6: Run to verify they pass**

Run: `npm run test:run -- src/app/use-task-row-handlers.test.ts src/app/use-bulk-operations.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit` → exit 0.

```bash
git add src/app/use-task-row-handlers.ts src/app/use-bulk-operations.ts src/app/task-manager.tsx src/app/use-task-row-handlers.test.ts src/app/use-bulk-operations.test.tsx
git commit -m "feat(undo): capture task delete (with dependents), clear-all, bulk-edit"
```

---

## Task 9: Capture Changes + Stakeholders (delete + bulk)

**Files:**
- Modify: `src/app/use-change-log.ts` (args + `handleDeleteChange`)
- Modify: `src/app/use-stakeholders.ts` (args + delete handler)
- Modify: `src/app/change-panel.tsx`, `src/app/stakeholders-panel.tsx` (bulk `onApply` capture — needs `capture` threaded)
- Modify: `src/app/workspace-section-types.ts`, `src/app/workspace-section.tsx` (thread `capture` to those panels)
- Modify: `src/app/task-manager.tsx` (pass `capture` into `useChangeLog`/`useStakeholders` args + into `WorkspaceSectionProps`)
- Test: `src/app/use-change-log.test.tsx`, `src/app/use-stakeholders.test.tsx` (extend)

- [ ] **Step 1: Write failing tests**

`use-change-log.test.tsx`:

```ts
it("captures the deleted change before removing it", () => {
  const capture = vi.fn();
  // render useChangeLog with capture + a changes array via workspace; call handleDeleteChange(id,title)
  expect(capture).toHaveBeenCalledWith(expect.objectContaining({
    kind: "change.deleted",
    before: [expect.objectContaining({ id: /*deleted id*/ 1 })],
  }));
});
```

`use-stakeholders.test.tsx`: analogous with `kind: "stakeholder.deleted"`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:run -- src/app/use-change-log.test.tsx src/app/use-stakeholders.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `use-change-log.ts`**

Add `capture` to its args type. In `handleDeleteChange` (`:68`):

```ts
const doomed = changes.find((c) => c.id === id);
if (doomed) capture({ setter: setChanges, kind: "change.deleted", before: [doomed], fromArray: changes });
setChanges((prev) => prev.filter((c) => c.id !== id));
```

(`changes`/`setChanges` come from `useWorkspace()` in the hook — confirm they're in scope; if the hook reads them via `useWorkspace`, use those.)

- [ ] **Step 4: Implement `use-stakeholders.ts`** — same shape with `stakeholder.deleted`, `stakeholders`/`setStakeholders`.

- [ ] **Step 5: Bulk-edit capture in the panels**

`change-panel.tsx` and `stakeholders-panel.tsx` own the bulk `onApply` loop. Add an optional `onCaptureUndo?: CaptureOpts-capture` prop (thread via `WorkspaceSectionProps` → `workspace-section.tsx` → the panel). In each panel's bulk-apply handler, BEFORE the per-row save loop:

```ts
const beforeRows = items.filter((r) => selectedIds.has(r.id));  // items = changes / stakeholders (live)
if (beforeRows.length > 0) onCaptureUndo?.({ setter: setChanges /* or setStakeholders */, kind: "change.edit"/*or a bulk kind*/, before: beforeRows, fromArray: items });
```

Use `kind: "bulk.edit"` for both (the existing generic bulk kind) to avoid new activity kinds. The setter is the workspace setter the panel already uses to persist bulk results.

- [ ] **Step 6: Thread from task-manager**

Add `capture: undoApi.capture` to `useChangeLog`/`useStakeholders` args, and pass `capture={undoApi.capture}` into `WorkspaceSectionProps` (renamed to whatever prop name the panels expect, e.g. `onCaptureUndo`).

- [ ] **Step 7: Run + typecheck + commit**

Run: `npm run test:run -- src/app/use-change-log.test.tsx src/app/use-stakeholders.test.tsx` → PASS.
Run: `npx tsc --noEmit` → exit 0.

```bash
git add src/app/use-change-log.ts src/app/use-stakeholders.ts src/app/change-panel.tsx src/app/stakeholders-panel.tsx src/app/workspace-section-types.ts src/app/workspace-section.tsx src/app/task-manager.tsx src/app/use-change-log.test.tsx src/app/use-stakeholders.test.tsx
git commit -m "feat(undo): capture change + stakeholder delete and bulk-edit"
```

---

## Task 10: Capture RAID / resources / roles / disciplines / grades / absences / shifts / milestones

**Files:**
- Modify: `src/app/use-resource-planner.ts` (delete handlers for RAID + resource + role + discipline + grade + absence + shift, and RAID bulk)
- Modify: `src/app/milestones-panel.tsx` (inline delete + bulk `onApply`)
- Modify: `src/app/raid-panel.tsx` (bulk `onApply` if the RAID bulk loop lives in the panel)
- Modify: `src/app/task-manager.tsx` (pass `capture` into `useResourcePlanner` args + milestones/raid panel props via `WorkspaceSectionProps`)
- Test: `src/app/use-resource-planner.test.tsx`, `src/app/milestones-panel.test.tsx` (extend)

- [ ] **Step 1: Write failing tests**

`use-resource-planner.test.tsx` — one per delete kind is ideal; at minimum RAID + resource + absence:

```ts
it("captures the deleted RAID item", () => {
  const capture = vi.fn();
  // …invoke the RAID delete handler with a seeded raid array…
  expect(capture).toHaveBeenCalledWith(expect.objectContaining({ kind: "raid.deleted", before: [expect.objectContaining({ id: 1 })] }));
});
// analogous: resource.deleted, absence.deleted, shift.deleted, role.deleted, discipline.deleted(?), grade.deleted(?)
```

`milestones-panel.test.tsx`:

```ts
it("captures the deleted milestone before removing it", () => {
  // render the panel with an onCaptureUndo spy + one milestone; click delete; expect capture kind "milestone.deleted"
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:run -- src/app/use-resource-planner.test.tsx src/app/milestones-panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement each delete handler in `use-resource-planner.ts`**

For every entity's delete handler, insert the capture before the filtering setter. Exact pattern per entity (find each handler; `X`/`setX`/kind vary):

```ts
// RAID
const doomedRaid = raid.find((r) => r.id === id);
if (doomedRaid) capture({ setter: setRaid, kind: "raid.deleted", before: [doomedRaid], fromArray: raid });
// Resource
const doomedRes = resources.find((r) => r.id === id);
if (doomedRes) capture({ setter: setResources, kind: "resource.deleted", before: [doomedRes], fromArray: resources });
// Role
const doomedRole = roles.find((r) => r.id === id);
if (doomedRole) capture({ setter: setRoles, kind: "role.deleted", before: [doomedRole], fromArray: roles });
// Discipline (no dedicated activity kind → use nearest; if none, reuse "resource.deleted" is WRONG — see note)
// Grade — same note
// Absence
const doomedAbs = absences.find((a) => a.id === id);
if (doomedAbs) capture({ setter: setAbsences, kind: "absence.deleted", before: [doomedAbs], fromArray: absences });
// Shift
const doomedShift = shifts.find((s) => s.id === id);
if (doomedShift) capture({ setter: setShifts, kind: "shift.deleted", before: [doomedShift], fromArray: shifts });
```

**Note on discipline/grade:** `ActivityKind` has no `discipline.deleted`/`grade.deleted`. The `kind` on an undo capture is used ONLY for the delete-vs-edit toast text (`endsWith(".deleted")`), never rendered as an activity line at capture time. Passing an existing `.deleted` kind (e.g. `role.deleted`) would mislabel nothing user-visible, but for cleanliness add `discipline.deleted`/`grade.deleted` to `ActivityKind` + `ACTIVITY_KIND_TO_KEY` + i18n **only if** these deletes should also appear in the activity log independently. **Decision (YAGNI): reuse `role.deleted` kind for discipline/grade undo capture is NOT acceptable (wrong semantics). Instead pass `kind: "resource.deleted"` is also wrong. Simplest correct: skip discipline/grade undo** (reference data, deleted rarely, and the finding centers on registers). Document this exclusion in the release notes. If the reviewer insists, add the two kinds in a follow-up.

RAID bulk-edit: if RAID has a bulk apply (per bulk-edit-moorcock), capture in `raid-panel.tsx`'s `onApply` before the loop (same pattern as Task 9 panels): `before = raid.filter(r => selectedIds.has(r.id))`, `kind: "bulk.edit"`.

- [ ] **Step 4: Implement `milestones-panel.tsx`**

Inline delete `save()`/delete handler: capture the doomed milestone before removal. Bulk `onApply`: capture selected before-images. Thread `onCaptureUndo` via `WorkspaceSectionProps`.

- [ ] **Step 5: Thread from task-manager**

Add `capture: undoApi.capture` to `useResourcePlanner` args (`:593`); pass `capture`/`onCaptureUndo` to the milestones + raid panels via `WorkspaceSectionProps`.

- [ ] **Step 6: Run + typecheck + commit**

Run: `npm run test:run -- src/app/use-resource-planner.test.tsx src/app/milestones-panel.test.tsx` → PASS.
Run: `npx tsc --noEmit` → exit 0.

```bash
git add src/app/use-resource-planner.ts src/app/milestones-panel.tsx src/app/raid-panel.tsx src/app/workspace-section-types.ts src/app/workspace-section.tsx src/app/task-manager.tsx src/app/use-resource-planner.test.tsx src/app/milestones-panel.test.tsx
git commit -m "feat(undo): capture RAID/resource/absence/shift/role deletes + milestone delete/bulk"
```

---

## Task 11: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add EN keys (`i18n.ts`)**

Add (positional `{0}` = count):

```ts
undo: "Undo",
undoTooltip: "Undo last change",
undoRestored: "Restored {0} item(s)",
undoToastDelete: "Deleted {0} item(s)",
undoToastEdit: "Edited {0} item(s)",
activityUndo: "Undo: restored {0} item(s)",
```

- [ ] **Step 2: Add DE keys via node (CRLF + real umlauts)**

`i18n.de.ts` is CRLF — do NOT use the Edit tool (corrupts umlauts). Write a scratchpad node script that reads the file, inserts the block after an anchor line (match with `\r\n`), and writes UTF-8. Values:

```
undo: "Rückgängig",
undoTooltip: "Letzte Änderung rückgängig machen",
undoRestored: "{0} Element(e) wiederhergestellt",
undoToastDelete: "{0} Element(e) gelöscht",
undoToastEdit: "{0} Element(e) bearbeitet",
activityUndo: "Rückgängig: {0} Element(e) wiederhergestellt",
```

Use `\uXXXX` escapes in the node string for the umlauts (ü=ü, Ä=Ä, ö=ö) to avoid shell-encoding corruption; verify with `grep` after that real umlauts (not `ue`/`ae`) are present.

- [ ] **Step 3: Verify parity + encoding**

Run: `npx tsc --noEmit` (enforces EN/DE key parity) → exit 0.
Run: `npm run test:run -- i18n-encoding` → PASS (bans ASCII umlaut subs).

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(undo): EN/DE strings for undo + activity"
```

---

## Task 12: Full gate sweep

- [ ] **Step 1: Typecheck** — `npx tsc --noEmit` → exit 0.
- [ ] **Step 2: Lint (changed files strict)** — `npx eslint --max-warnings=0 src/app/undo src/app/use-undo-hotkey.ts src/app/use-toast.ts src/app/toast-context.tsx src/app/use-task-row-handlers.ts src/app/use-bulk-operations.ts src/app/use-change-log.ts src/app/use-stakeholders.ts src/app/use-resource-planner.ts` → exit 0.
- [ ] **Step 3: Full unit suite** — `npm run test:run` → all green.
- [ ] **Step 4: Size ratchet** — `npm run size:check`. If `task-manager.tsx` or any modified file tripped the ratchet, run `node scripts/check-file-sizes.mjs --update` ONLY for legitimate growth and commit the baseline.
- [ ] **Step 5: Duplication** — `npm run dup:check` → within threshold (the per-entity capture 2-liners are near-identical; if jscpd flags them, that's acceptable boilerplate — confirm it doesn't cross the gate, else extract a tiny `captureDelete(capture, setter, kind, arr, id)` helper in `undo/undo-stack.ts` and reuse).
- [ ] **Step 6: axe (top bar in every view)** — `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` and `-g "Open Points"` → PASS (the undo control is empty-stack/hidden at scan time; confirm no regression from the header wiring).
- [ ] **Step 7: Commit any baseline update**

```bash
git add -A
git commit -m "chore(undo): size baseline + gate sweep"
```

---

## Verification (end-to-end, manual)

- Delete a task → toast "Deleted 1 item(s) · Undo" → click Undo → task reappears (dependencies restored on dependents). Ctrl+Z on a second delete → walks back. Top-bar control shows depth, click undoes top.
- Bulk-edit 5 tasks → Undo reverts all five to pre-edit values, leaving an interleaved edit to a 6th task intact.
- Clear-all → Undo restores the full list.
- Ctrl+Z inside the search box / a text field → native field undo, NOT app undo.
- Reload → stack empty (in-memory by design). Popout → no control, no capture.
- Repeat for RAID / change / stakeholder / milestone / resource / absence deletes.

## Out of scope (future)
- Redo · persistent (cross-reload) undo · undo of AI write-tool / inline-AI-edit mutations · discipline/grade deletes (reference data).
```
