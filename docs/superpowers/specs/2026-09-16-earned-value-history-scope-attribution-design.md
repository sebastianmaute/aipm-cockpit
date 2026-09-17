# Earned-value history and scope attribution — design

**Date:** 2026-09-16
**Status:** approved in brainstorming 2026-09-16; spec awaiting review
**Closes:** §549 (GitLab #339), §469 (GitLab #298)
**Builds on:** `docs/superpowers/specs/2026-09-15-forecast-chart-hours-design.md` (MR 3, shipped 1.7.0) and the
§550 fix shipped in 1.7.1
**Next slice, out of scope here:** §545 with §463 and §509

**Amended during planning (2026-09-16):** rulings R1–R4 (recorded in this slice's `constraints.md`)
fill gaps this spec left, and shipped code took precedence where they diverge. §4.3's baseline-writer
and undo bullets, §5.1, §5.3 and the §6 undo row below are corrected to match what shipped, not the
original wording.

## 1. Problem

Two gaps in the budget forecast shipped in 1.7.0.

1. **Hand-entered progress has no history (§549).** The cumulative chart rebuilds each bucket's earned value per
   period from the completion dates of its linked tasks. A bucket whose percent complete is typed in by hand has
   no dated record, so `budget-ev-history.ts` returns `manual-percent` and the chart draws **no earned-value line
   at all**. One such bucket suppresses the line for the whole project.
2. **Variance at completion blends two different things.** When budget grows, the headline variance moves, and a
   reader cannot tell whether the team is performing worse or the project was given more scope. A top-up can
   read as a performance problem, and a performance problem can hide behind a top-up.

A third, smaller item rides along: `SnapshotRecord.currency` is written on every capture and read by nothing
(§469). Reading it would bring back the mislabel §465 fixed, so the field is **deleted**.

## 2. Decisions taken in brainstorming

| # | Decision | Rejected alternatives |
|---|---|---|
| D1 | Record **per-bucket percent complete on each Turso snapshot** | derive from the activity log (clearable, replaced on load) |
| D2 | Earned-value line rule **1A′**: draw from project start and never truncate; a span with no record for an active bucket is drawn **partial** and names the buckets responsible | 1A (start where every bucket has data, which discards real history), 1B (full line, no explanation), 1C (linked buckets only), 1D (two lines) |
| D3 | Add a **bucket creation date** (`createdDate`, `YYYY-MM-DD`). Absent means unknown; **never backfilled** | a first-seen date inferred from snapshots |
| D4 | Variance at completion is split into **performance + attributed scope + unattributed** (layout 2C), and each dated budget change is **marked and named with its amount on the chart** (the attribution from 2B) | a two-part split (misfiles any change it cannot see); reconstructing budget history from creation dates alone (cannot see a top-up to an existing bucket) |
| D5 | Budget history is an **event-recorded series** held in the workspace, written when a budget change happens, and **separate from the activity log** | a column on the snapshot row (Turso only, tied to capture cadence, blind to changes between captures) |
| D6 | §469: **delete** `SnapshotRecord.currency` | read it in Trends (reintroduces §465's mislabel) |
| D7 | Surfaces: **both forecast cards** (hours and value) show the split; the **chart** shows the markers; the dashboard tile keeps the headline only | tile carries the split too |

## 3. Scope and staging

One spec, **two implementation stages**. Each stage can be reviewed and released on its own.

- **Stage 1 — storage foundations:** the creation date (§4.1), per-bucket percent on snapshots (§4.2), the
  budget-at-completion event series (§4.3), and deleting the snapshot currency field (§4.4). This stage makes no
  visible change beyond the data becoming available.
- **Stage 2 — surfaces:** the 1A′ earned-value line (§5.1), the three-part variance on the cards (§5.2), and the
  chart markers (§5.3).

Stage 1 must merge first. Stage 2 consumes its data and must not ship without it.

## 4. Stage 1 — storage

### 4.1 Bucket creation date

- New optional field `BudgetBucket.createdDate?: string` (`YYYY-MM-DD`), next to `startDate`, `endDate` and
  `closedDate`. It is a date and not a timestamp: periods are dated, so a clock time adds nothing.
- **Meaning:** the day the bucket started to exist in this workspace. It is **not** the day the work started, and
  that difference is the point. A bucket created in month 7 whose start date is backdated to month 1 is saying
  something true: the work began in month 1, and nothing was recorded before month 7.
- **Absent means unknown.** Buckets that exist today stay without a date. No migration and no backfill guess it,
  because a guessed date would claim knowledge nobody has.
- **Persistence:** this is a new column on an existing entity, so it follows the AGENTS.md "New COLUMN on existing
  entity" rule: `*_CSV_COLUMNS` plus the field codecs in `csv-codecs-core.ts` (this also covers both Turso layouts),
  the Markdown codec, `sanitize.ts` (reject anything that is not a valid `YYYY-MM-DD`, dropping it to absent),
  regenerated golden fixtures, and `turso-migrate.ts` self-heal for existing databases.
- **Writers:** every path that **creates** a bucket must set it to today's date in the project's calendar. At
  minimum these are the Budget panel's add action (`budget-panel.tsx`, which emits `budget.created`) and
  `use-budget-buckets.ts`. The plan must list **every** creator repo-wide before implementation, including AI
  tools, templates (`templates.ts` seeds budgets), workspace import and `scaleWorkspace`, and rule on each one:
  - A **template seed** keeps any date the template carries; otherwise the bucket gets the date it is
    instantiated in the workspace.
  - **Import** keeps the imported value. It never stamps today, because an import is not a creation.
  - **Updates never change `createdDate`.** A test must pin that.

### 4.2 Per-bucket percent complete on snapshots

- `SnapshotRecord` gains `bucketProgress: { bucketId: number; pctComplete: number }[]`. It holds **every
  bucket's** percent complete as the engine resolves it at capture time: the manual override if one is set,
  otherwise the value derived from linked tasks. Recording both kinds keeps a single reader.
- It is stored as a JSON text column on the Turso `snapshot` table (`snapshot-schema.ts`), next to
  `milestones_json`. It must be added to the DDL, the ordered column list, the encode and the decode together;
  §469 records that editing one without the others writes values into the wrong column.
- **Existing databases:** `snapshot-schema.ts` has no ALTER self-heal today. The plan must add one, mirroring
  `turso-migrate.ts`'s PRAGMA diff, or a save against an existing snapshot table will fail on the named-column
  INSERT.
- Decode tolerates the column being missing, null or malformed and yields `[]`. A snapshot with `[]` means "no
  record", never "0 %".
- This data exists on Turso only, the same as Snapshots and Trends, and follows the same
  `tursoConfig !== null` gating.

### 4.3 Budget-at-completion event series

- New persisted workspace slice `Workspace.budgetHistory: BudgetHistoryEntry[]`:

  ```ts
  type BudgetHistoryEntry = {
    id: string;                 // unique
    at: string;                 // ISO timestamp of the change
    date: string;               // YYYY-MM-DD, the period key source
    kind: "baseline" | "created" | "updated" | "deleted";
    bucketId: number | null;    // null only for "baseline"
    bucketName: string;         // name at the time, for markers after deletion
    projectBacHours: number;    // project own-basis BAC after the change
    projectBacValue: number;    // EUR, after the change
    deltaHours: number;         // change this event caused (0 for baseline)
    deltaValue: number;         // EUR
  };
  ```

- **No stored currency.** Values are EUR by construction because the engine converts at its single read (§465).
  Storing a currency next to them would lay the §469 trap again.
- **Basis:** the project **own-basis** figures from 1.7.1, meaning the rollup of `ownBudget`. Closing a bucket
  therefore moves nothing and writes no entry, because since §550 a close is not a budget change.
- **When it is written:** in the same handler that logs `budget.created`, `budget.updated` or `budget.deleted`. It
  is written **after** the change is applied and **only if the project own-basis BAC actually moved**, which keeps
  renames and non-budget edits out of the series. The delta is the BAC after the change minus the BAC before it,
  computed from the engine. It is never computed from the edited fields, because budget hours derive from
  allocations, capacity, absences and holidays.
- **Baseline entry:** when a workspace has buckets but an empty series, one `baseline` entry records the current
  BAC and marks the day recording began. Every later split is measured from it. **Amended (R1):** the single writer
  is the budget commit boundary — the first recorded change seeds the `baseline` entry from the BAC *before* that
  change. There is no forecast-time writer: that would be a write during render, and forecasts are also computed in
  read-only popouts. Consequence, stated here because it is user-visible: until someone edits a budget the cards show
  the "no history yet" note, and a project whose budget never changes never gets the split.
- **Retention:** keep everything. The size is bounded by how often budgets change, not by elapsed time.
- **Why it is separate from the activity log:** a user can clear that log, and `applyWorkspace` replaces it on load
  by default. It is a witness, not a ledger. `budget.updated` entries may **explain** an amount the series cannot
  attribute, but they never **measure** it.
- **Persistence:** this is a meta-blob slice like `activityLog`, so it needs **all six write paths by hand** (JSON,
  CSV, Markdown, Turso single, Turso tenant and IndexedDB), plus both load funnels and a sanitiser that drops
  malformed entries. It stays out of `TABLE_NAMES`. `isWorkspaceEmpty` must **not** count it, for the same reason
  it does not count `activityLog`. Whether it appears in exports is ruled in the §545 slice; in this slice it is
  storage-only.
- **Undo:** **Amended (R2):** reverting a budget change through the undo stack does NOT record an entry — undo sets
  the budgets array directly and never passes the commit boundary that writes the series, so its BAC movement
  surfaces as **unattributed** variance instead. Same for a version restore and for applying a project template.
  Entries are never deleted. (The §6 table's undo row states the same ruling.)

### 4.4 Delete `SnapshotRecord.currency` (§469)

- Remove the field from `SnapshotRecord`, from the builder's input and write, and from `snapshot-schema.ts` (the
  DDL, the column list, the encode and the decode), together with the writer `currency: plan.currency` in
  `task-manager.tsx`.
- **Existing databases** keep a `currency` column that nothing writes any more. It is a plain nullable column
  (`currency TEXT`, no index, no key) and the INSERT names its columns, so leaving it is harmless.
- **The column is NOT dropped in this slice, because dropping it is not safe yet.** Mechanically the drop would be
  fine. The danger is **older clients writing to the same database**: a desktop build or a stale browser tab from
  before Stage 1 still sends `INSERT INTO snapshot (…, currency, …)`. Against a dropped column that statement fails,
  and a libSQL pipeline batch does not abort on a failing statement (AGENTS.md, "idKind" bullet). `appendStatements`
  would then **commit the `snapshot_series` rows without their `snapshot` row**. That leaves orphaned series data,
  which is worse than a failed capture. The web app updates on reload, but the desktop app can lag by releases,
  and nothing in the database records which client versions still write to it.
- **Drop it in a later release**, as the second half of a two-phase removal: stop writing now, drop once no client
  that writes the column can reach the database. That needs an enforceable guarantee (for example a minimum client
  version the app checks before writing), not the passage of time. Tracked as §551 (GitLab #341).
- Rewrite the long comment block in `trends-panel.tsx` so that it says why the reader is EUR, **without**
  describing a field that no longer exists.
- This is one table, not the six workspace write paths (`snapshot` is outside `TABLE_NAMES`).

## 5. Stage 2 — surfaces

### 5.1 Earned-value line, rule 1A′

For each bucket in each period `p`:

| Situation | Contribution | Line in `p` |
|---|---|---|
| `p` ends before the bucket's `startDate` | 0 (no such work in the plan) | complete |
| Percent derived from linked tasks | from task completion dates (unchanged from MR 3) | complete |
| Manual percent **with** a snapshot record at or before the end of `p` | latest recorded `pctComplete` × own-basis budget | complete |
| Manual percent, active, **no** record yet | unknown, contributes 0 | **partial** |

- **Partial span:** consecutive partial periods draw dashed, with a label naming the buckets responsible
  ("partial: Vendor not recorded").
- **Join label:** the first period in which a previously partial bucket gains a record is labelled with the
  amount it brings in ("Vendor joins +120 h"). Without that label, work that predates the record would read as a
  sudden delivery.
- **What the creation date adds to the label:** if `createdDate` is known and falls after `startDate`, the partial
  span reads "created <date>". Otherwise it reads "not recorded". This separates "added later with its start
  backdated" from "recording started late". It changes the wording only, never the line.
- **Undated buckets** (no `startDate`) keep `bucketActivePeriods`' fall-back to every period, so a manual undated
  bucket is partial until its first record. That is the honest reading: the chart should not claim history it
  never had.
- This replaces today's all-or-nothing `manual-percent` state in `budget-ev-history.ts`. The old
  `"manual-percent"` and `"no-linked-tasks"` reasons are removed; one `"no-earned-value"` reason
  remains (ruling R3).
- **Amended (R3):** `available: false` is precise, not "partial at every point" — it is kept only
  when **at least one budgeted bucket exists and none of them has a known value AT TODAY**
  (`computeEvHistory`'s `tracked.length > 0 && tracked.every(...)` guard in `budget-ev-history.ts`;
  with zero tracked buckets the history stays available, trivially, with nothing to draw). A bucket
  is unknown at today when it has **neither a hand-entered percent nor any resolvable task link**
  (`bucketPercentComplete` returns `null`: no `percentComplete` set, and either no `taskIds` at all —
  `blankBucket`'s default shape — or every linked task has been deleted). A bucket that is merely
  partial in *earlier* periods but known today does not trip this state.
- Hours and value use the same rule, on the own basis (1.7.1).

### 5.2 Three-part variance on both forecast cards

Let `B0` be the BAC recorded in the baseline entry, `B` today's own-basis BAC, and `EAC` the forecast estimate at
completion.

```
headline      VAC = B − EAC                  (unchanged, still the headline)
performance       = B0 − EAC
attributed scope  = Σ deltas of created/updated/deleted entries after the baseline
unattributed      = (B − B0) − attributed scope
check:  performance + attributed + unattributed = VAC        (exact, by construction)
```

- The split renders beneath the headline on **both** cards: hours from `projectBacHours`, value from
  `projectBacValue`.
- **Unattributed** is shown only when it is not zero, rounded in the card's unit. It carries an explanation that
  may list the `budget.updated` log entries in the same window, as a witness only. Typical causes are capacity,
  absence or holiday changes that move computed budget without anyone editing a bucket, and edits made before
  recording began.
- **No baseline yet** (empty series): the card shows the headline only, with a note that the split starts once
  budget history is recorded.
- The split covers the period since the baseline date, and the card names that date ("since 16 Sep 2026").
- The dashboard tile shows the headline only.
- New strings go into `i18n.ts` and `i18n.de.ts` with key parity. The DE file is edited only through a Node UTF-8
  script with `\r\n` anchors.

### 5.3 Chart markers

- The budget-at-completion line steps at each recorded entry's period. Each step is marked and named with its
  signed amount ("+300 h scope", "−80 h Vendor removed"), using `bucketName` from the entry so the name survives
  the bucket's deletion.
- The baseline BAC is drawn as a dashed reference line. The gap between the two lines is the attributed plus
  unattributed change.
- Several entries in one period combine into a single marker, and its label lists them.
- **Amended (R4):** no table existed to extend, and per-period performance needs a per-period EAC,
  which is not recorded — so "gains performance, scope and unattributed columns per period" does not
  match what shipped. `BudgetChangeTable` lists one **row per recorded change** (not per period),
  columns date · bucket · signed change · cumulative attributed scope, ordered by `at`
  (`orderBudgetChanges`, never array order — a second-device union is not chronological). Its
  **footer** carries the summary instead of per-row columns: performance, attributed and
  unattributed **as of today**, from the pace forecast's own split.
- Markers need an accessible name, and colour must not be the only cue. The chart's existing text alternative
  carries the marker list.

## 6. Edge cases

| Case | Handling |
|---|---|
| Closing a bucket with a successor | no BAC change since §550, so no entry and no marker |
| Deleting a bucket | a `deleted` entry with a negative delta; the marker keeps the name |
| Capacity, absence or holiday change moves BAC | not a logged budget change, so it lands in **unattributed** (by design) |
| Fixed-price bucket | own `budgetValue` is the contract amount in EUR (§465, §550); deltas follow the engine |
| Bucket created with a backdated start | partial span labelled "created <date>" (§5.1) |
| Undo of a budget change, a version restore, or applying a project template with seed data | **Amended (R2):** none of the three writes an entry — undo, version restore (`applyRestoredWorkspace`) and `handleApplyTemplate` (`task-manager.tsx`) all set the budgets array directly and bypass the commit boundary (`commitBuckets`), which is the series' only writer. Each one's BAC movement surfaces as **unattributed** variance instead; history stays append-only for what it DOES record |
| Two tabs editing budgets | each writes its own entry; merge follows the workspace's existing save semantics; the plan must check this against the §548 first-load race |
| Read-only popout | writes nothing |
| File backends | §4.1 and §4.3 work everywhere; §4.2, and so manual-bucket history, is Turso only, and file users see manual buckets as partial for their whole span |

## 7. Testing

- **Engine:** a table test for the four 1A′ rows. The closed-split identity must hold exactly on property-based
  inputs. The delta must come from the engine and not from the edited fields: a pure capacity change writes **no**
  entry and shows up as unattributed.
- **Persistence:** `createdDate` round-trips on all six paths, and `budgetHistory` round-trips on all six paths
  with each one **counted per slice**. The snapshot column must round-trip through the real statements
  (`node:sqlite`, as `turso-schema.execute.test.ts` does), including the self-heal against a table created
  without it. After §4.4, the absence of `currency` is checked alongside a positive observable.
- **Writers:** every creator enumerated in §4.1 sets the date, and updates leave it alone. Every budget handler
  writes exactly one entry when BAC moves and none when it does not.
- **Surfaces:** the card split in both units, the no-baseline note, the partial styling with its label, the join
  label, marker names after a deletion, and DE strings (`loadI18n("de")`).
- **Mutation-prove** the identity check, the "only if BAC moved" guard, and the partial-vs-zero distinction.

## 8. Out of scope

- §545: the AI dashboard snapshot and exports carrying forecast figures, including whether `budgetHistory` is
  exported.
- §463 and §509: export coverage and export targets.
- Backfilling creation dates or budget history for existing data.
- Dropping the dead `currency` column from existing Turso databases. This is deferred as unsafe while older
  clients can still write to it (§4.4), and is tracked as §551.
