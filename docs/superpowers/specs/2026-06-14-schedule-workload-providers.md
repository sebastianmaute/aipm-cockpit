# Schedule/EVM + Workload Action Providers — Design

**Date:** 2026-06-14
**Status:** Approved (brainstorming complete)
**Branch:** `feat-schedule-workload-providers`

## Goal

Add two new providers to the suggested-next-actions engine (SP-adjacent, additive): a **schedule/EVM** provider (project trending behind schedule) and a **workload** provider (resources over-allocated or carrying overdue overload). Both surface signals nothing else in the queue covers.

## Context (verified)
- Provider shape: `{ moduleId?, provide(input: ActionInput): SuggestedAction[] }`; registered in `ALL_PROVIDERS` (`next-actions/index.ts`). Engine re-bands tier from score, dedups by id, filters `dismissed`.
- `ActionInput.dashboard: DashboardModel` already carries `schedule: {computed, effective, overridden}` (Health RAG), `evm: EvmMetrics` (`spi: number|null`, `cpi`), `burndown: BurndownSeries|null`. So the schedule provider needs NO new input (like `budgetProvider`).
- `buildResourceWorkload(...)` (`resource-workload-rows.ts`) → `WorkloadResult { managed: ManagedWorkloadRow[], unlinked }`; each row has `overdueCount`, `openCount`, `resource`. Planned utilization lives on `plan` (`r.utilization` per period) via `resource-capacity.ts` (`generatePeriods`/`convertUtilization`).
- Adding a REQUIRED `ActionInput` field breaks every provider test's `input()` helper → the new field MUST be OPTIONAL with a default (mirrors `taskDueEnabled?`).

## §1 — `schedule` provider (core, no new input)

`src/app/next-actions/providers/schedule.ts` — `moduleId: undefined` (core, always-on).
- Reads `input.dashboard.evm.spi` + `input.dashboard.schedule.effective` + `input.dashboard.burndown`.
- Fires ONE project-level action when the project is trending behind, using the **trend** signal (NOT a re-summary of overdue tasks/milestones — those are already emitted by task-due/milestone):
  - `spi != null && spi < 0.9` → action. Score scales with how far below: `spi < 0.8` lands in the `now` band, `0.8–0.9` in `soon` (via `ACTION_WEIGHTS` urgency/risk; engine re-bands from score).
  - (Optional, additive) if `spi == null` but `burndown` shows the latest actual trailing the ideal by a margin, fire a softer (monitor/soon) action. Keep simple: SPI is the primary trigger; burndown is a fallback only when SPI is null.
- `id: "schedule:project:spi"` (stable, one per project). `title: actionScheduleTitle [projectName]`. `why: actionScheduleWhyBehind [spi formatted]` (or `actionScheduleWhyBurndown`). `cta: { kind:"open", view:"dashboard", id:0 }`. Source `"schedule"`.
- Healthy project (spi ≥ 0.9 or null with no burndown gap) → emits nothing.

## §2 — `workload` provider (moduleId `resources`)

`src/app/next-actions/providers/workload.ts` — `moduleId: "resources"`.
- Consumes a NEW optional `input.workloadAlerts` (see §3). Maps each alert → one action:
  - `reason: "over-allocated"` → `title: actionWorkloadTitle [resourceName]`, `why: actionWorkloadWhyOverAllocated [value%]`, score from `ACTION_WEIGHTS.risk` scaled by how far over 100%.
  - `reason: "overload"` → `why: actionWorkloadWhyOverload [overdueCount]`, score from `ACTION_WEIGHTS.urgency` scaled by count.
  - `id: "workload:<resourceId>:<reason>"`. `cta: { kind:"open", view:"workload", id: resourceId }`. Source `"workload"`.
- Empty `workloadAlerts` → nothing.

## §3 — `WorkloadAlert` + pre-computation (surface)

New pure helper `src/app/next-actions-workload.ts`:
```ts
export interface WorkloadAlert {
  resourceId: number;
  resourceName: string;
  reason: "over-allocated" | "overload";
  value: number;            // utilization % (over-allocated) | overdue count (overload)
}
export function buildWorkloadAlerts(args: {
  workload: WorkloadResult;          // from buildResourceWorkload
  resources; plan; periods/util inputs;  // for the over-allocation check (resource-capacity)
  today: string;
  overdueThreshold?: number;         // default e.g. 3
}): WorkloadAlert[];
```
- **overload**: each managed row with `overdueCount >= overdueThreshold` → one `overload` alert (`value = overdueCount`).
- **over-allocated**: for each resource, resolve its near-term planned utilization % (next 1–2 periods) via `resource-capacity` (handle percent/hours modes); if `> 100` → one `over-allocated` alert (`value = util%`). De-dup: at most ONE alert per (resource, reason); a resource can have both reasons (two alerts) — acceptable (distinct concerns).
- Pure + unit-tested. The surface (task-manager) calls it once and passes the result.

`ActionInput` gains `workloadAlerts?: readonly WorkloadAlert[]` (OPTIONAL). `buildActionInput` defaults it to `[]`. `next-actions/types.ts` imports `WorkloadAlert` (from `../next-actions-workload`).

## §4 — Wiring, i18n, version, testing

- **types:** `ActionSource += "schedule" | "workload"`. `ActionInput.workloadAlerts?`.
- **index.ts:** register `scheduleProvider`, `workloadProvider` in `ALL_PROVIDERS` (deterministic order — after budget, before stakeholder-comms, or at the end).
- **next-actions-input.ts:** `buildActionInput` accepts + passes `workloadAlerts` (default `[]`).
- **task-manager.tsx:** compute `workloadAlerts = buildWorkloadAlerts({...})` (reuse the existing workload + plan data already in scope for the Resources views) and pass into `buildActionInput`. Memoize.
- **action-row source labels:** add `schedule`/`workload` to `SOURCE_LABEL` in `action-row.tsx` (`actionSourceSchedule`/`actionSourceWorkload`).
- **i18n (EN+DE, real umlauts):** `actionScheduleTitle`, `actionScheduleWhyBehind` (`"Behind schedule — SPI {0}"`), `actionScheduleWhyBurndown`, `actionWorkloadTitle`, `actionWorkloadWhyOverAllocated` (`"Over-allocated — {0}% planned"`), `actionWorkloadWhyOverload` (`"{0} overdue items"`), `actionSourceSchedule` ("Schedule"), `actionSourceWorkload` ("Workload"), + `versionHighlightScheduleWorkload`.
- **score.ts:** reuse existing weights; if a clean scale needs a constant, add to `ACTION_WEIGHTS` (additive, documented). No tier hard-coding (engine re-bands).
- **Version:** **0.80.0** "Kress" (Nancy Kress) — new providers → minor + codename + CHANGELOG + `versionHighlightScheduleWorkload` in `APP_HIGHLIGHT_KEYS`.
- **Testing:**
  - `schedule.test.ts`: spi 0.7 → action in `now`; 0.85 → `soon`; 0.95 / null-no-burndown → none; cta dashboard.
  - `workload.test.ts`: an `over-allocated` + an `overload` alert each → one action with the right why-key/cta; empty → none.
  - `next-actions-workload.test.ts`: `buildWorkloadAlerts` flags overdueCount≥threshold and util>100%; both reasons for one resource; none when healthy.
  - `next-actions-input.test.ts`: defaults `workloadAlerts` to `[]`; passes through.
  - existing provider `input()` helpers: unaffected (field optional).
  - i18n EN/DE parity + encoding; full suite + e2e/a11y green.

## Out of scope
- Birthdays provider (dropped — courtesy nudge, weak fit).
- Under-utilization actions (only OVER-allocation/overload — the actionable-risk side).
- New views/CTAs beyond dashboard + workload (both exist).
- Configurable thresholds in Settings (use sensible constants; revisit if asked).

## File summary
**New:** `next-actions/providers/schedule.ts`, `next-actions/providers/workload.ts`, `next-actions-workload.ts` (+ 3 tests).
**Modified:** `next-actions/types.ts`, `next-actions/index.ts`, `next-actions-input.ts`, `task-manager.tsx`, `action-row.tsx`, `i18n.ts`/`i18n.de.ts`, `version.ts`, `CHANGELOG.md` (+ tests).
