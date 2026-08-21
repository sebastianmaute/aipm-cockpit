# Baseline + Variance / Burndown Trends — Design

**Date:** 2026-06-03
**Status:** Approved (pending written-spec review)
**Target version:** 0.49.0 "Le Guin" · build 2026-06-03

## Goal

Capture periodic snapshots of project KPIs (persisted in Turso) and show
slippage over time: a baseline-vs-current variance summary, KPI trend charts,
and a burn-down overlay of historical actual curves. **Turso backend only.**
Switching away from Turso warns (with confirmation) that recording stops but is
retained; switching back resumes. Recording gaps are highlighted.

## Constraints (from the request)

- **Turso-only.** Snapshots are recorded and surfaced only when the active
  storage backend is Turso. Other backends show a clear "requires Turso" state.
- **Transparent switch-away.** Switching from Turso to any other backend must
  show an extra warning + confirmation: recording will stop.
- **Retain on switch away.** Recorded snapshots stay in Turso, untouched.
- **Resume on switch back.** Reconnecting to Turso resumes recording and reads
  the existing history.
- **Highlight gaps.** Missing expected-cadence periods are visually flagged.

## Why Turso-only works cleanly (architecture rationale)

Turso writes are **last-write-wins**: `workspaceToStatements()` (turso-schema.ts)
emits `BEGIN`, the schema DDL, `DELETE FROM <every workspace table>`, then
re-inserts. Therefore snapshots **must NOT** be part of the workspace tables or
the workspace `save()` cycle — otherwise the 500 ms debounced save would wipe
them every time.

Snapshots live in their **own append-only Turso tables**, written by a dedicated
store that is independent of `StorageBackend.save()`. Consequences that satisfy
the constraints for free:

- The portable `Workspace` never carries snapshot data, so non-Turso backends
  are physically incapable of seeing or persisting it (enforces Turso-only).
- Switching storage only serialises the *workspace* into the new backend and
  never drops the Turso database, so snapshot rows are retained automatically.
- Switching back simply re-reads the existing rows; the off-period renders as a
  highlighted gap.

## Decisions captured

- **Snapshot content:** compact KPI summary **plus** per-period burn-down arrays
  (so historical actual curves can be overlaid).
- **Capture:** automatic on a cadence **plus** a manual "Capture snapshot now"
  button. Auto fires at most once per cadence bucket; a manual snapshot in the
  same bucket suppresses the auto one.
- **Cadence:** weekly default, configurable to daily / monthly (Settings).
- **Baseline:** the row flagged `is_baseline`; defaults to the earliest snapshot
  (set on the first-ever capture); any snapshot can be re-flagged ("Set as
  baseline").
- **Variance:** latest − baseline, per KPI, with directional RAG.
- **UI:** a new "Trends" sub-view in the Overview nav group (alongside
  Dashboard), conditionally mounted, Turso-gated.
- **Gaps:** dashed bridge + faint shaded band across a missing bucket, with an
  "N gaps" count in the chart caption.

## Architecture (Approach A — chosen)

A standalone snapshot subsystem layered on the Turso pipeline, separate from the
generic `StorageBackend`. No change to the `StorageBackend` interface; no
`snapshots[]` field on `Workspace`.

```
turso-pipeline.ts   (NEW)  shared HTTP /v2/pipeline runner extracted from
                           TursoBackend; one place handles 401 / unreachable /
                           error-result. Used by both TursoBackend and the
                           snapshot store.
snapshot.ts         (NEW)  pure: bucketKey, buildSnapshot, expectedBuckets,
                           detectGaps, variance. No React, no I/O.
snapshot-schema.ts  (NEW)  pure SQL builders + row decoders for the snapshot
                           tables (mirrors turso-schema.ts style).
snapshot-store.ts   (NEW)  loadSnapshots / appendSnapshot / setBaseline /
                           deleteSnapshot — calls runTursoPipeline. Dynamic-
                           imported to avoid the storage import cycle.
use-snapshots.ts    (NEW)  React hook: orchestrates auto + manual capture
                           (main window only), exposes history/gaps/baseline.
trend-chart.tsx     (NEW)  dependency-free SVG line chart over snapshot dates,
                           with gap bridge + shaded band (sibling to
                           burndown-chart.tsx).
trends-panel.tsx    (NEW)  the Trends view: gate, variance table, KPI trend
                           charts, burn-down overlay, snapshot list.
```

### Turso schema — two new append-only tables

Created lazily via `CREATE TABLE IF NOT EXISTS` prepended to each pipeline (same
pattern as `SCHEMA_DDL`). **Deliberately excluded from `TABLE_NAMES`** so the
workspace overwrite never touches them. All columns `TEXT` (matching the
existing convention — numbers stringified, parsed on read).

`snapshot.id` is a **client-generated TEXT id** (the ISO millisecond
`captured_at` string, which is unique per capture under the single-writer
main-window rule) — NOT an autoincrement. This lets one batched pipeline insert
the snapshot and its series rows together without a `last_insert_rowid()`
round-trip.

```sql
CREATE TABLE IF NOT EXISTS snapshot (
  id               TEXT PRIMARY KEY,  -- client-generated = captured_at (ISO ms)
  captured_at      TEXT,  -- ISO timestamp
  bucket           TEXT,  -- cadence bucket key: "2026-W23" | "2026-06-03" | "2026-06"
  cadence          TEXT,  -- "weekly" | "daily" | "monthly" in effect at capture
  trigger          TEXT,  -- "auto" | "manual"
  is_baseline      TEXT,  -- "1" on exactly one row, else "0"
  remaining_hours  TEXT,
  remaining_cost   TEXT,
  pct_complete     TEXT,
  forecast_end_date TEXT,
  plan_end_date    TEXT,
  spi              TEXT,
  cpi              TEXT,
  overall_rag      TEXT,  -- "R" | "A" | "G" | ""
  schedule_rag     TEXT,
  budget_rag       TEXT,
  scope_rag        TEXT,
  currency         TEXT,
  milestones_json  TEXT   -- compact [{id,name,target,forecast}] for milestone slippage
);

CREATE TABLE IF NOT EXISTS snapshot_series (
  snapshot_id    TEXT,
  seq            TEXT,   -- ordering within the snapshot
  period         TEXT,   -- "2026-06" / "2026-W23"
  planned_hours  TEXT,
  actual_hours   TEXT,   -- "" when null (after today)
  planned_cost   TEXT,
  actual_cost    TEXT
);
```

The snapshot tables are written with `BEGIN` / inserts / `COMMIT`, append-only —
no `DELETE FROM`. A **guard test** asserts the snapshot table names are disjoint
from `turso-schema.ts`'s `TABLE_NAMES` so the overwrite-wipe regression can never
be reintroduced.

### Capture engine (`snapshot.ts`, pure)

- `bucketKey(date: Date, cadence): string` — ISO-week (`YYYY-Www`), day
  (`YYYY-MM-DD`), or month (`YYYY-MM`).
- `buildSnapshot(input): SnapshotRecord` — assembles a record from the existing
  pure engines: `computeDashboard` (overall/schedule/budget/scope RAG, %
  complete), `computeEvm` (SPI/CPI), `computeBurndownSeries`
  (`BurndownSeries` → `snapshot_series` rows + `remaining_hours` /
  `remaining_cost` taken as the last defined actual remaining), milestone
  target-vs-forecast, plan end date, forecast end date. `trigger` and `cadence`
  passed in.
- `expectedBuckets(from: Date, to: Date, cadence): string[]` — enumerates buckets
  inclusive.
- `detectGaps(snapshots, cadence, today): string[]` — expected buckets between
  the first snapshot and today with no row.
- `computeVariance(baseline, current): VarianceRow[]` — per-KPI baseline /
  current / delta + a directional `Health` (e.g. forecast end later than
  baseline, or remaining-cost higher, trends Red).

`forecast_end_date`: derived as the latest forecast finish among incomplete
tasks/milestones (reuse existing due-date logic); if none, falls back to
`plan_end_date`. (Exact source pinned in the plan.)

### Snapshot store (`snapshot-store.ts`)

Each function dynamic-imports `snapshot-schema.ts` and calls
`runTursoPipeline(config, stmts)`:

- `loadSnapshots(config): Promise<SnapshotRecord[]>` — DDL + `SELECT * FROM
  snapshot ORDER BY captured_at` + `SELECT * FROM snapshot_series`; joins series
  to their snapshot in JS; malformed rows skipped.
- `appendSnapshot(config, record): Promise<void>` — DDL + `BEGIN` + insert the
  snapshot row + insert its series rows (all carrying the client-generated
  `record.id`) + `COMMIT`. No id round-trip needed.
- `setBaseline(config, id): Promise<void>` — `UPDATE snapshot SET is_baseline='0'`
  then `UPDATE snapshot SET is_baseline='1' WHERE id=?`.
- `deleteSnapshot(config, id): Promise<void>` — delete the snapshot + its series
  rows.

### Capture orchestration (`use-snapshots.ts`)

- Active only when `settings.storageConfig.kind === "turso"` **and** `!isPopout`
  **and** the backend reports ready. Same single-writer rule as `save()` — a
  popout never records.
- On load (after the workspace has loaded): `loadSnapshots`; then, if
  `settings.snapshots.enabled` and the current `bucketKey(today, cadence)` has no
  snapshot, `appendSnapshot(... trigger:"auto")` once.
- Returns `{ snapshots, gaps, baseline, latest, captureNow, setBaseline,
  deleteSnapshot, busy }`. `captureNow` always records a `trigger:"manual"` row.
- Auto-capture failure: logged, non-blocking (best-effort, never touches the
  workspace). Manual failure: toast.

### Settings

Add `settings.snapshots = { enabled: boolean; cadence: "weekly" | "daily" |
"monthly" }` to `settings-types.ts` (`defaultSettings`: `{ enabled: true,
cadence: "weekly" }`). UI lives in the Turso block of the Integrations section:
an "Snapshot trend recording" toggle + a cadence select, both disabled/greyed
when Turso isn't the active backend (with a hint).

### Switch-away guard (`use-storage-backend.ts`)

In `onRequestStorageSwitch`, when `current.kind === "turso"` and `newKind !==
"turso"`, the leave-warning confirm **replaces** the generic convert-confirm for
this case (one dialog, not two) — `window.confirm(t(lang,
"storageTursoLeaveWarn", tasks.length, label))`:

> "Snapshot trend recording only works on the Turso backend. Switching to
> {label} stops recording (your {N} items are still converted). Your recorded
> snapshots are kept in Turso and recording resumes when you switch back.
> Continue?"

Cancel aborts the switch (no config change). All other switch directions keep
the existing single convert-confirm. No data is deleted in any case.

### Trends UI (`trends-panel.tsx` + `trend-chart.tsx`)

- New `AppView` `"trends"` added to `nav-config.ts` Overview group (after
  `dashboard`), with `LABEL_KEYS.trends = "navTrends"`, a `nav-icons.tsx` entry,
  and a conditional mount in `workspace-section.tsx` (`next/dynamic`,
  `ssr:false`). Classic sub-tabs already derive from `nav-config`.
- **Gate:** when not Turso (or recording disabled), render a muted empty state
  ("Trends require the Turso backend — choose Turso in Settings → Storage") and
  nothing else.
- **Variance summary:** a Baseline / Current / Δ table per KPI, Δ cells carrying
  a `RagBadge` / `healthText` colour. Marks which snapshot is the baseline and
  its date.
- **KPI trend charts** (`trend-chart.tsx`): line charts over snapshot dates
  (X = `captured_at`, thinned ticks like burndown). At least: remaining hours,
  remaining cost, forecast-end slippage (days vs baseline), SPI and CPI. Gaps
  render as a dashed bridge + faint shaded band; caption shows "N gaps".
- **Burn-down overlay:** the per-period burn-down with each snapshot's stored
  `snapshot_series` actual curve drawn faint, the baseline curve emphasised, and
  the planned glide-path dashed (reuses burndown-chart styling/legend).
- **Snapshot list:** captured_at, trigger (auto/manual), baseline marker, and
  per-row actions: "Set as baseline", "Delete".

## Component boundaries

- `snapshot.ts`, `snapshot-schema.ts` — pure, no React, no I/O; unit-tested.
- `turso-pipeline.ts` — pure transport; the only place that knows the HTTP shape.
- `snapshot-store.ts` — thin async store over the pipeline + schema.
- `use-snapshots.ts` — the only stateful/React orchestrator; main-window only.
- `trend-chart.tsx` — pure render, one new dependency-free SVG component.
- `trends-panel.tsx` — composition + gating only.

## Error handling

- All snapshot Turso calls reuse `runTursoPipeline` → existing
  `StorageNotReadyError` (`storage-unreachable` hint) / 401 / non-OK handling.
- Capture is best-effort and fully decoupled from `save()`: it can never block,
  delay, or corrupt the workspace. Auto-capture errors are logged only; manual
  errors raise a toast.
- Malformed rows are skipped on load (like `rowsToWorkspace`).

## Testing (TDD)

- `snapshot.test.ts` — `bucketKey` for all three cadences incl. ISO-week edges
  (year boundary); `buildSnapshot` KPI extraction from a fixture workspace;
  `expectedBuckets` / `detectGaps` boundaries (none, leading, trailing, interior);
  `computeVariance` directional RAG.
- `snapshot-schema.test.ts` — SQL builders produce expected INSERT/SELECT/UPDATE;
  row decode round-trip; **guard: snapshot tables disjoint from
  `turso-schema.TABLE_NAMES`**.
- `turso-pipeline.test.ts` — extracted runner parity: 401 → not-ready, network
  failure → `storage-unreachable`, error result → throws.
- `use-snapshots.test.tsx` — auto-capture once per bucket; manual suppresses auto
  in the same bucket; inactive when not Turso / when popout / when disabled;
  resume reads existing rows after returning to Turso.
- `trends-panel.test.tsx` — Turso gate empty state; variance table renders
  baseline/current/Δ; gap count shown.
- `trend-chart.test.tsx` — gap bridge + shaded band present; axis ticks render.
- `use-storage-backend.test.tsx` — leaving Turso triggers the extra confirm;
  cancel aborts the switch (config unchanged); non-Turso → Turso does not.
- i18n EN/DE parity (tsc-enforced) for every new key; ASCII straight quotes
  verified in `i18n.de.ts` after edit.

## i18n keys (EN + DE)

`navTrends`, `trendsRequireTurso`, `trendsCaptureNow`, `trendsSetBaseline`,
`trendsDeleteSnapshot`, `trendsBaselineLabel`, `trendsCurrentLabel`,
`trendsDeltaLabel`, `trendsGapsCount`, `trendsTriggerAuto`, `trendsTriggerManual`,
`trendsNoSnapshots`, `trendKpiRemainingHours`, `trendKpiRemainingCost`,
`trendKpiForecastSlip`, `trendKpiSpi`, `trendKpiCpi`,
`snapshotRecordingLabel`, `snapshotCadenceLabel`, `snapshotCadenceWeekly`,
`snapshotCadenceDaily`, `snapshotCadenceMonthly`, `snapshotNeedsTurso`,
`storageTursoLeaveWarn`, `versionHighlightTrends`.

## Versioning

`0.49.0` "Le Guin". Update `version.ts` (APP_VERSION, APP_BUILD_DATE,
APP_MILESTONE, top comment block, append `versionHighlightTrends` to
`APP_HIGHLIGHT_KEYS`), `package.json`, `CHANGELOG.md`, `README.md`, and
`docs/CODEMAPS/frontend.md` + `data.md`.

## Out of scope / deferred

- No charting dependency; trend + overlay charts stay hand-rolled SVG.
- No cross-project/multi-workspace history (the app is single-workspace).
- No snapshot export/import file format (snapshots live in Turso only).
- No automatic retention cap/pruning — rows are tiny; manual delete suffices
  (revisit only if volume becomes a real problem).
- No server-side scheduled capture — capture is client-side, main-window only,
  on app load (a closed app records no snapshot; the resulting gap is shown).
