# Forecast import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import budget forecast hours (person × period × hours, optional rate) from an `.xlsx`/`.xlsm`/`.csv` sheet into one budget bucket, by a hand route (detected layout + editable mapping) or a Claude route, through one shared preview and one undoable write.

**Architecture:** Both routes produce `ForecastRow[]`; one validator and one pure planner (`buildForecastImportPlan`) turn them into a cell diff; a modal shows it and `onChangeBuckets` (the panel's `commitBuckets`) writes it once. All engines are pure and i18n-free under `src/app/budget-import/`.

**Tech Stack:** TypeScript, React 19, Next 16, vitest + RTL + fast-check.

**Spec:** `docs/superpowers/specs/2026-10-12-forecast-import-design.md`

## Global Constraints

- `src/app/**` files are CRLF; write them with the Write/Edit tools or node, NEVER `sed -i`. `i18n.de.ts`: node utf8 write with `\r\n` anchors, real umlauts. Docs and CHANGELOG are LF.
- EN and DE i18n key sets identical (tsc enforces). Lang literal in tests is `"en-US"`.
- Engines under `src/app/budget-import/` import no i18n and no React.
- `MAX_IMPORT_HOURS_PER_CELL = 744`. Rate mismatch threshold: relative difference `> 0.005`. Hours rounded to 2 decimals.
- Canonical period keys: month `"YYYY-MM"`, week `"YYYY-Www"` — exactly `periodKeyForDate` (`resource-capacity.ts`).
- The workspace codec `parseCsv` (`csv-codecs-core.ts`) is NOT modified.
- Nothing writes rates, `plan`, other buckets, `actualHours` or resources.
- Every new interactive control has an accessible name; per-row controls get row-unique names via `buildRowTokens` (`row-tokens.ts`). Buttons use the shared `Button`; the modal is the shared `Modal`.
- Before every commit: `npx eslint --max-warnings=0 <changed files>` and `npx tsc --noEmit`, both unpiped, exit 0. Targeted vitest only, under the lock: `if mkdir /c/Projects/.vitest-lock 2>/dev/null; then npx vitest run <files> > <scratch>/v.log 2>&1; echo EXIT=$?; rm -rf /c/Projects/.vitest-lock; else echo LOCKED; fi`.
- Commit messages cite `§500`; no `Closes #`, no session URL, no `Claude-Session:` trailer. Never `--amend`.

## Review Focus

1. A German export: `;` separator, `1.234,5` decimals, `Jan.`/`Mär 2026` headers — must read as hours 1234.5, not 1.2345 or a rejected row. (Tasks 1, 2)
2. A wide sheet with a trailing `Total` column and a `Total` row — neither may be imported as a period or a person. (Tasks 2, 3)
3. A person listed twice (two rows, same role) — hours summed with a warning, not the second row replacing the first. (Task 4)
4. A monthly sheet into a weekly plan around a public holiday — total hours preserved exactly; no hours land on the holiday's week share. (Task 5)
5. The bucket closed (or `budgetFollowsPlan` switched on) while the preview is open — Apply must refuse, not write. (Tasks 6, 8)

---

### Task 1: Sheet grid

**Files:**
- Modify: `src/app/xlsx-extract.ts` (export a grid reader beside `extractXlsx`)
- Create: `src/app/budget-import/sheet-grid.ts`
- Test: `src/app/budget-import/sheet-grid.test.ts`, extend `src/app/xlsx-extract.test.ts`

**Interfaces:**
- Produces:
  - `export function extractXlsxGrid(entries: Map<string, Uint8Array>): { name: string; rows: string[][]; truncated: boolean }[]` in `xlsx-extract.ts` — built from the SAME `sheetEntries` / `sharedStrings` / `sheetRows` the Markdown path uses; `extractXlsx` must render from it so the two cannot drift.
  - `export type SheetGrid = { name: string; rows: string[][]; truncated: boolean }`
  - `export async function readSheetFile(name: string, bytes: Uint8Array): Promise<SheetGrid[]>` — `.xlsx`/`.xlsm` via `readZipEntries` (`unzip.ts`) + `extractXlsxGrid`; `.csv` via `parseDelimited`; anything else throws `Error("unsupported")`.
  - `export function parseDelimited(text: string): string[][]` — RFC 4180 quoting (doubled `""`, quoted newlines), strips a leading BOM, delimiter `;` when the first non-blank line holds more unquoted `;` than `,`, else `,`; CRLF and LF both end a row; trailing empty row dropped.
  - `export function excelSerialToIso(serial: number): string | null` — 1900 date system with the Lotus leap-year bug (serial 60 → null; 61 → `"1900-03-01"`; 45658 → `"2025-01-01"`); non-integer part ignored; `< 1` or non-finite → null.

- [ ] **Step 1: Failing tests.** `parseDelimited`: `'a;b\r\n"1,5";"x""y"\n'` → `[["a","b"],["1,5",'x"y']]`; `"a,b\n1,2"` → comma; BOM stripped; quoted newline kept in one cell. `excelSerialToIso`: the three values above plus `0` → null. `extractXlsxGrid` on the existing xlsx fixture in `xlsx-extract.test.ts` returns the rows `extractXlsx` renders (assert one known cell and the sheet name), and `extractXlsx` output for that fixture is byte-identical to before (snapshot the string in the test BEFORE the refactor).
- [ ] **Step 2: Run** `npx vitest run src/app/budget-import/sheet-grid.test.ts src/app/xlsx-extract.test.ts` → FAIL (missing exports).
- [ ] **Step 3: Implement.** Refactor `extractXlsx` to `extractXlsxGrid(...).map(renderRows)`; keep `MAX_XLSX_SHEET_CELLS` semantics.
- [ ] **Step 4: Run** the same command → PASS; also `npx vitest run src/app/attachment-ingest.test.ts` (consumer of `extractXlsx`) → PASS.
- [ ] **Step 5: Commit** `feat: spreadsheet grid reader for the forecast import (§500)`.

### Task 2: Row parsing

**Files:**
- Create: `src/app/budget-import/forecast-rows.ts`, `src/app/budget-import/forecast-types.ts`
- Test: `src/app/budget-import/forecast-rows.test.ts`

**Interfaces:**
- Produces (in `forecast-types.ts`):
  - `export type ForecastRow = { person: string; email?: string; period: string; hours: number; rate?: number; source?: string }`
  - `export type ColumnMapping = { layout: "wide" | "long"; headerRow: number; person: number; email?: number; rate?: number; periodCols?: number[]; period?: number; hours?: number }` (column indices 0-based; wide uses `periodCols`, long uses `period` + `hours`)
  - `export type DropReason = { row: number; reason: "total" | "blank-person" | "bad-period" | "bad-number" }`
- Produces (in `forecast-rows.ts`):
  - `export function parsePeriodLabel(cell: string): string | null` — accepts `2026-01`, `2026-1`, `Jan 2026`, `January 2026`, `Jan-26`, German `Jan.`/`Januar`/`Mär`/`März`/`Mai`/`Okt`/`Dez` + year, `01/2026`, `1.2026`, ISO date `2026-01-15` (→ `2026-01`), a numeric Excel serial 20000–80000 (→ its month via `excelSerialToIso`), and `2026-W03` / `W03 2026` / `KW03 2026` (→ `2026-W03`). Case-insensitive, trims. Anything else → null.
  - `export function detectDecimalStyle(cells: readonly string[]): "dot" | "comma"` — "comma" when any cell matches `^\d{1,3}(\.\d{3})+(,\d+)?$` or `^\d+,\d+$`, else "dot".
  - `export function parseNumberCell(cell: string, style: "dot" | "comma"): number | null` — blank → null; strips spaces and a trailing `h`/`€`/`$`/`£`/`₹`; applies the style's thousands/decimal separators; non-finite → null.
  - `export function isTotalLabel(cell: string): boolean` — trimmed, case-insensitive `total`, `totals`, `sum`, `summe`, `gesamt`, `Σ`, or a label starting with one of them followed by a space or colon.
  - `export function gridToForecastRows(rows: readonly string[][], mapping: ColumnMapping, sheetName: string): { rows: ForecastRow[]; dropped: DropReason[] }` — decimal style decided once per hours column (wide: once over all period columns together); a blank hours cell yields NO row; `0` yields a row; total/blank-person rows dropped; wide period columns whose header `parsePeriodLabel` rejects or `isTotalLabel` accepts are ignored; every row gets `source` = `${sheetName}!${A1 ref}` of its hours cell.

- [ ] **Step 1: Failing tests.** Table test for `parsePeriodLabel` covering every form above plus rejects (`"Q1 2026"`, `"Total"`, `""`, `"13/2026"`). `parseNumberCell("1.234,5","comma")` → 1234.5; `("1,234.5","dot")` → 1234.5; `("12 h","dot")` → 12; `("","dot")` → null. Review Focus 1: a German WIDE grid `[["Name","Jan 2026","Feb 2026","Gesamt"],["Ann","1.234,5","0",""],["Gesamt","…","…",""]]` → exactly two rows for Ann (1234.5 and 0), sources `S!B2` and `S!C2`, one `total` drop. Review Focus 2 is the `Gesamt` row + column in the same test. A LONG grid with email + rate columns maps every field.
- [ ] **Step 2: Run** `npx vitest run src/app/budget-import/forecast-rows.test.ts` → FAIL.
- [ ] **Step 3: Implement** the four exports.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: forecast row parsing for both sheet layouts (§500)`.

### Task 3: Layout detection

**Files:**
- Create: `src/app/budget-import/layout-detect.ts`
- Test: `src/app/budget-import/layout-detect.test.ts`

**Interfaces:**
- Consumes: `parsePeriodLabel`, `parseNumberCell`, `detectDecimalStyle`, `isTotalLabel`, `ColumnMapping` (Task 2).
- Produces: `export function detectLayout(rows: readonly string[][]): { kind: "wide" | "long" | "unknown"; mapping: ColumnMapping | null }`
  - Scans the first 10 rows for a header. WIDE when some row has ≥3 cells accepted by `parsePeriodLabel` → `headerRow` = that row, `periodCols` = those cells, `person` = the first column left of the first period column whose data cells are mostly non-numeric text, `email` = a column whose header matches `/e-?mail/i` or whose data cells contain `@`, `rate` = a header matching `/rate|satz|€\/h|eur\/h/i`.
  - LONG when, below some header row, one column parses as a period in ≥80% of non-blank cells and another as a number in ≥80% → `period` / `hours` (prefer a header matching `/hour|stunden|std|hrs/i` when two numeric columns qualify; the other becomes `rate` if its header matches the rate pattern).
  - Otherwise `{ kind: "unknown", mapping: null }`.

- [ ] **Step 1: Failing tests.** The Task 2 German WIDE grid → wide, `periodCols: [1,2]` (NOT the `Gesamt` column), `person: 0`. A LONG grid `[["Email","Month","Hours","Rate"],["a@x.de","2026-01","80","95"],…]` → long, `email: 0`, `period: 1`, `hours: 2`, `rate: 3`. A grid with a title row above the header (`[["Forecast Q1"],[],["Name","Jan 2026",…]]`) → `headerRow: 2`. A prose grid → unknown.
- [ ] **Step 2: Run** `npx vitest run src/app/budget-import/layout-detect.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: detect wide and long forecast layouts (§500)`.

### Task 4: Validator

**Files:**
- Create: `src/app/budget-import/forecast-validate.ts`
- Test: `src/app/budget-import/forecast-validate.test.ts`

**Interfaces:**
- Consumes: `ForecastRow`, `SheetGrid` (Tasks 1–2).
- Produces:
  - `export const MAX_IMPORT_HOURS_PER_CELL = 744;`
  - `export type RejectedRow = { row: ForecastRow | unknown; reason: "shape" | "hours" | "period" | "person" | "source" }`
  - `export function validateForecastRows(input: unknown, opts: { sheet: SheetGrid; requireSource: boolean }): { ok: ForecastRow[]; rejected: RejectedRow[]; duplicates: { person: string; period: string; count: number }[] }`
    - `input` must be an array; each element an object with string `person` (non-blank after trim), string `period` re-canonicalised by `parsePeriodLabel`, finite `hours` in `[0, 744]`, optional finite `rate ≥ 0`, optional string `email`.
    - `requireSource`: `source` must match `^<sheet.name>!([A-Z]{1,3})([1-9]\d*)$` AND address a cell inside `sheet.rows` whose `parseNumberCell` (either style) equals `hours` within 0.005 — a row that cites a cell holding a different number is `source`-rejected (the model invented or computed it).
    - Same `person` (case-insensitive trim) + `period` → summed into one row; listed in `duplicates`.

- [ ] **Step 1: Failing tests.** Non-array → all rejected `shape`. Hours `-1`, `745`, `NaN` → `hours`. Period `"Q1"` → `period`. Claude-route rows: no source → `source`; `Sheet1!Z99` outside the grid → `source`; source cell holds 40 but row says 80 → `source`; matching cell → ok. Review Focus 3: two rows `Ann`/`ann ` for `2026-01` (40 + 20) → one row of 60 and `duplicates: [{ person: "Ann", period: "2026-01", count: 2 }]`.
- [ ] **Step 2: Run** `npx vitest run src/app/budget-import/forecast-validate.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: validate forecast rows from either import route (§500)`.

### Task 5: Working-day period split

**Files:**
- Create: `src/app/budget-import/period-split.ts`
- Test: `src/app/budget-import/period-split.test.ts`, `src/app/budget-import/period-split.property.test.ts`

**Interfaces:**
- Consumes: `periodKeyForDate`, `generatePeriods`, `workdaysInRange` (`resource-capacity.ts`).
- Produces: `export function splitToGranularity(period: string, hours: number, target: PlanGranularity, holidaySet: ReadonlySet<string>): { key: string; hours: number }[]`
  - Source period → its dates (month: 1st..last; week: Monday..Sunday). Same granularity as `target` → `[{ key: period, hours }]`.
  - Otherwise each workday (Mon–Fri, not in `holidaySet`) maps to `periodKeyForDate(day, target)`; shares are `hours × workdays_in_key / total_workdays`, rounded to 2 decimals, and the rounding remainder is added to the LAST key so the sum equals `hours` exactly (to 2 decimals).
  - A source period with ZERO workdays falls back to calendar days. `hours === 0` → one `{ key: <first target key>, hours: 0 }` so a deliberate zero still overwrites.
  - Output ordered by key.

- [ ] **Step 1: Failing tests.** `splitToGranularity("2026-01", 100, "month", ∅)` → identity. `("2026-01", 88, "week", ∅)` → Jan 2026 has 22 workdays; weeks W01 (Jan 1–2: 2 days) → 8, W02–W04 → 20 each, W05 (Jan 26–30: 5 days) → 20; sum 88. Review Focus 4: same with `holidaySet = {"2026-01-06"}` → 21 workdays, W02 gets 4/21 of 88, sum still exactly 88. `("2026-W01", 40, "month", ∅)` → W01 2026 is Dec 29 2025 – Jan 4 2026: `2025-12` gets 3/5, `2026-01` gets 2/5. Zero hours → single zero entry.
- [ ] **Step 2: Property test** (seeded: `fc.assert(..., { seed: 500, numRuns: 200 })`): for random month or week keys in 2024–2028, hours in `[0, 744]` with 2 decimals, and random holiday subsets, `Math.round(sum*100) === Math.round(hours*100)` and every share `≥ 0`.
- [ ] **Step 3: Run** `npx vitest run src/app/budget-import/period-split.test.ts src/app/budget-import/period-split.property.test.ts` → FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** `feat: working-day split between month and week periods (§500)`.

### Task 6: Import plan and apply

**Files:**
- Create: `src/app/budget-import/forecast-plan.ts`
- Test: `src/app/budget-import/forecast-plan.test.ts`

**Interfaces:**
- Consumes: `ForecastRow` (Task 2), `splitToGranularity` (Task 5), workspace types.
- Produces:
  ```ts
  export type PersonOverride = number | "skip";            // resource id, or skip
  export type ImportCtx = {
    bucket: BudgetBucket; resources: readonly Resource[]; roles: readonly Role[];
    plan: ResourcePlan; holidaySet: ReadonlySet<string>;
    overrides: ReadonlyMap<string, PersonOverride>;        // key: normalised sheet person
  };
  export type AllocationKey = { kind: "role"; roleId: number } | { kind: "discipline"; disciplineId: number };
  export type CellChange = { alloc: AllocationKey; period: string; old: number | undefined; next: number };
  export type UnresolvedPerson = { person: string; email?: string; why: "no-match" | "ambiguous" | "no-role"; candidates: number[] };
  export type RateNote = { person: string; resourceId: number; sheetRate: number; internalRate: number; externalRate: number };
  export type ImportBlocker = "follows-plan" | "closed" | "nothing-to-apply";
  export type ImportPlan = {
    changes: CellChange[]; unresolved: UnresolvedPerson[]; skipped: string[];
    outOfRange: { person: string; period: string }[]; rateNotes: RateNote[];
    addResources: { alloc: AllocationKey; resourceIds: number[] }[];
    newAllocations: AllocationKey[]; blockers: ImportBlocker[]; hoursDelta: number;
  };
  export function normalisePerson(s: string): string;      // lower-case, trim, collapse whitespace
  export function buildForecastImportPlan(rows: readonly ForecastRow[], ctx: ImportCtx): ImportPlan;
  export function applyForecastImport(bucket: BudgetBucket, plan: ImportPlan): BudgetBucket;
  ```
  - Matching order: override; else `email` against `Resource.email` and `Resource.emails` (case-insensitive); else `normalisePerson(firstName + " " + lastName)`. Zero → `no-match`; >1 → `ambiguous` with `candidates`; matched but `roleId == null` → `no-role`. Unresolved and `skip` rows contribute nothing.
  - Routing: `bucket.planningMode === "blended"` → `{ kind: "discipline", disciplineId: role.disciplineId }`, else `{ kind: "role", roleId }`.
  - Periods: `splitToGranularity(row.period, row.hours, plan.granularity, holidaySet)`; a target key whose period lies outside `bucket.startDate..bucket.endDate` (compare the period's start/end from `generatePeriods`) goes to `outOfRange`.
  - Aggregate per alloc × key (sum, round 2); `old` = the stored `budgetHours[key]`; changes where `old === next` are omitted. `hoursDelta` = Σ(next − (old ?? 0)).
  - `rateNotes`: rows with `rate` whose relative difference from BOTH the role's `internalRate` and `externalRate` exceeds 0.005.
  - Blockers: `plan.budgetFollowsPlan === true` → `follows-plan`; `bucket.status === "closed"` → `closed`; `changes.length === 0` → `nothing-to-apply`.
  - `applyForecastImport` returns a NEW bucket: allocations it touches are new objects with new `budgetHours` maps; untouched allocations and the whole bucket's other fields are carried BY REFERENCE; a missing allocation is created with `resourceIds` from `addResources`, `budgetHours` from the changes, `actualHours: {}`; matched people are appended to `resourceIds` without duplicates. It never reads `plan.blockers` — the caller must not call it when blockers exist (asserted by the modal, Task 8).

- [ ] **Step 1: Failing tests.** Email match beats a same-name different person; name match is whitespace/case-insensitive; two `Ann Lee` resources → `ambiguous` with both ids; role-less → `no-role`; override to a resource id resolves; override `skip` drops. Detailed vs blended routing. Two people of one role in one month → one change of the sum. A cell equal to its stored value is omitted; a stored cell for another month is untouched. Period outside the bucket → `outOfRange`. Rate 100 vs role internal 100 → no note; 120 vs internal 100 / external 150 → note. Each blocker alone. `applyForecastImport`: returns a new object, an untouched allocation is `toBe` the original, a new allocation has `actualHours: {}`, `resourceIds` deduped.
- [ ] **Step 2: Run** `npx vitest run src/app/budget-import/forecast-plan.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: build and apply a forecast import plan (§500)`.

### Task 7: Claude route and the `forecastImport` guide target

**Files:**
- Modify: `src/app/operating-guide.ts` (`AI_TARGETS` gains `"forecastImport"`), `scripts/gen-operating-guide.mjs` (`VALID_ACTION_TARGETS` gains it; regenerate `operating-guide-builtin.generated.ts` with `node scripts/gen-operating-guide.mjs`), `src/app/settings-sections/ai-guides-section.tsx` (label map gains `forecastImport: "aiGuideTargetForecastImport"`), `src/app/i18n.ts` + `src/app/i18n.de.ts` (`aiGuideTargetForecastImport`: EN "Forecast import", DE "Prognose-Import")
- Create: `src/app/forecast-import-call.ts`
- Test: `src/app/forecast-import-call.test.ts`; extend `src/app/operating-guide-targets.test.ts`

**Interfaces:**
- Consumes: `runForcedToolCall` (`ai-forced-call.ts`), `extractXlsx`, `SheetGrid`.
- Produces:
  - `export const FORECAST_ROWS_TOOL` — name `propose_forecast_rows`; input schema `{ rows: { person: string, email?: string, period: string, hours: number, rate?: number, source: string }[] (required), notes?: string }`.
  - `export function sheetToPromptText(sheet: SheetGrid): string` — the sheet as the same Markdown table form `extractXlsx` renders, prefixed by `Sheet: <name>` and a column-letter header row (`A`, `B`, …) so the model can cite `Sheet!B7`.
  - `export async function runForecastImportCall(sheet: SheetGrid, ai: { apiKey: string; model: string; guideText?: string }, signal?: AbortSignal): Promise<{ rows: unknown; notes: string }>` — `maxTokens` 8192; system prompt (exact): `"You read a project forecast spreadsheet and return one row per person and period with the hours planned. Copy values exactly as written; never compute, total or estimate. Every row must cite the cell its hours came from as Sheet!A1. Skip totals, subtotals and blank cells. If anything is ambiguous, leave it out and explain in notes."`. Returns the raw `rows` for `validateForecastRows(…, { requireSource: true })`.

- [ ] **Step 1: Failing tests.** Mock `fetch`: the request forces `propose_forecast_rows`, the user message contains `Sheet: S` and a cell value, a `guideText` appears as the last system block; abort passes the signal. `operating-guide-targets.test.ts`: `forecastImport` is a valid target and a guide targeting it reaches `actionGuideText("forecastImport")` but not `"chat"`.
- [ ] **Step 2: Run** `npx vitest run src/app/forecast-import-call.test.ts src/app/operating-guide-targets.test.ts` → FAIL.
- [ ] **Step 3: Implement**; regenerate the built-in guides; `npx tsc --noEmit` (i18n parity).
- [ ] **Step 4: Run** the same files plus `src/app/settings-sections/ai-guides-section.test.tsx` → PASS.
- [ ] **Step 5: Commit** `feat: Claude reads a forecast sheet, steered by forecastImport guides (§500)`.

### Task 8: Import modal and entry point

**Files:**
- Create: `src/app/forecast-import-modal.tsx`, `src/app/use-forecast-import.ts`
- Modify: `src/app/budget-panel-bucket-card.tsx` (an "Import forecast…" `Button` in the card's header actions, hidden when `bucket.status === "closed"` or `isPopout`), `src/app/budget-panel.tsx` (modal state + mount; passes `onChangeBuckets`), `src/app/i18n.ts` + `src/app/i18n.de.ts` (keys `forecastImport*`)
- Test: `src/app/forecast-import-modal.test.tsx`, `src/app/use-forecast-import.test.ts`, extend `src/app/budget-panel.test.tsx` (the card has no test file of its own)

**Interfaces:**
- Consumes: Tasks 1–7; `useSettings` + `isAiEnabled` / `aiKeyIfEnabled` (`settings-types.ts`, used as `use-raci-suggest.tsx` does); `useActionGuideText("forecastImport")`; `ResourcePicker`; `buildRowTokens`.
- Produces:
  - `useForecastImport(deps: { bucket: BudgetBucket; buckets: readonly BudgetBucket[]; resources; roles; plan; holidaySet; onChangeBuckets: (next: BudgetBucket[], meta?: BucketCommitMeta) => void })` → `{ step, sheets, sheetIndex, mapping, setMapping, route, overrides, setOverride, importPlan, rejected, dropped, notes, error, busy, loadFile(file: File), askClaude(), cancel(), apply(): "applied" | "refused" }`.
  - `apply()` rebuilds `buildForecastImportPlan` from the LIVE `buckets` (looks the bucket up by id); bucket missing, closed, or any blocker → returns `"refused"` and writes nothing; else ONE `onChangeBuckets(buckets.map(b => b.id === id ? applyForecastImport(b, plan) : b), { kind: "budget.updated", name: bucket.name })`.
  - `ForecastImportModal({ lang, open, onClose, ...deps })` — steps Source → (Mapping | Claude) → Preview → Apply as in spec §3.4; file input `accept=".xlsx,.xlsm,.csv"`; size checked with `checkAttachmentSize` before reading; "Ask Claude" disabled with a reason when AI is off or no key; Cancel aborts an in-flight call without an error.

- [ ] **Step 1: Failing hook tests** (`renderHook`): a WIDE csv `File` loads to `step: "preview"` with the detected mapping; `apply()` calls `onChangeBuckets` exactly once with `kind: "budget.updated"`; Review Focus 5: rerender with `buckets` where the target is `status: "closed"` (and separately `plan.budgetFollowsPlan: true`) → `apply()` returns `"refused"` and `onChangeBuckets` is not called; `askClaude()` with mocked fetch returning one good and one source-less row → one row in the plan, one in `rejected`.
- [ ] **Step 2: Failing modal tests** (RTL): unresolved people render one picker each with DISTINCT accessible names when two rows share a sheet name prefix; the blocker notice disables Apply; the card shows "Import forecast…" for an open bucket and not for a closed one.
- [ ] **Step 3: Run** `npx vitest run src/app/use-forecast-import.test.ts src/app/forecast-import-modal.test.tsx src/app/budget-panel.test.tsx` → FAIL.
- [ ] **Step 4: Implement**; i18n both dictionaries via node utf8 for DE.
- [ ] **Step 5: Run** → PASS, then `npx tsc --noEmit` and eslint on the changed files.
- [ ] **Step 6: Commit** `feat: forecast import modal on the budget bucket card (§500)`.

### Task 9: Mutation proof, docs and register

**Files:**
- Modify: `docs/AGENTS/budget.md` (a "Forecast import" section: the two routes, one validator, `applyForecastImport` as the only writer, the follows-plan blocker, the live re-plan on Apply), `docs/AGENTS/ai-assistant.md` (the `forecastImport` target), `CHANGELOG.md` (Unreleased entry), `docs/open-followups.md` (§500 CLOSED with the mutation tally and the no-e2e gap; rebuild the index with `node scripts/rebuild-followup-index.mjs`)

- [ ] **Step 1: Mutants** (each applied alone, the owning test file run, then reverted; record killed/survived): (a) drop the `follows-plan` blocker; (b) drop the `closed` blocker; (c) `apply()` uses the open-time plan instead of rebuilding; (d) `validateForecastRows` skips the source-cell value comparison; (e) `splitToGranularity` drops the remainder correction; (f) `gridToForecastRows` decides decimal style per cell. Every one must be killed; a survivor gets a test before proceeding.
- [ ] **Step 2: Docs + register**; `npm run docs:symbols:check`, `npm run followups:index:check`, `npm run docs:claims:check` — each exit 0.
- [ ] **Step 3: Commit** `docs: forecast import reference and §500 closure`.
