# Slice 8 — useResourcePlanner + useBulkOperations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract ~620 lines from `task-manager.tsx` into two focused hooks — `useResourcePlanner` (RAID/absence/shift CRUD) and `useBulkOperations` (selection, bulk edit, voice commands) — targeting v0.7.6 "Duras".

**Architecture:** Both hooks call `useWorkspace()`, `useTaskForm()`, and/or `useFilters()` internally; accept callbacks as args; use the `langRef` pattern from prior slices so handlers don't re-register on every lang change. Pattern mirrors slices 5–7 (`useChatDispatcher`, `useJiraSync`, `useStorageBackend`).

**Tech Stack:** React 19, TypeScript, Vitest 3, `@testing-library/react` 16, `renderHook` + `act`.

---

## File Map

| Action | Path |
|--------|------|
| Create | `src/app/use-resource-planner.ts` |
| Create | `src/app/use-resource-planner.test.tsx` |
| Create | `src/app/use-bulk-operations.ts` |
| Create | `src/app/use-bulk-operations.test.tsx` |
| Modify | `src/app/task-manager.tsx` |

---

## Background: key imports you will need

Before writing any code, **grep for these** to confirm exact import paths:

```bash
grep -r "nextRaidId" src/app --include="*.ts" --include="*.tsx" -l
grep -r "DEFAULT_WEEK_HOURS" src/app --include="*.ts" --include="*.tsx" -l
grep -r "export.*Command" src/app --include="*.ts" -l
grep -r "sanitizePriority" src/app --include="*.ts" --include="*.tsx" -l
grep -r "greetingName" src/app --include="*.ts" --include="*.tsx" -l
```

Expected results:
- `nextRaidId` → `src/app/raid.ts`
- `DEFAULT_WEEK_HOURS` → `src/app/types.ts`
- `Command` → `src/app/voice.ts`
- sanitize functions → `src/app/sanitize.ts`
- `greetingName` → `src/app/contacts.ts`

Also note these are inlined in `task-manager.tsx` and must be **copied** into `use-resource-planner.ts` (they are NOT exported from any shared module):
- `isoToday()` — `new Date().toISOString().slice(0, 10)`
- `emptyAbsenceDraft(id: number)` — lines ~173–184 of task-manager.tsx
- `emptyShiftDraft(id: number)` — lines ~186–194 of task-manager.tsx

---

## Phase A — useResourcePlanner

---

### Task 1: Scaffold use-resource-planner.test.tsx + 2 state-init tests (RED)

**Files:**
- Create: `src/app/use-resource-planner.test.tsx`

- [ ] **Step 1: Create the test file**

```typescript
// src/app/use-resource-planner.test.tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Absence, RaidItem, Shift } from "./types";
import type { Lang } from "./i18n";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import {
  useResourcePlanner,
  type UseResourcePlannerArgs,
} from "./use-resource-planner";

function makeArgs(
  overrides?: Partial<UseResourcePlannerArgs>,
): UseResourcePlannerArgs {
  return {
    lang: "en-US" as Lang,
    logActivity: vi.fn(),
    showToast: vi.fn(),
    ...overrides,
  };
}

function renderPlanner(overrides?: Partial<UseResourcePlannerArgs>) {
  const logActivity = vi.fn();
  const showToast = vi.fn();
  const args = makeArgs({ logActivity, showToast, ...overrides });
  const { result } = renderHook(
    () => ({
      planner: useResourcePlanner(args),
      workspace: useWorkspace(),
    }),
    { wrapper: WorkspaceProvider },
  );
  return { result, logActivity, showToast };
}

describe("useResourcePlanner", () => {
  describe("initial state", () => {
    it("editingAbsence is null initially", () => {
      const { result } = renderPlanner();
      expect(result.current.planner.editingAbsence).toBeNull();
    });

    it("editingShift is null initially", () => {
      const { result } = renderPlanner();
      expect(result.current.planner.editingShift).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```
npx vitest run src/app/use-resource-planner.test.tsx --reporter=verbose
```

Expected: `Error: Cannot find module './use-resource-planner'`

- [ ] **Step 3: Commit**

```bash
git add src/app/use-resource-planner.test.tsx
git commit -m "test(use-resource-planner): scaffold test file + 2 state-init tests (RED)"
```

---

### Task 2: Create use-resource-planner.ts skeleton (GREEN on state-init tests)

**Files:**
- Create: `src/app/use-resource-planner.ts`

- [ ] **Step 1: Create the hook skeleton**

```typescript
// src/app/use-resource-planner.ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { nextRaidId } from "./raid";
import { DEFAULT_WEEK_HOURS, type Absence, type RaidItem, type Shift, type Task } from "./types";
import type { ActivityKind } from "./activity-log";
import { useWorkspace } from "./workspace-context";

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyAbsenceDraft(id: number): Absence {
  const today = isoToday();
  return {
    id,
    assignee: "",
    assigneeEmail: undefined,
    startDate: today,
    endDate: today,
    type: "vacation",
    note: undefined,
  };
}

function emptyShiftDraft(id: number): Shift {
  return {
    id,
    assignee: "",
    assigneeEmail: undefined,
    hoursPerWeekday: DEFAULT_WEEK_HOURS,
    note: undefined,
  };
}

export interface UseResourcePlannerArgs {
  lang: Lang;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
}

export function useResourcePlanner(args: UseResourcePlannerArgs) {
  const {
    tasks,
    setTasks,
    raid,
    setRaid,
    absences,
    setAbsences,
    shifts,
    setShifts,
  } = useWorkspace();

  const langRef = useRef(args.lang);
  const logActivityRef = useRef(args.logActivity);
  const showToastRef = useRef(args.showToast);
  const tasksRef = useRef(tasks);
  useEffect(() => { langRef.current = args.lang; }, [args.lang]);
  useEffect(() => { logActivityRef.current = args.logActivity; }, [args.logActivity]);
  useEffect(() => { showToastRef.current = args.showToast; }, [args.showToast]);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  const [editingAbsence, setEditingAbsence] = useState<{
    absence: Absence;
    isNew: boolean;
  } | null>(null);

  const [editingShift, setEditingShift] = useState<{
    shift: Shift;
    isNew: boolean;
  } | null>(null);

  const handleSaveRaidItem = useCallback((_item: RaidItem) => {}, []);
  const handleDeleteRaidItem = useCallback((_id: number) => {}, []);
  const handleOpenAddAbsence = useCallback((_seed?: Partial<Absence>) => {}, []);
  const handleEditAbsence = useCallback((_absence: Absence) => {}, []);
  const handleCloseAbsenceModal = useCallback(() => {}, []);
  const handleSaveAbsence = useCallback((_next: Absence) => {}, []);
  const handleDeleteAbsence = useCallback((_id: number) => {}, []);
  const handleOpenShiftEditor = useCallback(
    (_existing: Shift | null, _seed: { display: string; email: string }) => {},
    [],
  );
  const handleCloseShiftModal = useCallback(() => {}, []);
  const handleSaveShift = useCallback((_next: Shift) => {}, []);
  const handleDeleteShift = useCallback((_id: number) => {}, []);
  const handleCreateMitigationTaskFromRaid = useCallback(
    (_raidItemId: number): number | null => null,
    [],
  );

  return {
    editingAbsence,
    editingShift,
    handleSaveRaidItem,
    handleDeleteRaidItem,
    handleOpenAddAbsence,
    handleEditAbsence,
    handleCloseAbsenceModal,
    handleSaveAbsence,
    handleDeleteAbsence,
    handleOpenShiftEditor,
    handleCloseShiftModal,
    handleSaveShift,
    handleDeleteShift,
    handleCreateMitigationTaskFromRaid,
  };
}
```

- [ ] **Step 2: Run tests — expect 2 pass**

```
npx vitest run src/app/use-resource-planner.test.tsx --reporter=verbose
```

Expected: `2 passed`

- [ ] **Step 3: Commit**

```bash
git add src/app/use-resource-planner.ts
git commit -m "feat(use-resource-planner): create hook skeleton (GREEN)"
```

---

### Task 3: Add RAID + absence + shift handler tests (RED)

**Files:**
- Modify: `src/app/use-resource-planner.test.tsx`

- [ ] **Step 1: Append 10 handler tests inside the `describe("useResourcePlanner")` block**

Add these describe blocks after the `"initial state"` block (before the closing `}` of `describe("useResourcePlanner", ...)`):

```typescript
  describe("absence modal", () => {
    it("handleOpenAddAbsence sets editingAbsence with isNew=true and id=1", () => {
      const { result } = renderPlanner();
      act(() => {
        result.current.planner.handleOpenAddAbsence();
      });
      expect(result.current.planner.editingAbsence).not.toBeNull();
      expect(result.current.planner.editingAbsence!.isNew).toBe(true);
      expect(result.current.planner.editingAbsence!.absence.id).toBe(1);
    });

    it("handleEditAbsence sets editingAbsence with isNew=false", () => {
      const { result } = renderPlanner();
      const absence: Absence = {
        id: 5,
        assignee: "Alice",
        startDate: "2026-06-01",
        endDate: "2026-06-07",
        type: "vacation",
      };
      act(() => {
        result.current.planner.handleEditAbsence(absence);
      });
      expect(result.current.planner.editingAbsence!.isNew).toBe(false);
      expect(result.current.planner.editingAbsence!.absence).toBe(absence);
    });

    it("handleCloseAbsenceModal clears editingAbsence", () => {
      const { result } = renderPlanner();
      act(() => { result.current.planner.handleOpenAddAbsence(); });
      act(() => { result.current.planner.handleCloseAbsenceModal(); });
      expect(result.current.planner.editingAbsence).toBeNull();
    });

    it("handleSaveAbsence creates new absence and logs absence.created", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      const absence: Absence = {
        id: 1,
        assignee: "Alice",
        startDate: "2026-06-01",
        endDate: "2026-06-07",
        type: "vacation",
      };
      act(() => { result.current.planner.handleSaveAbsence(absence); });
      expect(result.current.workspace.absences).toHaveLength(1);
      expect(result.current.workspace.absences[0].assignee).toBe("Alice");
      expect(logActivity).toHaveBeenCalledWith(
        "absence.created",
        1,
        "Alice",
        "2026-06-01",
        "2026-06-07",
      );
    });

    it("handleSaveAbsence updates existing absence and logs absence.updated", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      const absence: Absence = {
        id: 1,
        assignee: "Alice",
        startDate: "2026-06-01",
        endDate: "2026-06-07",
        type: "vacation",
      };
      act(() => { result.current.planner.handleSaveAbsence(absence); });
      const updated = { ...absence, assignee: "Alice B" };
      act(() => { result.current.planner.handleSaveAbsence(updated); });
      expect(result.current.workspace.absences).toHaveLength(1);
      expect(result.current.workspace.absences[0].assignee).toBe("Alice B");
      expect(logActivity).toHaveBeenLastCalledWith(
        "absence.updated",
        1,
        "Alice B",
        "2026-06-01",
        "2026-06-07",
      );
    });

    it("handleDeleteAbsence removes absence and logs absence.deleted", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      const absence: Absence = {
        id: 1,
        assignee: "Alice",
        startDate: "2026-06-01",
        endDate: "2026-06-07",
        type: "vacation",
      };
      act(() => { result.current.planner.handleSaveAbsence(absence); });
      act(() => { result.current.planner.handleDeleteAbsence(1); });
      expect(result.current.workspace.absences).toHaveLength(0);
      expect(logActivity).toHaveBeenCalledWith("absence.deleted", 1, "Alice");
    });
  });

  describe("shift modal", () => {
    it("handleSaveShift creates new shift and logs shift.created", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      const shift: Shift = {
        id: 1,
        assignee: "Bob",
        hoursPerWeekday: [8, 8, 8, 8, 8, 0, 0],
      };
      act(() => { result.current.planner.handleSaveShift(shift); });
      expect(result.current.workspace.shifts).toHaveLength(1);
      expect(result.current.workspace.shifts[0].assignee).toBe("Bob");
      expect(logActivity).toHaveBeenCalledWith("shift.created", 1, "Bob");
    });

    it("handleDeleteShift removes shift and logs shift.deleted", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      const shift: Shift = {
        id: 1,
        assignee: "Bob",
        hoursPerWeekday: [8, 8, 8, 8, 8, 0, 0],
      };
      act(() => { result.current.planner.handleSaveShift(shift); });
      act(() => { result.current.planner.handleDeleteShift(1); });
      expect(result.current.workspace.shifts).toHaveLength(0);
      expect(logActivity).toHaveBeenCalledWith("shift.deleted", 1, "Bob");
    });
  });

  describe("RAID handlers", () => {
    it("handleSaveRaidItem creates new RAID item and logs raid.created", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      const item: RaidItem = {
        id: 1,
        category: "R",
        title: "Budget risk",
        description: "May overspend",
        severity: "High",
        status: "Open",
        owner: "Alice",
        ownerEmail: "alice@test.com",
        mitigation: undefined,
        linkedTaskIds: [],
        causedByRaidIds: [],
        raisedDate: "2026-05-20",
        targetDate: undefined,
        localModifiedAt: "2026-05-20T00:00:00.000Z",
      };
      act(() => { result.current.planner.handleSaveRaidItem(item); });
      expect(result.current.workspace.raid).toHaveLength(1);
      expect(logActivity).toHaveBeenCalledWith("raid.created", 1, "R", "Budget risk");
    });

    it("handleSaveRaidItem triggers auto-issue on Risk→Realized and calls showToast", () => {
      const logActivity = vi.fn();
      const showToast = vi.fn();
      const { result } = renderPlanner({ logActivity, showToast });
      const riskItem: RaidItem = {
        id: 1,
        category: "R",
        title: "Budget risk",
        description: "May overspend",
        severity: "High",
        status: "Open",
        owner: "Alice",
        ownerEmail: "alice@test.com",
        mitigation: undefined,
        linkedTaskIds: [],
        causedByRaidIds: [],
        raisedDate: "2026-05-20",
        targetDate: undefined,
        localModifiedAt: "2026-05-20T00:00:00.000Z",
      };
      act(() => { result.current.planner.handleSaveRaidItem(riskItem); });
      const realizedItem = { ...riskItem, status: "Realized" as const };
      act(() => { result.current.planner.handleSaveRaidItem(realizedItem); });
      expect(result.current.workspace.raid).toHaveLength(2);
      expect(result.current.workspace.raid[1].category).toBe("I");
      expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
      expect(logActivity).toHaveBeenCalledWith("raid.statusChanged", 1, "Open", "Realized");
      expect(logActivity).toHaveBeenCalledWith("raid.autoIssue", 1, expect.any(Number));
    });

    it("handleCreateMitigationTaskFromRaid adds task and links it to raid item", () => {
      const { result } = renderPlanner();
      const raidItem: RaidItem = {
        id: 1,
        category: "A",
        title: "Fix deployment",
        description: "Automate CI",
        severity: "Medium",
        status: "Open",
        owner: "Alice",
        ownerEmail: "alice@test.com",
        mitigation: "Write scripts",
        linkedTaskIds: [],
        causedByRaidIds: [],
        raisedDate: "2026-05-20",
        targetDate: "2026-06-01",
        localModifiedAt: "2026-05-20T00:00:00.000Z",
      };
      act(() => { result.current.workspace.setRaid([raidItem]); });
      let newTaskId: number | null = null;
      act(() => {
        newTaskId = result.current.planner.handleCreateMitigationTaskFromRaid(1);
      });
      expect(newTaskId).not.toBeNull();
      expect(result.current.workspace.tasks).toHaveLength(1);
      expect(result.current.workspace.tasks[0].id).toBe(newTaskId);
      expect(result.current.workspace.raid[0].linkedTaskIds).toContain(newTaskId);
    });
  });
```

- [ ] **Step 2: Run tests — expect 10 failures**

```
npx vitest run src/app/use-resource-planner.test.tsx --reporter=verbose
```

Expected: `2 passed, 10 failed`

- [ ] **Step 3: Commit**

```bash
git add src/app/use-resource-planner.test.tsx
git commit -m "test(use-resource-planner): add RAID + absence + shift handler tests (RED)"
```

---

### Task 4: Implement all CRUD handlers (GREEN)

**Files:**
- Modify: `src/app/use-resource-planner.ts`

Replace the entire file content with the complete implementation:

- [ ] **Step 1: Replace file content**

```typescript
// src/app/use-resource-planner.ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { nextRaidId } from "./raid";
import { DEFAULT_WEEK_HOURS, type Absence, type RaidItem, type Shift, type Task } from "./types";
import type { ActivityKind } from "./activity-log";
import { useWorkspace } from "./workspace-context";

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyAbsenceDraft(id: number): Absence {
  const today = isoToday();
  return {
    id,
    assignee: "",
    assigneeEmail: undefined,
    startDate: today,
    endDate: today,
    type: "vacation",
    note: undefined,
  };
}

function emptyShiftDraft(id: number): Shift {
  return {
    id,
    assignee: "",
    assigneeEmail: undefined,
    hoursPerWeekday: DEFAULT_WEEK_HOURS,
    note: undefined,
  };
}

export interface UseResourcePlannerArgs {
  lang: Lang;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
}

export function useResourcePlanner(args: UseResourcePlannerArgs) {
  const {
    tasks,
    setTasks,
    raid,
    setRaid,
    absences,
    setAbsences,
    shifts,
    setShifts,
  } = useWorkspace();

  const langRef = useRef(args.lang);
  const logActivityRef = useRef(args.logActivity);
  const showToastRef = useRef(args.showToast);
  const tasksRef = useRef(tasks);
  useEffect(() => { langRef.current = args.lang; }, [args.lang]);
  useEffect(() => { logActivityRef.current = args.logActivity; }, [args.logActivity]);
  useEffect(() => { showToastRef.current = args.showToast; }, [args.showToast]);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  const [editingAbsence, setEditingAbsence] = useState<{
    absence: Absence;
    isNew: boolean;
  } | null>(null);

  const [editingShift, setEditingShift] = useState<{
    shift: Shift;
    isNew: boolean;
  } | null>(null);

  const handleSaveRaidItem = useCallback(
    (item: RaidItem) => {
      const stamp = new Date().toISOString();
      const previous = raid.find((r) => r.id === item.id);
      const idx = raid.findIndex((r) => r.id === item.id);
      const withStamp: RaidItem = { ...item, localModifiedAt: stamp };
      const baseList =
        idx < 0
          ? [...raid, withStamp]
          : raid.map((r) => (r.id === item.id ? withStamp : r));

      const triggersAutoIssue =
        previous !== undefined &&
        item.category === "R" &&
        previous.status !== "Realized" &&
        item.status === "Realized" &&
        !raid.some(
          (r) => r.category === "I" && r.causedByRaidIds.includes(item.id),
        );

      let autoIssueId: number | null = null;
      if (triggersAutoIssue) {
        const newIssueId = nextRaidId(baseList);
        autoIssueId = newIssueId;
        const today = isoToday();
        const autoIssue: RaidItem = {
          id: newIssueId,
          category: "I",
          title: item.title,
          description: item.description,
          severity: item.severity,
          status: "Open",
          owner: item.owner,
          ownerEmail: item.ownerEmail,
          mitigation: undefined,
          linkedTaskIds: [],
          causedByRaidIds: [item.id],
          raisedDate: today,
          targetDate: item.targetDate,
          localModifiedAt: stamp,
        };
        setRaid([...baseList, autoIssue]);
        showToastRef.current(
          "info",
          t(langRef.current, "raidAutoCreatedIssue", item.id, newIssueId),
        );
      } else {
        setRaid(baseList);
      }

      if (previous === undefined) {
        logActivityRef.current("raid.created", item.id, item.category, item.title);
      } else if (previous.status !== item.status) {
        logActivityRef.current(
          "raid.statusChanged",
          item.id,
          previous.status,
          item.status,
        );
      } else {
        logActivityRef.current("raid.updated", item.id, item.category, item.title);
      }
      if (autoIssueId !== null) {
        logActivityRef.current("raid.autoIssue", item.id, autoIssueId);
      }
    },
    [raid, setRaid],
  );

  const handleDeleteRaidItem = useCallback(
    (id: number) => {
      const removed = raid.find((r) => r.id === id);
      setRaid((prev) => prev.filter((r) => r.id !== id));
      if (removed) {
        logActivityRef.current("raid.deleted", id, removed.category, removed.title);
      }
    },
    [raid, setRaid],
  );

  const handleOpenAddAbsence = useCallback(
    (seed?: Partial<Absence>) => {
      const nextId =
        absences.length > 0 ? Math.max(...absences.map((a) => a.id)) + 1 : 1;
      const draft: Absence = {
        ...emptyAbsenceDraft(nextId),
        ...seed,
        id: nextId,
      };
      setEditingAbsence({ absence: draft, isNew: true });
    },
    [absences],
  );

  const handleEditAbsence = useCallback((absence: Absence) => {
    setEditingAbsence({ absence, isNew: false });
  }, []);

  const handleCloseAbsenceModal = useCallback(() => {
    setEditingAbsence(null);
  }, []);

  const handleSaveAbsence = useCallback(
    (next: Absence) => {
      const stamp = new Date().toISOString();
      const withStamp: Absence = { ...next, localModifiedAt: stamp };
      const existing = absences.find((a) => a.id === next.id);
      if (existing) {
        setAbsences((prev) =>
          prev.map((a) => (a.id === next.id ? withStamp : a)),
        );
        logActivityRef.current(
          "absence.updated",
          next.id,
          next.assignee,
          next.startDate,
          next.endDate,
        );
      } else {
        setAbsences((prev) => [...prev, withStamp]);
        logActivityRef.current(
          "absence.created",
          next.id,
          next.assignee,
          next.startDate,
          next.endDate,
        );
      }
      setEditingAbsence(null);
    },
    [absences, setAbsences],
  );

  const handleDeleteAbsence = useCallback(
    (id: number) => {
      const removed = absences.find((a) => a.id === id);
      setAbsences((prev) => prev.filter((a) => a.id !== id));
      if (removed) {
        logActivityRef.current("absence.deleted", id, removed.assignee);
      }
      setEditingAbsence(null);
    },
    [absences, setAbsences],
  );

  const handleOpenShiftEditor = useCallback(
    (existing: Shift | null, seed: { display: string; email: string }) => {
      if (existing) {
        setEditingShift({ shift: existing, isNew: false });
        return;
      }
      const nextId =
        shifts.length > 0 ? Math.max(...shifts.map((s) => s.id)) + 1 : 1;
      const draft: Shift = {
        ...emptyShiftDraft(nextId),
        assignee: seed.display,
        assigneeEmail: seed.email || undefined,
      };
      setEditingShift({ shift: draft, isNew: true });
    },
    [shifts],
  );

  const handleCloseShiftModal = useCallback(() => {
    setEditingShift(null);
  }, []);

  const handleSaveShift = useCallback(
    (next: Shift) => {
      const stamp = new Date().toISOString();
      const withStamp: Shift = { ...next, localModifiedAt: stamp };
      const existing = shifts.find((s) => s.id === next.id);
      if (existing) {
        setShifts((prev) =>
          prev.map((s) => (s.id === next.id ? withStamp : s)),
        );
        logActivityRef.current("shift.updated", next.id, next.assignee);
      } else {
        setShifts((prev) => [...prev, withStamp]);
        logActivityRef.current("shift.created", next.id, next.assignee);
      }
      setEditingShift(null);
    },
    [shifts, setShifts],
  );

  const handleDeleteShift = useCallback(
    (id: number) => {
      const removed = shifts.find((s) => s.id === id);
      setShifts((prev) => prev.filter((s) => s.id !== id));
      if (removed) {
        logActivityRef.current("shift.deleted", id, removed.assignee);
      }
      setEditingShift(null);
    },
    [shifts, setShifts],
  );

  const handleCreateMitigationTaskFromRaid = useCallback(
    (raidItemId: number): number | null => {
      const item = raid.find((r) => r.id === raidItemId);
      if (!item) return null;
      const list = tasksRef.current;
      const newId =
        list.length > 0 ? Math.max(...list.map((tk) => tk.id)) + 1 : 1;
      const stamp = new Date().toISOString();
      const today = isoToday();
      const newTask: Task = {
        id: newId,
        taskName: item.title,
        assignee: item.owner ?? "",
        assigneeEmail: item.ownerEmail ?? "",
        dueDate: item.targetDate ?? today,
        lastUpdateDate: today,
        priority: "Medium",
        blockers: "",
        notes: item.mitigation ?? item.description ?? "",
        inquiriesSent: 0,
        localModifiedAt: stamp,
      };
      const nextList = [...list, newTask];
      tasksRef.current = nextList;
      setTasks(nextList);
      setRaid((prev) =>
        prev.map((r) =>
          r.id === raidItemId
            ? {
                ...r,
                linkedTaskIds: [...r.linkedTaskIds, newId],
                localModifiedAt: stamp,
              }
            : r,
        ),
      );
      return newId;
    },
    [raid, setRaid, setTasks],
  );

  return {
    editingAbsence,
    editingShift,
    handleSaveRaidItem,
    handleDeleteRaidItem,
    handleOpenAddAbsence,
    handleEditAbsence,
    handleCloseAbsenceModal,
    handleSaveAbsence,
    handleDeleteAbsence,
    handleOpenShiftEditor,
    handleCloseShiftModal,
    handleSaveShift,
    handleDeleteShift,
    handleCreateMitigationTaskFromRaid,
  };
}
```

- [ ] **Step 2: Run tests — expect all 12 pass**

```
npx vitest run src/app/use-resource-planner.test.tsx --reporter=verbose
```

Expected: `12 passed`

- [ ] **Step 3: Run full suite — confirm no regressions**

```
npx vitest run --reporter=verbose
```

Expected: all previously passing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/use-resource-planner.ts
git commit -m "feat(use-resource-planner): implement all CRUD handlers (GREEN)"
```

---

## Phase B — useBulkOperations

---

### Task 5: Scaffold use-bulk-operations.test.tsx + state-init tests (RED)

**Files:**
- Create: `src/app/use-bulk-operations.test.tsx`

- [ ] **Step 1: Create the test file**

```typescript
// src/app/use-bulk-operations.test.tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Lang } from "./i18n";
import type { Task } from "./types";
import { defaultSettings } from "./settings-menu";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { FiltersProvider } from "./filters-context";
import { TaskFormProvider } from "./task-form-context";
import {
  useBulkOperations,
  type UseBulkOperationsArgs,
} from "./use-bulk-operations";

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <FiltersProvider>
        <TaskFormProvider>{children}</TaskFormProvider>
      </FiltersProvider>
    </WorkspaceProvider>
  );
}

function makeArgs(
  overrides?: Partial<UseBulkOperationsArgs>,
): UseBulkOperationsArgs {
  return {
    lang: "en-US" as Lang,
    settings: defaultSettings,
    setSettings: vi.fn(),
    handlers: {
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onSendInquiry: vi.fn(),
    },
    onCancelEdit: vi.fn(),
    logActivity: vi.fn(),
    showToast: vi.fn(),
    ...overrides,
  };
}

function renderBulk(overrides?: Partial<UseBulkOperationsArgs>) {
  const args = makeArgs(overrides);
  const { result } = renderHook(
    () => ({
      bulk: useBulkOperations(args),
      workspace: useWorkspace(),
    }),
    { wrapper: Wrapper },
  );
  return { result, args };
}

describe("useBulkOperations", () => {
  describe("initial state", () => {
    it("selectedIds is empty initially", () => {
      const { result } = renderBulk();
      expect(result.current.bulk.selectedIds.size).toBe(0);
    });

    it("allVisibleSelected is false initially", () => {
      const { result } = renderBulk();
      expect(result.current.bulk.allVisibleSelected).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```
npx vitest run src/app/use-bulk-operations.test.tsx --reporter=verbose
```

Expected: `Error: Cannot find module './use-bulk-operations'`

- [ ] **Step 3: Commit**

```bash
git add src/app/use-bulk-operations.test.tsx
git commit -m "test(use-bulk-operations): scaffold test file + state-init tests (RED)"
```

---

### Task 6: Create use-bulk-operations.ts skeleton (GREEN on state-init tests)

**Files:**
- Create: `src/app/use-bulk-operations.ts`

- [ ] **Step 1: Create the skeleton**

```typescript
// src/app/use-bulk-operations.ts
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import type { Settings } from "./settings-menu";
import type { Task } from "./types";
import type { ActivityKind } from "./activity-log";
import type { Command } from "./voice";
import {
  greetingName,
  isValidEmail,
  sanitizeAssignee,
  sanitizeBlockers,
  sanitizeEmail,
  sanitizeGroup,
  sanitizeIsoDate,
  sanitizeLabels,
  sanitizeNotes,
  sanitizePriority,
  sanitizeTaskName,
  sanitizeVoiceTranscript,
} from "./sanitize";
import { useWorkspace } from "./workspace-context";
import { useTaskForm, emptyBulkEdit, emptyForm } from "./task-form-context";
import { useFilters } from "./filters-context";

export interface BulkRowHandlers {
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
  onSendInquiry: (task: Task) => void;
}

export interface UseBulkOperationsArgs {
  lang: Lang;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  handlers: BulkRowHandlers;
  onCancelEdit: () => void;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
}

export function useBulkOperations(args: UseBulkOperationsArgs) {
  const { tasks, setTasks, filteredSortedTasks } = useWorkspace();
  const {
    bulkEdit,
    setBulkEdit,
    setBulkEditOpen,
    setForm,
    setEditingId,
    setTaskModalOpen,
  } = useTaskForm();
  const { setSearch } = useFilters();

  const langRef = useRef(args.lang);
  const showToastRef = useRef(args.showToast);
  const logActivityRef = useRef(args.logActivity);
  const handlersRef = useRef(args.handlers);
  const onCancelEditRef = useRef(args.onCancelEdit);
  const setSettingsRef = useRef(args.setSettings);
  useEffect(() => { langRef.current = args.lang; }, [args.lang]);
  useEffect(() => { showToastRef.current = args.showToast; }, [args.showToast]);
  useEffect(() => { logActivityRef.current = args.logActivity; }, [args.logActivity]);
  useEffect(() => { handlersRef.current = args.handlers; }, [args.handlers]);
  useEffect(() => { onCancelEditRef.current = args.onCancelEdit; }, [args.onCancelEdit]);
  useEffect(() => { setSettingsRef.current = args.setSettings; }, [args.setSettings]);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const visibleIds = useMemo(
    () => filteredSortedTasks.map((r) => r.id),
    [filteredSortedTasks],
  );

  const allVisibleSelected = useMemo(
    () =>
      visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id)),
    [visibleIds, selectedIds],
  );

  const selectedJiraCount = useMemo(
    () =>
      tasks.reduce(
        (n, r) => (selectedIds.has(r.id) && r.jiraKey ? n + 1 : n),
        0,
      ),
    [tasks, selectedIds],
  );

  // Stub implementations — filled in Task 8
  const onToggleSelect = useCallback((_id: number) => {}, []);
  const toggleSelectAllVisible = useCallback(() => {}, []);
  const clearSelection = useCallback(() => {}, []);
  const cancelBulkEdit = useCallback(() => {}, []);
  const applyBulkEdit = useCallback(() => {}, []);
  const handleBulkSendInquiry = useCallback(() => {}, []);
  const handleClearAll = useCallback(() => {}, []);
  const handleCommand = useCallback(
    (_cmd: Command, _originalText: string) => {},
    [],
  );

  return {
    selectedIds,
    allVisibleSelected,
    selectedJiraCount,
    onToggleSelect,
    toggleSelectAllVisible,
    clearSelection,
    cancelBulkEdit,
    applyBulkEdit,
    handleBulkSendInquiry,
    handleClearAll,
    handleCommand,
  };
}
```

- [ ] **Step 2: Run tests — expect 2 pass**

```
npx vitest run src/app/use-bulk-operations.test.tsx --reporter=verbose
```

Expected: `2 passed`

- [ ] **Step 3: Commit**

```bash
git add src/app/use-bulk-operations.ts
git commit -m "feat(use-bulk-operations): create hook skeleton (GREEN)"
```

---

### Task 7: Add bulk handler + command tests (RED)

**Files:**
- Modify: `src/app/use-bulk-operations.test.tsx`

- [ ] **Step 1: Append 10 handler tests inside `describe("useBulkOperations")`**

Add after the `"initial state"` describe block:

```typescript
  describe("selection", () => {
    it("onToggleSelect adds id; calling again removes it", () => {
      const { result } = renderBulk();
      act(() => { result.current.bulk.onToggleSelect(1); });
      expect(result.current.bulk.selectedIds.has(1)).toBe(true);
      act(() => { result.current.bulk.onToggleSelect(1); });
      expect(result.current.bulk.selectedIds.has(1)).toBe(false);
    });

    it("clearSelection empties selectedIds", () => {
      const { result } = renderBulk();
      act(() => { result.current.bulk.onToggleSelect(1); });
      act(() => { result.current.bulk.onToggleSelect(2); });
      act(() => { result.current.bulk.clearSelection(); });
      expect(result.current.bulk.selectedIds.size).toBe(0);
    });
  });

  describe("bulk edit", () => {
    it("applyBulkEdit shows error toast when no fields enabled", () => {
      const showToast = vi.fn();
      const { result } = renderBulk({ showToast });
      act(() => { result.current.bulk.applyBulkEdit(); });
      expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
    });
  });

  describe("handleClearAll", () => {
    it("does nothing when tasks is empty", () => {
      const { result } = renderBulk();
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      act(() => { result.current.bulk.handleClearAll(); });
      expect(confirmSpy).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });

    it("clears tasks when window.confirm returns true", () => {
      const { result } = renderBulk();
      act(() => {
        result.current.workspace.setTasks([
          {
            id: 1,
            taskName: "Task A",
            assignee: "Alice",
            dueDate: "2026-06-01",
            lastUpdateDate: "2026-05-20",
            priority: "Medium",
            blockers: "",
            notes: "",
            inquiriesSent: 0,
            localModifiedAt: "2026-05-20T00:00:00.000Z",
          },
        ]);
      });
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      act(() => { result.current.bulk.handleClearAll(); });
      expect(result.current.workspace.tasks).toHaveLength(0);
      expect(result.current.bulk.selectedIds.size).toBe(0);
      confirmSpy.mockRestore();
    });

    it("does NOT clear tasks when window.confirm returns false", () => {
      const { result } = renderBulk();
      act(() => {
        result.current.workspace.setTasks([
          {
            id: 1,
            taskName: "Task A",
            assignee: "Alice",
            dueDate: "2026-06-01",
            lastUpdateDate: "2026-05-20",
            priority: "Medium",
            blockers: "",
            notes: "",
            inquiriesSent: 0,
            localModifiedAt: "2026-05-20T00:00:00.000Z",
          },
        ]);
      });
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      act(() => { result.current.bulk.handleClearAll(); });
      expect(result.current.workspace.tasks).toHaveLength(1);
      confirmSpy.mockRestore();
    });
  });

  describe("handleCommand", () => {
    it('kind="edit" calls handlers.onEdit with matching task', () => {
      const onEdit = vi.fn();
      const { result } = renderBulk({
        handlers: { onEdit, onDelete: vi.fn(), onSendInquiry: vi.fn() },
      });
      const task: Task = {
        id: 42,
        taskName: "Fix bug",
        assignee: "Alice",
        dueDate: "2026-06-01",
        lastUpdateDate: "2026-05-20",
        priority: "High",
        blockers: "",
        notes: "",
        inquiriesSent: 0,
        localModifiedAt: "2026-05-20T00:00:00.000Z",
      };
      act(() => { result.current.workspace.setTasks([task]); });
      act(() => {
        result.current.bulk.handleCommand({ kind: "edit", id: 42 } as Command, "");
      });
      expect(onEdit).toHaveBeenCalledWith(task);
    });

    it('kind="search" filters visible tasks', () => {
      const { result } = renderBulk();
      act(() => {
        result.current.workspace.setTasks([
          {
            id: 1,
            taskName: "Alpha task",
            assignee: "Alice",
            dueDate: "2026-06-01",
            lastUpdateDate: "2026-05-20",
            priority: "Medium",
            blockers: "",
            notes: "",
            inquiriesSent: 0,
            localModifiedAt: "2026-05-20T00:00:00.000Z",
          },
          {
            id: 2,
            taskName: "Beta task",
            assignee: "Bob",
            dueDate: "2026-06-01",
            lastUpdateDate: "2026-05-20",
            priority: "Medium",
            blockers: "",
            notes: "",
            inquiriesSent: 0,
            localModifiedAt: "2026-05-20T00:00:00.000Z",
          },
        ]);
      });
      act(() => {
        result.current.bulk.handleCommand(
          { kind: "search", query: "Alpha" } as Command,
          "",
        );
      });
      expect(result.current.workspace.filteredSortedTasks).toHaveLength(1);
      expect(result.current.workspace.filteredSortedTasks[0].id).toBe(1);
    });
  });

  describe("handleBulkSendInquiry", () => {
    it("opens mailto link and logs bulk.inquiries for selected task with email", () => {
      const logActivity = vi.fn();
      const { result } = renderBulk({ logActivity });
      const task: Task = {
        id: 1,
        taskName: "Task A",
        assignee: "Alice",
        assigneeEmail: "alice@test.com",
        dueDate: "2026-06-01",
        lastUpdateDate: "2026-05-20",
        priority: "Medium",
        blockers: "",
        notes: "",
        inquiriesSent: 0,
        localModifiedAt: "2026-05-20T00:00:00.000Z",
      };
      act(() => { result.current.workspace.setTasks([task]); });
      act(() => { result.current.bulk.onToggleSelect(1); });
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      act(() => { result.current.bulk.handleBulkSendInquiry(); });
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining("mailto:alice%40test.com"),
      );
      expect(logActivity).toHaveBeenCalledWith("bulk.inquiries", 1);
      openSpy.mockRestore();
      confirmSpy.mockRestore();
    });
  });
```

- [ ] **Step 2: Run tests — expect 10 failures**

```
npx vitest run src/app/use-bulk-operations.test.tsx --reporter=verbose
```

Expected: `2 passed, 10 failed`

- [ ] **Step 3: Commit**

```bash
git add src/app/use-bulk-operations.test.tsx
git commit -m "test(use-bulk-operations): add bulk handler + command tests (RED)"
```

---

### Task 8: Implement all bulk handlers (GREEN)

**Files:**
- Modify: `src/app/use-bulk-operations.ts`

Replace all stub `useCallback` bodies with real implementations:

- [ ] **Step 1: Replace stub bodies**

Replace the stub section (from `// Stub implementations` down to the `return` statement) with:

```typescript
  const onToggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected =
        visibleIds.length > 0 && visibleIds.every((id) => next.has(id));
      if (allSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [visibleIds]);

  const cancelBulkEdit = useCallback(() => {
    setBulkEditOpen(false);
    setBulkEdit(emptyBulkEdit());
  }, [setBulkEdit, setBulkEditOpen]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setBulkEditOpen(false);
  }, [setBulkEditOpen]);

  const applyBulkEdit = useCallback(() => {
    const lang = langRef.current;
    const today = new Date().toISOString().slice(0, 10);
    const fields = bulkEdit.enabled;
    const anyEnabled = Object.values(fields).some(Boolean);
    if (!anyEnabled) {
      showToastRef.current("error", t(lang, "bulkEditNoFields"));
      return;
    }
    if (fields.assignee) {
      const blockedCount = tasks.reduce(
        (n, row) => (selectedIds.has(row.id) && row.jiraKey ? n + 1 : n),
        0,
      );
      if (blockedCount > 0) {
        window.alert(t(lang, "jiraBulkAssigneeBlocked", blockedCount));
        return;
      }
    }
    const newDue = fields.dueDate ? sanitizeIsoDate(bulkEdit.dueDate) : "";
    if (fields.dueDate && (!newDue || newDue < today)) {
      showToastRef.current("error", t(lang, "errorPastDate"));
      return;
    }
    const newEmail = fields.assigneeEmail
      ? sanitizeEmail(bulkEdit.assigneeEmail)
      : "";
    if (fields.assigneeEmail && newEmail && !isValidEmail(newEmail)) {
      showToastRef.current("error", t(lang, "errorInvalidEmail"));
      return;
    }
    const updates: Partial<Task> = {};
    if (fields.priority) updates.priority = sanitizePriority(bulkEdit.priority);
    if (fields.dueDate) updates.dueDate = newDue;
    if (fields.lastUpdateDate)
      updates.lastUpdateDate =
        sanitizeIsoDate(bulkEdit.lastUpdateDate) || today;
    if (fields.assignee) updates.assignee = sanitizeAssignee(bulkEdit.assignee);
    if (fields.assigneeEmail) updates.assigneeEmail = newEmail;
    if (fields.blockers) updates.blockers = sanitizeBlockers(bulkEdit.blockers);
    if (fields.notes) updates.notes = sanitizeNotes(bulkEdit.notes);
    if (fields.group) updates.group = sanitizeGroup(bulkEdit.group);
    if (fields.labels) updates.labels = sanitizeLabels(bulkEdit.labels);
    const count = selectedIds.size;
    const stamp = new Date().toISOString();
    setTasks((prev) =>
      prev.map((row) =>
        selectedIds.has(row.id)
          ? { ...row, ...updates, localModifiedAt: stamp }
          : row,
      ),
    );
    showToastRef.current(
      "info",
      count === 1
        ? t(lang, "bulkEditDoneOne")
        : t(lang, "bulkEditDoneMany", count),
    );
    logActivityRef.current("bulk.edit", count);
    setBulkEditOpen(false);
    setBulkEdit(emptyBulkEdit());
    setSelectedIds(new Set());
  }, [bulkEdit, selectedIds, tasks, setTasks, setBulkEdit, setBulkEditOpen]);

  const handleClearAll = useCallback(() => {
    if (tasks.length === 0) return;
    if (!window.confirm(t(langRef.current, "confirmClearAll", tasks.length))) return;
    setTasks([]);
    setSelectedIds(new Set());
    onCancelEditRef.current();
  }, [tasks, setTasks]);

  const handleBulkSendInquiry = useCallback(() => {
    const lang = langRef.current;
    const selected = tasks.filter((row) => selectedIds.has(row.id));
    if (selected.length === 0) return;

    const emailUpdates: Record<number, string> = {};
    const resolved: Array<{ task: Task; email: string }> = [];

    for (const task of selected) {
      let email = task.assigneeEmail?.trim() || "";
      if (!email && isValidEmail(task.assignee)) email = task.assignee.trim();
      if (!email) {
        const provided = window.prompt(t(lang, "promptEmail", task.assignee), "");
        if (provided === null) continue;
        const trimmed = provided.trim();
        if (!isValidEmail(trimmed)) {
          showToastRef.current("error", t(lang, "errorInvalidEmail"));
          continue;
        }
        email = trimmed;
        emailUpdates[task.id] = trimmed;
      }
      resolved.push({ task, email });
    }

    if (Object.keys(emailUpdates).length > 0) {
      setTasks((prev) =>
        prev.map((row) =>
          emailUpdates[row.id]
            ? { ...row, assigneeEmail: emailUpdates[row.id] }
            : row,
        ),
      );
    }

    if (resolved.length === 0) {
      showToastRef.current("error", t(lang, "bulkSendNoTasks"));
      return;
    }

    const groups = new Map<string, Task[]>();
    for (const { task, email } of resolved) {
      const list = groups.get(email) || [];
      list.push(task);
      groups.set(email, list);
    }

    if (!window.confirm(t(lang, "confirmBulkSend", groups.size, resolved.length))) {
      return;
    }

    for (const [email, taskList] of groups) {
      const greeting = greetingName(taskList[0].assignee) || taskList[0].assignee;
      const subject =
        taskList.length === 1
          ? t(lang, "emailSubject", taskList[0].id, taskList[0].taskName)
          : t(lang, "emailSubjectBulk", taskList.length);
      let body: string;
      if (taskList.length === 1) {
        const t0 = taskList[0];
        body = t(lang, "emailBodyTemplate", greeting, t0.id, t0.taskName, t0.dueDate, t0.lastUpdateDate);
      } else {
        const items = taskList
          .map((tk) => `- #${tk.id}: ${tk.taskName} (${tk.dueDate})`)
          .join("\n");
        body = t(lang, "emailBodyBulkTemplate", greeting, taskList.length, items);
      }
      const url = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.open(url);
    }

    const sentIds = new Set(resolved.map(({ task }) => task.id));
    setTasks((prev) =>
      prev.map((row) =>
        sentIds.has(row.id)
          ? { ...row, inquiriesSent: (row.inquiriesSent ?? 0) + 1 }
          : row,
      ),
    );
    showToastRef.current("info", t(lang, "bulkSendDone", groups.size, resolved.length));
    logActivityRef.current("bulk.inquiries", resolved.length);
    setSelectedIds(new Set());
  }, [tasks, selectedIds, setTasks]);

  const handleCommand = useCallback(
    (cmd: Command, originalText: string) => {
      const lang = langRef.current;
      switch (cmd.kind) {
        case "edit": {
          const task = tasks.find((row) => row.id === cmd.id);
          if (!task) {
            showToastRef.current("error", t(lang, "voiceTaskNotFound", cmd.id));
            return;
          }
          handlersRef.current.onEdit(task);
          return;
        }
        case "delete": {
          const task = tasks.find((row) => row.id === cmd.id);
          if (!task) {
            showToastRef.current("error", t(lang, "voiceTaskNotFound", cmd.id));
            return;
          }
          handlersRef.current.onDelete(cmd.id);
          return;
        }
        case "sendInquiry": {
          const task = tasks.find((row) => row.id === cmd.id);
          if (!task) {
            showToastRef.current("error", t(lang, "voiceTaskNotFound", cmd.id));
            return;
          }
          handlersRef.current.onSendInquiry(task);
          return;
        }
        case "clearAll":
          handleClearAll();
          return;
        case "openForm":
          onCancelEditRef.current();
          setTaskModalOpen(true);
          return;
        case "openFormWith":
          onCancelEditRef.current();
          setForm({ ...emptyForm(), taskName: sanitizeTaskName(cmd.taskName) });
          setTaskModalOpen(true);
          return;
        case "search":
          setSearch(sanitizeVoiceTranscript(cmd.query));
          return;
        case "clearSearch":
          setSearch("");
          return;
        case "language":
          setSettingsRef.current((s) => ({ ...s, language: cmd.lang }));
          return;
        case "unknown":
          showToastRef.current("error", t(lang, "voiceUnknownCommand", originalText));
          return;
      }
    },
    [tasks, handleClearAll, setTaskModalOpen, setForm, setSearch],
  );
```

- [ ] **Step 2: Run tests — expect all 12 pass**

```
npx vitest run src/app/use-bulk-operations.test.tsx --reporter=verbose
```

Expected: `12 passed`

- [ ] **Step 3: Run full suite**

```
npx vitest run --reporter=verbose
```

Expected: all tests pass (123+).

- [ ] **Step 4: Commit**

```bash
git add src/app/use-bulk-operations.ts
git commit -m "feat(use-bulk-operations): implement all bulk handlers (GREEN)"
```

---

### Task 9: Refactor task-manager.tsx to consume both hooks

**Files:**
- Modify: `src/app/task-manager.tsx`

- [ ] **Step 1: Add two imports after the useStorageBackend import**

Find `import { useStorageBackend } from "./use-storage-backend";` and add after it:

```typescript
import { useResourcePlanner } from "./use-resource-planner";
import { useBulkOperations } from "./use-bulk-operations";
```

- [ ] **Step 2: Add hook call sites after the useStorageBackend call**

Find `const { storageDescription, storageReady, ...` and add AFTER the closing `};` of that destructuring:

```typescript
  const {
    editingAbsence,
    editingShift,
    handleSaveRaidItem,
    handleDeleteRaidItem,
    handleOpenAddAbsence,
    handleEditAbsence,
    handleCloseAbsenceModal,
    handleSaveAbsence,
    handleDeleteAbsence,
    handleOpenShiftEditor,
    handleCloseShiftModal,
    handleSaveShift,
    handleDeleteShift,
    handleCreateMitigationTaskFromRaid,
  } = useResourcePlanner({ lang, logActivity, showToast });

  const {
    selectedIds,
    allVisibleSelected,
    selectedJiraCount,
    onToggleSelect,
    toggleSelectAllVisible,
    clearSelection,
    cancelBulkEdit,
    applyBulkEdit,
    handleBulkSendInquiry,
    handleClearAll,
    handleCommand,
  } = useBulkOperations({
    lang,
    settings,
    setSettings,
    handlers: { onEdit: handleEdit, onDelete, onSendInquiry },
    onCancelEdit: handleCancelEdit,
    logActivity,
    showToast,
  });
```

- [ ] **Step 3: Remove extracted declarations — search for each and delete the entire block**

Use your editor's search to find and delete each of the following blocks. Each block starts at the line shown and ends at the next blank line or next declaration:

| Search string | Block to delete |
|---|---|
| `const [selectedIds, setSelectedIds]` | the `useState<Set<number>>` line |
| `const onToggleSelect = useCallback` | the full useCallback block |
| `const [editingAbsence, setEditingAbsence]` | the `useState` block |
| `const [editingShift, setEditingShift]` | the `useState` block |
| `const handleSaveRaidItem = useCallback` | entire useCallback block through its closing `), [raid, today, lang, logActivity],` |
| `const handleDeleteRaidItem = useCallback` | entire block |
| `const handleOpenAddAbsence = useCallback` | entire block |
| `const handleEditAbsence = useCallback` | entire block |
| `const handleCloseAbsenceModal = useCallback` | entire block |
| `const handleSaveAbsence = useCallback` | entire block |
| `const handleDeleteAbsence = useCallback` | entire block |
| `const handleOpenShiftEditor = useCallback` | entire block |
| `const handleCloseShiftModal = useCallback` | entire block |
| `const handleSaveShift = useCallback` | entire block |
| `const handleDeleteShift = useCallback` | entire block |
| `const handleCreateMitigationTaskFromRaid = useCallback` | entire block |
| `function handleClearAll()` | entire function body |
| `function handleCommand(` | entire function body |
| `function toggleSelectAllVisible()` | entire function |
| `function clearSelection()` | entire function |
| `function cancelBulkEdit()` | entire function |
| `function applyBulkEdit()` | entire function |
| `function handleBulkSendInquiry()` | entire function |
| `const allVisibleSelected =` | the const line |
| `const selectedJiraCount =` | the const line |

- [ ] **Step 4: Check tasksRef**

Search `tasksRef` in task-manager.tsx. If `handleGanttBarUpdate` or `handleSubmit` still reference it, keep it. If the only remaining usages are inside `useEffect(() => { tasksRef.current = tasks; })`, check whether any handler still uses it — if none, remove `tasksRef` and its sync effect.

- [ ] **Step 5: Run TypeScript check**

```
npx tsc --noEmit
```

Expected: no errors. Fix any type errors before proceeding (usually: a deleted variable still referenced in JSX, or a missing import).

- [ ] **Step 6: Run full test suite**

```
npx vitest run --reporter=verbose
```

Expected: all tests pass.

- [ ] **Step 7: Verify line count**

```
(Get-Content src/app/task-manager.tsx).Count
```

Expected: approximately 2,200 lines (down from 2,813).

- [ ] **Step 8: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "refactor(task-manager): consume useResourcePlanner + useBulkOperations"
```

---

### Task 10: Version bump to v0.7.6 + CHANGELOG "Duras"

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Read and update src/app/version.ts**

Read `src/app/version.ts` first, then set:
- `APP_VERSION = "0.7.6"`
- `APP_BUILD_DATE = "2026-05-20"`
- Update comment block to describe Slice 8: useResourcePlanner + useBulkOperations extraction

- [ ] **Step 2: Prepend to CHANGELOG.md**

Read the first 20 lines of `CHANGELOG.md` to match format, then prepend:

```markdown
## [0.7.6] "Duras" — 2026-05-20

### Refactored
- Extracted `useResourcePlanner` hook (~350 lines): RAID CRUD, absence CRUD (with modal state), shift CRUD (with modal state), `handleCreateMitigationTaskFromRaid`
- Extracted `useBulkOperations` hook (~270 lines): `selectedIds` state, bulk edit, `handleCommand` (voice dispatcher), `handleClearAll`, `handleBulkSendInquiry`
- `task-manager.tsx` −620 net lines; now ~2,200 lines

### Tests
- `use-resource-planner.test.tsx`: 12 tests — modal state, RAID/absence/shift CRUD, auto-issue on Risk→Realized, mitigation-task creation
- `use-bulk-operations.test.tsx`: 12 tests — selection toggle, bulk edit validation, clearAll confirm, handleCommand dispatch, bulk inquiry mailto
```

- [ ] **Step 3: Update README badge**

Find the version badge line containing `v0.7.5` and replace with `v0.7.6`.

- [ ] **Step 4: Run full test suite**

```
npx vitest run --reporter=verbose
```

Expected: all tests pass (135+).

- [ ] **Step 5: Run TypeScript check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/version.ts CHANGELOG.md README.md
git commit -m "release(v0.7.6): Duras - useResourcePlanner + useBulkOperations extraction"
```
