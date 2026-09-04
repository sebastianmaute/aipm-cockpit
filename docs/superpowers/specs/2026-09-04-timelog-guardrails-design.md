# TimeLog guardrails — design

**Date:** 2026-09-04
**Register entry:** `docs/open-followups.md` §347 — "No global guardrails on time entries"
**Status:** approved 2026-09-04, not yet planned or built
**Predecessor:** the AI write-safety slice (0.279.0) and the document write-concurrency slice
(0.280.0). §347 was sequenced deliberately after them so the two touch different subsystems and
each stays reviewable.

## 1. Goal

Flag time bookings that violate team policy, and surface each violation as an **Insight**.

Cockpit never writes a time entry. OpenProject 17.8's five validations are CREATE-time checks on
entries its own users write; the honest analogue here is **REVIEW-time** — flagging bookings already
made in TimeLog. Nothing is blocked. The PM is told.

## 2. Scope

**In:** four rules — cap per entry, cap per user per day, non-working day, working hours — plus the
`reconcileInsights` evaluated-scope fix that makes any go-dark detector safe to add.

**Out, each filed as its own register entry rather than deferred silently:**

- **Closed-month rule.** OpenProject's fifth. No input exists anywhere in the tree
  (`grep -rniE "closedMonth|periodLock|lockedPeriod|monthClosed|freezePeriod" src/app --include=*.ts --include=*.tsx | grep -v test`
  returns 0). It needs a period-lock concept: a new persisted field, a settings surface, and an
  authority question — who may close a month, and does closing bind other devices. That is a
  data-model invention, not a rule, and mixing it into a rules slice makes neither reviewable.
- **Booking on an absence day.** The strongest signal available, and `AbsenceType` even separates
  legitimately bookable `training` from `vacation`/`sick`. Not one of OpenProject's five, and §347
  is scoped to parity.

## 3. Corrections to §347

The register entry was probed on 2026-09-03. Four of its claims did not survive re-reading the code
on 2026-09-04. They are recorded here because the plan is built on the corrected version, and
because a spec that silently disagrees with its own register entry is how a fix ends up narrower
than its justification.

### 3.1 The rule-feasibility table reads the API shape, not anything persisted

§347's table calls four of the five rules' inputs "available", citing `item.hours` and a
`userId`+`date` grouping. That is true of `TimelogTimeItem` as the API returns it. It is **false of
everything Cockpit stores.**

`aggregateActuals` (`timelog-actuals.ts`) reduces items to
`ActualsAggregate = {byBucket, byResource, unattributed}`, and in doing so destroys every input the
four rules need:

- the calendar date collapses to `periodKeyForDate(it.date, granularity)` — a month or week key;
- per-entry hours are summed into a `HourCell`, so one 18h entry and three 6h entries are identical;
- `unattributed` swallows every item whose user **or** project is unlinked.

Raw `TimelogTimeItem[]` exists only transiently inside the fetch. `detectInsights` runs from a
debounced effect in `task-manager.tsx` keyed on the detection inputs, nowhere near a fetch.

So §347's "the gap is the rule layer, not the inputs" is false for **all four** surviving rules, not
only for closed-month. Something new must be persisted — §5 below.

### 3.2 The TimeLog-links codecs are not hand-written projections

§347 says CSV and Markdown "are hand-written field-by-field projections" and that "Only CSV and
Markdown need code". Both halves are wrong. `timelogLinksToCsv` is
`["config", csvCellEscape(JSON.stringify(links), neutralize)].join(",")` and
`timelogLinksToMarkdown` fences `JSON.stringify(links, null, 2)`. Both carry the whole blob.

**Consequence: adding a `policy` field needs no codec code on any of the six write paths.** JSON,
IndexedDB, Turso, CSV and Markdown all carry the object whole. The only code required is
`sanitizeTimelogLinks` admitting and validating the new key.

Reproduce: `grep -rn "timelogLinksToCsv\|timelogLinksToMarkdown\|sanitizeTimelogLinks" src/app --include=*.ts | grep -v "\.test\."`

### 3.3 The byte-stability rule is the file's own existing convention

§347 warns that `sanitizeTimelogLinks` "must return `undefined`, never `{}`, for absent policy" or
`golden-workspace.test`'s pinned bytes move. The RULE is right and it is not a new one; the stated
DETECTOR is wrong, and §3.4 below carries the measurement. The function already
does exactly this twice, for `customerId` and for `projectIds`, and says so in both comments — "drop
the key otherwise so an unscoped blob stays byte-stable". The new field follows the established
local pattern rather than introducing a constraint.

### 3.4 ★★★ `golden-workspace.test` CANNOT see this field — the fourth correction

Measured 2026-09-04 during Task 3, not reasoned: `grep -c timelogLinks sample-workspace-small.json`
returns **0**, and neither `__fixtures__/golden-workspace.csv` nor `.md` contains the string. The
golden suite serialises the sample master, which carries no `timelogLinks` blob, so it never reaches
`sanitizeTimelogLinks` and stays green whichever way this field serialises. Proved by mutation: the
`policy: policy ?? {}` mutant left **all 5** golden cases passing while killing 5 cases in
`timelog-sanitize.test.ts`.

So the byte-stability RULE stands and the reason for it stands — a blob predating the feature must
serialise unchanged on all six write paths — but the only detectors are the two "omits the policy
key" cases in `timelog-sanitize.test.ts` plus the two pre-existing whole-object `toEqual` link cases.
Writing "golden-workspace pins those bytes" into a source comment would have been a false-coverage
claim, which reads as protection and stops the next audit; the shipped comment names the real
detectors and carries the measurement instead.

### 3.5 `holidaysForCountries` does not exist

§347 names it as the non-working-day input. There is no such export. The pervasive shape is
`holidaySet: ReadonlySet<string>` (ISO dates), and **`InsightInput` already carries it** —
`detectInsights` passes `input.holidaySet` to the milestone-slip, overdue-trend and budget-variance
detectors today. The non-working-day rule therefore needs no new holiday plumbing at all.

## 4. The four rules

Rule logic lives in a **new pure, i18n-free module**.

★ **Not `timelog-guardrails.ts`.** `src/app/timelog-guards.ts` already exists — TimeLog *action*
guards, one contract per action shared by handler and button (register §74). One character of
separation between two unrelated concepts is a trap for every future reader and every future grep.
**Name it `timelog-policy.ts`.**

Before creating it, check for an existing `timelog-policy.tsx`: a bare `./timelog-policy` import
resolves `.ts` ahead of `.tsx`, so a new pure module can silently hijack a component import.

| Rule | Predicate | Inputs |
|---|---|---|
| `capPerEntry` | `maxEntryHours > cap` | daily roll |
| `capPerDay` | `hours > cap` for one (user, date) | daily roll |
| `nonWorkingDay` | booked on a date in `holidaySet`, or on a weekday whose `hoursPerWeekday` entry is 0 | daily roll + `holidaySet` + `Shift` |
| `workingHours` | `hours >` that weekday's defined hours | daily roll + `Shift` via `TimelogUserLink` |

### 4.1 Two bounds that must reach the rendered text

Both are properties of the data, not implementation details, and a user who reads a clean result
without them will draw a false conclusion. They belong in the insight body string, not only in a
source comment.

- **`capPerDay` under-reports.** It sums only the fetched customer and projects. It can never
  over-report. **False negatives only** — so a clean result is not a claim about the person's whole
  day, and must not be phrased as one.
- **`workingHours` goes dark without a link.** Reaching a `Shift` requires a `TimelogUserLink`
  resolving `timelogUserId` to a `resourceId`. With no link there is no shift and no evaluation. It
  degrades to **silence, never to a false clean** — which is precisely what §6's evaluated-scope
  argument exists to preserve.

`DEFAULT_WEEK_HOURS` (`[0, 8, 8, 8, 8, 8, 0]`) is the sanctioned fallback for a linked resource with
no shift, so sparse shifts are not a blocker. A *missing link* is a different thing from a *missing
shift*: the first means unevaluated, the second means evaluated against the default.

### 4.2 A deliberate divergence from OpenProject

Theirs restricts entries to a **clock-time window**. `TimelogTimeItem` carries `hours` with no start
or end, so a clock-time rule is unimplementable. The closest honest rule is "booked more than that
weekday's defined hours". Recorded so it is not later read as an incomplete port.

## 5. Input — the daily roll

`ActualsCacheEntry` (`timelog-actuals-store.ts`) gains:

```ts
/** Per-(user, date) roll, written by the same fetch that writes `aggregates`.
 *  Keyed `${userId}|${date}`. Sparse — only days that actually carry bookings.
 *  Optional for back-compat with entries written before this field existed. */
daily?: Record<string, { hours: number; maxEntryHours: number; entryCount: number }>;
```

`maxEntryHours` is what makes `capPerEntry` possible without caching raw items — a daily sum cannot
distinguish one 18h entry from three 6h ones.

**Why a roll and not the raw items.** The store's own header calls it a bounded localStorage key
with `MAX_PROJECTS = 50`; thousands of items per project is the case it is defending against. The
roll is sparse and sized by *booked days*, not entries.

**Why persisted at all, rather than evaluating at fetch time.** Policy stays re-evaluable: change a
cap or enable a rule and insights update on the next detect, with no re-fetch. Storing computed
violations instead would bake the policy into the stored value, and a stale violation set is
indistinguishable from a current one.

Follow the three precedents already in `ActualsCacheEntry` for adding an optional field
(`aggregates`, `users`/`projectRefs`, `partial`): a new `isEntry` branch that **fails open on
garbage** rather than rejecting the whole entry. Rejecting would drop good aggregates over a
malformed roll — the reasoning `partial` records for itself (register §172).

## 6. The reconcile fix

This is the load-bearing part of the slice. It is not a convenience for the new rules; without it
they cannot be added safely at all.

### 6.1 The defect

`reconcileInsights(stored, detected, today)` builds `detectedKeys` from the detected set, then for
every stored insight whose key is absent calls `clear()`. That reads **"absent from detection" as
"the condition cleared"**.

Sound for the five existing detectors, which always run. False for one that can go dark — TimeLog
not configured on this device, a failed fetch, a disabled rule.

The damage is not cosmetic, because the two sides live in different places:

- bookings are a **per-device** cache (`timelog-actuals-store.ts`: "NOT a Workspace field — never
  exported, never in Turso");
- `Workspace.insights` is **shared and exported**.

So: PM A has TimeLog configured, and guardrail insights are written into the shared blob. PM B opens
the same workspace with no TimeLog config. The detector yields nothing. `clear()` prunes the
untouched insights and, for any the user had marked `acted`, resolves it through
`computeClearedOutcome` — which always writes `"improved"` (`digest.ts` states this twice about its
own no-op branches). The result is a **fabricated win in a shared, exported artifact**, produced by
opening a file, which then rides every subsequent AI turn through the outcomes section.

`overdueTrend`'s inertness is **not** a precedent covering this. An inert detector produces nothing,
and producing nothing is exactly what triggers `clear()`. Reconcile cannot today distinguish "not
violated" from "not evaluated".

### 6.2 The fix

`reconcileInsights` gains a **required** fourth argument: the set of `InsightType`s actually
evaluated on this pass. `clear()` runs only for types in that set.

- **Required, not defaulted to all.** A future detector that forgets to declare itself becomes a
  compile error instead of a silent prune. A default would reintroduce the defect for the next
  go-dark detector while leaving the guard looking present.
- **A rule counts as evaluated only when `daily` is non-null AND that rule is enabled.** So
  switching a rule off **freezes** its insights rather than resolving them into a false win.
- **Four `InsightType` members, one per rule.** Evaluated scope is keyed per type; a single
  `timelogGuardrail` type with a `data.rule` discriminator would let one enabled rule clear the
  other three.

Single non-test call site: the debounced detect/reconcile effect in `task-manager.tsx`. Locate it
with `grep -rn "reconcileInsights" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."`.

## 7. Detection and surfacing

`detect.ts` receives **already-computed violations** and never learns what a booking is — mirroring
`priorOverdueCount`'s null-when-unknown shape, which returns `null` rather than guessing when the
prior count is unavailable.

**The invocation seam.** `timelog-policy.ts` is called by whoever builds `InsightInput` in
`task-manager.tsx`, not by `detect.ts`. That caller reads the daily roll with
`loadActualsCache(projectId)`, reads the policy off `timelogLinks`, and passes the rule module the
roll, the policy, `holidaySet`, the resources/shifts and the user links; the module returns
violations plus the evaluated-type set, both of which go onto `InsightInput`. Reading the cache
outside the TimeLog panel is established — `workspace-section.tsx` and `budget-unapplied-notice.tsx`
both call `loadActualsCache` today. `violations` is `null` when the roll is absent, which is the
signal §6.2 turns into an empty evaluated set.

**Aggregation: per (rule × `timelogUserId`), never per booking.** Per-booking keys would put
hundreds of rows into a shared, exported blob and churn the whole key set on every fetch. The
insight's `count` is lower-is-better, which is what `metricAtAction`/`delta` require.

**`entityRef`:** `{view: "resources", id: resourceId}` when a `TimelogUserLink` resolves the
`timelogUserId`; **omitted otherwise**. `InsightEntityRef` requires both fields when present, and
its `id` is resolved as a real workspace row by the recommendation-replay path — so a synthetic id
is not an option.

**No AI recommendation.** The booking lives in TimeLog and no tool in the recommendation allow-set
can change it. Every proposable call would be a workspace write that does not fix the violation, and
`acted`/`improved` would then track a proxy rather than the thing measured. The insight is
informational: acknowledge or dismiss.

## 8. Policy — model, defaults, persistence

Four rules × `{enabled: boolean, threshold?: number}`, carried on the existing `TimelogLinks`
meta-blob (workspace-level and shared, which is the right scope for a team guardrail and matches
OpenProject's instance-wide setting).

**All four default OFF, with no thresholds set.** This matches OpenProject 17.8, where all five
default off so an upgrade changes no behaviour — but the stronger reason is local: `Workspace.insights`
is shared and exported, so defaulting on would have an existing workspace silently gain rows in a
persisted, team-visible artifact the first time anyone opened it after the upgrade, and those rows
then ride every AI turn. It also avoids handing anyone an under-reporting daily cap or a dark
working-hours rule they never asked for.

`sanitizeTimelogLinks` returns `policy` **only when at least one rule is configured**, and drops the
key otherwise — the existing `customerId`/`projectIds` pattern, for the reason those two record: a
blob predating the feature must serialise unchanged. ★ The detector is `timelog-sanitize.test.ts`,
NOT `golden-workspace.test`, which cannot reach this function at all — see §3.4.

Per §3.2, no codec code is needed on any of the six write paths.

## 9. Surfaces

- **Settings:** a guardrails section in `timelog-settings.tsx` — four rows, each an enable toggle
  plus a threshold where the rule takes one. Use `ToggleButton`, never a hand-rolled `aria-pressed`
  button, so each gets the non-colour pressed marker. Every threshold input needs a real
  `aria-label` or `<label>` — a `placeholder` is not an accessible name, and Settings is
  axe-scanned.
- **Insight text:** four title/body key pairs in `insight-text.ts`, EN and DE. The two bounds from
  §4.1 belong in the body strings. DE is patched by node utf8 write with `\r\n` anchors — the Edit
  tool corrupts umlauts and curls quotes in `i18n.de.ts`, and a `\n` anchor silently no-ops on a
  CRLF file.
- **`sanitize-insights.ts`** must admit the four new types, or a stored guardrail insight is dropped
  on load.

## 10. Testing

Every guard is mutation-proved: apply the mutant, read **which cases fail** rather than the exit
code alone, then revert by inverse anchored write with a uniqueness assertion in both directions
(`git checkout -- <file>` is deny-blocked), and end on an empty `git diff --stat`.

- **Rules** (`timelog-policy.test.ts`): each rule at, just below and just above its threshold.
  `capPerEntry` must be pinned by a fixture where the daily **sum** is under the cap and one
  **entry** is over it — otherwise the test passes with `maxEntryHours` replaced by `hours` and the
  whole reason for the field is unpinned.
- **`workingHours` darkness:** a fixture with no `TimelogUserLink` must produce **no insight**, and
  a separate fixture with a link and no shift must evaluate against `DEFAULT_WEEK_HOURS`. Both, or
  "dark" and "defaulted" are indistinguishable.
- **Reconcile** (`reconcile.test.ts`): the load-bearing test is that a stored `acted` guardrail
  insight, reconciled on a pass where its type is **not** in the evaluated set, comes back
  **unchanged** — same `status`, no `outcome` written. Asserting only that it was not pruned passes
  against a version that resolves it to `"improved"` while keeping the row.
- **Disabled-rule freeze:** same shape, with the rule enabled-then-disabled. Distinct from the
  bookings-null case; both must be pinned or one implies the other falsely.
- **Required-argument proof:** the compile-error property is the whole justification for making the
  argument required rather than defaulted. Pin it with a type-level test, not prose.
- **Persistence** (`timelog-links-persistence.test.ts`): round-trip a policy through all six paths,
  and pin that a workspace with **no** policy serialises byte-identically to today. ★★ The second
  half is the ONLY thing protecting that property — `golden-workspace.test` cannot see this field
  (§3.4), so an absence case that is merely assumed is an unguarded one.
- **Cache back-compat:** an `ActualsCacheEntry` written before `daily` existed must still load, and
  a malformed `daily` must fail open rather than dropping the entry.
- ★★★ **Pin every CALL SITE, not only the function.** Added after execution, because the spec's
  testing section listed only functions and both gaps it left were invisible to every gate. Measured:
  substituting a hardcoded four-type evaluated set at `reconcileInsights`'s one caller left **31 test
  files / 321 tests green** — the precise defect §6 exists to prevent, reintroducible with a clean
  suite. The same shape recurred at the `isBlankTimelogLinks` caller. A pure function is the easy half
  to pin and the half that was never in danger; the defect lives at the seam where a caller supplies
  the argument. Both are now pinned by component tests whose mutants die
  (`task-manager.guardrail-reconcile.test.tsx`, `task-manager.timelog-links-blank.test.tsx`), each
  carrying an opposite-direction control so the first assertion cannot pass vacuously.
- ★★ **A second, outer byte-stability hole this spec missed.** `workspace.ts` emits a `timelogLinks`
  key for any truthy blob, so handing back an empty blob where the workspace held `undefined` adds a
  key to every exported artifact — §3.4's property, one level up. Closed by `isBlankTimelogLinks`.
- **Settings a11y:** a unit test rendering the four rows and asserting row-unique accessible names
  via the shared `src/test/row-unique-names.ts` — the axe gate is silent on duplicate accessible
  names in every view at every seed size, so a unit test is the only possible detector.

## 11. Gates

`npx tsc --noEmit` (exits **2** on diagnostics, not 1) · `npx eslint --max-warnings=0` on touched
files · the touched vitest files, then `npm run test:run` · `npm run test:shuffle` (new tests are
added, so the shuffled gate is the one that catches order dependence) · `npm run size:check` ·
`npm run docs:claims:check` · `npm run followups:status:check`.

`src/app/*.ts(x)` are CRLF: use the Edit tool, never Write, never `sed -i`.

Never run two vitest processes concurrently — a red mentioning `Failed to start forks worker` is
contention, not a failure.

## 12. Risks

- **The daily roll is a new persisted shape on a bounded device key.** Sparse keying makes it
  proportional to booked days, but the bound should be measured on the largest available fetch
  before the plan fixes a cap, not assumed.
- **The evaluated-scope argument touches a function all five existing detectors flow through.** The
  change is small and the call site is single, but a mistake there degrades every insight type at
  once rather than only the new ones.
- **Neither caveated rule can be validated against a real TimeLog tenant from a unit test.** An
  eye-verify against a live TimeLog project is owed before this ships, and is a gate, not a nicety.

## 13. Follow-ups this slice creates

- Closed-month rule — needs a period-lock concept and an authority decision (§2).
- Booking on an absence day (§2).
- §348 — a meeting's activity is invisible from the work it concerns — remains sequenced next. The
  register records its ordering as a preference, not a dependency; nothing here blocks it.
