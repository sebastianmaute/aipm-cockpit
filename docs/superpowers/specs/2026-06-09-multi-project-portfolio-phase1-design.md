# Multi-Project / Portfolio Management — Phase 1 (file-based) Design

**Status:** Approved (brainstorming) — ready for implementation planning
**Date:** 2026-06-09
**Target version:** 0.58.0 (Phase 1)
**Scope:** Phase 1 only. Turso multi-tenancy is Phase 2 (separate spec).

---

## 1. Summary

Today the app is **single-workspace**: one `Workspace` (tasks, RAID, milestones, budget,
resources, roles, stakeholders, status) behind one storage backend. This feature adds a
**project / portfolio layer**: the user manages **multiple projects**, each of which is a
**complete, independent workspace** plus a rich **metadata header** (`ProjectMeta`). The user
can switch between projects, see the current one prominently, create new ones, and export any
project (with all associated data) to a file.

**Phase 1 delivers this end-to-end for FILE-based projects** (one file per project). Turso
multi-tenancy (one shared DB partitioned by `project_id`) is deferred to Phase 2; Phase 1 must
leave a clean seam for it but ship without it.

### Decisions locked during brainstorming
- **Project = full dataset.** Each project is its own complete `Workspace` + `ProjectMeta`. The
  current app effectively becomes "one project."
- **`ProjectMeta` lives on `Workspace`** (`Workspace.project`) so it round-trips through every
  existing serializer (JSON/CSV/MD/file) and exports for free.
- **Per-project storage.** The portfolio registry tracks a `storageConfig` per project; Phase 1
  implements file-based projects only. (Phase 2 adds the shared Turso DB option.)
- **NACE Rev. 2.1: sections only** (21 codes A–U).
- **No migration.** The app is not yet in use; a fresh install starts with no project and shows
  the empty-state (load / create).
- **Multi-project is core**, not a toggleable feature module.
- **Turso = Phase 2.** In Phase 1, the Turso storage option is not offered for new projects.

---

## 2. Data model

### 2.1 `ProjectMeta`
New type (in `types.ts`). Top-level field on `Workspace`:

```ts
Workspace.project?: ProjectMeta
```

Fields (★ = required for a valid project):

**Identity**
- `name: string` ★
- `code: string` ★ — ID/code
- `description?: string` — short description

**People — internal group**
- `sponsor?: string`
- `projectManager: string` ★
- `keyStakeholdersInternal: string[]` ★ — recipient-style token list (see §2.2)
- `keyStakeholdersExternal: string[]` ★ — external "at the customer", recipient-style token list

**Customer group (visually separated in the form)**
- `customer: string` ★
- `naceSection: string` ★ — one of the 21 NACE Rev. 2.1 sections A–U (single-select)
- `identityTypes: IdentityType[]` — multi-select of `"B2E" | "B2B" | "B2C" | "NHI"`
- `identityCount?: number` — non-negative integer
- `products: string` ★
- `platform?: string`
- `deployment: Deployment` ★ — `"Cloud" | "On-premise" | "Hybrid"` (single-select)
- `startDate: string` ★ — ISO date
- `endDate: string` ★ — ISO date
- `profitCenter: string` ★
- `quotes?: string`
- `salesforceUrl?: string` — tooltip "Link to Salesforce opportunity"
- `sharepointUrl?: string` — tooltip "Link to Sales SharePoint"
- `confluenceUrl?: string` — tooltip "Link to Confluence"
- `contactPersons: ContactPerson[]` — `{ name: string; email: string; synced: boolean }`
- `docRepoLocation?: string` — free text
- `regulatory: RegulatoryRequirement[]` ★ — multi-select; `"Not applicable"` is mutually exclusive
- `notes?: string` — free text

Static option sets (new pure module `project-options.ts`, or split):
- `IDENTITY_TYPES = ["B2E","B2B","B2C","NHI"]`
- `DEPLOYMENTS = ["Cloud","On-premise","Hybrid"]`
- `REGULATORY_REQUIREMENTS = ["Not applicable","GDPR / data protection regulation","DORA","MaRisk","BAIT","NIS2","HIPAA","SOX","EU AI Act","Export control / sanctions compliance"]`
- `NACE_SECTIONS` (new `nace-sections.ts`): the 21 sections A–U. Standard titles (verify exact
  wording against the official NACE Rev. 2.1 during implementation):
  A Agriculture, forestry and fishing · B Mining and quarrying · C Manufacturing · D Electricity,
  gas, steam and air conditioning supply · E Water supply; sewerage, waste management and
  remediation · F Construction · G Wholesale and retail trade; repair of motor vehicles and
  motorcycles · H Transportation and storage · I Accommodation and food service activities · J
  Information and communication · K Financial and insurance activities · L Real estate activities
  · M Professional, scientific and technical activities · N Administrative and support service
  activities · O Public administration and defence; compulsory social security · P Education · Q
  Human health and social work activities · R Arts, entertainment and recreation · S Other service
  activities · T Activities of households as employers · U Activities of extraterritorial
  organisations and bodies.

### 2.2 Key-stakeholder recipient inputs
`keyStakeholdersInternal` / `keyStakeholdersExternal` behave like **Outlook recipient fields**:
- A shared chip/token input (`StakeholderRecipientInput`) reused for both fields.
- Type-ahead suggestions come from the **current project's per-workspace Stakeholder register**
  (`workspace.stakeholders`), matched by name.
- The user may **pick a suggestion** or **enter arbitrary free text** — free entry is always
  allowed.
- **Stored as `string[]` (names).** Matching to a register entry is a **render-time enrichment**,
  not a hard link. This makes the round-trip work: create project first (register empty → all free
  text), add stakeholders later, reopen the form → names re-resolve against the now-populated
  register; unmatched names stay valid free text.
- At create time the new project's workspace has no stakeholders, so suggestions start empty.

### 2.3 Sanitizer & validation
- `sanitizeProjectMeta(input): ProjectMeta | null` in `sanitize.ts`, following the existing
  sanitizer pattern (length caps, enum-set membership, integer coercion for `identityCount`,
  array coercion + per-element text sanitize for the list fields, `"Not applicable"` exclusivity
  for `regulatory`).
- Pure `project-validation.ts` (mirrors `task-validation.ts`): `validateProjectMeta(meta)` →
  `Record<field, errorKey>` and `hasProjectErrors(...)`. Single source for submit-gating and
  inline `FieldError` display. Required fields per the ★ list above; `startDate`/`endDate` must be
  valid dates and `endDate >= startDate`; URLs (if present) must look like URLs.

### 2.4 Serialization
- `ProjectMeta` projected to CSV/MD/JSON via the existing column-driven approach in `storage.ts`
  (new `PROJECT_CSV_COLUMNS`, `projectFieldToString`, `buildProjectFromObj`). Array/enum fields
  encoded with the existing delimiter + `mdEscape` conventions; **must not break the dual-use
  storage round-trip** (no-config `workspaceToCsv`/`workspaceToMarkdown` stays byte-identical-by-
  construction for the existing sections; `project` is a new optional section).
- New export section key `"project"` ("Project details") added to `EXPORT_SECTION_KEYS` and
  `buildExportSections` (default ON), so the metadata flows into XLSX/DOCX/PDF/PPTX as a key/value
  section (pivot like `status`).

---

## 3. Portfolio registry & switching

### 3.1 Registry (`projects-registry.ts`, localStorage)
```ts
type ProjectRegistryEntry = {
  id: string;            // stable uuid-ish id (generated without Date.now/Math.random in pure code — see note)
  name: string;
  code: string;
  storageConfig: StorageConfig;   // Phase 1: local-json / local-csv / local-md only
};
type ProjectsRegistry = {
  projects: ProjectRegistryEntry[];
  currentProjectId: string | null;
};
```
- Persisted under a new localStorage key `lop-app:projects`. Pure read/write helpers:
  `loadRegistry()`, `saveRegistry()`, `addProject()`, `removeProject()`, `setCurrentProject()`,
  `renameProject()` — all immutable.
- For **file projects**, the re-openable `FileSystemFileHandle` is persisted in **IndexedDB**
  (handles are structured-cloneable; the app already uses the File System Access API via
  `LocalFileBackend`). A small `project-file-handles.ts` keyed by project id. Re-acquiring
  permission on reopen uses the existing `requestWriteAccessForBackend` flow.
- Id generation: ids are created in the UI/effect layer (where `crypto.randomUUID()` is allowed),
  never inside a pure reducer/updater.

### 3.2 Switching (`use-project-switch.ts`)
Builds on the existing `onRequestStorageSwitch` machinery in `use-storage-backend.ts`:
1. Save the current workspace to its current backend.
2. Resolve the target entry's `storageConfig` (+ file handle); `createBackend(...)`.
3. For file projects, reopen the file (`openFileForBackend`), re-prompting for permission if
   needed.
4. `backend.load()` → swap **all** workspace state (`setTasks`, `setRaid`, … `setProject`).
5. `setCurrentProject(id)` in the registry.
6. Reuse the existing `suppressNextLoadRef` / `suppressNextSaveRef` guards to avoid double
   load/save races.

### 3.3 Create project
1. Open the create form (modal). User fills metadata + picks a file format (json/csv/md) and file
   location (File System Access save picker).
2. Seed an **empty `Workspace`** carrying the entered `ProjectMeta`.
3. Write it to the new file via `LocalFileBackend`.
4. Register the entry (store id, name, code, storageConfig, file handle) and **switch to it**.

---

## 4. UI surfaces

### 4.1 Navigation
- New **core** top-level entry **"Projects"** → `projects` view.
- Wiring checklist (from architecture map): add `"projects"` to `AppView` union and `LABEL_KEYS`
  in `nav-config.ts`; place in a **new top-level `NAV_GROUPS` group "Portfolio"** (label key
  `navPortfolio`); lazy-load + conditionally render the panel in `workspace-section.tsx`
  (covers modern sidebar, classic, and popout). No feature-module gating.

### 4.2 Current-project indicator
- Rendered in modern `TopBar` and classic `AppHeader`: the **project name shown prominently**.
- Clicking it opens the **switcher** (popover/modal): list of projects (name + code), **switch**,
  **Load from file…**, **+ New project**. Current project marked.

### 4.3 Projects management view (`projects-panel.tsx`)
Content window listing all registered projects as cards/rows, each with:
- name, code, customer, dates, current-badge;
- actions: **Switch**, **Edit** (opens the form pre-filled), **Export** (format menu → existing
  `exportWorkspace`), **Delete** (removes from registry; Phase 1 does not delete the underlying
  file — confirm-dialog wording makes that explicit).
- A prominent **"+ New project"** action.

### 4.4 Empty state
- When the registry has **no projects**, the main area shows a modal offering **Create project**
  or **Load from file** (and nothing else is actionable until one is chosen).

### 4.5 Create / Edit form (`project-form.tsx` + `project-form-fields.tsx`)
- Shared form component rendered in two hosts: a **modal** (create / empty-state) and the
  management view's **edit**.
- **Two visually separated groups**: Group 1 = Identity + People (internal); Group 2 = a clearly
  separated **"Customer"** block.
- Inline per-field validation via `project-validation.ts` + the existing `FieldError`
  (`role="alert"`); **Save disabled until valid**.
- `StakeholderRecipientInput` for the two key-stakeholder fields (§2.2).
- **Contact persons** control: add from the **address book** (`contacts.ts` → `{name,email}`,
  stored `synced:true`) **or** add a **manual** entry (`synced:false`). Manual entries live on the
  project only and are **never written back** to the address book.
- Static selects: NACE section (A–U), deployment, identity types (multi), regulatory (multi with
  exclusive "Not applicable"). Date pickers for start/end.

### 4.6 i18n
All new labels/tooltips/validation messages added to `i18n.ts` (+ `i18n.de.ts`, literal UTF-8 —
verify with grep after edits per the known Edit-tool quote-corruption gotcha).

---

## 5. Export

Per-project export from the management view reuses `exportWorkspace(ws, format, config, lang)`.
Because `ProjectMeta` is on the `Workspace`, the metadata is included automatically. The new
`"project"` export section (§2.4) renders it as a key/value block across all formats. "Export a
project including all associated data" therefore reuses the existing export pipeline unchanged
apart from the added section.

---

## 6. File / module structure

**New files**
- `types.ts` additions — `ProjectMeta`, `ContactPerson`, `IdentityType`, `Deployment`,
  `RegulatoryRequirement`.
- `project-options.ts` — identity/deployment/regulatory option sets.
- `nace-sections.ts` — 21 NACE Rev. 2.1 sections.
- `project-validation.ts` (pure) + test.
- `projects-registry.ts` (pure) + test.
- `project-file-handles.ts` — IDB handle persistence.
- `use-project-switch.ts` — switching hook.
- `projects-panel.tsx` — management view.
- `project-form.tsx`, `project-form-fields.tsx` — shared form.
- `stakeholder-recipient-input.tsx` — recipient token input.
- `project-empty-state.tsx` — empty-state modal.

**Modified files**
- `storage.ts` — `Workspace.project`; `PROJECT_CSV_COLUMNS`, `projectFieldToString`,
  `buildProjectFromObj`; include in CSV/MD/JSON; BrowserBackend load/save of `project` (KV).
- `sanitize.ts` — `sanitizeProjectMeta`.
- `settings-types.ts` / `export-sections.ts` — `"project"` export section + default-on.
- `nav-config.ts` — `projects` view + label + group.
- `workspace-section.tsx` — render `ProjectsPanel`; empty-state hook.
- `workspace-context.tsx` — `project` + `setProject` state.
- `use-storage-backend.ts` — load/save `project`; integrate switching.
- `TopBar` / `AppHeader` (modern + classic) — current-project indicator + switcher.
- `task-manager.tsx` — wire registry, switching, empty-state, handlers.
- `i18n.ts`, `i18n.de.ts` — new keys.
- `version.ts`, `package.json` — 0.58.0.

---

## 7. Testing

- **Pure units:** `sanitizeProjectMeta`, `validateProjectMeta`/`hasProjectErrors`, registry
  add/switch/remove/rename, CSV/MD/JSON `ProjectMeta` round-trip, `buildExportSections` "project"
  section, recipient-match resolution (matched vs free-text), contact-merge (manual vs synced).
- **Round-trip safety:** assert no-config `workspaceToCsv`/`workspaceToMarkdown` output for a
  workspace **without** `project` is unchanged (guards the dual-use storage format).
- **Validation gating:** required-field errors, date ordering, "Not applicable" exclusivity.
- Meet/exceed the repo coverage gate (70% lines per vitest config). `lint --max-warnings=0`,
  `tsc` clean.

---

## 8. Out of scope (Phase 1)

- Turso multi-tenancy (`project_id` columns, shared `projects` table, per-project Turso storage) —
  **Phase 2**.
- Program/portfolio **roll-up dashboards** across projects — future phase.
- Deleting the underlying file on project delete — Phase 1 only de-registers.
- Address-book sync-back of manual contact persons — explicitly never.

---

## 9. Constraints (carried from project conventions)

- No zod/yup. 9-color AIPM palette only; no gradients/shadows/off-palette.
- `lint --max-warnings=0`; no `console.log` in production; no secrets in logs.
- `i18n.de.ts` literal UTF-8 (Edit tool can corrupt ASCII quotes → grep after editing).
- Pure modules inject `now` / avoid `Date.now()`/`Math.random()`; id generation in the
  effect/UI layer only.
- No side effects inside `setState` updaters (React 19 StrictMode double-invoke).
- Immutable updates throughout.
