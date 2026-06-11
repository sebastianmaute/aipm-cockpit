# Resource Picker (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable resource-aware autocomplete (`ResourcePicker`) and migrate the task-assignee field to it, so picking a registry Resource sets `Task.resourceId` (the FK shipped in v0.61.0) — with inline "+ Add as resource" creation and a contacts fallback.

**Architecture:** A presentational `ResourcePicker` reads `resources` + `contacts` and emits `onChange` / `onCreateResource`; each surface owns the workspace write. The task form threads `resourceId` through its draft + submit, and the `resources` list + an `onCreateResource` writer flow from `task-manager` (which holds workspace-context) down the existing modal prop chain. `ContactInput` (task-assignee's only consumer) is removed after migration.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, vitest 4 + React Testing Library, Tailwind (AIPM palette tokens in `globals.css`).

**Spec:** `docs/superpowers/specs/2026-06-11-resource-picker-design.md`

**Branch:** `feat-resource-picker` (already created). Do NOT edit `eslint.config.mjs` (hook-blocked).

---

## File Structure

- **Create** `src/app/resource-picker.tsx` — the component (lifts ContactInput's keyboard/popover behavior).
- **Create** `src/app/resource-picker.test.tsx` — component unit tests.
- **Modify** `src/app/task-form-context.tsx` — add `resourceId` to `emptyForm()`.
- **Modify** `src/app/use-task-submit.ts` — map `form.resourceId` into the built Task; seed it in `openEditModal`.
- **Modify** `src/app/task-form-fields.tsx` — replace `ContactInput` with `ResourcePicker`; add `resources` + `onCreateResource` to `TaskFormFieldsProps`.
- **Modify** `src/app/task-form-modal.tsx`, `src/app/app-modals.tsx`, `src/app/task-manager.tsx` — thread `resources` + `onCreateResource` down; build `onCreateResource` in `task-manager`.
- **Delete** `src/app/contact-input.tsx` (+ `contact-input.test.tsx` if present) — unused after migration.
- **Modify** `CHANGELOG.md`, `src/app/version.ts`, `package.json` — 0.62.0 release.

`task-edit-view.tsx` needs no prop changes: `TaskEditViewProps extends TaskFormFieldsProps`, so the two new props flow through `{...fieldProps}` automatically.

---

## Task 1: ResourcePicker component

**Files:**
- Create: `src/app/resource-picker.tsx`
- Test: `src/app/resource-picker.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/resource-picker.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResourcePicker, type ResourcePickerValue } from "./resource-picker";
import type { Resource } from "./types";
import type { Contact } from "./contacts";

const res = (id: number, firstName: string, lastName: string, email?: string): Resource =>
  ({ id, firstName, lastName, email, roleId: null, utilizationMode: "percent", utilization: {} });

const resources: Resource[] = [res(1, "Sample", "Dummy", "Sample@x.com"), res(2, "Bob", "Lee", "bob@x.com")];
const contacts: Contact[] = [{ name: "Old Contact", email: "old@x.com" }];

function setup(value: ResourcePickerValue, over: Partial<Parameters<typeof ResourcePicker>[0]> = {}) {
  const onChange = vi.fn();
  const onCreateResource = vi.fn(() => 99);
  render(
    <ResourcePicker
      lang="en-US"
      value={value}
      resources={resources}
      contacts={contacts}
      onChange={onChange}
      onCreateResource={onCreateResource}
      {...over}
    />,
  );
  return { onChange, onCreateResource };
}

describe("ResourcePicker", () => {
  it("lists resource matches before contact matches", () => {
    setup({ name: "", email: "", resourceId: null });
    fireEvent.focus(screen.getByRole("combobox"));
    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    const sarahIdx = options.findIndex((t) => t.includes("Alex Example"));
    const contactIdx = options.findIndex((t) => t.includes("Old Contact"));
    expect(sarahIdx).toBeGreaterThanOrEqual(0);
    expect(contactIdx).toBeGreaterThan(sarahIdx);
  });

  it("picking a resource emits the FK and the resource name/email", () => {
    const { onChange } = setup({ name: "", email: "", resourceId: null });
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByText("Alex Example"));
    expect(onChange).toHaveBeenCalledWith({ name: "Alex Example", email: "Sample@x.com", resourceId: 1 });
  });

  it("picking a contact emits resourceId null", () => {
    const { onChange } = setup({ name: "", email: "", resourceId: null });
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByText("Old Contact"));
    expect(onChange).toHaveBeenCalledWith({ name: "Old Contact", email: "old@x.com", resourceId: null });
  });

  it("typing a name emits free text with resourceId null", () => {
    const { onChange } = setup({ name: "", email: "", resourceId: null });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Brand New" } });
    expect(onChange).toHaveBeenLastCalledWith({ name: "Brand New", email: "", resourceId: null });
  });

  it("offers + Add as resource for an unmatched name and creates+links it", () => {
    const { onChange, onCreateResource } = setup({ name: "Brand New", email: "", resourceId: null });
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByText(/Add .*Brand New.* as resource/i));
    expect(onCreateResource).toHaveBeenCalledWith("Brand New", "");
    expect(onChange).toHaveBeenCalledWith({ name: "Brand New", email: "", resourceId: 99 });
  });

  it("does not offer + Add when the typed name exactly matches a resource", () => {
    setup({ name: "Alex Example", email: "Sample@x.com", resourceId: null });
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.queryByText(/Add .* as resource/i)).toBeNull();
  });

  it("display authority: a linked value shows the resource's CURRENT name, not the stale stored string", () => {
    setup({ name: "stale string", email: "stale@x.com", resourceId: 1 });
    expect(screen.getByRole("combobox")).toHaveValue("Alex Example");
  });

  it("dangling FK falls back to the stored name and renders an unlink control without crashing", () => {
    const { onChange } = setup({ name: "Ghost", email: "g@x.com", resourceId: 404 });
    expect(screen.getByRole("combobox")).toHaveValue("Ghost");
    fireEvent.click(screen.getByRole("button", { name: /unlink|clear link/i }));
    expect(onChange).toHaveBeenCalledWith({ name: "Ghost", email: "g@x.com", resourceId: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/resource-picker.test.tsx`
Expected: FAIL — `Failed to resolve import "./resource-picker"`.

- [ ] **Step 3: Add the i18n keys the component uses**

In `src/app/i18n.ts`, add to the `enUS` object (alphabetically near other `resource*` keys):

```ts
  resourcePickerAddAsResource: "+ Add “{0}” as resource",
  resourcePickerLinked: "Linked to a resource",
  resourcePickerUnlink: "Unlink from resource",
  resourcePickerResourcesGroup: "Resources",
  resourcePickerRecentGroup: "Recent",
```

In `src/app/i18n.de.ts`, add the matching German keys (ASCII `"` delimiters only — verify the diff shows exactly these 5 added lines and no curly-quote corruption):

```ts
  resourcePickerAddAsResource: "+ „{0}“ als Ressource hinzufügen",
  resourcePickerLinked: "Mit einer Ressource verknüpft",
  resourcePickerUnlink: "Verknüpfung aufheben",
  resourcePickerResourcesGroup: "Ressourcen",
  resourcePickerRecentGroup: "Zuletzt verwendet",
```

- [ ] **Step 4: Write the component**

Create `src/app/resource-picker.tsx`:

```tsx
"use client";

// Resource-aware autocomplete for person fields (task assignee, RAID owner, ...).
//
// Augment model: registry Resources are suggested first (picking sets the FK),
// then remembered Contacts (picking sets name+email only, FK null), then a
// "+ Add as resource" row that creates a Resource from the typed name.
//
// Presentational: reads resources + contacts, emits onChange / onCreateResource.
// The parent owns every workspace write. A linked value (resourceId set) shows
// the resource's CURRENT name/email; the stored value.name is a cache used only
// as a fallback when the FK is dangling (resource deleted). Keyboard + popover
// behavior is lifted from the now-removed ContactInput.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type React from "react";
import type { Contact } from "./contacts";
import { type Lang, t } from "./i18n";
import { resourceDisplayName } from "./resource-foundation";
import type { Resource } from "./types";

export interface ResourcePickerValue {
  name: string;
  email: string;
  resourceId: number | null | undefined;
}

interface ResourceRow { kind: "resource"; id: number; name: string; email: string }
interface ContactRow { kind: "contact"; name: string; email: string }
interface AddRow { kind: "add"; name: string }
type Row = ResourceRow | ContactRow | AddRow;

export function ResourcePicker({
  lang,
  value,
  resources,
  contacts,
  onChange,
  onCreateResource,
  placeholder,
  maxLength,
  disabled,
  title,
  onBlur,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-required": ariaRequired,
}: {
  lang: Lang;
  value: ResourcePickerValue;
  resources: readonly Resource[];
  contacts: Contact[];
  onChange: (next: { name: string; email: string; resourceId: number | null }) => void;
  onCreateResource: (name: string, email: string) => number;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  title?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The linked resource (if any) is authoritative for display.
  const linked = value.resourceId != null
    ? resources.find((r) => r.id === value.resourceId)
    : undefined;
  const dangling = value.resourceId != null && !linked;
  const display = linked ? resourceDisplayName(linked) : value.name;

  const rows = useMemo<Row[]>(() => {
    const q = display.trim().toLowerCase();
    const resRows: ResourceRow[] = resources
      .filter((r) => {
        if (!q) return true;
        const n = resourceDisplayName(r).toLowerCase();
        return n.includes(q) || (r.email ?? "").toLowerCase().includes(q);
      })
      .sort((a, b) =>
        resourceDisplayName(a).localeCompare(resourceDisplayName(b), undefined, { sensitivity: "base" }),
      )
      .map((r) => ({ kind: "resource", id: r.id, name: resourceDisplayName(r), email: r.email ?? "" }));
    const resNames = new Set(resRows.map((r) => r.name.toLowerCase()));
    const conRows: ContactRow[] = contacts
      .filter((c) => {
        if (resNames.has(c.name.toLowerCase())) return false; // resource wins over a same-name contact
        if (!q) return true;
        return c.name.toLowerCase().includes(q) || (!!c.email && c.email.toLowerCase().includes(q));
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .map((c) => ({ kind: "contact", name: c.name, email: c.email }));
    const out: Row[] = [...resRows, ...conRows];
    const trimmed = display.trim();
    const exact = resRows.some((r) => r.name.toLowerCase() === trimmed.toLowerCase());
    if (trimmed && !exact) out.push({ kind: "add", name: trimmed });
    return out;
  }, [resources, contacts, display]);

  const [prevLen, setPrevLen] = useState(rows.length);
  if (prevLen !== rows.length) {
    setPrevLen(rows.length);
    setHighlight(0);
  }

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  function choose(row: Row) {
    if (row.kind === "resource") {
      onChange({ name: row.name, email: row.email, resourceId: row.id });
    } else if (row.kind === "contact") {
      onChange({ name: row.name, email: row.email, resourceId: null });
    } else {
      const id = onCreateResource(row.name, value.email);
      onChange({ name: row.name, email: value.email, resourceId: id });
    }
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      if (!rows.length) return;
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => (h + 1) % rows.length);
      return;
    }
    if (e.key === "ArrowUp") {
      if (!rows.length) return;
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => (h - 1 + rows.length) % rows.length);
      return;
    }
    if (e.key === "Enter") {
      if (open && rows[highlight]) {
        e.preventDefault();
        choose(rows[highlight]);
      }
      return;
    }
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={display}
          onChange={(e) => {
            // Typing edits the name as free text and breaks any FK link.
            onChange({ name: e.target.value, email: value.email, resourceId: null });
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          title={title}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-required={ariaRequired}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          className={`w-full rounded-md border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-AIPM-green disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted-foreground ${
            linked ? "border-AIPM-green pr-8" : dangling ? "border-AIPM-pink pr-8" : "border-line"
          }`}
        />
        {(linked || dangling) && (
          <button
            type="button"
            onClick={() => onChange({ name: value.name, email: value.email, resourceId: null })}
            aria-label={t(lang, "resourcePickerUnlink")}
            title={linked ? t(lang, "resourcePickerLinked") : t(lang, "resourcePickerUnlink")}
            className={`absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 ${
              linked ? "text-AIPM-green" : "text-AIPM-pink"
            } hover:bg-surface-muted`}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>

      {open && rows.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-line bg-surface"
        >
          {rows.map((row, idx) => {
            const active = idx === highlight;
            const key = row.kind === "resource" ? `r${row.id}` : row.kind === "contact" ? `c${row.name}` : "add";
            return (
              <li
                key={key}
                role="option"
                aria-selected={active}
                onMouseEnter={() => setHighlight(idx)}
                className={`px-3 py-1.5 text-sm ${active ? "bg-surface-muted" : "hover:bg-surface-muted"}`}
              >
                <button
                  type="button"
                  // onMouseDown runs before the input blur that would close the popover.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(row);
                  }}
                  className="flex w-full min-w-0 flex-col items-start text-left"
                >
                  {row.kind === "add" ? (
                    <span className="font-medium text-AIPM-green">
                      {t(lang, "resourcePickerAddAsResource").replace("{0}", row.name)}
                    </span>
                  ) : (
                    <>
                      <span className="flex items-center gap-1.5 truncate font-medium text-foreground">
                        {row.kind === "resource" && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-AIPM-green" />}
                        {row.name}
                      </span>
                      {row.email && <span className="truncate text-xs text-muted-foreground">{row.email}</span>}
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/resource-picker.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit` (expect exit 0) and `npm run lint` (expect 0 warnings).

- [ ] **Step 7: Commit**

```bash
git add src/app/resource-picker.tsx src/app/resource-picker.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: ResourcePicker resource-aware autocomplete component"
```

---

## Task 2: Thread resourceId through the task-form draft + submit

**Files:**
- Modify: `src/app/task-form-context.tsx` (`emptyForm`)
- Modify: `src/app/use-task-submit.ts` (build payload + `openEditModal` seed)
- Test: `src/app/use-task-submit.test.ts` (or the existing task-submit test file)

- [ ] **Step 1: Write the failing test**

Add to `src/app/use-task-submit.test.ts` (match the file's existing harness for building a draft and invoking submit; the assertions that matter):

```ts
it("carries form.resourceId onto a newly created task", async () => {
  // Arrange: a draft with a linked resourceId (see the file's existing draft helper)
  const draft = { ...makeDraft({ assignee: "Alex Example", assigneeEmail: "Sample@x.com" }), resourceId: 7 };
  // Act: run the submit path used by other tests in this file
  const created = await runSubmit(draft);
  // Assert
  expect(created.resourceId).toBe(7);
});

it("seeds form.resourceId when opening an existing task for edit", () => {
  const task = makeTask({ id: 5, assignee: "Alex Example", resourceId: 9 });
  const { form } = openEditAndReadForm(task); // see existing edit tests for the pattern
  expect(form.resourceId).toBe(9);
});
```

(If the existing test file has no `makeDraft`/`runSubmit` helpers, model these on the file's existing creation/edit tests — the behavioral assertions `created.resourceId === 7` and `form.resourceId === 9` are the required checks.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/use-task-submit.test.ts`
Expected: FAIL — `resourceId` is `undefined` on the created task / form.

- [ ] **Step 3: Add resourceId to emptyForm**

In `src/app/task-form-context.tsx`, inside the object returned by `emptyForm()`, add after the `timeSpentMinutes` line:

```ts
    // FK -> Resource.id; null/undefined = unlinked. Set by the assignee picker.
    resourceId: undefined as number | null | undefined,
```

- [ ] **Step 4: Map resourceId in the submit payload and the edit seed**

In `src/app/use-task-submit.ts`, find where the task payload is assembled (the object spread into `const newTask: Task = { id: nextId(tasks), ...payload, inquiriesSent: 0 }` and the equivalent update path). Ensure `resourceId: form.resourceId` is included in that payload object (add it alongside `assignee` / `assigneeEmail`).

In the same file, in `openEditModal(task)`, where the form is seeded (`assignee: task.assignee, assigneeEmail: task.assigneeEmail ?? ""`), add:

```ts
        resourceId: task.resourceId,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/use-task-submit.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit`, `npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add src/app/task-form-context.tsx src/app/use-task-submit.ts src/app/use-task-submit.test.ts
git commit -m "feat: thread Task.resourceId through the task-form draft and submit"
```

---

## Task 3: Thread resources + onCreateResource down the modal chain

**Files:**
- Modify: `src/app/task-manager.tsx` (build `onCreateResource`, pass both props into `AppModals`)
- Modify: `src/app/app-modals.tsx` (accept + forward)
- Modify: `src/app/task-form-modal.tsx` (accept + forward)

No new tests here (pure prop plumbing; covered by Task 4's integration test). Verify by typecheck.

- [ ] **Step 1: Build onCreateResource in task-manager**

In `src/app/task-manager.tsx`, near where `resources` and `setResources` come from `useWorkspace()`, add a stable callback (import `nextId` and `splitName` from `./resource-foundation` if not already imported):

```ts
  const handleCreateResource = useCallback(
    (name: string, email: string): number => {
      const { firstName, lastName } = splitName(name);
      const id = nextId(resources);
      setResources((prev) => [
        ...prev,
        { id, firstName, lastName, email: email || undefined, roleId: null, utilizationMode: "percent", utilization: {} },
      ]);
      return id;
    },
    [resources, setResources],
  );
```

- [ ] **Step 2: Pass the two props into AppModals**

In `task-manager.tsx`, at the `<AppModals ... />` render (the same JSX that already passes `contactsList={contactsList}`), add:

```tsx
          resources={resources}
          onCreateResource={handleCreateResource}
```

- [ ] **Step 3: Accept + forward in AppModals**

In `src/app/app-modals.tsx`, add to the props interface (near `contactsList`):

```ts
  resources: readonly Resource[];
  onCreateResource: (name: string, email: string) => number;
```

Destructure them in the component signature (near `contactsList`), import `Resource` from `./types`, and forward both to the `TaskFormModal` / `TaskEditView` render (wherever `contactsList={contactsList}` is passed):

```tsx
          resources={resources}
          onCreateResource={onCreateResource}
```

- [ ] **Step 4: Accept + forward in TaskFormModal**

In `src/app/task-form-modal.tsx`, add to its props interface (near `contactsList`):

```ts
  resources: readonly Resource[];
  onCreateResource: (name: string, email: string) => number;
```

Import `Resource` from `./types`, destructure them, and pass both into `<TaskFormFields ... />` (where `contactsList={contactsList}` is already passed):

```tsx
            resources={resources}
            onCreateResource={onCreateResource}
```

(`task-edit-view.tsx` needs no change — `TaskEditViewProps extends TaskFormFieldsProps`, so the new props pass through `{...fieldProps}`.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `task-form-fields.tsx` (it doesn't yet declare `resources`/`onCreateResource`) — those are fixed in Task 4. If errors appear elsewhere, a forward was missed; fix before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/app/task-manager.tsx src/app/app-modals.tsx src/app/task-form-modal.tsx
git commit -m "feat: thread resources + onCreateResource down the task-modal chain"
```

---

## Task 4: Migrate the task-assignee field to ResourcePicker

**Files:**
- Modify: `src/app/task-form-fields.tsx`
- Test: the task-form component test (e.g. `src/app/task-form-feedback.test.tsx` or the existing task-form render test — add an integration test)

- [ ] **Step 1: Write the failing integration test**

Add a test that renders the task form (use the existing task-form test harness in the repo) with a `resources` list and asserts that picking a resource sets the draft's `resourceId`. The required behavioral assertions:

```tsx
it("sets the task draft resourceId when an assignee resource is picked", () => {
  // render the assignee field / task form with resources=[res(1,"Sample","Dummy","Sample@x.com")]
  // open the assignee combobox, click "Alex Example"
  // assert the form/onSubmit payload carries resourceId === 1
});
it("creates a resource via + Add and links the task to it", () => {
  // type "New Person", click "+ Add ... as resource"
  // assert onCreateResource was called and the draft resourceId is the returned id
});
```

(Model the render on the existing task-form tests; if those mount `TaskFormFields` directly, pass the new `resources` + `onCreateResource` props.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run <that test file>`
Expected: FAIL (assignee still rendered via ContactInput; no resourceId set).

- [ ] **Step 3: Add the two props to TaskFormFieldsProps**

In `src/app/task-form-fields.tsx`, add to `TaskFormFieldsProps` (near `contactsList`):

```ts
  resources: readonly Resource[];
  onCreateResource: (name: string, email: string) => number;
```

Add `Resource` to the existing `./types` import. Destructure `resources` and `onCreateResource` in the component signature (near `contactsList`).

- [ ] **Step 4: Replace ContactInput with ResourcePicker in the assignee Field**

Change the import:

```ts
import { ResourcePicker } from "./resource-picker";
```

(remove `import { ContactInput } from "./contact-input";`)

Replace the `<ContactInput ... />` element in the assignee `Field` with:

```tsx
              <ResourcePicker
                lang={lang}
                value={{ name: form.assignee, email: form.assigneeEmail, resourceId: form.resourceId }}
                resources={resources}
                contacts={contactsList}
                onChange={(next) =>
                  setForm((prev) => ({
                    ...prev,
                    assignee: next.name,
                    assigneeEmail: next.email,
                    resourceId: next.resourceId,
                  }))
                }
                onCreateResource={onCreateResource}
                placeholder={t(lang, "assignee")}
                maxLength={ASSIGNEE_MAX}
                onBlur={(e) => {
                  setForm((prev) => ({ ...prev, assignee: describeTextCap(e.target.value, ASSIGNEE_MAX).value.trim() }));
                  markTouched("assignee");
                }}
                aria-invalid={errorFor("assignee") ? true : undefined}
                aria-describedby={describedBy("assignee", "assignee-counter")}
              />
```

Keep the existing separate `assigneeEmail` input, the `CharCounter`, the `FieldError`, and the "add to address book" button unchanged.

`onRemoveContact` was used ONLY by the assignee `ContactInput`. To stay lint-clean (`no-unused-vars` at `--max-warnings=0`) without cascading prop removals into SP4 territory: **remove `onRemoveContact` from the destructured parameters** in the `TaskFormFields` component signature, but **leave it declared on `TaskFormFieldsProps`** so the parent chain keeps passing it harmlessly (a declared-but-not-destructured prop triggers no unused-var warning). Its full removal from the prop chain is SP4 cleanup, out of scope here.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run <that test file>`
Expected: PASS.

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit` (expect exit 0 now — Task 3's plumbing is satisfied), `npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add src/app/task-form-fields.tsx <that test file>
git commit -m "feat: migrate task-assignee field to ResourcePicker"
```

---

## Task 5: Remove the now-unused ContactInput

**Files:**
- Delete: `src/app/contact-input.tsx` (+ `src/app/contact-input.test.tsx` if it exists)

- [ ] **Step 1: Confirm no remaining consumers**

Run: `npx grep -rn "ContactInput\|contact-input" src/app --include="*.tsx" --include="*.ts"` (or the Grep tool).
Expected: only the file itself + its test. If any other consumer exists, STOP and report — the migration missed a surface.

- [ ] **Step 2: Delete the files**

```bash
git rm src/app/contact-input.tsx
git rm src/app/contact-input.test.tsx   # only if it exists
```

- [ ] **Step 3: Typecheck + lint + full suite**

Run: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`.
Expected: all green (no references to the deleted module).

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: remove ContactInput, superseded by ResourcePicker"
```

---

## Task 6: Release 0.62.0

**Files:**
- Modify: `package.json`, `src/app/version.ts`, `CHANGELOG.md`

- [ ] **Step 1: Bump version**

`package.json`: `"version": "0.61.0"` → `"0.62.0"`.

`src/app/version.ts`: set `APP_VERSION = "0.62.0"`, update `APP_BUILD_DATE` comment, and a new minor codename `APP_MILESTONE` (next sci-fi/fantasy author not yet used — e.g. `"Mitchell"`). Update the codename comment to say the 0.62.x line is that name.

- [ ] **Step 2: CHANGELOG entry**

Prepend under the title in `CHANGELOG.md`:

```markdown
## [0.62.0] - <date> "<codename>"

Resource-aware people picker (identity normalization SP1).

### Added
- A resource-aware autocomplete for the task assignee: registry people are suggested first (picking one links the task to that Resource via `resourceId`), remembered contacts remain as a fallback, and "+ Add as resource" creates and links a new resource inline. A linked assignee shows the resource's current name/email (edit the person once, it updates everywhere); a broken link can be cleared.

### Changed
- `ContactInput` is replaced by the new shared `ResourcePicker`.
```

- [ ] **Step 3: Full gates + build**

Run: `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`. All must pass. Golden fixtures must be unchanged (this slice touches no serializer) — confirm `src/app/golden-workspace.test.ts` passes.

- [ ] **Step 4: Commit**

```bash
git add package.json src/app/version.ts CHANGELOG.md
git commit -m "chore: release 0.62.0 — resource-aware assignee picker (SP1)"
```

---

## Final verification (whole branch)

- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint` clean (`--max-warnings=0`)
- [ ] `npx vitest run` — full suite green
- [ ] `npm run build` — succeeds
- [ ] `src/app/golden-workspace.test.ts` — unchanged (no serializer touched)
- [ ] Manual smoke (task form): type a known resource → pick it → linked indicator shows and email follows the resource; type a new name → "+ Add as resource" → it appears in the Resources view linked to the task; clearing the link unsets `resourceId` while keeping the typed name.

## Notes / landmines

- **i18n.de.ts** has a history of curly-quote corruption on edit — after editing, verify the diff shows only the intended added lines (ASCII `"` delimiters).
- **AIPM palette only** — the linked/dangling indicators use `AIPM-green` / `AIPM-pink` tokens already in `globals.css`; no off-palette colors, gradients, or shadows.
- **Out of scope (do not do here):** RAID owner / shift / stakeholder wiring (SP2), rollups (SP3), retiring the contacts store / re-pointing Jira/Outlook seeding (SP4). No schema or Turso change.
