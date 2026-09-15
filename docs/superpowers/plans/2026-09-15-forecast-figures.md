# Forecast Figures (MR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Budget report, the dashboard "Budget burn" tile and the Budget view show two named forecasts (current pace, current efficiency) from one set of facts, with transparency banners, tooltips and the effort-index renames; §543's double count is fixed first so the pace forecast never reads a stale key twice.

**Architecture:** Two pure, i18n-free layers. `working-days.ts` holds UTC day stepping. `budget-forecast.ts` has a numeric core (`computeForecastFromFacts`, pinned by the spec §5.6 fixture) and an assembler (`forecastFacts`) that turns the existing `BudgetReport`, buckets, rate rows and burn-down series into those facts. `budget-forecast-notices.ts` derives the ordered banner states. React surfaces (`budget-forecast-facts.tsx`, `budget-forecast-cards.tsx`, `budget-forecast-banner.tsx`, `budget-forecast-headline.tsx`, `budget-forecast-link.tsx`) only format.

**Tech Stack:** Next.js / React 19, TypeScript, vitest + Testing Library, `Intl`.

**Spec:** `docs/superpowers/specs/2026-09-14-budget-forecast-union-design.md` §5, §6.1–§6.4, §6.6, §7 (MR 2), §8. MR 3 (chart, switch) is out of this plan.

## Rulings (plan vs spec)

Recorded as `Ruling — why — cost if wrong`.

1. **AC is the contract basis.** Per bucket: T&M → `BucketReport.consumedValue` (hours × external EUR rate); fixed price → uncapped `contract × actualHours ÷ budgetHours` (§5.4). Never `cost` (internal rate). — BAC is `budgetValue`, which is external/contract basis; mixing bases would make VAC meaningless. — If wrong, every forecast figure shifts by the internal/external margin.
2. **EV is computed by the engine**, `Σ budgetValue × bucketPercentComplete(bucket, tasks) ÷ 100` over buckets with `budgetValue > 0`. `BucketReport.earnedValue` is internal-cost based and is not reused. — Spec §5.1 names `budgetValue`. — Cost: none beyond the formula the spec states.
3. **PV = `totalBudgetValue − plannedRemainingValue[todayIndex]`** of `computeBurndownSeries`, 0 when `todayIndex === −1`. — "The same planned series the burn-down uses" (§5.3). — If the chain span differs from the plan span, PV follows the chart, which is the intent.
4. **Window valuation only counts keys the report counts.** A day key counts when its period (live plan granularity) is one of the bucket's active periods. A period key counts only when it has the live granularity and is active; it is spread evenly over its working days (`spread: true`), or placed on its first calendar day when it has none. Keys with hours ≤ 0 carry no booking date. — Keeps Σ window-eligible values reconciled with AC (a test pins it). — Negative hand corrections do not reduce the burn rate.
5. **Zero earned value.** When EV is known but 0 while AC > 0, CPI would be 0 and ETC infinite. The engine returns a third efficiency state `{ unavailable: "no-earned-value" }` ("Nothing earned yet", no banner). — The spec type has no finite answer for it. — One extra union member the spec did not list.
6. **"needs" (§6.1/§6.2) is the `needs-percent-complete` state**, shown as the card's "Needs linked tasks or a % complete" line with its own tooltip. — The spec's `EfficiencyForecast` has no TCPI field, and §6.1 quotes this text as an unavailable reason. — If a TCPI was meant, MR 3 adds it.
7. **Budget RAG.** When the pace forecast is available, the budget bucket input to `budgetComputed` becomes `paceVacHealth(vac, bac)`: G when VAC ≥ 0, A when 0 > VAC > −10 % of BAC, R at ≤ −10 % (`PACE_VAC_RED_RATIO = 0.10`). Otherwise the existing `computeBudgetStatus` stays. The effort `evmIndexHealth(evm.cpi)` stays in the worst-of. — Spec says the RAG input is the pace VAC; it names no threshold and does not remove the effort signal. — The §5.6 project reads Amber; a team may expect Red.
8. **Effort renames are global.** `evmCpi`/`evmSpi` text becomes "Effort CPI"/"Effort SPI" on every surface (Budget report, dashboard tile), the section title `evmTitle` becomes "Earned value · effort", and every other user-visible bare CPI/SPI that reads the effort engine gains the qualifier. A new i18n guard test fails on any bare `CPI`/`SPI` outside an allowlist of forecast keys. — Spec §11: "renames must land on every surface in MR 2 at once". — Longer labels in settings and trends.
9. **Key rename** `budgetCciRecovery` → `budgetCciInternalCostIndex` (+ `Hint`); EN "Internal cost index", DE "Interner Kostenindex". — Spec §6.6 lists the pair as renamed, not the new name. — A key name only.
10. **Money and dates follow the viewer's locale.** New `formatMoneyCompact` (`notation: "compact"`), `formatSignedPercent`, `formatDayMonthYear`, `formatDayMonth` in `forecast-format.ts`, all dates in UTC. The spec's "€261k", "13 Oct 2026", "15 Sep" are en-GB-looking examples; en-US tests assert what `Intl` prints ("€261K", "Oct 13, 2026", "Sep 15"). — Spec §6.1a: "Dates use the viewer's locale formatting". — Casing of the compact suffix differs by locale.
11. **Forecast money is EUR** on every surface (engine unit), like the burn-down. — `computeBudgetReport` is EUR by construction. — A non-EUR plan currency shows EUR forecast figures, as the chart already does.
12. **Budget view link uses `TextButton`**, following the `onGoToTimelog` precedent in the same view, via a new optional `onOpenBudgetReport` prop that workspace-section wires to `setActiveTab("budget-report")` and omits in popouts. — User rule: existing primitives, no hand-rolled controls. — `TextButton`'s docstring prefers bespoke navigation links; the in-view precedent wins.
13. **Tile size:** `burn` catalogue `h: 3, minH: 3, maxH: 4` (`BlockSpan` allows 4). `reconcile` clamps saved layouts. — Spec §6.3 "may rise from 2 to 3"; keeping `maxH` 3 would freeze the height. — One more row of vertical space.
14. **Tooltip texts are written here** (Task 4). The union mockup the spec cites is not in the repo (`grep -ril "current pace" .superpowers/brainstorm` returns nothing). — The spec requires meaning, formula with the project's numbers and how to read it. — Wording review happens in the task review.
15. **§543 fix is dated-branch only.** In `writeAllocations`, for each routed day, the OTHER granularity's bare period key (`periodKeyForDate(day, other)`) is removed before the day keys are written. A hand-typed month total overlapping a covered week is removed whole, as the register's fix shape says. The undated branch has no days and is unchanged. — Register §543 "Fix shape". — Hand-typed hours on uncovered days of that month are dropped; the unapplied notice already treated the period as TimeLog-owned.
16. **Register:** close §499 and §543; §501 and §504 stay open (S-curve and forecast line are MR 3) with corrected Status lines; §504's "URL supplied truncated" claim is corrected.

## Global Constraints

- `src/app/*.ts(x)` are `i/lf w/crlf`. The Edit and Write tools keep CRLF for existing files; never `sed -i`. New files: write them, then check `git ls-files --eol` after staging shows `i/lf`. `docs/open-followups.md` is LF.
- `src/app/i18n.de.ts` is edited ONLY with a Node UTF-8 write whose anchor uses `\r\n`, with real umlauts. Never the Edit tool. Re-read the inserted lines afterwards.
- EN and DE keys land in the same commit (tsc enforces parity). Placeholders are 0-based `{0}`, `{1}`.
- `Lang` literals in tests are `"en-US"`, never `"en"`. A test asserting DE output calls `loadI18n("de")` in `beforeAll`.
- Never `git add -A` or `git add .`. Stage named paths. Never stage `sample-workspace-huge.json` or `not-in-use.env.local.bak`. No `--amend`.
- Commit messages carry no `#` followed by digits. End every commit message with `Claude-Session: https://[session link removed]`.
- Never read an exit code through a pipe. Run vitest as `npx vitest run <files> > <scratch>/<name>.log 2>&1; echo "EXIT=$?"`, then read the log and check `Test Files` counts the files you named. Never run two vitest processes at once. No full suite (the user runs it at the end on their say).
- After editing any test file, run `npx tsc --noEmit; echo "EXIT=$?"`.
- Lint touched files: `npx eslint --max-warnings=0 <files>; echo "EXIT=$?"`. Unused bindings are fatal; `react-hooks/exhaustive-deps` rejects `obj.member` deps; no `Date.now()`/`new Date()` in a render body.
- New `.ts` engine files are coverage-gated (global lines 92 / functions 91 / branches 80 / statements 89): test every exported function and branch.
- UI: only existing primitives (`Banner`, `InfoTooltip`, `Tile`, `Section`, `TextButton`). No hand-rolled toggles or buttons. Palette tokens only.
- Constants: `BURN_RATE_WINDOW_WORKING_DAYS = 20`, `FORECAST_GAP_WARNING_RATIO = 0.10`, `PACE_VAC_RED_RATIO = 0.10`.
- Day key `YYYY-MM-DD`, month key `YYYY-MM`, week key `YYYY-Www`. All date math in UTC.
- File size LIMIT 1600 lines (`readFileSync().split("\n").length`).

## File Structure

| File | Responsibility |
|---|---|
| Modify `src/app/timelog-apply.ts`, `src/app/timelog-apply.test.ts` | Task 0: §543 |
| Create `src/app/working-days.ts` (+ test) | UTC working-day stepping and period bounds |
| Create `src/app/budget-forecast.ts` (+ test) | Types, constants, `computeForecastFromFacts`, `forecastGap`, `paceVacHealth`, `forecastFacts`, `computeBudgetForecast`, `computeProjectForecast` |
| Create `src/app/budget-forecast-notices.ts` (+ test) | Ordered banner states from a `BudgetForecast` |
| Create `src/app/forecast-format.ts` (+ test) | Compact money, signed percent, locale dates |
| Modify `src/app/i18n.ts`, `src/app/i18n.de.ts` | Task 4 forecast keys; Task 6 renames |
| Create `src/app/budget-forecast-facts.tsx`, `budget-forecast-cards.tsx`, `budget-forecast-banner.tsx` (+ tests) | Budget report surfaces |
| Modify `src/app/budget-report-panel.tsx` (+ test) | Section order, forecast wiring |
| Create `src/app/i18n-cpi-labels.test.ts` | Guard: no bare CPI/SPI outside forecast keys |
| Modify `src/app/budget-panel.tsx`, `budget-panel.test.tsx`, `dashboard-tile-bodies.tsx`, trends / next-actions / settings / help strings | Renames |
| Modify `src/app/dashboard.ts`, `dashboard-tiles.ts`, `dashboard-tile-bodies.tsx`, `dashboard-layout.test.ts`, dashboard tests; create `src/app/budget-forecast-headline.tsx` (+ test) | Tile headline, RAG, height |
| Create `src/app/budget-forecast-link.tsx` (+ test); modify `budget-panel.tsx`, `workspace-section.tsx` | Budget view link line |
| Modify `docs/open-followups.md`, `docs/AGENTS/integrations.md`, `docs/AGENTS/dashboard.md` | Task 9 docs |

Execution order: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9.

---

### Task 0: §543 — a dated Apply removes the overlapping period key of the other granularity

**Files:**
- Modify: `src/app/timelog-apply.ts` (`writeAllocations`)
- Test: `src/app/timelog-apply.test.ts` (`describe("dated apply", …)`)

**Interfaces:**
- Consumes: `periodKeyForDate(dateISO, granularity)` from `./resource-capacity`; `granularityOfPeriodKey(key)` from `./actual-hours`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests** — append inside `describe("dated apply", () => { … })`, which already defines `bucketWith`, `links`, `tItem`, `resources`, `roles`:

```ts
  it("removes a hand-typed month key that overlaps a weekly dated apply (§543)", () => {
    const agg = aggregateActuals([tItem(1, 9, "2026-06-10", 4)], links);
    const after = applyActualsToBuckets([bucketWith({ "2026-06": 10 })], bucketOverlay(agg, "week"), resources, roles);
    const hours = after[0].allocations[0].actualHours;
    expect(hours["2026-06"]).toBeUndefined();
    expect(actualHoursIn(hours, "2026-06")).toBe(4);
    expect(actualHoursIn(hours, "2026-W24")).toBe(4);
  });

  it("removes a hand-typed week key that overlaps a monthly dated apply (§543)", () => {
    const agg = aggregateActuals([tItem(1, 9, "2026-06-10", 4)], links);
    const after = applyActualsToBuckets([bucketWith({ "2026-W24": 10 })], bucketOverlay(agg, "month"), resources, roles);
    const hours = after[0].allocations[0].actualHours;
    expect(hours["2026-W24"]).toBeUndefined();
    expect(actualHoursIn(hours, "2026-W24")).toBe(4);
  });

  it("keeps an other-granularity key that no applied day falls in (§543)", () => {
    const agg = aggregateActuals([tItem(1, 9, "2026-06-10", 4)], links);
    const after = applyActualsToBuckets([bucketWith({ "2026-07": 8 })], bucketOverlay(agg, "week"), resources, roles);
    expect(after[0].allocations[0].actualHours["2026-07"]).toBe(8);
  });
```

- [ ] **Step 2: Run, expect the first two to FAIL** (`hours["2026-06"]` is 10).

Run: `npx vitest run src/app/timelog-apply.test.ts > <scratch>/t0.log 2>&1; echo "EXIT=$?"`

- [ ] **Step 3: Implement** — in `writeAllocations`, replace the dated `else` branch:

```ts
      } else {
        // §543: a dated Apply owns every covered DAY, so a bare period key of
        // the OTHER granularity that contains one of those days is stale hand
        // input and would be summed on top of the day keys after a switch back.
        const own = granularityOfPeriodKey(period);
        const other = own === "month" ? "week" : own === "week" ? "month" : null;
        for (const [day, h] of Object.entries(days?.[period] ?? {})) {
          if (other) delete nextActual[periodKeyForDate(day, other)];
          nextActual[day] = h;
        }
      }
```

`nextActual` is this function's own copy (`{ ...a.actualHours }`), so the delete never touches stored state. Add the two imports if absent.

- [ ] **Step 4: Run again, expect PASS; mutation-check** — comment out the `delete` line, confirm the first two tests fail, restore it, confirm `git diff --stat` shows only the intended change.

- [ ] **Step 5: Gates and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/timelog-apply.ts src/app/timelog-apply.test.ts; echo "EXIT=$?"
git add src/app/timelog-apply.ts src/app/timelog-apply.test.ts
git commit -m "fix(timelog): a dated Apply removes the overlapping period key of the other granularity (§543)" -m "Claude-Session: https://[session link removed]"
```

---

### Task 1: Working-day helpers

**Files:**
- Create: `src/app/working-days.ts`, `src/app/working-days.test.ts`

**Interfaces:**
- Produces (all dates `YYYY-MM-DD`, UTC, weekends = Sat/Sun, `holidaySet` holds ISO dates):

```ts
export function addCalendarDays(iso: string, n: number): string;
export function calendarDaysBetween(from: string, to: string): number; // to − from
export function isWorkingDay(iso: string, holidaySet: ReadonlySet<string>): boolean;
/** The `count` working days strictly before `today`, ascending. */
export function workingDaysBefore(today: string, count: number, holidaySet: ReadonlySet<string>): string[];
/** The n-th working day strictly after `from` (n ≥ 1). */
export function nthWorkingDayAfter(from: string, n: number, holidaySet: ReadonlySet<string>): string;
/** Working days in [startInclusive, endExclusive); 0 when end ≤ start. */
export function countWorkingDays(startInclusive: string, endExclusive: string, holidaySet: ReadonlySet<string>): number;
/** Working days in [start, end] inclusive, ascending. */
export function workingDaysInRange(start: string, end: string, holidaySet: ReadonlySet<string>): string[];
/** Inclusive calendar bounds of a month (`YYYY-MM`) or ISO week (`YYYY-Www`) key; null for anything else. */
export function periodBounds(periodKey: string): { start: string; end: string } | null;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  addCalendarDays, calendarDaysBetween, countWorkingDays, isWorkingDay, nthWorkingDayAfter,
  periodBounds, workingDaysBefore, workingDaysInRange,
} from "./working-days";

const none = new Set<string>();

describe("working-days", () => {
  it("steps calendar days across a month and a year end", () => {
    expect(addCalendarDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(calendarDaysBetween("2026-11-27", "2026-12-18")).toBe(21);
    expect(calendarDaysBetween("2026-12-18", "2026-11-27")).toBe(-21);
  });

  it("treats weekends and holidays as non-working", () => {
    expect(isWorkingDay("2026-09-14", none)).toBe(true);   // Monday
    expect(isWorkingDay("2026-09-19", none)).toBe(false);  // Saturday
    expect(isWorkingDay("2026-09-20", none)).toBe(false);  // Sunday
    expect(isWorkingDay("2026-09-07", new Set(["2026-09-07"]))).toBe(false);
  });

  it("returns the 20 working days before today (spec §5.6 window)", () => {
    const w = workingDaysBefore("2026-09-14", 20, none);
    expect(w).toHaveLength(20);
    expect(w[0]).toBe("2026-08-17");
    expect(w[19]).toBe("2026-09-11");
  });

  it("skips a holiday inside the window", () => {
    const w = workingDaysBefore("2026-09-14", 20, new Set(["2026-09-07"]));
    expect(w[0]).toBe("2026-08-14");
    expect(w).not.toContain("2026-09-07");
  });

  it("finds the n-th working day after a date", () => {
    expect(nthWorkingDayAfter("2026-09-14", 1, none)).toBe("2026-09-15");
    expect(nthWorkingDayAfter("2026-09-14", 54, none)).toBe("2026-11-27");
    expect(nthWorkingDayAfter("2026-09-18", 1, none)).toBe("2026-09-21");
    expect(nthWorkingDayAfter("2026-09-18", 1, new Set(["2026-09-21"]))).toBe("2026-09-22");
  });

  it("counts working days in a half-open range", () => {
    expect(countWorkingDays("2026-09-15", "2026-12-19", none)).toBe(69);
    expect(countWorkingDays("2026-09-15", "2026-10-02", none)).toBe(13);
    expect(countWorkingDays("2026-09-15", "2026-09-15", none)).toBe(0);
    expect(countWorkingDays("2026-09-16", "2026-09-15", none)).toBe(0);
  });

  it("lists working days in an inclusive range", () => {
    expect(workingDaysInRange("2026-06-01", "2026-06-30", none)).toHaveLength(22);
    expect(workingDaysInRange("2026-09-19", "2026-09-20", none)).toEqual([]);
  });

  it("returns period bounds for month and ISO week keys", () => {
    expect(periodBounds("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(periodBounds("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(periodBounds("2026-W24")).toEqual({ start: "2026-06-08", end: "2026-06-14" });
    expect(periodBounds("2026-W01")).toEqual({ start: "2025-12-29", end: "2026-01-04" });
    expect(periodBounds("2026-06-10")).toBeNull();
    expect(periodBounds("nonsense")).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing).

- [ ] **Step 3: Implement**

```ts
/**
 * UTC working-day stepping for the budget forecast (spec §5.2). A working day is
 * Monday–Friday and not in `holidaySet` — the same rule `workdaysInRange`
 * (`resource-capacity.ts`) counts with. Every date is an ISO `YYYY-MM-DD` string
 * read and written in UTC, so no local timezone can shift a day.
 */

const DAY_MS = 86_400_000;

function toUtcMs(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addCalendarDays(iso: string, n: number): string {
  return fromUtcMs(toUtcMs(iso) + n * DAY_MS);
}

export function calendarDaysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

export function isWorkingDay(iso: string, holidaySet: ReadonlySet<string>): boolean {
  const dow = new Date(toUtcMs(iso)).getUTCDay();
  return dow !== 0 && dow !== 6 && !holidaySet.has(iso);
}

export function workingDaysBefore(today: string, count: number, holidaySet: ReadonlySet<string>): string[] {
  const out: string[] = [];
  let d = today;
  while (out.length < count) {
    d = addCalendarDays(d, -1);
    if (isWorkingDay(d, holidaySet)) out.push(d);
  }
  return out.reverse();
}

export function nthWorkingDayAfter(from: string, n: number, holidaySet: ReadonlySet<string>): string {
  let d = from;
  let seen = 0;
  while (seen < n) {
    d = addCalendarDays(d, 1);
    if (isWorkingDay(d, holidaySet)) seen += 1;
  }
  return d;
}

export function countWorkingDays(startInclusive: string, endExclusive: string, holidaySet: ReadonlySet<string>): number {
  let n = 0;
  for (let d = startInclusive; d < endExclusive; d = addCalendarDays(d, 1)) {
    if (isWorkingDay(d, holidaySet)) n += 1;
  }
  return n;
}

export function workingDaysInRange(start: string, end: string, holidaySet: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addCalendarDays(d, 1)) {
    if (isWorkingDay(d, holidaySet)) out.push(d);
  }
  return out;
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const WEEK_RE = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;

export function periodBounds(periodKey: string): { start: string; end: string } | null {
  const m = MONTH_RE.exec(periodKey);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    return { start: fromUtcMs(Date.UTC(y, mo - 1, 1)), end: fromUtcMs(Date.UTC(y, mo, 0)) };
  }
  const w = WEEK_RE.exec(periodKey);
  if (w) {
    // ISO week 1 is the week holding 4 January; weeks start on Monday.
    const jan4 = Date.UTC(Number(w[1]), 0, 4);
    const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7; // Monday = 0
    const start = jan4 - jan4Dow * DAY_MS + (Number(w[2]) - 1) * 7 * DAY_MS;
    return { start: fromUtcMs(start), end: fromUtcMs(start + 6 * DAY_MS) };
  }
  return null;
}
```

- [ ] **Step 4: Run, expect PASS.** Cross-check the week rule against the existing helper once in the test file:

```ts
import { periodKeyForDate } from "./resource-capacity";
  it("agrees with periodKeyForDate on week membership", () => {
    for (const key of ["2026-W01", "2026-W24", "2026-W53", "2027-W01"]) {
      const b = periodBounds(key);
      if (!b) continue; // 2026 has 53 ISO weeks; skip a key a year lacks
      expect(periodKeyForDate(b.start, "week")).toBe(key);
      expect(periodKeyForDate(b.end, "week")).toBe(key);
    }
  });
```

- [ ] **Step 5: Gates and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/working-days.ts src/app/working-days.test.ts; echo "EXIT=$?"
git add src/app/working-days.ts src/app/working-days.test.ts
git commit -m "feat(budget): UTC working-day helpers for the forecast window" -m "Claude-Session: https://[session link removed]"
```

---

### Task 2: Forecast core from facts

**Files:**
- Create: `src/app/budget-forecast.ts`, `src/app/budget-forecast.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces (exact):

```ts
export const BURN_RATE_WINDOW_WORKING_DAYS = 20;
export const FORECAST_GAP_WARNING_RATIO = 0.10;
export const PACE_VAC_RED_RATIO = 0.10;

export type PaceForecast = { burnRatePerDay: number; windowDays: number; windowStart: string; windowEnd: string;
  spreadPeriodHoursUsed: boolean; workingDaysLeft: number;
  etc: number; eac: number; vac: number; runOutDate: string | null; daysBeforePlannedEnd: number | null };
export type PaceUnavailable =
  | { unavailable: "not-enough-bookings"; firstBookingDate: string | null; bookedWorkingDays: number; availableFrom: string | null }
  | { unavailable: "no-burn"; windowStart: string; windowEnd: string; lastBookingDate: string | null };
export type EfficiencyForecast = { pv: number; cpi: number; spi: number | null; etc: number; eac: number; vac: number };
export type EfficiencyUnavailable =
  | { unavailable: "needs-percent-complete"; bucketsMissingPercent: readonly { id: number; name: string }[] }
  | { unavailable: "no-actual-cost" }
  | { unavailable: "no-earned-value" };
export type ForecastGap = { eacDifference: number; percentOfBac: number; severity: "info" | "warning"; extraWorkingDays: number | null };
export type BudgetForecast = {
  facts: { bac: number; ac: number; remaining: number; ev: number | null; percentComplete: number | null };
  pace: PaceForecast | PaceUnavailable;
  efficiency: EfficiencyForecast | EfficiencyUnavailable;
  gap: ForecastGap | null;
  hasFixedPrice: boolean;
};
export type DatedValue = { date: string; bookedFrom: string; value: number; spread: boolean };
export type ForecastFacts = {
  bac: number; ac: number; ev: number | null; pv: number;
  bucketsMissingPercent: readonly { id: number; name: string }[];
  dated: readonly DatedValue[];
  planEnd: string; today: string; holidaySet: ReadonlySet<string>; hasFixedPrice: boolean;
};
export function computeForecastFromFacts(f: ForecastFacts): BudgetForecast;
export function forecastGap(pace: PaceForecast, efficiency: EfficiencyForecast, bac: number): ForecastGap;
export function paceVacHealth(vac: number, bac: number): "R" | "A" | "G" | null;
export function isPaceAvailable(p: BudgetForecast["pace"]): p is PaceForecast;
export function isEfficiencyAvailable(e: BudgetForecast["efficiency"]): e is EfficiencyForecast;
```

`workingDaysLeft` is added to the spec's `PaceForecast` (the gap and the tooltips need it). `percentComplete` is 0–100 like `bucketPercentComplete`.

- [ ] **Step 1: Write the failing tests** (`budget-forecast.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import {
  computeForecastFromFacts, forecastGap, isEfficiencyAvailable, isPaceAvailable, paceVacHealth,
  type DatedValue, type EfficiencyForecast, type ForecastFacts, type PaceForecast,
} from "./budget-forecast";
import { workingDaysBefore, workingDaysInRange } from "./working-days";

const none = new Set<string>();
const day = (date: string, value: number, spread = false): DatedValue => ({ date, bookedFrom: date, value, spread });

function fixture(over: Partial<ForecastFacts> = {}): ForecastFacts {
  return {
    bac: 240_000, ac: 168_000, ev: 148_800, pv: 176_000, bucketsMissingPercent: [],
    dated: [day("2026-01-05", 141_000), ...workingDaysBefore("2026-09-14", 20, none).map((d) => day(d, 1_350))],
    planEnd: "2026-12-18", today: "2026-09-14", holidaySet: none, hasFixedPrice: false,
    ...over,
  };
}

describe("computeForecastFromFacts — spec §5.6 acceptance fixture", () => {
  const f = computeForecastFromFacts(fixture());

  it("facts", () => {
    expect(f.facts).toEqual({ bac: 240_000, ac: 168_000, remaining: 72_000, ev: 148_800, percentComplete: 62 });
  });

  it("current pace", () => {
    if (!isPaceAvailable(f.pace)) throw new Error("pace unavailable");
    expect(f.pace.burnRatePerDay).toBe(1_350);
    expect(f.pace.windowDays).toBe(20);
    expect(f.pace.windowStart).toBe("2026-08-17");
    expect(f.pace.windowEnd).toBe("2026-09-11");
    expect(f.pace.workingDaysLeft).toBe(69);
    expect(f.pace.etc).toBe(93_150);
    expect(f.pace.eac).toBe(261_150);
    expect(f.pace.vac).toBe(-21_150);
    expect(f.pace.runOutDate).toBe("2026-11-27");
    expect(f.pace.daysBeforePlannedEnd).toBe(21);
    expect(f.pace.spreadPeriodHoursUsed).toBe(false);
  });

  it("current efficiency", () => {
    if (!isEfficiencyAvailable(f.efficiency)) throw new Error("efficiency unavailable");
    expect(f.efficiency.pv).toBe(176_000);
    expect(f.efficiency.cpi).toBeCloseTo(0.885714, 6);
    expect(f.efficiency.spi).toBeCloseTo(0.845455, 6);
    expect(f.efficiency.etc).toBeCloseTo(102_967.74, 2);
    expect(f.efficiency.eac).toBeCloseTo(270_967.74, 2);
    expect(f.efficiency.vac).toBeCloseTo(-30_967.74, 2);
  });

  it("gap", () => {
    expect(f.gap).not.toBeNull();
    expect(f.gap!.eacDifference).toBeCloseTo(9_817.74, 2);
    expect(f.gap!.percentOfBac).toBeCloseTo(0.040907, 6);
    expect(f.gap!.severity).toBe("info");
    expect(f.gap!.extraWorkingDays).toBe(8);
  });
});

describe("computeForecastFromFacts — pace window", () => {
  it("skips a holiday and ignores a booking on it", () => {
    const hs = new Set(["2026-09-07"]);
    const f = computeForecastFromFacts(fixture({ holidaySet: hs, dated: [day("2026-01-05", 1), day("2026-09-07", 9_999), day("2026-08-14", 2_000)] }));
    if (!isPaceAvailable(f.pace)) throw new Error("pace unavailable");
    expect(f.pace.windowStart).toBe("2026-08-14");
    expect(f.pace.burnRatePerDay).toBe(100);
  });

  it("flags spread period hours only when they fall in the window", () => {
    const inWindow = computeForecastFromFacts(fixture({ dated: [day("2026-01-05", 1), { date: "2026-09-01", bookedFrom: "2026-09-01", value: 100, spread: true }] }));
    const outside = computeForecastFromFacts(fixture({ dated: [{ date: "2026-01-05", bookedFrom: "2026-01-01", value: 100, spread: true }, day("2026-09-01", 100)] }));
    expect(isPaceAvailable(inWindow.pace) && inWindow.pace.spreadPeriodHoursUsed).toBe(true);
    expect(isPaceAvailable(outside.pace) && outside.pace.spreadPeriodHoursUsed).toBe(false);
  });

  it("returns no run-out when the budget is already used up", () => {
    const f = computeForecastFromFacts(fixture({ ac: 250_000 }));
    expect(isPaceAvailable(f.pace) && f.pace.runOutDate).toBeNull();
    expect(isPaceAvailable(f.pace) && f.pace.daysBeforePlannedEnd).toBeNull();
  });

  it("counts a run-out after the plan end as negative days", () => {
    const f = computeForecastFromFacts(fixture({ planEnd: "2026-10-30" }));
    if (!isPaceAvailable(f.pace)) throw new Error("pace unavailable");
    expect(f.pace.runOutDate).toBe("2026-11-27");
    expect(f.pace.daysBeforePlannedEnd).toBe(-28);
  });

  it("has no working days left when the plan has ended", () => {
    const f = computeForecastFromFacts(fixture({ planEnd: "2026-09-01" }));
    expect(isPaceAvailable(f.pace) && f.pace.workingDaysLeft).toBe(0);
    expect(isPaceAvailable(f.pace) && f.pace.etc).toBe(0);
  });
});

describe("computeForecastFromFacts — pace unavailable", () => {
  it("not-enough-bookings with transparency fields", () => {
    const dated = workingDaysInRange("2026-09-15", "2026-10-01", none).map((d) => day(d, 100));
    const f = computeForecastFromFacts(fixture({ today: "2026-10-02", dated }));
    expect(f.pace).toEqual({ unavailable: "not-enough-bookings", firstBookingDate: "2026-09-15", bookedWorkingDays: 13, availableFrom: "2026-10-13" });
  });

  it("counts from a weekend first booking across a holiday", () => {
    const hs = new Set(["2026-09-21"]);
    const f = computeForecastFromFacts(fixture({ today: "2026-09-25", holidaySet: hs, dated: [day("2026-09-19", 50)] }));
    expect(f.pace).toEqual({ unavailable: "not-enough-bookings", firstBookingDate: "2026-09-19", bookedWorkingDays: 3, availableFrom: "2026-10-20" });
  });

  it("uses a period's start as the first booking date", () => {
    const f = computeForecastFromFacts(fixture({ today: "2026-09-25", dated: [{ date: "2026-09-15", bookedFrom: "2026-09-01", value: 10, spread: true }] }));
    expect(f.pace).toMatchObject({ unavailable: "not-enough-bookings", firstBookingDate: "2026-09-01" });
  });

  it("nothing booked", () => {
    const f = computeForecastFromFacts(fixture({ dated: [] }));
    expect(f.pace).toEqual({ unavailable: "not-enough-bookings", firstBookingDate: null, bookedWorkingDays: 0, availableFrom: null });
  });

  it("no-burn names the window and the last booking", () => {
    const f = computeForecastFromFacts(fixture({ dated: [day("2026-01-05", 100), day("2026-08-03", 50)] }));
    expect(f.pace).toEqual({ unavailable: "no-burn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: "2026-08-03" });
  });

  it("no-burn ignores bookings dated today or later for the last booking", () => {
    const f = computeForecastFromFacts(fixture({ dated: [day("2026-01-05", 100), day("2026-09-14", 50)] }));
    expect(f.pace).toMatchObject({ unavailable: "no-burn", lastBookingDate: "2026-01-05" });
  });
});

describe("computeForecastFromFacts — efficiency unavailable", () => {
  it("needs percent complete, names buckets in order", () => {
    const missing = [{ id: 2, name: "Design" }, { id: 3, name: "Rollout" }];
    const f = computeForecastFromFacts(fixture({ ev: null, bucketsMissingPercent: missing }));
    expect(f.efficiency).toEqual({ unavailable: "needs-percent-complete", bucketsMissingPercent: missing });
    expect(f.facts.percentComplete).toBeNull();
    expect(f.gap).toBeNull();
  });

  it("no actual cost", () => {
    expect(computeForecastFromFacts(fixture({ ac: 0 })).efficiency).toEqual({ unavailable: "no-actual-cost" });
  });

  it("no earned value", () => {
    expect(computeForecastFromFacts(fixture({ ev: 0 })).efficiency).toEqual({ unavailable: "no-earned-value" });
  });

  it("SPI is null when nothing is planned yet", () => {
    const f = computeForecastFromFacts(fixture({ pv: 0 }));
    expect(isEfficiencyAvailable(f.efficiency) && f.efficiency.spi).toBeNull();
  });
});

describe("forecastGap", () => {
  const pace = { burnRatePerDay: 1_000, workingDaysLeft: 40, eac: 100_000 } as PaceForecast;
  const eff = (eac: number, etc = 50_000) => ({ eac, etc } as EfficiencyForecast);

  it("warns at exactly 10% of BAC and not at 9.99%", () => {
    expect(forecastGap(pace, eff(110_000), 100_000).severity).toBe("warning");
    expect(forecastGap(pace, eff(109_990), 100_000).severity).toBe("info");
  });

  it("uses the absolute EAC difference", () => {
    expect(forecastGap(pace, eff(90_000), 100_000).eacDifference).toBe(10_000);
  });

  it("extra working days only when positive", () => {
    expect(forecastGap(pace, eff(110_000), 100_000).extraWorkingDays).toBe(10);
    expect(forecastGap({ ...pace, workingDaysLeft: 50 }, eff(110_000), 100_000).extraWorkingDays).toBeNull();
    expect(forecastGap({ ...pace, workingDaysLeft: 60 }, eff(110_000), 100_000).extraWorkingDays).toBeNull();
  });

  it("zero BAC reads as info", () => {
    expect(forecastGap(pace, eff(110_000), 0)).toMatchObject({ percentOfBac: 0, severity: "info" });
  });
});

describe("paceVacHealth", () => {
  it("green, amber, red at the 10% line", () => {
    expect(paceVacHealth(0, 100)).toBe("G");
    expect(paceVacHealth(-9.99, 100)).toBe("A");
    expect(paceVacHealth(-10, 100)).toBe("R");
    expect(paceVacHealth(-1, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing).

- [ ] **Step 3: Implement** (`budget-forecast.ts`, core part; Task 3 appends the assembler):

```ts
/**
 * Budget forecast (spec 2026-09-14-budget-forecast-union-design.md §5). Pure and
 * i18n-free. Two named forecasts from one set of facts:
 * - current pace — the value booked per working day over the last
 *   BURN_RATE_WINDOW_WORKING_DAYS working days, carried to the plan end;
 * - current efficiency — ETC = (BAC − EV) ÷ CPI.
 * Money is EUR, on the contract basis (BAC = `budgetValue`), never internal cost.
 */
import { calendarDaysBetween, countWorkingDays, addCalendarDays, isWorkingDay, nthWorkingDayAfter, workingDaysBefore } from "./working-days";

// (constants and types exactly as in Interfaces above)

export function isPaceAvailable(p: BudgetForecast["pace"]): p is PaceForecast {
  return !("unavailable" in p);
}

export function isEfficiencyAvailable(e: BudgetForecast["efficiency"]): e is EfficiencyForecast {
  return !("unavailable" in e);
}

function pace(f: ForecastFacts): PaceForecast | PaceUnavailable {
  const { today, holidaySet: hs } = f;
  const booked = f.dated;
  const first = booked.reduce<string | null>((m, d) => (m === null || d.bookedFrom < m ? d.bookedFrom : m), null);
  const bookedWorkingDays = first === null ? 0 : countWorkingDays(first, today, hs);
  if (bookedWorkingDays < BURN_RATE_WINDOW_WORKING_DAYS) {
    let availableFrom: string | null = null;
    if (first !== null) {
      const start = isWorkingDay(first, hs) ? first : nthWorkingDayAfter(first, 1, hs);
      const last = nthWorkingDayAfter(start, BURN_RATE_WINDOW_WORKING_DAYS - 1, hs);
      availableFrom = nthWorkingDayAfter(last, 1, hs);
    }
    return { unavailable: "not-enough-bookings", firstBookingDate: first, bookedWorkingDays, availableFrom };
  }
  const window = workingDaysBefore(today, BURN_RATE_WINDOW_WORKING_DAYS, hs);
  const inWindow = new Set(window);
  const windowStart = window[0];
  const windowEnd = window[window.length - 1];
  let windowValue = 0;
  let spreadPeriodHoursUsed = false;
  for (const d of booked) {
    if (!inWindow.has(d.date)) continue;
    windowValue += d.value;
    if (d.spread) spreadPeriodHoursUsed = true;
  }
  if (windowValue <= 0) {
    const lastBookingDate = booked.reduce<string | null>((m, d) => (d.date < today && (m === null || d.date > m) ? d.date : m), null);
    return { unavailable: "no-burn", windowStart, windowEnd, lastBookingDate };
  }
  const burnRatePerDay = windowValue / BURN_RATE_WINDOW_WORKING_DAYS;
  const workingDaysLeft = countWorkingDays(addCalendarDays(today, 1), addCalendarDays(f.planEnd, 1), hs);
  const etc = burnRatePerDay * workingDaysLeft;
  const eac = f.ac + etc;
  const remaining = f.bac - f.ac;
  const runOutDate = remaining <= 0 ? null : nthWorkingDayAfter(today, Math.ceil(remaining / burnRatePerDay), hs);
  return {
    burnRatePerDay, windowDays: BURN_RATE_WINDOW_WORKING_DAYS, windowStart, windowEnd, spreadPeriodHoursUsed,
    workingDaysLeft, etc, eac, vac: f.bac - eac, runOutDate,
    daysBeforePlannedEnd: runOutDate === null ? null : calendarDaysBetween(runOutDate, f.planEnd),
  };
}

function efficiency(f: ForecastFacts): EfficiencyForecast | EfficiencyUnavailable {
  if (f.ev === null) return { unavailable: "needs-percent-complete", bucketsMissingPercent: f.bucketsMissingPercent };
  if (f.ac === 0) return { unavailable: "no-actual-cost" };
  if (f.ev === 0) return { unavailable: "no-earned-value" };
  const cpi = f.ev / f.ac;
  const etc = (f.bac - f.ev) / cpi;
  const eac = f.ac + etc;
  return { pv: f.pv, cpi, spi: f.pv === 0 ? null : f.ev / f.pv, etc, eac, vac: f.bac - eac };
}

export function forecastGap(p: PaceForecast, e: EfficiencyForecast, bac: number): ForecastGap {
  const eacDifference = Math.abs(e.eac - p.eac);
  const percentOfBac = bac > 0 ? eacDifference / bac : 0;
  const extra = Math.ceil(e.etc / p.burnRatePerDay) - p.workingDaysLeft;
  return {
    eacDifference, percentOfBac,
    severity: percentOfBac >= FORECAST_GAP_WARNING_RATIO ? "warning" : "info",
    extraWorkingDays: extra > 0 ? extra : null,
  };
}

export function paceVacHealth(vac: number, bac: number): "R" | "A" | "G" | null {
  if (bac <= 0) return null;
  if (vac >= 0) return "G";
  return -vac / bac >= PACE_VAC_RED_RATIO ? "R" : "A";
}

export function computeForecastFromFacts(f: ForecastFacts): BudgetForecast {
  const p = pace(f);
  const e = efficiency(f);
  return {
    facts: {
      bac: f.bac, ac: f.ac, remaining: f.bac - f.ac, ev: f.ev,
      percentComplete: f.ev === null || f.bac <= 0 ? null : (f.ev / f.bac) * 100,
    },
    pace: p,
    efficiency: e,
    gap: isPaceAvailable(p) && isEfficiencyAvailable(e) ? forecastGap(p, e, f.bac) : null,
    hasFixedPrice: f.hasFixedPrice,
  };
}
```

`percentComplete` for the fixture is exactly `148800 / 240000 × 100 = 62`; if floating point makes `toEqual` fail, change that one assertion to `toBeCloseTo(62, 10)` and leave the rest.

- [ ] **Step 4: Run, expect PASS; mutation-check each rule** — one at a time, revert after each, and record the result in the report: `>=` → `>` in the gap severity (9.99/10 test red); drop the holiday check (holiday test red); `Math.ceil` → `Math.floor` in run-out (fixture red); `d.date < today` → `d.date <= today` (last-booking test red); remove `if (d.spread)` (spread test red); swap the `ev === null` / `ac === 0` order (no-actual-cost test with ev null would change — add `fixture({ ev: null, ac: 0 })` expecting `needs-percent-complete` if the swap survives). End with `git diff --stat` showing only the two new files.

- [ ] **Step 5: Gates and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/budget-forecast.ts src/app/budget-forecast.test.ts; echo "EXIT=$?"
git add src/app/budget-forecast.ts src/app/budget-forecast.test.ts
git commit -m "feat(budget): forecast core — current pace, current efficiency and the gap" -m "Claude-Session: https://[session link removed]"
```

---

### Task 3: Assembler, project wrapper and banner states

**Files:**
- Modify: `src/app/budget-forecast.ts`, `src/app/budget-forecast.test.ts`
- Create: `src/app/budget-forecast-notices.ts`, `src/app/budget-forecast-notices.test.ts`

**Interfaces:**
- Consumes: `computeBudgetReport`, `bucketActivePeriods`, `bucketRateRows`, `BudgetReport` (`./budget-report`); `computeBurndownSeries`, `BurndownSeries` (`./budget-burndown`); `resolveBucketChain` (`./budget-bucket-chain`); `bucketPercentComplete` (`./budget-earned-value`); `currencyToEur` (`./fx`); `periodKeyForDate` (`./resource-capacity`); `isDayKey`, `granularityOfPeriodKey` (`./actual-hours`); `periodBounds`, `workingDaysInRange` (Task 1).
- Produces:

```ts
export type BudgetForecastInput = {
  report: BudgetReport; buckets: readonly BudgetBucket[]; roles: readonly Role[]; fxRates: FxRates | null;
  tasks: readonly Pick<Task, "id" | "status">[]; plan: ResourcePlan; burndown: BurndownSeries;
  holidaySet: ReadonlySet<string>; today: string;
};
export function forecastFacts(input: BudgetForecastInput): ForecastFacts;
export function computeBudgetForecast(input: BudgetForecastInput): BudgetForecast;
export type ProjectForecastArgs = {
  buckets: readonly BudgetBucket[]; plan: ResourcePlan; roles: readonly Role[]; resources: readonly Resource[];
  workdayHours: number; holidaySet: ReadonlySet<string>; absences: readonly Absence[];
  tasks: readonly Pick<Task, "id" | "status">[]; fxRates: FxRates | null; today: string;
};
/** Builds report, bucket chain and burn-down the way `budget-report-panel.tsx` does; null without buckets. */
export function computeProjectForecast(a: ProjectForecastArgs): BudgetForecast | null;

// budget-forecast-notices.ts
export type ForecastNotice =
  | { kind: "starts-on"; severity: "info"; availableFrom: string; bookedWorkingDays: number; firstBookingDate: string }
  | { kind: "starts-once-booked"; severity: "info" }
  | { kind: "no-burn"; severity: "warn"; windowStart: string; windowEnd: string; lastBookingDate: string | null }
  | { kind: "spread"; severity: "info" }
  | { kind: "needs-percent"; severity: "info"; bucketNames: readonly string[] };
/** Spec §6.1a states in table order. `no-actual-cost` / `no-earned-value` give none. */
export function forecastNotices(f: BudgetForecast): ForecastNotice[];
```

- [ ] **Step 1: Read before writing** — `computeBucketReport` (how `consumedValue` and `budgetHours` are formed), `effectiveBudgetHours` (a resource-less row with `budgetFollowsPlan` off reads the stored `budgetHours`), `currencyToEur` with `fxRates === null` for an EUR bucket, and the `BudgetBucket` required fields in `types.ts`. Build test fixtures from those, not from memory.

- [ ] **Step 2: Write the failing assembler tests** (append to `budget-forecast.test.ts`; adjust only the `bucket()` builder to satisfy the real `BudgetBucket` type):

```ts
import { computeBudgetReport } from "./budget-report";
import { computeBurndownSeries } from "./budget-burndown";
import { computeProjectForecast, forecastFacts, type BudgetForecastInput } from "./budget-forecast";
import type { BudgetBucket, ResourcePlan, Role } from "./types";

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const roles = [{ id: 1, disciplineId: 1, name: "Dev", gradeId: 1, internalRate: 60, externalRate: 100 } as Role];
function bucket(id: number, over: Partial<BudgetBucket> = {}): BudgetBucket {
  return {
    id, name: `B${id}`, type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: {} }],
    ...over,
  } as BudgetBucket;
}
function input(buckets: BudgetBucket[], tasks: BudgetForecastInput["tasks"] = [], today = "2026-09-14"): BudgetForecastInput {
  const report = computeBudgetReport(buckets, plan, roles, [], 8, none, [], [], null);
  const burndown = computeBurndownSeries(buckets, plan, roles, [], 8, none, [], today, null);
  return { report, buckets, roles, fxRates: null, tasks, plan, burndown, holidaySet: none, today };
}
const withActual = (id: number, actual: Record<string, number>, over: Partial<BudgetBucket> = {}) =>
  bucket(id, { allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: actual }], ...over } as Partial<BudgetBucket>);

describe("forecastFacts", () => {
  it("values exactly the keys the report counts, so the dated values sum to AC", () => {
    const b = withActual(1, { "2026-06-10": 8, "2026-06": 20, "2026-W24": 5, "2025-12": 3, "2026-07-01": 0 });
    const inp = input([b]);
    const f = forecastFacts(inp);
    expect(f.ac).toBe(inp.report.project.consumedValue);
    expect(f.ac).toBe(2_800);
    expect(f.dated.reduce((s, d) => s + d.value, 0)).toBeCloseTo(2_800, 6);
    const june = f.dated.filter((d) => d.spread);
    expect(june).toHaveLength(22);
    expect(june.every((d) => d.bookedFrom === "2026-06-01")).toBe(true);
    expect(f.dated.find((d) => d.date === "2026-06-10" && !d.spread)?.value).toBe(800);
  });

  it("values a fixed-price bucket uncapped", () => {
    const b = withActual(1, { "2026-06-10": 150 }, { type: "fixed", fixedPriceAmount: 100_000 } as Partial<BudgetBucket>);
    const inp = input([b]);
    const f = forecastFacts(inp);
    expect(inp.report.project.consumedValue).toBe(100_000);
    expect(f.ac).toBe(150_000);
    expect(f.dated[0].value).toBe(150_000);
    expect(f.hasFixedPrice).toBe(true);
  });

  it("sums earned value over budgeted buckets", () => {
    const f = forecastFacts(input([withActual(1, {}, { percentComplete: 50 } as Partial<BudgetBucket>)]));
    expect(f.ev).toBe(5_000);
    expect(f.bucketsMissingPercent).toEqual([]);
  });

  it("names every budgeted bucket without a percent complete, in bucket order", () => {
    const f = forecastFacts(input([
      withActual(1, {}, { percentComplete: 50 } as Partial<BudgetBucket>),
      withActual(2, {}, { name: "Design" } as Partial<BudgetBucket>),
      withActual(3, {}, { name: "Rollout" } as Partial<BudgetBucket>),
    ]));
    expect(f.ev).toBeNull();
    expect(f.bucketsMissingPercent).toEqual([{ id: 2, name: "Design" }, { id: 3, name: "Rollout" }]);
  });

  it("derives PV from the burn-down series", () => {
    const inp = input([withActual(1, {})]);
    const s = inp.burndown;
    expect(forecastFacts(inp).pv).toBe(s.todayIndex >= 0 ? s.totalBudgetValue - s.plannedRemainingValue[s.todayIndex] : 0);
    expect(forecastFacts(input([withActual(1, {})], [], "2025-06-01")).pv).toBe(0);
  });
});

describe("computeProjectForecast", () => {
  it("is null without buckets", () => {
    expect(computeProjectForecast({ buckets: [], plan, roles, resources: [], workdayHours: 8, holidaySet: none, absences: [], tasks: [], fxRates: null, today: "2026-09-14" })).toBeNull();
  });

  it("matches computeBudgetForecast on the same inputs", () => {
    const b = [withActual(1, { "2026-06-10": 8 })];
    const direct = computeForecastFromFacts(forecastFacts(input(b)));
    expect(computeProjectForecast({ buckets: b, plan, roles, resources: [], workdayHours: 8, holidaySet: none, absences: [], tasks: [], fxRates: null, today: "2026-09-14" })).toEqual(direct);
  });
});
```

If `bucket.percentComplete` is not the field name `bucketPercentComplete` reads, use the one it reads (`Pick<BudgetBucket, "taskIds" | "percentComplete">`).

- [ ] **Step 3: Implement the assembler** (append to `budget-forecast.ts`):

```ts
export function forecastFacts(input: BudgetForecastInput): ForecastFacts {
  const { report, buckets, roles, fxRates, tasks, plan, burndown, holidaySet, today } = input;
  const reportById = new Map(report.buckets.map((r) => [r.bucketId, r]));
  const dated: DatedValue[] = [];
  const bucketsMissingPercent: { id: number; name: string }[] = [];
  let ac = 0;
  let ev = 0;
  let hasFixedPrice = false;
  for (const bucket of buckets) {
    const br = reportById.get(bucket.id);
    if (!br) continue;
    const isFixed = bucket.type === "fixed";
    hasFixedPrice ||= isFixed;
    // §5.4: the uncapped contract ratio, so a fixed-price overrun shows.
    const fixedPerHour = isFixed && br.budgetHours > 0
      ? currencyToEur(bucket.fixedPriceAmount ?? 0, bucket, fxRates) / br.budgetHours
      : 0;
    ac += isFixed ? fixedPerHour * br.actualHours : br.consumedValue;
    if (br.budgetValue > 0) {
      const pct = bucketPercentComplete(bucket, tasks);
      if (pct === null) bucketsMissingPercent.push({ id: bucket.id, name: bucket.name });
      else ev += (br.budgetValue * pct) / 100;
    }
    const active = new Set(bucketActivePeriods(bucket, plan).map((p) => p.key));
    for (const row of bucketRateRows(bucket, roles)) {
      const perHour = isFixed ? fixedPerHour : row.rates.external;
      for (const [key, hours] of Object.entries(row.actualHours)) {
        if (!(hours > 0)) continue;
        if (isDayKey(key)) {
          if (active.has(periodKeyForDate(key, plan.granularity))) {
            dated.push({ date: key, bookedFrom: key, value: hours * perHour, spread: false });
          }
          continue;
        }
        if (granularityOfPeriodKey(key) !== plan.granularity || !active.has(key)) continue;
        const bounds = periodBounds(key);
        if (!bounds) continue;
        const days = workingDaysInRange(bounds.start, bounds.end, holidaySet);
        if (days.length === 0) {
          dated.push({ date: bounds.start, bookedFrom: bounds.start, value: hours * perHour, spread: true });
          continue;
        }
        const each = (hours * perHour) / days.length;
        for (const d of days) dated.push({ date: d, bookedFrom: bounds.start, value: each, spread: true });
      }
    }
  }
  const pv = burndown.todayIndex >= 0 ? burndown.totalBudgetValue - burndown.plannedRemainingValue[burndown.todayIndex] : 0;
  return {
    bac: report.project.budgetValue, ac, ev: bucketsMissingPercent.length > 0 ? null : ev, pv,
    bucketsMissingPercent, dated, planEnd: plan.endDate, today, holidaySet, hasFixedPrice,
  };
}

export function computeBudgetForecast(input: BudgetForecastInput): BudgetForecast {
  return computeForecastFromFacts(forecastFacts(input));
}

export function computeProjectForecast(a: ProjectForecastArgs): BudgetForecast | null {
  if (a.buckets.length === 0) return null;
  const report = computeBudgetReport(a.buckets, a.plan, a.roles, a.resources, a.workdayHours, a.holidaySet, a.absences, [], a.fxRates);
  const chain = resolveBucketChain(a.buckets, { start: a.plan.startDate, end: a.plan.endDate });
  const burndown = computeBurndownSeries(
    a.buckets, a.plan, a.roles, a.resources, a.workdayHours, a.holidaySet, a.absences, a.today, a.fxRates,
    chain.kind === "chain" ? { start: chain.start, end: chain.end } : undefined,
  );
  return computeBudgetForecast({ report, buckets: a.buckets, roles: a.roles, fxRates: a.fxRates, tasks: a.tasks, plan: a.plan, burndown, holidaySet: a.holidaySet, today: a.today });
}
```

Match the real parameter types of `computeBudgetReport` / `computeBurndownSeries` (`Set<string>` vs `ReadonlySet<string>`); widen with a cast only if tsc demands and say why in a comment.

- [ ] **Step 4: Write notices tests, then implement**

```ts
// budget-forecast-notices.test.ts
import { describe, expect, it } from "vitest";
import { forecastNotices } from "./budget-forecast-notices";
import type { BudgetForecast, PaceForecast } from "./budget-forecast";

const facts = { bac: 1, ac: 1, remaining: 0, ev: 1, percentComplete: 100 };
const pace = { burnRatePerDay: 1, windowDays: 20, windowStart: "2026-08-17", windowEnd: "2026-09-11", spreadPeriodHoursUsed: false,
  workingDaysLeft: 0, etc: 0, eac: 1, vac: 0, runOutDate: null, daysBeforePlannedEnd: null } as PaceForecast;
const eff = { pv: 1, cpi: 1, spi: 1, etc: 0, eac: 1, vac: 0 };
const make = (over: Partial<BudgetForecast>): BudgetForecast => ({ facts, pace, efficiency: eff, gap: null, hasFixedPrice: false, ...over });

describe("forecastNotices", () => {
  it("none when both forecasts ran on booked days", () => {
    expect(forecastNotices(make({}))).toEqual([]);
  });
  it("starts-on when bookings exist", () => {
    expect(forecastNotices(make({ pace: { unavailable: "not-enough-bookings", firstBookingDate: "2026-09-15", bookedWorkingDays: 13, availableFrom: "2026-10-13" } })))
      .toEqual([{ kind: "starts-on", severity: "info", availableFrom: "2026-10-13", bookedWorkingDays: 13, firstBookingDate: "2026-09-15" }]);
  });
  it("starts-once-booked when nothing is booked", () => {
    expect(forecastNotices(make({ pace: { unavailable: "not-enough-bookings", firstBookingDate: null, bookedWorkingDays: 0, availableFrom: null } })))
      .toEqual([{ kind: "starts-once-booked", severity: "info" }]);
  });
  it("no-burn is a warning", () => {
    expect(forecastNotices(make({ pace: { unavailable: "no-burn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null } })))
      .toEqual([{ kind: "no-burn", severity: "warn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null }]);
  });
  it("stacks spread and needs-percent in table order", () => {
    const n = forecastNotices(make({
      pace: { ...pace, spreadPeriodHoursUsed: true },
      efficiency: { unavailable: "needs-percent-complete", bucketsMissingPercent: [{ id: 2, name: "Design" }, { id: 3, name: "Rollout" }] },
    }));
    expect(n.map((x) => x.kind)).toEqual(["spread", "needs-percent"]);
    expect(n[1]).toEqual({ kind: "needs-percent", severity: "info", bucketNames: ["Design", "Rollout"] });
  });
  it("no-actual-cost and no-earned-value give no notice", () => {
    expect(forecastNotices(make({ efficiency: { unavailable: "no-actual-cost" } }))).toEqual([]);
    expect(forecastNotices(make({ efficiency: { unavailable: "no-earned-value" } }))).toEqual([]);
  });
});
```

```ts
// budget-forecast-notices.ts
import { isPaceAvailable, type BudgetForecast } from "./budget-forecast";

// (ForecastNotice type exactly as in Interfaces)

export function forecastNotices(f: BudgetForecast): ForecastNotice[] {
  const out: ForecastNotice[] = [];
  const p = f.pace;
  if (!isPaceAvailable(p)) {
    if (p.unavailable === "not-enough-bookings") {
      out.push(p.firstBookingDate !== null && p.availableFrom !== null
        ? { kind: "starts-on", severity: "info", availableFrom: p.availableFrom, bookedWorkingDays: p.bookedWorkingDays, firstBookingDate: p.firstBookingDate }
        : { kind: "starts-once-booked", severity: "info" });
    } else {
      out.push({ kind: "no-burn", severity: "warn", windowStart: p.windowStart, windowEnd: p.windowEnd, lastBookingDate: p.lastBookingDate });
    }
  } else if (p.spreadPeriodHoursUsed) {
    out.push({ kind: "spread", severity: "info" });
  }
  const e = f.efficiency;
  if ("unavailable" in e && e.unavailable === "needs-percent-complete") {
    out.push({ kind: "needs-percent", severity: "info", bucketNames: e.bucketsMissingPercent.map((b) => b.name) });
  }
  return out;
}
```

- [ ] **Step 5: Run both test files, expect PASS; mutation-check** — drop `!active.has(key)` (reconcile test red); make fixed price use `br.consumedValue` (uncapped test red); drop the `bookedFrom: bounds.start` (spread-start assertion red). Revert each.

- [ ] **Step 6: Gates and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/budget-forecast.ts src/app/budget-forecast.test.ts src/app/budget-forecast-notices.ts src/app/budget-forecast-notices.test.ts; echo "EXIT=$?"
git add src/app/budget-forecast.ts src/app/budget-forecast.test.ts src/app/budget-forecast-notices.ts src/app/budget-forecast-notices.test.ts
git commit -m "feat(budget): build forecast facts from the report, rate rows and burn-down" -m "Claude-Session: https://[session link removed]"
```

---

### Task 4: Formatters and forecast strings

**Files:**
- Create: `src/app/forecast-format.ts`, `src/app/forecast-format.test.ts`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

**Interfaces:**
- Produces:

```ts
export function formatMoneyCompact(amount: number, locale: string): string;          // EUR, notation compact, max 0 fraction digits
export function formatSignedPercent(ratio: number, locale: string, fractionDigits: 0 | 1): string; // −0.088 → "-8.8%", signDisplay "exceptZero"
export function formatDayMonthYear(iso: string, locale: string): string;             // UTC, day numeric, month short, year numeric
export function formatDayMonth(iso: string, locale: string): string;                 // UTC, day numeric, month short
```
- i18n keys below (EN exact; DE exact).

- [ ] **Step 1: Tests** — derive expectations from `Intl` itself for other locales, pin en-US literals:

```ts
import { describe, expect, it } from "vitest";
import { formatDayMonth, formatDayMonthYear, formatMoneyCompact, formatSignedPercent } from "./forecast-format";

describe("forecast-format", () => {
  it("compact EUR", () => {
    expect(formatMoneyCompact(261_150, "en-US")).toBe("€261K");
    expect(formatMoneyCompact(261_150, "de-DE")).toBe(new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 0 }).format(261_150));
  });
  it("signed percent", () => {
    expect(formatSignedPercent(-0.088125, "en-US", 1)).toBe("-8.8%");
    expect(formatSignedPercent(0.05, "en-US", 0)).toBe("+5%");
    expect(formatSignedPercent(0, "en-US", 0)).toBe("0%");
  });
  it("dates in UTC", () => {
    expect(formatDayMonthYear("2026-10-13", "en-US")).toBe("Oct 13, 2026");
    expect(formatDayMonthYear("2026-10-13", "en-GB")).toBe("13 Oct 2026");
    expect(formatDayMonth("2026-09-15", "en-US")).toBe("Sep 15");
    expect(formatDayMonth("2026-09-15", "en-GB")).toBe("15 Sep");
  });
});
```

- [ ] **Step 2: Implement**

```ts
/** Locale formatting for the budget forecast surfaces. Forecast money is EUR (engine unit). Dates are ISO days read in UTC. */
export function formatMoneyCompact(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 0 }).format(amount);
}

export function formatSignedPercent(ratio: number, locale: string, fractionDigits: 0 | 1): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: fractionDigits, minimumFractionDigits: fractionDigits, signDisplay: "exceptZero" }).format(ratio);
}

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function formatDayMonthYear(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(utcDate(iso));
}

export function formatDayMonth(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(utcDate(iso));
}
```

If `formatSignedPercent(0, …, 0)` does not print `"0%"`, fix the test to what `Intl` prints and note it; no other behaviour depends on it.

- [ ] **Step 3: Add i18n keys.** EN via the Edit tool, inserted immediately after the line `  budgetReportTitle: "Budget Report",` in `src/app/i18n.ts`. DE via Node, inserted after `  budgetReportTitle: "Budgetbericht",\r\n` in `src/app/i18n.de.ts`:

```js
// scratch/add-forecast-de.mjs — run with node, then delete the scratch file
import { readFileSync, writeFileSync } from "node:fs";
const p = "src/app/i18n.de.ts";
const s = readFileSync(p, "utf8");
const anchor = '  budgetReportTitle: "Budgetbericht",\r\n';
if (s.split(anchor).length !== 2) throw new Error("anchor not unique");
const lines = [ /* each DE line from the table below, as `  key: "text",` */ ];
writeFileSync(p, s.replace(anchor, anchor + lines.map((l) => l + "\r\n").join("")), "utf8");
```

| Key | EN | DE |
|---|---|---|
| `forecastTitle` | Forecast | Prognose |
| `forecastWhatIs` | What is {0}? | Was ist {0}? |
| `forecastFactBac` | Budget at completion (BAC) | Budget bei Fertigstellung (BAC) |
| `forecastFactAc` | Actual cost (AC) | Ist-Kosten (AC) |
| `forecastFactRemaining` | Remaining budget | Restbudget |
| `forecastFactEv` | Earned value (EV) | Erarbeiteter Wert (EV) |
| `forecastPaceTitle` | At current pace | Beim aktuellen Tempo |
| `forecastPaceQuestion` | Where do we land if spending continues as in the last {0} working days? | Wo landen wir, wenn die Ausgaben so weitergehen wie in den letzten {0} Arbeitstagen? |
| `forecastEfficiencyTitle` | At current efficiency | Bei aktueller Effizienz |
| `forecastEfficiencyQuestion` | Where do we land if the remaining work costs what the work so far cost? | Wo landen wir, wenn die restliche Arbeit so viel kostet wie die bisherige? |
| `forecastEacPace` | EAC at current pace | EAC beim aktuellen Tempo |
| `forecastEacEfficiency` | EAC at current efficiency | EAC bei aktueller Effizienz |
| `forecastVacPace` | VAC at current pace | VAC beim aktuellen Tempo |
| `forecastVacEfficiency` | VAC at current efficiency | VAC bei aktueller Effizienz |
| `forecastEtcPace` | ETC at current pace | ETC beim aktuellen Tempo |
| `forecastEtcEfficiency` | ETC at current efficiency | ETC bei aktueller Effizienz |
| `forecastBurnRate` | Burn rate | Verbrauchsrate |
| `forecastPerDay` | {0}/day | {0}/Tag |
| `forecastRunOut` | Budget runs out | Budget aufgebraucht |
| `forecastRunOutBefore` | {0}, {1} days before plan end | {0}, {1} Tage vor Planende |
| `forecastRunOutAfter` | {0}, {1} days after plan end | {0}, {1} Tage nach Planende |
| `forecastRunOutOnEnd` | {0}, on the plan end | {0}, am Planende |
| `forecastRunOutAlready` | Already used up | Bereits aufgebraucht |
| `forecastCpi` | CPI | CPI |
| `forecastSpi` | SPI | SPI |
| `forecastNeeds` | Needs | Benötigt |
| `forecastPaceNotEnough` | Not enough recent bookings | Nicht genug aktuelle Buchungen |
| `forecastPaceNoBurn` | No recent bookings | Keine aktuellen Buchungen |
| `forecastEfficiencyNeedsPercent` | Needs linked tasks or a % complete | Benötigt verknüpfte Aufgaben oder einen Fertigstellungsgrad |
| `forecastEfficiencyNoCost` | Nothing spent yet | Noch nichts ausgegeben |
| `forecastEfficiencyNoEarned` | Nothing earned yet | Noch nichts erarbeitet |
| `forecastFixedPriceNote` | Fixed price: the overrun is internal effort; the client price does not change. | Festpreis: Die Überschreitung ist interner Aufwand; der Kundenpreis ändert sich nicht. |
| `forecastWindowLine` | Burn rate from {0} – {1} ({2} working days) | Verbrauchsrate aus {0} – {1} ({2} Arbeitstage) |
| `forecastGapInfo` | The two forecasts differ by {0} ({1} of the budget). | Die beiden Prognosen unterscheiden sich um {0} ({1} des Budgets). |
| `forecastGapWarning` | Warning: the two forecasts differ by {0} ({1} of the budget). | Warnung: Die beiden Prognosen unterscheiden sich um {0} ({1} des Budgets). |
| `forecastExtraDaysTerm` | Extra working days | Zusätzliche Arbeitstage |
| `forecastGapExtraDays` | At current efficiency the work needs {0} working days beyond the planned end; the pace forecast assumes it finishes on time. | Bei aktueller Effizienz braucht die Arbeit {0} Arbeitstage über das geplante Ende hinaus; die Tempo-Prognose nimmt an, dass sie pünktlich fertig wird. |
| `forecastBannerStartsOn` | The current-pace forecast starts on {0}. It needs {1} working days of bookings; there are {2} so far, starting {3}. | Die Tempo-Prognose beginnt am {0}. Sie braucht {1} Arbeitstage mit Buchungen; bisher sind es {2}, beginnend am {3}. |
| `forecastBannerStartsOnceBooked` | The current-pace forecast starts once hours are booked. It needs {0} working days of bookings. | Die Tempo-Prognose beginnt, sobald Stunden gebucht sind. Sie braucht {0} Arbeitstage mit Buchungen. |
| `forecastBannerNoBurn` | No hours were booked in the last {0} working days ({1} – {2}), so there is no current-pace forecast. | In den letzten {0} Arbeitstagen ({1} – {2}) wurden keine Stunden gebucht, daher gibt es keine Tempo-Prognose. |
| `forecastBannerLastBooking` | Last booking: {0}. | Letzte Buchung: {0}. |
| `forecastBannerSpreadMonth` | Part of the burn rate comes from hours entered per month. They were spread evenly over that month's working days. | Ein Teil der Verbrauchsrate stammt aus monatlich erfassten Stunden. Sie wurden gleichmäßig auf die Arbeitstage des Monats verteilt. |
| `forecastBannerSpreadWeek` | Part of the burn rate comes from hours entered per week. They were spread evenly over that week's working days. | Ein Teil der Verbrauchsrate stammt aus wöchentlich erfassten Stunden. Sie wurden gleichmäßig auf die Arbeitstage der Woche verteilt. |
| `forecastBannerNeedsPercent` | The current-efficiency forecast needs a % complete on every budget bucket. Missing: {0}. | Die Effizienz-Prognose braucht einen Fertigstellungsgrad für jeden Budgetposten. Es fehlt: {0}. |
| `forecastShortStartsOn` | Pace forecast from {0} | Tempo-Prognose ab {0} |
| `forecastShortOnceBooked` | Pace forecast starts once hours are booked | Tempo-Prognose beginnt, sobald Stunden gebucht sind |
| `forecastShortNoBurn` | No recent bookings | Keine aktuellen Buchungen |
| `forecastShortSpread` | Burn rate partly from hours entered per period | Verbrauchsrate teils aus periodenweise erfassten Stunden |
| `forecastShortNeedsPercent` | Efficiency forecast needs a % complete | Effizienz-Prognose braucht einen Fertigstellungsgrad |
| `forecastTileRange` | EAC {0}–{1} · VAC {2} to {3} | EAC {0}–{1} · VAC {2} bis {3} |
| `forecastTileSingle` | EAC {0} · VAC {1} | EAC {0} · VAC {1} |
| `forecastTileRunsOut` | runs out {0} | aufgebraucht am {0} |
| `forecastTileActuals` | Actuals {0} of {1} | Ist {0} von {1} |
| `forecastLinkRange` | Forecast: EAC {0}–{1} | Prognose: EAC {0}–{1} |
| `forecastLinkSingle` | Forecast: EAC {0} | Prognose: EAC {0} |
| `forecastLinkStartsOn` | Forecast from {0} | Prognose ab {0} |
| `forecastLinkOnceBooked` | Forecast starts once hours are booked | Prognose beginnt, sobald Stunden gebucht sind |
| `forecastLinkNoBurn` | No recent bookings | Keine aktuellen Buchungen |
| `forecastTipBac` | Budget at completion: the total budget of all buckets, {0}. Every forecast is compared against it. | Budget bei Fertigstellung: das Gesamtbudget aller Budgetposten, {0}. Jede Prognose wird damit verglichen. |
| `forecastTipAc` | Actual cost: the contract value of the hours booked so far, {0}. Fixed-price buckets count their share of the contract without the cap, so an overrun shows. | Ist-Kosten: der Vertragswert der bisher gebuchten Stunden, {0}. Festpreis-Posten zählen ihren Anteil am Vertrag ohne Deckelung, damit eine Überschreitung sichtbar wird. |
| `forecastTipRemaining` | Remaining budget: budget {0} − actual cost {1} = {2}. | Restbudget: Budget {0} − Ist-Kosten {1} = {2}. |
| `forecastTipEv` | Earned value: each bucket's budget times its % complete, summed: {0} ({1} complete). Above the actual cost means the work done is worth more than it cost. | Erarbeiteter Wert: Budget jedes Postens mal Fertigstellungsgrad, summiert: {0} ({1} fertig). Über den Ist-Kosten heißt: Die geleistete Arbeit ist mehr wert, als sie gekostet hat. |
| `forecastTipPace` | Assumes spending continues at the rate of the last {0} working days until the planned end. | Nimmt an, dass die Ausgaben bis zum geplanten Ende im Tempo der letzten {0} Arbeitstage weitergehen. |
| `forecastTipEfficiency` | Assumes the remaining work costs what the work so far cost per unit of earned value (CPI). | Nimmt an, dass die restliche Arbeit je erarbeitetem Wert so viel kostet wie bisher (CPI). |
| `forecastTipEac` | Estimate at completion: actual cost {0} + ETC {1} = {2}. Above the budget means an overrun. | Schätzung bei Fertigstellung: Ist-Kosten {0} + ETC {1} = {2}. Über dem Budget heißt: Überschreitung. |
| `forecastTipVac` | Variance at completion: budget {0} − EAC {1} = {2}. Negative means over budget. | Abweichung bei Fertigstellung: Budget {0} − EAC {1} = {2}. Negativ heißt: über Budget. |
| `forecastTipEtcPace` | Estimate to complete: burn rate {0} × {1} working days left = {2}. | Restkostenschätzung: Verbrauchsrate {0} × {1} verbleibende Arbeitstage = {2}. |
| `forecastTipEtcEfficiency` | Estimate to complete: (budget {0} − earned value {1}) ÷ CPI {2} = {3}. | Restkostenschätzung: (Budget {0} − erarbeiteter Wert {1}) ÷ CPI {2} = {3}. |
| `forecastTipCpi` | Cost performance index: earned value {0} ÷ actual cost {1} = {2}. Below 1 means each euro spent earns less than a euro of planned work. | Kostenleistungsindex: erarbeiteter Wert {0} ÷ Ist-Kosten {1} = {2}. Unter 1 heißt: Jeder ausgegebene Euro erarbeitet weniger als einen Euro geplanter Arbeit. |
| `forecastTipSpi` | Schedule performance index: earned value {0} ÷ planned value {1} = {2}. Below 1 means behind the planned schedule. | Terminleistungsindex: erarbeiteter Wert {0} ÷ Planwert {1} = {2}. Unter 1 heißt: hinter dem Zeitplan. |
| `forecastTipBurnRate` | Average value booked per working day: {0} over the last {1} working days = {2} per day. | Durchschnittlich gebuchter Wert je Arbeitstag: {0} in den letzten {1} Arbeitstagen = {2} pro Tag. |
| `forecastTipRunOut` | The working day on which the remaining budget {0} is used up at {1} per day. Before the plan end means the budget runs out early. | Der Arbeitstag, an dem das Restbudget {0} bei {1} pro Tag aufgebraucht ist. Vor dem Planende heißt: Das Budget reicht nicht bis zum Ende. |
| `forecastTipNeeds` | The efficiency forecast needs a % complete on every bucket with a budget: link tasks to the bucket or enter a % complete on it. | Die Effizienz-Prognose braucht einen Fertigstellungsgrad für jeden Posten mit Budget: Aufgaben verknüpfen oder einen Fertigstellungsgrad eintragen. |
| `forecastTipExtraDays` | At current efficiency the remaining work needs ETC {0} ÷ burn rate {1} = {2} working days, {3} more than are left before the plan end. | Bei aktueller Effizienz braucht die restliche Arbeit ETC {0} ÷ Verbrauchsrate {1} = {2} Arbeitstage, {3} mehr als bis zum Planende bleiben. |

Write straight ASCII double quotes around each DE value, like the neighbouring lines (an apostrophe inside a value is fine); re-read the inserted block with the Read tool and confirm the umlauts render. Task 6's guard test must stay green on these keys: the only bare CPI/SPI are in its allowlist.

- [ ] **Step 4: Run** `npx vitest run src/app/forecast-format.test.ts src/app/i18n-encoding.test.ts` (use the real encoding test name from `git ls-files "src/app/*encoding*"`), `npx tsc --noEmit` (key parity). Expect PASS.

- [ ] **Step 5: Gates and commit**

```bash
npx eslint --max-warnings=0 src/app/forecast-format.ts src/app/forecast-format.test.ts src/app/i18n.ts; echo "EXIT=$?"
git add src/app/forecast-format.ts src/app/forecast-format.test.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(budget): forecast formatters and EN/DE forecast strings" -m "Claude-Session: https://[session link removed]"
```

---

### Task 5: Budget report — facts row, forecast cards, banner, section order

**Files:**
- Create: `src/app/budget-forecast-facts.tsx`, `src/app/budget-forecast-cards.tsx`, `src/app/budget-forecast-banner.tsx` and a test for each
- Modify: `src/app/budget-report-panel.tsx`, `src/app/budget-report-panel.test.tsx`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:

```tsx
export function ForecastFactsRow(props: { lang: Lang; forecast: BudgetForecast }): JSX.Element;
export function ForecastCards(props: { lang: Lang; forecast: BudgetForecast }): JSX.Element;
export function ForecastBanners(props: { lang: Lang; forecast: BudgetForecast; granularity: PlanGranularity }): JSX.Element | null;
/** Full banner sentence for one notice. */
export function forecastNoticeText(n: ForecastNotice, lang: Lang, granularity: PlanGranularity): string;
/** One-line tile form (§6.3). */
export function forecastNoticeShortText(n: ForecastNotice, lang: Lang): string;
```

Rendering rules (every figure via `formatCurrency(n, "EUR", localeFor(lang))` from `./resource-cost`, dates via `formatDayMonthYear`/`formatDayMonth`, percentages via `formatSignedPercent`; CPI/SPI `toFixed(2)`):

- **Facts row** — a `grid grid-cols-2 gap-3 sm:grid-cols-4` of four `Tile`s at the TOP of the "Project total" `Section`, before the existing tiles: BAC, AC, Remaining, EV (EV value `"—"` when `ev === null`, else `money (pct%)` with `percentComplete.toFixed(0)`). Each label is `<>{term}<span className="print:hidden ml-1"><InfoTooltip text={tip} label={t(lang,"forecastWhatIs", term)} /></span></>` with tips `forecastTipBac`/`Ac`/`Remaining`/`Ev` filled with the project's numbers.
- **Cards** — `<div className="grid gap-3 sm:grid-cols-2">` with two `<section aria-labelledby>` cards (`rounded-lg border border-line bg-surface p-3`). Each: `<h3>` title with its method tooltip (`forecastTipPace` with `{0}` = window size, `forecastTipEfficiency`), a muted question line, the EAC as the large figure (`text-2xl font-semibold`) labelled by `forecastEacPace`/`forecastEacEfficiency` with `forecastTipEac`, then a `<dl>`: VAC (`money (signed %)`, `forecastTipVac`), ETC (`forecastTipEtcPace` / `forecastTipEtcEfficiency`), then pace: burn rate (`forecastPerDay`, `forecastTipBurnRate`) + run-out (`forecastRunOutBefore`/`After`/`OnEnd`/`Already`, `forecastTipRunOut`; days as absolute value); efficiency: CPI (`forecastTipCpi`) + SPI (`forecastTipSpi`, `"—"` when null). Under the pace card, when available, a muted `forecastWindowLine` (`formatDayMonth` for both ends, window size). Unavailable card body: the reason text (`forecastPaceNotEnough`, `forecastPaceNoBurn`, `forecastEfficiencyNeedsPercent` + a `forecastNeeds` term tooltip with `forecastTipNeeds`, `forecastEfficiencyNoCost`, `forecastEfficiencyNoEarned`). When `hasFixedPrice`, each card ends with `forecastFixedPriceNote`.
- **Gap line** — below the cards when `gap` is non-null: `forecastGapInfo` in a plain `<p className="text-sm">` or `forecastGapWarning` in `<p role="status" className="text-sm font-medium">` (the "Warning:" prefix is inside the translated string, so the state is not colour-only). When `extraWorkingDays` is non-null, append a space and `forecastGapExtraDays` with that number, followed by `<InfoTooltip text={forecastTipExtraDays filled} label={t(lang, "forecastWhatIs", t(lang, "forecastExtraDaysTerm"))} />`.
- **Banners** — `forecastNotices(forecast).map(n => <Banner key={n.kind} severity={n.severity}>{forecastNoticeText(n, lang, granularity)}</Banner>)` in a `space-y-2` wrapper; `null` when the list is empty. Texts: `starts-on` → `forecastBannerStartsOn(formatDayMonthYear(availableFrom), 20, bookedWorkingDays, formatDayMonth(firstBookingDate))`; `starts-once-booked` → `forecastBannerStartsOnceBooked(20)`; `no-burn` → `forecastBannerNoBurn(20, formatDayMonth(windowStart), formatDayMonth(windowEnd))` + (lastBookingDate ? " " + `forecastBannerLastBooking(formatDayMonth(lastBookingDate))` : ""); `spread` → month/week key by granularity; `needs-percent` → names joined with ", ". The 20 is `BURN_RATE_WINDOW_WORKING_DAYS`. Short texts: `forecastShortStartsOn(formatDayMonthYear(availableFrom))`, `forecastShortOnceBooked`, `forecastShortNoBurn`, `forecastShortSpread`, `forecastShortNeedsPercent`.
- **Panel** — in `BudgetReportPanel` add `const forecast = useMemo(() => computeBudgetForecast({ report, buckets, roles, fxRates, tasks, plan, burndown, holidaySet, today }), [...])` BEFORE the empty-state return. New section order: Project total (facts row first) → `<Section title={t(lang,"forecastTitle")}>` with `ForecastBanners` then `ForecastCards` → Burn-down → `BucketDetailTable` → the existing EVM section moved to the end (unchanged in this task).

- [ ] **Step 1: Component tests first.** Build `BudgetForecast` literals (the §5.6 figures) and assert, in `"en-US"`:
  - facts row shows `€240,000`, `€168,000`, `€72,000`, `€148,800 (62%)`; `"—"` for EV when null;
  - pace card: `€261,150`, `-€21,150 (-8.8%)` (derive the exact string with the same helpers inside the test), `€1,350/day`, `Nov 27, 2026, 21 days before plan end`, window line `Burn rate from Aug 17 – Sep 11 (20 working days)`;
  - efficiency card: `0.89`, `0.85`, `€270,968`;
  - every unavailable state renders its text; `no-actual-cost` and `no-earned-value` render no `role="status"` banner;
  - fixed-price note appears twice when `hasFixedPrice`;
  - gap info is a `<p>` without `role`; warning has `role="status"` and starts with `Warning:`; extra days hidden when `extraWorkingDays` is null;
  - **tooltip names unique**: collect `aria-label` of every `[data-info-tooltip-trigger]` in the rendered forecast section and facts row, `expect(new Set(labels).size).toBe(labels.length)`;
  - **label-in-name**: each card figure's tooltip label contains the visible term (`What is EAC at current pace?` contains `EAC at current pace`);
  - banners: each notice kind renders its sentence and severity (`Banner` exposes severity via its class; assert `role="status"` and the text); two notices stack in order; empty list renders nothing;
  - `forecastNoticeShortText` for each kind;
  - one DE render (`loadI18n("de")` in `beforeAll`) of the banner `starts-on` sentence.
  - Panel test (`budget-report-panel.test.tsx`): headings appear in the order Project total, Forecast, Burn-down, By bucket, Earned value (read `getAllByRole("heading")` text order; use the real `Section` heading level).

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement the three components and the panel wiring. Step 4: Run, expect PASS.**

- [ ] **Step 5: Mutation-check** the unique-name test (give two tooltips the same label → red) and the warning role (drop `role` → red). Revert.

- [ ] **Step 6: Gates and commit** — size check the panel (`node -e "console.log(require('fs').readFileSync('src/app/budget-report-panel.tsx','utf8').split('\n').length)"`), tsc, eslint on every touched file, then:

```bash
git add src/app/budget-forecast-facts.tsx src/app/budget-forecast-facts.test.tsx src/app/budget-forecast-cards.tsx src/app/budget-forecast-cards.test.tsx src/app/budget-forecast-banner.tsx src/app/budget-forecast-banner.test.tsx src/app/budget-report-panel.tsx src/app/budget-report-panel.test.tsx
git commit -m "feat(budget-report): facts row, forecast cards, transparency banners" -m "Claude-Session: https://[session link removed]"
```

---

### Task 6: Effort renames and the CPI/SPI label guard

**Files:**
- Create: `src/app/i18n-cpi-labels.test.ts`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`, `src/app/budget-panel.tsx`, `src/app/budget-panel.test.tsx`, plus any file the guard or grep names

**Interfaces:**
- Produces: key `budgetCciInternalCostIndex` / `budgetCciInternalCostIndexHint` (old pair removed).

- [ ] **Step 1: Write the guard test**

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { en, loadI18n } from "./i18n"; // use the real exported EN dictionary name

// Spec §11 "Three indices, one word": after MR 2 a bare CPI/SPI label means the
// price-based forecast index. Every other user-visible CPI/SPI is the task-effort
// index and must say so. Allowlist = forecast keys that really are price-based.
const PRICE_BASED = new Set(["forecastCpi", "forecastSpi", "forecastTipCpi", "forecastTipSpi", "forecastTipEfficiency", "forecastTipEtcEfficiency"]);

describe("CPI/SPI labels", () => {
  let de: Record<string, string>;
  beforeAll(async () => { de = (await loadI18n("de")) as Record<string, string>; });

  it("EN: every CPI/SPI outside the forecast is qualified as effort", () => {
    const bad = Object.entries(en).filter(([k, v]) => !PRICE_BASED.has(k) && /(?<![Ee]ffort )\b(CPI|SPI)\b/.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("DE: every CPI/SPI outside the forecast is qualified as Aufwand", () => {
    const bad = Object.entries(de).filter(([k, v]) => !PRICE_BASED.has(k) && /(?<!Aufwands-)\b(CPI|SPI)\b/.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
  });
});
```

Read `i18n.ts` / `loadI18n` for the real export names and return shape and adapt the two access lines only.

- [ ] **Step 2: Run, expect FAIL** listing today's keys (`evmCpi`, `evmSpi`, `evmCpiHint`?, `trendKpiCpi`, `trendKpiSpi`, `actionBudgetWhy*`, `actionScheduleWhy*`, `naScheduleSpi*`, `aiPromptBudCpiLabel`, `dashboardHealthHelp`, `helpConceptBudgetBody`, `helpWorkflowBudgetBody`, `helpAutomatedHealthBody`, …). Record the list in the report.

- [ ] **Step 3: Verify each hit reads the effort engine** before renaming: `trendKpi*` (grep the trends snapshot field feeding `TrendChart`), `actionBudgetWhy*` (`next-actions/providers/budget.ts` reads `dashboard.evm.cpi` — effort), `actionScheduleWhy*` (`providers/schedule.ts`), `naScheduleSpi*` (thresholds for that provider), `aiPromptBudCpiLabel` (prompt chip text). A hit that reads something else goes in the report as a finding and is not renamed.

- [ ] **Step 4: Apply the texts.** Short keys (EN / DE):

| Key | EN | DE |
|---|---|---|
| `evmTitle` | Earned value · effort | Earned Value · Aufwand |
| `evmCpi` | Effort CPI | Aufwands-CPI |
| `evmSpi` | Effort SPI | Aufwands-SPI |
| `evmCpiHint` | Effort cost performance index = estimated effort of completed tasks ÷ time booked on tasks. Above 1 means tasks take less effort than estimated. Not the forecast's price-based index. | Aufwands-Kostenleistungsindex = geschätzter Aufwand erledigter Aufgaben ÷ auf Aufgaben gebuchte Zeit. Über 1 heißt: Aufgaben brauchen weniger Aufwand als geschätzt. Nicht der preisbasierte Index der Prognose. |
| `evmSpiHint` | Effort schedule performance index = estimated effort of completed tasks ÷ estimated effort of tasks due by today. Above 1 means ahead of schedule. | Aufwands-Terminleistungsindex = geschätzter Aufwand erledigter Aufgaben ÷ geschätzter Aufwand der bis heute fälligen Aufgaben. Über 1 heißt: vor dem Zeitplan. |
| `trendKpiCpi` / `trendKpiSpi` | Effort CPI / Effort SPI | Aufwands-CPI / Aufwands-SPI |
| `naScheduleSpiWarn` | Schedule: Effort SPI — warn below | Termin: Aufwands-SPI — warnen unter |
| `naScheduleSpiCritical` | Schedule: Effort SPI — critical below | Termin: Aufwands-SPI — kritisch unter |
| `naScheduleSpiCriticalHint` | Escalate the schedule action to critical when the Effort SPI drops below this. | Die Terminaktion auf kritisch hochstufen, wenn der Aufwands-SPI unter diesen Wert fällt. |
| `aiPromptBudCpiLabel` | On track? (Effort CPI) | Im Plan? (Aufwands-CPI) |
| `budgetCciInternalCostIndex` (replaces `budgetCciRecovery`) | Internal cost index | Interner Kostenindex |
| `budgetCciInternalCostIndexHint` (replaces `budgetCciRecoveryHint`) | Earned value ÷ actual cost, both at internal rates. 100% or above means the work delivered so far is worth at least what it cost internally. Needs linked tasks or a manual % complete on the bucket. Not the forecast's price-based index. | Erarbeiteter Wert ÷ tatsächliche Kosten, beide zu internen Sätzen. 100 % oder mehr bedeutet, dass die bisher gelieferte Arbeit mindestens so viel wert ist, wie sie intern gekostet hat. Benötigt verknüpfte Aufgaben oder einen manuellen Fertigstellungsgrad am Budgetposten. Nicht der preisbasierte Index der Prognose. |

`actionBudgetWhy*` / `actionScheduleWhy*`: replace the leading `CPI {0}` / `SPI {0}` with `Effort CPI {0}` / `Effort SPI {0}` (DE `Aufwands-CPI {0}` / `Aufwands-SPI {0}`), keeping the rest verbatim. `budgetCciBurnHint`: "see Cost recovery" → "see Internal cost index" (DE "siehe Kostendeckung" → "siehe Interner Kostenindex"). Long help texts: read each, qualify every CPI/SPI that means the task-effort index, change nothing else; the budget-RAG sentence in `dashboardHealthHelp` is Task 7's.

DE edits are ONE Node script with a list of `[oldLine, newLine]` pairs, each matched as a whole `\r\n`-terminated line and asserted to occur exactly once before any write; print the count replaced.

- [ ] **Step 5: Code and tests.** Rename the two `budget-panel.tsx` call sites and its `cpiCciValue` docstring; migrate `budget-panel.test.tsx` (the `/Cost recovery/` count → `/Internal cost index/`, `recoveryLabel` key, the "renamed … at BOTH of its sites" test to the new key). `git grep -n "budgetCciRecovery" -- src e2e` must return nothing.

- [ ] **Step 6: Run** `npx vitest run src/app/i18n-cpi-labels.test.ts src/app/budget-panel.test.tsx src/app/budget-report-panel.test.tsx src/app/dashboard-panel.test.tsx` plus every test file `git grep -ln "Cost recovery\|evmCpi\|evmSpi\|trendKpi\|actionBudgetWhy\|actionScheduleWhy\|naScheduleSpi\|aiPromptBudCpiLabel" -- "src/**/*.test.*"` names (one vitest run, all files). Expect PASS. Mutation: restore `evmCpi` to "CPI" → guard red; revert.

- [ ] **Step 7: Gates and commit** — tsc, eslint touched files, `npm run docs:symbols:check; echo "EXIT=$?"` (a doc may name `budgetCciRecovery`; fix the doc, never the allowlist).

```bash
git add <each touched path>
git commit -m "feat(budget): effort CPI/SPI and internal cost index renames on every surface" -m "Claude-Session: https://[session link removed]"
```

---

### Task 7: Dashboard "Budget burn" tile — headline, RAG from pace, height

**Files:**
- Create: `src/app/budget-forecast-headline.tsx`, `src/app/budget-forecast-headline.test.tsx`
- Modify: `src/app/dashboard.ts`, `src/app/dashboard-tiles.ts`, `src/app/dashboard-tile-bodies.tsx`, `src/app/dashboard-layout.test.ts`, `src/app/dashboard.test.ts` (real name via `git ls-files "src/app/dashboard*.test.*"`), `src/app/i18n.ts`, `src/app/i18n.de.ts`

**Interfaces:**
- Consumes: `computeBudgetForecast`, `paceVacHealth`, `isPaceAvailable`, `isEfficiencyAvailable` (Tasks 2–3); `forecastNotices` (Task 3); `forecastNoticeShortText` (Task 5); formatters (Task 4).
- Produces: `DashboardModel.forecast: BudgetForecast | null`; `export function forecastHeadlineText(f: BudgetForecast, lang: Lang): string`; `export function ForecastHeadline(props: { lang: Lang; forecast: BudgetForecast }): JSX.Element`.

- [ ] **Step 1: Headline tests** (`"en-US"`, literals derived with the Task 4 helpers inside the test):
  - both available (§5.6 figures) → `EAC €261K–€271K · VAC -9% to -13% · runs out Nov 27` (order by EAC ascending, VAC percents follow their EAC, `formatSignedPercent(vac/bac, locale, 0)`, run-out `formatDayMonth`; omit the run-out part when `runOutDate` is null);
  - efficiency unavailable → `EAC €261K · VAC -9% · runs out Nov 27`;
  - pace unavailable → `Actuals €168K of €240K`;
  - with a notice, `ForecastHeadline` renders a second muted line = `forecastNoticeShortText(first notice)`; without, no second line.

- [ ] **Step 2: Implement** `forecastHeadlineText` (joins parts with ` · `; uses `forecastTileRange`/`forecastTileSingle`/`forecastTileRunsOut`/`forecastTileActuals`) and `ForecastHeadline` (`<p className="text-sm font-semibold">` + optional `<p className="text-xs text-muted-foreground">`).

- [ ] **Step 3: Dashboard model** — in `computeDashboard`: keep the full report (`const report = … computeBudgetReport(…)`; `project = report?.project ?? null`), compute `burndown` before the RAG, then

```ts
  const forecast: BudgetForecast | null = report && burndown
    ? computeBudgetForecast({ report, buckets: input.budgets, roles: input.roles, fxRates: input.fxRates, tasks: input.tasks, plan: input.plan, burndown, holidaySet, today })
    : null;
  // The budget RAG reads the pace VAC once the pace forecast exists (spec §6.3);
  // before that the consumed-vs-budget ratio stays the signal. Effort CPI stays in the worst-of.
  const budgetBucketStatus = forecast && isPaceAvailable(forecast.pace)
    ? paceVacHealth(forecast.pace.vac, forecast.facts.bac)
    : computeBudgetStatus(project, amberRatio);
  const budgetComputed = worstHealth(budgetBucketStatus, evmIndexHealth(evm.cpi));
```

Add `forecast` to `DashboardModel` and the returned object. If `worstHealth` does not accept `"G"`, map to the type `computeBudgetStatus` returns.

- [ ] **Step 4: Dashboard tests** — a model with ≥ 20 working days of dated bookings whose pace VAC is −15 % of BAC reads budget `R`; the same buckets with no bookings fall back to the ratio rule (existing assertions stay green); pace VAC ≥ 0 reads `G` even when consumed/budget ≥ 0.9.

- [ ] **Step 5: Tile** — in `dashboard-tile-bodies.tsx` `burn:` body, render `{model.forecast ? <ForecastHeadline lang={lang} forecast={model.forecast} /> : null}` first. Catalogue `burn`: `h: 3, minH: 3, maxH: 4`. Update `dashboard-layout.test.ts` fixtures and the `restoreTile` expectation to `h: 3`; run `dashboard-grid.test.tsx` too. Update `dashboardHealthHelp` (EN + DE) budget sentence to say the budget signal is the current-pace VAC once 20 working days are booked (Amber below 0, Red at −10 % of the budget), otherwise the spend ratio.

- [ ] **Step 6: Run** headline, dashboard, dashboard-layout, dashboard-grid, dashboard-tile-bodies (if it exists), `i18n-cpi-labels` tests in one vitest run. Mutation: replace the pace branch with `computeBudgetStatus` → the `R` test fails; revert.

- [ ] **Step 7: Gates and commit** (tsc, eslint touched files, named `git add`).

```bash
git commit -m "feat(dashboard): budget burn tile shows the forecast headline and rates budget by pace VAC" -m "Claude-Session: https://[session link removed]"
```

---

### Task 8: Budget view link line

**Files:**
- Create: `src/app/budget-forecast-link.tsx`, `src/app/budget-forecast-link.test.tsx`
- Modify: `src/app/budget-panel.tsx`, `src/app/budget-panel.test.tsx`, `src/app/workspace-section.tsx`

**Interfaces:**
- Consumes: `computeProjectForecast` (Task 3), formatters (Task 4), `TextButton` (`./text-button`).
- Produces: `BudgetPanelProps.onOpenBudgetReport?: () => void`; `export function forecastLinkText(f: BudgetForecast, lang: Lang): string`; `export function BudgetForecastLink(props: { lang: Lang; forecast: BudgetForecast; onOpen: () => void }): JSX.Element`.

- [ ] **Step 1: Tests**
  - `forecastLinkText`: both → `Forecast: EAC €261K–€271K`; efficiency unavailable → `Forecast: EAC €261K`; `not-enough-bookings` with `availableFrom` → `Forecast from Oct 13, 2026`; nothing booked → `Forecast starts once hours are booked`; `no-burn` → `No recent bookings`.
  - `BudgetForecastLink` renders the text and a `TextButton` named `Budget Report` (EN `budgetReportTitle`); clicking calls `onOpen` once. The arrow `→` sits in an `aria-hidden` span.
  - `BudgetPanel`: with `onOpenBudgetReport` and buckets, the link renders; without the prop (popout), it does not.

- [ ] **Step 2: Implement** — `BudgetForecastLink` is `<p className="mb-2 flex flex-wrap items-center gap-2 text-sm">{text}<span aria-hidden="true">→</span><TextButton onClick={onOpen}>{t(lang, "budgetReportTitle")}</TextButton></p>`. In `BudgetPanel`: `const forecast = useMemo(() => computeProjectForecast({ buckets, plan, roles, resources, workdayHours, holidaySet, absences, tasks: tasks ?? [], fxRates, today }), [...])`, hoisting any `props.x` deps to locals; render `{onOpenBudgetReport && forecast && <BudgetForecastLink … />}` directly after the `BudgetUnappliedNotice` block. In `workspace-section.tsx` pass `onOpenBudgetReport={isPopout ? undefined : () => setActiveTab("budget-report")}`.

- [ ] **Step 3: Run** the link, budget-panel and workspace-section tests (one run). Gates: tsc, eslint touched files, size of `budget-panel.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/app/budget-forecast-link.tsx src/app/budget-forecast-link.test.tsx src/app/budget-panel.tsx src/app/budget-panel.test.tsx src/app/workspace-section.tsx
git commit -m "feat(budget): forecast link line above the bucket cards" -m "Claude-Session: https://[session link removed]"
```

---

### Task 9: Docs and register

**Files:**
- Modify: `docs/open-followups.md`, `docs/AGENTS/integrations.md`, `docs/AGENTS/dashboard.md`, `docs/superpowers/specs/2026-09-14-budget-forecast-union-design.md`

- [ ] **Step 1: Register.** Mirror §169's closed form exactly (heading suffix `— CLOSED 2026-09-15`, `**Status:** CLOSED …` first paragraph citing the pinning tests, OPEN-era text kept, `**Work item:**` line removed, index row updated to `**CLOSED** 2026-09-15` with the anchor re-derived — " — " becomes `--`).
  - §499 closes: `budget-forecast.ts` computes ETC, EAC and VAC for both methods; cite `budget-forecast.test.ts` "spec §5.6 acceptance fixture" and the surfaces (Budget report cards, dashboard tile headline, Budget view link line).
  - §543 closes: cite the three `timelog-apply.test.ts` tests from Task 0 and the mutation check.
  - §501 stays OPEN: new Status line dated 2026-09-15 with a backticked `grep -n "forecastFactBac\|evmCpi" src/app/i18n.ts` showing BAC/EAC/ETC labels and the effort qualifier exist; the S-curve remains for MR 3.
  - §504 stays OPEN: Status line dated 2026-09-15; remove the "URL supplied truncated" claim and state the forecast line is MR 3 (keep a backticked `grep -rln "computeBurndownSeries" src/app` command).
  - Run `npm run followups:index:check; echo "EXIT=$?"`, `npm run followups:status:check; echo "EXIT=$?"`, `npm run followups:workitems:check; echo "EXIT=$?"`. Exit 2 means the gate could not scan — investigate, do not retry blindly.
- [ ] **Step 2: `docs/AGENTS/integrations.md`** Timelog section: one ★ paragraph — a dated Apply also removes a bare period key of the other granularity that contains a routed day (§543), so a hand-typed month total overlapping a weekly Apply is gone after it.
- [ ] **Step 3: `docs/AGENTS/dashboard.md`**: one paragraph on the `burn` tile — headline from `forecastHeadlineText`, first notice as a muted line, budget RAG from `paceVacHealth` once the pace forecast exists (else `computeBudgetStatus`), effort CPI still in the worst-of, tile `minH` 3.
- [ ] **Step 4: Spec** — add Rulings 5, 7, 10, 13 as a dated "Plan corrections (2026-09-15)" note under §5/§6 so the spec and the plan agree (`no-earned-value` state, `workingDaysLeft` field, RAG thresholds, locale formats, tile `maxH` 4).
- [ ] **Step 5: Gates** — `npm run docs:symbols:check; echo "EXIT=$?"`, `npm run docs:claims:check; echo "EXIT=$?"`, `npm run size:check; echo "EXIT=$?"`.
- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md docs/AGENTS/integrations.md docs/AGENTS/dashboard.md docs/superpowers/specs/2026-09-14-budget-forecast-union-design.md
git commit -m "docs: close §499 and §543, update §501 and §504, document the forecast" -m "Claude-Session: https://[session link removed]"
```

Before any push (user-gated): axe on the changed views, one invocation, serial — `npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 -g "Budget|Reports|Dashboard"`; check that the "Reports" scan actually lands on the Budget report (read the spec's navigation for that view) and note the answer. The full unit suite runs only on the user's say.
