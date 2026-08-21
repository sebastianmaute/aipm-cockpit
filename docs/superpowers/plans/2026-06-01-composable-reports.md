# Composable Reports + Landscape Print Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Reports view append RAID / Budget / Resource reports below its task analytics (persisted, removable) inside one print card, and default in-app printing to A4 landscape.

**Architecture:** Each dedicated report panel gains an `embedded` prop that renders its content without the `ReportCard` chrome. `ReportsPanel` hosts the task analytics plus the embedded reports chosen via an "+ Add report" select, persisted in `settings.reports.extra`. A one-line `globals.css` `@page` change makes in-app print landscape.

**Tech Stack:** Next.js 16, React, TypeScript, Tailwind, Vitest + React Testing Library.

**Reference spec:** `docs/superpowers/specs/2026-06-01-composable-reports-design.md`

**Conventions (every task):**
- Single-file test: `npx vitest run src/app/<file>.test.tsx`
- Full gate before each commit: `npx vitest run && npx tsc --noEmit && npx eslint .`
- Commits: conventional, NO `Co-Authored-By` trailer; don't skip hooks.
- `i18n.de.ts`: keep `"` delimiters ASCII (umlauts inside fine); grep `'[“”‘’]'` after editing.
- Before each commit, if `sample-workspace.md` shows modified (dev-server churn), `git checkout -- sample-workspace.md` — never stage it. Stage only the listed files.
- Branch is `fix-budget-empty-add-bucket` (already has the 0.41.1 fix); do NOT switch branches.
- Task order keeps tsc/eslint/tests green at every commit.

---

### Task 1: i18n keys for the add-report control

**Files:** `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add EN keys to `i18n.ts`** (near the other `reports*` keys):
```ts
  reportsAddReport: "Add report",
  reportsRemoveReport: "Remove report",
  reportsAddReportNone: "All reports added",
```
- [ ] **Step 2: Add DE keys to `i18n.de.ts`** (ASCII `"` delimiters; umlauts fine):
```ts
  reportsAddReport: "Bericht hinzufügen",
  reportsRemoveReport: "Bericht entfernen",
  reportsAddReportNone: "Alle Berichte hinzugefügt",
```
- [ ] **Step 3: Verify** — `npx tsc --noEmit` (parity); `Select-String -Path src/app/i18n.de.ts -Pattern '[“”‘’]'` shows no curly quotes on the added lines.
- [ ] **Step 4: Full gate + commit**
```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: add i18n strings for the add-report control"
```

---

### Task 2: `addable-reports.ts` registry + sanitizer

**Files:** Create `src/app/addable-reports.ts`; Test `src/app/addable-reports.test.ts`

- [ ] **Step 1: Write the failing test `src/app/addable-reports.test.ts`**
```ts
import { describe, expect, test } from "vitest";
import { ADDABLE_REPORTS, sanitizeExtraReports } from "./addable-reports";

describe("addable-reports", () => {
  test("registry has the three reports in canonical order", () => {
    expect(ADDABLE_REPORTS.map((r) => r.id)).toEqual(["raid-report", "budget-report", "resource-report"]);
  });
  test("sanitizeExtraReports keeps valid ids in canonical order, drops junk + dups", () => {
    expect(sanitizeExtraReports(["budget-report", "raid-report", "budget-report", "nope"]))
      .toEqual(["raid-report", "budget-report"]);
  });
  test("sanitizeExtraReports returns [] for non-arrays", () => {
    expect(sanitizeExtraReports(undefined)).toEqual([]);
    expect(sanitizeExtraReports("budget-report")).toEqual([]);
    expect(sanitizeExtraReports(null)).toEqual([]);
  });
});
```
- [ ] **Step 2: Run — expect FAIL** (`npx vitest run src/app/addable-reports.test.ts`).
- [ ] **Step 3: Implement `src/app/addable-reports.ts`**
```ts
import type { TranslationKey } from "./i18n";

/** The reports that can be appended into the Reports view, in render order. */
export const ADDABLE_REPORTS = [
  { id: "raid-report", titleKey: "raidReportTitle" },
  { id: "budget-report", titleKey: "budgetReportTitle" },
  { id: "resource-report", titleKey: "resourcesReportTitle" },
] as const satisfies ReadonlyArray<{ id: string; titleKey: TranslationKey }>;

export type AddableReportId = (typeof ADDABLE_REPORTS)[number]["id"];

/** Keep only valid, unique ids, returned in ADDABLE_REPORTS order. */
export function sanitizeExtraReports(input: unknown): AddableReportId[] {
  if (!Array.isArray(input)) return [];
  return ADDABLE_REPORTS.filter((r) => input.includes(r.id)).map((r) => r.id);
}
```
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Full gate + commit**
```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add src/app/addable-reports.ts src/app/addable-reports.test.ts
git commit -m "feat: add addable-reports registry and sanitizer"
```

---

### Task 3: `embedded` prop on the three report panels

**Files:** `src/app/budget-report-panel.tsx`, `src/app/resources-report.tsx`, `src/app/raid-report-panel.tsx` (+ their `.test.tsx`)

Pattern for all three: add `embedded?: boolean` to the `Props` interface and `embedded = false` to the destructure. Keep every hook and the empty-state early return exactly where they are. Capture the current `<ReportCard>`'s children into a `content` fragment, then:
```tsx
if (embedded) return <div className="space-y-6">{content}</div>;
return <ReportCard …>{content}</ReportCard>;
```

- [ ] **Step 1: Budget panel** — in `budget-report-panel.tsx`, add `embedded?: boolean` to `Props`, `embedded = false` to the destructure. Replace the final `return (<ReportCard …>…</ReportCard>)` with:
```tsx
  const content = (
    <>
      {/* the existing <Section title={t(lang,"budgetReportProjectTotal")}>…</Section> */}
      {/* and the existing <BucketDetailTable …/> — moved here UNCHANGED */}
    </>
  );
  if (embedded) return <div className="space-y-6">{content}</div>;
  return (
    <ReportCard lang={lang} sizeRef={ref} onResetSize={reset} onResetCols={detail.resetColWidths} title={t(lang, "budgetReportTitle")}>
      {content}
    </ReportCard>
  );
```
(Move the existing Section + BucketDetailTable JSX verbatim into `content`. The `if (buckets.length === 0)` early return stays above and serves both modes.)

- [ ] **Step 2: Budget test** — append to `budget-report-panel.test.tsx`:
```ts
it("embedded mode renders content without the ReportCard print button", () => {
  renderPanel({ embedded: true });
  expect(screen.getByText(/project total/i)).toBeInTheDocument();
  expect(screen.getByText("Alpha")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /print/i })).toBeNull();
});
```
(The existing `renderPanel` helper spreads `over`, so `{ embedded: true }` flows through.)

- [ ] **Step 3: Resources panel** — in `resources-report.tsx`, add `embedded?: boolean` to `Props` + `embedded = false`. Wrap the existing `<ReportCard …>` children into `const content = (<>…</>)` and apply the same `if (embedded) return <div className="space-y-6">{content}</div>;` before the `ReportCard` return. The `resourcesReportEmpty` early return stays.

- [ ] **Step 4: Resources test** — append to `resources-report.test.tsx` (mirror its existing render helper/props):
```ts
it("embedded mode renders content without a print button", () => {
  // use the same props the other tests in this file pass to ResourcesReportPanel, plus embedded
  render(<ResourcesReportPanel lang="en-US" resources={resources} roles={roles} disciplines={disciplines} grades={grades} plan={plan} absences={[]} holidaySet={new Set()} workdayHours={8} embedded />);
  expect(screen.queryByRole("button", { name: /print/i })).toBeNull();
});
```
(Read the file's existing fixtures — `resources`, `roles`, `disciplines`, `grades`, `plan` — and reuse them; match how the file already constructs them.)

- [ ] **Step 5: RAID panel** — in `raid-report-panel.tsx`, add `embedded?: boolean` to `Props` (`interface Props { lang; items; today; embedded?: boolean }`) + `embedded = false`. After the `if (items.length === 0)` early return, compute the effective view and content:
```tsx
  const effectiveView: View = embedded ? "summary" : view;
  const content = (
    <>
      {effectiveView === "summary" && (
        <>
          {/* the existing summary tiles + SeverityTable/StatusTable/OwnerTable/TopOpenTable/CategoryTable/AgingTable — moved here UNCHANGED */}
        </>
      )}
      {effectiveView === "full" && (
        <DetailTable lang={lang} rows={rep.fullDetail} colResize={detail} />
      )}
    </>
  );
  if (embedded) return <div className="space-y-6">{content}</div>;
  const viewToggle = (
    /* the existing <SegmentedControl<View> …/> */
  );
  return (
    <ReportCard lang={lang} sizeRef={ref} onResetSize={reset} onResetCols={resetAllCols} toolbarExtra={viewToggle} title={t(lang, "raidReportTitle")}>
      {content}
    </ReportCard>
  );
```
(Move the existing summary block and the full `DetailTable` into `content`; move the existing `viewToggle` JSX down as shown. Embedded forces `"summary"` and renders no toggle.)

- [ ] **Step 6: RAID test** — append to `raid-report-panel.test.tsx` (reuse its `items` fixture):
```ts
it("embedded mode shows summary content and no Summary/Full toggle or print button", () => {
  render(<RaidReportPanel lang="en-US" items={items} today={TODAY} embedded />);
  expect(screen.queryByRole("button", { name: /print/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /full detail/i })).toBeNull();
});
```
(Use the file's existing `items` and date constant; if the date is named differently than `TODAY`, use the actual name.)

- [ ] **Step 7:** Run the three panel tests, then full gate.
```
npx vitest run src/app/budget-report-panel.test.tsx src/app/resources-report.test.tsx src/app/raid-report-panel.test.tsx
npx vitest run && npx tsc --noEmit && npx eslint .
```
Expected: all pass (existing non-embedded tests unchanged).
- [ ] **Step 8: Commit**
```bash
git add src/app/budget-report-panel.tsx src/app/budget-report-panel.test.tsx src/app/resources-report.tsx src/app/resources-report.test.tsx src/app/raid-report-panel.tsx src/app/raid-report-panel.test.tsx
git commit -m "feat: add embedded render mode to the report panels"
```

---

### Task 4: persist `settings.reports.extra`

**Files:** `src/app/settings-types.ts`, `src/app/use-settings.ts` (+ a test for the merge sanitize, see step 4)

- [ ] **Step 1: Extend the `Settings` type (`settings-types.ts`)**
Add the import at the top:
```ts
import type { AddableReportId } from "./addable-reports";
```
Add the field to `Settings` (after `layout`):
```ts
  reports?: { extra: AddableReportId[] };
```
Add to `defaultSettings` (after `layout: "modern",`):
```ts
  reports: { extra: [] },
```

- [ ] **Step 2: Sanitize on load (`use-settings.ts`)**
Add the import:
```ts
import { sanitizeExtraReports } from "./addable-reports";
```
In the `merged` object (alongside `popout`/`resources`), add:
```ts
            reports: {
              extra: sanitizeExtraReports(
                isPlainObject(parsed.reports) ? (parsed.reports as { extra?: unknown }).extra : undefined,
              ),
            },
```

- [ ] **Step 3: Run — expect green** (`npx tsc --noEmit`; existing settings tests still pass).

- [ ] **Step 4: Add a merge test** — if `src/app/use-settings.test.ts(x)` exists, add a case that a persisted `reports.extra` with junk is sanitized on load; otherwise add the coverage at the unit level in `addable-reports.test.ts` (already covers `sanitizeExtraReports`) and note the merge wiring is type-checked. Prefer the real merge test if the file exists:
```ts
// in the existing use-settings test, simulate localStorage with reports.extra junk and assert settings.reports.extra === ["budget-report"]
```
(If no such test file exists, skip adding one — the sanitizer is already unit-tested and the merge is type-safe.)

- [ ] **Step 5: Full gate + commit**
```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add src/app/settings-types.ts src/app/use-settings.ts
# include the test file if you added/edited one
git commit -m "feat: persist the composed reports selection in settings"
```

---

### Task 5: compose embedded reports in `ReportsPanel` + wire the call site

**Files:** `src/app/reports.tsx` (+ `reports.test.tsx`), `src/app/workspace-section.tsx`

- [ ] **Step 1: Write failing tests — append to `reports.test.tsx`**
Add `fireEvent` to the `@testing-library/react` import. Add budget fixtures + a render helper with the new props, then tests:
```ts
import type { BudgetBucket, ResourcePlan, Role } from "./types";

const brPlan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-01-31", granularity: "month", currency: "EUR" };
const brRoles: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
const brBuckets: BudgetBucket[] = [
  { id: 1, name: "Alpha", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 40 } }] },
];

function renderComposed(extraReports: string[], onChange = vi.fn()) {
  render(
    <ReportsPanel
      tasks={[makeTask({ id: 1, assignee: "A" })]}
      today={TODAY}
      holidaySet={new Set()}
      lang="en-US"
      buckets={brBuckets}
      plan={brPlan}
      roles={brRoles}
      disciplines={[{ id: 1, name: "Consulting" }]}
      grades={[{ id: 1, name: "Junior" }]}
      resources={[]}
      absences={[]}
      workdayHours={8}
      fxRates={null}
      raid={[]}
      extraReports={extraReports as never}
      onChangeExtraReports={onChange}
    />,
  );
  return onChange;
}

describe("ReportsPanel — composed reports", () => {
  it("renders an appended report's content when in extraReports", () => {
    renderComposed(["budget-report"]);
    expect(screen.getByText(/project total/i)).toBeInTheDocument(); // Budget report body
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
  it("the add-report select appends a chosen report", () => {
    const onChange = renderComposed([]);
    fireEvent.change(screen.getByLabelText(/add report/i), { target: { value: "budget-report" } });
    expect(onChange).toHaveBeenCalledWith(["budget-report"]);
  });
  it("a report's remove button removes it", () => {
    const onChange = renderComposed(["budget-report"]);
    fireEvent.click(screen.getByRole("button", { name: /remove report/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
```
- [ ] **Step 2: Run — expect FAIL** (`ReportsPanel` rejects the new props / no compose).

- [ ] **Step 3: Implement in `reports.tsx`**
Add imports:
```ts
import { RaidReportPanel } from "./raid-report-panel";
import { BudgetReportPanel } from "./budget-report-panel";
import { ResourcesReportPanel } from "./resources-report";
import { ADDABLE_REPORTS, type AddableReportId } from "./addable-reports";
import type {
  Absence, BudgetBucket, Discipline, FxRates, Grade, RaidItem, Resource, ResourcePlan, Role,
} from "./types";
```
(Keep the existing `{ type Priority, PRIORITIES, type Task }` import; `PRIORITIES` must stay a value import.)

Extend the signature (defaulted optionals so existing 4-prop callers still typecheck):
```ts
export function ReportsPanel({
  tasks, today, holidaySet, lang,
  raid = [], buckets = [], plan, roles = [], disciplines = [], grades = [],
  resources = [], absences = [], workdayHours = 8, fxRates = null,
  extraReports = [], onChangeExtraReports,
}: {
  tasks: Task[];
  today: string;
  holidaySet: Set<string>;
  lang: Lang;
  raid?: RaidItem[];
  buckets?: BudgetBucket[];
  plan?: ResourcePlan;
  roles?: Role[];
  disciplines?: Discipline[];
  grades?: Grade[];
  resources?: Resource[];
  absences?: Absence[];
  workdayHours?: number;
  fxRates?: FxRates | null;
  extraReports?: AddableReportId[];
  onChangeExtraReports?: (next: AddableReportId[]) => void;
}) {
```

Before the `return (<ReportCard …>`, build the add-report control and an embedded-report renderer:
```tsx
  const remainingReports = ADDABLE_REPORTS.filter((r) => !extraReports.includes(r.id));
  const addReportControl = (
    <select
      aria-label={t(lang, "reportsAddReport")}
      value=""
      disabled={remainingReports.length === 0}
      onChange={(e) => {
        const id = e.target.value as AddableReportId;
        if (id) onChangeExtraReports?.([...extraReports, id]);
      }}
      className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs disabled:opacity-50"
    >
      <option value="">{remainingReports.length === 0 ? t(lang, "reportsAddReportNone") : `+ ${t(lang, "reportsAddReport")}`}</option>
      {remainingReports.map((r) => (
        <option key={r.id} value={r.id}>{t(lang, r.titleKey)}</option>
      ))}
    </select>
  );

  const renderEmbedded = (id: AddableReportId) => {
    if (id === "raid-report") return <RaidReportPanel embedded lang={lang} items={raid} today={today} />;
    if (id === "budget-report") return plan ? <BudgetReportPanel embedded lang={lang} buckets={buckets} plan={plan} roles={roles} resources={resources} absences={absences} holidaySet={holidaySet} workdayHours={workdayHours} fxRates={fxRates} /> : null;
    if (id === "resource-report") return plan ? <ResourcesReportPanel embedded lang={lang} resources={resources} roles={roles} disciplines={disciplines} grades={grades} plan={plan} absences={absences} holidaySet={holidaySet} workdayHours={workdayHours} /> : null;
    return null;
  };
```

Pass `toolbarExtra={addReportControl}` to the `<ReportCard>` (it currently has no `toolbarExtra`), and append — as the LAST children inside the `<ReportCard>`, after the "By Label" `<Section>` — the composed reports:
```tsx
      {extraReports.map((id) => {
        const meta = ADDABLE_REPORTS.find((r) => r.id === id);
        if (!meta) return null;
        return (
          <div key={id}>
            <div className="mb-2 flex items-center justify-between gap-2 border-t border-line pt-4">
              <h3 className="text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, meta.titleKey)}</h3>
              <button
                type="button"
                onClick={() => onChangeExtraReports?.(extraReports.filter((x) => x !== id))}
                aria-label={t(lang, "reportsRemoveReport")}
                title={t(lang, "reportsRemoveReport")}
                className="rounded-md border border-transparent px-2 py-0.5 text-xs text-muted-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted print:hidden"
              >
                ×
              </button>
            </div>
            {renderEmbedded(id)}
          </div>
        );
      })}
```
The `<ReportCard …>` opening tag becomes:
```tsx
    <ReportCard lang={lang} sizeRef={reportsRef} onResetSize={resetReportsSize} onResetCols={resetAllReports} toolbarExtra={addReportControl} title={t(lang, "tabReports")}>
```

- [ ] **Step 4: Wire the call site (`workspace-section.tsx`)**
Replace the `<ReportsPanel … />` call with:
```tsx
            <ReportsPanel
              tasks={tasks}
              today={today}
              holidaySet={holidaySet}
              lang={lang}
              raid={raid}
              buckets={budgets}
              plan={plan}
              roles={roles}
              disciplines={disciplines}
              grades={grades}
              resources={resources}
              absences={absences}
              workdayHours={settings.resources.workdayHours}
              fxRates={fxRates}
              extraReports={settings.reports?.extra ?? []}
              onChangeExtraReports={(next) => setSettings((s) => ({ ...s, reports: { extra: next } }))}
            />
```
(`raid`, `budgets`, `plan`, `roles`, `disciplines`, `grades`, `resources`, `absences`, `fxRates`, `settings`, `setSettings` are all in scope — `setSettings` comes from `useSettings()`; if the component currently destructures only `settings`, add `setSettings` to that destructure.)

- [ ] **Step 5: Run reports tests, then full gate**
```
npx vitest run src/app/reports.test.tsx
npx vitest run && npx tsc --noEmit && npx eslint .
```
Expected: composed tests pass; existing task-report tests stay green.
- [ ] **Step 6: Commit**
```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add src/app/reports.tsx src/app/reports.test.tsx src/app/workspace-section.tsx
git commit -m "feat: compose addable reports into the reports view"
```

---

### Task 6: default in-app print to landscape

**Files:** `src/app/globals.css`; Test `src/app/print-orientation.test.ts` (create)

- [ ] **Step 1: Write the failing test `src/app/print-orientation.test.ts`**
```ts
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("print orientation", () => {
  test("in-app @page defaults to A4 landscape", () => {
    const css = readFileSync(fileURLToPath(new URL("./globals.css", import.meta.url)), "utf8");
    expect(css).toMatch(/@page\s*\{[^}]*size:\s*A4 landscape/);
  });
});
```
- [ ] **Step 2: Run — expect FAIL** (`npx vitest run src/app/print-orientation.test.ts`) — current css is `size: A4`.
- [ ] **Step 3: Edit `globals.css`** — in the `@media print { @page { … } }` block, change `size: A4;` to `size: A4 landscape;` (leave `margin: 1.5cm;` and all other print rules unchanged).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Full gate + commit**
```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add src/app/globals.css src/app/print-orientation.test.ts
git commit -m "feat: default in-app printing to A4 landscape"
```

---

### Task 7: version 0.42.0 "Le Guin" + docs

**Files:** `src/app/version.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `CHANGELOG.md`, `README.md`, `docs/CODEMAPS/*.md`

- [ ] **Step 1: `version.ts`** — set `APP_VERSION = "0.42.0"`, `APP_BUILD_DATE = "2026-06-01"`, `APP_MILESTONE = "Le Guin"`. Prepend, above the current top comment block:
```ts
// 0.42.0 "Le Guin" makes the Reports view composable: an "+ Add report" control
// appends the RAID, Budget, and Resource reports below the task analytics, each
// removable, the chosen set persisted in settings — all inside one print card.
// In-app printing now defaults to A4 landscape. (Folds in the 0.41.1 fix: the
// Budget empty-state "+ Add bucket…" prompt is a real button.)
```
Append `"versionHighlightComposableReports"` to the END of `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 2: Highlight strings**
`i18n.ts`:
```ts
  versionHighlightComposableReports: "Add the RAID, Budget, and Resource reports into the Reports view and print them together in landscape.",
```
`i18n.de.ts`:
```ts
  versionHighlightComposableReports: "RAID-, Budget- und Ressourcenberichte in die Berichtsansicht aufnehmen und zusammen im Querformat drucken.",
```

- [ ] **Step 3: `CHANGELOG.md`** — prepend (above the existing `## [0.41.1]` entry):
```markdown
## [0.42.0] — 2026-06-01 "Le Guin"

### Added
- **Composable Reports:** the Reports view has an "+ Add report" control that appends the RAID Report, Budget Report, and/or Resource Report below the task analytics. Each is removable, the selection persists, and the whole view prints as one document.

### Changed
- In-app printing now defaults to A4 landscape (matching the PDF export).
```

- [ ] **Step 4: `README.md`** — version line → `v0.42.0 "Le Guin"`.
- [ ] **Step 5: `docs/CODEMAPS/*.md`** — bump the stamp upper bound to `0.42.0` (grep `0.41.0`/`0.29.0` for the exact stamp; bump only the upper bound) across all 5 files.
- [ ] **Step 6: Verify + commit**
Curly-quote guard on `i18n.de.ts`. Full gate green.
```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md README.md docs/CODEMAPS
git commit -m "chore: release v0.42.0 -- composable reports + landscape print"
```

---

## Final verification (after all tasks)

- [ ] `npx vitest run` green; `npx tsc --noEmit` clean; `npx eslint .` clean.
- [ ] Manual smoke: Reports view shows "+ Add report"; adding Budget/RAID/Resource appends each below the task reports with a × to remove; reload keeps the selection; Print preview is landscape; the dedicated Budget/RAID/Resource nav views still render their full cards.
- [ ] `git checkout -- sample-workspace.md` if churned.
- [ ] Final whole-branch code review.
