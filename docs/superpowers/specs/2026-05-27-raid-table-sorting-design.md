# RAID Table-Header Sorting (0.14.2) — Design

**Date:** 2026-05-27
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.14.2-raid-sorting`
**Context:** First sub-project of a larger batch (decomposed into C=RAID sorting, A=resources assignee click, D+E=design system, B=resources styling). This is C.

## Goal

Let the user sort the RAID table by clicking column headers, in addition to the existing default ordering.

## Current state

`raid-panel.tsx` renders a table with columns: `#`, Category, Title, Severity, Status, Owner, Target Date, Linked Tasks, Caused By. The visible rows come from a `filtered.slice().sort(...)` (~line 207) whose default keeps terminal/closed items at the bottom. No header sorting today.

## Design

### Sortable columns
Scalar columns only: `id`, `category`, `title`, `severity`, `status`, `owner`, `targetDate`. The two list columns (Linked Tasks, Caused By) remain non-sortable plain headers.

### Sort state + interaction (`raid-panel.tsx`)
- `const [sort, setSort] = useState<{ key: RaidSortKey; dir: "asc" | "desc" } | null>(null)`.
- Clicking a column cycles **asc → desc → off** (null). "off" returns to the existing default order.
  - `toggleSort(key)`: if `sort?.key === key`, go `asc → desc → null`; else set `{ key, dir: "asc" }`.
- The active column's header shows a ▲ (asc) / ▼ (desc) indicator and `aria-sort={"ascending"|"descending"}`; inactive headers have `aria-sort="none"` (or omitted). Each sortable header is a `<button>` inside the `<th>` (keyboard-accessible).

### Applying the sort
- When `sort` is set: order the **filtered** list purely by that column (no terminal-to-bottom grouping).
- When `sort` is null: keep today's default sort unchanged.
- Implement as: `const ordered = sort ? [...filtered].sort(byColumn) : [...filtered].sort(defaultComparator)` — i.e. wrap the existing default; don't change default behavior.

### Comparator — pure helper in `raid.ts`
Add `raidSortValue(item: RaidItem, key: RaidSortKey): string | number` returning a comparable value:
- `id` → `item.id` (number).
- `category` → index in `RAID_CATEGORIES` (R=0, A=1, I=2, D=3), so sort follows R→A→I→D.
- `severity` → rank: `Low=1, Medium=2, High=3, Critical=4`, missing/undefined = `0` (lowest).
- `status` → `item.status` lowercased.
- `title` → `item.title` lowercased.
- `owner` → `(item.owner ?? "")` lowercased.
- `targetDate` → `item.targetDate ?? ""` (empty string).
The panel's column comparator uses `raidSortValue`: numeric subtraction when both values are numbers, else `String(a).localeCompare(String(b))`; multiply by `dir === "asc" ? 1 : -1`.
- **Missing `targetDate` sorts LAST** regardless of direction: handle in the comparator (an item with empty `targetDate` always orders after one with a date). (Other missing values use their natural low/empty ordering.)

Also export `RaidSortKey` (`"id" | "category" | "title" | "severity" | "status" | "owner" | "targetDate"`) and a `SEVERITY_RANK` map if helpful, from `raid.ts`.

## Non-goals
- No styling/color changes (the zinc header background etc. are the later D+E design-system sub-project).
- No change to the existing filters or the default sort itself.
- No persistence of the chosen sort (resets on reload) — matches the roles & rates sortable columns.

## Testing
- **Unit (`raid.test.ts`):** `raidSortValue` / the comparator — severity rank order (Critical > High > Medium > Low; missing lowest), category R→A→I→D, numeric id, case-insensitive title/owner/status, and **missing `targetDate` sorts last** in both directions.
- **Component (`raid-panel.test.tsx`):** clicking the Severity header sorts rows by severity asc, clicking again desc, a third click returns to default; a non-sortable header (Linked Tasks) has no sort button.

## Release
Patch → **0.14.2** (keep "Atwood"). Bump `version.ts`, add a `[0.14.2]` CHANGELOG entry, note RAID sorting in `docs/CODEMAPS/frontend.md`. Gates: lint 0, tsc 0, `test:coverage` green.
