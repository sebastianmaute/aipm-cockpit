# Slice 10 — useColumnManager + useContacts + useWorkspaceCollapsed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract three localStorage-backed UI-state hooks from `task-manager.tsx`, removing ~175 lines of inline state, effects, and callbacks.

**Architecture:** Three plain hooks (no context providers). `useColumnManager` owns column widths, hidden columns, column-config dropdown, and resize drag. `useContacts` owns the contacts address-book lifecycle (gated on `hydrated` + `tasks`). `useWorkspaceCollapsed` owns the workspace-panel collapsed boolean. `task-manager.tsx` replaces ~175 inline lines with three hook calls. Pattern mirrors slices 5–9.

**Tech Stack:** React 19, TypeScript, Vitest 3, @testing-library/react 16, localStorage (jsdom)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/app/use-column-manager.ts` | Column widths + hidden cols + config dropdown + resize drag |
| Create | `src/app/use-column-manager.test.ts` | 7 unit tests |
| Create | `src/app/use-contacts.ts` | Contacts address-book lifecycle |
| Create | `src/app/use-contacts.test.ts` | 4 unit tests |
| Create | `src/app/use-workspace-collapsed.ts` | Workspace collapsed boolean |
| Create | `src/app/use-workspace-collapsed.test.ts` | 4 unit tests |
| Modify | `src/app/task-manager.tsx` | Replace ~175 inline lines with three hook calls |
| Modify | `src/app/version.ts` | Bump to 0.7.8 "Faulkner" |
| Modify | `CHANGELOG.md` | Add [0.7.8] entry |
| Modify | `README.md` | Update version badge |

---

## Task 1: Scaffold use-column-manager.test.ts (RED)

**Files:**
- Create: `src/app/use-column-manager.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// src/app/use-column-manager.test.ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COL_WIDTHS, useColumnManager } from "./use-column-manager";

const COL_WIDTHS_KEY = "lop-app:col-widths";
const HIDDEN_COLS_KEY = "lop-app:hidden-cols";

describe("useColumnManager", () => {
  describe("initial state", () => {
    it("colWidths equals DEFAULT_COL_WIDTHS initially", () => {
      const { result } = renderHook(() => useColumnManager());
      expect(result.current.colWidths).toEqual(DEFAULT_COL_WIDTHS);
    });

    it("hiddenCols is an empty Set initially", () => {
      const { result } = renderHook(() => useColumnManager());
      expect(result.current.hiddenCols.size).toBe(0);
    });

    it("colConfigOpen is false initially", () => {
      const { result } = renderHook(() => useColumnManager());
      expect(result.current.colConfigOpen).toBe(false);
    });
  });

  describe("localStorage hydration", () => {
    it("loads colWidths from localStorage on mount", async () => {
      localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify({ taskName: 300 }));
      const { result } = renderHook(() => useColumnManager());
      await act(async () => {});
      expect(result.current.colWidths.taskName).toBe(300);
    });

    it("loads hiddenCols from localStorage on mount", async () => {
      localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify(["notes", "blockers"]));
      const { result } = renderHook(() => useColumnManager());
      await act(async () => {});
      expect(result.current.hiddenCols.has("notes")).toBe(true);
      expect(result.current.hiddenCols.has("blockers")).toBe(true);
    });
  });

  describe("resetColWidths", () => {
    it("resets to DEFAULT_COL_WIDTHS and removes the localStorage key", async () => {
      localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify({ taskName: 300 }));
      const { result } = renderHook(() => useColumnManager());
      await act(async () => {});
      act(() => {
        result.current.resetColWidths();
      });
      expect(result.current.colWidths).toEqual(DEFAULT_COL_WIDTHS);
      expect(localStorage.getItem(COL_WIDTHS_KEY)).toBeNull();
    });
  });

  describe("persistence", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("persists colWidths to localStorage after 250 ms debounce", async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useColumnManager());
      await act(async () => { vi.runAllTimers(); });
      localStorage.removeItem(COL_WIDTHS_KEY);

      act(() => {
        result.current.setColWidths((prev) => ({ ...prev, taskName: 999 }));
      });
      expect(localStorage.getItem(COL_WIDTHS_KEY)).toBeNull();

      act(() => { vi.advanceTimersByTime(250); });
      const stored = JSON.parse(
        localStorage.getItem(COL_WIDTHS_KEY) ?? "{}",
      ) as Record<string, number>;
      expect(stored.taskName).toBe(999);
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```
npx vitest run src/app/use-column-manager.test.ts --reporter=verbose
```

Expected: FAIL — `Cannot find module './use-column-manager'`

---

## Task 2: Create use-column-manager.ts (GREEN)

**Files:**
- Create: `src/app/use-column-manager.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/app/use-column-manager.ts
"use client";

import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const COL_WIDTHS_KEY = "lop-app:col-widths";
const HIDDEN_COLS_KEY = "lop-app:hidden-cols";

export const DEFAULT_COL_WIDTHS: Record<string, number> = {
  sel: 36,
  status: 36,
  id: 80,
  taskName: 200,
  assignee: 140,
  startDate: 110,
  dueDate: 110,
  lastUpdateDate: 110,
  priority: 90,
  blockers: 140,
  notes: 140,
  depRelations: 120,
  actions: 60,
};

export function useColumnManager(): {
  colWidths: Record<string, number>;
  setColWidths: Dispatch<SetStateAction<Record<string, number>>>;
  hiddenCols: Set<string>;
  setHiddenCols: Dispatch<SetStateAction<Set<string>>>;
  colConfigOpen: boolean;
  setColConfigOpen: Dispatch<SetStateAction<boolean>>;
  colConfigRef: RefObject<HTMLDivElement | null>;
  resetColWidths: () => void;
  startColResize: (col: string, e: React.MouseEvent) => void;
} {
  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_COL_WIDTHS);
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [colConfigOpen, setColConfigOpen] = useState(false);
  const colDragRef = useRef<{ col: string; startX: number; startW: number } | null>(null);
  const colConfigRef = useRef<HTMLDivElement | null>(null);

  // Hydrate colWidths from localStorage on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COL_WIDTHS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setColWidths((prev) => ({ ...prev, ...(parsed as Record<string, number>) }));
        }
      }
    } catch { /* non-fatal */ }
  }, []);

  // Persist colWidths debounced 250 ms — column drag fires setColWidths on
  // every mousemove; without the timeout we'd write localStorage 60×/sec.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colWidths));
      } catch { /* non-fatal */ }
    }, 250);
    return () => clearTimeout(id);
  }, [colWidths]);

  // Hydrate hiddenCols from localStorage on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HIDDEN_COLS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setHiddenCols(new Set(parsed as string[]));
      }
    } catch { /* non-fatal */ }
  }, []);

  // Persist hiddenCols on every change.
  useEffect(() => {
    try {
      window.localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify([...hiddenCols]));
    } catch { /* non-fatal */ }
  }, [hiddenCols]);

  // Close column-config dropdown on outside click or Escape.
  useEffect(() => {
    if (!colConfigOpen) return;
    function onDown(e: MouseEvent) {
      if (colConfigRef.current && !colConfigRef.current.contains(e.target as Node))
        setColConfigOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setColConfigOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [colConfigOpen]);

  const resetColWidths = useCallback(() => {
    setColWidths(DEFAULT_COL_WIDTHS);
    try { window.localStorage.removeItem(COL_WIDTHS_KEY); } catch { /* non-fatal */ }
  }, []);

  const startColResize = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault();
    colDragRef.current = { col, startX: e.clientX, startW: colWidths[col] ?? 80 };
    function onMove(mv: MouseEvent) {
      if (!colDragRef.current) return;
      const { col: c, startX, startW } = colDragRef.current;
      setColWidths((prev) => ({ ...prev, [c]: Math.max(40, startW + mv.clientX - startX) }));
    }
    function onUp() {
      colDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [colWidths]);

  return {
    colWidths,
    setColWidths,
    hiddenCols,
    setHiddenCols,
    colConfigOpen,
    setColConfigOpen,
    colConfigRef,
    resetColWidths,
    startColResize,
  };
}
```

- [ ] **Step 2: Run tests — expect PASS**

```
npx vitest run src/app/use-column-manager.test.ts --reporter=verbose
```

Expected: 7 passed

- [ ] **Step 3: Commit**

```
git add src/app/use-column-manager.ts src/app/use-column-manager.test.ts
git commit -m "feat(use-column-manager): extract column layout hook (GREEN)"
```

---

## Task 3: Scaffold use-contacts.test.ts (RED)

**Files:**
- Create: `src/app/use-contacts.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// src/app/use-contacts.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Task } from "./types";
import { useContacts } from "./use-contacts";

const CONTACTS_KEY = "lop-app:contacts";
const NO_TASKS: Task[] = [];

describe("useContacts", () => {
  describe("initial state", () => {
    it("contacts is empty and contactsList is empty initially", () => {
      const { result } = renderHook(() =>
        useContacts({ hydrated: false, tasks: NO_TASKS }),
      );
      expect(result.current.contacts).toEqual({});
      expect(result.current.contactsList).toHaveLength(0);
    });
  });

  describe("hydration", () => {
    it("does not hydrate when hydrated=false", async () => {
      localStorage.setItem(
        CONTACTS_KEY,
        JSON.stringify({ Alice: { name: "Alice", email: "alice@example.com" } }),
      );
      const { result } = renderHook(() =>
        useContacts({ hydrated: false, tasks: NO_TASKS }),
      );
      await act(async () => {});
      expect(result.current.contacts).toEqual({});
    });

    it("hydrates from localStorage when hydrated=true", async () => {
      localStorage.setItem(
        CONTACTS_KEY,
        JSON.stringify({ Alice: { name: "Alice", email: "alice@example.com" } }),
      );
      const { result } = renderHook(() =>
        useContacts({ hydrated: true, tasks: NO_TASKS }),
      );
      await act(async () => {});
      expect(Object.keys(result.current.contacts)).toContain("Alice");
      expect(result.current.contactsList).toHaveLength(1);
    });
  });

  describe("handleRemoveContact", () => {
    it("removes the named contact from the map", async () => {
      localStorage.setItem(
        CONTACTS_KEY,
        JSON.stringify({ Alice: { name: "Alice", email: "alice@example.com" } }),
      );
      const { result } = renderHook(() =>
        useContacts({ hydrated: true, tasks: NO_TASKS }),
      );
      await act(async () => {});
      act(() => {
        result.current.handleRemoveContact("Alice");
      });
      expect(Object.keys(result.current.contacts)).not.toContain("Alice");
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```
npx vitest run src/app/use-contacts.test.ts --reporter=verbose
```

Expected: FAIL — `Cannot find module './use-contacts'`

---

## Task 4: Create use-contacts.ts (GREEN)

**Files:**
- Create: `src/app/use-contacts.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/app/use-contacts.ts
"use client";

import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Contact,
  type ContactsMap,
  listContacts,
  loadContacts,
  removeContact,
  saveContacts,
  seedContactsFromTasks,
} from "./contacts";
import type { Task } from "./types";

export interface UseContactsArgs {
  hydrated: boolean;
  tasks: Task[];
}

export function useContacts({ hydrated, tasks }: UseContactsArgs): {
  contacts: ContactsMap;
  setContacts: Dispatch<SetStateAction<ContactsMap>>;
  contactsList: Contact[];
  handleRemoveContact: (name: string) => void;
} {
  const [contacts, setContacts] = useState<ContactsMap>({});
  const contactsHydratedRef = useRef(false);

  // Load contacts once after settings hydration completes so tasks are
  // available for seeding on first-ever load when the address book is empty.
  useEffect(() => {
    if (contactsHydratedRef.current) return;
    if (!hydrated) return;
    contactsHydratedRef.current = true;
    const loaded = loadContacts();
    const seeded =
      Object.keys(loaded).length === 0
        ? seedContactsFromTasks(loaded, tasks)
        : loaded;
    setContacts(seeded);
    if (Object.keys(seeded).length > 0 && Object.keys(loaded).length === 0) {
      saveContacts(seeded);
    }
  }, [hydrated, tasks]);

  // Persist on every change after hydration.
  useEffect(() => {
    if (!contactsHydratedRef.current) return;
    saveContacts(contacts);
  }, [contacts]);

  const contactsList = useMemo(() => listContacts(contacts), [contacts]);

  function handleRemoveContact(name: string) {
    setContacts((prev) => removeContact(prev, name));
  }

  return { contacts, setContacts, contactsList, handleRemoveContact };
}
```

- [ ] **Step 2: Run tests — expect PASS**

```
npx vitest run src/app/use-contacts.test.ts --reporter=verbose
```

Expected: 4 passed

- [ ] **Step 3: Run full suite to confirm no regressions**

```
npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: all previously-passing tests still pass

- [ ] **Step 4: Commit**

```
git add src/app/use-contacts.ts src/app/use-contacts.test.ts
git commit -m "feat(use-contacts): extract contacts lifecycle hook (GREEN)"
```

---

## Task 5: Scaffold use-workspace-collapsed.test.ts (RED)

**Files:**
- Create: `src/app/use-workspace-collapsed.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// src/app/use-workspace-collapsed.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWorkspaceCollapsed } from "./use-workspace-collapsed";

const WORKSPACE_COLLAPSED_KEY = "lop-app:workspace-collapsed";

describe("useWorkspaceCollapsed", () => {
  it("workspaceCollapsed is false initially", () => {
    const { result } = renderHook(() => useWorkspaceCollapsed());
    expect(result.current.workspaceCollapsed).toBe(false);
  });

  it("loads true from localStorage when key is '1'", async () => {
    localStorage.setItem(WORKSPACE_COLLAPSED_KEY, "1");
    const { result } = renderHook(() => useWorkspaceCollapsed());
    await act(async () => {});
    expect(result.current.workspaceCollapsed).toBe(true);
  });

  it("setWorkspaceCollapsed(true) persists '1' to localStorage", async () => {
    const { result } = renderHook(() => useWorkspaceCollapsed());
    await act(async () => {});
    act(() => {
      result.current.setWorkspaceCollapsed(true);
    });
    expect(localStorage.getItem(WORKSPACE_COLLAPSED_KEY)).toBe("1");
  });

  it("setWorkspaceCollapsed(false) removes the key from localStorage", async () => {
    localStorage.setItem(WORKSPACE_COLLAPSED_KEY, "1");
    const { result } = renderHook(() => useWorkspaceCollapsed());
    await act(async () => {});
    act(() => {
      result.current.setWorkspaceCollapsed(false);
    });
    expect(localStorage.getItem(WORKSPACE_COLLAPSED_KEY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```
npx vitest run src/app/use-workspace-collapsed.test.ts --reporter=verbose
```

Expected: FAIL — `Cannot find module './use-workspace-collapsed'`

---

## Task 6: Create use-workspace-collapsed.ts (GREEN)

**Files:**
- Create: `src/app/use-workspace-collapsed.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/app/use-workspace-collapsed.ts
"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

const WORKSPACE_COLLAPSED_KEY = "lop-app:workspace-collapsed";

export function useWorkspaceCollapsed(): {
  workspaceCollapsed: boolean;
  setWorkspaceCollapsed: Dispatch<SetStateAction<boolean>>;
} {
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);

  // Hydrate collapsed flag from localStorage on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WORKSPACE_COLLAPSED_KEY);
      if (raw === "1") setWorkspaceCollapsed(true);
    } catch { /* non-fatal */ }
  }, []);

  // Persist on every change.
  useEffect(() => {
    try {
      if (workspaceCollapsed) {
        window.localStorage.setItem(WORKSPACE_COLLAPSED_KEY, "1");
      } else {
        window.localStorage.removeItem(WORKSPACE_COLLAPSED_KEY);
      }
    } catch { /* non-fatal */ }
  }, [workspaceCollapsed]);

  return { workspaceCollapsed, setWorkspaceCollapsed };
}
```

- [ ] **Step 2: Run tests — expect PASS**

```
npx vitest run src/app/use-workspace-collapsed.test.ts --reporter=verbose
```

Expected: 4 passed

- [ ] **Step 3: Run full suite**

```
npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: all previously-passing tests pass (164 total: 149 previous + 15 new)

- [ ] **Step 4: Commit**

```
git add src/app/use-workspace-collapsed.ts src/app/use-workspace-collapsed.test.ts
git commit -m "feat(use-workspace-collapsed): extract workspace collapsed hook (GREEN)"
```

---

## Task 7: Refactor task-manager.tsx to consume all three hooks

**Files:**
- Modify: `src/app/task-manager.tsx`

### What to do

**1. Add three imports** near the other hook imports (around line 22–26):

```typescript
import { useColumnManager } from "./use-column-manager";
import { useContacts } from "./use-contacts";
import { useWorkspaceCollapsed } from "./use-workspace-collapsed";
```

**2. Remove four module-level constants** (around lines 203–225):

```typescript
const WORKSPACE_COLLAPSED_KEY = "lop-app:workspace-collapsed";
const COL_WIDTHS_KEY = "lop-app:col-widths";
const HIDDEN_COLS_KEY = "lop-app:hidden-cols";
```

And the `DEFAULT_COL_WIDTHS` block:

```typescript
const DEFAULT_COL_WIDTHS: Record<string, number> = {
  sel: 36, status: 36, id: 80, taskName: 200, assignee: 140,
  startDate: 110, dueDate: 110, lastUpdateDate: 110, priority: 90,
  blockers: 140, notes: 140, depRelations: 120, actions: 60,
};
```

If `DEFAULT_COL_WIDTHS` is still referenced in JSX (e.g. in a reset-button tooltip), add `import { DEFAULT_COL_WIDTHS } from "./use-column-manager"` instead of removing the reference.

**3. Remove inline state + ref declarations** inside `TaskManagerInner` (around lines 251–266 and 361–366):

```typescript
const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);
```

```typescript
const [contacts, setContacts] = useState<ContactsMap>({});
const contactsHydratedRef = useRef(false);
```

```typescript
const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_COL_WIDTHS);
const colDragRef = useRef<{ col: string; startX: number; startW: number } | null>(null);
const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
const [colConfigOpen, setColConfigOpen] = useState(false);
const colConfigRef = useRef<HTMLDivElement | null>(null);
```

**4. Remove `resetColWidths` and `startColResize` callbacks** (around lines 367–387).

**5. Add three hook calls** immediately after `const { activityLog, ... } = useActivityLog({ lang });`:

```typescript
const { workspaceCollapsed, setWorkspaceCollapsed } = useWorkspaceCollapsed();
const {
  colWidths,
  setColWidths,
  hiddenCols,
  setHiddenCols,
  colConfigOpen,
  setColConfigOpen,
  colConfigRef,
  resetColWidths,
  startColResize,
} = useColumnManager();
const { contacts, setContacts, contactsList, handleRemoveContact } =
  useContacts({ hydrated, tasks });
```

**6. Remove these nine `useEffect` blocks** further down in `TaskManagerInner`:

- Workspace-collapsed **hydration** effect (deps `[]`) — reads `WORKSPACE_COLLAPSED_KEY`
- Workspace-collapsed **persist** effect (deps `[workspaceCollapsed]`)
- colWidths **hydration** effect (deps `[]`) — reads `COL_WIDTHS_KEY`
- colWidths **debounced persist** effect (deps `[colWidths]`) — uses `setTimeout`
- hiddenCols **hydration** effect (deps `[]`) — reads `HIDDEN_COLS_KEY`
- hiddenCols **persist** effect (deps `[hiddenCols]`)
- colConfigOpen **click-outside+Escape** effect (deps `[colConfigOpen]`)
- Contacts **hydration** effect (deps `[hydrated, tasks]`)
- Contacts **persist** effect (deps `[contacts]`)

**7. Remove `handleRemoveContact` function** (around lines 723–725):

```typescript
function handleRemoveContact(name: string) {
  setContacts((prev) => removeContactFromMap(prev, name));
}
```

**8. Remove `contactsList` useMemo** (around line 758):

```typescript
const contactsList = useMemo(() => listContacts(contacts), [contacts]);
```

**9. Clean up now-unused imports from `./contacts`:**

Remove: `ContactsMap`, `listContacts`, `loadContacts`, `removeContact as removeContactFromMap`, `saveContacts`, `seedContactsFromTasks`.

Keep: `greetingName`, `upsertContact` (still used in `handleSubmit` and elsewhere).

The import becomes:
```typescript
import { greetingName, upsertContact } from "./contacts";
```

- [ ] **Step 1: Make all the edits described above**

- [ ] **Step 2: Run TypeScript check**

```
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors. If `DEFAULT_COL_WIDTHS` is still referenced in JSX, add `import { DEFAULT_COL_WIDTHS } from "./use-column-manager"` rather than removing the reference.

- [ ] **Step 3: Run full test suite**

```
npx vitest run --reporter=verbose 2>&1 | tail -15
```

Expected: 164 tests pass

- [ ] **Step 4: Commit**

```
git add src/app/task-manager.tsx
git commit -m "refactor(task-manager): consume useColumnManager + useContacts + useWorkspaceCollapsed"
```

---

## Task 8: Version bump v0.7.8 "Faulkner"

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Update version.ts**

Read the file. Prepend this comment block at the very top (before the existing 0.7.7 entry):

```
// 0.7.8 extracts useColumnManager (~110 LoC), useContacts (~45 LoC), and
// useWorkspaceCollapsed (~25 LoC) from task-manager.tsx. Slice 10 of the
// decomposition: all three are localStorage-backed UI-state hooks.
// useColumnManager owns column widths, hidden columns, the column-config
// dropdown, and the resize-drag interaction. useContacts owns the contacts
// address-book lifecycle (gated on hydrated + tasks for seeding).
// useWorkspaceCollapsed owns the workspace-panel collapsed boolean.
// 15 new unit tests. task-manager.tsx ~−175 lines; now ~2,010 lines.
```

Change the exports:
```typescript
export const APP_VERSION = "0.7.8";
export const APP_BUILD_DATE = "2026-05-21";
```

- [ ] **Step 2: Update CHANGELOG.md**

Read the file. Replace the `## [Unreleased]` section with:

```markdown
## [Unreleased]

_No unreleased changes._

## [0.7.8] "Faulkner" — 2026-05-21

### Refactored
- Extracted `useColumnManager` hook (~110 lines): column widths, hidden columns, column-config dropdown, resize-drag interaction; localStorage load/persist (debounced 250 ms for widths)
- Extracted `useContacts` hook (~45 lines): contacts address-book lifecycle, seed-from-tasks on first load, localStorage load/persist
- Extracted `useWorkspaceCollapsed` hook (~25 lines): workspace-panel collapsed boolean, localStorage load/persist
- `task-manager.tsx` ~−175 lines; now ~2,010 lines

### Tests
- `use-column-manager.test.ts`: 7 tests — initial state, localStorage hydration, resetColWidths, debounced persistence
- `use-contacts.test.ts`: 4 tests — initial state, hydration gate, localStorage load, handleRemoveContact
- `use-workspace-collapsed.test.ts`: 4 tests — initial state, localStorage load, persist true/false
```

- [ ] **Step 3: Update README.md**

Change all occurrences of `v0.7.7` to `v0.7.8`.

- [ ] **Step 4: Run full test suite one final time**

```
npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: 164 tests pass

- [ ] **Step 5: Commit**

```
git add src/app/version.ts CHANGELOG.md README.md
git commit -m "release(v0.7.8): Faulkner - useColumnManager + useContacts + useWorkspaceCollapsed"
```
