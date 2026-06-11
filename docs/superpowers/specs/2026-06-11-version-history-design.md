# Data Version History & Selective Restore — Design

**Date:** 2026-06-11 · **Status:** Approved, ready for implementation plan
**Target version:** new minor (0.66.0) · **Backend:** Turso only

## Context

Users want to reverse changes made to project data — a history like Confluence
page history: browse past versions, compare any two, and restore. Crucially,
restore must be **selective** — choose exactly which records and fields to bring
back, not just roll the whole project back.

This is **Turso-only**. The existing `snapshot` subsystem (Trends/baseline)
captures aggregate *metrics* per time-bucket and cannot reconstruct data, so it
is unsuitable for restore. This feature is a distinct subsystem that stores full
per-project workspace state.

The app is multi-project on Turso (one shared DB, `project_id` everywhere). The
loaded `Workspace` is one project; history is therefore **per-project**.

## Decisions (from brainstorming)

1. **Capture model:** automatic, *idle-debounced* coalescing (rapid autosaves
   collapse into one version) **plus** manual named checkpoints.
2. **Restore granularity:** *combined* — tick a whole changed record, or expand
   it and tick individual fields (field-level is the underlying capability;
   record-level ticking selects all of that record's changed fields).
3. **Retention:** keep the most recent 50 `auto` versions per project (prune
   older); keep **all** `manual` checkpoints forever.
4. **Version scope:** the whole project workspace (every editable collection).
   App settings/preferences are out of scope.
5. **Compare:** both *version → now* and *version ↔ version*.
6. **Restore is non-destructive:** it applies selected old values to current
   data and saves that as a **new** version; nothing is irreversibly
   overwritten. A `record added since the version` is restorable **as a removal**
   (opt-in). Restore writes a `history.restore` activity-log entry.
7. **Placement/gating:** a top-level **History** nav entry, shown only when the
   storage backend is Turso **and** a new `history` feature-module is enabled.

## Architecture & data model

**`project_versions` table (Turso, append-only):**

| column | type | notes |
|---|---|---|
| `id` | text/int PK | per-row id |
| `project_id` | text | tenant/project key (matches the rest of the schema) |
| `captured_at` | text | ISO timestamp |
| `trigger` | text | `'auto'` \| `'manual'` |
| `label` | text null | manual checkpoint name; null for auto |
| `summary` | text null | e.g. `"6 tasks, 2 RAID changed"` (derived at capture) |
| `payload` | text | full project workspace serialized as JSON |

- `payload` is produced by the existing JSON codec (`workspaceToJson`) and read
  back by `jsonToWorkspace` — a self-contained copy, decoupled from the live
  relational schema. Diff/restore deserialize two payloads and compare.
- **LANDMINE:** this table MUST be kept **out of `turso-schema` `TABLE_NAMES`**
  (the array the normal workspace-save clears/overwrites). The Trends snapshot
  tables have the same requirement and a guard test enforces it; add
  `project_versions` to the same exclusion and extend the guard.
- DDL is `CREATE TABLE IF NOT EXISTS` (additive; existing Turso DBs gain the
  table on next connect). No change to any existing entity table → none of the
  0.61-style column-add write-break risk.

**Capture (idle-debounced auto + manual):**
- The hook subscribes to the *successful Turso save* signal. On save it (re)arms
  an idle timer; when edits settle (quiet window, a named constant), it writes
  one `auto` version capturing the then-current serialized workspace.
- A no-op guard skips capture when the new payload equals the latest version's
  payload (no real change).
- `captureNow(label)` writes a `manual` row immediately.
- `summary` is computed by diffing the new payload against the previous version
  (counts per collection) for a human-readable timeline caption.

**Retention:** after each successful capture, prune `auto` rows beyond the most
recent 50 for that `project_id`. `manual` rows are exempt. Best-effort; a prune
failure is logged and never blocks the save.

## Pure engines

**`version-diff.ts`** — `diffWorkspaces(older, newer): VersionDiff`, driven by an
**entity registry** describing each workspace collection: its key on `Workspace`,
its id field, a human label, and per-field labels (reusing existing field-label
i18n where available). For each collection, records are matched by id and
classified **added** / **removed** / **modified**; a modified record carries a
list of `{ field, before, after }`. The registry is the single source of entity
shape knowledge, so compare/restore are generic and a future entity is a
one-line registration.

Collections covered (all of `Workspace`): tasks, raid, absences, shifts,
resources, roles, disciplines, grades, plan, budgets, status, milestones,
changes, stakeholders, project meta.

**`version-restore.ts`** — `applyRestore(current, version, selection): Workspace`
(pure, immutable). `selection` is a set of per-change picks. Relative to the
version being restored *from*:
- a ticked **modified field** → revert that field to the version's value;
- a **record removed since** the version → re-add it;
- a **record added since** the version → remove it (opt-in only).

Whole-record ticking = all that record's changed fields selected. Untouched
records/fields are preserved exactly.

## Components & wiring

**New files (focused, ~200–400 lines each):**
- `version-history.ts` — types (`ProjectVersion`, `VersionDiff`, `VersionChange`,
  `VersionSelection`) + the entity registry.
- `version-store.ts` — Turso CRUD: `append`, `listMeta` (metadata only; payloads
  loaded on demand via `loadPayload(id)`), `prune`, `delete`. Turso-only; mirrors
  `snapshot-store.ts`.
- `version-diff.ts`, `version-restore.ts` — the pure engines.
- `use-version-history.ts` — hook: list, coalesced + manual capture, restore,
  prune; wired to the Turso save signal, the activity log, and toasts; inert
  off-Turso.
- `history-panel.tsx` (+ a timeline-list subcomponent and a diff/restore
  subcomponent) — the view: left timeline (auto + ★ manual, "Save version now",
  select one for *vs now* or two for *vs each other*); right diff with
  record/field checkboxes and a non-destructive **Restore** action.

**Wiring (existing conventions):** new `history` view in `nav-config`; new
`history` entry in the feature-modules registry (`feature-modules.ts` +
`Settings.features`, defaulting on per `sanitizeFeatures`); render slot in
`workspace-section`/`task-manager`; `project_versions` DDL in `turso-schema`
(excluded from `TABLE_NAMES`); EN + DE i18n keys. The nav entry is gated on
`storageKind === 'turso' && isModuleEnabled('history', features)`.

## Error handling

- Capture and prune are **best-effort**: failure never breaks the main workspace
  save (logged; surfaced via the existing Turso storage-error bubble/banner only
  if the store itself is unreachable).
- Restore failure shows a toast and leaves current data unchanged.
- Off-Turso: nav hidden, hook no-ops, store methods are guarded.

## Testing

- `version-diff` / `version-restore` / prune + selection logic — heavy unit
  coverage (TDD): added/removed/modified classification, field-level revert,
  re-add removed, remove added-since, whole-record selection, immutability.
- `version-store` — vitest Turso-pipeline spy-mock (`vi.mock("./turso-pipeline",
  { spy: true })`).
- `use-version-history` — RTL; coalescing with fake timers (rapid saves → one
  version; no-op when payload unchanged); off-Turso inert.
- Round-trip: a payload survives `workspaceToJson` → `jsonToWorkspace` → restore.
- Golden fixtures unaffected (separate table; no workspace-serialization change).
- `turso-schema` guard test extended to assert `project_versions` is NOT cleared
  by a normal save.

## Suggested build order (the plan will detail this)

1. **Data layer + capture** — `project_versions` table, `version-store`, types,
   idle-debounced auto + manual `captureNow`, retention prune. Versions are
   written and listable (no restore UI yet).
2. **Diff engine + compare UI** — `version-diff` + entity registry; History view
   with timeline and read-only diff (vs-now and vs-version).
3. **Selective restore** — `version-restore`, restore controls, non-destructive
   new-version save, `history.restore` activity-log entry.
4. **Gating + polish** — `history` feature-module + nav, Turso gating, i18n,
   retention surfaced, empty/disabled states.

## Out of scope

- Non-Turso backends (file/IndexedDB) — feature hidden/inert there.
- App settings/preferences history (not project data).
- Per-user attribution/permissions (single-tenant BYO-key context; `author` is
  not modeled in v1).
- Cross-project / portfolio-wide history (per-project only).
- Delta/patch storage (full JSON copy per version is intentional).

## Verification

`npx tsc --noEmit`, `npm run lint` (`--max-warnings=0`), full `npx vitest run`,
`npm run build`, golden fixtures unchanged. Manual (Turso backend): edit data →
an auto-version appears after the idle window; "Save version now" creates a named
checkpoint; compare a version with now and with another version; tick a field and
a whole record and restore → current data updates, a new version is recorded, and
an activity-log entry appears; switch to a file backend → History is hidden.
