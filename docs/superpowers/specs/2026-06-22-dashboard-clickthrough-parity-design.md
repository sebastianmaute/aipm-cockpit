# Dashboard Click-Through Parity (#9) — Design

**Date:** 2026-06-22
**Status:** Approved (design)
**Roadmap:** Final Tier-2 slice of the dashboard landing-cockpit roadmap (slices #1–#8 shipped).

## Goal

Make the Dashboard a true launchpad: every surfaced **entity** opens its specific
editor (item-level), and every non-entity **tile / sparkline / activity row**
launches its view (view-level). Resolves the documented asymmetry where
`onOpenRaid` / `onOpenMilestone` / `onOpenChange` dropped their id arg (only tasks
deep-linked). No new deep-link infrastructure.

## Background / current state

The item-level deep-link channel **already exists and is fully wired**:
`WorkspaceTabContext.requestOpen(view, id)` (`workspace-tab-context.tsx`) sets
`activeTab = view` + `pendingOpen = { view, id }`. Each entity panel consumes
`pendingOpen` in an effect and self-opens its editor:
- task → `task-manager.tsx` `openEditModal`
- RAID → `raid-panel.tsx` `openEdit`
- milestone → `milestones-panel.tsx` `setEditing`
- change → `change-panel.tsx` `openEdit` (guards aggregate id, e.g. 0 → view only)
- stakeholder → already wired

Action Center already routes through it (`task-manager.tsx` `openAction` →
`requestOpen(a.cta.view, a.cta.id)`). `requestOpen` is already destructured in
`workspace-section.tsx:187` (used for `requestOpen("stakeholders", id)`).

What's NOT wired to it: the Dashboard. Its `onOpenRaid` view-switches and drops the
id; `onOpenMilestone` / `onOpenChange` take no id at all; KPI tiles, Progress/Burn
tiles, the completion sparkline card, the Top Changes list, and the Recent Activity
list are static (non-interactive). The milestone horizon chips and RAID register
rows already carry specific ids but the wiring throws them away.

Dashboard IS in the axe `A11Y_VIEWS` 12-view gate.

## Architecture

Pure wiring + making static surfaces interactive. Three buckets.

### A. Item-level deep-links (reuse `requestOpen`)

`workspace-section.tsx` — rewire the three DashboardPanel handlers:
- `onOpenRaid={(id) => { requestOpen("raid", id); handleClearRaidTaskFilter(); if (workspaceCollapsed) setWorkspaceCollapsed(false); }}` — preserves the existing filter-clear + uncollapse side-effects, now also opens the specific item.
- `onOpenMilestone={(id) => requestOpen("milestones", id)}`
- `onOpenChange={(id) => requestOpen("changes", id)}`
- `onOpenTask` unchanged (already by-id via `onEditTask`).

`dashboard-panel.tsx` — widen prop types: `onOpenMilestone?: (id: number) => void`
and `onOpenChange?: (id: number) => void` (were `() => void`). `onOpenRaid?: (id:
number) => void` unchanged.

Pass real ids:
- **Milestone horizon chips** (`milestone-horizon-strip.tsx`): widen
  `onOpenMilestone?: (id: number) => void`; per-chip passes `e.milestone.id`. The
  "+N more" affordance is a bucket aggregate with no single id → passes sentinel
  `-1` (milestones panel finds nothing → switches view, opens no modal: a clean
  view-level launch). Panel passes `props.onOpenMilestone` straight through.
- **Top Changes rows** (`dashboard-panel.tsx`): each currently-static `<li>` becomes
  a `<button>` → `props.onOpenChange?.(c.id)`, with a row-unique aria-label.
- **RAID register rows** (`registers-band.tsx`): already call `onOpenRaid(r.id)` —
  no component change; the workspace-section rewire makes them open the item.
- **Delta strip** (`dashboard-delta-strip.tsx`): chips are AGGREGATES ("2 milestones
  changed") with no single id → milestone/change chips stay view-level. The strip's
  handler signatures (`() => void`) are unchanged; the panel adapts:
  `onOpenMilestone={props.onOpenMilestone ? () => props.onOpenMilestone!(-1) : undefined}`,
  same for change. RAID/task delta chips keep their existing rep-id behavior
  (`onOpenRaid(model.topRaid[0]?.id ?? -1)`, rep task) — which now actually opens the
  item. No delta-strip-internal change.

### B. View-level tile launches (`onNavigate`)

`report-table.tsx` `Tile` — add optional `onActivate?: () => void` +
`activateLabel?: string`. When `onActivate` present, render the tile as a real
`<button type="button" aria-label={activateLabel} onClick={onActivate}>` carrying the
same visual classes plus `w-full text-left hover:border-AIPM-dark-blue
focus-visible:ring-1 focus-visible:ring-AIPM-green`; absent → current `<div>`
(back-compat: reports' tiles omit it). Keyboard + accessible name → axe-safe.

`dashboard-panel.tsx` (`onNavigate` already a prop, wired to `setActiveTab`):
- KPI strip: Complete% → `open-points`, Overdue → `open-points`, Open RAID → `raid`.
- Progress tiles → `open-points`; Budget-burn tiles → `budget`.
- Completion-trend sparkline card → wrap as a `<button>` → `onNavigate(tursoActive
  ? "trends" : "open-points")` with an aria-label (the sparkline SVG stays the inner
  graphic; the card is the control).

All gated on `props.onNavigate` being present (popout passes it too, but harmless —
popouts already get `onNavigate` from workspace-section; if undefined, tiles render
non-interactive).

### C. Recent-activity rows (view-level by kind)

New pure i18n-free module `dashboard-activity-nav.ts`:
```ts
import type { ActivityKind } from "./activity-log";
import type { AppView } from "./nav-config";
export function activityViewOf(kind: ActivityKind): AppView | null;
```
Mapping by prefix: `task.` → `"open-points"`, `raid.` → `"raid"`, `milestone.` →
`"milestones"`, `change.` → `"changes"`, `stakeholder.` → `"stakeholders"`; every
other prefix (bulk/jira/absence/shift/resource/role/settings/doc/history) → `null`.

`dashboard-panel.tsx` recent-activity list: for each entry, if
`activityViewOf(e.kind)` is non-null AND `onNavigate` present → render a `<button>` →
`onNavigate(view)` with a row-unique aria-label; else the current static span.

### Wiring summary

- `workspace-section.tsx`: three handler rewrites (above). No new prop.
- `dashboard-panel.tsx`: widened prop types; pass ids; clickable tiles/sparkline/
  changes/activity.
- No `task-manager.tsx` change (handlers built in workspace-section).

## i18n (EN + DE, key parity tsc-enforced; DE via node utf8 write, real umlauts)

New keys:
- `dashboardOpenTasksView` ("Open the tasks list")
- `dashboardOpenRaidView` ("Open the RAID register")
- `dashboardOpenBudgetView` ("Open the budget")
- `dashboardOpenTrendsView` ("Open trends")
- `dashboardOpenChangeItem` ("Open change {0}") — 0-based positional arg
- `dashboardActivityOpenView` ("Open {0}") — {0} = the target view's nav label

Aria-labels for KPI/progress tiles reuse the above view-open keys; the changes-row
label uses `dashboardOpenChangeItem` with the change title; activity-row label uses
`dashboardActivityOpenView` with the resolved nav label (`t(lang, navLabelKey)`).

## Error handling

- Sentinel ids (`-1`, aggregate change id) → `requestOpen` switches the view; the
  target panel's `pendingOpen` effect finds no matching entity → opens no modal. Safe
  view-level launch, never a crash or wrong-item open.
- `activityViewOf` is total (returns `null` for unmapped kinds) — never throws; the
  row simply stays non-interactive.
- Every interactive surface gated on its handler/`onNavigate` being present — when
  absent (e.g. a stripped render), it degrades to a non-interactive element.

## Testing

- `dashboard-activity-nav.test.ts` — each entity prefix → its view; unmapped kinds →
  null; exhaustive over the `ActivityKind` union.
- `report-table.test` (Tile) — with `onActivate` renders a `button` with the
  `activateLabel` accessible name and fires onActivate on click; without it renders a
  non-interactive element (no `button` role).
- `milestone-horizon-strip.test` — a chip click calls `onOpenMilestone` with that
  milestone's id; "+N more" calls it with `-1`.
- `dashboard-panel.test.tsx` — KPI Overdue tile click → `onNavigate("open-points")`;
  Open RAID tile → `onNavigate("raid")`; a Top Changes row click →
  `onOpenChange(<that id>)`; a `task.*` activity row click → `onNavigate("open-points")`;
  a `settings.updated` activity row is non-interactive; sparkline card click →
  `onNavigate` (trends when tursoActive).
- a11y: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` green
  before push (every new control is a `<button>` with a row-unique accessible name).
- `npx tsc --noEmit` (i18n parity + test-only type errors), `npm run lint`
  (`--max-warnings=0`), `npm run test:run`.

## Release

Bump `version.ts` (APP_VERSION 0.124.0 + new milestone codename),
`CHANGELOG.md` entry, append `versionHighlightClickThrough` to `APP_HIGHLIGHT_KEYS` +
EN/DE strings, README badge, `package.json` version.

## AGENTS.md

Flip the chip-routing-asymmetry landmine: the Dashboard now deep-links RAID /
milestone / change to the specific item via `requestOpen(view, id)` (aggregate
delta-strip + "+N more" chips intentionally stay view-level via sentinel `-1`). Note
the new `Tile.onActivate`/`activateLabel` clickable variant and the pure
`activityViewOf` helper.

## Decisions

- Recent-activity rows: **view-level by kind prefix** (robust; doesn't depend on
  parsing an entity id out of `args`). Unmapped kinds stay static.
- Clickable tiles: **KPI strip + Progress/Burn + completion sparkline** (all three).
- Delta-strip aggregate chips + horizon "+N more": **view-level** via sentinel `-1`
  (no single entity to open).
- No new `requestOpen`-style channel — the existing one covers every entity.

## Out of scope

Deep-linking that scrolls/highlights a specific row WITHIN a destination view (beyond
opening its editor); parsing entity ids out of activity `args` for item-level activity
deep-links; click-through on surfaces outside the Dashboard.
