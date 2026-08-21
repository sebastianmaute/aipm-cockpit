# Milestones — Design

**Date:** 2026-06-02
**Status:** Approved design (pre-implementation)
**Roadmap position:** Feature #2 of 3 — Health Dashboard ✅ (v0.43.0, MR !25) → **Milestones** → Earned Value (SPI-CPI).

## Goal

Add **milestones** — zero-duration key dates, distinct from tasks — as a first-class
entity. They render as diamonds on the Gantt (with edges from the tasks that gate them),
are managed in a dedicated Milestones view, and surface on the health dashboard. Linked
tasks drive an "at risk" signal when gating work will finish after the milestone date.

## Data model

```ts
// types.ts
export type Milestone = {
  id: number;
  name: string;
  date: string;            // YYYY-MM-DD target date
  description?: string;
  achievedDate?: string;   // manual sign-off; absent = pending (mirrors Task.completedDate)
  linkedTaskIds: number[]; // tasks that gate this milestone (drive edges + at-risk)
  localModifiedAt?: string;
};
// Workspace gains:  milestones?: Milestone[]
```

- **Achieved** is a manual sign-off (`achievedDate`), NOT auto-derived from linked tasks.
- **Owner** is intentionally out of scope (additive later).
- `linkedTaskIds` mirrors the existing `RaidItem.linkedTaskIds` pattern (same task-picker reuse).

## Derived status (pure logic — new `milestones.ts`)

One status per milestone, precedence top-down (first match wins):

1. **achieved** — `achievedDate` set.
2. **overdue** — `date < today` and not achieved → contributes **Red** to Schedule.
3. **at-risk** — not achieved, and at least one linked task's effective end
   (`completedDate || dueDate`) is `> date` → contributes **Amber**. Catches a plan
   inconsistency the task-only logic misses (e.g. a gating task due after its milestone).
4. **due-soon** — not achieved/overdue/at-risk, and within the workday window
   (`workdaysUntil(date, today) <= leadWorkdays`) → contributes **Amber**.
5. **on-track** — otherwise.

`milestones.ts` exports (all pure, unit-tested):
- `isAchieved(m): boolean`
- `milestoneStatus(m, tasksById, todayISO, holidaySet, leadWorkdays): MilestoneStatus`
  (`"achieved" | "overdue" | "at-risk" | "due-soon" | "on-track"`)
- `isAtRisk(m, tasksById): boolean` (not achieved && some linked task effective-end > date)
- `partitionMilestones(milestones, tasksById, todayISO, holidaySet, leadWorkdays)`
  → `{ overdue: Milestone[]; atRisk: Milestone[]; dueSoon: Milestone[] }` (each sorted by date then id; achieved excluded)
- `milestoneScheduleContribution(milestones, tasksById, todayISO, holidaySet, leadWorkdays)`
  → `"R" | "A" | null` (overdue→R, at-risk/due-soon→A, else null)
- `sortMilestones(milestones)` → by date then id

`leadWorkdays` defaults to the dashboard's `dueSoonWorkdays` (3), passed in by callers.

## Persistence

New `milestones?: Milestone[]` on `Workspace`, threaded exactly like `budgets` (the
established precedent — `linkedTaskIds` serializes as a number array like RAID's):

- `types.ts` — `Milestone` type.
- `sanitize.ts` — `sanitizeMilestone(input: unknown): Milestone | null` (id/name/date required, valid `linkedTaskIds` number array, optional description/achievedDate/localModifiedAt).
- `storage.ts` — `Workspace.milestones?`; `emptyWorkspace()` → `[]`; `migrateWorkspaceV6` defaults missing `milestones` to `[]`; `MILESTONES_CSV_COLUMNS = ["id","name","date","description","achievedDate","linkedTaskIds","localModifiedAt"]`; `# MILESTONES` CSV section (encode/decode via the existing column helpers + `splitCsvSections`); `## Milestones` Markdown section; JSON include/extract.
- `turso-schema.ts` — one `spec<Milestone>({ table: "milestones", wsKey: "milestones", columns: MILESTONES_CSV_COLUMNS, ... })` entry in `ENTITY_SPECS` (DDL/select/insert generated generically).
- `workspace-context.tsx` — `milestones` / `setMilestones`.
- `use-storage-backend.ts` — load (`setMilestones(workspace.milestones ?? [])`) + every save payload + auto-save deps.
- `activity-log.ts` — `milestone.created` / `milestone.updated` / `milestone.deleted` kinds + their i18n keys.

## Surfaces

### a. Milestones view (new)

A dedicated view (sortable key-dates list) built on the `report-table` kit
(`ReportCard` / `useSortableFilter` / `SortHeaderButton` / `TableFilter`):
columns name / date / status (status shows ⚠ for at-risk, a check for achieved).
`+ Add milestone`, click-row-to-edit, delete (confirm), and a quick "mark achieved"
toggle (sets `achievedDate = today`, mirroring the task-complete toggle; untoggle clears).

`MilestoneEditModal` (following the absence/shift modal pattern): name, date,
description, achieved sign-off, and a **linked-tasks multi-select** reusing the RAID
`linkedTaskIds` task-picker. Validation: name + date required; invalid → inline error.

### b. Gantt

Milestones render as **own rows** (Option A): a diamond at `date`, interleaved with task
rows sorted by date. Milestones join the Gantt's date-range computation.
- **Edges** drawn from each linked task → the milestone diamond (finish-to-milestone).
- **At-risk** diamonds get a warning ring; **achieved** render filled/greyed; pending render open.
- `+ Add milestone` on the toolbar (beside Add task); click a diamond → `MilestoneEditModal`.
- **Scope guard:** milestones are NOT inserted as nodes into the existing task
  critical-path algorithm (it stays task-to-task); the edges + at-risk ring give the
  traceability without reworking critical-path. (Deferred enhancement.)

### c. Dashboard

- `computeDashboard` gains a `milestones` input. It builds a `tasksById: ReadonlyMap<number, Task>`
  internally from `input.tasks` and passes it to the milestone helpers (which all take
  `tasksById` for linked-task lookup).
- New `DashboardModel` fields: `overdueMilestones`, `atRiskMilestones`, `dueSoonMilestones`
  (exactly the three buckets `partitionMilestones` returns — `overdue` / `atRisk` / `dueSoon`).
- `RegistersBand` gains a **Milestones subsection** (overdue / at-risk / upcoming, ◆-marked,
  at-risk flagged ⚠), click-through to the Milestones view.
- `computeScheduleStatus` folds in `milestoneScheduleContribution` (worst-of with the
  task signal; `status.scheduleOverride` still wins).

## Navigation & i18n

- New `"milestones"` `AppView` in the **Plan** group, right after Gantt
  (`[gantt, milestones, resources, budget]`); `LABEL_KEYS` entry; a `nav-icons.tsx`
  `ICON_PATHS` diamond entry (required — `ICON_PATHS` is `Record<AppView, string>`).
- Mounted in `workspace-section.tsx` (`{activeTab === "milestones" && <MilestonesPanel .../>}`).
- Milestone i18n keys EN (`i18n.ts`) + DE (`i18n.de.ts`, **straight ASCII `"` delimiters** — verify after edit).

## Error handling & edge cases

- Date required (a milestone without a valid `date` is rejected by `sanitizeMilestone`, like task `dueDate`).
- Achieved milestones are excluded from overdue/at-risk/due-soon and from the Schedule contribution.
- A `linkedTaskId` pointing at a deleted task is simply ignored in lookups (no crash, no edge).
- Empty milestones → no dashboard subsection, no Gantt rows, empty-state in the Milestones view.
- All `milestones.ts` helpers handle empty inputs.

## Testing

- **`milestones.test.ts`** (primary, AAA): `milestoneStatus` precedence (achieved > overdue >
  at-risk > due-soon > on-track), at-risk via linked-task effective-end at the boundary,
  achieved-exclusion, `partitionMilestones` buckets + sort, `milestoneScheduleContribution`
  mapping, deleted-linked-task tolerance, empty inputs.
- **`storage` round-trip** for `milestones` across JSON / CSV / Markdown / Turso (incl.
  `linkedTaskIds` arrays and a milestone with a description containing a comma).
- **`dashboard.test.ts`** extended: milestone subsection fields + `computeScheduleStatus`
  with an overdue/at-risk milestone driving Red/Amber.
- **Smoke tests:** Gantt renders a milestone diamond + edge without crashing; Milestones
  view renders empty + populated.

## Out of scope (v1 / later)

- Owner on milestones.
- Milestones as nodes in the critical-path algorithm.
- Auto-derived "achieved" from linked-task completion.
- Milestones in the DOCX/XLSX exporters (print via the existing report/Gantt path only).

## Assumptions (defaults — flag if wrong)

- "Due soon" / at-risk window reuses the dashboard `dueSoonWorkdays` (3 working days).
- Top of the Milestones subsection on the dashboard is not capped (typical milestone counts are small); if needed, cap at a constant later.
- New `"milestones"` view is added but the default landing view is unchanged.

## Dependency / branching

Builds directly on feature #1 (`dashboard.ts`, `dashboard-sections/registers-band.tsx`,
`computeScheduleStatus`), which is in open **MR !25** (not yet merged). The implementation
branch will **stack on `feat-health-dashboard`** unless !25 merges to `main` first —
decided at implementation time.
