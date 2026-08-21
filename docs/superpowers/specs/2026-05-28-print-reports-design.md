# Print Buttons + A4 Print Stylesheet — Design

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.20.0-print-reports`
**Context:** Sub-project **S3** — third of the 5-item batch (S1 banner cleanup 0.18.1; S2 Reports sort+filter 0.19.0; S4 PDF export to follow). Adds a Print button to Reports, RAID Report, and Resources Report popouts that opens the browser print dialog and produces a clean DIN A4 handout.

## Goal

Give the user a one-click path from any report popout to a steering-committee-ready printed/PDF handout via the browser's native print pipeline:

1. Click Print → browser print dialog opens with the current report view as preview.
2. Output fits DIN A4 (size + reasonable margin).
3. Toolbars, toggles, filter inputs, and the print button itself disappear; the report body (heading + tiles + tables) remains.
4. Surface-token backgrounds strip to white for ink efficiency; semantic accent colors (AIPM-pink overdue, AIPM-green completed) survive.

## Non-goals

- No binary PDF generation here — that's S4 (next sub-project).
- No new print-only HTML template (`export.ts` already does this for the full-workspace PDF; reports use the LIVE React DOM via `window.print()` on the popout).
- No multi-view print (printing both Summary and Full Detail of the RAID Report at once) — the user prints whichever view is currently selected, can print again for the other.
- No page-break customization beyond `page-break-inside: avoid` on table rows.
- No new dependencies.

## Architecture

### Shared `<PrintButton>` + `PrinterIcon` in `src/app/task-manager-ui.tsx`

```tsx
export function PrinterIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4">
      <rect x="5" y="2.5" width="10" height="5" />
      <rect x="3" y="7.5" width="14" height="7" rx="1" />
      <rect x="5" y="11" width="10" height="6.5" />
      <line x1="5" y1="13" x2="15" y2="13" />
    </svg>
  );
}

export function PrintButton({ lang, onClick }: { lang: Lang; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick ?? (() => window.print())}
      aria-label={t(lang, "printHint")}
      title={t(lang, "printHint")}
      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted print:hidden"
    >
      <PrinterIcon />
      {t(lang, "print")}
    </button>
  );
}
```

Behaviour: default `onClick` calls `window.print()`. Optional override lets future callers route through a custom pipeline (e.g. S4's PDF export will reuse `<PrinterIcon>` but pass its own onClick). Built-in `print:hidden` removes the button from the printed output.

### `@media print` block in `src/app/globals.css`

```css
@media print {
  @page {
    size: A4;
    margin: 1.5cm;
  }

  body {
    background: white !important;
    color: black !important;
  }

  /* Sticky thead is meaningless on paper */
  .sticky {
    position: static !important;
  }

  /* Strip surface-token backgrounds (waste ink); preserve semantic colors */
  [class*="bg-surface"] { background: white !important; }
  [class*="bg-surface-muted"] { background: #f5f5f5 !important; }
  [class*="border-line"] { border-color: #d1d5db !important; }

  /* Page-break hygiene */
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }

  /* Belt-and-braces: hide column-resize handles even if their print:hidden gets dropped */
  [aria-hidden="true"].cursor-col-resize { display: none !important; }
}
```

### `print:hidden` on chrome

Elements that should disappear in print:

1. **`<PrintButton>`** — already built in.
2. **`<ColumnResizeHandle>`** in `task-manager-ui.tsx` — add `print:hidden` to its className.
3. **`<SegmentedControl>`** invocations — add `print:hidden` at each call site in `raid-report-panel.tsx` (the Summary | Full Detail toggle) so it doesn't print. The `<SegmentedControl>` component itself stays unchanged; the wrapping `<div>` in the report header gets the class.
4. **`<TableFilter>`** in `reports.tsx` — the search input is uninteresting on paper. Add `print:hidden` to the helper's outer `<div>`.
5. **`<ResetColWidthsButton>`** wrapper — tag the toolbar parent that holds it (in each report).

### Integration sites — 3 reports

| Report file | Print button location | Other `print:hidden` additions |
|---|---|---|
| `reports.tsx` (`ReportsPanel`) | New header row at the top: `<div className="mb-3 flex items-center justify-end print:hidden"><PrintButton lang={lang} /></div>` | `<TableFilter>` outer `<div>`; any toolbar containing `<ResetColWidthsButton>` |
| `raid-report-panel.tsx` (`RaidReportPanel`) | Same flex row as the existing `<h2>` + Summary/Full Detail `<SegmentedControl>` | Wrap the `<SegmentedControl>` in a `print:hidden` container OR add the class to the existing flex parent's `print:hidden` if it includes only chrome (the heading `<h2>` should print) — simplest is to wrap only the SegmentedControl |
| `resources-report.tsx` (`ResourcesReportPanel`) | New header row at top, same shape as `reports.tsx` | None (Resources Report has minimal chrome) |

### i18n keys (EN + DE)

| Key | EN | DE |
|---|---|---|
| `print` | "Print" | "Drucken" |
| `printHint` | "Open the browser print dialog for an A4 handout" | "Browser-Druckdialog für ein A4-Handout öffnen" |
| `versionHighlightPrintReports` | "Reports, RAID Report and Resources Report now have a Print button — produces a clean A4-fitting handout via the browser's print dialog." | "Reports, RAID-Report und Resources-Report haben jetzt eine Drucken-Schaltfläche — erzeugt ein sauberes A4-Handout über den Browser-Druckdialog." |

## Behaviour & semantics

- **`window.print()`** opens the browser's native print dialog. The user can choose "Save as PDF" to export, or pick a physical printer. Cross-browser behaviour is uniform for `window.print()`.
- **`@page` size A4** is a CSS standard supported by Chromium, Firefox, Safari. Browser may ask the user to choose a different paper size; the size in CSS is a default.
- **Margin 1.5 cm** is a comfortable margin that leaves room for binding without wasting too much space.
- **Semantic colors preserved.** `text-AIPM-pink` (overdue) and `text-AIPM-green` (completed) carry meaning the steering committee needs to see at a glance on the printed page.
- **Tile values use `text-AIPM-dark-blue`** — survives the strip (the strip targets surface classes only, not text-AIPM-* accents).

## Edge cases

- **User prints from the MAIN window (not a popout).** The main window's task table + sidebar + chat would all get printed unless we tag them with `print:hidden`. **Out of scope for S3** — this sub-project only adds Print to the three REPORT popouts. The main window already lacks a Print button; nothing changes there. If a user presses Ctrl+P in the main window, they get the messy whole-window output (same as today).
- **Long Full Detail tables span multiple pages.** `tr { page-break-inside: avoid; }` keeps individual rows together; `thead { display: table-header-group; }` repeats the column header on each page (per CSS print spec). Acceptable.
- **The RAID Report's Top 10 mini-table** is intentionally short — fits on one page even with tiles above.
- **Dark mode.** Print should always be on white — the `body { background: white; color: black }` rule handles this regardless of the on-screen theme.
- **Browsers without `@page size`** (very old Safari) fall back to the default paper size from system settings. Acceptable.
- **The `print:` Tailwind variant** requires Tailwind v4 (current). Confirmed available.

## Testing

### Unit tests

- `PrintButton` renders with `lang="en-US"` showing the "Print" label.
- `PrintButton` calls a passed `onClick` when clicked.
- `PrintButton` falls back to `window.print()` when no `onClick` is passed (spy on `window.print` via `vi.spyOn`).
- `PrinterIcon` renders an SVG with the expected role/aria.

### Integration smoke tests

- `ReportsPanel`, `RaidReportPanel`, `ResourcesReportPanel` each render a Print button (find by role "button" name=/print/i within the panel).

### Print CSS

- JSDOM does not evaluate `@media print` reliably, so we don't unit-test the rules. The CHANGELOG entry includes a manual smoke step ("verify the Print dialog shows a clean A4-fitting preview").

### Gates

- `npx tsc --noEmit` 0, `npm run lint` 0 errors, full suite green (existing 922 + ~6 new), `npm run test:coverage` ≥ 70%.

## Release

Minor → **0.20.0 "Jemisin"** (codename retained). New highlight key `versionHighlightPrintReports`.

- `src/app/version.ts`: `APP_VERSION = "0.20.0"`; `APP_BUILD_DATE = "2026-05-28"; // Jemisin milestone`; new top-of-file comment; append `"versionHighlightPrintReports"` as the LAST entry of `APP_HIGHLIGHT_KEYS`.
- `src/app/i18n.ts` + `i18n.de.ts`: 3 new keys (`print`, `printHint`, `versionHighlightPrintReports`).
- `CHANGELOG.md` `[0.20.0] — 2026-05-28 "Jemisin"` entry with `Added` (Print buttons on all 3 reports).
- `src/app/globals.css`: `@media print` block.
- No DESIGN-TOKENS change.

## Plan shape (preview — `writing-plans` skill expands)

1. `PrinterIcon` + `<PrintButton>` in `task-manager-ui.tsx`.
2. `@media print` block in `globals.css`.
3. Add `print:hidden` to `<ColumnResizeHandle>` className.
4. Integrate `<PrintButton>` in `resources-report.tsx`.
5. Integrate `<PrintButton>` in `raid-report-panel.tsx` + `print:hidden` wrapping the `<SegmentedControl>`.
6. Integrate `<PrintButton>` in `reports.tsx` + `print:hidden` on `<TableFilter>` (outer wrapper).
7. i18n EN + DE (3 keys).
8. Tests — `PrintButton` unit tests + 3 smoke-render checks.
9. Release 0.20.0 (version.ts, CHANGELOG).

## What this closes

After 0.20.0 ships, S3 from the 5-item batch is done. **S4 (PDF export buttons + library)** is the last remaining sub-project — its design will mirror this one's `<PrintButton>` shape but route the click through a programmatic PDF generation pipeline (jsPDF or pdfmake; library decision is part of S4's brainstorm).
