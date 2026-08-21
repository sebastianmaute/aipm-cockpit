# RAID Report — Design

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.18.0-raid-report`
**Context:** Sub-project **R1**. A steering-committee-grade overview of the RAID log opened in a popout window from the RAID panel. Mirrors the Resources Report (`resource-report.ts` + `resources-report.tsx`) shape. Ships as **0.18.0** with the `versionHighlightRaidReport` headline (codename **"Jemisin"** retained).

## Goal

Give a steering committee a dense, scan-friendly read of the RAID log without leaving the workspace. The report opens in its own window from the RAID panel's "Report" button and shows:

- 4 headline tiles — open counts per category (Risks / Assumptions / Issues / Dependencies)
- 6 summary tables — By Severity, By Status, By Owner, Top 10 Open, By Category, By Aging
- A drill-down toggle (Summary | Full Detail) that switches the body to a read-only per-item table

## Non-goals

- No editing in the report (open the main RAID panel for that).
- No filtering UI in this release — the report shows everything; filters can come later.
- No PDF / print stylesheet — out of scope for v1.
- No date-range scoping (the report reflects current state). "Closed this period" semantics are deferred.
- No category-specific risk-matrix visualization (probability × impact heatmap) — surfaced via the By Severity row instead.

## Architecture

Two new source files + small plumbing in existing files. Same shape as the Resources Report.

### `src/app/raid-report.ts` (new — pure compute)

```ts
import type { RaidItem, RaidCategory, RaidSeverity, RaidStatus } from "./types";

export type RaidTiles = {
  openR: number;
  openA: number;
  openI: number;
  openD: number;
};

export type RaidSeverityRow = {
  severity: RaidSeverity | "Unrated";
  risks: number;
  assumptions: number;
  issues: number;
  dependencies: number;
  total: number;
};

export type RaidStatusRow = {
  status: RaidStatus;
  count: number;                   // open count for that status value
};

export type RaidOwnerRow = {
  owner: string;                   // sentinel "__unassigned__" for empty owner
  openR: number;
  openA: number;
  openI: number;
  openD: number;
  total: number;
};

export type RaidCategoryRow = {
  category: RaidCategory;
  open: number;
  closed: number;                  // closed/resolved/realized/validated/delivered — anything terminal
  overdue: number;                 // open AND targetDate < today
};

export type RaidAgingRow = {
  bucket: "le30" | "31_60" | "61_90" | "gt90";
  open: number;
};

export type RaidTopRow = {
  id: number;
  category: RaidCategory;
  title: string;
  severity?: RaidSeverity;
  owner: string;                   // sentinel "__unassigned__" if blank
  ageDays: number;                 // days since raisedDate
  status: RaidStatus;
  targetDate?: string;
  overdue: boolean;
};

export type RaidDetailRow = {
  id: number;
  category: RaidCategory;
  title: string;
  severity?: RaidSeverity;
  status: RaidStatus;
  owner: string;
  raisedDate: string;
  targetDate?: string;
  closedDate?: string;
  ageDays: number;
  linkedTaskCount: number;
  overdue: boolean;
};

export const UNASSIGNED_OWNER = "__unassigned__";

export type RaidReport = {
  tiles: RaidTiles;
  bySeverity: RaidSeverityRow[];   // 4 or 5 rows (L/M/H/C, optionally + Unrated)
  byStatus: RaidStatusRow[];       // sorted by count desc
  byOwner: RaidOwnerRow[];         // sorted by total desc, then owner asc
  byCategory: RaidCategoryRow[];   // exactly 4 rows in R/A/I/D order
  byAging: RaidAgingRow[];         // exactly 4 rows in fixed bucket order
  topOpen: RaidTopRow[];           // top 10, ranked by severity then ageDays
  fullDetail: RaidDetailRow[];     // every item, sorted by category asc then id asc
};

export function computeRaidReport(
  items: readonly RaidItem[],
  today: string,                   // YYYY-MM-DD
): RaidReport;
```

The compute is pure and easy to test in isolation. The presentation layer maps the `UNASSIGNED_OWNER` sentinel to the i18n string `raidReportUnassigned`. The `bucket` enum values match the suffixes of the i18n keys (`raidReportAgingLE30`, `raidReportAging31_60`, …).

"Open" means status is not one of the terminal statuses for that category (encoded as a `TERMINAL_STATUSES_BY_CATEGORY` map). "Severity-rank" for Top 10: Critical=4, High=3, Medium=2, Low=1, missing=0. Tie-break by ageDays desc (older = more urgent), then by id asc. "Age" = `daysBetween(raisedDate, today)`, clamped to ≥ 0.

### `src/app/raid-report.tsx` (new — presentation)

```tsx
import { useMemo, useState } from "react";
import { computeRaidReport, UNASSIGNED_OWNER } from "./raid-report";
import { SegmentedControl } from "./segmented-control";
import { type Lang, t } from "./i18n";
import type { RaidItem } from "./types";

interface Props {
  lang: Lang;
  items: readonly RaidItem[];
  today: string;
}

type View = "summary" | "full";

export function RaidReportPanel({ lang, items, today }: Props) {
  const rep = useMemo(() => computeRaidReport(items, today), [items, today]);
  const [view, setView] = useState<View>("summary");
  // ...
}
```

Layout (Summary view):

1. Page heading `<h2>` + the Summary | Full Detail `SegmentedControl` in a flex row.
2. **Tiles row** — 4 `<Tile>` cards in a `grid-cols-2 sm:grid-cols-4` (matches Resources Report shape). Each: small uppercase label + large foreground value.
3. **By Severity** — 4 or 5 rows × 5 numeric columns (Risks | Assumptions | Issues | Dependencies | Total). Severity column gets the AIPM severity ramp chip (green/blue/purple/pink); the optional Unrated row uses `text-muted-foreground`. Numeric cells `tabular-nums`. Uses the Workload table chrome (sticky thead, surface-muted, uppercase tracking-wide, `px-3 py-2 font-medium`).
4. **By Status** — single row per non-zero status, sorted by count desc. Status column shows status text only (no chip — status is per-category and visual encoding would be busy).
5. **By Owner** — owner + per-category open counts + total, sorted by total desc. The `UNASSIGNED_OWNER` sentinel is mapped to `t(lang, "raidReportUnassigned")` and rendered in italic.
6. **Top 10 Open** — mini per-item table (id, category chip, title, severity chip, owner, age + overdue marker if applicable).
7. **By Category** — 4 rows (R/A/I/D) × Open / Closed / Overdue counts. Category column shows the category chip.
8. **By Aging** — 4 rows (≤30d / 31–60d / 61–90d / >90d), open count.

Layout (Full Detail view):

A single read-only table with the columns: ID, Category, Title, Severity, Status, Owner, Raised, Target, Age, Linked Tasks. Sortable headers (local sort state — read-only context, simpler than reusing the main panel's sort plumbing). Overdue rows get a `text-AIPM-pink` on the target-date cell only (soft, scannable, avoids heavy visual noise on long lists).

Both views share:
- Surface tokens: `bg-surface`, `border-line`, `text-foreground`, `text-muted-foreground`.
- The 0.16.1 table chrome (sticky surface-muted thead, `text-xs uppercase tracking-wide`, `px-3 py-2 font-medium`).
- The 0.17.0 column-resize hook (`useColumnResize`) is **NOT** applied to the report's summary tables — they're short, fixed-shape, and resize would clutter the steering-committee feel. The Full Detail table DOES get column resize via the hook, with its own `tableId = "raidReportDetail"`. No reset button (popout has its own simple toolbar; user can use browser refresh to clear).

### `src/app/raid-panel.tsx` (modify)

Add an "Open Report" button to the existing RAID panel toolbar, next to the existing Reset Column Widths button. Uses the same toolbar-button chrome the Resources panel uses for its Report button. Calls a new optional prop `onOpenReport?: () => void`.

### `src/app/workspace-section.tsx` (modify)

Wire the prop on the `<RaidPanel>` instance: `onOpenReport={() => openPopoutWindow("raid-report", settings.popout.reuseWindow)}`. Add a parallel dispatch case for `activeTab === "raid-report"` that renders `<RaidReportPanel lang={lang} items={raidItems} today={today} />` inside the popout panel container — mirror the structure of the existing `resource-report` case at ~L405.

### `src/app/broadcast-sync.ts` (modify)

Add `"raid-report"` to the `POPOUT_TABS` literal (just after `"resource-report"`):
```ts
export const POPOUT_TABS = [
  "chat", "reports", "gantt", "raid", "resources", "activity",
  "resource-report", "raid-report", "address-book", "budget",
] as const;
```

### i18n (`src/app/i18n.ts` + `i18n.de.ts`)

New keys (EN strings shown):
- `raidReportTitle` — "RAID Report"
- `raidReportSummary` — "Summary"
- `raidReportFullDetail` — "Full Detail"
- `raidReportOpenRisks` — "Open Risks"
- `raidReportOpenAssumptions` — "Open Assumptions"
- `raidReportOpenIssues` — "Open Issues"
- `raidReportOpenDependencies` — "Open Dependencies"
- `raidReportBySeverity` — "By Severity"
- `raidReportByStatus` — "By Status"
- `raidReportByOwner` — "By Owner"
- `raidReportTopOpen` — "Top 10 Open"
- `raidReportByCategory` — "By Category"
- `raidReportByAging` — "By Aging"
- `raidReportColTotal` — "Total"
- `raidReportColOpen` — "Open"
- `raidReportColClosed` — "Closed"
- `raidReportColOverdue` — "Overdue"
- `raidReportColAge` — "Age"
- `raidReportColRaised` — "Raised"
- `raidReportColTarget` — "Target"
- `raidReportColLinkedTasks` — "Linked"
- `raidReportSeverityUnrated` — "Unrated"
- `raidReportUnassigned` — "Unassigned"
- `raidReportAgingLE30` — "≤ 30 days"
- `raidReportAging31_60` — "31–60 days"
- `raidReportAging61_90` — "61–90 days"
- `raidReportAgingGT90` — "> 90 days"
- `raidReportEmpty` — "No RAID items yet. Add some in the RAID panel."
- `raidReportOpenReport` — "Open RAID Report"
- `raidReportOpenReportHint` — "Open a steering-committee overview in a new window."

DE equivalents in `i18n.de.ts`.

Highlight string for the version banner:
- EN `versionHighlightRaidReport`: "RAID Report: a steering-committee overview of open risks, issues, assumptions and dependencies — with a drill-down to the full item list."
- DE `versionHighlightRaidReport`: "RAID-Report: Steuerungskreis-Übersicht über offene Risiken, Issues, Annahmen und Abhängigkeiten — mit Drill-Down zur vollständigen Item-Liste."

## Behaviour & semantics

- **"Open" definition.** Per category:
  - Risks: not in `["Closed", "Mitigated", "Realized"]`
  - Assumptions: not in `["Validated", "Invalidated"]`
  - Issues: not in `["Resolved", "Closed"]`
  - Dependencies: not in `["Delivered", "Closed"]`
  Anything else (or any custom/future status) counts as open.
- **"Closed" definition.** Inverse of Open (anything in the terminal set).
- **"Overdue" definition.** Open AND `targetDate < today`. Items without `targetDate` are NEVER overdue regardless of age.
- **Age buckets.**
  - `le30`: `0 ≤ ageDays ≤ 30`
  - `31_60`: `31 ≤ ageDays ≤ 60`
  - `61_90`: `61 ≤ ageDays ≤ 90`
  - `gt90`: `ageDays > 90`
  Buckets count open items only.
- **Owner normalization.** Empty / whitespace-only owner → `UNASSIGNED_OWNER` sentinel ("__unassigned__"). The compute function uses the sentinel; the presentation maps it to `t(lang, "raidReportUnassigned")` and italicizes the row.
- **Severity-rank ordering** for Top 10: `{ Critical: 4, High: 3, Medium: 2, Low: 1, undefined: 0 }`. Tie-break by `ageDays` desc, then `id` asc.

## Edge cases

- **Empty RAID log.** Render an empty-state card (matching the Resources Report's "empty" UX) with the `raidReportEmpty` text. No tiles, no tables.
- **Missing severity on non-Risk items.** Assumptions / Issues / Dependencies can lack `severity`. The compute treats them as severity-rank 0 for Top 10 ordering and counts them in a synthetic "Unrated" row of the By Severity table only when at least one item lacks severity (otherwise the row is omitted).
- **Items with `closedDate` but a non-terminal `status`.** Trust `status`, not `closedDate`. The compute uses `status` only.
- **Very long titles in Top 10.** Title cell gets `max-w-[40ch] truncate` with the full title in the `title` attribute (tooltip).
- **Dark mode.** All chrome inherits the surface tokens; no special-casing.
- **Popout window resizing.** The popout opens at 1200×800 (existing default in `broadcast-sync.ts`). The report's outer container is `min-h-0 flex-1 overflow-y-auto` so it fills the window and scrolls.
- **Activity log etc. integration.** Opening the report is read-only and does not log to the activity log.

## Testing

### Unit tests for `raid-report.ts` (in `raid-report.test.ts`)

The compute is pure — every behaviour above gets at least one test:

1. Empty input → tiles all zero; empty group arrays; empty topOpen + fullDetail.
2. Tile counts respect "open" definition for each category.
3. By Severity matrix counts exact category-by-severity cell values.
4. By Severity omits the "Unrated" synthetic row when no item lacks severity.
5. By Severity includes "Unrated" row when one or more items lack severity.
6. By Status counts only open items; closed items don't appear.
7. By Status rows are sorted by count desc.
8. By Owner: empty / whitespace owner is normalized to the `UNASSIGNED_OWNER` sentinel.
9. By Owner sort: total desc, then owner asc.
10. By Category: open + closed + overdue counts correct (overdue requires open AND target < today).
11. By Aging buckets count exact day counts at the boundaries (30 → le30; 31 → 31_60; 60 → 31_60; 61 → 61_90; 90 → 61_90; 91 → gt90).
12. Top 10 ordering: severity rank then age desc then id asc; respects the `≤ 10` cap.
13. Full Detail includes all items, sorted by category (R, A, I, D) then id asc.

### Component tests for `raid-report.tsx`

1. Empty state renders.
2. Tiles render with correct values.
3. Toggle: clicking "Full Detail" hides the summary sections and shows the detail table; clicking "Summary" restores.
4. Detail table sort header click cycles sort direction (asc / desc / off).
5. Overdue row in the detail table renders the overdue cell color.

### Integration

- `raid-panel.test.tsx`: clicking the new "Report" button fires `onOpenReport`.
- `workspace-section.test.tsx`: dispatching `activeTab === "raid-report"` renders `<RaidReportPanel>` (the existing tests have a similar pattern for `resource-report`).
- `broadcast-sync.test.ts`: `"raid-report"` is a valid `PopoutTab`.

### Gates

`npx tsc --noEmit` 0, `npm run lint` 0 errors, full suite green (existing 898 + new tests ≈ 920+), `npm run test:coverage` ≥ 70%.

## Release

Minor → **0.18.0 "Jemisin"** (codename retained — Jemisin was just minted at 0.17.0 and this batch continues under it; the codename rev waits for the next author-themed milestone).

- `src/app/version.ts`: `APP_VERSION = "0.18.0"`; `APP_BUILD_DATE = "2026-05-28"; // Jemisin milestone`; new top-of-file comment block; append `"versionHighlightRaidReport"` as the LAST entry of `APP_HIGHLIGHT_KEYS`.
- `src/app/i18n.ts` (EN) + `src/app/i18n.de.ts`: all new RAID report keys + the highlight key string.
- `CHANGELOG.md` `[0.18.0] — 2026-05-28 "Jemisin"` entry with `Added` (RAID report) section.
- No DESIGN-TOKENS.md change.

## Plan shape (preview — `writing-plans` skill expands)

1. `raid-report.ts` compute + 13 unit tests (TDD)
2. `raid-report.tsx` shell: tiles + SegmentedControl + empty state
3. By Severity table
4. By Status table
5. By Owner table
6. Top 10 Open mini-table
7. By Category table
8. By Aging table
9. Full Detail view (read-only table with sortable headers + column-resize)
10. Popout plumbing: add `"raid-report"` to `POPOUT_TABS`; `workspace-section.tsx` dispatch case; RAID panel "Report" button + `onOpenReport` wiring
11. i18n EN + DE (all keys + highlight strings)
12. Release 0.18.0 (version.ts, i18n entries, CHANGELOG)

## What this closes

After 0.18.0 ships, the original two-part conversation request is complete: Gantt centers today on open (0.17.1) + RAID steering-committee report with drill-down (0.18.0).
