# Dated Actuals (MR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TimeLog actuals keep their booking dates: Apply writes day keys (`YYYY-MM-DD`) into allocation `actualHours`, every reader sums them into periods, cells holding TimeLog day hours become read-only, and §169 closes.

**Architecture:** The TimeLog aggregate stores a per-day breakdown (`byBucketDay`, with each resource's daily hours). Consumers derive today's period-keyed overlay from it at read time with the LIVE plan granularity (`bucketOverlay`), so Apply's routing, the people rows and the notices keep their period-keyed contract. Apply keeps owning each period it covers, but writes day keys when every routed booking carries its days. One pure module (`actual-hours.ts`) answers "how many actual hours fall in this period" for every reader.

**Tech Stack:** Next.js / React 19, TypeScript, vitest + Testing Library + fast-check, fake-indexeddb, `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-09-14-budget-forecast-union-design.md` §4 and §7 (MR 1). §4.1–§4.3 and the §11 cache risk were corrected to match this plan in the same commit that added the plan (see "Rulings").

## Rulings (plan vs spec)

Each was forced by the code map and is already written into the spec.

1. **Key rule is scoped to `actualHours`.** `PERIOD_KEY_RE`, `encodePeriodMap`, `decodePeriodMap` and `coercePeriodMap` are shared with `budgetHours`, `Resource.utilization` and `Resource.absenceOverride`. Widening them would let day keys into those period-only fields. New actual-only variants are added instead.
2. **The overlay stays period-keyed; the cache gains days.** Replacing `byBucket` with day keys everywhere would rewrite Apply's routing and roughly 200 tests. Instead `aggregateActuals` returns `byBucketDay`, and `bucketOverlay(agg, granularity)` rolls it up at read time with the live granularity. That removes the fetch-time key freeze (§169) with the period contract intact.
3. **Old cache entries are not marked stale; they are filtered.** An entry written before this change has only `byBucket`. `bucketOverlay` keeps its period cells only when their key shape matches the live granularity, so a pre-upgrade entry can never write hours under a key the report does not read. Apply on such an entry writes a period key exactly as today.
4. **Two more readers.** `budget-panel.tsx`'s local `sumPeriods` and the two `actual={a.actualHours[p.key]}` cells read period keys directly and are switched too. `budget-bucket-people.ts` reads the overlay, which stays period-keyed, so it needs no change.
5. **Only the small sample gets day keys.** `sample-workspace-big.json` / `-huge.json` are not regenerated in this MR (`sample-workspace-huge.json` is never staged).
6. **The read-only cell needs a new prop.** `HoursCell`'s existing `readOnly` drives the budget input only.
7. **The cached day cells are packed at rest (added 2026-09-14, user decision).** Measured during Task 5: a day-keyed aggregate for 40 buckets × 250 days × 8 people is 177–222% of `MAX_ACTUALS_TOTAL_CHARS`, and a refused `localStorage` write was silent. Tasks 9a/9b pack day cells into per-bucket columns (lossless, about 26% of the verbose size), shed the saved entry's own roll as a last stage, and warn in the TimeLog panel when the browser still refuses the write. Design: `.superpowers/sdd/2026-09-14-dated-actuals/cache-design.md` (git-ignored scratch; the plan text below is self-contained).
8. **On a refused write the project's previous cache entry is removed**, so a reload reads "not fetched" rather than an older fetch presented as current. The warning is shown in the TimeLog panel only.
9. **Execution order is 1–7, 9a, 9b, 8**, so Task 8's docs describe the packed cache.

## Global Constraints

- `src/app/*.ts(x)` and `sample-workspace-small.json` are `i/lf w/crlf`. The Edit tool preserves CRLF; never use `sed -i`. Check with `git ls-files --eol <file>`.
- `src/app/i18n.de.ts` is edited ONLY with a Node UTF-8 write whose anchor uses `\r\n`, with real umlauts. Never the Edit tool.
- `src/app/__fixtures__/golden-workspace.csv` is `-text` CRLF and `golden-workspace.md` is `-text` LF: write them only with the serializer's own output.
- Never `git add -A` or `git add .`. Stage named paths. Never stage `sample-workspace-huge.json` or `not-in-use.env.local.bak`. No `--amend`.
- Commit messages carry no `#` followed by digits. End every commit message with `Claude-Session: https://[session link removed]`.
- Never read an exit code through a pipe. Run vitest as `npx vitest run <files> > <log> 2>&1; echo "EXIT=$?"` and then read the log. Never run two vitest processes at once.
- After editing any test file, run `npx tsc --noEmit` (vitest does not typecheck).
- Lint touched files with `npx eslint --max-warnings=0 <files>`. `react-hooks/exhaustive-deps` rejects an `obj.member` dependency: hoist it to a local const.
- `Lang` literals in tests are `"en-US"`, never `"en"`.
- Day key: `YYYY-MM-DD`. Month key: `YYYY-MM`. Week key: `YYYY-Www`. `budgetHours` stays period-only.
- The read-only text is exactly `From TimeLog. Re-apply to change.` (EN) and `Aus TimeLog. Zum Ändern erneut übernehmen.` (DE), key `budgetActualFromTimelog`.

## File Structure

| File | Responsibility |
|---|---|
| Create `src/app/actual-hours.ts` | Pure, i18n-free: day-key test, key → granularity, period lookup (`actualHoursAt`, `actualHoursIn`), `hasDayKeysIn`, `withoutPeriod` |
| Create `src/app/actual-hours.test.ts`, `src/app/actual-hours.property.test.ts` | Unit + property tests for the helper |
| Modify `src/app/sanitize-entities.ts` | Actual-only key rule and codec variants at the six `actualHours` sites |
| Create `src/app/actual-hours-persistence.test.ts` | Day key through JSON, CSV, Markdown, Turso single, Turso tenant, IndexedDB; `budgetHours` still drops day keys |
| Modify `src/app/types.ts` | Doc comments on the two `actualHours` fields |
| Modify `src/app/budget-report.ts`, `src/app/budget-burndown.ts`, `src/app/budget-panel-totals.tsx`, `src/app/budget-panel.tsx` | Readers use the helper; actual cell read-only |
| Modify `src/app/i18n.ts`, `src/app/i18n.de.ts` | `budgetActualFromTimelog` |
| Modify `src/app/timelog-actuals.ts` | `byBucketDay`, `ResourceDayCell`, `bucketOverlay`; `aggregateActuals` loses its granularity argument |
| Modify `src/app/use-timelog-sync.ts`, `src/app/timelog-panel.tsx`, `src/app/timelog-reapply.ts`, `src/app/budget-unapplied-notice.tsx`, `src/app/workspace-section.tsx` | Consumers derive the overlay with the live granularity |
| Modify `src/app/timelog-apply.ts` | Apply writes day keys; diff `current` via helper |
| Modify `sample-workspace-small.json`, `src/app/__fixtures__/golden-workspace.{csv,md}`, `src/app/sample-workspace-budget.test.ts` | Day keys in the sample |
| Modify `docs/superpowers/specs/2026-09-14-budget-forecast-union-design.md`, `docs/AGENTS/integrations.md`, `docs/open-followups.md` | Spec correction, landmine update, §169 closure |

---

### Task 1: Pure actual-hours helper

**Files:**
- Create: `src/app/actual-hours.ts`
- Test: `src/app/actual-hours.test.ts`, `src/app/actual-hours.property.test.ts`

**Interfaces:**
- Consumes: `periodKeyForDate(dateISO: string, granularity: PlanGranularity): string` from `./resource-capacity`; `PlanGranularity` from `./types`.
- Produces:
  - `DAY_KEY_RE: RegExp`
  - `isDayKey(key: string): boolean`
  - `granularityOfPeriodKey(key: string): PlanGranularity | null`
  - `actualHoursIn(map: Readonly<Record<string, number>>, periodKey: string): number`
  - `actualHoursAt(map: Readonly<Record<string, number>>, periodKey: string): number | undefined` (undefined when the period key is absent and no day key falls in the period)
  - `hasDayKeysIn(map: Readonly<Record<string, number>>, periodKey: string): boolean`
  - `withoutPeriod(map: Readonly<Record<string, number>>, periodKey: string): Record<string, number>`

- [ ] **Step 1: Write the failing unit tests**

Create `src/app/actual-hours.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  actualHoursAt, actualHoursIn, granularityOfPeriodKey, hasDayKeysIn, isDayKey, withoutPeriod,
} from "./actual-hours";

describe("isDayKey", () => {
  it("accepts a calendar-shaped day and rejects period keys and junk", () => {
    expect(isDayKey("2026-06-10")).toBe(true);
    expect(isDayKey("2026-06")).toBe(false);
    expect(isDayKey("2026-W24")).toBe(false);
    expect(isDayKey("2026-13-01")).toBe(false);
    expect(isDayKey("2026-06-32")).toBe(false);
    expect(isDayKey("05/01/2026")).toBe(false);
    expect(isDayKey("")).toBe(false);
  });
});

describe("granularityOfPeriodKey", () => {
  it("reads month and week keys and refuses anything else", () => {
    expect(granularityOfPeriodKey("2026-06")).toBe("month");
    expect(granularityOfPeriodKey("2026-W24")).toBe("week");
    expect(granularityOfPeriodKey("2026-06-10")).toBeNull();
    expect(granularityOfPeriodKey("NaN-WNaN")).toBeNull();
  });
});

describe("actualHoursIn / actualHoursAt", () => {
  const map = { "2026-06": 2, "2026-06-10": 3, "2026-06-30": 1.5, "2026-07-01": 7 };

  it("sums the period key and every day key inside a month", () => {
    expect(actualHoursIn(map, "2026-06")).toBe(6.5);
    expect(actualHoursIn(map, "2026-07")).toBe(7);
  });

  it("assigns day keys to ISO weeks", () => {
    // 2026-06-10 is Wednesday of 2026-W24; 2026-06-30 is Tuesday of 2026-W27.
    expect(actualHoursIn(map, "2026-W24")).toBe(3);
    expect(actualHoursIn(map, "2026-W27")).toBe(8.5);
  });

  it("returns 0 from actualHoursIn and undefined from actualHoursAt for an empty period", () => {
    expect(actualHoursIn(map, "2026-08")).toBe(0);
    expect(actualHoursAt(map, "2026-08")).toBeUndefined();
    expect(actualHoursAt({ "2026-08": 0 }, "2026-08")).toBe(0);
    expect(actualHoursAt(map, "2026-06")).toBe(6.5);
  });

  it("reduces to the plain lookup for a period-only map", () => {
    const periodOnly = { "2026-01": 40, "2026-02": 12 };
    expect(actualHoursIn(periodOnly, "2026-01")).toBe(40);
    expect(actualHoursAt(periodOnly, "2026-03")).toBeUndefined();
  });

  it("ignores a key that is neither a period nor a day", () => {
    expect(actualHoursIn({ "": 5, "NaN-WNaN": 5, "2026-06": 1 }, "2026-06")).toBe(1);
  });
});

describe("hasDayKeysIn", () => {
  it("is true only when a day key falls inside the period", () => {
    const map = { "2026-06": 2, "2026-07-01": 7 };
    expect(hasDayKeysIn(map, "2026-06")).toBe(false);
    expect(hasDayKeysIn(map, "2026-07")).toBe(true);
  });
});

describe("withoutPeriod", () => {
  it("removes the period key and its day keys, keeps everything else, and does not mutate", () => {
    const map = { "2026-06": 2, "2026-06-10": 3, "2026-07-01": 7, "2026-W24": 9 };
    const out = withoutPeriod(map, "2026-06");
    expect(out).toEqual({ "2026-07-01": 7, "2026-W24": 9 });
    expect(map).toEqual({ "2026-06": 2, "2026-06-10": 3, "2026-07-01": 7, "2026-W24": 9 });
  });
});
```

- [ ] **Step 2: Write the failing property test**

Create `src/app/actual-hours.property.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { actualHoursIn } from "./actual-hours";
import { periodKeyForDate } from "./resource-capacity";

const DAY_MS = 86_400_000;
const START = Date.UTC(2025, 0, 1);

const dayArb = fc.integer({ min: 0, max: 730 }).map((n) => new Date(START + n * DAY_MS).toISOString().slice(0, 10));
const hoursArb = fc.integer({ min: 0, max: 800 }).map((n) => n / 8);

describe("actualHoursIn conservation", () => {
  it("summing every month of the covered range equals the sum of all day and month keys", () => {
    fc.assert(
      fc.property(fc.dictionary(dayArb, hoursArb), fc.dictionary(dayArb.map((d) => d.slice(0, 7)), hoursArb), (days, months) => {
        const map = { ...days, ...months };
        const keys = new Set([...Object.keys(days).map((d) => periodKeyForDate(d, "month")), ...Object.keys(months)]);
        const total = Object.values(map).reduce((s, v) => s + v, 0);
        const byPeriod = [...keys].reduce((s, k) => s + actualHoursIn(map, k), 0);
        expect(byPeriod).toBeCloseTo(total, 6);
      }),
      { numRuns: 100 },
    );
  });

  it("summing every ISO week of the covered range equals the sum of all day keys", () => {
    fc.assert(
      fc.property(fc.dictionary(dayArb, hoursArb), (days) => {
        const weeks = new Set(Object.keys(days).map((d) => periodKeyForDate(d, "week")));
        const total = Object.values(days).reduce((s, v) => s + v, 0);
        const byWeek = [...weeks].reduce((s, k) => s + actualHoursIn(days, k), 0);
        expect(byWeek).toBeCloseTo(total, 6);
      }),
      { numRuns: 100 },
    );
  });
});
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `npx vitest run src/app/actual-hours.test.ts src/app/actual-hours.property.test.ts > "$TMPDIR/t1.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Cannot find|Failed to resolve" "$TMPDIR/t1.log"`
Expected: `EXIT=1`, and the log reports the `./actual-hours` import cannot be resolved.

- [ ] **Step 4: Implement the helper**

Create `src/app/actual-hours.ts`:

```ts
// src/app/actual-hours.ts — pure, i18n-free reads of an allocation's `actualHours`.
//
// A BucketAllocation / DisciplineAllocation `actualHours` map holds TWO key
// shapes side by side: a plan PERIOD key ("YYYY-MM" month, "YYYY-Www" ISO week)
// written by a hand edit, and a DAY key ("YYYY-MM-DD") written by TimeLog Apply.
// Every reader asks "how many actual hours fall in this period", and this module
// is the one place that answers it. The period's granularity is read off the
// period key's own shape, so no caller has to thread the plan granularity.
//
// ★★ Maps are replaced, never mutated (functional setters), so a per-map cache
// keyed by object identity is safe and makes repeated period lookups O(1) after
// the first.

import { periodKeyForDate } from "./resource-capacity";
import type { PlanGranularity } from "./types";

export const DAY_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const WEEK_KEY_RE = /^\d{4}-(W[0-4]\d|W5[0-3])$/;

type HoursMap = Readonly<Record<string, number>>;
type PeriodTotals = { totals: Record<string, number>; withDays: Set<string> };

const cache = new WeakMap<HoursMap, Map<PlanGranularity, PeriodTotals>>();

export function isDayKey(key: string): boolean {
  return DAY_KEY_RE.test(key);
}

export function granularityOfPeriodKey(key: string): PlanGranularity | null {
  if (MONTH_KEY_RE.test(key)) return "month";
  if (WEEK_KEY_RE.test(key)) return "week";
  return null;
}

function totalsFor(map: HoursMap, granularity: PlanGranularity): PeriodTotals {
  let byGranularity = cache.get(map);
  if (!byGranularity) {
    byGranularity = new Map();
    cache.set(map, byGranularity);
  }
  const hit = byGranularity.get(granularity);
  if (hit) return hit;
  const totals: Record<string, number> = {};
  const withDays = new Set<string>();
  for (const [key, hours] of Object.entries(map)) {
    if (!Number.isFinite(hours)) continue;
    if (isDayKey(key)) {
      const pk = periodKeyForDate(key, granularity);
      totals[pk] = (totals[pk] ?? 0) + hours;
      withDays.add(pk);
    } else if (granularityOfPeriodKey(key) === granularity) {
      totals[key] = (totals[key] ?? 0) + hours;
    }
  }
  const computed = { totals, withDays };
  byGranularity.set(granularity, computed);
  return computed;
}

/** Hours in the period: its own period key plus every day key inside it; 0 when none. */
export function actualHoursIn(map: HoursMap, periodKey: string): number {
  return actualHoursAt(map, periodKey) ?? 0;
}

/** Like `actualHoursIn`, but `undefined` when the period holds no key at all —
 *  so an editable cell can keep rendering blank rather than "0". */
export function actualHoursAt(map: HoursMap, periodKey: string): number | undefined {
  const granularity = granularityOfPeriodKey(periodKey);
  if (granularity === null) return undefined;
  return totalsFor(map, granularity).totals[periodKey];
}

/** True when at least one DAY key falls inside the period. */
export function hasDayKeysIn(map: HoursMap, periodKey: string): boolean {
  const granularity = granularityOfPeriodKey(periodKey);
  if (granularity === null) return false;
  return totalsFor(map, granularity).withDays.has(periodKey);
}

/** A copy without the period key and without every day key inside the period. */
export function withoutPeriod(map: HoursMap, periodKey: string): Record<string, number> {
  const granularity = granularityOfPeriodKey(periodKey);
  const out: Record<string, number> = {};
  for (const [key, hours] of Object.entries(map)) {
    if (key === periodKey) continue;
    if (granularity !== null && isDayKey(key) && periodKeyForDate(key, granularity) === periodKey) continue;
    out[key] = hours;
  }
  return out;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/actual-hours.test.ts src/app/actual-hours.property.test.ts > "$TMPDIR/t1.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$TMPDIR/t1.log"`
Expected: `EXIT=0`, `Test Files  2 passed (2)`.

- [ ] **Step 6: Mutation check**

Temporarily change `if (isDayKey(key)) {` to `if (false) {` in `actual-hours.ts`, rerun the Step 5 command and confirm `EXIT=1`. Revert, rerun and confirm `EXIT=0`. Run `git diff --stat src/app/actual-hours.ts` afterwards: only the new file, no leftover mutant.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/actual-hours.ts src/app/actual-hours.test.ts src/app/actual-hours.property.test.ts; echo "EXIT=$?"
git add src/app/actual-hours.ts src/app/actual-hours.test.ts src/app/actual-hours.property.test.ts
git commit -F - <<'EOF'
feat(budget): pure actual-hours helper for period and day keys

Answers how many actual hours fall in a period when an allocation's map
holds hand-typed period keys and TimeLog day keys side by side. The
period's granularity is read off its key, and totals are cached per map.

Claude-Session: https://[session link removed]
EOF
```

---

### Task 2: Day keys survive every backend (codec)

**Files:**
- Modify: `src/app/sanitize-entities.ts` (key rule block near `PERIOD_KEY_RE`, `encodeAllocations`, `decodeAllocations`, `sanitizeAllocation`, `encodeDisciplineAllocations`, `decodeDisciplineAllocations`, `sanitizeDisciplineAllocation`)
- Modify: `src/app/types.ts` (doc comments on `BucketAllocation` and `DisciplineAllocation`)
- Test: `src/app/actual-hours-persistence.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 at runtime (the codec keeps its own regex so `sanitize-entities.ts` gains no import).
- Produces: `encodeActualMap(map: Record<string, number> | undefined): string` and `decodeActualMap(s: unknown): Record<string, number>` exported from `sanitize-entities.ts`; allocation `actualHours` maps now round-trip day keys.

- [ ] **Step 1: Write the failing persistence test**

Create `src/app/actual-hours-persistence.test.ts`:

```ts
// Day keys in allocation actualHours must survive all six write paths, and
// budgetHours must keep refusing them. A key the codec rejects is dropped
// silently on save, so this is the guard for the whole dated-actuals change.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { DatabaseSync } from "node:sqlite";
import { csvToWorkspace, markdownToWorkspace, workspaceToCsv, workspaceToMarkdown } from "./storage";
import { emptyWorkspace, jsonToWorkspace, workspaceToJson, type Workspace } from "./workspace";
import { ENTITY_SPECS, SCHEMA_DDL, workspaceToStatements, type SqlStmt } from "./turso-schema";
import { tenantSchemaDdl, tenantWorkspaceToStatements } from "./turso-tenant-schema";
import { BrowserBackend } from "./browser-backend";
import type { BudgetBucket } from "./types";

const DETAILED_ACTUAL = { "2026-01": 2, "2026-01-05": 3, "2026-02-02": 1.5 };
const BLENDED_ACTUAL = { "2026-01-06": 4 };

function wsWithDayKeys(): Workspace {
  const detailed = {
    id: 1, name: "Detailed", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-06-30", status: "open",
    allocations: [{ roleId: 3, resourceIds: [5], budgetHours: { "2026-01": 40, "2026-01-05": 9 }, actualHours: DETAILED_ACTUAL }],
  } as unknown as BudgetBucket;
  const blended = {
    id: 2, name: "Blended", type: "tm", currency: "EUR", planningMode: "blended",
    startDate: "2026-01-01", endDate: "2026-06-30", status: "open", allocations: [],
    disciplineAllocations: [{ disciplineId: 4, resourceIds: [], budgetHours: { "2026-01": 8 }, actualHours: BLENDED_ACTUAL }],
  } as unknown as BudgetBucket;
  return { ...emptyWorkspace(), budgets: [detailed, blended] };
}

function expectDayKeysKept(budgets: readonly BudgetBucket[] | undefined): void {
  const byId = new Map((budgets ?? []).map((b) => [b.id, b]));
  expect(byId.get(1)?.allocations[0].actualHours).toEqual(DETAILED_ACTUAL);
  expect(byId.get(2)?.disciplineAllocations?.[0].actualHours).toEqual(BLENDED_ACTUAL);
}

function bindArg(arg: { type: string; value?: string }): string | bigint | null {
  if (arg.type === "null" || arg.value === undefined) return null;
  if (arg.type === "integer" && /^-?\d+$/.test(arg.value)) return BigInt(arg.value);
  return arg.value;
}

function runStatements(db: DatabaseSync, statements: readonly SqlStmt[]): void {
  for (const s of statements) {
    if (!s.args || s.args.length === 0) db.exec(s.sql);
    else db.prepare(s.sql).run(...s.args.map(bindArg));
  }
}

function budgetsFromRows(rows: readonly Record<string, unknown>[]): BudgetBucket[] {
  const spec = ENTITY_SPECS.find((s) => s.table === "budget_buckets");
  if (!spec) throw new Error("budget_buckets spec missing");
  const stringRow = (r: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? "" : String(v)]));
  return rows.map((r) => spec.fromObj(stringRow(r)) as BudgetBucket).filter((b) => b !== null);
}

describe("allocation actualHours day keys survive every backend", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it("JSON", () => {
    expectDayKeysKept(jsonToWorkspace(workspaceToJson(wsWithDayKeys())).budgets);
  });

  it("CSV", () => {
    expectDayKeysKept(csvToWorkspace(workspaceToCsv(wsWithDayKeys())).budgets);
  });

  it("Markdown", () => {
    expectDayKeysKept(markdownToWorkspace(workspaceToMarkdown(wsWithDayKeys())).budgets);
  });

  it("Turso single-tenant", () => {
    const db = new DatabaseSync(":memory:");
    try {
      for (const ddl of SCHEMA_DDL) db.exec(ddl);
      runStatements(db, workspaceToStatements(wsWithDayKeys()));
      expectDayKeysKept(budgetsFromRows(db.prepare("SELECT * FROM budget_buckets").all()));
    } finally {
      db.close();
    }
  });

  it("Turso multi-tenant", () => {
    const db = new DatabaseSync(":memory:");
    try {
      for (const ddl of tenantSchemaDdl()) db.exec(ddl);
      runStatements(db, tenantWorkspaceToStatements(wsWithDayKeys(), "proj-dated-1"));
      const rows = db.prepare("SELECT * FROM budget_buckets WHERE project_id = ?").all("proj-dated-1");
      expectDayKeysKept(budgetsFromRows(rows));
    } finally {
      db.close();
    }
  });

  it("IndexedDB", async () => {
    await new BrowserBackend().save(wsWithDayKeys());
    expectDayKeysKept((await new BrowserBackend().load()).budgets);
  });
});

describe("budgetHours stays period-only", () => {
  it("drops a day key from budgetHours on the CSV and JSON load paths", () => {
    const csv = csvToWorkspace(workspaceToCsv(wsWithDayKeys())).budgets?.find((b) => b.id === 1);
    const json = jsonToWorkspace(workspaceToJson(wsWithDayKeys())).budgets?.find((b) => b.id === 1);
    expect(csv?.allocations[0].budgetHours).toEqual({ "2026-01": 40 });
    expect(json?.allocations[0].budgetHours).toEqual({ "2026-01": 40 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/actual-hours-persistence.test.ts > "$TMPDIR/t2.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |✓|×|FAIL" "$TMPDIR/t2.log"`
Expected: `EXIT=1`. JSON, CSV, Markdown and both Turso tests fail (day keys dropped). IndexedDB passes (it never filtered). "budgetHours stays period-only" passes. If an import in the header does not resolve (for example `workspaceToJson` is exported from a different module), fix the import line to the module `git grep -n "export function workspaceToJson" src/app` names, then rerun.

- [ ] **Step 3: Add the actual-only key rule and codec variants**

In `src/app/sanitize-entities.ts`, directly after the `coercePeriodMap` function, add:

```ts
// ★★ `actualHours` accepts DAY keys ("YYYY-MM-DD", written by TimeLog Apply) as
// well as period keys; `budgetHours`, `Resource.utilization` and
// `Resource.absenceOverride` stay period-only and keep the functions above. The
// period rule and these three functions are deliberately NOT widened in place —
// every caller of them would start accepting day keys.
const ACTUAL_KEY_RE = /^\d{4}-((0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?|W[0-4]\d|W5[0-3])$/;

/** Encode an actualHours map (period and day keys) to "k=v|k=v". */
export function encodeActualMap(map: Record<string, number> | undefined): string {
  if (!map) return "";
  return Object.entries(map)
    .filter(([k, v]) => ACTUAL_KEY_RE.test(k) && Number.isFinite(v))
    .map(([k, v]) => `${k}=${v}`)
    .join("|");
}

/** Decode "k=v|k=v" to an actualHours map; drops malformed keys/values. */
export function decodeActualMap(s: unknown): Record<string, number> {
  if (typeof s !== "string" || !s) return {};
  const out: Record<string, number> = {};
  for (const part of s.split("|")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = Number(part.slice(eq + 1).trim());
    if (ACTUAL_KEY_RE.test(key) && Number.isFinite(val)) out[key] = val;
  }
  return out;
}

/** `coercePeriodMap` for actualHours: object OR encoded string, clamped. */
function coerceActualMap(input: unknown, clampMax: number): Record<string, number> {
  const raw = typeof input === "string" ? decodeActualMap(input) : isPlainObject(input) ? input : {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!ACTUAL_KEY_RE.test(k)) continue;
    const n = toNumber(v);
    if (!Number.isFinite(n)) continue;
    out[k] = Math.min(clampMax, Math.max(0, n));
  }
  return out;
}
```

Then switch exactly the six `actualHours` call sites (leave every `budgetHours` call untouched):

- In `encodeAllocations`: `encodePeriodMap(a.actualHours)` → `encodeActualMap(a.actualHours)`
- In `decodeAllocations`: `actualHours: decodePeriodMap(actualStr),` → `actualHours: decodeActualMap(actualStr),`
- In `sanitizeAllocation`: `actualHours: coercePeriodMap(input.actualHours, HOURS_MAP_MAX),` → `actualHours: coerceActualMap(input.actualHours, HOURS_MAP_MAX),`
- The same three replacements in `encodeDisciplineAllocations`, `decodeDisciplineAllocations` and `sanitizeDisciplineAllocation`.

Before editing `coerceActualMap`, confirm `coercePeriodMap`'s body ends as copied above (`git grep -n "function coercePeriodMap" -A 12 src/app/sanitize-entities.ts`); if it has extra lines after the loop, copy them into `coerceActualMap` too.

- [ ] **Step 4: Update the type comments**

In `src/app/types.ts`, change the `BucketAllocation` doc comment line `*  \`budgetHours\`/\`actualHours\` are periodKey → hours maps (aligned to the plan). */` to:

```ts
 *  `budgetHours` is a periodKey → hours map (aligned to the plan). `actualHours`
 *  holds period keys (hand edits) AND day keys "YYYY-MM-DD" (TimeLog Apply);
 *  read it through `actualHoursIn` / `actualHoursAt` in `actual-hours.ts`. */
```

Make the same change to the `DisciplineAllocation` doc comment ("budget/actual hours are periodKey → hours maps aligned to the plan") so it says the same about `actualHours`.

- [ ] **Step 5: Run the persistence test and the existing codec tests**

Run: `npx vitest run src/app/actual-hours-persistence.test.ts src/app/sanitize-budget.test.ts src/app/storage-budget-csv.test.ts src/app/storage-budget-json.test.ts src/app/storage-budget-md.test.ts src/app/budget-bucket-modal.test.tsx src/app/golden-workspace.test.ts > "$TMPDIR/t2.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$TMPDIR/t2.log"`
Expected: `EXIT=0`, `Test Files  7 passed (7)`. The golden test stays green because the sample has no day keys yet.

- [ ] **Step 6: Mutation check**

Revert only the `sanitizeAllocation` line back to `coercePeriodMap`, rerun `npx vitest run src/app/actual-hours-persistence.test.ts` (redirected, unpiped exit) and confirm the JSON test fails. Restore it. Then revert only the `encodeAllocations` change and confirm CSV, Markdown and both Turso tests fail. Restore it and confirm `EXIT=0`.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/sanitize-entities.ts src/app/types.ts src/app/actual-hours-persistence.test.ts; echo "EXIT=$?"
git ls-files --eol src/app/sanitize-entities.ts src/app/types.ts
git add src/app/sanitize-entities.ts src/app/types.ts src/app/actual-hours-persistence.test.ts
git commit -F - <<'EOF'
feat(budget): let allocation actualHours keep TimeLog day keys on every backend

Adds an actual-only key rule and codec variants, used at the six
actualHours sites. budgetHours, utilization and absence overrides keep the
period-only rule. A test round-trips day keys through JSON, CSV, Markdown,
both Turso layouts and IndexedDB.

Claude-Session: https://[session link removed]
EOF
```

Expected eol line for both source files: `i/lf    w/crlf`.

---

### Task 3: Readers sum day keys

**Files:**
- Modify: `src/app/budget-report.ts` (`sumPeriodMap` and its call in `computeBucketReport`)
- Modify: `src/app/budget-burndown.ts` (both `row.actualHours[p.key]` sites)
- Modify: `src/app/budget-panel-totals.tsx` (`bucketBudgetGrid` columns reducer)
- Modify: `src/app/budget-panel.tsx` (`sumPeriods`)
- Test: `src/app/budget-panel-totals.test.tsx` or new `src/app/actual-hours-readers.test.ts`; additions in `src/app/budget-report.test.ts` and `src/app/budget-burndown.test.ts`

**Interfaces:**
- Consumes: `actualHoursIn(map, periodKey): number` from Task 1.
- Produces: no new exports; every period total now includes day keys.

- [ ] **Step 1: Write the failing grid test**

Create `src/app/actual-hours-readers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bucketBudgetGrid, type TotalsRow } from "./budget-panel-totals";

describe("bucketBudgetGrid actual totals", () => {
  it("counts day keys inside each period column and in the grand total", () => {
    const rows: TotalsRow[] = [
      { resourceIds: [], budgetHours: {}, actualHours: { "2026-01": 2, "2026-01-05": 3, "2026-02-02": 7 } },
      { resourceIds: [], budgetHours: {}, actualHours: { "2026-02": 1 } },
    ];
    const grid = bucketBudgetGrid(rows, [{ key: "2026-01" }, { key: "2026-02" }], () => 0);
    expect(grid.columns.map((c) => c.actual)).toEqual([5, 8]);
    expect(grid.grandActual).toBe(13);
  });
});
```

- [ ] **Step 2: Write the failing report and burn-down tests**

In `src/app/budget-report.test.ts`, find the first test whose bucket fixture has `actualHours: { "2026-01": <n> }` (`git grep -n 'actualHours: { "2026-01"' src/app/budget-report.test.ts`). Add a new test directly below it that copies that test's arrange block exactly, then:

```ts
// Same fixture, but the January actual hours are split into day keys that sum
// to the original figure. Every total the report derives must be identical.
```

Replace the copied bucket's `actualHours: { "2026-01": <n> }` with `actualHours: { "2026-01-05": <n> / 2, "2026-01-20": <n> / 2 }` (write the two numbers out literally), compute the report with the same call, and assert `expect(dayKeyed.buckets[0].actualHours).toBe(<n>)` and `expect(dayKeyed.project.actualHours).toBe(<n>)`. Use the exact bucket/project field names the copied test asserts on.

In `src/app/budget-burndown.test.ts`, do the same with the first fixture that has a `"2026-01"` actual-hours key (`git grep -n 'actualHours: { "2026-01"' src/app/budget-burndown.test.ts`): copy its arrange block and call, split the January value into two day keys inside January, and assert the resulting series equals the original test's expected series for the same period (`actualRemainingHours` / `actualRemainingValue`, whichever the copied test asserts).

- [ ] **Step 3: Run the three files to verify the new tests fail**

Run: `npx vitest run src/app/actual-hours-readers.test.ts src/app/budget-report.test.ts src/app/budget-burndown.test.ts > "$TMPDIR/t3.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |×" "$TMPDIR/t3.log"`
Expected: `EXIT=1`; the three new tests fail (day keys counted as 0), every existing test passes.

- [ ] **Step 4: Switch the readers**

`src/app/budget-report.ts`: add `import { actualHoursIn } from "./actual-hours";` with the other imports. Replace

```ts
    const aActual = sumPeriodMap(row.actualHours, keys);
```

with

```ts
    const aActual = keys.reduce((s, k) => s + actualHoursIn(row.actualHours, k), 0);
```

Then run `git grep -n "sumPeriodMap" src/app/budget-report.ts`. If the definition is the only remaining hit, delete the whole `sumPeriodMap` function and its doc comment (lint fails on an unused local).

`src/app/budget-burndown.ts`: add `import { actualHoursIn } from "./actual-hours";`. Replace `ah += row.actualHours[p.key] ?? 0;` with `ah += actualHoursIn(row.actualHours, p.key);` and `const ah = row.actualHours[p.key] ?? 0;` with `const ah = actualHoursIn(row.actualHours, p.key);`.

`src/app/budget-panel-totals.tsx`: add `import { actualHoursIn } from "./actual-hours";`. Replace

```ts
    actual: rows.reduce((s, r) => s + (r.actualHours[p.key] ?? 0), 0),
```

with

```ts
    actual: rows.reduce((s, r) => s + actualHoursIn(r.actualHours, p.key), 0),
```

`src/app/budget-panel.tsx`: add `import { actualHoursAt, actualHoursIn, hasDayKeysIn } from "./actual-hours";` (Task 4 uses the other two). Replace the body of `sumPeriods`:

```ts
function sumPeriods(hours: Record<string, number>, periods: { key: string }[]): number {
  return periods.reduce((s, p) => s + actualHoursIn(hours, p.key), 0);
}
```

Confirm `sumPeriods` has only actual-hours callers: `git grep -n "sumPeriods(" src/app/budget-panel.tsx` must show only the two `totActual` lines. If `actualHoursAt` / `hasDayKeysIn` are unused until Task 4 and lint fails, import only `actualHoursIn` now and extend the import in Task 4.

- [ ] **Step 5: Run the reader tests and the budget suites**

Run: `npx vitest run src/app/actual-hours-readers.test.ts src/app/budget-report.test.ts src/app/budget-report-bucket.test.ts src/app/budget-report-blended.test.ts src/app/budget-report-edges.test.ts src/app/budget-report-project.test.ts src/app/budget-burndown.test.ts src/app/budget-panel.test.tsx src/app/budget-panel-edit.test.tsx src/app/budget-report-panel.test.tsx > "$TMPDIR/t3.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$TMPDIR/t3.log"`
Expected: `EXIT=0`, `Test Files  10 passed (10)`.

- [ ] **Step 6: Mutation check**

Put `actualHours: rows.reduce((s, r) => s + (r.actualHours[p.key] ?? 0), 0),` back in `budget-panel-totals.tsx`, rerun `actual-hours-readers.test.ts` alone and confirm it fails; restore. Do the same for the `budget-report.ts` line against the new report test, and one burn-down site against the new burn-down test. Finish with the Step 5 command at `EXIT=0`.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/budget-report.ts src/app/budget-burndown.ts src/app/budget-panel-totals.tsx src/app/budget-panel.tsx src/app/actual-hours-readers.test.ts src/app/budget-report.test.ts src/app/budget-burndown.test.ts; echo "EXIT=$?"
git add src/app/budget-report.ts src/app/budget-burndown.ts src/app/budget-panel-totals.tsx src/app/budget-panel.tsx src/app/actual-hours-readers.test.ts src/app/budget-report.test.ts src/app/budget-burndown.test.ts
git commit -F - <<'EOF'
feat(budget): count TimeLog day keys in every actual-hours total

The bucket report, burn-down, panel column totals and panel row totals now
read actual hours through actualHoursIn, so day keys add into the period
that contains them. A period-only map totals exactly as before.

Claude-Session: https://[session link removed]
EOF
```

---

### Task 4: Read-only actual cell for TimeLog periods

**Files:**
- Modify: `src/app/budget-panel-totals.tsx` (`HoursCell`, `HoursTd`)
- Modify: `src/app/budget-panel.tsx` (both `HoursTd` call sites)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/budget-panel-actual-readonly.test.tsx`

**Interfaces:**
- Consumes: `actualHoursAt`, `hasDayKeysIn` from Task 1.
- Produces: `HoursTd` / `HoursCell` accept `actualReadOnlyReason?: string`; i18n key `budgetActualFromTimelog`.

- [ ] **Step 1: Write the failing component test**

Create `src/app/budget-panel-actual-readonly.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HoursTd } from "./budget-panel-totals";

function renderCell(actualReadOnlyReason?: string) {
  const onActual = vi.fn();
  render(
    <table><tbody><tr>
      <HoursTd
        ariaPrefix="1-3-2026-06" budget={10} actual={6} onBudget={vi.fn()} onActual={onActual}
        lang="en-US" periodEnd="2026-06-30" today="2026-07-15" actualReadOnlyReason={actualReadOnlyReason}
      />
    </tr></tbody></table>,
  );
  return { onActual, input: screen.getByLabelText("actual-1-3-2026-06") as HTMLInputElement };
}

describe("HoursTd actual input read-only state", () => {
  it("is read-only, titled and described when a reason is given", async () => {
    const { onActual, input } = renderCell("From TimeLog. Re-apply to change.");
    expect(input.readOnly).toBe(true);
    expect(input).toHaveAttribute("title", "From TimeLog. Re-apply to change.");
    expect(input).toHaveAccessibleDescription("From TimeLog. Re-apply to change.");
    expect(input.value).toBe("6");
    await userEvent.type(input, "9");
    await userEvent.tab();
    expect(onActual).not.toHaveBeenCalled();
  });

  it("stays editable with no title or description when no reason is given", async () => {
    const { onActual, input } = renderCell();
    expect(input.readOnly).toBe(false);
    expect(input).not.toHaveAttribute("title");
    expect(input).not.toHaveAttribute("aria-describedby");
    await userEvent.clear(input);
    await userEvent.type(input, "9");
    await userEvent.tab();
    expect(onActual).toHaveBeenCalledWith(9);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/budget-panel-actual-readonly.test.tsx > "$TMPDIR/t4.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |×" "$TMPDIR/t4.log"`
Expected: `EXIT=1`; the first test fails (`readOnly` false), the second passes.

- [ ] **Step 3: Add the prop to `HoursCell` and `HoursTd`**

In `src/app/budget-panel-totals.tsx`, add `useId` to the React import (or add `import { useId } from "react";` if React is not imported by name).

`HoursCell`: add `actualReadOnlyReason` to the destructured props and the prop type:

```ts
  // When set, the ACTUAL input is read-only: its period holds TimeLog day hours,
  // which only a re-apply may change. The reason becomes the input's title and
  // accessible description. Independent of `readOnly`, which drives the budget
  // input only.
  actualReadOnlyReason?: string;
```

Inside the component, after the `actualDraft` line, add:

```ts
  const actualReasonId = useId();
  const actualReadOnly = actualReadOnlyReason !== undefined;
```

Replace the actual `<input>` with:

```tsx
        <input
          aria-label={`actual-${ariaPrefix}`}
          type="number"
          value={actualReadOnly ? displayHours(actual, true) : actualDraft.value}
          readOnly={actualReadOnly}
          title={actualReadOnlyReason}
          aria-describedby={actualReadOnly ? actualReasonId : undefined}
          onChange={actualReadOnly ? undefined : (e) => actualDraft.onChange(e.target.value)}
          onFocus={actualReadOnly ? undefined : actualDraft.onFocus}
          onBlur={actualReadOnly ? undefined : actualDraft.onBlur}
          onKeyDown={actualReadOnly ? undefined : actualDraft.onKeyDown}
          className={`w-16 rounded border border-line bg-surface-muted px-1 py-0.5 text-right tabular-nums ${actualReadOnly ? "text-muted-foreground" : ""} ${FOCUS_RING} ${TRANSITION}`}
        />
        {actualReadOnly && <span id={actualReasonId} className="sr-only">{actualReadOnlyReason}</span>}
```

Keep the `RagBadge` line after it unchanged.

`HoursTd`: add `actualReadOnlyReason` to its destructured props, add `actualReadOnlyReason?: string;` to its prop type, and pass `actualReadOnlyReason={actualReadOnlyReason}` to `<HoursCell>`.

- [ ] **Step 4: Run the component test to verify it passes**

Run the Step 2 command. Expected: `EXIT=0`, `Tests  2 passed (2)`.

- [ ] **Step 5: Add the i18n strings**

`src/app/i18n.ts`: directly below `  budgetCellActual: "Actual",` add

```ts
  budgetActualFromTimelog: "From TimeLog. Re-apply to change.",
```

`src/app/i18n.de.ts` (Node only). Write this script to `$TMPDIR/add-de-key.cjs` with the Write tool, then run `node "$TMPDIR/add-de-key.cjs"; echo "EXIT=$?"`:

```js
const fs = require("fs");
const file = "src/app/i18n.de.ts";
const src = fs.readFileSync(file, "utf8");
const anchor = '  budgetCellActual: "Ist",\r\n';
const count = src.split(anchor).length - 1;
if (count !== 1) throw new Error(`anchor found ${count} times`);
const line = '  budgetActualFromTimelog: "Aus TimeLog. Zum Ändern erneut übernehmen.",\r\n';
fs.writeFileSync(file, src.replace(anchor, anchor + line), "utf8");
console.log("ok");
```

Verify: `grep -n "budgetActualFromTimelog" src/app/i18n.ts src/app/i18n.de.ts` shows both lines with real umlauts, and `git ls-files --eol src/app/i18n.de.ts` still reads `i/lf    w/crlf`.

- [ ] **Step 6: Wire the panel cells**

In `src/app/budget-panel.tsx`, in the detailed-row `HoursTd` (the one with `ariaPrefix={\`${bucket.id}-${a.roleId}-${p.key}\`}`), replace `actual={a.actualHours[p.key]}` with:

```tsx
                            actual={actualHoursAt(a.actualHours, p.key)}
                            actualReadOnlyReason={hasDayKeysIn(a.actualHours, p.key) ? t(lang, "budgetActualFromTimelog") : undefined}
```

Make the identical change in the blended-row `HoursTd` (the one with `ariaPrefix={\`${bucket.id}-d${a.disciplineId}-${p.key}\`}`). Ensure the import from `./actual-hours` now names `actualHoursAt`, `actualHoursIn` and `hasDayKeysIn`.

- [ ] **Step 7: Add a panel-level test**

In `src/app/budget-panel.test.tsx`, find the render helper used by tests that type into an actual input (`git grep -n "actual-" src/app/budget-panel.test.tsx | head`). Add one test that renders the panel with a bucket whose first allocation has `actualHours: { "2026-01-05": 3, "2026-01-06": 2 }` inside a period the view shows, then asserts the actual input for that period (`screen.getByLabelText(\`actual-<bucketId>-<roleId>-2026-01\`)`) has `readOnly === true`, value `"5"` and accessible description `From TimeLog. Re-apply to change.`, and that a period without day keys in the same row is not read-only. Use the file's existing fixture builders and the exact `ariaPrefix` format from the step above.

- [ ] **Step 8: Run the budget panel suites and i18n tests**

Run: `npx vitest run src/app/budget-panel-actual-readonly.test.tsx src/app/budget-panel.test.tsx src/app/budget-panel-edit.test.tsx src/app/i18n.test.ts src/app/i18n-encoding.test.ts > "$TMPDIR/t4.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$TMPDIR/t4.log"`
Expected: `EXIT=0`. If `i18n-encoding.test.ts` has a different file name, find it with `git ls-files "src/app/*encoding*"`.

- [ ] **Step 9: Mutation check**

Change `readOnly={actualReadOnly}` to `readOnly={false}` and confirm `budget-panel-actual-readonly.test.tsx` fails; restore. In `budget-panel.tsx`, change one `hasDayKeysIn(...)` to `false` and confirm the Step 7 test fails; restore.

- [ ] **Step 10: Typecheck, lint, commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/budget-panel-totals.tsx src/app/budget-panel.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/budget-panel-actual-readonly.test.tsx src/app/budget-panel.test.tsx; echo "EXIT=$?"
git add src/app/budget-panel-totals.tsx src/app/budget-panel.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/budget-panel-actual-readonly.test.tsx src/app/budget-panel.test.tsx
git commit -F - <<'EOF'
feat(budget): make a period's actual cell read-only when it holds TimeLog day hours

The cell shows the period total and explains, as title and accessible
description, that only a re-apply changes it. Cells without day keys stay
editable exactly as before.

Claude-Session: https://[session link removed]
EOF
```

---

### Task 5: Day breakdown in the TimeLog aggregate, overlay at read time

**Files:**
- Modify: `src/app/timelog-actuals.ts`
- Modify: `src/app/use-timelog-sync.ts`, `src/app/timelog-panel.tsx`, `src/app/timelog-reapply.ts`, `src/app/budget-unapplied-notice.tsx`, `src/app/budget-panel.tsx`, `src/app/workspace-section.tsx`
- Test: `src/app/timelog-actuals.test.ts`, `src/app/timelog-actuals.property.test.ts`, `src/app/use-timelog-sync.test.ts`, `src/app/timelog-reapply.test.ts`, `src/app/budget-unapplied-notice.test.tsx`, `src/app/timelog-panel.test.tsx`

**Interfaces:**
- Consumes: `granularityOfPeriodKey` from Task 1; `periodKeyForDate` from `./resource-capacity`.
- Produces (in `timelog-actuals.ts`):
  - `type ResourceDayCell = HourCell & { byDay?: Record<string, number> }`
  - `type BucketPeriodCell = HourCell & { byResource?: Record<number, ResourceDayCell> }` (widened)
  - `type ActualsByBucketDay = Record<number, Record<string, BucketPeriodCell>>` (day-keyed)
  - `ActualsAggregate` gains `byBucketDay?: ActualsByBucketDay`; `byBucket` becomes optional (`byBucket?: ActualsByBucket`, legacy entries only)
  - `aggregateActuals(items: readonly TimelogTimeItem[], links: TimelogLinks): ActualsAggregate` (granularity argument removed)
  - `bucketOverlay(agg: ActualsAggregate | undefined, granularity: PlanGranularity): ActualsByBucket`
  - `decideReapply(result, buckets, resources, roles, granularity: PlanGranularity)` (new last parameter)
  - `BudgetUnappliedNotice` gains required prop `granularity: PlanGranularity`

- [ ] **Step 1: Write the failing engine tests**

Append to `src/app/timelog-actuals.test.ts` (reuse the file's existing `links` fixture and item builder; `git grep -n "const links\|function item\|const item" src/app/timelog-actuals.test.ts` names them). The code below assumes the builder is `item(userId, projectId, date, hours)`; adapt only the call shape to the real one:

```ts
describe("byBucketDay and bucketOverlay", () => {
  it("keeps each booking's day and resource in byBucketDay", () => {
    const agg = aggregateActuals([item(1, 9, "2026-06-10", 2), item(1, 9, "2026-06-10", 1), item(2, 9, "2026-06-11", 4)], links);
    expect(agg.byBucket).toBeUndefined();
    const days = agg.byBucketDay?.[7];
    expect(days?.["2026-06-10"]?.hours).toBe(3);
    expect(days?.["2026-06-11"]?.byResource?.[20]?.hours).toBe(4);
  });

  it("rolls days up into month periods with per-resource byDay", () => {
    const agg = aggregateActuals([item(1, 9, "2026-06-10", 2), item(1, 9, "2026-06-30", 1), item(1, 9, "2026-07-01", 5)], links);
    const overlay = bucketOverlay(agg, "month");
    expect(overlay[7]["2026-06"].hours).toBe(3);
    expect(overlay[7]["2026-06"].byResource?.[10]?.byDay).toEqual({ "2026-06-10": 2, "2026-06-30": 1 });
    expect(overlay[7]["2026-07"].hours).toBe(5);
  });

  it("rolls the same aggregate into ISO weeks when the plan is weekly (§169)", () => {
    const agg = aggregateActuals([item(1, 9, "2026-06-10", 4)], links);
    expect(bucketOverlay(agg, "week")[7]["2026-W24"].hours).toBe(4);
    expect(bucketOverlay(agg, "month")[7]["2026-06"].hours).toBe(4);
  });

  it("keeps a legacy period-keyed entry only where its keys match the live granularity", () => {
    const legacy = {
      byBucket: { 7: { "2026-06": { hours: 6, billableHours: 6 }, "2026-W24": { hours: 4, billableHours: 4 } } },
      byResource: {}, unattributed: { hours: 0, billableHours: 0 },
    };
    expect(Object.keys(bucketOverlay(legacy, "month")[7])).toEqual(["2026-06"]);
    expect(Object.keys(bucketOverlay(legacy, "week")[7])).toEqual(["2026-W24"]);
  });

  it("returns an empty overlay for an absent aggregate", () => {
    expect(bucketOverlay(undefined, "month")).toEqual({});
  });
});
```

The resource ids in the assertions (`10`, `20`) must be the ids the file's `links` fixture maps users 1 and 2 to, and bucket `7` the bucket project 9 maps to; adjust the literals to that fixture.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/timelog-actuals.test.ts > "$TMPDIR/t5.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |×|bucketOverlay" "$TMPDIR/t5.log"`
Expected: `EXIT=1` (`bucketOverlay` is not exported).

- [ ] **Step 3: Change the engine types and `aggregateActuals`**

In `src/app/timelog-actuals.ts`:

Replace the `BucketPeriodCell` and `ActualsByBucket` type lines with:

```ts
/** One resource's hours inside a cell. `byDay` is present on cells derived from
 *  a dated aggregate (`bucketOverlay` over `byBucketDay`) and lets Apply write
 *  day keys; a legacy cached cell has no `byDay`. */
export type ResourceDayCell = HourCell & { byDay?: Record<string, number> };
export type BucketPeriodCell = HourCell & { byResource?: Record<number, ResourceDayCell> };
/** bucketId → PERIOD key ("YYYY-MM" / "YYYY-Www") → cell. Derived, never cached. */
export type ActualsByBucket = Record<number, Record<string, BucketPeriodCell>>;
/** bucketId → DAY key ("YYYY-MM-DD") → cell. What the fetch stores. */
export type ActualsByBucketDay = Record<number, Record<string, BucketPeriodCell>>;
```

Keep the existing docstring above `BucketPeriodCell` and append one sentence to it: "Since dated actuals, the fetch stores day cells (`byBucketDay`) and periods are derived at read time by `bucketOverlay`."

In `ActualsAggregate`, replace `byBucket: ActualsByBucket;` with:

```ts
  /** LEGACY: period-keyed cells written before dated actuals, frozen at the
   *  granularity of that fetch. New fetches never write it. Read it only through
   *  `bucketOverlay`, which drops keys that do not match the live granularity. */
  byBucket?: ActualsByBucket;
  /** Day-keyed cells. Read through `bucketOverlay`. */
  byBucketDay?: ActualsByBucketDay;
```

Change `aggregateActuals`: remove the `granularity` parameter and its comment, rename the local `byBucket` to `byBucketDay` (type `ActualsByBucketDay`), replace

```ts
    const pk = periodKeyForDate(it.date, granularity);
    byBucket[bucketId] ??= {};
    const cur = byBucket[bucketId][pk];
    byBucket[bucketId][pk] = {
```

with

```ts
    // The DAY is the key. Periods are derived at read time (`bucketOverlay`) with
    // the live plan granularity, so a granularity change after the fetch can no
    // longer file hours under keys the report never reads (§169).
    const day = it.date;
    byBucketDay[bucketId] ??= {};
    const cur = byBucketDay[bucketId][day];
    byBucketDay[bucketId][day] = {
```

and return `{ byBucketDay, byResource, unattributed, undated }`. Keep `ISO_DAY_RE` and the unattributed/undated logic exactly as they are.

Add `import type { PlanGranularity } from "./types";` (the file already imports `PlanGranularity` from `./types`; keep one import), `import { granularityOfPeriodKey } from "./actual-hours";`, and keep the `periodKeyForDate` import (used below).

Add after `aggregateActuals`:

```ts
/**
 * The period-keyed overlay every consumer reads, derived with the LIVE plan
 * granularity. A dated aggregate rolls its day cells up and records each
 * resource's `byDay`, so Apply can write day keys. A legacy aggregate keeps
 * only the cells whose key shape matches `granularity`; a cell frozen at the
 * other granularity would land under a key the report never reads.
 */
export function bucketOverlay(agg: ActualsAggregate | undefined, granularity: PlanGranularity): ActualsByBucket {
  if (!agg) return {};
  if (agg.byBucketDay) return rollUpDays(agg.byBucketDay, granularity);
  return legacyOverlay(agg.byBucket ?? {}, granularity);
}

function rollUpDays(days: ActualsByBucketDay, granularity: PlanGranularity): ActualsByBucket {
  const out: ActualsByBucket = {};
  for (const [bucketId, byDay] of Object.entries(days)) {
    const periods: Record<string, BucketPeriodCell> = {};
    for (const [day, cell] of Object.entries(byDay)) {
      const pk = periodKeyForDate(day, granularity);
      const cur = periods[pk];
      const byResource: Record<number, ResourceDayCell> = { ...cur?.byResource };
      for (const [rid, rc] of Object.entries(cell.byResource ?? {})) {
        const id = Number(rid);
        const prev = byResource[id];
        byResource[id] = {
          hours: (prev?.hours ?? 0) + rc.hours,
          billableHours: (prev?.billableHours ?? 0) + rc.billableHours,
          byDay: { ...prev?.byDay, [day]: (prev?.byDay?.[day] ?? 0) + rc.hours },
        };
      }
      periods[pk] = {
        hours: (cur?.hours ?? 0) + cell.hours,
        billableHours: (cur?.billableHours ?? 0) + cell.billableHours,
        byResource,
      };
    }
    out[Number(bucketId)] = periods;
  }
  return out;
}

function legacyOverlay(byBucket: ActualsByBucket, granularity: PlanGranularity): ActualsByBucket {
  const out: ActualsByBucket = {};
  for (const [bucketId, periods] of Object.entries(byBucket)) {
    const kept: Record<string, BucketPeriodCell> = {};
    for (const [pk, cell] of Object.entries(periods)) {
      if (granularityOfPeriodKey(pk) === granularity) kept[pk] = cell;
    }
    if (Object.keys(kept).length > 0) out[Number(bucketId)] = kept;
  }
  return out;
}
```

- [ ] **Step 4: Migrate the existing engine tests**

In `src/app/timelog-actuals.test.ts`:
- Every `aggregateActuals(<items>, <links>, "month")` becomes `aggregateActuals(<items>, <links>)`.
- Every assertion that reads `agg.byBucket[...]` / `result.byBucket[...]` reads `bucketOverlay(<agg>, "month")[...]` instead, keeping the asserted period keys and values.
- Delete the three tests named "week granularity: aggregates under YYYY-Www key, NOT YYYY-MM", "week granularity: a malformed date does not mint the NaN-WNaN key" and "week granularity: items in different weeks get distinct keys". Their behaviour now lives in `bucketOverlay` and is covered by the Step 1 "rolls the same aggregate into ISO weeks" test.
- Add to the Step 1 describe block one test that replaces the deleted malformed-date week test: a malformed-date item goes to `unattributed` and `Object.keys(bucketOverlay(agg, "week")[7] ?? {})` contains no key other than valid week keys for the well-formed items.

In `src/app/timelog-actuals.property.test.ts`, drop the `"month"` argument, and compute the bucket sum over `agg.byBucketDay` (sum every cell's `hours`) instead of `agg.byBucket`.

- [ ] **Step 5: Run the engine tests**

Run: `npx vitest run src/app/timelog-actuals.test.ts src/app/timelog-actuals.property.test.ts > "$TMPDIR/t5.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$TMPDIR/t5.log"`
Expected: `EXIT=0`.

- [ ] **Step 6: Update the consumers**

`src/app/use-timelog-sync.ts`: remove `granularity: PlanGranularity;` from `Args`, remove `const granularity = args.granularity;`, and call `aggregateActuals(items, effectiveLinks)`. Remove the `PlanGranularity` import if it becomes unused.

`src/app/timelog-panel.tsx`:
- Remove `granularity: planGranularity,` from the `useTimelogSync({...})` call.
- Replace `const overlay = sync.aggregates?.byBucket;` with

```tsx
  const overlay = useMemo(
    () => (sync.aggregates ? bucketOverlay(sync.aggregates, planGranularity) : undefined),
    [sync.aggregates, planGranularity],
  );
```

- Change the re-apply call to `decideReapply(await handleRefreshBookings(), budgets, matchableResources, roles, planGranularity)`.
- Import `bucketOverlay` from `./timelog-actuals`; ensure `useMemo` is imported.

`src/app/timelog-reapply.ts`: add `import type { PlanGranularity } from "./types";` and `import { bucketOverlay } from "./timelog-actuals";`. Add a last parameter to `decideReapply`:

```ts
  /** The LIVE plan granularity: the overlay is derived from the fetched day
   *  cells at call time, never from a period key frozen at fetch time. */
  granularity: PlanGranularity,
```

Replace `const overlay = result.aggregates?.byBucket;` with `const overlay = result.aggregates ? bucketOverlay(result.aggregates, granularity) : undefined;`. Keep every later line unchanged.

`src/app/budget-unapplied-notice.tsx`: add `granularity: PlanGranularity;` to `BudgetUnappliedNoticeProps` with the comment `/** Live plan granularity; the cached day cells are rolled up with it. */`, destructure it, and replace the two `aggregates?.byBucket` reads with a derived overlay:

```tsx
  const overlay = useMemo(() => (aggregates ? bucketOverlay(aggregates, granularity) : null), [aggregates, granularity]);
  const plan = useMemo(
    () => (overlay ? buildApplyPlan(buckets, overlay, pickMatchableResources(resources), roles) : null),
    [overlay, buckets, resources, roles],
  );
```

and `const missing = useMemo(() => (overlay ? bucketsMissingAllocations(buckets, overlay).length : 0), [overlay, buckets]);`. Import `bucketOverlay` and `PlanGranularity`.

`src/app/budget-panel.tsx`: pass `granularity={plan.granularity}` to `<BudgetUnappliedNotice ... />`.

`src/app/workspace-section.tsx`: confirm `plan` is in scope above the `budgetActuals` memo (`git grep -n "plan" src/app/workspace-section.tsx | head -20`). Add `const planGranularity = plan.granularity;` directly above the memo and replace the memo with:

```tsx
  const budgetActuals = useMemo(() => { const c = loadActualsCache(currentProjectId ?? "default"); return { byBucket: bucketOverlay(c?.aggregates, planGranularity), fetchedAt: c?.fetchedAt }; }, [currentProjectId, planGranularity]);
```

Import `bucketOverlay` from `./timelog-actuals`. If `plan` can be undefined there, use `plan?.granularity ?? "month"` (the fallback `timelog-panel.tsx` already uses).

- [ ] **Step 7: Migrate the consumer tests**

- `src/app/use-timelog-sync.test.ts`: remove `granularity: "month" as const` from the `args()` helper; delete the test "week granularity: aggregates under weekly key (2026-W24), not monthly key (2026-06)"; change every `result.current.aggregates?.byBucket[7]["2026-06"]` (and the same pattern on other result names) to `bucketOverlay(result.current.aggregates, "month")[7]?.["2026-06"]`. Import `bucketOverlay`.
- `src/app/timelog-reapply.test.ts`: add `"month"` as the last argument of every `decideReapply(...)` call. Fixtures keep their `aggregates: { byBucket: {...} }` month-keyed shape; the legacy path keeps them.
- `src/app/budget-unapplied-notice.test.tsx`: add `granularity="month"` to every render of `BudgetUnappliedNotice` (the file's render helper, if it has one, is the single place).
- `src/app/timelog-panel.test.tsx`: run it first unchanged (Step 8). Its `useTimelogSync` mock returns month-keyed legacy `byBucket` aggregates, which `bucketOverlay(…, "month")` keeps. Only if a test fails, move that mock's `byBucket` to `byBucketDay` with a day inside the same month and the same per-resource breakdown.
- `src/app/timelog-actuals-store.test.ts`: `byBucket` is now optional, so the two `?.aggregates?.byBucket[7]["…"]` reads fail typecheck. Change each to `?.aggregates?.byBucket?.[7]?.["…"]` with the same key and expected value.
- Then run `npx tsc --noEmit; echo "EXIT=$?"`. For every remaining error in a test file that reads `.byBucket[`, apply the same optional-access change; for an error in a source file, the consumer was missed in Step 6: switch it to `bucketOverlay(<aggregate>, <live granularity>)`.

- [ ] **Step 8: Run every TimeLog and budget consumer suite**

Run: `npx vitest run src/app/timelog-actuals.test.ts src/app/timelog-actuals.property.test.ts src/app/use-timelog-sync.test.ts src/app/timelog-reapply.test.ts src/app/budget-unapplied-notice.test.tsx src/app/timelog-panel.test.tsx src/app/timelog-apply.test.ts src/app/timelog-actuals-store.test.ts src/app/budget-panel.test.tsx src/app/budget-panel-people-rows.test.tsx src/app/workspace-section.test.tsx > "$TMPDIR/t5.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$TMPDIR/t5.log"`
Expected: `EXIT=0`, 11 files passed.

- [ ] **Step 9: Mutation check**

In `legacyOverlay`, change `if (granularityOfPeriodKey(pk) === granularity)` to `if (true)` and confirm the legacy test fails; restore. In `rollUpDays`, change `periodKeyForDate(day, granularity)` to `periodKeyForDate(day, "month")` and confirm the ISO-week test fails; restore. Rerun Step 8 at `EXIT=0`.

- [ ] **Step 10: Typecheck, lint, commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/timelog-actuals.ts src/app/use-timelog-sync.ts src/app/timelog-panel.tsx src/app/timelog-reapply.ts src/app/budget-unapplied-notice.tsx src/app/budget-panel.tsx src/app/workspace-section.tsx src/app/timelog-actuals.test.ts src/app/timelog-actuals.property.test.ts src/app/use-timelog-sync.test.ts src/app/timelog-reapply.test.ts src/app/budget-unapplied-notice.test.tsx src/app/timelog-panel.test.tsx; echo "EXIT=$?"
git add src/app/timelog-actuals.ts src/app/use-timelog-sync.ts src/app/timelog-panel.tsx src/app/timelog-reapply.ts src/app/budget-unapplied-notice.tsx src/app/budget-panel.tsx src/app/workspace-section.tsx src/app/timelog-actuals.test.ts src/app/timelog-actuals.property.test.ts src/app/use-timelog-sync.test.ts src/app/timelog-reapply.test.ts src/app/budget-unapplied-notice.test.tsx src/app/timelog-actuals-store.test.ts
git commit -F - <<'EOF'
feat(timelog): keep booking days in the aggregate and derive periods at read time

aggregateActuals stores a per-day, per-resource breakdown and no longer
takes the plan granularity. Every consumer derives the period overlay with
the live granularity through bucketOverlay, so changing the granularity
after a fetch no longer strands hours under unread keys (§169). A cached
entry from before this change keeps only the cells that match the live
granularity.

Claude-Session: https://[session link removed]
EOF
```

Stage `src/app/timelog-panel.test.tsx` too if Step 7 changed it.

---

### Task 6: Apply writes day keys

**Files:**
- Modify: `src/app/timelog-apply.ts` (`Routed`, `routeBucket`, `buildApplyPlan`, `writeAllocations`)
- Test: `src/app/timelog-apply.test.ts`

**Interfaces:**
- Consumes: `actualHoursIn`, `withoutPeriod` from Task 1; `ResourceDayCell` / `bucketOverlay` / `aggregateActuals` from Task 5.
- Produces: `applyActualsToBuckets` writes day keys for periods whose routed bookings all carry `byDay`; `ApplyDiffRow.current` counts day keys. Signatures unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/timelog-apply.test.ts` (reuse the file's bucket builder for bucket 7 with role 3 and resource 10; `git grep -n "function bucket\|const bucket\|resources:" src/app/timelog-apply.test.ts | head` names it):

```ts
describe("dated apply", () => {
  const datedOverlay: ActualsByBucket = {
    7: { "2026-06": { hours: 5, billableHours: 5, byResource: { 10: { hours: 5, billableHours: 5, byDay: { "2026-06-10": 2, "2026-06-11": 3 } } } } },
  };

  it("writes day keys and removes the hand-typed period key", () => {
    const before = [bucketWith({ "2026-06": 40, "2026-07": 8 })];
    const after = applyActualsToBuckets(before, datedOverlay, resources, roles);
    expect(after[0].allocations[0].actualHours).toEqual({ "2026-06-10": 2, "2026-06-11": 3, "2026-07": 8 });
  });

  it("replaces stale day keys inside a covered period", () => {
    const before = [bucketWith({ "2026-06-09": 7, "2026-06-10": 1 })];
    const after = applyActualsToBuckets(before, datedOverlay, resources, roles);
    expect(after[0].allocations[0].actualHours).toEqual({ "2026-06-10": 2, "2026-06-11": 3 });
  });

  it("reports current as the period total including day keys", () => {
    const rows = planApply([bucketWith({ "2026-06": 1, "2026-06-20": 2 })], datedOverlay, resources, roles);
    expect(rows).toEqual([{ bucketId: 7, allocIndex: 0, period: "2026-06", current: 3, next: 5 }]);
  });

  it("writes a period key, as before, when a routed booking has no byDay", () => {
    const legacy: ActualsByBucket = { 7: { "2026-06": { hours: 5, billableHours: 5, byResource: { 10: { hours: 5, billableHours: 5 } } } } };
    const after = applyActualsToBuckets([bucketWith({ "2026-06-10": 9 })], legacy, resources, roles);
    expect(after[0].allocations[0].actualHours).toEqual({ "2026-06": 5 });
  });

  it("keeps hours counted when the plan switches granularity after apply (§169)", () => {
    const agg = aggregateActuals([tItem(1, 9, "2026-06-10", 4)], links);
    const after = applyActualsToBuckets([bucketWith({})], bucketOverlay(agg, "week"), resources, roles);
    const hours = after[0].allocations[0].actualHours;
    expect(actualHoursIn(hours, "2026-W24")).toBe(4);
    expect(actualHoursIn(hours, "2026-06")).toBe(4);
  });
});
```

`bucketWith(actualHours)` is a local helper you add at the top of this describe: it returns the file's existing bucket-7 fixture with `allocations[0].actualHours` replaced. `tItem`, `links`, `resources` and `roles` are the file's existing fixtures (the "consumes a real aggregateActuals result end to end" test uses `tItem`); match their argument order to the file. Import `ActualsByBucket`, `aggregateActuals`, `bucketOverlay` from `./timelog-actuals` and `actualHoursIn` from `./actual-hours`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/timelog-apply.test.ts > "$TMPDIR/t6.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |×" "$TMPDIR/t6.log"`
Expected: `EXIT=1`; all five new tests fail. ("writes a period key, as before" fails too: today's `writeAllocations` leaves the stale `"2026-06-10"` day key beside the written period key.)

- [ ] **Step 3: Carry days through routing**

In `src/app/timelog-apply.ts`, add `import { actualHoursIn, withoutPeriod } from "./actual-hours";`.

Replace the `Routed` type with:

```ts
type Routed = {
  perAlloc: Map<number, Record<string, number>>;
  /** alloc index → period → day → hours, from each routed booking's `byDay`. */
  perAllocDays: Map<number, Record<string, Record<string, number>>>;
  /** Periods where at least one routed booking had no `byDay` (legacy cache):
   *  those are written as a period key, exactly as before dated actuals. */
  undatedPeriods: Set<string>;
  periods: string[];
  unmatched: boolean;
  unmatchedHours: number;
};
```

In `routeBucket`, create `const perAllocDays = new Map<number, Record<string, Record<string, number>>>();` and `const undatedPeriods = new Set<string>();` next to `perAlloc`. Inside the `for (const [rid, hc] of Object.entries(breakdown))` loop, after `perAlloc.set(idx, rec);`, add:

```ts
      if (hc.byDay) {
        const allocDays = perAllocDays.get(idx) ?? {};
        const periodDays = { ...allocDays[period] };
        for (const [day, h] of Object.entries(hc.byDay)) periodDays[day] = round2((periodDays[day] ?? 0) + h);
        allocDays[period] = periodDays;
        perAllocDays.set(idx, allocDays);
      } else if (hc.hours !== 0) {
        undatedPeriods.add(period);
      }
```

Return `{ perAlloc, perAllocDays, undatedPeriods, periods: [...routedPeriods], unmatched, unmatchedHours }`.

- [ ] **Step 4: Count day keys in the diff and write them**

In `buildApplyPlan`, replace `const current = a.actualHours[period] ?? 0;` with `const current = actualHoursIn(a.actualHours, period);`.

Replace `writeAllocations` with:

```ts
function writeAllocations<T extends { actualHours: Record<string, number> }>(
  list: readonly T[],
  routed: Routed,
): T[] {
  return list.map((a, i) => {
    const rec = routed.perAlloc.get(i);
    const days = routed.perAllocDays.get(i);
    let nextActual: Record<string, number> = { ...a.actualHours };
    for (const period of routed.periods) {
      // Apply OWNS the period: its hand-typed period key and every day key inside
      // it are replaced, whether or not this line routed anything.
      nextActual = withoutPeriod(nextActual, period);
      if (routed.undatedPeriods.has(period)) {
        nextActual[period] = rec?.[period] ?? 0;
      } else {
        for (const [day, h] of Object.entries(days?.[period] ?? {})) nextActual[day] = h;
      }
    }
    return { ...a, actualHours: nextActual };
  });
}
```

Update the doc comment above `applyActualsToBuckets` ("Apply OWNS every target line for the periods it covers: a line with no bookings in an applied period is written to 0, not skipped…") so its first sentence reads: "Apply OWNS every target line for the periods it covers: the period key and every day key inside the period are replaced; a dated period writes day keys, and a line with no bookings in it ends with none."

- [ ] **Step 5: Run the apply suite and its consumers**

Run: `npx vitest run src/app/timelog-apply.test.ts src/app/timelog-reapply.test.ts src/app/timelog-panel.test.tsx src/app/budget-unapplied-notice.test.tsx > "$TMPDIR/t6.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$TMPDIR/t6.log"`
Expected: `EXIT=0`. Existing tests build overlays without `byDay`, so they take the undated path and keep asserting period keys.

If an existing test asserts that a non-routed line in a covered period ends with `actualHours["2026-06"]` equal to `0`, it still passes (the undated path writes `0`). If an existing test fails because it now expects a period key where the overlay came from a real `aggregateActuals` + `bucketOverlay`, migrate that assertion to `actualHoursIn(<map>, "2026-06")` with the same value.

- [ ] **Step 6: Mutation check**

Replace `nextActual = withoutPeriod(nextActual, period);` with nothing and confirm "writes day keys and removes the hand-typed period key" fails; restore. Replace `actualHoursIn(a.actualHours, period)` with `a.actualHours[period] ?? 0` and confirm "reports current as the period total" fails; restore. Rerun Step 5 at `EXIT=0`.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/timelog-apply.ts src/app/timelog-apply.test.ts; echo "EXIT=$?"
git add src/app/timelog-apply.ts src/app/timelog-apply.test.ts
git commit -F - <<'EOF'
feat(timelog): apply TimeLog hours as day keys and own each covered period whole

Apply keeps routing by period, writes each routed booking's days, and
clears the period key and stale day keys of every period it covers. The
confirm dialog's current value counts day keys. A cached cell without days
is still written as a period key.

Claude-Session: https://[session link removed]
EOF
```

---

### Task 7: Day keys in the sample workspace and golden fixtures

**Files:**
- Modify: `sample-workspace-small.json`
- Modify: `src/app/__fixtures__/golden-workspace.csv`, `src/app/__fixtures__/golden-workspace.md` (regenerated)
- Modify: `src/app/sample-workspace-budget.test.ts`

**Interfaces:**
- Consumes: Task 2 codec (day keys survive load), Task 1 `isDayKey` / `actualHoursIn`.
- Produces: the sample's bucket 1, role line 1 carries June as three day keys.

- [ ] **Step 1: Migrate the sample test first (it must fail)**

In `src/app/sample-workspace-budget.test.ts`:

Replace

```ts
    expect(r1.actualHours).toEqual({ "2026-04": 116, "2026-05": 128, "2026-06": 48 });
```

with

```ts
    expect(r1.actualHours).toEqual({ "2026-04": 116, "2026-05": 128, "2026-06-01": 16, "2026-06-02": 16, "2026-06-03": 16 });
    expect(actualHoursIn(r1.actualHours, "2026-06")).toBe(48);
```

Replace the key-shape loop

```ts
        for (const key of [...Object.keys(row.budgetHours), ...Object.keys(row.actualHours)]) {
          expect(`${key}-01` >= b.startDate! && key <= b.endDate!.slice(0, 7)).toBe(true);
        }
```

with

```ts
        for (const key of Object.keys(row.budgetHours)) {
          expect(`${key}-01` >= b.startDate! && key <= b.endDate!.slice(0, 7)).toBe(true);
        }
        for (const key of Object.keys(row.actualHours)) {
          const inRange = isDayKey(key)
            ? key >= b.startDate! && key <= b.endDate!
            : `${key}-01` >= b.startDate! && key <= b.endDate!.slice(0, 7);
          expect(inRange).toBe(true);
        }
```

Add `import { actualHoursIn, isDayKey } from "./actual-hours";`.

Run: `npx vitest run src/app/sample-workspace-budget.test.ts > "$TMPDIR/t7.log" 2>&1; echo "EXIT=$?"`
Expected: `EXIT=1` (the sample still has `"2026-06": 48`).

- [ ] **Step 2: Edit the sample with a CRLF-anchored Node script**

Write `$TMPDIR/sample-days.cjs` with the Write tool, then run `node "$TMPDIR/sample-days.cjs"; echo "EXIT=$?"`:

```js
const fs = require("fs");
const file = "sample-workspace-small.json";
const src = fs.readFileSync(file, "utf8");
const indent = "            ";
const anchor = `${indent}"2026-05": 128,\r\n${indent}"2026-06": 48\r\n`;
const count = src.split(anchor).length - 1;
if (count !== 1) throw new Error(`anchor found ${count} times`);
const next = `${indent}"2026-05": 128,\r\n${indent}"2026-06-01": 16,\r\n${indent}"2026-06-02": 16,\r\n${indent}"2026-06-03": 16\r\n`;
fs.writeFileSync(file, src.replace(anchor, next), "utf8");
console.log("ok");
```

If the anchor count is 0, print the lines around `"2026-05": 128` with `node -e "const s=require('fs').readFileSync('sample-workspace-small.json','utf8');const i=s.indexOf('\"2026-05\": 128');console.log(JSON.stringify(s.slice(i-40,i+60)))"`, correct `indent`, and rerun. Verify with `git diff --stat sample-workspace-small.json` (1 file, 3 insertions, 1 deletion) and `git ls-files --eol sample-workspace-small.json` (`i/lf    w/crlf`).

Run the Step 1 command again. Expected: `EXIT=0`.

- [ ] **Step 3: Regenerate the golden fixtures**

`jsonToWorkspace` needs the jsdom test environment, so regenerate from a throwaway vitest file. Write `src/app/regen-golden.tmp.test.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { jsonToWorkspace } from "./workspace";
import { workspaceToCsv, workspaceToMarkdown } from "./storage";

it("regenerates golden fixtures from the sample (throwaway)", () => {
  const root = join(import.meta.dirname, "..", "..");
  const ws = jsonToWorkspace(readFileSync(join(root, "sample-workspace-small.json"), "utf8"));
  writeFileSync(join(import.meta.dirname, "__fixtures__", "golden-workspace.csv"), workspaceToCsv(ws));
  writeFileSync(join(import.meta.dirname, "__fixtures__", "golden-workspace.md"), workspaceToMarkdown(ws));
});
```

Use the same import modules `src/app/golden-workspace.test.ts` uses for `jsonToWorkspace`, `workspaceToCsv` and `workspaceToMarkdown` (`git grep -n "^import" src/app/golden-workspace.test.ts`).

Run: `npx vitest run src/app/regen-golden.tmp.test.ts > "$TMPDIR/t7.log" 2>&1; echo "EXIT=$?"`, then delete it: PowerShell `Remove-Item src/app/regen-golden.tmp.test.ts` (never stage it).

Verify:
- `git status --short` shows the two fixtures, the sample and the sample test modified, and no `regen-golden` file.
- `git diff --stat src/app/__fixtures__` shows a small change in each fixture (the allocations cell of bucket 1 only). Read `git diff src/app/__fixtures__/golden-workspace.md` and confirm the only change is `2026-06=48` becoming `2026-06-01=16|2026-06-02=16|2026-06-03=16`.
- `git ls-files --eol src/app/__fixtures__/golden-workspace.csv src/app/__fixtures__/golden-workspace.md` still reads `i/crlf w/crlf` and `i/lf w/lf`.

- [ ] **Step 4: Run the sample-dependent suites**

Run: `npx vitest run src/app/golden-workspace.test.ts src/app/sample-workspace-budget.test.ts src/app/actual-hours-persistence.test.ts > "$TMPDIR/t7.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$TMPDIR/t7.log"`
Expected: `EXIT=0`.

Then find any other test reading the sample: `git grep -ln "sample-workspace-small" -- "*.test.ts" "*.test.tsx"`. Run those files the same way; expected `EXIT=0` (June's total is unchanged at 48).

- [ ] **Step 5: Commit (separate commit, legitimate input change)**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git add sample-workspace-small.json src/app/__fixtures__/golden-workspace.csv src/app/__fixtures__/golden-workspace.md src/app/sample-workspace-budget.test.ts
git commit -F - <<'EOF'
test(sample): carry June actuals for the first T&M role as TimeLog day keys

The sample now exercises day keys on every load path. The golden storage
fixtures are regenerated from the changed input; June still totals 48 h.
The big and huge samples are not regenerated in this change.

Claude-Session: https://[session link removed]
EOF
```

---

### Task 9a: Pack cached day cells and report a refused cache write

**Files:**
- Create: `src/app/timelog-actuals-codec.ts`
- Modify: `src/app/timelog-actuals-store.ts`, `src/app/device-store.ts`, `docs/AGENTS/theming.md`
- Test: `src/app/timelog-actuals-codec.test.ts` (new), `src/app/timelog-actuals-store.test.ts`, `src/app/device-store.test.ts`

**Interfaces:**
- Consumes: `ActualsAggregate`, `ActualsByBucketDay`, `BucketPeriodCell`, `ResourceDayCell` from `./timelog-actuals` (Task 5).
- Produces (in `timelog-actuals-codec.ts`):
  - `const PACKED_DAYS_VERSION = 1 as const`
  - `type PackedBucketColumns = { d: number[]; n: number[]; t: number[]; tb?: number[]; r: number[]; h: number[]; hb?: number[] }`
  - `type PackedBucketDays = { v: typeof PACKED_DAYS_VERSION; days: string[]; res: number[]; b: Record<string, PackedBucketColumns> }`
  - `type StoredAggregate = Omit<ActualsAggregate, "byBucketDay"> & { byBucketDay?: ActualsByBucketDay; dayCells?: PackedBucketDays }`
  - `packBucketDays(byBucketDay: ActualsByBucketDay): PackedBucketDays`
  - `isPackedBucketDays(v: unknown): v is PackedBucketDays`
  - `unpackBucketDays(packed: PackedBucketDays): ActualsByBucketDay`
  - `toStoredAggregate(agg: StoredAggregate): StoredAggregate`
  - `fromStoredAggregate(agg: StoredAggregate): ActualsAggregate`
- Changes:
  - `saveActualsCache(projectId: string, entry: ActualsCacheEntry): boolean` (was `void`)
  - `writeDeviceJson(key: string, value: unknown): boolean` (was `void`)
  - `loadActualsCache(projectId: string): ActualsCacheEntry | undefined` (signature unchanged; unpacks)

- [ ] **Step 1: Write the failing codec tests**

Confirm no component of the same stem exists: `git ls-files "src/app/timelog-actuals-codec*"` must print nothing.

Create `src/app/timelog-actuals-codec.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { aggregateActuals } from "./timelog-actuals";
import {
  fromStoredAggregate,
  isPackedBucketDays,
  packBucketDays,
  toStoredAggregate,
  unpackBucketDays,
  type StoredAggregate,
} from "./timelog-actuals-codec";
import type { TimelogLinks, TimelogTimeItem } from "./timelog-types";

const links: TimelogLinks = {
  userLinks: [
    { timelogUserId: 1, resourceId: 10, manual: true },
    { timelogUserId: 2, resourceId: 1726000000020, manual: true },
  ],
  projectLinks: [
    { timelogProjectId: 9, bucketId: 7, manual: true },
    { timelogProjectId: 8, bucketId: 3, manual: true },
  ],
};

const item = (userId: number, projectId: number, date: string, hours: number, billableHours: number): TimelogTimeItem => ({
  timeRegistrationId: 1, userId, projectId, projectName: "", projectNo: "", taskId: 0, date, hours, billableHours, isBillable: billableHours > 0,
});

/** Decimal sums (0.1 + 0.2 is 0.30000000000000004), a credit correction, a
 *  resource id past 2^32 and a shape-valid NON-date (2026-02-30), because
 *  `aggregateActuals` admits any YYYY-MM-DD-shaped key. */
const dated = () =>
  aggregateActuals(
    [
      item(1, 9, "2026-06-10", 0.1, 0.1),
      item(1, 9, "2026-06-10", 0.2, 0),
      item(2, 9, "2026-06-10", 7.25, 7.25),
      item(2, 9, "2026-06-11", -1.5, -1.5),
      item(1, 8, "2026-02-30", 3, 3),
      item(2, 8, "2026-12-31", 8, 8),
    ],
    links,
  );

describe("timelog actuals codec", () => {
  it("round-trips the aggregate through JSON exactly", () => {
    const agg = dated();
    const stored = JSON.parse(JSON.stringify(toStoredAggregate(agg))) as StoredAggregate;
    expect(stored.byBucketDay).toBeUndefined();
    expect(isPackedBucketDays(stored.dayCells)).toBe(true);
    expect(fromStoredAggregate(stored)).toEqual(agg);
  });

  it("omits a billable column that equals its hours column, and keeps one that does not", () => {
    const allBillable = packBucketDays(aggregateActuals([item(1, 9, "2026-06-10", 2, 2)], links).byBucketDay ?? {});
    expect(allBillable.b["7"].hb).toBeUndefined();
    expect(allBillable.b["7"].tb).toBeUndefined();
    const mixed = packBucketDays(dated().byBucketDay ?? {});
    expect(mixed.b["7"].hb).toEqual([0.1, 7.25, -1.5]);
    expect(mixed.b["7"].tb).toEqual([7.35, -1.5]);
  });

  it("passes a legacy period-keyed aggregate through both ways by identity", () => {
    const legacy = { byBucket: { 7: { "2026-06": { hours: 1, billableHours: 1 } } }, byResource: {}, unattributed: { hours: 0, billableHours: 0 } };
    expect(toStoredAggregate(legacy)).toBe(legacy);
    expect(fromStoredAggregate(legacy)).toBe(legacy);
  });

  it("loads a verbose byBucketDay aggregate from an earlier build by identity", () => {
    const verbose = dated();
    expect(fromStoredAggregate(verbose)).toBe(verbose);
  });

  it("packs a year of day cells to well under a third of the verbose size", () => {
    // Measured 2026-09-14: this fixture is 186,408 chars verbose and 48,538
    // packed (ratio 0.260). The bound leaves room for fixture drift, not for a
    // codec that stopped packing.
    const items: TimelogTimeItem[] = [];
    for (let b = 0; b < 10; b += 1) {
      for (let day = 0; day < 250; day += 1) {
        for (let p = 0; p < 4; p += 1) {
          const hours = (((day * 7 + p * 3 + b) % 31) + 1) / 4;
          const date = `2026-${String((day % 12) + 1).padStart(2, "0")}-${String((day % 28) + 1).padStart(2, "0")}`;
          items.push(item(p + 1, b + 1, date, hours, (day + p) % 3 === 0 ? 0 : hours));
        }
      }
    }
    const bigLinks: TimelogLinks = {
      userLinks: [1, 2, 3, 4].map((u) => ({ timelogUserId: u, resourceId: u * 10, manual: true })),
      projectLinks: Array.from({ length: 10 }, (_, b) => ({ timelogProjectId: b + 1, bucketId: b + 100, manual: true })),
    };
    const agg = aggregateActuals(items, bigLinks);
    const ratio = JSON.stringify(toStoredAggregate(agg)).length / JSON.stringify(agg).length;
    expect(ratio).toBeLessThan(0.35);
  });

  it("admits and unpacks an empty payload", () => {
    const empty = { v: 1 as const, days: [], res: [], b: {} };
    expect(isPackedBucketDays(empty)).toBe(true);
    expect(unpackBucketDays(empty)).toEqual({});
  });

  describe("rejects a malformed payload", () => {
    const good = packBucketDays(dated().byBucketDay ?? {});
    const col = good.b["7"];
    const cases: [string, unknown][] = [
      ["an unknown version", { ...good, v: 2 }],
      ["a day that is not YYYY-MM-DD", { ...good, days: ["06/10/2026", ...good.days.slice(1)] }],
      ["a day index past the day table", { ...good, b: { ...good.b, 7: { ...col, d: [99, ...col.d.slice(1)] } } }],
      ["a repeated day in one bucket", { ...good, b: { ...good.b, 7: { ...col, d: [col.d[0], 0] } } }],
      ["a resource index past the resource table", { ...good, b: { ...good.b, 7: { ...col, r: [5, ...col.r.slice(1)] } } }],
      ["a resource row missing its hours", { ...good, b: { ...good.b, 7: { ...col, h: col.h.slice(1) } } }],
      ["a null day total", { ...good, b: { ...good.b, 7: { ...col, t: [null, ...col.t.slice(1)] } } }],
      ["a negative row count", { ...good, b: { ...good.b, 7: { ...col, n: [-1, ...col.n.slice(1)] } } }],
      ["a string resource id", { ...good, res: ["10", ...good.res.slice(1)] }],
      ["bucket columns held in an array", { ...good, b: [] }],
      ["a null bucket", { ...good, b: { ...good.b, 7: null } }],
      ["a number", 5],
      ["null", null],
    ];
    it.each(cases)("%s", (_name, payload) => {
      expect(isPackedBucketDays(payload)).toBe(false);
    });

    it("accepts the unmodified payload (control)", () => {
      expect(isPackedBucketDays(JSON.parse(JSON.stringify(good)))).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/timelog-actuals-codec.test.ts > "$TMPDIR/t9a.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Failed to|Cannot find" "$TMPDIR/t9a.log"`
Expected: `EXIT=1` (the module does not exist).

- [ ] **Step 3: Create the codec**

Create `src/app/timelog-actuals-codec.ts` with the Write tool:

```ts
// src/app/timelog-actuals-codec.ts — pure, i18n-free AT-REST packing of the
// day-keyed TimeLog aggregate for the per-device actuals cache
// (`timelog-actuals-store.ts`). In memory every consumer keeps reading
// `ActualsAggregate.byBucketDay`; only the stored JSON changes shape.
import type { ActualsAggregate, ActualsByBucketDay, BucketPeriodCell, ResourceDayCell } from "./timelog-actuals";

/** Bumped only when the column layout changes. An entry carrying any other
 *  version is rejected by `isPackedBucketDays` and its cache entry dropped:
 *  that reads as "never fetched", which a re-fetch repairs. */
export const PACKED_DAYS_VERSION = 1 as const;

/** One bucket's day cells as parallel columns, days in ascending order.
 *  - `d`  day-index DELTA per day group (first is absolute; later ones > 0)
 *  - `n`  resource rows in that day group
 *  - `t`  / `tb` the day cell's `hours` / `billableHours` (`tb` omitted when
 *         every value equals `t`)
 *  - `r`  resource index into `PackedBucketDays.res`, one per resource row
 *  - `h`  / `hb` that resource's `hours` / `billableHours` (`hb` omitted when
 *         every value equals `h`)
 *  ★★ The day totals `t`/`tb` are stored even though they equal the sum of the
 *  resource rows: re-summing reproduces them only when every addend is an exact
 *  binary fraction, and a one-ULP drift would make the reloaded aggregate differ
 *  from the fetched one. Measured cost: ~10% of the packed size. */
export type PackedBucketColumns = {
  d: number[];
  n: number[];
  t: number[];
  tb?: number[];
  r: number[];
  h: number[];
  hb?: number[];
};

export type PackedBucketDays = {
  v: typeof PACKED_DAYS_VERSION;
  /** Every day key used by any bucket, ascending. Stored as STRINGS, never as
   *  offsets from a base date: `aggregateActuals` admits any `YYYY-MM-DD`-shaped
   *  key (`9999-99-99` included), and date arithmetic would silently rewrite a
   *  shape-valid non-date such as `2026-02-30`. */
  days: string[];
  /** Every resource id used by any bucket, ascending. */
  res: number[];
  /** bucketId → columns. */
  b: Record<string, PackedBucketColumns>;
};

/** An aggregate as it sits in localStorage: `byBucketDay` packed into
 *  `dayCells`. A legacy `byBucket` entry and a verbose `byBucketDay` entry from
 *  an earlier build are also valid stored aggregates. */
export type StoredAggregate = Omit<ActualsAggregate, "byBucketDay"> & {
  byBucketDay?: ActualsByBucketDay;
  dayCells?: PackedBucketDays;
};

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function allEqual(a: readonly number[], b: readonly number[]): boolean {
  return a.every((v, i) => v === b[i]);
}

export function packBucketDays(byBucketDay: ActualsByBucketDay): PackedBucketDays {
  const daySet = new Set<string>();
  const resSet = new Set<number>();
  for (const cells of Object.values(byBucketDay)) {
    for (const [day, cell] of Object.entries(cells)) {
      daySet.add(day);
      for (const rid of Object.keys(cell.byResource ?? {})) resSet.add(Number(rid));
    }
  }
  const days = [...daySet].sort();
  const res = [...resSet].sort((x, y) => x - y);
  const dayIndex = new Map(days.map((day, i) => [day, i] as const));
  const resIndex = new Map(res.map((id, i) => [id, i] as const));

  const b: Record<string, PackedBucketColumns> = {};
  for (const [bucketId, cells] of Object.entries(byBucketDay)) {
    const d: number[] = [];
    const n: number[] = [];
    const t: number[] = [];
    const tb: number[] = [];
    const r: number[] = [];
    const h: number[] = [];
    const hb: number[] = [];
    let prev = 0;
    for (const day of Object.keys(cells).sort()) {
      const cell = cells[day];
      const index = dayIndex.get(day) ?? 0;
      d.push(index - prev);
      prev = index;
      t.push(cell.hours);
      tb.push(cell.billableHours);
      const rows = Object.entries(cell.byResource ?? {});
      n.push(rows.length);
      for (const [rid, rc] of rows) {
        r.push(resIndex.get(Number(rid)) ?? 0);
        h.push(rc.hours);
        hb.push(rc.billableHours);
      }
    }
    const columns: PackedBucketColumns = { d, n, t, r, h };
    if (!allEqual(t, tb)) columns.tb = tb;
    if (!allEqual(h, hb)) columns.hb = hb;
    b[bucketId] = columns;
  }
  return { v: PACKED_DAYS_VERSION, days, res, b };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteColumn(v: unknown, length: number): v is number[] {
  return Array.isArray(v) && v.length === length && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

function isIndexColumn(v: unknown, bound: number): v is number[] {
  return Array.isArray(v) && v.every((x) => Number.isInteger(x) && (x as number) >= 0 && (x as number) < bound);
}

function isColumns(v: unknown, dayCount: number, resCount: number): v is PackedBucketColumns {
  if (!isPlainObject(v)) return false;
  const { d, n, t, tb, r, h, hb } = v;
  if (!Array.isArray(d) || !Array.isArray(n) || d.length !== n.length) return false;
  // Day indices: absolute first, strictly increasing after, all inside `days`.
  let day = -1;
  for (let i = 0; i < d.length; i += 1) {
    const step = d[i];
    if (!Number.isInteger(step) || step < 0 || (i > 0 && step === 0)) return false;
    day = i === 0 ? step : day + step;
    if (day >= dayCount) return false;
  }
  if (!n.every((x) => Number.isInteger(x) && (x as number) >= 0)) return false;
  const rows = (n as number[]).reduce((s, x) => s + x, 0);
  if (!isFiniteColumn(t, d.length)) return false;
  if (tb !== undefined && !isFiniteColumn(tb, d.length)) return false;
  if (!Array.isArray(r) || r.length !== rows || !isIndexColumn(r, resCount)) return false;
  if (!isFiniteColumn(h, rows)) return false;
  if (hb !== undefined && !isFiniteColumn(hb, rows)) return false;
  return true;
}

/** Shape check for a stored `dayCells` payload. Everything `unpackBucketDays`
 *  indexes is bounds-checked here, so an admitted payload cannot throw or mint
 *  an `undefined` key. A rejected payload drops its cache entry, exactly like an
 *  `aggregates` field of the wrong type does. */
export function isPackedBucketDays(v: unknown): v is PackedBucketDays {
  if (!isPlainObject(v) || v.v !== PACKED_DAYS_VERSION) return false;
  const { days, res, b } = v;
  if (!Array.isArray(days) || !days.every((x) => typeof x === "string" && DAY_KEY_RE.test(x))) return false;
  if (!Array.isArray(res) || !res.every((x) => typeof x === "number" && Number.isFinite(x))) return false;
  if (!isPlainObject(b)) return false;
  return Object.values(b).every((columns) => isColumns(columns, days.length, res.length));
}

export function unpackBucketDays(packed: PackedBucketDays): ActualsByBucketDay {
  const out: ActualsByBucketDay = {};
  for (const [bucketId, col] of Object.entries(packed.b)) {
    const cells: Record<string, BucketPeriodCell> = {};
    let day = 0;
    let row = 0;
    for (let g = 0; g < col.d.length; g += 1) {
      day = g === 0 ? col.d[g] : day + col.d[g];
      const byResource: Record<number, ResourceDayCell> = {};
      for (let k = 0; k < col.n[g]; k += 1) {
        byResource[packed.res[col.r[row]]] = { hours: col.h[row], billableHours: col.hb ? col.hb[row] : col.h[row] };
        row += 1;
      }
      cells[packed.days[day]] = { hours: col.t[g], billableHours: col.tb ? col.tb[g] : col.t[g], byResource };
    }
    out[Number(bucketId)] = cells;
  }
  return out;
}

/** Pack on the way INTO storage. An aggregate without `byBucketDay` (a legacy
 *  period-keyed one, or one already packed) is returned BY IDENTITY. */
export function toStoredAggregate(agg: StoredAggregate): StoredAggregate {
  if (agg.byBucketDay === undefined) return agg;
  const { byBucketDay, ...rest } = agg;
  return { ...rest, dayCells: packBucketDays(byBucketDay) };
}

/** Unpack on the way OUT of storage. The caller must have validated
 *  `dayCells` with `isPackedBucketDays`. An aggregate without `dayCells` (legacy
 *  `byBucket`, or a verbose `byBucketDay` from an earlier build) is returned BY
 *  IDENTITY. */
export function fromStoredAggregate(agg: StoredAggregate): ActualsAggregate {
  if (agg.dayCells === undefined) return agg;
  const { dayCells, ...rest } = agg;
  return { ...rest, byBucketDay: unpackBucketDays(dayCells) };
}
```

- [ ] **Step 4: Run the codec tests**

Run: `npx vitest run src/app/timelog-actuals-codec.test.ts > "$TMPDIR/t9a.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$TMPDIR/t9a.log"`
Expected: `EXIT=0`, `Test Files  1 passed (1)`.

- [ ] **Step 5: Write the failing store and device-store tests**

In `src/app/device-store.test.ts`, add inside the `describe("device-store", …)` block, after the "write survives a throwing setItem" test:

```ts
  it("reports whether the write reached storage", () => {
    expect(writeDeviceJson(KEY, { x: 1 })).toBe(true);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(writeDeviceJson(KEY, { x: 2 })).toBe(false);
  });
```

In `src/app/timelog-actuals-store.test.ts`:

Replace the first import line `import { describe, it, expect, afterEach } from "vitest";` with
`import { describe, it, expect, afterEach, vi } from "vitest";`, and add
`import { aggregateActuals } from "./timelog-actuals";` directly below the `./device-store` import.

Inside `describe("timelog actuals cache — map-level size budget", …)`, insert directly ABOVE the comment line
`  /** ★★★ THE STAGE-1 RESTORE BRANCH, WHICH HAD NO COVERAGE AT ALL. The existing` (so `bigAgg`, `bigRoll`,
`fatUser` and `isoDay` are in scope):

```ts
  /** ★★★ STAGE 6. Day cells are stored packed, but an entry can still sit over
   *  budget on `aggregates` alone. Stage 5 sheds its users first; stage 6 then
   *  sheds its roll trio TOGETHER and keeps `aggregates`. `bigAgg(60_000)` is a
   *  legacy period map (passed through unpacked), measured at 2,400,081 chars
   *  against the 2,097,152 budget and well inside jsdom's 5 MB quota.
   *  ★ The CONTROL is the stage-5 test above: its users alone are over budget,
   *  so after stage 5 the entry fits and its roll must survive — which also
   *  pins stage 5's `size` recompute. */
  it("sheds the saved entry's own roll when its aggregates alone exceed the budget, keeping the aggregates", () => {
    const roll = bigRoll(10);
    const caller = {
      fetchedAt: "2026-09-01T00:00:00.000Z",
      aggregates: bigAgg(60_000),
      users: [fatUser(1)],
      projectRefs: [{ id: 1, name: "P", no: "P-1" }],
      daily: roll,
      dailyWindow: { from: isoDay(0), to: isoDay(9) },
      dailyUsers: [7],
    };
    expect(saveActualsCache("huge", caller)).toBe(true);
    const e = loadActualsCache("huge");
    expect(e?.aggregates?.byBucket?.[7]?.["2000-01"].hours).toBe(8);
    expect(e?.users).toBeUndefined();
    expect(e?.daily).toBeUndefined();
    expect(e?.dailyWindow).toBeUndefined();
    expect(e?.dailyUsers).toBeUndefined();
    // A COPY was shed, never the caller's object.
    expect(caller.daily).toBe(roll);
  });

  it("returns true when the map reaches storage", () => {
    expect(saveActualsCache("p", { fetchedAt: "t", aggregates: agg(1) })).toBe(true);
  });

  /** ★★★ A REFUSED WRITE MUST NOT LEAVE THE PREVIOUS FETCH READABLE. Storage
   *  still holds this project's old entry, which a reload would read as the
   *  current fetch; the store removes it and reports the failure instead. The
   *  refusal is ONE call, so the removal write itself lands. */
  it("returns false and removes the saving project's stale entry when storage refuses the write", () => {
    saveActualsCache("keep", { fetchedAt: "2026-09-01T00:00:00.000Z", aggregates: agg(1) });
    saveActualsCache("p", { fetchedAt: "2026-09-01T00:00:00.000Z", aggregates: agg(2) });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      expect(saveActualsCache("p", { fetchedAt: "2026-09-02T00:00:00.000Z", aggregates: agg(3) })).toBe(false);
    } finally {
      setItem.mockRestore();
    }
    expect(loadActualsCache("p")).toBeUndefined();
    expect(loadActualsCache("keep")?.aggregates?.unattributed.hours).toBe(1);
  });

  it("returns false without throwing when storage refuses every write", () => {
    saveActualsCache("p", { fetchedAt: "2026-09-01T00:00:00.000Z", aggregates: agg(2) });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      expect(saveActualsCache("p", { fetchedAt: "2026-09-02T00:00:00.000Z", aggregates: agg(3) })).toBe(false);
    } finally {
      setItem.mockRestore();
    }
    // Nothing could be written, so storage still holds the previous entry.
    expect(loadActualsCache("p")?.aggregates?.unattributed.hours).toBe(2);
  });
```

Append at the END of the file (after the last `});`):

```ts
describe("timelog actuals cache — packed day cells", () => {
  const links = {
    userLinks: [
      { timelogUserId: 1, resourceId: 10, manual: true },
      { timelogUserId: 2, resourceId: 20, manual: true },
    ],
    projectLinks: [{ timelogProjectId: 9, bucketId: 7, manual: true }],
  };
  const booking = (userId: number, date: string, hours: number, billableHours: number) => ({
    timeRegistrationId: 1, userId, projectId: 9, projectName: "", projectNo: "", taskId: 0, date, hours, billableHours, isBillable: billableHours > 0,
  });
  const dated = () =>
    aggregateActuals([booking(1, "2026-06-10", 0.1, 0.1), booking(1, "2026-06-10", 0.2, 0), booking(2, "2026-06-11", 7.25, 7.25)], links);
  const storedAggregates = (projectId: string) =>
    (JSON.parse(window.localStorage.getItem(TIMELOG_ACTUALS_KEY) ?? "{}") as Record<string, { aggregates?: Record<string, unknown> }>)[projectId]
      ?.aggregates;

  it("stores day cells packed and loads them back unchanged", () => {
    const aggregates = dated();
    expect(saveActualsCache("p", { fetchedAt: "t", aggregates })).toBe(true);
    expect(storedAggregates("p")?.byBucketDay).toBeUndefined();
    expect(storedAggregates("p")?.dayCells).toBeDefined();
    expect(loadActualsCache("p")?.aggregates).toEqual(aggregates);
  });

  it("loads a verbose byBucketDay entry an earlier build wrote", () => {
    writeDeviceJson(TIMELOG_ACTUALS_KEY, { p: { fetchedAt: "t", aggregates: dated() } });
    expect(loadActualsCache("p")?.aggregates).toEqual(dated());
  });

  it("repacks another project's verbose entry on the next save", () => {
    writeDeviceJson(TIMELOG_ACTUALS_KEY, { old: { fetchedAt: "t", aggregates: dated() } });
    saveActualsCache("new", { fetchedAt: "t2", aggregates: agg(1) });
    expect(storedAggregates("old")?.byBucketDay).toBeUndefined();
    expect(storedAggregates("old")?.dayCells).toBeDefined();
    expect(loadActualsCache("old")?.aggregates).toEqual(dated());
  });

  /** A malformed packed payload is the aggregate's core, so the ENTRY goes —
   *  the rule `isEntry` already applies to `aggregates: 5` — while other
   *  projects' entries survive. */
  it("drops an entry whose packed day cells are malformed, keeping the others", () => {
    saveActualsCache("bad", { fetchedAt: "t", aggregates: dated() });
    saveActualsCache("good", { fetchedAt: "t", aggregates: dated() });
    const map = JSON.parse(window.localStorage.getItem(TIMELOG_ACTUALS_KEY) ?? "{}") as Record<
      string,
      { aggregates: { dayCells: { v: number } } }
    >;
    map.bad.aggregates.dayCells.v = 99;
    writeDeviceJson(TIMELOG_ACTUALS_KEY, map);
    expect(loadActualsCache("bad")).toBeUndefined();
    expect(loadActualsCache("good")?.aggregates).toEqual(dated());
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run src/app/timelog-actuals-store.test.ts src/app/device-store.test.ts > "$TMPDIR/t9a.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |✗|×" "$TMPDIR/t9a.log"`
Expected: `EXIT=1`. The packed, stage-6, return-value and refused-write tests fail; every pre-existing test passes.

- [ ] **Step 7: Make `writeDeviceJson` report the result**

In `src/app/device-store.ts` (Edit tool; CRLF is preserved), replace:

```ts
/** JSON.stringify + write a per-device key. SSR-safe; swallows quota /
 *  serialization / disabled-storage errors. */
export function writeDeviceJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota / disabled / serialization — non-fatal
  }
}
```

with:

```ts
/** JSON.stringify + write a per-device key. SSR-safe; never throws on quota /
 *  serialization / disabled-storage errors.
 *  Returns `true` only when the value reached storage. Callers that can live
 *  with a lost write ignore it; `saveActualsCache` reads it, because a lost
 *  TimeLog fetch must be reported to the user. */
export function writeDeviceJson(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // quota / disabled / serialization — non-fatal, but reported
    return false;
  }
}
```

- [ ] **Step 8: Pack in the store, add stage 6, report the write**

All edits in `src/app/timelog-actuals-store.ts` use the Edit tool. Every anchor below was verified to match exactly
once (the signature anchor exactly four times) against HEAD `0d856c17`.

8.1 Below `import type { ActualsAggregate } from "./timelog-actuals";` add:

```ts
import { fromStoredAggregate, isPackedBucketDays, toStoredAggregate, type StoredAggregate } from "./timelog-actuals-codec";
```

8.2 Replace `type CacheMap = Record<string, ActualsCacheEntry>;` with:

```ts
/** An entry as it sits in localStorage: `ActualsCacheEntry` with its
 *  aggregate's day cells PACKED (`dayCells`, see `timelog-actuals-codec.ts`).
 *  ★ Every shedding stage in `saveActualsCache` reads only fields the two shapes
 *  share, so the stages run on stored entries unchanged. Only
 *  `loadActualsCache` unpacks, and only the one entry it returns. */
type StoredEntry = Omit<ActualsCacheEntry, "aggregates"> & { aggregates?: StoredAggregate };

type CacheMap = Record<string, StoredEntry>;
```

8.3 In `isEntry`, change `function isEntry(v: unknown): v is ActualsCacheEntry {` to `function isEntry(v: unknown): v is StoredEntry {`
and `const e = v as ActualsCacheEntry;` to `const e = v as StoredEntry;`. Then replace the line
`  if (e.users !== undefined && !Array.isArray(e.users)) return false;` with:

```ts
  // ★★ Packed day cells are the aggregate's CORE payload, not an optional side
  // field, so a malformed payload drops the entry — the rule the `aggregates`
  // type check above already applies — rather than being stripped: KPIs that
  // survive while their day cells vanish would show booked hours the Budget
  // view can never place.
  if (e.aggregates?.dayCells !== undefined && !isPackedBucketDays(e.aggregates.dayCells)) return false;
  if (e.users !== undefined && !Array.isArray(e.users)) return false;
```

8.4 Replace ALL FOUR occurrences (Edit tool `replace_all: true`) of `(e: ActualsCacheEntry): ActualsCacheEntry` with
`(e: StoredEntry): StoredEntry` (`withCheckedDaily`, `withCheckedDailyWindow`, `withCheckedDailyUsers`,
`withBoundedDaily`). Confirm: `grep -c "(e: StoredEntry): StoredEntry" src/app/timelog-actuals-store.ts` prints `4`.

8.5 Replace `function readMap(): CacheMap {` with:

```ts
/** Pack for storage. Identity when there is nothing to pack. */
function toStoredEntry(e: StoredEntry): StoredEntry {
  if (e.aggregates === undefined) return e;
  const aggregates = toStoredAggregate(e.aggregates);
  return aggregates === e.aggregates ? e : { ...e, aggregates };
}

/** Unpack for a reader. Identity when there is nothing to unpack. */
function fromStoredEntry(e: StoredEntry): ActualsCacheEntry {
  if (e.aggregates === undefined) return e;
  const aggregates = fromStoredAggregate(e.aggregates);
  return aggregates === e.aggregates ? e : { ...e, aggregates };
}

function readMap(): CacheMap {
```

8.6 Replace:

```ts
export function loadActualsCache(projectId: string): ActualsCacheEntry | undefined {
  return readMap()[projectId];
}
```

with:

```ts
export function loadActualsCache(projectId: string): ActualsCacheEntry | undefined {
  const stored = readMap()[projectId];
  return stored === undefined ? undefined : fromStoredEntry(stored);
}
```

8.7 In the `MAX_ACTUALS_TOTAL_CHARS` docstring, replace:

```ts
 *  `users`/`projectRefs` whole and keeps its aggregates (§430, closed). An entry
 *  over budget on `aggregates` alone is still written as-is — nothing sheds
 *  aggregates off the entry being saved.
```

with:

```ts
 *  `users`/`projectRefs` whole and keeps its aggregates (§430, closed). An entry
 *  STILL over budget sheds its own roll trio (stage 6) and is then written
 *  as-is — nothing sheds aggregates off the entry being saved. Since the day
 *  cells are stored packed (`timelog-actuals-codec.ts`) that takes an extreme
 *  aggregate; when the browser then refuses the write, `saveActualsCache`
 *  removes the entry's stale predecessor and returns `false`.
```

8.8 Replace `/** ★★★ FIVE STAGES, IN INCREASING ORDER OF WHAT THEY COST THE USER.` with
`/** ★★★ SIX STAGES, IN INCREASING ORDER OF WHAT THEY COST THE USER.`, and replace:

```ts
 *  5. Shed the SAVED entry's own `users` + `projectRefs` — reached only when
 *     that entry alone is over budget (open-followups §430).
```

with:

```ts
 *  5. Shed the SAVED entry's own `users` + `projectRefs` — reached only when
 *     that entry alone is over budget (open-followups §430).
 *  6. Shed the SAVED entry's own `daily` + `dailyWindow` + `dailyUsers`
 *     together — reached only when stage 5 was not enough.
 *  ★★★ RETURNS WHETHER THE MAP REACHED STORAGE. `writeDeviceJson` never throws,
 *  so without this a refused write (quota, disabled storage) is silent and the
 *  next reload reads a stale entry as the current fetch. On a refused write the
 *  saving project's PREVIOUS entry is removed (a second, smaller write) so the
 *  stale data cannot be read, and `false` is returned for the caller to
 *  surface (`use-timelog-sync.ts` → the TimeLog panel's warning).
```

8.9 Replace:

```ts
export function saveActualsCache(projectId: string, entry: ActualsCacheEntry): void {
  const map = readMap();
  map[projectId] = withBoundedDaily(entry);
```

with:

```ts
export function saveActualsCache(projectId: string, entry: ActualsCacheEntry): boolean {
  // Pack EVERY entry, not only this one: a verbose `byBucketDay` entry an
  // earlier build left for another project is repacked by the next save of any
  // project. `toStoredEntry` is identity for an entry already packed.
  const map: CacheMap = {};
  for (const [k, v] of Object.entries(readMap())) map[k] = toStoredEntry(v);
  map[projectId] = withBoundedDaily(toStoredEntry(entry));
```

8.10 Replace everything from the stage-5 comment to the end of the function:

```ts
  // Stage 5 — the SAVED entry's own matching-UI inputs, shed whole, aggregates
  // kept. Reached only when the saved entry ALONE is over budget: stages 2–4
  // have removed everything else they may. A COPY, never a mutation of the
  // caller's entry. Nothing further is shed — the roll is already capped by
  // `withBoundedDaily`, so a real entry fits after this.
  if (size > MAX_ACTUALS_TOTAL_CHARS) {
    const e = out[projectId];
    if (e.users !== undefined || e.projectRefs !== undefined) {
      const shed = { ...e };
      delete shed.users;
      delete shed.projectRefs;
      out = { ...out, [projectId]: shed };
    }
  }

  writeDeviceJson(TIMELOG_ACTUALS_KEY, out);
}
```

with:

```ts
  // Stage 5 — the SAVED entry's own matching-UI inputs, shed whole, aggregates
  // kept. Reached only when the saved entry ALONE is over budget: stages 2–4
  // have removed everything else they may. A COPY, never a mutation of the
  // caller's entry.
  if (size > MAX_ACTUALS_TOTAL_CHARS) {
    const e = out[projectId];
    if (e.users !== undefined || e.projectRefs !== undefined) {
      const shed = { ...e };
      delete shed.users;
      delete shed.projectRefs;
      out = { ...out, [projectId]: shed };
      size = mapSize(out);
    }
  }

  // Stage 6 — the SAVED entry's own roll trio, shed TOGETHER by stage 2's rule
  // (a window or scope claim must never outlive its roll). Reached only when
  // the entry is still over budget without its users, i.e. its packed
  // aggregates alone approach the budget. The cost is the recoverable one: with
  // no window the insights reconcile FREEZES until the next fetch.
  if (size > MAX_ACTUALS_TOTAL_CHARS) {
    const e = out[projectId];
    if (e.daily !== undefined || e.dailyWindow !== undefined || e.dailyUsers !== undefined) {
      const shed = { ...e };
      delete shed.daily;
      delete shed.dailyWindow;
      delete shed.dailyUsers;
      out = { ...out, [projectId]: shed };
    }
  }

  if (writeDeviceJson(TIMELOG_ACTUALS_KEY, out)) return true;
  // ★★★ THE BROWSER REFUSED THE WRITE. Storage still holds this project's
  // PREVIOUS entry, which a reload would read as the current fetch — in the
  // Budget overlay and the unapplied notice — while the workspace may already
  // carry what the new fetch applied. Remove it: an absent entry reads as "not
  // fetched", the recoverable direction every stage above sheds towards. This
  // second write is no larger than what storage already holds minus that
  // entry, so it normally lands; if it does not, there is nothing left to try.
  const withoutStale: CacheMap = { ...out };
  delete withoutStale[projectId];
  writeDeviceJson(TIMELOG_ACTUALS_KEY, withoutStale);
  return false;
}
```

8.11 Size check: `node -e "console.log(require('fs').readFileSync('src/app/timelog-actuals-store.ts','utf8').split('\n').length)"`
Expected: about 647 (measured on a scratch copy with these exact edits).

- [ ] **Step 9: Correct the device-store doc claim**

In `docs/AGENTS/theming.md` (LF file; Edit tool), replace
``validation/cap/dedupe on the parsed result). ★ `writeDeviceJson` SWALLOWS quota throws — a store that must``
with
``validation/cap/dedupe on the parsed result). ★ `writeDeviceJson` never throws on a quota failure; it returns `false`, which only `saveActualsCache` reads — a store that must``

- [ ] **Step 10: Run the store, codec and cache-reader suites**

Run: `npx vitest run src/app/timelog-actuals-codec.test.ts src/app/timelog-actuals-store.test.ts src/app/device-store.test.ts src/app/use-timelog-sync.test.ts src/app/budget-unapplied-notice.test.tsx src/app/task-manager.guardrail-reconcile.test.tsx src/app/workspace-section.test.tsx > "$TMPDIR/t9a.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$TMPDIR/t9a.log"`
Expected: `EXIT=0`, `Test Files  7 passed (7)`.

- [ ] **Step 11: Mutation checks**

Apply each mutant alone with the Edit tool, run the named file, confirm the named test fails, revert with the
Edit tool, and prove the revert with `git diff --stat`.
1. Codec `isColumns`: `(i > 0 && step === 0)` → `false`. `timelog-actuals-codec.test.ts` "a repeated day in one bucket" fails.
2. Codec `packBucketDays`: delete `if (!allEqual(h, hb)) columns.hb = hb;`. "round-trips the aggregate through JSON exactly" fails.
3. Store `isEntry`: delete the `isPackedBucketDays` line. "drops an entry whose packed day cells are malformed, keeping the others" fails.
4. Store stage 6: `if (size > MAX_ACTUALS_TOTAL_CHARS) {` directly above `const e = out[projectId];\n    if (e.daily !== undefined` → `if (false) {`. "sheds the saved entry's own roll when its aggregates alone exceed the budget" fails.
5. Store stage 5: delete the new `size = mapSize(out);` inside stage 5. "sheds the saved entry's own users and projectRefs when it alone exceeds the budget, keeping the rest" fails (stage 6 fires on a stale size).
6. Store: delete `delete withoutStale[projectId];`. "returns false and removes the saving project's stale entry when storage refuses the write" fails.
7. Store: `for (const [k, v] of Object.entries(readMap())) map[k] = toStoredEntry(v);` → `… map[k] = v;`. "repacks another project's verbose entry on the next save" fails.
8. Device store: `return true;` → `return false;`. `device-store.test.ts` "reports whether the write reached storage" fails.

After all reverts, rerun Step 10 at `EXIT=0` with `Test Files  7 passed (7)`.

- [ ] **Step 12: Typecheck, lint, commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/timelog-actuals-codec.ts src/app/timelog-actuals-codec.test.ts src/app/timelog-actuals-store.ts src/app/timelog-actuals-store.test.ts src/app/device-store.ts src/app/device-store.test.ts; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
git ls-files --eol src/app/timelog-actuals-store.ts src/app/device-store.ts docs/AGENTS/theming.md
git add src/app/timelog-actuals-codec.ts src/app/timelog-actuals-codec.test.ts src/app/timelog-actuals-store.ts src/app/timelog-actuals-store.test.ts src/app/device-store.ts src/app/device-store.test.ts docs/AGENTS/theming.md
git commit -F - <<'EOF'
feat(timelog): pack cached day cells and report a refused cache write

The actuals cache now stores each aggregate's day cells as per-bucket
columns over shared day and resource tables. Packing is lossless and
loadActualsCache unpacks, so every reader still sees byBucketDay. Legacy
period entries and verbose day entries from earlier builds still load; a
malformed packed payload drops its entry. A year of 40 buckets, 8 people
and 2 bookings a day went from 177% of the cache budget to 46%.

writeDeviceJson now returns whether the write reached storage.
saveActualsCache sheds the saved entry's own roll when it is still over
budget (stage 6), and when the browser refuses the write it removes that
project's stale entry and returns false.

Claude-Session: https://[session link removed]
EOF
```

Expected: every `EXIT=0`; `git ls-files --eol` shows `w/crlf` for the two src files and `w/lf` for theming.md.

---

### Task 9b: Warn in the TimeLog panel when fetched bookings could not be cached

**Files:**
- Modify: `src/app/use-timelog-sync.ts`, `src/app/timelog-panel.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/use-timelog-sync.test.ts`, `src/app/timelog-panel.test.tsx`

**Interfaces:**
- Consumes: `saveActualsCache(projectId, entry): boolean` and `type ActualsCacheEntry` from Task 9a; `Banner` from `./banner`.
- Produces:
  - `useTimelogSync(...)` return value gains `cacheNotSaved: boolean`
  - i18n key `timelogCacheNotSaved` (EN + DE)

- [ ] **Step 1: Write the failing hook tests**

Append at the end of `src/app/use-timelog-sync.test.ts` (it already imports `vi`, `act`, `renderHook`, `api`,
`bucketOverlay`, `loadActualsCache`, and defines `item` and `args`):

```ts
// ★★★ A refused cache write used to be silent: the hook kept the fresh fetch
// while storage kept the previous one, and a reload read that as current.
it("sets cacheNotSaved when the browser refuses the cache write, and clears it on the next successful save", async () => {
  (api.getPrivileges as ReturnType<typeof vi.fn>).mockResolvedValue({ registrationAllTasks: false });
  (api.listTimeItemsSelf as ReturnType<typeof vi.fn>).mockResolvedValue([item(5, 4)]);
  const { result } = renderHook(() => useTimelogSync(args()));
  expect(result.current.cacheNotSaved).toBe(false);
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });
  try {
    await act(async () => { await result.current.fetchBookings("2026-06-01", "2026-06-30"); });
  } finally {
    setItem.mockRestore();
  }
  expect(result.current.cacheNotSaved).toBe(true);
  // The fetch itself still landed in memory — only the cache write failed.
  expect(bucketOverlay(result.current.aggregates, "month")[7]?.["2026-06"].hours).toBe(4);
  await act(async () => { await result.current.fetchBookings("2026-06-01", "2026-06-30"); });
  expect(result.current.cacheNotSaved).toBe(false);
  expect(loadActualsCache("p1")).toBeDefined();
});

it("resets cacheNotSaved on Clear all", async () => {
  (api.getPrivileges as ReturnType<typeof vi.fn>).mockResolvedValue({ registrationAllTasks: false });
  (api.listTimeItemsSelf as ReturnType<typeof vi.fn>).mockResolvedValue([item(5, 4)]);
  const { result } = renderHook(() => useTimelogSync(args()));
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });
  try {
    await act(async () => { await result.current.fetchBookings("2026-06-01", "2026-06-30"); });
  } finally {
    setItem.mockRestore();
  }
  expect(result.current.cacheNotSaved).toBe(true);
  act(() => { result.current.clearAll(); });
  expect(result.current.cacheNotSaved).toBe(false);
});
```

- [ ] **Step 2: Write the failing panel tests**

In `src/app/timelog-panel.test.tsx`, in `defaultSyncReturn()`, replace `    busy: false,\n    error: null,` with
`    busy: false,\n    error: null,\n    cacheNotSaved: false,`.

Insert inside `describe("TimelogPanel", () => {`, directly above the comment line
`  // §432. The attribution hint explains LINK state, and for an undated row the`:

```tsx
  describe("cache not saved warning", () => {
    it("warns when the sync hook reports that the cache write was refused", async () => {
      const { useTimelogSync } = await import("./use-timelog-sync");
      vi.mocked(useTimelogSync).mockReturnValue({
        ...defaultSyncReturn(),
        cacheNotSaved: true,
      } as unknown as ReturnType<typeof useTimelogSync>);
      enableTimelog();
      render(
        <>
          <SeedWorkspace />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      const warning = screen.getByText(t("en-US", "timelogCacheNotSaved"));
      expect(warning.closest('[role="status"]')).not.toBeNull();
    });

    it("shows no warning when the cache write succeeded (control)", () => {
      enableTimelog();
      render(
        <>
          <SeedWorkspace />
          <TimelogPanel lang="en-US" />
        </>,
        { wrapper },
      );
      expect(screen.queryByText(t("en-US", "timelogCacheNotSaved"))).toBeNull();
    });
  });

```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/app/use-timelog-sync.test.ts src/app/timelog-panel.test.tsx > "$TMPDIR/t9b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$TMPDIR/t9b.log"`
Expected: `EXIT=1`. The three new "sets/resets/warns" tests fail; the control passes.

- [ ] **Step 4: Add the strings**

`src/app/i18n.ts` (Edit tool): directly below `  timelogTokenInvalid: "Token was rejected. Re-enter it.",` add:

```ts
  timelogCacheNotSaved:
    "These TimeLog bookings could not be saved on this device because browser storage is full or unavailable. The Budget view does not show them, and they are gone after a reload. Apply them to the budget now, or free up browser storage and fetch again.",
```

`src/app/i18n.de.ts` (Node UTF-8 write, NEVER the Edit tool). Create `$TMPDIR/t9b-de.cjs` with the Write tool:

```js
const fs = require("fs");
const p = "src/app/i18n.de.ts";
const s = fs.readFileSync(p, "utf8");
const anchor = '  timelogTokenInvalid: "Token wurde abgelehnt. Bitte erneut eingeben.",\r\n';
const count = s.split(anchor).length - 1;
if (count !== 1) throw new Error(`anchor matched ${count} times`);
const add =
  "  timelogCacheNotSaved:\r\n" +
  '    "Diese TimeLog-Buchungen konnten auf diesem Gerät nicht gespeichert werden, weil der Browserspeicher voll oder nicht verfügbar ist. Die Budgetansicht zeigt sie nicht an, und nach dem Neuladen sind sie verloren. Wenden Sie sie jetzt auf das Budget an oder geben Sie Browserspeicher frei und rufen Sie die Buchungen erneut ab.",\r\n';
fs.writeFileSync(p, s.replace(anchor, anchor + add), "utf8");
const back = fs.readFileSync(p, "utf8");
console.log(back.includes("auf diesem Gerät nicht gespeichert") && back.includes("nicht verfügbar ist") ? "DE OK" : "DE MISSING");
```

Run: `node "$TMPDIR/t9b-de.cjs"; echo "EXIT=$?"` → expected `DE OK` and `EXIT=0`. Then
`git ls-files --eol src/app/i18n.de.ts` must still show `w/crlf`.

- [ ] **Step 5: Track the not-saved state in the hook**

In `src/app/use-timelog-sync.ts` (Edit tool):

5.1 Replace
`import { saveActualsCache, loadActualsCache, clearActualsCache, type TimelogRollWindow } from "./timelog-actuals-store";`
with
`import { saveActualsCache, loadActualsCache, clearActualsCache, type ActualsCacheEntry, type TimelogRollWindow } from "./timelog-actuals-store";`

5.2 In the `rollPair` docstring, replace `pair — the shape every \`saveActualsCache\` call spreads.` with `pair — the shape every \`persist\` call spreads.`

5.3 Directly below `  const [error, setError] = useState<number | null>(null);` add:

```ts
  // ★★ TRUE when the LAST cache write was refused by the browser (quota or
  // disabled storage). This hook still holds the fresh fetch, but
  // `saveActualsCache` removed the stale stored entry rather than leave it, so
  // the Budget view and the next reload do not see these bookings. The panel
  // warns while it is set; the next successful save or Clear all resets it.
  // Not persisted — it describes a write in THIS session.
  const [cacheNotSaved, setCacheNotSaved] = useState(false);
  /** Every cache write goes through here, so none of the four savers can drop
   *  the not-saved signal. */
  function persist(entry: ActualsCacheEntry): void {
    setCacheNotSaved(!saveActualsCache(projectId, entry));
  }
```

5.4 Replace ALL occurrences (`replace_all: true`) of `saveActualsCache(projectId, {` with `persist({`.
Confirm: `grep -c "persist({" src/app/use-timelog-sync.ts` prints `4`, and `grep -c "saveActualsCache(projectId" src/app/use-timelog-sync.ts` prints `1` (inside `persist`).

5.5 In `clearAll`, replace `    clearActualsCache(projectId);\n  }` with:

```ts
    clearActualsCache(projectId);
    // The warning described a write this Clear just made moot.
    setCacheNotSaved(false);
  }
```

5.6 In the hook's `return { … }`, replace `busy, error, loadDirectory,` with `busy, error, cacheNotSaved, loadDirectory,`.

- [ ] **Step 6: Render the warning**

In `src/app/timelog-panel.tsx` (Edit tool):

6.1 Below `import { useToastContext } from "./toast-context";` add `import { Banner } from "./banner";`
(`git grep -n "from \"./banner\"" src/app/timelog-panel.tsx` must print nothing beforehand).

6.2 Directly below the `sync.error` block (the `)}` that closes `{sync.error && (`, followed by the blank line and
`      {/* Last synced + unattributed */}`), insert:

```tsx
      {/* The fetched bookings could not be cached on this device (browser
          storage refused the write). Clears on the next successful save. */}
      {sync.cacheNotSaved && (
        <Banner severity="warn" className="mb-3">
          {t(lang, "timelogCacheNotSaved")}
        </Banner>
      )}

```

- [ ] **Step 7: Run the suites**

Run: `npx vitest run src/app/use-timelog-sync.test.ts src/app/timelog-panel.test.tsx src/app/i18n-encoding.test.ts src/app/i18n.test.ts > "$TMPDIR/t9b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$TMPDIR/t9b.log"`
Expected: `EXIT=0`, `Test Files  4 passed (4)`.

- [ ] **Step 8: Mutation checks**

Apply each alone, confirm the named test fails, revert with the Edit tool, prove with `git diff --stat`:
1. Hook `persist`: `setCacheNotSaved(!saveActualsCache(projectId, entry));` → `saveActualsCache(projectId, entry);`. "sets cacheNotSaved when the browser refuses the cache write …" fails.
2. Hook `clearAll`: delete `setCacheNotSaved(false);`. "resets cacheNotSaved on Clear all" fails.
3. Panel: `{sync.cacheNotSaved && (` → `{false && (`. "warns when the sync hook reports that the cache write was refused" fails.

Rerun Step 7 at `EXIT=0`, `Test Files  4 passed (4)`.

- [ ] **Step 9: Typecheck, lint, size, commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/use-timelog-sync.ts src/app/use-timelog-sync.test.ts src/app/timelog-panel.tsx src/app/timelog-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts; echo "EXIT=$?"
node -e "for (const f of ['src/app/use-timelog-sync.ts','src/app/timelog-panel.tsx']) console.log(f, require('fs').readFileSync(f,'utf8').split('\n').length)"
git ls-files --eol src/app/use-timelog-sync.ts src/app/timelog-panel.tsx src/app/i18n.ts src/app/i18n.de.ts
git add src/app/use-timelog-sync.ts src/app/use-timelog-sync.test.ts src/app/timelog-panel.tsx src/app/timelog-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat(timelog): warn when fetched bookings could not be cached

useTimelogSync routes its four cache writes through one helper and
exposes cacheNotSaved when the browser refused the write. The TimeLog
panel shows a warning Banner telling the user the Budget view does not
see these bookings and that a reload loses them, and to apply them now or
free storage and fetch again. The next successful save or Clear all
clears it.

Claude-Session: https://[session link removed]
EOF
```

Expected: every `EXIT=0`; line counts about 540 and 832 (limit 1600); all four files `w/crlf`.

**Ordering note for Task 8:** Task 8's `docs/AGENTS/integrations.md` text must describe the packed cache and the
warning, and it names `toStoredAggregate`, `fromStoredAggregate`, `isPackedBucketDays` and `cacheNotSaved`. Those
are gated by `docs:symbols:check`, so run Task 8 after 9a and 9b. The exact paragraph is in `cache-design.md` §8.

---

### Task 8: Spec correction, landmine docs and §169 closure

**Files:**
- Modify: `docs/superpowers/specs/2026-09-14-budget-forecast-union-design.md` (only if a name shipped under a different spelling)
- Modify: `docs/AGENTS/integrations.md` ("Apply to budget" bullet)
- Modify: `docs/open-followups.md` (§169 heading, status, index row)
- Modify: `src/app/budget-panel-people-rows.tsx` (one doc comment)

**Interfaces:**
- Consumes: the names shipped in Tasks 1–7.
- Produces: documentation only.

- [ ] **Step 1: Confirm the spec already matches**

§4.1–§4.3 and the §11 cache risk were corrected in the plan's own commit. Run
`git grep -n -E "encodeActualMap|bucketOverlay|actualHoursAt" docs/superpowers/specs/2026-09-14-budget-forecast-union-design.md`
and confirm all three names appear. If a name shipped under a different spelling in Tasks 1–7, correct the spec
text and stage the spec in this task's commit.

- [ ] **Step 2: Update `docs/AGENTS/integrations.md`**

In the "Apply to budget" bullet, replace the sentence that begins `★★ The actuals period KEY MUST match the plan granularity:` up to and including `Pass \`plan.granularity\` panel→\`useTimelogSync\`→engine;` with:

```markdown
★★ Actual hours carry DAY keys. `aggregateActuals(items, links)` stores `byBucketDay` (bucket → `YYYY-MM-DD` → cell with each resource's hours) and takes NO granularity; the period-keyed overlay every consumer reads is `bucketOverlay(aggregate, plan.granularity)`, derived at read time, so a granularity change after a fetch cannot strand hours under unread keys (§169, closed). Apply writes day keys into allocation `actualHours` and owns each covered period whole (its period key and every day key inside it); every reader goes through `actualHoursIn` / `actualHoursAt` (`actual-hours.ts`), never `actualHours[p.key]`. The codec accepts day keys for `actualHours` ONLY (`encodeActualMap` / `decodeActualMap`); `budgetHours` stays period-only. A period cell holding day keys is read-only in the Budget view. Verify: `git grep -n "actualHours\[" -- src/app ':!*.test.*'` must print nothing.
```

First, in `src/app/budget-panel-people-rows.tsx`, change the doc comment that quotes `a.actualHours[p.key]` so it quotes `actualHoursAt(a.actualHours, p.key)` instead (Edit tool; the file is CRLF). Then run that verification command; expected no output. If it prints a line, a reader was missed: switch it to `actualHoursIn` before continuing.

Also add to the Timelog "Apply to budget" section of `docs/AGENTS/integrations.md`:

```markdown
★★ The per-device actuals cache stores day cells PACKED: `saveActualsCache` runs `toStoredAggregate` (`timelog-actuals-codec.ts`: per-bucket columns over shared day and resource tables, lossless) and `loadActualsCache` unpacks with `fromStoredAggregate`, so every reader still sees `byBucketDay`. A pre-packing entry (legacy `byBucket`, or verbose `byBucketDay`) loads as-is; a malformed `dayCells` drops the entry (`isPackedBucketDays`). When the browser refuses the write, `saveActualsCache` removes that project's stale entry and returns `false`, and `useTimelogSync`'s `cacheNotSaved` shows the TimeLog panel's warning.
```

and in the `BudgetUnappliedNotice` bullet change "`isEntry` only shallow-checks that `aggregates` is an object" to "`isEntry` checks only that `aggregates` is an object and that any packed `dayCells` is well-formed" (grep the quoted phrase first; if it is worded differently, apply the same correction to the real sentence).

- [ ] **Step 3: Close §169 in the register**

In `docs/open-followups.md`:

Heading `## 169. TimeLog period keys are derived at FETCH time from the granularity, then cached — open` becomes `## 169. TimeLog period keys are derived at FETCH time from the granularity, then cached — CLOSED 2026-09-14`.

Status line `**Status:** open — period keys frozen at fetch time. Reproduced 2026-08-28 by …` becomes:

```markdown
**Status:** CLOSED 2026-09-14 on `feat/budget-forecast-union`. `aggregateActuals` no longer takes a granularity: it stores day-keyed cells (`byBucketDay`), and every consumer derives periods at read time with the live plan granularity through `bucketOverlay`. A pre-change cached entry keeps only the cells whose key shape matches the live granularity. Pinned by `timelog-actuals.test.ts` "rolls the same aggregate into ISO weeks when the plan is weekly (§169)" and "keeps a legacy period-keyed entry only where its keys match the live granularity", and `timelog-apply.test.ts` "keeps hours counted when the plan switches granularity after apply (§169)", each mutation-checked. The OPEN-era text below is kept as the record of what was found.
```

Index row: change the link anchor and the status cells of

```markdown
| [§169](#169-timelog-period-keys-are-derived-at-fetch-time-from-the-granularity-then-cached--open) | TimeLog period keys are derived at FETCH time from the granularity, then cached — open | — | — | open |
```

to

```markdown
| [§169](#169-timelog-period-keys-are-derived-at-fetch-time-from-the-granularity-then-cached--closed-2026-09-14) | TimeLog period keys are derived at FETCH time from the granularity, then cached — CLOSED 2026-09-14 | — | — | **CLOSED** 2026-09-14 |
```

Keep the `**Work item:** #169` line unchanged (the MR description closes the issue).

- [ ] **Step 4: Run the doc gates**

```bash
npm run followups:index:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```

Expected: all `EXIT=0`. Line endings: `git ls-files --eol docs/open-followups.md docs/AGENTS/integrations.md docs/superpowers/specs/2026-09-14-budget-forecast-union-design.md` all `i/lf w/lf`.

- [ ] **Step 5: Commit**

```bash
git add docs/AGENTS/integrations.md docs/open-followups.md src/app/budget-panel-people-rows.tsx
git commit -F - <<'EOF'
docs(budget): record dated actuals and the packed cache, close §169

integrations.md replaces the fetch-time granularity rule with the day-key
rule and documents the packed actuals cache. The people-rows comment names
the period reader. §169 is closed with its pinning tests; the spec already
matched the shipped names.

Claude-Session: https://[session link removed]
EOF
```

---

## Final verification (after Task 8)

Run once, sequentially, each unpiped:

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src; echo "EXIT=$?"
# Full suite ONLY on the user's explicit say (user instruction 2026-09-14):
# npm run test:run > "$TMPDIR/final.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$TMPDIR/final.log"
npm run size:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
git grep -n "actualHours\[" -- src/app ':!*.test.*'
git log --oneline origin/main..HEAD
```

Expected: every `EXIT=0`, the grep prints nothing, and the log shows the spec and plan commits plus every task and fix-round commit. Push, MR and merge happen only on the user's explicit say.

## Owed eye-verify (for the MR description)

- Budget view on a project with applied TimeLog hours: a period with day keys shows the total, is read-only, and hovering shows "From TimeLog. Re-apply to change."; a period without day keys stays editable.
- TimeLog panel: fetch on a monthly plan, switch the plan to weekly, Apply: the Budget view totals match TimeLog.
- A device with a cache from before the change: the Budget view and the unapplied notice render without errors; Refresh & re-apply writes day keys.
