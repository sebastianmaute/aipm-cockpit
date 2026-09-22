# Forecast Chart, Hours Forecast and Rate-Mix Signal (MR 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Renamed since this plan was written:** the bundle module `budget-forecasts.ts` (with its test)
> shipped as **`budget-forecast-bundle.ts`** — one character from `budget-forecast.ts` was a footgun
> in imports and greps. Its exports (`computeForecastBundle`, `ForecastBundle`, `ForecastBundleInput`)
> are unchanged. The steps below keep the original filename deliberately: this is a record of the plan
> as executed, not a description of today's tree. Do NOT renumber or rewrite them.

**Goal:** The Budget report and the dashboard "Budget burn" tile get one burn-down chart with orientation (Burn-down / Cumulative) and unit (€ / Hours) switches, both forecast lines, a derived earned-value history, and an hours forecast whose disagreement with the € forecast is signalled (banner, role-mix disclosure, rate fact, chips).

**Architecture:** Pure, i18n-free engines first: hours facts from the existing single facts walk (`budget-forecast.ts`), `budget-ev-history.ts`, `budget-rate-mix.ts`, bundled by `budget-forecasts.ts`, and a chart geometry model (`burndown-geometry.ts`). A React-free text layer (`budget-rate-mix-text.ts`) turns them into EN/DE sentences. React surfaces only format and lay out, using existing primitives (`InfoTooltip` gains a `children` trigger).

**Tech Stack:** Next.js / React 19, TypeScript, vitest + Testing Library, `Intl`, dependency-free SVG.

**Spec:** `docs/superpowers/specs/2026-09-15-forecast-chart-hours-design.md` (addendum, all sections) with its parent `docs/superpowers/specs/2026-09-14-budget-forecast-union-design.md` (§5, §6.5 as superseded). Mockup: `docs/superpowers/specs/2026-09-15-forecast-chart-hours-mockup.html`.

## Rulings (plan vs spec)

Recorded as `Ruling — why — cost if wrong`.

1. **EV h uses the reported, spillover-inclusive `br.budgetHours`.** Probe on a donor/successor fixture: EV h ÷ BAC h = EV € ÷ BAC € = 45% on this basis, 30% on own hours. The spec §3.1 wording was corrected in the plan commit. — `report.project.budgetHours` sums reported hours. — If wrong, hours percent complete disagrees with € for any project with spillover.
2. **Bundle lives in a new `budget-forecasts.ts`.** `budget-rate-mix.ts` and `budget-ev-history.ts` import types from `budget-forecast.ts`; putting the bundle there would create an import cycle. — Cost: one more small module.
3. **`forecastFacts` keeps returning € facts**; the new `forecastFactsByUnit` returns both. — Every existing test and caller stays byte-identical. — None.
4. **Role names come from `roleLabel(role, disciplines, grades)`** (roles and grades are managed in Resources → Manage roles); a discipline row uses the discipline's name; a dangling id reads "—". `BudgetReportPanel` gains `grades?`, `DashboardPanel` gains `disciplines?` and `grades?`, `DashboardEntities` gains both optional (default `[]`), so `task-manager.tsx` and `use-portfolio-health.ts` callers are untouched. — Names are workspace data, not i18n. — Those two callers get "n/a n/a" names, but they never render the mix.
5. **Banner pace sentence says "the hours show X; the budget shows Y"** instead of the spec's "effort overrun is X": true also when a VAC is positive. — Cost: slightly less vivid wording.
6. **Driver clause is "{role}: {share} of the booked hours (planned {share})"** — role names like "Developer Senior" cannot be pluralised safely in EN or DE.
7. **Arrow glyphs (▲ ▼) and the chip's ⓘ are `aria-hidden` spans outside translated strings.** The accessible name still contains the visible words (label-in-name).
8. **`InfoTooltip` trigger styling:** without `children` the existing round "i" classes stay byte-identical; with `children` the trigger uses `inline-flex cursor-help items-center rounded-full focus:outline-none focus:ring-2 focus:ring-ui-green` and the `Badge` supplies the chip look. No `className` prop is added. `label` is required with `children` (a discriminated props union, pinned by a `@ts-expect-error` test).
9. **Facts grid** stays `grid-cols-2 sm:grid-cols-4` without the rate fact and becomes `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` with it.
10. **New `ForecastSection`** (`budget-forecast-section.tsx`) renders banners, the S4 disclosure and the cards, and owns the disclosure's open state and a focus nonce. The panel stays an orchestrator. Focus moves in an effect keyed on the nonce (after commit), never synchronously in the click handler (the `dashboard-panel.tsx` precedent).
11. **`DashboardModel` gains `forecastBundle: ForecastBundle | null` and `chartDates: { today: string; planEnd: string }`**; `forecast` stays and equals `forecastBundle?.eur ?? null`, so the budget RAG readers are unchanged.
12. **`BurndownCharts` is removed**; `BurndownChart` (pure presentation over a `ChartModel`) and `BurndownChartPanel` (switches + settings) replace it. Captions reuse `burndownBudgetRemaining` / `burndownHoursRemaining` and add two cumulative captions — no key is deleted.
13. **Y-axis tick labels carry `data-axis="y"`**, so the two EUR-axis tests count ticks, not forecast end labels. X-axis labels stay the first and last period keys.
14. **EV history points use `actualPointDates(series, today)`** (a helper in `budget-burndown.ts`), the same dates as the actual line; the history line is drawn in the Cumulative orientation only.
15. **Tile height stays `h: 3`.** `docs/AGENTS/dashboard.md` records inner scrolling as the tile body's normal mode (the burn tile was already 507px over). Eye-verify reports it; the user decides a bump.
16. **The "In hours" rows carry no tooltip except CPI (hours).** EAC and VAC are explained on the € rows directly above.
17. **Local axe scan and the full suite run only on the user's say.**
18. **`useSettings()` is called inside `BurndownChartPanel`** with functional setters. Instances sync through the settings listener registry in `use-settings.ts`, so a write here cannot be overwritten by a stale copy elsewhere.
19. **Tasks 12 and 13 are one dispatch and one review unit.** Removing `BurndownCharts` breaks its two call sites; keeping a shim export for one task would add dead code that Task 13 deletes again. — Cost: one larger review.

## Global Constraints

- `src/app/*.ts(x)` are `i/lf w/crlf`. The Edit and Write tools keep CRLF on existing files; never `sed -i`. New files: after staging, `git ls-files --eol <file>` must show `i/lf`. `docs/open-followups.md` and `docs/**/*.md` are LF.
- `src/app/i18n.de.ts` is edited ONLY with a Node UTF-8 write whose anchor uses `\r\n`, with real umlauts and straight ASCII double quotes. Never the Edit tool. Re-read the inserted lines afterwards.
- EN and DE keys land in the same commit (tsc enforces parity). Placeholders are 0-based `{0}`, `{1}`.
- `Lang` literals in tests are `"en-US"`, never `"en"`. A test asserting DE output calls `loadI18n("de")` in `beforeAll`.
- Never `git add -A` or `git add .`. Stage named paths. Never stage `sample-workspace-huge.json` or `not-in-use.env.local.bak`. No `--amend`.
- Commit messages carry no `#` followed by digits. End every commit message with the session trailer.
- Never read an exit code through a pipe. Run vitest as `npx vitest run <files> > <scratch>/<name>.log 2>&1; echo "EXIT=$?"`, then read the log and check `Test Files` counts exactly the files you named. Never run two vitest processes at once. No full suite (the user runs it at the end on their say).
- After editing any test file, run `npx tsc --noEmit > <scratch>/tsc.log 2>&1; echo "EXIT=$?"` and read the `src/` error count.
- Lint touched files: `npx eslint --max-warnings=0 <files>; echo "EXIT=$?"`. Unused bindings are fatal; `react-hooks/exhaustive-deps` rejects `obj.member` deps; no `Date.now()`/`new Date()` in a render body; `react-hooks/set-state-in-effect` is fatal.
- New `.ts` modules are coverage-gated (global lines 92 / functions 91 / branches 80 / statements 89): test every exported function and branch of `budget-forecasts.ts`, `budget-rate-mix.ts`, `budget-ev-history.ts`, `budget-rate-mix-text.ts`, `burndown-geometry.ts`.
- UI: only existing primitives — `SegmentedControl`, `InfoTooltip` (with the Task 6 `children` trigger), `Badge`, `Banner`, `Button`, `Tile`, `Section`, native `<details>`/`<summary>`. No hand-rolled toggles, radios or buttons. Palette tokens only (`ui-dark-blue`, `ui-purple`, `ui-pink`, `ui-green`, `--rag-amber`); never `--rag-amber-text` on small text.
- Constants (verbatim): `RATE_DRIFT_SIGNAL_RATIO = 0.03`, `RATE_MIX_DRIVER_MIN_DIFFERENCE = 0.03`, `CHART_FRAME_TOLERANCE = 0.5`. Existing: `BURN_RATE_WINDOW_WORKING_DAYS = 20`, `PACE_VAC_RED_RATIO = 0.10`.
- Budget RAG, tile headline, AI snapshot and exports stay € only.
- Docs: no `path:LINE` citations (the doc-claims ratchet); cite symbols.
- File size LIMIT 1600 lines (`readFileSync().split("\n").length`).

## File Structure

| File | Responsibility |
|---|---|
| Modify `src/app/budget-forecast.ts` (+ test) | Task 1: `forecastFactsByUnit`, `computeBudgetForecastsByUnit` |
| Modify `src/app/budget-burndown.ts` (+ test) | Task 2: `periodStarts`/`periodEnds`, `actualPointDates` |
| Create `src/app/budget-ev-history.ts` (+ test) | Task 3: derived earned-value history |
| Create `src/app/budget-rate-mix.ts` (+ test); modify `src/app/budget-report.ts` | Task 4: rate drift, role mix, trigger; `RateRow.roleId`/`disciplineId` |
| Create `src/app/budget-forecasts.ts` (+ test); modify `dashboard.ts`, `dashboard-panel.tsx`, `budget-report-panel.tsx`, `workspace-section.tsx`, `reports.tsx` | Task 5: bundle + wiring, no visual change |
| Modify `src/app/info-tooltip.tsx` (+ test) | Task 6: `children` trigger |
| Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`, `src/app/forecast-format.ts` (+ test); create `src/app/budget-rate-mix-text.ts` (+ test), `src/test/forecast-fixtures.ts` | Task 7: strings, formatters, sentence builders, shared UI fixtures |
| Create `src/app/budget-rate-mix-chip.tsx`; modify `src/app/budget-forecast-cards.tsx` (+ test) | Task 8: "In hours" lines + chips |
| Create `src/app/budget-rate-mix-details.tsx`, `src/app/budget-forecast-section.tsx` (+ tests); modify `budget-forecast-banner.tsx` (+ test), `budget-report-panel.tsx` | Task 9: mix banner + S4 disclosure |
| Modify `src/app/budget-forecast-facts.tsx`, `src/app/budget-forecast-headline.tsx`, `src/app/dashboard-tile-bodies.tsx` (+ tests) | Task 10: rate fact + tile chip |
| Create `src/app/burndown-geometry.ts` (+ test) | Task 11: chart model |
| Rewrite `src/app/burndown-chart.tsx` (+ test); create `src/app/burndown-chart-panel.tsx` (+ test); modify `settings-types.ts`, `use-settings.ts` (+ test) | Task 12: chart component, switches, settings |
| Modify `budget-report-panel.tsx`, `dashboard-tile-bodies.tsx`, `budget-report-panel.test.tsx`, `dashboard-panel.test.tsx` | Task 13: mount the chart, migrate twin-chart tests |
| Modify `docs/open-followups.md`, `docs/AGENTS/dashboard.md` | Task 14: close §501 and §504, narrow §549, tile docs |

---

### Task 1: Hours facts from the single facts walk

**Files:**
- Modify: `src/app/budget-forecast.ts` (`forecastFacts` and below)
- Test: `src/app/budget-forecast.test.ts`

**Interfaces:**
- Consumes: existing `BudgetForecastInput`, `ForecastFacts`, `computeForecastFromFacts`.
- Produces:
  - `export type ForecastFactsByUnit = { eur: ForecastFacts; hours: ForecastFacts };`
  - `export function forecastFactsByUnit(input: BudgetForecastInput): ForecastFactsByUnit`
  - `export function computeBudgetForecastsByUnit(input: BudgetForecastInput): { eur: BudgetForecast; hours: BudgetForecast }`
  - `forecastFacts(input)` unchanged in behaviour (returns `.eur`).

- [ ] **Step 1: Write the failing tests** — append to `src/app/budget-forecast.test.ts` (it already defines `none`, `day`, `fixture`, `plan`, `roles`, `bucket`, `input`, `withActual`; add `forecastFactsByUnit`, `computeBudgetForecastsByUnit` to the existing import from `./budget-forecast`):

```ts
describe("hours facts (MR 3 addendum §3.1)", () => {
  it("pins the hours scenario of spec §7 through the unchanged core", () => {
    const f = computeForecastFromFacts(fixture({
      bac: 2_000, ac: 1_450, ev: 1_240, pv: 176_000 / 120,
      dated: [day("2026-01-05", 1_230), ...workingDaysBefore("2026-09-14", 20, none).map((d) => day(d, 11))],
    }));
    if (!isPaceAvailable(f.pace) || !isEfficiencyAvailable(f.efficiency)) throw new Error("unavailable");
    expect(f.pace.burnRatePerDay).toBeCloseTo(11, 9);
    expect(f.pace.etc).toBeCloseTo(759, 6);
    expect(f.pace.eac).toBeCloseTo(2_209, 6);
    expect(f.pace.vac).toBeCloseTo(-209, 6);
    expect(f.pace.runOutDate).toBe("2026-11-23");
    expect(f.efficiency.cpi).toBeCloseTo(0.8552, 4);
    expect(f.efficiency.etc).toBeCloseTo(888.7, 1);
    expect(f.efficiency.eac).toBeCloseTo(2_338.7, 1);
    expect(f.gap?.eacDifference).toBeCloseTo(129.7, 1);
    expect(f.gap?.extraWorkingDays).toBe(12);
  });

  it("builds hours facts from the same walk: BAC/AC hours, day-key bookings valued as hours", () => {
    const { eur, hours } = forecastFactsByUnit(input([withActual(1, { "2026-06-10": 8 })]));
    expect(hours.bac).toBe(100);
    expect(hours.ac).toBe(8);
    expect(hours.dated).toEqual([{ date: "2026-06-10", bookedFrom: "2026-06-10", value: 8, spread: false }]);
    expect(eur.dated).toEqual([{ date: "2026-06-10", bookedFrom: "2026-06-10", value: 800, spread: false }]);
  });

  it("spreads a period key's hours evenly over its working days", () => {
    const { hours } = forecastFactsByUnit(input([withActual(1, { "2026-06": 22 })]));
    expect(hours.dated).toHaveLength(22);
    expect(hours.dated.every((d) => d.value === 1 && d.spread && d.bookedFrom === "2026-06-01")).toBe(true);
  });

  it("reads PV hours from the burn-down hours series", () => {
    const { eur, hours } = forecastFactsByUnit(input([withActual(1, {})]));
    expect(hours.pv).toBe(100);
    expect(eur.pv).toBe(10_000);
  });

  it("uses the reported, spillover-inclusive bucket hours for EV h (Ruling 1)", () => {
    const donor = bucket(1, {
      status: "closed", successorId: 2, percentComplete: 100,
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 50 }, actualHours: {} }],
    } as Partial<BudgetBucket>);
    const succ = bucket(2, {
      percentComplete: 60,
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: {} }],
    } as Partial<BudgetBucket>);
    const { eur, hours } = forecastFactsByUnit(input([donor, succ]));
    expect(hours.bac).toBe(200);
    expect(hours.ev).toBeCloseTo(140, 9);
    expect(eur.ev! / eur.bac).toBeCloseTo(hours.ev! / hours.bac, 9);
  });

  it("shares the missing-percent rule between units", () => {
    const { eur, hours } = forecastFactsByUnit(input([withActual(1, {}, { name: "Design" } as Partial<BudgetBucket>)]));
    expect(eur.ev).toBeNull();
    expect(hours.ev).toBeNull();
    expect(hours.bucketsMissingPercent).toEqual([{ id: 1, name: "Design" }]);
  });

  it("forecastFacts still returns the € facts, and the pair wrapper runs both", () => {
    const inp = input([withActual(1, { "2026-06-10": 8 })]);
    expect(forecastFacts(inp)).toEqual(forecastFactsByUnit(inp).eur);
    const both = computeBudgetForecastsByUnit(inp);
    expect(both.eur).toEqual(computeBudgetForecast(inp));
    expect(both.hours.facts.bac).toBe(100);
  });
});
```

If `workingDaysBefore`, `isEfficiencyAvailable` or `BudgetBucket` are not yet imported in that test file, add them to its existing imports.

The spillover test's premise (donor 50 h at €100/h spills into the successor, reported successor hours 150, project 200 h / €20,000) was measured on this exact shape; if the asserted `hours.bac` differs, print `inp.report.buckets` and correct the fixture's numbers, not the rule.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/budget-forecast.test.ts > <scratch>/t1.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=1; the new tests fail with `forecastFactsByUnit is not a function` (the §7 pin passes — it exercises the unchanged core).

- [ ] **Step 3: Implement** — in `src/app/budget-forecast.ts`, replace the body of `forecastFacts` with a shared walk. Keep every existing comment in the loop verbatim.

```ts
export type ForecastFactsByUnit = { eur: ForecastFacts; hours: ForecastFacts };

/**
 * One walk, two units (MR 3 addendum §3.1). € facts are exactly what
 * `forecastFacts` has always returned. Hours facts:
 * - BAC h = `report.project.budgetHours`, AC h = `report.project.actualHours`;
 * - EV h = Σ reported `br.budgetHours` × percent complete (Ruling 1: the same
 *   spillover-inclusive basis BAC h sums, so EV h ÷ BAC h = EV € ÷ BAC €);
 * - PV h from the burn-down hours series at `todayIndex`;
 * - dated values are hours, from the same day-key / spread-period rules.
 */
export function forecastFactsByUnit(input: BudgetForecastInput): ForecastFactsByUnit {
  const { report, buckets, roles, fxRates, tasks, plan, burndown, holidaySet, today } = input;
  const reportById = new Map(report.buckets.map((r) => [r.bucketId, r]));
  const datedEur: DatedValue[] = [];
  const datedHours: DatedValue[] = [];
  const bucketsMissingPercent: { id: number; name: string }[] = [];
  let ac = 0;
  let ev = 0;
  let evHours = 0;
  let hasFixedPrice = false;
  for (const bucket of buckets) {
    const br = reportById.get(bucket.id);
    if (!br) continue;
    const isFixed = bucket.type === "fixed";
    hasFixedPrice ||= isFixed;
    // (existing §5.4 / ★ Review finding 1 comment block, verbatim)
    const ownBudgetHours = br.budgetHours - br.spilloverInHours;
    const fixedPerHour = isFixed && ownBudgetHours > 0
      ? currencyToEur(bucket.fixedPriceAmount ?? 0, bucket, fxRates) / ownBudgetHours
      : 0;
    ac += isFixed ? fixedPerHour * br.actualHours : br.consumedValue;
    if (br.budgetValue > 0) {
      const pct = bucketPercentComplete(bucket, tasks);
      if (pct === null) {
        bucketsMissingPercent.push({ id: bucket.id, name: bucket.name });
      } else {
        ev += (br.budgetValue * pct) / 100;
        // Ruling 1 (MR 3): REPORTED hours, not `ownBudgetHours` — the own-hours
        // subtraction above serves the fixed-price AC ratio only.
        evHours += (br.budgetHours * pct) / 100;
      }
    }
    const active = new Set(bucketActivePeriods(bucket, plan).map((p) => p.key));
    for (const row of bucketRateRows(bucket, roles)) {
      const perHour = isFixed ? fixedPerHour : row.rates.external;
      for (const [key, hours] of Object.entries(row.actualHours)) {
        // (existing Ruling 4 comment, verbatim)
        if (!(hours > 0)) continue;
        if (isDayKey(key)) {
          if (active.has(periodKeyForDate(key, plan.granularity))) {
            datedEur.push({ date: key, bookedFrom: key, value: hours * perHour, spread: false });
            datedHours.push({ date: key, bookedFrom: key, value: hours, spread: false });
          }
          continue;
        }
        if (granularityOfPeriodKey(key) !== plan.granularity || !active.has(key)) continue;
        const bounds = periodBounds(key);
        if (!bounds) continue;
        const days = workingDaysInRange(bounds.start, bounds.end, holidaySet);
        if (days.length === 0) {
          datedEur.push({ date: bounds.start, bookedFrom: bounds.start, value: hours * perHour, spread: true });
          datedHours.push({ date: bounds.start, bookedFrom: bounds.start, value: hours, spread: true });
          continue;
        }
        // € keeps its exact original expression so existing € pins stay bit-identical.
        const eachEur = (hours * perHour) / days.length;
        const eachHours = hours / days.length;
        for (const d of days) {
          datedEur.push({ date: d, bookedFrom: bounds.start, value: eachEur, spread: true });
          datedHours.push({ date: d, bookedFrom: bounds.start, value: eachHours, spread: true });
        }
      }
    }
  }
  const at = burndown.todayIndex;
  const pv = at >= 0 ? burndown.totalBudgetValue - burndown.plannedRemainingValue[at] : 0;
  const pvHours = at >= 0 ? burndown.totalBudgetHours - burndown.plannedRemainingHours[at] : 0;
  const missing = bucketsMissingPercent.length > 0;
  const common = { bucketsMissingPercent, planEnd: plan.endDate, today, holidaySet, hasFixedPrice };
  return {
    eur: { bac: report.project.budgetValue, ac, ev: missing ? null : ev, pv, dated: datedEur, ...common },
    hours: {
      bac: report.project.budgetHours, ac: report.project.actualHours, ev: missing ? null : evHours, pv: pvHours,
      dated: datedHours, ...common,
    },
  };
}

export function forecastFacts(input: BudgetForecastInput): ForecastFacts {
  return forecastFactsByUnit(input).eur;
}

export function computeBudgetForecastsByUnit(input: BudgetForecastInput): { eur: BudgetForecast; hours: BudgetForecast } {
  const facts = forecastFactsByUnit(input);
  return { eur: computeForecastFromFacts(facts.eur), hours: computeForecastFromFacts(facts.hours) };
}
```

Keep the existing docstring above `forecastFacts` by moving it onto `forecastFactsByUnit` (its € description still holds).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/app/budget-forecast.test.ts > <scratch>/t1.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0, `Test Files 1 passed`, every pre-existing test still green (the € regression pin).

- [ ] **Step 5: Mutation-check Ruling 1** — temporarily change `evHours += (br.budgetHours * pct) / 100` to `evHours += (ownBudgetHours * pct) / 100`, rerun the file, confirm "uses the reported, spillover-inclusive bucket hours" fails, revert, prove `git diff --stat` shows only the intended changes.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit > <scratch>/tsc.log 2>&1; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/budget-forecast.ts src/app/budget-forecast.test.ts; echo "EXIT=$?"
git add src/app/budget-forecast.ts src/app/budget-forecast.test.ts
git commit -m "feat(forecast): hours facts from the single facts walk"
```

---

### Task 2: Period dates on the burn-down series

**Files:**
- Modify: `src/app/budget-burndown.ts`
- Test: `src/app/budget-burndown.test.ts`; fix literal `BurndownSeries` objects that tsc flags (`src/app/snapshot.test.ts`, `src/app/use-snapshots.test.tsx`; `src/app/burndown-chart.test.tsx` is rewritten in Task 12 — for now add the two fields to its four literals)

**Interfaces:**
- Produces:
  - `BurndownSeries.periodStarts: readonly string[]`, `BurndownSeries.periodEnds: readonly string[]` (same index as `periods`; ISO dates from `Period.start`/`Period.end` in `resource-capacity.ts`).
  - `export function actualPointDates(series: Pick<BurndownSeries, "periodEnds" | "todayIndex">, today: string): string[]`

- [ ] **Step 1: Write the failing tests** — append to `src/app/budget-burndown.test.ts` (reuse its existing bucket/plan fixtures; the calls below use the argument order of `computeBurndownSeries`):

```ts
describe("period dates (MR 3 date axis)", () => {
  it("carries each period's start and end date, index-aligned with the keys", () => {
    const s = computeBurndownSeries([], { startDate: "2026-01-01", endDate: "2026-03-31", granularity: "month", currency: "EUR" }, [], [], 8, new Set(), [], "2026-02-14", null);
    expect(s.periods).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(s.periodStarts).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(s.periodEnds).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });
});

describe("actualPointDates", () => {
  const periodEnds = ["2026-01-31", "2026-02-28", "2026-03-31"];
  it("uses each past period's end and today inside the current period", () => {
    expect(actualPointDates({ periodEnds, todayIndex: 1 }, "2026-02-14")).toEqual(["2026-01-31", "2026-02-14"]);
  });
  it("uses the period end when today is on or after it", () => {
    expect(actualPointDates({ periodEnds, todayIndex: 1 }, "2026-02-28")).toEqual(["2026-01-31", "2026-02-28"]);
  });
  it("is empty before the first period", () => {
    expect(actualPointDates({ periodEnds, todayIndex: -1 }, "2025-12-01")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/budget-burndown.test.ts > <scratch>/t2.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=1 (`actualPointDates` not exported; `periodStarts` undefined).

- [ ] **Step 3: Implement** — in `src/app/budget-burndown.ts`:

```ts
export type BurndownSeries = {
  periods: readonly string[];
  /** ISO start / end date of each entry of `periods`, same index (MR 3 date axis). */
  periodStarts: readonly string[];
  periodEnds: readonly string[];
  // …existing fields unchanged…
};
```

In the return object add, beside `periods: periods.map((p) => p.key)`:

```ts
    periodStarts: periods.map((p) => p.start),
    periodEnds: periods.map((p) => p.end),
```

Append:

```ts
/** Dates of the actual line's points: every past period's end, and for the
 *  period containing `today` the earlier of `today` and that period's end.
 *  Empty when `todayIndex === -1`. Shared by the chart geometry and the
 *  earned-value history so both lines sit on the same x positions. */
export function actualPointDates(series: Pick<BurndownSeries, "periodEnds" | "todayIndex">, today: string): string[] {
  const out: string[] = [];
  for (let i = 0; i <= series.todayIndex; i++) {
    const end = series.periodEnds[i];
    out.push(i === series.todayIndex && today < end ? today : end);
  }
  return out;
}
```

- [ ] **Step 4: Run tsc and fix every literal `BurndownSeries` it flags** by adding `periodStarts`/`periodEnds` arrays matching the literal's `periods` (for a month key `YYYY-MM`: start `YYYY-MM-01`, end the month's last day). Objects cast with `as unknown as` need no change.

Run: `npx tsc --noEmit > <scratch>/tsc.log 2>&1; echo "EXIT=$?"`
Expected after fixes: no `src/` errors.

- [ ] **Step 5: Run the touched test files**

Run: `npx vitest run src/app/budget-burndown.test.ts src/app/burndown-chart.test.tsx src/app/snapshot.test.ts src/app/use-snapshots.test.tsx > <scratch>/t2.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0, `Test Files 4 passed`.

- [ ] **Step 6: Lint and commit**

```bash
npx eslint --max-warnings=0 src/app/budget-burndown.ts src/app/budget-burndown.test.ts src/app/burndown-chart.test.tsx src/app/snapshot.test.ts src/app/use-snapshots.test.tsx; echo "EXIT=$?"
git add src/app/budget-burndown.ts src/app/budget-burndown.test.ts src/app/burndown-chart.test.tsx src/app/snapshot.test.ts src/app/use-snapshots.test.tsx
git commit -m "feat(burndown): period dates and actual point dates on the series"
```

(Stage only the files you actually changed.)

---

### Task 3: Derived earned-value history

**Files:**
- Create: `src/app/budget-ev-history.ts`
- Test: `src/app/budget-ev-history.test.ts`

**Interfaces:**
- Consumes: `bucketPercentComplete` (`budget-earned-value.ts`), `isTaskFinished` (`task-status.ts`), `BudgetReport` (`budget-report.ts`).
- Produces:

```ts
export type EvHistoryTask = Pick<Task, "id" | "status" | "completedDate">;
export type EvHistoryPoint = { date: string; eur: number; hours: number };
export type EvHistory =
  | { available: true; points: readonly EvHistoryPoint[] }
  | { available: false; reason: "manual-percent" | "no-linked-tasks"; buckets: readonly { id: number; name: string }[] };
export type EvHistoryInput = {
  report: BudgetReport; buckets: readonly BudgetBucket[]; tasks: readonly EvHistoryTask[];
  dates: readonly string[]; today: string;
};
export function computeEvHistory(input: EvHistoryInput): EvHistory
```

- [ ] **Step 1: Write the failing tests** — `src/app/budget-ev-history.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeEvHistory, type EvHistoryTask } from "./budget-ev-history";
import { computeBudgetReport } from "./budget-report";
import { computeBudgetForecastsByUnit, type BudgetForecastInput } from "./budget-forecast";
import { computeBurndownSeries } from "./budget-burndown";
import type { BudgetBucket, ResourcePlan, Role } from "./types";

const none = new Set<string>();
const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const roles = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 60, externalRate: 100 } as Role];
function bucket(id: number, over: Partial<BudgetBucket> = {}): BudgetBucket {
  return {
    id, name: `B${id}`, type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: {} }],
    ...over,
  } as BudgetBucket;
}
const report = (b: BudgetBucket[]) => computeBudgetReport(b, plan, roles, [], 8, none, [], [], null);
const tasks: EvHistoryTask[] = [
  { id: 1, status: "Done", completedDate: "2026-03-10" },
  { id: 2, status: "Done", completedDate: "2026-06-30T18:00:00Z" },
  { id: 3, status: "Cancelled", completedDate: undefined },
  { id: 4, status: "In Progress", completedDate: undefined },
];
const dates = ["2026-01-31", "2026-03-31", "2026-06-30", "2026-09-14"];

describe("computeEvHistory", () => {
  it("counts each finished task from its own completion date; today uses the live percent complete", () => {
    const b = [bucket(1, { taskIds: [1, 2, 3, 4] })];
    const h = computeEvHistory({ report: report(b), buckets: b, tasks, dates, today: "2026-09-14" });
    if (!h.available) throw new Error("unavailable");
    expect(h.points).toEqual([
      { date: "2026-01-31", eur: 0, hours: 0 },
      { date: "2026-03-31", eur: 2_500, hours: 25 },
      { date: "2026-06-30", eur: 5_000, hours: 50 },
      { date: "2026-09-14", eur: 7_500, hours: 75 }, // Cancelled (no date) counts only here
    ]);
  });

  it("ends exactly at the forecast's EV in both units", () => {
    const b = [bucket(1, { taskIds: [1, 2, 3, 4] })];
    const today = "2026-09-14";
    const burndown = computeBurndownSeries(b, plan, roles, [], 8, none, [], today, null);
    const inp: BudgetForecastInput = { report: report(b), buckets: b, roles, fxRates: null, tasks, plan, burndown, holidaySet: none, today };
    const { eur, hours } = computeBudgetForecastsByUnit(inp);
    const h = computeEvHistory({ report: inp.report, buckets: b, tasks, dates, today });
    if (!h.available) throw new Error("unavailable");
    const last = h.points[h.points.length - 1];
    expect(last.eur).toBeCloseTo(eur.facts.ev!, 9);
    expect(last.hours).toBeCloseTo(hours.facts.ev!, 9);
  });

  it("is unavailable, naming the buckets, when a budgeted bucket has a hand-entered percent", () => {
    const b = [bucket(1, { taskIds: [1] }), bucket(2, { percentComplete: 50, name: "Design" })];
    expect(computeEvHistory({ report: report(b), buckets: b, tasks, dates, today: "2026-09-14" }))
      .toEqual({ available: false, reason: "manual-percent", buckets: [{ id: 2, name: "Design" }] });
  });

  it("is unavailable when a budgeted bucket has no resolvable linked task", () => {
    const b = [bucket(1, { taskIds: [99], name: "Rollout" })];
    expect(computeEvHistory({ report: report(b), buckets: b, tasks, dates, today: "2026-09-14" }))
      .toEqual({ available: false, reason: "no-linked-tasks", buckets: [{ id: 1, name: "Rollout" }] });
  });

  it("ignores buckets without budget", () => {
    const empty = bucket(2, { allocations: [] } as Partial<BudgetBucket>);
    const b = [bucket(1, { taskIds: [1] }), empty];
    expect(computeEvHistory({ report: report(b), buckets: b, tasks, dates: [], today: "2026-09-14" }))
      .toEqual({ available: true, points: [] });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/budget-ev-history.test.ts > <scratch>/t3.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=1, cannot resolve `./budget-ev-history`.

- [ ] **Step 3: Implement** — `src/app/budget-ev-history.ts`:

```ts
/**
 * Derived earned-value history (MR 3 addendum §3.4, Option 1). Pure, i18n-free.
 * Per date and per budgeted bucket: share = linked tasks finished with a
 * completion date on or before that date ÷ resolved linked tasks. EV € = Σ
 * budgetValue × share, EV h = Σ reported budgetHours × share (§3.1 basis).
 * The TODAY point uses `bucketPercentComplete`, so the line ends exactly at the
 * forecast's EV; a finished task with no completion date (Cancelled) can only
 * be placed there. All or nothing: a hand-entered percent or an unlinked
 * budgeted bucket has no history, and a partial line would under-report EV.
 * Approximation by construction: today's links and budget apply to the past.
 */
import { bucketPercentComplete } from "./budget-earned-value";
import { isTaskFinished } from "./task-status";
import type { BudgetReport } from "./budget-report";
import type { BudgetBucket, Task } from "./types";

export type EvHistoryTask = Pick<Task, "id" | "status" | "completedDate">;
export type EvHistoryPoint = { date: string; eur: number; hours: number };
export type EvHistory =
  | { available: true; points: readonly EvHistoryPoint[] }
  | { available: false; reason: "manual-percent" | "no-linked-tasks"; buckets: readonly { id: number; name: string }[] };
export type EvHistoryInput = {
  report: BudgetReport; buckets: readonly BudgetBucket[]; tasks: readonly EvHistoryTask[];
  dates: readonly string[]; today: string;
};

type LinkedBucket = { bucket: BudgetBucket; eur: number; hours: number; resolved: readonly EvHistoryTask[] };

function finishedBy(task: EvHistoryTask, date: string): boolean {
  const done = task.completedDate ? task.completedDate.slice(0, 10) : "";
  return isTaskFinished(task) && done !== "" && done <= date;
}

export function computeEvHistory(input: EvHistoryInput): EvHistory {
  const { report, buckets, tasks, dates, today } = input;
  const reportById = new Map(report.buckets.map((r) => [r.bucketId, r]));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const blocking: { id: number; name: string }[] = [];
  let anyManual = false;
  const linked: LinkedBucket[] = [];
  for (const bucket of buckets) {
    const br = reportById.get(bucket.id);
    if (!br || !(br.budgetValue > 0)) continue;
    if (bucket.percentComplete !== undefined) {
      anyManual = true;
      blocking.push({ id: bucket.id, name: bucket.name });
      continue;
    }
    const resolved = (bucket.taskIds ?? [])
      .map((id) => tasksById.get(id))
      .filter((task): task is EvHistoryTask => task !== undefined);
    if (resolved.length === 0) {
      blocking.push({ id: bucket.id, name: bucket.name });
      continue;
    }
    linked.push({ bucket, eur: br.budgetValue, hours: br.budgetHours, resolved });
  }
  if (blocking.length > 0) {
    return { available: false, reason: anyManual ? "manual-percent" : "no-linked-tasks", buckets: blocking };
  }
  const points = dates.map((date) => {
    let eur = 0;
    let hours = 0;
    for (const b of linked) {
      const share = date >= today
        ? (bucketPercentComplete(b.bucket, b.resolved) ?? 0) / 100
        : b.resolved.filter((task) => finishedBy(task, date)).length / b.resolved.length;
      eur += b.eur * share;
      hours += b.hours * share;
    }
    return { date, eur, hours };
  });
  return { available: true, points };
}
```

If `Task.completedDate` is not `string | undefined` (check `export type Task` in `types.ts`), adapt `finishedBy`'s guard to its real type; keep the `slice(0, 10)` date-only comparison.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/app/budget-ev-history.test.ts > <scratch>/t3.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0, `Test Files 1 passed`, 5 tests.

- [ ] **Step 5: Mutation-check** — (a) replace `date >= today ? (bucketPercentComplete…)` with the finished-by branch for every date: "ends exactly at the forecast's EV" and the Cancelled expectation must fail; (b) drop `.slice(0, 10)`: the 2026-06-30 point must fail. Revert each; `git diff --stat` shows only the two new files.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit > <scratch>/tsc.log 2>&1; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/budget-ev-history.ts src/app/budget-ev-history.test.ts; echo "EXIT=$?"
git add src/app/budget-ev-history.ts src/app/budget-ev-history.test.ts
git commit -m "feat(forecast): derived earned-value history from task completion dates"
```

### Task 4: Rate-mix engine

**Files:**
- Modify: `src/app/budget-report.ts` (`RateRow`, `bucketRateRows`)
- Create: `src/app/budget-rate-mix.ts`
- Test: `src/app/budget-rate-mix.test.ts`; any test asserting `bucketRateRows(...)` with `toEqual` (find with `grep -rn "bucketRateRows(" src/app --include=*.test.ts --include=*.test.tsx`) — MIGRATE by adding the new id field to the expected rows

**Interfaces:**
- Consumes: `bucketActivePeriods`, `bucketRateRows`, `effectiveBudgetHours` (`budget-report.ts`); `actualHoursIn` (`actual-hours.ts`); `roleLabel` (`resource-foundation.ts`); `isPaceAvailable`, `paceVacHealth`, `BudgetForecast` (`budget-forecast.ts`).
- Produces:

```ts
export const RATE_DRIFT_SIGNAL_RATIO = 0.03;
export const RATE_MIX_DRIVER_MIN_DIFFERENCE = 0.03;
export type RateMixRow = {
  key: string; kind: "role" | "discipline"; id: number; name: string; plannedRate: number | null;
  budgetHours: number; actualHours: number; plannedShare: number; bookedShare: number; difference: number;
  usedOfBudget: number | null;
};
export type RateMixSignal = {
  triggered: boolean; direction: "hours-worse" | "eur-worse" | null; severity: "warning" | "info" | null;
};
export type RateMix = RateMixSignal & {
  drift: number; bookedRate: number; plannedRate: number; budgetHours: number; actualHours: number;
  budgetValue: number; bookedValue: number; rows: readonly RateMixRow[]; driver: RateMixRow | null;
};
export type RateMixInput = {
  buckets: readonly BudgetBucket[]; roles: readonly Role[]; disciplines: readonly Discipline[]; grades: readonly Grade[];
  plan: ResourcePlan; resources: readonly Resource[]; workdayHours: number; holidaySet: ReadonlySet<string>;
  absences: readonly Absence[]; eur: BudgetForecast; hours: BudgetForecast;
};
export function rateMixSignal(drift: number, eur: BudgetForecast, hours: BudgetForecast): RateMixSignal
export function computeRateMix(input: RateMixInput): RateMix | null
```
- `RateRow` gains `roleId?: number; disciplineId?: number;`.

- [ ] **Step 1: Read the report's own hours loop** — open `computeBucketReport` in `src/app/budget-report.ts` and find where it sums `aBudget` (via `effectiveBudgetHours`) and `aActual` (via `actualHoursIn`) per rate row. Note exactly which period list and key list it iterates. Step 3 mirrors that loop; the parity test in Step 2 enforces it.

- [ ] **Step 2: Write the failing tests** — `src/app/budget-rate-mix.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeRateMix, rateMixSignal, RATE_DRIFT_SIGNAL_RATIO } from "./budget-rate-mix";
import { bucketRateRows, computeBudgetReport } from "./budget-report";
import { computeForecastFromFacts, type DatedValue, type ForecastFacts } from "./budget-forecast";
import { workingDaysBefore } from "./working-days";
import type { BudgetBucket, Discipline, Grade, ResourcePlan, Role } from "./types";

const none = new Set<string>();
const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const disciplines: Discipline[] = [{ id: 1, name: "Consultant" }, { id: 2, name: "Analyst" }];
const grades: Grade[] = [{ id: 1, name: "Senior" }, { id: 2, name: "Regular" }, { id: 3, name: "Junior" }];
const roles = [
  { id: 1, disciplineId: 1, gradeId: 1, internalRate: 90, externalRate: 150 },
  { id: 2, disciplineId: 1, gradeId: 2, internalRate: 70, externalRate: 120 },
  { id: 3, disciplineId: 1, gradeId: 3, internalRate: 50, externalRate: 90 },
  { id: 4, disciplineId: 2, gradeId: 1, internalRate: 60, externalRate: 100 },
] as Role[];
const day = (date: string, value: number): DatedValue => ({ date, bookedFrom: date, value, spread: false });
function facts(bac: number, ac: number, ev: number, pv: number, windowValue: number): ForecastFacts {
  return {
    bac, ac, ev, pv, bucketsMissingPercent: [],
    dated: [day("2026-01-05", ac - windowValue), ...workingDaysBefore("2026-09-14", 20, none).map((d) => day(d, windowValue / 20))],
    planEnd: "2026-12-18", today: "2026-09-14", holidaySet: none, hasFixedPrice: false,
  };
}
const EUR = computeForecastFromFacts(facts(240_000, 168_000, 148_800, 176_000, 27_000));
const hoursForecast = (ac: number, windowHours: number) => computeForecastFromFacts(facts(2_000, ac, 1_240, 176_000 / 120, windowHours));

function scenarioBucket(booked: [number, number, number]): BudgetBucket {
  return {
    id: 1, name: "B1", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
    allocations: [
      { roleId: 1, resourceIds: [], budgetHours: { "2026-06": 600 }, actualHours: { "2026-06": booked[0] } },
      { roleId: 2, resourceIds: [], budgetHours: { "2026-06": 800 }, actualHours: { "2026-06": booked[1] } },
      { roleId: 3, resourceIds: [], budgetHours: { "2026-06": 600 }, actualHours: { "2026-06": booked[2] } },
    ],
  } as BudgetBucket;
}
function mix(buckets: BudgetBucket[], hours = hoursForecast(1_450, 220)) {
  return computeRateMix({
    buckets, roles, disciplines, grades, plan, resources: [], workdayHours: 8, holidaySet: none, absences: [],
    eur: EUR, hours,
  });
}

describe("bucketRateRows ids", () => {
  it("tags role rows with roleId and blended rows with disciplineId", () => {
    expect(bucketRateRows(scenarioBucket([0, 0, 0]), roles)[0].roleId).toBe(1);
    const blended = {
      ...scenarioBucket([0, 0, 0]), planningMode: "blended", allocations: [],
      disciplineAllocations: [{ disciplineId: 2, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: {} }],
    } as BudgetBucket;
    expect(bucketRateRows(blended, roles)[0].disciplineId).toBe(2);
  });
});

describe("computeRateMix — spec §7 scenarios", () => {
  it("cheaper roles overburn: drift −3.45%, junior drives, hours worse, warning", () => {
    const m = mix([scenarioBucket([339, 572, 539])], hoursForecast(1_450, 220))!;
    expect(m.drift).toBeCloseTo((168_000 / 1_450) / 120 - 1, 9);
    expect(m.bookedRate).toBeCloseTo(168_000 / 1_450, 9);
    expect(m.plannedRate).toBe(120);
    expect(m.rows.map((r) => r.name)).toEqual(["Consultant Senior", "Consultant Regular", "Consultant Junior"]);
    expect(m.rows[2].plannedShare).toBeCloseTo(0.3, 9);
    expect(m.rows[2].bookedShare).toBeCloseTo(539 / 1_450, 9);
    expect(m.rows[2].usedOfBudget).toBeCloseTo(539 / 600, 9);
    expect(m.rows[1].plannedRate).toBe(120);
    expect(m.driver?.id).toBe(3);
    expect(m).toMatchObject({ triggered: true, direction: "hours-worse", severity: "warning" });
  });

  it("senior roles overburn: drift +3.70%, senior drives, € worse, info", () => {
    const m = mix([scenarioBucket([505, 540, 305])], hoursForecast(1_350, 205))!;
    expect(m.drift).toBeCloseTo((168_000 / 1_350) / 120 - 1, 9);
    expect(m.driver?.id).toBe(1);
    expect(m).toMatchObject({ triggered: true, direction: "eur-worse", severity: "info" });
  });

  it("mix on plan: no drift, no driver, not triggered", () => {
    const m = mix([scenarioBucket([420, 560, 420])], hoursForecast(1_400, 225))!;
    expect(m.drift).toBeCloseTo(0, 9);
    expect(m.driver).toBeNull();
    expect(m).toMatchObject({ triggered: false, direction: null, severity: null });
  });
});

describe("computeRateMix — rules", () => {
  it("excludes fixed-price buckets from drift and rows", () => {
    const fixed = { ...scenarioBucket([900, 0, 0]), id: 2, type: "fixed", fixedPriceAmount: 50_000 } as BudgetBucket;
    const with_ = mix([scenarioBucket([339, 572, 539]), fixed])!;
    const without = mix([scenarioBucket([339, 572, 539])])!;
    expect(with_.drift).toBeCloseTo(without.drift, 12);
    expect(with_.actualHours).toBe(without.actualHours);
  });

  it("groups blended buckets by discipline, named by the discipline", () => {
    const blended = {
      ...scenarioBucket([0, 0, 0]), id: 2, planningMode: "blended", allocations: [],
      disciplineAllocations: [{ disciplineId: 2, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: { "2026-06": 100 } }],
    } as BudgetBucket;
    const m = mix([scenarioBucket([339, 572, 539]), blended])!;
    const analyst = m.rows.find((r) => r.kind === "discipline")!;
    expect(analyst).toMatchObject({ id: 2, name: "Analyst", budgetHours: 100, actualHours: 100 });
  });

  it("matches the report's own hours and value for hourly buckets (parity)", () => {
    const b = [scenarioBucket([339, 572, 539])];
    const m = mix(b)!;
    const report = computeBudgetReport(b, plan, roles, [], 8, none, [], [], null);
    const hourly = report.buckets.filter((r) => r.type !== "fixed");
    expect(m.budgetHours).toBeCloseTo(hourly.reduce((s, r) => s + r.budgetHours - r.spilloverInHours, 0), 9);
    expect(m.actualHours).toBeCloseTo(hourly.reduce((s, r) => s + r.actualHours, 0), 9);
    expect(m.bookedValue).toBeCloseTo(hourly.reduce((s, r) => s + r.consumedValue, 0), 9);
  });

  it("is null without booked hours or without hourly budget", () => {
    expect(mix([scenarioBucket([0, 0, 0])])).toBeNull();
    expect(mix([])).toBeNull();
  });

  it("names a dangling role '—'", () => {
    const dangling = { ...scenarioBucket([0, 0, 0]), allocations: [{ roleId: 99, resourceIds: [], budgetHours: { "2026-06": 10 }, actualHours: { "2026-06": 5 } }] } as BudgetBucket;
    expect(mix([dangling])!.rows[0].name).toBe("—");
  });
});

describe("rateMixSignal", () => {
  const hours = hoursForecast(1_400, 225); // same rating band as EUR (A)
  it("fires at exactly the drift threshold and not just below it", () => {
    expect(rateMixSignal(RATE_DRIFT_SIGNAL_RATIO, EUR, hours).triggered).toBe(true);
    expect(rateMixSignal(-RATE_DRIFT_SIGNAL_RATIO, EUR, hours).triggered).toBe(true);
    expect(rateMixSignal(0.0299, EUR, hours).triggered).toBe(false);
  });
  it("fires on differing ratings alone, as a warning", () => {
    expect(rateMixSignal(0, EUR, hoursForecast(1_450, 220))).toEqual({ triggered: true, direction: "hours-worse", severity: "warning" });
  });
  it("never fires without both pace forecasts", () => {
    const noPace = computeForecastFromFacts({ ...facts(2_000, 1_450, 1_240, 1, 220), dated: [] });
    expect(rateMixSignal(0.5, EUR, noPace)).toEqual({ triggered: false, direction: null, severity: null });
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/app/budget-rate-mix.test.ts > <scratch>/t4.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=1, cannot resolve `./budget-rate-mix`.

- [ ] **Step 4: Tag rate rows** — in `src/app/budget-report.ts`, add to `RateRow`:

```ts
  /** The allocation's role (role-planned bucket) or discipline (blended bucket).
   *  Read by `budget-rate-mix.ts` to group rows; nothing else relies on it. */
  roleId?: number;
  disciplineId?: number;
```

In `bucketRateRows`, add `disciplineId: a.disciplineId,` to the blended branch's object and `roleId: a.roleId,` to the role branch's object.

- [ ] **Step 5: Implement** — `src/app/budget-rate-mix.ts`:

```ts
/**
 * Rate mix (MR 3 addendum §3.2). Pure and i18n-free. € and hours forecasts
 * diverge only when the average contract rate of the hours actually booked
 * differs from the planned average. This module measures that drift over
 * HOURLY buckets (a fixed-price bucket's € actual is already an hours ratio),
 * groups rows by role or discipline, names the driver and decides whether the
 * surfaces signal it. Hours per row mirror `computeBucketReport` exactly: own
 * effective budget hours and `actualHoursIn` over the bucket's active periods.
 */
import { bucketActivePeriods, bucketRateRows, effectiveBudgetHours } from "./budget-report";
import { actualHoursIn } from "./actual-hours";
import { roleLabel } from "./resource-foundation";
import { isPaceAvailable, paceVacHealth, type BudgetForecast } from "./budget-forecast";
import type { Absence, BudgetBucket, Discipline, Grade, Resource, ResourcePlan, Role } from "./types";

export const RATE_DRIFT_SIGNAL_RATIO = 0.03;
export const RATE_MIX_DRIVER_MIN_DIFFERENCE = 0.03;

export type RateMixRow = {
  key: string; kind: "role" | "discipline"; id: number; name: string; plannedRate: number | null;
  budgetHours: number; actualHours: number; plannedShare: number; bookedShare: number; difference: number;
  usedOfBudget: number | null;
};
export type RateMixSignal = {
  triggered: boolean; direction: "hours-worse" | "eur-worse" | null; severity: "warning" | "info" | null;
};
export type RateMix = RateMixSignal & {
  drift: number; bookedRate: number; plannedRate: number; budgetHours: number; actualHours: number;
  budgetValue: number; bookedValue: number; rows: readonly RateMixRow[]; driver: RateMixRow | null;
};
export type RateMixInput = {
  buckets: readonly BudgetBucket[]; roles: readonly Role[]; disciplines: readonly Discipline[]; grades: readonly Grade[];
  plan: ResourcePlan; resources: readonly Resource[]; workdayHours: number; holidaySet: ReadonlySet<string>;
  absences: readonly Absence[]; eur: BudgetForecast; hours: BudgetForecast;
};

const QUIET: RateMixSignal = { triggered: false, direction: null, severity: null };

/** Trigger (§3.2): both pace forecasts available AND (|drift| ≥ 3% OR the €
 *  and hours pace VAC ratings differ). Severity is a warning only when the
 *  ratings differ. */
export function rateMixSignal(drift: number, eur: BudgetForecast, hours: BudgetForecast): RateMixSignal {
  if (!isPaceAvailable(eur.pace) || !isPaceAvailable(hours.pace) || eur.facts.bac <= 0 || hours.facts.bac <= 0) return QUIET;
  const ragDiffers = paceVacHealth(eur.pace.vac, eur.facts.bac) !== paceVacHealth(hours.pace.vac, hours.facts.bac);
  if (Math.abs(drift) < RATE_DRIFT_SIGNAL_RATIO && !ragDiffers) return QUIET;
  const hoursWorse = hours.pace.vac / hours.facts.bac < eur.pace.vac / eur.facts.bac;
  return { triggered: true, direction: hoursWorse ? "hours-worse" : "eur-worse", severity: ragDiffers ? "warning" : "info" };
}

type Group = { kind: "role" | "discipline"; id: number; budgetHours: number; actualHours: number; budgetValue: number };

export function computeRateMix(input: RateMixInput): RateMix | null {
  const { buckets, roles, disciplines, grades, plan, resources, workdayHours, holidaySet, absences, eur, hours } = input;
  const budgetFollowsPlan = plan.budgetFollowsPlan ?? false;
  const resourcesById = new Map(resources.map((r) => [r.id, r] as const));
  const groups = new Map<string, Group>();
  let budgetHours = 0;
  let actualHours = 0;
  let budgetValue = 0;
  let bookedValue = 0;
  for (const bucket of buckets) {
    if (bucket.type === "fixed") continue;
    const periods = bucketActivePeriods(bucket, plan);
    for (const row of bucketRateRows(bucket, roles)) {
      const kind = row.roleId !== undefined ? "role" : row.disciplineId !== undefined ? "discipline" : null;
      if (kind === null) continue;
      const id = kind === "role" ? (row.roleId as number) : (row.disciplineId as number);
      // Mirrors computeBucketReport's per-row sums (Step 1); the parity test pins it.
      let bh = 0;
      let ah = 0;
      for (const p of periods) {
        bh += effectiveBudgetHours(row, p, periods, resources, workdayHours, holidaySet, plan.granularity, absences, budgetFollowsPlan, resourcesById);
        ah += actualHoursIn(row.actualHours, p.key);
      }
      const external = row.rates.external;
      const key = `${kind}:${id}`;
      const g = groups.get(key) ?? { kind, id, budgetHours: 0, actualHours: 0, budgetValue: 0 };
      g.budgetHours += bh;
      g.actualHours += ah;
      g.budgetValue += bh * external;
      groups.set(key, g);
      budgetHours += bh;
      actualHours += ah;
      budgetValue += bh * external;
      bookedValue += ah * external;
    }
  }
  if (!(budgetHours > 0) || !(actualHours > 0) || !(budgetValue > 0)) return null;
  const plannedRate = budgetValue / budgetHours;
  const bookedRate = bookedValue / actualHours;
  const drift = bookedRate / plannedRate - 1;
  const rows: RateMixRow[] = [...groups.entries()].map(([key, g]) => {
    const plannedShare = g.budgetHours / budgetHours;
    const bookedShare = g.actualHours / actualHours;
    const name = g.kind === "role"
      ? roleLabel(roles.find((r) => r.id === g.id), disciplines, grades) || "—"
      : disciplines.find((d) => d.id === g.id)?.name ?? "—";
    return {
      key, kind: g.kind, id: g.id, name,
      plannedRate: g.budgetHours > 0 ? g.budgetValue / g.budgetHours : null,
      budgetHours: g.budgetHours, actualHours: g.actualHours,
      plannedShare, bookedShare, difference: bookedShare - plannedShare,
      usedOfBudget: g.budgetHours > 0 ? g.actualHours / g.budgetHours : null,
    };
  });
  const driver = rows
    .filter((r) => r.difference >= RATE_MIX_DRIVER_MIN_DIFFERENCE - 1e-9)
    .reduce<RateMixRow | null>((best, r) => (best === null || r.difference > best.difference ? r : best), null);
  return {
    drift, bookedRate, plannedRate, budgetHours, actualHours, budgetValue, bookedValue, rows, driver,
    ...rateMixSignal(drift, eur, hours),
  };
}
```

If Step 1 showed `computeBucketReport` sums actual hours over a different key list than `periods.map((p) => p.key)`, mirror that list instead; keep the parity test unchanged.

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run src/app/budget-rate-mix.test.ts > <scratch>/t4.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0, `Test Files 1 passed`.

- [ ] **Step 7: MIGRATE existing `bucketRateRows` expectations** — run the files the Files grep found; where a `toEqual` now misses `roleId`/`disciplineId`, add the field to the expected object (never loosen to `toMatchObject`).

Run: `npx vitest run <those files> > <scratch>/t4b.log 2>&1; echo "EXIT=$?"` — Expected: EXIT=0.

- [ ] **Step 8: Mutation-check** — (a) remove the `bucket.type === "fixed"` skip: "excludes fixed-price buckets" fails; (b) change `< RATE_DRIFT_SIGNAL_RATIO` to `<=`: "fires at exactly the drift threshold" fails; (c) swap `"warning" : "info"`: the cheaper-roles scenario fails. Revert each.

- [ ] **Step 9: Typecheck, lint, commit**

```bash
npx tsc --noEmit > <scratch>/tsc.log 2>&1; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/budget-rate-mix.ts src/app/budget-rate-mix.test.ts src/app/budget-report.ts; echo "EXIT=$?"
git add src/app/budget-rate-mix.ts src/app/budget-rate-mix.test.ts src/app/budget-report.ts
git commit -m "feat(forecast): rate-mix engine — drift, role mix, driver and trigger"
```

(Add any migrated test files to the `git add`.)

---

### Task 5: Forecast bundle and wiring (no visual change)

**Files:**
- Create: `src/app/budget-forecasts.ts`, `src/app/budget-forecasts.test.ts`
- Modify: `src/app/dashboard.ts`, `src/app/dashboard-panel.tsx`, `src/app/budget-report-panel.tsx`, `src/app/workspace-section.tsx`, `src/app/reports.tsx`
- Test: `src/app/dashboard.test.ts`; any test building a full `DashboardModel` literal that tsc flags

**Interfaces:**
- Consumes: `computeBudgetForecastsByUnit` (Task 1), `actualPointDates` (Task 2), `computeEvHistory`/`EvHistory` (Task 3), `computeRateMix`/`RateMix` (Task 4).
- Produces:

```ts
// budget-forecasts.ts
export type ForecastBundle = { eur: BudgetForecast; hours: BudgetForecast; mix: RateMix | null; evHistory: EvHistory };
export type ForecastBundleInput = BudgetForecastInput & {
  tasks: readonly Pick<Task, "id" | "status" | "completedDate">[];
  resources: readonly Resource[]; workdayHours: number; absences: readonly Absence[];
  disciplines: readonly Discipline[]; grades: readonly Grade[];
};
export function computeForecastBundle(input: ForecastBundleInput): ForecastBundle
```

- `DashboardEntities` gains `disciplines?: readonly Discipline[]; grades?: readonly Grade[];` (defaulted to `[]` by `buildDashboardInput`).
- `DashboardModel` gains `forecastBundle: ForecastBundle | null;` and `chartDates: { today: string; planEnd: string };`. `forecast` stays and is `forecastBundle?.eur ?? null`.
- `DashboardPanel` props gain `disciplines?: readonly Discipline[]; grades?: readonly Grade[];`.
- `BudgetReportPanel` props gain `grades?: readonly Grade[];` and the component holds `bundle: ForecastBundle` (Tasks 9 and 13 read it).

- [ ] **Step 1: Write the failing bundle test** — `src/app/budget-forecasts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeForecastBundle, type ForecastBundleInput } from "./budget-forecasts";
import { computeBudgetForecastsByUnit } from "./budget-forecast";
import { computeBudgetReport } from "./budget-report";
import { computeBurndownSeries } from "./budget-burndown";
import type { BudgetBucket, ResourcePlan, Role } from "./types";

const none = new Set<string>();
const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const roles = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 60, externalRate: 100 } as Role];
const today = "2026-09-14";
function input(buckets: BudgetBucket[]): ForecastBundleInput {
  const report = computeBudgetReport(buckets, plan, roles, [], 8, none, [], [], null);
  const burndown = computeBurndownSeries(buckets, plan, roles, [], 8, none, [], today, null);
  return {
    report, buckets, roles, fxRates: null, tasks: [], plan, burndown, holidaySet: none, today,
    resources: [], workdayHours: 8, absences: [], disciplines: [{ id: 1, name: "Dev" }], grades: [{ id: 1, name: "Senior" }],
  };
}
const bucket = {
  id: 1, name: "B1", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
  allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: { "2026-06-10": 8 } }],
} as BudgetBucket;

describe("computeForecastBundle", () => {
  it("carries the by-unit forecasts unchanged", () => {
    const inp = input([bucket]);
    const b = computeForecastBundle(inp);
    expect({ eur: b.eur, hours: b.hours }).toEqual(computeBudgetForecastsByUnit(inp));
  });
  it("attaches the rate mix and the earned-value history", () => {
    const b = computeForecastBundle(input([bucket]));
    expect(b.mix?.rows[0].name).toBe("Dev Senior");
    expect(b.evHistory).toEqual({ available: false, reason: "no-linked-tasks", buckets: [{ id: 1, name: "B1" }] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/budget-forecasts.test.ts > <scratch>/t5.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=1, cannot resolve `./budget-forecasts`.

- [ ] **Step 3: Implement** — `src/app/budget-forecasts.ts`:

```ts
/**
 * Forecast bundle (MR 3 addendum §3). One call builds the € and hours
 * forecasts, the rate mix and the earned-value history from the inputs the
 * Budget report and the dashboard already hold. A separate module because
 * `budget-rate-mix.ts` and `budget-ev-history.ts` import from
 * `budget-forecast.ts` (plan Ruling 2 — no import cycle).
 */
import { computeBudgetForecastsByUnit, type BudgetForecast, type BudgetForecastInput } from "./budget-forecast";
import { actualPointDates } from "./budget-burndown";
import { computeEvHistory, type EvHistory } from "./budget-ev-history";
import { computeRateMix, type RateMix } from "./budget-rate-mix";
import type { Absence, Discipline, Grade, Resource, Task } from "./types";

export type ForecastBundle = { eur: BudgetForecast; hours: BudgetForecast; mix: RateMix | null; evHistory: EvHistory };
export type ForecastBundleInput = BudgetForecastInput & {
  tasks: readonly Pick<Task, "id" | "status" | "completedDate">[];
  resources: readonly Resource[]; workdayHours: number; absences: readonly Absence[];
  disciplines: readonly Discipline[]; grades: readonly Grade[];
};

export function computeForecastBundle(input: ForecastBundleInput): ForecastBundle {
  const { eur, hours } = computeBudgetForecastsByUnit(input);
  const mix = computeRateMix({
    buckets: input.buckets, roles: input.roles, disciplines: input.disciplines, grades: input.grades,
    plan: input.plan, resources: input.resources, workdayHours: input.workdayHours,
    holidaySet: input.holidaySet, absences: input.absences, eur, hours,
  });
  const evHistory = computeEvHistory({
    report: input.report, buckets: input.buckets, tasks: input.tasks,
    dates: actualPointDates(input.burndown, input.today), today: input.today,
  });
  return { eur, hours, mix, evHistory };
}
```

- [ ] **Step 4: Run the bundle test** — same command as Step 2. Expected: EXIT=0, 2 tests.

- [ ] **Step 5: Wire the dashboard model** — in `src/app/dashboard.ts`:
  1. Add `disciplines?: readonly Discipline[]; grades?: readonly Grade[];` to `DashboardEntities` (import the types).
  2. In `buildDashboardInput`, add `disciplines: e.disciplines ?? [], grades: e.grades ?? [],` beside `changes: e.changes ?? []`.
  3. Replace the `const forecast: BudgetForecast | null = report && burndown ? computeBudgetForecast({...}) : null;` block with:

```ts
  const forecastBundle: ForecastBundle | null = report && burndown
    ? computeForecastBundle({
        report, buckets: input.budgets, roles: input.roles, fxRates: input.fxRates,
        tasks: input.tasks, plan: input.plan, burndown, holidaySet, today,
        resources: input.resources, workdayHours: input.workdayHours, absences: input.absences,
        disciplines: input.disciplines, grades: input.grades,
      })
    : null;
  // The budget RAG and the tile headline stay € only (addendum §3.3).
  const forecast: BudgetForecast | null = forecastBundle?.eur ?? null;
```

  4. Add to `DashboardModel` (next to `forecast`):

```ts
  /** € + hours forecasts, rate mix and earned-value history (MR 3). `forecast`
   *  above is `forecastBundle.eur`. Null exactly when `forecast` is. */
  forecastBundle: ForecastBundle | null;
  /** Dates the burn-down chart needs beyond the series (MR 3 date axis). */
  chartDates: { today: string; planEnd: string };
```

  5. In the returned model add `forecastBundle,` and `chartDates: { today, planEnd: input.plan.endDate },`.
  6. Remove the now-unused `computeBudgetForecast` import if lint flags it.

- [ ] **Step 6: Thread disciplines and grades**
  - `src/app/dashboard-panel.tsx`: add `disciplines?: readonly Discipline[]; grades?: readonly Grade[];` to `DashboardPanelProps` and pass `disciplines: props.disciplines, grades: props.grades,` in the `buildDashboardInput` entities object (beside `roles: props.roles`).
  - `src/app/workspace-section.tsx`: on the `<DashboardPanel` element add `disciplines={disciplines}` and `grades={grades}`; on the `<BudgetReportPanel` element add `grades={grades}` (both names are already destructured from `workspace`).
  - `src/app/reports.tsx`: on the `budget-report` `<BudgetReportPanel` element add `grades={grades}`.
  - `src/app/budget-report-panel.tsx`: add `grades?: readonly Grade[];` to `Props` (default `grades = []` in the destructuring), import `computeForecastBundle`, and replace the `forecast` memo:

```tsx
  const bundle = useMemo(
    () => computeForecastBundle({
      report, buckets, roles, fxRates, tasks, plan, burndown, holidaySet, today,
      resources, workdayHours, absences, disciplines, grades,
    }),
    [report, buckets, roles, fxRates, tasks, plan, burndown, holidaySet, today, resources, workdayHours, absences, disciplines, grades],
  );
  const forecast = bundle.eur;
```

  If `grades = []` as a destructuring default makes a new array each render and lint or the memo deps complain, hoist a module-level `const NO_GRADES: readonly Grade[] = [];` and default to it.

- [ ] **Step 7: Add the dashboard model test** — in `src/app/dashboard.test.ts`, inside the `describe` that declares `bucketA` and `bucketB` (the bucket-chain tests, which call `computeDashboard(baseInput({ budgets }))`), add after its last test:

```ts
  it("carries the forecast bundle (MR 3) and keeps forecast as its € member", () => {
    const m = computeDashboard(baseInput({ budgets: [bucketA, bucketB] }));
    expect(m.forecastBundle).not.toBeNull();
    expect(m.forecast).toBe(m.forecastBundle!.eur);
    expect(m.forecastBundle!.hours.facts.bac).toBe(m.burn!.budgetHours);
    expect(m.chartDates).toEqual({ today: "2026-06-02", planEnd: "2026-12-31" });
  });

  it("has no forecast bundle without budgets", () => {
    expect(computeDashboard(baseInput()).forecastBundle).toBeNull();
  });
```

Before running, confirm the `baseInput` in scope builds `today: "2026-06-02"` and a plan ending `"2026-12-31"`; if it builds other dates, assert those.

- [ ] **Step 8: Typecheck and fix model literals** — run tsc; add `forecastBundle: null, chartDates: { today: "…", planEnd: "…" }` to any full `DashboardModel` object literal it flags (casts via `as unknown as` need nothing).

Run: `npx tsc --noEmit > <scratch>/tsc.log 2>&1; echo "EXIT=$?"` — Expected: no `src/` errors.

- [ ] **Step 9: Run the affected tests**

Run: `npx vitest run src/app/budget-forecasts.test.ts src/app/dashboard.test.ts src/app/dashboard-panel.test.tsx src/app/budget-report-panel.test.tsx > <scratch>/t5.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0, `Test Files 4 passed` (plus any file you edited in Step 8, named in the command).

- [ ] **Step 10: Lint and commit**

```bash
npx eslint --max-warnings=0 src/app/budget-forecasts.ts src/app/budget-forecasts.test.ts src/app/dashboard.ts src/app/dashboard-panel.tsx src/app/budget-report-panel.tsx src/app/workspace-section.tsx src/app/reports.tsx src/app/dashboard.test.ts; echo "EXIT=$?"
git add src/app/budget-forecasts.ts src/app/budget-forecasts.test.ts src/app/dashboard.ts src/app/dashboard-panel.tsx src/app/budget-report-panel.tsx src/app/workspace-section.tsx src/app/reports.tsx src/app/dashboard.test.ts
git commit -m "feat(forecast): forecast bundle on the dashboard model and the Budget report"
```

---

### Task 6: `InfoTooltip` custom trigger

**Files:**
- Modify: `src/app/info-tooltip.tsx`
- Test: `src/app/info-tooltip.test.tsx` (existing tests stay unchanged; add a `describe`)

**Interfaces:**
- Produces: `InfoTooltip` accepts either `{ text; label?; children?: undefined }` (unchanged "i" trigger) or `{ text; label: string; children: ReactNode }` (the children render inside the same focusable `role="button"` trigger, keeping `data-info-tooltip-trigger`).

- [ ] **Step 1: Write the failing tests** — append to `src/app/info-tooltip.test.tsx` (add `act` to its Testing Library import if missing):

```tsx
describe("custom trigger (children)", () => {
  const name = "Effort worse than € at current pace — why?";

  it("renders the children inside the one focusable trigger, named by label", () => {
    render(<InfoTooltip text="because" label={name}><span>Effort worse than €</span></InfoTooltip>);
    const trigger = screen.getByRole("button", { name });
    expect(trigger).toHaveTextContent("Effort worse than €");
    expect(trigger).toHaveAttribute("data-info-tooltip-trigger");
    expect(trigger.className).not.toContain("h-4");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("keeps the visible text inside the accessible name (label-in-name)", () => {
    render(<InfoTooltip text="because" label={name}><span>Effort worse than €</span></InfoTooltip>);
    const trigger = screen.getByRole("button", { name });
    expect(trigger.getAttribute("aria-label")).toContain(trigger.textContent ?? "");
  });

  it("opens on pointer enter and on focus, and closes on Escape", () => {
    render(<InfoTooltip text="because" label={name}><span>Effort worse than €</span></InfoTooltip>);
    const trigger = screen.getByRole("button", { name });
    fireEvent.pointerEnter(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent("because");
    fireEvent.pointerLeave(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => trigger.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent("because");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("requires a label with a custom trigger (type-level)", () => {
    // @ts-expect-error — `label` is required when `children` is given
    const element = <InfoTooltip text="x"><span>y</span></InfoTooltip>;
    expect(element).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/info-tooltip.test.tsx > <scratch>/t6.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=1 — the trigger renders "i", not the children. (The type-level test is checked by tsc in Step 5, not by vitest.)

- [ ] **Step 3: Implement** — in `src/app/info-tooltip.tsx`:

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";

type InfoTooltipProps =
  | {
      /** Already-translated tooltip text. Empty → renders nothing. */
      text: string;
      /** Accessible label for the trigger; defaults to `text`. */
      label?: string;
      children?: undefined;
    }
  | {
      text: string;
      /** Required with a custom trigger, and it must CONTAIN the trigger's
       *  visible text (WCAG 2.5.3 label-in-name). */
      label: string;
      /** Custom trigger content (e.g. a `Badge` chip), rendered inside the one
       *  focusable trigger instead of the "i" glyph (MR 3, plan Ruling 8). */
      children: ReactNode;
    };

const ICON_TRIGGER_CLASS =
  "flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line text-[10px] font-semibold normal-case leading-none text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ui-green";
const CUSTOM_TRIGGER_CLASS =
  "inline-flex cursor-help items-center rounded-full focus:outline-none focus:ring-2 focus:ring-ui-green";

export function InfoTooltip({ text, label, children }: InfoTooltipProps) {
```

Keep the body unchanged except the trigger `<span>`: set `className={children === undefined ? ICON_TRIGGER_CLASS : CUSTOM_TRIGGER_CLASS}` and replace its literal `i` child with `{children === undefined ? "i" : children}`. `ICON_TRIGGER_CLASS` must be byte-identical to the class string it replaces.

- [ ] **Step 4: Run to verify they pass** — same command. Expected: EXIT=0, all pre-existing tests plus 4 new.

- [ ] **Step 5: Typecheck (pins the type-level test), lint, commit**

```bash
npx tsc --noEmit > <scratch>/tsc.log 2>&1; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/info-tooltip.tsx src/app/info-tooltip.test.tsx; echo "EXIT=$?"
git add src/app/info-tooltip.tsx src/app/info-tooltip.test.tsx
git commit -m "feat(ui): InfoTooltip accepts a custom trigger"
```

Mutation-check the type pin: delete `label: string;` from the second union member, rerun tsc, confirm an "Unused '@ts-expect-error' directive" error, revert.

---

### Task 7: Strings, formatters, sentence builders and shared fixtures

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`, `src/app/forecast-format.ts`, `src/app/forecast-format.test.ts`
- Create: `src/app/budget-rate-mix-text.ts`, `src/app/budget-rate-mix-text.test.ts`, `src/test/forecast-fixtures.ts`

**Interfaces:**
- Consumes: `RateMix`, `RateMixRow`, `RATE_DRIFT_SIGNAL_RATIO` (Task 4); `BudgetForecast`, `isPaceAvailable` (existing).
- Produces:

```ts
// forecast-format.ts
export function formatHours(hours: number, locale: string): string        // "2,209 h"
export function formatShare(ratio: number, locale: string): string        // "37%"
// budget-rate-mix-text.ts
export function rateMixExplanation(lang: Lang, mix: RateMix, eur: BudgetForecast, hours: BudgetForecast): string
export function rateMixBannerText(lang: Lang, mix: RateMix, eur: BudgetForecast, hours: BudgetForecast): string
export function rateMixChipText(lang: Lang, mix: RateMix): string
export function rateMixChipName(lang: Lang, mix: RateMix, card: "pace" | "efficiency"): string
export function rateMixTileChipText(lang: Lang, mix: RateMix, hours: BudgetForecast): string
export function rateMixWhyName(lang: Lang, visibleText: string): string
export function rateMixPoints(lang: Lang, difference: number): string   // "+7 pts"
export function rateFactValue(lang: Lang, mix: RateMix): string
export function rateFactTip(lang: Lang, mix: RateMix): string
// src/test/forecast-fixtures.ts
export const EUR_FORECAST: BudgetForecast;
export const HOURS_FORECAST_HOURS_WORSE: BudgetForecast;   // 1,450 h booked, 220 h in window
export const HOURS_FORECAST_EUR_WORSE: BudgetForecast;     // 1,350 h booked, 205 h in window
export const MIX_HOURS_WORSE: RateMix;
export const MIX_EUR_WORSE: RateMix;
export const MIX_ON_PLAN: RateMix;
export const EV_HISTORY: EvHistory;
export const BUNDLE_HOURS_WORSE: ForecastBundle;
```

- [ ] **Step 1: Add the keys.** EN with the Edit tool, inserted immediately after the line `  forecastTileRunsOut: "runs out {0}",` in `src/app/i18n.ts`. DE with one Node script, inserted after `  forecastTileRunsOut: "aufgebraucht am {0}",\r\n` in `src/app/i18n.de.ts`:

```js
// <scratch>/add-mr3-de.mjs — run with `node <scratch>/add-mr3-de.mjs` from the worktree root
import { readFileSync, writeFileSync } from "node:fs";
const p = "src/app/i18n.de.ts";
const s = readFileSync(p, "utf8");
const anchor = '  forecastTileRunsOut: "aufgebraucht am {0}",\r\n';
if (s.split(anchor).length !== 2) throw new Error("anchor not unique");
const lines = [ /* one `  key: "DE text",` entry per table row, in table order */ ];
writeFileSync(p, s.replace(anchor, anchor + lines.map((l) => l + "\r\n").join("")), "utf8");
console.log("inserted", lines.length);
```

Straight ASCII double quotes around each value; re-read the inserted block with the Read tool and confirm the umlauts.

| Key | EN | DE |
|---|---|---|
| `forecastInHours` | In hours | In Stunden |
| `forecastEacHours` | EAC in hours | EAC in Stunden |
| `forecastVacHours` | VAC in hours | VAC in Stunden |
| `forecastRunOutHours` | Runs out (hours) | Aufgebraucht (Stunden) |
| `forecastCpiHours` | CPI (hours) | CPI (Stunden) |
| `forecastTipCpiHours` | CPI in hours: earned budget hours {0} ÷ booked hours {1} = {2}. It compares bucket hours, not task effort. | CPI in Stunden: verdiente Budgetstunden {0} ÷ gebuchte Stunden {1} = {2}. Verglichen werden Budgetstunden, nicht Aufgabenaufwand. |
| `forecastMixChipHoursWorse` | Effort worse than € | Aufwand schlechter als € |
| `forecastMixChipEurWorse` | € worse than effort | € schlechter als Aufwand |
| `forecastMixChipNamePace` | {0} at current pace — why? | {0} beim aktuellen Tempo – warum? |
| `forecastMixChipNameEfficiency` | {0} at current efficiency — why? | {0} bei aktueller Effizienz – warum? |
| `forecastMixWhy` | {0} — why? | {0} – warum? |
| `forecastMixLeadWarning` | Warning: | Warnung: |
| `forecastMixLeadNote` | Note: | Hinweis: |
| `forecastMixHeadHoursWorse` | the hours tell a worse story than the budget. | die Stunden zeichnen ein schlechteres Bild als das Budget. |
| `forecastMixHeadEurWorse` | the budget tells a worse story than the hours. | das Budget zeichnet ein schlechteres Bild als die Stunden. |
| `forecastMixDriver` | {0}: {1} of the booked hours (planned {2}), | {0}: {1} der gebuchten Stunden (geplant {2}), |
| `forecastMixRateAfterDriver` | so hours cost {0}/h on average instead of {1}/h. | daher kostet eine Stunde im Schnitt {0}/h statt {1}/h. |
| `forecastMixRate` | Hours cost {0}/h on average instead of {1}/h. | Eine Stunde kostet im Schnitt {0}/h statt {1}/h. |
| `forecastMixPaceHoursWorse` | At current pace the hours show {0}; the budget shows {1}. | Beim aktuellen Tempo zeigen die Stunden {0}, das Budget {1}. |
| `forecastMixPaceEurWorse` | At current pace the budget shows {0}; the hours show only {1}. The difference is in rate, not in hours. | Beim aktuellen Tempo zeigt das Budget {0}, die Stunden nur {1}. Der Unterschied liegt im Satz, nicht in den Stunden. |
| `forecastMixTileHoursWorse` | Hours {0} · runs out {1} | Stunden {0} · aufgebraucht am {1} |
| `forecastMixTileHoursWorseNoRunOut` | Hours {0} | Stunden {0} |
| `forecastMixTileEurWorse` | Hours only {0} — the overrun is in rate | Stunden nur {0} – die Überschreitung liegt im Satz |
| `forecastMixAction` | Where the hours went | Wohin die Stunden gingen |
| `forecastMixSummary` | Share of booked hours by role compared with the plan | Anteil der gebuchten Stunden je Rolle im Vergleich zum Plan |
| `forecastMixColRole` | Role or discipline | Rolle oder Disziplin |
| `forecastMixColRate` | Planned rate | Geplanter Satz |
| `forecastMixColPlanned` | Planned share | Geplanter Anteil |
| `forecastMixColBooked` | Booked share | Gebuchter Anteil |
| `forecastMixColDifference` | Difference | Differenz |
| `forecastMixColUsed` | Hours used of budget | Verbrauchte Stunden vom Budget |
| `forecastMixPoints` | {0} pts | {0} Pkt. |
| `forecastMixUsed` | {0} of {1} ({2}) | {0} von {1} ({2}) |
| `forecastMixDriverBadge` | Driver | Treiber |
| `forecastMixOnPlan` | No role is {0} points or more off its planned share. | Keine Rolle weicht um {0} Punkte oder mehr von ihrem geplanten Anteil ab. |
| `forecastFactRate` | Avg rate booked | Ø gebuchter Satz |
| `forecastRatePerHour` | {0}/h | {0}/h |
| `forecastRateDrift` | {0}/h, {1} vs plan | {0}/h, {1} ggü. Plan |
| `forecastRateOnPlan` | {0}/h, on plan | {0}/h, im Plan |
| `forecastTipRate` | Contract value of the hours booked so far ÷ those hours: {0} ÷ {1} = {2}/h. Planned average: {3} ÷ {4} = {5}/h. When the two differ, the € and hours forecasts tell different stories. | Vertragswert der bisher gebuchten Stunden ÷ diese Stunden: {0} ÷ {1} = {2}/h. Geplanter Durchschnitt: {3} ÷ {4} = {5}/h. Weichen beide ab, erzählen die €- und die Stundenprognose Unterschiedliches. |
| `burndownViewLabel` | Chart orientation | Diagrammausrichtung |
| `burndownViewBurndown` | Burn-down | Burn-down |
| `burndownViewCumulative` | Cumulative | Kumuliert |
| `burndownUnitLabel` | Chart unit | Diagrammeinheit |
| `burndownUnitEur` | € | € |
| `burndownUnitHours` | Hours | Stunden |
| `burndownValueCumulative` | Spend, cumulative | Ausgaben, kumuliert |
| `burndownHoursCumulative` | Hours, cumulative | Stunden, kumuliert |
| `burndownEv` | Earned value (today) | Earned Value (heute) |
| `burndownEvHistory` | Earned value | Earned Value |
| `burndownPlanEnd` | Plan end | Planende |
| `burndownOver` | over | über |
| `burndownWorkLeft` | work left {0} | offene Arbeit {0} |
| `burndownBac` | BAC {0} | BAC {0} |
| `burndownFrameNote` | Chart totals differ from the forecast figures (fixed-price or bucket window); the figures above are authoritative. | Die Diagrammsummen weichen von den Prognosewerten ab (Festpreis oder Budgetzeitraum); maßgeblich sind die Werte oben. |
| `burndownEvHistoryUnavailable` | Earned value over time needs task-linked budget buckets. Hand-entered % complete or no linked tasks: {0}. | Earned Value im Zeitverlauf braucht Budgetposten mit verknüpften Aufgaben. Manueller Fertigstellungsgrad oder keine verknüpften Aufgaben: {0}. |
| `burndownTipEvHistory` | Earned value over time, from the dates the linked tasks were completed. Today's task links and budget are applied to the past, so a relinked or reopened task changes earlier points. | Earned Value im Zeitverlauf, aus den Abschlussdaten der verknüpften Aufgaben. Heutige Verknüpfungen und Budgets gelten rückwirkend; eine neu verknüpfte oder wieder geöffnete Aufgabe ändert frühere Punkte. |
| `burndownAria` | {0} in {1}. | {0} in {1}. |
| `burndownAriaRunOut` | Runs out {0} at current pace. | Beim aktuellen Tempo aufgebraucht am {0}. |
| `burndownAriaEnd` | At plan end: {0} at current pace, {1} at current efficiency. | Zum Planende: {0} beim aktuellen Tempo, {1} bei aktueller Effizienz. |
| `burndownAriaEndPace` | At plan end: {0} at current pace. | Zum Planende: {0} beim aktuellen Tempo. |

- [ ] **Step 2: Write the failing formatter tests** — append to `src/app/forecast-format.test.ts` (add the two names to its import):

```ts
describe("formatHours / formatShare (MR 3)", () => {
  it("formats whole hours with a unit", () => {
    expect(formatHours(2_208.6, "en-US")).toBe("2,209 h");
    expect(formatHours(2_208.6, "de-DE")).toBe("2.209 h");
  });
  it("formats a share as a whole percent", () => {
    expect(formatShare(539 / 1_450, "en-US")).toBe("37%");
  });
});
```

- [ ] **Step 3: Implement the formatters** — append to `src/app/forecast-format.ts`:

```ts
/** Whole hours with a thin unit suffix, in the viewer's locale: "2,209 h". */
export function formatHours(hours: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(hours)} h`;
}

/** A 0–1 share as a whole percent: "37%". */
export function formatShare(ratio: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(ratio);
}
```

If `de-DE` prints a different percent spacing, keep the implementation and assert what `Intl` prints (Ruling 10 of the MR 2 plan).

- [ ] **Step 4: Create the shared fixtures** — `src/test/forecast-fixtures.ts`:

```ts
// Shared forecast fixtures for MR 3 UI tests — the spec §7 scenarios, built
// through the real core so every figure is one the engine can produce.
import { computeForecastFromFacts, type BudgetForecast, type DatedValue, type ForecastFacts } from "../app/budget-forecast";
import { workingDaysBefore } from "../app/working-days";
import type { RateMix, RateMixRow } from "../app/budget-rate-mix";
import type { EvHistory } from "../app/budget-ev-history";
import type { ForecastBundle } from "../app/budget-forecasts";

const none = new Set<string>();
const day = (date: string, value: number): DatedValue => ({ date, bookedFrom: date, value, spread: false });
function facts(bac: number, ac: number, ev: number, pv: number, windowValue: number): ForecastFacts {
  return {
    bac, ac, ev, pv, bucketsMissingPercent: [],
    dated: [day("2026-01-05", ac - windowValue), ...workingDaysBefore("2026-09-14", 20, none).map((d) => day(d, windowValue / 20))],
    planEnd: "2026-12-18", today: "2026-09-14", holidaySet: none, hasFixedPrice: false,
  };
}

export const EUR_FORECAST: BudgetForecast = computeForecastFromFacts(facts(240_000, 168_000, 148_800, 176_000, 27_000));
export const HOURS_FORECAST_HOURS_WORSE: BudgetForecast = computeForecastFromFacts(facts(2_000, 1_450, 1_240, 176_000 / 120, 220));
export const HOURS_FORECAST_EUR_WORSE: BudgetForecast = computeForecastFromFacts(facts(2_000, 1_350, 1_240, 176_000 / 120, 205));

function row(id: number, name: string, rate: number, budget: number, booked: number, totalBooked: number): RateMixRow {
  const plannedShare = budget / 2_000;
  const bookedShare = booked / totalBooked;
  return {
    key: `role:${id}`, kind: "role", id, name, plannedRate: rate, budgetHours: budget, actualHours: booked,
    plannedShare, bookedShare, difference: bookedShare - plannedShare, usedOfBudget: booked / budget,
  };
}
function mixOf(booked: [number, number, number], signal: Pick<RateMix, "triggered" | "direction" | "severity">, driverIndex: number | null): RateMix {
  const total = booked[0] + booked[1] + booked[2];
  const rows = [
    row(1, "Consultant Senior", 150, 600, booked[0], total),
    row(2, "Consultant Regular", 120, 800, booked[1], total),
    row(3, "Consultant Junior", 90, 600, booked[2], total),
  ];
  return {
    drift: (168_000 / total) / 120 - 1, bookedRate: 168_000 / total, plannedRate: 120,
    budgetHours: 2_000, actualHours: total, budgetValue: 240_000, bookedValue: 168_000,
    rows, driver: driverIndex === null ? null : rows[driverIndex], ...signal,
  };
}

export const MIX_HOURS_WORSE: RateMix = mixOf([339, 572, 539], { triggered: true, direction: "hours-worse", severity: "warning" }, 2);
export const MIX_EUR_WORSE: RateMix = mixOf([505, 540, 305], { triggered: true, direction: "eur-worse", severity: "info" }, 0);
export const MIX_ON_PLAN: RateMix = mixOf([420, 560, 420], { triggered: false, direction: null, severity: null }, null);

export const EV_HISTORY: EvHistory = {
  available: true,
  points: [
    { date: "2026-03-31", eur: 60_000, hours: 500 },
    { date: "2026-06-30", eur: 110_000, hours: 917 },
    { date: "2026-09-14", eur: 148_800, hours: 1_240 },
  ],
};

export const BUNDLE_HOURS_WORSE: ForecastBundle = {
  eur: EUR_FORECAST, hours: HOURS_FORECAST_HOURS_WORSE, mix: MIX_HOURS_WORSE, evHistory: EV_HISTORY,
};
```

- [ ] **Step 5: Write the failing sentence tests** — `src/app/budget-rate-mix-text.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { loadI18n, localeFor, t } from "./i18n";
import { formatCurrency } from "./resource-cost";
import { formatDayMonth, formatSignedPercent } from "./forecast-format";
import {
  rateMixExplanation, rateMixBannerText, rateMixChipText, rateMixChipName, rateMixTileChipText,
  rateMixWhyName, rateMixPoints, rateFactValue, rateFactTip,
} from "./budget-rate-mix-text";
import {
  EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE, HOURS_FORECAST_EUR_WORSE, MIX_HOURS_WORSE, MIX_EUR_WORSE, MIX_ON_PLAN,
} from "../test/forecast-fixtures";

const en = "en-US" as const;
const loc = localeFor(en);
const money = (n: number) => formatCurrency(n, "EUR", loc);
const pct1 = (r: number) => formatSignedPercent(r, loc, 1);

beforeAll(async () => { await loadI18n("de"); });

describe("rateMixExplanation / rateMixBannerText — hours worse", () => {
  const hoursVac = -209 / 2_000;
  const eurVac = -21_150 / 240_000;
  const explanation =
    `Consultant Junior: 37% of the booked hours (planned 30%), so hours cost ${money(168_000 / 1_450)}/h on average instead of ${money(120)}/h. ` +
    `At current pace the hours show ${pct1(hoursVac)}; the budget shows ${pct1(eurVac)}.`;

  it("names the driver, the two rates and both pace VACs", () => {
    expect(rateMixExplanation(en, MIX_HOURS_WORSE, EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE)).toBe(explanation);
  });
  it("leads the banner with Warning: and the hours-worse head", () => {
    expect(rateMixBannerText(en, MIX_HOURS_WORSE, EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE))
      .toBe(`Warning: the hours tell a worse story than the budget. ${explanation}`);
  });
});

describe("€ worse, no driver, on plan", () => {
  it("leads with Note: and the rate-not-hours sentence", () => {
    const text = rateMixBannerText(en, MIX_EUR_WORSE, EUR_FORECAST, HOURS_FORECAST_EUR_WORSE);
    expect(text.startsWith("Note: the budget tells a worse story than the hours. Consultant Senior: 37% of the booked hours (planned 30%),")).toBe(true);
    expect(text.endsWith("The difference is in rate, not in hours.")).toBe(true);
  });
  it("drops the driver clause when there is no driver", () => {
    expect(rateMixExplanation(en, MIX_ON_PLAN, EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE).startsWith("Hours cost ")).toBe(true);
  });
});

describe("chips, names, points, rate fact", () => {
  it("chip text and card-unique names", () => {
    expect(rateMixChipText(en, MIX_HOURS_WORSE)).toBe("Effort worse than €");
    expect(rateMixChipText(en, MIX_EUR_WORSE)).toBe("€ worse than effort");
    expect(rateMixChipName(en, MIX_HOURS_WORSE, "pace")).toBe("Effort worse than € at current pace — why?");
    expect(rateMixChipName(en, MIX_HOURS_WORSE, "efficiency")).toBe("Effort worse than € at current efficiency — why?");
  });
  it("tile chip text in both directions", () => {
    const hoursPace = HOURS_FORECAST_HOURS_WORSE.pace;
    if (!("runOutDate" in hoursPace) || hoursPace.runOutDate === null) throw new Error("fixture");
    expect(rateMixTileChipText(en, MIX_HOURS_WORSE, HOURS_FORECAST_HOURS_WORSE))
      .toBe(`Hours ${formatSignedPercent(-209 / 2_000, loc, 0)} · runs out ${formatDayMonth(hoursPace.runOutDate, loc)}`);
    expect(rateMixTileChipText(en, MIX_EUR_WORSE, HOURS_FORECAST_EUR_WORSE).startsWith("Hours only ")).toBe(true);
    expect(rateMixWhyName(en, "Hours −10%")).toBe("Hours −10% — why?");
  });
  it("points carry a sign and round to whole points", () => {
    expect(rateMixPoints(en, 0.0717)).toBe("+7 pts");
    expect(rateMixPoints(en, -0.0662)).toBe("−7 pts");
    expect(rateMixPoints(en, 0.004)).toBe("0 pts");
  });
  it("rate fact: drift above the threshold, on plan below it", () => {
    expect(rateFactValue(en, MIX_HOURS_WORSE)).toBe(`${money(168_000 / 1_450)}/h, ${pct1(MIX_HOURS_WORSE.drift)} vs plan`);
    expect(rateFactValue(en, MIX_ON_PLAN)).toBe(`${money(120)}/h, on plan`);
    expect(rateFactTip(en, MIX_HOURS_WORSE)).toContain(`${money(240_000)} ÷ 2,000 h = ${money(120)}/h`);
  });
});

describe("German", () => {
  it("renders the banner head and chip name from the DE dictionary", () => {
    expect(rateMixBannerText("de", MIX_HOURS_WORSE, EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE).startsWith(`${t("de", "forecastMixLeadWarning")} ${t("de", "forecastMixHeadHoursWorse")}`)).toBe(true);
    expect(rateMixChipName("de", MIX_HOURS_WORSE, "pace")).toBe("Aufwand schlechter als € beim aktuellen Tempo – warum?");
  });
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `npx vitest run src/app/forecast-format.test.ts src/app/budget-rate-mix-text.test.ts > <scratch>/t7.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=1 (`budget-rate-mix-text` missing). The formatter tests pass if Step 3 is already in place.

- [ ] **Step 7: Implement** — `src/app/budget-rate-mix-text.ts`:

```ts
/**
 * Sentences for the rate-mix signal (MR 3 addendum §4.3–§4.7). React-free.
 * ONE explanation feeds every chip tooltip, the rate fact's tooltip and the
 * role-mix footnote; the banner prefixes it with its lead word and head, so
 * the numbers agree on every surface (S6).
 */
import { type Lang, t, localeFor } from "./i18n";
import { formatCurrency } from "./resource-cost";
import { formatDayMonth, formatHours, formatShare, formatSignedPercent } from "./forecast-format";
import { isPaceAvailable, type BudgetForecast } from "./budget-forecast";
import { RATE_DRIFT_SIGNAL_RATIO, type RateMix } from "./budget-rate-mix";

function paceVacRatio(f: BudgetForecast): number | null {
  return isPaceAvailable(f.pace) && f.facts.bac > 0 ? f.pace.vac / f.facts.bac : null;
}

export function rateMixExplanation(lang: Lang, mix: RateMix, eur: BudgetForecast, hours: BudgetForecast): string {
  const locale = localeFor(lang);
  const money = (n: number) => formatCurrency(n, "EUR", locale);
  const parts: string[] = [];
  if (mix.driver) {
    parts.push(t(lang, "forecastMixDriver", mix.driver.name, formatShare(mix.driver.bookedShare, locale), formatShare(mix.driver.plannedShare, locale)));
    parts.push(t(lang, "forecastMixRateAfterDriver", money(mix.bookedRate), money(mix.plannedRate)));
  } else {
    parts.push(t(lang, "forecastMixRate", money(mix.bookedRate), money(mix.plannedRate)));
  }
  const e = paceVacRatio(eur);
  const h = paceVacRatio(hours);
  if (e !== null && h !== null && mix.direction !== null) {
    parts.push(mix.direction === "hours-worse"
      ? t(lang, "forecastMixPaceHoursWorse", formatSignedPercent(h, locale, 1), formatSignedPercent(e, locale, 1))
      : t(lang, "forecastMixPaceEurWorse", formatSignedPercent(e, locale, 1), formatSignedPercent(h, locale, 1)));
  }
  return parts.join(" ");
}

export function rateMixBannerText(lang: Lang, mix: RateMix, eur: BudgetForecast, hours: BudgetForecast): string {
  const lead = t(lang, mix.severity === "warning" ? "forecastMixLeadWarning" : "forecastMixLeadNote");
  const head = t(lang, mix.direction === "eur-worse" ? "forecastMixHeadEurWorse" : "forecastMixHeadHoursWorse");
  return `${lead} ${head} ${rateMixExplanation(lang, mix, eur, hours)}`;
}

export function rateMixChipText(lang: Lang, mix: RateMix): string {
  return t(lang, mix.direction === "eur-worse" ? "forecastMixChipEurWorse" : "forecastMixChipHoursWorse");
}

export function rateMixChipName(lang: Lang, mix: RateMix, card: "pace" | "efficiency"): string {
  return t(lang, card === "pace" ? "forecastMixChipNamePace" : "forecastMixChipNameEfficiency", rateMixChipText(lang, mix));
}

export function rateMixTileChipText(lang: Lang, mix: RateMix, hours: BudgetForecast): string {
  const locale = localeFor(lang);
  const h = formatSignedPercent(paceVacRatio(hours) ?? 0, locale, 0);
  if (mix.direction === "eur-worse") return t(lang, "forecastMixTileEurWorse", h);
  const runOut = isPaceAvailable(hours.pace) ? hours.pace.runOutDate : null;
  return runOut === null
    ? t(lang, "forecastMixTileHoursWorseNoRunOut", h)
    : t(lang, "forecastMixTileHoursWorse", h, formatDayMonth(runOut, locale));
}

export function rateMixWhyName(lang: Lang, visibleText: string): string {
  return t(lang, "forecastMixWhy", visibleText);
}

export function rateMixPoints(lang: Lang, difference: number): string {
  const points = Math.round(difference * 100);
  const text = points > 0 ? `+${points}` : points < 0 ? `−${Math.abs(points)}` : "0";
  return t(lang, "forecastMixPoints", text);
}

export function rateFactValue(lang: Lang, mix: RateMix): string {
  const locale = localeFor(lang);
  const rate = formatCurrency(mix.bookedRate, "EUR", locale);
  return Math.abs(mix.drift) >= RATE_DRIFT_SIGNAL_RATIO
    ? t(lang, "forecastRateDrift", rate, formatSignedPercent(mix.drift, locale, 1))
    : t(lang, "forecastRateOnPlan", rate);
}

export function rateFactTip(lang: Lang, mix: RateMix): string {
  const locale = localeFor(lang);
  const money = (n: number) => formatCurrency(n, "EUR", locale);
  return t(
    lang, "forecastTipRate",
    money(mix.bookedValue), formatHours(mix.actualHours, locale), money(mix.bookedRate),
    money(mix.budgetValue), formatHours(mix.budgetHours, locale), money(mix.plannedRate),
  );
}
```

If an EN expectation in Step 5 differs only because `formatCurrency` prints decimals (e.g. "€115.86"), keep the implementation: the expectations already build money through `formatCurrency`. If the literal "37%" / "30%" / "2,000 h" pieces differ, correct the test literal to what `Intl` prints and note it in the report.

- [ ] **Step 8: Run to verify they pass** — same command as Step 6, plus `src/app/i18n.test.ts` and the encoding test (find it with `ls src/app/*encoding*.test.ts`):

Run: `npx vitest run src/app/forecast-format.test.ts src/app/budget-rate-mix-text.test.ts src/app/i18n.test.ts <encoding test> > <scratch>/t7.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0, `Test Files 4 passed`.

- [ ] **Step 9: Typecheck (key parity), lint, commit**

```bash
npx tsc --noEmit > <scratch>/tsc.log 2>&1; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/forecast-format.ts src/app/forecast-format.test.ts src/app/budget-rate-mix-text.ts src/app/budget-rate-mix-text.test.ts src/test/forecast-fixtures.ts; echo "EXIT=$?"
git add src/app/i18n.ts src/app/i18n.de.ts src/app/forecast-format.ts src/app/forecast-format.test.ts src/app/budget-rate-mix-text.ts src/app/budget-rate-mix-text.test.ts src/test/forecast-fixtures.ts
git commit -m "feat(forecast): rate-mix and chart strings, hour and share formatters"
```

---

### Task 8: "In hours" lines and chips on the forecast cards

**Files:**
- Create: `src/app/budget-rate-mix-chip.tsx`
- Modify: `src/app/budget-forecast-cards.tsx`
- Test: `src/app/budget-forecast-cards.test.tsx`

**Interfaces:**
- Consumes: Task 6 `InfoTooltip` children; Task 7 `formatHours`, `rateMixChipName`, `rateMixChipText`, `rateMixExplanation`, fixtures; `Badge`.
- Produces:
  - `export function RateMixChip(props: { name: string; text: string; tip: string; direction: "hours-worse" | "eur-worse" }): JSX.Element` (reused by Task 10).
  - `ForecastCards({ lang, forecast, hours?, mix? })` — `hours?: BudgetForecast | null`, `mix?: RateMix | null`; without them the output is unchanged.

- [ ] **Step 1: Write the failing tests** — append to `src/app/budget-forecast-cards.test.tsx` (import `act`, `fireEvent` if missing):

```tsx
import { EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE, MIX_HOURS_WORSE, MIX_ON_PLAN } from "../test/forecast-fixtures";
import { rateMixExplanation } from "./budget-rate-mix-text";
import type { BudgetForecast } from "./budget-forecast";

describe("ForecastCards — In hours (MR 3)", () => {
  it("renders no hours line without hours", () => {
    render(<ForecastCards lang="en-US" forecast={EUR_FORECAST} />);
    expect(screen.queryByText("In hours")).toBeNull();
  });

  it("shows EAC, VAC and run-out in hours, and CPI (hours) on the efficiency card", () => {
    render(<ForecastCards lang="en-US" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_ON_PLAN} />);
    expect(screen.getAllByText("In hours")).toHaveLength(2);
    expect(screen.getByText("2,209 h")).toBeInTheDocument();
    expect(screen.getByText("2,339 h")).toBeInTheDocument();
    expect(screen.getByText("Nov 23, 2026")).toBeInTheDocument();
    expect(screen.getByText("CPI (hours)")).toBeInTheDocument();
    expect(screen.getByText("0.86")).toBeInTheDocument();
  });

  it("shows card-unique chips when the mix triggers, explained by the shared sentence", () => {
    render(<ForecastCards lang="en-US" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_HOURS_WORSE} />);
    const pace = screen.getByRole("button", { name: "Effort worse than € at current pace — why?" });
    expect(screen.getByRole("button", { name: "Effort worse than € at current efficiency — why?" })).toBeInTheDocument();
    expect(pace).toHaveTextContent("Effort worse than €");
    act(() => pace.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      rateMixExplanation("en-US", MIX_HOURS_WORSE, EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE),
    );
  });

  it("shows no chip when the mix does not trigger", () => {
    render(<ForecastCards lang="en-US" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_ON_PLAN} />);
    expect(screen.queryByRole("button", { name: /why\?$/ })).toBeNull();
  });

  it("hides the pace hours line when the hours pace forecast is unavailable", () => {
    const hours: BudgetForecast = { ...HOURS_FORECAST_HOURS_WORSE, pace: { unavailable: "no-burn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null } };
    render(<ForecastCards lang="en-US" forecast={EUR_FORECAST} hours={hours} mix={MIX_ON_PLAN} />);
    expect(screen.getAllByText("In hours")).toHaveLength(1);
  });
});
```

If the literal "Nov 23, 2026" or "0.86" collides with another figure on the page (`getByText` throws on duplicates), scope the query with `within(<that card's section>)`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/budget-forecast-cards.test.tsx > <scratch>/t8.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=1 (no "In hours" text; unknown props).

- [ ] **Step 3: Create the chip** — `src/app/budget-rate-mix-chip.tsx`:

```tsx
"use client";

// Rate-mix chip (MR 3 addendum §4.1): ONE control — a Badge inside the
// InfoTooltip trigger, so hovering or focusing its text or its ⓘ shows the
// shared explanation. The arrow and ⓘ are aria-hidden; `name` must contain the
// visible text (label-in-name). Not colour-only: the text says the direction.
import { InfoTooltip } from "./info-tooltip";
import { Badge } from "./badge";

export function RateMixChip({
  name, text, tip, direction,
}: {
  name: string; text: string; tip: string; direction: "hours-worse" | "eur-worse";
}) {
  const hoursWorse = direction === "hours-worse";
  return (
    <InfoTooltip text={tip} label={name}>
      <Badge
        pill
        size="sm"
        className={hoursWorse
          ? "border border-ui-pink/50 font-medium text-ui-pink-strong"
          : "border border-[var(--rag-amber)]/60 font-medium text-foreground"}
      >
        <span aria-hidden="true" className="mr-1">{hoursWorse ? "▲" : "▼"}</span>
        {text}
        <span aria-hidden="true" className="ml-1">ⓘ</span>
      </Badge>
    </InfoTooltip>
  );
}
```

- [ ] **Step 4: Add the hours lines** — in `src/app/budget-forecast-cards.tsx`:
  1. Imports: `formatHours` from `./forecast-format`; `RateMixChip` from `./budget-rate-mix-chip`; `rateMixChipName`, `rateMixChipText`, `rateMixExplanation` from `./budget-rate-mix-text`; `type RateMix` from `./budget-rate-mix`.
  2. Add helpers above `PaceCard`:

```tsx
/** One "In hours" `<dl>` row. No tooltip: the € row above explains the term (plan Ruling 16). */
function HoursRow({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="flex items-center text-muted-foreground">{term}</dt>
      <dd className="tabular-nums font-medium text-foreground">{children}</dd>
    </div>
  );
}

function HoursLine({ lang, chip, children }: { lang: Lang; chip: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-3 border-t border-dashed border-line pt-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(lang, "forecastInHours")}</p>
      <dl className="mt-1 space-y-1 text-sm">{children}</dl>
      {chip ? <div className="mt-2">{chip}</div> : null}
    </div>
  );
}

function mixChip(lang: Lang, mix: RateMix | null, eur: BudgetForecast, hours: BudgetForecast, card: "pace" | "efficiency"): ReactNode {
  if (!mix || !mix.triggered || mix.direction === null) return null;
  return (
    <RateMixChip
      name={rateMixChipName(lang, mix, card)}
      text={rateMixChipText(lang, mix)}
      tip={rateMixExplanation(lang, mix, eur, hours)}
      direction={mix.direction}
    />
  );
}
```

  3. `PaceCard` gains props `eur: BudgetForecast; hours: BudgetForecast | null; mix: RateMix | null`. Inside the `isPaceAvailable(pace)` branch, after the window-line `<p>`, add:

```tsx
          {hours && isPaceAvailable(hours.pace) && (
            <HoursLine lang={lang} chip={mixChip(lang, mix, eur, hours, "pace")}>
              <HoursRow term={t(lang, "forecastEacHours")}>{formatHours(hours.pace.eac, locale)}</HoursRow>
              <HoursRow term={t(lang, "forecastVacHours")}>
                {formatHours(hours.pace.vac, locale)} ({formatSignedPercent(hours.facts.bac > 0 ? hours.pace.vac / hours.facts.bac : 0, locale, 1)})
              </HoursRow>
              <HoursRow term={t(lang, "forecastRunOutHours")}>
                {hours.pace.runOutDate === null ? t(lang, "forecastRunOutAlready") : formatDayMonthYear(hours.pace.runOutDate, locale)}
              </HoursRow>
            </HoursLine>
          )}
```

  4. `EfficiencyCard` gains the same three props. Inside the `isEfficiencyAvailable(efficiency)` branch, after its `</dl>`, add:

```tsx
          {hours && isEfficiencyAvailable(hours.efficiency) && (
            <HoursLine lang={lang} chip={mixChip(lang, mix, eur, hours, "efficiency")}>
              <HoursRow term={t(lang, "forecastEacHours")}>{formatHours(hours.efficiency.eac, locale)}</HoursRow>
              <HoursRow term={t(lang, "forecastVacHours")}>
                {formatHours(hours.efficiency.vac, locale)} ({formatSignedPercent(hours.facts.bac > 0 ? hours.efficiency.vac / hours.facts.bac : 0, locale, 1)})
              </HoursRow>
              <HoursRow
                term={<>{t(lang, "forecastCpiHours")}<TermTooltip lang={lang} term={t(lang, "forecastCpiHours")} tip={t(lang, "forecastTipCpiHours", formatHours(hours.facts.ev ?? 0, locale), formatHours(hours.facts.ac, locale), hours.efficiency.cpi.toFixed(2))} /></>}
              >
                {hours.efficiency.cpi.toFixed(2)}
              </HoursRow>
            </HoursLine>
          )}
```

  5. `ForecastCards` becomes `({ lang, forecast, hours = null, mix = null }: { lang: Lang; forecast: BudgetForecast; hours?: BudgetForecast | null; mix?: RateMix | null })` and passes `eur={forecast} hours={hours} mix={mix}` to both cards.

- [ ] **Step 5: Run to verify they pass** — same command as Step 2. Expected: EXIT=0, all existing card tests plus 5 new.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit > <scratch>/tsc.log 2>&1; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/budget-rate-mix-chip.tsx src/app/budget-forecast-cards.tsx src/app/budget-forecast-cards.test.tsx; echo "EXIT=$?"
git add src/app/budget-rate-mix-chip.tsx src/app/budget-forecast-cards.tsx src/app/budget-forecast-cards.test.tsx
git commit -m "feat(forecast): hours lines and rate-mix chips on the forecast cards"
```

---

### Task 9: Mix banner, role-mix disclosure and the Forecast section

**Files:**
- Create: `src/app/budget-rate-mix-details.tsx`, `src/app/budget-rate-mix-details.test.tsx`, `src/app/budget-forecast-section.tsx`, `src/app/budget-forecast-section.test.tsx`
- Modify: `src/app/budget-forecast-banner.tsx`, `src/app/budget-forecast-banner.test.tsx`, `src/app/budget-report-panel.tsx`

**Interfaces:**
- Consumes: Task 5 `bundle`/`ForecastBundle`; Task 7 text builders and fixtures; Task 8 `ForecastCards` props.
- Produces:
  - `ForecastBanners({ lang, forecast, granularity, hours?, mix?, onShowMix? })`
  - `export function RateMixDetails(props: { lang: Lang; mix: RateMix; eur: BudgetForecast; hours: BudgetForecast; open: boolean; onToggle: (open: boolean) => void; focusNonce: number })`
  - `export function ForecastSection(props: { lang: Lang; bundle: ForecastBundle; granularity: PlanGranularity })`

- [ ] **Step 1: Write the failing banner tests** — append to `src/app/budget-forecast-banner.test.tsx`:

```tsx
import { EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE, HOURS_FORECAST_EUR_WORSE, MIX_HOURS_WORSE, MIX_EUR_WORSE, MIX_ON_PLAN } from "../test/forecast-fixtures";
import { rateMixBannerText } from "./budget-rate-mix-text";

describe("ForecastBanners — rate-mix banner (MR 3)", () => {
  it("renders the mix banner even when no other notice applies, as a warning", () => {
    render(<ForecastBanners lang="en-US" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_HOURS_WORSE} granularity="month" />);
    const banners = screen.getAllByRole("status");
    expect(banners).toHaveLength(1);
    expect(banners[0]).toHaveTextContent(rateMixBannerText("en-US", MIX_HOURS_WORSE, EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE));
    expect(banners[0].className).toContain("--rag-amber");
  });

  it("uses the info tint when only the drift fires", () => {
    render(<ForecastBanners lang="en-US" forecast={EUR_FORECAST} hours={HOURS_FORECAST_EUR_WORSE} mix={MIX_EUR_WORSE} granularity="month" />);
    expect(screen.getByRole("status").className).toContain("ui-dark-blue");
  });

  it("sits first, ahead of the existing notices", () => {
    const efficiency: BudgetForecast["efficiency"] = { unavailable: "needs-percent-complete", bucketsMissingPercent: [{ id: 1, name: "Design" }] };
    render(<ForecastBanners lang="en-US" forecast={{ ...EUR_FORECAST, efficiency }} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_HOURS_WORSE} granularity="month" />);
    const banners = screen.getAllByRole("status");
    expect(banners).toHaveLength(2);
    expect(banners[0]).toHaveTextContent("Warning: the hours tell a worse story");
  });

  it("renders nothing when the mix does not trigger and no notice applies", () => {
    const { container } = render(<ForecastBanners lang="en-US" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_ON_PLAN} granularity="month" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers the action only with a handler, and calls it", () => {
    const onShowMix = vi.fn();
    render(<ForecastBanners lang="en-US" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_HOURS_WORSE} granularity="month" onShowMix={onShowMix} />);
    fireEvent.click(screen.getByRole("button", { name: "Where the hours went" }));
    expect(onShowMix).toHaveBeenCalledTimes(1);
  });
});
```

(Import `vi`, `fireEvent` and `BudgetForecast` if the file does not already.)

- [ ] **Step 2: Write the failing disclosure and section tests** — `src/app/budget-rate-mix-details.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RateMixDetails } from "./budget-rate-mix-details";
import { rateMixExplanation } from "./budget-rate-mix-text";
import { EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE, MIX_HOURS_WORSE, MIX_ON_PLAN } from "../test/forecast-fixtures";

const props = { lang: "en-US" as const, eur: EUR_FORECAST, hours: HOURS_FORECAST_HOURS_WORSE, onToggle: vi.fn() };

describe("RateMixDetails", () => {
  it("is collapsed by default and lists every row with planned and booked shares", () => {
    const { container } = render(<RateMixDetails {...props} mix={MIX_HOURS_WORSE} open={false} focusNonce={0} />);
    expect(container.querySelector("details")!.open).toBe(false);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    const junior = rows[2];
    expect(within(junior).getByText("Consultant Junior")).toBeInTheDocument();
    expect(within(junior).getByText("30%")).toBeInTheDocument();
    expect(within(junior).getByText("37%")).toBeInTheDocument();
    expect(within(junior).getByText("+7 pts")).toBeInTheDocument();
    expect(within(junior).getByText("539 h of 600 h (90%)")).toBeInTheDocument();
  });

  it("marks only the driver row with the Driver badge", () => {
    render(<RateMixDetails {...props} mix={MIX_HOURS_WORSE} open focusNonce={0} />);
    expect(screen.getAllByText("Driver")).toHaveLength(1);
    expect(screen.getByText("Driver").closest("tr")).toHaveTextContent("Consultant Junior");
  });

  it("explains the mix in the footnote, or says it is on plan", () => {
    const { rerender } = render(<RateMixDetails {...props} mix={MIX_HOURS_WORSE} open focusNonce={0} />);
    expect(screen.getByText(rateMixExplanation("en-US", MIX_HOURS_WORSE, EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE))).toBeInTheDocument();
    rerender(<RateMixDetails {...props} mix={MIX_ON_PLAN} open focusNonce={0} />);
    expect(screen.getByText("No role is 3 points or more off its planned share.")).toBeInTheDocument();
  });

  it("moves focus to its summary when the focus nonce changes", () => {
    const { rerender, container } = render(<RateMixDetails {...props} mix={MIX_HOURS_WORSE} open={false} focusNonce={0} />);
    rerender(<RateMixDetails {...props} mix={MIX_HOURS_WORSE} open focusNonce={1} />);
    expect(document.activeElement).toBe(container.querySelector("summary"));
  });
});
```

`src/app/budget-forecast-section.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ForecastSection } from "./budget-forecast-section";
import { BUNDLE_HOURS_WORSE } from "../test/forecast-fixtures";

describe("ForecastSection", () => {
  it("opens the role mix from the banner and focuses its summary", () => {
    const { container } = render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" />);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Where the hours went" }));
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(container.querySelector("summary"));
  });

  it("renders the cards with their hours lines", () => {
    render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" />);
    expect(screen.getAllByText("In hours")).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/app/budget-forecast-banner.test.tsx src/app/budget-rate-mix-details.test.tsx src/app/budget-forecast-section.test.tsx > <scratch>/t9.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=1.

- [ ] **Step 4: Extend `ForecastBanners`** — in `src/app/budget-forecast-banner.tsx` import `Button` from `./button`, `rateMixBannerText` from `./budget-rate-mix-text`, `type RateMix` from `./budget-rate-mix`, and replace the component:

```tsx
export function ForecastBanners({
  lang, forecast, granularity, hours = null, mix = null, onShowMix,
}: {
  lang: Lang;
  forecast: BudgetForecast;
  granularity: PlanGranularity;
  hours?: BudgetForecast | null;
  mix?: RateMix | null;
  onShowMix?: () => void;
}) {
  const notices = forecastNotices(forecast);
  // MR 3 §4.3: the rate-mix banner goes FIRST — it changes how the cards read.
  // It cannot co-occur with a pace-unavailable notice (the trigger needs both
  // pace forecasts), but it can be the ONLY banner, so the early return below
  // must account for it.
  const mixBanner = mix && mix.triggered && hours ? (
    <Banner severity={mix.severity === "warning" ? "warn" : "info"} className="flex flex-wrap items-start gap-2">
      <span className="min-w-0 flex-1">{rateMixBannerText(lang, mix, forecast, hours)}</span>
      {onShowMix ? (
        <Button variant="secondary" size="xs" onClick={onShowMix}>{t(lang, "forecastMixAction")}</Button>
      ) : null}
    </Banner>
  ) : null;
  if (notices.length === 0 && mixBanner === null) return null;
  return (
    <div className="space-y-2">
      {mixBanner}
      {notices.map((n) => (
        <Banner key={n.kind} severity={n.severity}>
          {forecastNoticeText(n, lang, granularity)}
        </Banner>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Create the disclosure** — `src/app/budget-rate-mix-details.tsx`:

```tsx
"use client";

// "Where the hours went" (MR 3 addendum §4.4): the CAUSE behind the rate-mix
// banner. Native <details> (the house disclosure pattern), controlled so the
// banner action can open it; focus moves to the summary AFTER commit, keyed on
// a nonce — never synchronously in the click handler (plan Ruling 10).
import { useEffect, useRef } from "react";
import { type Lang, t, localeFor } from "./i18n";
import { formatCurrency } from "./resource-cost";
import { formatHours, formatShare } from "./forecast-format";
import { Badge } from "./badge";
import { rateMixExplanation, rateMixPoints } from "./budget-rate-mix-text";
import { RATE_MIX_DRIVER_MIN_DIFFERENCE, type RateMix } from "./budget-rate-mix";
import type { BudgetForecast } from "./budget-forecast";

export function RateMixDetails({
  lang, mix, eur, hours, open, onToggle, focusNonce,
}: {
  lang: Lang; mix: RateMix; eur: BudgetForecast; hours: BudgetForecast;
  open: boolean; onToggle: (open: boolean) => void; focusNonce: number;
}) {
  const summaryRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (focusNonce > 0) summaryRef.current?.focus();
  }, [focusNonce]);
  const locale = localeFor(lang);
  const money = (n: number) => formatCurrency(n, "EUR", locale);
  const headers = ["forecastMixColRole", "forecastMixColRate", "forecastMixColPlanned", "forecastMixColBooked", "forecastMixColDifference", "forecastMixColUsed"] as const;
  return (
    <details
      open={open}
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
      className="rounded-md border border-line"
    >
      <summary ref={summaryRef} className="cursor-pointer px-3 py-1.5 text-sm font-medium text-foreground">
        {t(lang, "forecastMixAction")}
        <span className="ml-2 text-xs font-normal text-muted-foreground">{t(lang, "forecastMixSummary")}</span>
      </summary>
      <div className="overflow-x-auto px-3 pb-3">
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr>
              {headers.map((key) => (
                <th key={key} scope="col" className="px-2 py-1 text-left text-xs font-medium text-muted-foreground">{t(lang, key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mix.rows.map((row) => (
              <tr key={row.key}>
                <td className="px-2 py-1">
                  {row.name}
                  {mix.driver?.key === row.key ? (
                    <Badge size="sm" pill className="ml-2 border border-line">{t(lang, "forecastMixDriverBadge")}</Badge>
                  ) : null}
                </td>
                <td className="px-2 py-1 tabular-nums">{row.plannedRate === null ? "—" : t(lang, "forecastRatePerHour", money(row.plannedRate))}</td>
                <td className="px-2 py-1 tabular-nums">{formatShare(row.plannedShare, locale)}</td>
                <td className="px-2 py-1 tabular-nums">{formatShare(row.bookedShare, locale)}</td>
                <td className="px-2 py-1 tabular-nums">{rateMixPoints(lang, row.difference)}</td>
                <td className="px-2 py-1 tabular-nums">
                  {row.usedOfBudget === null ? "—" : t(lang, "forecastMixUsed", formatHours(row.actualHours, locale), formatHours(row.budgetHours, locale), formatShare(row.usedOfBudget, locale))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">
          {mix.driver
            ? rateMixExplanation(lang, mix, eur, hours)
            : t(lang, "forecastMixOnPlan", String(Math.round(RATE_MIX_DRIVER_MIN_DIFFERENCE * 100)))}
        </p>
      </div>
    </details>
  );
}
```

- [ ] **Step 6: Create the section** — `src/app/budget-forecast-section.tsx`:

```tsx
"use client";

// Forecast section body (MR 3): banners, the role-mix disclosure and the cards.
// Owns the disclosure's open state and the focus nonce the banner action bumps,
// so the Budget report panel stays an orchestrator (plan Ruling 10).
import { useState } from "react";
import type { Lang } from "./i18n";
import type { PlanGranularity } from "./types";
import type { ForecastBundle } from "./budget-forecasts";
import { ForecastBanners } from "./budget-forecast-banner";
import { ForecastCards } from "./budget-forecast-cards";
import { RateMixDetails } from "./budget-rate-mix-details";

export function ForecastSection({ lang, bundle, granularity }: { lang: Lang; bundle: ForecastBundle; granularity: PlanGranularity }) {
  const [mixOpen, setMixOpen] = useState(false);
  const [focusNonce, setFocusNonce] = useState(0);
  const { eur, hours, mix } = bundle;
  const showMix = () => {
    setMixOpen(true);
    setFocusNonce((n) => n + 1);
  };
  return (
    <div className="space-y-3">
      <ForecastBanners lang={lang} forecast={eur} hours={hours} mix={mix} granularity={granularity} onShowMix={mix ? showMix : undefined} />
      {mix ? (
        <RateMixDetails lang={lang} mix={mix} eur={eur} hours={hours} open={mixOpen} onToggle={setMixOpen} focusNonce={focusNonce} />
      ) : null}
      <ForecastCards lang={lang} forecast={eur} hours={hours} mix={mix} />
    </div>
  );
}
```

- [ ] **Step 7: Use it in the panel** — in `src/app/budget-report-panel.tsx`, replace the Forecast section's inner `<div className="space-y-3">…</div>` (the `ForecastBanners` + `ForecastCards` pair) with `<ForecastSection lang={lang} bundle={bundle} granularity={plan.granularity} />`; import it and drop the now-unused `ForecastBanners`/`ForecastCards` imports.

- [ ] **Step 8: Run to verify they pass**

Run: `npx vitest run src/app/budget-forecast-banner.test.tsx src/app/budget-rate-mix-details.test.tsx src/app/budget-forecast-section.test.tsx src/app/budget-report-panel.test.tsx > <scratch>/t9.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0, `Test Files 4 passed`.

If "539 h of 600 h (90%)" differs only in `Intl` spacing, assert what `formatHours`/`formatShare` print.

- [ ] **Step 9: Mutation-check the focus rule** — move `summaryRef.current?.focus()` out of the effect into `showMix` (synchronously after the setters). Note whether "opens the role mix from the banner and focuses its summary" still passes in jsdom; record the result in the report either way, then revert. (jsdom may not distinguish the two — the effect form is required regardless, per Ruling 10.)

- [ ] **Step 10: Typecheck, lint, commit**

```bash
npx tsc --noEmit > <scratch>/tsc.log 2>&1; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/budget-forecast-banner.tsx src/app/budget-forecast-banner.test.tsx src/app/budget-rate-mix-details.tsx src/app/budget-rate-mix-details.test.tsx src/app/budget-forecast-section.tsx src/app/budget-forecast-section.test.tsx src/app/budget-report-panel.tsx; echo "EXIT=$?"
git add src/app/budget-forecast-banner.tsx src/app/budget-forecast-banner.test.tsx src/app/budget-rate-mix-details.tsx src/app/budget-rate-mix-details.test.tsx src/app/budget-forecast-section.tsx src/app/budget-forecast-section.test.tsx src/app/budget-report-panel.tsx
git commit -m "feat(forecast): rate-mix banner and the where-the-hours-went disclosure"
```

---

### Task 10: Rate fact in the facts row and the tile chip

**Files:**
- Modify: `src/app/budget-forecast-facts.tsx`, `src/app/budget-forecast-headline.tsx`, `src/app/dashboard-tile-bodies.tsx`, `src/app/budget-report-panel.tsx`
- Test: `src/app/budget-forecast-facts.test.tsx`, `src/app/budget-forecast-headline.test.tsx`

**Interfaces:**
- Consumes: Task 7 `rateFactValue`, `rateFactTip`, `rateMixTileChipText`, `rateMixWhyName`, `rateMixExplanation`, fixtures; Task 8 `RateMixChip`; Task 5 `model.forecastBundle`.
- Produces: `ForecastFactsRow({ lang, forecast, mix? })`; `ForecastHeadline({ lang, forecast, hours?, mix? })`.

- [ ] **Step 1: Write the failing tests** — append to `src/app/budget-forecast-facts.test.tsx`:

```tsx
import { EUR_FORECAST, MIX_HOURS_WORSE, MIX_ON_PLAN } from "../test/forecast-fixtures";
import { rateFactTip, rateFactValue } from "./budget-rate-mix-text";

describe("ForecastFactsRow — rate fact (MR 3)", () => {
  it("adds no fifth fact without a mix, keeping the four-column grid", () => {
    const { container } = render(<ForecastFactsRow lang="en-US" forecast={EUR_FORECAST} />);
    expect(screen.queryByText("Avg rate booked")).toBeNull();
    expect(container.firstElementChild!.className).toContain("sm:grid-cols-4");
  });

  it("shows the drifting rate with a direction arrow and its tooltip", () => {
    const { container } = render(<ForecastFactsRow lang="en-US" forecast={EUR_FORECAST} mix={MIX_HOURS_WORSE} />);
    expect(screen.getByText(rateFactValue("en-US", MIX_HOURS_WORSE))).toBeInTheDocument();
    expect(container.textContent).toContain("▼");
    expect(container.firstElementChild!.className).toContain("lg:grid-cols-5");
    const trigger = screen.getByRole("button", { name: "What is Avg rate booked?" });
    act(() => trigger.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent(rateFactTip("en-US", MIX_HOURS_WORSE));
  });

  it("shows 'on plan' without an arrow when the drift is below the threshold", () => {
    const { container } = render(<ForecastFactsRow lang="en-US" forecast={EUR_FORECAST} mix={MIX_ON_PLAN} />);
    expect(screen.getByText(rateFactValue("en-US", MIX_ON_PLAN))).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[▲▼]/);
  });
});
```

Append to `src/app/budget-forecast-headline.test.tsx`:

```tsx
import { EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE, MIX_HOURS_WORSE, MIX_ON_PLAN } from "../test/forecast-fixtures";
import { rateMixTileChipText, rateMixWhyName } from "./budget-rate-mix-text";

describe("ForecastHeadline — tile chip (MR 3)", () => {
  it("adds the hours chip under the headline when the mix triggers", () => {
    render(<ForecastHeadline lang="en-US" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_HOURS_WORSE} />);
    const text = rateMixTileChipText("en-US", MIX_HOURS_WORSE, HOURS_FORECAST_HOURS_WORSE);
    expect(screen.getByRole("button", { name: rateMixWhyName("en-US", text) })).toHaveTextContent(text);
  });

  it("adds nothing when the mix does not trigger or is absent", () => {
    const { rerender } = render(<ForecastHeadline lang="en-US" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_ON_PLAN} />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<ForecastHeadline lang="en-US" forecast={EUR_FORECAST} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
```

(Add `act` to the facts test file's imports if missing.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/budget-forecast-facts.test.tsx src/app/budget-forecast-headline.test.tsx > <scratch>/t10.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=1.

- [ ] **Step 3: Implement the rate fact** — in `src/app/budget-forecast-facts.tsx` import `rateFactTip`, `rateFactValue` from `./budget-rate-mix-text` and `RATE_DRIFT_SIGNAL_RATIO`, `type RateMix` from `./budget-rate-mix`. Change the signature to `({ lang, forecast, mix = null }: { lang: Lang; forecast: BudgetForecast; mix?: RateMix | null })`, the grid class to

```tsx
    <div className={`mb-3 grid grid-cols-2 gap-3 ${mix ? "sm:grid-cols-3 lg:grid-cols-5" : "sm:grid-cols-4"}`}>
```

and append after the EV tile:

```tsx
      {mix ? (
        <Tile
          label={<FactLabel lang={lang} term={t(lang, "forecastFactRate")} tip={rateFactTip(lang, mix)} />}
          value={
            <>
              {Math.abs(mix.drift) >= RATE_DRIFT_SIGNAL_RATIO ? (
                <span aria-hidden="true" className="mr-1">{mix.drift < 0 ? "▼" : "▲"}</span>
              ) : null}
              {rateFactValue(lang, mix)}
            </>
          }
        />
      ) : null}
```

In `src/app/budget-report-panel.tsx` pass `mix={bundle.mix}` to `ForecastFactsRow`.

- [ ] **Step 4: Implement the tile chip** — in `src/app/budget-forecast-headline.tsx` import `RateMixChip`, `rateMixExplanation`, `rateMixTileChipText`, `rateMixWhyName`, `type RateMix`. Change `ForecastHeadline`:

```tsx
export function ForecastHeadline({
  lang, forecast, hours = null, mix = null,
}: {
  lang: Lang; forecast: BudgetForecast; hours?: BudgetForecast | null; mix?: RateMix | null;
}) {
  const notices = forecastNotices(forecast);
  const chipText = mix && mix.triggered && mix.direction !== null && hours ? rateMixTileChipText(lang, mix, hours) : null;
  return (
    <>
      <p className="text-sm font-semibold">{forecastHeadlineText(forecast, lang)}</p>
      {notices.length > 0 ? (
        <p className="text-xs text-muted-foreground">{forecastNoticeShortText(notices[0], lang)}</p>
      ) : null}
      {chipText !== null && mix && mix.direction !== null && hours ? (
        <div className="mt-1">
          <RateMixChip
            name={rateMixWhyName(lang, chipText)}
            text={chipText}
            tip={rateMixExplanation(lang, mix, forecast, hours)}
            direction={mix.direction}
          />
        </div>
      ) : null}
    </>
  );
}
```

In `src/app/dashboard-tile-bodies.tsx`, the `burn` body's headline becomes:

```tsx
        {model.forecast ? (
          <ForecastHeadline
            lang={lang}
            forecast={model.forecast}
            hours={model.forecastBundle?.hours ?? null}
            mix={model.forecastBundle?.mix ?? null}
          />
        ) : null}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/app/budget-forecast-facts.test.tsx src/app/budget-forecast-headline.test.tsx src/app/budget-report-panel.test.tsx src/app/dashboard-panel.test.tsx > <scratch>/t10.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0, `Test Files 4 passed`.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit > <scratch>/tsc.log 2>&1; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/budget-forecast-facts.tsx src/app/budget-forecast-facts.test.tsx src/app/budget-forecast-headline.tsx src/app/budget-forecast-headline.test.tsx src/app/dashboard-tile-bodies.tsx src/app/budget-report-panel.tsx; echo "EXIT=$?"
git add src/app/budget-forecast-facts.tsx src/app/budget-forecast-facts.test.tsx src/app/budget-forecast-headline.tsx src/app/budget-forecast-headline.test.tsx src/app/dashboard-tile-bodies.tsx src/app/budget-report-panel.tsx
git commit -m "feat(forecast): booked-rate fact and the dashboard hours chip"
```

---

### Task 11: Chart geometry model

**Files:**
- Create: `src/app/burndown-geometry.ts`, `src/app/burndown-geometry.test.ts`

**Interfaces:**
- Consumes: Task 2 `BurndownSeries` dates and `actualPointDates`; Task 3 `EvHistory`; `BudgetForecast`, `isPaceAvailable`, `isEfficiencyAvailable`.
- Produces:

```ts
export type ChartUnit = "eur" | "hours";
export type ChartOrientation = "burndown" | "cumulative";
export const CHART_FRAME_TOLERANCE = 0.5;
export type ChartPoint = { date: string; value: number };
export type ChartSegment = { from: ChartPoint; to: ChartPoint; endFigure: number };
export type ChartModel = {
  empty: boolean; xDomain: readonly [string, string]; yDomain: readonly [number, number]; total: number;
  planned: readonly ChartPoint[]; actual: readonly ChartPoint[]; over: boolean;
  pace: ChartSegment | null; efficiency: ChartSegment | null; runOut: ChartPoint | null; ev: ChartPoint | null;
  evLine: readonly ChartPoint[] | null; evHistoryBlockedBy: readonly string[] | null;
  bacLine: number | null; today: string | null; planEnd: string; frameDiffers: boolean;
};
export type ChartInput = {
  series: BurndownSeries; unit: ChartUnit; orientation: ChartOrientation;
  forecast: BudgetForecast | null; evHistory: EvHistory | null; today: string; planEnd: string;
};
export function daysBetweenUtc(from: string, to: string): number
export function scaleDate(date: string, domain: readonly [string, string], x0: number, x1: number): number
export function scaleValue(value: number, domain: readonly [number, number], yBottom: number, yTop: number): number
export function buildChartModel(input: ChartInput): ChartModel
```

- [ ] **Step 1: Write the failing tests** — `src/app/burndown-geometry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildChartModel, daysBetweenUtc, scaleDate, scaleValue, type ChartInput } from "./burndown-geometry";
import type { BurndownSeries } from "./budget-burndown";
import type { BudgetForecast } from "./budget-forecast";

const series: BurndownSeries = {
  periods: ["2026-01", "2026-02", "2026-03"],
  periodStarts: ["2026-01-01", "2026-02-01", "2026-03-01"],
  periodEnds: ["2026-01-31", "2026-02-28", "2026-03-31"],
  plannedRemainingHours: [60, 30, 0], plannedRemainingValue: [6_000, 3_000, 0],
  actualRemainingHours: [70, 50, null], actualRemainingValue: [7_000, 5_000, null],
  todayIndex: 1, totalBudgetHours: 90, totalBudgetValue: 9_000,
};
const forecast: BudgetForecast = {
  facts: { bac: 9_000, ac: 4_000, remaining: 5_000, ev: 3_600, percentComplete: 40 },
  pace: {
    burnRatePerDay: 200, windowDays: 20, windowStart: "2026-01-19", windowEnd: "2026-02-13", spreadPeriodHoursUsed: false,
    workingDaysLeft: 30, etc: 6_000, eac: 10_000, vac: -1_000, runOutDate: "2026-03-20", daysBeforePlannedEnd: 11,
  },
  efficiency: { pv: 4_500, cpi: 0.9, spi: 0.8, etc: 7_000, eac: 11_000, vac: -2_000 },
  gap: null, hasFixedPrice: false,
};
const base: ChartInput = { series, unit: "eur", orientation: "burndown", forecast, evHistory: null, today: "2026-02-14", planEnd: "2026-03-31" };

describe("scales", () => {
  it("counts UTC calendar days and maps dates and values linearly", () => {
    expect(daysBetweenUtc("2026-01-01", "2026-03-01")).toBe(59);
    expect(scaleDate("2026-01-16", ["2026-01-01", "2026-01-31"], 0, 300)).toBe(150);
    expect(scaleDate("2026-01-01", ["2026-01-01", "2026-01-01"], 10, 300)).toBe(10);
    expect(scaleValue(50, [0, 100], 200, 0)).toBe(100);
    expect(scaleValue(5, [5, 5], 200, 0)).toBe(200);
  });
});

describe("buildChartModel — burn-down, €", () => {
  const m = buildChartModel(base);
  it("plots planned from an origin at the first period start, then at period ends", () => {
    expect(m.planned).toEqual([
      { date: "2026-01-01", value: 9_000 }, { date: "2026-01-31", value: 6_000 },
      { date: "2026-02-28", value: 3_000 }, { date: "2026-03-31", value: 0 },
    ]);
  });
  it("ends the actual line at today", () => {
    expect(m.actual).toEqual([
      { date: "2026-01-01", value: 9_000 }, { date: "2026-01-31", value: 7_000 }, { date: "2026-02-14", value: 5_000 },
    ]);
    expect(m.today).toBe("2026-02-14");
  });
  it("extends both forecasts from the last actual point by their ETC, labelled with VAC", () => {
    expect(m.pace).toEqual({ from: { date: "2026-02-14", value: 5_000 }, to: { date: "2026-03-31", value: -1_000 }, endFigure: -1_000 });
    expect(m.efficiency?.to.value).toBe(-2_000);
    expect(m.efficiency?.endFigure).toBe(-2_000);
  });
  it("places the run-out at zero on its date, EV as work left, and opens the domain below zero", () => {
    expect(m.runOut).toEqual({ date: "2026-03-20", value: 0 });
    expect(m.ev).toEqual({ date: "2026-02-14", value: 5_400 });
    expect(m.yDomain).toEqual([-2_000, 9_000]);
    expect(m.xDomain).toEqual(["2026-01-01", "2026-03-31"]);
    expect(m.bacLine).toBeNull();
    expect(m.frameDiffers).toBe(false);
    expect(m.over).toBe(false);
    expect(m.empty).toBe(false);
  });
});

describe("buildChartModel — cumulative", () => {
  const m = buildChartModel({ ...base, orientation: "cumulative" });
  it("flips values to cumulative, labels ends with EAC and draws the BAC line", () => {
    expect(m.actual[m.actual.length - 1]).toEqual({ date: "2026-02-14", value: 4_000 });
    expect(m.pace?.to.value).toBe(10_000);
    expect(m.pace?.endFigure).toBe(10_000);
    expect(m.runOut).toEqual({ date: "2026-03-20", value: 9_000 });
    expect(m.ev?.value).toBe(3_600);
    expect(m.bacLine).toBe(9_000);
  });
  it("draws the earned-value history only here", () => {
    const evHistory = { available: true as const, points: [{ date: "2026-01-31", eur: 1_000, hours: 10 }, { date: "2026-02-14", eur: 3_600, hours: 36 }] };
    expect(buildChartModel({ ...base, orientation: "cumulative", evHistory }).evLine).toEqual([
      { date: "2026-01-01", value: 0 }, { date: "2026-01-31", value: 1_000 }, { date: "2026-02-14", value: 3_600 },
    ]);
    expect(buildChartModel({ ...base, evHistory }).evLine).toBeNull();
  });
  it("names the buckets that block the history", () => {
    const evHistory = { available: false as const, reason: "manual-percent" as const, buckets: [{ id: 2, name: "Design" }] };
    expect(buildChartModel({ ...base, orientation: "cumulative", evHistory }).evHistoryBlockedBy).toEqual(["Design"]);
  });
});

describe("buildChartModel — edges", () => {
  it("reads the hours arrays in the hours unit", () => {
    const m = buildChartModel({ ...base, unit: "hours", forecast: null });
    expect(m.total).toBe(90);
    expect(m.actual[m.actual.length - 1].value).toBe(50);
  });
  it("draws no forecast when it is unavailable or absent", () => {
    const unavailable = { ...forecast, pace: { unavailable: "no-burn", windowStart: "a", windowEnd: "b", lastBookingDate: null }, efficiency: { unavailable: "no-actual-cost" } } as BudgetForecast;
    const m = buildChartModel({ ...base, forecast: unavailable });
    expect(m.pace).toBeNull();
    expect(m.efficiency).toBeNull();
    expect(m.runOut).toBeNull();
  });
  it("omits a run-out after the plan end", () => {
    const late = { ...forecast, pace: { ...forecast.pace, runOutDate: "2026-04-10" } } as BudgetForecast;
    expect(buildChartModel({ ...base, forecast: late }).runOut).toBeNull();
  });
  it("flags a frame difference beyond the tolerance", () => {
    expect(buildChartModel({ ...base, forecast: { ...forecast, facts: { ...forecast.facts, bac: 9_001 } } }).frameDiffers).toBe(true);
    expect(buildChartModel({ ...base, forecast: { ...forecast, facts: { ...forecast.facts, ac: 4_000.4 } } }).frameDiffers).toBe(false);
  });
  it("marks over-budget and empty charts, and has no actual line before the first period", () => {
    expect(buildChartModel({ ...base, series: { ...series, actualRemainingValue: [7_000, -500, null] } }).over).toBe(true);
    expect(buildChartModel({ ...base, series: { ...series, totalBudgetValue: 0 } }).empty).toBe(true);
    const before = buildChartModel({ ...base, series: { ...series, todayIndex: -1 }, today: "2025-12-01" });
    expect(before.actual).toEqual([]);
    expect(before.pace).toBeNull();
    expect(before.today).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/burndown-geometry.test.ts > <scratch>/t11.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=1, cannot resolve `./burndown-geometry`.

- [ ] **Step 3: Implement** — `src/app/burndown-geometry.ts`:

```ts
/**
 * Burn-down chart geometry (MR 3 addendum §5.2). Pure, i18n-free, no pixels
 * except the two scale helpers. Values live in the CHART's frame (the series
 * totals); forecast lines start at the last actual point and extend by their
 * own ETC so there is no jump at today, and their end labels carry the
 * forecast's own figures. `frameDiffers` tells the surface to say so when the
 * chart's totals and the forecast's BAC/AC disagree (fixed price, bucket window).
 */
import { isEfficiencyAvailable, isPaceAvailable, type BudgetForecast } from "./budget-forecast";
import { actualPointDates, type BurndownSeries } from "./budget-burndown";
import type { EvHistory } from "./budget-ev-history";

export type ChartUnit = "eur" | "hours";
export type ChartOrientation = "burndown" | "cumulative";
export const CHART_FRAME_TOLERANCE = 0.5;
export type ChartPoint = { date: string; value: number };
export type ChartSegment = { from: ChartPoint; to: ChartPoint; endFigure: number };
export type ChartModel = {
  empty: boolean; xDomain: readonly [string, string]; yDomain: readonly [number, number]; total: number;
  planned: readonly ChartPoint[]; actual: readonly ChartPoint[]; over: boolean;
  pace: ChartSegment | null; efficiency: ChartSegment | null; runOut: ChartPoint | null; ev: ChartPoint | null;
  evLine: readonly ChartPoint[] | null; evHistoryBlockedBy: readonly string[] | null;
  bacLine: number | null; today: string | null; planEnd: string; frameDiffers: boolean;
};
export type ChartInput = {
  series: BurndownSeries; unit: ChartUnit; orientation: ChartOrientation;
  forecast: BudgetForecast | null; evHistory: EvHistory | null; today: string; planEnd: string;
};

const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

export function daysBetweenUtc(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

export function scaleDate(date: string, domain: readonly [string, string], x0: number, x1: number): number {
  const span = daysBetweenUtc(domain[0], domain[1]);
  return span <= 0 ? x0 : x0 + (daysBetweenUtc(domain[0], date) / span) * (x1 - x0);
}

export function scaleValue(value: number, domain: readonly [number, number], yBottom: number, yTop: number): number {
  const span = domain[1] - domain[0];
  return span <= 0 ? yBottom : yBottom - ((value - domain[0]) / span) * (yBottom - yTop);
}

export function buildChartModel(input: ChartInput): ChartModel {
  const { series, unit, orientation, forecast, evHistory, today, planEnd } = input;
  const eurUnit = unit === "eur";
  const down = orientation === "burndown";
  const total = eurUnit ? series.totalBudgetValue : series.totalBudgetHours;
  const plannedRemaining = eurUnit ? series.plannedRemainingValue : series.plannedRemainingHours;
  const actualRemaining = eurUnit ? series.actualRemainingValue : series.actualRemainingHours;
  const fromCumulative = (cumulative: number) => (down ? total - cumulative : cumulative);
  const n = series.periods.length;
  const start = n > 0 ? series.periodStarts[0] : planEnd;
  const lastEnd = n > 0 ? series.periodEnds[n - 1] : planEnd;
  const xDomain: readonly [string, string] = [start, lastEnd > planEnd ? lastEnd : planEnd];
  const origin: ChartPoint = { date: start, value: fromCumulative(0) };

  const planned: ChartPoint[] = n === 0 ? [] : [
    origin,
    ...plannedRemaining.map((remaining, i) => ({ date: series.periodEnds[i], value: fromCumulative(total - remaining) })),
  ];
  const dates = actualPointDates(series, today);
  const actual: ChartPoint[] = dates.length === 0 ? [] : [origin];
  dates.forEach((date, i) => {
    const remaining = actualRemaining[i];
    if (remaining !== null) actual.push({ date, value: fromCumulative(total - remaining) });
  });
  const last = actual.length > 1 ? actual[actual.length - 1] : null;
  const lastRemaining = series.todayIndex >= 0 ? actualRemaining[series.todayIndex] : null;
  const over = lastRemaining !== null && lastRemaining < 0;

  let pace: ChartSegment | null = null;
  let efficiency: ChartSegment | null = null;
  let runOut: ChartPoint | null = null;
  let ev: ChartPoint | null = null;
  if (forecast && last) {
    const segment = (etc: number, figure: number): ChartSegment => ({
      from: last, to: { date: planEnd, value: down ? last.value - etc : last.value + etc }, endFigure: figure,
    });
    const p = forecast.pace;
    if (isPaceAvailable(p)) {
      pace = segment(p.etc, down ? p.vac : p.eac);
      if (p.runOutDate !== null && p.runOutDate <= planEnd) runOut = { date: p.runOutDate, value: down ? 0 : total };
    }
    const e = forecast.efficiency;
    if (isEfficiencyAvailable(e)) efficiency = segment(e.etc, down ? e.vac : e.eac);
    if (forecast.facts.ev !== null) ev = { date: last.date, value: fromCumulative(forecast.facts.ev) };
  }

  let evLine: ChartPoint[] | null = null;
  let evHistoryBlockedBy: string[] | null = null;
  if (!down && evHistory) {
    if (evHistory.available) {
      evLine = evHistory.points.length === 0 ? null : [origin, ...evHistory.points.map((pt) => ({ date: pt.date, value: eurUnit ? pt.eur : pt.hours }))];
    } else {
      evHistoryBlockedBy = evHistory.buckets.map((b) => b.name);
    }
  }

  const lastCumulative = last === null ? null : (down ? total - last.value : last.value);
  const frameDiffers = forecast !== null && lastCumulative !== null && (
    Math.abs(total - forecast.facts.bac) > CHART_FRAME_TOLERANCE ||
    Math.abs(lastCumulative - forecast.facts.ac) > CHART_FRAME_TOLERANCE
  );

  const values = [
    0, total,
    ...planned.map((pt) => pt.value), ...actual.map((pt) => pt.value),
    ...(evLine ?? []).map((pt) => pt.value),
    ...[pace?.to.value, efficiency?.to.value, ev?.value].filter((v): v is number => v !== undefined),
  ];
  const yMin = Math.min(...values);
  const yMaxRaw = Math.max(...values);
  const yMax = yMaxRaw > yMin ? yMaxRaw : yMin + 1;

  return {
    empty: !(total > 0), xDomain, yDomain: [yMin, yMax], total,
    planned, actual, over, pace, efficiency, runOut, ev, evLine, evHistoryBlockedBy,
    bacLine: down ? null : total,
    today: dates.length > 0 ? dates[dates.length - 1] : null,
    planEnd, frameDiffers,
  };
}
```

- [ ] **Step 4: Run to verify they pass** — same command as Step 2. Expected: EXIT=0.

- [ ] **Step 5: Mutation-check** — (a) start forecast segments at `{ date: today, value: fromCumulative(forecast.facts.ac) }` instead of `last`: the pace segment test must still pass on this fixture (frames agree) — so ALSO run with `facts.ac: 4_300` in a throwaway copy of the fixture and confirm the `from` value then differs; this documents why `last` is the anchor. (b) drop the `!down &&` guard: "draws the earned-value history only here" fails. (c) change `> CHART_FRAME_TOLERANCE` to `>= 0`: the tolerance test fails. Revert all.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit > <scratch>/tsc.log 2>&1; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/burndown-geometry.ts src/app/burndown-geometry.test.ts; echo "EXIT=$?"
git add src/app/burndown-geometry.ts src/app/burndown-geometry.test.ts
git commit -m "feat(burndown): date-accurate chart geometry with forecasts and earned value"
```

---

### Task 12: Chart component, switches and device settings

> **Tasks 12 and 13 are ONE dispatch and ONE review unit** (plan Ruling 19): removing `BurndownCharts` breaks its two call sites, so the tree only typechecks once Task 13 Step 2 lands. Commit Task 12's files after Task 13 Step 2, then Task 13's.

**Files:**
- Modify: `src/app/settings-types.ts`, `src/app/use-settings.ts`, `src/app/use-settings.test.ts`
- Rewrite: `src/app/burndown-chart.tsx`, `src/app/burndown-chart.test.tsx`
- Create: `src/app/burndown-chart-panel.tsx`, `src/app/burndown-chart-panel.test.tsx`

**Interfaces:**
- Consumes: Task 11 `buildChartModel`, `scaleDate`, `scaleValue`, types; Task 5 `ForecastBundle`; Task 7 keys; `SegmentedControl`, `useSettings`, `TermTooltip`.
- Produces:
  - `Settings.budgetChartView?: "burndown" | "cumulative"` (default `"burndown"`), `Settings.budgetChartUnit?: "eur" | "hours"` (default `"eur"`).
  - `export function BurndownChart(props: { lang: Lang; currency: string; model: ChartModel; unit: ChartUnit; orientation: ChartOrientation; periods: readonly string[] })`
  - `export function BurndownChartPanel(props: { lang: Lang; series: BurndownSeries; bundle: Pick<ForecastBundle, "eur" | "hours" | "evHistory"> | null; today: string; planEnd: string; currency: string })`
  - `BurndownCharts` is removed (Task 13 replaces its two call sites).

- [ ] **Step 1: Write the failing settings tests** — in `src/app/use-settings.test.ts`, next to the `tasksViewMode` coercion tests and in the same style:

```ts
    it("budget chart settings default to burn-down and € when absent", async () => {
      const { budgetChartView: _v, budgetChartUnit: _u, ...rest } = defaultSettings;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.budgetChartView).toBe("burndown");
      expect(result.current.settings.budgetChartUnit).toBe("eur");
    });

    it("budget chart settings coerce invalid values to the defaults", async () => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings, budgetChartView: "garbage", budgetChartUnit: 7 }));
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.budgetChartView).toBe("burndown");
      expect(result.current.settings.budgetChartUnit).toBe("eur");
    });

    it("budget chart settings keep strictly valid persisted values", async () => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings, budgetChartView: "cumulative", budgetChartUnit: "hours" }));
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.budgetChartView).toBe("cumulative");
      expect(result.current.settings.budgetChartUnit).toBe("hours");
    });
```

`_v`/`_u` unused destructuring names are fatal lint in this repo (no `argsIgnorePattern`); if eslint rejects them, build `rest` with `const rest: Record<string, unknown> = { ...defaultSettings }; delete rest.budgetChartView; delete rest.budgetChartUnit;` instead.

- [ ] **Step 2: Implement the settings** — in `src/app/settings-types.ts`, after `dashboardDensity?`:

```ts
  /** Per-device burn-down chart orientation (Budget report + dashboard tile). Default "burndown".
   *  No per-project override (MR 3 addendum §6). */
  budgetChartView?: "burndown" | "cumulative";
  /** Per-device burn-down chart unit. Default "eur". */
  budgetChartUnit?: "eur" | "hours";
```

and in the defaults object after `dashboardDensity: "comfortable",`: `budgetChartView: "burndown", budgetChartUnit: "eur",`.

In `src/app/use-settings.ts`'s load merge, after the `tasksViewMode:` entry:

```ts
            budgetChartView:
              (parsed as Record<string, unknown>).budgetChartView === "cumulative" ? "cumulative" : "burndown",
            budgetChartUnit:
              (parsed as Record<string, unknown>).budgetChartUnit === "hours" ? "hours" : "eur",
```

Then grep tests that enumerate settings keys (`grep -rln "tasksViewMode" src/app --include=*.test.ts --include=*.test.tsx`) and run them with the settings test in Step 3; MIGRATE any exact-keys assertion by adding the two keys.

- [ ] **Step 3: Run the settings tests**

Run: `npx vitest run src/app/use-settings.test.ts <key-enumerating tests found> > <scratch>/t12a.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0.

- [ ] **Step 4: Write the failing chart tests** — replace `src/app/burndown-chart.test.tsx` entirely (its five twin-chart tests are DELETED; their intents — caption, one svg, pink when over, empty hint, axis labels — are carried below):

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BurndownChart } from "./burndown-chart";
import { buildChartModel, type ChartInput } from "./burndown-geometry";
import type { BurndownSeries } from "./budget-burndown";
import type { BudgetForecast } from "./budget-forecast";

const series: BurndownSeries = {
  periods: ["2026-01", "2026-02", "2026-03"],
  periodStarts: ["2026-01-01", "2026-02-01", "2026-03-01"],
  periodEnds: ["2026-01-31", "2026-02-28", "2026-03-31"],
  plannedRemainingHours: [60, 30, 0], plannedRemainingValue: [6_000, 3_000, 0],
  actualRemainingHours: [70, 50, null], actualRemainingValue: [7_000, 5_000, null],
  todayIndex: 1, totalBudgetHours: 90, totalBudgetValue: 9_000,
};
const forecast: BudgetForecast = {
  facts: { bac: 9_000, ac: 4_000, remaining: 5_000, ev: 3_600, percentComplete: 40 },
  pace: {
    burnRatePerDay: 200, windowDays: 20, windowStart: "2026-01-19", windowEnd: "2026-02-13", spreadPeriodHoursUsed: false,
    workingDaysLeft: 30, etc: 6_000, eac: 10_000, vac: -1_000, runOutDate: "2026-03-20", daysBeforePlannedEnd: 11,
  },
  efficiency: { pv: 4_500, cpi: 0.9, spi: 0.8, etc: 7_000, eac: 11_000, vac: -2_000 },
  gap: null, hasFixedPrice: false,
};
const base: ChartInput = { series, unit: "eur", orientation: "burndown", forecast, evHistory: null, today: "2026-02-14", planEnd: "2026-03-31" };
function draw(over: Partial<ChartInput> = {}) {
  const input = { ...base, ...over };
  return render(
    <BurndownChart lang="en-US" currency="EUR" model={buildChartModel(input)} unit={input.unit} orientation={input.orientation} periods={input.series.periods} />,
  );
}

describe("BurndownChart", () => {
  it.each([
    ["eur", "burndown", "Budget remaining"], ["hours", "burndown", "Hours remaining"],
    ["eur", "cumulative", "Spend, cumulative"], ["hours", "cumulative", "Hours, cumulative"],
  ] as const)("captions %s × %s as %s", (unit, orientation, caption) => {
    draw({ unit, orientation });
    expect(screen.getByText(caption)).toBeInTheDocument();
  });

  it("renders one chart svg whose name summarises run-out and plan-end VAC", () => {
    const { container } = draw();
    const svgs = container.querySelectorAll("svg[role='img']");
    expect(svgs).toHaveLength(1);
    expect(svgs[0].getAttribute("aria-label")).toContain("Runs out Mar 20, 2026 at current pace.");
    expect(svgs[0].getAttribute("aria-label")).toContain("at current efficiency");
  });

  it("labels the y axis below zero and the first and last period", () => {
    const { container } = draw();
    expect(container.querySelectorAll("svg[role='img'] text[data-axis='y']")).toHaveLength(4);
    expect(screen.getAllByText("2026-01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2026-03").length).toBeGreaterThan(0);
  });

  it("draws the actual line pink when over budget, green otherwise", () => {
    expect(draw().container.querySelectorAll("polyline.stroke-ui-green")).toHaveLength(1);
    const over = draw({ series: { ...series, actualRemainingValue: [7_000, -500, null] } });
    expect(over.container.querySelectorAll("polyline.stroke-ui-pink")).toHaveLength(1);
  });

  it("lists only drawn series in the legend", () => {
    draw({ forecast: null });
    expect(screen.queryByText("At current pace")).toBeNull();
    expect(screen.getByText("Planned")).toBeInTheDocument();
  });

  it("shows the frame note and the blocked-history note when they apply", () => {
    draw({ forecast: { ...forecast, facts: { ...forecast.facts, bac: 9_500 } } });
    expect(screen.getByText(/Chart totals differ from the forecast figures/)).toBeInTheDocument();
    draw({ orientation: "cumulative", evHistory: { available: false, reason: "manual-percent", buckets: [{ id: 2, name: "Design" }] } });
    expect(screen.getByText(/Hand-entered % complete or no linked tasks: Design\./)).toBeInTheDocument();
  });

  it("shows the no-budget hint for an empty chart", () => {
    draw({ series: { ...series, totalBudgetValue: 0 } });
    expect(screen.getByText("No budget configured")).toBeInTheDocument();
  });
});
```

`src/app/burndown-chart-panel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { BurndownChartPanel } from "./burndown-chart-panel";
import { SETTINGS_KEY } from "./use-settings";
import { EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE, EV_HISTORY } from "../test/forecast-fixtures";
import type { BurndownSeries } from "./budget-burndown";

const series: BurndownSeries = {
  periods: ["2026-08", "2026-09"], periodStarts: ["2026-08-01", "2026-09-01"], periodEnds: ["2026-08-31", "2026-09-30"],
  plannedRemainingHours: [1_000, 500], plannedRemainingValue: [120_000, 60_000],
  actualRemainingHours: [900, 550], actualRemainingValue: [110_000, 72_000],
  todayIndex: 1, totalBudgetHours: 2_000, totalBudgetValue: 240_000,
};
const bundle = { eur: EUR_FORECAST, hours: HOURS_FORECAST_HOURS_WORSE, evHistory: EV_HISTORY };

describe("BurndownChartPanel", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to burn-down in €, switches with the two segmented controls and persists the choice", async () => {
    render(<BurndownChartPanel lang="en-US" series={series} bundle={bundle} today="2026-09-14" planEnd="2026-12-18" currency="EUR" />);
    await act(async () => {});
    expect(screen.getByRole("radiogroup", { name: "Chart orientation" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Chart unit" })).toBeInTheDocument();
    expect(screen.getByText("Budget remaining")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Cumulative" }));
    expect(screen.getByText("Spend, cumulative")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Hours" }));
    expect(screen.getByText("Hours, cumulative")).toBeInTheDocument();
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
      expect(stored.budgetChartView).toBe("cumulative");
      expect(stored.budgetChartUnit).toBe("hours");
    });
  });
});
```

If `SETTINGS_KEY` is not exported by `use-settings.ts`, import it from where `use-settings.test.ts` does. If `SegmentedControl` renders a different role than `radiogroup`/`radio`, read `segmented-control.tsx` and query the roles it renders.

- [ ] **Step 5: Run to verify they fail**

Run: `npx vitest run src/app/burndown-chart.test.tsx src/app/burndown-chart-panel.test.tsx > <scratch>/t12b.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=1.

- [ ] **Step 6: Rewrite the chart** — replace `src/app/burndown-chart.tsx`:

```tsx
"use client";

// One burn-down chart (MR 3 addendum §5): pure presentation over a ChartModel.
// Dash patterns and the legend carry each series' meaning, not colour alone.
// End labels are foreground text (small `ui-purple` text fails AA on dark
// schemes); the line swatch in the legend carries the colour.
import { type Lang, t, localeFor } from "./i18n";
import { formatCurrency } from "./resource-cost";
import { formatDayMonthYear, formatHours } from "./forecast-format";
import { TermTooltip } from "./budget-forecast-tooltip";
import { scaleDate, scaleValue, type ChartModel, type ChartOrientation, type ChartPoint, type ChartUnit } from "./burndown-geometry";

const W = 640, H = 240, PAD_L = 64, PAD_R = 80, PAD_T = 16, PAD_B = 28;
const X0 = PAD_L, X1 = W - PAD_R, Y_BOTTOM = H - PAD_B, Y_TOP = PAD_T;

const DASH = { planned: "5 4", pace: "7 4", efficiency: "2 3", evLine: "6 2 1 2", bac: "4 4", today: "3 3" } as const;

function Swatch({ className, dash, width = 2.5 }: { className: string; dash?: string; width?: number }) {
  return (
    <svg width="22" height="6" aria-hidden="true">
      <line x1="0" y1="3" x2="22" y2="3" className={className} strokeWidth={width} strokeDasharray={dash} />
    </svg>
  );
}

export function BurndownChart({
  lang, currency, model, unit, orientation, periods,
}: {
  lang: Lang; currency: string; model: ChartModel; unit: ChartUnit; orientation: ChartOrientation; periods: readonly string[];
}) {
  if (model.empty) return <p className="text-sm text-muted-foreground">{t(lang, "dashboardNoBudget")}</p>;
  const locale = localeFor(lang);
  const fmt = (v: number) => (unit === "eur" ? formatCurrency(v, currency, locale) : formatHours(v, locale));
  const x = (date: string) => scaleDate(date, model.xDomain, X0, X1);
  const y = (value: number) => scaleValue(value, model.yDomain, Y_BOTTOM, Y_TOP);
  const pts = (list: readonly ChartPoint[]) => list.map((p) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const down = orientation === "burndown";
  const caption = t(lang, down
    ? (unit === "eur" ? "burndownBudgetRemaining" : "burndownHoursRemaining")
    : (unit === "eur" ? "burndownValueCumulative" : "burndownHoursCumulative"));
  const aria = [t(lang, "burndownAria", caption, t(lang, unit === "eur" ? "burndownUnitEur" : "burndownUnitHours"))];
  if (model.runOut) aria.push(t(lang, "burndownAriaRunOut", formatDayMonthYear(model.runOut.date, locale)));
  if (model.pace && model.efficiency) aria.push(t(lang, "burndownAriaEnd", fmt(model.pace.endFigure), fmt(model.efficiency.endFigure)));
  else if (model.pace) aria.push(t(lang, "burndownAriaEndPace", fmt(model.pace.endFigure)));
  const yTicks = [...new Set([model.yDomain[0], 0, model.total / 2, model.total])].filter((v) => v >= model.yDomain[0]);
  const belowZero = model.yDomain[0] < 0;
  const zeroY = y(0);
  const actualClass = model.over ? "stroke-ui-pink" : "stroke-ui-green";

  return (
    <div className="space-y-2">
      <div>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{caption}</div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={aria.join(" ")}>
          {belowZero && <rect x={X0} y={zeroY} width={X1 - X0} height={Y_BOTTOM - zeroY} className="fill-ui-pink/10" />}
          <line x1={X0} y1={Y_TOP} x2={X0} y2={Y_BOTTOM} className="stroke-line" strokeWidth={1} />
          <line x1={X0} y1={zeroY} x2={X1} y2={zeroY} className="stroke-line" strokeWidth={1} />
          {yTicks.map((v) => (
            <text key={v} data-axis="y" x={X0 - 4} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground text-[8px] tabular-nums" aria-hidden="true">{fmt(v)}</text>
          ))}
          {belowZero && (
            <text x={X0 + 4} y={Y_BOTTOM - 4} className="fill-muted-foreground text-[8px]" aria-hidden="true">{t(lang, "burndownOver")}</text>
          )}
          {periods.length > 0 && (
            <>
              <text x={X0} y={H - 8} textAnchor="start" className="fill-muted-foreground text-[8px] tabular-nums" aria-hidden="true">{periods[0]}</text>
              <text x={X1} y={H - 8} textAnchor="end" className="fill-muted-foreground text-[8px] tabular-nums" aria-hidden="true">{periods[periods.length - 1]}</text>
            </>
          )}
          {model.bacLine !== null && (
            <>
              <line x1={X0} y1={y(model.bacLine)} x2={X1} y2={y(model.bacLine)} className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray={DASH.bac} />
              <text x={X0 + 4} y={y(model.bacLine) - 4} className="fill-muted-foreground text-[8px]" aria-hidden="true">{t(lang, "burndownBac", fmt(model.bacLine))}</text>
            </>
          )}
          <polyline points={pts(model.planned)} fill="none" className="stroke-muted-foreground" strokeWidth={2} strokeDasharray={DASH.planned} />
          {model.evLine && <polyline points={pts(model.evLine)} fill="none" className="stroke-[var(--rag-amber)]" strokeWidth={2} strokeDasharray={DASH.evLine} />}
          {model.actual.length > 1 && <polyline points={pts(model.actual)} fill="none" className={actualClass} strokeWidth={2.5} />}
          {model.pace && (
            <>
              <line x1={x(model.pace.from.date)} y1={y(model.pace.from.value)} x2={x(model.pace.to.date)} y2={y(model.pace.to.value)} className="stroke-ui-dark-blue" strokeWidth={2.5} strokeDasharray={DASH.pace} />
              <text x={X1 + 4} y={y(model.pace.to.value) + 3} className="fill-foreground text-[8px] tabular-nums" aria-hidden="true">{fmt(model.pace.endFigure)}</text>
            </>
          )}
          {model.efficiency && (
            <>
              <line x1={x(model.efficiency.from.date)} y1={y(model.efficiency.from.value)} x2={x(model.efficiency.to.date)} y2={y(model.efficiency.to.value)} className="stroke-ui-purple" strokeWidth={2.5} strokeDasharray={DASH.efficiency} />
              <text x={X1 + 4} y={y(model.efficiency.to.value) + 12} className="fill-foreground text-[8px] tabular-nums" aria-hidden="true">{fmt(model.efficiency.endFigure)}</text>
            </>
          )}
          {model.today && (
            <line x1={x(model.today)} y1={Y_TOP} x2={x(model.today)} y2={Y_BOTTOM} className="stroke-muted-foreground" strokeWidth={1} strokeDasharray={DASH.today} />
          )}
          <line x1={x(model.planEnd)} y1={Y_TOP} x2={x(model.planEnd)} y2={Y_BOTTOM} className="stroke-line" strokeWidth={1} />
          {model.ev && (
            <path d={`M ${x(model.ev.date)} ${y(model.ev.value) - 5} l 5 5 l -5 5 l -5 -5 z`} className="fill-[var(--rag-amber)]" />
          )}
          {model.ev && down && (
            <text x={x(model.ev.date) - 7} y={y(model.ev.value) - 7} textAnchor="end" className="fill-muted-foreground text-[8px]" aria-hidden="true">{t(lang, "burndownWorkLeft", fmt(model.ev.value))}</text>
          )}
          {model.runOut && <circle cx={x(model.runOut.date)} cy={y(model.runOut.value)} r={4} className="fill-ui-pink" />}
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><Swatch className="stroke-muted-foreground" dash={DASH.planned} width={2} />{t(lang, "burndownPlanned")}</span>
        {model.actual.length > 1 && <span className="inline-flex items-center gap-1.5"><Swatch className={actualClass} />{t(lang, "burndownActual")}</span>}
        {model.pace && <span className="inline-flex items-center gap-1.5"><Swatch className="stroke-ui-dark-blue" dash={DASH.pace} />{t(lang, "forecastPaceTitle")}</span>}
        {model.efficiency && <span className="inline-flex items-center gap-1.5"><Swatch className="stroke-ui-purple" dash={DASH.efficiency} />{t(lang, "forecastEfficiencyTitle")}</span>}
        {model.evLine && (
          <span className="inline-flex items-center gap-1.5">
            <Swatch className="stroke-[var(--rag-amber)]" dash={DASH.evLine} width={2} />{t(lang, "burndownEvHistory")}
            <TermTooltip lang={lang} term={t(lang, "burndownEvHistory")} tip={t(lang, "burndownTipEvHistory")} />
          </span>
        )}
        {model.ev && <span className="inline-flex items-center gap-1.5"><svg width="10" height="10" aria-hidden="true"><path d="M 5 0 l 5 5 l -5 5 l -5 -5 z" className="fill-[var(--rag-amber)]" /></svg>{t(lang, "burndownEv")}</span>}
        {model.runOut && <span className="inline-flex items-center gap-1.5"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" className="fill-ui-pink" /></svg>{t(lang, "forecastRunOut")}</span>}
        {model.today && <span className="inline-flex items-center gap-1.5"><Swatch className="stroke-muted-foreground" dash={DASH.today} width={1} />{t(lang, "burndownToday")}</span>}
      </div>
      {model.frameDiffers && <p className="text-xs text-muted-foreground">{t(lang, "burndownFrameNote")}</p>}
      {model.evHistoryBlockedBy && (
        <p className="text-xs text-muted-foreground">{t(lang, "burndownEvHistoryUnavailable", model.evHistoryBlockedBy.join(", "))}</p>
      )}
    </div>
  );
}
```

Simplify the "work left" expression to `fmt(model.ev.value)` (in burn-down, the EV point's value already IS BAC − EV); it is written long above only to show the derivation — use the short form.

- [ ] **Step 7: Create the panel** — `src/app/burndown-chart-panel.tsx`:

```tsx
"use client";

// Burn-down chart with its two switches (MR 3 addendum §5.1, §6). The switches
// write device settings through `useSettings` with FUNCTIONAL setters; instances
// sync through the settings listener registry, so the report and the tile agree
// and no stale copy can overwrite the choice (plan Ruling 18). Print shows the
// chosen view; the switches themselves do not print.
import { useMemo } from "react";
import { type Lang, t } from "./i18n";
import { useSettings } from "./use-settings";
import { SegmentedControl } from "./segmented-control";
import { BurndownChart } from "./burndown-chart";
import { buildChartModel, type ChartOrientation, type ChartUnit } from "./burndown-geometry";
import type { BurndownSeries } from "./budget-burndown";
import type { ForecastBundle } from "./budget-forecasts";

export function BurndownChartPanel({
  lang, series, bundle, today, planEnd, currency,
}: {
  lang: Lang; series: BurndownSeries; bundle: Pick<ForecastBundle, "eur" | "hours" | "evHistory"> | null;
  today: string; planEnd: string; currency: string;
}) {
  const { settings, setSettings } = useSettings();
  const orientation: ChartOrientation = settings.budgetChartView ?? "burndown";
  const unit: ChartUnit = settings.budgetChartUnit ?? "eur";
  const model = useMemo(
    () => buildChartModel({
      series, unit, orientation, today, planEnd,
      forecast: bundle ? bundle[unit] : null,
      evHistory: bundle ? bundle.evHistory : null,
    }),
    [series, unit, orientation, today, planEnd, bundle],
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <SegmentedControl<ChartOrientation>
          value={orientation}
          options={[
            { value: "burndown", label: t(lang, "burndownViewBurndown") },
            { value: "cumulative", label: t(lang, "burndownViewCumulative") },
          ]}
          onChange={(v) => setSettings((s) => ({ ...s, budgetChartView: v }))}
          ariaLabel={t(lang, "burndownViewLabel")}
        />
        <SegmentedControl<ChartUnit>
          value={unit}
          options={[
            { value: "eur", label: t(lang, "burndownUnitEur") },
            { value: "hours", label: t(lang, "burndownUnitHours") },
          ]}
          onChange={(v) => setSettings((s) => ({ ...s, budgetChartUnit: v }))}
          ariaLabel={t(lang, "burndownUnitLabel")}
        />
      </div>
      <BurndownChart lang={lang} currency={currency} model={model} unit={unit} orientation={orientation} periods={series.periods} />
    </div>
  );
}
```

- [ ] **Step 8: Run to verify they pass** — same command as Step 5. Expected: EXIT=0, `Test Files 2 passed`.

- [ ] **Step 9: Typecheck (expect the two old `BurndownCharts` call sites to fail — Task 13 fixes them; confirm they are the ONLY `src/` errors), lint, commit**

```bash
npx tsc --noEmit > <scratch>/tsc.log 2>&1; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/settings-types.ts src/app/use-settings.ts src/app/use-settings.test.ts src/app/burndown-chart.tsx src/app/burndown-chart.test.tsx src/app/burndown-chart-panel.tsx src/app/burndown-chart-panel.test.tsx; echo "EXIT=$?"
```

Do NOT commit a red typecheck. Continue straight into Task 13 Steps 1–2, then commit Tasks 12 and 13 as two commits once tsc is clean (stage Task 12's files for the first commit):

```bash
git add src/app/settings-types.ts src/app/use-settings.ts src/app/use-settings.test.ts src/app/burndown-chart.tsx src/app/burndown-chart.test.tsx src/app/burndown-chart-panel.tsx src/app/burndown-chart-panel.test.tsx
git commit -m "feat(burndown): one chart with orientation and unit switches"
```

---

### Task 13: Mount the chart on the Budget report and the tile

**Files:**
- Modify: `src/app/budget-report-panel.tsx`, `src/app/dashboard-tile-bodies.tsx`
- Test: `src/app/budget-report-panel.test.tsx`, `src/app/dashboard-panel.test.tsx`

**Interfaces:**
- Consumes: Task 12 `BurndownChartPanel`; Task 5 `bundle`, `model.forecastBundle`, `model.chartDates`.

- [ ] **Step 1: Replace the report's chart** — in `src/app/budget-report-panel.tsx`, replace `<BurndownCharts series={burndown} lang={lang} currency="EUR" />` with

```tsx
        <BurndownChartPanel lang={lang} series={burndown} bundle={bundle} today={today} planEnd={plan.endDate} currency="EUR" />
```

keeping the ★★ EUR comment above it; swap the import.

- [ ] **Step 2: Replace the tile's chart** — in `src/app/dashboard-tile-bodies.tsx`, replace `<BurndownCharts series={model.burndown} lang={lang} currency={a.currency} />` with

```tsx
            <BurndownChartPanel
              lang={lang}
              series={model.burndown}
              bundle={model.forecastBundle}
              today={model.chartDates.today}
              planEnd={model.chartDates.planEnd}
              currency={a.currency}
            />
```

and swap the import. Run tsc: `src/` must now be clean. Commit Task 12 (see its Step 9).

- [ ] **Step 3: MIGRATE the twin-chart tests**
  - `budget-report-panel.test.tsx`, "renders the burn-down section with both chart captions" (RECOMPUTE): rename to "renders the burn-down section with its chart switches" and assert `screen.getByRole("heading", { name: "Burn-down" })`, `screen.getByRole("radio", { name: "Burn-down" })`, `screen.getByRole("radio", { name: "Hours" })` and `screen.getByText("Budget remaining")` (the default view). A bare `getByText("Burn-down")` now matches two elements.
  - `budget-report-panel.test.tsx` and `dashboard-panel.test.tsx`, "labels the burn-down value axis in EUR even when the plan names another currency" (MIGRATE): keep the scoping through the "Budget remaining" caption's `parentElement`, but count `svg text[data-axis='y']` instead of every `[€$]` text (forecast end labels are money too). The claim stays: every y tick reads €, none the plan currency. Recompute the expected tick count from the test's own fixture (`[yMin if below zero, 0, total/2, total]`).
  - Before each run, `localStorage.clear()` if the file does not already reset it, so a persisted chart view from another test cannot change the default caption.

- [ ] **Step 4: Run the affected files**

Run: `npx vitest run src/app/budget-report-panel.test.tsx src/app/dashboard-panel.test.tsx src/app/burndown-chart.test.tsx src/app/burndown-chart-panel.test.tsx > <scratch>/t13.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0, `Test Files 4 passed`.

- [ ] **Step 5: Confirm no twin-chart reference is left**

Run: `git grep -n "BurndownCharts" -- src e2e; echo "EXIT=$?"`
Expected: no output, EXIT=1.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit > <scratch>/tsc.log 2>&1; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/budget-report-panel.tsx src/app/dashboard-tile-bodies.tsx src/app/budget-report-panel.test.tsx src/app/dashboard-panel.test.tsx; echo "EXIT=$?"
git add src/app/budget-report-panel.tsx src/app/dashboard-tile-bodies.tsx src/app/budget-report-panel.test.tsx src/app/dashboard-panel.test.tsx
git commit -m "feat(burndown): mount the switchable chart on the Budget report and the burn tile"
```

- [ ] **Step 7: Eye-verify note for the final report** — record for the user (do not run a dev server unless asked): the burn tile at `h: 3` now holds headline, chip, tiles, two switches and the chart and will scroll inside the tile (Ruling 15); the Budget report is not reached by the CI axe gate, so a local axe scan of Dashboard and Budget report is offered on the user's say (Ruling 17).

---

### Task 14: Register and docs

**Files:**
- Modify: `docs/open-followups.md` (LF), `docs/AGENTS/dashboard.md` (LF)

**Interfaces:** none (docs only). `<DATE>` below is the commit date, `YYYY-MM-DD`.

A register closure takes FOUR edits per entry, and missing one fails a blocking gate: (1) heading suffix `— OPEN` → `— CLOSED <DATE>`, (2) a new `**Status:** CLOSED <DATE> — …` line citing a command in backticks, (3) DELETE the `**Work item:** #NN` line, (4) the index row's anchor, title suffix and status column. The GitLab issues close from the MR description (`Closes #40`, `Closes #44`, one per line) — never from a commit message.

- [ ] **Step 1: Close §501** (EVM terminology and S-curve, #40).
  - Heading: `## 501. EVM terminology is incomplete across the app, with no BAC, EAC or ETC labels and no time-phased S-curve — CLOSED <DATE>`.
  - Replace the Status paragraph with: `**Status:** CLOSED <DATE> — the forecast figures (§499) shipped the BAC/EAC/ETC/VAC labels; MR 3 of the budget forecast slice shipped the time-phased view: the Cumulative orientation of the burn-down chart draws planned value, actual cost and a derived earned-value line (\`grep -n "burndownValueCumulative\|burndownEvHistory" src/app/i18n.ts\` prints both keys; \`buildChartModel\` in \`burndown-geometry.ts\` builds \`evLine\`). Earned-value history for buckets with a hand-entered % complete continues as §549.` Keep the OPEN-era paragraphs below as the record.
  - Delete `**Work item:** #40`.

- [ ] **Step 2: Close §504** (burn-down forecast line, #44).
  - Heading suffix → `— CLOSED <DATE>`.
  - Status: `**Status:** CLOSED <DATE> — the burn-down chart draws the current-pace forecast (the AIPM Project Burndown "Forecast (Simple)" line: remaining budget minus the 20-working-day burn rate) and the current-efficiency forecast, with a run-out marker, on the Budget report and the dashboard burn tile (\`grep -n "stroke-ui-dark-blue\|stroke-ui-purple" src/app/burndown-chart.tsx\` prints both forecast lines). Alignment with the article: burn rate over the last 20 working days, run-out date, and depletion before or after plan end, per \`docs/superpowers/specs/2026-09-14-budget-forecast-union-design.md\` §1.`
  - Delete `**Work item:** #44`.

- [ ] **Step 3: Narrow §549** (#339 stays open).
  - New heading: `## 549. Buckets with a hand-entered % complete have no earned-value history, so the cumulative chart cannot draw one for them — OPEN`.
  - Status: `**Status:** OPEN <DATE> — MR 3 derives earned-value history from task completion dates, all or nothing: \`grep -n "manual-percent" src/app/budget-ev-history.ts\` shows the unavailable state a hand-entered percent produces, and the chart then names those buckets instead of drawing a line.`
  - Body: replace the first paragraph with what MR 3 shipped (derived, task-linked only, today's links applied to the past) and keep the fix shape for the remaining half: record each bucket's % complete per period (for example alongside Turso snapshots) so a hand-entered percent gains history from the day recording starts.
  - Keep `**Work item:** #339`.

- [ ] **Step 4: Update the three index rows.** For §501 and §504: change the anchor's `--open` to the closed heading's slug, the title suffix to `— CLOSED <DATE>`, and the status column to `closed`. For §549: new anchor, new title, size column `M — record % complete per period for hand-entered buckets`. Derive every anchor with this command (it reproduces an existing anchor exactly — check it against §546 first):

```bash
node -e 'const slug=(h)=>h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu,"").replace(/\s/g,"-"); console.log(slug(process.argv[1]))' "549. <full heading text after ## >"
```

- [ ] **Step 5: Dashboard docs** — in `docs/AGENTS/dashboard.md`, directly after the paragraph that starts `★ **The \`burn\` tile's content (forecast figures union, MR 2):**`, add:

```markdown
★ **The `burn` tile's chart and hours signal (MR 3):** the chart is `BurndownChartPanel` (`burndown-chart-panel.tsx`) — the same component the Budget report mounts — with two `SegmentedControl`s writing the device settings `budgetChartView` / `budgetChartUnit` through `useSettings` (no per-project override). The model carries `forecastBundle` (€ and hours forecasts, rate mix, earned-value history from `computeForecastBundle`) and `chartDates`; `forecast` stays `forecastBundle.eur`, so the budget RAG is still € only. When the rate mix triggers, `ForecastHeadline` adds a `RateMixChip` under the headline; the tile body scrolls inside the tile at `h: 3` as before.
```

- [ ] **Step 6: Run the register gates**

```bash
npm run -s followups:status:check > <scratch>/g-status.log 2>&1; echo "status EXIT=$?"
npm run -s followups:index:check > <scratch>/g-index.log 2>&1; echo "index EXIT=$?"
npm run -s followups:workitems:check > <scratch>/g-work.log 2>&1; echo "workitems EXIT=$?"
npm run -s docs:symbols:check > <scratch>/g-symbols.log 2>&1; echo "symbols EXIT=$?"
npm run -s docs:claims:check > <scratch>/g-claims.log 2>&1; echo "claims EXIT=$?"
```

Expected: all EXIT=0. `docs:symbols:check` gates `docs/AGENTS/dashboard.md`: every backticked mixed-case name in the Step 5 paragraph must exist in `src/`.

- [ ] **Step 7: Commit**

```bash
git add docs/open-followups.md docs/AGENTS/dashboard.md
git commit -m "docs(followups): close 501 and 504, narrow 549; dashboard burn tile chart"
```

(Commit messages carry § numbers only as bare numbers — no `#` followed by digits.)

- [ ] **Step 8: Ask the user before retitling GitLab issue #339** to `§549: Buckets with a hand-entered % complete have no earned-value history, so the cumulative chart cannot draw one for them`. It is an outward-facing change; do it only on their say (at release time together with the MR).

---

## Self-review record

- Spec coverage: §3.1 → Task 1 (+ Ruling 1); §3.2 → Task 4; §3.3 → Task 5 (`forecast` stays €); §3.4 → Tasks 2, 3, 11, 12; §4.1 → Task 6; §4.2 → Task 8; §4.3–§4.4 → Task 9; §4.5–§4.6 → Task 10; §4.7 → Task 7; §5 → Tasks 11–13; §6 → Task 12 (settings), Ruling 15 (tile height); §7 → the tests in each task; §8 → Task 14 (CHANGELOG belongs to the release, not this plan).
- Out of the plan by rule: full suite and local axe (Ruling 17), release bump and CHANGELOG, GitLab retitle (Task 14 Step 8, user-gated).
