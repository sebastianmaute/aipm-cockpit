# Action Center Roadmap — Slice 3: New Signal Providers — Design

**Date:** 2026-06-29
**Status:** Approved (design)
**Roadmap position:** Slice 3 of 4 (Ranking/noise ✓ → Layout ✓ → **New providers** → Inline CTAs)
**Branch:** `feat-action-center-slice3` (off `feat-action-center-slice2`; stacks slices 1+2+3)

## Problem

Real "this can't progress" task conditions never surface in the Action Center: tasks with no owner, tasks gone stale, explicitly-blocked tasks, and tasks waiting on an unfinished predecessor. Slice 3 adds one new provider covering those four signals. Engine-only — no layout/CTA change.

## Goals

Add a `task-attention` provider emitting four signal types, ranked + grouped like every other action.

## Non-Goals

- No new CTAs (Open + the slice-2 `[⋮]` menu are reused; inline "Assign owner" on these rows is slice 4).
- No opt-in settings toggle this slice (always-on; noise bounded by slice-1 grouping + tier cap + monitor-collapse). A toggle is a possible follow-up.
- No `task-manager`/`ActionInput`/settings change — the provider reads `input.tasks` + `input.today` only.
- No special-casing of Jira-synced tasks (staleness uses `lastUpdateDate`; a re-synced Jira task could read stale — accepted minor, documented).

## Architecture

### New provider: `src/app/next-actions/providers/task-attention.ts`
Pure, i18n-free. No `moduleId` (core, always runs) — mirrors `taskDueProvider`. Signature `provide(input: ActionInput): SuggestedAction[]`.

For each task in `input.tasks` that is **active** (`!isTaskFinished(task)` from `../../task-status`), emit a `SuggestedAction` per matched condition:

| Signal | Condition | ScoreFactors | tier | `why` (key, params) |
|---|---|---|---|---|
| Unassigned | `task.assignee.trim() === "" && task.resourceId == null` | `{ risk: W.riskHigh, clarity: cl }` = 30 | soon | `actionTaskWhyUnassigned` |
| Stale | `daysBetween(lastUpdateDate, today) >= STALE_DAYS` (14) | `{ staleness: stalenessScore(days), semiClarity: sc }` | monitor | `actionTaskWhyStale` [days] |
| Blocked | `task.blockers.trim() !== ""` | `{ risk: W.riskHigh, clarity: cl }` = 30 | soon | `actionTaskWhyBlocked` [blockers] |
| Dependency-blocked | some `dep` in `task.dependencies` where `byId.get(dep.taskId)` exists and is `!isTaskFinished` | `{ impact: W.impactBlocksMilestone, clarity: cl }` = 35 | soon | `actionTaskWhyDepBlocked` [predecessorName] |

Where (using `ACTION_WEIGHTS as W`, `scoreAction`, `bandTier`, `stalenessScore` from `../score`):
- `cl = input.clarityBonus ?? W.clarityBonus`; `sc = input.semiClarityBonus ?? W.semiClarityBonus`.
- `score = scoreAction(factors)`, `tier = bandTier(score)` (single source of tier — engine re-bands anyway).
- `STALE_DAYS = 14` (module const).
- `daysBetween(aISO, bISO)` = `Math.floor((Date.parse(bISO) - Date.parse(aISO)) / 86_400_000)`; guard a non-finite parse (skip stale if `lastUpdateDate` unparseable).
- Dependency-blocked: build `const byId = new Map(input.tasks.map(t => [t.id, t]))` once; fire ONCE per task (first unfinished predecessor) with that predecessor's `taskName` as the param. Skip deps whose predecessor id isn't found.
- Each action: `id = \`task-attention:${task.id}:${reason}\`` (reason ∈ unassigned|stale|blocked|dep), `source: "task-attention"`, `title: { key: "actionTaskTitle", params: [task.taskName] }` (reuse existing key), `cta: { kind: "open", view: "open-points", id: task.id }`.

A single task can emit multiple actions (e.g. unassigned + stale); slice-1 `groupNextActions` collapses them into one row keyed by `open-points:${id}`.

### `ActionSource` union + maps
- `src/app/next-actions/types.ts`: add `"task-attention"` to the `ActionSource` union.
- `src/app/action-source-label.ts`: add `"task-attention": "actionSourceAttention"`.
- `src/app/action-source-icon.tsx`: add a distinct `aria-hidden` glyph (a bell) for `"task-attention"`.
- These two Records are exhaustive (tsc-enforced). Run `npx tsc --noEmit` after the union change to surface any OTHER source-keyed exhaustive map that must be extended (none expected beyond these two; `action-learning` keys by string, not a Record).

### Registration
- `src/app/next-actions/index.ts`: import `taskAttentionProvider` and append it to `ALL_PROVIDERS`.

### i18n (EN + DE), 5 new keys
| Key | EN | DE |
|---|---|---|
| `actionSourceAttention` | `Attention` | `Handlungsbedarf` |
| `actionTaskWhyUnassigned` | `No owner assigned` | `Kein Verantwortlicher zugewiesen` |
| `actionTaskWhyStale` | `No update in {0} days` | `Seit {0} Tagen keine Aktualisierung` |
| `actionTaskWhyBlocked` | `Blocked: {0}` | `Blockiert: {0}` |
| `actionTaskWhyDepBlocked` | `Waiting on {0}` | `Wartet auf {0}` |

DE has umlaut/ß-free strings here EXCEPT none — but still write `i18n.de.ts` via node utf8 (Edit-tool corruption guard) and verify parity via tsc. (`Handlungsbedarf` is the precise PM term for "action required".)

## Testing

`src/app/next-actions/providers/task-attention.test.ts` (pure):
- Unassigned: fires for an active task with blank assignee + no resourceId; NOT when an assignee or resourceId is present; NOT for a finished (Done/Cancelled) task.
- Stale: fires when `lastUpdateDate` is ≥14 days before `today`; not when recent; unparseable date → no crash, no stale action.
- Blocked: fires when `blockers` non-empty; not when blank.
- Dependency-blocked: fires when a predecessor task is not Done; NOT when the predecessor is Done; predecessor name appears in the `why` params; missing predecessor id is skipped.
- A task matching two conditions emits two actions with distinct ids but the same `cta` entity (so grouping collapses them).
- Scores band to the expected tiers (soon/monitor) via `bandTier`.
- Engine integration: `computeNextActions` with the real `ALL_PROVIDERS` includes task-attention actions (or a focused `index.test` assertion).
- `npx tsc --noEmit` (union + i18n parity), `npm run lint`, `npm run test:run`.

## Acceptance

- Active tasks that are unassigned / stale / blocked / dependency-blocked surface as ranked actions under the "Attention" source, grouped per task.
- No change to existing providers, layout, or CTAs.
- All gates green.
