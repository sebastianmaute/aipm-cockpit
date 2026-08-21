# Multi-Project / Portfolio — Phase 2: Turso Multi-Tenancy (Design)

**Date:** 2026-06-10
**Status:** Approved (brainstorming) — ready for implementation plan
**Builds on:** Phase 1 (file-based multi-project, v0.58.0 "Vinge"). See `2026-06-09-multi-project-portfolio-phase1-design.md`.

## Goal

Let a single shared Turso (libSQL) database hold many projects (multi-tenant),
so users can create, switch between, export, and delete projects entirely in the
database — the Turso counterpart to Phase 1's file-based portfolio. The Turso DB
becomes the source of truth for the Turso project list.

## Locked decisions (from brainstorming)

1. **Project list source of truth (Turso mode):** the DB itself — a `projects`
   table queried on connect builds the list.
2. **Coexistence:** a **global portfolio-mode switch** — the portfolio is in
   exactly one mode at a time, `"file"` (Phase 1, unchanged) or `"turso"`.
3. **Concurrency:** **last-write-wins, per project.** Different projects are
   isolated; same-project concurrent edits resolve last-save-wins (matches the
   existing single-tenant Turso backend). No locking/versioning.
4. **Deletion:** **soft delete (archive) by default**, reversible from an
   archived view; plus an explicit **hard delete** that permanently removes the
   project and all its data, guarded by a **type-to-confirm dialog** (user must
   type the project's exact name and submit).
5. **No migration** — the app is not yet in use. Fresh DB gets the multi-tenant
   schema; old single-tenant rows (no `project_id`) read as invisible.

## Non-goals

- Real-time collaboration / conflict resolution (last-write-wins is accepted).
- Migrating existing single-tenant Turso data into a project.
- Mixing file and Turso projects in one portfolio view (global mode switch
  replaces that).

---

## Architecture & mode model

**Portfolio mode** is a global, persisted choice: `"file"` or `"turso"`. A new
pure module **`portfolio-mode.ts`** owns it (load/save to localStorage, guarded
like `projects-registry.ts`: `typeof window` guard + try/catch; tolerant of
corruption; returns a default of `"file"`).

**File mode:** unchanged. Phase 1's localStorage `ProjectsRegistry`, per-project
file handles, empty-state, switcher, create/edit all behave exactly as today.

**Turso mode:**
- The shared DB is authoritative for the list of projects.
- Switching project = set the active `project_id` and reload that project's
  slice from the DB. No reconnect (same URL/token).
- `load()` reads the current project's slice
  (`SELECT * FROM <t> WHERE project_id = ?`); `save()` overwrites only the
  current project's rows (`DELETE … WHERE project_id = ?` then re-insert stamped
  with `project_id`), transactionally. Other projects are never touched.
- The localStorage `ProjectsRegistry` is **not** the list in Turso mode. Instead
  a thin localStorage cache remembers `{ currentProjectId }` so the
  last-selected project survives reloads. The list is always rebuilt from
  `SELECT … FROM projects WHERE archived = '0'`.

---

## Schema

New pure module **`turso-tenant-schema.ts`** (keeps `turso-schema.ts` focused).
It reuses Phase 1's `PROJECT_CSV_COLUMNS` / `projectFieldToString` /
`buildProjectFromObj` and the existing generic column registry, so no per-field
mapping is duplicated.

**`projects` table** (new):

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  archived TEXT,                       -- "0" | "1"
  <one "<field>" TEXT column per PROJECT_CSV_COLUMNS entry>
)
```

**Every workspace table gains `project_id TEXT`.** DDL is already generated from
`colDdl(columns)`; we append `, project_id TEXT`. Affected: all `ENTITY_SPECS`
tables (`tasks`, `raid`, `absences`, `shifts`, `resources`, `roles`,
`disciplines`, `grades`, `budget_buckets`, `milestones`, `changes`,
`stakeholders`), plus `plan`, `fx_rates`, `meta`, and the snapshot tables
(`snapshot`, `snapshot_series`).

**Scoped statement builders** (parameterized by `projectId`):

- `selectStatements(projectId)` → `SELECT * FROM <t> WHERE project_id = ?` for
  each `TABLE_NAMES` entry.
- `workspaceToStatements(ws, projectId)` → `BEGIN` · DDL · per-table
  `DELETE FROM <t> WHERE project_id = ?` · re-insert each row with `project_id`
  appended to columns+args · `COMMIT`.
- `listProjectsStatement()` → `SELECT * FROM projects WHERE archived = '0'`.
- `listArchivedProjectsStatement()` → `SELECT * FROM projects WHERE archived = '1'`.
- `upsertProjectStatement(meta, id)` → `INSERT OR REPLACE` the `projects` row
  (id + archived='0' + meta columns).
- `archiveProjectStatement(id)` → `UPDATE projects SET archived='1' WHERE id = ?`.
- `restoreProjectStatement(id)` → `UPDATE projects SET archived='0' WHERE id = ?`.
- `hardDeleteProjectStatements(id)` → `BEGIN` · `DELETE FROM <t> WHERE
  project_id = ?` across **all** workspace + snapshot tables · `DELETE FROM
  projects WHERE id = ?` · `COMMIT`.

**Snapshot scoping** (`snapshot-schema.ts`): add `project_id` to both tables and
thread `projectId` through `snapshotSelectStatements`, `appendStatements`,
`setBaselineStatements`, and `deleteStatements`. Critically, the bare
`UPDATE snapshot SET is_baseline='0'` MUST become
`… WHERE project_id = ?` so setting one project's baseline does not clear every
other project's baseline. Snapshot tables stay OUT of `TABLE_NAMES` (the
existing guard test must remain green).

`SCHEMA_VERSION` bumps from `"9"` to `"10"`.

---

## Backend API & data flow

The single-tenant `StorageBackend` interface (`load/save/isReady/describe`)
cannot express project-aware ops, so Phase 2 adds dedicated modules and leaves
the existing `TursoBackend` in place (used for non-portfolio/legacy paths and as
the snapshot pipeline host).

**`turso-tenant-backend.ts`** — `new TursoTenantBackend(config, projectId)`
implements `StorageBackend`:
- `load()` → DDL + `selectStatements(projectId)` → `rowsToWorkspace`; empty
  slice → `emptyWorkspace()`.
- `save(ws)` → `workspaceToStatements(ws, projectId)` (per-project, transactional).
- Reuses `runTursoPipeline`; errors classified by the existing `tursoErrorKind`
  so the red status bubble + storage banner keep working unchanged.

**`turso-portfolio.ts`** — portfolio-level ops (one config, no single project):
- `listProjects(config)` → `{ id, meta, archived }[]` for the switcher/panel.
- `listArchivedProjects(config)` → for the archived view.
- `createProject(config, meta, id)` → ensure DDL, then `upsertProjectStatement`.
  A new project starts empty (no workspace rows until first `save`).
- `updateProjectMeta(config, meta, id)` → `upsertProjectStatement`.
- `archiveProject(config, id)` / `restoreProject(config, id)`.
- `hardDeleteProject(config, id)` → `hardDeleteProjectStatements`.

**Switch flow (Turso mode)** in `use-storage-backend.ts`:
1. Flush the outgoing project (`save()` on current tenant backend) — same
   best-effort-flush-first discipline Phase 1 established (avoids losing
   debounce-window edits).
2. Set active `projectId` → memoized backend recreates as
   `TursoTenantBackend(config, newId)`.
3. Suppress the config-change auto-load (existing suppress-ref mechanism), then
   `applyWorkspace(await backend.load())`.
4. Persist `{ currentProjectId }` to the thin localStorage cache.

**Snapshots** (`use-snapshots.ts` / `snapshot-store.ts`): thread the active
`projectId` into every snapshot call so Trends reads/writes/baseline within the
current project only.

---

## UI surfaces

- **Settings — portfolio-mode toggle.** A File ↔ Turso selector beside the
  existing Turso URL/token inputs. Selecting Turso (with a valid config) swaps
  the portfolio source. Connection failures use the existing red bubble +
  storage banner. Persisted via `portfolio-mode.ts`.
- **Switcher & Projects panel — mode-aware list.** In Turso mode they render
  `listProjects(config)` (fetched on connect + after each mutation) instead of
  the localStorage registry. Current-project indicator/dropdown otherwise
  identical; popouts stay read-only.
- **Empty-state (Turso mode).** Shows **Create project only** ("Load from file"
  is meaningless against a DB). Gating stays `hydrated && list.length === 0`,
  popout-exempt.
- **Create / edit forms.** Reuse Phase 1 `create-project-form.tsx` /
  `project-form.tsx`. In Turso mode the file-format selector is hidden (storage
  is "this DB"); the form collects `ProjectMeta` only. Create generates the
  `id` (UUID, UI layer) and calls `turso-portfolio.createProject`.
- **Delete — two paths in the Projects panel:**
  - **Archive** (default): simple confirm → `archiveProject`; project leaves the
    active list.
  - **Show archived** toggle reveals archived projects with **Restore** and
    **Delete permanently**.
  - **Delete permanently** → new **`TypeToConfirmDialog`**: shows the project
    name, a text input, and a submit button disabled until the typed value
    exactly equals the project name; on submit → `hardDeleteProject`.
    Irreversible, styled destructive within the 9-color AIPM palette (no new
    colors).
- **Export.** Per-project export (Phase 1) works as-is: the current project's
  loaded workspace feeds `buildExportSections`. No change.
- **i18n.** New EN/DE keys: portfolio-mode labels, archived view + Restore +
  Delete-permanently, type-to-confirm dialog (prompt, input aria, mismatch
  hint). Parity is tsc-enforced; `i18n.de.ts` edited carefully (curly-quote
  corruption gotcha — verify bytes after editing).

---

## Edge cases & operational notes

- **No migration:** fresh DB → multi-tenant schema; old single-tenant DB → reads
  zero projects (unscoped rows lack `project_id`, invisible — no blend, no
  corruption). Documented, not coded.
- **Mode switch with unsaved work:** File→Turso flushes the current file project
  first, then loads the Turso list; switching back leaves the localStorage file
  registry untouched.
- **Turso configured but unreachable:** `listProjects` failure routes through
  `tursoErrorKind` → red bubble + storage banner; portfolio shows an error
  state, NOT a misleading empty-state.
- **Sample database** (`scripts/generate-sample-workspace.ts` →
  `sample-workspace.sqlite3`): regenerate under the multi-tenant schema — one
  `projects` row + all sample rows stamped with that `project_id` — so the demo
  DB loads in Turso mode. `scripts/` stays excluded from tsconfig.
- **`feat-toast-first-migration` fold-in:** merge that branch (2 commits:
  notification-defaults toast, unrelated to Turso; touches `use-settings.ts` /
  `task-manager.tsx` / i18n only) into the Phase 2 branch early so it ships
  together (per the deferral decision). No storage-layer overlap → no conflicts
  expected.

---

## Testing

- **Pure schema builders** (`turso-tenant-schema`): DDL includes `project_id`;
  `selectStatements` / `workspaceToStatements` carry the `WHERE` / `INSERT`
  `project_id`; `hardDeleteProjectStatements` covers every table incl.
  `projects` + snapshots; `listProjectsStatement` filters `archived='0'`.
- **Round-trip:** `workspaceToStatements(ws, "p1")` → simulated rows →
  `rowsToWorkspace` reproduces `ws`; two projects' statement sets are mutually
  non-interfering (p1 save emits no DELETE/INSERT for p2).
- **Snapshot scoping:** `setBaselineStatements(id, projectId)` includes
  `WHERE project_id`; select/append/delete scoped by project.
- **Portfolio ops** (`turso-portfolio`) against a mocked pipeline:
  list/create/archive/restore/hard-delete emit the right statements; archived
  excluded from `listProjects`.
- **`portfolio-mode.ts`:** load/save round-trip, SSR guard, corruption
  tolerance (mirrors `projects-registry` tests).
- **Hook flow** (`use-storage-backend`): Turso switch flushes outgoing then
  loads target slice; create selects new project; hard-delete re-points current.
- **Type-to-confirm dialog:** submit disabled until exact name match; fires
  `hardDeleteProject` on submit; mismatch keeps it disabled.
- Full suite + `tsc` + lint (`--max-warnings=0`) green; e2e unaffected.

---

## File structure (new / modified)

**New:**
- `src/app/portfolio-mode.ts` (+ test) — global mode flag + currentProjectId cache.
- `src/app/turso-tenant-schema.ts` (+ test) — project-scoped DDL + statements.
- `src/app/turso-tenant-backend.ts` (+ test) — per-project `StorageBackend`.
- `src/app/turso-portfolio.ts` (+ test) — list/create/update/archive/restore/hardDelete.
- `src/app/type-to-confirm-dialog.tsx` (+ test) — reusable destructive confirm.

**Modified:**
- `src/app/snapshot-schema.ts` (+ test) — `project_id` scoping.
- `src/app/use-storage-backend.ts` — Turso switch/create/delete flows, mode-aware.
- `src/app/use-snapshots.ts` / `src/app/snapshot-store.ts` — thread `projectId`.
- `src/app/task-manager.tsx` — mode-aware project list, empty-state, switcher wiring.
- `src/app/projects-panel.tsx` — archived view, archive/restore/hard-delete actions.
- `src/app/project-switcher.tsx` / `project-empty-state.tsx` — Turso-mode variants.
- `src/app/create-project-form.tsx` — hide format selector in Turso mode.
- Settings section component — portfolio-mode toggle.
- `src/app/i18n.ts` / `src/app/i18n.de.ts` — new keys (EN/DE parity).
- `src/app/version.ts` / `package.json` — v0.59.0 (codename chosen at release, sci-fi author per convention).
- `scripts/generate-sample-workspace.ts` — multi-tenant sample DB.
