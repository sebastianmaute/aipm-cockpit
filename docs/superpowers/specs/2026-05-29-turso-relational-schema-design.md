# Turso Relational Schema — Design

**Date:** 2026-05-29
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.26.0-turso-relational`
**Context:** Sub-project **A** of a two-part storage rework. The Turso backend (shipped 0.25.0, local/self-hosted support 0.25.1) currently stores the entire workspace as a single JSON blob in `workspace(id, data)`. This replaces that with a **proper relational (hybrid) schema** — one table per top-level entity, scalar fields as columns, deeply-nested fields as TEXT columns reusing the existing CSV-cell encoders. Sub-project **B** (convert-and-write on storage-format switch, with confirmation) is a separate spec built after this. Ships as **0.26.0**.

## Goal

Persist the lop-app `Workspace` to Turso as queryable per-entity tables instead of one opaque JSON row, while reusing the codebase's existing per-entity serialization and validation so no parsing/validation logic is duplicated.

## Non-goals

- No change to the libSQL HTTP `/v2/pipeline` transport, the config resolver, or the Settings/Storage-Config UI (all from 0.25.0/0.25.1 — unchanged).
- No fully-normalized child tables — nested collections/maps stay as TEXT columns (the **hybrid** decision).
- No per-record incremental sync / partial writes — `save()` overwrites the whole workspace transactionally (same whole-workspace, last-write-wins semantics as every other backend).
- No relational schema for the other backends (browser/local/SharePoint stay blob/text; only Turso becomes tabular).
- No change to the convert-on-switch behavior — that is Sub-project B.

## Decisions (from brainstorming)

- **Hybrid schema:** one table per top-level entity; scalar fields → columns; nested arrays/maps → TEXT columns encoded with the **existing** `sanitize.ts` cell encoders.
- **Mirror the CSV layout:** `workspaceToCsv`/`csvToWorkspace` already flatten every entity (`tasksToCsv`, `raidToCsv`, `absencesToCsv`, `shiftsToCsv`, `refsToCsv`, `rolesToCsv`, `resourcesToCsv`, `budgetsToCsv`, `fxRatesToCsvLine`, `planToCsvLine`) and round-trip them back via `csvToWorkspace` + the per-entity sanitizers. The relational tables mirror that **per-entity column set**, and the load mapper reuses the **same** encoders/decoders + full-record sanitizers. No new flatten/validate logic.
- **Transactional full-overwrite save**; **old-blob one-time auto-import**.

## Architecture

Two units: a pure schema/mapping module + a `TursoBackend` rewrite that keeps the existing transport.

### 1. `src/app/turso-schema.ts` (new, pure)

No React/window/fetch. Depends only on `types.ts` + the existing `sanitize.ts` encoders/sanitizers + `storage.ts` (`emptyWorkspace`, the V6 migration).

```ts
/** One execute statement for the libSQL pipeline. */
export interface SqlStmt { sql: string; args?: { type: "text" | "integer" | "null"; value?: string }[]; }

/** CREATE TABLE IF NOT EXISTS for every table + the meta row. Ordered. */
export const SCHEMA_DDL: string[];

/** Table names in load order (also the SELECT set). */
export const TABLE_NAMES: readonly string[];

/** Produce the ordered statements that OVERWRITE the whole workspace:
 *  BEGIN, [DDL], DELETE FROM each table, INSERT every row, meta upsert, COMMIT. */
export function workspaceToStatements(ws: Workspace): SqlStmt[];

/** The SELECT statements load() runs (one per table + meta), in TABLE_NAMES order. */
export function selectStatements(): SqlStmt[];

/** Assemble a Workspace from the pipeline results of selectStatements().
 *  Maps each row → the raw object shape, runs the existing per-entity sanitizer,
 *  drops nulls, then applies migrateWorkspaceV6. Empty → emptyWorkspace(). */
export function rowsToWorkspace(results: PipelineResult[]): Workspace;
```

- **Column ↔ field mapping** mirrors the per-entity CSV columns. For each entity the TEXT-encoded columns reuse the existing helpers:
  - tasks: `labels` ← `sanitizeLabels`/join, `dependencies` ← `serializeDependencies`/`parseDependenciesString`.
  - resources: `utilization`, `absence_override` ← `encodePeriodMap`/`decodePeriodMap`.
  - shifts: `hours_per_weekday` ← the existing pipe-join used by `shiftsToCsv`.
  - raid: `linked_task_ids`, `parent_ids` ← the existing id-list encoder.
  - budget_buckets: `allocations` ← `encodeAllocations`/`decodeAllocations`.
  - fx_rates: `rates` ← `encodePeriodMap`-style / the existing fx encoder.
- **Single-row tables:** `plan` and `fx_rates` hold exactly one row (id = 1). `meta(key,value)` holds `schema_version`.
- **Numbers vs text args:** ids/minutes/rates use `{type:"integer"|"text"}` libSQL args; everything else `text`; absent optionals → omit column / store NULL. (Loaders already coerce via sanitizers, so NULL/empty round-trips safely.)

### 2. `src/app/turso-backend.ts` (rewrite of `load`/`save`)

Keeps `kind`, constructor, `isReady`, `describe`, the `/v2/pipeline` transport + 0.25.1 loopback/no-token/no-`close` behavior, and the typed errors. Only `load`/`save` change:

- **`save(ws)`** → `runPipeline(workspaceToStatements(ws))`. The statement list wraps the writes in `BEGIN` … `COMMIT` so a mid-write failure rolls back (no half-written workspace). DDL is `CREATE TABLE IF NOT EXISTS`, so first save creates the schema.
- **`load()`** →
  1. `runPipeline([...DDL, ...selectStatements(), old-blob probe])`.
  2. **Old-blob auto-import:** also `SELECT data FROM workspace WHERE id = 1` (the 0.25.x blob table — guarded `CREATE TABLE IF NOT EXISTS workspace(id,data)` so the SELECT never errors). If the relational tables are all empty **and** a blob row exists → return `jsonToWorkspace(blob)` (the next `save` writes it relationally; the old `workspace` table is left untouched, harmless). Otherwise → `rowsToWorkspace(results)`.
  3. Empty everywhere → `emptyWorkspace()`.

### Data flow

```
save: Workspace → workspaceToStatements → BEGIN; CREATE IF NOT EXISTS×N; DELETE×N; INSERT rows; meta; COMMIT
       → POST {httpUrl}/v2/pipeline (Bearer if token)
load: POST selectStatements + blob-probe → rowsToWorkspace (row→raw→sanitize→assemble→migrateWorkspaceV6)
       (or one-time jsonToWorkspace(old blob) when relational tables empty)
```

### Edge cases

- **Empty DB / first use:** DDL runs, all SELECTs empty, no blob → `emptyWorkspace()`. First `save` populates the tables.
- **Old 0.25.x blob present:** imported once on load; subsequent saves are relational. No data loss.
- **Partial / malformed rows:** each row passes through the existing full-record sanitizer (e.g. `sanitizeResource` returns null for unrecoverable rows → dropped), exactly like the CSV/JSON load paths. `dropDanglingDependencies` applied as today.
- **Transaction failure:** any statement error → the pipeline surfaces it (`Turso error: …`); because writes are inside `BEGIN/COMMIT`, an aborted transaction leaves prior data intact. (If the engine auto-rolls-back an open transaction on connection close, no explicit `ROLLBACK` is needed; the plan verifies against the local engine.)
- **Last-write-wins** preserved (whole-workspace overwrite); no concurrency control (unchanged).
- **Token never in URL/logs** (unchanged); loopback http + cloud https both work.

## i18n keys (EN + DE)

| Key | EN | DE |
|---|---|---|
| `versionHighlightTursoRelational` | "Turso storage now uses a proper relational schema (one table per entity) instead of a single JSON blob — your workspace is queryable in SQL. Existing single-blob databases are imported automatically." | "Der Turso-Speicher nutzt jetzt ein echtes relationales Schema (eine Tabelle pro Entität) statt eines einzelnen JSON-Blobs – Ihr Workspace ist in SQL abfragbar. Bestehende Einzel-Blob-Datenbanken werden automatisch importiert." |

(Backend `StorageNotReadyError`/`Error` messages are reused as-is — no new error keys.)

## Testing

### Unit — `turso-schema.test.ts` (new)
- **Round-trip:** build a representative fixture `Workspace` (tasks with labels + FS/SS dependencies; resources with `utilization` + `absenceOverride` period maps; budgets with allocations + per-period hour maps; raid with linkedTaskIds + parentIds; shifts; plan; fxRates). `workspaceToStatements(ws)` → assert the INSERT args for the encoded TEXT columns equal the existing-encoder output. Then synthesize the `SELECT` `PipelineResult`s those INSERTs imply and assert `rowsToWorkspace(results)` deep-equals the **sanitized** fixture (i.e. `rowsToWorkspace ∘ statements` is identity modulo sanitization).
- Empty results → `emptyWorkspace()`.
- Numeric vs text arg typing for a sample of columns (id integer, minutes integer, text fields text, absent optional → NULL/omitted).

### Unit — `turso-backend.test.ts` (extend, mock fetch)
- `save` issues a `BEGIN` … `COMMIT` pipeline containing `CREATE TABLE IF NOT EXISTS` + `DELETE FROM <table>` + `INSERT` for populated entities.
- `load` assembles a Workspace from mocked multi-table SELECT results.
- **Old-blob import:** relational tables empty + `workspace(id,data)` row present → returns `jsonToWorkspace(blob)`.
- Empty everywhere → `emptyWorkspace()`. 401 → `StorageNotReadyError`; libSQL error → Error; not-configured → not-ready. Loopback (no-token) still omits `Authorization`.

### Live verification
Against `tursodb mydb.db --sync-server 127.0.0.1:8080`: a real `save` then `load` round-trips a non-trivial workspace; confirm the tables exist (`SELECT name FROM sqlite_master WHERE type='table'`) and `BEGIN/COMMIT` + multi-statement pipeline are accepted.

### Gates
`npx tsc --noEmit` 0; `npm run lint` 0; full suite green (existing 1058 + new); coverage ≥ current.

## Release

Minor → **0.26.0**. `src/app/version.ts`: bump + top comment + append `"versionHighlightTursoRelational"` to `APP_HIGHLIGHT_KEYS`. `i18n.ts`/`i18n.de.ts`: the highlight key. `CHANGELOG.md`: `[0.26.0]` — Changed (Turso backend now relational/hybrid; per-entity tables; old single-blob DBs auto-imported). No new dependencies.

## Plan shape (preview — `writing-plans` expands)

1. `turso-schema.ts` — `SCHEMA_DDL` + `TABLE_NAMES` + `selectStatements()` (DDL + SELECTs) + tests for the SELECT/DDL shape.
2. `turso-schema.ts` — `workspaceToStatements(ws)` (transactional overwrite; reuse encoders) + round-trip tests.
3. `turso-schema.ts` — `rowsToWorkspace(results)` (row→raw→sanitizer→assemble→migrate) + round-trip tests.
4. `turso-backend.ts` — rewrite `save`/`load` to delegate; old-blob auto-import; extend backend tests (mock fetch).
5. Live verification against local `tursodb`; fix any protocol gaps.
6. Release 0.26.0 (version.ts, i18n, CHANGELOG).

## What this closes

After 0.26.0, Turso stores the workspace as queryable per-entity tables. **Sub-project B** (convert-and-write on storage-format switch, with a confirmation dialog) follows as its own spec.
