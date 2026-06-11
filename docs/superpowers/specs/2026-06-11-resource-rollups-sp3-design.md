# Resource Rollups SP3 — Design

**Date:** 2026-06-11 · **Status:** Approved, ready for implementation plan
**Branch:** `feat-resource-rollups-sp3` · **Target version:** 0.64.0 (new minor — UI capability)
**Predecessors:** SP1 (`ResourcePicker`, 0.62.0), SP2 (pickers on RAID/shift/stakeholder, 0.63.0).

## Context

SP1/SP2 made people resource-linkable: tasks, absences, shifts, RAID owners, and
stakeholders now carry a Resource FK set via the picker. The workload/people view
(`buildResourceWorkload` → the "workload" table in `resources-panel.tsx`) already
aggregates per resource — open/overdue task counts, weekly shift hours, upcoming
absences — by resolving each record to a resource via `resolve(resourceId, name,
email)` (FK first, case-folded name fallback), bucketing into **managed** (linked)
and **unlinked** (free-text, no match) rows.

`RaidItem.ownerResourceId` (set via SP2's RAID-owner picker) is currently
**stored but unconsumed** — no view reads it. SP3 consumes it: the workload view
gains a per-resource "open RAID owned" count.

This is SP3 of the four-part decomposition (SP1 ✅ / SP2 ✅ / SP3 this / SP4 retire
contacts store). It is the first slice to *read* the ownership FKs rather than set
them.

## Decision (from brainstorming)

Scope = **RAID-owned count in the workload view** (the focused option). NOT:
severity RAG breakdown, changes-owned (no single-owner FK — changes use
`stakeholderIds`), RAID/task table display-authority, or SP4 contacts work.

## Design

### 1. Aggregation — `src/app/resource-workload-rows.ts`

- `WorkloadRowBase` gains `raidOpenCount: number` (initialized `0` in both the
  managed-row and unlinked-row constructors, alongside `openCount`).
- `buildResourceWorkload` gains a parameter `raid: readonly RaidItem[]` (placed
  after `shifts`, before `today`).
- New aggregation loop (mirroring the tasks loop): for each RAID item, skip if it
  is terminal (`isTerminalStatus(item.status, item.category)` from `./raid` — the
  existing category-aware helper), else `resolve(item.ownerResourceId, item.owner
  ?? "", item.ownerEmail)` and, if non-null, increment `row.raidOpenCount`.
- Unlinked owners (free-text `owner` with no `ownerResourceId` and no name match)
  fall into the existing **unlinked** bucket via `ensureUnlinked` — no new bucket
  logic. RAID items with no owner string and no FK → `resolve` returns null → skipped.
- The doc comment at the top of the function updates to mention RAID ownership as
  a fourth contributor (task/absence/shift/raid).

`resolve` already accepts `(resourceId: number | null | undefined, assignee:
string, email?: string)` — `RaidItem.ownerResourceId` is `number | null`, so it
passes directly with no coalesce.

### 2. Workload table — `src/app/resource-workload.tsx`

The workload table is the `ResourceWorkload` component in `resource-workload.tsx`
(it owns the `WORKLOAD_COL_WIDTHS` width map and the `WorkloadCol` union, and
calls `buildResourceWorkload(resources, tasks, absences, shifts, today)` in a
`useMemo` at ~line 57). Changes here:

- The component gains a `raid: readonly RaidItem[]` prop and passes it as the new
  `buildResourceWorkload` argument (and adds `raid` to that useMemo's deps).
- Add `"openRaid"` (or similar) to the `WorkloadCol` union and `WORKLOAD_COL_WIDTHS`
  with a sensible default width — following the exact pattern of the existing
  workload columns so the resizable-column + reset-widths wiring (`useColumnResize`)
  covers it automatically.
- Add an "Open RAID" header cell (new i18n key `workloadOpenRaid`, EN + DE) using
  the existing header styling, and a numeric body cell rendering `row.raidOpenCount`
  for both managed and unlinked rows, placed adjacent to the open/overdue columns.

### 3. Data flow / threading

`raid` is NOT currently available to the workload component (it only receives
`tasks`/`absences`/`shifts`). Thread it: `resource-workload.tsx` gains the `raid`
prop (above); `resources-panel.tsx` — which renders `<ResourceWorkload tasks=...
absences=... shifts=... />` and declares `tasks`/`absences`/`shifts` on
`ResourcesPanelProps` — gains a `raid: readonly RaidItem[]` prop and forwards it;
`workspace-section.tsx` (which renders `ResourcesPanel` and already has `raid`
from `useWorkspace()`) passes `raid={raid}`. No schema change, no serializer
change, no new persisted state, no Turso impact. Golden fixtures unchanged.

(If `ResourceWorkload` is also rendered in a popout/secondary path, that site
must pass `raid` too — the plan must grep all render sites; `tsc` will catch a
missed one since the prop is required.)

## Testing

Extend `src/app/resource-workload-rows.test.ts`:

- A resource owning two open RAID items (one by `ownerResourceId`, one by owner
  name) → `raidOpenCount === 2` on its managed row.
- A terminal/closed RAID item owned by a resource is NOT counted.
- A free-text RAID owner with no matching resource → an unlinked row with
  `raidOpenCount === 1`.
- FK precedence: a RAID item whose `owner` string mismatches but whose
  `ownerResourceId` points at a resource counts for that resource (not unlinked).
- A RAID item with neither owner nor FK is skipped (no crash, no phantom row).

If a workload-table render test exists, assert the "Open RAID" column renders the
count; otherwise the aggregation tests + tsc/lint cover it.

## Out of scope

- Severity RAG breakdown of owned RAID.
- Changes-owned rollup (no single-owner FK).
- RAID/task list-table display-authority (showing linked resource current names).
- SP4: retiring the contacts store, re-pointing Jira/Outlook seeding.

## Verification

`npx tsc --noEmit`, `npm run lint` (--max-warnings=0), full `npx vitest run`,
`npm run build`, golden-workspace fixtures unchanged (no serializer touched).
Manual: in the workload view, a resource who owns an open RAID item shows a
non-zero "Open RAID"; closing that RAID drops the count; a RAID with a free-text
owner shows under an unlinked row.
