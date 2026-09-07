# Insights guardrail bounds — design

_2026-09-07. Scoped from the §360–§367 cluster in `docs/open-followups.md`, all eight filed
2026-09-04 from the §347 review round._

> ★★★ **SUPERSEDED IN PLACES — READ THE PLAN'S "Corrections found during execution" SECTION FIRST.**
> This document is left as written, as the record of what was designed. Execution and a subsequent
> cold review falsified several of its claims, and the corrections are maintained in ONE place, in
> `docs/superpowers/plans/2026-09-07-insights-guardrail-bounds.md`, rather than restated here where
> the two copies would drift. The ones that bite hardest in THIS file: the shedding stages are FOUR,
> not three, and the stage numbers here are off by one from the shipped code FROM STAGE 3 ONWARD —
> this document's stages 1 and 2 match the shipped 1 and 2, and only its stage 3 is the shipped
> stage 4, so "the numbers are off by one" unqualified is itself wrong (item 5); the map budget
> admits THREE full-size rolls, not four (item 6); the UTF-16 "the two are equal" clause does not hold
> for the map budget (item 7); and "the reconcile predicate returns false" is scoped to guardrail
> insights (item 8). Read the stage list off `saveActualsCache` itself, never off this document.

## What this slice is, and what it deliberately is not

Three of the eight entries in that cluster are recorded by their own text as decisions or notes
rather than defects, and this slice does not overturn them:

- **§360** — "Recorded as a DECISION, not a defect." A guardrail insight gets no entity digest on the
  recommendation path because the guardrail sentence already carries person, count, threshold and
  worst hours, and a digest costs billed prompt tokens.
- **§363's residue** — the plain cap is "a NOTE, not a defect", because losing a row is strictly
  better than fabricating an `"improved"` outcome for it.
- **§365** — two coherent answers are named (`min={1}` narrowed to `>= 1` at all three enforcement
  sites, or the attribute left alone); only the current split is incoherent, and picking between
  them is a separate decision.

**§362**, **§364** and **§366** are real but user-visible: a dead deep-link affordance, cross-version
guardrail pruning, and a permanent freeze under project scope with no way to see it. Each needs UI
work or a cross-version policy call. They stay open.

What this slice takes is the three **bounds** defects — the places where something is unbounded,
unmeasured, or unvalidated. All three sit in pure engine or store modules, all three are testable
with no DOM, and none of them creates eye-verify debt.

## Corrections to the register this slice makes

Two of the three entries are less accurate than they read, and the spec records the correction rather
than inheriting the claim.

**§363's obvious fix is unsafe, and the entry does not say so.** The entry observes that guardrail
cardinality is `4 × (TimeLog users seen)` with no cap in `detect.ts`. The apparent remedy — cap
`timelogGuardrailInsights` — drops rows from `detected`. `reconcileInsights` reads "absent from the
detection set" as "the condition cleared" unless `isEvaluated` says otherwise, and that predicate is
built at the `task-manager.tsx` call site from the daily roll, which knows nothing about a cap
applied inside `detect.ts`. A capped-out row whose violating days the roll covers therefore passes
the window check, finds no violation, and resolves through `computeClearedOutcome` — which always
emits `"improved"` — into `Workspace.insights`, which is shared, exported, and read on every AI turn.
That is precisely the fabricated win the `isEvaluated` contract exists to prevent. The cap must live
where freeze semantics are known.

**§367 is latent, not live, and its store half is already closed.** The entry's headline is a single
oversized cell: a key whose date half is six hundred thousand characters parses successfully and
exceeds `MAX_DAILY_ROLL_CHARS` on its own. But `withBoundedDaily` skips any key failing its own
`ISO_DATE_RE` before building its retention list, so that key never enters the retention set and is
dropped on the next trim. The reachable half is the policy engine: a malformed date reaches
`timelog-policy.ts`'s cell loop, `weekdayIndex` returns null so the working-hours and weekend arms
skip it, and the value still flows into `firstViolationDate` / `lastViolationDate`, after which the
downstream window comparison fails and the insight FREEZES — the safe direction. This is hardening,
and the entry's own "reachability is the open question" is what it closes.

**§361 is live and unambiguous**, and needs no correction. `MAX_PROJECTS` is 50 and counts entries
without ever measuring them; `MAX_DAILY_ROLL_CHARS` is 512 KiB per entry; `writeDeviceJson` catches
and discards. Fifty entries just under budget is roughly 25 MB against a shared origin quota of about
5 MB, and the entire save — `aggregates` included — is then lost with nothing reported anywhere.

## Section 1 — §363: reserved capacity in `reconcile.ts`

**Where.** `src/app/insights/insight.ts` (one new constant), `src/app/insights/reconcile.ts` (the
final selection).

`MAX_INSIGHTS` stays 200. A new sibling constant `RESERVED_NON_GUARDRAIL` of 60 makes the guardrail
admission cap `MAX_INSIGHTS - RESERVED_NON_GUARDRAIL`, i.e. 140.

`reconcileInsights` keeps its existing comparator untouched — the severity rank, the frozen-row
`orderKey`, and the frozen-loses-the-tie rule are all load-bearing and all already mutation-proved.
Only the terminal `slice` changes, to a two-pass selection over the already-sorted list:

1. Walk the sorted list once. Admit every non-guardrail row while under `MAX_INSIGHTS`. Admit a
   guardrail row only while the admitted guardrail count is under 140.
2. Walk the rejected rows in that same sorted order, admitting them until `MAX_INSIGHTS` is reached.

Emit in sorted order. The list is never left shorter than the plain `slice` would have made it, and
the panel's ordering is unchanged.

**Family membership** is read off the insight's `type` against the four guardrail literals already
declared in `INSIGHT_TYPES` (`timelogCapPerEntry`, `timelogCapPerDay`, `timelogNonWorkingDay`,
`timelogWorkingHours`). Those four literals are deliberately identical to `TimelogRuleId` so no
rule-to-type lookup table exists to drift, and this slice adds none.

**Why these numbers.** 140 is 35 people across 4 rules, which covers a realistic org-scope fetch. 60
covers a large project's `milestoneSlip` and `raidAging` sets plus the three singletons. The row that
starves first is `overdueTrend`: it is the only `low`-severity detector in the app and every
guardrail is `medium`, so under the existing comparator it loses to every guardrail before ties are
even reached.

**Why this is safe where a `detect.ts` cap is not.** Nothing leaves `detected`. `isEvaluated` sees
exactly the keys it saw before, so no stored row can be re-read as cleared and no `"improved"` can be
fabricated. Eviction still happens, at the cap, where §363's own text already rules it acceptable.

## Section 2 — §361: size-based eviction that strips rolls before dropping entries

**Where.** `src/app/timelog-actuals-store.ts` (`saveActualsCache`, plus one new constant).

A map-level budget `MAX_ACTUALS_TOTAL_CHARS` of 2 MiB. Against a shared origin quota of about 5 MB
that is roughly 40%, leaving about 3 MB for every other `aipm-cockpit:*` key, and it admits four
full-size rolls against the existing 512 KiB per-entry cap.

`saveActualsCache` runs three stages after `withBoundedDaily`, re-measuring the serialised map
between each and stopping as soon as it fits:

1. **Count eviction, unchanged.** The existing `MAX_PROJECTS` drop, newest `fetchedAt` first.
2. **Strip rolls, oldest first.** While over budget, remove `daily`, `dailyWindow` and `dailyUsers`
   **together** from the oldest entry that still carries a roll, keeping its `aggregates`.
3. **Drop entries whole, oldest first.** While still over budget, remove the oldest entry outright.

**The entry being saved is never a candidate at any stage.** Without that, a save can silently do
nothing — the pathological case being a single entry that alone exceeds the map budget, where every
stage would strip or drop the very thing the caller just fetched.

**Why strip before drop.** `withBoundedDaily`'s own docstring already states the rule: losing the
roll must never cost the `aggregates` beside it. Today's count-based whole-entry eviction violates
it. Stripping honours it while keeping the safety argument §361 gives for whole-entry eviction
intact — the three fields go together, so a stripped entry has no window, an absent window makes the
reconcile predicate return false, the insight FREEZES, and that is the recoverable direction. No
coverage claim is ever narrowed or falsified, which is the failure the per-entry bound was designed
around and which a whole-map *trim*, as opposed to a strip, would have reintroduced.

**Measurement** is the serialised length of the map, matching `withBoundedDaily`'s existing choice.
That counts UTF-16 code units rather than bytes; for a real roll — ASCII keys, numeric values — the
two are equal, and browsers bill localStorage in UTF-16 units anyway.

**Out of scope.** `writeDeviceJson`'s swallowed quota error stays swallowed. It is the worst thing in
the cluster, but `device-store.ts` is shared by every per-device key and changing its contract
reaches far beyond TimeLog. This slice records that decision; it does not act on it.

## Section 3 — §367: validate the date shape at the parse

**Where.** `src/app/timelog-types.ts` (`parseDailyKey`).

The date half of the key must match a four-two-two ISO shape. Shape only, never existence — a date of
`9999-99-99` is admitted. That is the same rationale the store already gives for its window rule: the
check exists to make `<` and `>` comparisons downstream lexicographically meaningful, not to certify
that a date exists.

**Two consumers, one behaviour change.** `withBoundedDaily` already gates on its own `ISO_DATE_RE`
immediately after calling `parseDailyKey`, so its behaviour is unchanged. `timelog-policy.ts`'s cell
loop is where the change lands: a malformed date is now rejected at the parse instead of flowing into
`firstViolationDate` / `lastViolationDate`.

**The pattern is deliberately a third copy, not shared.** `sanitize-core.ts` and
`timelog-actuals-store.ts` each already declare one. The store's is a WINDOW rule; this is a KEY
rule. They answer different questions and merging them would couple two independent decisions — the
store's docstring already argues exactly this, in the other direction, about why key validation is
not its job.

**The redundant guard in `withBoundedDaily` stays.** It becomes provably redundant, and it stays
anyway, as documented defence-in-depth. The identical reasoning is already written out beside
`timelog-policy.ts`'s `isDailyCell` skip, which explains that a TYPE is a promise the CALLER makes
and that a future caller handing over an unvalidated roll does not keep it.

## Testing

All three changes are pure — no DOM, no React, no UI, and therefore no eye-verify debt and no
handrolled controls.

Each fix is mutation-proved separately, and each mutant is recorded as `N failed / M passed` with the
sum checked against the file's runtime test count, so a mutant that never landed cannot read as a
proof.

**§363** needs two fixtures, and the second is the one that is easy to omit:

- The reservation must be the *only* thing keeping `overdueTrend` alive — more than 200 guardrail
  rows at `medium` against one `low` singleton — so reverting the reservation to 0 reds the test. A
  fixture where `overdueTrend` would have survived the plain `slice` proves nothing.
- The top-up pass must fill the cap when the core family is small. A reservation that silently
  shortens the output to 140 is the failure mode, and a test asserting only that `overdueTrend` is
  present passes against it.

**§361** needs a fixture where stage 2 alone suffices, asserting the stripped entry keeps its
`aggregates` and loses all three roll fields together; a fixture reaching stage 3; and the
never-evict-the-current-entry case, seeded as a single entry exceeding the whole map budget.

**§367** needs the policy-path assertion — a malformed-date cell no longer reaching
`firstViolationDate` — plus the negative control that a well-formed key still parses, without which
a mutant returning `null` unconditionally survives.

## Gates

`npx tsc --noEmit`, `npx eslint --max-warnings=0 src`, and targeted vitest on the touched test files.
No full suite, per standing instruction; the shuffled-seed run is not needed because no test file is
reordered and no cross-file state is introduced.

## Register hygiene

§361, §363 and §367 are updated in place with what landed and what did not. §363 keeps its open
residue — the plain cap can still drop a frozen row, and this slice does not change that — and gains
the correction that capping in `detect.ts` is unsafe, so the next reader does not attempt it. §367
records that its store half was already closed by `withBoundedDaily`. §360, §362, §364, §365 and §366
are untouched and stay open.
