# Blended rate poisoning + cost-unknown reason — design

**Date:** 2026-07-21
**Follows:** 0.195.0 "McGuire" (!309) and 0.195.1 (!310) — the cost-knowability defect family.
**Status:** approved, ready for planning.

## Problem

Two open items left deliberately unfixed after 0.195.1. Both share one root: **`Role.internalRate` is
a required `number`, so `0` is the only representation of "nobody has priced this"** — indistinguishable
from a genuinely free role. Confirmed with the user: in this rate card, **0 always means unpriced.**

### 1. Blended-discipline dilution

`blendedDisciplineRate(id, roles)` takes an unweighted mean of `internalRate` across every role in the
discipline. A discipline with one role at 100 and one unpriced role blends to **50**.

That 50 then passes every guard shipped in 0.195.1: `hasRatedRow` sees `50 > 0`, `uncostedWork` stays
false, so `costIsKnowable` is **true** and no notice fires. A bucket staffed entirely by the unpriced
grade is costed at a rate nobody entered, and the panel presents the result as sound.

This is worse than the phantom-margin family it survived: a phantom 100% margin is obviously wrong, a
diluted rate is *plausible*. Blended allocation is per-discipline only (`DisciplineAllocation` carries no
`gradeId`), so which grade actually works is unknowable — only the denominator is in question.

### 2. Bare dash with no explanation

An empty bucket yields `costIsKnowable: false`, `ratesAreMissing: false` — margin, burn and fixed-price
win/loss render `—` with **no message at all**. Three states, two booleans, and the surface *infers*
which message to show. That inference is exactly what put "set them on the rate card" on an empty bucket
in the first place (defect #2 of the family).

## Decisions

| Question | Decision |
|---|---|
| Meaning of `internalRate === 0` | Always "unpriced". No role is ever genuinely free internally. |
| Discipline with mixed priced/unpriced grades | **Poison** — the blend is uncostable, not diluted. |
| Modelling "why is cost unknown" | **One reason enum**; the booleans become derived helpers. |
| Empty bucket | Gets its own explanatory line, same muted slot, uniform with every other reason. |
| Unpriced-blend message | **Names the offending disciplines.** |
| External-rate axis | **Out of scope**, logged as its own item (see Non-goals). |

## Design

### 1. Rate layer — `budget-rates.ts`

`blendedDisciplineRate` stops averaging an unpriced role's `0` into the internal mean:

- Any role in the discipline with `internalRate <= 0` → discipline internal rate is **0** (uncostable).
- A discipline with no roles → `0`, unchanged.
- `externalRate` keeps the plain mean this slice (see Non-goals).

New sibling predicate so the report can explain itself:

```ts
export function disciplineHasUnpricedGrade(id: number, roles: readonly Role[]): boolean;
```

**Override subtlety (load-bearing):** `effectiveRates` lets a bucket's `rateOverrideInternal` win over
the blend. When that override is usable the blend is irrelevant, so the poison **must not** fire — a
bucket the user has priced directly is fully costable regardless of the rate card behind it.

### 2. Report layer — `budget-report.ts`

Replace the two booleans with one discriminated field:

```ts
export type CostUnknownReason = "no-rows" | "no-rates" | "unrated-hours" | "unpriced-blend";
// on BucketReport and ProjectReport:
costUnknownReason: CostUnknownReason | null;
/** Disciplines whose blend is poisoned — drives the named message. Empty unless
 *  the reason is "unpriced-blend". */
unpricedDisciplineIds: number[];
```

- `costIsKnowable(r)` becomes a derived helper: `r.costUnknownReason === null`.
- `ratesAreMissing` is **deleted as a field**. With one message per reason there is nothing left for it
  to decide at a surface. The rollup predicate still needs the concept, so it survives as a second
  derived helper — `ratesMissing(r)` is `r.costUnknownReason !== null && r.costUnknownReason !== "no-rows"`,
  i.e. every reason except the empty bucket, which has no roles to rate.
  (The 0.195.1 rule "do NOT merge the two flags" was about merging them into a single *boolean*, which
  loses a state. A reason enum keeps every state distinguishable and adds one — it is the opposite move.)
- `DashboardBurn` carries `costUnknownReason` in place of the two flags. Nothing consumes them today.

Bucket reason derivation, in priority order:

1. `rows.length === 0` → `"no-rows"`
2. blended, no usable internal override, and some allocated discipline has an unpriced grade →
   `"unpriced-blend"`
3. `!hasRatedRow` → `"no-rates"`
4. `uncostedWork` → `"unrated-hours"`
5. otherwise `null`

Ordering matters: a poisoned blend also makes its row unrated, so `"unpriced-blend"` must be tested
before `"no-rates"` or the better message is never reached.

**Project rollup keeps its shipped predicate byte-for-byte:**

```ts
some(b => costIsKnowable(b)) && every(b => costIsKnowable(b) || (b.revenue === 0 && !ratesMissing(b)))
```

Its reason is the reason of the failing bucket that ranks highest by **severity of distortion** — note
this is deliberately *not* the bucket-level 1–4 order above, which is a derivation order of mutually
exclusive checks, not a ranking:

`unrated-hours` › `unpriced-blend` › `no-rates` › `no-rows`

Real hours costed at zero actively corrupt the total, so they outrank a missing rate card, which in turn
outranks a bucket that simply has nothing in it. A project with no buckets at all is `"no-rows"`. Pinned
by an invariant test — see Testing.

### 3. Surfaces

`budget-panel.tsx` (bucket card + project card) and `budget-report-panel.tsx` render from an exhaustive
map, so tsc forces a message for any reason added later:

```ts
const REASON_KEY: Record<CostUnknownReason, I18nKey> = { … };
```

The line keeps the existing slot and styling (`mt-2 text-xs text-muted-foreground`) — muted guidance,
not a warning banner, so a brand-new empty bucket does not nag.

Messages (EN, DE mirrors):

| Reason | Message |
|---|---|
| `no-rows` | No allocations yet, so cost, margin and burn cannot be calculated. Add a role or discipline line. |
| `no-rates` | *(reuses `budgetNoInternalRates`)* No internal rates are set for this bucket's roles… |
| `unrated-hours` | Some hours are booked against roles with no internal rate, so cost, margin and burn would be understated. |
| `unpriced-blend` | Blended rates cannot be calculated: {0} {has,have} grades with no internal rate. |

`unpriced-blend` interpolates the discipline names via the 0-based positional placeholder convention;
the panel already resolves discipline names for its allocation rows.

**DE i18n edits go through a node UTF-8 write with `\r\n` anchors** — the Edit tool corrupts umlauts and
curls quotes in `i18n.de.ts`, and the file is CRLF so an `\n` anchor silently no-ops.

### 4. Testing

- `budget-rates.test.ts` — poisoned blend; all-unpriced discipline; no-roles discipline; **override wins
  over the poison**; external mean unaffected.
- `budget-report.test.ts` — one test per reason; the invariant `costIsKnowable(r) === (r.costUnknownReason
  === null)`; a new **blended-partly-priced** kind added to the existing combinatorial bucket-kind
  enumeration (hand-picked scenarios missed the next case for five rounds — the enumeration is what
  caught the rollup); the project predicate pinned against the shipped `some && every` for every combo.
- Panel tests — each reason renders its own line; **an empty bucket renders the no-allocations line and
  NOT the rate-card line** (the original defect); a poisoned blend names its disciplines.
- Every new test mutation-checked. Two tests in the last round passed *before* their fix existed; a
  fixture guard (`expect(names).toContain(x)` before asserting position) goes on any positional assertion.

## Non-goals

- **External-rate blend dilution.** `blendedDisciplineRate` averages `externalRate` identically, so an
  unpriced role drags the external mean down and understates T&M revenue. This is the same defect class
  on the other axis, not a non-issue. It is out of scope because gating external cascades into revenue,
  consumption and T&M win/loss — all currently ungated *by design* ("knowable without a rate card") —
  and blanking them would turn a card that shows figures today into all dashes. It needs its own design
  decision about what an unknowable external rate does to those three, which is a slice, not a line.
- **Phase C (real EV/AC Cost Performance Index).** Deferred; plan already on disk at
  `docs/superpowers/plans/2026-07-21-budget-panel-correctness-and-evm.md`, tasks C1–C6.
- Changing `Role.internalRate` to a nullable field to distinguish free from unpriced. Rejected: the user
  confirmed 0 always means unpriced, so the distinction has no user-visible case and would cost a
  six-write-path migration plus a golden-fixture regeneration for nothing.

## Blast radius

Contained. `blendedDisciplineRate` has exactly one production consumer (`budget-report.ts:145`) plus its
own test. `costIsKnowable`/`ratesAreMissing` are consumed in `budget-panel.tsx`, `budget-report-panel.tsx`,
`budget-report.ts` and `dashboard.ts`, plus tests. No persisted field changes, no new backend write path,
no golden-fixture regeneration.
