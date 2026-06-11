# Resource Picker (SP1) — Design

**Date:** 2026-06-11 · **Status:** Approved, ready for implementation plan
**Branch:** `feat-resource-picker` · **Target version:** 0.62.0 (new minor — adds a UI capability)

## Context

The v0.61.0 "Robinson" release added the data layer for person-identity
normalization: `RaidItem.ownerResourceId`, `Shift.resourceId` (joining their
denormalized owner/assignee to the Resource registry), plus a `migrateWorkspaceV9`
email-backfill. Those foreign keys are populated only by the backfill — **no UI
input sets them**. Today:

- Task assignee uses `ContactInput`, an autocomplete fed by the **contacts
  address book** (a separate `localStorage` store, `contacts.ts`), not the
  Resource registry. It sets `assignee`/`assigneeEmail` but never `resourceId`.
- RAID owner is a plain free-text `<input>` (owner + ownerEmail), no suggestions.
- Shift assignee, stakeholder name: same loose free-text pattern.

So two parallel "address books" exist — the contacts store and the Resource
registry — and the registry is not the source any input draws from.

This is **SP1** of a four-part decomposition of "make the Resource registry the
single source for people":

- **SP1 (this spec):** a reusable resource-aware picker component + migrate the
  task-assignee surface to it.
- **SP2:** wire the picker into RAID owner, shift assignee, stakeholder.
- **SP3:** per-owner / per-resource rollups (RAID-owned counts in the workload view).
- **SP4:** convergence — retire/merge the contacts store, re-point Jira/Outlook
  seeding at resource creation. (Highest risk; last.)

## Decisions (from brainstorming)

1. **Source model — Augment:** suggestions show Resource-registry people first
   (picking sets the FK), then remembered contacts below (picking sets name+email
   only, FK stays null). Both coexist; the registry becomes primary but typing a
   not-yet-a-resource name still works and is remembered via contacts.
2. **Inline create:** when a typed name matches no resource, the picker offers
   "+ Add ‘<name>’ as resource", creating a minimal Resource and linking it.
3. **Display authority:** a linked value (FK set) displays the resource's
   *current* name/email; the stored name/email strings are a refreshed-on-link
   cache kept only for export/offline round-trips. Fixing a person once on the
   resource then propagates everywhere — the point of the FK.
4. **Component strategy — Approach A:** a new presentational `ResourcePicker`
   that emits intent; each surface owns the workspace writes. (vs. extending
   `ContactInput` in place, or wrapping it.)

## Component contract

`src/app/resource-picker.tsx`:

```ts
interface ResourcePickerValue {
  name: string;
  email: string;
  resourceId: number | null | undefined;
}

interface ResourcePickerProps {
  value: ResourcePickerValue;
  resources: readonly Resource[];
  contacts: Contact[];
  /** Emitted on pick-resource / pick-contact / free-text. The component
   *  computes the next value; the parent maps it onto its own fields. */
  onChange: (next: { name: string; email: string; resourceId: number | null }) => void;
  /** Create a minimal resource from a typed name+email, return its new id.
   *  The parent owns the actual setResources mutation. */
  onCreateResource: (name: string, email: string) => number;
  lang: Lang;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  // a11y: id / aria-describedby passthrough as ContactInput has today
}
```

The generic `{name, email, resourceId}` shape is what each SP2 surface maps onto
its specific fields (task `assignee/assigneeEmail/resourceId`, RAID
`owner/ownerEmail/ownerResourceId`, shift `assignee/assigneeEmail/resourceId`,
stakeholder `name/email/resourceId`).

## Behavior & UX

One text input + a sectioned autocomplete popover:

- **Resources** section first: registry people whose display name or email
  substring-matches the query, each with a small "linked" marker.
- **Recent** section below: contacts-store matches (the augment fallback).
- **"+ Add ‘<query>’ as resource"** trailing row, shown when the trimmed query
  is non-empty and matches no resource exactly.

All styling (section headers, the "linked" marker, the add row) must use the
existing AIPM palette tokens in `globals.css` — green-dominant, no gradients or
shadows, no off-palette colors — consistent with the rest of the UI.

Interactions:

| Action | Result |
|---|---|
| Pick a resource | `onChange({ name: resourceDisplayName(r), email: r.email ?? "", resourceId: r.id })`; input shows the linked indicator |
| Pick a contact | `onChange({ name, email, resourceId: null })` |
| Type + blur, no pick | free text, `resourceId: null` (today's behavior preserved) |
| "+ Add as resource" | `id = onCreateResource(name, email)` → `onChange({ name, email, resourceId: id })` |

- **Email carries with the value** exactly as `ContactInput` does today: a pick
  sets it, free-text leaves it as-is. SP1 introduces **no change** to how task
  assignee email is entered. The "email becomes read-only when linked" treatment
  applies only to SP2 surfaces that render a *separate* email input (e.g. RAID
  owner's `ownerEmail` field) — not to SP1.
- **Display authority:** if `value.resourceId` is set and a matching resource
  exists, render that resource's current name/email. If the FK is **dangling**
  (resource deleted — the no-cascade case), fall back to the cached
  `value.name` and show a subtle "link broken" affordance (e.g., a muted unlink
  control to clear the FK). Never crash. (`buildResourceWorkload` already treats
  a dangling resourceId + unknown name as unlinked — consistent.)

## Data flow

The component is presentational. It reads `resources` + `contacts` and emits
`onChange` / `onCreateResource`; it performs no workspace mutation itself.

The parent (the task form, in SP1) owns the writes:

- `onChange` → set the surface's three fields from the emitted value.
- `onCreateResource(name, email)` → split the name (`splitName`), build a Resource
  via the existing `sanitizeResource` + `nextId(resources)`, append through
  `setResources` (from `workspace-context`), and return the new id. **Reuse the
  exact minimal-resource defaults the Resources view's existing "add resource"
  flow already uses** (firstName/lastName/email, `roleId: null`, default
  utilization) — do not invent new defaults.

The contacts store is **unchanged** in SP1 — still seeded and used as the
fallback source. Its retirement is SP4.

## Proving integration: task-assignee migration

`task-form-fields.tsx` migrates the assignee field from `ContactInput` to
`ResourcePicker`. `Task.resourceId` already exists, so picking a resource now
sets it; "+ Add as resource" creates one. The task form supplies `resources` +
the `onCreateResource` writer (via workspace-context) and `contacts` (as today).

`ContactInput` is the task-assignee field's only consumer, so it is removed once
migrated. Its popover/keyboard-navigation internals (arrow keys, escape, click-
outside, the suggestion-row rendering) are lifted into `ResourcePicker` rather
than rewritten — preserving the existing keyboard UX.

## Testing

Component unit tests (`resource-picker.test.tsx`):

- Resource matches render before contact matches for the same query.
- Picking a resource emits `onChange` with that `resourceId` and the resource's
  name/email.
- Picking a contact emits `onChange` with `resourceId: null`.
- Typing + blur with no selection emits free text, `resourceId: null`.
- "+ Add as resource" calls `onCreateResource` with the typed name/email, then
  emits `onChange` linked to the returned id.
- **Authority:** a value with `resourceId` pointing at a resource whose name
  differs from `value.name` renders the *resource's* current name.
- **Dangling FK:** `resourceId` with no matching resource falls back to
  `value.name` and renders the link-broken affordance without throwing.
- `disabled` suppresses the popover and create row.

Integration (extend `task-form` tests): picking a resource sets `task.resourceId`;
"+ Add as resource" appends a resource and links the task to it.

## Out of scope (SP1)

- RAID owner / shift assignee / stakeholder wiring → **SP2**.
- Per-owner / per-resource rollups → **SP3**.
- Retiring the contacts store; re-pointing Jira/Outlook seeding at resource
  creation → **SP4**.
- No schema change (the FKs already exist as of 0.61.0). No Turso column change,
  so none of the 0.61.0 Turso-migration limitation applies here.

## Verification

`npx tsc --noEmit`, `npm run lint` (--max-warnings=0), full `npx vitest run`,
`npm run build`, golden-workspace fixtures unchanged (this slice touches no
serializer). Manual: in the task form, type a known resource → pick it → confirm
the linked indicator and that the email follows the resource; type a new name →
"+ Add as resource" → confirm it appears in the Resources view linked to the task.
