# UI polish — resources toolbars + report headings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five presentation-only fixes: Workload toolbar on one line, Planning date-picker height, Manage-Roles table styling + Chat-style sizing, and a left-aligned heading on the RAID Report and Reports cards.

**Architecture:** Reuse existing shared primitives — lift `useColumnResize` to the parent (the `raid-report-panel` ownership pattern) for Workload; extract Chat's centered half-size class into `view-styles.ts` and share it with Manage Roles; add an optional `title` slot to the shared `ReportCard`. No behavior, data, routing, or i18n-key changes.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-01-ui-polish-resources-report-headings-design.md`

**Conventions:** type-check `npx tsc --noEmit`; lint `npm run lint`; test `npx vitest run <file>`. Scoped `git add` only (never `-A`/`.`). We are already on branch `ui-polish-resources-headings` (created off `main`). Commit locally; push/MR only on request. Tailwind v4 here has no `h-1/2`/`w-1/2` — use `h-[50%]`/`w-[50%]`.

---

## Task 1: Shared centered half-size pane class (Manage Roles = Chat sizing)

**Files:**
- Modify: `src/app/view-styles.ts`
- Modify: `src/app/chat-panel.tsx`
- Modify: `src/app/roles-panel.tsx`
- Test: `src/app/view-pane-sweep.test.ts`

Context: Chat's centered half-size class is currently a private constant in `chat-panel.tsx:105-106`:
```
"relative mx-auto flex h-[50%] max-h-full min-h-[360px] w-[50%] min-w-[420px] flex-col overflow-hidden rounded-xl border border-line bg-surface p-6 resize"
```
`roles-panel.tsx` currently uses `VIEW_PANE_RESIZABLE_CLASS` (fills the viewport). We move the string into `view-styles.ts` and share it.

- [ ] **Step 1: Update the sweep tests (RED).** In `src/app/view-pane-sweep.test.ts`, REPLACE the existing chat test (the `it("chat-panel is a bespoke centered half-size resizable card", …)` block, lines ~74-78) with these three tests:

```ts
  it("view-styles exports CENTERED_HALF_PANE_CLASS (centered, half-size, resizable)", () => {
    const src = readFileSync(join(ROOT, "view-styles.ts"), "utf8");
    expect(src).toContain("CENTERED_HALF_PANE_CLASS");
    expect(src).toMatch(/mx-auto/);
    expect(src).toMatch(/h-\[50%\]/);
    expect(src).toMatch(/\bresize\b/);
  });

  it("chat-panel sources the shared centered half-size class", () => {
    const src = readFileSync(join(__dirname, "chat-panel.tsx"), "utf8");
    expect(src).toContain("CHAT_PANE_CLASS");
    expect(src).toContain("CENTERED_HALF_PANE_CLASS");
  });

  it("manage-roles panel uses the shared centered half-size class", () => {
    const src = readFileSync(join(__dirname, "roles-panel.tsx"), "utf8");
    expect(src).toContain("CENTERED_HALF_PANE_CLASS");
  });
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/app/view-pane-sweep.test.ts`
Expected: the three new assertions fail (constant not yet defined / not yet used).

- [ ] **Step 3: Add the shared constant.** Append to `src/app/view-styles.ts`:

```ts
/** Centered, half-viewport pane card that is ALSO user-resizable: horizontally
 *  centered (mx-auto), top-anchored, half width/height with min bounds, drag the
 *  corner for a custom size. Shared by Chat and Manage Roles. */
export const CENTERED_HALF_PANE_CLASS =
  "relative mx-auto flex h-[50%] max-h-full min-h-[360px] w-[50%] min-w-[420px] flex-col overflow-hidden rounded-xl border border-line bg-surface p-6 resize";
```

- [ ] **Step 4: Point chat-panel at the shared constant.** In `src/app/chat-panel.tsx`:
  - Add the import near the other `./` imports (after the `useResizable` import on line 9):

```ts
import { CENTERED_HALF_PANE_CLASS } from "./view-styles";
```
  - REPLACE the local definition at lines 103-106:

```ts
// Half the content area, centered horizontally, top-anchored, scales with % so
// it shrinks on smaller screens. Drag the corner to a custom size.
const CHAT_PANE_CLASS =
  "relative mx-auto flex h-[50%] max-h-full min-h-[360px] w-[50%] min-w-[420px] flex-col overflow-hidden rounded-xl border border-line bg-surface p-6 resize";
```
  with:

```ts
// Centered half-size, drag-to-resize. Shared with Manage Roles via view-styles.
const CHAT_PANE_CLASS = CENTERED_HALF_PANE_CLASS;
```

- [ ] **Step 5: Point roles-panel at the shared constant.** In `src/app/roles-panel.tsx`:
  - Change the import line `import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";` to:

```ts
import { CENTERED_HALF_PANE_CLASS } from "./view-styles";
```
  - Change the `<section>` className from `VIEW_PANE_RESIZABLE_CLASS` to `CENTERED_HALF_PANE_CLASS`:

```tsx
    <section ref={ref} className={CENTERED_HALF_PANE_CLASS}>
```

- [ ] **Step 6: Run, expect PASS.**
```
npx vitest run src/app/view-pane-sweep.test.ts src/app/chat-panel.test.tsx src/app/roles-panel.test.tsx
npx tsc --noEmit
```
Expected: all green. (`roles-panel.test.tsx` asserts `.resize` exists — still present in the shared class. `chat-panel.test.tsx` asserts the source contains `CHAT_PANE_CLASS` — still present as the alias.)

- [ ] **Step 7: Commit**
```bash
git add src/app/view-styles.ts src/app/chat-panel.tsx src/app/roles-panel.tsx src/app/view-pane-sweep.test.ts
git commit -m "feat: share centered half-size pane class between chat and manage roles"
```

---

## Task 2: Manage-Roles rate-card table matches Directory/Workload

**Files:**
- Modify: `src/app/roles-editor.tsx`
- Test: `src/app/roles-editor.test.tsx` (create)

Context: the rate-card `<table>` in `roles-editor.tsx` (lines ~98-150) is a bare table — no scroll-card wrapper, and its `<th>`/`<td>` cells use `py-1`/`py-1.5` with no horizontal padding. Directory/Workload tables wrap the table in `INNER_TABLE_CLASS` (`min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-surface`) and use `px-3 py-2` cells. The `<thead>` already uses `TABLE_HEAD_CLASS`.

- [ ] **Step 1: Write the failing test.** Create `src/app/roles-editor.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RolesEditor } from "./roles-editor";
import type { Discipline, Grade, Role } from "./types";

const noop = () => {};
const disciplines: Discipline[] = [{ id: 1, name: "Engineering" }];
const grades: Grade[] = [{ id: 1, name: "Senior" }];
const roles: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 }];

function renderEditor() {
  return render(
    <RolesEditor
      lang="en-US"
      roles={roles}
      disciplines={disciplines}
      grades={grades}
      onSaveRole={noop}
      onDeleteRole={noop}
      onResolveOrCreateRole={() => 0}
      onAddDiscipline={() => 0}
      onRenameDiscipline={noop}
      onDeleteDiscipline={noop}
      onReorderDisciplines={noop}
      onAddGrade={() => 0}
      onRenameGrade={noop}
      onDeleteGrade={noop}
      onReorderGrades={noop}
    />,
  );
}

describe("RolesEditor rate-card table", () => {
  it("wraps the rate-card table in the shared inner-table scroll card", () => {
    renderEditor();
    const table = screen.getByRole("table");
    const wrapper = table.parentElement;
    expect(wrapper?.className).toContain("overflow-auto");
    expect(wrapper?.className).toContain("rounded-xl");
    expect(wrapper?.className).toContain("border-line");
  });

  it("uses px-3 py-2 cell padding like the directory/workload tables", () => {
    renderEditor();
    // the Engineering discipline cell is a real data cell
    const cell = screen.getByText("Engineering").closest("td");
    expect(cell?.className).toContain("px-3");
    expect(cell?.className).toContain("py-2");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/app/roles-editor.test.tsx`
Expected: FAIL (table has no `overflow-auto` wrapper; cells use `py-1.5` without `px-3`).

- [ ] **Step 3: Implement.** In `src/app/roles-editor.tsx`:
  - Add `INNER_TABLE_CLASS` to the imports. Add this import line near the other `./` imports (e.g. after the `table-styles` import):

```ts
import { INNER_TABLE_CLASS } from "./view-styles";
```
  - Wrap the rate-card `<table>` in a div with `INNER_TABLE_CLASS`. Change the opening of the table block (the `<table className="w-full text-left text-sm">` … `</table>` inside the `<>` fragment) so the table is wrapped:

```tsx
          <>
          <div className={INNER_TABLE_CLASS}>
          <table className="w-full text-left text-sm">
```
  and add the matching closing `</div>` right after `</table>`:

```tsx
          </table>
          </div>
          <hr className="my-3 border-t border-line" />
          </>
```
  - Change every rate-card `<th>` cell to use `px-3 py-2` and every `<td>` cell to use `px-3 py-2`. Specifically:
    - The four header `<th className="relative py-1" …>` and `<th className="relative py-1 text-right" …>` become `className="relative px-3 py-2"` / `className="relative px-3 py-2 text-right"`.
    - The trailing empty header `<th className="py-1" />` becomes `<th className="px-3 py-2" />`.
    - The body `<td className="py-1.5">` (discipline, grade) become `<td className="px-3 py-2">`.
    - The body `<td className="py-1.5 text-right">` (internal, external, delete) become `<td className="px-3 py-2 text-right">`.

- [ ] **Step 4: Run, expect PASS.**
```
npx vitest run src/app/roles-editor.test.tsx src/app/table-head-sweep.test.ts src/app/roles-panel.test.tsx
npx tsc --noEmit
```
Expected: all green. (`table-head-sweep` still passes — `TABLE_HEAD_CLASS` is unchanged.)

- [ ] **Step 5: Commit**
```bash
git add src/app/roles-editor.tsx src/app/roles-editor.test.tsx
git commit -m "feat: style manage-roles rate card like the directory/workload tables"
```

---

## Task 3: `ReportCard` heading slot — RAID Report + Reports

**Files:**
- Modify: `src/app/report-table.tsx`
- Modify: `src/app/raid-report-panel.tsx`
- Modify: `src/app/reports.tsx`
- Test: `src/app/report-table.test.tsx`

Context: `ReportCard` (`report-table.tsx:127-154`) renders a `justify-end` toolbar row (`print:hidden`) then the children. RAID Report's first child is `<h2>{t(lang,"raidReportTitle")}</h2>`, which lands BELOW the toolbar. Reports has no heading. We add a left-aligned, printable `title` slot and switch the row to `justify-between`.

- [ ] **Step 1: Write the failing test.** Append to `src/app/report-table.test.tsx`:

```tsx
test("renders a left-aligned heading when title is given, outside the print-hidden toolbar", () => {
  function H() {
    const ref = useRef<HTMLDivElement | null>(null);
    return (
      <ReportCard lang="en-US" sizeRef={ref} onResetSize={() => {}} title="My Report">
        <p>body</p>
      </ReportCard>
    );
  }
  render(<H />);
  const heading = screen.getByRole("heading", { name: "My Report" });
  expect(heading).toBeInTheDocument();
  // the heading must NOT live inside the print:hidden button cluster
  expect(heading.closest('[class*="print:hidden"]')).toBeNull();
});

test("omits the heading when no title is given", () => {
  function H() {
    const ref = useRef<HTMLDivElement | null>(null);
    return (
      <ReportCard lang="en-US" sizeRef={ref} onResetSize={() => {}}>
        <p>body</p>
      </ReportCard>
    );
  }
  render(<H />);
  expect(screen.queryByRole("heading")).toBeNull();
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/app/report-table.test.tsx`
Expected: FAIL (`title` prop ignored; no heading rendered).

- [ ] **Step 3: Implement the `title` slot.** In `src/app/report-table.tsx`, change the `ReportCard` signature and header block. REPLACE the whole component (lines 127-154) with:

```tsx
export function ReportCard({
  lang,
  sizeRef,
  onResetSize,
  onResetCols,
  toolbarExtra,
  title,
  children,
}: {
  lang: Lang;
  sizeRef: React.RefObject<HTMLDivElement | null>;
  onResetSize: () => void;
  onResetCols?: () => void;
  toolbarExtra?: React.ReactNode;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div ref={sizeRef} className={`print-root ${VIEW_PANE_RESIZABLE_CLASS}`}>
      <div className="mb-4 flex shrink-0 items-center justify-between gap-2">
        {title ? (
          <h2 className="text-lg font-medium text-foreground">{title}</h2>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2 print:hidden">
          {toolbarExtra}
          <PrintButton lang={lang} />
          {onResetCols && <ResetColWidthsButton onClick={onResetCols} lang={lang} />}
          <ResetSizeButton onClick={onResetSize} lang={lang} />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto">{children}</div>
      <ResizeCornerHint lang={lang} />
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/app/report-table.test.tsx`
Expected: all green (including the existing "renders content inside a resizable print-root card" test).

- [ ] **Step 5: Wire RAID Report.** In `src/app/raid-report-panel.tsx`:
  - Add `title={t(lang, "raidReportTitle")}` to the `<ReportCard …>` props (alongside `toolbarExtra={viewToggle}`).
  - REMOVE the now-duplicate heading line that is the first child of `ReportCard`:

```tsx
      <h2 className="text-lg font-medium text-foreground">{t(lang, "raidReportTitle")}</h2>
```

- [ ] **Step 6: Wire Reports.** In `src/app/reports.tsx`, add `title={t(lang, "tabReports")}` to the `<ReportCard …>` opening tag:

```tsx
    <ReportCard lang={lang} sizeRef={reportsRef} onResetSize={resetReportsSize} onResetCols={resetAllReports} title={t(lang, "tabReports")}>
```

- [ ] **Step 7: Run, expect PASS.**
```
npx vitest run src/app/report-table.test.tsx src/app/raid-report-panel.test.tsx src/app/reports.test.tsx
npx tsc --noEmit
```
Expected: all green (RAID title text still renders — now via the `ReportCard` heading).

- [ ] **Step 8: Commit**
```bash
git add src/app/report-table.tsx src/app/raid-report-panel.tsx src/app/reports.tsx src/app/report-table.test.tsx
git commit -m "feat: left-aligned heading on raid-report and reports cards"
```

---

## Task 4: Workload toolbar on one line (lift `useColumnResize` to the parent)

**Files:**
- Modify: `src/app/resource-workload.tsx`
- Modify: `src/app/resources-panel.tsx`
- Test: `src/app/resource-workload.test.tsx`
- Test: `src/app/resources-panel.test.tsx`

Context: `ResourcesPanel.renderHeader()` draws `[title | ResetSize]`; `ResourceWorkload` draws its own second row `[ResetColWidths]`. Two right-aligned buttons on two rows = vertical stack. We lift Workload's `useColumnResize` into `ResourcesPanel` (the parent already owns Planning/rollup resize; `raid-report-panel` owns all its `useColumnResize` hooks and passes them down). The button labels (for tests): Reset-Cols aria-label is "Reset all column widths back to their defaults."; Reset-Size aria-label is "Reset back to the default size."

- [ ] **Step 1: Update `resource-workload.test.tsx` (RED).** `ResourceWorkload` will require a new `colResize` prop and will no longer render its own reset button. REPLACE the top of `src/app/resource-workload.test.tsx` (the imports + `baseProps`, lines 1-10) with:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ResourceWorkload, WORKLOAD_COL_WIDTHS } from "./resource-workload";
import type { Resource, Task } from "./types";

const r: Resource = { id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent", utilization: {} };
const colResize = {
  colWidths: { ...WORKLOAD_COL_WIDTHS },
  startColResize: () => {},
  resetColWidths: () => {},
};
const baseProps = {
  lang: "en-US" as const, resources: [r], absences: [], shifts: [], today: "2026-06-01",
  onEditResource: vi.fn(), onAddResource: vi.fn(), onEditAbsence: vi.fn(), onEditShift: vi.fn(),
  colResize,
};
```
  Then append this test to the `describe("ResourceWorkload", …)` block:

```tsx
  it("no longer renders its own reset-column-widths button (moved to the panel header)", () => {
    render(<ResourceWorkload {...baseProps} tasks={[]} />);
    expect(screen.queryByRole("button", { name: /reset all column widths/i })).toBeNull();
  });
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/app/resource-workload.test.tsx`
Expected: FAIL (TS/runtime — `WORKLOAD_COL_WIDTHS` not exported, `colResize` prop unknown, reset button still present).

- [ ] **Step 3: Implement `ResourceWorkload`.** In `src/app/resource-workload.tsx`:
  - Export the col-width map + type. Change `const WORKLOAD_COL_WIDTHS = {` to `export const WORKLOAD_COL_WIDTHS = {` and `type WorkloadCol = …` to `export type WorkloadCol = keyof typeof WORKLOAD_COL_WIDTHS;`.
  - Remove the now-unused imports: drop `useColumnResize` from `"./use-column-resize"` and drop `ResetColWidthsButton` from the `"./task-manager-ui"` import (keep `ColumnResizeHandle`).
  - Add `colResize` to `Props` (after `onEditShift`):

```ts
  colResize: {
    colWidths: Record<WorkloadCol, number>;
    startColResize: (col: WorkloadCol, e: React.MouseEvent) => void;
    resetColWidths: () => void;
  };
```
  - Add `colResize` to the destructured params of `ResourceWorkload({ … })`.
  - REPLACE the hook + toolbar block (the `const { colWidths, startColResize: _startColResize, resetColWidths } = useColumnResize…` through the closing `</div>` of the `mb-2 … justify-end` toolbar, i.e. the body from `const { colWidths …` down to the `<div className={INNER_TABLE_CLASS}>` line) with:

```tsx
  const { colWidths } = colResize;
  const startColResize = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={INNER_TABLE_CLASS}>
```
  (This deletes the `mb-2 flex shrink-0 items-center justify-end` toolbar row entirely; the table wrapper and everything below it are unchanged.)

- [ ] **Step 4: Implement `ResourcesPanel`.** In `src/app/resources-panel.tsx`:
  - Extend the workload import to bring in the col-width map + type. Change `import { ResourceWorkload } from "./resource-workload";` to:

```ts
import { ResourceWorkload, WORKLOAD_COL_WIDTHS, type WorkloadCol } from "./resource-workload";
```
  - Add a workload col-resize hook next to the existing `planning`/`rollup` hooks (after line ~132):

```ts
  const workload = useColumnResize<WorkloadCol>("workload", WORKLOAD_COL_WIDTHS);
```
  - In `renderHeader()`, change the planning-only Reset-Cols button to also cover workload. REPLACE:

```tsx
        {view === "planning" && (
          <ResetColWidthsButton onClick={resetPlanningAndRollup} lang={lang} />
        )}
```
  with:

```tsx
        {(view === "planning" || view === "workload") && (
          <ResetColWidthsButton
            onClick={view === "planning" ? resetPlanningAndRollup : workload.resetColWidths}
            lang={lang}
          />
        )}
```
  - Pass the hook down: change the `<ResourceWorkload … />` element (in the `view === "workload"` branch) to add `colResize={workload}`:

```tsx
        <ResourceWorkload
          lang={lang}
          colResize={workload}
          resources={resources}
          tasks={tasks}
          absences={absences}
          shifts={shifts}
          today={today}
          onEditResource={onEditResource}
          onAddResource={onAddResource}
          onEditAbsence={onEditAbsence}
          onEditShift={onEditShift}
        />
```

- [ ] **Step 5: Add the single-row assertion to `resources-panel.test.tsx`.** Append inside `describe("ResourcesPanel", …)`:

```tsx
  test("workload header shows reset-cols and reset-size together (one toolbar, not stacked)", () => {
    render(<ResourcesPanel {...baseProps} view="workload" />);
    // Exactly one reset-column-widths control, now lifted into the panel header
    expect(screen.getAllByRole("button", { name: /reset all column widths/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /reset back to the default size/i })).toBeInTheDocument();
  });
```

- [ ] **Step 6: Run, expect PASS.**
```
npx vitest run src/app/resource-workload.test.tsx src/app/resources-panel.test.tsx src/app/view-pane-sweep.test.ts
npx tsc --noEmit
```
Expected: all green. (`view-pane-sweep` still passes — `resources-panel.tsx` keeps `VIEW_PANE_RESIZABLE_CLASS` on its root and `resource-workload.tsx` keeps `INNER_TABLE_CLASS`.)

- [ ] **Step 7: Commit**
```bash
git add src/app/resource-workload.tsx src/app/resources-panel.tsx src/app/resource-workload.test.tsx src/app/resources-panel.test.tsx
git commit -m "fix: workload reset buttons on one line via lifted column-resize"
```

---

## Task 5: Planning date-picker height matches the controls

**Files:**
- Modify: `src/app/resources-panel.tsx`
- Test: `src/app/resources-panel.test.tsx`

Context: in the planning controls row, the two `<input type="date">` use `className="rounded border border-line px-1.5 py-0.5 dark:bg-surface"` and inherit `text-xs`; the `SegmentedControl` buttons beside them use `px-3 py-1.5 text-sm`. Bump the date inputs to `px-2 py-1.5 text-sm` so the row is one height.

- [ ] **Step 1: Write the failing test.** Append inside `describe("ResourcesPanel", …)` in `src/app/resources-panel.test.tsx`:

```tsx
  test("planning date inputs use the taller py-1.5 control height", () => {
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} view="planning" resources={[]} plan={plan} workdayHours={8}
      onSetUtilization={() => {}} onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    const from = screen.getByLabelText("From");
    expect(from.className).toContain("py-1.5");
    expect(from.className).toContain("text-sm");
  });
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/app/resources-panel.test.tsx`
Expected: FAIL (date input still `px-1.5 py-0.5`, no `text-sm`).

- [ ] **Step 3: Implement.** In `src/app/resources-panel.tsx`, both planning date inputs (the `resourcesPlanStart` and `resourcesPlanEnd` `<input type="date">`) currently end with `className="rounded border border-line px-1.5 py-0.5 dark:bg-surface"`. Change BOTH to:

```tsx
                  className="rounded border border-line px-2 py-1.5 text-sm dark:bg-surface" />
```

- [ ] **Step 4: Run, expect PASS.**
```
npx vitest run src/app/resources-panel.test.tsx
npx tsc --noEmit
```
Expected: green.

- [ ] **Step 5: Commit**
```bash
git add src/app/resources-panel.tsx src/app/resources-panel.test.tsx
git commit -m "fix: planning date pickers match segmented-control height"
```

---

## Task 6: Release v0.38.2

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version.** In `src/app/version.ts`, set `APP_VERSION = "0.38.2"`; keep `APP_BUILD_DATE = "2026-06-01"`. Prepend a `// 0.38.2 …` one-paragraph comment above the `// 0.38.1 …` block: "UI polish: Workload reset buttons sit on one header line (lifted column-resize); Planning date pickers match the segmented-control height; Manage Roles uses the directory/workload table styling and is sized/oriented like Chat (shared CENTERED_HALF_PANE_CLASS); RAID Report and Reports show a left-aligned heading on the toolbar line (ReportCard title slot). No new strings." Do NOT add an `APP_HIGHLIGHT_KEYS` entry (point release).

- [ ] **Step 2: CHANGELOG.** In `CHANGELOG.md`, add a `## 0.38.2` section at the top with these bullets:
```
- Resources → Workload: reset buttons now share one header line (no vertical stack).
- Resources → Planning: date pickers match the control row height.
- Resources → Manage Roles: rate-card table styled like Directory/Workload; panel centered + half-size like Chat.
- RAID Report & Reports: heading sits left on the toolbar line.
```

- [ ] **Step 3: Verify full green.**
```
npx vitest run && npx tsc --noEmit && npm run lint
```
Expected: all pass/clean.

- [ ] **Step 4: Commit**
```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "chore: release v0.38.2 — resources/report UI polish"
```

---

## Self-review (coverage map)
- Spec **A** (workload one line) → Task 4 (lift `useColumnResize`, header Reset-Cols for workload, drop child toolbar). Tested: child has no reset button; panel header has exactly one Reset-Cols + Reset-Size.
- Spec **B** (planning date height) → Task 5 (`px-2 py-1.5 text-sm`). Tested via the From input's className.
- Spec **C1** (roles table styling) → Task 2 (`INNER_TABLE_CLASS` wrapper + `px-3 py-2` cells). Tested via wrapper + cell classes; `table-head-sweep` regression run.
- Spec **C2** (roles sized like chat) → Task 1 (`CENTERED_HALF_PANE_CLASS` shared; roles-panel + chat consume it). Tested via sweep assertions; chat/roles-panel tests stay green.
- Spec **D/E** (report headings) → Task 3 (`ReportCard` `title` slot, `justify-between`, printable; RAID passes `raidReportTitle` + drops dup `<h2>`; Reports passes `tabReports`). Tested: heading present + outside `print:hidden`; absent when no title.
- Spec **versioning** → Task 6. No new i18n keys anywhere (RAID reuses `raidReportTitle`, Reports reuses `tabReports`).
- Type consistency: `WORKLOAD_COL_WIDTHS`/`WorkloadCol` exported from `resource-workload.tsx` and imported by `resources-panel.tsx`; `colResize` prop shape matches `useColumnResize`'s return; `CENTERED_HALF_PANE_CLASS` exported from `view-styles.ts` and consumed by both `chat-panel.tsx` and `roles-panel.tsx`; `ReportCard` `title?: string` consumed by raid-report/reports.
- No placeholders; every code step shows the exact code.
