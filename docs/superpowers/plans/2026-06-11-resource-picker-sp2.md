# Resource Picker SP2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the SP1 `ResourcePicker` to the RAID-owner and shift-assignee fields (full augment picker) and the stakeholder name field (link-only variant), so each sets its existing Resource FK.

**Architecture:** Make `ResourcePicker.onCreateResource` optional (omitting it = no "+ Add" row = link-only). Swap the three editors' person inputs to `ResourcePicker`, threading `resources` / `contacts` / `onCreateResource` from where they already live. RAID/shift reuse `task-manager.handleCreateResource` (already stamps `localModifiedAt` + logs `resource.created`). No schema/serializer change.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, vitest 4 + RTL, Tailwind (AIPM palette).

**Spec:** `docs/superpowers/specs/2026-06-11-resource-picker-sp2-design.md`. **Branch:** `feat-resource-picker-sp2`. Do NOT edit `eslint.config.mjs`.

**Key facts (verified):**
- FKs are all `number | null` — `RaidItem.ownerResourceId`, `Shift.resourceId`, `Stakeholder.resourceId` — matching `ResourcePicker.onChange`'s `resourceId: number | null` emit exactly. **No coalesce needed** (unlike SP1's `Task.resourceId`).
- `ResourcePickerValue = { name: string; email: string; resourceId: number | null | undefined }`; `onChange: (next: { name; email; resourceId: number | null }) => void`.
- `AssigneeField` (the shift datalist sub-component) is SHARED with `absence-edit-modal.tsx` and `modal-edit-fields.tsx` — do NOT remove it; only swap shift's usage.
- `app-modals.tsx` already has `resources`, `onCreateResource`, `contactsList` (from SP1) and renders `ShiftEditModal`.
- `stakeholder-edit-modal.tsx` already receives `resources`.
- RAID threading path: `task-manager.tsx` (`workspaceProps`) → `WorkspaceSection` → `RaidPanel` → `RaidEditModal`.

---

## Task 1: Make `ResourcePicker.onCreateResource` optional (link-only support)

**Files:**
- Modify: `src/app/resource-picker.tsx`
- Test: `src/app/resource-picker.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/app/resource-picker.test.tsx` (the existing `setup` helper passes `onCreateResource`; add a variant test that omits it):

```tsx
it("omits the + Add row entirely when onCreateResource is not provided (link-only)", () => {
  const onChange = vi.fn();
  render(
    <ResourcePicker
      lang="en-US"
      value={{ name: "Brand New", email: "", resourceId: null }}
      resources={resources}
      contacts={contacts}
      onChange={onChange}
    />,
  );
  fireEvent.focus(screen.getByRole("combobox"));
  expect(screen.queryByText(/Add .* as resource/i)).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/resource-picker.test.tsx`
Expected: FAIL — TypeScript/runtime: `onCreateResource` is required, or the add row still renders.

- [ ] **Step 3: Make the prop optional and gate the add row**

In `src/app/resource-picker.tsx`:

1. Change the prop type from `onCreateResource: (name: string, email: string) => number;` to:
```ts
  onCreateResource?: (name: string, email: string) => number;
```

2. In the `rows` useMemo, gate the add-row push on the callback being present. Change:
```ts
    if (trimmed && !exact) out.push({ kind: "add", name: trimmed });
```
to:
```ts
    if (onCreateResource && trimmed && !exact) out.push({ kind: "add", name: trimmed });
```
and add `onCreateResource` to the `useMemo` dependency array (alongside `resources, contacts, display`).

3. In `choose()`, the `add` branch calls `onCreateResource(...)`. Guard it so TypeScript is satisfied and it's unreachable when undefined:
```ts
    } else if (onCreateResource) {
      const id = onCreateResource(row.name, value.email);
      onChange({ name: row.name, email: value.email, resourceId: id });
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/resource-picker.test.tsx`
Expected: PASS (11 tests — the 10 SP1 tests + this one).

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit` (expect errors ONLY about callers that pass `onCreateResource` — none should break since it's now optional; expect 0 errors). `npm run lint` (0).

- [ ] **Step 6: Commit**

```bash
git add src/app/resource-picker.tsx src/app/resource-picker.test.tsx
git commit -m "feat: optional onCreateResource enables ResourcePicker link-only mode"
```

---

## Task 2: RAID owner → ResourcePicker

**Files:**
- Modify: `src/app/raid-edit-modal.tsx` (swap owner input; add props)
- Modify: `src/app/raid-panel.tsx` (forward props)
- Modify: `src/app/workspace-section.tsx` (forward props)
- Modify: `src/app/task-manager.tsx` (add `contactsList` + `onCreateResource` to `workspaceProps`)
- Test: `src/app/raid-edit-modal` test (find the existing raid-panel/raid-edit test; add an integration test)

- [ ] **Step 1: Write the failing test**

Find the existing RAID editor test (e.g. `raid-panel.test.tsx`). Add a test that opening the RAID editor with a `resources` list, focusing the owner field, and picking a resource sets `ownerResourceId`. The required behavioral assertion (model on the file's harness — it likely drives the modal via the panel):

```tsx
it("links a RAID owner to a resource via the picker (sets ownerResourceId)", () => {
  // render RaidPanel/RaidEditModal with resources=[{id:1,firstName:"Sample",lastName:"Dummy",email:"Sample@x.com",roleId:null,utilizationMode:"percent",utilization:{}}]
  // open the editor, focus the owner field (getByPlaceholderText or label), click "Alex Example"
  // assert the onSave/draft payload carries ownerResourceId === 1
});
```

If the test harness can't reach the modal cleanly, render `RaidEditModal` directly with a `draft` and a spy `onChange`, and assert `onChange` was called with `ownerResourceId: 1`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run <that test file>`
Expected: FAIL (owner is still a plain input; no ownerResourceId set).

- [ ] **Step 3: Add props to `RaidEditModalProps` and the component signature**

In `src/app/raid-edit-modal.tsx`, add to `RaidEditModalProps` (after `stakeholders`):
```ts
  resources: readonly Resource[];
  contacts: Contact[];
  onCreateResource: (name: string, email: string) => number;
```
Add imports: `import type { Resource } from "./types";` (extend the existing `./types` import) and `import type { Contact } from "./contacts";`. Add `ResourcePicker`: `import { ResourcePicker } from "./resource-picker";`. Destructure `resources, contacts, onCreateResource` in the component signature (after `stakeholders`).

- [ ] **Step 4: Swap the owner input for ResourcePicker**

In `raid-edit-modal.tsx`, replace the owner `<input>` (the one bound to `draft.owner`, inside the `raidOwner` label) with:
```tsx
            <ResourcePicker
              lang={lang}
              value={{ name: draft.owner ?? "", email: draft.ownerEmail ?? "", resourceId: draft.ownerResourceId }}
              resources={resources}
              contacts={contacts}
              onCreateResource={onCreateResource}
              onChange={(next) =>
                onChange({
                  ...draft,
                  owner: next.name || undefined,
                  ownerEmail: next.email || undefined,
                  ownerResourceId: next.resourceId,
                })
              }
              maxLength={ASSIGNEE_MAX}
              title={t(lang, "raidFieldOwnerHint")}
              aria-describedby="raid-owner-counter"
            />
```
Keep the surrounding `<label>` + `<span>` + the `CharCounter` for owner, and keep the separate `ownerEmail` input unchanged (email stays editable).

- [ ] **Step 5: Forward the three props through `raid-panel.tsx`**

In `src/app/raid-panel.tsx`: add to `RaidPanelProps`:
```ts
  resources: readonly Resource[];
  contacts: Contact[];
  onCreateResource: (name: string, email: string) => number;
```
Add `Resource` to the `./types` import and `import type { Contact } from "./contacts";`. Destructure `resources, contacts, onCreateResource` in `RaidPanelInner`'s params. Pass them to `<RaidEditModal>` (where `stakeholders={stakeholders}` is passed):
```tsx
          resources={resources}
          contacts={contacts}
          onCreateResource={onCreateResource}
```

- [ ] **Step 6: Forward through `workspace-section.tsx`**

In `src/app/workspace-section.tsx`: `resources` is already available via `useWorkspace()` (line ~233). Add `contactsList` and `onCreateResource` to `WorkspaceSectionProps`:
```ts
  contactsList: Contact[];
  onCreateResource: (name: string, email: string) => number;
```
Add `import type { Contact } from "./contacts";`. Destructure them in the component params. Pass to `<RaidPanel>` (where `onSave={handleSaveRaidItem}` is):
```tsx
            resources={resources}
            contacts={contactsList}
            onCreateResource={onCreateResource}
```

- [ ] **Step 7: Provide the two new props from `task-manager.tsx`**

In `src/app/task-manager.tsx`, find `workspaceProps` (the object spread into `<WorkspaceSection {...workspaceProps} />`, ~line 1051). Add:
```ts
    contactsList,
    onCreateResource: handleCreateResource,
```
`contactsList` and `handleCreateResource` are already in scope in `task-manager` (from `useContacts` and the SP1 `handleCreateResource`).

- [ ] **Step 8: Run the test + typecheck + lint**

Run: `npx vitest run <that test file>` (PASS), `npx tsc --noEmit` (0), `npm run lint` (0). If tsc errors in raid-panel/workspace-section tests (fixtures lacking the new required props), add `resources={[]}`/`contacts={[]}`/`onCreateResource={vi.fn(() => 1)}` (or object equivalents) to those fixtures.

- [ ] **Step 9: Commit**

```bash
git add src/app/raid-edit-modal.tsx src/app/raid-panel.tsx src/app/workspace-section.tsx src/app/task-manager.tsx <test + any fixtures>
git commit -m "feat: RAID owner field uses ResourcePicker"
```

---

## Task 3: Shift assignee → ResourcePicker

**Files:**
- Modify: `src/app/shift-edit-modal.tsx` (swap AssigneeField for ResourcePicker; add props)
- Modify: `src/app/app-modals.tsx` (forward the three props it already holds)
- Test: the shift-edit-modal test (find it; add an integration test)

- [ ] **Step 1: Write the failing test**

Add to the shift editor's test file: rendering the shift modal with a `resources` list, focusing the assignee field, and picking a resource sets the draft's `resourceId`; the onSave payload carries `resourceId`. Model on the file's harness. Required assertion:

```tsx
it("links a shift assignee to a resource via the picker", () => {
  // render ShiftEditModal with resources=[Alex Example id 1]; open, pick "Alex Example"
  // submit; assert the saved Shift carries resourceId === 1
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run <shift test file>` → FAIL.

- [ ] **Step 3: Add props to `ShiftEditModalProps` + signature**

In `src/app/shift-edit-modal.tsx`, add to its props interface:
```ts
  resources: readonly Resource[];
  contacts: Contact[];
  onCreateResource: (name: string, email: string) => number;
```
Add imports: `import type { Resource } from "./types";` (extend existing), `import type { Contact } from "./contacts";`, `import { ResourcePicker } from "./resource-picker";`. Destructure the three in the signature.

- [ ] **Step 4: Swap `<AssigneeField>` for `<ResourcePicker>`**

Replace the `<AssigneeField ... />` element (the one with `assignee={draft.assignee}` / `onAssigneeChange` / `onEmailChange`) with:
```tsx
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">{t(lang, "shiftAssignee")}</span>
            <ResourcePicker
              lang={lang}
              value={{ name: draft.assignee, email: draft.assigneeEmail ?? "", resourceId: draft.resourceId }}
              resources={resources}
              contacts={contacts}
              onCreateResource={onCreateResource}
              onChange={(next) =>
                setDraft((d) => (d ? { ...d, assignee: next.name, assigneeEmail: next.email || undefined, resourceId: next.resourceId } : d))
              }
              placeholder={t(lang, "shiftPlaceholderAssignee")}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">{t(lang, "shiftAssigneeEmail")}</span>
            <input
              type="email"
              value={draft.assigneeEmail ?? ""}
              onChange={(e) => update("assigneeEmail", e.target.value || undefined)}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>
```
This preserves the assignee + a separate editable email input (the email was previously inside `AssigneeField`; it now lives as its own input, matching RAID/task). Do NOT remove `AssigneeField` itself — it stays for `absence-edit-modal.tsx` and `modal-edit-fields.tsx`. Remove the now-unused `AssigneeField` import and `DATALIST_ID`/`knownAssignees` props from THIS file only if they become unused (check: `knownAssignees` may still feed duplicate-validation — if so keep it; only drop the `AssigneeField` import if nothing else references it here).

- [ ] **Step 5: Forward the props from `app-modals.tsx`**

In `src/app/app-modals.tsx`, at the `<ShiftEditModal ... />` render (~line 200), add:
```tsx
          resources={resources}
          contacts={contactsList}
          onCreateResource={onCreateResource}
```
(`resources`, `contactsList`, `onCreateResource` are already props/values in `app-modals` from SP1.)

- [ ] **Step 6: Run + typecheck + lint**

Run: `npx vitest run <shift test file>` (PASS), `npx tsc --noEmit` (0), `npm run lint` (0). Fix any shift/app-modals test fixtures now needing the three props.

- [ ] **Step 7: Commit**

```bash
git add src/app/shift-edit-modal.tsx src/app/app-modals.tsx <test + fixtures>
git commit -m "feat: shift assignee field uses ResourcePicker"
```

---

## Task 4: Stakeholder name → link-only ResourcePicker

**Files:**
- Modify: `src/app/stakeholder-edit-modal.tsx` (swap name input + resource select for a link-only picker)
- Test: the stakeholder editor test (find it; add an integration test)

- [ ] **Step 1: Write the failing test**

Add to the stakeholder editor test: picking a resource in the name field sets `name` + `resourceId`; typing a free name leaves `resourceId` unset (external) and keeps the name; NO "+ Add as resource" row appears. Required assertions (model on the file's harness — the modal is controlled via `onChange`):

```tsx
it("links a stakeholder to a resource via the name picker", () => {
  // render StakeholderEditModal with resources=[Alex Example id 1] and a spy onChange
  // focus the name field, click "Alex Example"
  // assert onChange called with name="Alex Example" AND resourceId=1
});
it("keeps a stakeholder external (no resourceId, no + Add) when typing a free name", () => {
  // type "External Person"; assert no "+ Add" row; assert onChange leaves resourceId null/undefined
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run <stakeholder test file>` → FAIL.

- [ ] **Step 3: Add the import + swap the name input for a link-only ResourcePicker**

In `src/app/stakeholder-edit-modal.tsx`, add `import { ResourcePicker } from "./resource-picker";`. Replace the name `<input>` (bound to `draft.name`, in the `stakeholderFieldName` label) with:
```tsx
            <ResourcePicker
              lang={lang}
              value={{ name: draft.name, email: draft.email ?? "", resourceId: draft.resourceId }}
              resources={resources}
              contacts={[]}
              onChange={(next) =>
                onChange({ ...draft, name: next.name, resourceId: next.resourceId })
              }
              maxLength={BUDGET_NAME_MAX}
              aria-required
              aria-describedby="stakeholder-name-counter"
            />
```
(No `onCreateResource` → link-only, no "+ Add" row. `contacts={[]}` → registry-or-external only. The picker writes `name`, so the required-name validation `saveDisabled = !draft.name.trim()` still works.) Keep the name `CharCounter` and the `*` required marker in the label.

- [ ] **Step 4: Remove the now-redundant resource `<select>`**

Delete the entire `<label>` block containing the resource `<select>` (the one with `value={draft.resourceId ?? ""}`, the `stakeholderFieldResource` label, and the `stakeholderResourceNone` option) — the link is now set by the name picker. After deletion, grep `stakeholderResourceNone` and `stakeholderFieldResource`: if now referenced only in i18n.ts/i18n.de.ts, leave the keys (orphaned i18n is harmless; SP4 cleanup) and REPORT them as orphaned. `resourceDisplayName` may become an unused import in this file — remove it if so.

- [ ] **Step 5: Run + typecheck + lint**

Run: `npx vitest run <stakeholder test file>` (PASS), `npx tsc --noEmit` (0), `npm run lint` (0). Fix any stakeholder test fixtures.

- [ ] **Step 6: Commit**

```bash
git add src/app/stakeholder-edit-modal.tsx <test>
git commit -m "feat: stakeholder name field uses link-only ResourcePicker"
```

---

## Task 5: Release 0.63.0 + final gates

**Files:** `package.json`, `src/app/version.ts`, `CHANGELOG.md`

- [ ] **Step 1: Version bump**

`package.json`: `0.62.0` → `0.63.0`. `src/app/version.ts`: `APP_VERSION = "0.63.0"`, update `APP_BUILD_DATE` comment, set `APP_MILESTONE = "Bujold"` (Lois McMaster Bujold — fresh codename for the 0.63.x line), update the codename JSDoc to say the 0.63.x line is "Bujold".

- [ ] **Step 2: CHANGELOG entry**

Prepend above `## [0.62.0]`:
```markdown
## [0.63.0] - <today YYYY-MM-DD> "Bujold"

Resource-aware people pickers across RAID, shifts, and stakeholders (identity normalization SP2).

### Added
- The RAID owner and shift assignee fields are now resource-aware autocompletes (registry-first, contacts fallback, "+ Add as resource"), linking to a Resource via `ownerResourceId` / `resourceId`.
- The stakeholder name field is a resource-aware typeahead that links to a Resource or leaves the stakeholder external — replacing the separate link-to-resource dropdown. External stakeholders (no link) remain a first-class state.

### Changed
- `ResourcePicker` gains an optional `onCreateResource`; omitting it yields the link-only variant used by stakeholders.
```

- [ ] **Step 3: Full gates + build**

Run: `npm run lint` (0), `npx tsc --noEmit` (0), `npx vitest run` (full suite green — report counts), `npm run build` (succeeds). Confirm `src/app/golden-workspace.test.ts` passes (no serializer touched).

- [ ] **Step 4: Commit**

```bash
git add package.json src/app/version.ts CHANGELOG.md
git commit -m "chore: release 0.63.0 \"Bujold\" — resource pickers on RAID/shift/stakeholder (SP2)"
```

---

## Final verification (whole branch)

- [ ] `npx tsc --noEmit` clean; `npm run lint` clean; full `npx vitest run` green; `npm run build` succeeds; golden fixtures unchanged.
- [ ] Manual: link a person in each editor (RAID owner, shift, stakeholder) → linked indicator shows, FK set; stakeholder free-text name → external, no "+ Add" offered; "+ Add" works in RAID/shift.

## Notes / landmines

- i18n.de.ts curly-quote vigilance if any de keys are touched (none expected in SP2).
- AIPM palette only (the picker already conforms).
- `AssigneeField` is SHARED — do not delete it; only swap shift's usage.
- All three FKs are `number | null` — no null→undefined coalesce (unlike SP1).
- Out of scope: absence field (not in SP2), SP3 rollups, SP4 contacts retirement, email-read-only-when-linked.
