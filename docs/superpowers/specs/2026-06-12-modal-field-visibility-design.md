# Modal Field-Visibility Framework — Design Spec

> **Status:** Approved (brainstorming complete, 2026-06-12). Sub-project #1 of 4.
> **Storage note:** `docs/superpowers/` is gitignored — this spec lives locally, not committed.

## Context — the 4-part feature

The user wants project/task **templates** that spin up recurring project structures fast and
pre-configure the app's mode/functions, plus per-modal **Simple/Advanced/Full** field views with a
**cog** for per-field overrides, with templates seeding the defaults, selectable (and suggested) at
project creation. This decomposes into four independently-shippable sub-projects, built in order:

1. **Modal field-visibility framework** *(this spec)* — the Simple/Advanced/Full view switch + cog
   on each edit modal, and the per-project config schema everything else stores.
2. **Templates entity** — a Template carrying the per-modal field-visibility config, the
   feature-module/mode preset, and **optionally seeded recurring content** (user's choice at apply
   time). CRUD + storage.
3. **Creation wiring** — pick a template **and** configure functions (mode) during project creation,
   applying both axes to the new project.
4. **Template suggestion engine** — recommend a template from size / complexity / persons-involved /
   other available data points.

Sub-projects #2–#4 get their own spec → plan → build cycles. This spec covers **#1 only**, but is
designed so #2 can store its field-visibility payload in exactly the schema defined here.

---

## Goal

Give every entity edit modal a **Simple / Advanced / Full** view switcher plus a **cog** for
per-field show/hide, with the resulting configuration persisted **per project** and seeded (later)
by templates. Out of the box, with no template, every modal opens in **Advanced**.

## Two distinct axes (terminology)

The app already has an app-level **mode** (Simple/Modular/Advanced *feature modules* — which
nav/functions are visible; `feature-modules.ts`, `Settings.features`). This sub-project introduces a
**separate, parallel axis**: the **field view** within a single editor (which *fields* show). They
do not share state. A template (#2) will set a choice on both axes; this spec only touches the field
axis.

---

## Architecture

### 1. Field registry — single source of truth

New file `src/app/modal-fields.ts`:

```ts
export type FieldTier = "simple" | "advanced" | "full";

export interface ModalField {
  id: string;                 // stable id, unique within a modal
  labelKey: TranslationKey;   // reuse the field's existing label key where possible
  tier: FieldTier;            // lowest tier in which this field appears (nested upward)
  required?: boolean;         // validated/mandatory → always shown, locked in the cog
}

export type ModalId =
  | "task" | "raid" | "change" | "milestone"
  | "stakeholder" | "resource" | "absence" | "budget";

export const MODAL_FIELDS: Record<ModalId, readonly ModalField[]>;
```

- `tier` encodes nesting: a field with `tier:"advanced"` is visible in **Advanced** and **Full**,
  hidden in **Simple**. Invariant tested: every `required` field has `tier:"simple"`.
- The approved baselines (below) populate this table verbatim.

### 2. Stored config — a singleton on the Workspace

The persisted state per modal is the **explicit set of visible field ids**. The displayed tier
(Simple/Advanced/Full/Custom) is always *derived* from that set, never stored — this avoids an
ambiguity where `{mode, hidden}` cannot represent *showing* a higher-tier field while in a lower
tier (e.g. cog-enabling one Advanced field from Simple).

```ts
export interface ModalVisibility {
  fields: readonly string[];   // explicit visible field ids; always includes every required field
}
export interface FieldVisibilityConfig {
  [modalId: string]: ModalVisibility;
}
// workspace.ts: Workspace.fieldVisibility?: Readonly<FieldVisibilityConfig>;
```

- **Per project.** Each loaded Workspace is one project, so this lives on the Workspace as an
  optional singleton (mirrors `plan` / `status` / `fxRates`).
- **`undefined` (legacy / no template) ⇒ Advanced everywhere** via the resolver's fallback. No
  migration writes a value; absence is the default.
- Serialized as **one JSON block**, kept **out of `turso-schema.ts` TABLE_NAMES** (it is not a
  relational collection), using the established JSON-in-cell / singleton-block codec pattern so it
  round-trips across CSV / Markdown / JSON / Turso and travels with export/import.
- **Byte-stability:** when `fieldVisibility` is `undefined`, codecs emit nothing (no empty block),
  preserving existing fixtures.

### 3. Resolver — pure logic

New file `src/app/field-visibility.ts`:

```ts
// The field ids belonging to a tier (nested: simple ⊂ advanced ⊂ full).
export function tierFields(modalId: ModalId, tier: FieldTier): string[];
// Fields visible for a modal given its config (or undefined → Advanced default), as a Set,
// intersected with the known registry ids (drops stale stored ids).
export function visibleFields(modalId: ModalId, cfg?: ModalVisibility): Set<string>;
// Build the config for a tier baseline (fields = that tier's ids).
export function applyTier(modalId: ModalId, tier: FieldTier): ModalVisibility;
// Toggle one field in/out of the visible set; required fields are no-ops.
export function toggleField(modalId: ModalId, cfg: ModalVisibility, fieldId: string): ModalVisibility;
// Derive the segmented-control label by matching the visible set against each named tier.
export function tierOf(modalId: ModalId, cfg?: ModalVisibility): FieldTier | "custom";
```

- Resolution order: built-in tier defaults (Advanced when `cfg` is `undefined`) → stored project
  `fields` set → live cog toggles, all collapsing to one visible-field `Set`.
- `tierOf` returns the tier whose id-set equals the config's, else `"custom"`.
- A field id absent from `MODAL_FIELDS[modalId]` is ignored (defensive against stale stored ids).

### 4. Interaction model

- **Segmented control** (Simple | Advanced | Full) in the modal header → `applyTier`: sets `fields`
  to that tier's id-set → clean baseline. The active segment is highlighted via `tierOf`.
- **Cog ⚙** opens a checklist of *all* fields for that modal. `required` fields render
  checked-and-disabled. Toggling a non-required field → `toggleField`; if the resulting set no
  longer equals a named tier, `tierOf` returns `"custom"` and the segmented control shows an implicit
  **"Custom"** state.
- **"Reset to template default"** in the cog → restores the template-seeded config (built-in
  Advanced until #2 ships). For #1 this is "Reset to Advanced."
- **Sticky per project:** every change persists to `Workspace.fieldVisibility[modalId]` immediately
  through the existing context setters → existing dirty-table autosave.

### 5. Wiring into modals (low churn)

- Shared hook `useModalVisibility(modalId)` → `{ isVisible(fieldId), mode, setMode, toggleField,
  reset }`, reading/writing the Workspace config via the WorkspaceProvider setter.
- Shared component `<ModalFieldControls modalId=… />` = the segmented control + cog popover; drops
  into each modal header next to the existing title.
- Each editor guards its field rows: `isVisible("priority") && (<PriorityField/>)`.
- **Task first:** the modal (`task-form-modal.tsx`) and the full-page `TaskEditView` both render
  `task-form-fields.tsx`, so one set of guards covers both. Then RAID, Change, Milestone,
  Stakeholder, Resource, Absence, Budget.
- Hidden fields keep their data: guards hide the *input*, never clear the value on save.

---

## Approved field baselines

Required fields marked `●`. Tiers nest (Simple ⊂ Advanced ⊂ Full).

### Task (`task`)
- **Simple:** Task name ●, Assignee, Due date, Status, Notes
- **+Advanced:** Priority, Start date, Original estimate, Group/Labels, Dependencies, Blockers,
  Health indicator
- **+Full:** Manual email, Time spent, Last-update date, Completed date, Jira link, Health override

### RAID (`raid`)
- **Simple:** Title ●, Category (R/A/I/D), Status, Owner, Description
- **+Advanced:** Probability/Impact/Severity, Mitigation, Target date, Linked tasks
- **+Full:** Risk matrix, Raised date, Linked RAID, Linked stakeholders

### Change (`change`)
- **Simple:** Title ●, Type, Status, Description
- **+Advanced:** Impact + Impact description, Requestor, Cost/Schedule delta, Decision date
- **+Full:** Linked tasks / RAID / stakeholders

### Milestone (`milestone`)
- **Simple:** Name ●, Target date
- **+Advanced:** Description, Achieved date, Linked tasks
- **+Full:** Document links

### Stakeholder (`stakeholder`)
- **Simple:** Name ●, Organization, Category
- **+Advanced:** Title/Email, Influence/Interest, Resource link
- **+Full:** Notes, RACI map

### Resource (`resource`)
- **Simple:** Name ●, Email, Role
- **+Advanced:** Title/Grade/Discipline, Utilization allocation
- **+Full:** Birthday, Document links

### Absence (`absence`)
- **Simple:** Resource ●, Start/End date
- **+Advanced:** Reason, Cover
- **+Full:** Cover email, Notes

### Budget bucket (`budget`)
- **Simple:** Name ●, Funding amount/Currency
- **+Advanced:** Period start/end, Burn rate
- **+Full:** Planning flags / detail

> Where a row groups several fields (e.g. "Probability/Impact/Severity"), each underlying input gets
> its own `ModalField` id at the same tier during planning.

---

## Components & files

| File | Responsibility |
|------|----------------|
| `modal-fields.ts` *(new)* | The `MODAL_FIELDS` registry + types. |
| `field-visibility.ts` *(new)* | Pure resolver (`visibleFields`/`applyTier`/`toggleField`/`tierOf`). |
| `use-modal-visibility.ts` *(new)* | Hook bridging resolver ↔ Workspace config + setters. |
| `modal-field-controls.tsx` *(new)* | Segmented control + cog popover UI. |
| `workspace.ts` | Add optional `fieldVisibility` field + default-on-load (`undefined`). |
| `csv-codecs.ts` / `markdown-codecs.ts` | Singleton JSON-block codec (emit nothing when undefined). |
| `turso-schema.ts` / Turso backend | Persist the singleton block; **stay out of TABLE_NAMES**. |
| `i18n.ts` / `i18n.de.ts` | Keys: tier labels, "Custom", "Configure fields", "Reset to default". |
| The 8 edit modals + `task-form-fields.tsx` | Add `<ModalFieldControls>` + `isVisible()` guards. |

## Error handling & edge cases

- Unknown stored field ids ignored by the resolver (no crash on schema drift).
- Required field can never be hidden (cog disables it; `toggleField` no-ops).
- Switching tier replaces `fields` with that tier's id-set, discarding prior custom toggles
  (predictable clean baseline).
- Empty/legacy config ⇒ Advanced; never throws.

## Testing

- **Unit:** `modal-fields` invariants (nesting, required⊂simple, unique ids per modal);
  `field-visibility` resolver (tier→set, toggle→custom/snap-back, reset, unknown-id tolerance).
- **Codec:** round-trip across all four backends; `undefined` ⇒ byte-identical to today (golden
  fixtures unchanged).
- **Component:** segmented switch shows/hides rows; required can't hide; cog toggle → Custom badge;
  reset restores Advanced; data survives hide→save.

## Out of scope (later sub-projects)

- Template entity / CRUD / seeded content (#2).
- Project-creation template picker + function/mode config (#3).
- Template suggestion heuristic (#4).
