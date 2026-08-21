# Percent/Hours Utilization-Mode Toggle (0.14.1) — Design

**Date:** 2026-05-27
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.14.1-utilization-mode-toggle`

## Problem

Resources have a per-resource `utilizationMode` (`"percent" | "hours"`), and the planning grid reads it (to set the number input's step), but **no UI control ever calls** the wired-but-unused `onSetUtilizationMode` handler. So every resource is stuck in the default `"percent"` mode with no way to switch.

## Goal

Add a single **percent/hours toggle** to the planning header, next to the month/week granularity control. It is a **global** switch: it sets the mode for **all** resources at once and **converts** the entered utilization values between units so the plan stays meaningful.

## Components

### 1. Pure conversion helper — `convertUtilization` (in `resource-capacity.ts`)

```
convertUtilization(
  util: Record<string, number>,
  fromMode: "percent" | "hours",
  toMode: "percent" | "hours",
  periods: readonly Period[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
): Record<string, number>
```

- If `fromMode === toMode`, return `util` unchanged.
- For each `periodKey` in `util`: find the matching `Period` in `periods` (by `key`). Compute `possible = workdaysInRange(period.start, period.end, holidaySet) * workdayHours` (gross working hours, holidays excluded; **absence NOT subtracted** — see "Conversion basis").
  - `percent → hours`: `Math.round(value / 100 * possible)`.
  - `hours → percent`: `possible > 0 ? Math.round(value / possible * 100) : 0`.
- Keys with **no matching period** (e.g. stale keys outside the current window) keep their value unchanged.
- Returns a NEW object (immutable). Unit-tested.

**Conversion basis (decision):** the factor is **gross** possible working hours (`workdays × workdayHours`), not net-of-absence. Rationale: hours-mode already subtracts absence in its own capacity formula (`max(0, value − absence)`), so a net-of-absence factor would double-count absence and would not round-trip. Consequence: conversion is exact for periods without absence and round-trips (`p→h→p ≈ p`); in periods that have an absence, net capacity can shift slightly because percent-mode and hours-mode apply absence differently — a pre-existing property of the two modes, not introduced here.

### 2. Bulk handler — `handleSetAllUtilizationMode(mode)` (in `use-resource-planner.ts`)

- No-op if every resource already has `mode` (avoid a needless stamp/update).
- Otherwise, ONE immutable `setResources`: for each resource, `{ ...r, utilizationMode: mode, utilization: convertUtilization(r.utilization, r.utilizationMode, mode, canonicalPeriods, workdayHours, holidaySet), localModifiedAt: stamp }`.
- The planner needs `workdayHours` + `holidaySet` (it currently has neither): add them to `UseResourcePlannerArgs` and pass them at the `useResourcePlanner({...})` call in `task-manager.tsx` (both are already in scope there). `plan` is available via `useWorkspace()`; canonical periods = `generatePeriods(plan.startDate, plan.endDate, plan.granularity)`.
- Expose `handleSetAllUtilizationMode` from the hook; thread to the panel as `onSetAllUtilizationMode`, wrapped in `guardEdit` at the task-manager call site like the other resource handlers.

### 3. The toggle — planning header (`resources-panel.tsx`)

- A `SegmentedControl<"percent" | "hours">` rendered immediately after the existing month/week `SegmentedControl` (~line 325).
- `value` = the resources' shared mode: if all resources have the same `utilizationMode`, use it; if there are none (or somehow mixed), default `"percent"`. (Because the toggle always sets all, resources stay uniform after any use.)
- `onChange={(mode) => onSetAllUtilizationMode(mode)}`.
- Add a new prop `onSetAllUtilizationMode: (mode: "percent" | "hours") => void` to the panel's props.
- The existing per-resource `onSetUtilizationMode` prop stays as-is (still wired, now joined by the bulk one); it is fine if it remains uncalled.

## i18n (EN + DE)

New keys (both dicts): `resourcesUtilModePercent` ("Percent"), `resourcesUtilModeHours` ("Hours"), and `resourcesUtilModeHint` (SegmentedControl title, e.g. "Switch all resources between percent and hours; entered values are converted.").

## Non-goals

- No change to the capacity/cost engine formulas or the absence model.
- No per-resource mode UI (explicitly chosen global).
- No schema/sanitize/storage changes (`utilizationMode`/`utilization` already persist).

## Edge cases

- Zero-capacity period (`possible === 0`): `hours→percent` yields `0`; `percent→hours` yields `0`.
- No resources: toggle shows `"percent"`, handler no-ops.
- Utilization key not in the current plan window: value left unchanged (not lost).
- Rounding: values are rounded to whole numbers (consistent with the integer-ish inputs); round-trip is within rounding tolerance.

## Testing

- **Unit (`resource-capacity.test.ts`):** `convertUtilization` — percent→hours (100% of a known-workday month → expected hours), hours→percent, round-trip stability, zero-capacity period → 0, unmatched key kept, same-mode no-op (returns input).
- **Planner (`use-resource-planner.test.tsx`):** `handleSetAllUtilizationMode("hours")` sets every resource's mode to hours and converts values; no-op when already uniform.
- **Panel (`resources-panel.test.tsx`):** the percent/hours toggle renders in the planning header and calls `onSetAllUtilizationMode` with the chosen mode; its value reflects the resources' shared mode.

## Release

Small feature → **0.14.1** (patch within the "Atwood" milestone; keep codename). Bump `version.ts`, add a `[0.14.1]` CHANGELOG entry, update `docs/CODEMAPS/{frontend,data}.md` (`convertUtilization`, the toggle, the bulk handler). Gates: lint 0, tsc 0, `test:coverage` green (≥70%).
