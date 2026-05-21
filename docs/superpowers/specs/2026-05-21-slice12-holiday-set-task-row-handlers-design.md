# Slice 12 — useHolidaySet + useTaskRowHandlers Design

**Version:** v0.8.0 "Hemingway"  
**Date:** 2026-05-21  
**Status:** Approved

---

## Overview

Extract two hooks from `task-manager.tsx` as part of the ongoing decomposition series (Slices 5–11 pattern). This is the first slice to bump the minor version (0.7.x → 0.8.0) because it removes a significant portion of inline callback logic.

---

## Architecture

### New Files

| File | Responsibility |
|------|---------------|
| `src/app/use-holiday-set.ts` | Async `date-holidays` load → `Set<string>` of ISO date strings for the current year |
| `src/app/use-holiday-set.test.ts` | Vitest unit tests for useHolidaySet |
| `src/app/use-task-row-handlers.ts` | 9 row-level callbacks + `expandedNotes` + `pushingIds` state |
| `src/app/use-task-row-handlers.test.ts` | Vitest unit tests for useTaskRowHandlers |

### Modified Files

| File | Change |
|------|--------|
| `src/app/task-manager.tsx` | Remove ~120 lines (holidaySet state/effect, pushingIds/expandedNotes state, 9 row callbacks, handleEdit duplicate); import and consume both hooks |
| `src/app/version.ts` | Bump to v0.8.0 |
| `CHANGELOG.md` | [0.8.0] "Hemingway" entry |
| `README.md` | Badge v0.7.9 → v0.8.0 |

### Data Flow

```
task-manager.tsx
  ├── useHolidaySet({ countryCode, settings })
  │     └── returns: { holidaySet: Set<string> }
  │
  └── useTaskRowHandlers({ tasks, tasksRef, settings, holidaySet,
                           today, showToast, openEditModal,
                           setTasks, setGanttViewActive,
                           setBulkOpQueue, setJiraSyncQueue,
                           syncTasksToStorage, language })
        └── returns: {
              expandedNotes, setExpandedNotes,
              pushingIds, setPushingIds,
              handleToggleNotes, handleComplete, handleDelete,
              handlePushToJira, handleToggleGantt,
              onEdit, handleClearRaidTaskFilter,
              handleJumpToTaskFromRaid, handleGanttBarClick
            }
```

`tasksRef` stays inline in task-manager (mutated by `handleSubmit` and `handleGanttBarUpdate` which remain in-file) and is passed as an arg to `useTaskRowHandlers`.

---

## Hook Interfaces

### useHolidaySet

```typescript
// src/app/use-holiday-set.ts
interface UseHolidaySetArgs {
  countryCode: string;        // e.g. "DE", "GB", "US"
  settings: Settings;         // used to re-load on country change
}

function useHolidaySet({ countryCode, settings }: UseHolidaySetArgs): {
  holidaySet: Set<string>;
}
```

**Implementation notes:**
- Initial state: `useState<Set<string>>(new Set())`
- Effect deps: `[countryCode]` (settings only used to derive countryCode; pass countryCode directly)
- Use `let cancelled = false` cancellation flag; set `cancelled = true` in cleanup
- Dynamic import: `const { default: Holidays } = await import("date-holidays")`
- Build set: `new Holidays(countryCode).getHolidays(year).map(h => h.date.slice(0, 10))`
- Wrap `import()` in `try/catch`; on failure log and leave set empty

### useTaskRowHandlers

```typescript
// src/app/use-task-row-handlers.ts
interface UseTaskRowHandlersArgs {
  tasks: Task[];
  tasksRef: React.MutableRefObject<Task[]>;
  settings: Settings;
  holidaySet: Set<string>;
  today: string;                          // ISO date "YYYY-MM-DD"
  showToast: (kind: "info" | "error", text: string) => void;
  openEditModal: (task: Task) => void;    // opens edit form pre-populated
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setGanttViewActive: React.Dispatch<React.SetStateAction<boolean>>;
  setBulkOpQueue: React.Dispatch<React.SetStateAction<...>>;
  setJiraSyncQueue: React.Dispatch<React.SetStateAction<...>>;
  syncTasksToStorage: (tasks: Task[]) => void;
  language: Lang;
}

function useTaskRowHandlers(args: UseTaskRowHandlersArgs): {
  expandedNotes: Set<number>;
  setExpandedNotes: React.Dispatch<React.SetStateAction<Set<number>>>;
  pushingIds: Set<number>;
  setPushingIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  handleToggleNotes: (id: number) => void;
  handleComplete: (id: number) => void;
  handleDelete: (id: number) => void;
  handlePushToJira: (id: number) => Promise<void>;
  handleToggleGantt: (id: number) => void;
  onEdit: (task: Task) => void;
  handleClearRaidTaskFilter: () => void;
  handleJumpToTaskFromRaid: (id: number) => void;
  handleGanttBarClick: (id: number) => void;
}
```

**Implementation notes:**
- `expandedNotes` and `pushingIds` move from task-manager into this hook
- `handleEdit` (line 713 duplicate) is eliminated — task-manager uses `onEdit` directly
- All 9 callbacks wrapped in `useCallback` with appropriate deps
- `openEditModal` replaces individual form setters (`setEditingTask`, `setFormData`, `setIsEditMode`, `setShowForm`) — callers simply call `openEditModal(task)` and task-manager wires up the form population internally
- `handleClearRaidTaskFilter` and `handleJumpToTaskFromRaid` move into this hook (they operate on task data)

---

## Tests

### useHolidaySet — 3 tests

```typescript
// src/app/use-holiday-set.test.ts
import { renderHook, act } from "@testing-library/react";
import { vi, it, expect, describe, beforeEach, afterEach } from "vitest";

describe("useHolidaySet", () => {
  it("returns empty set initially", () => {
    const { result } = renderHook(() =>
      useHolidaySet({ countryCode: "DE", settings: makeSettings() })
    );
    expect(result.current.holidaySet.size).toBe(0);
  });

  it("resolves holidays after async load", async () => {
    const { result } = renderHook(() =>
      useHolidaySet({ countryCode: "DE", settings: makeSettings() })
    );
    await act(async () => {});
    expect(result.current.holidaySet.size).toBeGreaterThan(0);
  });

  it("cancels in-flight load on unmount (no state update after unmount)", async () => {
    const { result, unmount } = renderHook(() =>
      useHolidaySet({ countryCode: "DE", settings: makeSettings() })
    );
    unmount();
    // No "Can't perform a React state update on an unmounted component" error
    await act(async () => {});
    expect(result.current.holidaySet.size).toBe(0);
  });
});
```

### useTaskRowHandlers — 6 tests

```typescript
// src/app/use-task-row-handlers.test.ts
import { renderHook, act } from "@testing-library/react";
import { vi, it, expect, describe } from "vitest";

describe("useTaskRowHandlers", () => {
  it("returns empty expandedNotes and pushingIds initially", () => {
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs()));
    expect(result.current.expandedNotes.size).toBe(0);
    expect(result.current.pushingIds.size).toBe(0);
  });

  it("handleToggleNotes adds and removes id from expandedNotes", () => {
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs()));
    act(() => result.current.handleToggleNotes(1));
    expect(result.current.expandedNotes.has(1)).toBe(true);
    act(() => result.current.handleToggleNotes(1));
    expect(result.current.expandedNotes.has(1)).toBe(false);
  });

  it("handleComplete marks task done and syncs storage", () => {
    const setTasks = vi.fn();
    const syncTasksToStorage = vi.fn();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ setTasks, syncTasksToStorage }))
    );
    act(() => result.current.handleComplete(1));
    expect(setTasks).toHaveBeenCalled();
  });

  it("handleDelete removes task and syncs storage", () => {
    const setTasks = vi.fn();
    const syncTasksToStorage = vi.fn();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ setTasks, syncTasksToStorage }))
    );
    act(() => result.current.handleDelete(1));
    expect(setTasks).toHaveBeenCalled();
  });

  it("onEdit calls openEditModal with the task", () => {
    const openEditModal = vi.fn();
    const task = makeTask();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ openEditModal }))
    );
    act(() => result.current.onEdit(task));
    expect(openEditModal).toHaveBeenCalledWith(task);
  });

  it("handleToggleGantt calls setGanttViewActive", () => {
    const setGanttViewActive = vi.fn();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ setGanttViewActive }))
    );
    act(() => result.current.handleToggleGantt(1));
    expect(setGanttViewActive).toHaveBeenCalled();
  });
});
```

---

## Version

- **Version:** `0.8.0` (minor bump — first since decomposition began)
- **Codename:** Hemingway
- **Date:** 2026-05-21
- **Rationale:** Minor bump because ~120 lines of callback logic are removed from task-manager and the public hook API surface changes meaningfully (openEditModal replaces form setters)

---

## Approved Decisions

1. **`openEditModal: (task: Task) => void`** — hook receives single callback; task-manager keeps form setter wiring internally. Keeps useTaskRowHandlers decoupled from form state shape.
2. **`tasksRef` stays inline** in task-manager, passed as arg — it is mutated by `handleSubmit`/`handleGanttBarUpdate` which are not part of this slice.
3. **`handleEdit` duplicate eliminated** — task-manager calls `onEdit` directly everywhere; the `handleEdit` alias at line 713 is removed.
4. **`handleClearRaidTaskFilter` + `handleJumpToTaskFromRaid` move into hook** — they operate on task data, fit naturally alongside the other row handlers.
5. **`useHolidaySet` is a separate hook** from `useTaskRowHandlers` — `holidaySet` is also consumed by `useDueAlerts`, so keeping it independent avoids coupling.
