# Change-Control Log (Register) — Design

**Date:** 2026-06-03
**Status:** Approved (pending written-spec review)
**Target version:** 0.50.0 "Sanderson" · build 2026-06-03

## Goal

Add a project-management **change-control register** ("Change Log") as a
first-class sibling to the RAID log: manually-logged change requests with an
approval workflow, impact rating + optional schedule/cost figures, task and RAID
cross-links, a sortable/filterable panel + add/edit modal, a printable Change
Report, persistence across every storage backend, and a dashboard Scope signal.

It is distinct from the existing **Activity Log** (the automatic, capped CRUD
audit trail). The Change Log is deliberate, persistent, user-edited records.

## Decisions captured

- **Kind:** change-control register (change requests), not a decision log.
- **Parity:** full RAID parity — panel + add/edit modal, printable Change Report,
  Registers-group nav entry with a report sub-view, persistence in all backends.
- **Cross-links:** entries link to **tasks** and to **RAID items** (both editable
  in the modal); task rows get a "N changes" reverse badge. One-directional — the
  RAID panel does NOT gain a reverse "linked changes" section.
- **Dashboard:** a Changes subsection + a computed **Scope** RAG signal from
  pending changes (Scope currently has no computed signal — override only).
- **Statuses:** `Proposed`, `Under Review`, `Approved`, `Rejected`,
  `Implemented`, `Deferred`.
- **Impact:** an impact rating (`Low|Medium|High|Critical`, reusing `RaidSeverity`
  + `severityRag`) + free-text description + optional `scheduleImpactDays` and
  `costImpact` (plan currency).
- **Scope signal:** Amber if ≥1 pending change; Red if pending count ≥
  `SCOPE_PENDING_RED` (default 5); worst-of with the manual override (override
  still wins), exactly as Schedule/Budget fold their signals.

## Architecture (Approach A — chosen)

A new first-class `ChangeItem` workspace entity, mirroring RAID's file structure
and the Milestones (0.44.0) new-entity precedent. Rejected alternatives: a 5th
RAID category "C" (different lifecycle/fields would bloat `RaidItem`); storing
changes in the Activity Log (wrong home — that's an automatic audit).

## 1. Data model (`types.ts`)

```ts
export const CHANGE_TYPES = ["Scope", "Schedule", "Cost", "Quality", "Other"] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const CHANGE_STATUSES = [
  "Proposed", "Under Review", "Approved", "Rejected", "Implemented", "Deferred",
] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export type ChangeImpact = RaidSeverity; // "Low" | "Medium" | "High" | "Critical"

export type ChangeItem = {
  id: number;                  // monotonic, separate from task/raid ids
  title: string;
  description: string;
  type: ChangeType;
  status: ChangeStatus;
  impact?: ChangeImpact;
  impactDescription?: string;
  scheduleImpactDays?: number;
  costImpact?: number;         // displayed in plan currency
  requestedBy?: string;
  raisedDate: string;          // YYYY-MM-DD
  decisionBy?: string;
  decisionDate?: string;       // auto-filled when status first leaves the pending set
  resolutionNotes?: string;
  linkedTaskIds: number[];
  linkedRaidIds: number[];
  localModifiedAt?: string;
};
```

- **Pending** = `Proposed | Under Review` (drives "open" filters + scope signal).
- **Terminal** = `Rejected | Implemented | Deferred`.
- `Approved` is decided-but-active (not pending, not terminal).
- `decisionDate` auto-fills when status first leaves the pending set.

## 2. Pure logic (`change-log.ts`, sibling to `raid.ts`)

`CHANGE_TYPES`/`CHANGE_STATUSES` re-exported; `defaultChangeStatus = "Proposed"`;
`isPendingChange(status)`, `isTerminalChangeStatus(status)`; `nextChangeId(items)`;
`changeImpactRag(impact)` → `severityRag`; `countByType`, `countByStatus`;
`buildChangeByTaskIndex(items)` → `Map<number, ChangeItem[]>`;
`compareChange(a, b, key, dir)` with sort keys
`id|type|title|impact|status|requestedBy|raisedDate|decisionDate` (missing dates
sort last, as `compareRaid` does); `computeScopeStatus(changes, redThreshold)` →
`Health | null`; `selectTopChanges(changes, limit)` (pending, by impact rank then
recency). No React, no IO.

## 3. Storage (`storage.ts`, `sanitize.ts`, `turso-schema.ts`)

- `Workspace.changes?: ChangeItem[]` — optional for backward compat (like
  `budgets`/`milestones`). `emptyWorkspace()` seeds `[]`.
- **Schema v6 → v7 additive migration**: ensure `changes: []` on older
  workspaces. Bump `SCHEMA_VERSION` to `"7"` (turso-schema). The migration is
  idempotent and adds nothing else.
- Column-driven round-trip: `CHANGES_CSV_COLUMNS` (id, title, description, type,
  status, impact, impactDescription, scheduleImpactDays, costImpact, requestedBy,
  raisedDate, decisionBy, decisionDate, resolutionNotes, linkedTaskIds,
  linkedRaidIds, localModifiedAt), `changeFieldToString(item, col)`,
  `buildChangeFromObj(obj)` (→ `sanitizeChangeItem`). Id-array columns encode as
  the existing pipe/space convention used by `linkedTaskIds` elsewhere.
- `sanitizeChangeItem(raw)`: validate `type`/`status` against the enums (fallback
  to `"Other"`/`"Proposed"`), coerce/clamp `scheduleImpactDays`/`costImpact`
  (non-negative finite or undefined), sanitize date strings, sanitize id arrays,
  length-cap text fields. Mirrors `sanitizeBudgetBucket`/`sanitizeAbsence`.
- `turso-schema.ts`: one `ENTITY_SPECS` entry `{ table: "changes", wsKey:
  "changes", columns: CHANGES_CSV_COLUMNS, get, toRow: changeFieldToString,
  fromObj: buildChangeFromObj }`. It **is** a workspace table (participates in
  the normal overwrite save/load — NOT like the append-only snapshot tables).

## 4. Panel + edit modal

- `change-panel.tsx` (sibling to `raid-panel.tsx`, `React.memo` + stable
  `useCallback` handlers): header with the add button before the search field;
  sortable/filterable/resizable table via the shared `report-table` kit +
  `useSortableFilter` + `TABLE_HEAD_CLASS`; columns id · type · title · impact
  (RAG dot via `changeImpactRag`) · status · requestedBy · raised; row click
  opens the edit modal; conditional mount; uses `VIEW_PANE_*` chrome.
- `change-edit-modal.tsx` (draggable, shared `ModalHeader` + `use-draggable`):
  title, description, `type`/`status`/`impact` selects, impactDescription,
  scheduleImpactDays, costImpact, requestedBy, raisedDate, decisionBy,
  decisionDate (read-only auto-fill once decided), resolutionNotes, a **task
  picker** (`linkedTaskIds`) and a **RAID picker** (`linkedRaidIds`). Validates
  via `sanitizeChangeItem`; compact footer (Cancel + Save) matching the other
  edit modals.

## 5. CRUD hook (`use-change-log.ts`)

Owns `changes` (from `WorkspaceContext`), create/update/delete, modal open +
draft state, and the `decisionDate` auto-fill on the pending→decided transition.
Mirrors `use-resource-planner.ts` (which owns RAID CRUD). All writes route
through `sanitizeChangeItem`.

## 6. Cross-linking

- Change → tasks and Change → RAID, editable in the modal, shown in the report
  and the modal.
- Task rows show a read-only "N changes" badge via `buildChangeByTaskIndex`
  (parity with the RAID badge). The badge is display-only; a click-to-jump from
  the badge into the Change Log is deferred (out of scope for this release).
- One-directional: no reverse section in the RAID panel.

## 7. Report (`change-report-panel.tsx`, sibling to `raid-report-panel.tsx`)

Printable `ReportCard`: summary tiles (Total · Pending · Approved · Implemented ·
Rejected) + By-X tables (By Type, By Status, By Impact, By Requestor, Top
Pending), all sortable/filterable via the shared report kit. Reachable from the
Registers nav (sub-view of Changes) and as a popout, like the RAID Report.

## 8. Dashboard (`dashboard.ts`, `dashboard-panel.tsx`)

- **Scope becomes computed.** Replace `scope: { effective: status.scopeOverride
  ?? null }` with `scope: { computed, effective: status.scopeOverride ?? computed,
  overridden: !!status.scopeOverride }`, where `computed =
  computeScopeStatus(input.changes, SCOPE_PENDING_RED)`: Amber if pending ≥ 1, Red
  if pending ≥ `SCOPE_PENDING_RED`. `SCOPE_PENDING_RED = 5` added to the
  dashboard constants block. `DashboardInput` gains `changes: readonly
  ChangeItem[]`. The overall RAG already worst-of's the four sub-statuses, so a
  Red scope now influences overall.
- `DashboardModel` gains a `changes` summary (`pending`, `approved`,
  `implemented`, `total`) + `topChanges` (from `selectTopChanges`).
- `dashboard-panel.tsx`: a Changes subsection (pending count + top-pending list,
  rows clickable to open the change), matching the RAID/milestone subsections.

## 9. Nav + wiring

- `nav-config.ts`: Registers group gains `{ view: "changes", children: [{ view:
  "change-report" }] }`. Add `"changes"` + `"change-report"` to the `AppView`
  union and `LABEL_KEYS` (`navChanges`, `changeReportTitle`).
- `nav-icons.tsx`: glyphs for `changes` (e.g. a document-with-swap) and
  `change-report` (reuse the report glyph). `ICON_PATHS` totality is tsc-enforced.
- `workspace-tab-context.tsx`: add `"changes"` + `"change-report"` to `TopTab`.
- `workspace-context.tsx`: add `changes`/`setChanges` state.
- `workspace-section.tsx`: dynamic-mount `ChangePanel` (`activeTab === "changes"`)
  and `ChangeReportPanel` (`activeTab === "change-report"`), `ssr:false`.
- `task-manager.tsx`: instantiate `use-change-log`, thread CRUD handlers + the
  change-by-task index to the panel and task rows; pass `changes` into
  `computeDashboard`.
- Classic sub-tabs derive automatically from `nav-config`.

## 10. i18n (EN + DE)

~45 keys: `navChanges`, `changeReportTitle`, the 6 status labels, the 5 type
labels, field labels (title/description/type/status/impact/impact-description/
schedule-impact/cost-impact/requested-by/raised/decision-by/decision-date/
resolution/linked-tasks/linked-raid), report headings/tiles, the dashboard
Changes section labels, the task-row "N changes" badge, and
`versionHighlightChangeLog`. ASCII straight quotes only in `i18n.de.ts`
(transliterate umlauts ae/oe/ue); tsc enforces EN/DE parity.

## 11. Testing (TDD)

- `change-log.test.ts`: status/pending/terminal predicates; `nextChangeId`;
  `compareChange` per key incl. missing-date-last; `computeScopeStatus`
  thresholds (0 → null, 1..4 → A, ≥5 → R); `buildChangeByTaskIndex`;
  `selectTopChanges` ordering; `changeImpactRag`.
- `sanitize` test: `sanitizeChangeItem` enum fallback, number clamp, id arrays,
  length caps.
- Storage: CSV/MD/JSON round-trip of a `ChangeItem`; **v6→v7 migration** seeds
  `changes: []`; Turso relational round-trip (new `changes` table).
- UI: `change-panel.test.tsx` (sort/filter/row-open), `change-edit-modal.test.tsx`
  (validation + decisionDate auto-fill + link pickers), `change-report-panel.test.tsx`
  (tiles + By-X), `use-change-log.test.tsx` (CRUD + auto-fill).
- `dashboard.test.ts`: scope signal (pending → A; ≥5 → R; override wins;
  overall folds scope-Red); changes summary/topChanges.
- `nav-config.test.ts`: `changes`/`change-report` present + label keys.
- i18n EN/DE parity (tsc) for all new keys; ASCII-quote grep on `i18n.de.ts`.

## 12. Versioning

`0.50.0` "Sanderson". Update `version.ts` (APP_VERSION/APP_BUILD_DATE/
APP_MILESTONE + top comment block + append `versionHighlightChangeLog` to
`APP_HIGHLIGHT_KEYS`), `package.json`, `CHANGELOG.md`, `README.md`, and
`docs/CODEMAPS/frontend.md` + `data.md`.

## Out of scope / deferred

- No reverse "linked changes" section in the RAID panel (one-directional links).
- No automatic change capture (it's a manual register, unlike the Activity Log).
- No change-request approval permissions/roles (single-user app).
- No export of the Change Report to DOCX/XLSX beyond what the shared report/print
  path already provides.
