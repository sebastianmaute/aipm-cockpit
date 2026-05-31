# Multi-Section Task Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Partition the flat 18-field task form into 5 stacked, numbered sections, defined once in the shared `TaskFormFields` so both the modern full-page edit view and the classic modal render them identically.

**Architecture:** Add a `TaskFormSection` wrapper inside `task-form-fields.tsx`; `TaskFormFields` returns 5 `<TaskFormSection>` blocks instead of one flat grid. Each section owns its own `sm:grid-cols-2` grid, so BOTH parents (`task-edit-view.tsx`, `task-form-modal.tsx`) must drop their own grid wrappers and stack sections (`space-y-6`) in the SAME change. 5 new i18n keys (en+de) supersede `taskEditDetailsHeading`.

**Tech Stack:** Next.js 16 (App Router), React 18, TypeScript, Tailwind v4 (CSS-var tokens), Vitest + React Testing Library (jsdom).

**Branch:** `multi-section-edit-view` (created; spec committed at `13a72ef`).

**Standing constraints (every task):**
- AIPM 9-color palette only — no new colors, gradients, or shadows. Headings reuse `text-AIPM-dark-blue dark:text-AIPM-light-grey`.
- NEVER touch or stage `README.md` or `public/*.png`. Scoped `git add <paths>` only — never `git add -A`/`.`.
- `i18n.de.ts`: the Edit tool corrupts ASCII `"`→curly quotes. After ANY de edit, grep-verify ASCII quotes (Task 1 Step 5).
- Before each edit, Read the current region (line numbers below may have shifted) and match the verbatim string.
- Tests use literal English label strings and the existing `TestProviders` wrapper (or the modal's mocked `useTaskForm`). Do NOT introduce an `enUS` import or a `TaskFormProvider` wrapper — match each file's existing setup.

**Atomicity note:** Task 2 is intentionally one commit covering `task-form-fields.tsx` + both parents + all 3 tests. Splitting it would leave an intermediate commit where a parent's old 2-column grid wraps the new `<section>`s and renders them side-by-side. Do NOT split it.

---

## Test commands
- One file: `npx vitest run src/app/<file>.test.tsx`
- Type check: `npx tsc --noEmit`
- Full suite: `npx vitest run`

---

### Task 1: Add the 5 section-heading i18n keys (en + de)

**Files:**
- Modify: `src/app/i18n.ts` (line 19)
- Modify: `src/app/i18n.de.ts` (line 23)

Keep `taskEditDetailsHeading` for now (still referenced by the edit view until Task 2; removed in Task 3). Unused new keys are harmless.

- [ ] **Step 1: Read the en insertion context**

Read `src/app/i18n.ts` around line 19. Confirm the line reads exactly:
```ts
  taskEditDetailsHeading: "Task details",
```

- [ ] **Step 2: Add 5 keys after it (en)**

Replace:
```ts
  taskEditDetailsHeading: "Task details",
```
with:
```ts
  taskEditDetailsHeading: "Task details",
  taskFormSectionDetails: "Details",
  taskFormSectionScheduling: "Scheduling",
  taskFormSectionEffort: "Effort & Classification",
  taskFormSectionRelationships: "Relationships",
  taskFormSectionStatus: "Status & Notes",
```

- [ ] **Step 3: Read the de insertion context**

Read `src/app/i18n.de.ts` around line 23. Confirm the line reads exactly:
```ts
  taskEditDetailsHeading: "Aufgabendetails",
```

- [ ] **Step 4: Add 5 keys after it (de)**

Replace:
```ts
  taskEditDetailsHeading: "Aufgabendetails",
```
with:
```ts
  taskEditDetailsHeading: "Aufgabendetails",
  taskFormSectionDetails: "Details",
  taskFormSectionScheduling: "Terminplanung",
  taskFormSectionEffort: "Aufwand & Klassifizierung",
  taskFormSectionRelationships: "Beziehungen",
  taskFormSectionStatus: "Status & Notizen",
```

- [ ] **Step 5: Verify de file has NO curly-quote corruption + both maps gained the keys**

Run: `grep -nP "[\x{201C}\x{201D}]" src/app/i18n.de.ts`
Expected: NO output (no curly quotes). If any appear, revert that line and re-insert with ASCII `"` (or byte-patch).
Run: `grep -c "taskFormSection" src/app/i18n.de.ts` → expect `5`.
Run: `grep -c "taskFormSection" src/app/i18n.ts` → expect `5`.

- [ ] **Step 6: Type check**

Run: `npx tsc --noEmit`
Expected: no errors (both translation maps gained the same 5 keys, so the `TranslationKey` union stays consistent).

- [ ] **Step 7: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n: add 5 task-form section heading keys (en+de)"
```

---

### Task 2: Section the shared form + fix both parents (ATOMIC)

**Files:**
- Modify: `src/app/task-form-fields.tsx`
- Modify: `src/app/task-edit-view.tsx`
- Modify: `src/app/task-form-modal.tsx`
- Test: `src/app/task-form-fields.test.tsx`, `src/app/task-edit-view.test.tsx`, `src/app/task-form-modal.test.tsx`

- [ ] **Step 1: Write the failing fields tests**

In `src/app/task-form-fields.test.tsx`, add inside `describe("TaskFormFields", …)` (the file already defines `Harness()` rendering `TaskFormFields` and imports `render, screen` + `TestProviders`):
```tsx
  it("renders all 5 numbered section headings", () => {
    render(<Harness />, { wrapper: TestProviders });
    expect(screen.getByText("1. Details")).toBeTruthy();
    expect(screen.getByText("2. Scheduling")).toBeTruthy();
    expect(screen.getByText("3. Effort & Classification")).toBeTruthy();
    expect(screen.getByText("4. Relationships")).toBeTruthy();
    expect(screen.getByText("5. Status & Notes")).toBeTruthy();
  });

  it("places the Due date field within the Scheduling section", () => {
    render(<Harness />, { wrapper: TestProviders });
    const section = screen.getByText("2. Scheduling").closest("section");
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain("Due date");
  });
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run src/app/task-form-fields.test.tsx`
Expected: FAIL (no section headings yet).

- [ ] **Step 3: Add the `TaskFormSection` component**

In `src/app/task-form-fields.tsx`, add this component just above the `Field` helper near the bottom of the file:
```tsx
// One titled, numbered section of the task form. Owns its own two-column grid so
// fields with `sm:col-span-2` keep spanning. Heading uses the AIPM dark-blue token.
export function TaskFormSection({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-3 border-b border-line pb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
        {index}. {title}
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
```

- [ ] **Step 4: Wrap the fields into 5 sections**

In `TaskFormFields`, replace the entire returned `<>…</>` fragment (every block from the ID `<Field>` through the Jira-create `<label>`) with the 5-section structure below. Move each field's JSX VERBATIM into its section — do not change any field's props, handlers, IIFEs, `key`s, or `sm:col-span-2`. `lang` is already in scope.

```tsx
  return (
    <>
      <TaskFormSection index={1} title={t(lang, "taskFormSectionDetails")}>
        {/* MOVE VERBATIM: <Field label={t(lang,"id")}>, <Field label={t(lang,"priority")}>,
            <Field label={t(lang,"taskName")} required className="sm:col-span-2">,
            <Field label={t(lang,"assignee")} required>, <Field label={t(lang,"email")}> */}
      </TaskFormSection>

      <TaskFormSection index={2} title={t(lang, "taskFormSectionScheduling")}>
        {/* MOVE VERBATIM: <Field label={t(lang,"startDate")}>,
            <Field label={t(lang,"dueDate")} required> (keep its absence-warning IIFE),
            <Field label={t(lang,"lastUpdateDate")}> */}
      </TaskFormSection>

      <TaskFormSection index={3} title={t(lang, "taskFormSectionEffort")}>
        {/* MOVE VERBATIM: <Field label={t(lang,"group")}>,
            <EffortField key={`estimate-${editingId ?? "new"}`} …>,
            <EffortField key={`spent-${editingId ?? "new"}`} …>,
            <EffortProgressBar …>, <Field label={t(lang,"labels")}> */}
      </TaskFormSection>

      <TaskFormSection index={4} title={t(lang, "taskFormSectionRelationships")}>
        {/* MOVE VERBATIM: <Field label={t(lang,"depDependencies")} className="sm:col-span-2">,
            <Field label={t(lang,"blockers")} className="sm:col-span-2"> */}
      </TaskFormSection>

      <TaskFormSection index={5} title={t(lang, "taskFormSectionStatus")}>
        {/* MOVE VERBATIM: <Field label={t(lang,"health")} className="sm:col-span-2"> (keep IIFE),
            <Field label={t(lang,"notes")} className="sm:col-span-2">,
            the {error && (<p role="alert" … className="… sm:col-span-2">…)} block,
            the {!isEditing && jiraEnabled && jiraProjectKey && (<label … className="… sm:col-span-2">…)} block */}
      </TaskFormSection>
    </>
  );
```

The `EffortField`, `Field`, and `TaskFormSection` helper functions stay defined below the component (no change to them beyond adding `TaskFormSection`).

- [ ] **Step 5: Run the fields test — expect PASS**

Run: `npx vitest run src/app/task-form-fields.test.tsx`
Expected: PASS (the existing "renders the core task fields" + "shows the error message" tests, plus the 2 new section tests).

- [ ] **Step 6: Fix the edit-view parent**

In `src/app/task-edit-view.tsx`, replace:
```tsx
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
```
with:
```tsx
      <section className="rounded-lg border border-line bg-surface">
        <form id={TASK_EDIT_FORM_ID} onSubmit={onSubmit} className="space-y-6 p-6">
          <TaskFormFields {...fieldProps} />
        </form>
      </section>
```
Then remove the now-unused `t` import and `lang` destructure:
- Change `import { type Lang, t } from "./i18n";` → `import { type Lang } from "./i18n";` (`Lang` is still used by `TaskEditViewProps`).
- Remove the line `const { lang } = fieldProps;` from the function body.

- [ ] **Step 7: Update the edit-view heading test**

In `src/app/task-edit-view.test.tsx`, replace the first test:
```tsx
  it("renders a numbered Dark-Blue section heading", () => {
    setup();
    expect(screen.getByRole("heading", { name: /task details/i })).toBeTruthy();
  });
```
with:
```tsx
  it("renders the numbered Details section heading", () => {
    setup();
    expect(screen.getByRole("heading", { name: "1. Details" })).toBeTruthy();
  });
```
(The other two tests in that file — shared form id, onSubmit — are unaffected.)

- [ ] **Step 8: Fix the modal parent**

In `src/app/task-form-modal.tsx`, the `<form>` is itself the two-column grid and has BOTH `<TaskFormFields>` and the Save/Cancel button row as direct children. De-grid the form and drop the button row's `sm:col-span-2`.

Replace:
```tsx
        <form
          onSubmit={onSubmit}
          className="min-h-0 flex-1 overflow-y-auto grid grid-cols-1 gap-4 p-6 sm:grid-cols-2"
        >
```
with:
```tsx
        <form
          onSubmit={onSubmit}
          className="min-h-0 flex-1 overflow-y-auto space-y-6 p-6"
        >
```
And replace:
```tsx
          <div className="flex justify-end gap-2 sm:col-span-2">
```
with:
```tsx
          <div className="flex justify-end gap-2">
```
(The `<TaskFormFields … />` element between them is unchanged. Scrolling is preserved by `min-h-0 flex-1 overflow-y-auto`. The button row is now the final stacked child after the 5 sections.)

- [ ] **Step 9: Add the modal parity test**

In `src/app/task-form-modal.test.tsx`, add inside `describe("TaskFormModal", …)` (the file already mocks `useTaskForm` and defines `defaultProps()`):
```tsx
  test("renders all 5 numbered section headings (parity with edit view)", () => {
    render(<TaskFormModal {...defaultProps()} />);
    expect(screen.getByText("1. Details")).toBeInTheDocument();
    expect(screen.getByText("2. Scheduling")).toBeInTheDocument();
    expect(screen.getByText("3. Effort & Classification")).toBeInTheDocument();
    expect(screen.getByText("4. Relationships")).toBeInTheDocument();
    expect(screen.getByText("5. Status & Notes")).toBeInTheDocument();
  });
```

- [ ] **Step 10: Run all three test files + type check**

Run: `npx vitest run src/app/task-form-fields.test.tsx src/app/task-edit-view.test.tsx src/app/task-form-modal.test.tsx`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no errors. If tsc flags an unused `t`/`lang` in `task-edit-view.tsx`, finish the Step 6 removals.

- [ ] **Step 11: Commit (one atomic commit)**

```bash
git add src/app/task-form-fields.tsx src/app/task-edit-view.tsx src/app/task-form-modal.tsx src/app/task-form-fields.test.tsx src/app/task-edit-view.test.tsx src/app/task-form-modal.test.tsx
git commit -m "feat: render task form as 5 stacked sections in both surfaces"
```

---

### Task 3: Remove the now-dead `taskEditDetailsHeading` key

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

After Task 2, nothing references `taskEditDetailsHeading`.

- [ ] **Step 1: Confirm it is unreferenced**

Run: `grep -rn "taskEditDetailsHeading" src/app --include=*.ts --include=*.tsx | grep -v "i18n.ts\|i18n.de.ts"`
Expected: NO output. (If anything prints, clean that reference first — do not delete the key while referenced.)

- [ ] **Step 2: Remove the en key**

In `src/app/i18n.ts`, delete the line:
```ts
  taskEditDetailsHeading: "Task details",
```

- [ ] **Step 3: Remove the de key**

In `src/app/i18n.de.ts`, delete the line:
```ts
  taskEditDetailsHeading: "Aufgabendetails",
```

- [ ] **Step 4: Verify de quotes + type check**

Run: `grep -nP "[\x{201C}\x{201D}]" src/app/i18n.de.ts` → expect NO output.
Run: `npx tsc --noEmit` → no errors (key removed from both maps symmetrically).

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n: drop superseded taskEditDetailsHeading key"
```

---

### Task 4: Release 0.36.0 "Hurley"

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`

- [ ] **Step 1: Confirm codename unused**

Run: `git grep -i "hurley" CHANGELOG.md`
Expected: no match. If it collides, use the next unused author surname (Kowal, Valente, Nagata) consistently below.

- [ ] **Step 2: Read `src/app/version.ts`** — confirm the top milestone comment line begins `// 0.35.0 "Muir" …` and the constants are `APP_VERSION = "0.35.0"` / `APP_BUILD_DATE = "2026-05-31"; // Muir`.

- [ ] **Step 3: Add the milestone comment**

In `src/app/version.ts`, insert above the `// 0.35.0 "Muir" …` line:
```ts
// 0.36.0 "Hurley" splits the task form into 5 stacked, numbered sections
// (Details · Scheduling · Effort & Classification · Relationships · Status &
// Notes), defined once in the shared TaskFormFields so BOTH the modern full-page
// edit view and the classic modal render them identically. No fields added or
// reordered across groups; validation, Save/Cancel, and form wiring unchanged.
```

- [ ] **Step 4: Bump the constants**

Replace:
```ts
export const APP_VERSION = "0.35.0";
export const APP_BUILD_DATE = "2026-05-31"; // Muir
```
with:
```ts
export const APP_VERSION = "0.36.0";
export const APP_BUILD_DATE = "2026-05-31"; // Hurley
```

- [ ] **Step 5: Add the CHANGELOG entry**

In `CHANGELOG.md`, insert above the `## [0.35.0] — 2026-05-31 "Muir"` line:
```markdown
## [0.36.0] — 2026-05-31 "Hurley"

### Changed
- The task form (both the modern full-page edit view and the classic modal dialog) now presents its fields in 5 stacked, numbered sections — Details, Scheduling, Effort & Classification, Relationships, Status & Notes — instead of one long list. Same fields, same validation; just grouped for easier scanning.

```

- [ ] **Step 6: Full suite + type check**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "release: 0.36.0 — multi-section task form (Hurley)"
```

---

### Final: Finish the branch

Use **superpowers:finishing-a-development-branch**: verify the full suite is green, then **merge to `main` locally** (`git merge --ff-only` if possible) and delete the branch. Do NOT push — push on explicit request only. Confirm `git status` shows no accidental staging of `README.md`/`public/*.png`.

---

## Self-Review

**Spec coverage:**
- 5 stacked sections, defined once in shared component → Task 2 (`TaskFormSection` + `TaskFormFields` refactor). ✓
- Both surfaces sectioned → Task 2 fixes edit-view AND modal parents in one commit. ✓
- Exact 5 groupings + field order preserved → Task 2 Step 4 placement list. ✓
- Identical numbered dark-blue headings, no collapse → `TaskFormSection` heading; both render the same component. ✓
- 5 new i18n keys (en+de) + supersede/remove `taskEditDetailsHeading` → Task 1 (add) + Task 3 (remove). ✓
- de curly-quote guard → Task 1 Step 5, Task 3 Step 4. ✓
- Tests: fields headings + field-in-section, edit-view heading, modal parity → Task 2 Steps 1/7/9. ✓
- Release 0.36.0 "Hurley" → Task 4. ✓
- Constraints (palette, README/PNG, scoped add) → header + per task. ✓

**Placeholder scan:** Task 2 Step 4 uses `{/* MOVE VERBATIM: … */}` markers rather than re-pasting ~370 lines of unchanged field JSX — a deliberate in-file MOVE with an exhaustive per-section field manifest, not a "fill in details" placeholder. Every other code step shows complete literal code. No TBD/TODO.

**Type/identifier consistency:** Key names (`taskFormSectionDetails/Scheduling/Effort/Relationships/Status`) identical across Tasks 1–3. `TaskFormSection` signature (`index`/`title`/`children`) matches its usage. `TASK_EDIT_FORM_ID` preserved. Test literals ("1. Details" … "5. Status & Notes") match the headings `TaskFormSection` renders. Version "0.36.0"/"Hurley" consistent between Task 4 and the CHANGELOG block.
