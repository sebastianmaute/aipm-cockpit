# Resource-linked Project Contacts (SP4) — Design

**Date:** 2026-06-11 · **Status:** Approved, ready for implementation plan
**Branch:** `feat-contacts-retire-sp4` · **Target version:** 0.65.0 (new minor — schema + UI)
**Predecessors:** SP1 (0.62.0), SP2 (0.63.0), SP3 (0.64.0).

## Context

SP1–SP3 made people resource-linkable across tasks, RAID owners, shifts, and
stakeholders, and surfaced ownership in the workload view. The last person
surface is the **project metadata's contact persons** (`ProjectMeta.contactPersons`,
type `ContactPerson = { name, email, synced }`), edited by `ContactPersonsControl`
in `project-form-fields.tsx` (a chip-list with an "add from address book" select +
manual name/email inputs). It uses the contacts address book (`addressBook`), not
the Resource registry, and carries no resource FK.

**Scope decision (from brainstorming):** this is the original SP4 slot, but the
"retire the contacts store" sketch was reconsidered — the contacts store is wired
into the pickers' fallback AND the project forms, and retiring it would remove
working features. Instead, SP4 **extends the resource picker to project contacts
and adds a real FK** (`ContactPerson.resourceId`), normalizing the last surface.
The contacts store **stays** as the fallback layer; the import's contacts seeding
is left as-is.

## Decisions

1. **Add `resourceId?: number | null` to `ContactPerson`** — true normalization of
   the last surface (matching `Task`/`RaidItem`/`Shift`/`Stakeholder`).
2. **Link-only picker** — `ContactPersonsControl`'s add-input becomes a
   `ResourcePicker` WITHOUT `onCreateResource` (no "+ Add as resource") and with
   the contacts address book as the fallback. Project contacts are often external
   (clients, vendors), like stakeholders — picking a resource links, free text
   leaves the contact external (`resourceId: null`).
3. **Byte-stable encoding** — `resourceId` is appended to the encoded entry ONLY
   when set, so existing data is byte-identical and golden fixtures don't change.

## Design

### 1. Type — `src/app/types.ts`
`ContactPerson` gains `resourceId?: number | null;` (after `synced`). Keep the
`synced` semantics unchanged.

### 2. Sanitizer — `src/app/sanitize.ts`
`sanitizeContactPerson` returns `resourceId` via the existing
`fkIdOrUndefined(input.resourceId)` (the positive-int FK guard added in the
readonly-types work). `number | null` matches the picker's emit — no coalesce.

### 3. Encoding — `src/app/csv-codecs.ts`
`encodeContactPersons`: each entry is `name;email;synced`, and `;<resourceId>` is
appended ONLY when `resourceId` is a number (so an unlinked contact stays the
3-field `name;email;synced` — byte-identical to today). `decodeContactPersons`:
read an optional 4th sub-field; absent/empty → `resourceId` unset. The `\`/`;`/`|`
escaping is unchanged (resourceId is a bare integer, no escaping needed). This one
change covers CSV, Markdown (via `projectFieldToString` → the same encoder), and
the Turso `projects` row's `contactPersons` text column. JSON round-trips
automatically (`jsonToWorkspace` JSON-decodes ProjectMeta).

**Consequences (verified):**
- **Golden fixtures unchanged** — the sample project's contacts have no resource
  link, so their encoded bytes don't change.
- **No workspace schema bump** — old data (3-field) decodes with `resourceId`
  unset; new data (4-field) is a strict superset. Graceful, no migration.
- **No Turso DDL change** — `resourceId` lives inside the existing `contactPersons`
  text column, NOT a new column, so the 0.61-style Turso column-add write-break
  does not apply.

### 4. Editor — `src/app/project-form-fields.tsx` (`ContactPersonsControl`)
Replace the "add from address book" `<select>` + manual name/email inputs with a
single **link-only `ResourcePicker`** driving a local draft `{ name, email,
resourceId }`:
- `resources` (registry, suggested first) + `contacts={addressBook}` (fallback);
  NO `onCreateResource` → no "+ Add" row.
- Picking a resource sets the draft `name`/`email`/`resourceId`; typing free text
  leaves `resourceId: null`.
- An **Add** button commits the draft as a `ContactPerson` and resets the draft.
  `synced` follows the existing semantics: **true** when the draft was filled by
  picking a suggestion (a registry resource OR an address-book contact), **false**
  when the name was free-typed. (A linked resource implies `synced: true`.) Keep
  the existing "no duplicate name" guard.
- Existing chips show a small "linked" indicator (AIPM-green dot/icon) when
  `resourceId` is set, consistent with the picker's linked styling.

`ContactPersonsControl` gains a `resources: readonly Resource[]` prop.

### 5. Threading
The project forms (`create-project-form.tsx`, `project-form-fields.tsx`,
`project-empty-state.tsx`, and the edit `project-form.tsx`) gain a `resources`
prop, threaded from `task-manager` (which already has `resources`), passed
alongside the existing `addressBook`. `tsc` enforces all render sites.

## Testing
- `encodeContactPersons`/`decodeContactPersons` round-trip WITH `resourceId` (4
  fields) and WITHOUT (3 fields, byte-identical to pre-change output for the same
  input — assert the exact 3-field string for an unlinked contact).
- `sanitizeContactPerson` sets `resourceId` via `fkIdOrUndefined` (positive int
  kept; 0/negative/blank → unset).
- `ContactPersonsControl`: picking a resource adds a `ContactPerson` with that
  `resourceId` + the resource's name/email; typing a free name adds an external
  contact (`resourceId` unset); NO "+ Add as resource" row appears; the linked
  indicator shows for a linked chip.
- Golden-workspace fixtures stay green (no serializer byte change for existing
  unlinked data).

## Out of scope
- Retiring the contacts store / re-pointing the Outlook import's contacts seeding
  (the contacts store stays as the fallback).
- `keyStakeholdersInternal/External` (they autocomplete from the project's own
  stakeholder register — a separate, already-sensible source).
- Per-project-contact rollups / display-authority in the project table.

## Verification
`npx tsc --noEmit`, `npm run lint` (--max-warnings=0), full `npx vitest run`,
`npm run build`, golden-workspace fixtures unchanged. Manual: in a project's
contact-persons editor, link a registry person (picker shows the linked
indicator), add a free-text external contact (no "+ Add" offered), save and
reload — both round-trip; an unlinked contact's serialized form is unchanged.
