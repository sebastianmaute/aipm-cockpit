# Print Reports (0.20.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Print button to Reports, RAID Report, and Resources Report popouts that opens the browser print dialog and produces a clean DIN A4 handout.

**Architecture:** New shared `<PrintButton>` + `PrinterIcon` primitives in `task-manager-ui.tsx` (default onClick = `window.print()`, optional override for future S4 PDF reuse). New `@media print` block in `globals.css` with `@page size: A4`, surface-token stripping, sticky-thead flattening, and page-break hygiene. `print:hidden` tagged on chrome (PrintButton itself, ColumnResizeHandle, the RAID Report Summary/Full Detail SegmentedControl wrapper, and `<TableFilter>` outer wrappers) so the printed output contains only heading + tiles + tables.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-28-print-reports-design.md`
**Branch:** `feat/0.20.0-print-reports` (already created off `main`).

> **Heads-up for the implementer subagent:**
> 1. **Fact-forcing gate.** Before FIRST shell command print 2 facts. Before EVERY Edit/Write, in the SAME message print 4 facts — (a) importers (Grep the new symbol name), (b) symbols affected, (c) data fields (none), (d) instruction verbatim: "adjust the design to follow the following table:". Then retry.
> 2. **win32** — Bash tool, no `&&`-chained `cd`, don't touch eslint.config.mjs.
> 3. After test runs, if `git status` shows `src/app/sample-workspace.md` dirty, `git restore` it BEFORE committing.

---

## Task 1: Add `PrinterIcon` + `<PrintButton>` to `task-manager-ui.tsx`

**Files:** Modify `src/app/task-manager-ui.tsx`.

i18n keys `print` and `printHint` are added in Task 7. The implementer can do Task 7 BEFORE Task 1 to close the i18n key union early (recommended), OR proceed with this task and tolerate the temporary tsc errors on the 2 missing keys. Both approaches end at the same place.

- [ ] **Step 1: Add `PrinterIcon`**

READ `src/app/task-manager-ui.tsx` to locate the existing icon cluster (after `ResetColWidthsIcon`, `EraserIcon`). Insert AFTER the existing `EraserIcon` (~L156) and BEFORE `ColumnResizeHandle` (~L158):

```tsx
export function PrinterIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <rect x="5" y="2.5" width="10" height="5" />
      <rect x="3" y="7.5" width="14" height="7" rx="1" />
      <rect x="5" y="11" width="10" height="6.5" />
      <line x1="5" y1="13" x2="15" y2="13" />
    </svg>
  );
}
```

- [ ] **Step 2: Add `<PrintButton>`**

Append at the end of `task-manager-ui.tsx` (or next to `ResetColWidthsButton`):

```tsx
export function PrintButton({
  onClick,
  lang,
}: {
  onClick?: () => void;
  lang: Lang;
}) {
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

If `Lang` and `t` aren't yet in scope at the top of `task-manager-ui.tsx`, Grep `from "./i18n"` to confirm (they should be — used by `ResetColWidthsButton`).

- [ ] **Step 3: Gates**

```bash
npx tsc --noEmit
npm run lint
```
Expected: 2 tsc errors on missing `print` / `printHint` keys (closed in Task 7) OR 0 if Task 7 was done first. Lint should be 0 errors.

Restore `src/app/sample-workspace.md` if dirty.

- [ ] **Step 4: Commit**

```bash
git add src/app/task-manager-ui.tsx
git commit -m "feat(print): PrinterIcon + PrintButton primitives"
```

---

## Task 2: Add `@media print` block to `globals.css`

**Files:** Modify `src/app/globals.css`.

- [ ] **Step 1: Append the print block at the END of `globals.css`**

After all existing CSS, append:

```css
/* Print: DIN A4 page, strip surface chrome, preserve semantic accents.
   See docs/superpowers/specs/2026-05-28-print-reports-design.md. */
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

- [ ] **Step 2: Gates**

```bash
npx tsc --noEmit
npm run lint
```
Expected: 0 errors (CSS file isn't linted by ESLint here; just make sure the build pipeline doesn't break). Restore `sample-workspace.md` if dirty.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(print): @media print stylesheet — A4, surface strip, page-break hygiene"
```

---

## Task 3: Add `print:hidden` to `<ColumnResizeHandle>`

**Files:** Modify `src/app/task-manager-ui.tsx`.

- [ ] **Step 1: Edit the `ColumnResizeHandle` className**

READ `src/app/task-manager-ui.tsx` around L158–175. The existing className is:
```
absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-AIPM-dark-blue/40 dark:hover:bg-AIPM-blue/40
```

Edit to append `print:hidden`:
- Find: `absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-AIPM-dark-blue/40 dark:hover:bg-AIPM-blue/40`
- Replace: `absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-AIPM-dark-blue/40 dark:hover:bg-AIPM-blue/40 print:hidden`

- [ ] **Step 2: Gates**

```bash
npx tsc --noEmit
npm run lint
```
Expected: 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 3: Commit**

```bash
git add src/app/task-manager-ui.tsx
git commit -m "feat(print): hide ColumnResizeHandle when printing"
```

---

## Task 4: Integrate `<PrintButton>` in `resources-report.tsx`

**Files:** Modify `src/app/resources-report.tsx`.

- [ ] **Step 1: Add the import**

READ `src/app/resources-report.tsx`. Find the import line for `./task-manager-ui` (it imports `ColumnResizeHandle` after 0.17.0). Extend that import to include `PrintButton`:

If the existing import line is e.g. `import { ColumnResizeHandle } from "./task-manager-ui";`, change to:
`import { ColumnResizeHandle, PrintButton } from "./task-manager-ui";`

(Grep `from "./task-manager-ui"` in this file first to see the actual import line.)

- [ ] **Step 2: Add the Print button header row at the top of the panel**

READ the JSX return of `ResourcesReportPanel`. The current return likely starts with a `<div className="space-y-6">` wrapping the empty-state-check + the report sections. Add a small header `<div>` as the FIRST child inside the space-y-6 wrapper:

```tsx
<div className="flex items-center justify-end print:hidden">
  <PrintButton lang={lang} />
</div>
```

Place it BEFORE the `<h2>` if there is one, or as the very first child of the outermost `<div>`.

- [ ] **Step 3: Gates**

```bash
npx tsc --noEmit
npm run lint
npx vitest run resources-report
```
Expected: PASS, 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 4: Commit**

```bash
git add src/app/resources-report.tsx
git commit -m "feat(print): Print button on Resources Report"
```

---

## Task 5: Integrate `<PrintButton>` in `raid-report-panel.tsx` + `print:hidden` SegmentedControl

**Files:** Modify `src/app/raid-report-panel.tsx`.

- [ ] **Step 1: Add the import**

Grep `from "./task-manager-ui"` in `src/app/raid-report-panel.tsx`. Extend (or add) the import to include `PrintButton`.

- [ ] **Step 2: Add the Print button next to the existing SegmentedControl**

READ `raid-report-panel.tsx`. Locate the existing flex row containing the `<h2>` + the Summary/Full Detail `<SegmentedControl>`. The shape today is:
```tsx
<div className="flex items-center justify-between gap-3">
  <h2 className="text-lg font-medium text-foreground">{t(lang, "raidReportTitle")}</h2>
  <SegmentedControl<View>
    value={view}
    ...
  />
</div>
```

Edit to:
- Keep the `<h2>` printed (it's part of the report body).
- Wrap the SegmentedControl + new PrintButton in a `print:hidden` container.

```tsx
<div className="flex items-center justify-between gap-3">
  <h2 className="text-lg font-medium text-foreground">{t(lang, "raidReportTitle")}</h2>
  <div className="flex items-center gap-3 print:hidden">
    <SegmentedControl<View>
      value={view}
      ariaLabel={t(lang, "raidReportTitle")}
      options={[
        { value: "summary", label: t(lang, "raidReportSummary") },
        { value: "full", label: t(lang, "raidReportFullDetail") },
      ]}
      onChange={(v) => setView(v)}
    />
    <PrintButton lang={lang} />
  </div>
</div>
```

(Copy the existing SegmentedControl options + onChange verbatim; only add the wrapping `<div className="flex items-center gap-3 print:hidden">` around it + the PrintButton.)

- [ ] **Step 3: Gates**

```bash
npx tsc --noEmit
npm run lint
npx vitest run raid-report
```
Expected: PASS, 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 4: Commit**

```bash
git add src/app/raid-report-panel.tsx
git commit -m "feat(print): Print button on RAID Report; hide Summary/Full Detail toggle when printing"
```

---

## Task 6: Integrate `<PrintButton>` in `reports.tsx` + `print:hidden` on `<TableFilter>`

**Files:** Modify `src/app/reports.tsx`.

- [ ] **Step 1: Add the import**

Grep `from "./task-manager-ui"` in `src/app/reports.tsx`. The existing import is `import { ColumnResizeHandle, ResetColWidthsButton } from "./task-manager-ui";`. Change to:
- Find: `import { ColumnResizeHandle, ResetColWidthsButton } from "./task-manager-ui";`
- Replace: `import { ColumnResizeHandle, PrintButton, ResetColWidthsButton } from "./task-manager-ui";`

- [ ] **Step 2: Add the Print button header row**

READ the JSX return of `ReportsPanel`. Insert a header row as the FIRST child of the outermost wrapper:

```tsx
<div className="mb-3 flex items-center justify-end print:hidden">
  <PrintButton lang={lang} />
</div>
```

If there's a header row already containing other toolbar chrome, add `<PrintButton>` inline within that flex row at the leftmost position.

- [ ] **Step 3: Add `print:hidden` to `<TableFilter>`'s outer `<div>`**

READ `src/app/reports.tsx` and find `function TableFilter(`. The existing outer `<div>` className is `mb-2 flex items-center gap-2`. Edit:
- Find: `className="mb-2 flex items-center gap-2"`
- Replace: `className="mb-2 flex items-center gap-2 print:hidden"`

- [ ] **Step 4: Gates**

```bash
npx tsc --noEmit
npm run lint
npx vitest run reports
```
Expected: PASS, 0 errors. The new tests in Task 8 will check the smoke render of the Print button. Restore `sample-workspace.md` if dirty.

- [ ] **Step 5: Commit**

```bash
git add src/app/reports.tsx
git commit -m "feat(print): Print button on Reports; hide TableFilter when printing"
```

---

## Task 7: i18n EN + DE

**Files:**
- Modify `src/app/i18n.ts`
- Modify `src/app/i18n.de.ts`

Done early in execution (after Task 1 OR as the very first task) to close the i18n key union before the PrintButton's `t(lang, …)` calls land.

- [ ] **Step 1: Add EN entries to `i18n.ts`**

READ. Add the following keys near other general action keys (e.g. next to `clear`, `cancel`, `save`):

```ts
print: "Print",
printHint: "Open the browser print dialog for an A4 handout",
versionHighlightPrintReports: "Reports, RAID Report and Resources Report now have a Print button — produces a clean A4-fitting handout via the browser's print dialog.",
```

Match indentation, quote style, trailing comma conventions of surrounding entries.

Do NOT touch `APP_HIGHLIGHT_KEYS` here — that array lives in `version.ts`; Task 9 handles it.

- [ ] **Step 2: Add DE entries to `i18n.de.ts`**

```ts
print: "Drucken",
printHint: "Browser-Druckdialog für ein A4-Handout öffnen",
versionHighlightPrintReports: "Reports, RAID-Report und Resources-Report haben jetzt eine Drucken-Schaltfläche — erzeugt ein sauberes A4-Handout über den Browser-Druckdialog.",
```

- [ ] **Step 3: Gates**

```bash
npx tsc --noEmit
npm run lint
npx vitest run
```
Expected: tsc 0; lint 0; full suite green. Restore `sample-workspace.md` if dirty.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(print): i18n EN + DE (print, printHint, versionHighlightPrintReports)"
```

---

## Task 8: Tests

**Files:**
- Modify `src/app/task-manager-ui.test.tsx`
- Modify `src/app/reports.test.tsx`
- Optionally `src/app/raid-report-panel.test.tsx` and `src/app/resources-report.test.tsx` (Grep to check if they exist).

- [ ] **Step 1: Add `PrintButton` unit tests to `task-manager-ui.test.tsx`**

READ `src/app/task-manager-ui.test.tsx` to confirm import style. Append:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrintButton } from "./task-manager-ui";

describe("PrintButton", () => {
  it("renders the Print label and printer icon", () => {
    render(<PrintButton lang="en-US" />);
    expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
  });

  it("calls a passed onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<PrintButton lang="en-US" onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: /print/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("falls back to window.print when no onClick is passed", async () => {
    const user = userEvent.setup();
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    try {
      render(<PrintButton lang="en-US" />);
      await user.click(screen.getByRole("button", { name: /print/i }));
      expect(printSpy).toHaveBeenCalledTimes(1);
    } finally {
      printSpy.mockRestore();
    }
  });
});
```

If existing tests in this file use a different import style (already-imported `describe`/`it`/`expect`/`vi`/`render`/etc. at the top), drop the duplicate imports.

- [ ] **Step 2: Add a smoke-render test to `reports.test.tsx`**

Append to the existing `describe("ReportsPanel — sort + filter", …)` block (after the existing tests):

```tsx
it("renders a Print button in the header", () => {
  renderReports(tasks);
  expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
});
```

The `renderReports` and `tasks` helpers already exist from sub-project S2 (0.19.0).

- [ ] **Step 3: Smoke checks for RAID Report + Resources Report (conditional)**

Grep for `raid-report-panel.test.tsx` and `resources-report.test.tsx` in `src/app/`. If either exists, append a smoke test using its existing fixture builders. If neither exists, skip — the `reports.test.tsx` and `task-manager-ui.test.tsx` additions are the must-haves.

For `resources-report.test.tsx` (if exists) — append a test like:
```tsx
it("renders a Print button", () => {
  render(<ResourcesReportPanel {...minimalProps} />);
  expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
});
```
(Use the existing test file's `minimalProps` or equivalent builder.)

For `raid-report-panel.test.tsx` (if exists) — analogous smoke test.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run
```
Expected: full suite green. Existing 922 + 3 new (PrintButton) + 1 new (reports smoke) + 0–2 new (raid-report / resources-report smoke if files existed) = 926+ pass.

- [ ] **Step 5: Gates**

```bash
npx tsc --noEmit
npm run lint
```
Expected: 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/task-manager-ui.test.tsx src/app/reports.test.tsx
git add src/app/raid-report-panel.test.tsx src/app/resources-report.test.tsx 2>/dev/null || true
git commit -m "test(print): PrintButton unit tests + smoke renders in Reports/RAID/Resources"
```

---

## Task 9: Release 0.20.0

**Files:** `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1: version.ts** — READ first. Set `APP_VERSION = "0.20.0"` (currently `"0.19.0"`). Keep `APP_BUILD_DATE = "2026-05-28"; // Jemisin milestone`. Add a new top-of-file comment block ABOVE the existing `// 0.19.0 …` block:

```ts
// 0.20.0 adds a Print button to Reports, RAID Report, and Resources Report
// popouts. The button opens the browser's print dialog with the report body
// laid out for DIN A4 — toolbars, toggles, and the print button itself are
// hidden via @media print, surface-token backgrounds strip to white for ink
// efficiency, and semantic accent colors (pink/green/dark-blue) are preserved.
```

Append `"versionHighlightPrintReports"` as the LAST entry of `APP_HIGHLIGHT_KEYS`. Match the tuple's `as const` style.

- [ ] **Step 2: CHANGELOG** — READ to match style; add a new `[0.20.0] — 2026-05-28 "Jemisin"` entry ABOVE the `[0.19.0]` entry:

```markdown
## [0.20.0] — 2026-05-28 "Jemisin"

### Added
- Print button on Reports, RAID Report, and Resources Report popouts. Click to open the browser's print dialog with the report body laid out for DIN A4. Toolbars, toggles, filter inputs, and the print button itself are hidden via @media print; surface-token backgrounds strip to white for ink efficiency; semantic accent colors (overdue=pink, completed=green, tile values=dark-blue) survive the strip.
- New version highlight: "Print on reports" (`versionHighlightPrintReports`) in both EN and DE.
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run lint
npm run test:coverage
```
Expected: tsc 0; lint 0; all suites pass; coverage ≥ 70%. Restore `sample-workspace.md` if dirty.

- [ ] **Step 4: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "docs(release): 0.20.0 Jemisin — Print buttons + A4 print stylesheet on reports"
```

---

## Final review

Dispatch a final reviewer over `git diff main...HEAD`. Confirm:

1. **Scope:** only `src/app/task-manager-ui.tsx`, `src/app/task-manager-ui.test.tsx`, `src/app/globals.css`, `src/app/reports.tsx`, `src/app/reports.test.tsx`, `src/app/raid-report-panel.tsx`, `src/app/resources-report.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `src/app/version.ts`, `CHANGELOG.md` touched (+ optionally `raid-report-panel.test.tsx` / `resources-report.test.tsx` if they exist and got smoke tests).
2. **Primitives:** `PrinterIcon` and `PrintButton` exported from `task-manager-ui.tsx`. `PrintButton` has `print:hidden` built-in.
3. **CSS:** `globals.css` has the `@media print` block with `@page size: A4 + margin 1.5cm`, surface-token stripping, sticky-thead flattening, page-break hygiene, and the column-resize-handle defense.
4. **`print:hidden` chrome:** `<ColumnResizeHandle>` has it; `<TableFilter>`'s outer div has it; `raid-report-panel`'s SegmentedControl wrapper has it.
5. **Integrations:** all 3 reports render a `<PrintButton>` in their header area.
6. **i18n:** EN and DE both contain `print`, `printHint`, `versionHighlightPrintReports`.
7. **Release metadata:** `APP_VERSION === "0.20.0"`, `APP_BUILD_DATE` UNCHANGED with `// Jemisin milestone`, `APP_HIGHLIGHT_KEYS` ends with `"versionHighlightPrintReports"`, CHANGELOG `[0.20.0]` entry present.
8. **Gates:** `npx tsc --noEmit` 0; `npm run lint` 0 errors; `npx vitest run` 926+ passing; `npm run test:coverage` ≥ 70%.

After approval, use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:**
- `PrinterIcon` + `<PrintButton>` → Task 1 ✓
- `@media print` block in globals.css → Task 2 ✓
- `print:hidden` on `<ColumnResizeHandle>` → Task 3 ✓
- Integrate Print in Resources Report → Task 4 ✓
- Integrate Print in RAID Report + SegmentedControl wrapper → Task 5 ✓
- Integrate Print in Reports + `<TableFilter>` wrapper → Task 6 ✓
- i18n EN + DE → Task 7 ✓
- Tests (3 PrintButton unit + 1+ smoke renders) → Task 8 ✓
- Release 0.20.0 → Task 9 ✓
- Non-goals (no PDF lib, no new HTML templates, no multi-view print, no main-window print) → none touched ✓

**Placeholder scan:** No TBD/TODO. Task 8 explicitly enumerates the must-have tests; the optional raid-report/resources-report smokes are clearly flagged as "skip if test file doesn't exist."

**Type consistency:** `lang` is `Lang` everywhere; `onClick` is optional `() => void`; the i18n keys `print` / `printHint` / `versionHighlightPrintReports` are used consistently across Tasks 1, 4, 5, 6, 7, 9.

**Ordering note:** Task 7 (i18n) can run as early as immediately after Task 1 to close the i18n key union before Tasks 2–6 do their tsc gates. Recommended dispatch order: 1 → 7 → 2 → 3 → 4 → 5 → 6 → 8 → 9. Subagent-driven runs sequentially, so the 1→9 numerical order also works (Task 1 commits with tsc errors that get closed by Task 7).
