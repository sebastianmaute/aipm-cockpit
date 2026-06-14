# Next-Actions Confidence Ranking + Root-Cause Context — Design

**Date:** 2026-06-14
**Status:** Approved (brainstorm) — ready for implementation plan
**Feature area:** `src/app/next-actions/` (engine), `actions-panel.tsx` (inbox UI), Settings → Next actions

---

## Goal

Make the Action Center inbox rank by **how actionable a signal is**, not by severity color
alone. A clear-fix medium-severity item should be able to outrank a vague, static red. Vague
aggregate reds (total budget over, portfolio SPI low) sink to a collapsed "monitor" group
instead of crowding out items a PM can actually act on. The "why" line gains a one-clause
root-cause hint (magnitude + trend direction).

This is the **"smarter ranking + context"** slice of the larger From-Reports-to-Next-Best-Action
roadmap. It deliberately does NOT add new action types (execution depth) or a loop/learning
layer — those are separate later slices.

## Background — what already exists

The signal → rule → score → inbox pipeline is already built ([[next-actions-engine]],
[[action-center]]):

- **8 providers** (`next-actions/providers/`) map report signals → `SuggestedAction`
  (task-due, raid, change-pending, milestone, budget, stakeholder-comms, schedule, workload).
- **`score.ts`** scores additively (`urgency + risk + impact + quickWin + staleness`) and
  `bandTier` buckets each action into `now / soon / monitor`.
- **`engine.ts`** runs providers, dedups by id, drops dismissed, sorts by score desc.
- **`actions-panel.tsx`** renders the three tiers, each always expanded.
- **`ActionInput`** is built by the surface (task-manager) and is **pure / i18n-free**; new
  fields are added as **optional** (a required `ActionInput` field breaks every provider test's
  `input()` helper — established landmine).
- **`NextActionsConfig`** (`settings-types.ts`) already holds tunable signal-firing thresholds,
  resolved via `resolveNextActionsConfig`, edited in `settings-sections/next-actions-section.tsx`.
- **Snapshots** (`snapshot.ts`, `use-snapshots.ts`) are **Turso-only**: a sorted
  `SnapshotRecord[]` with `spi`, `cpi`, `budgetRag`, `scheduleRag`, `remainingCost`, … per bucket.

## Decisions taken during brainstorming

1. **Confidence math = hybrid (bonus + static penalty), NOT a multiplier.**
   `final = base + clarity − staticPenalty`. Keeps the additive, point-by-point, auditable
   model intact (a multiplier hides which factor moved an item and over-damps genuine urgency).
   It is the only option that BOTH lifts clear items AND sinks vague reds.
2. **Confidence basis = actionability (intrinsic) + trend bonus when snapshots exist.**
   Actionability works on every backend with no history; the trend layer sharpens the
   aggregate signals where Turso snapshot history is present, and degrades gracefully (field
   undefined) everywhere else.
3. **Weights are user-configurable** in Settings → Next actions (clarityBonus, semiClarityBonus,
   staticPenalty), following the existing `NextActionsConfig` pattern.

---

## Architecture

### 1. Scoring model (`score.ts`)

```
base  = urgency + risk + impact + quickWin + staleness     (unchanged)
final = base + clarity − staticPenalty

ScoreFactors gains:
  clarity?:       number   // 0 .. clarityBonus      (added)
  staticPenalty?: number   // 0 .. staticPenalty cap  (subtracted)

ACTION_WEIGHTS gains DEFAULTS (overridable via config — see §5):
  clarityBonus:      15
  semiClarityBonus:   7
  staticPenalty:     25

scoreAction(f) = (f.urgency ?? 0) + (f.risk ?? 0) + (f.impact ?? 0)
               + (f.quickWin ?? 0) + (f.staleness ?? 0)
               + (f.clarity ?? 0) − (f.staticPenalty ?? 0)
```

`bandTier` is unchanged: a low `final` naturally sinks to `monitor`. `scoreAction` must never
return below 0 — clamp with `Math.max(0, …)` so a heavily-penalised item still sorts
deterministically and never goes negative.

Worked example (the acceptance target):
- Vague red budget, base 70, staticPenalty 25 → **45** (`soon`/`monitor`).
- Clear RAID-no-owner, base 45, clarity 15 → **60** (`now`).
- Clear medium now outranks vague red. ✓

### 2. Confidence derivation (per provider)

Each provider tags its action(s) with a **clarity class**, then applies a **trend adjustment**
when `input.trends` carries a direction for that source.

**Clarity class (intrinsic, all backends):**

| Class | Providers | Factor |
|---|---|---|
| `CLEAR` | task-due, raid (High + no mitigation owner), change-pending, stakeholder-comms | `clarity = clarityBonus` |
| `SEMI`  | workload, milestone | `clarity = semiClarityBonus` |
| `VAGUE` | budget (aggregate over), schedule (portfolio SPI) | `staticPenalty = staticPenalty` |

RAID nuance: a High risk **with** a mitigation owner already assigned is `SEMI` (less clear what
to do next), a High risk with **no** owner is `CLEAR` (assign the owner). Providers decide the
class from data they already hold; no new inputs.

**Trend adjustment (only when `input.trends?.<source>` is set — Turso):**

```
VAGUE provider:
  trend "worsening"        → staticPenalty halved (signal IS moving, pull it back up)
  trend "flat"/"improving" → staticPenalty kept   (static red → stays in monitor)
  trend undefined          → staticPenalty kept   (no history; intrinsic class only)
```

(SEMI/CLEAR providers don't currently consume trend — they have no aggregate snapshot metric.
Leaving the hook in `ActionInput` lets a later slice extend them without an interface change.)

### 3. Trend plumbing (keeps the engine pure)

```ts
// next-actions/trends.ts  (pure, no React, no Turso import)
export type TrendDir = "worsening" | "flat" | "improving";
export interface ActionTrends {
  budget?: TrendDir;
  schedule?: TrendDir;
}

// lookback = how many buckets back to compare; default TREND_LOOKBACK = 1 (prior snapshot).
export function computeActionTrends(
  snapshots: readonly SnapshotRecord[],
  lookback?: number,
): ActionTrends | undefined;
```

- Returns `undefined` when `< 2` snapshots (no comparison possible) → caller passes `undefined`.
- `budget`: compare `latest.remainingCost` vs the `lookback`-back record; **higher remaining
  cost = worsening**. Tiebreak/fallback on `budgetRag` movement (G→A→R = worsening) when
  `remainingCost` is null on either side. Equal within an epsilon → `flat`.
- `schedule`: compare `latest.spi` vs the `lookback`-back record; **lower SPI = worsening**;
  higher = improving; within epsilon → `flat`. Null on either side → omit the key.

`ActionInput` gains:

```ts
trends?: ActionTrends;   // optional; surface fills from useSnapshots history; undefined off-Turso
```

The surface (`task-manager.tsx`, `buildActionInput` call site) computes
`computeActionTrends(snapshots)` from the `useSnapshots` history it already holds and threads it
in. Non-Turso / popout / `< 2` snapshots → `trends` stays `undefined`, providers keep the
intrinsic class only. Engine never imports snapshot/Turso code.

### 4. Root-cause hint in the "why" line

`why` stays `I18nText { key, params }`. Per-provider, one extra clause, deterministic, built
from data already on hand (magnitude from the dashboard model, direction from `trends`):

| Provider | Enriched why (new key) | Fallback (no trend) |
|---|---|---|
| budget | `actionBudgetWhyTrend` → "Budget {0} (CPI {1}), worsening {2} periods" | existing `actionBudgetWhyCpi` |
| schedule | `actionScheduleWhyTrend` → "SPI {0}, slipping over recent snapshots" | existing schedule why |
| raid | `actionRaidWhyNoOwner` → "High risk, no mitigation owner" (clarity made explicit) | existing raid why |

- New EN + DE keys added to `i18n.ts` / `i18n.de.ts`. **DE uses real umlauts** — patch
  `i18n.de.ts` via a node utf8 write, never the Edit tool ([[i18n-de-edit-corruption]]). `tsc`
  enforces EN/DE key parity; `i18n-encoding` test bans ASCII umlaut subs.
- No new data sources, no "Vendor X" attribution (not in the data model) — magnitude + direction
  only. Provider falls back to the current key when `trends` is absent for its source.

### 5. Configurable weights (Settings → Next actions)

```ts
// settings-types.ts — NextActionsConfig gains:
clarityBonus: number;      // default 15
semiClarityBonus: number;  // default 7
staticPenalty: number;     // default 25
```

- `defaultNextActionsConfig` + `resolveNextActionsConfig` extended (`intMin0`-style coercion:
  finite, `>= 0`, rounded; fall back to default per field). These three are point values, so a
  `0`-floor variant of the existing `intMin1` is needed (0 must be allowed = "disable this knob").
- Threaded as **optional** `ActionInput` fields (`clarityBonus?`, `semiClarityBonus?`,
  `staticPenalty?`); each provider falls back to the `ACTION_WEIGHTS` const when undefined
  (test-helper landmine — new `ActionInput` fields MUST be optional).
- `settings-sections/next-actions-section.tsx`: three new integer number-inputs in their own
  "Ranking weights" sub-group, with the existing reset-to-defaults button covering them.

### 6. Collapse static reds (`actions-panel.tsx`)

- `now` and `soon` sections render expanded, exactly as today.
- `monitor` becomes **collapsible, collapsed by default**: a header button
  `"{N} monitored ▸"` toggling `aria-expanded`; expanding reveals the existing `ActionRow`s.
- Empty `monitor` → render nothing (current behavior preserved).
- Palette: only sanctioned tokens; the disclosure caret reuses existing chrome (no new color).
- a11y: the toggle is a real `<button>` with `aria-expanded` / `aria-controls`; the 12-view axe
  gate must stay green.

---

## Data flow

```
useSnapshots history ─┐
                      ├─► computeActionTrends() ─► ActionTrends ─┐
dashboard model ──────┘                                          │
settings.nextActions (weights + thresholds) ─────────────────────┤
                                                                 ▼
                                            buildActionInput(...) → ActionInput
                                                                 ▼
                              providers (clarity class + trend adj + why enrichment)
                                                                 ▼
                                    scoreAction (base + clarity − staticPenalty)
                                                                 ▼
                                 computeNextActions → sorted SuggestedAction[]
                                                                 ▼
                          ActionsPanel (now / soon expanded · monitor collapsed)
```

## Components / file map

| File | Change |
|---|---|
| `next-actions/score.ts` | `clarity` / `staticPenalty` factors; 3 new weights; clamp `>= 0` |
| `next-actions/trends.ts` | **new** — `TrendDir`, `ActionTrends`, `computeActionTrends` (pure) |
| `next-actions/types.ts` | `ActionInput.trends?`, `clarityBonus?`, `semiClarityBonus?`, `staticPenalty?` |
| `next-actions/providers/*.ts` | each sets clarity class; budget/schedule consume trend + enriched why; raid no-owner why |
| `settings-types.ts` | `NextActionsConfig` += 3 weights; default + resolver |
| `settings-sections/next-actions-section.tsx` | "Ranking weights" sub-group (3 inputs) |
| `next-actions-input.ts` | passthrough of trends + weights into `ActionInput` |
| `task-manager.tsx` | compute `computeActionTrends(snapshots)`; pass weights from `settings.nextActions` |
| `actions-panel.tsx` | collapsible `monitor` group |
| `i18n.ts` / `i18n.de.ts` | new why-trend + "N monitored" keys (EN + DE, real umlauts) |

## Error handling / edge cases

- `< 2` snapshots, non-Turso, popout → `trends` undefined → intrinsic clarity only (no crash).
- Null `spi` / `remainingCost` on either compared snapshot → omit that trend key (don't guess).
- Weight set to `0` → that knob is disabled (clarity adds nothing / no penalty); still valid.
- `scoreAction` clamped at `0` — never negative, ordering stays deterministic.
- A provider with no clarity class set behaves as today (clarity 0, no penalty) — backward safe.

## Testing

- `score.test.ts`: hybrid math incl. clamp at 0; clarity lifts, staticPenalty sinks; the worked
  example (clear medium 60 > vague red 45).
- `trends.test.ts`: budget/schedule direction from snapshot deltas; `< 2` → undefined; null-KPI
  → key omitted; epsilon `flat`; lookback honored.
- Each provider test: correct clarity class; budget/schedule trend adjustment + enriched why;
  raid no-owner clarity + why; fallback when trend undefined.
- `engine` ordering test: clear medium outranks vague red end-to-end.
- `actions-panel` test: `monitor` collapsed by default, toggles, empty renders nothing.
- `settings-next-actions` test: 3 weights round-trip, reset-to-defaults, `0` allowed, coercion.
- i18n: EN/DE parity (`tsc`), `i18n-encoding` (no ASCII umlaut subs).
- e2e 12-view axe gate stays green (collapsible button a11y).

## Out of scope (explicitly)

- Execution-depth CTAs (create-task / assign / draft-email / escalate / re-baseline).
- Loop / learning layer (lifecycle state, dismiss-with-reason, outcome data).
- Push notifications (email/Teams digest).
- Extending trend consumption to SEMI/CLEAR providers (hook left in place for later).

## Release

Per [[gitlab-ci-and-ops]] + AGENTS.md release checklist: bump `version.ts` (APP_VERSION +
milestone stays "Jemisin" if same minor line, else new codename), add `CHANGELOG.md` entry,
append a new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` (+ EN/DE strings).
