# Composable Reports + Landscape Print — Design Spec

**Date:** 2026-06-01
**Status:** Approved (design)
**Target version:** 0.42.0 "Le Guin"
**Branch:** `fix-budget-empty-add-bucket` (also carries the 0.41.1 empty-state fix)

## Goal

Let the **Reports view** compose additional reports below its default task
analytics: an **"+ Add report"** control appends any of **RAID Report, Budget
Report, Resource Report** (the dedicated reports not already in the task Reports
view) into the same report card, each removable, the chosen set persisted in
settings. Separately, in-app **printing defaults to A4 landscape**.

## Decisions (from brainstorming)

1. **Addable set:** RAID Report, Budget Report, Resource Report.
2. **Add UX:** pick individually via an "+ Add report" dropdown (lists not-yet-added reports); each appended report has a `×` to remove.
3. **Persistence:** the chosen set persists in settings (localStorage), surviving reloads.
4. **Landscape:** global — every in-app print-root prints landscape (consistent with the already-landscape PDF-export path).
5. **Embedded RAID shows the Summary view only** (full detail stays in the dedicated RAID Report).
6. Combined printing requires **one** print-root (each `.print-root` is `position:absolute; inset:0`, so multiple would overlap) — hence the embedded reports render inside the Reports view's single `ReportCard`.

## Architecture — `embedded` prop (no separate body components)

Each dedicated report panel (`RaidReportPanel`, `BudgetReportPanel`,
`ResourcesReportPanel`) gains an optional `embedded?: boolean` (default `false`):

- **`embedded === false` (default):** unchanged — renders its full `ReportCard`
  (title, Print, reset-size, reset-cols, and RAID's Summary/Full toggle).
- **`embedded === true`:** renders the SAME inner content in a plain
  `<div className="space-y-6">` — no `ReportCard`, no Print/resize/reset chrome,
  no title. RAID forces `view = "summary"` and renders no toggle.

All hooks (`useMemo`, `useResizable`, the `useColumnResize` set, `useState` for
RAID's view) are still called unconditionally before any early return, so
embedding adds only an unused card ref. The existing empty-state early returns
(no items / no buckets / no capacity) render their dashed message in both modes.

This keeps every standalone nav view (Budget → Budget Report, RAID → RAID
Report, Resources) byte-for-byte the same on screen, while the Reports view can
embed the content.

## Reports view (`reports.tsx`)

`ReportsPanel` gains optional, defaulted props:
- Data for the embeddable panels: `raid`, `buckets`, `plan`, `roles`,
  `disciplines`, `grades`, `resources`, `absences`, `workdayHours`, `fxRates`.
- `extraReports: AddableReportId[]` and `onChangeExtraReports: (next: AddableReportId[]) => void`.

A registry (small inline const or `addable-reports.ts`):
```ts
export const ADDABLE_REPORTS = [
  { id: "raid-report", titleKey: "raidReportTitle" },
  { id: "budget-report", titleKey: "budgetReportTitle" },
  { id: "resource-report", titleKey: "resourcesReportTitle" },
] as const;
export type AddableReportId = (typeof ADDABLE_REPORTS)[number]["id"];
```

Rendering, inside the existing single `<ReportCard>`:
- The task analytics sections (unchanged).
- Then, for each `id` in `extraReports` (kept in `ADDABLE_REPORTS` order), a block:
  an `<h3>` with the report title and a `×` remove button (`print:hidden`),
  followed by the matching panel rendered with `embedded`:
  - `raid-report` → `<RaidReportPanel embedded lang items={raid} today />`
  - `budget-report` → `<BudgetReportPanel embedded lang buckets plan roles resources absences holidaySet workdayHours fxRates />`
  - `resource-report` → `<ResourcesReportPanel embedded lang resources roles disciplines grades plan absences holidaySet workdayHours />`
- The **"+ Add report"** control is passed as the `ReportCard` `toolbarExtra`
  (already `print:hidden`): a `<select>` (styled like the budget-report bucket
  filter) whose first option is the `reportsAddReport` placeholder (value `""`)
  and whose remaining options are the reports in `ADDABLE_REPORTS` not already in
  `extraReports` (labelled by their `titleKey`). Its `onChange` appends the
  chosen id via `onChangeExtraReports([...extraReports, id])` and resets the
  select back to the placeholder. When no reports remain to add, the select shows
  the `reportsAddReportNone` option and is `disabled`.
- Remove calls `onChangeExtraReports(extraReports.filter(x => x !== id))`.

The existing `stats.total === 0` empty-state early return stays (the composed
reports accompany task analytics; with zero tasks the add control isn't shown —
accepted minor limitation, noted).

## Persistence (`settings-types.ts`, `use-settings.ts`, `workspace-section.tsx`)

- `Settings` gains optional `reports?: { extra: AddableReportId[] }`;
  `defaultSettings.reports = { extra: [] }`. Optional ⇒ back-compat via the
  settings merge in `use-settings.ts`.
- Sanitize on load: coerce `reports.extra` to an array, keep only valid
  `AddableReportId` values, dedup. (Add to the settings sanitizer used by
  `use-settings.ts`; if settings are merged without a dedicated sanitizer for
  this field, add a small guard there.)
- `workspace-section.tsx` passes to `<ReportsPanel>`: the embeddable data props
  (already in scope — `raid`, `budgets`, `plan`, `roles`, `disciplines`,
  `grades`, `resources`, `absences`, `settings.resources.workdayHours`,
  `fxRates`), plus `extraReports={settings.reports?.extra ?? []}` and
  `onChangeExtraReports={(next) => setSettings(s => ({ ...s, reports: { extra: next } }))}`.

## Landscape print (`globals.css`)

The in-app print block becomes:
```css
@media print {
  @page { size: A4 landscape; margin: 1.5cm; }
  /* …existing print-root / ink-strip rules unchanged… */
}
```
(Only the `size` changes from `A4` to `A4 landscape`. The PDF-export path in
`export.ts` is already landscape and is untouched.)

## i18n (EN + DE) — ASCII `"` delimiters in `i18n.de.ts`

New keys:
- `reportsAddReport` — "Add report" / "Bericht hinzufügen"
- `reportsRemoveReport` — "Remove report" / "Bericht entfernen"
- `reportsAddReportNone` — "All reports added" / "Alle Berichte hinzugefügt"

Report titles reuse existing keys (`raidReportTitle`, `budgetReportTitle`,
`resourcesReportTitle`).

## Version & docs

- `version.ts`: `APP_VERSION = "0.42.0"`, `APP_MILESTONE = "Le Guin"`,
  `APP_BUILD_DATE = "2026-06-01"`; prepend a release-notes block; append a
  highlight key `versionHighlightComposableReports` to `APP_HIGHLIGHT_KEYS`
  (+ EN/DE strings).
- `CHANGELOG.md`: 0.42.0 "Le Guin" entry (Added: compose extra reports into the
  Reports view; Changed: in-app print defaults to landscape). The already-present
  0.41.1 "Fixed" entry stays above 0.41.0 and below 0.42.0.
- `README.md`: version line → `v0.42.0 "Le Guin"`.
- `docs/CODEMAPS/*`: stamps bumped to `0.42.0`.

## Testing

- **Panel `embedded` mode** (`raid-report-panel.test.tsx`,
  `budget-report-panel.test.tsx`, `resources-report.test.tsx`): with
  `embedded`, the panel renders its content (a known section/heading) but NO
  Print button and no `print-root`/ReportCard wrapper; default (non-embedded)
  tests stay green. RAID embedded renders Summary content and no Summary/Full
  toggle.
- **`reports.test.tsx`:** with `extraReports={["budget-report"]}` the Budget
  report content renders below the task sections; the "+ Add report" control
  lists only not-yet-added reports; selecting one fires `onChangeExtraReports`
  with the appended id; clicking a report's `×` fires it with the id removed;
  task-report tests stay green.
- **Settings sanitize:** `reports.extra` defaults to `[]`; invalid/duplicate ids
  are dropped on load.
- **Landscape:** an assertion that `globals.css` contains
  `@page { size: A4 landscape` (or a parsed-rule check), guarding the default.

## File structure

**Modified:** `reports.tsx` (+`reports.test.tsx`), `raid-report-panel.tsx`
(+test), `budget-report-panel.tsx` (+test), `resources-report.tsx` (+test),
`settings-types.ts`, `use-settings.ts` (sanitize), `workspace-section.tsx`,
`globals.css`, `i18n.ts`, `i18n.de.ts`, `version.ts`, `CHANGELOG.md`,
`README.md`, `docs/CODEMAPS/*`.
**New (optional):** `addable-reports.ts` registry (inline in `reports.tsx` if
that's cleaner).

## Out of scope (YAGNI)

- Reordering the appended reports (they render in `ADDABLE_REPORTS` order).
- Embedding the task Reports into the other views (one direction only).
- Per-embedded-report resize/reset-cols (available in the dedicated views).
- Showing the add control when there are zero tasks (Reports stays task-anchored).
- Any change to the report engines or the PDF-export path.
