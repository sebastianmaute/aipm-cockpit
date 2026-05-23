# Resource Roles & Rates (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Phase 1 role/discipline/grade entities usable: a roles-manager modal (discipline × grade rate card with editable internal/external rates), add/rename of disciplines & grades, on-demand `Role` creation, and per-resource role assignment in the Resources tab.

**Architecture:** Follow the established modal pattern exactly — CRUD handlers + open/close state live in `use-resource-planner.ts` (reading `roles/disciplines/grades/resources` + setters from `useWorkspace`), the modal renders via `AppModals` (threaded through `task-manager.tsx`), and `ResourcesPanel` stays presentational with prop-drilled callbacks from `workspace-section.tsx`. Pure lookups (`findRoleByCombo`, `roleLabel`, `nextId`) go in `resource-foundation.ts`. No activity-logging or persistence changes — Phase 1 already persists these entities.

**Tech Stack:** TypeScript, React 19, Next.js 16, Vitest (jsdom) + Testing Library. Spec: `docs/superpowers/specs/2026-05-23-resource-utilization-design.md`. Branch: `feat/resource-utilization`.

**Baseline note:** the repo has 2 PRE-EXISTING `tsc` errors in test files (`settings-menu.test.tsx:18`, `use-due-alerts.test.ts:28`). Ignore them; introduce no new ones. `use-holiday-set.test.ts` is an occasional full-run flake — re-run alone if it's the only failure.

---

## File Structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `src/app/resource-foundation.ts` | Pure `nextId`, `findRoleByCombo`, `roleLabel` | Modify |
| `src/app/resource-foundation.test.ts` | Tests for the above | Modify |
| `src/app/use-resource-planner.ts` | Role/discipline/grade/assignment CRUD + roles-modal open state | Modify |
| `src/app/use-resource-planner.test.tsx` | Tests for the new handlers | Modify |
| `src/app/roles-modal.tsx` | Rate-card modal: combos + rates + list management | **New** |
| `src/app/roles-modal.test.tsx` | Modal tests | **New** |
| `src/app/app-modals.tsx` | Render `<RolesModal>` + new props | Modify |
| `src/app/task-manager.tsx` | Wire handlers/state from `useResourcePlanner` + `useWorkspace` into `AppModals` and `WorkspaceSection` | Modify |
| `src/app/workspace-section.tsx` | Pass `roles/disciplines/grades` + `onManageRoles`/`onAssignRole` to `ResourcesPanel` | Modify |
| `src/app/resources-panel.tsx` | "Manage roles" button + per-resource role picker in the roster | Modify |
| `src/app/resources-panel.test.tsx` | Test button + assignment callbacks | Modify |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | New keys | Modify |

**Commands:** single file `npx vitest run src/app/<file>.test.tsx`; full `npm run test:run`; types `npx tsc --noEmit`.

---

## Task 1: Pure role helpers

**Files:** Modify `src/app/resource-foundation.ts`; Test `src/app/resource-foundation.test.ts`.

- [ ] **Step 1: Append failing tests** to `src/app/resource-foundation.test.ts`:

```ts
import { nextId, findRoleByCombo, roleLabel } from "./resource-foundation";
import type { Role, Discipline, Grade } from "./types";

describe("nextId", () => {
  test("returns 1 for empty, max+1 otherwise", () => {
    expect(nextId([])).toBe(1);
    expect(nextId([{ id: 3 }, { id: 7 }, { id: 5 }])).toBe(8);
  });
});

describe("findRoleByCombo", () => {
  const roles: Role[] = [{ id: 1, disciplineId: 2, gradeId: 3, internalRate: 0, externalRate: 0 }];
  test("matches on discipline+grade", () => {
    expect(findRoleByCombo(roles, 2, 3)?.id).toBe(1);
    expect(findRoleByCombo(roles, 2, 4)).toBeUndefined();
  });
});

describe("roleLabel", () => {
  const disciplines: Discipline[] = [{ id: 2, name: "Developer" }];
  const grades: Grade[] = [{ id: 3, name: "Senior" }];
  test("formats discipline + grade; empty for null role", () => {
    const role: Role = { id: 1, disciplineId: 2, gradeId: 3, internalRate: 0, externalRate: 0 };
    expect(roleLabel(role, disciplines, grades)).toBe("Developer Senior");
    expect(roleLabel(undefined, disciplines, grades)).toBe("");
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run src/app/resource-foundation.test.ts` (imports not found).

- [ ] **Step 3: Append to `src/app/resource-foundation.ts`** (add `Role` to the existing `./types` import; `Discipline`/`Grade` are already imported):

```ts
/** Next monotonic id for an entity array (1-based). */
export function nextId(items: ReadonlyArray<{ id: number }>): number {
  return items.length ? Math.max(...items.map((i) => i.id)) + 1 : 1;
}

/** Find the Role for a discipline × grade combination, if one exists. */
export function findRoleByCombo(
  roles: ReadonlyArray<Role>,
  disciplineId: number,
  gradeId: number,
): Role | undefined {
  return roles.find((r) => r.disciplineId === disciplineId && r.gradeId === gradeId);
}

/** Human label for a role: "Developer Senior". Empty string when role is undefined. */
export function roleLabel(
  role: Role | undefined,
  disciplines: ReadonlyArray<Discipline>,
  grades: ReadonlyArray<Grade>,
): string {
  if (!role) return "";
  const d = disciplines.find((x) => x.id === role.disciplineId)?.name ?? "?";
  const g = grades.find((x) => x.id === role.gradeId)?.name ?? "?";
  return `${d} ${g}`;
}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run src/app/resource-foundation.test.ts`.

- [ ] **Step 5: Commit.**
```bash
git add src/app/resource-foundation.ts src/app/resource-foundation.test.ts
git commit -m "feat(resources): pure nextId/findRoleByCombo/roleLabel helpers"
```

---

## Task 2: CRUD handlers + roles-modal state (`use-resource-planner.ts`)

**Files:** Modify `src/app/use-resource-planner.ts`; Test `src/app/use-resource-planner.test.tsx`.

Read the existing file first: it destructures workspace state from `useWorkspace()` and returns `useCallback` handlers. Phase 1 added `resources/roles/disciplines/grades/plan` (+ setters) to the context — destructure the ones you need. Read `use-resource-planner.test.tsx` to copy its exact `renderHook` + provider harness.

- [ ] **Step 1: Append failing tests** to `src/app/use-resource-planner.test.tsx` (mirror the file's existing setup for rendering the hook within the workspace providers and seeding `disciplines`/`grades`/`resources`):

```ts
// Using the file's existing harness (renderHook within providers). These assert
// the new handlers on the hook's return value. Adapt the seeding/probe helpers
// to whatever the file already uses for the absence/shift handler tests.

test("resolveOrCreateRole creates a role once, then is idempotent", () => {
  const { result } = renderPlanner();
  let id1 = 0, id2 = 0;
  act(() => { id1 = result.current.resolveOrCreateRole(1, 1); });
  act(() => { id2 = result.current.resolveOrCreateRole(1, 1); });
  expect(id1).toBe(id2);
});

test("handleAssignResourceRole sets the resource's roleId", () => {
  const { result } = renderPlanner({ resources: [{ id: 1, name: "Sample", roleId: null, utilizationMode: "percent", utilization: {} }] });
  act(() => { result.current.handleAssignResourceRole(1, 1, 1); });
  expect(currentResources()[0].roleId).not.toBeNull();
});

test("handleDeleteRole clears referencing resources' roleId", () => {
  const { result } = renderPlanner({
    roles: [{ id: 5, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 0 }],
    resources: [{ id: 1, name: "Sample", roleId: 5, utilizationMode: "percent", utilization: {} }],
  });
  act(() => { result.current.handleDeleteRole(5); });
  expect(currentRoles().find((r) => r.id === 5)).toBeUndefined();
  expect(currentResources()[0].roleId).toBeNull();
});

test("handleAddDiscipline appends a trimmed discipline and returns its id", () => {
  const { result } = renderPlanner({ disciplines: [{ id: 1, name: "Developer" }] });
  let id = 0;
  act(() => { id = result.current.handleAddDiscipline("  QA  ")!; });
  expect(currentDisciplines().find((d) => d.id === id)?.name).toBe("QA");
});
```

> If the existing test file lacks `renderPlanner`/`currentResources` helpers, build the harness in the same style the file already uses for the absence/shift handlers (render the hook inside the workspace providers; expose context state via a probe component or shared setter spy). Keep assertions behavioral.

- [ ] **Step 2: Run → FAIL.** `npx vitest run src/app/use-resource-planner.test.tsx`.

- [ ] **Step 3: Implement in `src/app/use-resource-planner.ts`.**
Add to the `useWorkspace()` destructure: `resources, setResources, roles, setRoles, disciplines, setDisciplines, grades, setGrades`. Import `nextId` from `./resource-foundation` and type `Role` (and `Discipline`/`Grade` if referenced) from `./types`. Add state + handlers:

```ts
const [rolesModalOpen, setRolesModalOpen] = useState(false);
const handleOpenRolesModal = useCallback(() => setRolesModalOpen(true), []);
const handleCloseRolesModal = useCallback(() => setRolesModalOpen(false), []);

const resolveOrCreateRole = useCallback(
  (disciplineId: number, gradeId: number): number => {
    const existing = roles.find(
      (r) => r.disciplineId === disciplineId && r.gradeId === gradeId,
    );
    if (existing) return existing.id;
    const id = nextId(roles);
    const role: Role = {
      id, disciplineId, gradeId, internalRate: 0, externalRate: 0,
      localModifiedAt: new Date().toISOString(),
    };
    setRoles((prev) => [...prev, role]);
    return id;
  },
  [roles, setRoles],
);

const handleSaveRole = useCallback((role: Role) => {
  const stamp = new Date().toISOString();
  setRoles((prev) => prev.map((r) => (r.id === role.id ? { ...role, localModifiedAt: stamp } : r)));
}, [setRoles]);

const handleDeleteRole = useCallback((id: number) => {
  const stamp = new Date().toISOString();
  setRoles((prev) => prev.filter((r) => r.id !== id));
  setResources((prev) => prev.map((r) => (r.roleId === id ? { ...r, roleId: null, localModifiedAt: stamp } : r)));
}, [setRoles, setResources]);

const handleAssignResourceRole = useCallback(
  (resourceId: number, disciplineId: number, gradeId: number) => {
    const roleId = resolveOrCreateRole(disciplineId, gradeId);
    const stamp = new Date().toISOString();
    setResources((prev) => prev.map((r) => (r.id === resourceId ? { ...r, roleId, localModifiedAt: stamp } : r)));
  },
  [resolveOrCreateRole, setResources],
);

const handleClearResourceRole = useCallback((resourceId: number) => {
  const stamp = new Date().toISOString();
  setResources((prev) => prev.map((r) => (r.id === resourceId ? { ...r, roleId: null, localModifiedAt: stamp } : r)));
}, [setResources]);

const handleAddDiscipline = useCallback((name: string): number | null => {
  const clean = name.trim();
  if (!clean) return null;
  const id = nextId(disciplines);
  setDisciplines((prev) => [...prev, { id, name: clean, localModifiedAt: new Date().toISOString() }]);
  return id;
}, [disciplines, setDisciplines]);

const handleRenameDiscipline = useCallback((id: number, name: string) => {
  const clean = name.trim();
  if (!clean) return;
  const stamp = new Date().toISOString();
  setDisciplines((prev) => prev.map((d) => (d.id === id ? { ...d, name: clean, localModifiedAt: stamp } : d)));
}, [setDisciplines]);

const handleAddGrade = useCallback((name: string): number | null => {
  const clean = name.trim();
  if (!clean) return null;
  const id = nextId(grades);
  setGrades((prev) => [...prev, { id, name: clean, localModifiedAt: new Date().toISOString() }]);
  return id;
}, [grades, setGrades]);

const handleRenameGrade = useCallback((id: number, name: string) => {
  const clean = name.trim();
  if (!clean) return;
  const stamp = new Date().toISOString();
  setGrades((prev) => prev.map((g) => (g.id === id ? { ...g, name: clean, localModifiedAt: stamp } : g)));
}, [setGrades]);
```

Add all of these to the hook's returned object:
`rolesModalOpen, handleOpenRolesModal, handleCloseRolesModal, resolveOrCreateRole, handleSaveRole, handleDeleteRole, handleAssignResourceRole, handleClearResourceRole, handleAddDiscipline, handleRenameDiscipline, handleAddGrade, handleRenameGrade`.

- [ ] **Step 4: Run → PASS.** `npx vitest run src/app/use-resource-planner.test.tsx`.

- [ ] **Step 5: Commit.**
```bash
git add src/app/use-resource-planner.ts src/app/use-resource-planner.test.tsx
git commit -m "feat(resources): role/discipline/grade CRUD + assignment handlers"
```

---

## Task 3: Roles modal (`roles-modal.tsx`)

**Files:** Create `src/app/roles-modal.tsx`, `src/app/roles-modal.test.tsx`; Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: Add i18n keys** to BOTH dicts (match each file's structure / `TranslationKey` union):

| key | en | de |
|-----|----|----|
| `rolesManageTitle` | `"Roles & rates"` | `"Rollen & Sätze"` |
| `rolesRateCard` | `"Rate card"` | `"Satztabelle"` |
| `rolesDiscipline` | `"Discipline"` | `"Disziplin"` |
| `rolesGrade` | `"Grade"` | `"Stufe"` |
| `rolesInternalRate` | `"Internal /h"` | `"Intern /Std"` |
| `rolesExternalRate` | `"External /h"` | `"Extern /Std"` |
| `rolesAddCombo` | `"Add role"` | `"Rolle hinzufügen"` |
| `rolesAddDiscipline` | `"Add discipline"` | `"Disziplin hinzufügen"` |
| `rolesAddGrade` | `"Add grade"` | `"Stufe hinzufügen"` |
| `rolesNoRoles` | `"No roles yet — add a discipline × grade combination."` | `"Noch keine Rollen — Disziplin × Stufe hinzufügen."` |

- [ ] **Step 2: Write the failing test** `src/app/roles-modal.test.tsx`:

```tsx
import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RolesModal } from "./roles-modal";
import type { Role, Discipline, Grade } from "./types";

const disciplines: Discipline[] = [{ id: 1, name: "Developer" }];
const grades: Grade[] = [{ id: 1, name: "Senior" }];
const roles: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 90, externalRate: 180 }];

function setup(over: Partial<React.ComponentProps<typeof RolesModal>> = {}) {
  const props = {
    lang: "en-US" as const, open: true, roles, disciplines, grades,
    onSaveRole: vi.fn(), onDeleteRole: vi.fn(), onResolveOrCreateRole: vi.fn(),
    onAddDiscipline: vi.fn(), onRenameDiscipline: vi.fn(),
    onAddGrade: vi.fn(), onRenameGrade: vi.fn(), onClose: vi.fn(),
    ...over,
  };
  render(<RolesModal {...props} />);
  return props;
}

test("renders existing role combos with their rates", () => {
  setup();
  expect(screen.getByText("Developer")).toBeInTheDocument();
  expect(screen.getByText("Senior")).toBeInTheDocument();
  expect(screen.getByDisplayValue("90")).toBeInTheDocument();
});

test("editing an internal rate calls onSaveRole with the new value", () => {
  const props = setup();
  const input = screen.getByDisplayValue("90");
  fireEvent.change(input, { target: { value: "100" } });
  expect(props.onSaveRole).toHaveBeenCalledWith(expect.objectContaining({ id: 1, internalRate: 100 }));
});

test("adding a discipline calls onAddDiscipline with the typed name", () => {
  const props = setup();
  fireEvent.change(screen.getByPlaceholderText("Add discipline"), { target: { value: "QA" } });
  fireEvent.click(screen.getByRole("button", { name: "Add discipline" }));
  expect(props.onAddDiscipline).toHaveBeenCalledWith("QA");
});
```

- [ ] **Step 3: Run → FAIL.** `npx vitest run src/app/roles-modal.test.tsx`.

- [ ] **Step 4: Implement `src/app/roles-modal.tsx`** (mirror `shift-edit-modal.tsx`: `<Modal>` shell, header with close X, scrollable body). Rates are controlled inputs committing via `onSaveRole` on change; discipline/grade lists have inline rename inputs (commit on blur) plus add-inputs.

```tsx
"use client";

import { useState } from "react";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { roleLabel } from "./resource-foundation";
import type { Discipline, Grade, Role } from "./types";

interface Props {
  lang: Lang;
  open: boolean;
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  onSaveRole: (role: Role) => void;
  onDeleteRole: (id: number) => void;
  onResolveOrCreateRole: (disciplineId: number, gradeId: number) => number;
  onAddDiscipline: (name: string) => number | null;
  onRenameDiscipline: (id: number, name: string) => void;
  onAddGrade: (name: string) => number | null;
  onRenameGrade: (id: number, name: string) => void;
  onClose: () => void;
}

function clampRate(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

export function RolesModal({
  lang, open, roles, disciplines, grades,
  onSaveRole, onDeleteRole, onResolveOrCreateRole,
  onAddDiscipline, onRenameDiscipline, onAddGrade, onRenameGrade, onClose,
}: Props) {
  const [newDiscipline, setNewDiscipline] = useState("");
  const [newGrade, setNewGrade] = useState("");
  const [comboDiscipline, setComboDiscipline] = useState<number | "">("");
  const [comboGrade, setComboGrade] = useState<number | "">("");

  if (!open) return null;

  const sortedRoles = [...roles].sort((a, b) =>
    roleLabel(a, disciplines, grades).localeCompare(roleLabel(b, disciplines, grades)),
  );

  return (
    <Modal open onClose={onClose} ariaLabel={t(lang, "rolesManageTitle")} align="center" backdropClassName="bg-black/40" zIndex={50}>
      <div className="relative flex max-h-[90vh] w-[720px] min-w-[320px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-AIPM-light-grey bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h3 className="text-base font-semibold text-AIPM-dark-grey dark:text-AIPM-light-grey">{t(lang, "rolesManageTitle")}</h3>
          <button type="button" onClick={onClose} aria-label={t(lang, "cancel")} className="rounded p-1 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800">
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="h-4 w-4"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" /></svg>
          </button>
        </header>

        <div className="flex flex-col gap-6 overflow-y-auto p-5">
          {/* Rate card */}
          <section>
            <h4 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, "rolesRateCard")}</h4>
            {sortedRoles.length === 0 ? (
              <p className="text-sm text-AIPM-medium-grey">{t(lang, "rolesNoRoles")}</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-AIPM-medium-grey">
                  <tr>
                    <th className="py-1">{t(lang, "rolesDiscipline")}</th>
                    <th className="py-1">{t(lang, "rolesGrade")}</th>
                    <th className="py-1 text-right">{t(lang, "rolesInternalRate")}</th>
                    <th className="py-1 text-right">{t(lang, "rolesExternalRate")}</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {sortedRoles.map((r) => (
                    <tr key={r.id}>
                      <td className="py-1.5">{disciplines.find((d) => d.id === r.disciplineId)?.name ?? "?"}</td>
                      <td className="py-1.5">{grades.find((g) => g.id === r.gradeId)?.name ?? "?"}</td>
                      <td className="py-1.5 text-right">
                        <input type="number" min={0} step={1} value={r.internalRate}
                          onChange={(e) => onSaveRole({ ...r, internalRate: clampRate(e.target.value) })}
                          className="w-24 rounded-md border border-zinc-300 px-2 py-1 text-right text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900" />
                      </td>
                      <td className="py-1.5 text-right">
                        <input type="number" min={0} step={1} value={r.externalRate}
                          onChange={(e) => onSaveRole({ ...r, externalRate: clampRate(e.target.value) })}
                          className="w-24 rounded-md border border-zinc-300 px-2 py-1 text-right text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900" />
                      </td>
                      <td className="py-1.5 text-right">
                        <button type="button" onClick={() => onDeleteRole(r.id)} aria-label={t(lang, "delete")}
                          className="rounded p-1 text-AIPM-medium-grey hover:bg-red-50 hover:text-red-600 dark:hover:bg-zinc-800">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {/* Add combo */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select value={comboDiscipline} onChange={(e) => setComboDiscipline(e.target.value ? Number(e.target.value) : "")}
                className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                <option value="">{t(lang, "rolesDiscipline")}</option>
                {disciplines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select value={comboGrade} onChange={(e) => setComboGrade(e.target.value ? Number(e.target.value) : "")}
                className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                <option value="">{t(lang, "rolesGrade")}</option>
                {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <button type="button"
                disabled={comboDiscipline === "" || comboGrade === ""}
                onClick={() => { if (comboDiscipline !== "" && comboGrade !== "") onResolveOrCreateRole(Number(comboDiscipline), Number(comboGrade)); }}
                className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1 text-sm font-medium text-white disabled:opacity-50">
                {t(lang, "rolesAddCombo")}
              </button>
            </div>
          </section>

          {/* Lists: disciplines + grades */}
          <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <RefList lang={lang} title={t(lang, "rolesDiscipline")} items={disciplines}
              onRename={onRenameDiscipline} addPlaceholder={t(lang, "rolesAddDiscipline")}
              addValue={newDiscipline} setAddValue={setNewDiscipline}
              onAdd={() => { if (onAddDiscipline(newDiscipline) != null) setNewDiscipline(""); }} />
            <RefList lang={lang} title={t(lang, "rolesGrade")} items={grades}
              onRename={onRenameGrade} addPlaceholder={t(lang, "rolesAddGrade")}
              addValue={newGrade} setAddValue={setNewGrade}
              onAdd={() => { if (onAddGrade(newGrade) != null) setNewGrade(""); }} />
          </section>
        </div>
      </div>
    </Modal>
  );
}

function RefList({
  lang, title, items, onRename, addPlaceholder, addValue, setAddValue, onAdd,
}: {
  lang: Lang;
  title: string;
  items: readonly { id: number; name: string }[];
  onRename: (id: number, name: string) => void;
  addPlaceholder: string;
  addValue: string;
  setAddValue: (v: string) => void;
  onAdd: () => void;
}) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{title}</h4>
      <ul className="flex flex-col gap-1.5">
        {items.map((it) => (
          <li key={it.id}>
            <input defaultValue={it.name}
              onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== it.name) onRename(it.id, e.target.value); }}
              className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900" />
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        <input value={addValue} onChange={(e) => setAddValue(e.target.value)} placeholder={addPlaceholder}
          className="flex-1 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <button type="button" onClick={onAdd} aria-label={addPlaceholder}
          className="rounded-md border border-AIPM-dark-blue px-3 py-1 text-sm font-medium text-AIPM-dark-blue hover:bg-AIPM-dark-blue/5">+</button>
      </div>
    </div>
  );
}
```

> The `+` add-button's `aria-label` is the placeholder text ("Add discipline"), which the test queries via `getByRole("button", { name: "Add discipline" })`.

- [ ] **Step 5: Run → PASS.** `npx vitest run src/app/roles-modal.test.tsx`.

- [ ] **Step 6: Commit.**
```bash
git add src/app/roles-modal.tsx src/app/roles-modal.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(resources): roles & rates manager modal"
```

---

## Task 4: Wire the modal + "Manage roles" button

**Files:** Modify `src/app/app-modals.tsx`, `src/app/task-manager.tsx`, `src/app/workspace-section.tsx`, `src/app/resources-panel.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`. Test: extend `src/app/resources-panel.test.tsx`.

- [ ] **Step 1: i18n** — add `resourcesManageRoles` → en `"Manage roles"`, de `"Rollen verwalten"` to both dicts.

- [ ] **Step 2: `app-modals.tsx`** — import `RolesModal` + types `Role/Discipline/Grade`. Add to `AppModalsProps`:
```ts
  rolesModalOpen: boolean;
  roles: Role[];
  disciplines: Discipline[];
  grades: Grade[];
  onSaveRole: (role: Role) => void;
  onDeleteRole: (id: number) => void;
  onResolveOrCreateRole: (disciplineId: number, gradeId: number) => number;
  onAddDiscipline: (name: string) => number | null;
  onRenameDiscipline: (id: number, name: string) => void;
  onAddGrade: (name: string) => number | null;
  onRenameGrade: (id: number, name: string) => void;
  onCloseRolesModal: () => void;
```
Destructure them and render (next to the other modals):
```tsx
<RolesModal
  lang={lang} open={rolesModalOpen} roles={roles} disciplines={disciplines} grades={grades}
  onSaveRole={onSaveRole} onDeleteRole={onDeleteRole} onResolveOrCreateRole={onResolveOrCreateRole}
  onAddDiscipline={onAddDiscipline} onRenameDiscipline={onRenameDiscipline}
  onAddGrade={onAddGrade} onRenameGrade={onRenameGrade} onClose={onCloseRolesModal}
/>
```

- [ ] **Step 3: `task-manager.tsx`** — pull the new values from `useResourcePlanner(...)` (`rolesModalOpen, handleOpenRolesModal, handleCloseRolesModal, handleSaveRole, handleDeleteRole, resolveOrCreateRole, handleAssignResourceRole, handleAddDiscipline, handleRenameDiscipline, handleAddGrade, handleRenameGrade`) and `roles, disciplines, grades` from `useWorkspace()`. Pass the modal props into `<AppModals … />`, and pass `onManageRoles={handleOpenRolesModal}` + `onAssignRole={handleAssignResourceRole}` into `<WorkspaceSection … />`.

- [ ] **Step 4: `workspace-section.tsx`** — add `onManageRoles: () => void;` and `onAssignRole: (resourceId: number, disciplineId: number, gradeId: number) => void;` to `WorkspaceSectionProps`. Destructure `roles, disciplines, grades` from `useWorkspace()`. Pass `onManageRoles`, `onAssignRole`, `roles`, `disciplines`, `grades` to `<ResourcesPanel … />`.

- [ ] **Step 5: `resources-panel.tsx`** — add to `Props`: `roles: readonly Role[]; disciplines: readonly Discipline[]; grades: readonly Grade[]; onManageRoles: () => void; onAssignRole: (resourceId: number, disciplineId: number, gradeId: number) => void;` (import the types). In `renderHeader`, add a button before "+ Add absence":
```tsx
<button type="button" onClick={onManageRoles}
  className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800">
  {t(lang, "resourcesManageRoles")}
</button>
```

- [ ] **Step 6: Extend `resources-panel.test.tsx`** — add `roles={[]} disciplines={[]} grades={[]} onManageRoles={fn} onAssignRole={fn}` to the existing render(s), and a test:
```tsx
test("clicking Manage roles calls onManageRoles", () => {
  const onManageRoles = vi.fn();
  render(<ResourcesPanel {...baseProps} resources={[]} onManageRoles={onManageRoles} onAssignRole={() => {}} roles={[]} disciplines={[]} grades={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Manage roles" }));
  expect(onManageRoles).toHaveBeenCalled();
});
```
(Use the en-US label "Manage roles"; import `vi`, `fireEvent`. Define a `baseProps` object if the file doesn't already have one, carrying the required `ResourcesPanel` props.)

- [ ] **Step 7: Verify + commit.** `npx tsc --noEmit` (only 2 known errors) and `npx vitest run src/app/resources-panel.test.tsx`.
```bash
git add src/app/app-modals.tsx src/app/task-manager.tsx src/app/workspace-section.tsx src/app/resources-panel.tsx src/app/resources-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(resources): wire roles modal + Manage roles button"
```

---

## Task 5: Per-resource role assignment in the roster

**Files:** Modify `src/app/resources-panel.tsx`; Test `src/app/resources-panel.test.tsx`.

Replace the Phase-1 read-only roster (the `<ul>` of names) with a per-resource control: name, current role, and two selects (discipline, grade) that assign on change.

- [ ] **Step 1: Failing test** — append to `resources-panel.test.tsx`:
```tsx
test("choosing a discipline then grade assigns the role", () => {
  const onAssignRole = vi.fn();
  const resources = [{ id: 1, name: "Alex Example", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
  render(<ResourcesPanel {...baseProps} resources={resources} roles={[]}
    disciplines={[{ id: 2, name: "Developer" }]} grades={[{ id: 3, name: "Senior" }]}
    onManageRoles={() => {}} onAssignRole={onAssignRole} />);
  fireEvent.change(screen.getByLabelText("Discipline for Alex Example"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Grade for Alex Example"), { target: { value: "3" } });
  expect(onAssignRole).toHaveBeenCalledWith(1, 2, 3);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** the roster with per-resource selects. Pre-select from the resource's current `roleId`; the grade `onChange` reads the sibling discipline select's current value so picking both fires one `onAssignRole`. Import `roleLabel` from `./resource-foundation`.

```tsx
{resources.length > 0 && (
  <ul className="mb-3 flex flex-col gap-2">
    {resources.map((r) => {
      const current = roles.find((x) => x.id === r.roleId);
      const disc = current?.disciplineId ?? "";
      const grad = current?.gradeId ?? "";
      return (
        <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800">
          <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">{r.name}</span>
          {r.roleId == null && (
            <span className="text-xs text-AIPM-medium-grey italic">{t(lang, "resourcesUnassignedRole")}</span>
          )}
          <select aria-label={`Discipline for ${r.name}`} defaultValue={disc}
            onChange={(e) => { const d = Number(e.target.value); if (d && grad) onAssignRole(r.id, d, Number(grad)); }}
            className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900">
            <option value="">{t(lang, "rolesDiscipline")}</option>
            {disciplines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select aria-label={`Grade for ${r.name}`} defaultValue={grad}
            onChange={(e) => {
              const g = Number(e.target.value);
              const dEl = document.querySelector(`[aria-label="Discipline for ${r.name}"]`) as HTMLSelectElement | null;
              const d = dEl ? Number(dEl.value) : 0;
              if (g && d) onAssignRole(r.id, d, g);
            }}
            className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900">
            <option value="">{t(lang, "rolesGrade")}</option>
            {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </li>
      );
    })}
  </ul>
)}
```

> The test changes discipline first (grade still empty → no call), then grade (sibling discipline now `2`, grade `3` → one call `onAssignRole(1, 2, 3)`).

- [ ] **Step 4: Run → PASS.** `npx vitest run src/app/resources-panel.test.tsx`.

- [ ] **Step 5: Commit.**
```bash
git add src/app/resources-panel.tsx src/app/resources-panel.test.tsx
git commit -m "feat(resources): per-resource role assignment in the roster"
```

---

## Final Verification

- [ ] `npm run test:run` — green (re-run `use-holiday-set.test.ts` alone if it's the sole failure).
- [ ] `npx tsc --noEmit` — only the 2 known pre-existing errors.
- [ ] Smoke (`npm run dev`): Resources tab → "Manage roles" opens the modal; add a discipline/grade; add a combo (appears in the rate card); edit a rate; assign a resource a discipline+grade (creates the role on demand if new); reload → roles, rates, and assignments persist (Phase-1 persistence covers these entities).

---

## Self-Review

**Spec coverage (Phase 2):** roles modal with discipline × grade rate grid ✓ (T3); editable internal/external rates ✓ (T3); add/rename disciplines & grades ✓ (T2 handlers, T3 UI); on-demand Role creation ✓ (`resolveOrCreateRole`, T2; invoked from T3 add-combo and T5 assignment); role assignment on a resource ✓ (T2 `handleAssignResourceRole`, T5 UI); CRUD handlers for roles/disciplines/grades/resource-assignment ✓ (T2). Persistence/serialization already done in Phase 1 — no storage changes needed (`Role/Discipline/Grade/Resource.roleId` all round-trip via the Phase-1 sanitizers/serializers).

**Type consistency:** handler names map cleanly hook → task-manager → app-modals → modal: `handleSaveRole`/`onSaveRole`, `handleDeleteRole`/`onDeleteRole`, `resolveOrCreateRole`/`onResolveOrCreateRole`, `handleAddDiscipline`/`onAddDiscipline`, `handleRenameDiscipline`/`onRenameDiscipline`, `handleAddGrade`/`onAddGrade`, `handleRenameGrade`/`onRenameGrade`, `handleAssignResourceRole`/`onAssignRole`, `handleOpenRolesModal`/`onManageRoles`, `rolesModalOpen`/`open`, `handleCloseRolesModal`/`onCloseRolesModal`. `onAssignRole(resourceId, disciplineId, gradeId)` is identical in T2/T4/T5. `roleLabel`/`findRoleByCombo`/`nextId` signatures match T1.

**Placeholder scan:** none — all net-new code shown in full. T2's "follow the file's existing renderHook harness" is the one deferral to an existing pattern; behaviors under test are explicit.

**Scope (YAGNI):** no activity-logging for the new entities (deliberate — avoids touching `activity-log.ts`); no discipline/grade deletion (spec asked only add + rename); `handleDeleteRole` clears dangling `resource.roleId` for integrity. The roster's grade-select reads its sibling discipline value via the DOM to coordinate two independent selects without extra per-row state — acceptable; per-row local state is a clean alternative if a reviewer prefers.
