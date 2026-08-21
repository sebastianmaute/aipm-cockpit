# Table Column Resize + Task Modal Height (0.17.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the existing tasks-only column-resize machinery into a per-table hook, roll it out to 11 tables (reset button on 9 tall ones), and bump the task form modal's default height.

**Architecture:** New `useColumnResize<TId>(tableId, defaults)` hook (mirrors the existing `useColumnManager`'s resize/persist/reset code with a namespaced localStorage key); a new standalone `<ColumnResizeHandle>` primitive in `task-manager-ui.tsx` that any `<th>` can host; per-table integration adds `_COL_WIDTHS` defaults const + the hook + inline width styles + the handle (+ a `<ResetColWidthsButton>` for tall tables).

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-28-table-column-resize-design.md`
**Branch:** `feat/0.17.0-table-column-resize` (already created off `main`).

> **Heads-up for the implementer subagent:**
> 1. **Fact-forcing gate.** Before FIRST shell command print 2 facts (task + command purpose). Before EVERY Edit, in the SAME message print 4 facts — (a) importers (Grep the component/hook name in same turn), (b) symbols affected, (c) data fields (none for this work), (d) instruction verbatim: "adjust the design to follow the following table:". Then retry the Edit.
> 2. **win32** — Bash tool, no `&&`-chained `cd`, don't touch eslint.config.mjs.
> 3. After test runs, if `git status` shows `src/app/sample-workspace.md` dirty, `git restore src/app/sample-workspace.md` BEFORE committing.
> 4. **Surface tokens / palette rules from 0.16.0 still apply** — no zinc/shadow/off-palette colors; tables stay on Workload's `px-3 py-2` recipe from 0.16.1.
> 5. The existing `<Th>` and `<SortableTh>` in `task-manager-ui.tsx` use `px-4 py-2` and stay tasks-only. Do NOT migrate other tables to those wrappers — add the standalone `<ColumnResizeHandle>` to each table's existing `<th>` markup.

---

## Task 1: Create `useColumnResize` hook

**Files:**
- Create: `src/app/use-column-resize.ts`
- Create: `src/app/use-column-resize.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/use-column-resize.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useColumnResize } from "./use-column-resize";

const KEY = (id: string) => `lop-app:col-widths:${id}`;

const DEFAULTS = { a: 100, b: 200 } as const;

describe("useColumnResize", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns defaults when localStorage is empty", () => {
    const { result } = renderHook(() => useColumnResize("t1", DEFAULTS));
    expect(result.current.colWidths).toEqual(DEFAULTS);
  });

  it("merges persisted widths over defaults (extras ignored, missing filled)", async () => {
    localStorage.setItem(KEY("t1"), JSON.stringify({ a: 333, x: 999 }));
    const { result } = renderHook(() => useColumnResize("t1", DEFAULTS));
    await act(async () => {});
    expect(result.current.colWidths.a).toBe(333);
    expect(result.current.colWidths.b).toBe(200);
  });

  it("resize updates state and clamps to 40 px min", () => {
    const { result } = renderHook(() => useColumnResize("t1", DEFAULTS));
    const ev = { clientX: 100, preventDefault: () => {} } as unknown as React.MouseEvent;
    act(() => {
      result.current.startColResize("a", ev);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 50 }));
    });
    expect(result.current.colWidths.a).toBe(50);
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: -200 }));
    });
    expect(result.current.colWidths.a).toBe(40);
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
  });

  it("reset replaces state with defaults and removes the namespaced key", async () => {
    localStorage.setItem(KEY("t1"), JSON.stringify({ a: 999 }));
    const { result } = renderHook(() => useColumnResize("t1", DEFAULTS));
    await act(async () => {});
    act(() => {
      result.current.resetColWidths();
    });
    expect(result.current.colWidths).toEqual(DEFAULTS);
    expect(localStorage.getItem(KEY("t1"))).toBeNull();
  });

  it("two different tableIds use independent storage keys", async () => {
    localStorage.setItem(KEY("a1"), JSON.stringify({ a: 111 }));
    localStorage.setItem(KEY("a2"), JSON.stringify({ a: 222 }));
    const r1 = renderHook(() => useColumnResize("a1", DEFAULTS));
    const r2 = renderHook(() => useColumnResize("a2", DEFAULTS));
    await act(async () => {});
    expect(r1.result.current.colWidths.a).toBe(111);
    expect(r2.result.current.colWidths.a).toBe(222);
  });

  it("persists colWidths to the namespaced key after 250 ms debounce", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useColumnResize("t1", DEFAULTS));
    await act(async () => { vi.runAllTimers(); });
    localStorage.removeItem(KEY("t1"));

    const ev = { clientX: 100, preventDefault: () => {} } as unknown as React.MouseEvent;
    act(() => {
      result.current.startColResize("a", ev);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 200 }));
    });
    expect(localStorage.getItem(KEY("t1"))).toBeNull();

    act(() => { vi.advanceTimersByTime(250); });
    const stored = JSON.parse(localStorage.getItem(KEY("t1")) ?? "{}") as Record<string, number>;
    expect(stored.a).toBe(200);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run use-column-resize
```
Expected: FAIL with "Cannot find module './use-column-resize'".

- [ ] **Step 3: Create the hook**

Create `src/app/use-column-resize.ts`:

```ts
// src/app/use-column-resize.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const KEY_PREFIX = "lop-app:col-widths";

export function useColumnResize<TId extends string>(
  tableId: string,
  defaults: Readonly<Record<TId, number>>,
): {
  colWidths: Record<TId, number>;
  startColResize: (col: TId, e: React.MouseEvent) => void;
  resetColWidths: () => void;
} {
  const storageKey = `${KEY_PREFIX}:${tableId}`;
  const [colWidths, setColWidths] = useState<Record<TId, number>>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return { ...defaults, ...(parsed as Record<TId, number>) };
        }
      }
    } catch { /* non-fatal */ }
    return { ...defaults };
  });

  const dragRef = useRef<{ col: TId; startX: number; startW: number } | null>(null);
  const colWidthsRef = useRef(colWidths);
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);

  // Debounced persist (250 ms): drag fires setColWidths on every mousemove,
  // so without the timeout we'd write localStorage ~60x/sec.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(colWidths));
      } catch { /* non-fatal */ }
    }, 250);
    return () => clearTimeout(id);
  }, [colWidths, storageKey]);

  const resetColWidths = useCallback(() => {
    setColWidths({ ...defaults });
    try { window.localStorage.removeItem(storageKey); } catch { /* non-fatal */ }
  }, [defaults, storageKey]);

  const startColResize = useCallback((col: TId, e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      col,
      startX: e.clientX,
      startW: colWidthsRef.current[col] ?? defaults[col] ?? 80,
    };
    function onMove(mv: MouseEvent) {
      if (!dragRef.current) return;
      const { col: c, startX, startW } = dragRef.current;
      setColWidths((prev) => ({
        ...prev,
        [c]: Math.max(40, startW + mv.clientX - startX),
      }));
    }
    function onUp() {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [defaults]);

  return { colWidths, startColResize, resetColWidths };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx vitest run use-column-resize
```
Expected: PASS (6 tests).

- [ ] **Step 5: Gates**

```bash
npx tsc --noEmit
npm run lint
```
Expected: 0 errors each. Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-column-resize.ts src/app/use-column-resize.test.ts
git commit -m "feat(table): generic useColumnResize hook with per-table localStorage namespace"
```

---

## Task 2: Extract shared primitives (`ColumnResizeHandle`, `ResetColWidthsButton`)

**Files:**
- Modify: `src/app/task-manager-ui.tsx` (add two exports)
- Modify: `src/app/tasks-section.tsx` (replace the inline reset-widths button with the new shared component)

- [ ] **Step 1: Add `ColumnResizeHandle` to `task-manager-ui.tsx`**

Insert just before the existing `Th` export (around L158):

```tsx
/** Drag handle on the right edge of a <th>. Host th MUST be `relative`. */
export function ColumnResizeHandle({
  col,
  onMouseDown,
}: {
  col: string;
  onMouseDown: (col: string, e: React.MouseEvent) => void;
}) {
  return (
    <div
      aria-hidden="true"
      onMouseDown={(e) => onMouseDown(col, e)}
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-AIPM-dark-blue/40 dark:hover:bg-AIPM-blue/40"
    />
  );
}
```

- [ ] **Step 2 (optional DRY): Refactor `Th` and `SortableTh` to use `ColumnResizeHandle`**

Replace the inline `<div onMouseDown={onResize} className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-AIPM-dark-blue/40 dark:hover:bg-AIPM-blue/40" />` block in both `<Th>` (~L168–173) and `<SortableTh>` (~L210–215) with:

```tsx
{onResize && (
  <ColumnResizeHandle col="" onMouseDown={(_col, e) => onResize(e)} />
)}
```

This is a behaviour-preserving DRY cleanup. Skip if it causes test-assertion churn that's not worth the saved 4 lines.

- [ ] **Step 3: Add `ResetColWidthsButton`**

Append at end of `task-manager-ui.tsx`:

```tsx
export function ResetColWidthsButton({
  onClick,
  lang,
}: {
  onClick: () => void;
  lang: Lang;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t(lang, "colResetWidthsHint")}
      title={t(lang, "colResetWidthsHint")}
      className="rounded-md border border-line bg-surface p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
    >
      <ResetColWidthsIcon />
    </button>
  );
}
```

If `Lang` and `t` are not yet imported at the top of the file, add them: `import { type Lang, t } from "./i18n";`.

- [ ] **Step 4: Refactor tasks-section to use the shared button**

In `src/app/tasks-section.tsx`, find the existing inline reset-widths button (~L311–319):

```tsx
<button
  type="button"
  onClick={resetColWidths}
  aria-label={t(lang, "colResetWidthsHint")}
  title={t(lang, "colResetWidthsHint")}
  className="rounded-md border border-line bg-surface p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
>
  <ResetColWidthsIcon />
</button>
```

Replace with:

```tsx
<ResetColWidthsButton onClick={resetColWidths} lang={lang} />
```

Update the import from `./task-manager-ui` to include `ResetColWidthsButton`. Grep the rest of `tasks-section.tsx` for `ResetColWidthsIcon` — if no other usage remains, remove it from the import too.

- [ ] **Step 5: Tests**

```bash
npx vitest run tasks-section task-manager-ui
```
Expected: PASS. If `tasks-section.test.tsx` asserts on the exact reset-button JSX, update the assertion.

- [ ] **Step 6: Gates**

```bash
npx tsc --noEmit
npm run lint
```
Expected: 0 errors each. Restore `sample-workspace.md` if dirty.

- [ ] **Step 7: Commit**

```bash
git add src/app/task-manager-ui.tsx src/app/tasks-section.tsx
git add src/app/tasks-section.test.tsx 2>/dev/null || true
git commit -m "feat(table): extract ColumnResizeHandle + ResetColWidthsButton primitives"
```

---

## Task 3: Roll out to Directory + Workload

**Files:**
- Modify: `src/app/resource-directory.tsx`
- Modify: `src/app/resource-workload.tsx`

### Directory

- [ ] **Step 1: Read the current Directory thead + a sample tr**

Read `src/app/resource-directory.tsx` lines 200–270 to confirm the th structure before editing.

- [ ] **Step 2: Add defaults + hook**

Add near the top of the file, AFTER the existing imports:

```ts
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle, ResetColWidthsButton } from "./task-manager-ui";

const DIRECTORY_COL_WIDTHS = {
  name: 180,
  discipline: 120,
  grade: 100,
  title: 160,
  department: 140,
  phone: 120,
  email: 180,
  birthday: 90,
} as const;
type DirectoryCol = keyof typeof DIRECTORY_COL_WIDTHS;
```

Inside `ResourceDirectoryInner` (before the `return`):

```ts
const { colWidths, startColResize, resetColWidths } = useColumnResize<DirectoryCol>(
  "directory",
  DIRECTORY_COL_WIDTHS,
);
```

- [ ] **Step 3: Apply widths + handles to each `<th>`**

For each of the 8 column headers (~L204–243), update the className to include `relative` (the th must be `relative` for the handle's `absolute` positioning), add `style={{ width: colWidths.X, minWidth: colWidths.X }}`, and append `<ColumnResizeHandle col="X" onMouseDown={startColResize} />` as the last child.

Example (name column header, ~L204):

```tsx
<th
  className="relative px-3 py-2 font-medium"
  style={{ width: colWidths.name, minWidth: colWidths.name }}
>
  <button type="button" onClick={() => toggleSort("name")} aria-label={t(lang, "sortBy", t(lang, "assignee"))} title={t(lang, "sortBy", t(lang, "assignee"))} className="hover:text-foreground">
    {t(lang, "assignee")}{sortIndicator("name")}
  </button>
  <ColumnResizeHandle col="name" onMouseDown={startColResize} />
</th>
```

Apply the same pattern to: `discipline` (~L209), `grade` (~L214), `title` (~L219), `department` (~L224), `phone` (~L229), `email` (~L234), `birthday` (~L239).

- [ ] **Step 4: Add the reset button to the Directory toolbar**

In the toolbar block (~L168–194, the `<div className="mb-2 flex shrink-0 items-center gap-2">`), add the reset button after the search input and before the `onOpenAddressBook` button:

```tsx
<ResetColWidthsButton onClick={resetColWidths} lang={lang} />
```

- [ ] **Step 5: Verify columns visibly resize (manual check note)**

If during testing the inline width has no effect, switch the `<table>` to `table-fixed`: change `<table className="w-full text-left text-sm">` (~L201) to `<table className="w-full table-fixed text-left text-sm">`. Tasks-table works under `table-auto` so this should not be necessary, but it's the fallback.

### Workload

- [ ] **Step 6: Add defaults + hook to Workload**

In `src/app/resource-workload.tsx`, add after existing imports:

```ts
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle, ResetColWidthsButton } from "./task-manager-ui";

const WORKLOAD_COL_WIDTHS = {
  assignee: 160,
  email: 180,
  openTasks: 110,
  overdue: 110,
  weeklyHours: 120,
  upcoming: 200,
} as const;
type WorkloadCol = keyof typeof WORKLOAD_COL_WIDTHS;
```

Inside `ResourceWorkload` (before the `return`):

```ts
const { colWidths, startColResize, resetColWidths } = useColumnResize<WorkloadCol>(
  "workload",
  WORKLOAD_COL_WIDTHS,
);
```

Add a small toolbar div above the existing `<div className="min-h-0 flex-1 overflow-auto rounded-md border border-line">` wrapper (~L43):

```tsx
<div className="mb-2 flex shrink-0 items-center justify-end">
  <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
</div>
```

- [ ] **Step 7: Apply widths + handles to each Workload `<th>`**

For each of the 6 column headers (~L46–60), update the className from `"px-3 py-2 font-medium"` to `"relative px-3 py-2 font-medium"` (or `"relative px-3 py-2 font-medium text-right"` for right-aligned headers), add `style={{ width: colWidths.<col>, minWidth: colWidths.<col> }}`, and append `<ColumnResizeHandle col="<col>" onMouseDown={startColResize} />`.

Example assignee header:

```tsx
<th
  className="relative px-3 py-2 font-medium"
  style={{ width: colWidths.assignee, minWidth: colWidths.assignee }}
>
  {t(lang, "assignee")}
  <ColumnResizeHandle col="assignee" onMouseDown={startColResize} />
</th>
```

Apply to: `email`, `openTasks`, `overdue`, `weeklyHours`, `upcoming` (each binding to its colWidths key + handle col).

- [ ] **Step 8: Gates + tests**

```bash
npx vitest run resource-directory resource-workload
npx tsc --noEmit
npm run lint
```
Expected: PASS, 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 9: Commit**

```bash
git add src/app/resource-directory.tsx src/app/resource-workload.tsx
git add src/app/resource-directory.test.tsx src/app/resource-workload.test.tsx 2>/dev/null || true
git commit -m "feat(table): column resize on Directory + Workload tabs"
```

---

## Task 4: Roll out to Planning + Rollup

**Files:** Modify `src/app/resources-panel.tsx`.

Planning + Rollup share the same `<ResourcesPanel>` parent. One hook per table; ONE toolbar button placed in the panel header that resets both when clicked.

- [ ] **Step 1: Add defaults + two hooks**

Near the top of `resources-panel.tsx`, after existing imports:

```ts
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle, ResetColWidthsButton } from "./task-manager-ui";

const PLANNING_COL_WIDTHS = {
  assignee: 160,
  period: 100,
  capacityDays: 110,
  internalCost: 120,
  externalCost: 120,
  margin: 100,
} as const;
type PlanningCol = keyof typeof PLANNING_COL_WIDTHS;

const ROLLUP_COL_WIDTHS = {
  assignee: 160,
  period: 100,
} as const;
type RollupCol = keyof typeof ROLLUP_COL_WIDTHS;
```

Inside `ResourcesPanelInner` (before the `return`):

```ts
const planning = useColumnResize<PlanningCol>("planning", PLANNING_COL_WIDTHS);
const rollup = useColumnResize<RollupCol>("rollup", ROLLUP_COL_WIDTHS);
const resetPlanningAndRollup = () => {
  planning.resetColWidths();
  rollup.resetColWidths();
};
```

- [ ] **Step 2: Apply widths + handles to the Planning th cells (~L346–353)**

```tsx
<th
  className="relative px-3 py-2 font-medium"
  style={{ width: planning.colWidths.assignee, minWidth: planning.colWidths.assignee }}
>
  {t(lang, "assignee")}
  <ColumnResizeHandle col="assignee" onMouseDown={planning.startColResize} />
</th>
{periods.map((p) => (
  <th
    key={p.key}
    className="relative px-3 py-2 text-right font-medium tabular-nums"
    style={{ width: planning.colWidths.period, minWidth: planning.colWidths.period }}
  >
    {p.key}
    <ColumnResizeHandle col="period" onMouseDown={planning.startColResize} />
  </th>
))}
<th
  className="relative px-3 py-2 text-right font-medium"
  style={{ width: planning.colWidths.capacityDays, minWidth: planning.colWidths.capacityDays }}
  title={t(lang, "resourcesCapacityDaysHint")}
>
  {t(lang, "resourcesCapacityDays")}
  <ColumnResizeHandle col="capacityDays" onMouseDown={planning.startColResize} />
</th>
<th
  className="relative px-3 py-2 text-right font-medium"
  style={{ width: planning.colWidths.internalCost, minWidth: planning.colWidths.internalCost }}
  title={t(lang, "resourcesInternalCostHint")}
>
  {t(lang, "resourcesInternalCost")}
  <ColumnResizeHandle col="internalCost" onMouseDown={planning.startColResize} />
</th>
<th
  className="relative px-3 py-2 text-right font-medium"
  style={{ width: planning.colWidths.externalCost, minWidth: planning.colWidths.externalCost }}
  title={t(lang, "resourcesExternalCostHint")}
>
  {t(lang, "resourcesExternalCost")}
  <ColumnResizeHandle col="externalCost" onMouseDown={planning.startColResize} />
</th>
<th
  className="relative px-3 py-2 text-right font-medium"
  style={{ width: planning.colWidths.margin, minWidth: planning.colWidths.margin }}
  title={t(lang, "resourcesMarginHint")}
>
  {t(lang, "resourcesMargin")}
  <ColumnResizeHandle col="margin" onMouseDown={planning.startColResize} />
</th>
```

- [ ] **Step 3: Apply widths + handles to the Rollup th cells (~L451–453)**

```tsx
<th
  className="relative px-3 py-2 font-medium"
  style={{ width: rollup.colWidths.assignee, minWidth: rollup.colWidths.assignee }}
>
  {t(lang, "assignee")}
  <ColumnResizeHandle col="assignee" onMouseDown={rollup.startColResize} />
</th>
{rollupPeriods.map((rp) => (
  <th
    key={rp.key}
    className="relative px-3 py-2 text-right font-medium tabular-nums"
    style={{ width: rollup.colWidths.period, minWidth: rollup.colWidths.period }}
  >
    {rp.key}
    <ColumnResizeHandle col="period" onMouseDown={rollup.startColResize} />
  </th>
))}
```

- [ ] **Step 4: Add the reset button to the panel header**

In the `renderHeader` function (~L224), inside the `<div className="flex items-center gap-3">`, add this conditional just before the GearIcon button:

```tsx
{view === "planning" && (
  <ResetColWidthsButton onClick={resetPlanningAndRollup} lang={lang} />
)}
```

(Workload and Directory render their own reset buttons inside their own components.)

- [ ] **Step 5: Tests + gates**

```bash
npx vitest run resources-panel
npx tsc --noEmit
npm run lint
```
Expected: PASS, 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/resources-panel.tsx
git add src/app/resources-panel.test.tsx 2>/dev/null || true
git commit -m "feat(table): column resize on Planning + Rollup (shared reset)"
```

---

## Task 5: Roll out to RAID

**Files:** Modify `src/app/raid-panel.tsx`.

- [ ] **Step 1: Read the file**

Read `src/app/raid-panel.tsx` around L418–456 (the main RAID thead). Also identify the existing toolbar where Add/Search/Sort buttons live.

- [ ] **Step 2: Add defaults + hook**

After existing imports:

```ts
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle, ResetColWidthsButton } from "./task-manager-ui";

const RAID_COL_WIDTHS = {
  id: 60,
  category: 100,
  title: 240,
  severity: 90,
  status: 110,
  owner: 140,
  targetDate: 110,
  linkedTasks: 140,
  causedBy: 140,
} as const;
type RaidCol = keyof typeof RAID_COL_WIDTHS;
```

Inside the main RAID component (before `return`):

```ts
const { colWidths, startColResize, resetColWidths } = useColumnResize<RaidCol>(
  "raid",
  RAID_COL_WIDTHS,
);
```

- [ ] **Step 3: Apply widths + handles to the 9 th cells (~L420–456)**

For each existing th (the sortable ones with the inner sort button + `aria-sort`, plus the last two that are plain), transform from:
```tsx
<th className="px-3 py-2" aria-sort={...}>
  <button onClick={() => toggleSort("id")} ...>...</button>
</th>
```
to:
```tsx
<th
  className="relative px-3 py-2"
  style={{ width: colWidths.id, minWidth: colWidths.id }}
  aria-sort={...}
>
  <button onClick={() => toggleSort("id")} ...>...</button>
  <ColumnResizeHandle col="id" onMouseDown={startColResize} />
</th>
```

Apply to: `id`, `category`, `title`, `severity`, `status`, `owner`, `targetDate`, `linkedTasks` (no sort), `causedBy` (no sort).

- [ ] **Step 4: Add the reset button to the RAID toolbar**

Locate the RAID main panel's toolbar (above the table; typically contains Add/Filter buttons). Insert:

```tsx
<ResetColWidthsButton onClick={resetColWidths} lang={lang} />
```

Place it adjacent to the existing toolbar controls. If the file has both a list-view toolbar and a detail-modal toolbar, add only to the list-view one.

- [ ] **Step 5: Tests + gates**

```bash
npx vitest run raid-panel
npx tsc --noEmit
npm run lint
```
Expected: PASS, 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/raid-panel.tsx
git add src/app/raid-panel.test.tsx 2>/dev/null || true
git commit -m "feat(table): column resize + reset button on RAID table"
```

---

## Task 6: Roll out to Activity Log

**Files:** Modify `src/app/activity-log-panel.tsx`.

- [ ] **Step 1: Read the file**

Read `src/app/activity-log-panel.tsx` end-to-end (~291 lines) to identify the exact thead column ids. Typical structure: timestamp, kind, actor, message — but use whatever the actual file shows.

- [ ] **Step 2: Add defaults + hook**

After existing imports:

```ts
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle, ResetColWidthsButton } from "./task-manager-ui";

const ACTIVITY_LOG_COL_WIDTHS = {
  timestamp: 160,
  kind: 110,
  actor: 140,
  message: 320,
} as const;
type ActivityLogCol = keyof typeof ACTIVITY_LOG_COL_WIDTHS;
```

If the file's columns differ from the assumed names above, adjust the const to match.

Inside the main component (before `return`):

```ts
const { colWidths, startColResize, resetColWidths } = useColumnResize<ActivityLogCol>(
  "activityLog",
  ACTIVITY_LOG_COL_WIDTHS,
);
```

- [ ] **Step 3: Apply widths + handles to each th**

For each of the 4 column headers, add `relative` to the className + `style={{ width, minWidth }}` + append `<ColumnResizeHandle col="<col>" onMouseDown={startColResize} />`.

- [ ] **Step 4: Add the reset button to the Activity Log toolbar**

The existing Activity Log toolbar (clear button + search input + filter dropdown, around L182–203). Insert next to the clear-button group:

```tsx
<ResetColWidthsButton onClick={resetColWidths} lang={lang} />
```

- [ ] **Step 5: Tests + gates**

```bash
npx vitest run activity-log
npx tsc --noEmit
npm run lint
```
Expected: PASS, 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/activity-log-panel.tsx
git add src/app/activity-log-panel.test.tsx 2>/dev/null || true
git commit -m "feat(table): column resize + reset button on Activity Log"
```

---

## Task 7: Roll out to Reports (3 sub-tables, shared reset)

**Files:** Modify `src/app/reports.tsx`.

- [ ] **Step 1: Read the file**

Read `src/app/reports.tsx` (it has three sub-table theads at ~L414, ~L444, ~L542). Identify the exact header strings and the column field names so the defaults const matches.

- [ ] **Step 2: Add three defaults + types**

After existing imports:

```ts
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle, ResetColWidthsButton } from "./task-manager-ui";

const REPORTS_PRIORITY_COL_WIDTHS = {
  id: 60,
  task: 260,
  count: 90,
} as const;
type ReportsPriorityCol = keyof typeof REPORTS_PRIORITY_COL_WIDTHS;

const REPORTS_ASSIGNEE_COL_WIDTHS = {
  assignee: 160,
  total: 90,
  open: 90,
  overdue: 90,
  dueSoon: 90,
  completed: 90,
  ratio: 90,
} as const;
type ReportsAssigneeCol = keyof typeof REPORTS_ASSIGNEE_COL_WIDTHS;

const REPORTS_BY_X_COL_WIDTHS = {
  label: 180,
  total: 90,
  open: 90,
  overdue: 90,
  dueSoon: 90,
  completed: 90,
} as const;
type ReportsByXCol = keyof typeof REPORTS_BY_X_COL_WIDTHS;
```

(Adjust per-table column ids to match what the actual th cells render.)

- [ ] **Step 3: Add three hooks + combined reset**

Inside the Reports component (before `return`):

```ts
const priority = useColumnResize<ReportsPriorityCol>("reportsPriority", REPORTS_PRIORITY_COL_WIDTHS);
const assignee = useColumnResize<ReportsAssigneeCol>("reportsAssignee", REPORTS_ASSIGNEE_COL_WIDTHS);
const byX = useColumnResize<ReportsByXCol>("reportsByX", REPORTS_BY_X_COL_WIDTHS);
const resetAllReports = () => {
  priority.resetColWidths();
  assignee.resetColWidths();
  byX.resetColWidths();
};
```

- [ ] **Step 4: Apply widths + handles to each sub-table's th cells**

For each sub-table thead block:
- Priority (~L414–418): bind to `priority.colWidths.*` + `priority.startColResize`
- Assignee (~L444–462): bind to `assignee.colWidths.*` + `assignee.startColResize`
- By-X (~L542–553): bind to `byX.colWidths.*` + `byX.startColResize`

Each th: add `relative`, `style={{ width, minWidth }}`, append `<ColumnResizeHandle col="..." onMouseDown={...} />`.

- [ ] **Step 5: Add the shared reset button to the Reports view header**

Locate the Reports view's main header (the title block above the sub-tables). Place `<ResetColWidthsButton onClick={resetAllReports} lang={lang} />` adjacent to the title.

- [ ] **Step 6: Tests + gates**

```bash
npx vitest run reports
npx tsc --noEmit
npm run lint
```
Expected: PASS, 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 7: Commit**

```bash
git add src/app/reports.tsx
git add src/app/reports.test.tsx 2>/dev/null || true
git commit -m "feat(table): column resize on Reports sub-tables (shared reset)"
```

---

## Task 8: Roll out to Budget

**Files:** Modify `src/app/budget-panel.tsx`.

- [ ] **Step 1: Read the file**

Read `src/app/budget-panel.tsx` around L240–260 (thead). Note any additional fixed columns beyond `role` (e.g. a "total" column).

- [ ] **Step 2: Add defaults + hook**

After existing imports:

```ts
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle, ResetColWidthsButton } from "./task-manager-ui";

const BUDGET_COL_WIDTHS = {
  role: 160,
  period: 100,
} as const;
type BudgetCol = keyof typeof BUDGET_COL_WIDTHS;
```

If Budget has additional fixed columns beyond role (e.g. `total: 110`), add them here with appropriate defaults.

Inside the budget component (before `return`):

```ts
const { colWidths, startColResize, resetColWidths } = useColumnResize<BudgetCol>(
  "budget",
  BUDGET_COL_WIDTHS,
);
```

- [ ] **Step 3: Apply widths + handles**

Role header:

```tsx
<th
  className="relative px-3 py-2 font-medium"
  style={{ width: colWidths.role, minWidth: colWidths.role }}
>
  {t(lang, "budgetRole")}
  <ColumnResizeHandle col="role" onMouseDown={startColResize} />
</th>
```

Period headers in the map:

```tsx
<th
  key={p.key}
  className="relative px-3 py-2 text-right font-medium tabular-nums"
  style={{ width: colWidths.period, minWidth: colWidths.period }}
>
  {p.key}
  <ColumnResizeHandle col="period" onMouseDown={startColResize} />
</th>
```

(Add similar treatment for any extra fixed columns identified in Step 1.)

- [ ] **Step 4: Add the reset button to the Budget toolbar**

Locate the budget panel's toolbar (above the table). Add:

```tsx
<ResetColWidthsButton onClick={resetColWidths} lang={lang} />
```

- [ ] **Step 5: Tests + gates**

```bash
npx vitest run budget-panel
npx tsc --noEmit
npm run lint
```
Expected: PASS, 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/budget-panel.tsx
git add src/app/budget-panel.test.tsx 2>/dev/null || true
git commit -m "feat(table): column resize + reset button on Budget"
```

---

## Task 9: Roll out to Resources Report sub-tables (no reset)

**Files:** Modify `src/app/resources-report.tsx`.

Five sub-tables, each gets its own hook + resize handles. NO reset buttons (the popup has no per-sub-table toolbar).

- [ ] **Step 1: Read the file**

Read `src/app/resources-report.tsx` end-to-end (138 lines) to confirm each `<Table head={[...]}>` invocation and its column count + field names.

- [ ] **Step 2: Add five defaults sets**

After existing imports:

```ts
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle } from "./task-manager-ui";

const RES_REPORT_BY_PERIOD_WIDTHS = {
  label: 100, days: 110, internal: 110, external: 110, margin: 110,
} as const;
type ResReportByPeriodCol = keyof typeof RES_REPORT_BY_PERIOD_WIDTHS;

const RES_REPORT_BY_DISCIPLINE_WIDTHS = {
  label: 160, headcount: 110, days: 110, internal: 110, external: 110,
} as const;
type ResReportByDisciplineCol = keyof typeof RES_REPORT_BY_DISCIPLINE_WIDTHS;

const RES_REPORT_BY_GRADE_WIDTHS = {
  label: 160, headcount: 110, days: 110, internal: 110, external: 110,
} as const;
type ResReportByGradeCol = keyof typeof RES_REPORT_BY_GRADE_WIDTHS;

const RES_REPORT_BY_COMBO_WIDTHS = {
  label: 200, headcount: 110, days: 110, internal: 110, external: 110,
} as const;
type ResReportByComboCol = keyof typeof RES_REPORT_BY_COMBO_WIDTHS;

const RES_REPORT_BY_RESOURCE_WIDTHS = {
  name: 160, role: 160, avgUtil: 90, capDays: 110, internal: 120, external: 120,
} as const;
type ResReportByResourceCol = keyof typeof RES_REPORT_BY_RESOURCE_WIDTHS;
```

- [ ] **Step 3: Update the `<Table>` helper to accept widths + resize**

Modify the `Table` helper signature (~L119):

```tsx
function Table<TId extends string>({
  head,
  widths,
  startResize,
  cols,
  children,
}: {
  head: string[];
  widths: Record<TId, number>;
  startResize: (col: TId, e: React.MouseEvent) => void;
  cols: readonly TId[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="min-w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                className={`relative px-3 py-2 font-medium ${i === 0 ? "" : "text-right"}`}
                style={{ width: widths[cols[i]], minWidth: widths[cols[i]] }}
              >
                {h}
                <ColumnResizeHandle col={cols[i]} onMouseDown={startResize} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Wire each Table invocation**

Inside the `ResourcesReportPanel` component, add the five hooks:

```ts
const byPeriod = useColumnResize<ResReportByPeriodCol>("resReportByPeriod", RES_REPORT_BY_PERIOD_WIDTHS);
const byDiscipline = useColumnResize<ResReportByDisciplineCol>("resReportByDiscipline", RES_REPORT_BY_DISCIPLINE_WIDTHS);
const byGrade = useColumnResize<ResReportByGradeCol>("resReportByGrade", RES_REPORT_BY_GRADE_WIDTHS);
const byCombo = useColumnResize<ResReportByComboCol>("resReportByCombo", RES_REPORT_BY_COMBO_WIDTHS);
const byResource = useColumnResize<ResReportByResourceCol>("resReportByResource", RES_REPORT_BY_RESOURCE_WIDTHS);
```

Update each `<Table head={[…]}>` invocation to pass `widths` + `startResize` + `cols`. For `perPeriod`:

```tsx
<Table
  head={[t(lang, "resourcesReportByPeriod"), t(lang, "resourcesCapacityDays"), t(lang, "resourcesInternalCost"), t(lang, "resourcesExternalCost"), t(lang, "resourcesMargin")]}
  widths={byPeriod.colWidths}
  startResize={byPeriod.startColResize}
  cols={["label", "days", "internal", "external", "margin"]}
>
  ...
</Table>
```

`GroupSection` uses the `<Table>` helper too. Either lift the hook calls up to `ResourcesReportPanel` and pass `widths/startResize/cols` down into `GroupSection`, or duplicate the hook calls inline. The cleaner path: change `GroupSection`'s signature to accept the hook return tuple plus the cols array:

```tsx
function GroupSection<TId extends string>({
  title, rows, lang, days, money, widths, startResize, cols,
}: {
  title: string;
  rows: ReportGroupRow[];
  lang: Lang;
  days: (h: number) => string;
  money: (n: number) => string;
  widths: Record<TId, number>;
  startResize: (col: TId, e: React.MouseEvent) => void;
  cols: readonly TId[];
}) {
  if (rows.length === 0) return null;
  return (
    <Section title={title}>
      <Table head={[title, t(lang, "resourcesReportHeadcount"), t(lang, "resourcesCapacityDays"), t(lang, "resourcesInternalCost"), t(lang, "resourcesExternalCost")]}
             widths={widths} startResize={startResize} cols={cols}>
        ...
      </Table>
    </Section>
  );
}
```

Then the three `<GroupSection>` calls pass `byDiscipline`/`byGrade`/`byCombo` respectively, each with its `cols={["label", "headcount", "days", "internal", "external"]}`.

The `byResource` block uses `<Table>` directly with its `cols={["name", "role", "avgUtil", "capDays", "internal", "external"]}`.

- [ ] **Step 5: Tests + gates**

```bash
npx vitest run resources-report
npx tsc --noEmit
npm run lint
```
Expected: PASS, 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/resources-report.tsx
git add src/app/resources-report.test.tsx 2>/dev/null || true
git commit -m "feat(table): column resize on Resources Report sub-tables (no reset)"
```

---

## Task 10: Roll out to jira-conflicts + roles modals (no reset)

**Files:**
- Modify: `src/app/jira-conflicts-modal.tsx`
- Modify: `src/app/roles-modal.tsx`

Modal-hosted tables get resize but no reset button.

### jira-conflicts-modal

- [ ] **Step 1: Read the file**

Read `src/app/jira-conflicts-modal.tsx` to identify the exact th cells + their column ids.

- [ ] **Step 2: Add defaults + hook + handles**

After existing imports:

```ts
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle } from "./task-manager-ui";

const JIRA_CONFLICTS_COL_WIDTHS = {
  // Fill in based on actual th cells. Common shape:
  id: 80, summary: 240, local: 160, remote: 160, resolution: 140,
} as const;
type JiraConflictsCol = keyof typeof JIRA_CONFLICTS_COL_WIDTHS;
```

Inside the component (before `return`):

```ts
const { colWidths, startColResize } = useColumnResize<JiraConflictsCol>(
  "jiraConflicts",
  JIRA_CONFLICTS_COL_WIDTHS,
);
```

For each th, add `relative`, `style={{ width, minWidth }}`, append `<ColumnResizeHandle>`.

### roles-modal

- [ ] **Step 3: Read the file**

Read `src/app/roles-modal.tsx` to identify the exact th cells.

- [ ] **Step 4: Add defaults + hook + handles**

```ts
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle } from "./task-manager-ui";

const ROLES_COL_WIDTHS = {
  // Fill in based on actual th cells. Common shape:
  discipline: 160, grade: 120, name: 200,
} as const;
type RolesCol = keyof typeof ROLES_COL_WIDTHS;
```

Inside the component (before `return`):

```ts
const { colWidths, startColResize } = useColumnResize<RolesCol>(
  "roles",
  ROLES_COL_WIDTHS,
);
```

For each th, add `relative`, `style={{ width, minWidth }}`, append `<ColumnResizeHandle>`.

- [ ] **Step 5: Tests + gates**

```bash
npx vitest run jira-conflicts roles-modal
npx tsc --noEmit
npm run lint
```
Expected: PASS, 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/jira-conflicts-modal.tsx src/app/roles-modal.tsx
git commit -m "feat(table): column resize on jira-conflicts + roles modal tables"
```

---

## Task 11: Task form modal height bump

**Files:** Modify `src/app/task-form-modal.tsx`.

- [ ] **Step 1: Apply the edit**

Edit `src/app/task-form-modal.tsx`:

- Find: `relative flex w-[700px] min-w-[460px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface dark:border-line dark:bg-surface`
- Replace: `relative flex h-[900px] max-h-[95vh] min-h-[480px] w-[700px] min-w-[460px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface dark:border-line dark:bg-surface`

(Inserts `h-[900px] max-h-[95vh] min-h-[480px] ` between `flex ` and `w-[700px]`. Nothing else changes.)

- [ ] **Step 2: Tests + gates**

```bash
npx vitest run task-form-modal
npx tsc --noEmit
npm run lint
```
Expected: PASS, 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 3: Commit**

```bash
git add src/app/task-form-modal.tsx
git add src/app/task-form-modal.test.tsx 2>/dev/null || true
git commit -m "feat(modal): bump task form default height to 900px (was content-driven)"
```

---

## Task 12: Release 0.17.0 "Jemisin"

**Files:** `src/app/version.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `CHANGELOG.md`.

- [ ] **Step 1: version.ts** — READ first. Set `APP_VERSION = "0.17.0"`. Replace the existing `// Butler milestone` end-of-line comment on `APP_BUILD_DATE` with `// Jemisin milestone`. Add a new top-of-file comment block ABOVE the existing 0.16.2 block:
```ts
// 0.17.0 "Jemisin" adds column resize to every table in the app — drag the
// right edge of any header; the Reset button restores defaults. Also doubles
// the task form modal's default height (h-[900px], still user-resizable).
```

Append `"versionHighlightTableResize"` as the LAST entry of `APP_HIGHLIGHT_KEYS`. Match the existing tuple's style (indentation, trailing comma if present).

- [ ] **Step 2: i18n.ts** — Add new translation entry:
```
versionHighlightTableResize: "Column widths now resizable in every table — drag the right edge of any header; the Reset button restores defaults.",
```
Place it right after the last `versionHighlight*` entry (after `versionHighlightPalette`). Match surrounding entries' indentation, quotes, and trailing comma style.

- [ ] **Step 3: i18n.de.ts** — Add the same key:
```
versionHighlightTableResize: "Spaltenbreiten in allen Tabellen anpassbar — am rechten Rand jedes Spaltenkopfes ziehen; die Reset-Schaltfläche stellt die Standardwerte wieder her.",
```

- [ ] **Step 4: CHANGELOG.md** — Add a new `[0.17.0] — 2026-05-28 "Jemisin"` entry above `[0.16.2]`:
```markdown
## [0.17.0] — 2026-05-28 "Jemisin"

### Added
- Column-width resize on every table — Directory, Workload, Planning + Rollup, RAID, Activity Log, Reports, Budget, Resources Report sub-tables, and the jira-conflicts + roles modal tables. Drag the right edge of any header to widen or narrow a column; widths persist per table in localStorage. Tall tables (Directory, Workload, Planning, RAID, Activity Log, Reports, Budget) gain a "Reset column widths" button in their toolbar.
- New version highlight: "Column widths now resizable" (`versionHighlightTableResize`) in both EN and DE.

### Changed
- Task form modal default height bumped to 900 px (clamped to 95 vh) with a 480 px floor — twice the previous content-driven height, still user-resizable via the modal's native resize handle.
```

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit
npm run lint
npm run test:coverage
```
Expected: tsc 0; lint 0 errors; all suites pass; coverage ≥ 70%. Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md
git commit -m "docs(release): 0.17.0 Jemisin — column resize on every table"
```

---

## Final review

Dispatch a final reviewer over `git diff main...HEAD`. The reviewer should confirm:

1. **Scope:** the diff touches only the files enumerated in the per-task lists above (the new hook + tests, two primitives in `task-manager-ui.tsx`, 11 component files for table rollout, `task-form-modal.tsx`, `version.ts`, `i18n.ts`, `i18n.de.ts`, `CHANGELOG.md`). Test files updated where assertions had to change. Anything else = flag.
2. **Hook:** `useColumnResize` lives in `src/app/use-column-resize.ts`, exports the documented signature, tests pass.
3. **Primitives:** `ColumnResizeHandle` and `ResetColWidthsButton` exported from `task-manager-ui.tsx`. Tasks-section uses `<ResetColWidthsButton>` (no inline reset-widths button block remaining).
4. **Per-table:** each of the 11 target tables has a `<NAME>_COL_WIDTHS` defaults const, a `useColumnResize(...)` call, `style={{ width, minWidth }}` on every resizable th, and a `<ColumnResizeHandle>` inside each. The 9 tall tables have a `<ResetColWidthsButton>` in their toolbar (Reports shares one across its 3 sub-tables; Planning shares one across Planning + Rollup; Workload + Directory each have their own).
5. **Task form modal:** `h-[900px] max-h-[95vh] min-h-[480px]` present in the panel className.
6. **Release metadata:** `APP_VERSION === "0.17.0"`, `APP_BUILD_DATE` comment is `// Jemisin milestone`, `APP_HIGHLIGHT_KEYS` ends with `"versionHighlightTableResize"`, both i18n files contain the new EN/DE strings, CHANGELOG has the `[0.17.0]` entry with Added + Changed sections.
7. **Gates:** `npx tsc --noEmit` 0; `npm run lint` 0; `npx vitest run` all tests passing (existing 890 + 6 new from `use-column-resize.test.ts` = 896+); `npm run test:coverage` ≥ 70%.

After the reviewer approves, use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:**
- Generic hook + tests → Task 1 ✓
- Shared primitives + tasks-section refactor → Task 2 ✓
- Directory + Workload integration → Task 3 ✓
- Planning + Rollup (shared reset) → Task 4 ✓
- RAID → Task 5 ✓
- Activity Log → Task 6 ✓
- Reports (3 sub-tables + shared reset) → Task 7 ✓
- Budget → Task 8 ✓
- Resources Report (5 sub-tables, no reset) → Task 9 ✓
- jira-conflicts + roles modals (no reset) → Task 10 ✓
- Task form modal height → Task 11 ✓
- Release 0.17.0 Jemisin + i18n EN+DE + CHANGELOG → Task 12 ✓
- Non-goals (Calendar, hidden cols, drag-reorder, master-reset, tasks-table changes) → not touched in any task ✓

**Placeholder scan:** No TBD/TODO. Tasks 6, 7, 8, 9, 10 explicitly direct the implementer to read the target file to confirm exact column ids — that's verification, not a placeholder; the default-widths const skeleton is concrete, the implementer adjusts to the actual field names.

**Type consistency:** The hook's `TId extends string` generic threads through every per-table integration. Each table's `<NAME>_COL_WIDTHS` const + derived `<NAME>Col` type match the `useColumnResize<NAME>Col>(tableId, defaults)` call site. The shared `period` key is reused across Planning, Rollup, Budget — three independent `tableId`s each owning their own `period` width.

**Ordering note:** Task 2's `<Th>`/`<SortableTh>` refactor (Step 2) is optional cleanup — the new `ColumnResizeHandle` and tasks-section button refactor are required; touching `<Th>`/`<SortableTh>` is nice-to-have DRY. If the implementer hits friction (tasks-section.test.tsx assertions tied to the inline class string), they can skip Step 2 and the plan still ships correctly.
