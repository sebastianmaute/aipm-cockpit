# Project/Task Templates — Design Spec

> **Status:** Approved (brainstorming complete, 2026-06-12). Sub-project #2 of 4.
> **Storage note:** `docs/superpowers/` is gitignored — this spec lives locally, not committed.

## Context — the 4-part feature

Templates that spin up recurring project structures fast and pre-set the app's mode/functions, with
per-modal field-visibility, template suggestion at creation, and function/mode config at creation.
Four sub-projects, built in order:

1. **Modal field-visibility framework** — SHIPPED v0.70.0 "Heinlein" (`Workspace.fieldVisibility`,
   `FieldVisibilityConfig`, the `applyTier`/`tierOf`/`visibleFields` resolver).
2. **Templates entity** *(this spec)* — the `ProjectTemplate` library, CRUD, save-as-template,
   apply-to-current, and the pure `applyTemplate` core reused by #3.
3. **Creation wiring** — pick a template + configure functions during project creation (decides the
   features-application model: per-project vs global).
4. **Template suggestion engine** — recommend a template from project parameters.

This spec covers **#2 only**.

## Goal

A cross-project library of reusable `ProjectTemplate`s — built-in starters plus user-created — that
bundle a feature-module preset, a field-visibility config (#1), and optional starter content. Users
can save the current project as a template, manage the library in Settings, and apply a template to
the current project. The pure `applyTemplate` function is the core #3 will reuse at creation.

---

## Architecture

### 1. The `ProjectTemplate` entity

New file `src/app/templates.ts`:

```ts
import type { FeatureModuleId } from "./feature-modules";
import type { FieldVisibilityConfig } from "./field-visibility";
import type { Task, Milestone, RaidItem, ChangeItem, Stakeholder, BudgetBucket } from "./types";

export interface TemplateSeed {
  tasks?: readonly Task[];
  milestones?: readonly Milestone[];
  raid?: readonly RaidItem[];
  changes?: readonly ChangeItem[];
  stakeholders?: readonly Stakeholder[];
  budgets?: readonly BudgetBucket[];
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description?: string;
  builtIn?: boolean;                       // true → read-only (Duplicate to edit)
  features: readonly FeatureModuleId[];    // mode/function preset; STORED here, APPLIED at creation (#3)
  fieldVisibility: FieldVisibilityConfig;  // per-modal config from sub-project #1
  seed?: TemplateSeed;                     // optional starter content (seedable collections only)
}
```

Seedable collections are the structural/skeleton content only: **tasks, milestones, raid, changes,
stakeholders, budgets**. Excluded: resources, absences, shifts (people/time-specific) and
config/reference (roles, grades, disciplines, plan, fxRates, status, project, fieldVisibility).

### 2. Storage

- **User templates** persist in a new optional `Settings.templates?: ProjectTemplate[]` field
  (`settings-types.ts`), riding the existing `writeSettings` → `localStorage["lop-app:settings"]`
  blob (app-global, cross-project, cross-backend — same as every other setting). `defaultSettings`
  sets `templates: []`. Sanitized on read in `use-settings.ts` via a new `sanitizeTemplates`.
- **Built-ins live in code** as a `BUILT_IN_TEMPLATES` constant in `templates-builtin.ts` — NOT
  persisted. The displayed library is `[...BUILT_IN_TEMPLATES, ...settings.templates]`. Keeps the
  blob lean and lets built-ins evolve per release.
- **No workspace-serializer changes** — templates never touch the CSV/MD/Turso/JSON workspace codecs,
  so there is no byte-stability surface here.

### 3. `sanitizeTemplates` — defensive boundary

`src/app/templates.ts`:

```ts
export function sanitizeTemplate(raw: unknown): ProjectTemplate | null;
export function sanitizeTemplates(raw: unknown): ProjectTemplate[]; // [] for junk/legacy/undefined
```

- Drops non-objects; requires `id` + `name` (string, non-empty); coerces `features` through the
  existing `sanitizeFeatures`; coerces `fieldVisibility` through the existing
  `sanitizeFieldVisibility`; sanitizes each seed collection through its existing entity sanitizer
  (`sanitizeTask`, `sanitizeMilestone`, etc.); forces `builtIn` to absent/false on user templates
  (a stored template can never masquerade as built-in).

### 4. Built-in starters — `templates-builtin.ts`

Three built-ins (`builtIn: true`), mapping to the app's Simple/Modular/Advanced mode tiers:

- **Minimal** — `features: []` (Simple mode), `fieldVisibility` = Simple tier for the common modals,
  `seed` = ~3 generic tasks ("Kickoff", "Plan", "Wrap-up").
- **Standard PM** — `features` = a curated modular subset (`["dashboard","gantt","milestones",
  "raid","changes"]`), `fieldVisibility` = Advanced (or omitted entries → Advanced default), `seed`
  = ~12 tasks across phases + 3 milestones.
- **Full delivery** — `features` = all module ids (`[...ALL_MODULE_IDS]`, Advanced mode),
  `fieldVisibility` = Full for the common modals, `seed` = ~24 tasks + milestones + a few RAID items
  + a couple of stakeholders.

Exact seed contents are pinned in the implementation plan. All seed ids are template-local (re-id on
apply, see §5). Names are i18n keys or plain strings (decision: plain English strings for seed
*content* — seed items are user-editable data, not UI chrome; built-in template *names/descriptions*
get i18n keys for the library UI).

### 5. Pure `applyTemplate` — the reusable core

`src/app/template-apply.ts`:

```ts
export interface ApplyTemplateOptions { includeSeed: boolean; }
export function applyTemplate(
  ws: Workspace,
  tpl: ProjectTemplate,
  opts: ApplyTemplateOptions,
): Workspace;
```

- **Field visibility:** returns `{ ...ws, fieldVisibility: tpl.fieldVisibility }` (replaces).
- **Seed (when `includeSeed`):** appends each seed collection's items to the corresponding workspace
  collection with **freshly-generated ids relative to `ws`**, non-destructively (existing items
  kept). Implemented as one pass:
  1. Compute an id-remap per collection (tasks use the next integer id after `ws`'s max; other
     entities use new string ids).
  2. Rewrite **internal cross-references** within the seed so appended items stay self-consistent:
     seed task `dependencies` pointing at other seed tasks, and seed RAID/change `linkedTasks` /
     `linkedRaid` / `stakeholderIds` pointing at other seed items, are remapped to the new ids.
     References that point *outside* the seed are dropped (a template can't reference the target
     project's pre-existing items).
- **Features:** NOT applied here in #2 (features are app-global today; the application model is a #3
  decision). `applyTemplate` ignores `tpl.features`. The Apply dialog *shows* the template's mode as
  info only.
- Pure and immutable (no mutation of `ws` or `tpl`).

> **Re-id detail:** the remap is the one real complexity. It is isolated in `template-apply.ts` with
> a dedicated helper `remapSeed(ws, seed): TemplateSeed` (returns seed with new ids + rewritten
> internal refs) so it is unit-testable independently of the workspace merge.

### 6. Save current project as a template

A pure builder in `templates.ts`:

```ts
export interface SaveTemplateInput {
  name: string;
  description?: string;
  includeContent: boolean;       // capture current content as seed?
}
export function templateFromWorkspace(
  ws: Workspace,
  features: readonly FeatureModuleId[],
  input: SaveTemplateInput,
  newId: string,
): ProjectTemplate;
```

- Captures `ws.fieldVisibility` (or the Advanced default if undefined → materialize via the resolver)
  and the passed-in `features` (the current `Settings.features`).
- If `includeContent`: copies the seedable collections from `ws` as-is into `seed` (each run through
  its entity sanitizer). No field-stripping is needed — the ids are template-local and get remapped
  on apply (§5), so they can be stored verbatim.
- `builtIn` is never set (user templates only).

### 7. UI surfaces (option A)

- **`settings-sections/templates-section.tsx`** — a new Settings section. Lists built-ins (with a
  **Duplicate** action that creates an editable user copy) and user templates (**Rename / Edit /
  Delete**), plus a **Save current project as a template…** entry. CRUD writes through the
  `useSettings` setter (live-persisted, consistent with other live sections). Threaded into
  `settings-view.tsx` and the settings section registry like the existing sections.
- **Action-menu entries** in `action-menus.tsx` — "**Save project as a template…**" and "**Apply
  template to current project…**". Apply opens a dialog: pick template (dropdown), an
  "Also add starter content (N tasks, M milestones)" checkbox (default off), Cancel/Apply. Apply
  calls `applyTemplate(currentWorkspace, tpl, { includeSeed })` and writes the result through the
  existing workspace setters (field-visibility setter + the collection setters), which triggers the
  existing autosave.
- A small **template editor** (reused by Edit and Duplicate-then-edit and Save-as) — name,
  description, and a read-only summary of what it captures (mode, field-visibility tiers, seed
  counts). Editing seed *content* item-by-item is OUT OF SCOPE for #2 (YAGNI — users build seed by
  "save current project's content"); the editor edits name/description/visibility/features metadata,
  not individual seed rows.

### 8. A `useTemplates` hook

`src/app/use-templates.ts` — thin convenience over `useSettings`:

```ts
{ templates: ProjectTemplate[];        // built-ins + user, merged
  userTemplates: ProjectTemplate[];
  addTemplate(t): void; updateTemplate(id, patch): void; removeTemplate(id): void;
  duplicateTemplate(id): void; }
```

Built-ins are immutable (update/remove no-op on built-in ids; duplicate makes a user copy).

---

## Components & files

| File | Responsibility | New? |
|------|----------------|------|
| `templates.ts` | `ProjectTemplate`/`TemplateSeed` types, `sanitizeTemplate(s)`, `templateFromWorkspace` | new |
| `templates-builtin.ts` | `BUILT_IN_TEMPLATES` constant | new |
| `template-apply.ts` | `applyTemplate` + `remapSeed` | new |
| `use-templates.ts` | hook over `useSettings` (merge built-ins + user, CRUD) | new |
| `settings-types.ts` | add `templates?: ProjectTemplate[]` + default `[]` | modify |
| `use-settings.ts` | sanitize `templates` on read | modify |
| `settings-sections/templates-section.tsx` | library manager UI | new |
| `settings-view.tsx` + section registry | register the new section | modify |
| `action-menus.tsx` (+ a small apply dialog component) | Save/Apply entries + Apply dialog | modify/new |
| `i18n.ts` / `i18n.de.ts` | section + action + dialog + built-in name/description keys | modify |

## Error handling & edge cases

- `sanitizeTemplates(undefined)` → `[]` (legacy settings without the field).
- A user template that fails sanitization is dropped, not crashed.
- Apply with `includeSeed` on an empty template seed → just sets field-visibility.
- Re-id: seed internal refs remap; external refs drop. No collision with existing workspace ids.
- Duplicating a built-in produces a user template with a fresh id and `builtIn` cleared.
- Built-in update/delete are no-ops (the UI only shows Duplicate for built-ins).

## Testing

- **Unit:** `applyTemplate` (field-visibility replace; seed append with fresh ids; internal-ref
  remap; external-ref drop; non-destructive; immutable); `remapSeed` in isolation;
  `sanitizeTemplates` (junk/legacy/builtIn-spoof); `templateFromWorkspace` (captures fv+features,
  includeContent on/off).
- **Component:** templates settings section CRUD (add/rename/delete/duplicate; built-ins read-only);
  the Apply dialog (pick + seed toggle → calls applyTemplate → setters); Save-as flow.
- **No** byte-stability/golden-fixture tests needed (templates aren't in the workspace serializers).

## Out of scope (later sub-projects)

- Picking a template at project **creation** + the features-application model (per-project vs global)
  (#3).
- Template **suggestion** from project parameters (#4).
- Per-row editing of seed content (build seed via "save current project's content").
