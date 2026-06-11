# Resource Picker SP2 — Design

**Date:** 2026-06-11 · **Status:** Approved, ready for implementation plan
**Branch:** `feat-resource-picker-sp2` · **Target version:** 0.63.0 (new minor — UI capability)
**Predecessor:** SP1 (`ResourcePicker`, v0.62.0 "Liu"); see `2026-06-11-resource-picker-design.md`.

## Context

SP1 built `ResourcePicker` (a resource-aware autocomplete) and wired it into the
task-assignee field. SP2 extends it to the three remaining person surfaces whose
FKs shipped in v0.61.0:

- **RAID owner** (`raid-edit-modal.tsx`) — today plain `owner` + `ownerEmail`
  text inputs, no resource awareness. FK: `RaidItem.ownerResourceId`. Workforce.
- **Shift assignee** (`shift-edit-modal.tsx`) — today a datalist autocomplete
  (a shared labeled name+email sub-component). FK: `Shift.resourceId`. Workforce.
- **Stakeholder** (`stakeholder-edit-modal.tsx`) — today a free-text `name` input
  PLUS an explicit "link to resource" `<select>` dropdown (None + resource list)
  that sets `Stakeholder.resourceId`. The model comment states `resourceId` is
  "null/absent for purely-external stakeholders" — external-with-no-link is a
  first-class, intended state here.

This is SP2 of the four-part decomposition (SP1 picker ✅ / SP2 these three /
SP3 rollups / SP4 contacts retirement).

## Decisions (from brainstorming)

1. **Scope = all three, stakeholder gets a LINK-ONLY variant.** RAID owner and
   shift get the full augment picker (registry-first, contacts fallback,
   "+ Add as resource"). The stakeholder name field gets a `ResourcePicker`
   WITHOUT the create affordance — a typeahead that links to a resource or
   leaves the stakeholder external (resourceId undefined). It replaces the
   current `<select>` dropdown.
2. **No new component / no `allowCreate` flag.** Make `ResourcePicker`'s
   `onCreateResource` prop **optional**; when omitted, the "+ Add as resource"
   row does not render. The link-only variant falls out of that single change.
3. **Email stays editable when linked** on all surfaces (matches SP1's task
   assignee — email is carried by the picker value, the separate email input
   remains free-edit). The "email becomes read-only when linked" idea is
   explicitly NOT done.
4. **Reuse SP1's write path.** RAID/shift "+ Add" reuse the existing
   `handleCreateResource` in `task-manager.tsx` (already stamps `localModifiedAt`
   and logs `resource.created`). No new resource-creation logic.

## Component change

`src/app/resource-picker.tsx`:

- Change `onCreateResource: (name, email) => number` → `onCreateResource?: (name, email) => number`.
- The "+ Add as resource" row renders only when `onCreateResource` is provided
  AND the existing conditions hold (non-empty trimmed query, no exact resource
  match). When `onCreateResource` is undefined, the row is never built, and the
  `choose()` add-branch is unreachable.
- No other behavior changes. All SP1 tests stay green; add a test that with
  `onCreateResource` omitted, no "+ Add" row appears even for an unmatched query.

## Per-surface design

### RAID owner — `raid-edit-modal.tsx`
- Replace the `owner` text input with `<ResourcePicker>`:
  `value={{ name: draft.owner ?? "", email: draft.ownerEmail ?? "", resourceId: draft.ownerResourceId }}`,
  `onChange` → `onChange({ ...draft, owner: next.name || undefined, ownerEmail: next.email || undefined, ownerResourceId: next.resourceId })`.
- Pass `resources`, `contacts` (the global address book), and `onCreateResource`.
- Keep the separate `ownerEmail` input, its `CharCounter`, and any owner
  `CharCounter`/validation. Email stays editable.
- **Threading:** `RaidEditModalProps` gains `resources: readonly Resource[]`,
  `contacts: Contact[]`, `onCreateResource: (name,email)=>number`. `raid-panel.tsx`
  (which renders `RaidEditModal`) gains the same props and forwards them; its
  parent provides them (the same `resources`/`contactsList`/`handleCreateResource`
  task-manager already exposes for the task form).

### Shift assignee — `shift-edit-modal.tsx`
- Replace the datalist-based assignee sub-component (the labeled
  name+email/`onAssigneeChange`/`onEmailChange` block) with `<ResourcePicker>`:
  `value={{ name: draft.assignee, email: draft.assigneeEmail ?? "", resourceId: draft.resourceId }}`,
  `onChange` → `update`s `assignee`/`assigneeEmail`/`resourceId` together.
- Pass `resources`, `contacts`, `onCreateResource`. Keep the shift labels
  (`shiftAssignee`, `shiftAssigneeEmail`, placeholder). Keep the separate email
  input; email stays editable. Keep the existing duplicate-assignee validation.
- **Threading:** `ShiftEditModalProps` gains the three props; its parent
  (`app-modals.tsx`, which renders `ShiftEditModal`) forwards them.
- **Note for the plan:** check whether the replaced datalist sub-component is
  used by any other editor (e.g. absence) before removing it; if shared, leave
  it in place and only swap the shift usage.

### Stakeholder — `stakeholder-edit-modal.tsx` (LINK-ONLY)
- Replace the free-text `name` input AND the resource-link `<select>` with a
  single `<ResourcePicker>` (no `onCreateResource` → link-only):
  `value={{ name: draft.name, email: draft.email ?? "", resourceId: draft.resourceId }}`,
  `contacts={[]}` (no address-book fallback — stakeholders are registry-or-external).
- `onChange` → picking a resource sets `name` = resource display name and
  `resourceId` = id (links); typing free text sets `name` and `resourceId: null`
  (external). `Stakeholder.resourceId` is `number | null` (types.ts:279), which
  matches the picker's `onChange` emit exactly — **no coalesce needed** (unlike
  SP1's `Task.resourceId`, which is `number | undefined`). The same holds for
  `RaidItem.ownerResourceId` and `Shift.resourceId` (both `number | null`).
- The modal already receives `resources` — minimal new threading (only
  `onCreateResource` is intentionally NOT passed). Keep the separate stakeholder
  `email` input, the name `CharCounter`, and the required-name validation
  (`saveDisabled = !draft.name.trim()` still works — the picker writes `name`).
- Remove the now-dead `stakeholderResourceNone` select option usage; leave its
  i18n key (orphaned i18n is harmless; SP4/cleanup territory) — REPORT if orphaned.

## Data flow

Same as SP1: each picker is presentational and emits intent; the surface's
parent owns writes. `onChange` updates the entity draft's three fields;
`onCreateResource` (RAID/shift only) is the shared `task-manager.handleCreateResource`.
No schema change (FKs exist since 0.61.0), no serializer change (golden fixtures
unchanged), no Turso change.

## Testing

- **Component:** add a test that `onCreateResource` omitted → no "+ Add" row.
- **RAID owner:** picking a resource sets `ownerResourceId`; "+ Add" creates+links;
  free-text leaves `ownerResourceId` unset; the separate `ownerEmail` input still
  edits independently.
- **Shift:** picking a resource sets `resourceId`; "+ Add" creates+links; duplicate-
  assignee validation still fires; email edits independently.
- **Stakeholder:** picking a resource sets `name`+`resourceId` (link); typing free
  text leaves `resourceId` unset (external) and keeps the typed name; NO "+ Add"
  row appears; the linked display shows the resource's current name.
- Reuse each editor's existing test harness; full suite + golden + build green.

## Out of scope

- Per-owner / per-resource rollups → **SP3**.
- Retiring the contacts store / re-pointing Jira/Outlook seeding → **SP4**.
- Email-read-only-when-linked (deliberately not done — email stays editable).

## Verification

`npx tsc --noEmit`, `npm run lint` (--max-warnings=0), full `npx vitest run`,
`npm run build`, golden-workspace fixtures unchanged. Manual: in each editor,
link a person via the picker and confirm the FK is set (linked indicator); for
stakeholder, confirm typing a new external name leaves it unlinked with no
"+ Add" offered.
