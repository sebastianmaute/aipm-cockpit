# Budget currency boundary, and the two CPIs — design

**Date:** 2026-09-12
**Closes:** `docs/open-followups.md` §465, §464
**Branch:** `feat/budget-currency-boundary`, cut from `origin/main` @ `d4287d39`

## The problem

### §465 — every money figure on a non-EUR fixed-price bucket is wrong

`BudgetBucket.fixedPriceAmount` is documented as "Fixed-price contract amount in the bucket
currency", and `budget-bucket-modal.tsx` stores what the user typed, unconverted. `budget-report.ts`
declares the opposite in two places — the `BucketReport` type comment ("All amounts in EUR
(converted to bucket currency only at display)") and `computeBucketReport`'s docstring ("All money is
in EUR (role rates are EUR)") — and then reads `fixedPriceAmount` directly as `revenue`,
`budgetValue` and the base of `consumedValue`.

Nothing converts it. `fx.ts` exports `currencyToEur`, and it has **no production caller**:

```
grep -rn "currencyToEur(" src --include=*.ts --include=*.tsx | grep -v "\.test\."
```

returns the definition alone. Every conversion in the app runs outward, through `eurToCurrency`.

The damage is not uniform, and knowing which figures are affected is what keeps the fix small:

| Figure | Denomination today | Affected |
|---|---|---|
| `revenue`, `budgetValue`, `consumedValue` (fixed branch) | bucket currency, raw | yes |
| `cost`, `budgetCost` | EUR by construction (role rates) | no |
| `contributionMargin` | **mixed** — bucket-currency numerator minus EUR cost | yes, and this is the one that matters |
| `costPerformance` | EUR / EUR | no |
| `consumption.percent` | scale-invariant within one bucket | no |
| `earnedValue`, `costPerformanceIndex` | EUR, never reads `fixedPriceAmount` | no |

Worked example from §465, a USD bucket with contract 10,000, rate 1.10, 100 h budget, 50 h actual,
€50/h internal (cost €2,500): the margin reports **75.0 %** where the truth is **72.5 %**. Treating a
USD contract as EUR revenue inflates the numerator without touching the EUR-denominated cost, so the
bucket claims a healthier margin than it has. The direction depends on the rate — a currency weaker
than the euro overstates margin, a stronger one understates it.

The two surfaces are wrong in opposite directions, which is why neither looks broken beside the
other:

- `budget-panel.tsx` converts the engine's figures **outward** (`inCur` at two call sites, `cci` at
  four), multiplying a number that was never EUR by the rate again.
- `budget-report-panel.tsx` formats the same figures **as EUR** — `formatCurrency(n, "EUR", locale)`,
  hardcoded — and its own comment says the FX rate is "shown for context only, not used to convert".

★ **Spillover, which §465 does not record.** `computeSpillover` carries `budgetValue −
consumedValue` from a CLOSED bucket into its successor's `spilloverInValue`. For a closed *fixed*
bucket both terms are raw `fixedPriceAmount`-derived, so a non-EUR predecessor injects a
foreign-currency amount into its successor — and if that successor is **T&M**, its own `budgetValue`
(`budgetValueExternal + spilloverInValue`), its win/loss, its consumption percent and its RAG all
inherit the contamination. Predecessor and successor currencies are independent; nothing constrains
them to match. So the contamination reaches a single bucket's own displayed figures, not only the
project rollup.

★ **The project rollup converts nothing** (`budget-panel.tsx` passes the four project figures raw)
and labels them `projCur = plan.currency || "EUR"`. §465 filed this as an unverified lead; it is
confirmed.

### §464 — "CPI" means two different numbers, and two hints are wrong

Two unrelated quantities carry the label, a click apart:

- **money ratio** — `budgetCciCpi` "Cost performance (CPI)", rendered as a percent, value
  `costPerformanceIndex` = `earnedValue / cost`, both EUR internal-rate. Exactly two render sites,
  both in `budget-panel.tsx` (project rollup tile, per-bucket tile).
- **hours ratio** — `evmCpi` "CPI", rendered as a ratio to two decimals, value `evm.cpi` = `ev / ac`
  from task estimates and `timeSpentMinutes`. Rendered on the Budget report and the Dashboard, and it
  is what Trends, next-actions and the AI snapshot's `evm` block all mean by CPI.

The app invites the comparison: the Dashboard's CPI tile (hours) navigates to the `budget` view,
whose rollup tile is the money one under almost the same label. `ai-dashboard-snapshot.ts` passes
**both** — `evm.cpi` and `budget.costPerformanceIndex` — so the assistant can be handed two numbers a
prompt would reasonably read as one.

★ **Correction to §464, established during design:** the entry says the Dashboard's Budget health is
computed from `evm.cpi`. It is `worstHealth(computeBudgetStatus(project, amberRatio),
evmIndexHealth(evm.cpi))` — **worst of two**, the other argument being `consumedValue / budgetValue`
from the budget report. This matters here: the §465 fix can move the Budget RAG through the *first*
argument while never touching EVM.

Two hints annotate figures they do not describe:

- `budgetWinLossHint` — "Hours won or lost versus plan." sits on a **money** figure
  (`inCur(br.winLossValue)`). `winLossHours` exists on the row but is rendered nowhere in `src/app`,
  so the hint describes an invisible number while sitting beside one it does not describe.
- `budgetReportColWinLossHint` — "Difference between revenue and cost in EUR" holds for the
  **fixed-price branch only**. `winLossValue` is `isFixed ? revenue - cost : budgetValue -
  consumedValue`, and on the T&M branch both terms are revenue-side, making the column remaining
  budget, not margin.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Where the currency boundary sits | **Engine converts on read** | The stored amount keeps its documented meaning — a contract amount in its own currency, which does not drift as rates move |
| `fxRates` parameter | **Required**, not optional | Three of five call sites lack it today; a defaulted parameter leaves the bug live on those surfaces silently. Required makes tsc enumerate them |
| Which CPI yields its name | **The money one** | CPI is a term of art from EVM; the non-standard quantity is the one that should rename |
| New label | **"Cost recovery" / "Kostendeckung"** | Sits in the same register as its sibling tile `Cost burn` / `budgetCciBurn`; `Kostendeckung` is a real German term, not a coinage |
| i18n key | **Renamed too** (`budgetCciCpi` → `budgetCciRecovery`) | A key saying `Cpi` while meaning recovery is the internal mislabel this repo keeps paying for |
| Live-data migration | **None needed** | No live non-EUR fixed-price buckets exist; demo and sample only. This is the cheap version of §465 — the expensive version was always the unmarked stored amounts |
| Sample data | **Bucket #4 becomes USD with a pinned `fxRateOverride`** | The demo, e2e and the axe run then exercise multi-currency; a pinned override keeps it deterministic, with no dependency on a live ECB rate |
| `plan.currency` | **Narrowed to the `BudgetCurrency` union** | The engine's "all EUR" claim already rests on this precondition and nothing enforces it |

### Approaches rejected

- **Writer stores EUR** (convert in `budget-bucket-modal.tsx`, engine untouched). Much less code and
  no threading, but it freezes the contract at the entry-day rate: a $10,000 contract becomes a EUR
  number that silently stops matching the contract as rates move, and the field's documented meaning
  inverts. Wrong trade for a contract amount.
- **Convert at each display site.** Cannot work: `contributionMargin` is computed *inside* the engine
  as `revenue − cost`, so the mixed-unit subtraction has already happened before any display layer
  sees it.
- **`fxRates` optional, defaulting to rate 1.** Cheaper — `dashboard.ts` and `insights/detect.ts`
  need no threading — but those two surfaces keep the defect with nothing reporting it. Rejected as a
  silent partial fix.

## Design

### 1. The currency boundary

`computeBucketReport` gains a required `fxRates: FxRates | null` parameter and converts at its single
read of the field:

```ts
const fixedPrice = currencyToEur(bucket.fixedPriceAmount ?? 0, bucket, fxRates);
```

This gives `currencyToEur` its first production caller and makes `revenue`, `budgetValue` and
`consumedValue` genuinely EUR. Consequently:

- `contributionMargin` stops subtracting an EUR cost from a foreign numerator — the margin defect;
- the project rollup sums one unit — ★ NARROWED 2026-09-12: **only when every non-EUR bucket has an
  effective rate.** `resolveRate` returns 1 for a non-EUR bucket with no `fxRateOverride` and no
  cached ECB table, so its contract amount enters the rollup unconverted and is summed as EUR. The
  rollup is EUR-labelled and converts nothing, so that bucket's foreign amount is silently counted
  at par. Not a regression — at rate 1 `currencyToEur` is the identity, so the number is exactly
  what it was before this branch — but the unqualified claim above is false on the default
  no-rate path, which is the state most users are in. `docs/open-followups.md` §474 carries it;
- `computeSpillover`'s carry is EUR before it ever reaches a successor, so the ★ contamination above
  is fixed by construction rather than by a second patch;
- `budget-report-panel.tsx`'s hardcoded "EUR" label becomes true.

`computeBudgetReport` takes and forwards the same parameter. The five production call sites —
`budget-panel.tsx`, `budget-report-panel.tsx`, `dashboard.ts`, `insights/detect.ts`,
`task-manager.tsx` — must all supply it; the first two have `fxRates` in scope already, the other
three need it threaded. tsc is the enumerator, which is the reason the parameter is required rather
than defaulted.

**`inCur` and `cci` are not touched.** Four of the six figures they convert are already correctly EUR
and convert rightly; only the engine's *input* was wrong. Changing the converters would break the
four that work.

**The precondition gets named.** The engine's "all money is EUR" holds only if role rates are EUR,
i.e. `plan.currency === "EUR"`. `ResourcePlan.currency` narrows from free `string` to the
`BudgetCurrency` union, and `sanitizePlan` coerces anything unrecognised to `"EUR"`. A stored
plan carrying e.g. `"CHF"` therefore becomes `"EUR"` on load — a silent value change on existing
data, acceptable only because those figures were EUR all along and merely mislabelled. This adds no
column and needs no golden regeneration, but it is a persisted-field shape change and rides
`sanitize.ts` plus the storage round-trip tests.

★ CORRECTED 2026-09-12: this paragraph and the test table below both named `sanitizeResourcePlan`,
which has never existed anywhere in the repo. The real function is `sanitizePlan(input, today)` in
`sanitize-entities.ts`. Reproduce the absence with
`grep -rn "sanitizeResourcePlan" src scripts e2e` → no hits (exit 1), against
`grep -n "export function sanitizePlan" src/app/sanitize-entities.ts` → 1 hit.
★★ **Nothing would ever have caught this, and that is a property of this directory rather than of
the mistake.** `docs:symbols:check` reads `AGENTS.md` and `docs/AGENTS/*.md` and nothing else, and
`docs:claims:check` explicitly excludes `docs/superpowers/` — so an invented backticked identifier in
a spec or plan is ungated forever, in both gates, by construction. Treat every symbol named in this
directory as unverified until grepped.

**Six docstrings were identified; FIVE became false and moved in the same commit,** and the sixth is
deliberately unchanged. Moved: `budget-report.ts` (the `BucketReport` comment and
`computeBucketReport`'s), `budget-panel.tsx` (the `cci` comment and the project-rollup comment), and
`types.ts` on the field itself. ★ NOT moved, on purpose: `budget-report-panel.tsx`'s "the FX rate is
shown for context only, not used to convert" comment. The conversion landed in the ENGINE, at
`computeBucketReport`'s single read, so by the time that panel receives a figure it really is EUR and
the rate it renders really is context-only — **the fix made that comment more true, not false**, and
rewriting it would have introduced an error. Reproduce that it was left alone:
`git diff 065a9d02..HEAD -- src/app/budget-report-panel.tsx | grep -E "^[-+].*//"` → three `+` lines,
all one new comment about `tasks: []`, and no `-` line at all.
★ An earlier revision of this heading said "Five docstrings" and then listed six items — a count and
its own list disagreeing in adjacent clauses. The count was right about the outcome by accident and
wrong about the list; both halves are now stated.

### 2. The rename and the three hints

`budgetCciCpi` → `budgetCciRecovery`, `budgetCciCpiHint` → `budgetCciRecoveryHint`. EN "Cost
recovery", DE "Kostendeckung". Two render sites, both in `budget-panel.tsx`. `evmCpi` and every other
CPI in the app keep their name.

`budgetCciBurnHint` currently ends "This is not an EVM index — see Cost performance (CPI)" in both
languages, pointing at the label being renamed; it is updated in the same edit, and reads better for
it, since "see Cost recovery" no longer contains the acronym it is disclaiming.

`budgetReportColWinLossHint` states both branches explicitly instead of describing the fixed-price
one as if it were universal.

`budgetWinLossHint` **mirrors that twin**, differing only in its last clause. ★ CORRECTED
2026-09-12 — this section originally said only that it "becomes money in the bucket currency",
which is what the first cut did and is not what shipped. The two hints annotate the SAME
`winLossValue`, so leaving this one at a single undifferentiated branch left the fixed-price case
described as a variance against plan when it is a margin, revenue minus cost. It now carries the
same two branches; the last clause is the ONLY difference and is load-bearing in both directions —
the panel tile renders through `inCur` and really is in the bucket currency, the report column is
EUR. Pinned on both sides, each half mutation-proved against being swapped for the other.

`budgetSpilloverInHint` said "Hours carried in from another bucket" over a row that renders hours
AND their converted money value; it now names both. ★ ADDED 2026-09-12 — this string was fixed in
`f32cfb6c`, two lines from the one §464 fixed and for the same reason, but appeared nowhere in this
spec or in the plan. Recorded here so the section describes what shipped rather than what was
foreseen.

`agents-symbol-check` gates backticked mixed-case names in `AGENTS.md` and `docs/AGENTS/*.md`, and
`docs/AGENTS/platform.md` names `budgetCciCpi` **and** recites its rename history — so it is swept in
the same commit.

Out of scope deliberately: the prose strings that mention CPI in passing
(`helpConceptBudgetBody`, `dashboardHealthHelp`, three `versionHighlight*`) all refer to the **EVM**
CPI, which keeps its name, so they stay true. `operating-guide-builtin.generated.ts` is generated from
a generic PM guide and is never hand-edited.

### 3. Testing

**No existing test can be leaned on, and the reason is structural.** Every fixed-price fixture in the
repo sits on a `currency: "EUR"` bucket, and every budget panel/report test passes `fxRates={null}`.
Under either condition `resolveRate` returns 1 and **both converters are the identity function**, so
the double conversion is arithmetically invisible to the whole suite at every seed. No test asserts
any figure's currency.

That trap applies to the new tests too, so two structural defences:

1. **Every new currency test asserts a rate ≠ 1 before asserting anything else.** A fixture later
   edited back to EUR, or to a null rate, then reds the test that depends on it instead of going
   quietly vacuous.
2. **Every new test is mutation-proved** by reverting the `currencyToEur` call and confirming which
   cases go red, reported with per-file counts. A test still green with the conversion removed is
   testing nothing.

Cases:

| Case | Asserts |
|---|---|
| USD fixed bucket, rate 1.10 | `revenue` / `budgetValue` / `consumedValue` are EUR; `contributionMargin.percent` is 72.5 %, not 75 % |
| Same bucket, win/loss | €6,590.91, not the inflated figure |
| Closed USD fixed → **T&M** successor | the successor's own `budgetValue` and win/loss carry no foreign amount |
| USD fixed + GBP fixed + T&M in one project | the rollup sums a single unit |
| `sanitizePlan` with `"CHF"` | coerced to `"EUR"` |
| Budget panel, USD bucket | entering a $10,000 contract renders **$10,000** back |
| Budget report panel, same bucket | the EUR-labelled figure is the converted one |

i18n: the renamed key and all three fixed hints get per-site assertions with `loadI18n("de")` in
`beforeAll` — an EN-only assertion on a string whose DE twin is byte-identical is vacuous, and these
are not identical. Key parity itself is tsc's job.

★ DELIVERED 2026-09-12, and the count moved: this line said "both fixed hints" while §2 named two
and a third (`budgetSpilloverInHint`) shipped without ever entering either document. The four
assertions live in `budget-panel.test.tsx` (`budgetWinLossHint`, `budgetSpilloverInHint`,
`budgetCciRecovery`) and `budget-report-panel.test.tsx` (`budgetReportColWinLossHint`).

★★ A HINT REACHES THE DOM THROUGH TWO SEPARATE `t()` CALLS and a per-site assertion has to cover
both, which "per-site" does not say on its own. `InfoTooltip` takes `text` (the portalled body, the
thing a reader sees) and `label` (the `aria-label`); the call sites pass the key to each. MEASURED:
a first cut of these tests read the `aria-label` alone and stayed GREEN with the call site's `text`
swapped for the EUR twin — green while the visible tooltip named the wrong currency. Each test now
focuses its trigger and asserts the portalled body too.

No PER-ENGINE coverage glob covers `budget-report.ts`, `fx.ts` or `evm.ts`, and neither panel is
coverage-gated. ★ CORRECTED 2026-09-12 — **the inference drawn from that was false.** An earlier
revision continued "so the gate will not force any of this", which reads the absence of a glob as
the absence of a floor. `coverage.include` is `src/**/*.{ts,tsx}` and none of the three engines is
in `coverage.exclude`, so all three sit under the GLOBAL floor (lines 92 / funcs 91 / branches 80 /
stmts 89) — a per-engine glob would only OVERRIDE that floor, never create it. The panels genuinely
are ungated, but by the blanket `src/app/**/*.tsx` exclusion, which is a different mechanism.
Reproduce, against `vitest.config.ts`: `grep -c '"src/app/budget-report\.ts"' vitest.config.ts` → 0,
and the same for `fx.ts` and `evm.ts` → 0 each (no exclusion), while
`grep -n "thresholds" -A 12 vitest.config.ts` shows the four global numbers above and
`grep -n 'include: \["src/\*\*' vitest.config.ts` shows the blanket include.
So the gate DOES exert pressure on the three engines — just aggregate, project-wide pressure that a
handful of new lines can hide inside. The mutation proofs remain the only evidence that any
particular assertion here is doing work; that half of the original claim stands.

### 4. Sample data and fixtures

Sample bucket #4 "Data Migration (fixed price)" becomes USD with an explicit `fxRateOverride`, so the
figure never depends on a live ECB rate. Consequences, all legitimate because the *input* changed:

- regenerate `src/app/__fixtures__/golden-workspace.csv` and `.md` — both carry the `currency` and
  `fixedPriceAmount` columns for this row;
- regenerate `-big.json` / `-huge.json` via `npx vite-node scripts/generate-sample-workspace.ts`
  (never hand-edited);
- update `sample-workspace-budget.test.ts`, which asserts the bucket's amount and a "realistic"
  rollup;
- `e2e/seed.ts` inherits the master, so the e2e and axe runs exercise multi-currency for the first
  time.

## Task sequence

1. **Engine boundary** — the conversion, the required parameter, threading to the three call sites
   that lack `fxRates`, the five docstrings. Also traces the Trends `remainingCost` KPI's provenance,
   the one item the reconnaissance could not determine; if it derives from the budget report rather
   than from hours, it joins the changed-output list.
2. **Spillover and rollup** — the cross-bucket and cross-currency cases with their own fixtures.
3. **`projCur` mislabel** — the rollup stops labelling EUR figures with `plan.currency`.
4. **`plan.currency` narrowing** — type, sanitizer coercion, storage round-trip tests.
5. **§464 rename and both hints** — EN via Edit, DE via a node utf8 write, plus the
   `budgetCciBurnHint` cross-reference and the `docs/AGENTS/platform.md` sweep.
6. **Sample data** — the USD bucket, both goldens, the generated tiers, the sample test.
7. **Register** — close §464 and §465 with executable evidence; Status lines and index rows in the
   same commit.

Review: per-task spec-compliance then quality review, **plus a whole-branch review at the end**.
Five threaded call sites across several commits is precisely the shape where a guard lands on one
path and not its neighbour, and per-task review structurally cannot see that seam.

## Landmines

| Constraint | Where stated | Bearing here |
|---|---|---|
| `i18n.ts` / `i18n.de.ts` key sets identical; DE uses real umlauts, ASCII substitutes banned | `AGENTS.md` hard constraints; `i18n-encoding.test.ts` | Every DE string here carries umlauts (`Kostendeckung`, `tatsächliche`, `Erlös`, `über`) |
| The Edit tool corrupts umlauts and curls quotes in `i18n.de.ts`; the file is CRLF, so a `\n` anchor silently no-ops | `AGENTS.md` hard constraints | DE edits go through a node utf8 write matching `\r\n`, then are re-verified |
| `golden-workspace.test` pins exact CSV/Markdown bytes; regenerate only when the *input* legitimately changed | `AGENTS.md` hard constraints | The sample currency flip qualifies; regeneration must not mask a format diff |
| Sample tiers are generated, never hand-edited | `AGENTS.md` architecture pointers | `-big` / `-huge` via the script only |
| `agents-symbol-check` fails on a backticked mixed-case name that exists nowhere in `src` | `AGENTS.md` CI bullet | The key rename requires the `docs/AGENTS/platform.md` sweep |
| Engines stay i18n-free | `AGENTS.md` architecture pointers | `budget-report.ts` must remain string-free |
| `followups-status-check` and `followups-index-check`, both blocking | `AGENTS.md` CI bullet | Closing §464/§465 updates index rows and Status lines in the same commit |
| File-size ratchet, LIMIT 1600 | `scripts/check-file-sizes.mjs` | Ample headroom: `budget-report.ts` 664, `budget-panel.tsx` 800, `budget-bucket-modal.tsx` 827 |
| A new persisted field would mean six write paths | `AGENTS.md` hard constraints | Not triggered — no column is added. The `plan.currency` narrowing changes a type, not the schema |

## Out of scope

- The two CPIs' *deep-link* behaviour. The Dashboard tile will still navigate to the Budget view; with
  the rename the destination no longer shows a second thing called CPI, which is the defect. Changing
  the tile's target is a separate IA question.
- `winLossHours` remains unrendered. It is noted in §464 as a figure nothing displays; surfacing it is
  a product decision, not a correctness fix.
- Anything on the EVM side. `evm.ts` is untouched.
