<!-- Split out of AGENTS.md, which is the always-loaded file (CLAUDE.md is `@AGENTS.md`).
     THIS file is NOT auto-loaded — open it when you work on this subsystem.
     Same conventions: ★ = a non-obvious rule, ★★ = has already caused a bug,
     ★★★ = has caused the same bug more than once.
     `npm run docs:symbols:check` gates this file exactly as it gates AGENTS.md:
     it proves a backticked NAME is real, never that a CLAIM about it is true.
     Every claim here was true when written and some have outlived their code —
     grep before relying on one, and correct what you disprove in the same commit. -->

# Insights → action loop

[← AGENTS.md](../../AGENTS.md) · [doc set](../../AGENTS.md#the-doc-set--what-lives-where)

### Insights → action loop

- **Pure `insights/` engines (i18n-free):** `detect.ts` `detectInsights(input, today)` runs FIVE
  deterministic detectors (milestone slip · stalled/no-progress work · budget aging · RAID aging ·
  overdue-trend) → `DetectedInsight[]`; `reconcile.ts` `reconcileInsights(stored, detected, today)` merges
  detected signals into the stored record, DEDUPES by a stable key, and PRESERVES each insight's lifecycle
  (`active` → `acknowledged`/`acted`/`dismissed` → `resolved`). `sanitize-insights.ts` = the single validator
  (never throws), `insight-text.ts` = i18n-free label/summary helpers, `insight-prompt.ts`
  `buildInsightsPromptBlock(insights)` = the AI context block. ★ `overdueTrend` is INERT in SP1 — it needs a
  prior-overdue count threaded in (SP2); do NOT treat its empty output as a bug.
- **Persistence + export:** `Workspace.insights` is a JSON blob persisted across ALL SIX write paths
  (JSON/CSV/MD/Turso-single/Turso-tenant/IndexedDB) and is EXPORTABLE via a new `insights` `ExportSectionKey`
  (default OFF, like `knowledgeItems`). ★★ An EMPTY record is BYTE-STABLE (no golden regen); mirrors the
  `knowledgeItems` app-level save/load wiring — value+setter through `workspace-context`, set on load in
  `applyWorkspace` + `task-manager` restore, and INCLUDED in the `backend.save({…})` literals + `currentWorkspace()`
  so it actually autosaves. ★★ LANDMINE: the autosave-effect DEPS array MUST include insights or edits silently
  drop (data-loss).
- **Detect→reconcile runner (task-manager):** debounced, gated `hydrated && !isPopout`, functional
  `setInsights((prev) => reconcileInsights(prev ?? [], detected, today))`. ★★ Its content-key EXCLUDES lifecycle
  fields, so acting on / dismissing an insight can't re-trigger detection → the reconcile→setInsights→re-run loop
  is avoided.
- **Surfaces:** Dashboard `dashboard-sections/insights-card.tsx` + a dedicated `insights` AppView (an Overview
  SUB-CHILD of `dashboard` in `nav-config.ts`, NOT Turso-gated, IS in axe `A11Y_VIEWS` as `#insights`). ★ severity
  rides a `RagDot` (non-text, AA-exempt), NEVER tinted small text. AI-aware: `buildInsightsPromptBlock` is appended
  AFTER the chat cache breakpoint (volatile — reflects the live record without busting prompt caching).
- **Prompt block — TWO sections since B2a:** `buildInsightsPromptBlock` emits the ACTIVE/acknowledged set
  (`SURFACED_STATUSES`, severity-sorted, capped at `MAX_PROMPT_INSIGHTS`) AND a "Recent outcomes" section over
  insights that are `acted`/`resolved` AND carry a MEASURED `outcome` (newest `measuredAt` first, capped at the
  new `MAX_PROMPT_OUTCOMES`). ★★ It therefore no longer returns `""` merely because the active set is empty —
  it returns `""` only when BOTH sections are empty. A caller that reads an empty active list as "no block"
  now drops real context. The second section is what stops the assistant re-recommending an action the user
  already took, INCLUDING one that changed nothing: `unchanged` is deliberately kept, since filtering it
  would bias the model toward things that worked.
  ★★ **The status is not sufficient — the `outcome` must be present.** `isMeasured` requires both, because
  `outcome` is only ever written against a `metricAtAction` baseline that reconcile captures at the first
  transition to `acted`. That is what licenses the "→ acted" wording on a row whose status now reads
  `resolved`.
  ★ `outcome.current`/`outcome.delta` are ABSENT when an insight simply stopped firing (four of the five
  detectors are threshold-gated, so "cleared" means below-threshold, not zero) — `outcomeLine` then prints the
  direction with no magnitude rather than implying a measured move.
  ★★★ **`delta` is `baseline − current`, so POSITIVE means BETTER** (every insight metric is
  lower-is-better). A fixture pairing `direction: "improved"` with a NEGATIVE delta typechecks and would ship
  teaching the inverse convention to every later reader — the B2a plan contained exactly that
  (`baseline: 9, current: 3, delta: -6`, where the arithmetic gives `+6`). `insight.ts`'s own field doc is
  the authority.
  ★★ **The outcomes section rides EVERY turn**, which is why it is capped rather than windowed (the module is
  deterministic and clock-free by contract, so "recent" is expressed as sort-then-cap). GROWING the cap is a
  token-cost decision and fine to revisit; MOVING the block into the cached prefix is not — it would
  invalidate the cached prefix on every reconcile pass. `chat-api.system-prompt.test.ts`'s "puts both insight
  sections in the UNCACHED block, never the cached one" is what enforces that, and it did not exist until
  B2a: that file guarded the tools, view-scope and digest breakpoints only, while being repeatedly cited as
  covering this block too.
- **SP2 — proactive AI recommendations (0.191.0):** an `Insight` gains an optional persisted
  `recommendation` (`{summary, proposedCalls[], generatedAt, status: proposed|applied|rejected, appliedSummary?,
  appliedAt?}`) that rides the SAME insights blob (no new backend path, byte-stable when empty). ★★ THREE landmines:
  (1) `insightsMateriallyEqual` (reconcile) MUST compare the recommendation, else a freshly-generated rec is
  silently dropped by the churn guard (the SP1 data-loss class — pinned by a test); (2) `reconcile` upsert carries
  the rec forward via `...prev`, and a re-fire DROPS it (a stale proposal no longer fits the recurring problem);
  (3) `sanitizeInsights` only shape/size-guards `proposedCalls[].input` — the real per-entity validation happens at
  APPLY time in `runTool`. Pure engines: `insights/recommend.ts` (forced-tool `propose_insight_actions` +
  `parseRecommendation` re-grounding every entity id against the live workspace via `action-ai` `GroundingIndex`,
  allow-set = safe update/create tools only, NO delete/settings), `recommend-context.ts` (per-insight digest +
  cacheable system prompt, i18n-free English), `recommend-plan.ts` (`describeRecommendationPlan(calls, ws)` → an
  `EditPlan` preview reusing the inline-ai-edit descriptor engine, grounding each call by ITS OWN id). The call
  (`recommend-call.ts` `runInsightRecommendation`) mirrors `task-dedup-call` — ONE forced call through the shared
  never-log `runForcedToolCall`. TWO triggers share the generate path: on-demand hook `use-insight-recommend.ts`
  (per-insight ✨ button) + opt-in background `use-insight-recommend-runner.ts` (mirrors `use-scheduled-job-runner`
  — `[]`-dep refs, mount+visibility+15-min tick, serial, capped `MAX_BG_RECS_PER_TICK`, breaks the tick on a
  limit/auth error; gated `isAiEnabled && settings.ai.insightRecommendations === true && !isPopout`, default OFF).
  ★★ APPLY replays `rec.proposedCalls` DIRECTLY through the chat `runTool` dispatcher (each `{name,input}` carries
  its id; the `EditPlan` is PREVIEW-ONLY — its `updates` carry no id, so a multi-call rec can't apply from the
  plan). task-manager owns the generate/apply/reject handlers (the `insightActions` bag moved AFTER
  `useChatDispatcher` so apply can reach `dispatcher`/`runTool`) + the `recommendation-review-modal.tsx` (Confirm →
  replay → `recommendation.status="applied"` + insight `acted`, no undo; logs `ai.insightRecommendation`).
  ★★ THAT ADVANCE IS NO LONGER UNCONDITIONAL. Every proposed `update_*` call is stamped with an
  optimistic-concurrency token when the recommendation is STORED, and a replay whose target row has moved
  since is refused before the dispatcher is reached; when nothing committed and every failure was such a
  refusal, the insight is left untouched and the recommendation stays `proposed` so it can be regenerated
  against the moved data. Mechanism, the reason the stamp happens at storage time rather than at apply time,
  and the `ConcurrencyTokenError` type-match rule live in
  [`ai-assistant.md`](ai-assistant.md) — not restated here. Shared
  row controls in `insight-recommendation-controls.tsx` (both surfaces). ★ `overdueTrend` NOW FIRES:
  `buildInsightInput` reads the prior overdue count from the per-project `landing-state` `metrics.overdue`
  (key = `portfolioCurrentId ?? "default"`, the SAME key workspace-section writes; memo captured at mount, NOT
  re-read on activity — that would race `use-landing-delta`'s ~4s snapshot advance). SP4 = digest.
- **SP3 — outcome measurement (0.192.0):** acting on an insight captures the ONE number it is about into
  `metricAtAction`; a later reconcile measures the live number against it into a persisted `outcome`
  (`{direction: improved|unchanged|worsened, baseline, current, delta, measuredAt}`). Both ride the SAME
  insights blob (no new backend path, byte-stable when absent). Pure i18n-free `insights/outcome.ts` owns
  `METRIC_FIELD` (milestoneSlip→`daysOverdue` · overdueTrend→`current` · stalledWork→`count` ·
  budgetVariance→`variancePct` · raidAging→`daysSinceUpdate`), `insightMetricValue`/`insightMetricSnapshot`/
  `metricAtActionPatch`/`baselineOf`/`computeOutcome`. ★★ ALL metrics are LOWER-IS-BETTER, so `improved` ⇔
  current < baseline and `delta = baseline − current` — there is deliberately NO per-type direction table;
  a new detector whose metric is higher-is-better would break that assumption and needs one. ★ `delta` is
  NEGATIVE when worsened — the UI must render `Math.abs(delta)`. ★★ CAPTURE is at EVERY acted transition
  (manual `onActInsight` AND `confirmInsightRecommendation`), both spreading the SAME `metricAtActionPatch(i)`
  — read `i` from the functional setter's `prev`, NEVER a closure-captured insight, and the FIRST act wins
  (a re-act must not overwrite the baseline). ★★ MEASUREMENT lives in `reconcile`: `upsert` re-measures an
  `acted`+still-detected record from the fresh `det.data`; `clear` labels the (pre-existing SP1) acted→resolved
  auto-resolve as `improved` via `computeClearedOutcome` — ★★ DIRECTION-ONLY (no `current`/`delta`): four of
  the five detectors are THRESHOLD-gated (`stalledWork count<3`, `budgetVariance pct<10`, `raidAging days<7`,
  `overdueTrend current<=prior`), so "cleared" is BELOW THRESHOLD not zero, and reconcile has no detection left
  to read the true value from — emitting `current: 0` OVERSTATES the delta (review-caught: "improved by 10" for
  a real move of 8). `InsightOutcome.current`/`delta` are therefore OPTIONAL and the badge renders
  `insightOutcomeResolved` when they are absent. ★★ re-fire DROPS BOTH `outcome` AND `metricAtAction` — a
  recurrence is a NEW problem instance; keeping the baseline would make the next act a no-op for
  `metricAtActionPatch` ("first act wins") and measure a July recurrence against a March baseline.
  Measurement is idempotent (same data + same `today` ⇒ same outcome) so the reconcile→setInsights→re-run
  cycle converges — a test pins it. ★★ DATA-LOSS LANDMINE (third time in this feature): `insightsMateriallyEqual`
  MUST compare `outcome` (`outcomeEqual`) or the runner's churn guard skips the write-back and a freshly
  measured outcome is silently lost — exactly the SP1/SP2 class. ★ the badge (`insights/insight-outcome-badge.tsx`)
  renders in the Insights VIEW ONLY — the dashboard card filters to `active`/`acknowledged` while outcomes exist
  only on `acted`/`resolved`, so a card mount is unreachable dead code (one was written and removed). Direction
  rides the DOT; the wording carries the meaning so it is never colour-only. ★ the dot is a LOCAL
  `DIRECTION_DOT` token map, deliberately NOT the shared `RagDot` — that primitive's `level` is `Health`
  (`"R"|"A"|"G"`) and cannot express the neutral "unchanged" state (neutral→amber would read as "at risk").
  This mirrors every other non-Health dot in the app (`TIER_RAG` in `actions-panel`/`action-chips`, the
  resource-picker linked marker, tour step dots); `RagDot` stays reserved for genuine RAG health. Don't
  "fix" it to RagDot. ★ SP2 fold-ins landed here too:
  the recommendation context now includes a bounded linked-entity digest (milestones + raid only — the only
  detectors with an `entityRef`; RAID owner via `effectivePersonName`, incl. the `mitigation` plan so the model
  stops re-proposing an existing fix), a `rejected` recommendation re-offers the Generate CTA (shared
  `GenerateRecommendationCta`, NOT duplicated JSX — the dup gate is blocking), `runInsightRecommendation` lost a
  dead `| null`, and the background runner lost an unused `now` arg. ★ the apply preview re-derives against LIVE
  entities at apply time by design (a background proposal can be stale); the allow-set is enforced at load AND
  apply, so that divergence is safe.
- **SP4 — digest (0.193.0):** the FINAL slice. A rolling-window summary card at the top of the Insights
  view: fired / acted / open-now, plus a **wins** list (resolved-with-outcome) and a **regressions** list
  (worsened). Pure i18n-free `insights/digest.ts` `computeInsightDigest(insights, today, windowDays?)` →
  `InsightDigest`. ★★ Adds **ZERO persisted fields and ZERO backend write paths** — it is pure derivation
  over the lifecycle timestamps SP1–SP3 already store, so there is no six-write-path chore and no golden
  regen. Do NOT "improve" it into a persisted record. ★ window is INCLUSIVE at both ends (7 days = today +
  the 6 prior), cutoff via UTC-midnight `Date.parse` (the `bucketMilestonesByHorizon` pattern, no clock in
  the module — `today` passed in); future-dated events EXCLUDED (a skewed clock or imported record must not
  inflate counts); unparseable `today` → empty digest, never throws. ★★ `openNow` is deliberately NOT
  windowed — it is a live state, not an event — so `isEmpty` can be false with zero fired/acted, and the
  card separates it visually (own span behind a `·`) so "N open now" can't read as "N opened this week".
  ★★ wins and regressions are MUTUALLY EXCLUSIVE: the regression branch skips `resolved` records. Without
  that guard a resolved+worsened record counts in BOTH lists — unreachable in-app (`computeClearedOutcome`
  always writes `improved`) but `sanitizeInsights` RE-DERIVES direction from baseline/current and admits
  the shape from an imported blob. ★ the card (`insights/insight-digest-card.tsx`) is props-only (the
  panel's tests render outside providers), REUSES `InsightOutcomeBadge`, caps each list at
  `MAX_DIGEST_ROWS=5` with a NON-interactive `+N more` span (the full set is one History-toggle click away;
  a dead affordance is worse than a count), and makes a row a `<button>` only when `onOpenInsight` is
  passed AND `insight.entityRef !== undefined` — `stalledWork`/`overdueTrend`/`budgetVariance` are
  portfolio-level and carry NO entityRef, so an ungated row would be a dead button. Insights IS axe-scanned
  → row-unique accessible names.
- **SP4 cadence:** the SP2 background runner's fixed 15-min tick became
  `settings.ai.insightRecommendationIntervalMinutes` (default **60**, rides the `writeSettings` spread, no
  allowlist edit), edited via the shared `CapInput` in `AiSection` (shown only while
  `insightRecommendations` is on). ★★ ONE clamp — `clampInsightRecInterval` (`settings-types.ts`, whole
  minutes [15, 1440], the `clampMaxChatTurns` pattern) — is used by the sanitizer on load, the input on
  edit AND the runner on read, because this value drives BILLED calls; the FLOOR is load-bearing (`Number
  (null)` is `0`, which is finite, so only the range check rejects it). ★★★ `use-insight-recommend-runner`
  now has TWO effects and they must NOT be merged: a `[]`-dep one for the mount tick + `visibilitychange`,
  and an `[intervalMs]`-dep one for the `setInterval` ALONE. Folding the interval into the `[]` effect
  leaves a stale rate armed until reload; adding `[intervalMs]` to the effect that also fires the mount
  tick spends an EXTRA BILLED ROUND on every settings edit. The tick body lives in a `useRef` initializer
  (NOT an assignment during render — that trips the react-hooks purity rule); freezing the first closure is
  safe ONLY because the body reads nothing but refs — keep it that way.

