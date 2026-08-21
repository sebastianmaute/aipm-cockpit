# Insights SP4 — Digest (design)

Feature #6B "Insights → Action Loop", **SP4 of 4** (final slice).

SP1 surfaced problems, SP2 proposed fixes, SP3 measured whether the fix worked.
SP4 makes the loop *legible over time*: a rolling 7-day digest at the top of the
Insights view answering "what happened, what did I do, did it help".

Folds in the two SP3 deferred items:
1. acted→resolved wins are invisible (hidden behind the History toggle)
2. the background recommendation runner's cadence is hardcoded at 15 minutes

---

## Decisions (locked)

| Fork | Decision |
|---|---|
| Surface | New card at the top of the `insights` view. NOT folded into the 0.172.0 weekly status digest (that one targets stakeholders; this targets the PM). |
| Period | Rolling window, always visible. No "since last viewed" marker — no new per-device store, no mount-snapshot race. |
| Composition | Deterministic only. No Anthropic call, no key needed, no billing. |
| Wins visibility | A Wins section inside the digest. The Insights view's default list filter is UNCHANGED. |
| Cadence | `settings.ai.insightRecommendationIntervalMinutes`, default **60**, user-settable. |

## Non-goals

- No AI narrative (rejected: the deterministic text already carries the facts).
- No change to `Workspace.insights` — **zero new persisted fields, zero backend
  write paths, no golden-fixture regeneration.** The digest is pure derivation
  over timestamps SP1–SP3 already persist.
- No change to the Insights view's status/type filters or History toggle.
- The RAID-`mitigation`-to-Anthropic exposure stays as-is. The 1h cadence reduces
  frequency; it does not remove the payload, which is what makes recommendations
  useful. Bounded 200 chars, no secrets, feature default OFF.

---

## Part 1 — Pure engine `src/app/insights/digest.ts`

i18n-free, no clock (`today` passed in), no `Date.now()`/`new Date()`.

```ts
export const DIGEST_WINDOW_DAYS = 7;

export interface InsightDigest {
  readonly windowDays: number;
  readonly from: string;   // inclusive cutoff, YYYY-MM-DD
  readonly to: string;     // === today
  readonly firedCount: number;
  readonly actedCount: number;
  readonly wins: readonly Insight[];
  readonly regressions: readonly Insight[];
  readonly openNow: number;
  readonly isEmpty: boolean;
}

export function computeInsightDigest(
  insights: readonly Insight[],
  today: string,
  windowDays?: number,
): InsightDigest;
```

### Window semantics

`from = today − (windowDays − 1) days`, so a 7-day window covers **today plus the
6 prior days**. An event counts when `from <= D <= today`.

- Cutoff computed via UTC-midnight `Date.parse` (the `bucketMilestonesByHorizon`
  pattern) — never `new Date()` of now.
- An unparseable `today` ⇒ an empty digest (`isEmpty: true`). Never throws.
- Future-dated events (`D > today`) are EXCLUDED — mirrors `computeCompletionTrend`
  ignoring future-dated activity. A clock-skewed or imported record must not
  inflate the counts.
- Compare with `D.slice(0, 10)`. In-app every one of these is stamped `today`
  (a bare `YYYY-MM-DD`), but `sanitizeInsights` admits up to 40 chars from an
  imported blob, so slice defensively before the lexicographic compare.

### Buckets

| Field | Rule |
|---|---|
| `firedCount` | `firstSeenAt` in window |
| `actedCount` | `actedAt` in window (any current status — acting is the event) |
| `wins` | `status === "resolved"` && `outcome !== undefined` && `resolvedAt` in window |
| `regressions` | `outcome?.direction === "worsened"` && `outcome.measuredAt` in window |
| `openNow` | live count of `active` + `acknowledged` (NOT windowed — it is a state, not an event) |

`regressions` is gated on `measuredAt`, not on status: a worsened outcome is a
live measurement on an `acted` record that is still firing. Gating it on the
window keeps a months-old stale measurement out of "this week".

`wins` and `regressions` sort deterministically: date descending, then `id`
ascending as the tiebreak (no `Date` construction — the date strings compare
lexicographically).

`isEmpty` is true only when all five are zero/empty. The card returns `null` on
`isEmpty`, so a blank or quiet project renders nothing.

The engine is **uncapped** (full and testable). The CARD caps each list.

## Part 2 — Presentational `src/app/insights/insight-digest-card.tsx`

Props-only (`digest`, `lang`, and the same deep-link handler the panel rows
already use). Mounted as the FIRST child inside the panel's
`min-h-[240px] flex-1 overflow-auto pr-2` scroller — so it scrolls with the list
rather than squeezing it, and it prints (the pane is `print-root`).

- Counts render as a compact meta line, not tiles. The dashboard already owns
  KPI tiles; this is a summary band inside a working view.
- Wins/regressions rows reuse the existing **`InsightOutcomeBadge`** — do not
  build a second badge. The direction rides the dot; the wording carries the
  meaning, so it is never colour-only.
- Each list caps at `MAX_DIGEST_ROWS = 5`, with a trailing **non-interactive**
  `<span>` "+N more". Deliberately not a button: the full set is one click away
  via the History toggle in the same view's toolbar, and a dead affordance is
  worse than a plain count.

### a11y

The `insights` view IS in axe `A11Y_VIEWS` (`#insights`), so this card is
scanned on every gate run across all 5 theme combos:
- Row entries that deep-link need a row-UNIQUE accessible name (the N-identical-
  labels WCAG 2.4.6 trap the gate can pass when only one row is seeded).
- No tinted small text for direction — dot only (`--rag-amber-text` is sub-AA as
  small text on `bg-surface` in dark/mockup).
- No `RagBadge` inside a clickable row (label bleed).

## Part 3 — Configurable runner cadence

`AiConfig` gains:

```ts
insightRecommendationIntervalMinutes?: number; // default 60, clamped [15, 1440]
```

with `DEFAULT_INSIGHT_REC_INTERVAL_MIN = 60` and a single exported
`clampInsightRecInterval(v: unknown): number` in `settings-types.ts` — the
`clampMaxChatTurns` pattern. That ONE clamp is used by the sanitizer, the
settings input, AND the runner read site, so a directly-typed out-of-range value
can never drive unbounded billed calls. Lower bound 15 min so the setting cannot
be used to hammer the API; upper bound 1440 (24h).

Rides the `writeSettings` spread — no allowlist edit. Wired into
`sanitizeAiConfig` and `defaultAiConfig`.

### ★★ Runner effect split (the landmine)

`use-insight-recommend-runner.ts` currently creates its `setInterval` inside a
single `[]`-dep effect. Mirroring the new interval into a ref would NOT re-arm
the already-created timer — the setting would silently not take effect until
reload. But simply adding `[intervalMs]` to the existing effect re-runs its
mount-`tick()` on every settings change, firing an extra billed round.

Split into TWO effects:
1. `[]`-dep: mount `tick()` + the `visibilitychange` listener. Fires once per
   hook lifetime, exactly as today.
2. `[intervalMs]`-dep: the `setInterval` only. Re-arms cleanly when the setting
   changes; no extra tick.

Everything else about the runner is untouched — the ref-mirroring, the overlap
guard, `MAX_BG_RECS_PER_TICK`, and the `limit`/`auth` `break` that stops a tick
rather than burning budget.

### Settings UI

A number input in `AiSection` beside the existing `insightRecommendations`
toggle, shown only when that toggle is on. Settings IS axe-scanned — the input
needs a real `aria-label`/`<label>` (a placeholder is NOT an accessible name).
Use the `Input` primitive; do not hand-roll.

---

## Files

**Create**
- `src/app/insights/digest.ts` — pure engine
- `src/app/insights/digest.test.ts`
- `src/app/insights/insight-digest-card.tsx`
- `src/app/insights/insight-digest-card.test.tsx`

**Modify**
- `src/app/insights-panel.tsx` — mount the card
- `src/app/settings-types.ts` — `AiConfig` field, default, clamp, sanitizer
- `src/app/use-insight-recommend-runner.ts` — interval arg + effect split
- `src/app/task-manager.tsx` — pass the clamped interval into the runner
- `src/app/settings-sections/ai-section.tsx` — the cadence input
- `src/app/i18n.ts` / `i18n.de.ts` — EN/DE keys (DE via node utf8 write, CRLF anchors, real umlauts)
- `src/app/version.ts`, `CHANGELOG.md`, `AGENTS.md`, `package.json`

## Testing

- Engine: window boundaries (on `from`, on `today`, one day either side),
  future-dated exclusion, unparseable `today`, each bucket in isolation, sort
  determinism, `isEmpty`, a full mixed record.
- Card: renders nothing when empty; wins render the outcome badge; the
  direction-only ("Resolved") shape renders; the +N cap; row-unique names.
- Clamp: below/above range, non-numeric, undefined → 60.
- Runner: changing the interval re-arms the timer WITHOUT an extra immediate
  tick (the landmine above), and the mount tick still fires exactly once.

## Gates

`npx tsc --noEmit` · `npm run lint` (`--max-warnings=0`) · `npm run test:run` ·
`npm run dup:check` · `npm run size:check` ·
`npx playwright test e2e/a11y.spec.ts --project=chromium -g "Insights"`.

Version bump to 0.193.0 with a UNIQUE milestone codename (grep `CHANGELOG.md`
before choosing) + a `versionHighlight*` key appended to `APP_HIGHLIGHT_KEYS`.
