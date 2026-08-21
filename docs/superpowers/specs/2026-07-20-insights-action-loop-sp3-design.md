# Insights → Action Loop SP3 — Outcome Measurement (Design)

**Feature #6B.** Slice 3 of 4. Build order SP1 → SP2 → **SP3** → SP4; each its own spec → plan → ship.

SP1 (0.190.44 "Pinsker") shipped the persisted, deduped `Workspace.insights` log with a
deterministic detector→reconcile lifecycle, surfaced on the Dashboard + a dedicated view, exportable,
and fed into AI chat. SP2 (0.191.0 "Le Guin") made an insight *actionable by AI* — an AI-proposed,
executable recommendation the user reviews and applies, recorded on the insight.

**SP3 closes the loop:** when an insight is acted on, snapshot the one number it is about; on a later
reconcile, compare the live number to that baseline and label the outcome (improved / unchanged /
worsened + delta). A fully-fixed insight already auto-resolves in SP1 — SP3 labels that win. This turns
the log from "here are problems + suggested fixes" into "here is whether the fixes worked", and gives
SP4's digest real outcome data.

- SP1 — persisted, deduped insight log with lifecycle.
- SP2 — proactive AI recommendations write executable, tracked proposals into the log.
- **SP3 (this)** — outcome feedback measures whether the metric moved after an action.
- SP4 — a periodic insight digest synthesizes the log (incl. outcomes) into a briefing.

**Out of scope for SP3:** the digest (SP4), new deterministic detectors, new AI write tools, any new
backend write path (outcome rides the existing insights blob).

---

## Decisions (from brainstorming)

1. **Capture trigger = any transition to "acted"** — the baseline snapshots whenever an insight becomes
   `acted`, via manual "Act" (SP1 `onAct`) OR AI recommendation-apply (SP2 `confirmInsightRecommendation`).
   Broadest coverage — measures the outcome of ALL user actions, not just AI ones.
2. **Metric scope = per-insight-type metric** — snapshot the ONE number the insight is about (per-type
   extractor), not a broad KPI bundle. Precise and meaningful per row.
3. **Outcome behavior = badge + auto-resolve on fix** — show an outcome badge on acted/resolved rows;
   when the condition fully clears the insight auto-resolves (SP1 already does this — SP3 labels it
   `improved`). Worsened/unchanged acted rows keep their status + a badge.

---

## Data model (`insights/insight.ts`)

`metricAtAction?: Readonly<Record<string, number>>` already exists (reserved in SP1, "RESERVED for SP3").
SP3 uses it and adds ONE optional field.

```ts
export const INSIGHT_OUTCOME_DIRECTIONS = ["improved", "unchanged", "worsened"] as const;
export type InsightOutcomeDirection = (typeof INSIGHT_OUTCOME_DIRECTIONS)[number];

export interface InsightOutcome {
  readonly direction: InsightOutcomeDirection;
  readonly baseline: number;   // = the captured metricAtAction value
  readonly current: number;    // the live metric at measurement time
  readonly delta: number;      // baseline − current (positive ⇒ better; ALL metrics are lower-is-better)
  readonly measuredAt: string; // ISO date
}

// Insight gains:
//   readonly outcome?: InsightOutcome;
```

`metricAtAction` is a `{ [field]: value }` map with the single per-type field (below). Kept as a map (not
a bare number) to match the reserved type and stay forward-compatible.

### Per-type metric (all lower-is-better, so `improved` ⇔ current < baseline)

From `detect.ts` `data` keys (guard-tested against them):

| InsightType    | metric field       | fixed when |
|----------------|--------------------|------------|
| milestoneSlip  | `daysOverdue`      | 0 / not overdue |
| overdueTrend   | `current`          | count drops |
| stalledWork    | `count`            | count drops |
| budgetVariance | `variancePct`      | variance drops |
| raidAging      | `daysSinceUpdate`  | item touched → resets |

### Persistence (rides the existing blob — no new write path)
`outcome` + `metricAtAction` serialize with the insights blob across all six SP1 paths (JSON / CSV
`# INSIGHTS` / MD `## Insights` / Turso single+tenant meta row `insights` / IDB KV) as JSON — no codec
change. **Empty ⇒ byte-stable** (no golden regen): an insight without `outcome`/`metricAtAction`
serializes identically to SP1/SP2.

### `sanitizeInsights` (SINGLE validator, never throws)
Extend to validate `outcome`:
- Drop the whole field unless `direction` ∈ the enum AND `baseline`/`current`/`delta` are finite numbers.
- `direction` → enum-guard.
- `baseline`/`current`/`delta` → `toNumber`-coerced, non-finite ⇒ drop the field.
- `measuredAt` → date-guard.
`metricAtAction` validation is unchanged from SP1 (numeric-value record).

---

## Outcome engine (pure i18n-free `insights/outcome.ts`)

No React / fetch / i18n. `today` passed in.

```ts
export const METRIC_FIELD: Record<InsightType, string> = {
  milestoneSlip: "daysOverdue",
  overdueTrend: "current",
  stalledWork: "count",
  budgetVariance: "variancePct",
  raidAging: "daysSinceUpdate",
};

/** The comparable number for an insight, pulled from its `data`. null when absent/NaN. */
export function insightMetricValue(
  type: InsightType,
  data: Readonly<Record<string, string | number>>,
): number | null;

/** Snapshot `{ [field]: value }` for metricAtAction, or undefined when the value is absent. */
export function insightMetricSnapshot(insight: Insight): Readonly<Record<string, number>> | undefined;

/** direction: improved if current<baseline, worsened if current>baseline, else unchanged. */
export function computeOutcome(baseline: number, current: number, today: string): InsightOutcome;
```

A guard test pins `METRIC_FIELD` values against the `data` keys each detector actually emits (a renamed
detector field must not silently strand the extractor at `null`).

---

## Capture (task-manager) — "any transition to acted"

`insightMetricSnapshot(insight)` stamps `metricAtAction` at BOTH acted sites, via one shared helper so
they can't drift:

- **SP1 `onAct(id)`** (manual "Act" from card/panel) — set `status="acted"`, `actedAt=today`,
  `metricAtAction = insightMetricSnapshot(insight)` (only when a metric exists; else omit).
- **SP2 `confirmInsightRecommendation`** (AI apply) — already advances to `acted`; ALSO capture
  `metricAtAction` in the same functional-setter update.

Both read the insight's `data` at act time (last-detected values) — the value that was true when the
user acted. If the insight had no numeric metric (defensive), `metricAtAction` is omitted and no outcome
is ever computed (the row just shows no badge). Capture must NOT overwrite an existing `metricAtAction`
on a re-act (idempotent — the first act's baseline is the true "before").

---

## Reconcile wiring (`insights/reconcile.ts`)

Outcome is derived state (baseline is captured in task-manager; reconcile only measures against it), so
reconcile stays pure — `today` already flows in.

- **upsert — acted (or resolved-then-refiring back through acted history) AND still-detected** →
  recompute `outcome` from the fresh `det.data` metric vs `metricAtAction` via `computeOutcome`. Attach
  it (replacing any prior outcome). Idempotent: same detection ⇒ same outcome, so a second reconcile
  with unchanged workspace converges — no re-run loop (the detection content-key already excludes
  lifecycle/outcome fields). Only computed when `metricAtAction` exists AND the metric is extractable;
  else `outcome` is left as-is/absent.
- **clear — acted → resolved** (SP1 already resolves via `hadUserAction`, which includes `actedAt`) →
  attach `outcome` with `direction="improved"`: the condition cleared (no longer detected) ⇒ fully
  fixed. `current` = 0 fallback, `baseline` = the captured metric, `delta = baseline − 0`. When there is
  no `metricAtAction` (acked-only, never acted), resolve exactly as SP1 with no outcome.
- **re-fire (dismissed/resolved → active)** — SP2 already rebuilds the record and preserves
  `metricAtAction`; SP3 additionally DROPS a stale `outcome` (the world changed; the old measurement no
  longer applies). Keep `metricAtAction` (history) but clear `outcome`.

### `insightsMateriallyEqual` (churn guard — DATA-LOSS LANDMINE)
Add an `outcome` comparison (deep-equal on direction/baseline/current/delta/measuredAt). Without it, a
freshly measured outcome returns the same-material verdict → the runner skips the write-back → the
outcome is silently lost (the exact SP1/SP2 data-loss class). A regression test pins it. `metricAtAction`
is already compared (SP2).

---

## UI — outcome badge (`insights-card.tsx` dashboard + `insights-panel.tsx` view)

Both surfaces are axe-scanned; all new markup uses DS primitives, palette tokens, row-unique labels.

On an insight with an `outcome`, render a small badge near the status/severity line:
- `improved` → a down/check icon + delta (e.g. "↓ 3 overdue since you acted"), `--rag-green` on the
  ICON/dot only.
- `unchanged` → a neutral dash + "no change since acted", muted.
- `worsened` → an up icon + delta, `--rag-red`/`--rag-amber` on the ICON only.

★ NOT the shared `RagDot` primitive: its `level` is `Health` (`"R" | "A" | "G"`), which cannot express the
neutral "unchanged" state, and mapping neutral→amber would read as "at risk". The badge therefore uses a
LOCAL `DIRECTION_DOT` token map — the same pattern the repo already uses for every non-Health dot
(`TIER_RAG` in `actions-panel.tsx`/`action-chips.tsx`, the resource-picker linked marker, tour step dots).
`RagDot` stays reserved for genuine RAG health.

★★ Direction rides the **DOT (non-text, AA-exempt)** — NEVER tinted small text (the recurring
AA rule; `--rag-amber-text` fails AA as small text on dark/mockup). The delta wording is muted text. No
status-changing control (resolve is automatic).

★ **The badge lives in the Insights VIEW only** (`insights-panel.tsx`), not the dashboard card. The card
filters to `active`/`acknowledged`, and reconcile only writes an `outcome` on `acted` (still-detected) or
`resolved` records — those sets never intersect, so a card-side mount would be unreachable dead code
(caught during implementation; an earlier draft of this spec wrongly claimed the badge would appear on
"still-acted rows on the dashboard"). The division is deliberate: the dashboard answers "what needs me
now", the Insights view answers "did acting work". Surfacing outcomes on the dashboard would mean
widening the card's filter — a product change, out of scope for this slice.

New EN + DE keys: `insightOutcomeImproved`, `insightOutcomeUnchanged`, `insightOutcomeWorsened`
(each takes the delta via positional `{0}` where relevant), plus an accessible-name string for the
badge. DE via node utf8 write (real umlauts, CRLF anchors).

Live axe on both surfaces (5 theme combos) after the markup change.

---

## SP2 fold-ins (bundled into this slice)

1. **recommend-context linked-entity digest** — `insights/recommend-context.ts` `buildRecommendContext`
   currently omits the linked entity's current fields (a deferred comment in task-manager notes it). Add
   the insight's `entityRef` target's live fields to the context digest so the AI proposes against real
   current state. Token-bounded, same cap-per-category discipline as `action-ai.buildAnalysisContext`.
2. **regenerate-after-reject** — a `rejected` recommendation currently shows only a muted "dismissed"
   note with no path forward. Re-show the `✨ Recommend fix` CTA on a `rejected` recommendation (gated
   on `isAiEnabled`, !popout) so the user can regenerate. `onGenerateRecommendation` overwrites the
   rejected recommendation with a fresh `proposed` one.
3. **recommend-call dead `| null`** — `runInsightRecommendation`'s return union carries a vestigial
   `| null` it never returns (`runForcedToolCall` throws on failure; parse-fail throws). Narrow the
   return type; update the one call site if it branches on null.
4. **runner unused `now` arg** — `use-insight-recommend-runner.ts` takes a `now` it doesn't use. Remove
   it (lint `--max-warnings=0` would flag an unused param anyway if surfaced).
5. **WYSIWYG note (doc-only)** — the apply preview re-derives against live entities at apply time, so a
   background proposal generated earlier can diverge from what generation saw; this is intentional and
   security holds (allow-set enforced at load + apply). No code change — a one-line AGENTS.md note.

---

## Testing

- `outcome.ts` — `insightMetricValue` per type (correct field, string→number, NaN→null);
  `insightMetricSnapshot` omits when absent; `computeOutcome` direction/delta boundaries
  (improved/unchanged/worsened); `METRIC_FIELD` guard vs the `data` keys `detect.ts` emits.
- `reconcile` — acted + still-detected computes an outcome from fresh data; acted → resolved attaches
  `improved`; re-fire drops a stale outcome but keeps `metricAtAction`; **`insightsMateriallyEqual`
  detects an outcome change** (the data-loss regression).
- `sanitize-insights` — outcome shape/enum/number/date guards; corrupt outcome dropped; empty ⇒
  byte-stable.
- capture — both `onAct` and `confirmInsightRecommendation` snapshot `metricAtAction`; a re-act does not
  overwrite the first baseline.
- fold-ins — `buildRecommendContext` includes the linked entity's fields; a `rejected` recommendation
  renders the regenerate CTA; `recommend-call` return type has no `null`; runner signature dropped `now`.
- Live axe on both surfaces (5 theme combos) after any card/panel markup change.

## Release

MINOR bump — `version.ts` (APP_VERSION `0.192.0` + a NEW milestone codename; grep CHANGELOG so it is
unused per the codename-unique rule), `versionHighlightInsightsOutcome` (+ EN/DE + `APP_HIGHLIGHT_KEYS`),
`package.json`, `CHANGELOG.md`, `AGENTS.md` (extend `### Insights → action loop`: outcome measurement +
the WYSIWYG note), file-size baseline if any file crossed. Full suite + tsc + lint + dup + size + live
axe green. Superpowers code review before the release chain. Merge only on explicit "release".
