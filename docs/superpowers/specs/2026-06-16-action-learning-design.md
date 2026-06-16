# Execution Depth — Action Center Loop/Learning Layer (FINAL slice)

**Date:** 2026-06-16
**Status:** Approved (brainstorm) — ready for implementation plan
**Feature area:** pure `action-learning.ts` + `next-actions/` engine (bias term) + `use-action-learning.ts` hook + two `LearningStore` impls + insights view + `action-row` hint + settings + docs refresh.

---

## Goal

Close the Action Center feedback loop. Learn from how the user actually responds to suggested
actions (acts via an executable CTA / snoozes / dismisses) and feed a **bounded bias** back into the
pure ranking engine, so the Action Center surfaces fewer, higher-value next-best-actions over time.

**Design pillar (the repositioning narrative this slice carries):** the app is an *enabler /
accelerator*, **not yet-another-data-silo**. It works **with** the user's existing stack — Microsoft
365 (Outlook contacts/calendar, SharePoint documents) and **Jira bidirectional sync** — rather than
becoming another place to maintain data. The learning layer is that promise made concrete: it reduces
manual triage by telling you the next best thing to do. Learning telemetry is **personal tuning**,
not project data.

This is the **final slice** of the execution-depth roadmap (create-task → assign-owner →
draft-message → escalate → re-baseline → notifications → **loop/learning**). After this the roadmap
is complete.

## Background (verified by recon)

- The ranking engine is pure / i18n-free. `scoreAction` (`next-actions/score.ts`) is additive:
  `sum = urgency + risk + impact + quickWin + staleness + clarity − staticPenalty; final = max(0, sum)`.
  Tier bands (`bandTier`): `score ≥ 60 → "now"`, `≥ 30 → "soon"`, `< 30 → "monitor"`
  (`TIER_NOW = 60`, `TIER_SOON = 30`).
- `computeNextActions` (`engine.ts`) dedups by `id` (first provider wins), drops dismissed, re-bands
  tier from score, sorts by score desc then `id` asc.
- `SuggestedAction.id = "${source}:${entityId}:${reason}"`. `source` ∈ `task-due | raid |
  change-pending | milestone | budget | stakeholder-comms | schedule | workload`. Each provider sets a
  `why.key`. The stable **learning granule** is the pair `(source, why.key)`.
- Existing outcome capture: `action-snooze.ts` (localStorage `lop-app:action-snooze`,
  `{actionId: until-epoch-ms}`, time-boxed, pruned on read) → `useActionSnooze()` returns
  `{ dismissed: ReadonlySet<string>, snooze(actionId, durationMs) }`; the dismissed set feeds
  `ActionInput.dismissed`. The executable-CTA handlers (create-task/assign/draft/escalate/rebaseline)
  are scattered across `action-*.ts` + `task-manager.tsx` — there is **no** central outcome choke
  point today (this slice adds one).
- Config overrides thread into the engine via **optional** `ActionInput` fields
  (`clarityBonus?`/`staticPenalty?`/…). **New `ActionInput` fields MUST be optional** or the provider
  test `input()` helpers break.
- Persistence precedents: localStorage dedup (`lop-app:action-snooze`, `lop-app:notified-urgent`);
  Turso non-workspace tables kept OUT of `TABLE_NAMES` (snapshots, version-history, comm_templates)
  via `runTursoPipeline`.
- Integration reality (for the docs repositioning — accurate, no embellishment): **Jira** —
  `/api/jira/{test,projects,issue-types,users,search,create-issue,update-issue,transition-issue}`
  proxy routes + a **bidirectional sync** hook (`use-jira-sync.ts`, `jira-api.ts`). **M365/Graph** —
  Outlook contacts (`outlook-contacts.ts`), Outlook calendar (`outlook-calendar.ts`), Graph mail
  (`graph-mail.ts`), SharePoint storage + document picker (`sharepoint-*.ts`). On-demand
  imports/pickers, not a background sync loop.

## Decisions taken during brainstorming

1. **Adjustment model = symmetric bounded bias** (not suppress-only, not surface-side reorder). One
   new optional additive term in the pure engine; suppresses chronically-dismissed kinds AND floats
   kinds the user acts on.
2. **Persistence = both, user-configurable.** A `LearningStore` interface with a localStorage impl
   (default) and a Turso impl (cross-device); `settings.nextActionsLearning.store` selects. Turso
   gracefully **falls back to local** when `tursoConfig === null`.
3. **Transparency = full insights view + per-kind manual override** (the richest option) — plus a
   per-row hint and the settings controls.
4. **Signal model = tiered intent.** Executable CTA = strong positive; dismiss = strong negative;
   snooze = weak negative (deferral ≠ rejection); a bare open / deep-link is **not** recorded
   (too ambiguous).
5. **Defaults:** **opt-in, off by default** (it changes ranking behaviour); **global** per user (not
   per project); decay half-life ≈ **30 days**; bias **CAP = 20**; **min-evidence = 3** outcomes
   before any bias applies.
6. **Safety cap (non-negotiable):** the learned bias can never demote an intrinsically-urgent item
   out of the `now` tier (protects critical/overdue from being hidden).
7. **Docs bundled at the end of this slice** (README repositioning + version badge + codemaps +
   runbook), per the sequencing decision.

---

## Architecture

```
CTA handlers (task-manager) ──record(action, type)──► use-action-learning ──► LearningStore (local | turso)
                                                              │
                                                       buildBiasMap(state, overrides)
                                                              │ Record<kind, number>
nextActions useMemo ── ActionInput.learnedBias ──► computeNextActions
                                                              │  intrinsic score (scoreAction, unchanged)
                                                              │  + applyLearnedBias (bounded, safety floor)
                                                              ▼
                                          SuggestedAction { …, learning?: { bias, moved } }
                                          │                                   │
                                   action-row hint                    insights view (counts + override)
```

### 1. Pure `src/app/action-learning.ts` (i18n-free, unit-tested)

Types:
```ts
export type OutcomeType = "acted" | "snoozed" | "dismissed";
export type OutcomeStats = { acted: number; snoozed: number; dismissed: number; lastAt: number };
export type LearningState = Record<string, OutcomeStats>;            // key = kind = `${source}:${why.key}`
export type LearningOverride = "auto" | "surface" | "suppress" | "off";
export type LearningOverrides = Record<string, LearningOverride>;    // key = kind
```

Constants: `BIAS_CAP = 20`, `MIN_EVIDENCE = 3`, `DECAY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000`,
weights `W_ACTED = 1`, `W_SNOOZED = 0.5`, `W_DISMISSED = 1`.

Functions:
- `decayStats(s: OutcomeStats, now: number): OutcomeStats` — multiply each count by
  `0.5 ** ((now − s.lastAt) / DECAY_HALF_LIFE_MS)` (lazy exponential decay). If `lastAt` is 0/absent,
  no decay.
- `recordOutcome(state, kind, type, now): LearningState` — immutably: decay the kind's stats to `now`,
  `+1` the `type`, set `lastAt = now`. Returns a new state.
- `learnedBias(s: OutcomeStats): number` — `total = acted + snoozed + dismissed`; if
  `total < MIN_EVIDENCE` return `0`; `net = W_ACTED*acted − W_SNOOZED*snoozed − W_DISMISSED*dismissed`;
  `return clamp(Math.round(BIAS_CAP * net / total), −BIAS_CAP, BIAS_CAP)`.
- `effectiveBias(s, override): number` — `surface → +BIAS_CAP`, `suppress → −BIAS_CAP`, `off → 0`,
  `auto → learnedBias(s)`.
- `buildBiasMap(state, overrides, now): Record<string, number>` — for every kind present in `state`
  OR `overrides`, compute `effectiveBias(decayStats(stats ?? empty, now), overrides[kind] ?? "auto")`;
  omit zero entries (keep the map small).

### 2. Engine integration (`next-actions/score.ts` + `engine.ts`)

- New **optional** `ActionInput.learnedBias?: Record<string, number>` (types.ts).
- `scoreAction` stays **intrinsic** (unchanged). Add a pure helper in `score.ts`:
  ```ts
  export function applyLearnedBias(intrinsic: number, kind: string,
                                   learnedBias?: Record<string, number>): number {
    const bias = learnedBias?.[kind] ?? 0;
    const biased = Math.max(0, intrinsic + bias);
    // Safety floor: never demote an intrinsically-urgent item out of the now tier.
    return intrinsic >= TIER_NOW ? Math.max(biased, TIER_NOW) : biased;
  }
  ```
- In `computeNextActions` (engine.ts): for each action, `kind = `${a.source}:${a.why.key}``;
  `intrinsic = a.score`; `final = applyLearnedBias(intrinsic, kind, input.learnedBias)`; set
  `a.score = final` for sort/tier and annotate
  `a.learning = bias === 0 ? undefined : { bias, moved: bias > 0 ? "up" : "down" }`.
  (Add optional `learning?: { bias: number; moved: "up" | "down" }` to `SuggestedAction`.)
  Tier is re-banded from `final` (existing behaviour) — the safety floor guarantees an intrinsically-
  now item stays `now`.

### 3. Stores — `LearningStore` interface + two impls

```ts
export interface LearningSnapshot { state: LearningState; overrides: LearningOverrides }
export interface LearningStore {
  load(): Promise<LearningSnapshot>;
  save(snap: LearningSnapshot): Promise<void>;
}
```
- `src/app/learning-store-local.ts` — localStorage key `lop-app:action-learning`
  (`{ state, overrides }` JSON; guarded read/parse like `action-snooze.ts`; SSR-safe).
- `src/app/learning-store-turso.ts` — a **global** (no `project_id`) Turso table `action_learning`
  kept **OUT of `TABLE_NAMES`** (guard test) via `runTursoPipeline`. Columns: `kind TEXT PRIMARY KEY`,
  `acted`, `snoozed`, `dismissed`, `last_at`, `override TEXT`. `SqlArg.value` is string-only — write
  ints with `String(v)`. CREATE-IF-NOT-EXISTS on first use.
- `pickLearningStore(settings, tursoConfig)`: returns the Turso store when
  `settings.nextActionsLearning.store === "turso" && tursoConfig !== null`, else the local store
  (graceful fallback).

### 4. `src/app/use-action-learning.ts` hook

- On mount: `pickLearningStore(...).load()` into state (guarded; empty on error).
- Exposes: `record(action, type)` (decays+increments+debounce-persists; **no-op when
  `!settings.nextActionsLearning.enabled`**), memoized `bias: Record<kind, number>`
  (`buildBiasMap` — empty `{}` when disabled), `overrides` + `setOverride(kind, override)` (persists),
  `stats` (decayed snapshot for the insights view), `reset()` (clears store + state).
- Persist is debounced (≈1s) to avoid hammering Turso. Refs-in-effects pattern for callbacks/config
  to keep effect deps tight (exhaustive-deps rejects `obj.member` — hoist to a const).
- Single instance in the canonical `task-manager`; gated `!isPopout` for capture (popouts are
  read-only mirrors).

### 5. Capture wiring (`task-manager.tsx`)

- Thread `learning.bias` into the `nextActions` useMemo as `ActionInput.learnedBias` (optional field;
  add `learning.bias` to the dep array via a hoisted const).
- Call `learning.record(action, "acted")` from each executable-CTA handler
  (create-task, assign-owner, draft-message, escalate, rebaseline) at the point the action is
  dispatched. Call `learning.record(action, "snoozed")` from the snooze handler. **Dismiss:** the plan
  must check whether a *distinct permanent dismiss* exists separate from snooze; if yes →
  `record(action, "dismissed")`; if the only negative gesture is snooze, `"dismissed"` stays unused at
  capture time (the type + store column remain for forward-compat and the Turso schema). Bare
  open/deep-link is **not** recorded.

### 6. Insights view (`learning-insights`)

- New `AppView` `"learning-insights"`, opened from a button in the Next-actions settings section
  (primary entry point; no separate nav rail item in v1 to keep the surface small). Renders a table:
  one row per known kind with
  source label + a friendly why-label, decayed `acted`/`snoozed`/`dismissed` counts (rounded),
  derived `bias`, and an **override** `<select>` (Auto / Surface / Suppress / Off) wired to
  `setOverride`. A **Reset all** button (confirm) calls `reset()`. Empty-state when no learning data.
- i18n: source labels reuse existing `ACTION_SOURCE_LABEL`; why-labels reuse the existing `why.key`
  strings; new column headers + override option labels + the view title.
- a11y: every `<select>` has an associated label/`aria-label` (axe).

### 7. Per-row hint (`action-row.tsx`)

- When `action.learning?.moved` is set, render a small explained chip:
  `moved === "up"` → `learningSurfacedHint` ("You usually act on these — surfaced"),
  `moved === "down"` → `learningDemotedHint` ("Often dismissed — demoted"). Palette-token styled,
  no off-palette shadow.

### 8. Settings (`nextActionsLearning` config)

- `settings.nextActionsLearning: { enabled: boolean; store: "local" | "turso" }`; default
  `{ enabled: false, store: "local" }`. Coerce in the settings migrator (default off; store coerced to
  the union, else "local"). Add to all settings type/default + the `migrate`/`resolve` path.
- UI (in the Next-actions settings section): enable/disable checkbox; a store radio/select
  (Local / Turso — the Turso option notes it needs Turso configured); a **Reset learned data** button
  (confirm); a link/button to open the insights view. Labeled controls (axe).

### 9. i18n keys (EN + DE, real umlauts)

`learningSurfacedHint`, `learningDemotedHint`, `settingsLearningEnable`, `settingsLearningEnableHint`,
`settingsLearningStore`, `settingsLearningStoreLocal`, `settingsLearningStoreTurso`,
`settingsLearningReset`, `settingsLearningResetConfirm`, `learningInsightsTitle`,
`learningInsightsEmpty`, `learningColKind`, `learningColActed`, `learningColSnoozed`,
`learningColDismissed`, `learningColBias`, `learningColOverride`, `learningOverrideAuto`,
`learningOverrideSurface`, `learningOverrideSuppress`, `learningOverrideOff`,
`versionHighlightLearning`. `Lang = "en-US" | "en-GB" | "de"` (no `"en"`); DE dict lazy
(`loadI18n("de")` in DE-asserting tests' `beforeAll`); edit `i18n.de.ts` via node UTF-8 CRLF write
only. Interpolation 0-based `{0}`.

### 10. Release + docs (bundled at the end of this slice)

- `version.ts` → `APP_VERSION = "0.95.0"`, new codename, build date; append
  `"versionHighlightLearning"` to `APP_HIGHLIGHT_KEYS`. `CHANGELOG.md` entry.
- **README repositioning:** update the stale version badge (`0.60.0 "Stephenson"` → `0.95.0`); rework
  the Overview/tagline to lead with "works **with** your stack — M365 (contacts/calendar/SharePoint)
  + **Jira bidirectional sync** — an accelerator that surfaces the next best action, not another
  ledger to maintain"; surface the learning layer as that promise realized. Keep all existing factual
  feature/integration tables (they are accurate).
- **Codemaps** (`docs/CODEMAPS/*`): add the learning module, the engine bias term, the new view, and
  the `action_learning` Turso table to architecture/frontend/data maps.
- **RUNBOOK** (`docs/RUNBOOK.md`): add a "Reset / disable learning" entry (clear
  `lop-app:action-learning` or the Turso table; the safe-mode/recovery note that learning never
  blocks boot).
- **DESIGN-TOKENS** (`docs/DESIGN-TOKENS.md`): update only if the hint/insights UI introduces a new
  token — expected none (reuse existing palette tokens).

## Testing

- **Pure `action-learning.test.ts`:** decay (half-life), `learnedBias` (net formula, min-evidence
  floor returns 0, cap clamp both directions), `effectiveBias` (each override), `recordOutcome`
  (immutability + increment + lastAt), `buildBiasMap` (omits zeros, applies overrides).
- **Engine:** `applyLearnedBias` adds bias; **safety floor** — an intrinsically-`now` item with a
  large negative bias still scores ≥ `TIER_NOW` and stays `now`; a `monitor` item with positive bias
  can rise; `learning` annotation set/cleared correctly; missing `learnedBias` = no change (back-compat
  — existing provider tests untouched).
- **Stores:** local round-trip (save/load, malformed JSON → empty); Turso store builds the right
  pipeline + stays OUT of `TABLE_NAMES` (guard test); `pickLearningStore` fallback to local when
  `tursoConfig === null`.
- **Hook:** `record` no-ops when disabled; updates bias when enabled; `setOverride`/`reset` persist;
  popout gating.
- **Insights view:** renders counts; override select calls `setOverride`; reset confirms.
- **Settings:** toggle/store/reset wired; coercion defaults (off/local).
- **a11y:** insights selects + settings controls labeled (axe gate covers the views).

## Out of scope (with reasoning)

- **Per-project learning** — a kind's act/dismiss pattern is a *personal* work habit, not a project
  trait; per-project counters re-learn from zero each project (sparse → min-evidence rarely met) and
  complicate the store with `project_id`. Global converges faster and is simpler; a per-project
  override layer can be added later if a real need appears.
- **Cross-user / shared learning** — the unit of learning is *this user's* triage habits; averaging
  multiple users' outcomes destroys the individual pattern and drags in identity/attribution/merge/
  privacy concerns (a separate product decision). The Turso store already gives one user
  cross-**device** continuity, which is the actual need.
- **Ignored-but-shown (no-interaction) as a negative signal** — "shown but not clicked" is ambiguous
  (scrolled past, below the fold, handled in Jira/Outlook); counting it as rejection would suppress
  kinds the user handles *outside* the app, contradicting the accelerator pillar, and needs
  impression-tracking infra we don't have. Explicit gestures are unambiguous; impressions are not.
- **Auto-tuning the base weights** — mutating intrinsic weights (`urgencyOverdue` etc.) is unbounded
  and could drift the whole engine (a feedback loop that learns to stop surfacing overdue items). The
  bounded additive bias (±20, capped, safety-floored) captures ~all the value at a fraction of the
  risk; weight optimization (stability/regularization) is a research project, not a slice.
