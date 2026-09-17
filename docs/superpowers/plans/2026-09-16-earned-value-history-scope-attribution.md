# Earned-Value History and Scope Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give hand-entered buckets an earned-value history, split variance at completion into performance, attributed scope and unattributed change, and remove the dead snapshot currency field.

**Architecture:**
- **Stage 1 (Tasks 1–7)** is storage and one correctness fix:
  - earned-value history moves to the own basis;
  - buckets get a creation date;
  - a pure `budget-history.ts` module owns an append-only budget-at-completion series, persisted as a meta-blob slice on all six write paths and written from the single budget commit boundary;
  - snapshots record per-bucket percent complete;
  - `SnapshotRecord.currency` is deleted.
- **Stage 2 (Tasks 8–12)** is surfaces:
  - `computeEvHistory` implements rule 1A′ from snapshot records;
  - the chart draws partial spans, join labels, budget steps and markers;
  - both forecast cards show the three-part split.

**Tech Stack:** Next.js / React 19 / TypeScript, vitest + Testing Library, fast-check, `node:sqlite` execute tests, custom SVG chart.

**Spec:** `docs/superpowers/specs/2026-09-16-earned-value-history-scope-attribution-design.md`

## Global Constraints

- Every task ends with `npx tsc --noEmit` EXIT=0 and `npx eslint --max-warnings=0 <touched files>` EXIT=0.
- Read an exit code only unpiped: `cmd > log 2>&1; echo "EXIT=$?"`. Never through `| tail` or `| grep`.
- Vitest runs one process at a time, always with `--maxWorkers=1`. Run only the tests the task names. The full suite and `npm run test:shuffle` run once, in Task 13.
- `i18n.ts` (EN) and `i18n.de.ts` (DE) keep identical key sets (tsc enforces this).
  - Edit `i18n.de.ts` ONLY through a Node UTF-8 script whose anchors use `\r\n`. The file is CRLF.
  - DE text uses real umlauts.
  - A test asserting DE output calls `loadI18n("de")` first.
- `Lang` is `"en-US" | "en-GB" | "de"`. Tests use `"en-US"`.
- `src/app/*.ts(x)` files are CRLF in the working tree. Never use `sed -i` on them. After any scripted edit, check with `git ls-files --eol <file>`; it must show `w/crlf`.
- No hand-rolled UI controls: use `ToggleButton`, `SegmentedControl`, `InfoTooltip`, `Badge`, `Banner`, `Button` and `<details>`.
- Palette tokens only. The chart uses existing `--rag-*` / `--ui-*` tokens.
- Colour is never the only cue. Partial spans carry a dash pattern AND a text label.
- Money on these surfaces is EUR by construction (§465). No stored currency anywhere new.
- `budgetHistory` values are EUR. Its basis is the project **own** basis, i.e. `report.project.budgetHours` / `report.project.budgetValue`, which since 1.7.1 already sum `ownBudget`.
- Commits:
  - conventional type prefix;
  - no `#`+digits in the message;
  - `§NNN` allowed;
  - trailer `Claude-Session: https://[session link removed]`;
  - never `--amend`;
  - never `git add -A` / `git add .`: stage explicit paths.
- Never stage or open `sample-workspace-huge.json` or `not-in-use.env.local.bak`.
- A mutation proof means:
  1. apply the named mutant;
  2. run the named test and see it fail;
  3. revert the mutant;
  4. show `git diff --stat` has no residue.

  Report `N/N mutants killed`.
- Before any edit, grep repo-wide for tests your change invalidates. Label each hit DELETE, MIGRATE or RECOMPUTE in the task report.

## Rulings made while planning (spec is the authority; these fill gaps it left)

- **R1 — single baseline writer.** Spec §4.3 asks for one writer. The writer is the budget commit boundary: the first recorded change seeds a `baseline` entry from the BAC *before* that change. Before any budget change, the cards show the "no history yet" note. A render-time baseline write was rejected: it would be a write during render, and forecasts are also computed in read-only popouts.
- **R2 — undo and version restore do not write entries.** Neither passes through `commitBuckets`. Their BAC movement lands in **unattributed**, which is what that component exists for. This replaces spec §6's "Undo … a new entry" row; Task 13 amends the spec to match.
- **R3 — a linked-task bucket whose links resolve to no tasks** is treated like an unrecorded manual bucket: partial while active. `available: false` is kept only when every budgeted bucket is partial at every point (`reason: "no-earned-value"`). The old `"manual-percent"` and `"no-linked-tasks"` reasons are removed.
- **R4 — the table beside the chart.** No table exists today, and per-period performance needs per-period EAC, which is not recorded. The new table lists each recorded change (date, bucket, signed amount, cumulative attributed scope), with a summary of performance, attributed and unattributed as of today. This is recorded as a deviation from the spec §5.3 wording.
- **R5 — bucket creators.** `blankBucket` in `budget-panel.tsx` is the only non-test site that builds a bucket from scratch; the survey confirmed no AI tool, template literal, wizard or duplicate action does. Template seeds and imports flow through `sanitizeLoaded*BudgetBucket`, which keeps whatever `createdDate` they carry, so no extra writer is needed.
- **R6 — `budgetHistory` is storage-only.** It is not an export key, and not in `applyRestoredWorkspace` or the version payload, mirroring `activityLog`. It IS in `useBroadcastSync`, because the autosave writes the whole workspace.

---

# Stage 1 — storage foundations

### Task 1: Earned-value history on the own basis (live 1.7.1 defect)

**Why:** `computeEvHistory` multiplies by `br.budgetValue` / `br.budgetHours`, the reported spillover-inclusive twins. `budget-forecast.ts` and the chart's today diamond (`burndown-geometry.ts`, `forecast.facts.ev`) use `br.ownBudget.*` since 1.7.1. With a closed donor bucket, the history line therefore ends away from the diamond.

**Files:**
- Modify: `src/app/budget-ev-history.ts` (the `linked.push` line and the `br.budgetValue > 0` gate)
- Test: `src/app/budget-ev-history.test.ts`

**Interfaces:** Produces no new names. `EvHistoryPoint` is unchanged.

- [ ] **Step 1: Measure before changing.** Add a test with a spillover fixture. Reuse the §550 fixture shape from `src/app/budget-report.test.ts`; grep `spilloverIn` there to find it. Set it up as:
  - donor bucket closed with `successorId`, both buckets linked to tasks, every task Done;
  - `dates` = `[today]`.

  Assert that the last point's `eur` equals `computeBudgetForecastsByUnit(...).eur.facts.ev`, and the same for `hours`:

```ts
it("ends on the same own-basis earned value the forecast reports (§550 re-basing)", () => {
  const { report, buckets, tasks, forecastInput } = spilloverFixture(); // build from the §550 fixture
  const h = computeEvHistory({ report, buckets, tasks, dates: [TODAY], today: TODAY });
  if (!h.available) throw new Error("expected available");
  const f = computeBudgetForecastsByUnit(forecastInput);
  expect(h.points.at(-1)!.eur).toBeCloseTo(f.eur.facts.ev!, 6);
  expect(h.points.at(-1)!.hours).toBeCloseTo(f.hours.facts.ev!, 6);
});
```

- [ ] **Step 2: Run it and record the failing numbers in the report.**
  - Run: `npx vitest run src/app/budget-ev-history.test.ts --maxWorkers=1 > /tmp/t1.log 2>&1; echo "EXIT=$?"`
  - Expected: EXIT=1, with the line's `eur` greater than the forecast's `ev`.
- [ ] **Step 3: Fix.** In `computeEvHistory`, change the gate to `if (!br || !(br.ownBudget.budgetValue > 0)) continue;` and the push to `linked.push({ bucket, eur: br.ownBudget.budgetValue, hours: br.ownBudget.budgetHours, resolved });`. Add a one-line comment: `// Own basis, matching budget-forecast.ts since §550 — the reported twins double-count spilled-in budget.`
- [ ] **Step 4: Run it again.** Expected: EXIT=0. Also run `src/app/budget-forecast-bundle.test.ts` and `src/app/burndown-geometry.test.ts`. RECOMPUTE any expectation that moved and state why in the report.
- [ ] **Step 5: Mutation proof.** Mutant: revert the `eur:` field to `br.budgetValue`. The Step 1 test must fail. Revert the mutant.
- [ ] **Step 6: Commit** `fix(forecast): draw earned-value history on the own basis the forecast uses`, staging the two files.

### Task 2: Bucket creation date

**Files:**
- Modify: `src/app/types.ts` (`BudgetBucket`: add `createdDate?: string; // YYYY-MM-DD, the day the bucket was created here; absent = unknown` directly after `closedDate?`)
- Modify: `src/app/csv-codecs-core.ts`
  - `BUDGETS_CSV_COLUMNS`: insert `"createdDate"` directly after `"closedDate"`;
  - `budgetFieldToString`: add `case "createdDate": return b.createdDate ?? "";`.
- Modify: `src/app/markdown-columns.ts` (`BUDGETS_MD_COLUMNS`: add `{ col: "createdDate", label: "Created" }` after the Closed entry)
- Modify: `src/app/markdown-codecs-decode.ts` (`BUDGET_ALIASES`: add `created: "createdDate", createddate: "createdDate"`)
- Modify: `src/app/sanitize-entities.ts` (`budgetWithDateReader`)
- Modify: `src/app/budget-panel.tsx` (`blankBucket`, and its call in `addBucket`)
- Modify: `src/app/__fixtures__/golden-workspace.csv`, `src/app/__fixtures__/golden-workspace.md` (regenerated)
- Test: `src/app/sanitize-budget.test.ts`, `src/app/storage-budget-csv.test.ts`, `src/app/turso-schema.test.ts`, `src/app/budget-panel.test.tsx`

**Interfaces:** Produces `BudgetBucket.createdDate?: string`, consumed by Task 9.

- [ ] **Step 1: Failing tests.**
  - In `sanitize-budget.test.ts`, add:

```ts
it("keeps a valid createdDate and drops an invalid one, on every status", () => {
  const base = { id: 7, name: "B", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open", allocations: [] };
  expect(sanitizeLoadedBudgetBucket({ ...base, createdDate: "2026-07-01" })?.createdDate).toBe("2026-07-01");
  expect(sanitizeLoadedBudgetBucket({ ...base, createdDate: "2026-02-30" })?.createdDate).toBeUndefined();
  expect(sanitizeLoadedBudgetBucket({ ...base, createdDate: "" })).not.toHaveProperty("createdDate");
  expect(sanitizeLoadedBudgetBucket({ ...base, status: "closed", closedDate: "2026-08-01", createdDate: "2026-07-01" })?.createdDate).toBe("2026-07-01");
});
```

  - In `turso-schema.test.ts`'s "budget columns are in the CSV column registry" test, add `"createdDate"` to the `toContain` list.
  - In `storage-budget-csv.test.ts`, round-trip a bucket with `createdDate: "2026-07-01"` through CSV and through Markdown (use the encode/decode pair that file already uses), and assert the field survives both.
  - In `budget-panel.test.tsx`, clicking the add-bucket button calls `onChangeBuckets` with a new bucket whose `createdDate` equals the `today` prop. A second test: editing an existing bucket passes it through with its `createdDate` unchanged (`"2026-01-05"` stays `"2026-01-05"`).
- [ ] **Step 2: Run them.** Expected: FAIL.
  - Run: `npx vitest run src/app/sanitize-budget.test.ts src/app/storage-budget-csv.test.ts src/app/turso-schema.test.ts src/app/budget-panel.test.tsx --maxWorkers=1 > /tmp/t2.log 2>&1; echo "EXIT=$?"`
- [ ] **Step 3: Implement.** In `budgetWithDateReader`, directly after the `if (status === "closed") {…}` block, add:

```ts
  const created = readOptional(input.createdDate, "budget", id, "createdDate");
  if (created) bucket.createdDate = created;
```

  Change `blankBucket` to `function blankBucket(id: number, plan: ResourcePlan, today: string): BudgetBucket` and add `createdDate: today` to the literal. Pass `props.today` at its call in `addBucket`. Apply the codec, column and alias edits listed under Files.
- [ ] **Step 4: Run Step 2 again.** Expected: EXIT=0.
- [ ] **Step 5: Regenerate the golden fixtures** (a legitimate new-column format change, per AGENTS.md "New COLUMN on existing entity").
  - Run `npx vitest run src/app/golden-workspace.test.ts --maxWorkers=1`. It is expected to fail with only the budget header and row changes.
  - Write a throwaway script in the scratchpad. It reads `sample-workspace-small.json`, decodes it with `jsonToWorkspace` (this needs a DOM, so run it as a vitest file with `// @vitest-environment jsdom`), encodes it with the same encoders `golden-workspace.test.ts` calls, and writes both fixture files byte-exactly.
  - Diff them with `git diff --stat src/app/__fixtures__`. Expected: only the budgets section changes, with one new header cell and one empty cell per budget row.
  - Paste the fixture diff into the report. Delete the throwaway script.
  - Re-run `golden-workspace.test.ts`. Expected: EXIT=0.
- [ ] **Step 6: Mutation proof** (2 mutants):
  - (a) delete the `createdDate` line in `budgetFieldToString`: the CSV round-trip test fails;
  - (b) drop `createdDate: today` from `blankBucket`: the panel test fails.
- [ ] **Step 7: Commit** `feat(budget): record the date a bucket was created`.

### Task 3: `budget-history.ts` — pure series engine

**Files:**
- Create: `src/app/budget-history.ts`
- Test: `src/app/budget-history.test.ts`, `src/app/budget-history.property.test.ts`

**Interfaces — Produces:**

```ts
export type BudgetHistoryKind = "baseline" | "created" | "updated" | "deleted";
export type BudgetHistoryEntry = {
  id: string; at: string; date: string; kind: BudgetHistoryKind;
  bucketId: number | null; bucketName: string;
  projectBacHours: number; projectBacValue: number;
  deltaHours: number; deltaValue: number;
};
export type ProjectBac = { hours: number; value: number };
export type BudgetChange = {
  kind: Exclude<BudgetHistoryKind, "baseline">; bucketId: number; bucketName: string;
  before: ProjectBac; after: ProjectBac; at: string; date: string; newId: () => string;
};
export const BAC_EPSILON = 1e-6;
export function sanitizeBudgetHistory(input: unknown): BudgetHistoryEntry[];
export function recordBudgetChange(history: readonly BudgetHistoryEntry[], change: BudgetChange): readonly BudgetHistoryEntry[];
export type BudgetHistorySummary = {
  baselineDate: string; baseline: ProjectBac; attributed: ProjectBac;
  changes: readonly BudgetHistoryEntry[]; // created/updated/deleted after the baseline, in order
};
export function summarizeBudgetHistory(history: readonly BudgetHistoryEntry[]): BudgetHistorySummary | null;
export type VarianceSplit = { vac: number; performance: number; attributed: number; unattributed: number };
export function splitVariance(baseline: number, attributed: number, bac: number, eac: number): VarianceSplit;
```

- [ ] **Step 1: Failing unit tests** (`budget-history.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { recordBudgetChange, sanitizeBudgetHistory, splitVariance, summarizeBudgetHistory, type BudgetChange } from "./budget-history";

let n = 0;
const change = (over: Partial<BudgetChange>): BudgetChange => ({
  kind: "updated", bucketId: 1, bucketName: "Build",
  before: { hours: 100, value: 10000 }, after: { hours: 150, value: 15000 },
  at: "2026-09-16T10:00:00.000Z", date: "2026-09-16", newId: () => `id-${++n}`, ...over,
});

describe("recordBudgetChange", () => {
  it("seeds a baseline from the BAC before the first change, then records the change", () => {
    const h = recordBudgetChange([], change({}));
    expect(h.map((e) => e.kind)).toEqual(["baseline", "updated"]);
    expect(h[0]).toMatchObject({ bucketId: null, projectBacHours: 100, projectBacValue: 10000, deltaHours: 0, deltaValue: 0 });
    expect(h[1]).toMatchObject({ bucketId: 1, bucketName: "Build", projectBacHours: 150, deltaHours: 50, deltaValue: 5000 });
  });
  it("writes nothing when BAC did not move (rename, non-budget edit)", () => {
    const prev = recordBudgetChange([], change({}));
    const same = recordBudgetChange(prev, change({ before: { hours: 150, value: 15000 }, after: { hours: 150, value: 15000 } }));
    expect(same).toBe(prev);
  });
  it("writes nothing and seeds nothing on an empty history when BAC did not move", () => {
    const none = recordBudgetChange([], change({ after: { hours: 100, value: 10000 } }));
    expect(none).toEqual([]);
  });
  it("records a deletion as a negative delta keeping the name", () => {
    const h = recordBudgetChange([], change({ kind: "deleted", bucketName: "Vendor", after: { hours: 60, value: 6000 } }));
    expect(h[1]).toMatchObject({ kind: "deleted", bucketName: "Vendor", deltaHours: -40, deltaValue: -4000 });
  });
  it("never mutates its input", () => {
    const prev = Object.freeze(recordBudgetChange([], change({})));
    expect(() => recordBudgetChange(prev, change({ before: { hours: 150, value: 15000 }, after: { hours: 170, value: 17000 } }))).not.toThrow();
  });
});

describe("summarizeBudgetHistory", () => {
  it("is null without a baseline", () => { expect(summarizeBudgetHistory([])).toBeNull(); });
  it("sums attributed deltas after the baseline", () => {
    let h = recordBudgetChange([], change({}));
    h = recordBudgetChange(h, change({ before: { hours: 150, value: 15000 }, after: { hours: 130, value: 13000 } }));
    const s = summarizeBudgetHistory(h)!;
    expect(s.baselineDate).toBe("2026-09-16");
    expect(s.baseline).toEqual({ hours: 100, value: 10000 });
    expect(s.attributed).toEqual({ hours: 30, value: 3000 });
    expect(s.changes).toHaveLength(2);
  });
});

describe("splitVariance", () => {
  it("matches the approved mockup: baseline 1200, +500 scope, BAC 1700, EAC 1440", () => {
    expect(splitVariance(1200, 500, 1700, 1440)).toEqual({ vac: 260, performance: -240, attributed: 500, unattributed: 0 });
  });
  it("puts BAC movement nobody recorded into unattributed", () => {
    expect(splitVariance(1200, 500, 1760, 1440)).toEqual({ vac: 320, performance: -240, attributed: 500, unattributed: 60 });
  });
});

describe("sanitizeBudgetHistory", () => {
  it("drops malformed entries and non-arrays", () => {
    expect(sanitizeBudgetHistory("x")).toEqual([]);
    const good = recordBudgetChange([], change({}));
    expect(sanitizeBudgetHistory([...good, { id: 5 }, null, { ...good[1], kind: "bogus" }, { ...good[1], date: "2026-13-01" }])).toEqual(good);
  });
});
```

- [ ] **Step 2: Property test** (`budget-history.property.test.ts`). For arbitrary sequences of `(before, after)` pairs where each `before` equals the previous `after`, and arbitrary `bac`/`eac`, the identity `performance + attributed + unattributed === vac` holds within 1e-6. With `bac` equal to the last recorded `after`, `unattributed` is 0 within 1e-6. Use `fc.double({ min: 0, max: 1e7, noNaN: true })`.
- [ ] **Step 3: Run both.** Expected: FAIL (module missing).
- [ ] **Step 4: Implement.**

```ts
/**
 * Append-only budget-at-completion series (spec 2026-09-16 §4.3). Values are the
 * project OWN basis in hours and EUR — EUR by construction (§465), so no stored
 * currency. Written only from the budget commit boundary (ruling R1); undo and
 * version restore bypass it and surface as unattributed (R2).
 */
import { sanitizeIsoDate } from "./sanitize-core";

export type BudgetHistoryKind = "baseline" | "created" | "updated" | "deleted";
export type BudgetHistoryEntry = {
  id: string; at: string; date: string; kind: BudgetHistoryKind;
  bucketId: number | null; bucketName: string;
  projectBacHours: number; projectBacValue: number;
  deltaHours: number; deltaValue: number;
};
export type ProjectBac = { hours: number; value: number };
export type BudgetChange = {
  kind: Exclude<BudgetHistoryKind, "baseline">; bucketId: number; bucketName: string;
  before: ProjectBac; after: ProjectBac; at: string; date: string; newId: () => string;
};
export const BAC_EPSILON = 1e-6;

const KINDS: ReadonlySet<string> = new Set<BudgetHistoryKind>(["baseline", "created", "updated", "deleted"]);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function sanitizeEntry(input: unknown): BudgetHistoryEntry | null {
  if (!input || typeof input !== "object") return null;
  const e = input as Record<string, unknown>;
  if (typeof e.id !== "string" || e.id === "" || typeof e.at !== "string") return null;
  if (typeof e.kind !== "string" || !KINDS.has(e.kind)) return null;
  const date = typeof e.date === "string" ? sanitizeIsoDate(e.date) : "";
  if (!date) return null;
  const bucketId = e.kind === "baseline" ? null : finite(e.bucketId) ? e.bucketId : NaN;
  if (Number.isNaN(bucketId)) return null;
  if (![e.projectBacHours, e.projectBacValue, e.deltaHours, e.deltaValue].every(finite)) return null;
  return {
    id: e.id, at: e.at, date, kind: e.kind as BudgetHistoryKind, bucketId,
    bucketName: typeof e.bucketName === "string" ? e.bucketName : "",
    projectBacHours: e.projectBacHours as number, projectBacValue: e.projectBacValue as number,
    deltaHours: e.deltaHours as number, deltaValue: e.deltaValue as number,
  };
}

export function sanitizeBudgetHistory(input: unknown): BudgetHistoryEntry[] {
  if (!Array.isArray(input)) return [];
  return input.map(sanitizeEntry).filter((e): e is BudgetHistoryEntry => e !== null);
}

export function recordBudgetChange(
  history: readonly BudgetHistoryEntry[], change: BudgetChange,
): readonly BudgetHistoryEntry[] {
  const dh = change.after.hours - change.before.hours;
  const dv = change.after.value - change.before.value;
  if (Math.abs(dh) < BAC_EPSILON && Math.abs(dv) < BAC_EPSILON) return history;
  const seeded: BudgetHistoryEntry[] = history.some((e) => e.kind === "baseline") ? [] : [{
    id: change.newId(), at: change.at, date: change.date, kind: "baseline", bucketId: null, bucketName: "",
    projectBacHours: change.before.hours, projectBacValue: change.before.value, deltaHours: 0, deltaValue: 0,
  }];
  return [...history, ...seeded, {
    id: change.newId(), at: change.at, date: change.date, kind: change.kind,
    bucketId: change.bucketId, bucketName: change.bucketName,
    projectBacHours: change.after.hours, projectBacValue: change.after.value, deltaHours: dh, deltaValue: dv,
  }];
}

export type BudgetHistorySummary = {
  baselineDate: string; baseline: ProjectBac; attributed: ProjectBac;
  changes: readonly BudgetHistoryEntry[];
};

export function summarizeBudgetHistory(history: readonly BudgetHistoryEntry[]): BudgetHistorySummary | null {
  const i = history.findIndex((e) => e.kind === "baseline");
  if (i < 0) return null;
  const base = history[i];
  const changes = history.slice(i + 1).filter((e) => e.kind !== "baseline");
  return {
    baselineDate: base.date,
    baseline: { hours: base.projectBacHours, value: base.projectBacValue },
    attributed: {
      hours: changes.reduce((s, e) => s + e.deltaHours, 0),
      value: changes.reduce((s, e) => s + e.deltaValue, 0),
    },
    changes,
  };
}

export type VarianceSplit = { vac: number; performance: number; attributed: number; unattributed: number };

/** Closed by construction: performance + attributed + unattributed === vac. */
export function splitVariance(baseline: number, attributed: number, bac: number, eac: number): VarianceSplit {
  return { vac: bac - eac, performance: baseline - eac, attributed, unattributed: bac - baseline - attributed };
}
```

  Check `sanitizeIsoDate`'s real signature in `sanitize-core.ts` first. If it takes a different argument shape or returns something other than `string`, adapt the one call and say so in the report.
- [ ] **Step 5: Run both.** Expected: EXIT=0. `budget-history.ts` is a pure engine: leave it coverage-gated (do NOT add it to `coverage.exclude`). Run `npx vitest run --coverage.enabled --coverage.include=src/app/budget-history.ts src/app/budget-history*.test.ts --maxWorkers=1 > /tmp/t3c.log 2>&1; echo "EXIT=$?"` and report line and branch coverage (both must be ≥ 90%).
- [ ] **Step 6: Mutation proof** (3 mutants):
  - (a) `unattributed: bac - baseline` (drop `- attributed`): property fails;
  - (b) the epsilon guard's `&&` → `||`, so a change that moves only one unit is skipped. Add the case `before {100, 10000}` → `after {100, 12000}` to the first describe block; it must record an entry, and the mutant must fail it;
  - (c) the baseline seeded from `change.after`: the first test fails.
- [ ] **Step 7: Commit** `feat(budget): budget-at-completion history engine`.

### Task 4: Persist `budgetHistory` on all six write paths

**Files:** mirror `activityLog` at every non-test site. The checklist is the output of `git grep -n "activityLog" -- src/app ':!*.test.*' ':!src/app/i18n*'`. Rule on EVERY hit in the report: MIRROR or SKIP, with the reason. The survey expects these MIRROR sites:
- `workspace.ts` (the `Workspace` interface: `budgetHistory?: readonly BudgetHistoryEntry[];`; the JSON encode that omits the key when empty; `jsonToWorkspace` decode via `sanitizeBudgetHistory`)
- `workspace-metrics.ts` (NOT counted: add the same style of comment beside the activityLog one)
- `workspace-slice-policy.ts` (a `budgetHistory: { counted: false, reason: "…" }` entry. Reason: "Written by ordinary budget edits as a side record; counting it would keep a wiped project reading as non-empty, the same inversion as activityLog.")
- `csv-codecs-config.ts` + `csv-codecs-decode.ts` (a new section marker `CSV_SECTION_BUDGET_HISTORY`, one `config,<json>` cell, mirroring `activityLogToCsv` and its decode)
- `markdown-codecs-core.ts` + `markdown-codecs-decode.ts` (a `## Budget History` heading plus a fenced json block, mirroring `activityLogToMarkdown` and its decode)
- `turso-schema.ts` (meta key `"budgetHistory"`: write, dirty-marking, `rowsToWorkspace` decode)
- `turso-tenant-schema.ts` (same key)
- `browser-backend.ts` (`KV_BUDGET_HISTORY_KEY = "budgetHistory"`: write, delete-when-empty, read with sanitize)
- `workspace-context.tsx` (state `budgetHistory` / `setBudgetHistory`, exposed in the context value at both sites)
- `use-storage-backend.ts` (the destructure, `applyWorkspace` replace/merge, the `outgoing` literal, the save deps array, the `getWorkspace` literal, `useBroadcastSync("budgetHistory", …)`)
- `use-storage-backend-types.ts`

The survey expects these SKIP sites:
- `applyRestoredWorkspace` in `task-manager.tsx` (R6: add `budgetHistory` to the comment that lists the deliberately missing slices);
- `use-version-history.ts` (R6: extend its exclusion comment);
- every AI-, dashboard- and panel-reading site.

- Test: `src/app/budget-history-persistence.test.ts` (new), plus additions to `workspace.test.ts`, `turso-schema.test.ts`, `turso-tenant-schema.test.ts`, `browser-backend.test.ts`, `entity-persistence-registry.test.ts`

**Interfaces:**
- Consumes: Task 3 (`BudgetHistoryEntry`, `sanitizeBudgetHistory`).
- Produces: `Workspace.budgetHistory`, and `useWorkspace().budgetHistory` / `setBudgetHistory`.

- [ ] **Step 1: Failing tests, one per path, COUNTED.** Seed two entries (baseline + updated) produced by `recordBudgetChange`, then:
  - JSON: `workspaceToJson` → `jsonToWorkspace` round-trips them; an empty array omits the key; one malformed entry is dropped on load.
  - CSV and Markdown: add rows to `entity-persistence-registry.test.ts` next to the activityLog describe, in the same shape.
  - Turso single: add to `turso-schema.test.ts`, mirroring the "turso activityLog (meta KV)" describe: writes the meta row, marks meta dirty on reference change, excluded from `TABLE_NAMES`, round-trips via `rowsToWorkspace`, omits the row when empty.
  - Turso tenant: add to `turso-tenant-schema.test.ts`, the same shape.
  - IndexedDB: add to `browser-backend.test.ts`: round-trips, and deletes the stored key when cleared.
  - `isWorkspaceEmpty`: a workspace holding ONLY `budgetHistory` is empty.
  - The `outgoing` literal, which tsc cannot guard because the field is optional: in `budget-history-persistence.test.ts`, render the storage hook the way `use-storage-backend` tests already do (grep `outgoing` / `activityLog` in `use-storage-backend*.test.tsx` and copy that harness). Assert the saved workspace carries `budgetHistory`.

  In the report, state the per-path count as "6/6 paths pinned", naming the test for each.
- [ ] **Step 2: Run the named files.** Expected: FAIL.
- [ ] **Step 3: Implement at every MIRROR site.** Merge rule for `applyWorkspace` in `logMode === "merge"`: union by `id` keeping order (prev first, then new ids). Write `mergeBudgetHistories(prev, next)` in `budget-history.ts` with its own unit test.
- [ ] **Step 4: Run the named files.** Expected: EXIT=0. Also run `golden-workspace.test.ts`. Expected: still green, because the sample has no history and empty slices are omitted. If it is red, STOP and report: the omit-when-empty rule is broken.
- [ ] **Step 5: Mutation proof** (6 mutants, one per path). Delete the write line on each path in turn; its test must fail. Report `6/6`.
- [ ] **Step 6: Update `docs/AGENTS/activity-log.md`.** Add a short "Sibling slice: `budgetHistory`" paragraph stating that it follows the same meta-blob rules and where it differs: it is in broadcast sync, merges by id, and is never capped. Run `npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "EXIT=$?"`. Expected: 0.
- [ ] **Step 7: Commit** `feat(persistence): persist budget history on every backend`.

### Task 5: Record budget changes at the commit boundary

**Files:**
- Modify: `src/app/use-budget-buckets.ts` (add optional deps and recording)
- Modify: `src/app/task-manager.tsx` (build the `projectBac` closure; pass `setBudgetHistory`, `today`)
- Test: `src/app/use-budget-buckets.test.tsx` (extend; create it if absent, mirroring the hook-test harness used elsewhere)

**Interfaces:**
- Consumes: `recordBudgetChange`, `ProjectBac`, `setBudgetHistory`.
- Produces the new optional `Deps` fields:

```ts
projectBac?: (buckets: readonly BudgetBucket[]) => ProjectBac;
setBudgetHistory?: Dispatch<SetStateAction<readonly BudgetHistoryEntry[]>>;
today?: string;
```

- [ ] **Step 1: Failing tests.** Use a stub `projectBac = (bs) => ({ hours: bs.reduce((s, b) => s + (b.allocations.length * 10), 0), value: … })`. Test:
  - (a) Adding a bucket that moves BAC writes `[baseline, created]` through `setBudgetHistory`, with the bucket's name.
  - (b) A rename-only update writes nothing (`setBudgetHistory` not called, or called with the identical array).
  - (c) Deleting writes `deleted` with the deleted bucket's name.
  - (d) Without `projectBac` (old callers), nothing is recorded and nothing throws.
  - (e) `setBudgetHistory` is called with a FUNCTIONAL updater, so two commits in one tick both land. Call `commitBuckets` twice synchronously in `act` and assert 3 entries.
- [ ] **Step 2: Run the file.** Expected: FAIL.
- [ ] **Step 3: Implement** in `commitBuckets`, after the kind/name derivation and before `setBudgets(next)`:

```ts
    if (projectBac && setBudgetHistory && today) {
      const before = projectBac(prev);
      const after = projectBac(next);
      // An edit's `soleRow` is the PRE-edit bucket; name the entry after the saved one.
      const bucketName = deleted.length > 0
        ? soleRow.name
        : next.find((b) => b.id === soleRow.id)?.name ?? soleRow.name;
      // One commit touching several buckets records ONE entry: the first bucket's
      // name and the whole BAC delta.
      const historyKind = deleted.length > 0 ? "deleted" : created.length > 0 ? "created" : "updated";
      const at = new Date().toISOString();
      setBudgetHistory((h) => recordBudgetChange(h, {
        kind: historyKind, bucketId: soleRow.id, bucketName,
        before, after, at, date: today, newId: () => crypto.randomUUID(),
      }));
    }
```

  The hook already computes `prev` (= `budgets`), `created`, `deleted`, `editedBefore`, `kind` and `soleRow` (`deleted[0] ?? editedBefore[0] ?? created[0]`). Destructure the three new deps beside the existing ones. `historyKind` is derived from the diff, never from `meta?.kind`, because an overriding activity kind (for example a task-link commit) is not a budget kind.

  In `task-manager.tsx`, at the `useBudgetBuckets({...})` call, add:

```ts
projectBac: (bs) => {
  const p = computeBudgetReport(bs, plan, roles, resources, settings.resources.workdayHours, holidaySet, absences, [], fxRates).project;
  return { hours: p.budgetHours, value: p.budgetValue };
},
setBudgetHistory,
today,
```

  `setBudgetHistory` comes from `useWorkspace()`, the same destructure that provides `setActivityLog`'s siblings. Popouts are already blocked by `guardEdit(commitBuckets)`; add a test asserting that a guarded popout commit records nothing, if the existing guard tests make that cheap. Otherwise cite the guard in the report.
- [ ] **Step 4: Run the file.** Expected: EXIT=0. Also run `src/app/task-manager.characterization.test.tsx`.
- [ ] **Step 5: Mutation proof** (2 mutants):
  - (a) record with `after` swapped for `before`: test (a) fails;
  - (b) replace the functional updater with a value captured at render. To do this, temporarily add a `budgetHistory` dep and call `setBudgetHistory(recordBudgetChange(budgetHistory, …))`; test (e) fails. Revert both edits.
- [ ] **Step 6: Commit** `feat(budget): record each budget change in the budget history`.

### Task 6: Per-bucket percent complete on snapshots

**Files:**
- Modify: `src/app/snapshot.ts` (`SnapshotRecord.bucketProgress`; `BuildSnapshotInput.buckets`; `buildSnapshot`)
- Modify: `src/app/snapshot-schema.ts` (DDL, `SNAPSHOT_COLS`, encode, decode, and a new `snapshotColumnEnsureStatements` export)
- Modify: `src/app/snapshot-store.ts` (run the ensure step before every pipeline that INSERTs)
- Modify: `src/app/task-manager.tsx` (pass `buckets: budgets` into the snapshot build input)
- Test: `src/app/snapshot.test.ts`, `src/app/snapshot-schema.test.ts`, `src/app/snapshot-store.test.ts`, new `src/app/snapshot-schema.execute.test.ts`

**Interfaces:** Produces

```ts
export type SnapshotBucketProgress = { bucketId: number; pctComplete: number };
// SnapshotRecord.bucketProgress: SnapshotBucketProgress[]
export function snapshotColumnEnsureStatements(pragmaResult: PipelineResultLike | undefined): SqlStmt[];
```

- [ ] **Step 1: Failing tests.**
  - `snapshot.test.ts`: `buildSnapshot` with buckets `[{id:1, percentComplete: 40}, {id:2, taskIds:[t1,t2]} (t1 Done), {id:3, taskIds: []}]` yields `bucketProgress` `[{1,40},{2,50}]`. Bucket 3 is omitted because its percent is `null`.
  - `snapshot-schema.test.ts`:
    - `appendStatements` writes a `bucket_progress_json` arg equal to `JSON.stringify(rec.bucketProgress)`;
    - `rowsToSnapshots` decodes it;
    - a row WITHOUT the column (an old database: omit it from `cols`) decodes to `[]`;
    - `"not json"` → `[]`;
    - entries with non-finite fields are dropped.
  - `snapshot-schema.execute.test.ts` (new), using `DatabaseSync` from `node:sqlite` as in `turso-schema.execute.test.ts`:
    1. Create the table with the OLD DDL (a literal copy of today's `snapshot` DDL, inlined in the test with a comment saying why).
    2. Run `PRAGMA table_info("snapshot")` and feed the rows, shaped as `PipelineResultLike`, to `snapshotColumnEnsureStatements`.
    3. Execute the returned ALTERs.
    4. Execute `appendStatements(rec, "p1")` (skip `BEGIN`/`COMMIT`, or keep them: `DatabaseSync` supports both).
    5. `SELECT *`, then assert the round-trip through `rowsToSnapshots`.
    6. Assert that a second ensure run returns `[]` (idempotent).
- [ ] **Step 2: Run the four files.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - DDL: append `, bucket_progress_json TEXT` after `milestones_json TEXT`. Keep `project_id` last in the CREATE, and in `SNAPSHOT_COLS` insert `"bucket_progress_json"` before `"project_id"`, keeping the encode arg order identical (§469 warns the list and the args drift apart).
  - Decode: `bucketProgress: parseBucketProgress(r.bucket_progress_json)`, written like `parseMilestones`.
  - `snapshotColumnEnsureStatements` reuses `existingColumnsFromPragma` and `missingColumnAlters` from `turso-migrate.ts`: `missingColumnAlters("snapshot", existing, SNAPSHOT_COLS)`. It returns `[]` when the PRAGMA result is unreadable.
  - In `snapshot-store.ts`'s `appendSnapshot`, run one pipeline `[...ddl(), { sql: 'PRAGMA table_info("snapshot")' }]`, then `[...ensure, ...appendStatements(...)]`. Update `snapshot-store.test.ts`'s mocked pipeline sequence accordingly (MIGRATE).
  - `buildSnapshot`: `bucketProgress: buckets.flatMap((b) => { const p = bucketPercentComplete(b, tasks); return p === null ? [] : [{ bucketId: b.id, pctComplete: p }]; })`.
- [ ] **Step 4: Run the four files, plus `use-snapshots.test.tsx` and `trends-panel.test.tsx`.** MIGRATE fixtures that build a full `SnapshotRecord` by adding `bucketProgress: []`. Expected: EXIT=0.
- [ ] **Step 5: Mutation proof** (3 mutants):
  - (a) drop the ensure step in `appendSnapshot`: the store test fails;
  - (b) swap `bucket_progress_json` and `milestones_json` in `SNAPSHOT_COLS`: the execute test fails;
  - (c) the decode returns `[{…}]` for `"not json"`: the schema test fails.
- [ ] **Step 6: Commit** `feat(snapshots): record each bucket's percent complete per capture`.

### Task 7: Delete `SnapshotRecord.currency` (closes §469)

**Files:** `src/app/snapshot.ts`, `src/app/snapshot-schema.ts`, `src/app/task-manager.tsx`, `src/app/trends-panel.tsx`, `docs/open-followups.md`, and the tests listed below.

- [ ] **Step 1: Invalidated tests (MIGRATE).**
  - `snapshot.test.ts`: remove the `currency` input and assertions.
  - `snapshot-schema.test.ts` and `snapshot-store.test.ts`: remove `"currency"` from the mocked `cols` and its row value.
  - `use-snapshots.test.tsx`: drop `currency` from the fixtures.
  - `trends-panel.test.tsx`, the "currency labelling" describe: keep the test that the panel labels EUR. Replace its `snap(..., { currency: "USD" })` seeding with a contract-currency plan if the panel still receives one; otherwise keep only the EUR assertion. Say which in the report.
- [ ] **Step 2: Add a new test with a positive observable.** In `snapshot-schema.test.ts`: `appendStatements`' snapshot INSERT names `bucket_progress_json` (positive) and does not name `currency` (absence). The arg count equals the column count.
- [ ] **Step 3: Remove the field.**
  - Remove it from `SnapshotRecord`, `BuildSnapshotInput`, the `buildSnapshot` destructure and return, `SNAPSHOT_COLS`, the encode arg and the decode.
  - Remove `currency: plan.currency` from the snapshot build in `task-manager.tsx`.
  - **Keep `currency TEXT` in the DDL.** Removing it from `CREATE TABLE IF NOT EXISTS` changes nothing for existing databases, and keeping it means new and old databases share one shape until §551 drops it. Add a comment beside it: `-- unused since §469; dropped only once §551's minimum-client guarantee exists`.
  - `snapshot-schema.execute.test.ts` still passes, because the INSERT names its columns.
- [ ] **Step 4: Rewrite the `trends-panel.tsx` comment block** above `const currency = "EUR"` to ≤ 6 lines: the figure is an EUR sum from the engine (§465), so the label is EUR. Snapshots no longer carry a currency (§469).
- [ ] **Step 5: Run.**
  - Run `npx vitest run src/app/snapshot.test.ts src/app/snapshot-schema.test.ts src/app/snapshot-store.test.ts src/app/snapshot-schema.execute.test.ts src/app/use-snapshots.test.tsx src/app/trends-panel.test.tsx --maxWorkers=1 > /tmp/t7.log 2>&1; echo "EXIT=$?"`. Expected: 0.
  - Run `npm run src:symbols:check -- --since origin/main`. Report any finding that names `currency`.
- [ ] **Step 6: Close §469 in the register.** Use a Node script (Write the script file; never `node -e` with backticks):
  - heading → `— CLOSED 2026-09-16` (use the real date at execution);
  - Status → `CLOSED <date> by <branch>: the field, its writer, column list entry, encode and decode are removed; the DDL column stays until §551.`;
  - remove the `**Work item:** #298` line;
  - index row → closed.

  Run `npm run followups:index:check > /tmp/idx.log 2>&1; echo "EXIT=$?"`. Expected: 0.
- [ ] **Step 7: Commit** `refactor(snapshots): remove the unread snapshot currency field (§469)`.

**Stage boundary.** Stage 1 is releasable on its own. The controller stops here only if the user asked to release per stage; otherwise it continues.

---

# Stage 2 — surfaces

### Task 8: Snapshot progress series and rule 1A′ in `computeEvHistory`

**Files:**
- Modify: `src/app/budget-ev-history.ts`
- Test: `src/app/budget-ev-history.test.ts` (MIGRATE the unavailable-reason tests), `src/app/budget-forecast-bundle.test.ts` (MIGRATE)

**Interfaces — Produces:**

```ts
export type BucketProgressRecord = { date: string; pct: number };            // date = capturedAt.slice(0,10)
export function bucketProgressSeries(
  snapshots: readonly Pick<SnapshotRecord, "capturedAt" | "bucketProgress">[],
): ReadonlyMap<number, readonly BucketProgressRecord[]>;                      // sorted by date asc
export type EvPartialBucket = { id: number; name: string; createdDate: string | null };
export type EvJoin = { id: number; name: string; eur: number; hours: number };
export type EvHistoryPoint = {
  date: string; eur: number; hours: number;
  partial: readonly EvPartialBucket[];    // empty ⇒ this point is complete
  joins: readonly EvJoin[];               // buckets whose record begins at this point
};
export type EvHistory =
  | { available: true; points: readonly EvHistoryPoint[] }
  | { available: false; reason: "no-earned-value"; buckets: readonly { id: number; name: string }[] };
export type EvHistoryInput = {
  report: BudgetReport; buckets: readonly BudgetBucket[]; tasks: readonly EvHistoryTask[];
  dates: readonly string[]; today: string;
  progress: ReadonlyMap<number, readonly BucketProgressRecord[]>;   // new, required
};
```

- [ ] **Step 1: Failing table test**, one case per spec §5.1 row plus R3. Fixture: plan months 1–12, points at each month end, today = month 12.
  - (1) A manual bucket with `startDate` month 7 and no records contributes 0 at months 1–6. Those points have `partial: []`.
  - (2) A linked bucket derives from its tasks, as before.
  - (3) A manual bucket with records at months 7 and 9 (pct 20, 50): month 7 → 20 % × own budget, month 8 → 20 %, month 9 → 50 %.
  - (4) The same bucket, active from month 1 (no `startDate`, or `startDate` month 1), has no record before month 7. Months 1–6 contribute 0 and list it in `partial` with `createdDate` from the bucket (null when absent). Month 7 lists it in `joins` with its contribution.
  - (5) The today point uses the bucket's current `percentComplete`: it is never partial and never a join.
  - (R3) A linked bucket whose `taskIds` resolve to nothing is partial at every non-today point.
  - Unavailable: every budgeted bucket partial at every non-today point AND no today value → `{ available: false, reason: "no-earned-value" }`.
  - `bucketProgressSeries`: groups by bucket, sorts by date, and keeps the LAST record of a day when two captures share it.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the file under ~200 lines. Per bucket, choose a `valueAt(date, isToday)` that returns `{ share: number, known: boolean }`:
  - today → `bucketPercentComplete(bucket, resolved)`, known if non-null;
  - `bucket.startDate && date < bucket.startDate` → `{0, known: true}`;
  - manual → the latest record with `record.date <= date` → `{pct/100, true}`, otherwise `{0, false}`;
  - linked with resolved tasks → the finished share, `true`;
  - linked with none → `{0, false}`.

  A bucket is a join at point i when it is known at i and was unknown at i−1 (with i−1 existing and non-today). Use the own-basis amounts from Task 1.
- [ ] **Step 4: Update `budget-forecast-bundle.ts`.** `ForecastBundleInput` gains `progress: ReadonlyMap<number, readonly BucketProgressRecord[]>` and passes it through. MIGRATE the bundle tests with `progress: new Map()`.
- [ ] **Step 5: Run** `budget-ev-history`, `budget-forecast-bundle` and `burndown-geometry` tests. Expected: EXIT=0. The last is migrated in Task 9; if it is red here, only the reason literal may differ, and it is fixed in Task 9 in the same round.
- [ ] **Step 6: Mutation proof** (3 mutants):
  - (a) `date < bucket.startDate` → `<=`: case (1) fails;
  - (b) `record.date <= date` → `<`: case (3) fails;
  - (c) the join rule ignores `i−1` unknown: case (4)'s join assertion fails.
- [ ] **Step 7: Commit** `feat(forecast): earned-value history for hand-entered buckets (rule 1A′)`.

### Task 9: Chart — partial spans and join labels

**Files:**
- Modify: `src/app/burndown-geometry.ts` (`ChartInput`, `buildChartModel`: replace `evLine` + `evHistoryBlockedBy` with `evSegments`, `evJoins`, `evPartialNames`, `evUnavailable`)
- Modify: `src/app/burndown-chart.tsx` (draw them; `DASH.evPartial = "2 4"`; legend swatch; aria)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/burndown-geometry.test.ts`, `src/app/burndown-chart.test.tsx` (MIGRATE `"shows the frame note and the blocked-history note when they apply"`)

**Interfaces — Produces (model fields):**

```ts
evSegments: readonly { partial: boolean; points: readonly ChartPoint[] }[] | null;
evJoins: readonly { date: string; value: number; label: string }[];   // label = names joined with ", "
evPartialNames: readonly { names: string; created: boolean }[];         // one per partial segment, for the caption
evUnavailable: readonly string[] | null;
```

**i18n keys (EN / DE)** — exact text:

| key | EN | DE |
|---|---|---|
| `burndownEvPartial` | `Partial earned value` | `Unvollständiger Fertigstellungswert` |
| `burndownEvPartialNotRecorded` | `Partial: {0} not recorded` | `Unvollständig: {0} nicht erfasst` |
| `burndownEvPartialCreated` | `Partial: {0} created later` | `Unvollständig: {0} später angelegt` |
| `burndownEvJoinsHours` | `{0} joins (+{1} h)` | `{0} kommt hinzu (+{1} h)` |
| `burndownEvJoinsEur` | `{0} joins (+{1})` | `{0} kommt hinzu (+{1})` |
| `burndownAriaEvPartial` | `Earned value is partial for {0}.` | `Der Fertigstellungswert ist für {0} unvollständig.` |

Rename `burndownEvHistoryUnavailable`'s EN text to `No earned-value history yet for {0}.` and its DE text to `Noch kein Verlauf des Fertigstellungswerts für {0}.`. Before touching DE, check the current DE wording and keep its style if it differs.

`burndownEvPartialCreated` is used when every bucket in the segment has a `createdDate` later than its `startDate`; otherwise `burndownEvPartialNotRecorded` is used.

- [ ] **Step 1: Failing tests.**
  - Geometry: consecutive partial points form one `partial: true` segment. The segment boundary point is shared by both neighbouring segments, so the line stays continuous. A join produces an `evJoins` entry at that point, with the formatted amount in the current unit.
  - Chart:
    - a partial segment renders a `<polyline>` with `strokeDasharray` equal to `DASH.evPartial`, plus a visible caption text;
    - the join label text is present;
    - the aria label contains `Earned value is partial for Vendor.`;
    - with `loadI18n("de")` the DE caption renders with umlauts.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Edit `i18n.de.ts` via a scratchpad Node script (read utf8, anchor on an existing `burndownEvHistoryUnavailable` line, including its `\r\n`, write utf8, then print the count of each new key = 1). Check `git ls-files --eol src/app/i18n.de.ts` → `w/crlf`.
- [ ] **Step 4: Run** the geometry and chart tests, then `npx tsc --noEmit`. Expected: 0.
- [ ] **Step 5: Mutation proof** (2 mutants):
  - (a) partial segments drawn with `DASH.evLine`: the chart test fails;
  - (b) segments not sharing the boundary point: the geometry continuity test fails.
- [ ] **Step 6: Commit** `feat(chart): mark partial earned-value spans and name the buckets that join`.

### Task 10: Thread snapshots and budget history into the forecast bundle

**Files:**
- Modify: `src/app/budget-forecast-bundle.ts`
  - input gains `budgetHistory: readonly BudgetHistoryEntry[]`;
  - bundle gains `history: BudgetHistorySummary | null` (from `summarizeBudgetHistory`).
- Modify: `src/app/budget-report-panel.tsx` (props `snapshots?: readonly SnapshotRecord[]`, `budgetHistory?: readonly BudgetHistoryEntry[]`; build `progress` via `bucketProgressSeries(snapshots ?? [])` in a `useMemo`)
- Modify: `src/app/dashboard.ts` (input gains the same two optional fields and passes them to `computeForecastBundle`)
- Modify: the prop chain into `BudgetReportPanel` (`reports.tsx`, `workspace-panels.tsx`, `workspace-section.tsx`, `workspace-section-types.ts`) and into `dashboard.ts`'s caller (`task-manager.tsx` and/or `dashboard-panel.tsx`). Trace each with `grep -n "BudgetReportPanel\|computeDashboardModel\|buildDashboard" src/app/*.tsx` and list every hop in the report.
  - `snapshots` comes from `useSnapshots` in `task-manager.tsx` (`snapshots.snapshots`), and only when `trendsActive`; pass `[]` otherwise.
  - `budgetHistory` comes from `useWorkspace()`.
- Test: `src/app/budget-forecast-bundle.test.ts`, `src/app/budget-report-panel.test.tsx`, `src/app/dashboard.test.ts` (or the file that pins `computeForecastBundle` use in the dashboard; grep for it)

**Interfaces:**
- Consumes: Tasks 3, 6 and 8.
- Produces: `ForecastBundle.history: BudgetHistorySummary | null`.

- [ ] **Step 1: Failing tests.**
  - The bundle carries `history` equal to `summarizeBudgetHistory(input)`, or null for `[]`.
  - `BudgetReportPanel`, given snapshots with a manual bucket's record, renders an earned-value history line where it previously rendered the unavailable note. Assert on the chart's aria text.
  - The dashboard model does the same.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the new props OPTIONAL at component boundaries and default them to `[]`, so unrelated tests stay green. Memo panels must keep receiving stable identities: pass the context array directly and never wrap it in a new literal (see the AGENTS.md memo bullet).
- [ ] **Step 4: Run** the named files plus `task-manager.characterization.test.tsx` and `workspace-section.test.tsx`. Expected: 0.
- [ ] **Step 5: Mutation proof** (1 mutant). Pass `new Map()` instead of the built `progress` in `BudgetReportPanel`; the panel test must fail.
- [ ] **Step 6: Commit** `feat(forecast): feed snapshot progress and budget history to the forecast`.

### Task 11: Three-part variance on both forecast cards

**Files:**
- Modify: `src/app/budget-forecast-cards.tsx` (`ForecastCards` gains `history?: BudgetHistorySummary | null`; `PaceCard` and `EfficiencyCard` render a `VarianceSplitRows` beneath their VAC rows, in € and, where the hours line shows, in hours)
- Modify: `src/app/budget-forecast-section.tsx` (pass `bundle.history`)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/budget-forecast-cards.test.tsx`

**Behaviour:**
- For each card × unit, `split = splitVariance(history.baseline[unit], history.attributed[unit], facts.bac, card.eac)`.
- Rows: performance and attributed scope always; unattributed only when `Math.abs(unattributed) >= 0.5` in the displayed unit.
- A caption names the baseline date. The unattributed row carries an `InfoTooltip` explaining it.
- `history === null` → one muted note instead of the rows.
- The dashboard tile (`ForecastHeadline`) is NOT changed.

**i18n keys (EN / DE):**

| key | EN | DE |
|---|---|---|
| `forecastSplitSince` | `Since {0}` | `Seit {0}` |
| `forecastSplitPerformance` | `Performance` | `Leistung` |
| `forecastSplitScope` | `Added scope` | `Zusätzlicher Umfang` |
| `forecastSplitUnattributed` | `Unexplained budget change` | `Nicht zugeordnete Budgetänderung` |
| `forecastTipSplitUnattributed` | `Budget at completion moved without a recorded budget edit — for example a capacity, absence or holiday change, an undo, or a restored version. Check the activity log for budget edits in this period.` | `Das Gesamtbudget hat sich ohne erfasste Budgetänderung verschoben – etwa durch geänderte Kapazität, Abwesenheiten oder Feiertage, ein Rückgängigmachen oder eine wiederhergestellte Version. Prüfen Sie das Aktivitätsprotokoll auf Budgetänderungen in diesem Zeitraum.` |
| `forecastSplitNoHistory` | `The split into performance and added scope starts with the first recorded budget change.` | `Die Aufteilung in Leistung und zusätzlichen Umfang beginnt mit der ersten erfassten Budgetänderung.` |
| `forecastTipSplitNameUnattributed` | `About the unexplained budget change` | `Zur nicht zugeordneten Budgetänderung` |

The last key is the `InfoTooltip`'s accessible name. It must be unique per card: append the card title the same way the existing `forecastTip*` names are made unique. Read that pattern in the a11y describe of `budget-forecast-cards.test.tsx` first.

- [ ] **Step 1: Failing tests.**
  - With history baseline 1200 h / attributed 500 h, facts.bac 1700 h and hours pace EAC 1440, the pace card shows `Performance −240 h`, `Added scope +500 h`, and no unattributed row.
  - With bac 1760, the unattributed row shows `+60 h` and its tooltip.
  - The € rows render the same way.
  - `history: null` renders the note once per card.
  - Tooltip accessible names are unique across both cards.
  - A DE render (after `loadI18n("de")`) shows `Zusätzlicher Umfang`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use the card's existing formatting helpers for signed hours and €. No new colour: rows reuse `MetricRow` / `HoursRow`. DE via a Node script, as in Task 9.
- [ ] **Step 4: Run** the cards test, `tsc` and eslint. Expected: 0.
- [ ] **Step 5: Mutation proof** (2 mutants):
  - (a) the unattributed threshold `>=` → `>` with a value of exactly 0.5: add that boundary case and it fails;
  - (b) the efficiency card passes the pace EAC: an efficiency assertion fails.
- [ ] **Step 6: Commit** `feat(forecast): split variance at completion into performance, scope and unexplained change`.

### Task 12: Chart budget steps, change markers and the change table

**Files:**
- Modify: `src/app/burndown-geometry.ts` (from `history` + `ChartInput.today`: `bacSteps: readonly ChartPoint[] | null`, a stepped polyline; `bacBaseline: number | null`; `bacMarkers: readonly { date: string; value: number; label: string }[]`)
- Modify: `src/app/burndown-chart.tsx` (draw them in cumulative orientation only, replacing the flat `bacLine` when `bacSteps` is present; baseline as a dashed `DASH.bac` reference; markers as small labelled ticks)
- Create: `src/app/budget-change-table.tsx` (`BudgetChangeTable({ lang, history, split, unit })`: a `<table>` with a caption, rendered beside the chart by `burndown-chart-panel.tsx`)
- Modify: `src/app/burndown-chart-panel.tsx` (the `bundle` Pick gains `history`)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/burndown-geometry.test.ts`, `src/app/burndown-chart.test.tsx`, `src/app/budget-change-table.test.tsx`

**Behaviour:**
- **Steps.** The line runs at `baseline` from the origin to the first change's date, then steps to each entry's `projectBac*`.
- **Marker labels.**
  - One entry: `+300 h Vendor`, or `−80 h Vendor removed` for a deletion.
  - Several entries in one period: amounts summed, names joined by `, `.
- **Change table (R4).** Columns: date · bucket · change · cumulative scope. The footer rows show performance / added scope / unexplained (from the pace card's split in the displayed unit) with a "pace forecast" note. The caption names the unit.
- **Accessibility.** The chart's aria label appends `Budget changes: {list}.`

**i18n keys (EN / DE):**

| key | EN | DE |
|---|---|---|
| `burndownBacBaseline` | `Budget at start of recording` | `Budget bei Aufzeichnungsbeginn` |
| `burndownBacMarkerRemoved` | `{0} {1} removed` | `{0} {1} entfernt` |
| `burndownAriaBudgetChanges` | `Budget changes: {0}.` | `Budgetänderungen: {0}.` |
| `budgetChangeTableCaption` | `Budget changes ({0})` | `Budgetänderungen ({0})` |
| `budgetChangeColDate` | `Date` | `Datum` |
| `budgetChangeColBucket` | `Bucket` | `Budgettopf` |
| `budgetChangeColChange` | `Change` | `Änderung` |
| `budgetChangeColCumulative` | `Added scope to date` | `Zusätzlicher Umfang bisher` |
| `budgetChangePaceNote` | `Split against the pace forecast.` | `Aufteilung gegen die Tempo-Prognose.` |

Before adding `budgetChangeColBucket`, grep i18n for the existing DE term for "bucket" and reuse it if it differs.

- [ ] **Step 1: Failing tests.**
  - Geometry: two entries in different months give 3 step levels; two in the same month give one marker with the summed label; no history gives `bacSteps === null` with the flat line unchanged.
  - Chart: the baseline line and marker labels render, and the aria label contains `Budget changes:`.
  - Table:
    - rows in order;
    - cumulative column correct;
    - deleted row labelled;
    - footer figures;
    - DE caption.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The table is plain semantic `<table>` markup with the app's table classes; it has no sort, so `SortResizeTh` is not needed. On narrow widths, stack the table below the chart (`flex-col md:flex-row`). DE via a Node script.
- [ ] **Step 4: Run** the three files plus `burndown-chart-panel` and `dashboard-tile-bodies` tests if present, then `tsc` and eslint. Expected: 0.
- [ ] **Step 5: Visual and axe check.**
  - Run `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Budget" --workers=1 > /tmp/axe.log 2>&1; echo "EXIT=$?"`, then the same for `-g "Dashboard"`.
  - Run `npx playwright test --project=visual -g "Dashboard|Budget" > /tmp/vis.log 2>&1; echo "EXIT=$?"`.
  - A visual diff caused by the new table or steps is expected ONLY where the seed has budget history. The e2e seed has none, so the expectation is NO diff. A diff means something changed for projects without history; STOP and report it.
- [ ] **Step 6: Mutation proof** (2 mutants):
  - (a) markers not summed per period: the geometry test fails;
  - (b) the cumulative column uses the entry delta: the table test fails.
- [ ] **Step 7: Commit** `feat(chart): show budget changes as steps, named markers and a change table`.

### Task 13: Close-out

- [ ] **Step 1: Amend the spec for rulings R2–R4.**
  - §6 undo row → "undo and version restore bypass the commit boundary and surface as unattributed";
  - §5.1 reasons;
  - §5.3 table wording.

  Add a dated "Amended during planning" note at the top.
- [ ] **Step 2: Close §549 in the register** via a Node script, as in Task 7 Step 6 (work item line removed, index row closed). Run `npm run followups:index:check`. Expected: 0.
- [ ] **Step 3: Docs.**
  - `docs/AGENTS/dashboard.md`: extend its burn/forecast paragraph by ≤ 6 lines naming the split, the partial rule and the snapshot dependency (Turso only).
  - Run `npm run docs:symbols:check` and `npm run docs:claims:check`. Expected: 0 each.
- [ ] **Step 4: Full gates, once, sequentially, each unpiped:**
  - `npx tsc --noEmit`
  - `npx eslint --max-warnings=0 src`
  - `npm run test:run`
  - `npm run test:shuffle`
  - `npm run test:coverage`
  - `npm run size:check`
  - `npm run dup:check`

  Report each EXIT. The user may waive these in favour of CI. Ask the controller, not the plan.
- [ ] **Step 5: Commit** `docs: close §549 and record the planning rulings`.

---

## Self-review notes (controller)

- **Spec coverage:**
  - §4.1 → T2
  - §4.2 → T6
  - §4.3 → T3, T4, T5
  - §4.4 → T7
  - §5.1 → T8, T9
  - §5.2 → T10, T11
  - §5.3 → T12
  - §6 → T5 (R2), T8 (partial and undated), T3 (deletion)
  - §7 → per task
  - §8 is honoured: no export key, no backfill, no column drop.
- The Task 1 defect was found while planning. It lives in the shipped 1.7.1 chart and is fixed first so that Stage 1 can ship it.
- **Names used across tasks:**
  - `BudgetHistoryEntry`, `recordBudgetChange`, `summarizeBudgetHistory`, `splitVariance`, `BudgetHistorySummary`, `ProjectBac` (T3 → T4, T5, T10, T11, T12);
  - `bucketProgressSeries`, `BucketProgressRecord` (T8 → T10);
  - `SnapshotRecord.bucketProgress` (T6 → T8);
  - `ForecastBundle.history` (T10 → T11, T12).
