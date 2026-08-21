# Project-Health Dashboard — Design

**Date:** 2026-06-02
**Status:** Approved design (pre-implementation)
**Roadmap position:** Feature #1 of 3 — Health Dashboard → Milestones → Earned Value (SPI/CPI).

## Goal

A single consolidated view that answers "how is this project doing?" at a glance:
project-level RAG with sub-status, a PM narrative, % complete + task health, budget
burn, top open RAID items, upcoming/overdue dates, and recent activity. It serves
**two equal purposes**: a live in-app cockpit (click-through to source views) and a
clean, printable status report for stakeholders.

## Layout — "Hybrid bands" (Layout C)

A full-width header band, then alternating full-width / two-up bands, top to bottom:

1. **Header band** — overall RAG (large), sub-status chips (Schedule / Budget / Scope),
   project title + report date, headline tiles (% complete, budget burn). Inline RAG
   override control.
2. **Narrative band** (full width) — editable PM "status summary" text + last-updated stamp.
3. **Progress / Budget band** (two-up) — left: % complete + R/A/G task-health counts;
   right: budget burn (budgeted vs actual cost/hours, cost performance, consumption).
4. **Registers band** (two-up) — left: Top open RAID items; right: Upcoming & overdue dates.
5. **Activity band** (full width) — recent activity / accomplishments.

Renders in portrait (reads like a document); prints via the existing `.print-root` path.

## Architecture & file boundaries

Logic and presentation are split so the logic meets the 70% coverage gate while the
`.tsx` presentation is excluded, matching the existing repo convention.

| File | Kind | Responsibility |
|------|------|----------------|
| `dashboard.ts` | new, pure logic | `computeDashboard(...)` → `DashboardModel`. Aggregates all sections. No React, no I/O. The primary testable unit. |
| `dashboard-panel.tsx` | new, presentation | Reads `useWorkspace()` + settings, calls `computeDashboard` via `useMemo`, renders Layout C inside `ReportCard`. Writes narrative / RAG overrides back via the context setter. |
| `dashboard-sections/header-band.tsx` | new | RAG + sub-status chips + headline tiles + override controls. |
| `dashboard-sections/narrative-band.tsx` | new | Editable status-summary text with updated-at stamp. |
| `dashboard-sections/registers-band.tsx` | new | Top RAID list + Upcoming/overdue list (click-through). |

**Reused as-is:** `health.ts` (`computeGroupHealth`, `Health`, `healthDot`), `budget-report.ts`
(`computeBudgetReport`), `raid.ts` (`isTerminalStatus`, `riskSeverityFromMatrix`),
`report-table.tsx` (`ReportCard`, `Section`, `Tile`, `PrintButton`), `activity-log.ts`
(`loadActivityLog`).

Files stay focused (target 200–400 lines, 800 max). Progress/Budget bands are simple
enough to live inside `dashboard-panel.tsx` using existing `Tile`/`Section`.

## Data model & persistence

One new nested field on `Workspace` (minimal serialization surface — mirrors `budgets`):

```ts
// types.ts
export type ProjectStatus = {
  ragOverride?: Health;        // overall; absent = use computed
  scheduleOverride?: Health;
  budgetOverride?: Health;
  scopeOverride?: Health;      // Scope has no data source → manual only
  narrative?: string;          // PM status summary
  narrativeUpdatedAt?: string; // ISO 8601, stamped on edit
};
```

`Workspace` gains `status?: ProjectStatus` (optional so older saved files still type-check;
every load path defaults to `{}`).

**Persistence — all formats (matches the budget bar):**

- **Type:** add `status?` to `Workspace` in `storage.ts`.
- **Defaults:** `emptyWorkspace()` sets `status: {}`; `migrateWorkspace*` defaults missing `status` to `{}`.
- **JSON:** include in `workspaceToJson` / extract+default in `jsonToWorkspace`.
- **CSV/MD:** new `# PROJECT STATUS` section written by `workspaceToCsv` and parsed by
  `splitCsvSections` + `csvToWorkspace` (key/value rows: one row per `ProjectStatus` field).
- **Turso:** persist alongside the other workspace data following the existing pattern.
- **Context:** `useWorkspace()` exposes `status` + a `setStatus`/`updateStatus(patch)` setter;
  `WorkspaceProvider` holds the state.

## How each section derives its value

All computed in `computeDashboard`; manual overrides from `ProjectStatus` take precedence
over the computed value and the computed value is surfaced as a hint when overridden.

- **Overall RAG** — `computeGroupHealth(all tasks).color`; `status.ragOverride` wins if set.
- **Schedule sub-status** — date-driven: **Red** if any task is overdue (`dueDate < today`,
  not completed); **Amber** if any task is due within the alert lead window (reuse the
  existing due-alert lead-days setting); else **Green**. `status.scheduleOverride` wins.
- **Budget sub-status** — from `computeBudgetReport().project`: **Red** if over budget
  (`consumedValue > budgetValue`); **Amber** if consumption ≥ **90%** of budget; else **Green**.
  If no budgets are configured → neutral `"—"`. `status.budgetOverride` wins.
- **Scope sub-status** — manual only; neutral until `status.scopeOverride` is set.
- **% complete + task health** — `completed / total` (completed = `completedDate` set);
  R/A/G counts from `computeGroupHealth(...).counts`.
- **Budget burn** — pass through `computeBudgetReport().project`: `budgetCost`/`cost`,
  `budgetHours`/`actualHours`, `costPerformance`, `consumption`.
- **Top RAID** — open items (`!isTerminalStatus(status, category)`), sorted by severity
  (Critical→Low; risks via `riskSeverityFromMatrix`), top **5**. Each links to the RAID register.
- **Upcoming & overdue** — non-completed tasks partitioned by `dueDate` vs `today`:
  overdue (past) and due-soon (today..+lead). Compact list, each links to the task.
  *This list is where Milestones (feature #2) will plug in.*
- **Recent activity** — `loadActivityLog().slice(-N)` (N default 8), newest first.

### DashboardModel (shape)

```ts
export type SubStatus = Health | null;   // null = neutral / not applicable

export type DashboardModel = {
  overall: { computed: Health; effective: Health; overridden: boolean };
  schedule: { computed: SubStatus; effective: SubStatus; overridden: boolean };
  budget: { computed: SubStatus; effective: SubStatus; overridden: boolean };
  scope: { effective: SubStatus };                 // manual only
  progress: { total: number; completed: number; percent: number; counts: Record<Health, number> };
  burn: { budgetCost: number; cost: number; budgetHours: number; actualHours: number;
          costPerformance: CciValue; consumption: CciValue } | null; // null if no budgets
  topRaid: RaidItem[];                             // already sorted + sliced
  overdue: Task[];
  dueSoon: Task[];
  recentActivity: ActivityEntry[];
  narrative: { text: string; updatedAt?: string };
};
```

## Navigation, printing, export

- **Nav:** add `"dashboard"` to the `AppView` union and to the **Overview** `NavGroup` as the
  **first** item (before `open-points`). Add a `LABEL_KEYS` mapping + i18n strings. The default
  landing view **stays `open-points`** (no behavior change for existing users). Mounted in
  `workspace-section.tsx` as `{activeTab === "dashboard" && <DashboardPanel ... />}`. The modern
  sidebar picks it up automatically from `NAV_GROUPS`.
- **Print:** reuse `ReportCard`'s built-in `PrintButton` + `.print-root`. Portrait.
- **Export:** v1 relies on **print → PDF** (existing path). The `status` object rides along in
  JSON/CSV/MD workspace exports automatically. Adding the dashboard to the DOCX/XLSX OOXML
  exporters is **deferred** (not in v1 scope).

## Error handling & edge cases

- **Empty workspace** (no tasks): overall computed health falls back to neutral Green;
  progress shows 0/0 → 0%; all lists empty; no crash.
- **No budgets configured:** budget sub-status and burn band render a neutral "no budget
  configured" state (`burn: null`).
- **Narrative:** trimmed on save; `narrativeUpdatedAt` stamped only when text actually changes.
  No length cap (free text), consistent with other notes fields.
- **Activity log caveat:** the log is localStorage-only and **not** part of the workspace
  export, so a printed report reflects only this machine's session history. Documented; acceptable for v1.
- All `computeDashboard` helpers handle empty input arrays.

## i18n

New keys for: nav label, section titles (Status summary, Progress, Budget burn, Top RAID,
Upcoming & overdue, Recent activity), sub-status labels (Schedule/Budget/Scope), the
"no budget configured" empty state, override-control labels, and the report date label.
Add to `i18n.ts` (en-US/en-GB) and `i18n.de.ts`. **`i18n.de.ts` must use straight ASCII
double-quote (`"`) delimiters** — verify after editing.

## Testing

- **`dashboard.test.ts`** (primary, AAA pattern):
  - overall health rollup; override precedence + `overridden`/`computed` reporting.
  - each sub-status threshold incl. no-budget neutral and the 90% Amber boundary.
  - % complete and R/A/G counts.
  - top-N RAID: terminal-status filtering, severity ordering, slice to 5.
  - overdue / due-soon partitioning at the `today` boundary (and the lead-window edge).
  - recent-activity slicing (newest first, capped at N).
  - empty-workspace and no-budget paths → neutral, no throw.
- **`storage.test.ts`**: round-trip the new `status` field through JSON and CSV/MD
  (including absent → `{}` migration).
- **`dashboard-panel` smoke test** (optional, `.tsx`): renders without crashing on an
  empty workspace and on a populated one.

## Out of scope (v1)

- Milestones (feature #2) and Earned Value / SPI-CPI (feature #3) — the Upcoming band and
  budget burn are designed to absorb them later.
- Dashboard in DOCX/XLSX/PPTX exporters.
- Historical snapshots / trend charts (a separate future feature).
- Multi-project portfolio rollup (app is single-workspace).
- Making the dashboard the default landing view.

## Assumptions (defaults chosen — flag if wrong)

- Budget Amber threshold = **90%** consumption.
- Top RAID list size = **5**; recent-activity size = **8**.
- "Due soon" reuses the existing due-alert **lead-days** setting.
- Default landing view stays **open-points**.
