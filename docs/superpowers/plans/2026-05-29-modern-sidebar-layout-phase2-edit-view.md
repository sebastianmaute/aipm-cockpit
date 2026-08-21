# Modern Sidebar Layout — Phase 2 (Full-Page Edit View) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the modern layout, host the task editor as a full-viewport `edit` view (styled per `docs/patterns/edit.png`) instead of the overlay modal; Classic mode and all popouts keep the existing modal — both surfaces reuse the same form fields, state, and validation.

**Architecture:** Extract the modal's field grid into a shared `TaskFormFields` (a fragment of `<Field>` rows reading `useTaskForm()`). The modal keeps its chrome + Save/Cancel buttons; a new `TaskEditView` renders the same fields full-page inside a Dark-Blue-headed card, with Save (green) / Cancel migrated to the top bar via HTML `form=` association. The existing `taskModalOpen` flag stays the single "editor is open" signal: a layout-aware effect in `TaskManager` translates it into navigation to/from the reserved `edit` view (remembering the origin view to return to), while the modal is suppressed in the modern main window. No change to `use-task-submit`, the task-form context, or any data/validation logic.

**Tech Stack:** Next.js 16 (App Router) · React · TypeScript · Tailwind v4 (AIPM palette tokens) · Vitest + React Testing Library.

**Hard constraints (carried from the spec):**
- AIPM palette only (`AIPM-*` + semantic `surface`/`line`/`foreground`/`muted-foreground` tokens). Green dominant accent, Dark-Blue headings. **No gradients, no drop shadows, no off-palette colors.**
- All new copy goes through `t(lang, …)` with keys in **both** `i18n.ts` and `i18n.de.ts`. `i18n.de.ts` is prone to ASCII→curly-quote corruption — after editing it, **grep-verify** the new line and that the file still compiles (`npx tsc --noEmit`).
- Classic mode + every popout must stay behaviorally identical (the modal is the editor there).
- Spec reference: `docs/superpowers/specs/2026-05-29-modern-sidebar-layout-design.md` (§ "Full-page edit view (Phase 2)").

**Tooling notes:**
- Run a single test file: `npx vitest run src/app/<file>.test.tsx`
- Full suite: `npx vitest run` · Types: `npx tsc --noEmit` · Lint: `npx eslint src/app/<file>`
- `next lint` is removed in Next 16 — use `npx eslint`.
- `eslint.config.mjs` is hook-protected; do not edit it.

---

## File Structure

**New files**
- `src/app/task-form-fields.tsx` — the shared task-form field grid (fragment of `<Field>` rows + error + Jira-create checkbox), the `Field` / `EffortField` helpers, and the `inputClass` constant, all moved verbatim out of `task-form-modal.tsx`. Reads `useTaskForm()`. One clear responsibility: render the task form's inputs. Consumed by both the modal and the edit view.
- `src/app/task-edit-view.tsx` — exports `TASK_EDIT_FORM_ID` and `TaskEditView`: the full-page editor. Renders a Dark-Blue-headed card wrapping `<form id={TASK_EDIT_FORM_ID} onSubmit>` → `<TaskFormFields/>`. No buttons of its own (Save/Cancel live in the top bar).
- `src/app/task-form-fields.test.tsx`, `src/app/task-edit-view.test.tsx` — new tests.

**Modified files**
- `src/app/task-form-modal.tsx` — replace the inline field JSX with `<TaskFormFields …/>`; keep the `Modal`, `<form>`, `ModalHeader`, and the existing Save/Cancel buttons. Visually/behaviorally identical.
- `src/app/top-bar.tsx` — add optional `primaryAction?: React.ReactNode` (renders in place of the default New-task button when provided).
- `src/app/modern-shell.tsx` — add `editView` / `editTitle` / `editActions` props; render the `edit` view (content + title + top-bar Save/Cancel) when `activeView === "edit"`.
- `src/app/app-modals.tsx` — add `showTaskFormModal?: boolean` (default `true`) gating only the `<TaskFormModal>`.
- `src/app/task-manager.tsx` — read `taskModalOpen`; add the layout-aware editor entry/exit effect; build `editViewEl` / `editActions` / `editTitle`; pass them + `primaryAction` wiring to `ModernShell`; pass `showTaskFormModal` to `AppModals`.
- `src/app/i18n.ts`, `src/app/i18n.de.ts` — add `taskEditDetailsHeading` and `versionHighlightFullPageEdit`.
- `src/app/version.ts` — bump to `0.30.0` "Liu", add `versionHighlightFullPageEdit` to `APP_HIGHLIGHT_KEYS`, milestone comment.
- `CHANGELOG.md` — `0.30.0` entry.
- Memory: `modern-layout-roadmap.md` (+ `MEMORY.md` index line).

**Unchanged:** `use-task-submit.ts`, `task-form-context.tsx`, `use-hash-view.ts` (already guards `edit`), `nav-config.ts` (already reserves `edit`), all panels, storage, contexts.

---

### Why `taskModalOpen` stays the single editor flag

`taskModalOpen` already means "the task editor has been requested open." All entry points set it: row edit → `onEdit` → `openEditModal` → `setTaskModalOpen(true)`; the modern top-bar "New task" → `handleCancelEdit(); setTaskModalOpen(true)`; due-list selection → `openEditModal`. All exit points clear it: `handleSubmit` sets it `false` **only on success** (validation errors `return` early, leaving it `true`), and `handleCancelEdit` sets it `false`.

We reuse that success/failure signal unchanged. Define:

```ts
const useEditView = settings.layout === "modern" && !isPopout;
```

- **Classic mode / any popout** (`useEditView === false`): render `<TaskFormModal>` gated by `taskModalOpen` — today's behavior, untouched.
- **Modern main window** (`useEditView === true`): suppress the modal; render `TaskEditView` as the `edit` view; a single effect mirrors `taskModalOpen` into navigation:

```ts
// Enter "edit" when the editor opens; return to the origin view when it closes.
if (taskModalOpen && activeTab !== "edit") { editorReturnRef.current = activeTab; setActiveTab("edit"); }
else if (!taskModalOpen && activeTab === "edit") { setActiveTab(editorReturnRef.current); }
```

This gives correct behavior for free: a validation error keeps `taskModalOpen === true` → stays on the edit view; a successful save or Cancel clears it → returns to the origin view. It also degrades gracefully when the layout is toggled mid-edit (the suppressed/visible surface swaps automatically). `use-hash-view` already skips writing the hash while `activeTab === "edit"`, and `slugToView("edit")` already falls back to `open-points`, so `#edit` can never be deep-linked.

---

## Task 1: Extract `TaskFormFields` (pure refactor — no behavior change)

**Files:**
- Create: `src/app/task-form-fields.tsx`
- Create: `src/app/task-form-fields.test.tsx`
- Modify: `src/app/task-form-modal.tsx`

Goal: move the modal's inner field grid into a reusable component so the edit view can render the identical fields. The modal's rendered output stays the same.

- [ ] **Step 1: Write the failing test**

Create `src/app/task-form-fields.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { TestProviders } from "./test-providers";
import { TaskFormFields } from "./task-form-fields";

function Harness() {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <form aria-label="form">
      <TaskFormFields
        lang="en-US"
        today="2026-05-29"
        nextId={1}
        contactsList={[]}
        absences={[]}
        tasksForDeps={[]}
        uniqueGroups={[]}
        uniqueLabels={[]}
        editingIsJiraLinked={false}
        jiraEnabled={false}
        error={null}
        holidaySet={new Set()}
        jiraProjectKey={undefined}
        jiraDefaultIssueType={undefined}
        onRemoveContact={vi.fn()}
        onShowToast={vi.fn()}
        onAddAssigneeToAddressBook={vi.fn()}
      />
    </form>
  );
}

describe("TaskFormFields", () => {
  it("renders the core task fields", () => {
    render(<Harness />, { wrapper: TestProviders });
    expect(screen.getByText("Task name")).toBeTruthy();
    expect(screen.getByText("Assignee")).toBeTruthy();
    expect(screen.getByText("Due date")).toBeTruthy();
  });

  it("shows the error message when provided", () => {
    function ErrHarness() {
      return (
        <form aria-label="form">
          <TaskFormFields
            lang="en-US" today="2026-05-29" nextId={1} contactsList={[]}
            absences={[]} tasksForDeps={[]} uniqueGroups={[]} uniqueLabels={[]}
            editingIsJiraLinked={false} jiraEnabled={false} error="Boom"
            holidaySet={new Set()} jiraProjectKey={undefined} jiraDefaultIssueType={undefined}
            onRemoveContact={vi.fn()} onShowToast={vi.fn()} onAddAssigneeToAddressBook={vi.fn()}
          />
        </form>
      );
    }
    render(<ErrHarness />, { wrapper: TestProviders });
    expect(screen.getByRole("alert").textContent).toContain("Boom");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/app/task-form-fields.test.tsx`
Expected: FAIL — `Failed to resolve import "./task-form-fields"`.

- [ ] **Step 3: Create `task-form-fields.tsx`**

Move the helpers and the field grid out of `task-form-modal.tsx`. Create `src/app/task-form-fields.tsx` with:

1. The imports the fields need (copy from `task-form-modal.tsx`): `dynamic` (for `InlineMicButton`), `useState`, `ComboInput`, `ContactInput`, `listContacts` type, `DependenciesEditor`, `formatDuration`/`parseDuration`, the `health` imports, `priorityLabel`/`t`/`Lang`, `LabelsInput`, the `sanitize` constants + `sanitizeVoiceTranscript`, `EffortProgressBar`, `SegmentedControl`, `useTaskForm`, and `PRIORITIES`/`Absence`/`Task` types. Drop `Modal`, `ModalHeader`, `useDraggable` (those stay in the modal).
2. The `InlineMicButton` dynamic import and the `inputClass` constant (moved verbatim).
3. A `TaskFormFieldsProps` interface and the component.
4. The `Field` and `EffortField` helpers (moved verbatim, **exported** so the modal/others can reuse if needed).

```tsx
"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { ComboInput } from "./combo-input";
import { ContactInput } from "./contact-input";
import type { listContacts } from "./contacts";
import { DependenciesEditor } from "./dependencies-editor";
import { formatDuration, parseDuration } from "./duration";
import {
  computeTaskHealth,
  HEALTH_VALUES,
  healthColorName,
  healthDot,
  type Health,
} from "./health";
import { type Lang, priorityLabel, t } from "./i18n";
import { LabelsInput } from "./labels-input";
import {
  ASSIGNEE_MAX,
  EMAIL_MAX,
  GROUP_MAX,
  TASK_NAME_MAX,
  TEXTAREA_MAX,
  sanitizeVoiceTranscript,
} from "./sanitize";
import { EffortProgressBar } from "./effort-progress-bar";
import { SegmentedControl } from "./segmented-control";
import { useTaskForm } from "./task-form-context";
import { PRIORITIES, type Absence, type Task } from "./types";

const InlineMicButton = dynamic(
  () => import("./voice-button").then((m) => m.InlineMicButton),
  { ssr: false },
);

// Same compact input class the rest of the form uses.
export const inputClass =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green dark:border-line dark:bg-surface dark:text-foreground";

export interface TaskFormFieldsProps {
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
  error: string | null;
  holidaySet: Set<string>;
  jiraProjectKey: string | undefined;
  jiraDefaultIssueType: string | undefined;
  onRemoveContact: (name: string) => void;
  onShowToast: (kind: "info" | "error", text: string) => void;
  onAddAssigneeToAddressBook: (name: string, email: string) => void;
}

export function TaskFormFields({
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
  error,
  holidaySet,
  jiraProjectKey,
  jiraDefaultIssueType,
  onRemoveContact,
  onShowToast,
  onAddAssigneeToAddressBook,
}: TaskFormFieldsProps) {
  const { form, setForm, editingId } = useTaskForm();
  const isEditing = editingId !== null;

  return (
    <>
      {/* === MOVE VERBATIM === the JSX that is currently the children of the
          <form> in task-form-modal.tsx: from the `<Field label={t(lang,"id")}>`
          block through the Jira-create `</label>` block — i.e. EVERYTHING
          EXCEPT the final `<div className="flex justify-end gap-2 …">` button
          row. Do not change any field markup. The references `form`, `setForm`,
          `isEditing`, `editingId`, and every prop above already resolve here. */}
    </>
  );
}

// Field helper — moved verbatim from task-form-modal.tsx.
export function Field({
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
      <span className="mb-1 block text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-AIPM-pink">*</span>}
      </span>
      {children}
    </label>
  );
}

// Effort field — moved verbatim from task-form-modal.tsx.
function EffortField({
  lang,
  label,
  minutes,
  onChange,
}: {
  lang: Lang;
  label: string;
  minutes: number | undefined;
  onChange: (minutes: number | undefined) => void;
}) {
  const [text, setText] = useState(() => formatDuration(minutes ?? 0));
  const [invalid, setInvalid] = useState(false);

  return (
    <Field label={label}>
      <input
        type="text"
        value={text}
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          if (value.trim() === "") {
            setInvalid(false);
            onChange(undefined);
            return;
          }
          const mins = parseDuration(value);
          if (mins === null) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          onChange(mins);
        }}
        placeholder={t(lang, "taskEffortHint")}
        className={inputClass}
      />
      {invalid && (
        <p className="mt-1 text-xs text-AIPM-pink">
          {t(lang, "taskEffortInvalid")}
        </p>
      )}
    </Field>
  );
}
```

> **Important:** The body of `TaskFormFields` is the existing modal field JSX, copied exactly. It references `EffortField` (now local to this file), `Field` (local), `inputClass` (local), and all the props/imports above. The previous code read `form`, `setForm`, `editingId` (as `isEditing`) from the modal's `useTaskForm()` call — those now come from the `useTaskForm()` at the top of `TaskFormFields`. Do **not** include the final button row; that stays in the modal.

- [ ] **Step 4: Rewrite `task-form-modal.tsx` to consume `TaskFormFields`**

In `task-form-modal.tsx`:
1. Delete the moved imports that are now only used by the fields (`dynamic`/`InlineMicButton`, `ComboInput`, `ContactInput`, `DependenciesEditor`, `formatDuration`/`parseDuration`, `health` imports, `LabelsInput`, the `sanitize` constants, `EffortProgressBar`, `SegmentedControl`, `PRIORITIES`/`Absence`/`Task` if otherwise unused). Keep `Modal`, `ModalHeader`, `useDraggable`, `useTaskForm`, `t`/`Lang` only if still referenced.
2. Import the shared pieces: `import { TaskFormFields } from "./task-form-fields";`
3. Delete the local `inputClass`, `Field`, and `EffortField` definitions (now in `task-form-fields.tsx`).
4. Replace the `<form>` children (the field grid) with `<TaskFormFields …/>` followed by the **unchanged** button row. The `<form>` keeps its existing className so the grid layout is identical:

```tsx
        <form
          onSubmit={onSubmit}
          className="min-h-0 flex-1 overflow-y-auto grid grid-cols-1 gap-4 p-6 sm:grid-cols-2"
        >
          <TaskFormFields
            lang={lang}
            today={today}
            nextId={nextId}
            contactsList={contactsList}
            absences={absences}
            tasksForDeps={tasksForDeps}
            uniqueGroups={uniqueGroups}
            uniqueLabels={uniqueLabels}
            editingIsJiraLinked={editingIsJiraLinked}
            jiraEnabled={jiraEnabled}
            error={error}
            holidaySet={holidaySet}
            jiraProjectKey={jiraProjectKey}
            jiraDefaultIssueType={jiraDefaultIssueType}
            onRemoveContact={onRemoveContact}
            onShowToast={onShowToast}
            onAddAssigneeToAddressBook={onAddAssigneeToAddressBook}
          />
          <div className="flex justify-end gap-2 sm:col-span-2">
            {isEditing && (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted dark:border-line dark:bg-surface dark:text-foreground dark:hover:bg-surface-muted"
              >
                {t(lang, "cancel")}
              </button>
            )}
            <button
              type="submit"
              className="rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue focus:ring-offset-2"
            >
              {isEditing ? t(lang, "updateTask") : t(lang, "addTask")}
            </button>
          </div>
        </form>
```

(`isEditing` in the modal still derives from its own `useTaskForm()` call — keep that line.)

- [ ] **Step 5: Run the new test + the existing modal test**

Run: `npx vitest run src/app/task-form-fields.test.tsx src/app/task-form-modal.test.tsx`
Expected: PASS — both. The modal test is unchanged and proves the refactor preserved behavior.

- [ ] **Step 6: Types + lint**

Run: `npx tsc --noEmit` → clean. `npx eslint src/app/task-form-fields.tsx src/app/task-form-modal.tsx` → clean (remove any now-unused imports the linter flags).

- [ ] **Step 7: Commit**

```bash
git add src/app/task-form-fields.tsx src/app/task-form-fields.test.tsx src/app/task-form-modal.tsx
git commit -m "refactor: extract shared TaskFormFields from the task modal"
```

---

## Task 2: `TopBar` — optional `primaryAction` slot

**Files:**
- Modify: `src/app/top-bar.tsx`
- Modify: `src/app/top-bar.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/top-bar.test.tsx`:

```tsx
it("renders primaryAction in place of the default New-task button", () => {
  render(
    <TopBar
      lang="en-US"
      title="Editing task #5"
      bannerCount={0}
      onNewTask={() => {}}
      onShowAlerts={() => {}}
      primaryAction={<button type="button">Save changes</button>}
    />,
  );
  expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "New task" })).toBeNull();
});
```

(Reuse the existing imports/`render` from the top of `top-bar.test.tsx`. If the file has a `setup`/render helper, mirror its pattern but pass `primaryAction`.)

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/app/top-bar.test.tsx`
Expected: FAIL — `primaryAction` is not a prop; the New-task button is still present.

- [ ] **Step 3: Add the prop**

In `src/app/top-bar.tsx`, extend the interface and render logic:

```tsx
interface TopBarProps {
  lang: Lang;
  title: string;
  bannerCount: number;
  onNewTask: () => void;
  onShowAlerts: () => void;
  /** When set, replaces the default New-task button (e.g. Save/Cancel while editing). */
  primaryAction?: React.ReactNode;
  /** Menu components (Export/Help/Version/Settings/Voice) rendered as-is. */
  children?: React.ReactNode;
}

export function TopBar({ lang, title, bannerCount, onNewTask, onShowAlerts, primaryAction, children }: TopBarProps) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-line bg-surface px-6 py-3">
      <h1 className="text-xl font-semibold tracking-tight text-AIPM-dark-blue dark:text-AIPM-light-grey">
        {title}
      </h1>
      <div className="flex items-center gap-1">
        {primaryAction ?? (
          <button
            type="button"
            onClick={onNewTask}
            title={t(lang, "newTask")}
            className="rounded-md bg-AIPM-green px-3 py-1.5 text-sm font-semibold text-AIPM-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-green"
          >
            {t(lang, "newTask")}
          </button>
        )}
        {/* …existing bell button + {children} unchanged… */}
```

Leave the bell button and `{children}` exactly as they are.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/app/top-bar.test.tsx`
Expected: PASS (new test + all existing TopBar tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/top-bar.tsx src/app/top-bar.test.tsx
git commit -m "feat: add optional primaryAction slot to the modern top bar"
```

---

## Task 3: `AppModals` — gate the task modal with `showTaskFormModal`

**Files:**
- Modify: `src/app/app-modals.tsx`
- Modify: `src/app/app-modals.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/app-modals.test.tsx`. Mirror the file's existing render helper (it already constructs the long `AppModalsProps`); the only new assertions concern the `showTaskFormModal` flag while the task modal would otherwise be open. If the existing helper opens the task modal, set `taskModalOpen` via the provider exactly as the current passing tests do.

```tsx
it("hides the task form modal when showTaskFormModal is false", () => {
  // Render with the task modal requested open (same setup the existing
  // 'renders the task form modal' test uses) but showTaskFormModal={false}.
  renderAppModals({ showTaskFormModal: false }); // helper: see existing tests
  expect(screen.queryByRole("dialog", { name: /new task/i })).toBeNull();
});

it("shows the task form modal by default", () => {
  renderAppModals({}); // default showTaskFormModal (undefined → true)
  expect(screen.getByRole("dialog", { name: /new task/i })).toBeTruthy();
});
```

> If `app-modals.test.tsx` has no reusable helper, copy the props object from its first test and add the `showTaskFormModal` override. The dialog's accessible name comes from `ariaLabel={t(lang,"tabNewTask")}` ("New task") when not editing.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/app/app-modals.test.tsx`
Expected: FAIL — `showTaskFormModal` is not a prop; the dialog renders regardless.

- [ ] **Step 3: Add the prop**

In `src/app/app-modals.tsx`:
1. Add to `AppModalsProps`:

```tsx
  /** When false, the task form modal is not rendered (modern mode uses the
   *  full-page edit view instead). Defaults to true. */
  showTaskFormModal?: boolean;
```

2. Destructure it with a default in the function signature:

```tsx
export function AppModals({
  lang,
  isPopout,
  showTaskFormModal = true,
  // …rest unchanged…
}: AppModalsProps) {
```

3. Gate only the `<TaskFormModal>` render:

```tsx
    <>
      {showTaskFormModal && (
        <TaskFormModal
          lang={lang}
          today={today}
          /* …all existing props unchanged… */
          onShowToast={showToast}
        />
      )}
      {/* every other modal (Due, Jira, Absence, Shift, Resource, Roles),
          the footer, and the toast stay exactly as they are */}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/app/app-modals.test.tsx`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add src/app/app-modals.tsx src/app/app-modals.test.tsx
git commit -m "feat: allow suppressing the task form modal in AppModals"
```

---

## Task 4: `TaskEditView` + `TASK_EDIT_FORM_ID`

**Files:**
- Create: `src/app/task-edit-view.tsx`
- Create: `src/app/task-edit-view.test.tsx`

The full-page editor: a Dark-Blue-headed card wrapping the shared fields, with the form carrying a stable id so the top-bar Save button can submit it via HTML `form=` association.

- [ ] **Step 1: Write the failing test**

Create `src/app/task-edit-view.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TestProviders } from "./test-providers";
import { TaskEditView, TASK_EDIT_FORM_ID } from "./task-edit-view";

function setup(over: Partial<React.ComponentProps<typeof TaskEditView>> = {}) {
  const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
  render(
    <TaskEditView
      lang="en-US"
      today="2026-05-29"
      nextId={7}
      contactsList={[]}
      absences={[]}
      tasksForDeps={[]}
      uniqueGroups={[]}
      uniqueLabels={[]}
      editingIsJiraLinked={false}
      jiraEnabled={false}
      error={null}
      holidaySet={new Set()}
      jiraProjectKey={undefined}
      jiraDefaultIssueType={undefined}
      onSubmit={onSubmit}
      onRemoveContact={vi.fn()}
      onShowToast={vi.fn()}
      onAddAssigneeToAddressBook={vi.fn()}
      {...over}
    />,
    { wrapper: TestProviders },
  );
  return { onSubmit };
}

describe("TaskEditView", () => {
  it("renders a numbered Dark-Blue section heading", () => {
    setup();
    expect(screen.getByRole("heading", { name: /task details/i })).toBeTruthy();
  });

  it("renders the shared task fields inside a form with the shared id", () => {
    setup();
    const form = document.getElementById(TASK_EDIT_FORM_ID);
    expect(form?.tagName).toBe("FORM");
    expect(screen.getByText("Task name")).toBeTruthy();
  });

  it("calls onSubmit when the form is submitted", () => {
    const { onSubmit } = setup();
    const form = document.getElementById(TASK_EDIT_FORM_ID) as HTMLFormElement;
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/app/task-edit-view.test.tsx`
Expected: FAIL — `Failed to resolve import "./task-edit-view"`.

- [ ] **Step 3: Implement `task-edit-view.tsx`**

```tsx
"use client";

import { type Lang, t } from "./i18n";
import { TaskFormFields, type TaskFormFieldsProps } from "./task-form-fields";

/** Stable id shared by the edit-view <form> and the top-bar Save button so the
 *  button can submit the form via the HTML `form=` association. */
export const TASK_EDIT_FORM_ID = "task-edit-form";

export interface TaskEditViewProps extends TaskFormFieldsProps {
  lang: Lang;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}

export function TaskEditView({ onSubmit, ...fieldProps }: TaskEditViewProps) {
  const { lang } = fieldProps;
  return (
    <div className="mx-auto w-full max-w-5xl">
      <section className="rounded-lg border border-line bg-surface">
        <h2 className="border-b border-line px-6 py-4 text-base font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          1. {t(lang, "taskEditDetailsHeading")}
        </h2>
        <form
          id={TASK_EDIT_FORM_ID}
          onSubmit={onSubmit}
          className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2"
        >
          <TaskFormFields {...fieldProps} />
        </form>
      </section>
    </div>
  );
}
```

> Palette: `border-line` + `bg-surface` only (no shadow, no gradient); the heading is Dark-Blue. `TaskEditViewProps extends TaskFormFieldsProps`, so the field props pass straight through. Save/Cancel are NOT rendered here — they live in the top bar (Task 6).

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/app/task-edit-view.test.tsx`
Expected: PASS.

- [ ] **Step 5: Types + lint**

Run: `npx tsc --noEmit` → clean. `npx eslint src/app/task-edit-view.tsx` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/task-edit-view.tsx src/app/task-edit-view.test.tsx
git commit -m "feat: add full-page TaskEditView for the modern layout"
```

---

## Task 5: `ModernShell` — render the `edit` view

**Files:**
- Modify: `src/app/modern-shell.tsx`
- Modify: `src/app/modern-shell.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/modern-shell.test.tsx` (the `setup` helper already exists; pass the new props via `over`):

```tsx
it("shows the edit view, edit title, and edit actions for the edit view", () => {
  setup({
    activeView: "edit",
    editView: <div data-testid="edit" />,
    editTitle: "Editing task #5",
    editActions: <button type="button">Save changes</button>,
  });
  expect(screen.getByTestId("edit")).toBeTruthy();
  expect(screen.queryByTestId("tasks")).toBeNull();
  expect(screen.queryByTestId("workspace")).toBeNull();
  expect(screen.getByRole("heading", { name: "Editing task #5" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  // The default New-task button is replaced by the edit actions.
  expect(screen.queryByRole("button", { name: "New task" })).toBeNull();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/app/modern-shell.test.tsx`
Expected: FAIL — `editView`/`editTitle`/`editActions` are not props; for `activeView="edit"` the shell currently falls through to `workspace` and shows the New-task button.

- [ ] **Step 3: Add the edit slot**

In `src/app/modern-shell.tsx`, extend the props and the content/title/primary-action selection:

```tsx
interface ModernShellProps {
  lang: Lang;
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  version: string;
  bannerCount: number;
  onNewTask: () => void;
  onShowAlerts: () => void;
  topBarMenus: React.ReactNode;
  sidebarFooter: React.ReactNode;
  tasksSection: React.ReactNode;
  workspace: React.ReactNode;
  /** Phase 2: full-page task editor, shown when activeView === "edit". */
  editView?: React.ReactNode;
  editTitle?: string;
  editActions?: React.ReactNode;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function ModernShell({
  lang, activeView, onNavigate, version, bannerCount, onNewTask, onShowAlerts,
  topBarMenus, sidebarFooter, tasksSection, workspace,
  editView = null, editTitle = "", editActions = null,
  collapsed = false, onToggleCollapsed = () => {},
}: ModernShellProps) {
  const isEditing = activeView === "edit";
  const title = isEditing ? editTitle : t(lang, navLabelKey(activeView));
  const content = isEditing
    ? editView
    : activeView === "open-points"
      ? tasksSection
      : workspace;
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        lang={lang}
        activeView={activeView}
        onNavigate={onNavigate}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        version={version}
        footer={sidebarFooter}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          lang={lang}
          title={title}
          bannerCount={bannerCount}
          onNewTask={onNewTask}
          onShowAlerts={onShowAlerts}
          primaryAction={isEditing ? editActions : undefined}
        >
          {topBarMenus}
        </TopBar>
        <main className="min-h-0 flex-1 overflow-auto bg-surface-muted p-6 dark:bg-black">
          {content}
        </main>
      </div>
    </div>
  );
}
```

Delete the now-stale Phase-2 TODO comment about `edit` needing its own slot.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/app/modern-shell.test.tsx`
Expected: PASS (new + existing — existing tests don't pass the new props, which default to safe values).

- [ ] **Step 5: Commit**

```bash
git add src/app/modern-shell.tsx src/app/modern-shell.test.tsx
git commit -m "feat: render the full-page edit view in ModernShell"
```

---

## Task 6: `TaskManager` — wire the editor surface (effect + props)

**Files:**
- Modify: `src/app/task-manager.tsx`
- Modify: `src/app/task-manager.shell.test.tsx`

This is the integration crux: route the existing `taskModalOpen` flag to the `edit` view in modern mode, suppress the modal there, and feed `ModernShell` the edit view/title/actions.

- [ ] **Step 1: Write the failing test**

Append to `src/app/task-manager.shell.test.tsx`. Mirror the file's existing render helper for `TaskManager` (it already renders the default export and seeds storage/settings). Add an integration test for the modern edit flow:

```tsx
it("opens the full-page edit view (not the modal) when New task is clicked in modern mode", async () => {
  renderTaskManager(); // existing helper — modern is the default layout
  // The modern top bar's New-task button.
  fireEvent.click(await screen.findByRole("button", { name: "New task" }));
  // Full-page edit view appears…
  expect(await screen.findByRole("heading", { name: /task details/i })).toBeTruthy();
  // …and the dialog modal does NOT.
  expect(screen.queryByRole("dialog", { name: /new task/i })).toBeNull();
  // Top bar now shows Save (Add task) + Cancel instead of New task.
  expect(screen.getByRole("button", { name: "Add task" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "New task" })).toBeNull();
});

it("returns to the previous view when the edit is cancelled", async () => {
  renderTaskManager();
  fireEvent.click(await screen.findByRole("button", { name: "New task" }));
  expect(await screen.findByRole("heading", { name: /task details/i })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  // Back on Open Points (the origin view): the edit heading is gone.
  expect(screen.queryByRole("heading", { name: /task details/i })).toBeNull();
});
```

> If `task-manager.shell.test.tsx` lacks a `renderTaskManager` helper, copy the render call from its first test verbatim and reuse it. The default layout is modern (per `defaultSettings`), so no settings seeding is needed for these cases.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/app/task-manager.shell.test.tsx`
Expected: FAIL — clicking New task opens the modal dialog; there is no "Task details" heading and no `edit` view.

- [ ] **Step 3: Read `taskModalOpen` and define the editor-surface helpers**

In `src/app/task-manager.tsx`, add `taskModalOpen` to the existing `useTaskForm()` destructure (around line 143-149):

```tsx
  const {
    form,
    setForm,
    editingId,
    setEditingId,
    taskModalOpen,
    setTaskModalOpen,
  } = useTaskForm();
```

Add the imports near the other `./` imports at the top of the file:

```tsx
import { TaskEditView, TASK_EDIT_FORM_ID } from "./task-edit-view";
import type { AppView } from "./nav-config";
```

(If `AppView` is already imported in this file, skip the duplicate.)

Just after the existing `useHashView(...)` + classic-coercion effect block (around line 100-109), add the editor-surface state and effect:

```tsx
  // Phase 2: in the modern main window the task editor is a full-page "edit"
  // view, not the overlay modal. `taskModalOpen` stays the single "editor open"
  // signal (set by every entry point, cleared by handleSubmit on success and by
  // handleCancelEdit); this effect mirrors it into navigation, remembering the
  // origin view so Save/Cancel return there. Classic mode and popouts keep the
  // modal and are unaffected (the effect is gated on `useEditView`).
  const useEditView = settings.layout === "modern" && !isPopout;
  const editorReturnRef = useRef<AppView>("open-points");
  useEffect(() => {
    if (!useEditView) return;
    if (taskModalOpen && activeTab !== "edit") {
      editorReturnRef.current = activeTab;
      setActiveTab("edit");
    } else if (!taskModalOpen && activeTab === "edit") {
      setActiveTab(editorReturnRef.current);
    }
  }, [useEditView, taskModalOpen, activeTab, setActiveTab]);
```

> `useRef` and `useEffect` are already imported in this file. `isPopout` and `activeTab`/`setActiveTab` already come from the `useWorkspaceTab()` destructure at line 99.

- [ ] **Step 4: Build the edit view, title, and actions; suppress the modal**

Near where `tasksSectionEl` / `workspaceFullBleedEl` are defined (around line 658-703), add:

```tsx
  // Phase 2 full-page editor (modern). Reuses the same fields/validation as the
  // modal; submit goes through the existing handleSubmit.
  const editTitle =
    editingId !== null ? t(lang, "tabEditTask", editingId) : t(lang, "tabNewTask");

  const editActions = (
    <>
      <button
        type="button"
        onClick={handleCancelEdit}
        className="rounded-md border border-line bg-surface px-4 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted dark:border-line dark:bg-surface dark:text-foreground dark:hover:bg-surface-muted"
      >
        {t(lang, "cancel")}
      </button>
      <button
        type="submit"
        form={TASK_EDIT_FORM_ID}
        className="rounded-md bg-AIPM-green px-4 py-1.5 text-sm font-semibold text-AIPM-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-green"
      >
        {editingId !== null ? t(lang, "updateTask") : t(lang, "addTask")}
      </button>
    </>
  );

  const editViewEl = (
    <TaskEditView
      lang={lang}
      today={today}
      nextId={nextId}
      contactsList={contactsList}
      absences={absences}
      tasksForDeps={tasks}
      uniqueGroups={uniqueGroups}
      uniqueLabels={uniqueLabels}
      editingIsJiraLinked={editingIsJiraLinked}
      jiraEnabled={settings.jira.enabled}
      error={error}
      holidaySet={holidaySet}
      jiraProjectKey={settings.jira.projectKey}
      jiraDefaultIssueType={settings.jira.issueTypes[0]}
      onSubmit={handleSubmit}
      onRemoveContact={handleRemoveContact}
      onShowToast={showToast}
      onAddAssigneeToAddressBook={handleAddAssigneeToAddressBook}
    />
  );
```

> These reuse the exact same values the `AppModals` block already passes to `TaskFormModal` (`nextId`, `contactsList`, `editingIsJiraLinked`, `error`, `holidaySet`, etc.), so they are all already in scope here.

In the `<AppModals …/>` inside `modalsBlock` (around line 755), pass the suppression flag so the modal never co-exists with the edit view:

```tsx
      <AppModals
        lang={lang}
        isPopout={isPopout}
        showTaskFormModal={!useEditView}
        /* …all existing props unchanged… */
```

- [ ] **Step 5: Pass the edit slot to `ModernShell`**

In `modernTree` (around line 883-903), add the three props to `<ModernShell>`:

```tsx
      <ModernShell
        lang={lang}
        activeView={activeTab}
        onNavigate={(v) => {
          if (v === "settings") { setSettingsOpen(true); return; }
          setActiveTab(v);
        }}
        version={APP_VERSION}
        bannerCount={bannerItems.length}
        onNewTask={() => { handleCancelEdit(); setTaskModalOpen(true); }}
        onShowAlerts={() => { setBannerDismissed(false); setDueModalOpen(true); }}
        topBarMenus={topBarMenus}
        sidebarFooter={null}
        tasksSection={tasksSectionEl}
        workspace={workspaceFullBleedEl}
        editView={editViewEl}
        editTitle={editTitle}
        editActions={editActions}
      />
      {modalsBlock}
```

> `onNewTask` is unchanged: `setTaskModalOpen(true)` trips the effect from Step 3, which navigates to the `edit` view. Row edits (`onEdit` → `openEditModal`) and the due-list selection (`onSelectDueTask` → `openEditModal`) also set `taskModalOpen`, so they route to the edit view automatically — no call-site changes needed.

- [ ] **Step 6: Run the integration test + the full suite**

Run: `npx vitest run src/app/task-manager.shell.test.tsx`
Expected: PASS.

Run: `npx vitest run`
Expected: PASS — the whole suite (no regressions in classic-mode or popout tests). `npx tsc --noEmit` clean. `npx eslint src/app/task-manager.tsx` clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/task-manager.tsx src/app/task-manager.shell.test.tsx
git commit -m "feat: route the task editor to the full-page edit view in modern mode"
```

---

## Task 7: i18n key, version bump, changelog, memory

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-29-modern-sidebar-layout-phase2-edit-view.md` (check the boxes as you go)

- [ ] **Step 1: Add the EN keys to `i18n.ts`**

Add to the English `enUS` object (near the other `task*` keys / version highlights):

```ts
  taskEditDetailsHeading: "Task details",
```

and, with the other `versionHighlight*` strings:

```ts
  versionHighlightFullPageEdit:
    "Full-page task editor in the modern layout — open a task or click New task to edit it full-screen; Classic mode keeps the dialog.",
```

- [ ] **Step 2: Add the matching DE keys to `i18n.de.ts`**

Add the German values to the `de` object:

```ts
  taskEditDetailsHeading: "Aufgabendetails",
  versionHighlightFullPageEdit:
    "Ganzseitiger Aufgabeneditor im modernen Layout — Aufgabe öffnen oder „Neue Aufgabe“ klicken, um sie im Vollbild zu bearbeiten; der Klassik-Modus behält den Dialog.",
```

> **Corruption guard:** after saving `i18n.de.ts`, grep-verify the new lines kept ASCII delimiters and the German quotes are intentional, then run `npx vitest run src/app/i18n.test.ts` (key-parity test) and `npx tsc --noEmit`. If `tsc` reports a `de` key-parity error, a quote got mangled — re-apply with a byte-careful edit.

- [ ] **Step 3: Run the i18n parity test**

Run: `npx vitest run src/app/i18n.test.ts`
Expected: PASS — `de` has full parity with `enUS` (the test enforces every key exists in both).

- [ ] **Step 4: Bump the version**

In `src/app/version.ts`:
1. Add a new milestone comment block at the top (above the `0.29.0 "Okorafor"` block):

```ts
// 0.30.0 "Liu" adds Phase 2 of the modern layout: a full-page task editor.
// In the modern layout, opening a task (or clicking "New task") now opens a
// full-viewport edit view styled in the AIPM palette (Dark-Blue section heading,
// two-column field grid) with Save (green) / Cancel in the top bar, instead of
// the overlay dialog. The editor reuses the exact same fields, state, and
// validation as before; Classic mode and all popouts keep the dialog.
```

2. Update the constants:

```ts
export const APP_VERSION = "0.30.0";
export const APP_BUILD_DATE = "2026-05-29"; // Liu milestone
```

3. Append the highlight key to `APP_HIGHLIGHT_KEYS` (after `"versionHighlightModernLayout"`):

```ts
  "versionHighlightFullPageEdit",
```

> Codename: continue the SF-author chain (…Le Guin, Butler, Jemisin, Leckie, Wells, Chambers, Okorafor → **Liu**, for Cixin Liu). If "Liu" has been used elsewhere, pick another unused SF author and keep it consistent across the comment + build-date note + CHANGELOG.

- [ ] **Step 5: Add the CHANGELOG entry**

Insert at the top of `CHANGELOG.md` (above `## [0.29.0]`):

```markdown
## [0.30.0] — 2026-05-29 "Liu"

### Added
- **Full-page task editor (modern layout).** Opening a task — or clicking **New task** — now opens a full-viewport edit view instead of the overlay dialog: a Dark-Blue section heading, a two-column field grid in the AIPM palette, and **Save** (green) / **Cancel** in the top bar. The editor reuses the same fields, state, and validation as before, and returns you to the view you came from on save or cancel. **Classic mode** and all pop-out windows keep the dialog. This is Phase 2 of the sidebar-layout redesign (a table restyle follows).
```

- [ ] **Step 6: Verify the build is green**

Run: `npx vitest run` → all pass. `npx tsc --noEmit` → clean. `npx eslint src/app` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts src/app/version.ts CHANGELOG.md docs/superpowers/plans/2026-05-29-modern-sidebar-layout-phase2-edit-view.md
git commit -m "release: 0.30.0 — full-page task edit view (modern layout, Phase 2)"
```

- [ ] **Step 8: Update memory**

Edit `~/.claude/projects/C--Projects-lop-app/memory/modern-layout-roadmap.md`: mark Phase 2 COMPLETE (v0.30.0 "Liu"), record the editor-surface seam (`taskModalOpen` + `useEditView` effect, shared `TaskFormFields`, Save/Cancel in top bar via `TASK_EDIT_FORM_ID`), and note the remaining Phases 3–4. Refresh the matching one-line entry in `MEMORY.md`.

---

## Self-Review (run by the plan author after writing)

**1. Spec coverage** (§ "Full-page edit view (Phase 2)"):
- "new view (`edit`) hosts the task editor full-viewport" → Tasks 4-6 (TaskEditView rendered for `activeView === "edit"`). ✓
- "styled per edit.png: … two-column field grid, Dark-Blue section headings" → Task 4 (Dark-Blue heading + `sm:grid-cols-2`). ✓ — see design note below on "numbered/labeled sections".
- "RAG toggle buttons, chip inputs" → already in the shared `TaskFormFields` (health chips + labels/dependencies). ✓
- "Save (green) / Cancel live in the top bar" → Tasks 2, 5, 6 (`primaryAction` + `editActions`, green Save). ✓
- "Reuses existing task-form state/validation … modal chrome replaced by full-page view in modern mode" → Tasks 1, 6 (shared `TaskFormFields`, unchanged `use-task-submit`, modal suppressed via `showTaskFormModal`). ✓
- "Classic mode keeps the existing modal" → Task 3 default `showTaskFormModal=true`; `useEditView` is false in classic/popout. ✓
- "Entered by clicking an open point or New; exits to prior view on Save/Cancel" → Task 6 effect (`editorReturnRef`). ✓

**2. Placeholder scan:** the only intentional "fill-in" is the verbatim move in Task 1 Step 3 (clearly delimited as a copy of existing code, not new logic). No TODO/TBD/"handle errors"/"similar to Task N" left.

**3. Type consistency:** `TaskFormFieldsProps` (Task 1) is reused by `TaskEditViewProps extends TaskFormFieldsProps` (Task 4) and matched field-by-field by the `TaskFormFields`/`TaskEditView`/`AppModals` call sites (Tasks 1, 6). `TASK_EDIT_FORM_ID` is defined once (Task 4) and imported by Task 6. `primaryAction` (Task 2) is the prop ModernShell passes (Task 5). `showTaskFormModal` (Task 3) matches the Task 6 call site. `AppView` import in Task 6 matches `nav-config`.

**Design note flagged for the user / reviewers:** edit.png shows many numbered sections for a *different* domain (bid qualification). The LOP task has its own, smaller field set, so this plan renders the existing fields under **one** numbered Dark-Blue "1. Task details" section rather than fabricating domain sections — this keeps the modal and the page on a single shared `TaskFormFields` (DRY, modal visually unchanged). Splitting the task fields into multiple labeled sections is deferred to Phase 4 polish; it would require either a `variant` on `TaskFormFields` or section-group components, and would otherwise diverge the modal from the page.
