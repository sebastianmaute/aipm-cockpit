# Project Budget Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project budget planner — named budget buckets (PO lines) that span roles, draw planned hours from the resource engine, track manually-entered actuals, compute a three-value CCI + win/loss, spill remaining budget into a successor on close, and display in a currency backed by ECB rates.

**Architecture:** Budget is a first-class workspace entity following the existing resources/roles pattern (type → sanitizer → IDB/CSV/MD/JSON persistence + migration → calc engine → tab/panel). The calc engine (`budget-report.ts`) is pure and computes all money in EUR from role rates; currency conversion happens only at display/rollup via `fx.ts`. FX rates come from a new `/api/ecb` route, cached in the workspace.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Vitest + Testing Library, Tailwind v4. Persistence via IndexedDB / local files (JSON/CSV/MD) / SharePoint.

**Spec:** `docs/superpowers/specs/2026-05-26-project-budget-planner-design.md`

**Conventions to follow:**
- Immutable updates only (spread, never mutate). Sanitizers return `null` to reject a record.
- Run a single test: `npx vitest run src/app/<file>.test.ts -t "<name>"`.
- Run all tests: `npm run test:run`. Type-check/build: `npm run build`. Lint: `npm run lint`.
- Commit messages: conventional commits (`feat:`, `test:`, `refactor:`…). Attribution is disabled globally — do not add co-author trailers.

---

## Phase 1 — Data model, persistence, calc engine

### Task 1: Budget types & constants

**Files:**
- Modify: `src/app/types.ts` (append at end, after `DEFAULT_CURRENCY`)
- Test: `src/app/budget-types.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/budget-types.test.ts
import { describe, expect, test } from "vitest";
import { BUDGET_TYPES, SUPPORTED_CURRENCIES, isBudgetCurrency } from "./types";

describe("budget constants", () => {
  test("supported currencies are EUR/USD/GBP", () => {
    expect(SUPPORTED_CURRENCIES).toEqual(["EUR", "USD", "GBP"]);
  });
  test("budget types are tm and fixed", () => {
    expect(BUDGET_TYPES).toEqual(["tm", "fixed"]);
  });
  test("isBudgetCurrency narrows valid codes", () => {
    expect(isBudgetCurrency("USD")).toBe(true);
    expect(isBudgetCurrency("JPY")).toBe(false);
    expect(isBudgetCurrency(42)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/budget-types.test.ts`
Expected: FAIL — `SUPPORTED_CURRENCIES`/`BUDGET_TYPES`/`isBudgetCurrency` not exported.

- [ ] **Step 3: Append the types to `src/app/types.ts`**

```ts
// ----------------------------------------------------------------------------
// Project Budget Planner.
//
// A single project-level budget = all BudgetBuckets in the workspace. A bucket
// is a named PO/contract line (T&M or fixed-price) in a currency. It spans one
// or more roles via per-role ALLOCATIONS: each allocation names a role + the
// resources whose capacity forms its PLAN, plus per-period budget & actual
// hours. Closing a bucket spills its remaining budget into a successor.

export const BUDGET_TYPES = ["tm", "fixed"] as const;
export type BudgetType = (typeof BUDGET_TYPES)[number]; // time-&-material | fixed-price

export const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP"] as const;
export type BudgetCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function isBudgetCurrency(v: unknown): v is BudgetCurrency {
  return typeof v === "string" && (SUPPORTED_CURRENCIES as readonly string[]).includes(v);
}

export type BucketStatus = "open" | "closed";

/** One role line within a bucket. `resourceIds` feed the PLAN (their capacity);
 *  `budgetHours`/`actualHours` are periodKey → hours maps (aligned to the plan). */
export type BucketAllocation = {
  roleId: number;
  resourceIds: number[];
  budgetHours: Record<string, number>;
  actualHours: Record<string, number>;
};

export type BudgetBucket = {
  id: number;
  name: string;
  poNumber?: string;
  type: BudgetType;
  currency: BudgetCurrency;
  /** Fixed-price contract amount in the bucket currency; only when type === "fixed". */
  fixedPriceAmount?: number;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  /** Successor bucket id that receives this bucket's remaining budget on close. */
  successorId?: number | null;
  status: BucketStatus;
  closedDate?: string;
  /** Manual EUR → currency rate override; wins over cached ECB while present. */
  fxRateOverride?: number;
  allocations: BucketAllocation[];
  localModifiedAt?: string;
};

/** Cached ECB reference rates (EUR base), one table per workspace. */
export type FxRates = {
  base: "EUR";
  date: string;      // ECB publication date (YYYY-MM-DD)
  fetchedAt: string; // ISO timestamp of the fetch
  rates: Record<string, number>; // currency code → units per 1 EUR
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/budget-types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/types.ts src/app/budget-types.test.ts
git commit -m "feat(budget): add budget bucket and fx-rate types"
```

---

### Task 2: Budget sanitizers

**Files:**
- Modify: `src/app/sanitize.ts` (append at end; add imports)
- Test: `src/app/sanitize-budget.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/sanitize-budget.test.ts
import { describe, expect, test } from "vitest";
import {
  sanitizeBudgetBucket,
  sanitizeFxRates,
  encodeAllocations,
  decodeAllocations,
} from "./sanitize";

describe("sanitizeBudgetBucket", () => {
  const base = {
    id: 1, name: "PAM", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-06-30", status: "open",
    allocations: [{ roleId: 3, resourceIds: [5, 7], budgetHours: { "2026-01": 40 }, actualHours: { "2026-01": 38 } }],
  };
  test("accepts a well-formed bucket", () => {
    const b = sanitizeBudgetBucket(base)!;
    expect(b.id).toBe(1);
    expect(b.type).toBe("tm");
    expect(b.allocations[0].resourceIds).toEqual([5, 7]);
    expect(b.allocations[0].budgetHours).toEqual({ "2026-01": 40 });
  });
  test("rejects missing id / name", () => {
    expect(sanitizeBudgetBucket({ ...base, id: 0 })).toBeNull();
    expect(sanitizeBudgetBucket({ ...base, name: "  " })).toBeNull();
  });
  test("defaults bad type/currency/status", () => {
    const b = sanitizeBudgetBucket({ ...base, type: "x", currency: "JPY", status: "weird" })!;
    expect(b.type).toBe("tm");
    expect(b.currency).toBe("EUR");
    expect(b.status).toBe("open");
  });
  test("swaps reversed dates", () => {
    const b = sanitizeBudgetBucket({ ...base, startDate: "2026-06-30", endDate: "2026-01-01" })!;
    expect(b.startDate).toBe("2026-01-01");
    expect(b.endDate).toBe("2026-06-30");
  });
  test("keeps fixedPriceAmount only for fixed type", () => {
    expect(sanitizeBudgetBucket({ ...base, type: "fixed", fixedPriceAmount: 1000 })!.fixedPriceAmount).toBe(1000);
    expect(sanitizeBudgetBucket({ ...base, type: "tm", fixedPriceAmount: 1000 })!.fixedPriceAmount).toBeUndefined();
  });
  test("parses allocations from an encoded string (CSV/MD path)", () => {
    const enc = encodeAllocations(base.allocations as never);
    const b = sanitizeBudgetBucket({ ...base, allocations: enc })!;
    expect(b.allocations[0].roleId).toBe(3);
    expect(b.allocations[0].actualHours).toEqual({ "2026-01": 38 });
  });
});

describe("encode/decode allocations round-trip", () => {
  test("round-trips", () => {
    const allocs = [
      { roleId: 3, resourceIds: [5, 7], budgetHours: { "2026-01": 40, "2026-02": 20 }, actualHours: { "2026-01": 38 } },
      { roleId: 9, resourceIds: [], budgetHours: {}, actualHours: {} },
    ];
    expect(decodeAllocations(encodeAllocations(allocs))).toEqual(allocs);
  });
});

describe("sanitizeFxRates", () => {
  test("accepts an EUR-base table", () => {
    const fx = sanitizeFxRates({ base: "EUR", date: "2026-05-26", fetchedAt: "2026-05-26T10:00:00Z", rates: { EUR: 1, USD: 1.08, JPY: 999 } })!;
    expect(fx.rates.USD).toBe(1.08);
    expect(fx.rates.JPY).toBeUndefined(); // only supported currencies kept
    expect(fx.rates.EUR).toBe(1);
  });
  test("rejects non-EUR base / missing date", () => {
    expect(sanitizeFxRates({ base: "USD", date: "2026-05-26", fetchedAt: "x", rates: {} })).toBeNull();
    expect(sanitizeFxRates({ base: "EUR", date: "", fetchedAt: "x", rates: {} })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/sanitize-budget.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Add imports and append sanitizers to `src/app/sanitize.ts`**

Add to the `types` import block at the top:

```ts
  type BudgetBucket,
  type BucketAllocation,
  type BudgetType,
  type BucketStatus,
  type FxRates,
  BUDGET_TYPES,
  SUPPORTED_CURRENCIES,
  isBudgetCurrency,
```

Append at the end of the file:

```ts
// --- Budget planner sanitizers ---------------------------------------------

const BUDGET_NAME_MAX = 200;
const PO_NUMBER_MAX = 64;
const AMOUNT_MAX = 1_000_000_000;
const BUDGET_TYPE_SET: ReadonlySet<BudgetType> = new Set(BUDGET_TYPES);

function sanitizeAmount(n: unknown): number | undefined {
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num) || num < 0) return undefined;
  return Math.min(AMOUNT_MAX, Math.round(num * 100) / 100);
}

function sanitizeIdList(input: unknown): number[] {
  let arr: unknown[];
  if (Array.isArray(input)) arr = input;
  else if (typeof input === "string") arr = input.split(".");
  else return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const item of arr) {
    const n = typeof item === "number" ? item : Number(String(item).trim());
    if (Number.isFinite(n) && n > 0 && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

// Allocation text encoding (CSV/MD-safe). One allocation =
//   roleId ; resourceIds(.-joined) ; budgetHours(periodmap) ; actualHours(periodmap)
// Allocations joined by "~". Period maps reuse encode/decodePeriodMap ("k=v|k=v").
export function encodeAllocations(allocs: readonly BucketAllocation[] | undefined): string {
  if (!Array.isArray(allocs) || allocs.length === 0) return "";
  return allocs
    .map((a) =>
      [a.roleId, a.resourceIds.join("."), encodePeriodMap(a.budgetHours), encodePeriodMap(a.actualHours)].join(";"),
    )
    .join("~");
}

export function decodeAllocations(s: unknown): BucketAllocation[] {
  if (typeof s !== "string" || !s) return [];
  const out: BucketAllocation[] = [];
  for (const part of s.split("~")) {
    if (!part.trim()) continue;
    const [roleIdStr = "", idsStr = "", budgetStr = "", actualStr = ""] = part.split(";");
    const roleId = Number(roleIdStr);
    if (!Number.isFinite(roleId) || roleId <= 0) continue;
    out.push({
      roleId,
      resourceIds: sanitizeIdList(idsStr),
      budgetHours: decodePeriodMap(budgetStr),
      actualHours: decodePeriodMap(actualStr),
    });
  }
  return out;
}

function sanitizeAllocation(input: unknown): BucketAllocation | null {
  if (!isPlainObject(input)) return null;
  const roleId = Number(input.roleId);
  if (!Number.isFinite(roleId) || roleId <= 0) return null;
  return {
    roleId,
    resourceIds: sanitizeIdList(input.resourceIds),
    budgetHours: coercePeriodMap(input.budgetHours, HOURS_MAP_MAX),
    actualHours: coercePeriodMap(input.actualHours, HOURS_MAP_MAX),
  };
}

function sanitizeAllocations(input: unknown): BucketAllocation[] {
  if (typeof input === "string") return decodeAllocations(input);
  if (!Array.isArray(input)) return [];
  return input.map(sanitizeAllocation).filter((a): a is BucketAllocation => a !== null);
}

export function sanitizeBudgetBucket(input: unknown): BudgetBucket | null {
  if (!isPlainObject(input)) return null;
  const id = Number(input.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const name = sanitizeText(input.name, BUDGET_NAME_MAX);
  if (!name) return null;

  const type: BudgetType =
    typeof input.type === "string" && BUDGET_TYPE_SET.has(input.type as BudgetType)
      ? (input.type as BudgetType)
      : "tm";
  const currency = isBudgetCurrency(input.currency) ? input.currency : SUPPORTED_CURRENCIES[0];
  const status: BucketStatus = input.status === "closed" ? "closed" : "open";

  const startDate = sanitizeIsoDate(input.startDate);
  const endDate = sanitizeIsoDate(input.endDate);
  const [start, end] = startDate && endDate && endDate < startDate ? [endDate, startDate] : [startDate, endDate];

  const bucket: BudgetBucket = {
    id, name, type, currency,
    startDate: start, endDate: end,
    status,
    allocations: sanitizeAllocations(input.allocations),
  };
  const po = sanitizeText(input.poNumber, PO_NUMBER_MAX); if (po) bucket.poNumber = po;
  if (type === "fixed") {
    const amt = sanitizeAmount(input.fixedPriceAmount);
    if (amt !== undefined) bucket.fixedPriceAmount = amt;
  }
  const succ = Number(input.successorId);
  if (Number.isFinite(succ) && succ > 0 && succ !== id) bucket.successorId = succ;
  if (status === "closed") {
    const cd = sanitizeIsoDate(input.closedDate);
    if (cd) bucket.closedDate = cd;
  }
  const fx = sanitizeAmount(input.fxRateOverride);
  if (fx !== undefined && fx > 0) bucket.fxRateOverride = fx;
  if (typeof input.localModifiedAt === "string" && input.localModifiedAt) bucket.localModifiedAt = input.localModifiedAt;
  return bucket;
}

export function sanitizeFxRates(input: unknown): FxRates | null {
  if (!isPlainObject(input)) return null;
  if (input.base !== "EUR") return null;
  const date = sanitizeIsoDate(input.date);
  if (!date) return null;
  const fetchedAt = typeof input.fetchedAt === "string" && input.fetchedAt ? input.fetchedAt : "";
  if (!fetchedAt) return null;
  const ratesIn = isPlainObject(input.rates) ? input.rates : {};
  const rates: Record<string, number> = {};
  for (const code of SUPPORTED_CURRENCIES) {
    const n = Number((ratesIn as Record<string, unknown>)[code]);
    if (Number.isFinite(n) && n > 0) rates[code] = Math.round(n * 1e6) / 1e6;
  }
  rates.EUR = 1; // base is always 1
  return { base: "EUR", date, fetchedAt, rates };
}
```

> Note: `encodePeriodMap`, `decodePeriodMap`, `coercePeriodMap`, `HOURS_MAP_MAX`, `isPlainObject`, `sanitizeText`, `sanitizeIsoDate` already exist in this file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/sanitize-budget.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/sanitize.ts src/app/sanitize-budget.test.ts
git commit -m "feat(budget): add bucket + fx-rate sanitizers and allocation codec"
```

---

### Task 3: Workspace shape + v6 migration

**Files:**
- Modify: `src/app/storage.ts` (Workspace type, `SCHEMA_VERSION`, `emptyWorkspace`, add `migrateWorkspaceV6`; imports)
- Test: `src/app/storage-budget-migrate.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/storage-budget-migrate.test.ts
import { describe, expect, test } from "vitest";
import { emptyWorkspace, migrateWorkspaceV6, type Workspace } from "./storage";

describe("v6 migration", () => {
  test("emptyWorkspace has budgets [] and fxRates null", () => {
    const ws = emptyWorkspace();
    expect(ws.budgets).toEqual([]);
    expect(ws.fxRates).toBeNull();
  });
  test("migrate adds missing budget fields and is idempotent", () => {
    const legacy = { ...emptyWorkspace() } as Partial<Workspace>;
    delete (legacy as Record<string, unknown>).budgets;
    delete (legacy as Record<string, unknown>).fxRates;
    const once = migrateWorkspaceV6(legacy as Workspace);
    expect(once.budgets).toEqual([]);
    expect(once.fxRates).toBeNull();
    const twice = migrateWorkspaceV6(once);
    expect(twice.budgets).toBe(once.budgets); // unchanged reference
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/storage-budget-migrate.test.ts`
Expected: FAIL — `migrateWorkspaceV6` not exported; `budgets`/`fxRates` not on Workspace.

- [ ] **Step 3: Edit `src/app/storage.ts`**

Add to the `types` import block:

```ts
  type BudgetBucket,
  type FxRates,
```

Add to the `sanitize` import block:

```ts
  sanitizeBudgetBucket,
  sanitizeFxRates,
```

Extend the `Workspace` type (after `plan: ResourcePlan;`):

```ts
  budgets: BudgetBucket[];
  fxRates: FxRates | null;
```

Bump the constant:

```ts
const SCHEMA_VERSION = 6;
```

In `emptyWorkspace()`, add the two fields to the returned object:

```ts
    plan: defaultResourcePlan(new Date().toISOString().slice(0, 10)),
    budgets: [],
    fxRates: null,
```

Add a v6 migration that composes onto v5 (place directly after `migrateWorkspaceV5`):

```ts
/**
 * v6 migration: ensures the budget planner fields exist. Runs after v5.
 * Idempotent — reuses arrays/values unchanged.
 */
export function migrateWorkspaceV6(ws: Workspace): Workspace {
  const base = migrateWorkspaceV5(ws);
  const budgets = Array.isArray(base.budgets) ? base.budgets : [];
  const fxRates = base.fxRates ?? null;
  if (budgets === base.budgets && fxRates === base.fxRates) return base;
  return { ...base, budgets, fxRates };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/storage-budget-migrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/storage.ts src/app/storage-budget-migrate.test.ts
git commit -m "feat(budget): extend workspace with budgets + fxRates and v6 migration"
```

---

### Task 4: CSV round-trip for budgets + fxRates

**Files:**
- Modify: `src/app/storage.ts` (CSV encoders/decoders + section split + `workspaceToCsv`/`csvToWorkspace`)
- Test: `src/app/storage-budget-csv.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/storage-budget-csv.test.ts
import { describe, expect, test } from "vitest";
import { workspaceToCsv, csvToWorkspace, emptyWorkspace } from "./storage";

function wsWithBudget() {
  const ws = emptyWorkspace();
  return {
    ...ws,
    budgets: [{
      id: 1, name: "PAM, Phase 1", type: "tm" as const, currency: "USD" as const,
      startDate: "2026-01-01", endDate: "2026-06-30", status: "open" as const,
      successorId: 2, fxRateOverride: 1.09,
      allocations: [{ roleId: 3, resourceIds: [5, 7], budgetHours: { "2026-01": 40 }, actualHours: { "2026-01": 38 } }],
    }],
    fxRates: { base: "EUR" as const, date: "2026-05-26", fetchedAt: "2026-05-26T10:00:00Z", rates: { EUR: 1, USD: 1.08, GBP: 0.85 } },
  };
}

describe("budget CSV round-trip", () => {
  test("budgets + fxRates survive CSV encode/decode", () => {
    const ws = wsWithBudget();
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.budgets).toHaveLength(1);
    expect(back.budgets[0].name).toBe("PAM, Phase 1"); // comma-containing name survives quoting
    expect(back.budgets[0].currency).toBe("USD");
    expect(back.budgets[0].successorId).toBe(2);
    expect(back.budgets[0].allocations[0]).toEqual({ roleId: 3, resourceIds: [5, 7], budgetHours: { "2026-01": 40 }, actualHours: { "2026-01": 38 } });
    expect(back.fxRates?.rates.USD).toBe(1.08);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/storage-budget-csv.test.ts`
Expected: FAIL — budgets come back empty.

- [ ] **Step 3: Edit `src/app/storage.ts`**

Add the `encodeAllocations` import to the `sanitize` import block:

```ts
  encodeAllocations,
```

Add column defs + section markers near the other `*_CSV_COLUMNS` (after `REF_CSV_COLUMNS`):

```ts
const BUDGETS_CSV_COLUMNS = [
  "id", "name", "poNumber", "type", "currency", "fixedPriceAmount",
  "startDate", "endDate", "successorId", "status", "closedDate",
  "fxRateOverride", "allocations", "localModifiedAt",
] as const;

const CSV_SECTION_BUDGETS = "# BUDGETS";
const CSV_SECTION_FXRATES = "# FXRATES";
```

Add encoders (near `rolesToCsv`):

```ts
function budgetFieldToString(b: BudgetBucket, c: string): string {
  switch (c) {
    case "id": return String(b.id);
    case "name": return b.name;
    case "poNumber": return b.poNumber ?? "";
    case "type": return b.type;
    case "currency": return b.currency;
    case "fixedPriceAmount": return b.fixedPriceAmount == null ? "" : String(b.fixedPriceAmount);
    case "startDate": return b.startDate;
    case "endDate": return b.endDate;
    case "successorId": return b.successorId == null ? "" : String(b.successorId);
    case "status": return b.status;
    case "closedDate": return b.closedDate ?? "";
    case "fxRateOverride": return b.fxRateOverride == null ? "" : String(b.fxRateOverride);
    case "allocations": return encodeAllocations(b.allocations);
    case "localModifiedAt": return b.localModifiedAt ?? "";
    default: return "";
  }
}

function budgetsToCsv(bs: readonly BudgetBucket[]): string {
  return rowsToCsv(BUDGETS_CSV_COLUMNS, bs.map((b) => BUDGETS_CSV_COLUMNS.map((c) => budgetFieldToString(b, c))));
}

function encodeRatesMap(rates: Record<string, number>): string {
  return Object.entries(rates).filter(([, v]) => Number.isFinite(v)).map(([k, v]) => `${k}=${v}`).join("|");
}

function fxRatesToCsvLine(fx: FxRates): string {
  return [CSV_SECTION_FXRATES, [fx.base, fx.date, fx.fetchedAt, encodeRatesMap(fx.rates)].map(csvEscape).join(",")].join("\r\n");
}
```

Add decoders (near `csvToRoles`):

```ts
function csvToBudgets(csv: string): BudgetBucket[] {
  return csvRowsToObjects(csv).map((o) => sanitizeBudgetBucket(o)).filter((b): b is BudgetBucket => b !== null);
}

function decodeRatesMap(s: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of s.split("|")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = Number(part.slice(eq + 1).trim());
    if (k && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function parseFxRatesLine(line: string): FxRates | null {
  const cells = parseCsv(line)[0];
  if (!cells || cells.length < 4) return null;
  return sanitizeFxRates({ base: cells[0], date: cells[1], fetchedAt: cells[2], rates: decodeRatesMap(cells[3]) });
}
```

Wire into `workspaceToCsv` (before the final `parts.push("", planToCsvLine(ws.plan));`):

```ts
  if (ws.budgets.length > 0) parts.push("", CSV_SECTION_BUDGETS, budgetsToCsv(ws.budgets));
  if (ws.fxRates) parts.push("", fxRatesToCsvLine(ws.fxRates));
```

In `splitCsvSections`: add `budgets` and `fxrates` to the `mode` union and the `*Lines` arrays, add marker branches, append branches, and return fields. Concretely:
- Add to the mode union: `| "budgets" | "fxrates"`.
- Add arrays: `const budgetsLines: string[] = []; const fxRatesLines: string[] = [];`
- Add marker checks (before the `CSV_SECTION_PLAN` check):
  ```ts
  if (trimmed.startsWith(CSV_SECTION_BUDGETS)) { mode = "budgets"; continue; }
  if (trimmed.startsWith(CSV_SECTION_FXRATES)) { mode = "fxrates"; continue; }
  ```
- Add append branches:
  ```ts
  else if (mode === "budgets") budgetsLines.push(line);
  else if (mode === "fxrates") fxRatesLines.push(line);
  ```
- Add to the returned object:
  ```ts
  budgetsText: budgetsLines.join("\r\n"),
  fxRatesText: fxRatesLines.join("\r\n"),
  ```
- Add the two keys to the function's return-type annotation.

Wire into `csvToWorkspace` (before the final `return migrateWorkspaceV5(ws);`): build `ws` with the new fields and switch the final migration to v6:

```ts
    plan: (s.planText.trim() && parsePlanLine(s.planText)) || defaultResourcePlan(new Date().toISOString().slice(0, 10)),
    budgets: s.budgetsText.trim() ? csvToBudgets(s.budgetsText) : [],
    fxRates: s.fxRatesText.trim() ? parseFxRatesLine(s.fxRatesText.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#")) ?? "") : null,
  };
  return migrateWorkspaceV6(ws);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/storage-budget-csv.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing storage suite to confirm no regression**

Run: `npx vitest run src/app/storage.test.ts src/app/storage-serialization.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/storage.ts src/app/storage-budget-csv.test.ts
git commit -m "feat(budget): CSV serialization for budgets + fx rates"
```

---

### Task 5: Markdown round-trip for budgets + fxRates

**Files:**
- Modify: `src/app/storage.ts` (MD encoders/decoders + section split + `workspaceToMarkdown`/`markdownToWorkspace`)
- Test: `src/app/storage-budget-md.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/storage-budget-md.test.ts
import { describe, expect, test } from "vitest";
import { workspaceToMarkdown, markdownToWorkspace, emptyWorkspace } from "./storage";

describe("budget Markdown round-trip", () => {
  test("budgets + fxRates survive MD encode/decode", () => {
    const ws = {
      ...emptyWorkspace(),
      budgets: [{
        id: 1, name: "PAM", type: "fixed" as const, currency: "GBP" as const,
        fixedPriceAmount: 50000, startDate: "2026-01-01", endDate: "2026-06-30", status: "open" as const,
        allocations: [{ roleId: 3, resourceIds: [5], budgetHours: { "2026-01": 40 }, actualHours: {} }],
      }],
      fxRates: { base: "EUR" as const, date: "2026-05-26", fetchedAt: "2026-05-26T10:00:00Z", rates: { EUR: 1, USD: 1.08, GBP: 0.85 } },
    };
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.budgets[0].type).toBe("fixed");
    expect(back.budgets[0].fixedPriceAmount).toBe(50000);
    expect(back.budgets[0].allocations[0].budgetHours).toEqual({ "2026-01": 40 });
    expect(back.fxRates?.rates.GBP).toBe(0.85);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/storage-budget-md.test.ts`
Expected: FAIL.

- [ ] **Step 3: Edit `src/app/storage.ts`**

Add MD column defs (near `ROLES_MD_COLUMNS`):

```ts
const BUDGETS_MD_COLUMNS: readonly { col: string; label: string }[] = [
  { col: "id", label: "ID" },
  { col: "name", label: "Name" },
  { col: "poNumber", label: "PO" },
  { col: "type", label: "Type" },
  { col: "currency", label: "Currency" },
  { col: "fixedPriceAmount", label: "FixedPrice" },
  { col: "startDate", label: "Start" },
  { col: "endDate", label: "End" },
  { col: "successorId", label: "SuccessorId" },
  { col: "status", label: "Status" },
  { col: "closedDate", label: "Closed" },
  { col: "fxRateOverride", label: "FxOverride" },
  { col: "allocations", label: "Allocations" },
  { col: "localModifiedAt", label: "LocalModified" },
];
```

Add MD encoders (near `rolesToMarkdown`):

```ts
function budgetsToMarkdown(bs: readonly BudgetBucket[]): string {
  const header = `| ${BUDGETS_MD_COLUMNS.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${BUDGETS_MD_COLUMNS.map(() => "---").join(" | ")} |`;
  const lines = ["# Budgets", "", header, sep];
  for (const b of bs) {
    lines.push(`| ${BUDGETS_MD_COLUMNS.map((c) => mdEscape(budgetFieldToString(b, c.col))).join(" | ")} |`);
  }
  return lines.join("\n") + "\n";
}

function fxRatesToMarkdown(fx: FxRates): string {
  return `## FX Rates\n\n${fx.base},${fx.date},${fx.fetchedAt},${encodeRatesMap(fx.rates)}\n`;
}
```

Wire into `workspaceToMarkdown` (before `out += "\n" + planToMarkdown(ws.plan);`):

```ts
  if (ws.budgets.length > 0) out += "\n" + budgetsToMarkdown(ws.budgets);
  if (ws.fxRates) out += "\n" + fxRatesToMarkdown(ws.fxRates);
```

Add MD decoders (near `markdownToRoles`):

```ts
function markdownToBudgets(md: string): BudgetBucket[] {
  return markdownTableToObjects(md).map((row) => {
    const mapped: Record<string, string> = {};
    for (const [label, val] of Object.entries(row)) {
      const norm = label.toLowerCase().replace(/\s+/g, "");
      if (norm === "id") mapped["id"] = val;
      else if (norm === "name") mapped["name"] = val;
      else if (norm === "po" || norm === "ponumber") mapped["poNumber"] = val;
      else if (norm === "type") mapped["type"] = val;
      else if (norm === "currency") mapped["currency"] = val;
      else if (norm === "fixedprice" || norm === "fixedpriceamount") mapped["fixedPriceAmount"] = val;
      else if (norm === "start" || norm === "startdate") mapped["startDate"] = val;
      else if (norm === "end" || norm === "enddate") mapped["endDate"] = val;
      else if (norm === "successorid") mapped["successorId"] = val;
      else if (norm === "status") mapped["status"] = val;
      else if (norm === "closed" || norm === "closeddate") mapped["closedDate"] = val;
      else if (norm === "fxoverride" || norm === "fxrateoverride") mapped["fxRateOverride"] = val;
      else if (norm === "allocations") mapped["allocations"] = val;
      else if (norm === "localmodified" || norm === "localmodifiedat") mapped["localModifiedAt"] = val;
    }
    return sanitizeBudgetBucket(mapped);
  }).filter((b): b is BudgetBucket => b !== null);
}

function parseFxRatesMarkdown(md: string): FxRates | null {
  for (const line of md.split(/\r?\n/)) {
    const tline = line.trim();
    if (!tline || tline.startsWith("#") || tline.startsWith("|")) continue;
    const cells = tline.split(",").map((s) => s.trim());
    if (cells.length < 4) continue;
    return sanitizeFxRates({ base: cells[0], date: cells[1], fetchedAt: cells[2], rates: decodeRatesMap(cells.slice(3).join(",")) });
  }
  return null;
}
```

In `splitMarkdownSections`: add `budgetsLines` and `fxRatesLines` arrays, the heading matchers, and return fields:
- Arrays: `const budgetsLines: string[] = []; const fxRatesLines: string[] = [];`
- Heading matchers (alongside the other `if (/^#\s+Roles\b/i...)` lines):
  ```ts
  if (/^#\s+Budgets\b/i.test(trimmed)) { target = budgetsLines; target.push(line); continue; }
  if (/^##\s+FX\s+Rates\b/i.test(trimmed)) { target = fxRatesLines; continue; }
  ```
- Return additions: `budgetsMd: budgetsLines.join("\n"), fxRatesMd: fxRatesLines.join("\n"),` and add both keys to the return-type annotation.

Wire into `markdownToWorkspace` (change the final migration to v6):

```ts
    plan: (s.planMd.trim() && parsePlanMarkdown(s.planMd)) || defaultResourcePlan(new Date().toISOString().slice(0, 10)),
    budgets: s.budgetsMd.trim() ? markdownToBudgets(s.budgetsMd) : [],
    fxRates: s.fxRatesMd.trim() ? parseFxRatesMarkdown(s.fxRatesMd) : null,
  };
  return migrateWorkspaceV6(ws);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/storage-budget-md.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/storage.ts src/app/storage-budget-md.test.ts
git commit -m "feat(budget): Markdown serialization for budgets + fx rates"
```

---

### Task 6: JSON envelope + IndexedDB persistence

**Files:**
- Modify: `src/app/storage.ts` (add exported `workspaceToJson`/`jsonToWorkspace`; use them in `LocalFileBackend`; add `budgets` IDB store + `fx-rates` KV key + `BrowserBackend` baseline/diff/load/save)
- Test: `src/app/storage-budget-json.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/storage-budget-json.test.ts
import { describe, expect, test } from "vitest";
import { workspaceToJson, jsonToWorkspace, emptyWorkspace } from "./storage";

describe("budget JSON round-trip", () => {
  test("budgets + fxRates survive JSON encode/decode", () => {
    const ws = {
      ...emptyWorkspace(),
      budgets: [{
        id: 1, name: "PAM", type: "tm" as const, currency: "EUR" as const,
        startDate: "2026-01-01", endDate: "2026-06-30", status: "open" as const,
        allocations: [{ roleId: 3, resourceIds: [5, 7], budgetHours: { "2026-01": 40 }, actualHours: { "2026-01": 38 } }],
      }],
      fxRates: { base: "EUR" as const, date: "2026-05-26", fetchedAt: "2026-05-26T10:00:00Z", rates: { EUR: 1, USD: 1.08, GBP: 0.85 } },
    };
    const back = jsonToWorkspace(workspaceToJson(ws));
    expect(back.budgets).toHaveLength(1);
    expect(back.budgets[0].allocations[0].actualHours).toEqual({ "2026-01": 38 });
    expect(back.fxRates?.rates.USD).toBe(1.08);
  });
  test("jsonToWorkspace tolerates a legacy envelope without budgets", () => {
    const legacy = JSON.stringify({ schemaVersion: 5, tasks: [], raid: [] });
    const back = jsonToWorkspace(legacy);
    expect(back.budgets).toEqual([]);
    expect(back.fxRates).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/storage-budget-json.test.ts`
Expected: FAIL — `workspaceToJson`/`jsonToWorkspace` not exported.

- [ ] **Step 3: Edit `src/app/storage.ts`**

Add exported JSON helpers (place near `workspaceToCsv`). These centralize the envelope logic currently inlined in `LocalFileBackend`:

```ts
/** Serialize a workspace to the JSON envelope (schemaVersion + entity arrays). */
export function workspaceToJson(ws: Workspace): string {
  return JSON.stringify(
    {
      schemaVersion: SCHEMA_VERSION,
      tasks: ws.tasks, raid: ws.raid, absences: ws.absences, shifts: ws.shifts,
      resources: ws.resources, roles: ws.roles, disciplines: ws.disciplines,
      grades: ws.grades, plan: ws.plan, budgets: ws.budgets, fxRates: ws.fxRates,
    },
    null,
    2,
  );
}

/** Parse a JSON envelope back to a workspace. Tolerates legacy files (pre-v6)
 *  by defaulting budgets → [] and fxRates → null. Returns an empty workspace
 *  on malformed input. */
export function jsonToWorkspace(text: string): Workspace {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyWorkspace();
    const p = parsed as Record<string, unknown>;
    if (!Array.isArray(p.tasks) || !Array.isArray(p.raid)) return emptyWorkspace();
    const raw: Workspace = {
      tasks: p.tasks as Task[],
      raid: p.raid as RaidItem[],
      absences: ((p.absences as unknown[]) ?? []).map((a) => sanitizeAbsence(a)).filter((a): a is Absence => a !== null),
      shifts: ((p.shifts as unknown[]) ?? []).map((s) => sanitizeShift(s)).filter((s): s is Shift => s !== null),
      resources: ((p.resources as unknown[]) ?? []).map((r) => sanitizeResource(r)).filter((r): r is Resource => r !== null),
      roles: ((p.roles as unknown[]) ?? []).map((r) => sanitizeRole(r)).filter((r): r is Role => r !== null),
      disciplines: ((p.disciplines as unknown[]) ?? []).map((d) => sanitizeDiscipline(d)).filter((d): d is Discipline => d !== null),
      grades: ((p.grades as unknown[]) ?? []).map((g) => sanitizeGrade(g)).filter((g): g is Grade => g !== null),
      plan: sanitizePlan(p.plan ?? {}, new Date().toISOString().slice(0, 10)),
      budgets: ((p.budgets as unknown[]) ?? []).map((b) => sanitizeBudgetBucket(b)).filter((b): b is BudgetBucket => b !== null),
      fxRates: sanitizeFxRates(p.fxRates),
    };
    return migrateWorkspaceV6(raw);
  } catch {
    return emptyWorkspace();
  }
}
```

Refactor `LocalFileBackend.load()` JSON branch to delegate: replace the whole `if (this.format === "json") { ... }` block with:

```ts
    if (this.format === "json") return jsonToWorkspace(text);
```

Refactor `LocalFileBackend.save()` JSON branch: replace the `if (this.format === "json") { content = JSON.stringify({...}); }` block with:

```ts
    if (this.format === "json") content = workspaceToJson(ws);
```

Add the IDB store + KV key constants (near `IDB_GRADES_STORE`):

```ts
const IDB_BUDGETS_STORE = "budgets";
const KV_FXRATES_KEY = "fx-rates";
```

Bump `const IDB_VERSION = 5;` → `6;` and add the store in `onupgradeneeded` (alongside the other `if (!db.objectStoreNames.contains(...))` blocks):

```ts
      if (!db.objectStoreNames.contains(IDB_BUDGETS_STORE)) {
        db.createObjectStore(IDB_BUDGETS_STORE, { keyPath: "id" });
      }
```

In `BrowserBackend`, add a baseline field (near `gradesBaseline`):

```ts
  private budgetsBaseline = new Map<number, BudgetBucket>();
```

In `BrowserBackend.load()`: declare `let budgets: BudgetBucket[] = [];` and `let fxRates: FxRates | null = null;` near the other `let` declarations, then read them inside the `try` block:

```ts
      budgets = await idbGetAll<BudgetBucket>(IDB_BUDGETS_STORE);
      fxRates = (await idbGet<FxRates>(KV_FXRATES_KEY)) ?? null;
```

Include them in the `raw` workspace literal (`{ tasks, raid, ..., plan, budgets, fxRates }`), change `migrateWorkspaceV5(raw)` → `migrateWorkspaceV6(raw)`, and after the existing baseline rebuilds add:

```ts
    this.budgetsBaseline = new Map(ws.budgets.map((b) => [b.id, b]));
```

In `BrowserBackend.save()`: add the budget diff + persist (alongside the resource diffs) and the fxRates KV write:

```ts
    const budgetDelta = this.diff(this.budgetsBaseline, ws.budgets);
    await idbBulkUpdate(IDB_BUDGETS_STORE, budgetDelta.puts, budgetDelta.deletes);
    await idbSet(KV_FXRATES_KEY, ws.fxRates);
```

and refresh the baseline at the end (alongside the other baseline rebuilds):

```ts
    this.budgetsBaseline = new Map(ws.budgets.map((b) => [b.id, b]));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/storage-budget-json.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check the whole project**

Run: `npm run build`
Expected: Build succeeds (the JSON branch refactor compiles; `Workspace` literals are complete everywhere).

- [ ] **Step 6: Run the full storage suite**

Run: `npx vitest run src/app/storage.test.ts src/app/storage-serialization.test.ts src/app/storage-file-picker.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/storage.ts src/app/storage-budget-json.test.ts
git commit -m "feat(budget): JSON envelope helpers + IndexedDB persistence for budgets"
```

---

### Task 7: Calc engine — active periods + planned hours

**Files:**
- Create: `src/app/budget-report.ts`
- Test: `src/app/budget-report.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/budget-report.test.ts
import { describe, expect, test } from "vitest";
import { bucketActivePeriods, allocationPlannedHours } from "./budget-report";
import type { ResourcePlan, Resource, BudgetBucket } from "./types";

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-03-31", granularity: "month", currency: "EUR" };
const noHolidays = new Set<string>();

function res(id: number, roleId: number, util: Record<string, number>): Resource {
  return { id, firstName: `R${id}`, lastName: "", roleId, utilizationMode: "percent", utilization: util };
}

describe("bucketActivePeriods", () => {
  test("intersects bucket [start,end] with plan periods", () => {
    const bucket = { startDate: "2026-02-01", endDate: "2026-02-28" } as BudgetBucket;
    const periods = bucketActivePeriods(bucket, plan);
    expect(periods.map((p) => p.key)).toEqual(["2026-02"]);
  });
});

describe("allocationPlannedHours", () => {
  test("sums capacity of the allocation's resources for a period at given util", () => {
    // Jan 2026 has 22 workdays × 8h = 176h at 100%.
    const resources = [res(5, 3, { "2026-01": 100 }), res(7, 3, { "2026-01": 50 })];
    const alloc = { roleId: 3, resourceIds: [5, 7], budgetHours: {}, actualHours: {} };
    const period = { key: "2026-01", start: "2026-01-01", end: "2026-01-31" };
    const hours = allocationPlannedHours(alloc, period, [period], resources, 8, noHolidays, "month");
    expect(hours).toBeCloseTo(176 + 88, 5); // 100% + 50%
  });
});
```

> Note: 22 is the count of Mon–Fri days in January 2026. If a future calendar makes that count differ, compute it with `workdaysInRange("2026-01-01","2026-01-31", new Set())` from `resource-capacity` and use `count*8 + count*8*0.5` in the assertion.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/budget-report.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/app/budget-report.ts`**

```ts
import {
  absencesForResource, displayCapacityHours, generatePeriods, type Period,
} from "./resource-capacity";
import type {
  Absence, BudgetBucket, BucketAllocation, PlanGranularity,
  Resource, ResourcePlan, Role,
} from "./types";

/** Plan periods whose start falls within the bucket's [startDate,endDate]. */
export function bucketActivePeriods(bucket: Pick<BudgetBucket, "startDate" | "endDate">, plan: ResourcePlan): Period[] {
  const all = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
  if (!bucket.startDate || !bucket.endDate) return all;
  return all.filter((p) => p.start >= bucket.startDate && p.start <= bucket.endDate);
}

/** Planned hours for one allocation in one period = Σ capacity of its resources. */
export function allocationPlannedHours(
  alloc: BucketAllocation,
  period: Period,
  canonicalPeriods: readonly Period[],
  resources: readonly Resource[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
  granularity: PlanGranularity,
  absences: readonly Absence[] = [],
): number {
  const byId = new Map(resources.map((r) => [r.id, r]));
  let sum = 0;
  for (const rid of alloc.resourceIds) {
    const r = byId.get(rid);
    if (!r) continue;
    const resAbs = absencesForResource(absences, r);
    sum += displayCapacityHours(period, canonicalPeriods, r, resAbs, workdayHours, holidaySet, granularity, granularity);
  }
  return sum;
}

/** Sum a periodKey → number map over a set of period keys (or all when omitted). */
export function sumPeriodMap(map: Record<string, number>, keys?: readonly string[]): number {
  if (!keys) return Object.values(map).reduce((a, b) => a + b, 0);
  let s = 0;
  for (const k of keys) s += map[k] ?? 0;
  return s;
}

/** Resolve the Role for an allocation. */
export function roleFor(roleId: number, roles: readonly Role[]): Role | undefined {
  return roles.find((r) => r.id === roleId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/budget-report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/budget-report.ts src/app/budget-report.test.ts
git commit -m "feat(budget): calc engine — active periods + planned hours"
```

---

### Task 8: Calc engine — per-bucket report (hours, cost, revenue, CCI, win/loss)

**Files:**
- Modify: `src/app/budget-report.ts`
- Test: `src/app/budget-report-bucket.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/budget-report-bucket.test.ts
import { describe, expect, test } from "vitest";
import { computeBucketReport } from "./budget-report";
import type { ResourcePlan, Resource, Role, BudgetBucket } from "./types";

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-01-31", granularity: "month", currency: "EUR" };
const roles: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
const resources: Resource[] = []; // plan hours not needed for these assertions
const noHolidays = new Set<string>();

function tmBucket(): BudgetBucket {
  return {
    id: 1, name: "PAM", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } }],
  };
}

describe("computeBucketReport — T&M", () => {
  const rep = computeBucketReport(tmBucket(), plan, roles, resources, 8, noHolidays);
  test("hours roll up", () => {
    expect(rep.budgetHours).toBe(100);
    expect(rep.actualHours).toBe(80);
  });
  test("cost = internal × actual; revenue = external × actual", () => {
    expect(rep.cost).toBe(80 * 100);
    expect(rep.revenue).toBe(80 * 150);
  });
  test("contribution margin", () => {
    expect(rep.contributionMargin.amount).toBe(80 * 150 - 80 * 100); // 4000
    expect(rep.contributionMargin.percent).toBeCloseTo((4000 / (80 * 150)) * 100, 5);
  });
  test("cost performance (CPI): budgetCost vs actualCost", () => {
    expect(rep.costPerformance.amount).toBe(100 * 100 - 80 * 100); // 2000 under
    expect(rep.costPerformance.percent).toBeCloseTo((10000 / 8000) * 100, 5);
  });
  test("consumption: budgetValue − consumedValue (external basis)", () => {
    expect(rep.consumption.amount).toBe(100 * 150 - 80 * 150); // 3000
    expect(rep.consumption.percent).toBeCloseTo((12000 / 15000) * 100, 5);
  });
  test("win/loss = budget − actual (hours & external value)", () => {
    expect(rep.winLossHours).toBe(20);
    expect(rep.winLossValue).toBe(20 * 150);
  });
});

describe("computeBucketReport — fixed-price", () => {
  test("revenue = fixed price; win/loss = price − cost; zero-denominator → null %", () => {
    const b: BudgetBucket = { ...tmBucket(), type: "fixed", fixedPriceAmount: 20000,
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 0 }, actualHours: { "2026-01": 80 } }] };
    const rep = computeBucketReport(b, plan, roles, resources, 8, noHolidays);
    expect(rep.revenue).toBe(20000);
    expect(rep.cost).toBe(80 * 100);
    expect(rep.winLossValue).toBe(20000 - 8000);
    expect(rep.consumption.percent).toBeNull(); // budgetValue 0 → guard
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/budget-report-bucket.test.ts`
Expected: FAIL — `computeBucketReport` not exported.

- [ ] **Step 3: Append to `src/app/budget-report.ts`**

```ts
/** A CCI value: an absolute amount (EUR) and a percent, or null when the
 *  denominator is 0 (rendered as "—"). */
export type CciValue = { amount: number; percent: number | null };

export type BucketReport = {
  bucketId: number;
  name: string;
  currency: BudgetBucket["currency"];
  type: BudgetBucket["type"];
  status: BudgetBucket["status"];
  budgetHours: number;
  plannedHours: number;
  actualHours: number;
  /** All amounts in EUR (converted to bucket currency only at display). */
  budgetValue: number;
  consumedValue: number;
  revenue: number;
  cost: number;
  /** internal-rate cost of the budgeted hours (used for the project CPI rollup). */
  budgetCost: number;
  winLossHours: number;
  winLossValue: number;
  /** Remaining budget rolled in from a closed predecessor (EUR + hours). */
  spilloverInHours: number;
  spilloverInValue: number;
  contributionMargin: CciValue;
  costPerformance: CciValue;
  consumption: CciValue;
};

function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return (numerator / denominator) * 100;
}

/**
 * Compute a single bucket's report. All money is in EUR (role rates are EUR).
 * `spilloverInHours`/`spilloverInValue` are the remaining budget rolled in
 * from a closed predecessor; the caller (computeBudgetReport) supplies them.
 */
export function computeBucketReport(
  bucket: BudgetBucket,
  plan: ResourcePlan,
  roles: readonly Role[],
  resources: readonly Resource[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
  spilloverInHours = 0,
  spilloverInValue = 0,
  absences: readonly Absence[] = [],
): BucketReport {
  const periods = bucketActivePeriods(bucket, plan);
  const keys = periods.map((p) => p.key);

  let budgetHours = 0;
  let actualHours = 0;
  let plannedHours = 0;
  let cost = 0;            // internal × actual hours, summed across allocations
  let tmRevenue = 0;       // external × actual hours (T&M)
  let budgetValueExternal = 0; // external × budget hours (T&M budget basis)
  let budgetCost = 0;      // internal × budget hours

  for (const alloc of bucket.allocations) {
    const role = roleFor(alloc.roleId, roles);
    const internal = role?.internalRate ?? 0;
    const external = role?.externalRate ?? 0;
    const aBudget = sumPeriodMap(alloc.budgetHours, keys);
    const aActual = sumPeriodMap(alloc.actualHours, keys);
    budgetHours += aBudget;
    actualHours += aActual;
    cost += aActual * internal;
    tmRevenue += aActual * external;
    budgetValueExternal += aBudget * external;
    budgetCost += aBudget * internal;
    for (const p of periods) {
      plannedHours += allocationPlannedHours(alloc, p, periods, resources, workdayHours, holidaySet, plan.granularity, absences);
    }
  }

  const isFixed = bucket.type === "fixed";
  const fixedPrice = bucket.fixedPriceAmount ?? 0;

  const revenue = isFixed ? fixedPrice : tmRevenue;
  // Budget/consumed VALUE basis: T&M = external × hours; Fixed = contract price
  // (consumed = price × actual/budget hours, clamped to [0, price]).
  const budgetValue = (isFixed ? fixedPrice : budgetValueExternal) + spilloverInValue;
  const consumedValue = isFixed
    ? (budgetHours > 0 ? Math.min(fixedPrice, fixedPrice * (actualHours / budgetHours)) : 0)
    : tmRevenue;

  const winLossHours = budgetHours + spilloverInHours - actualHours;
  const winLossValue = isFixed ? revenue - cost : budgetValue - consumedValue;

  return {
    bucketId: bucket.id, name: bucket.name, currency: bucket.currency,
    type: bucket.type, status: bucket.status,
    budgetHours: budgetHours + spilloverInHours, plannedHours, actualHours,
    budgetValue, consumedValue, revenue, cost, budgetCost,
    winLossHours, winLossValue,
    spilloverInHours, spilloverInValue,
    contributionMargin: { amount: revenue - cost, percent: pct(revenue - cost, revenue) },
    costPerformance: { amount: budgetCost - cost, percent: pct(budgetCost, cost) },
    consumption: { amount: budgetValue - consumedValue, percent: pct(consumedValue, budgetValue) },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/budget-report-bucket.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/budget-report.ts src/app/budget-report-bucket.test.ts
git commit -m "feat(budget): per-bucket report with CCI, revenue, win/loss"
```

---

### Task 9: Calc engine — spillover + project rollup

**Files:**
- Modify: `src/app/budget-report.ts`
- Test: `src/app/budget-report-project.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/budget-report-project.test.ts
import { describe, expect, test } from "vitest";
import { computeBudgetReport } from "./budget-report";
import type { ResourcePlan, Role, BudgetBucket } from "./types";

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const roles: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];

function bucket(id: number, extra: Partial<BudgetBucket> = {}): BudgetBucket {
  return {
    id, name: `B${id}`, type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
    allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } }],
    ...extra,
  };
}

describe("computeBudgetReport", () => {
  test("a closed bucket spills remaining budget into its successor", () => {
    const closed = bucket(1, { status: "closed", successorId: 2 }); // remaining: 20h, 20×150=3000€
    const succ = bucket(2);
    const report = computeBudgetReport([closed, succ], plan, roles, [], 8, new Set());
    const succReport = report.buckets.find((b) => b.bucketId === 2)!;
    expect(succReport.spilloverInHours).toBe(20);
    expect(succReport.spilloverInValue).toBe(3000);
    expect(succReport.budgetHours).toBe(120); // own 100 + 20 spilled
  });
  test("project rollup sums bucket revenue/cost and computes project CCI", () => {
    const report = computeBudgetReport([bucket(1), bucket(2)], plan, roles, [], 8, new Set());
    expect(report.project.revenue).toBe(2 * 80 * 150);
    expect(report.project.cost).toBe(2 * 80 * 100);
    expect(report.project.contributionMargin.amount).toBe(2 * (80 * 150 - 80 * 100));
  });
  test("spillover ignores a self/cyclic successor without throwing", () => {
    const a = bucket(1, { status: "closed", successorId: 2 });
    const b = bucket(2, { status: "closed", successorId: 1 });
    expect(() => computeBudgetReport([a, b], plan, roles, [], 8, new Set())).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/budget-report-project.test.ts`
Expected: FAIL — `computeBudgetReport` not exported.

- [ ] **Step 3: Append to `src/app/budget-report.ts`**

```ts
export type ProjectReport = {
  budgetHours: number;
  plannedHours: number;
  actualHours: number;
  budgetValue: number;
  consumedValue: number;
  revenue: number;
  cost: number;
  winLossHours: number;
  winLossValue: number;
  contributionMargin: CciValue;
  costPerformance: CciValue;
  consumption: CciValue;
};

export type BudgetReport = {
  buckets: BucketReport[];
  project: ProjectReport;
};

/**
 * Compute spillover-in amounts per bucket: a CLOSED bucket with a successor
 * contributes its remaining budget (budget − actual hours, and the EUR value)
 * to the successor. Single hop (no transitive chains); self-refs and missing
 * successors are ignored. Returns maps keyed by successor bucket id.
 */
function computeSpillover(
  buckets: readonly BudgetBucket[],
  plan: ResourcePlan,
  roles: readonly Role[],
  resources: readonly Resource[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
): { hours: Map<number, number>; value: Map<number, number> } {
  const hours = new Map<number, number>();
  const value = new Map<number, number>();
  const ids = new Set(buckets.map((b) => b.id));
  for (const b of buckets) {
    if (b.status !== "closed" || b.successorId == null) continue;
    if (b.successorId === b.id || !ids.has(b.successorId)) continue;
    const rep = computeBucketReport(b, plan, roles, resources, workdayHours, holidaySet);
    hours.set(b.successorId, (hours.get(b.successorId) ?? 0) + rep.winLossHours);
    value.set(b.successorId, (value.get(b.successorId) ?? 0) + (rep.budgetValue - rep.consumedValue));
  }
  return { hours, value };
}

export function computeBudgetReport(
  buckets: readonly BudgetBucket[],
  plan: ResourcePlan,
  roles: readonly Role[],
  resources: readonly Resource[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
  absences: readonly Absence[] = [],
): BudgetReport {
  const spill = computeSpillover(buckets, plan, roles, resources, workdayHours, holidaySet);
  const reports = buckets.map((b) =>
    computeBucketReport(
      b, plan, roles, resources, workdayHours, holidaySet,
      spill.hours.get(b.id) ?? 0, spill.value.get(b.id) ?? 0, absences,
    ),
  );

  const sum = (sel: (r: BucketReport) => number) => reports.reduce((a, r) => a + sel(r), 0);
  const revenue = sum((r) => r.revenue);
  const cost = sum((r) => r.cost);
  const budgetValue = sum((r) => r.budgetValue);
  const consumedValue = sum((r) => r.consumedValue);
  const budgetCost = sum((r) => r.budgetCost);

  const project: ProjectReport = {
    budgetHours: sum((r) => r.budgetHours),
    plannedHours: sum((r) => r.plannedHours),
    actualHours: sum((r) => r.actualHours),
    budgetValue, consumedValue, revenue, cost,
    winLossHours: sum((r) => r.winLossHours),
    winLossValue: sum((r) => r.winLossValue),
    contributionMargin: { amount: revenue - cost, percent: pct(revenue - cost, revenue) },
    costPerformance: { amount: budgetCost - cost, percent: pct(budgetCost, cost) },
    consumption: { amount: budgetValue - consumedValue, percent: pct(consumedValue, budgetValue) },
  };
  return { buckets: reports, project };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/budget-report-project.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full budget engine suite + build**

Run: `npx vitest run src/app/budget-report.test.ts src/app/budget-report-bucket.test.ts src/app/budget-report-project.test.ts && npm run build`
Expected: PASS + build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/budget-report.ts src/app/budget-report-project.test.ts
git commit -m "feat(budget): spillover into successor + project-level rollup"
```

---

## Phase 2 — FX / ECB

### Task 10: FX rate resolution + conversion (`fx.ts`)

**Files:**
- Create: `src/app/fx.ts`
- Test: `src/app/fx.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/fx.test.ts
import { describe, expect, test } from "vitest";
import { resolveRate, eurToCurrency, currencyToEur } from "./fx";
import type { FxRates, BudgetBucket } from "./types";

const fx: FxRates = { base: "EUR", date: "2026-05-26", fetchedAt: "x", rates: { EUR: 1, USD: 1.08, GBP: 0.85 } };
const bucket = (extra: Partial<BudgetBucket> = {}): BudgetBucket =>
  ({ id: 1, name: "B", type: "tm", currency: "USD", startDate: "", endDate: "", status: "open", allocations: [], ...extra });

describe("resolveRate", () => {
  test("manual override wins when present", () => {
    expect(resolveRate(bucket({ fxRateOverride: 1.2 }), fx)).toBe(1.2);
  });
  test("falls back to cached ECB rate when no override", () => {
    expect(resolveRate(bucket(), fx)).toBe(1.08);
  });
  test("falls back to 1 when currency missing / no cache / EUR", () => {
    expect(resolveRate(bucket({ currency: "GBP" }), null)).toBe(1);
    expect(resolveRate(bucket({ currency: "EUR" }), fx)).toBe(1);
  });
});

describe("conversion", () => {
  test("eurToCurrency multiplies by the rate", () => {
    expect(eurToCurrency(100, bucket(), fx)).toBeCloseTo(108, 5);
  });
  test("currencyToEur divides by the rate", () => {
    expect(currencyToEur(108, bucket(), fx)).toBeCloseTo(100, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/fx.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/app/fx.ts`**

```ts
import type { BudgetBucket, FxRates } from "./types";

/**
 * Units of the bucket's currency per 1 EUR. Precedence:
 *   1. bucket.fxRateOverride (manual; wins while present)
 *   2. cached ECB rate for the currency
 *   3. 1 (EUR base, or unknown currency / no cache)
 */
export function resolveRate(bucket: Pick<BudgetBucket, "currency" | "fxRateOverride">, fxRates: FxRates | null): number {
  if (bucket.fxRateOverride != null && bucket.fxRateOverride > 0) return bucket.fxRateOverride;
  if (bucket.currency === "EUR") return 1;
  const cached = fxRates?.rates[bucket.currency];
  return cached != null && cached > 0 ? cached : 1;
}

/** EUR amount → bucket currency. */
export function eurToCurrency(amountEur: number, bucket: Pick<BudgetBucket, "currency" | "fxRateOverride">, fxRates: FxRates | null): number {
  return amountEur * resolveRate(bucket, fxRates);
}

/** Bucket-currency amount → EUR. */
export function currencyToEur(amount: number, bucket: Pick<BudgetBucket, "currency" | "fxRateOverride">, fxRates: FxRates | null): number {
  const rate = resolveRate(bucket, fxRates);
  return rate === 0 ? amount : amount / rate;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/fx.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/fx.ts src/app/fx.test.ts
git commit -m "feat(budget): FX rate resolution + EUR conversion helpers"
```

---

### Task 11: ECB rate parser + `/api/ecb` route

**Files:**
- Create: `src/app/ecb.ts` (pure XML parser)
- Create: `src/app/api/ecb/route.ts`
- Test: `src/app/ecb.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/ecb.test.ts
import { describe, expect, test } from "vitest";
import { parseEcbDailyXml } from "./ecb";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
 <Cube>
  <Cube time='2026-05-26'>
   <Cube currency='USD' rate='1.0823'/>
   <Cube currency='GBP' rate='0.8512'/>
   <Cube currency='JPY' rate='168.2'/>
  </Cube>
 </Cube>
</gesmes:Envelope>`;

describe("parseEcbDailyXml", () => {
  test("extracts date and EUR-base rates (only supported currencies + EUR=1)", () => {
    const fx = parseEcbDailyXml(SAMPLE, "2026-05-26T10:00:00Z")!;
    expect(fx.base).toBe("EUR");
    expect(fx.date).toBe("2026-05-26");
    expect(fx.rates).toEqual({ EUR: 1, USD: 1.0823, GBP: 0.8512 });
  });
  test("returns null on malformed XML", () => {
    expect(parseEcbDailyXml("<nope/>", "x")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/ecb.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/app/ecb.ts`**

```ts
import { SUPPORTED_CURRENCIES, type FxRates } from "./types";

/**
 * Parse the ECB euro foreign-exchange daily reference XML into an EUR-base
 * FxRates table. Keeps only SUPPORTED_CURRENCIES; always sets EUR = 1.
 * Returns null when the date or rate cube can't be found. Pure (regex-based,
 * no DOM) so it runs in both Node (route) and tests.
 */
export function parseEcbDailyXml(xml: string, fetchedAt: string): FxRates | null {
  const timeMatch = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/);
  if (!timeMatch) return null;
  const date = timeMatch[1];
  const rates: Record<string, number> = { EUR: 1 };
  const supported = new Set<string>(SUPPORTED_CURRENCIES);
  const re = /currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = re.exec(xml))) {
    found = true;
    const code = m[1];
    const rate = Number(m[2]);
    if (supported.has(code) && Number.isFinite(rate) && rate > 0) rates[code] = rate;
  }
  if (!found) return null;
  return { base: "EUR", date, fetchedAt, rates };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/ecb.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the route `src/app/api/ecb/route.ts`**

```ts
import { NextResponse } from "next/server";
import { parseEcbDailyXml } from "../../ecb";

const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/** GET /api/ecb — fetch ECB daily EUR reference rates, return an FxRates table.
 *  The client caches the result in the workspace; this route holds no state. */
export async function GET() {
  try {
    const res = await fetch(ECB_DAILY_URL, { headers: { Accept: "application/xml" }, cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: `ECB responded ${res.status}` }, { status: 502 });
    }
    const xml = await res.text();
    const fx = parseEcbDailyXml(xml, new Date().toISOString());
    if (!fx) {
      return NextResponse.json({ error: "Could not parse ECB rates" }, { status: 502 });
    }
    // Allow the client to cache for an hour; ECB updates ~16:00 CET daily.
    return NextResponse.json(fx, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (err) {
    return NextResponse.json({ error: `ECB fetch failed: ${String(err)}` }, { status: 502 });
  }
}
```

- [ ] **Step 6: Type-check**

Run: `npm run build`
Expected: Build succeeds; the new route compiles.

- [ ] **Step 7: Commit**

```bash
git add src/app/ecb.ts src/app/ecb.test.ts src/app/api/ecb/route.ts
git commit -m "feat(budget): ECB daily-rate parser + /api/ecb route"
```

---

### Task 12: Client FX fetch hook

**Files:**
- Create: `src/app/use-fx-rates.ts`
- Test: `src/app/use-fx-rates.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/use-fx-rates.test.tsx
import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFxRates } from "./use-fx-rates";
import type { FxRates } from "./types";

const sample: FxRates = { base: "EUR", date: "2026-05-26", fetchedAt: "x", rates: { EUR: 1, USD: 1.08, GBP: 0.85 } };

describe("useFxRates", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  test("fetches and reports the rate table via onLoaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => sample })) as unknown as typeof fetch);
    const onLoaded = vi.fn();
    const { result } = renderHook(() => useFxRates(onLoaded));
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(sample));
    expect(result.current.error).toBeNull();
  });
  test("surfaces an error string on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: "x" }) })) as unknown as typeof fetch);
    const { result } = renderHook(() => useFxRates(vi.fn()));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-fx-rates.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/app/use-fx-rates.ts`**

```ts
"use client";
import { useCallback, useState } from "react";
import { sanitizeFxRates } from "./sanitize";
import type { FxRates } from "./types";

/**
 * Fetches ECB rates from /api/ecb on demand. `onLoaded` receives the sanitized
 * table so the caller can cache it into the workspace (workspace.fxRates).
 */
export function useFxRates(onLoaded: (fx: FxRates) => void) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ecb");
      const body = await res.json();
      if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
      const fx = sanitizeFxRates(body);
      if (!fx) throw new Error("Invalid rate table");
      onLoaded(fx);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [onLoaded]);

  return { loading, error, refresh };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/use-fx-rates.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-fx-rates.ts src/app/use-fx-rates.test.tsx
git commit -m "feat(budget): client hook to fetch + cache ECB rates"
```

---

## Phase 3 — Reminders, state wiring, UI

### Task 13: Bucket end-date reminders helper

**Files:**
- Modify: `src/app/budget-report.ts` (append)
- Test: `src/app/budget-reminders.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/budget-reminders.test.ts
import { describe, expect, test } from "vitest";
import { getBucketReminders } from "./budget-report";
import type { BudgetBucket } from "./types";

const b = (extra: Partial<BudgetBucket>): BudgetBucket =>
  ({ id: 1, name: "B", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-02-28", status: "open", allocations: [], ...extra });

describe("getBucketReminders", () => {
  test("flags open buckets whose end date is within the lead window", () => {
    const items = getBucketReminders([b({ endDate: "2026-02-10" })], 14, "2026-02-01");
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe("soon");
  });
  test("flags overdue (past end date, still open)", () => {
    const items = getBucketReminders([b({ endDate: "2026-01-15" })], 14, "2026-02-01");
    expect(items[0].category).toBe("overdue");
  });
  test("ignores closed buckets and far-future ends", () => {
    expect(getBucketReminders([b({ status: "closed", endDate: "2026-02-02" })], 14, "2026-02-01")).toHaveLength(0);
    expect(getBucketReminders([b({ endDate: "2026-06-01" })], 14, "2026-02-01")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/budget-reminders.test.ts`
Expected: FAIL — `getBucketReminders` not exported.

- [ ] **Step 3: Append to `src/app/budget-report.ts`**

```ts
export type BucketReminder = {
  bucket: BudgetBucket;
  category: "overdue" | "today" | "soon";
  daysLeft: number; // negative when overdue
};

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

/**
 * Open buckets whose end date is overdue, today, or within `leadDays` calendar
 * days of `today`. Sorted by end date ascending. Closed buckets are skipped.
 */
export function getBucketReminders(
  buckets: readonly BudgetBucket[],
  leadDays: number,
  today: string,
): BucketReminder[] {
  const out: BucketReminder[] = [];
  for (const bucket of buckets) {
    if (bucket.status === "closed" || !bucket.endDate) continue;
    const left = daysBetween(today, bucket.endDate);
    if (left < 0) out.push({ bucket, category: "overdue", daysLeft: left });
    else if (left === 0) out.push({ bucket, category: "today", daysLeft: 0 });
    else if (left <= leadDays) out.push({ bucket, category: "soon", daysLeft: left });
  }
  out.sort((a, b) => a.bucket.endDate.localeCompare(b.bucket.endDate));
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/budget-reminders.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/budget-report.ts src/app/budget-reminders.test.ts
git commit -m "feat(budget): bucket end-date reminder helper"
```

---

### Task 14: Workspace state + tab + broadcast wiring

**Files:**
- Modify: `src/app/workspace-context.tsx` (add `budgets`/`setBudgets`, `fxRates`/`setFxRates`)
- Modify: `src/app/workspace-tab-context.tsx` (`TopTab` += `"budget"`)
- Modify: `src/app/broadcast-sync.ts` (add `"budget"` popout tab + `budgets` channel key)
- Modify: `src/app/use-storage-backend.ts` (load/save/broadcast budgets + fxRates)
- Test: `src/app/workspace-context.test.tsx` (extend)

- [ ] **Step 1: Add a failing assertion to `src/app/workspace-context.test.tsx`**

Add this test inside the existing top-level `describe` (reuse the file's existing `wrapper`/render helper for `useWorkspace`; add `act`/`renderHook` to the `@testing-library/react` imports if not present):

```tsx
test("exposes budgets and fxRates state", () => {
  const { result } = renderHook(() => useWorkspace(), { wrapper });
  expect(result.current.budgets).toEqual([]);
  expect(result.current.fxRates).toBeNull();
  act(() => result.current.setBudgets([{ id: 1, name: "B", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-06-30", status: "open", allocations: [] }]));
  expect(result.current.budgets).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/workspace-context.test.tsx -t "budgets and fxRates"`
Expected: FAIL — `budgets`/`setBudgets` not on the context.

- [ ] **Step 3: Edit `src/app/workspace-context.tsx`**

Add to the type imports: `type BudgetBucket, type FxRates,`.

Add to `interface WorkspaceValue` (after `setPlan`):

```ts
  budgets: BudgetBucket[];
  setBudgets: Dispatch<SetStateAction<BudgetBucket[]>>;
  fxRates: FxRates | null;
  setFxRates: Dispatch<SetStateAction<FxRates | null>>;
```

Add state in `WorkspaceProvider` (after the `plan` state):

```ts
  const [budgets, setBudgets] = useState<BudgetBucket[]>([]);
  const [fxRates, setFxRates] = useState<FxRates | null>(null);
```

Add to the `value` object (after `setPlan`):

```ts
    budgets, setBudgets,
    fxRates, setFxRates,
```

- [ ] **Step 4: Edit `src/app/workspace-tab-context.tsx`**

Add `"budget"` to the `TopTab` union:

```ts
export type TopTab = "chat" | "reports" | "gantt" | "raid" | "resources" | "activity" | "resource-report" | "address-book" | "budget";
```

- [ ] **Step 5: Edit `src/app/broadcast-sync.ts`**

Open the file and locate (a) the `PopoutTab` union/list and (b) the broadcast channel key union used by `useBroadcastSync`. Add `"budget"` to the `PopoutTab` set exactly the way `"resource-report"` is registered, and add `"budgets"` to the channel-key union exactly the way `"resources"` appears. (The file uses a single source list for popout tabs and a key union for `useBroadcastSync` — mirror each existing entry.)

- [ ] **Step 6: Edit `src/app/use-storage-backend.ts`**

Destructure the new state at the top (in the `useWorkspace()` destructure):

```ts
    budgets, setBudgets,
    fxRates, setFxRates,
```

In the load effect, after `if (workspace.plan) setPlan(workspace.plan);` add:

```ts
        setBudgets(workspace.budgets ?? []);
        setFxRates(workspace.fxRates ?? null);
```

In the debounced save effect, add `budgets`/`fxRates` to BOTH the `backend.save({...})` payload and the effect dependency array. Do the same for the `backend.save({...})` call inside `onPickStorageFile`. The payload object must become:

```ts
{ tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates }
```

Add a broadcast channel for budgets (after the `grades` line):

```ts
  useBroadcastSync("budgets", budgets, setBudgets, canSend);
```

> fxRates is a single small object refreshed on demand; it does not need a broadcast channel.

- [ ] **Step 7: Run tests + build**

Run: `npx vitest run src/app/workspace-context.test.tsx && npm run build`
Expected: PASS + build succeeds (every `backend.save`/`Workspace` literal now includes budgets + fxRates).

- [ ] **Step 8: Commit**

```bash
git add src/app/workspace-context.tsx src/app/workspace-tab-context.tsx src/app/broadcast-sync.ts src/app/use-storage-backend.ts src/app/workspace-context.test.tsx
git commit -m "feat(budget): thread budgets + fxRates through workspace state, tabs, sync"
```

---

### Task 15: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts` (add keys to the `enUS` object)
- Modify: `src/app/i18n.de.ts` (add the same keys, translated)
- Test: `src/app/i18n.test.ts` if present (it may assert EN/DE key parity — run it)

- [ ] **Step 1: Add keys to `enUS` in `src/app/i18n.ts`** (place near the other `tab*` keys)

```ts
  tabBudget: "Budget",
  budgetTitle: "Project Budget",
  budgetAddBucket: "Add bucket",
  budgetBucketName: "Bucket name",
  budgetPoNumber: "PO number",
  budgetType: "Type",
  budgetTypeTm: "Time & Material",
  budgetTypeFixed: "Fixed price",
  budgetCurrency: "Currency",
  budgetFxRate: "Rate (per 1 EUR)",
  budgetFxRefresh: "Refresh ECB rates",
  budgetFixedPrice: "Fixed price amount",
  budgetStart: "Start",
  budgetEnd: "End",
  budgetSuccessor: "Successor bucket",
  budgetClose: "Close bucket",
  budgetReopen: "Reopen bucket",
  budgetRole: "Role",
  budgetResources: "Resources",
  budgetPlanHours: "Plan (h)",
  budgetBudgetHours: "Budget (h)",
  budgetActualHours: "Actual (h)",
  budgetWinLoss: "Win / loss",
  budgetCciMargin: "Contribution margin",
  budgetCciCpi: "Cost performance",
  budgetCciConsumption: "Consumption",
  budgetProjectTotal: "Project total",
  budgetSpilloverIn: "Spilled in",
  budgetEndingSoon: "Budget bucket ending soon",
```

- [ ] **Step 2: Add the same keys (German) to `src/app/i18n.de.ts`**

```ts
  tabBudget: "Budget",
  budgetTitle: "Projektbudget",
  budgetAddBucket: "Bucket hinzufügen",
  budgetBucketName: "Bucket-Name",
  budgetPoNumber: "Bestellnummer",
  budgetType: "Typ",
  budgetTypeTm: "Time & Material",
  budgetTypeFixed: "Festpreis",
  budgetCurrency: "Währung",
  budgetFxRate: "Kurs (pro 1 EUR)",
  budgetFxRefresh: "EZB-Kurse aktualisieren",
  budgetFixedPrice: "Festpreisbetrag",
  budgetStart: "Beginn",
  budgetEnd: "Ende",
  budgetSuccessor: "Nachfolge-Bucket",
  budgetClose: "Bucket schließen",
  budgetReopen: "Bucket öffnen",
  budgetRole: "Rolle",
  budgetResources: "Ressourcen",
  budgetPlanHours: "Plan (Std.)",
  budgetBudgetHours: "Budget (Std.)",
  budgetActualHours: "Ist (Std.)",
  budgetWinLoss: "Gewinn / Verlust",
  budgetCciMargin: "Deckungsbeitrag",
  budgetCciCpi: "Kostenperformance",
  budgetCciConsumption: "Verbrauch",
  budgetProjectTotal: "Projektsumme",
  budgetSpilloverIn: "Übertrag",
  budgetEndingSoon: "Budget-Bucket endet bald",
```

- [ ] **Step 3: Run the i18n parity test (if it exists) + build**

Run: `npx vitest run src/app/i18n.test.ts; npm run build`
Expected: PASS (EN/DE keys match) + build succeeds. If there is no `i18n.test.ts`, the build's type-check still verifies `t()` keys compile.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(budget): EN + DE strings for the budget planner"
```

---

### Task 16: Budget panel — CCI cards + project summary (read-only view)

**Files:**
- Create: `src/app/budget-panel.tsx`
- Test: `src/app/budget-panel.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/budget-panel.test.tsx
import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BudgetPanel } from "./budget-panel";
import type { BudgetBucket, Role, ResourcePlan } from "./types";

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const roles: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
const buckets: BudgetBucket[] = [{
  id: 1, name: "PAM", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-06-30", status: "open",
  allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } }],
}];

const props = {
  lang: "en-US" as const, buckets, roles, disciplines: [], grades: [], resources: [],
  plan, fxRates: null, absences: [], holidaySet: new Set<string>(), workdayHours: 8, today: "2026-02-01",
  onChangeBuckets: vi.fn(), onRefreshFx: vi.fn(),
};

describe("BudgetPanel", () => {
  test("renders the project total contribution margin", () => {
    render(<BudgetPanel {...props} />);
    expect(screen.getByText(/Project total/i)).toBeInTheDocument();
    // margin amount = 80×150 − 80×100 = 4000
    expect(screen.getByText(/4,000|4000/)).toBeInTheDocument();
  });
  test("lists each bucket by name", () => {
    render(<BudgetPanel {...props} />);
    expect(screen.getByText("PAM")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/budget-panel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/app/budget-panel.tsx`**

```tsx
"use client";
import { useMemo } from "react";
import { type Lang, t } from "./i18n";
import { formatCurrency } from "./resource-cost";
import { computeBudgetReport, type BucketReport, type CciValue } from "./budget-report";
import { eurToCurrency, resolveRate } from "./fx";
import type { Absence, BudgetBucket, Discipline, FxRates, Grade, Resource, ResourcePlan, Role } from "./types";

export interface BudgetPanelProps {
  lang: Lang;
  buckets: BudgetBucket[];
  roles: Role[];
  disciplines: Discipline[];
  grades: Grade[];
  resources: Resource[];
  plan: ResourcePlan;
  fxRates: FxRates | null;
  absences: Absence[];
  holidaySet: Set<string>;
  workdayHours: number;
  today: string;
  onChangeBuckets: (next: BudgetBucket[]) => void;
  onRefreshFx: () => void;
}

function localeFor(lang: Lang): string {
  return lang === "de" ? "de-DE" : lang === "en-GB" ? "en-GB" : "en-US";
}

function Cci({ label, value, currency, locale }: { label: string; value: CciValue; currency: string; locale: string }) {
  const pct = value.percent == null ? "—" : `${value.percent.toFixed(1)}%`;
  const tone = value.amount >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-AIPM-pink";
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-lg font-semibold ${tone}`}>{formatCurrency(value.amount, currency, locale)}</div>
      <div className="text-xs text-zinc-500">{pct}</div>
    </div>
  );
}

export function BudgetPanel(props: BudgetPanelProps) {
  const { lang, buckets, roles, resources, plan, fxRates, absences, holidaySet, workdayHours } = props;
  const locale = localeFor(lang);

  const report = useMemo(
    () => computeBudgetReport(buckets, plan, roles, resources, workdayHours, holidaySet, absences),
    [buckets, plan, roles, resources, workdayHours, holidaySet, absences],
  );

  const bucketById = useMemo(() => new Map(buckets.map((b) => [b.id, b])), [buckets]);
  const projCur = plan.currency || "EUR"; // project rollup is in the plan base currency (EUR)

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "budgetTitle")} — {t(lang, "budgetProjectTotal")}
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <Cci label={t(lang, "budgetCciMargin")} value={report.project.contributionMargin} currency={projCur} locale={locale} />
          <Cci label={t(lang, "budgetCciCpi")} value={report.project.costPerformance} currency={projCur} locale={locale} />
          <Cci label={t(lang, "budgetCciConsumption")} value={report.project.consumption} currency={projCur} locale={locale} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        {report.buckets.map((br: BucketReport) => {
          const bucket = bucketById.get(br.bucketId)!;
          const rate = resolveRate(bucket, fxRates);
          const inCur = (eur: number) => formatCurrency(eurToCurrency(eur, bucket, fxRates), bucket.currency, locale);
          // CCI amounts are EUR from the engine — convert to the bucket currency for display.
          const cci = (v: CciValue): CciValue => ({ amount: eurToCurrency(v.amount, bucket, fxRates), percent: v.percent });
          return (
            <div key={br.bucketId} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="mb-2 flex items-center justify-between">
                <div className="font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
                  {br.name}{bucket.poNumber ? ` · ${bucket.poNumber}` : ""}
                </div>
                <div className="text-xs text-zinc-500">
                  {t(lang, br.type === "fixed" ? "budgetTypeFixed" : "budgetTypeTm")} · {bucket.currency}
                  {rate !== 1 ? ` (×${rate})` : ""}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-sm">
                <div><div className="text-xs text-zinc-500">{t(lang, "budgetBudgetHours")}</div>{br.budgetHours.toFixed(0)}</div>
                <div><div className="text-xs text-zinc-500">{t(lang, "budgetPlanHours")}</div>{br.plannedHours.toFixed(0)}</div>
                <div><div className="text-xs text-zinc-500">{t(lang, "budgetActualHours")}</div>{br.actualHours.toFixed(0)}</div>
                <div><div className="text-xs text-zinc-500">{t(lang, "budgetWinLoss")}</div>{inCur(br.winLossValue)}</div>
              </div>
              {br.spilloverInHours !== 0 && (
                <div className="mt-1 text-xs text-zinc-500">
                  {t(lang, "budgetSpilloverIn")}: {br.spilloverInHours.toFixed(0)} h · {inCur(br.spilloverInValue)}
                </div>
              )}
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Cci label={t(lang, "budgetCciMargin")} value={cci(br.contributionMargin)} currency={bucket.currency} locale={locale} />
                <Cci label={t(lang, "budgetCciCpi")} value={cci(br.costPerformance)} currency={bucket.currency} locale={locale} />
                <Cci label={t(lang, "budgetCciConsumption")} value={cci(br.consumption)} currency={bucket.currency} locale={locale} />
              </div>
            </div>
          );
        })}
        {report.buckets.length === 0 && (
          <p className="text-sm text-zinc-500">{t(lang, "budgetAddBucket")}…</p>
        )}
      </section>
    </div>
  );
}
```

> The CCI cards convert per-bucket amounts to the bucket currency; the project total uses the EUR-based rollup. Editing controls are added in Task 17 so this task stays a bite-sized, testable read-only render.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/budget-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/budget-panel.tsx src/app/budget-panel.test.tsx
git commit -m "feat(budget): budget panel — CCI cards + per-bucket summary"
```

---

### Task 17: Budget panel — bucket editor + allocation grid (editing)

**Files:**
- Modify: `src/app/budget-panel.tsx` (add an "Add bucket" control, close/reopen, and an editable budget/actual grid)
- Test: `src/app/budget-panel-edit.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/budget-panel-edit.test.tsx
import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BudgetPanel } from "./budget-panel";
import type { BudgetBucket, Role, ResourcePlan } from "./types";

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const roles: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];

function props(buckets: BudgetBucket[], onChangeBuckets = vi.fn()) {
  return {
    lang: "en-US" as const, buckets, roles, disciplines: [{ id: 1, name: "Consulting" }], grades: [{ id: 1, name: "Senior" }],
    resources: [], plan, fxRates: null, absences: [], holidaySet: new Set<string>(), workdayHours: 8, today: "2026-02-01",
    onChangeBuckets, onRefreshFx: vi.fn(),
  };
}

describe("BudgetPanel editing", () => {
  test("Add bucket calls onChangeBuckets with a new bucket", async () => {
    const onChange = vi.fn();
    render(<BudgetPanel {...props([], onChange)} />);
    await userEvent.click(screen.getByRole("button", { name: /Add bucket/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as BudgetBucket[];
    expect(next).toHaveLength(1);
    expect(next[0].status).toBe("open");
  });

  test("editing an actual-hours cell emits an updated bucket", async () => {
    const onChange = vi.fn();
    const buckets: BudgetBucket[] = [{
      id: 1, name: "PAM", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } }],
    }];
    render(<BudgetPanel {...props(buckets, onChange)} />);
    const cell = screen.getByLabelText("actual-1-3-2026-01");
    await userEvent.clear(cell);
    await userEvent.type(cell, "90");
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0] as BudgetBucket[];
    expect(last[0].allocations[0].actualHours["2026-01"]).toBe(90);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/budget-panel-edit.test.tsx`
Expected: FAIL — no "Add bucket" button / no editable cells.

- [ ] **Step 3: Edit `src/app/budget-panel.tsx`**

Add these imports (extend the existing import lines):

```tsx
import { bucketActivePeriods } from "./budget-report";
import { roleLabel } from "./resource-foundation";
```

Add helpers above the component:

```tsx
function nextBucketId(buckets: readonly BudgetBucket[]): number {
  return buckets.reduce((m, b) => Math.max(m, b.id), 0) + 1;
}

function blankBucket(id: number, plan: ResourcePlan): BudgetBucket {
  return {
    id, name: `Bucket ${id}`, type: "tm", currency: "EUR",
    startDate: plan.startDate, endDate: plan.endDate, status: "open", allocations: [],
  };
}
```

Inside the component, after computing `report`, add immutable update helpers:

```tsx
  const stamp = () => new Date().toISOString();

  const addBucket = () => {
    props.onChangeBuckets([...buckets, blankBucket(nextBucketId(buckets), plan)]);
  };

  const updateBucket = (id: number, patch: Partial<BudgetBucket>) => {
    props.onChangeBuckets(buckets.map((b) => (b.id === id ? { ...b, ...patch, localModifiedAt: stamp() } : b)));
  };

  const setCell = (
    bucketId: number, roleId: number, periodKey: string,
    field: "budgetHours" | "actualHours", value: number,
  ) => {
    props.onChangeBuckets(
      buckets.map((b) => {
        if (b.id !== bucketId) return b;
        const allocations = b.allocations.map((a) =>
          a.roleId === roleId ? { ...a, [field]: { ...a[field], [periodKey]: value } } : a,
        );
        return { ...b, allocations, localModifiedAt: stamp() };
      }),
    );
  };
```

Add an "Add bucket" / "Refresh ECB rates" bar as the first child of the outer `<div className="flex flex-col gap-6">` (above the project-total `<section>`):

```tsx
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={addBucket}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-AIPM-dark-blue shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
        >
          {t(lang, "budgetAddBucket")}
        </button>
        <button
          type="button"
          onClick={props.onRefreshFx}
          className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey"
        >
          {t(lang, "budgetFxRefresh")}
        </button>
      </div>
```

Inside the per-bucket `<div>`, after the CCI cards grid, add the editable allocation grid and the close/reopen button:

```tsx
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-zinc-500">
                      <th className="px-2 py-1 text-left">{t(lang, "budgetRole")}</th>
                      {bucketActivePeriods(bucket, plan).map((p) => (
                        <th key={p.key} className="px-2 py-1 text-right">{p.key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bucket.allocations.map((a) => (
                      <tr key={a.roleId} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="px-2 py-1">{roleLabel(roles.find((r) => r.id === a.roleId), props.disciplines, props.grades) || `#${a.roleId}`}</td>
                        {bucketActivePeriods(bucket, plan).map((p) => (
                          <td key={p.key} className="px-1 py-1">
                            <div className="flex flex-col gap-0.5">
                              <input
                                aria-label={`budget-${bucket.id}-${a.roleId}-${p.key}`}
                                type="number"
                                value={a.budgetHours[p.key] ?? ""}
                                onChange={(e) => setCell(bucket.id, a.roleId, p.key, "budgetHours", Number(e.target.value) || 0)}
                                className="w-16 rounded border border-zinc-200 bg-white px-1 text-right dark:border-zinc-700 dark:bg-zinc-900"
                              />
                              <input
                                aria-label={`actual-${bucket.id}-${a.roleId}-${p.key}`}
                                type="number"
                                value={a.actualHours[p.key] ?? ""}
                                onChange={(e) => setCell(bucket.id, a.roleId, p.key, "actualHours", Number(e.target.value) || 0)}
                                className="w-16 rounded border border-zinc-200 bg-zinc-50 px-1 text-right dark:border-zinc-700 dark:bg-zinc-800"
                              />
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={() => updateBucket(bucket.id, bucket.status === "open"
                  ? { status: "closed", closedDate: props.today }
                  : { status: "open", closedDate: undefined })}
                className="mt-2 text-xs text-zinc-500 hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey"
              >
                {t(lang, bucket.status === "open" ? "budgetClose" : "budgetReopen")}
              </button>
```

> The successor picker, currency/type selectors, and role-line "add" control are small follow-ups using `updateBucket(...)`; this task's test only requires Add-bucket + editable cells + close/reopen. Add the remaining selectors as plain `<select>`/`<input>` bound to `updateBucket` if time allows — they are not required for the test to pass.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/budget-panel-edit.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/budget-panel.tsx src/app/budget-panel-edit.test.tsx
git commit -m "feat(budget): bucket editor + editable budget/actual allocation grid"
```

---

### Task 18: Mount the budget tab + panel; wire FX refresh

**Files:**
- Modify: `src/app/workspace-section.tsx` (dynamic import, tab button, tabpanel; props)
- Modify: `src/app/task-manager.tsx` (pass `onChangeBudgets` + `onRefreshFx`)
- Test: `src/app/workspace-section.test.tsx` (extend to assert the Budget tab renders)

- [ ] **Step 1: Add a failing assertion to `src/app/workspace-section.test.tsx`**

Add within the existing render-based describe (reuse the file's existing render helper/props):

```tsx
test("renders the Budget tab button", () => {
  renderWorkspaceSection(); // use the helper already defined in this file
  expect(screen.getByRole("tab", { name: /Budget/i })).toBeInTheDocument();
});
```

> If the file builds props inline rather than via a helper, mirror that pattern. The assertion only needs the tablist to include a Budget tab.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/workspace-section.test.tsx -t "Budget tab"`
Expected: FAIL — no Budget tab.

- [ ] **Step 3: Edit `src/app/workspace-section.tsx`**

Add the dynamic import (next to `ResourcesReportPanel`):

```tsx
const BudgetPanel = dynamic(
  () => import("./budget-panel").then((m) => m.BudgetPanel),
  { ssr: false },
);
```

Add `budgets`, `fxRates` to the `useWorkspace()` destructure (~line 118).

Add to `WorkspaceSectionProps`:

```ts
  onChangeBudgets: (next: import("./types").BudgetBucket[]) => void;
  onRefreshFx: () => void;
```

…and destructure them in the component signature.

Add a tab button (after the `activity` `TabButton`, before the reset-size button):

```tsx
          <TabButton
            active={activeTab === "budget"}
            onClick={() => {
              setActiveTab("budget");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-budget"
            onPopout={() => openPopoutWindow("budget", settings.popout.reuseWindow)}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabBudget")}
          </TabButton>
```

Add the tabpanel (after the `resource-report` panel block):

```tsx
        {activeTab === "budget" && (
          <div id="panel-budget" role="tabpanel" className="min-h-0 flex-1 overflow-y-auto pt-4">
            <BudgetPanel
              lang={lang}
              buckets={budgets}
              roles={roles}
              disciplines={disciplines}
              grades={grades}
              resources={resources}
              plan={plan}
              fxRates={fxRates}
              absences={absences}
              holidaySet={holidaySet}
              workdayHours={settings.resources.workdayHours}
              today={today}
              onChangeBudgets={onChangeBudgets}
              onRefreshFx={onRefreshFx}
            />
          </div>
        )}
```

- [ ] **Step 4: Edit `src/app/task-manager.tsx`** (the component that renders `<WorkspaceSection>`)

Pull `setBudgets`, `setFxRates` from `useWorkspace()` and add handlers (mirror how `resources`/`setResources` are threaded). Add imports `import { useFxRates } from "./use-fx-rates";`, `import type { BudgetBucket } from "./types";`, and `useCallback` if not already imported. Add:

```tsx
  const handleChangeBudgets = useCallback((next: BudgetBucket[]) => setBudgets(next), [setBudgets]);
  const { refresh: refreshFx } = useFxRates(useCallback((fx) => setFxRates(fx), [setFxRates]));
```

Pass to `<WorkspaceSection ... onChangeBudgets={handleChangeBudgets} onRefreshFx={refreshFx} />`.

> Locate the exact `<WorkspaceSection .../>` usage and `useWorkspace()` destructure in `task-manager.tsx`; add the two props + two setters.

- [ ] **Step 5: Run tests + build**

Run: `npx vitest run src/app/workspace-section.test.tsx && npm run build`
Expected: PASS + build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/workspace-section.tsx src/app/task-manager.tsx src/app/workspace-section.test.tsx
git commit -m "feat(budget): mount Budget tab + panel, wire FX refresh"
```

---

### Task 19: Surface bucket reminders as a toast

**Files:**
- Modify: `src/app/task-manager.tsx` (compute `getBucketReminders` and toast when buckets are ending soon)
- Test: covered by `budget-reminders.test.ts` (logic); integration glue verified by build.

- [ ] **Step 1: Edit `src/app/task-manager.tsx`**

Near where due alerts / toasts are computed, add (use the project's existing reminder-lead-days setting — search the file for the value passed to `getAlertableTasks` and reuse it; the literal `14` below is a fallback):

```tsx
  const bucketReminders = useMemo(
    () => getBucketReminders(budgets, reminderLeadDays ?? 14, today),
    [budgets, reminderLeadDays, today],
  );

  useEffect(() => {
    if (bucketReminders.length > 0) {
      showToast("info", `${bucketReminders.length} ${t(lang, "budgetEndingSoon")}`);
    }
    // Fire when the set of ending-soon bucket ids changes (keeps the toast non-spammy).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucketReminders.map((r) => r.bucket.id).join(",")]);
```

Add import: `import { getBucketReminders } from "./budget-report";`. Reuse the existing `reminderLeadDays`/`showToast`/`lang`/`today` already present in this component (mirror the task due-alert wiring).

- [ ] **Step 2: Build + run the budget reminder test**

Run: `npx vitest run src/app/budget-reminders.test.ts && npm run build`
Expected: PASS + build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "feat(budget): toast when budget buckets are ending soon"
```

---

### Task 20: Include budgets + fx rates in manual exports

**Files:**
- Modify: `src/app/export.ts` and `src/app/export-menu.tsx` (carry budgets/fxRates into the exported workspace object)
- Modify: `src/app/app-header.tsx` (pass `budgets`/`fxRates` to `<ExportMenu>`)
- Test: `src/app/export.test.ts` if present — otherwise verified by build.

- [ ] **Step 1: Inspect `src/app/export.ts` / `export-menu.tsx`**

Find how the export builds the object passed to `workspaceToCsv`/`workspaceToMarkdown`/`workspaceToJson`. The encoders already include budgets + fxRates (Tasks 4–6), so the only change is making sure the object handed to them carries `budgets` and `fxRates`.

- [ ] **Step 2: Edit `ExportMenu` props + `app-header.tsx`**

Add `budgets: BudgetBucket[]` and `fxRates: FxRates | null` to `ExportMenuProps`; thread them into whatever workspace object the export builds (default `budgets: []`, `fxRates: null` is fine for older call sites). Add imports `import type { BudgetBucket, FxRates } from "./types";` where needed. In `app-header.tsx`, add `budgets`, `fxRates` to the `useWorkspace()` destructure (line ~49) and pass them:

```tsx
<ExportMenu lang={lang} tasks={tasks} raid={raid} absences={absences} shifts={shifts} resources={resources} roles={roles} disciplines={disciplines} grades={grades} plan={plan} budgets={budgets} fxRates={fxRates} />
```

- [ ] **Step 3: Build + run any export test**

Run: `npx vitest run src/app/export.test.ts; npm run build`
Expected: PASS / build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/export.ts src/app/export-menu.tsx src/app/app-header.tsx
git commit -m "feat(budget): include budgets + fx rates in manual exports"
```

---

### Task 21: Full verification + docs/version

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `README.md` (+ DE), `docs/CODEMAPS/*` per repo convention.

- [ ] **Step 1: Run the entire test suite with coverage**

Run: `npm run test:coverage`
Expected: All tests PASS; coverage ≥ 80% (the new modules are well covered by Tasks 1–17).

- [ ] **Step 2: Lint + production build**

Run: `npm run lint && npm run build`
Expected: No lint errors; build succeeds (includes the `prebuild` docs-sync check).

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`, open the app, click the **Budget** tab. Add a bucket, enter budget/actual hours, switch currency, click **Refresh ECB rates**, set a manual rate override (confirm it leads; clear it to fall back to the cached rate), close a bucket with a successor and confirm the successor shows "Spilled in". Reload to confirm persistence.

- [ ] **Step 4: Update version + changelog + codemaps**

Bump `src/app/version.ts`, add a `CHANGELOG.md` entry describing the budget planner, update README (EN + DE) feature list, and regenerate codemaps if the repo provides a script (`docs/CODEMAPS/*`). Follow the format of the most recent release entry.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(budget): changelog, version, README, codemaps for budget planner"
```

---

## Notes for the implementer

- **All engine money is EUR.** `budget-report.ts` never touches FX. Display conversion happens only in `budget-panel.tsx` via `fx.ts`. The project rollup is intentionally EUR (the plan base currency).
- **Spillover is computed, not stored.** Closing a bucket only flips `status`/`closedDate`; the successor's "spilled in" amount is recomputed every render, so reopening reverses it automatically. Spillover is a single hop (closed → successor), not transitive.
- **Immutability:** every bucket edit returns new arrays/objects (the IndexedDB diff relies on reference identity to decide what to write).
- **`coercePeriodMap` clamps to `HOURS_MAP_MAX` (1000) per period** — fine for hours. Do not reuse it for amounts.
- When a referenced symbol (e.g. a settings key like `reminderLeadDays`) differs from what's shown, search the file for the existing analogous usage (resources/roles/task-alerts) and mirror it exactly rather than inventing a new name.
