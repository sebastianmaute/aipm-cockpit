# Resource Address Book — Phase 2 (Directory Tab + Edit Modal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Split the Resources pane's old "List" view into two tabs — **Directory** (an editable address-book table) and **Workload** (today's stats table, unchanged for now) — alongside Calendar and Planning, and add a full **Resource edit modal** reachable by clicking a name or "+ Add resource".

**Architecture:** Add resource CRUD to `use-resource-planner.ts` (`editingResource` state + add/save/delete). New `resource-edit-modal.tsx` mirrors `absence-edit-modal.tsx`. New `resource-directory.tsx` renders the address-book table (name → edit, inline discipline/grade selects). `resources-panel.tsx` switches to a four-tab `SegmentedControl`; the existing roster `<ul>` is replaced by the Directory and the existing stats table moves under "Workload" (its aggregation logic is unchanged here — Phase 3 rekeys it). The modal renders via `AppModals` ungated by `isPopout`.

**Tech Stack:** TypeScript, Next.js 16, React 19, Tailwind v4, Vitest + RTL. Source under `src/app/`.

**Source spec:** [`../specs/2026-05-24-resource-address-book-design.md`](../specs/2026-05-24-resource-address-book-design.md) — Phase 2 of 5. Builds on Phase 1 (Resource now has firstName/lastName + contact fields; `resourceDisplayName` exists).

---

### Task 1: Resource CRUD in `use-resource-planner.ts`

**Files:**
- Modify: `src/app/use-resource-planner.ts`
- Test: `src/app/use-resource-planner.test.tsx`

Add `editingResource` state and handlers, mirroring the absence handlers already in the file.

- [ ] **Step 1: Write failing tests** in `src/app/use-resource-planner.test.tsx` using the file's existing render harness (it renders the hook with the workspace providers and exposes a workspace probe — copy that setup). Assert behavior via the returned handlers and the workspace `resources` array:

```ts
it("handleOpenAddResource opens a blank draft with the next id", () => {
  const { result } = renderPlanner();
  act(() => result.current.handleOpenAddResource());
  expect(result.current.editingResource?.isNew).toBe(true);
  expect(result.current.editingResource?.resource.firstName).toBe("");
});

it("handleSaveResource adds a new resource and closes the modal", () => {
  const { result } = renderPlanner();
  act(() => result.current.handleOpenAddResource());
  const draft = result.current.editingResource!.resource;
  act(() => result.current.handleSaveResource({ ...draft, firstName: "Nora", lastName: "Ito" }));
  expect(result.current.editingResource).toBeNull();
  // assert via the workspace probe that a resource named "Nora Ito" now exists
});

it("handleDeleteResource removes by id and closes", () => {
  const { result } = renderPlanner();
  act(() => result.current.handleOpenAddResource());
  const draft = result.current.editingResource!.resource;
  act(() => result.current.handleSaveResource({ ...draft, firstName: "Nora", lastName: "Ito" }));
  act(() => result.current.handleDeleteResource(draft.id));
  expect(result.current.editingResource).toBeNull();
  // assert via the workspace probe that the resource is gone
});
```

NOTE: the existing tests in this file show the exact harness (a `renderHook` with providers + workspace probe). Reuse it; replace the "assert via the workspace probe" comments with real assertions in that harness's style. Keep assertions behavior-based.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/app/use-resource-planner.test.tsx` → FAIL (handlers/`editingResource` undefined).

- [ ] **Step 3: Implement** — add to `use-resource-planner.ts`. `nextId` is already imported; add `resourceDisplayName` to the `./resource-foundation` import and `type Resource` to the `./types` import.

```ts
const [editingResource, setEditingResource] = useState<{
  resource: Resource;
  isNew: boolean;
} | null>(null);

const handleOpenAddResource = useCallback(
  (seed?: Partial<Resource>) => {
    const id = nextId(resources);
    const draft: Resource = {
      id,
      firstName: "",
      lastName: "",
      roleId: null,
      utilizationMode: "percent",
      utilization: {},
      ...seed,
      id, // id is authoritative regardless of seed
    };
    setEditingResource({ resource: draft, isNew: true });
  },
  [resources],
);

const handleEditResource = useCallback((resource: Resource) => {
  setEditingResource({ resource, isNew: false });
}, []);

const handleCloseResourceModal = useCallback(() => setEditingResource(null), []);

const handleSaveResource = useCallback(
  (next: Resource) => {
    const stamp = new Date().toISOString();
    const withStamp: Resource = { ...next, localModifiedAt: stamp };
    setResources((prev) => {
      const exists = prev.some((r) => r.id === next.id);
      return exists
        ? prev.map((r) => (r.id === next.id ? withStamp : r))
        : [...prev, withStamp];
    });
    logActivityRef.current("resource.saved", next.id, resourceDisplayName(next));
    setEditingResource(null);
  },
  [setResources],
);

const handleDeleteResource = useCallback(
  (id: number) => {
    const removed = resources.find((r) => r.id === id);
    setResources((prev) => prev.filter((r) => r.id !== id));
    if (removed) logActivityRef.current("resource.deleted", id, resourceDisplayName(removed));
    setEditingResource(null);
  },
  [resources, setResources],
);
```

Add `editingResource, handleOpenAddResource, handleEditResource, handleCloseResourceModal, handleSaveResource, handleDeleteResource` to the hook's returned object.

**Activity-log kinds:** open `src/app/activity-log.ts`. If `ActivityKind` is a closed union, add `"resource.saved"` and `"resource.deleted"` with message formatters following the absence entries. If that balloons scope, match how the file already handles similar entries — do NOT invent a logging subsystem. If adding kinds is awkward, drop the two `logActivityRef.current(...)` lines rather than fabricate kinds (note this as a concern).

- [ ] **Step 4: Run tests to pass** — `npx vitest run src/app/use-resource-planner.test.tsx` → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-resource-planner.ts src/app/use-resource-planner.test.tsx src/app/activity-log.ts
git commit -m "feat(resources): add resource add/edit/delete handlers to the planner"
```

---

### Task 2: `ResourceEditModal` + i18n + AppModals/task-manager wiring

**Files:**
- Create: `src/app/resource-edit-modal.tsx`, `src/app/resource-edit-modal.test.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`, `src/app/app-modals.tsx`, `src/app/app-modals.test.tsx`, `src/app/task-manager.tsx`

- [ ] **Step 1: Add i18n keys.** In `src/app/i18n.ts` (en-US, and en-GB if maintained separately — mirror how existing `resources*` keys are duplicated) add, and add to the `TranslationKey` union if the file maintains an explicit one:

```
resourcesViewDirectory: "Directory",
resourcesViewWorkload: "Workload",
resourcesAddResource: "+ Add resource",
resourceNewTitle: "New resource",
resourceEditTitle: "Edit resource",
resourceFirstName: "First name",
resourceLastName: "Last name",
resourceJobTitle: "Title",
resourceCompany: "Company",
resourceDepartment: "Department",
resourceLocation: "Location",
resourcePhone: "Business phone",
resourceEmail: "Email",
resourceBirthday: "Birthday",
resourceBirthdayMonth: "Month",
resourceBirthdayDay: "Day",
resourceNotes: "Notes",
resourceSave: "Save resource",
resourceConfirmDelete: "Delete this resource?",
resourceColPhone: "Phone",
resourceColDepartment: "Department",
resourceColTitle: "Title",
resourceColBirthday: "Birthday",
resourceErrorName: "Enter a first or last name.",
```

In `src/app/i18n.de.ts` add German equivalents (e.g. `resourcesViewDirectory: "Verzeichnis"`, `resourcesViewWorkload: "Auslastung"`, `resourcesAddResource: "+ Ressource hinzufügen"`, `resourceNewTitle: "Neue Ressource"`, `resourceEditTitle: "Ressource bearbeiten"`, `resourceFirstName: "Vorname"`, `resourceLastName: "Nachname"`, `resourceJobTitle: "Titel"`, `resourceCompany: "Firma"`, `resourceDepartment: "Abteilung"`, `resourceLocation: "Standort"`, `resourcePhone: "Telefon (geschäftlich)"`, `resourceEmail: "E-Mail"`, `resourceBirthday: "Geburtstag"`, `resourceBirthdayMonth: "Monat"`, `resourceBirthdayDay: "Tag"`, `resourceNotes: "Notizen"`, `resourceSave: "Ressource speichern"`, `resourceConfirmDelete: "Diese Ressource löschen?"`, `resourceColPhone: "Telefon"`, `resourceColDepartment: "Abteilung"`, `resourceColTitle: "Titel"`, `resourceColBirthday: "Geburtstag"`, `resourceErrorName: "Bitte Vor- oder Nachnamen angeben."`). Match the file's structure exactly.

- [ ] **Step 2: Write failing component test** `src/app/resource-edit-modal.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ResourceEditModal } from "./resource-edit-modal";
import type { Resource } from "./types";

const base: Resource = { id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent", utilization: {} };

describe("ResourceEditModal", () => {
  it("renders nothing when resource is null", () => {
    const { container } = render(
      <ResourceEditModal lang="en-US" resource={null} isNew={false}
        onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("saves with first/last preserved", () => {
    const onSave = vi.fn();
    render(<ResourceEditModal lang="en-US" resource={base} isNew={false}
      onSave={onSave} onDelete={vi.fn()} onClose={vi.fn()} />);
    fireEvent.submit(screen.getByRole("button", { name: /save resource/i }).closest("form")!);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ firstName: "Sample", lastName: "Dummy" });
  });
  it("blocks save when both names are empty", () => {
    const onSave = vi.fn();
    render(<ResourceEditModal lang="en-US" resource={{ ...base, firstName: "", lastName: "" }} isNew
      onSave={onSave} onDelete={vi.fn()} onClose={vi.fn()} />);
    fireEvent.submit(screen.getByRole("button", { name: /save resource/i }).closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
  });
  it("hides Delete in create mode", () => {
    render(<ResourceEditModal lang="en-US" resource={base} isNew
      onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run src/app/resource-edit-modal.test.tsx` → FAIL (module missing).

- [ ] **Step 4: Implement `resource-edit-modal.tsx`.** Mirror `absence-edit-modal.tsx` exactly for the chrome (`<Modal open onClose=… align="center" zIndex={50}>`, header with close button, 2-col grid `<form>`, footer with Delete/Cancel/Save, local `draft` state synced from the `resource` prop via `useEffect([resource])`, an `update(key, value)` helper, `if (!draft) return null`). Props:

```ts
interface Props {
  lang: Lang;
  resource: Resource | null;   // null => hidden
  isNew: boolean;
  onSave: (next: Resource) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}
```

Fields (all bound to `draft`): First name (`resourceFirstName`), Last name (`resourceLastName`), Title (`resourceJobTitle`), Company (`resourceCompany`), Department (`resourceDepartment`), Location (`resourceLocation`), Business phone (`resourcePhone`, `type="tel"`), Email (`resourceEmail`, `type="email"`) — text inputs, writing `e.target.value || undefined` for the optional ones. Notes (`resourceNotes`) — `<textarea rows={3}>` spanning both columns.

Birthday (`resourceBirthday`): two `<select>`s (Month 01–12, Day 01–31) each with an empty option; compose `MM-DD` on change, clear to `undefined` when either is unset. Helpers:

```ts
const pad2 = (n: number) => String(n).padStart(2, "0");
function parseBirthday(b?: string): { mm: string; dd: string } {
  const m = (b ?? "").match(/^(\d{2})-(\d{2})$/);
  return m ? { mm: m[1], dd: m[2] } : { mm: "", dd: "" };
}
// months = Array.from({ length: 12 }, (_, i) => pad2(i + 1));
// days   = Array.from({ length: 31 }, (_, i) => pad2(i + 1));
// onChange(mm,dd): update("birthday", mm && dd ? `${mm}-${dd}` : undefined);
```

Submit: trim firstName/lastName; if both empty → `setError(t(lang,"resourceErrorName"))` and return; normalize empty optional strings to `undefined`; `onSave(clean)`. Delete (hidden when `isNew`) → `window.confirm(t(lang,"resourceConfirmDelete"))` then `onDelete(draft.id)`. Header/aria use `resourceNewTitle`/`resourceEditTitle`; Save button label `resourceSave`; Cancel uses existing `cancel`; Delete uses existing `delete`. Discipline/Grade are NOT edited here (they live inline in the Directory table per the spec).

- [ ] **Step 5: Run modal test to pass** — `npx vitest run src/app/resource-edit-modal.test.tsx` → PASS.

- [ ] **Step 6: Wire into AppModals.** In `src/app/app-modals.tsx`: import `ResourceEditModal` and `type Resource` (already imported); add to `AppModalsProps` + destructure: `editingResource: { resource: Resource; isNew: boolean } | null`, `onSaveResource: (r: Resource) => void`, `onDeleteResource: (id: number) => void`, `onCloseResourceModal: () => void`. Render ungated by `isPopout`, near the other edit modals:

```tsx
{editingResource && (
  <ResourceEditModal
    lang={lang}
    resource={editingResource.resource}
    isNew={editingResource.isNew}
    onSave={onSaveResource}
    onDelete={onDeleteResource}
    onClose={onCloseResourceModal}
  />
)}
```

In `src/app/app-modals.test.tsx`: add `editingResource: null, onSaveResource: vi.fn(), onDeleteResource: vi.fn(), onCloseResourceModal: vi.fn()` to `makeProps`, and add `ResourceEditModal: () => <div data-testid="resource-edit-modal" />` to the `./resource-edit-modal` mock (add a `vi.mock("./resource-edit-modal", …)`).

- [ ] **Step 7: Wire task-manager → AppModals.** In `src/app/task-manager.tsx`, destructure `editingResource, handleSaveResource, handleDeleteResource, handleCloseResourceModal, handleOpenAddResource, handleEditResource` from `useResourcePlanner(...)`, and pass `editingResource={editingResource} onSaveResource={handleSaveResource} onDeleteResource={handleDeleteResource} onCloseResourceModal={handleCloseResourceModal}` into `<AppModals … />`. (`handleOpenAddResource`/`handleEditResource` are forwarded to the Directory in Task 3.)

- [ ] **Step 8: Typecheck + full suite** — `npx tsc --noEmit` clean; `npx vitest run` green (modulo the known `use-holiday-set` flake).

- [ ] **Step 9: Commit**

```bash
git add src/app/resource-edit-modal.tsx src/app/resource-edit-modal.test.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/app-modals.tsx src/app/app-modals.test.tsx src/app/task-manager.tsx
git commit -m "feat(resources): resource edit modal with address-book fields"
```

---

### Task 3: Directory tab + four-tab Resources pane

**Files:**
- Create: `src/app/resource-directory.tsx`, `src/app/resource-directory.test.tsx`
- Modify: `src/app/resources-panel.tsx`, `src/app/resources-panel.test.tsx`, `src/app/workspace-section.tsx`, `src/app/task-manager.tsx`

- [ ] **Step 1: Implement `resource-directory.tsx`** (lift the discipline/grade logic out of the current `ResourceRoleRow`):

```tsx
"use client";
import { useEffect, useState } from "react";
import { type Lang, t } from "./i18n";
import { resourceDisplayName } from "./resource-foundation";
import type { Discipline, Grade, Resource, Role } from "./types";

interface Props {
  lang: Lang;
  resources: readonly Resource[];
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  onAssignRole: (resourceId: number, disciplineId: number, gradeId: number) => void;
  onEditResource: (resource: Resource) => void;
  onAddResource: () => void;
}
```

Render: a header row with a **+ Add resource** button (`resourcesAddResource` → `onAddResource`); an empty state (`resourcesEmpty`) when `resources.length === 0`; otherwise a `<table>` with columns Name, Discipline, Grade, `resourceColTitle`, `resourceColDepartment`, `resourceColPhone`, Email, `resourceColBirthday`. Per row:
- Name cell = `<button type="button" onClick={() => onEditResource(r)}>{resourceDisplayName(r)}</button>` (reuse the link/edit button styling from `resources-panel.tsx`).
- Discipline/Grade cells = inline `<select>`s using a small `DirectoryRoleSelects` subcomponent that ports the `ResourceRoleRow` logic verbatim (local `disc`/`grad` `useState`, `useEffect` re-sync from `roles.find(x=>x.id===r.roleId)`, calling `onAssignRole(r.id, disc, grade)` when both set).
- Title/Department/Phone/Email/Birthday = text cells (`r.title ?? "—"`, `r.department ?? "—"`, `r.businessPhone ?? "—"`, `r.email ?? "—"`, `r.birthday ?? "—"`).

- [ ] **Step 2: Failing test** `src/app/resource-directory.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ResourceDirectory } from "./resource-directory";
import type { Resource } from "./types";
const rs: Resource[] = [{ id: 1, firstName: "Sample", lastName: "Dummy", title: "Architect", roleId: null, utilizationMode: "percent", utilization: {} }];
describe("ResourceDirectory", () => {
  it("fires onEditResource when the name is clicked", () => {
    const onEdit = vi.fn();
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]}
      onAssignRole={vi.fn()} onEditResource={onEdit} onAddResource={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Alex Example" }));
    expect(onEdit).toHaveBeenCalledWith(rs[0]);
  });
  it("fires onAddResource from the add button", () => {
    const onAdd = vi.fn();
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]}
      onAssignRole={vi.fn()} onEditResource={vi.fn()} onAddResource={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /add resource/i }));
    expect(onAdd).toHaveBeenCalled();
  });
});
```

Run → FAIL; implement Step 1 → PASS.

- [ ] **Step 3: Four-tab `resources-panel.tsx`.** Change `type View = "directory" | "workload" | "calendar" | "planning";`, default `useState<View>("directory")`. `SegmentedControl` options: Directory (`resourcesViewDirectory`), Workload (`resourcesViewWorkload`), Calendar (`resourcesViewCalendar`), Planning (`resourcesViewPlanning`). Add panel props `onEditResource` and `onAddResource`. Render:
  - `view === "directory"` → `<ResourceDirectory … />` — DELETE the old `resourceRoster` `<ul>` block and the `ResourceRoleRow` component (its logic now lives in the directory).
  - `view === "workload"` → the EXISTING stats `<table>` (currently the `view === "list"` body), moved verbatim — its `rows` aggregation is unchanged this phase.
  - `view === "calendar"` / `"planning"` → unchanged.
  Remove the old `"list"` branch.

- [ ] **Step 4: Forward handlers in `workspace-section.tsx`.** Add `onEditResource` and `onAddResource` to `WorkspaceSection`'s props and pass them into the `<ResourcesPanel … />` call. In `task-manager.tsx`, pass `onEditResource={handleEditResource} onAddResource={handleOpenAddResource}` into `<WorkspaceSection … />`.

- [ ] **Step 5: Update `resources-panel.test.tsx`** for the renamed tabs (List → Directory/Workload) and the roster `<ul>` → Directory table. Keep coverage equivalent; if a `ResourcesPanel` render now needs `onEditResource`/`onAddResource`, pass `vi.fn()`.

- [ ] **Step 6: Typecheck + full suite** — `npx tsc --noEmit` clean; `npx vitest run` green (modulo the `use-holiday-set` flake).

- [ ] **Step 7: Commit**

```bash
git add src/app/resource-directory.tsx src/app/resource-directory.test.tsx src/app/resources-panel.tsx src/app/resources-panel.test.tsx src/app/workspace-section.tsx src/app/task-manager.tsx
git commit -m "feat(resources): Directory tab (address-book table) + four-tab Resources pane"
```

---

## Self-Review

**Spec coverage (Phase 2):** four-tab pane (Task 3.3) ✓; Directory address-book table, name→edit, inline discipline/grade (Task 3.1-2) ✓; +Add resource (Task 1 handler + Task 3 button) ✓; edit modal with all address-book fields incl. MM-DD birthday + notes (Task 2) ✓; modal works in popout via ungated AppModals render (Task 2.6; the popout TAB is Phase 4) ✓; CRUD with immutable upsert + localModifiedAt (Task 1) ✓; Workload keeps current aggregation, rekey deferred (Task 3.3) ✓.

**Placeholder scan:** Task 1 Step 1 references the file's existing harness for workspace assertions rather than re-inventing it (the harness is authoritative in-repo) — the implementer fills the two assertion comments using that harness. All other steps show complete code.

**Type consistency:** `editingResource: { resource: Resource; isNew: boolean } | null` identical across planner (T1), AppModals props (T2.6), task-manager wiring (T2.7). Handler names consistent (`handleOpenAddResource`, `handleEditResource`, `handleSaveResource`, `handleDeleteResource`, `handleCloseResourceModal`). `ResourceDirectory` prop names match the resources-panel/workspace-section call sites.

**Out of scope (later):** Workload rekey + Unlinked group (Phase 3); pop-out tab/button (Phase 4); birthday banner/toast/settings (Phase 5).
