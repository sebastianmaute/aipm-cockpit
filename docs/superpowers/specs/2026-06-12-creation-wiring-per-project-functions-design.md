# Creation Wiring + Per-Project Functions — Design Spec

> **Status:** Approved (brainstorming complete, 2026-06-12). Sub-project #3 of 4.
> **Storage note:** `docs/superpowers/` is gitignored — this spec lives locally, not committed.

## Context — the 4-part feature

1. **Modal field-visibility framework** — SHIPPED v0.70.0 "Heinlein" (`Workspace.fieldVisibility`).
2. **Templates entity** — SHIPPED v0.71.0 "Bear" (`Settings.templates[]`, `applyTemplate`, save/apply UI). It
   deferred applying a template's **feature-module preset** to this sub-project.
3. **Creation wiring + per-project functions** *(this spec)* — make "which functions/modules are on" a
   **per-project** setting, and add a project-creation **wizard** that picks a template and configures
   functions, applying both at creation.
4. **Template suggestion engine** — recommend a template from project parameters (plugs into the
   wizard's template step later).

This spec covers **#3 only**.

## Goal

Functions become per-project: each project remembers its enabled modules, switching projects switches
the active functions **reactively (no page reload)**, and a 3-step creation wizard picks a template and
configures functions, applying the template's field-visibility + optional seed + the chosen functions to
the new project.

---

## Architecture

### Decision: Approach A — per-project functions, reactive, synced through `settings.features`

`settings.features` (`FeatureModuleId[]`) is read by **45 call sites** across 7 files (nav, dashboard/
task-row badges, conditional renders, reports, redirects). Almost all are already memoized on
`settings.features`, so they recompute reactively when it changes. Only two force the current
`window.location.reload()`: the `filterNavGroups(...)` nav memo and `useHashView(...)` — both also depend
on `settings.features`, so they react too once the value is updated reactively (via `setSettings`) rather
than written straight to localStorage + reload.

**Therefore:** keep `settings.features` as the single **reactive "active functions" source** (no consumer
changes), and make the **per-project** value the source of truth that drives it.

### 1. Data model

- New `Workspace.features?: readonly FeatureModuleId[]` (optional, additive — exactly like
  `fieldVisibility`). `undefined` for legacy projects.
- `emptyWorkspace()` leaves it `undefined` (a blank workspace has no per-project override yet).

### 2. Persistence (mirror `fieldVisibility`, byte-stable)

- JSON envelope (`workspace.ts`): include only when present (`...(ws.features ? {features: ws.features} : {})`);
  read via `sanitizeFeatures` only when the key exists (so legacy `undefined` stays `undefined`, NOT the
  `sanitizeFeatures(undefined) → ALL` default — see Edge cases).
- CSV (`csv-codecs.ts`): a dedicated section emitted only when present (single JSON cell, like the
  field-visibility section); decode via `sanitizeFeatures`.
- Markdown (`markdown-codecs.ts`): a `## Functions` fenced-JSON section, emitted only when present.
- Turso: a `meta`-KV row keyed `"features"` (sibling of `project_status`/`field_visibility`),
  reference-equality dirty-tracked; `meta` stays in TABLE_NAMES (it's the KV table — correct).
- **Byte-stability:** `undefined` ⇒ no output anywhere; existing golden fixtures unchanged.

> **Important sanitize nuance:** `sanitizeFeatures(undefined)` returns `[...ALL_MODULE_IDS]` (its legacy
> "all on" default). For the per-project field we must distinguish "no override" (`undefined`, key absent)
> from "explicitly empty" (`[]`, Simple mode). So decoders only call `sanitizeFeatures` **when the key/
> section/row is present**; absence ⇒ leave `ws.features` undefined.

### 3. Sync — the no-reload mechanism (`use-storage-backend.ts`)

- **On load/switch** (`applyWorkspace(ws)`): after applying collections, sync the active functions:
  `if (ws.features) setSettings(s => ({ ...s, features: ws.features }))`. If `ws.features` is undefined
  (legacy), leave `settings.features` unchanged (preserves current behavior). This requires threading
  `setSettings` into the storage hook (it already has access to settings).
- **On change** (Settings → Mode "Save", or creation): write to **both** `Workspace.features` (via
  `setFeatures` → existing dirty-table autosave) **and** `settings.features` (reactive). No reload.
- **Redirect-on-shrink:** switching to a project with fewer modules while the active view belongs to a
  now-disabled module must run `disabledViewRedirect`. Since `settings.features` changes reactively, the
  existing redirect memo/effect re-fires; verify during implementation and add an explicit guard if a gap
  shows.

### 4. WorkspaceProvider + setter

Add `features`/`setFeatures` to `workspace-context.tsx` (mirrors `fieldVisibility`/`setFieldVisibility`),
in the context value + memo deps. Thread through the storage bridge's load fan-out + all save-gather
sites (the same 4+ sites `fieldVisibility` uses) + save-effect deps.

### 5. Settings → Mode section becomes per-project

The existing Mode section now edits the **current project's** functions. `handleCommitFeatures(features)`
(task-manager) changes to: `setFeatures(features)` (persist to the project) **+** `setSettings(s => ({...s,
features}))` (reactive) — and **drops `window.location.reload()`**. Commit-on-Save UX is kept (explicit
Save); only the reload is removed. Copy/help clarifies functions are per-project.

### 6. Creation wizard (Approach A — 3 steps)

New `create-project-wizard.tsx` wrapping the existing create form. It **replaces the direct
`create-project-form.tsx` invocation at every create entry point** (the Projects/Portfolio panel and the
empty-state) — those now open the wizard; Step 1 reuses the existing form's field group so no field logic
is duplicated.
- **Step 1 — Details:** the existing `ProjectMeta` fields (reuse `create-project-form.tsx`'s field group +
  format selector).
- **Step 2 — Template:** a list of `useTemplates().templates` (built-ins + user) + a **Blank** option.
  Each row shows mode (`deriveMode(features)`) + seed summary. Selecting sets the wizard's working
  `template` (or null for Blank).
- **Step 3 — Functions:** a mode segmented control + per-module checkboxes, **pre-filled** from the
  selected template's `features` (Blank → `[...ALL_MODULE_IDS]`); editable. Plus an **"Include starter
  content"** checkbox shown only when the template has a non-empty `seed`.
- **Create** assembles the new workspace:
  ```
  let ws = { ...emptyWorkspace(), project: meta };
  if (template) ws = applyTemplate(ws, template, { includeSeed });   // sets fieldVisibility (+ seed)
  ws = { ...ws, features: configuredFunctions };                      // per-project functions
  ```
  Blank: no `applyTemplate` (fieldVisibility stays undefined → Advanced default), `features =
  configuredFunctions`. This **resolves #2's deferral** — functions are applied at creation.

### 7. Create flow wiring (`use-storage-backend.ts`)

Extend `createProject(meta, format, opts?)` and `createTursoProject(meta, opts?)` with
`opts?: { template?: ProjectTemplate; features?: readonly FeatureModuleId[]; includeSeed?: boolean }`. At
the existing seam (after `emptyWorkspace()`, before `applyWorkspace()`), build `ws` per §6, then
`applyWorkspace(ws)` (which now also syncs `settings.features` from `ws.features` via §3). Default `opts`
(no wizard / programmatic create) preserves today's behavior (`features` undefined ⇒ no override).

---

## Components & files

| File | Responsibility | New? |
|------|----------------|------|
| `workspace.ts` | `Workspace.features?` + JSON envelope (present-only) | modify |
| `csv-codecs.ts` / `markdown-codecs.ts` | features section (present-only, byte-stable) | modify |
| `turso-schema.ts` | `meta`-KV `features` row + dirty-track | modify |
| `workspace-context.tsx` | `features`/`setFeatures` | modify |
| `use-storage-backend.ts` | load-sync, save-gather, create opts + apply seam | modify |
| `create-project-wizard.tsx` | 3-step wizard | new |
| `create-project-form.tsx` | reused as Step 1 (extract field group if needed) | modify |
| `task-manager.tsx` | `handleCommitFeatures` per-project + drop reload; wire wizard | modify |
| `settings-sections/mode-section.tsx` | per-project copy | modify |
| `i18n.ts` / `i18n.de.ts` | wizard steps + mode copy keys | modify |

## Error handling & edge cases

- `sanitizeFeatures` only applied when the stored key/section/row is **present** (absence ⇒ `undefined`,
  not "all on") — preserves the legacy-vs-explicit-empty distinction.
- Legacy project (no `ws.features`): keeps the current `settings.features`; gains a per-project value on
  first Mode save.
- Switching to a project whose active functions hide the current view ⇒ `disabledViewRedirect`.
- Wizard "Blank": no template, default field-visibility, functions default to all (editable).
- Create with no `opts` (programmatic): behaves as today (no per-project override).
- Popouts: read the same reactive `settings.features`; no reload means popouts stay in sync via the
  existing broadcast/settings mechanism (verify popout features behavior).

## Testing

- **Unit:** `Workspace.features` byte-stable serialization across all 4 backends (undefined ⇒ nothing;
  present ⇒ round-trips; absent-vs-empty distinction preserved); `applyWorkspace` sync (defined→sets
  settings.features, undefined→preserves); wizard "Create" assembly (template field-vis + seed +
  configured features; Blank path).
- **Component:** wizard step navigation; template selection pre-fills the functions step; Blank path;
  include-seed toggle visibility; Mode section saves per-project without reload.
- **Integration (highest risk):** changing functions updates nav **without remount/reload**; switching to
  a fewer-module project redirects off a now-disabled view.

## Out of scope (later)

- Template **suggestion** from project parameters (#4) — the wizard's template step is manual + Blank here.
- Making other settings (layout/appearance) per-project — only functions move in this sub-project.
