# Table Column Resize + Task Modal Height — Design

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.17.0-table-column-resize`
**Context:** Three-part user request — (1) column resize on every table, (2) reset-all-widths button on tall tables, (3) double the task form modal default height. Shipped together as **0.17.0 "Jemisin"** with a new `versionHighlightTableResize` highlight key.

## Goal

- Generalize the existing tasks-only `useColumnManager` resize machinery into a `useColumnResize(tableId, defaults)` hook usable by any table.
- Roll out column resize to all 11 remaining `<table>` surfaces in the app (excluding the 30-day Calendar grid).
- Add a "reset column widths" button to the 9 tall tables that gain resize (the two modal-hosted tables and the 5 Resources Report sub-tables don't get a button — they get resize only).
- Set an explicit, roomier default height on the task form modal.

## Non-goals

- The `resource-calendar.tsx` 30-day grid is excluded — its uniform day columns are a layout decision, not data columns.
- No column hide/show feature for non-tasks tables (the existing tasks `useColumnManager.hiddenCols` stays tasks-only).
- No drag-reorder of columns.
- No persistence sync across devices / no server-side storage.
- No "reset every table at once" master button — each table's reset clears only its own widths.
- No changes to the tasks-table integration (it already has resize + reset).

## Architecture

### `src/app/use-column-resize.ts` (new, generic hook)

```ts
export function useColumnResize<TId extends string>(
  tableId: string,
  defaults: Readonly<Record<TId, number>>,
): {
  colWidths: Record<TId, number>;
  startColResize: (col: TId, e: React.MouseEvent) => void;
  resetColWidths: () => void;
};
```

- localStorage key: `lop-app:col-widths:<tableId>` (per-table namespace).
- On mount: read the namespaced key; merge into defaults (extra keys ignored, missing keys filled from defaults).
- On `startColResize`: same drag mechanic as the existing tasks hook — `mousedown` captures the column id + starting clientX + starting width; `mousemove` updates state with `Math.max(40, startW + dx)`; `mouseup` releases. Identical 250 ms debounce on the persist effect to avoid 60 writes/sec during drag.
- `resetColWidths`: replaces state with `defaults` and removes the namespaced localStorage key.
- The existing `useColumnManager` hook stays as-is and continues to own the legacy unsuffixed `lop-app:col-widths` key for tasks — no migration. New tables use the namespaced keys.

### Shared primitives in `src/app/task-manager-ui.tsx`

```tsx
export function ColumnResizeHandle({
  col,
  onMouseDown,
}: {
  col: string;
  onMouseDown: (col: string, e: React.MouseEvent) => void;
}): JSX.Element;
```
A 4 px-wide absolute-positioned `<span>` on the right edge of a `<th>` with `cursor-col-resize` and `aria-hidden="true"`. The host `<th>` must be `relative`. Existing tasks resize handle is the visual reference — extract it or inline-mirror its styles.

```tsx
export function ResetColWidthsButton({
  onClick,
  lang,
}: {
  onClick: () => void;
  lang: Lang;
}): JSX.Element;
```
Wraps the existing `ResetColWidthsIcon` in the established toolbar-button style (`rounded-md border border-line bg-surface p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground`). `aria-label` and `title` use the existing `colResetWidthsHint` i18n key. The tasks-section currently inlines this same shape — once the shared button exists, swap the tasks inline version for the import (one-line refactor).

## Per-table integration

For every target table:

1. Define an inline `<NAME>_COL_WIDTHS` const (e.g. `DIRECTORY_COL_WIDTHS`) — a readonly `Record<ColumnId, number>` enumerating each resizable column and its default px width.
2. Call `const { colWidths, startColResize, resetColWidths } = useColumnResize("<tableId>", <NAME>_COL_WIDTHS);`.
3. On each resizable `<th>`:
   - Add `relative` to the className (if absent).
   - Add `style={{ width: colWidths.<col>, minWidth: colWidths.<col> }}`.
   - Include `<ColumnResizeHandle col="<col>" onMouseDown={startColResize} />` as the last child.
4. For tall tables: place `<ResetColWidthsButton onClick={resetColWidths} lang={lang} />` in the table's toolbar (next to existing buttons like Add/Search/Sort).
5. If the target `<table>` is `table-auto` (Tailwind default) and inline widths visibly don't take effect during testing, switch it to `table-fixed`. Confirm during Task 1 by checking what the existing tasks table uses.

### Table inventory + scope

| `tableId` | File | Resizable columns | Reset button |
|---|---|---|---|
| `directory` | `resource-directory.tsx` | name (180), discipline (120), grade (100), title (160), department (140), phone (120), email (180), birthday (90) | ✓ in toolbar |
| `workload` | `resource-workload.tsx` | assignee (160), email (180), openTasks (110), overdue (110), weeklyHours (120), upcoming (200) | ✓ in `<ResourcesPanel>` header (workload is a sub-view; button shown only when `view === "workload"`) |
| `planning` | `resources-panel.tsx` (planning view) | assignee (160), period (100, shared across all period columns), capacityDays (110), internalCost (120), externalCost (120), margin (100) | ✓ in panel header when `view === "planning"` |
| `rollup` | `resources-panel.tsx` (rollup sub-table) | assignee (160), period (100, shared) | (covered by the planning reset button — same toolbar) |
| `raid` | `raid-panel.tsx` (main table) | id (60), category (100), title (240), severity (90), status (110), owner (140), targetDate (110), linkedTasks (140), causedBy (140) | ✓ in RAID toolbar |
| `activityLog` | `activity-log-panel.tsx` | timestamp (160), kind (110), actor (140), message (320) | ✓ in toolbar |
| `reportsPriority` | `reports.tsx` (priority sub-table) | id (60), task (260), count (90) | one shared button for the three Reports sub-tables, in the Reports view header — clicks reset all three keys (`reportsPriority`, `reportsAssignee`, `reportsByX`) |
| `reportsAssignee` | `reports.tsx` (assignee sub-table) | assignee (160) + 6 number cols (90 each) | (shared, see above) |
| `reportsByX` | `reports.tsx` (by-X sub-table) | label (180) + 5 number cols (90 each) | (shared, see above) |
| `budget` | `budget-panel.tsx` | role (160), period (100, shared) | ✓ in budget toolbar |
| `resReportByPeriod` | `resources-report.tsx` (`<Section>` "By period") | period (100) + 4 number cols (110 each) | ✗ no reset (popup, no per-sub-table toolbar) |
| `resReportByDiscipline` | `resources-report.tsx` | label (160) + 4 cols (110 each) | ✗ |
| `resReportByGrade` | `resources-report.tsx` | label (160) + 4 cols (110 each) | ✗ |
| `resReportByCombo` | `resources-report.tsx` | label (200) + 4 cols (110 each) | ✗ |
| `resReportByResource` | `resources-report.tsx` | name (160), role (160), avgUtil (90), capDays (110), internal (120), external (120) | ✗ |
| `jiraConflicts` | `jira-conflicts-modal.tsx` | per-col (sized 100–240 by content) | ✗ (modal panel itself resizes) |
| `roles` | `roles-modal.tsx` | per-col (sized to discipline/grade/level shape) | ✗ |

Default widths above are starting points; final values get sanity-checked during integration. All values are arbitrary — adjustable later by the user via drag.

### Variable-period columns (Planning, Rollup, Budget)

The Planning/Rollup grid generates N period `<th>` cells dynamically (`periods.map(p => <th key={p.key}>{p.key}</th>)`). Storing one width per dynamic key is wasteful (the keys change with the plan window). Instead all period columns share a single `period` width:

- `style={{ width: colWidths.period, minWidth: colWidths.period }}` on every period `<th>`.
- The drag handle calls `startColResize("period", e)`. Dragging any period column resizes every period column uniformly.
- The same `period` key is reused across `planning` and `rollup` namespaces (separate `tableId`s — `planning`'s period width is independent of `rollup`'s). Budget gets its own.

## Task form modal height

`src/app/task-form-modal.tsx:110` — the panel `<div>` className gains `h-[900px] max-h-[95vh] min-h-[480px]`:

- Before: `relative flex w-[700px] min-w-[460px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface dark:border-line dark:bg-surface`
- After: `relative flex h-[900px] max-h-[95vh] min-h-[480px] w-[700px] min-w-[460px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface dark:border-line dark:bg-surface`

CSS `resize` is already on the panel, so users can still drag below 900 if they want. Matches the `jira-conflicts-modal` shape.

## Edge cases

- **`table-fixed` vs `table-auto`:** Tailwind v4 defaults `<table>` to `table-auto`, which treats explicit `width` as a hint when content asks for more. Tasks already works under this default, so inline `style.width + minWidth` is sufficient. If a per-table integration shows column drag with no visible width change, the fallback is to add `table-fixed` to that `<table>`.
- **`relative` on `<th>`:** the resize handle is absolute-positioned inside the th. Several existing theads use Tailwind's default `<th>` (no `relative`); add the class during integration. No visual side-effect.
- **Modal-table resize handles:** modals own `resize` on the panel + sometimes inner scroll containers. The column-resize handle stays inside the `<th>` and `e.preventDefault()` already isolates the mousedown — no event conflicts.
- **Sticky thead + column widths:** Workload-style sticky headers (`sticky top-0 z-10`) work fine with explicit widths. Confirmed during sub-project B.
- **Drag-handle hit area vs sort-by-header buttons:** Directory/RAID `<th>`s already host clickable sort buttons. Place the resize handle so its 4-px hit zone is clearly to the right of the sort button's right edge; if visual overlap happens during integration, narrow the sort button or pad the th right side.
- **Reports shared-reset behavior:** the one Reports reset button calls a function that calls `resetColWidths` on all three Reports hooks. Either pass a combined callback or lift the three hooks to the parent.
- **Resources Report popup — no toolbar:** the popup uses `<Section>` titles, no per-sub-table toolbar. Resize-only; no reset button. The user can clear localStorage manually if they ever want to undo; acceptable trade-off given that the popup's tables are short and rarely resized.

## Testing

- **New unit tests** in `src/app/use-column-resize.test.ts` mirroring `use-column-manager.test.ts`:
  - returns defaults when localStorage is empty
  - merges persisted widths over defaults (extras ignored, missing filled)
  - resize updates state and clamps to 40 px min
  - reset replaces state with defaults and removes the namespaced key
  - two different `tableId`s use independent storage keys
- Per-table integration: existing tests stay green. If a behavioral test happens to assert on a header's class string and the integration adds `relative`, update that assertion.
- Full suite: `npx vitest run` → 890+ pass. `npx tsc --noEmit` 0. `npm run lint` 0. `npm run test:coverage` ≥ 70%.

## Release

Minor → **0.17.0 "Jemisin"** (continues the Bradbury/Atwood/Le Guin/Butler author pattern → N.K. Jemisin).

- `src/app/version.ts`: `APP_VERSION = "0.17.0"`; `APP_BUILD_DATE = "2026-05-28"; // Jemisin milestone`; new top-of-file milestone comment block; append `"versionHighlightTableResize"` as the LAST entry of `APP_HIGHLIGHT_KEYS`.
- `src/app/i18n.ts` (EN): `versionHighlightTableResize: "Column widths now resizable in every table — drag the right edge of any header; the Reset button restores defaults."`
- `src/app/i18n.de.ts`: `versionHighlightTableResize: "Spaltenbreiten in allen Tabellen anpassbar — am rechten Rand jedes Spaltenkopfes ziehen; die Reset-Schaltfläche stellt die Standardwerte wieder her."`
- `CHANGELOG.md` `[0.17.0] — 2026-05-28 "Jemisin"` entry with `Added` (column resize + reset) and `Changed` (task modal default height) sections.
- `docs/DESIGN-TOKENS.md` is NOT touched (this is an interaction primitive, not a design token).

## Plan shape (preview — the writing-plans skill expands)

1. Generic hook (`use-column-resize.ts`) + tests
2. Shared primitives (`ColumnResizeHandle`, `ResetColWidthsButton`) in `task-manager-ui.tsx`; refactor tasks-section to use the shared button
3. Roll out: Directory + Workload (Resources sub-tabs pair)
4. Roll out: Planning + Rollup (resources-panel)
5. Roll out: RAID
6. Roll out: Activity Log
7. Roll out: Reports (3 sub-tables + shared reset)
8. Roll out: Budget
9. Roll out: Resources Report (5 sub-tables, no reset)
10. Roll out: jira-conflicts + roles (modal tables, no reset)
11. Task form modal height bump
12. Release 0.17.0 "Jemisin" (version.ts, i18n EN+DE, CHANGELOG)

After 0.17.0 ships, the 2026-05-27 batch remains complete; this new feature is a stand-alone improvement on top.
