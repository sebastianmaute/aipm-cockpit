# Suggested Next Actions — Design (SP1: the action engine)

**Date:** 2026-06-13
**Status:** Approved (brainstorming complete) — SP1 of a 4-part feature
**Branch:** `feat-next-actions-engine`

## Problem

The app has ~9 **signal sources** (health RAG, EVM SPI/CPI, RAID severity + review-due, change-pending, budget ratio/margin/CPI, milestones overdue/at-risk, stakeholder-comms, due tasks, burndown/birthdays) all expressed as **passive status**, and ~10 **fragmented nudge surfaces** (7 banners, toasts, 3 reminder modals) that each shout about one signal. A red pill changes nothing — *acting* on it does. Goal: turn every signal into a ranked **suggested next action**, and consolidate the scattered nudges into one prioritized queue.

## Overall roadmap (4 sub-projects)

1. **SP1 — Action engine** (THIS spec): a pure `next-actions.ts` that consumes the existing signals and emits a ranked, deduplicated `SuggestedAction[]`. No UI, no new persisted data.
2. **SP2 — Action Center surface:** a "Next Actions" nav view (full prioritized queue) + a Dashboard "Top 5 actions" widget + a nav badge count. Executes each action's CTA.
3. **SP3 — Supplant the reminders:** fold the due-alerts, RAID-review, and stakeholder-comms banners+modals INTO the queue (delete the bespoke ones); generalize the snooze infra to per-action-id. Keep transient toasts (save-failed, snapshot) and blocking config banners (storage-error, jira-token, safe-mode).
4. **SP4 — Inline per-report action chips** (optional, last): each Red/Amber report row gets a "suggested action" chip linking into the engine.

Scope decisions locked in brainstorming: surface = Action Center + Dashboard widget; consolidation = supplant the 3 reminders, keep toasts + blocking banners; build engine-first.

---

## SP1 architecture

A pure, framework-free module `src/app/next-actions.ts` (+ a `next-actions/` folder of per-domain providers). It reuses the EXISTING signal logic — providers call `getAlertableTasks`, `getRaidReviewItems`, `partitionMilestones`, `computeScopeStatus`/change-log helpers, `getStakeholderCommsItems`, and the budget health fns — so there are no duplicated thresholds.

### The `SuggestedAction` value object
```ts
type ActionTier = "now" | "soon" | "monitor";

interface I18nText { key: TranslationKey; params?: (string | number)[]; }

type ActionCta =
  | { kind: "open"; target: { view: AppView; id: string | number } } // deep-link to the entity
  | { kind: "snooze"; actionId: string }                              // dismiss/snooze this action
  | { kind: "mark-reviewed"; raidId: string };                        // one-click op (engine describes; surface executes)

interface SuggestedAction {
  id: string;             // STABLE: `${source}:${entityId}:${reason}` e.g. "raid-review:R-12:overdue"
  source: ActionSource;   // "task-due" | "raid" | "change-pending" | "milestone" | "budget" | "stakeholder-comms"
  moduleId: FeatureModuleId;
  title: I18nText;        // i18n key + params — surface translates (engine is i18n-free)
  why: I18nText;          // the triggering signal + reason
  score: number;          // integer, for ranking
  tier: ActionTier;       // banded from score
  cta: ActionCta;         // a DESCRIPTOR, not a function — SP2 executes it
}
```
- **Stable IDs** so SP3's snooze/dismiss persists across recomputes (an action keeps its id while its condition holds).
- **CTA is a serializable descriptor.** The engine *describes* the next step; the surface executes it. `kind:"open"` deep-links via the existing `parseHash`/`buildHash`/`requestOpen` infra (reserve no new routing).
- **Title/why are i18n keys+params**, never translated strings — keeps the engine pure and unit-testable (the same pattern pure modules already follow; only the surface imports `t`).

### Provider registry
```ts
interface ActionProvider {
  moduleId: FeatureModuleId;                  // gate: skipped if the module is disabled
  provide(input: ActionInput): SuggestedAction[];
}
```
`computeNextActions(input)` runs only providers whose `moduleId` is enabled in `input.features`, concatenates results, **dedups by `id`** (first wins), sorts by `score` desc with a stable tiebreak (`id` asc), and returns the list (each already carrying its banded `tier`).

`ActionInput` is the read-only slice the providers need:
```ts
interface ActionInput {
  tasks; raid; changes; milestones; budgets; stakeholders; plan; resources; absences; status;
  dashboard: DashboardModel;          // the EXISTING computed model (RAGs, EVM SPI/CPI) — reused, not recomputed
  features: FeatureModuleId[];
  holidaySet; today: string; now: Date;
  dismissed: ReadonlySet<string>;     // snoozed/dismissed action ids — INJECTED (engine stays pure; SP3 wires the store)
}
```
`computeNextActions` filters out any action whose `id` is in `dismissed`.

### SP1 core providers (granularity rule: per-item for individually-actionable; aggregate for threshold signals)
| Provider (`source`) | moduleId | Emits | Granularity |
|---|---|---|---|
| `task-due` | schedule | overdue / due-today / due-soon tasks (via `getAlertableTasks`) — replaces due-alerts | per-task |
| `raid` | raid | open Critical/High items + review-due (via `getRaidReviewItems` + severity) — replaces RAID-review | per-item |
| `change-pending` | scope | changes Proposed/Under Review; one aggregate action when count ≥ scope-red threshold, else per-change for high-impact | aggregate + per-item |
| `milestone` | schedule | overdue / at-risk milestones (via `partitionMilestones`) | per-item |
| `budget` | budget | bucket ratio > 100% or CPI Red (via budget health fns) | per-bucket / aggregate |
| `stakeholder-comms` | stakeholder-comms | comms-due (via `getStakeholderCommsItems`) — replaces comms reminder | per-reminder |

(Burndown/birthdays/workload deferred — not in the supplanted-reminder set; easy to add later as new providers.)

### Scoring (deterministic, explainable — mirrors the existing `template-suggest` additive pattern)
```ts
score = urgency + risk + impact + quickWin + staleness
// urgency:   overdue +40, due-today +30, due-soon +15
// risk:      Critical / Red RAG +30, High / Amber +15
// impact:    blocks a milestone +20 (via the existing milestone↔linked-task linkage), scope-pending ≥ threshold +15
//            (NOTE: "on critical path" is intentionally excluded — no critical-path computation exists yet; add as a future factor if one lands)
// quickWin:  a one-click op that clears a Red +10   (high value / low effort floats up)
// staleness: review/decision overdue, +1 per day, capped +15
// tier:  score ≥ 60 → "now"  ·  30–59 → "soon"  ·  < 30 → "monitor"
```
- All weights live in one named-constants block (`ACTION_WEIGHTS`) for easy tuning.
- Every action's `why` lists the contributing factors, so the ranking is auditable — no black box.
- Scoring helpers are small pure functions, each unit-tested.

---

## Boundaries

- `next-actions.ts` imports ONLY: the existing signal modules (due-dates, raid, raid-review, change-log, milestones, budget-health, stakeholder-comms, dashboard), `feature-modules` (FeatureModuleId), and types. It imports NO React, NO `t`/i18n, NO localStorage, NO DOM.
- No new persisted Workspace field, no serializer changes, no schema/Turso/golden-fixture impact (SP1 is compute-only).
- Snooze persistence is explicitly OUT of SP1 — the engine takes `dismissed` as an input set; SP3 builds the store and generalizes `reminder-snooze.ts` to per-action-id.

## Testing

- One unit test file per provider (`next-actions/<source>.test.ts`), AAA: given a workspace slice in a known state, assert the exact `SuggestedAction[]` (id, source, tier, score, cta shape, why key).
- `next-actions.test.ts` for `computeNextActions`: module-gating (disabled module → its actions absent), dedup by id, score-descending order with stable tiebreak, and the `dismissed` filter.
- Scoring: unit-test each factor function + the tier banding at boundary values (29/30, 59/60).
- No UI tests in SP1.

## Out of scope (SP1)
- Any rendering / nav view / dashboard widget / badge (SP2).
- Deleting/!modifying the existing banners or reminder modals (SP3).
- Snooze store + per-action snooze UI (SP3).
- Inline report chips (SP4).
- New signal providers beyond the core set (burndown, birthdays, workload) — additive later.

## File summary (SP1)
**New:** `src/app/next-actions.ts` (types + `computeNextActions` + registry + scoring), `src/app/next-actions/` providers (`task-due.ts`, `raid.ts`, `change-pending.ts`, `milestone.ts`, `budget.ts`, `stakeholder-comms.ts`), plus a `.test.ts` per file.
**Modified:** none (compute-only; SP2 will wire it into task-manager).
