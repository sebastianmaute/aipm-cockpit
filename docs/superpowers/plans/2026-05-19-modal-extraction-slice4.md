# Modal Extraction (Slice 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the two inline modal JSX blocks out of `src/app/task-manager.tsx` (lines 2863–3260 for the task form modal, lines 3496–3767 for the bulk-edit modal) into two new self-contained components — `<TaskFormModal />` and `<BulkEditModal />`. Pure refactor; no observable behaviour change. Spec: `docs/superpowers/specs/2026-05-19-modal-extraction-slice4-design.md`.

**Architecture:** Two new files. Each new component reads its `form` / `editingId` / `taskModalOpen` (or `bulkEdit` / `bulkEditOpen`) state directly from `useTaskForm()`. Everything else — handlers, derived values, `lang`, `today`, `modalRef`, `showToast`, etc. — flows in as flat props. The visibility guard (`taskModalOpen && (...)` / `bulkEditOpen && selectedIds.size > 0 && (...)`) moves *inside* the component; the call site is just `<TaskFormModal ... />` / `<BulkEditModal ... />`. The two existing small helpers `Field` and `BulkEditFieldRow` (each used only inside its own modal) and the `InlineMicButton` dynamic import (only used in the task form modal) move with their modal. `ResetSizeIcon` stays in `task-manager.tsx` — it is used twice but only outside the modal blocks.

**Tech Stack:** React 19 + Next 16 (App Router, `"use client"`); TypeScript; Vitest 3 + `@testing-library/react`. Mirrors the pattern of Slices 2b and 3.

---

## File Structure

| File | Role |
|---|---|
| `src/app/task-form-modal.tsx` | **NEW** ~420 lines — `<TaskFormModal>` component, `Field` helper, `InlineMicButton` dynamic import, `TaskFormModalProps` type |
| `src/app/task-form-modal.test.tsx` | **NEW** ~140 lines, 4 tests |
| `src/app/bulk-edit-modal.tsx` | **NEW** ~330 lines — `<BulkEditModal>` component, `BulkEditFieldRow` helper, `BulkEditModalProps` type |
| `src/app/bulk-edit-modal.test.tsx` | **NEW** ~150 lines, 7 tests |
| `src/app/task-manager.tsx` | Modified — delete the two modal JSX blocks (~670 lines), delete `Field` / `BulkEditFieldRow` / `InlineMicButton` dynamic import (~80 lines), add `<TaskFormModal />` and `<BulkEditModal />` call sites (~30 lines), add two new imports |

---

## Identifier mapping (reference for all four tasks)

Use this section whenever you need to know what an identifier inside the old JSX should become inside the new component.

**From `useTaskForm()` inside the new component** (no prop needed):

| Identifier in old JSX | New source inside the modal component |
|---|---|
| `form`, `setForm`           | `const { form, setForm } = useTaskForm();` |
| `editingId`, `setEditingId` | `const { editingId, setEditingId } = useTaskForm();` |
| `taskModalOpen`             | `const { taskModalOpen } = useTaskForm();` (used for the `if (!taskModalOpen) return null;` guard) |
| `bulkEdit`, `setBulkEdit`   | `const { bulkEdit, setBulkEdit } = useTaskForm();` |
| `bulkEditOpen`              | `const { bulkEditOpen } = useTaskForm();` (used for the bulk-edit visibility guard) |

**From props** (everything else the old JSX referenced):

Task form modal:

| Identifier in old JSX | New source | Prop type |
|---|---|---|
| `lang`                  | `props.lang` | `Lang` |
| `today`                 | `props.today` | `string` |
| `nextId`                | `props.nextId` | `number` |
| `contactsList`          | `props.contactsList` | `ReturnType<typeof listContacts>` |
| `absences`              | `props.absences` | `Absence[]` |
| `tasks` (only inside `<DependenciesEditor tasks={tasks} />`) | `props.tasksForDeps` | `Task[]` |
| `uniqueGroups`          | `props.uniqueGroups` | `string[]` |
| `uniqueLabels`          | `props.uniqueLabels` | `string[]` |
| `editingIsJiraLinked`   | `props.editingIsJiraLinked` | `boolean` |
| `jiraEnabled`           | `props.jiraEnabled` | `boolean` |
| `modalRef`              | `props.modalRef` | `RefObject<HTMLDivElement>` |
| `handleSubmit`          | `props.onSubmit` | `(e: React.FormEvent<HTMLFormElement>) => void` |
| `handleCancelEdit`      | `props.onCancel` | `() => void` |
| `handleRemoveContact`   | `props.onRemoveContact` | `(name: string) => void` |
| `showToast`             | `props.onShowToast` | `(kind: "info" \| "error", text: string) => void` |
| `isEditing`             | Local `const isEditing = editingId !== null;` (derived inside the component) |

Bulk-edit modal:

| Identifier in old JSX | New source | Prop type |
|---|---|---|
| `lang`             | `props.lang` | `Lang` |
| `today`            | `props.today` | `string` |
| `selectedIds`      | `props.selectedIds` | `Set<number>` |
| `selectedJiraCount`| `props.selectedJiraCount` | `number` |
| `uniqueGroups`     | `props.uniqueGroups` | `string[]` |
| `uniqueLabels`     | `props.uniqueLabels` | `string[]` |
| `applyBulkEdit`    | `props.onApply` | `() => void` |
| `cancelBulkEdit`   | `props.onCancel` | `() => void` |

Constants referenced inside the moved JSX must be imported from their original modules in the new files (not from `task-manager.tsx`, which would create a circular import):

- `PRIORITIES`, `PRIORITY_RANK` — from `./types`
- `TASK_NAME_MAX`, `ASSIGNEE_MAX`, `EMAIL_MAX`, `GROUP_MAX`, `TEXTAREA_MAX` — from `./sanitize`
- `sanitizeVoiceTranscript` — from `./sanitize`
- `priorityLabel`, `t`, `type Lang` — from `./i18n`
- `HEALTH_VALUES`, `formatHealthTooltip`, `healthColorName`, `healthDot` — from `./health`
- `inputClass` — module-level local string in `task-manager.tsx` (Tailwind utility composition). Grep before copying: if used outside the modal blocks too, declare an identical copy in each new file. The string is one line; duplication is acceptable for slice scope (a third shared file would be scope creep).

---

## Task 1: Scaffold `task-form-modal.tsx` with a null-rendering stub and its first test

**Files:**
- Create: `src/app/task-form-modal.tsx`
- Create: `src/app/task-form-modal.test.tsx`
- Test: `src/app/task-form-modal.test.tsx`

Goal of this task: stand up the new module with the right exports and one passing test that proves the closed-modal render path returns `null`. No real JSX yet.

- [ ] **Step 1: Write the failing test**

Create `src/app/task-form-modal.test.tsx`:

```tsx
import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { TaskFormProvider, useTaskForm } from "./task-form-context";
import { TaskFormModal } from "./task-form-modal";

// Module-scoped ref so the inline open below runs exactly once per render
// tree (React renders Probe twice in StrictMode; we want one setState).
const taskModalOpenedRef = { current: false };

function Probe({
  children,
  openModal,
}: {
  children: ReactNode;
  openModal: boolean;
}) {
  const { setTaskModalOpen } = useTaskForm();
  if (openModal && !taskModalOpenedRef.current) {
    taskModalOpenedRef.current = true;
    setTaskModalOpen(true);
  }
  return <>{children}</>;
}

function defaultProps() {
  return {
    lang: "en-US" as const,
    today: "2026-05-19",
    nextId: 1,
    contactsList: [],
    absences: [],
    tasksForDeps: [],
    uniqueGroups: [],
    uniqueLabels: [],
    editingIsJiraLinked: false,
    jiraEnabled: false,
    modalRef: createRef<HTMLDivElement>(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    onRemoveContact: vi.fn(),
    onShowToast: vi.fn(),
  };
}

describe("TaskFormModal", () => {
  test("renders nothing when taskModalOpen is false", () => {
    taskModalOpenedRef.current = false;
    const { container } = render(
      <TaskFormProvider>
        <Probe openModal={false}>
          <TaskFormModal {...defaultProps()} />
        </Probe>
      </TaskFormProvider>,
    );
    expect(container.querySelector("form")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/task-form-modal.test.tsx`

Expected: FAIL with module resolution error (`Cannot find module './task-form-modal'`).

- [ ] **Step 3: Write minimal implementation (null-rendering stub)**

Create `src/app/task-form-modal.tsx`:

```tsx
"use client";

import { type RefObject } from "react";
import { type listContacts } from "./contacts";
import { type Lang } from "./i18n";
import { useTaskForm } from "./task-form-context";
import { type Absence, type Task } from "./types";

export interface TaskFormModalProps {
  lang: Lang;
  today: string;
  nextId: number;
  contactsList: ReturnType<typeof listContacts>;
  absences: Absence[];
  tasksForDeps: Task[];
  uniqueGroups: string[];
  uniqueLabels: string[];
  editingIsJiraLinked: boolean;
  jiraEnabled: boolean;
  modalRef: RefObject<HTMLDivElement>;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onRemoveContact: (name: string) => void;
  onShowToast: (kind: "info" | "error", text: string) => void;
}

export function TaskFormModal(_props: TaskFormModalProps) {
  const { taskModalOpen } = useTaskForm();
  if (!taskModalOpen) return null;
  // Real JSX arrives in Task 2.
  return null;
}
```

> Note: `listContacts` is a function imported as a value. If TypeScript complains about importing it purely for its return type, switch the import to `import type { listContacts } from "./contacts";` — the type expression `ReturnType<typeof listContacts>` stays the same.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/task-form-modal.test.tsx`

Expected: PASS, 1 test.

- [ ] **Step 5: TypeScript / build check**

Run: `npm run build`

Expected: builds successfully. `task-form-modal.tsx` compiles even though it's not yet wired into `task-manager.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/app/task-form-modal.tsx src/app/task-form-modal.test.tsx
git commit -m "feat(task-form-modal): scaffold component + null-when-closed test"
```

---

## Task 2: Move task form modal JSX into `<TaskFormModal>`, delete from `task-manager.tsx`, add remaining 3 tests

**Files:**
- Modify: `src/app/task-form-modal.tsx`
- Modify: `src/app/task-form-modal.test.tsx`
- Modify: `src/app/task-manager.tsx` (delete lines 2863–3260, delete `Field` function at lines 4023–4043, delete `InlineMicButton` dynamic import at lines 170–173, add `<TaskFormModal />` instantiation, add import)
- Test: `src/app/task-form-modal.test.tsx`

This is the largest step in the slice. Do it in two sub-passes inside this task: (a) move the JSX, get `npm run build` and the existing 1 test green, then (b) add the remaining three behaviour tests.

- [ ] **Step 1: Read the source ranges into context**

Open `src/app/task-manager.tsx` and read all three ranges before editing — you'll need them for the moves:
- Lines **170–173**: the `InlineMicButton` dynamic import.
- Lines **2863–3260**: the task form modal JSX (starts with `{taskModalOpen && (`, ends with the closing `</Modal>` + `)}`).
- Lines **4023–4043**: the `Field` helper function.

Also grep `task-manager.tsx` for `inputClass` to confirm whether it is used outside the two modal blocks. If it is (likely), declare it identically in both new modal files (`task-form-modal.tsx` now, `bulk-edit-modal.tsx` later in Task 4) so the new files compile without importing from `task-manager.tsx`.

- [ ] **Step 2: Move the JSX, Field, and InlineMicButton into `task-form-modal.tsx`**

Replace the stub body. The component now reads form state from `useTaskForm()`, computes `isEditing` locally, and renders the JSX previously at `task-manager.tsx:2863–3260`. The outer `{taskModalOpen && ( ... )}` wrapper becomes the early-return guard at the top of the component. Apply the identifier mapping table verbatim — every reference to `lang`, `today`, `nextId`, `contactsList`, `absences`, `tasks`, `uniqueGroups`, `uniqueLabels`, `editingIsJiraLinked`, `jiraEnabled`, `modalRef`, `handleSubmit`, `handleCancelEdit`, `handleRemoveContact`, and `showToast` becomes the corresponding prop. New file shape (copy the real JSX from `task-manager.tsx:2864–3259` between the start/end markers):

```tsx
"use client";

import dynamic from "next/dynamic";
import { type RefObject } from "react";
import { ComboInput } from "./combo-input";
import { ContactInput } from "./contact-input";
import { type listContacts } from "./contacts";
import { DependenciesEditor } from "./dependencies-editor";
import {
  HEALTH_VALUES,
  formatHealthTooltip,
  healthColorName,
  healthDot,
} from "./health";
import { type Lang, priorityLabel, t } from "./i18n";
import { LabelsInput } from "./labels-input";
import { Modal } from "./modal";
import {
  ASSIGNEE_MAX,
  EMAIL_MAX,
  GROUP_MAX,
  TASK_NAME_MAX,
  TEXTAREA_MAX,
  sanitizeVoiceTranscript,
} from "./sanitize";
import { SegmentedControl } from "./segmented-control";
import { useTaskForm } from "./task-form-context";
import { PRIORITIES, type Absence, type Task } from "./types";

// voice-button is lazy-loaded — see task-manager.tsx for the original rationale.
const InlineMicButton = dynamic(
  () => import("./voice-button").then((m) => m.InlineMicButton),
  { ssr: false },
);

// Same compact input class the rest of the form uses. Declared here to avoid
// a circular import back into task-manager.tsx.
const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

export interface TaskFormModalProps {
  lang: Lang;
  today: string;
  nextId: number;
  contactsList: ReturnType<typeof listContacts>;
  absences: Absence[];
  tasksForDeps: Task[];
  uniqueGroups: string[];
  uniqueLabels: string[];
  editingIsJiraLinked: boolean;
  jiraEnabled: boolean;
  modalRef: RefObject<HTMLDivElement>;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onRemoveContact: (name: string) => void;
  onShowToast: (kind: "info" | "error", text: string) => void;
}

export function TaskFormModal({
  lang,
  today,
  nextId,
  contactsList,
  absences,
  tasksForDeps,
  uniqueGroups,
  uniqueLabels,
  editingIsJiraLinked,
  jiraEnabled,
  modalRef,
  onSubmit,
  onCancel,
  onRemoveContact,
  onShowToast,
}: TaskFormModalProps) {
  const { form, setForm, editingId, taskModalOpen } = useTaskForm();
  const isEditing = editingId !== null;
  if (!taskModalOpen) return null;

  return (
    // ── BEGIN moved JSX (was task-manager.tsx:2864–3259) ───────────────────
    //
    // Paste verbatim, then apply renames per the identifier mapping table:
    //   handleSubmit         → onSubmit
    //   handleCancelEdit     → onCancel
    //   handleRemoveContact  → onRemoveContact
    //   showToast            → onShowToast
    //   tasks (inside <DependenciesEditor tasks={...} />) → tasksForDeps
    //
    // Everything else (lang, today, nextId, contactsList, absences,
    // uniqueGroups, uniqueLabels, editingIsJiraLinked, jiraEnabled,
    // modalRef, form, setForm, editingId, isEditing) keeps its name because
    // it is either a destructured prop or read from useTaskForm()/derived
    // above. PRIORITIES, *_MAX constants, priorityLabel(), t(), healthDot(),
    // healthColorName(), HEALTH_VALUES, formatHealthTooltip(), Modal,
    // SegmentedControl, Field, InlineMicButton, ContactInput, ComboInput,
    // LabelsInput, DependenciesEditor are imported at the top of this file.
    //
    // ── END moved JSX ─────────────────────────────────────────────────────
    <Modal
      open
      onClose={onCancel}
      ariaLabel={
        isEditing ? t(lang, "tabEditTask", editingId!) : t(lang, "tabNewTask")
      }
      backdropClassName="bg-AIPM-dark-blue/40 overflow-y-auto"
    >
      {/* ... the rest of the JSX from task-manager.tsx:2874–3258 ... */}
    </Modal>
  );
}

// Field helper — moved verbatim from task-manager.tsx:4023–4043.
function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}
```

- [ ] **Step 3: Update `task-manager.tsx`**

Four edits, in this order:

1. **Replace the modal JSX block** (lines 2863–3260) with a call site. Find:

   ```tsx
         {taskModalOpen && (
           <Modal
             open
             onClose={handleCancelEdit}
             ...
           </Modal>
         )}
   ```

   Replace with:

   ```tsx
         <TaskFormModal
           lang={lang}
           today={today}
           nextId={nextId}
           contactsList={contactsList}
           absences={absences}
           tasksForDeps={tasks}
           uniqueGroups={uniqueGroups}
           uniqueLabels={uniqueLabels}
           editingIsJiraLinked={editingIsJiraLinked}
           jiraEnabled={jiraEnabled}
           modalRef={modalRef}
           onSubmit={handleSubmit}
           onCancel={handleCancelEdit}
           onRemoveContact={handleRemoveContact}
           onShowToast={showToast}
         />
   ```

2. **Delete the `Field` function** (lines 4023–4043 in the original file; line numbers will have shifted after edit 1).

3. **Delete the `InlineMicButton` dynamic import** (lines 170–173 in the original file; the four-line block beginning with `const InlineMicButton = dynamic(`). The neighbouring `VoiceCommandButton` import stays.

4. **Add the `<TaskFormModal>` import.** Near the other component imports (after the `task-form-context` import block at the top of the file):

   ```tsx
   import { TaskFormModal } from "./task-form-modal";
   ```

- [ ] **Step 4: Run test + build to verify first test still passes**

Run: `npx vitest run src/app/task-form-modal.test.tsx`

Expected: PASS, 1 test (the renders-null-when-closed test still passes against the now-real component because the guard at the top still returns `null`).

Run: `npm run build`

Expected: TypeScript clean, Next bundles successfully. The build is the safety net for missed identifier renames inside the moved JSX. If TypeScript complains about an undefined identifier in `task-form-modal.tsx`, it is almost certainly a value referenced in the old JSX that needs to become a prop (and a corresponding `onXxx` / value prop pair must be added to `defaultProps()` in the test as well).

- [ ] **Step 5: Run the full Vitest suite**

Run: `npx vitest run`

Expected: All previously-green tests stay green. Pre-slice baseline is 58 tests across 9 files. After Task 2: 58 + 1 = 59 across 10 files.

- [ ] **Step 6: Add the remaining 3 tests**

Append the following tests to `src/app/task-form-modal.test.tsx` inside the existing `describe("TaskFormModal", ...)` block:

```tsx
  test("renders header and form when modal is open", () => {
    taskModalOpenedRef.current = false;
    render(
      <TaskFormProvider>
        <Probe openModal={true}>
          <TaskFormModal {...defaultProps()} />
        </Probe>
      </TaskFormProvider>,
    );
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
    expect(document.querySelector("form")).not.toBeNull();
  });

  test("close button fires onCancel exactly once", () => {
    taskModalOpenedRef.current = false;
    const props = defaultProps();
    render(
      <TaskFormProvider>
        <Probe openModal={true}>
          <TaskFormModal {...props} />
        </Probe>
      </TaskFormProvider>,
    );
    // The header close button is the only button in the modal that carries
    // an aria-label (it's t(lang, "alertModalClose")).
    const closeButton = screen
      .getAllByRole("button")
      .find((b) => (b.getAttribute("aria-label") ?? "").length > 0);
    expect(closeButton).toBeDefined();
    closeButton!.click();
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  test("submitting the form fires onSubmit", () => {
    taskModalOpenedRef.current = false;
    const props = defaultProps();
    render(
      <TaskFormProvider>
        <Probe openModal={true}>
          <TaskFormModal {...props} />
        </Probe>
      </TaskFormProvider>,
    );
    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    form!.requestSubmit();
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });
```

> Note on the close-button selector: if a future refactor introduces another `aria-label`-bearing button into the modal *header*, tighten the selector to `screen.getByRole("button", { name: t("en", "alertModalClose") })` — this requires importing `t` from `./i18n`.

> Note on the form selector: `<Modal>` may render via a React portal under `document.body` rather than the test container. The selectors above use `document.querySelector` and `screen` (which queries from `document.body`) precisely to handle that case.

- [ ] **Step 7: Run the test file**

Run: `npx vitest run src/app/task-form-modal.test.tsx`

Expected: PASS, 4 tests.

- [ ] **Step 8: Run the full Vitest suite**

Run: `npx vitest run`

Expected: 62 tests across 10 files (58 + 4 new). All green.

- [ ] **Step 9: Manual smoke**

Start the dev server (`npm run dev`) and verify in a browser:

1. Click `+ Add task` → modal opens with empty fields and `#1` (or next available id).
2. Fill in a task name and due date → click the submit button → modal closes and a new task row appears.
3. Click the pencil icon on an existing row → modal opens with that task's data; close (`×` button) → modal closes, no change.
4. Drag the bottom-right corner of the modal to resize it; close and re-open → size persists from localStorage (this confirms the `modalRef` / `useResizable` wiring still attaches the ref).

- [ ] **Step 10: Commit**

```bash
git add src/app/task-form-modal.tsx src/app/task-form-modal.test.tsx src/app/task-manager.tsx
git commit -m "refactor(task-manager): extract TaskFormModal into its own file"
```

---

## Task 3: Scaffold `bulk-edit-modal.tsx` with a null-rendering stub and its first two tests

**Files:**
- Create: `src/app/bulk-edit-modal.tsx`
- Create: `src/app/bulk-edit-modal.test.tsx`
- Test: `src/app/bulk-edit-modal.test.tsx`

Mirrors Task 1 for the bulk-edit modal. The bulk-edit modal has TWO visibility conditions (`bulkEditOpen && selectedIds.size > 0`), so the stub-stage covers both with two tests instead of one.

- [ ] **Step 1: Write the failing test**

Create `src/app/bulk-edit-modal.test.tsx`:

```tsx
import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { TaskFormProvider, useTaskForm } from "./task-form-context";
import { BulkEditModal } from "./bulk-edit-modal";

const bulkOpenedRef = { current: false };

function Probe({
  children,
  openBulk,
}: {
  children: ReactNode;
  openBulk: boolean;
}) {
  const { setBulkEditOpen } = useTaskForm();
  if (openBulk && !bulkOpenedRef.current) {
    bulkOpenedRef.current = true;
    setBulkEditOpen(true);
  }
  return <>{children}</>;
}

function defaultProps(
  overrides: Partial<{
    selectedIds: Set<number>;
    selectedJiraCount: number;
  }> = {},
) {
  return {
    lang: "en-US" as const,
    today: "2026-05-19",
    selectedIds: overrides.selectedIds ?? new Set<number>([1]),
    selectedJiraCount: overrides.selectedJiraCount ?? 0,
    uniqueGroups: [],
    uniqueLabels: [],
    onApply: vi.fn(),
    onCancel: vi.fn(),
  };
}

describe("BulkEditModal", () => {
  test("renders nothing when bulkEditOpen is false", () => {
    bulkOpenedRef.current = false;
    const { container } = render(
      <TaskFormProvider>
        <Probe openBulk={false}>
          <BulkEditModal {...defaultProps()} />
        </Probe>
      </TaskFormProvider>,
    );
    expect(container.querySelector("h3")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("renders nothing when bulkEditOpen is true but selectedIds is empty", () => {
    bulkOpenedRef.current = false;
    const { container } = render(
      <TaskFormProvider>
        <Probe openBulk={true}>
          <BulkEditModal {...defaultProps({ selectedIds: new Set() })} />
        </Probe>
      </TaskFormProvider>,
    );
    expect(container.querySelector("h3")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/bulk-edit-modal.test.tsx`

Expected: FAIL with `Cannot find module './bulk-edit-modal'`.

- [ ] **Step 3: Write minimal implementation (null-rendering stub)**

Create `src/app/bulk-edit-modal.tsx`:

```tsx
"use client";

import { type Lang } from "./i18n";
import { useTaskForm } from "./task-form-context";

export interface BulkEditModalProps {
  lang: Lang;
  today: string;
  selectedIds: Set<number>;
  selectedJiraCount: number;
  uniqueGroups: string[];
  uniqueLabels: string[];
  onApply: () => void;
  onCancel: () => void;
}

export function BulkEditModal(props: BulkEditModalProps) {
  const { bulkEditOpen } = useTaskForm();
  if (!bulkEditOpen) return null;
  if (props.selectedIds.size === 0) return null;
  // Real JSX arrives in Task 4.
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/bulk-edit-modal.test.tsx`

Expected: PASS, 2 tests.

- [ ] **Step 5: TypeScript / build check**

Run: `npm run build`

Expected: builds successfully.

- [ ] **Step 6: Commit**

```bash
git add src/app/bulk-edit-modal.tsx src/app/bulk-edit-modal.test.tsx
git commit -m "feat(bulk-edit-modal): scaffold component + null-when-closed tests"
```

---

## Task 4: Move bulk-edit modal JSX into `<BulkEditModal>`, delete from `task-manager.tsx`, add remaining 5 tests

**Files:**
- Modify: `src/app/bulk-edit-modal.tsx`
- Modify: `src/app/bulk-edit-modal.test.tsx`
- Modify: `src/app/task-manager.tsx` (delete the bulk-edit JSX block, delete `BulkEditFieldRow` function, add `<BulkEditModal />` instantiation, add import)
- Test: `src/app/bulk-edit-modal.test.tsx`

> Note: after Task 2, line numbers in `task-manager.tsx` have shifted. Re-read the file before editing rather than trusting the line numbers from the spec. Locate the bulk-edit block by searching for `{bulkEditOpen && selectedIds.size > 0 && (` and `BulkEditFieldRow` by searching for `function BulkEditFieldRow(`.

- [ ] **Step 1: Read the source ranges into context**

Open `src/app/task-manager.tsx` and read the bulk-edit JSX block and the `BulkEditFieldRow` helper. Confirm via `grep "BulkEditFieldRow" src/app/task-manager.tsx` that the helper is not referenced anywhere outside the bulk-edit JSX (during spec writing this was confirmed: nine internal usages, no external usage).

- [ ] **Step 2: Move the JSX and `BulkEditFieldRow` into `bulk-edit-modal.tsx`**

Replace the stub body. The component reads `bulkEdit`, `setBulkEdit`, and `bulkEditOpen` from `useTaskForm()`, and every other identifier becomes a prop per the identifier mapping table. The outer guard `{bulkEditOpen && selectedIds.size > 0 && ( ... )}` is replaced by the two early-returns already present in the stub. New file shape (copy the real JSX from the bulk-edit block in `task-manager.tsx` between the start/end markers, and copy the `BulkEditFieldRow` body from its function definition):

```tsx
"use client";

import { ComboInput } from "./combo-input";
import { type Lang, priorityLabel, t } from "./i18n";
import { LabelsInput } from "./labels-input";
import {
  ASSIGNEE_MAX,
  EMAIL_MAX,
  GROUP_MAX,
  TEXTAREA_MAX,
} from "./sanitize";
import { useTaskForm, type BulkEditField } from "./task-form-context";
import { PRIORITIES, type Priority } from "./types";

// Same compact input class the rest of the form uses. Duplicated here to
// avoid a circular import back into task-manager.tsx.
const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

export interface BulkEditModalProps {
  lang: Lang;
  today: string;
  selectedIds: Set<number>;
  selectedJiraCount: number;
  uniqueGroups: string[];
  uniqueLabels: string[];
  onApply: () => void;
  onCancel: () => void;
}

export function BulkEditModal({
  lang,
  today,
  selectedIds,
  selectedJiraCount,
  uniqueGroups,
  uniqueLabels,
  onApply,
  onCancel,
}: BulkEditModalProps) {
  const { bulkEdit, setBulkEdit, bulkEditOpen } = useTaskForm();
  if (!bulkEditOpen) return null;
  if (selectedIds.size === 0) return null;

  return (
    // ── BEGIN moved JSX (was task-manager.tsx bulk-edit block) ────────────
    //
    // Paste verbatim, then apply renames per the identifier mapping table:
    //   applyBulkEdit  → onApply
    //   cancelBulkEdit → onCancel
    //
    // bulkEdit, setBulkEdit, lang, today, selectedIds, selectedJiraCount,
    // uniqueGroups, uniqueLabels keep their names (destructured props or
    // useTaskForm() reads above). PRIORITIES, *_MAX, priorityLabel(), t(),
    // ComboInput, LabelsInput, BulkEditFieldRow imported / defined locally.
    //
    // ── END moved JSX ─────────────────────────────────────────────────────
    <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {/* ... the rest of the JSX, with the renames above applied ... */}
    </div>
  );
}

// BulkEditFieldRow helper — moved verbatim from task-manager.tsx.
function BulkEditFieldRow({
  id,
  label,
  enabled,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  enabled: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={enabled}
        onChange={onToggle}
        className="mt-2 h-4 w-4 cursor-pointer rounded border-zinc-300 text-AIPM-dark-blue focus:ring-AIPM-dark-blue dark:border-zinc-600 dark:bg-zinc-800"
      />
      <div className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className="mb-1 block cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          {label}
        </label>
        {children}
      </div>
    </div>
  );
}
```

> Note on `BulkEditField` import: it is included above because some `setBulkEdit` updaters inside the moved JSX type the keys of `bulkEdit.enabled`. If the moved JSX does not in fact reference `BulkEditField`, drop the import — TypeScript will warn on unused imports.

> Note on `Priority` import: included for the `e.target.value as Priority` cast inside the priority `<select>` `onChange`. Drop if unused after the move.

- [ ] **Step 3: Update `task-manager.tsx`**

Three edits, in this order:

1. **Replace the bulk-edit JSX block** with a call site. Find the block beginning with `{bulkEditOpen && selectedIds.size > 0 && (` and replace it with:

   ```tsx
         <BulkEditModal
           lang={lang}
           today={today}
           selectedIds={selectedIds}
           selectedJiraCount={selectedJiraCount}
           uniqueGroups={uniqueGroups}
           uniqueLabels={uniqueLabels}
           onApply={applyBulkEdit}
           onCancel={cancelBulkEdit}
         />
   ```

2. **Delete the `BulkEditFieldRow` function.**

3. **Add the `<BulkEditModal>` import.** Right after the `TaskFormModal` import added in Task 2:

   ```tsx
   import { BulkEditModal } from "./bulk-edit-modal";
   ```

- [ ] **Step 4: Run test + build to verify first 2 tests still pass**

Run: `npx vitest run src/app/bulk-edit-modal.test.tsx`

Expected: PASS, 2 tests.

Run: `npm run build`

Expected: TypeScript clean. As in Task 2, build failures here usually mean an identifier inside the moved JSX still expects a value that needs a prop or local destructure.

- [ ] **Step 5: Add the remaining 5 tests**

Append to `src/app/bulk-edit-modal.test.tsx` inside the existing `describe("BulkEditModal", ...)` block:

```tsx
  test("renders the heading when exactly one row is selected", () => {
    bulkOpenedRef.current = false;
    render(
      <TaskFormProvider>
        <Probe openBulk={true}>
          <BulkEditModal {...defaultProps({ selectedIds: new Set([1]) })} />
        </Probe>
      </TaskFormProvider>,
    );
    expect(screen.getByRole("heading", { level: 3 })).toBeInTheDocument();
  });

  test("renders the count in the heading when multiple rows are selected", () => {
    bulkOpenedRef.current = false;
    render(
      <TaskFormProvider>
        <Probe openBulk={true}>
          <BulkEditModal {...defaultProps({ selectedIds: new Set([1, 2, 3]) })} />
        </Probe>
      </TaskFormProvider>,
    );
    // Plural title interpolates the count in any language. Substring match
    // on "3" is robust to translations of the surrounding phrase.
    expect(
      screen.getByRole("heading", { level: 3 }).textContent ?? "",
    ).toMatch(/3/);
  });

  test("cancel button fires onCancel exactly once", () => {
    bulkOpenedRef.current = false;
    const props = defaultProps();
    render(
      <TaskFormProvider>
        <Probe openBulk={true}>
          <BulkEditModal {...props} />
        </Probe>
      </TaskFormProvider>,
    );
    // The cancel button has a neutral (white/bg-white) style; the apply
    // button uses bg-AIPM-dark-blue. Resolve by *not* being the primary.
    const buttons = screen.getAllByRole("button");
    const cancel = buttons.find(
      (b) => !(b.className ?? "").includes("bg-AIPM-dark-blue"),
    );
    expect(cancel).toBeDefined();
    cancel!.click();
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  test("apply button fires onApply exactly once", () => {
    bulkOpenedRef.current = false;
    const props = defaultProps({ selectedIds: new Set([1]) });
    render(
      <TaskFormProvider>
        <Probe openBulk={true}>
          <BulkEditModal {...props} />
        </Probe>
      </TaskFormProvider>,
    );
    const buttons = screen.getAllByRole("button");
    const apply = buttons.find((b) =>
      (b.className ?? "").includes("bg-AIPM-dark-blue"),
    );
    expect(apply).toBeDefined();
    apply!.click();
    expect(props.onApply).toHaveBeenCalledTimes(1);
  });

  test("toggling the priority row updates bulkEdit.enabled.priority via setBulkEdit", () => {
    bulkOpenedRef.current = false;
    const captured: { enabledPriority?: boolean } = {};

    function Spy() {
      const { bulkEdit } = useTaskForm();
      captured.enabledPriority = bulkEdit.enabled.priority;
      return null;
    }

    render(
      <TaskFormProvider>
        <Probe openBulk={true}>
          <BulkEditModal {...defaultProps()} />
          <Spy />
        </Probe>
      </TaskFormProvider>,
    );

    expect(captured.enabledPriority).toBe(false);

    // BulkEditFieldRow renders an <input type="checkbox" id={id}> toggle.
    // The priority row uses id="bulk-priority".
    const toggle = document.getElementById("bulk-priority") as
      | HTMLInputElement
      | null;
    expect(toggle).not.toBeNull();
    toggle!.click();
    expect(captured.enabledPriority).toBe(true);
  });
```

> **If the toggle selector fails** because `BulkEditFieldRow` uses a different control (e.g., a `<button role="switch">`), adjust the lookup. The contract being asserted — that clicking the row's toggle flips `bulkEdit.enabled.priority` — is independent of the control shape.

> **If the primary-button selector fails** for cancel/apply because the Tailwind class string differs from `bg-AIPM-dark-blue`, switch to resolving by the button's accessible name using the i18n keys `cancel`, `bulkApplyOne`, `bulkApplyMany`.

- [ ] **Step 6: Run the test file**

Run: `npx vitest run src/app/bulk-edit-modal.test.tsx`

Expected: PASS, 7 tests.

- [ ] **Step 7: Run the full Vitest suite**

Run: `npx vitest run`

Expected: 69 tests across 11 files. All green.

- [ ] **Step 8: Manual smoke**

Start the dev server (`npm run dev`) and verify in a browser:

1. Select two rows via their row-checkboxes → click bulk-edit toggle in the toolbar → bulk-edit panel appears with the plural title showing "2".
2. Enable the priority row's toggle → change the priority → click Apply → both rows get the new priority; the panel closes.
3. Re-open bulk-edit → click Cancel → panel closes; the previously-applied priority change persists, the draft does not.
4. Open bulk-edit with one row selected → singular title appears.
5. Deselect all rows while bulk-edit is open → panel disappears (the `selectedIds.size === 0` guard).

- [ ] **Step 9: Commit**

```bash
git add src/app/bulk-edit-modal.tsx src/app/bulk-edit-modal.test.tsx src/app/task-manager.tsx
git commit -m "refactor(task-manager): extract BulkEditModal into its own file"
```

---

## Final verification (after all four tasks land)

- [ ] **Full test suite**

Run: `npx vitest run`

Expected: 69 tests across 11 files, all green. (58 pre-slice + 11 new = 69.)

- [ ] **Type check + bundle**

Run: `npm run build`

Expected: clean.

- [ ] **Line-count check on `task-manager.tsx`**

Run: `wc -l src/app/task-manager.tsx`

Expected: ~3500 lines (down from 4224, a ~700-line drop).

- [ ] **Manual smoke (combined)**

Repeat the smoke checks from Task 2 and Task 4 in a single session. Confirm the drag-resize handle on the task form modal still saves size to localStorage (`lop-app:task-modal-size`).

- [ ] **Commit log review**

Run: `git log --oneline -5`

Expected (newest first):
```
<hash> refactor(task-manager): extract BulkEditModal into its own file
<hash> feat(bulk-edit-modal): scaffold component + null-when-closed tests
<hash> refactor(task-manager): extract TaskFormModal into its own file
<hash> feat(task-form-modal): scaffold component + null-when-closed test
<hash> docs(spec): Slice 4 — modal extraction (TaskFormModal + BulkEditModal) design
```
