# Edit-Bucket Modal + Role Picker (0.14.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a draggable Edit-bucket modal (with a role picker + per-role resource assignment) that edits a bucket's fields and allocation lines, and wire "Add bucket" to open it — fixing the uneditable-empty-shell gap.

**Architecture:** New `BudgetBucketModal` on the shared `Modal`/`ModalHeader` (draggable + in-modal voice via existing context), draft+Save pattern. `budget-panel.tsx` owns `editingBucketId`, renders the modal, adds an Edit button, and opens the modal on Add. UI-only — no type/sanitize/storage/engine changes.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest + Testing Library. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-27-budget-bucket-modal-design.md`
**Branch:** `feat/0.14.0-budget-bucket-modal` (already created off `main`).

**Conventions:** i18n keys in BOTH `i18n.ts` (EN) + `i18n.de.ts` (DE); immutable updates; no `any`; tooltips via `title`. Run `npx tsc --noEmit`, `npm run lint`, relevant `npx vitest run` after each task.

---

## File Structure
- **New:** `src/app/budget-bucket-modal.tsx` (`BudgetBucketModal`), `src/app/budget-bucket-modal.test.tsx`.
- **Modify:** `src/app/budget-panel.tsx` (state + Edit button + Add-opens-modal + render modal), `src/app/i18n.ts`, `src/app/i18n.de.ts`, plus release files in Task 4.

---

## Task 1: i18n keys

**Files:** `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1:** Add these keys to BOTH dicts (same key names; German translated). Place near the existing `budget*` keys. First CHECK whether `budgetCurrency` and `budgetType` already exist — if present, do NOT redefine; otherwise add them.

EN (`i18n.ts`):
```ts
budgetEditBucket: "Edit bucket",
budgetBucketName: "Name",
budgetPoNumber: "PO number",
budgetStartDate: "Start date",
budgetEndDate: "End date",
budgetSuccessor: "Spillover successor",
budgetSuccessorNone: "None",
budgetFixedPriceAmount: "Fixed-price amount",
budgetFxOverride: "Manual FX rate",
budgetFxOverrideHint: "Manual EUR→currency rate; leave blank to use the cached ECB rate.",
budgetAllocations: "Role allocations",
budgetAddRole: "Add role",
budgetRemoveRole: "Remove role",
budgetResources: "Resources",
budgetNoRolesLeft: "All roles are already allocated.",
budgetNameRequired: "Name is required.",
budgetDateRangeInvalid: "Start date must be on or before the end date.",
```
DE (`i18n.de.ts`) — faithful translations: `budgetEditBucket: "Budget-Topf bearbeiten"`, `budgetBucketName: "Name"`, `budgetPoNumber: "Bestellnummer"`, `budgetStartDate: "Startdatum"`, `budgetEndDate: "Enddatum"`, `budgetSuccessor: "Nachfolger (Übertrag)"`, `budgetSuccessorNone: "Keiner"`, `budgetFixedPriceAmount: "Festpreisbetrag"`, `budgetFxOverride: "Manueller Wechselkurs"`, `budgetFxOverrideHint: "Manueller EUR→Währung-Kurs; leer lassen, um den zwischengespeicherten EZB-Kurs zu verwenden."`, `budgetAllocations: "Rollen-Zuordnungen"`, `budgetAddRole: "Rolle hinzufügen"`, `budgetRemoveRole: "Rolle entfernen"`, `budgetResources: "Ressourcen"`, `budgetNoRolesLeft: "Alle Rollen sind bereits zugeordnet."`, `budgetNameRequired: "Name ist erforderlich."`, `budgetDateRangeInvalid: "Das Startdatum muss am oder vor dem Enddatum liegen."`.

- [ ] **Step 2:** `npx tsc --noEmit` (0 — catches any key mismatch between dicts). `npm run lint` clean.
- [ ] **Step 3:** Commit
```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n(budget): keys for the edit-bucket modal"
```

---

## Task 2: `BudgetBucketModal` component + tests

**Files:** Create `src/app/budget-bucket-modal.tsx`, `src/app/budget-bucket-modal.test.tsx`.

First READ `src/app/resource-edit-modal.tsx` (draft+Save modal pattern) and `src/app/task-form-modal.tsx` (to find where `SegmentedControl` is imported from, and the panel `<div>`/header markup). Confirm `roleLabel` + `resourceDisplayName` are exported from `./resource-foundation` and the types from `./types`.

- [ ] **Step 1: Write the component** (`src/app/budget-bucket-modal.tsx`)

```tsx
"use client";

import { useState } from "react";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { useDraggable } from "./use-draggable";
import { SegmentedControl } from "./task-manager-ui"; // match task-form-modal's import source
import {
  BUDGET_TYPES,
  SUPPORTED_CURRENCIES,
  type BudgetBucket,
  type BudgetCurrency,
  type Discipline,
  type Grade,
  type Resource,
  type Role,
} from "./types";
import { roleLabel, resourceDisplayName } from "./resource-foundation";

interface BudgetBucketModalProps {
  lang: Lang;
  bucket: BudgetBucket;
  allBuckets: readonly BudgetBucket[];
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  resources: readonly Resource[];
  onSave: (bucket: BudgetBucket) => void;
  onClose: () => void;
}

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function BudgetBucketModal({
  lang, bucket, allBuckets, roles, disciplines, grades, resources, onSave, onClose,
}: BudgetBucketModalProps) {
  const [draft, setDraft] = useState<BudgetBucket>(bucket);
  const [error, setError] = useState<string | null>(null);
  const [roleToAdd, setRoleToAdd] = useState<string>("");
  const { offset, handleProps } = useDraggable(true);

  const allocatedRoleIds = new Set(draft.allocations.map((a) => a.roleId));
  const addableRoles = roles.filter((r) => !allocatedRoleIds.has(r.id));

  const addRole = () => {
    const id = Number(roleToAdd);
    if (!id || allocatedRoleIds.has(id)) return;
    setDraft((d) => ({
      ...d,
      allocations: [...d.allocations, { roleId: id, resourceIds: [], budgetHours: {}, actualHours: {} }],
    }));
    setRoleToAdd("");
  };
  const removeRole = (roleId: number) =>
    setDraft((d) => ({ ...d, allocations: d.allocations.filter((a) => a.roleId !== roleId) }));
  const toggleResource = (roleId: number, resourceId: number) =>
    setDraft((d) => ({
      ...d,
      allocations: d.allocations.map((a) =>
        a.roleId !== roleId
          ? a
          : {
              ...a,
              resourceIds: a.resourceIds.includes(resourceId)
                ? a.resourceIds.filter((rid) => rid !== resourceId)
                : [...a.resourceIds, resourceId],
            },
      ),
    }));

  const save = () => {
    if (!draft.name.trim()) return setError(t(lang, "budgetNameRequired"));
    if (draft.startDate > draft.endDate) return setError(t(lang, "budgetDateRangeInvalid"));
    onSave({ ...draft, localModifiedAt: new Date().toISOString() });
  };

  const isFixed = draft.type === "fixed";

  return (
    <Modal open onClose={onClose} ariaLabel={t(lang, "budgetEditBucket")} backdropClassName="bg-AIPM-dark-blue/40 overflow-y-auto">
      <div
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="relative flex w-[640px] min-w-[460px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-AIPM-light-grey bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <ModalHeader lang={lang} title={t(lang, "budgetEditBucket")} onClose={onClose} dragHandleProps={handleProps} />
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-6 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span>{t(lang, "budgetBucketName")}</span>
            <input className={inputClass} value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>{t(lang, "budgetPoNumber")}</span>
            <input className={inputClass} value={draft.poNumber ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, poNumber: e.target.value || undefined }))} />
          </label>

          <div className="flex flex-col gap-1 text-sm">
            <span>{t(lang, "budgetType")}</span>
            <SegmentedControl
              value={draft.type}
              ariaLabel={t(lang, "budgetType")}
              options={BUDGET_TYPES.map((bt) => ({ value: bt, label: t(lang, bt === "fixed" ? "budgetTypeFixed" : "budgetTypeTm") }))}
              onChange={(type) => setDraft((d) => ({ ...d, type }))}
            />
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span>{t(lang, "budgetCurrency")}</span>
            <select className={inputClass} value={draft.currency}
              onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value as BudgetCurrency }))}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          {isFixed && (
            <label className="flex flex-col gap-1 text-sm">
              <span>{t(lang, "budgetFixedPriceAmount")}</span>
              <input className={inputClass} type="number" min={0} value={draft.fixedPriceAmount ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, fixedPriceAmount: e.target.value === "" ? undefined : Number(e.target.value) }))} />
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span>{t(lang, "budgetStartDate")}</span>
            <input className={inputClass} type="date" value={draft.startDate}
              onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t(lang, "budgetEndDate")}</span>
            <input className={inputClass} type="date" value={draft.endDate}
              onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))} />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>{t(lang, "budgetSuccessor")}</span>
            <select className={inputClass} value={draft.successorId ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, successorId: e.target.value === "" ? null : Number(e.target.value) }))}>
              <option value="">{t(lang, "budgetSuccessorNone")}</option>
              {allBuckets.filter((b) => b.id !== draft.id).map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>{t(lang, "budgetFxOverride")}</span>
            <input className={inputClass} type="number" min={0} step="0.0001" value={draft.fxRateOverride ?? ""}
              title={t(lang, "budgetFxOverrideHint")}
              onChange={(e) => setDraft((d) => ({ ...d, fxRateOverride: e.target.value === "" ? undefined : Number(e.target.value) }))} />
            <span className="text-xs text-AIPM-medium-grey">{t(lang, "budgetFxOverrideHint")}</span>
          </label>

          <div className="flex flex-col gap-2 text-sm sm:col-span-2">
            <span className="font-medium">{t(lang, "budgetAllocations")}</span>
            {draft.allocations.map((a) => (
              <div key={a.roleId} className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{roleLabel(roles.find((r) => r.id === a.roleId), disciplines, grades) || `#${a.roleId}`}</span>
                  <button type="button" onClick={() => removeRole(a.roleId)}
                    className="rounded-md border border-transparent px-2 py-0.5 text-xs text-zinc-500 hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:hover:bg-zinc-800">
                    {t(lang, "budgetRemoveRole")}
                  </button>
                </div>
                {resources.length > 0 && (
                  <div className="mt-1">
                    <div className="text-xs text-AIPM-medium-grey">{t(lang, "budgetResources")}</div>
                    <div className="flex flex-wrap gap-2">
                      {resources.map((r) => (
                        <label key={r.id} className="flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={a.resourceIds.includes(r.id)}
                            onChange={() => toggleResource(a.roleId, r.id)} />
                          {resourceDisplayName(r)}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div className="flex items-center gap-2">
              <select className={`${inputClass} flex-1`} value={roleToAdd} onChange={(e) => setRoleToAdd(e.target.value)}
                disabled={addableRoles.length === 0} aria-label={t(lang, "budgetAddRole")}>
                <option value="">{addableRoles.length === 0 ? t(lang, "budgetNoRolesLeft") : "—"}</option>
                {addableRoles.map((r) => (
                  <option key={r.id} value={r.id}>{roleLabel(r, disciplines, grades) || `#${r.id}`}</option>
                ))}
              </select>
              <button type="button" onClick={addRole} disabled={roleToAdd === ""}
                className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-AIPM-dark-blue/90 disabled:opacity-50">
                + {t(lang, "budgetAddRole")}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-AIPM-pink sm:col-span-2">{error}</p>}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-AIPM-light-grey px-6 py-4 dark:border-zinc-800">
          <button type="button" onClick={onClose}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-AIPM-dark-grey shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800">
            {t(lang, "cancel")}
          </button>
          <button type="button" onClick={save}
            className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-AIPM-dark-blue/90">
            {t(lang, "save")}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
```
Implementer notes: confirm the real import source for `SegmentedControl` (match `task-form-modal.tsx`); confirm `budgetType`, `cancel`, `save`, `budgetCurrency` i18n keys exist (they're used by existing UI — if any is missing, add it in BOTH dicts in Task 1's spirit). Confirm `SegmentedControl`'s prop names (`value`/`options`/`onChange`/`ariaLabel`) against its definition and adapt if different. If `resources` is empty, the resource checkbox block is simply omitted.

- [ ] **Step 2: Write tests** (`src/app/budget-bucket-modal.test.tsx`)

```tsx
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BudgetBucketModal } from "./budget-bucket-modal";
import type { BudgetBucket, Role } from "./types";

const roles: Role[] = [
  { id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
  { id: 4, disciplineId: 1, gradeId: 2, internalRate: 120, externalRate: 180 },
];
const baseBucket: BudgetBucket = {
  id: 1, name: "PAM", type: "tm", currency: "EUR",
  startDate: "2026-01-01", endDate: "2026-06-30", status: "open", allocations: [],
};
function setup(over: Partial<React.ComponentProps<typeof BudgetBucketModal>> = {}) {
  const onSave = vi.fn();
  render(<BudgetBucketModal lang="en-US" bucket={baseBucket} allBuckets={[baseBucket]} roles={roles}
    disciplines={[]} grades={[]} resources={[]} onSave={onSave} onClose={vi.fn()} {...over} />);
  return { onSave };
}

describe("BudgetBucketModal", () => {
  test("editing name and saving emits the updated bucket", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByDisplayValue("PAM"), { target: { value: "PAM v2" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].name).toBe("PAM v2");
  });
  test("blank name blocks save with a message", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByDisplayValue("PAM"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
  });
  test("start after end blocks save", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByDisplayValue("2026-06-30"), { target: { value: "2025-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/start date must be/i)).toBeInTheDocument();
  });
  test("add role appends an allocation with empty hour maps", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText(/add role/i), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /\+ add role/i }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const saved = onSave.mock.calls[0][0] as BudgetBucket;
    expect(saved.allocations).toHaveLength(1);
    expect(saved.allocations[0]).toMatchObject({ roleId: 3, resourceIds: [], budgetHours: {}, actualHours: {} });
  });
});
```
(If the SegmentedControl-based Fixed/T&M toggle has a clean accessible selector, ADD a test that the Fixed-price field appears only after switching Type to Fixed; if not easily selectable, skip that one rather than asserting brittle DOM. Adjust the `/\+ add role/i` button-name regex to match the rendered label.)

- [ ] **Step 3:** `npx vitest run src/app/budget-bucket-modal.test.tsx` (pass), `npx tsc --noEmit` (0), `npm run lint` (clean).

- [ ] **Step 4: Commit**
```bash
git add src/app/budget-bucket-modal.tsx src/app/budget-bucket-modal.test.tsx
git commit -m "feat(budget): BudgetBucketModal — edit fields + role picker + resource assignment"
```

---

## Task 3: Panel integration

**Files:** `src/app/budget-panel.tsx` (+ extend `budget-panel-edit.test.tsx`).

- [ ] **Step 1: State + import** — add `import { BudgetBucketModal } from "./budget-bucket-modal";` and, in `BudgetPanel`, `const [editingBucketId, setEditingBucketId] = useState<number | null>(null);` (next to the existing `dragId` state).

- [ ] **Step 2: Add-opens-modal** — change `addBucket`:
```tsx
  const addBucket = () => {
    const id = nextBucketId(buckets);
    props.onChangeBuckets([...buckets, blankBucket(id, plan)]);
    setEditingBucketId(id);
  };
```

- [ ] **Step 3: Edit button** — in each bucket card's action row (where Close/Remove are, ~line 279–297), add an Edit button BEFORE the Close button:
```tsx
                <button
                  type="button"
                  onClick={() => setEditingBucketId(bucket.id)}
                  className="rounded-md border border-transparent px-2 py-0.5 text-xs text-zinc-500 hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  {t(lang, "budgetEditBucket")}
                </button>
```

- [ ] **Step 4: Render the modal** — after the buckets `<section>` (before `BudgetPanel`'s closing `</div>`), add:
```tsx
      {editingBucketId != null && bucketById.get(editingBucketId) && (
        <BudgetBucketModal
          lang={lang}
          bucket={bucketById.get(editingBucketId)!}
          allBuckets={buckets}
          roles={roles}
          disciplines={props.disciplines}
          grades={props.grades}
          resources={resources}
          onSave={(next) => {
            props.onChangeBuckets(buckets.map((b) => (b.id === next.id ? next : b)));
            setEditingBucketId(null);
          }}
          onClose={() => setEditingBucketId(null)}
        />
      )}
```
Confirm `roles`, `resources` are destructured in `BudgetPanel` (they are — from `props`), and `props.disciplines`/`props.grades` exist; `bucketById` already exists.

- [ ] **Step 5: Integration tests** — extend `src/app/budget-panel-edit.test.tsx` (it has a `Harness` with an onChange spy). Add: (a) clicking a bucket's **Edit** button shows the modal (assert the "Edit bucket" heading/title appears); (b) clicking **Add bucket** calls the onChange spy with one more bucket AND opens the modal. Mirror the file's existing Harness usage.

- [ ] **Step 6:** `npx tsc --noEmit` (0); `npm run lint`; `npx vitest run src/app/budget-panel src/app/budget-bucket-modal` (pass).

- [ ] **Step 7: Commit**
```bash
git add src/app/budget-panel.tsx src/app/budget-panel-edit.test.tsx
git commit -m "feat(budget): Edit button + Add-opens-modal wiring in the budget panel"
```

---

## Task 4: Release 0.14.0

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `docs/CODEMAPS/frontend.md`.

- [ ] **Step 1: version.ts** — set `APP_VERSION = "0.14.0"`, build date `2026-05-27`. READ the file: choose a codename per its convention (next dystopian-author milestone, e.g. "Atwood"). If the file expects one highlight key per minor, add `versionHighlightBudgetEdit` to `APP_HIGHLIGHT_KEYS` + define in both i18n dicts; otherwise leave the list.

- [ ] **Step 2: CHANGELOG** — add `## [0.14.0] … — 2026-05-27`: editable budget buckets via a new draggable Edit-bucket modal (name, PO, type, currency, fixed-price, dates, spillover successor, manual FX override) with a role picker (add/remove role lines + per-role resource assignment); "Add bucket" now opens the editor on the new bucket; per-period hours still edited in the panel grid.

- [ ] **Step 3: Codemap** — `docs/CODEMAPS/frontend.md`: add `budget-bucket-modal.tsx` (`BudgetBucketModal`) and note the budget panel's Edit / Add-opens-modal wiring.

- [ ] **Step 4:** `npx tsc --noEmit` (0); `npm run lint`; `npm run test:coverage` (green, ≥70%). Before committing, `git status` and `git restore` any unrelated modified fixture (e.g. `sample-workspace.md`).

- [ ] **Step 5: Commit**
```bash
git add src/app/version.ts CHANGELOG.md docs/CODEMAPS/frontend.md src/app/i18n.ts src/app/i18n.de.ts
git commit -m "docs(release): 0.14.0 — editable budget buckets (edit-bucket modal)"
```

---

## Final review
Dispatch a final code reviewer over `git diff main...HEAD`; confirm gates green; then use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)
**Spec coverage:** modal component + all fields → T2; allocations role picker + resource assignment → T2; panel Edit button + Add-opens-modal + render → T3; i18n → T1; validation → T2; release → T4. All covered.

**Placeholder scan:** Code is concrete. T2/T4 flag specific things to confirm against source rather than guess (SegmentedControl import + prop names; existence of `budgetType`/`cancel`/`save`/`budgetCurrency` keys; version codename/highlight convention) — explicit, not vague.

**Type consistency:** `BudgetBucketModal` props (`bucket`, `allBuckets`, `roles`, `disciplines`, `grades`, `resources`, `onSave`, `onClose`) match the panel render in T3; `onSave: (bucket: BudgetBucket) => void` consistent; allocation shape `{ roleId, resourceIds, budgetHours, actualHours }` matches `BucketAllocation`. `nextBucketId`/`blankBucket`/`bucketById` referenced in T3 already exist in budget-panel.tsx.
