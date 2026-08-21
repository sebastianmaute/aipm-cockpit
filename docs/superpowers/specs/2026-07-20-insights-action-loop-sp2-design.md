# Insights → Action Loop SP2 — Proactive AI Recommendations (Design)

**Feature #6B.** Slice 2 of 4. Build order SP1 → **SP2** → SP3 → SP4; each its own spec → plan → ship.

SP1 shipped (0.190.44 "Pinsker") the persisted, deduped `Workspace.insights` log with a
deterministic detector→reconcile lifecycle, surfaced on the Dashboard + a dedicated view, exportable,
and fed into AI chat. SP2 makes an insight *actionable by AI*: it can carry an AI-proposed, executable
recommendation the user reviews and applies, recorded on the insight so later slices can measure the
outcome.

- **SP2 (this)** — proactive AI recommendations write executable, tracked proposals into the log.
- SP3 — outcome feedback measures whether the metric moved after an action (`metricAtAction`).
- SP4 — a periodic insight digest synthesizes the log into a briefing.

**Out of scope for SP2:** outcome measurement, digest, new deterministic detectors, new AI write tools
(recommendations reuse the existing chat `runTool` schemas).

---

## Decisions (from brainstorming)

1. **Trigger = BOTH** — a per-insight on-demand button *and* an opt-in background scheduled job, sharing
   one generate path.
2. **Execution = reuse chat `runTool` (plan-then-apply)** — AI proposes concrete tool calls; the user
   reviews a diff; Confirm replays through the existing dispatcher. Zero new AI write tools / Workspace
   fields / backend write paths.
3. **Tracking = persist the recommendation + applied-action on the `Insight`** — new optional fields
   ride the existing insights blob (no new backend path); required so a background proposal survives to
   be seen, and so SP3 can correlate action → outcome.
4. Fold in the deferred SP1 gap: thread `priorOverdueCount` so `overdueTrend` fires.

---

## Data model

Extend the SP1 `Insight` (in `insights/insight.ts`) with ONE optional field. Text is model prose
(English), consistent with the existing `report_analysis` `summary` and the English-only AI layer — it
is model output, not app-rendered i18n.

```ts
export interface InsightToolCall {
  readonly name: string;                          // a chat write-tool name (validated on apply)
  readonly input: Readonly<Record<string, unknown>>; // sanitized per-entity at apply time
}

export type InsightRecommendationStatus = "proposed" | "applied" | "rejected";

export interface InsightRecommendation {
  readonly summary: string;                        // one-line what/why (model prose, English)
  readonly proposedCalls: readonly InsightToolCall[];
  readonly generatedAt: string;                    // ISO date
  readonly status: InsightRecommendationStatus;
  readonly appliedSummary?: string;                // human summary of what was applied (log + SP3)
  readonly appliedAt?: string;
}

// Insight gains:
//   readonly recommendation?: InsightRecommendation;
```

New caps in `insight.ts`: `INSIGHT_REC_SUMMARY_MAX = 500`, `INSIGHT_REC_MAX_CALLS = 5`,
`INSIGHT_REC_APPLIED_SUMMARY_MAX = 500`, `MAX_BG_RECS_PER_TICK = 3`.

### Persistence (rides the existing blob — no new write path)
The `recommendation` field serializes with the rest of the insights blob across all six SP1 paths
(JSON / CSV `# INSIGHTS` / MD `## Insights` / Turso single+tenant meta row `insights` / IDB KV). No
codec change is needed beyond the JSON round-trip the blob already does — the CSV/MD codecs store the
insights record as a JSON payload, so a nested field is transparent. **Empty ⇒ byte-stable** (no golden
regen): an insight with no `recommendation` serializes identically to SP1.

### `sanitizeInsights` (SINGLE validator, never throws)
Extend to validate `recommendation`:
- Drop the whole field unless `summary` is a non-empty string and `proposedCalls` is an array.
- `summary` / `appliedSummary` → `sanitizeText`-capped.
- `status` → enum-guard (`proposed`/`applied`/`rejected`), default `proposed`.
- `proposedCalls` → keep only `{ name: string, input: object }` entries; cap at `INSIGHT_REC_MAX_CALLS`;
  `name` capped; `input` kept as an opaque object (re-sanitized per-entity at APPLY time by `runTool`,
  not here — this layer only guards shape/size so a corrupt blob can't crash the load).
- `generatedAt` / `appliedAt` → date-guard.

---

## Reconcile changes (`insights/reconcile.ts`)

The recommendation is user/AI state, not detection state, so reconcile must preserve it like the
lifecycle stamps:

- **upsert** — carry `recommendation` forward unchanged (a fresh detection of the same key must not drop
  a pending/applied recommendation).
- **re-fire** — a `dismissed`/`resolved` record firing again returns to `active`; **clear a stale
  `applied` recommendation** (the world changed — the old proposal no longer describes the fix), but a
  still-`proposed` one may carry forward. Simplest safe rule: on re-fire, drop `recommendation` entirely
  (regeneration is one click / one background tick away). Documented as intentional.
- **clear/resolve/prune** — unchanged; a resolved insight keeps its recommendation as history (SP3/SP4
  read it).

### `insightsMateriallyEqual` (churn guard — DATA-LOSS LANDMINE)
MUST compare the `recommendation` sub-fields (summary/status/generatedAt/appliedAt/appliedSummary +
proposedCalls deep-equal). If it ignores `recommendation`, a newly generated recommendation returns the
same-material verdict → the runner skips the write-back → the recommendation is silently lost. This is
the exact SP1 data-loss class; a regression test pins it.

---

## Pure recommend engine (`insights/recommend.ts`, i18n-free)

The forced-tool contract + untrusted-output validation. No React / fetch / i18n.

- `RECOMMEND_TOOL` — Anthropic tool def `propose_insight_actions`, forced via `tool_choice`. Its
  `calls[]` items constrain `name` to a **curated subset** of the existing chat write-tool names
  (re-exported from `chat-tool-defs.ts` — e.g. `update_task`, `create_task`, `update_raid`,
  `update_milestone`, `update_change`; NOT delete/settings tools) plus a free-form `input` object and a
  one-line `summary`.
- `parseRecommendation(input: unknown, grounding: GroundingIndex): InsightRecommendation | null` —
  validates the model output: `summary` non-empty; each call's `name` in the allowed subset; each call
  re-grounded — any entity-id argument (`id`/`taskId`/etc.) must exist in the live workspace
  (reuse/extend `action-ai.buildGroundingIndex` + `groundEntity` semantics) else the call is DROPPED;
  cap at `INSIGHT_REC_MAX_CALLS`. Returns `null` when nothing survives (→ surface shows "no safe
  action"). NEVER trusts a model id.
- `ALLOWED_REC_TOOLS: ReadonlySet<string>` — the curated allow-set; a guard test pins it against
  `chat-tool-defs.ts` so a renamed/removed tool can't silently widen or break the set.

### Context builder (`insights/recommend-context.ts`, i18n-free)
`buildRecommendContext(insight, ws, today): string` — a compact, token-bounded digest: the insight
(type/severity/data/entity), its linked entity's current fields, and the small relevant workspace slice
(mirrors `action-ai.buildAnalysisContext`'s cap-per-category discipline). Volatile — sent as the user
message, never in the cached system block. A stable `buildRecommendSystemPrompt()` (senior-PM framing,
"propose only concrete, applicable actions via the tool; ground every id") is the cacheable prefix.

---

## The call (`insights/recommend-call.ts`, non-hook)

`runInsightRecommendation({ apiKey, model, insight, context, signal }): Promise<InsightRecommendation | null>`
— mirrors `scheduled-job-analysis.ts` / `task-dedup-call.ts` EXACTLY:
- ONE forced-tool call, no agentic loop.
- Routes the fetch through the shared `runForcedToolCall` (`ai-forced-call.ts`) — the audited never-log
  envelope (key header-only; body read only via `safeAiErrorType`; `!ok` → `AiHttpError` status-only;
  absent tool_use → `Error("parse")`).
- NEVER logs or echoes the apiKey or response body.
- Returns `parseRecommendation(toolInput, grounding)` (may be `null`).

---

## Triggers

### On-demand (hook `use-insight-recommend.ts`)
A per-insight generate state machine (idle → generating → done/error), popout read-only. Exposes
`generate(insightId)` and busy/erroring state. On success, writes the recommendation onto the insight
via a FUNCTIONAL `setInsights(prev => …)` updater (bulk-safe). AI errors surface via the shared
`classifyAiError` (usage-limit → the standard notice). This is a `.ts` glue hook — coverage-excluded
class if it becomes render-scope glue, else keep it testable; decide at implementation per the file's
purity.

### Background (opt-in, `use-insight-recommend-runner.ts`)
Mounted ONCE in task-manager, above the view. Mirrors `use-scheduled-job-runner.ts`:
ref-stable, `[]`-dep subscribe, mount + `visibilitychange` + interval tick, SERIAL, overlap-guarded,
fail-once-per-tick (a failed generate still advances so a broken key doesn't re-spam billed calls).
Gated on `isAiEnabled(settings.ai) && settings.ai.insightRecommendations === true` (default **OFF**,
opt-in — like `scheduledJobs`, UNLIKE `actionSuggestions`'s `!== false`) and `!isPopout`.

Per tick: select active/acknowledged insights **without a fresh `recommendation`** (none, or one older
than a staleness window), cap at `MAX_BG_RECS_PER_TICK`, generate SERIALLY, persist each via the
functional setter. NO new store — the recommendation's presence + `generatedAt` on the insight is the
dedup key. Reuses the same `runInsightRecommendation` the button calls.

`AiConfig` gains `insightRecommendations?: boolean`; `sanitizeAiConfig` sets it `=== true`. Toggled in
Settings → AI (fires the integration-disclaimer path on first enable, like the other AI toggles).

---

## Apply / reject (reuse inline-ai-edit — zero new tools)

Applying replays the proposed calls through the EXISTING chat `runTool` dispatcher:

- **Review** = a modal that re-derives the diff at APPLY time against LIVE entities (reuse
  `inline-ai-edit/plan.ts` `describeToolCalls` → `EditPlan`). A background proposal may be stale; the
  preview always reflects current state, and a call whose entity vanished is shown as inapplicable /
  dropped. NEVER previews against the generation-time snapshot.
- **Confirm** → replay each call through `runTool` (per-entity `sanitizeX` re-validates every value) via
  a functional `setTasks`/`setRaid`/… updater; then set `recommendation.status="applied"` +
  `appliedAt` + `appliedSummary` (built from the applied plan) and advance the insight to `acted`
  (routes through the SP1 `onAct` path so the deep-link + activity log fire). Record ONE undo entry.
- **Reject** → `recommendation.status="rejected"` (kept for history; the insight stays in its current
  status so the user can still ack/dismiss/deep-link).

New `InsightActions` methods (threaded task-manager → WorkspaceSectionProps → workspace-section →
card/panel, same chain as SP1):
`onGenerateRecommendation(id)`, `onApplyRecommendation(id)`, `onRejectRecommendation(id)`.
All popout no-op / undefined; all gated on `isAiEnabled`.

Logs a new `ai.insightRecommendation` activity kind on apply.

---

## `overdueTrend` fires (the SP1 gap)

`buildInsightInput` (task-manager) currently passes `priorOverdueCount: null`, making `overdueTrend`
inert. Thread the prior overdue count from the per-project `landing-state` metrics snapshot
(`aipm-cockpit:landing-state` → `[projectId].metrics?.overdue`) for the current `projectId` (the same
store the dashboard delta strip already advances). Read it (a pure load, no write) and pass it as
`priorOverdueCount`. `overdueTrend` then produces a real insight when overdue is rising. No new store,
no write path. If no prior snapshot exists (fresh project) it stays `null` and the detector stays inert
(correct — nothing to compare).

---

## UI

Surfaces are the SP1 `insights-card.tsx` (dashboard) + `insights-panel.tsx` (dedicated view), both
axe-scanned; all new controls use DS primitives (`Button`, the shared modal), row-unique aria-labels,
severity on the `RagDot` (never tinted small text).

Per insight, in priority order:
- `recommendation` present & `status="proposed"` → an `AI suggests: <summary>` line + `[Review & apply]`
  and `[Reject]` buttons (`Review & apply` opens the plan modal).
- `recommendation` present & `applied`/`rejected` → a muted one-line note (`Applied …` / `Dismissed
  suggestion`) — history, no buttons.
- no `recommendation` + AI enabled + !popout → a `[✨ Recommend fix]` button (calls
  `onGenerateRecommendation`; shows a busy state while generating).

The review modal reuses inline-ai-edit's preview component (field diffs + related creates) with
Confirm / Cancel. A generation nonce discards a stale in-flight result if the insight changes
underneath (mirrors inline-ai-edit's request-generation guard).

Both surfaces render the recommendation read-only in popouts (no generate/apply). The dashboard card
stays capped; a recommendation doesn't change the self-hide rule (card still shows only
active/acknowledged insights).

---

## i18n

New EN + DE keys: `insightRecommendCta` (✨ Recommend fix), `insightRecommendReview` (Review & apply),
`insightRecommendReject`, `insightRecommendSuggests` (AI suggests: {0}), `insightRecommendApplied`,
`insightRecommendRejected`, `insightRecommendGenerating`, `insightRecommendNoAction` (no safe action
found), the Settings toggle label `aiInsightRecommendations` + its description, and the release
highlight. DE via node utf8 write (real umlauts, CRLF anchors).

---

## Testing

- `sanitize-insights` — recommendation shape/cap/enum guards; corrupt call dropped; empty ⇒ byte-stable.
- `reconcile` — upsert preserves recommendation; re-fire drops a stale applied rec; **`insightsMateriallyEqual`
  detects a recommendation change** (the data-loss regression).
- `recommend` — `parseRecommendation` grounds ids (hallucinated id dropped), enforces the tool allow-set,
  caps calls, returns null when nothing survives; `ALLOWED_REC_TOOLS` guard vs `chat-tool-defs`.
- `recommend-call` — routes through `runForcedToolCall`; never logs key/body; parse error path.
- runner — gated OFF by default; serial + capped + fail-once; skips insights with a fresh rec.
- apply — replays through `runTool`, re-sanitizes, stamps applied + acted, records undo; stale call
  dropped at apply.
- `overdueTrend` — fires with a real prior count; inert when prior is null.
- Live axe on the two surfaces (5 theme combos) after any card/panel markup change.

## Release

Bump `version.ts` (APP_VERSION + milestone — grep CHANGELOG for the next "Pinsker" block codename),
`versionHighlightInsightsRecommend` (+ EN/DE + `APP_HIGHLIGHT_KEYS`), `package.json`, `CHANGELOG.md`,
`AGENTS.md` (extend the `### Insights → action loop` section), file-size baseline if any file crossed.
Full suite + tsc + lint + dup + size + live axe green. Superpowers code review before the release chain.
