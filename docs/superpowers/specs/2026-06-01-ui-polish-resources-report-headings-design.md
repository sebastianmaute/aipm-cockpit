# UI polish — resources toolbars + report headings (v0.38.2)

**Date:** 2026-06-01
**Status:** Design approved; pending implementation plan

## Problem

Five small layout/styling issues remain after the v0.38.x batches. All are
presentation-only — no behavior, data, or routing changes.

1. **Resources → Workload:** the right-hand buttons stack vertically instead of
   sitting on one line.
2. **Resources → Planning:** the date pickers are shorter than the segmented
   controls next to them, so the control row is uneven.
3. **Resources → Manage Roles:** (a) the rate-card table looks unlike the
   Directory/Workload tables; (b) the panel fills the viewport instead of being
   sized/oriented like Chat.
4. **RAID Report:** the heading sits on its own line below the toolbar buttons.
5. **Reports:** there is no heading at all.

## Decisions (resolved with the user)

- **Heading layout (fixes 4 & 5):** heading on the **left**, buttons on the
  **right**, on one line (`justify-between`) — consistent with the
  Tasks/Resources/Budget headers. (Chosen over right-aligned heading.)

## Design

### A. Workload toolbar — one line

Root cause: `ResourcesPanel` renders its header row `[title | Reset Size]`, and
`ResourceWorkload` renders its own second row `[Reset Column Widths]`. Two
right-aligned buttons on two rows read as a vertical stack.

Fix: lift Workload's `useColumnResize` out of `ResourceWorkload` and into
`ResourcesPanel` — the same ownership pattern Planning/rollup already use in
that file, and that `raid-report-panel.tsx` uses (parent owns all
`useColumnResize` hooks, passes `colResize` objects to children).

- `ResourcesPanel` adds `const workload = useColumnResize<WorkloadCol>("workload", WORKLOAD_COL_WIDTHS)`.
  `WORKLOAD_COL_WIDTHS` + `WorkloadCol` move to (or are imported from) a shared
  spot so both files agree on the shape; simplest is to export them from
  `resource-workload.tsx` and import into `resources-panel.tsx`.
- The header's Reset-Column-Widths button shows for `view === "planning" ||
  view === "workload"`. For workload it calls `workload.resetColWidths()`; for
  planning it keeps `resetPlanningAndRollup`.
- `ResourceWorkload` takes a `colResize: ReturnType<typeof useColumnResize<WorkloadCol>>`
  prop, removes its internal `useColumnResize` call, and removes its own
  `<div className="mb-2 flex ... justify-end">` toolbar row.

Result: a single header line — `Resources (N) ……… Reset Cols  Reset Size`.

### B. Planning date-picker height

The two `<input type="date">` use `px-1.5 py-0.5` and inherit `text-xs`; the
`SegmentedControl` buttons beside them use `px-3 py-1.5 text-sm`. Change the date
inputs to `px-2 py-1.5 text-sm` so the whole control row is one height. (Border
and rounding unchanged.)

### C. Manage Roles

**C1. Rate-card table matches Directory/Workload.** In `roles-editor.tsx`, wrap
the rate-card `<table>` in the shared `INNER_TABLE_CLASS` card (rounded-xl
border) and change cell padding from `py-1`/`py-1.5` (no horizontal padding) to
`px-3 py-2` on both the `<th>` and `<td>` cells. The `<thead>` already uses
`TABLE_HEAD_CLASS`; keep it. The sort buttons and `ColumnResizeHandle`s stay.

**C2. Panel sized/oriented like Chat.** Chat's centered half-size class is
currently a private `CHAT_PANE_CLASS` in `chat-panel.tsx`:

```
relative mx-auto flex h-[50%] max-h-full min-h-[360px] w-[50%] min-w-[420px] flex-col overflow-hidden rounded-xl border border-line bg-surface p-6 resize
```

Move that string into `view-styles.ts` as an exported
`CENTERED_HALF_PANE_CLASS`. Both consumers use it:

- `chat-panel.tsx`: `import { CENTERED_HALF_PANE_CLASS } from "./view-styles"` and
  keep `const CHAT_PANE_CLASS = CENTERED_HALF_PANE_CLASS;` (preserves the local
  name and the existing sweep assertion).
- `roles-panel.tsx`: root `<section>` class changes from
  `VIEW_PANE_RESIZABLE_CLASS` to `CENTERED_HALF_PANE_CLASS`. The existing
  `useResizable("lop-app:manage-roles-size")`, header, scroll body, and
  `ResizeCornerHint` are unchanged.

### D & E. Report headings on the toolbar line

`ReportCard` (in `report-table.tsx`) gains an optional `title?: string` prop. Its
header row changes from `justify-end` to `justify-between`:

```tsx
<div className="mb-4 flex shrink-0 items-center justify-between gap-2">
  {title ? <h2 className="text-lg font-medium text-foreground">{title}</h2> : <span />}
  <div className="flex items-center gap-2 print:hidden">
    {toolbarExtra}
    <PrintButton lang={lang} />
    {onResetCols && <ResetColWidthsButton onClick={onResetCols} lang={lang} />}
    <ResetSizeButton onClick={onResetSize} lang={lang} />
  </div>
</div>
```

- The title sits left and is **printable** (it is outside the `print:hidden`
  button cluster — an improvement over the old behavior where the toolbar was
  fully hidden).
- The empty `<span />` keeps the buttons right-aligned when no title is passed.
- `raid-report-panel.tsx`: pass `title={t(lang, "raidReportTitle")}` to
  `ReportCard` and remove the now-duplicate `<h2>{t(lang, "raidReportTitle")}</h2>`
  first child.
- `reports.tsx`: pass `title={t(lang, "tabReports")}` to `ReportCard`. No new
  i18n key (`tabReports` already = "Reports").
- `resources-report.tsx`: unchanged (no title) — buttons stay right via the
  spacer.

## Files

- `src/app/view-styles.ts` — add `CENTERED_HALF_PANE_CLASS`.
- `src/app/chat-panel.tsx` — consume the shared constant (alias `CHAT_PANE_CLASS`).
- `src/app/roles-panel.tsx` — root uses `CENTERED_HALF_PANE_CLASS`.
- `src/app/roles-editor.tsx` — rate-card table wrapper + `px-3 py-2` cells.
- `src/app/resources-panel.tsx` — lift workload `colResize`; header Reset-Cols for
  workload; planning date-input height.
- `src/app/resource-workload.tsx` — accept `colResize` prop; drop own toolbar;
  export `WORKLOAD_COL_WIDTHS`/`WorkloadCol`.
- `src/app/report-table.tsx` — `ReportCard` `title` prop + `justify-between` +
  printable title.
- `src/app/raid-report-panel.tsx` — pass title; remove duplicate `<h2>`.
- `src/app/reports.tsx` — pass title.
- `src/app/version.ts`, `CHANGELOG.md` — v0.38.2.

## Testing (TDD)

- `view-pane-sweep.test.ts`: add a Manage-Roles assertion (roles-panel uses
  `CENTERED_HALF_PANE_CLASS`); add a `view-styles` export assertion for
  `CENTERED_HALF_PANE_CLASS`. Chat assertion (`CHAT_PANE_CLASS` + `resize`) and
  the `resources-panel` `VIEW_PANE_RESIZABLE_CLASS` assertion remain unchanged
  (the panel root is unchanged).
- `report-table.test.tsx`: `ReportCard` renders the `title` as a heading on the
  left when provided; the heading is NOT inside a `print:hidden` region; with no
  title the buttons remain right-aligned.
- `resources-panel.test.tsx` / `resource-workload.test.tsx`: Workload renders
  with the lifted `colResize` prop; a single header toolbar row (no second
  right-aligned button row).
- `roles-editor` / `table-head-sweep.test.ts`: rate-card table still uses
  `TABLE_HEAD_CLASS` (unchanged) and now sits in the shared inner-table card.
- `chat-panel.test.tsx`: still green (local `CHAT_PANE_CLASS` alias retained).

## Versioning

- `version.ts` → `0.38.2`; `CHANGELOG.md` entry. No new i18n keys. No new
  `APP_HIGHLIGHT_KEYS` (point release).

## Out of scope

- Resources Report heading (left title-less by request). Any behavior, routing,
  data, or modern-sidebar changes.
