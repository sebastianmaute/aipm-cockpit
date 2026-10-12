# Forecast import — design (§500)

**Register:** §500 · **Work item:** #39 · **Status:** approved in conversation 2026-10-12, awaiting spec review

## 1. Problem and intent

Budget forecast hours are typed into each bucket by hand, cell by cell. A PM who already holds the
forecast in a spreadsheet (resources × months × hours, often with a rate) must re-enter it. The
2026-09-11 demo asked for an import. No sample sheet exists in the repo or the issue, so the design
accepts two common shapes and lets Claude read anything else.

**Success:** a PM picks a sheet and a target bucket, sees exactly which role × period cells change
(old → new), resolves any person the app cannot match, and applies the import as ONE undoable step.
Nothing outside the target bucket's budget hours (and the resources listed on its allocations)
changes.

**Decisions taken with the owner (2026-10-12):**

| Question | Decision |
|---|---|
| Sheet shape | Both WIDE (row per person, column per period) and LONG (row per person × period), auto-detected, mapping editable |
| Rate column | CHECK ONLY — compared against the role rate, mismatches listed; nothing writes a rate |
| Existing hours | REPLACE COVERED CELLS — a role × period cell the sheet covers is overwritten; every other cell kept |
| Unmatched person | PICK PER ROW — map to an existing person or skip; unresolved rows are skipped and reported |
| Other shapes | An alternative "Ask Claude" route that reads the sheet and returns the same rows |

## 2. Non-goals

- Writing role rates, bucket rate overrides, `fixedPriceAmount`, `plan.currency` or FX (the rate column is
  informational; §476 owns currency).
- Importing ACTUAL hours (TimeLog Apply owns those).
- Creating resources, roles or buckets. A role allocation missing from the target bucket IS created —
  that is a budget-hours row, not a new entity.
- Exporting a forecast template. (Worth a follow-up: an export of the bucket in the WIDE shape would make
  a round trip trivial.)
- A chat tool. The assistant cannot write buckets today and this does not change that; the Claude route
  lives inside the importer, behind the same preview.

## 3. Architecture

Both routes stop at one intermediate list, so the model can never write something the hand route could
not, and every safety rule lives in code shared by both.

```
file ──► sheet-grid ──► layout-detect ──► forecast-rows ──┐
                │                          (hand route)   │
                └──► extractXlsx (Markdown) ──► Claude ───┤  ForecastRow[]
                                          (Claude route)  │
                                                          ▼
                                              validateForecastRows
                                                          ▼
                                     buildForecastImportPlan (workspace) ──► preview ──► commitBuckets
```

### 3.1 Pure modules (`src/app/budget-import/`, i18n-free)

| Module | Responsibility |
|---|---|
| `sheet-grid.ts` | `.xlsx`/`.xlsm` → `{ name, rows: string[][] }[]` per sheet; `.csv` → one sheet. XLSX reuses `xlsx-extract.ts`'s `sheetRows` (exported as `extractXlsxGrid`, so the Markdown path and the grid path read cells identically). CSV is read by a small delimiter-aware reader of its own (RFC 4180 quoting; `;` or `,` detected from the first non-blank line, since German Excel writes `;`). ★ The workspace codec `parseCsv` (`csv-codecs-core.ts`) is deliberately NOT changed: it sits on the byte-stable storage path pinned by `golden-workspace.test`. Cell caps follow `MAX_XLSX_SHEET_CELLS`. |
| `layout-detect.ts` | `detectLayout(rows) → { kind: "wide" \| "long" \| "unknown", mapping }`. WIDE: a header row where ≥3 cells parse as periods and data rows name a person. LONG: one column parses as periods in most rows and another as numbers. The mapping names the person / email / period / hours / rate columns (and header row index); the UI may override every field. |
| `forecast-rows.ts` | `gridToForecastRows(rows, mapping) → { rows: ForecastRow[], dropped: DropReason[] }`. Period labels: `2026-01`, `Jan 2026` / `January 2026` (EN + DE month names), `01/2026`, `1.2026`, an Excel date serial or ISO date (→ its month), and ISO week keys `2026-W03`. Numbers: the decimal convention is decided once per column (`1.234,5` vs `1,234.5`), never per cell. Blank cells are NOT covered; `0` is a real value. Rows whose person cell reads like a total (`Total`, `Summe`, `Gesamt`, `Σ`) or is blank are dropped and counted. |
| `forecast-validate.ts` | `validateForecastRows(rows, sheet) → { ok: ForecastRow[], rejected }` — finite, `0 ≤ hours ≤ MAX_IMPORT_HOURS_PER_CELL` (744 — the hours in a 31-day month, per person per period, before aggregation), a parseable period, a non-empty person, and (Claude route) a `source` cell reference that exists in the sheet. Duplicates (same person + period) are summed with a warning. Both routes pass through it. |
| `forecast-plan.ts` | `buildForecastImportPlan(rows, ctx) → ImportPlan` — see 3.2. |

```ts
type ForecastRow = {
  person: string;          // as written in the sheet
  email?: string;
  period: string;          // canonical "YYYY-MM" or "YYYY-Www"
  hours: number;
  rate?: number;           // informational only
  source?: string;         // "Sheet1!D7" — required on the Claude route
};
```

### 3.2 The import plan

`buildForecastImportPlan(rows, { bucket, resources, roles, disciplines, plan, workdayHours, holidaySet, overrides })`:

1. **Match people.** Email (case-insensitive) first, then full name (`firstName lastName`, case- and
   whitespace-insensitive). A person with no match, more than one match, or no `roleId` becomes an
   UNRESOLVED row. `overrides` (from the preview's per-row pickers) maps a sheet person to a resource id or
   to `skip`.
2. **Route.** Detailed bucket → the person's role allocation (`roleId`); blended bucket
   (`planningMode === "blended"`) → the allocation of that role's discipline.
3. **Convert periods** to `plan.granularity`. A source period becomes its working days (plan workday
   hours, holidays excluded), and its hours are spread across the target periods those days fall in,
   weighted by working days. Same granularity = identity. Hours are kept exact to 2 decimals; any rounding
   remainder lands on the last target period, so totals are preserved.
4. **Clip to the bucket.** Target periods outside `bucket.startDate..endDate` are reported and skipped.
5. **Aggregate** per role (or discipline) × target period — several people of one role sum into one cell.
6. **Diff.** For each covered cell: `{ allocationKey, period, old, new }`. Uncovered cells are untouched.
7. **Rate check.** For each matched person with a sheet `rate`, compare against the role's internal and
   external rate (plan currency); a difference beyond 0.5% is listed as `{ person, sheetRate, roleRate }`.
   Nothing is written.
8. **Blockers.** `plan.budgetFollowsPlan === true` (budget hours on allocations with people are DERIVED
   from capacity — `effectiveBudgetHours`, `budget-report.ts` — so imported hours would be invisible);
   bucket `status === "closed"`; zero applicable cells.

`applyForecastImport(bucket, plan) → BudgetBucket` returns a NEW bucket object: covered cells replaced,
missing allocations created (`actualHours: {}`), resolved people appended to `resourceIds` (deduped),
everything else carried by reference.

### 3.3 Claude route

`forecast-import-call.ts`: a forced tool call through `runForcedToolCall` (`ai-forced-call.ts`), tool
`propose_forecast_rows`, input schema `{ rows: ForecastRow[], notes?: string }`. The user message is the
sheet as Markdown from `extractXlsx` (CSV rendered through the same table form), capped by the existing
cell budget. The system prompt says: copy values, never compute or invent them; give every row its
`source` cell; leave anything ambiguous out and say so in `notes`. The result goes through
`validateForecastRows` exactly like the hand route; rows with a missing or out-of-sheet `source` are
rejected and reported.

- Respects the AI master switch and the key requirement, like every other forced call.
- Abortable (`AbortSignal`), and a cancelled call sets no error.
- New operating-guide target `forecastImport` (`AI_TARGETS`, `operating-guide.ts`), wired with
  `useActionGuideText("forecastImport")`, so the user's guides can steer the reading (§701).

### 3.4 UI — `ForecastImportModal`

Opened from the Budget panel's bucket card ("Import forecast…"), not shown on closed buckets or in
popouts (read-only). Steps, in one draggable `Modal`:

1. **Source** — file picker (`.xlsx,.xlsm,.csv`), sheet picker when there are several (default: the first
   sheet `detectLayout` does not call `unknown`), target bucket (preselected from the card).
2. **Route** — "Detect columns" (default) or "Ask Claude". `unknown` layout opens the mapping empty with
   "Ask Claude" offered.
3. **Mapping** (hand route) — the detected columns as selects, a 5-row sample showing what each row
   parses to.
4. **Preview** — blockers first; then unresolved people, each with a `ResourcePicker`-style picker
   (row-unique accessible names via `buildRowTokens`) or Skip; rate mismatches; skipped / out-of-range /
   rejected rows with reasons (and the `source` cell on the Claude route); the cell diff grouped by role,
   old → new, with a total-hours delta.
5. **Apply** — rebuilds the plan from LIVE state (the bucket may have changed while the modal was open);
   refuses with a message when the bucket is gone or closed; otherwise ONE `commitBuckets` call with
   `kind: "budget.updated"` and the bucket's name, so one undo entry and one activity row.

## 4. Error handling

| Condition | Behaviour |
|---|---|
| File over `MAX_ATTACHMENT_BYTES`, unreadable zip, not a spreadsheet | Error in the source step, nothing parsed |
| Sheet over the cell cap | Truncation notice; rows read up to the cap |
| No period / hours columns found | Mapping opens empty; Claude route offered |
| Hours negative, non-finite, over cap, or unparseable | Row rejected with reason, listed in preview |
| Person unmatched / ambiguous / no role | Unresolved row with picker; Skip by default |
| Period outside the bucket | Reported, skipped |
| `budgetFollowsPlan` on | Apply disabled, notice names the setting |
| Bucket closed or deleted before Apply | Apply refuses with a message, nothing written |
| Claude: no key, AI off, HTTP error, abort | Same handling as other forced calls; hand route still available |
| Claude: row without a valid `source` | Rejected and reported |

## 5. Testing

- **Pure tables:** both layouts; each period-label form (EN and DE month names, Excel serials, ISO weeks);
  decimal conventions per column; totals and blank rows; duplicates summed; the working-day split
  month → week and week → month including a holiday; email / name / ambiguous / role-less matching;
  blended routing; clipping to bucket dates; every blocker; `applyForecastImport` returns a new object and
  carries untouched allocations by reference.
- **Property:** the working-day split preserves total hours to 2 decimals over random periods and
  holiday sets (seeded).
- **Claude route:** mocked forced call returning good, invented (no `source`) and out-of-sheet rows; the
  validator's verdicts asserted; a `forecastImport` guide appears in the system prompt and a chat-only one
  does not.
- **Modal (RTL):** each step; row-unique picker names; Apply calls `commitBuckets` once; undo restores the
  bucket; Apply against a bucket closed after opening refuses.
- **Mutation:** each blocker and the `source` check, tallied in the register entry at closure.
- **Not covered:** no e2e / axe run — the seed carries no import and the modal is not in `A11Y_VIEWS`;
  recorded as a gap at closure.

## 6. Files

New: `src/app/budget-import/{sheet-grid,layout-detect,forecast-rows,forecast-validate,forecast-plan}.ts`,
`src/app/forecast-import-call.ts`, `src/app/forecast-import-modal.tsx`, tests beside each.
Changed: `xlsx-extract.ts` (export the grid), `operating-guide.ts` (`forecastImport` target) and the built-in guide targets,
`budget-panel-bucket-card.tsx` (the entry point), `i18n.ts` / `i18n.de.ts`, `docs/AGENTS/budget.md`,
`CHANGELOG.md`, `docs/open-followups.md` (§500).
