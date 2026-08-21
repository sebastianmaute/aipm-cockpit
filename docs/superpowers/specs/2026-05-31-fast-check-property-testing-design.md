# fast-check Property-Based Testing — Design

**Date:** 2026-05-31
**Status:** Approved
**Ships as:** v0.37.2 (test-only patch — zero runtime/behavior change)

## Goal

Introduce property-based testing with [fast-check](https://github.com/dubzzz/fast-check)
across the app's pure-logic modules. Example-based tests pin specific cases;
property tests assert invariants over *generated* inputs, catching edge cases
(empty strings, huge numbers, reversed ranges, Unicode) that hand-written
examples miss.

The repo already has a strong invariant culture (e.g. the `parse ∘ format`
round-trip in `duration.test.ts`). This formalises and extends it.

## Approach

**Co-located `*.property.test.ts` per module.** One property file beside each
target module, matching the repo's flat co-location convention. Files are
discovered automatically by the existing vitest include glob
(`src/**/*.{test,spec}.{ts,tsx}`) because `foo.property.test.ts` ends with
`.test.ts`. No config change needed.

Rejected: a single consolidated `properties.test.ts` (violates many-small-files);
a separate `__properties__/` directory (diverges from the flat layout).

## Dependency

Add `fast-check` (latest 3.x) to `devDependencies`. No production/runtime impact.

## Conventions

- `fc.assert(fc.property(...arbitraries, predicate))` inside ordinary vitest
  `test()` bodies.
- Default `numRuns` (100); bump only where a property is cheap and high-value.
- No manual seeding — fast-check reports the failing seed and shrinks
  counterexamples automatically.
- Arbitraries inlined per file. Extract a shared `test-arbitraries.ts` **only**
  if an arbitrary (ISO date, `Period`, `RaidItem`) repeats across 3+ files.

## Critical framing

These properties run against **already-shipped, already-correct** code. A
property failure means one of two things:

1. The property is wrong → fix the property.
2. There is a latent bug → fix the code (or file it).

We investigate every failure; we never weaken a property just to make it green.
Discovering a latent bug is the *point* of this exercise.

## Target modules & properties

### `duration.property.test.ts`
- Round-trip: `parseDuration(formatDuration(m)) === m` for integer `m > 0`.
- `formatDuration(m) === ""` for `m <= 0`.
- `parseDuration` of arbitrary strings never throws; result is a non-negative
  integer or `null`.

### `fx.property.test.ts`
- `resolveRate(...)` is always `> 0`.
- Round-trip: `currencyToEur(eurToCurrency(x, b, r), b, r) ≈ x` (float tolerance).
- `eurToCurrency` is monotonic non-decreasing in `amountEur` for a positive rate.

### `resource-capacity.property.test.ts`
- `periodCapacityHours(...) >= 0`.
- `generatePeriods`: `start > end → []`; otherwise periods are ordered and each
  `period.start <= period.end`.
- `workdaysInRange(start, end, ∅) ∈ [0, totalCalendarDays]`.
- `convertUtilization` with `fromMode === toMode` is identity; outputs are
  non-negative.

### `due-dates.property.test.ts`
- `workdaysUntil(...) >= 0`; `due <= today → 0`.
- `shiftToWorkingDay` never moves the date forward and lands on a day that is
  not a weekend / holiday / absence day.
- `summarizeAlerts` counts sum to `items.length`.
- `getAlertableTasks` output is sorted by `dueDate` ascending; never throws.

### `sanitize.property.test.ts`
- Text sanitizers respect length caps and are idempotent
  (`f(f(x)) === f(x)`).
- `sanitizeLabel` output never contains `|`, `,`, `\r`, `\n`, `\t`; length
  `<= LABEL_MAX`.
- `sanitizeLabels` returns `<= LABELS_MAX_COUNT` entries, deduped
  case-insensitively, each `<= LABEL_MAX`.
- `sanitizeNonNegInt` → non-negative integer; `sanitizeOptionalMinutes` →
  `undefined` or non-negative integer.
- `serializeDependencies ∘ parseDependenciesString` and
  `encodePeriodMap ∘ decodePeriodMap` round-trip for valid inputs.

### `raid.property.test.ts`
- `riskSeverityFromMatrix` always returns one of the 4 levels and is monotonic
  in `probability * impact`.
- `compareRaid` is antisymmetric (`sign(cmp(a,b)) === -sign(cmp(b,a))`) and
  reflexive (`cmp(a,a) === 0`); sorting an array with it never throws; a missing
  `targetDate` always sorts last.
- `countByCategory` sums to `items.length`; `nextRaidId` is strictly greater
  than every existing id.

### `resource-cost.property.test.ts`
- `periodCost`: `margin === external - internal`; linear in `capacityHours`;
  no role → all zero.
- `formatCurrency` never throws, even for invalid currency codes (falls back).

### `date-format.property.test.ts`
- `localeFor` returns one of the 3 known locales.
- `formatExpiryDate` / `shortDateRange` never throw; unparseable input is
  returned verbatim.

## Testing & verification

- Full `npx vitest run` green (existing + new property suites).
- `npx tsc --noEmit` clean.
- Any property failure investigated per the *Critical framing* section.

## Out of scope

- Property tests for React components, network clients, or external-format
  serializers (export/zip/voice/jira-api) — those are E2E/integration territory
  and already coverage-excluded.
- Changing the coverage threshold.
