# Phase A — Add Address-Book Entry from the Task Form — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** A **+** button next to the task form's Assignee opens the address-book **Add entry** modal (seeded with the typed name/email); on save it creates the resource and fills the task's assignee/email.

**Architecture:** `TaskFormModal` gets an `onAddAssigneeToAddressBook(name, email)` prop + a **+** button. `task-manager` implements it by flagging the origin and calling the existing `handleOpenAddResource(seed)`; it wraps the resource save so a task-form-originated save also `setForm`s the assignee. Link is by display name (no `resourceId` on the form).

**Tech Stack:** TypeScript, Next.js 16, React 19, Tailwind v4, Vitest + RTL. Source `src/app/`.

**Source spec:** [`../specs/2026-05-25-task-form-contact-and-reminder-snooze-design.md`](../specs/2026-05-25-task-form-contact-and-reminder-snooze-design.md) — Phase A of 3.

---

### Task 1: `+` button + prop in `TaskFormModal` (+ i18n)

**Files:**
- Modify: `src/app/task-form-modal.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/task-form-modal.test.tsx` (create if absent)

- [ ] **Step 1: i18n key.** Add to `i18n.ts` (en-US + en-GB if separate) and `i18n.de.ts`:
```
taskAddAssigneeToAddressBook: "Add to address book"   // de: "Zum Adressbuch hinzufügen"
```

- [ ] **Step 2: Add the prop.** In `task-form-modal.tsx`, add to `TaskFormModalProps` (after `onShowToast`):
```ts
  onAddAssigneeToAddressBook: (name: string, email: string) => void;
```
Destructure `onAddAssigneeToAddressBook` in the `TaskFormModal({...})` parameter list. (`form` is already in scope via `useTaskForm()` — it's read as `form.assignee` in the assignee field.)

- [ ] **Step 3: Render the + button.** In the Assignee `Field` (currently `<Field label={t(lang,"assignee")} required>` wrapping `<ContactInput … />`), wrap the input + a button in a flex row. Read the current block first and preserve every existing `ContactInput` prop:
```tsx
<Field label={t(lang, "assignee")} required>
  <div className="flex items-start gap-2">
    <div className="min-w-0 flex-1">
      <ContactInput
        lang={lang}
        value={form.assignee}
        contacts={contactsList}
        onChangeName={(name) => setForm((prev) => ({ ...prev, assignee: name }))}
        onChangePair={(name, email) => setForm((prev) => ({ ...prev, assignee: name, assigneeEmail: email }))}
        onRemoveContact={onRemoveContact}
        placeholder={t(lang, "placeholderAssignee")}
        maxLength={ASSIGNEE_MAX}
        disabled={editingIsJiraLinked}
        title={editingIsJiraLinked ? t(lang, "jiraManagedHint") : undefined}
      />
    </div>
    <button
      type="button"
      onClick={() => onAddAssigneeToAddressBook(form.assignee, form.assigneeEmail)}
      disabled={editingIsJiraLinked}
      aria-label={t(lang, "taskAddAssigneeToAddressBook")}
      title={t(lang, "taskAddAssigneeToAddressBook")}
      className="shrink-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
    >
      +
    </button>
  </div>
  {editingIsJiraLinked && (
    <p className="mt-1 text-xs italic text-AIPM-medium-grey">🔒 {t(lang, "jiraManagedHint")}</p>
  )}
</Field>
```

- [ ] **Step 4: Failing test.** `src/app/task-form-modal.test.tsx`. The modal reads form state from `useTaskForm()`; mock it (mirror `app-modals.test.tsx`'s `vi.mock("./task-form-context", …)` + `emptyForm`/`emptyBulkEdit`) and seed `form` with an assignee/email. Mock the lazy mic button: `vi.mock("./voice-button", () => ({ InlineMicButton: () => null }))`. Provide all required `TaskFormModalProps` via a `makeProps()` helper (`vi.fn()`s + the new `onAddAssigneeToAddressBook`). Tests:
```tsx
it("fires onAddAssigneeToAddressBook with the current assignee + email", () => {
  const onAdd = vi.fn();
  // seed the useTaskForm mock so form.assignee = "Nora Ito", form.assigneeEmail = "nora@x.com"
  render(<TaskFormModal {...makeProps({ onAddAssigneeToAddressBook: onAdd })} />);
  fireEvent.click(screen.getByRole("button", { name: /add to address book/i }));
  expect(onAdd).toHaveBeenCalledWith("Nora Ito", "nora@x.com");
});
it("disables the add-to-address-book button for Jira-linked tasks", () => {
  render(<TaskFormModal {...makeProps({ editingIsJiraLinked: true })} />);
  expect(screen.getByRole("button", { name: /add to address book/i })).toBeDisabled();
});
```
Run `npx vitest run src/app/task-form-modal.test.tsx` → FAIL (button/prop missing).

- [ ] **Step 5: Run to pass.** After Steps 2-3: `npx vitest run src/app/task-form-modal.test.tsx` → PASS. NOTE: `npx tsc --noEmit` stays RED until Task 2 supplies the new prop at the `<TaskFormModal>` call site — expected; green build lands at the end of Task 2.

- [ ] **Step 6: Commit**
```bash
git add src/app/task-form-modal.tsx src/app/task-form-modal.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(tasks): + button to add the assignee to the address book"
```

---

### Task 2: Wire through AppModals + task-manager (fill-on-save)

**Files:**
- Modify: `src/app/app-modals.tsx`, `src/app/app-modals.test.tsx`
- Modify: `src/app/task-manager.tsx`

- [ ] **Step 1: AppModals prop + thread to TaskFormModal.** In `src/app/app-modals.tsx`:
  - Add to `AppModalsProps` (near the `// TaskFormModal props` block): `onAddAssigneeToAddressBook: (name: string, email: string) => void;`
  - Destructure it in `AppModals({...})`.
  - Pass it to the `<TaskFormModal … />` render: `onAddAssigneeToAddressBook={onAddAssigneeToAddressBook}`.
  In `src/app/app-modals.test.tsx` `makeProps()`, add `onAddAssigneeToAddressBook: vi.fn(),`.

- [ ] **Step 2: task-manager wrapper handlers.** In `src/app/task-manager.tsx`:
  - Imports: add `splitName` and `resourceDisplayName` to the `./resource-foundation` import (add the import line if none); ensure `type Resource` is imported from `./types`.
  - The `useResourcePlanner(...)` destructure already exposes `handleOpenAddResource`, `handleSaveResource`, `handleCloseResourceModal`, `editingResource`. `useTaskForm()` exposes `form`, `setForm`. Add:
```ts
const [fillTaskAssigneeOnSave, setFillTaskAssigneeOnSave] = useState(false);

const handleAddAssigneeToAddressBook = useCallback((name: string, email: string) => {
  const { firstName, lastName } = splitName(name);
  setFillTaskAssigneeOnSave(true);
  handleOpenAddResource({ firstName, lastName, email: email.trim() || undefined });
}, [handleOpenAddResource]);

const handleSaveResourceFromAnywhere = useCallback((next: Resource) => {
  handleSaveResource(next);
  if (fillTaskAssigneeOnSave) {
    setForm((prev) => ({ ...prev, assignee: resourceDisplayName(next), assigneeEmail: next.email ?? "" }));
    setFillTaskAssigneeOnSave(false);
  }
}, [handleSaveResource, fillTaskAssigneeOnSave, setForm]);

const handleCloseResourceFromAnywhere = useCallback(() => {
  handleCloseResourceModal();
  setFillTaskAssigneeOnSave(false);
}, [handleCloseResourceModal]);
```
  - In the `<AppModals … />` render: change `onSaveResource={handleSaveResource}` → `onSaveResource={handleSaveResourceFromAnywhere}`; `onCloseResourceModal={handleCloseResourceModal}` → `onCloseResourceModal={handleCloseResourceFromAnywhere}`; and add `onAddAssigneeToAddressBook={handleAddAssigneeToAddressBook}`.
  - `useState`/`useCallback` are already imported in task-manager.

- [ ] **Step 3: Typecheck + tests.** `npx tsc --noEmit` clean; `npx vitest run` green (only the known `use-holiday-set` flake acceptable). Task 1's tests now compile (prop supplied at the call site).

- [ ] **Step 4: Commit**
```bash
git add src/app/app-modals.tsx src/app/app-modals.test.tsx src/app/task-manager.tsx
git commit -m "feat(tasks): create address-book entry from task form and fill the assignee"
```

---

## Self-Review

**Spec coverage (Phase A):** + button beside assignee (Task 1) ✓; opens add-entry modal seeded with name/email via `handleOpenAddResource({firstName,lastName,email})` (Task 2) ✓; on save creates resource + fills task assignee/email (Task 2 `handleSaveResourceFromAnywhere`) ✓; link by name (sets `form.assignee` to `resourceDisplayName`, no `resourceId`) ✓; disabled for Jira-managed (Task 1) ✓; i18n en/de (Task 1) ✓.

**Placeholder scan:** Task 1 Step 4 references mirroring `app-modals.test.tsx`'s `useTaskForm` mock — a concrete in-repo harness, not a placeholder; all code shown otherwise.

**Type consistency:** `onAddAssigneeToAddressBook: (name: string, email: string) => void` identical in `TaskFormModalProps`, `AppModalsProps`, and the task-manager handler. `handleSaveResourceFromAnywhere` / `handleCloseResourceFromAnywhere` / `handleAddAssigneeToAddressBook` names consistent across Task 2. `handleOpenAddResource(seed?: Partial<Resource>)` already accepts `{firstName,lastName,email}` (Phase-2 planner).

**Out of scope:** unified lead + working-day shift (Phase B); snooze (Phase C).
