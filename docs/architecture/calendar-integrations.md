# `useCalendarIntegrations` — Outlook calendar orchestration

**Source:** `src/app/use-calendar-integrations.ts` · **Extracted from** `task-manager.tsx` (Phase 3, move-only).

## Purpose
Single home for ALL Microsoft Graph (Outlook) calendar write-back and two-way pull
wiring: milestones + steering committee (manual push/pull) and the four two-way
entities task / raid / change / absence (manual push/pull **plus** the 15-min
background auto-pull and content-key auto-push). Keeps `task-manager.tsx` free of
the ~50 calendar hooks/derivations.

## Interface
`useCalendarIntegrations(deps: CalendarIntegrationDeps)` — a **deps-object hook**
(see AGENTS.md "Extraction conventions"). `deps` is the live render-scope closure
it reads each render: `isPopout`, `settings`, `m365Enabled`, `portfolioCurrentId`,
`project`, `lang`, `today`, `logActivity`, `setSettings`, and each entity's live
array + setter (`milestones`/`setMilestones`, `steeringCommittee`/`setSteeringCommittee`,
`tasks`/`setTasks`, `raid`/`setRaid`, `changes`/`setChanges`, `absences`/`setAbsences`).
Returns the per-entity push/pull/enabled/busy handlers + pushable lists that
task-manager threads into the `EntityCalendarProps` bags and the pull-summary modals.

## Invariants
- **Called unconditionally**, before task-manager's single return (react-hooks
  purity — a `.ts` hook may receive refs; a plain fn may not).
- Returned handlers are **NOT memoized** — they read live render-scope every call.
- **Popout = read-only**: every push/pull no-ops when `isPopout`.
- Background auto-pull is **silent** (non-interactive token, no toasts except a
  deduped conflict-count toast) and never opens the summary modal.
- Milestone stays flat/manual (no enable toggle); the four two-way entities use the
  generic `useEntityCalendarPush`/`useEntityCalendarPull` under the hood.

## Coverage
This file is a render-scope UI-glue hook and is **excluded from the coverage gate**
(`vitest.config.ts` `coverage.exclude`). Behavior is validated via
`task-manager.characterization.test.tsx` (prop-threading contract), the generic
`use-entity-calendar-{push,pull}.test.tsx`, `use-calendar-auto-pull.test.tsx`, and
the pure engines it calls (`calendar-pull.ts`, `calendar-reconcile.ts`), which stay
gated. See AGENTS.md "Calendar write-back engine" + "Two-way calendar sync" sections
for the full behavioral spec.
