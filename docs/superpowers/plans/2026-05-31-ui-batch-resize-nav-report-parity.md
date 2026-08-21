# UI Batch v0.38.0 — Resize, Resources Nav Restructure, Report Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every modern-shell pane drag-resizable (fill-by-default), give Chat a centered half-size frame, reorder the Gantt/RAID/Budget toolbars, restructure the Resources navigation (workload/calendar/planning/manage-roles → sub-menu views; parent defaults to the resource report; address-book→directory; resource-report view removed), and bring the RAID & Resource reports up to the Reports layout with sortable/filterable/column-resizable tables.

**Architecture:** Reuse the existing `useResizable(storageKey)` hook for per-pane drag-resize; add a shared `VIEW_PANE_RESIZABLE_CLASS` and two shared UI bits (`ResizeCornerHint`, `ResetSizeButton`). Extract Reports' inline table primitives into a shared `report-table.tsx` consumed by all three report files. Promote resources subviews to first-class nav views routed by `workspace-section.tsx`, keeping `resources-panel.tsx` as the host (prop-driven subview) to avoid a full file split.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-31-ui-batch-resize-nav-report-parity-design.md`

**Conventions for every task below:**
- Type-check: `npx tsc --noEmit`  ·  Lint: `npm run lint`  ·  Tests: `npx vitest run <file>`
- Commit only locally (branch `ui-polish-batch`); never push/merge unless the user asks.
- Scoped `git add` of the listed files only — never `git add -A` / `.`.
- After editing `i18n.de.ts`, grep it for curly quotes (`”` `“`) and fix any the Edit tool introduced.
- `eslint.config.mjs` is hook-blocked — fix source, not the rule.

---

## Phase 0 — Shared infrastructure

### Task 1: `VIEW_PANE_RESIZABLE_CLASS`

**Files:**
- Modify: `src/app/view-styles.ts`
- Test: `src/app/view-pane-sweep.test.ts`

- [ ] **Step 1: Write the failing test** — append to `view-pane-sweep.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("view-styles exports VIEW_PANE_RESIZABLE_CLASS with resize + min bounds", () => {
  const src = readFileSync(join(__dirname, "view-styles.ts"), "utf8");
  expect(src).toMatch(/export const VIEW_PANE_RESIZABLE_CLASS\b/);
  expect(src).toMatch(/VIEW_PANE_FILL_CLASS \+ " resize min-h-\[300px\] min-w-\[480px\]"/);
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `npx vitest run src/app/view-pane-sweep.test.ts`
Expected: FAIL (constant not defined).

- [ ] **Step 3: Implement** — add after the `VIEW_PANE_FILL_CLASS` definition in `view-styles.ts`:

```ts
/** Full-height pane card that is ALSO user-resizable: fills by default, but the
 *  bottom-right corner drags to a custom size (persisted via useResizable). */
export const VIEW_PANE_RESIZABLE_CLASS =
  VIEW_PANE_FILL_CLASS + " resize min-h-[300px] min-w-[480px]";
```

- [ ] **Step 4: Run it, expect PASS**

Run: `npx vitest run src/app/view-pane-sweep.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/app/view-styles.ts src/app/view-pane-sweep.test.ts
git commit -m "feat: add VIEW_PANE_RESIZABLE_CLASS shared pane card"
```

---

### Task 2: `ResizeCornerHint` + `ResetSizeButton` shared UI

**Files:**
- Modify: `src/app/task-manager-ui.tsx` (already exports `ResetSizeIcon`, `ResetColWidthsButton`)
- Test: `src/app/task-manager-ui.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing test:**

```tsx
import { render, screen } from "@testing-library/react";
import { ResizeCornerHint, ResetSizeButton } from "./task-manager-ui";

test("ResizeCornerHint renders the inert braille corner glyph", () => {
  const { container } = render(<ResizeCornerHint lang="en" />);
  expect(container.textContent).toContain("⠿");
});

test("ResetSizeButton calls onClick", async () => {
  const onClick = vi.fn();
  render(<ResetSizeButton onClick={onClick} lang="en" />);
  await screen.getByRole("button").click();
  expect(onClick).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run src/app/task-manager-ui.test.tsx` (exports missing).

- [ ] **Step 3: Implement** — add to `task-manager-ui.tsx` (reuse the existing `ResetSizeIcon` and i18n keys `tableResizeHint` / `tableResetSizeHint`):

```tsx
/** Inert bottom-right corner glyph hinting the pane is drag-resizable. The real
 *  resize is the native CSS `resize` handle; this is a visual cue only. */
export function ResizeCornerHint({ lang }: { lang: Lang }) {
  return (
    <span
      aria-hidden={true}
      title={t(lang, "tableResizeHint")}
      className="pointer-events-none absolute bottom-1 right-1 select-none text-muted-foreground"
    >
      ⠿
    </span>
  );
}

/** Icon button that resets a pane's user-dragged size back to the fill default. */
export function ResetSizeButton({ onClick, lang }: { onClick: () => void; lang: Lang }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t(lang, "tableResetSizeHint")}
      title={t(lang, "tableResetSizeHint")}
      className="rounded-md border border-line bg-surface p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
    >
      <ResetSizeIcon />
    </button>
  );
}
```

Ensure `Lang` and `t` are imported at the top of the file (they are already used elsewhere in it; if not, add `import { type Lang, t } from "./i18n";`).

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/app/task-manager-ui.tsx src/app/task-manager-ui.test.tsx
git commit -m "feat: add shared ResizeCornerHint + ResetSizeButton"
```

---

### Task 3: Extract shared `report-table.tsx` (and refactor reports.tsx onto it)

**Files:**
- Create: `src/app/report-table.tsx`
- Modify: `src/app/reports.tsx` (currently defines `useSortableFilter` ~line 572, `TableFilter`, `compareStrOrNum`, and the `print-root ${VIEW_PANE_CLASS} min-h-full space-y-6 p-6` root ~line 348)
- Test: `src/app/report-table.test.tsx` (create), `src/app/view-pane-sweep.test.ts`

The new module exports (move the existing implementations verbatim from reports.tsx, then import them back):

```tsx
// report-table.tsx
"use client";
import type React from "react";
import { useMemo } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { ColumnResizeHandle, PrintButton, ResetColWidthsButton, ResetSizeButton, ResizeCornerHint } from "./task-manager-ui";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { TABLE_HEAD_CLASS } from "./table-styles";

export type SortDir = "asc" | "desc" | "off";

export function compareStrOrNum(a: string | number, b: string | number): number { /* move from reports.tsx */ }

export function useSortableFilter<Row extends { name: string }, Key extends string>(
  rows: readonly Row[],
  sort: { key: Key; dir: SortDir },
  setSort: (s: { key: Key; dir: SortDir }) => void,
  filter: string,
  getValue: (row: Row, key: Key) => string | number,
) { /* move verbatim from reports.tsx:572-604 */ }

export function TableFilter({ lang, value, onChange, placeholderKey }: {
  lang: Lang; value: string; onChange: (v: string) => void; placeholderKey: TranslationKey;
}) { /* move verbatim from reports.tsx */ }

/** A clickable sort header cell (button + asc/desc/off indicator + resize handle). */
export function SortHeaderButton({ label, active, dir, onClick }: {
  label: string; active: boolean; dir: SortDir; onClick: () => void;
}) {
  const indicator = active ? (dir === "asc" ? " ↑" : " ↓") : "";
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1 ${active ? "text-AIPM-green" : ""} hover:text-AIPM-green`}>
      {label}{indicator}
    </button>
  );
}

/** The Reports-style resizable report card: header toolbar (extra slot + Print +
 *  Reset-cols + Reset-size) over scrollable, sectioned content. `sizeRef`/`onResetSize`
 *  come from a useResizable() in the consumer. */
export function ReportCard({ lang, sizeRef, onResetSize, onResetCols, toolbarExtra, children }: {
  lang: Lang;
  sizeRef: React.RefObject<HTMLDivElement | null>;
  onResetSize: () => void;
  onResetCols?: () => void;
  toolbarExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div ref={sizeRef} className={`print-root ${VIEW_PANE_RESIZABLE_CLASS}`}>
      <div className="mb-4 flex shrink-0 items-center justify-end gap-2 print:hidden">
        {toolbarExtra}
        <PrintButton lang={lang} />
        {onResetCols && <ResetColWidthsButton onClick={onResetCols} lang={lang} />}
        <ResetSizeButton onClick={onResetSize} lang={lang} />
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto">{children}</div>
      <ResizeCornerHint lang={lang} />
    </div>
  );
}
```

- [ ] **Step 1: Write the failing sweep test** — append to `view-pane-sweep.test.ts`:

```ts
test("report files import the shared report-table kit", () => {
  for (const f of ["reports.tsx", "raid-report-panel.tsx", "resources-report.tsx"]) {
    const src = readFileSync(join(__dirname, f), "utf8");
    expect(src, f).toMatch(/from "\.\/report-table"/);
  }
});
```
And a behavioral test in `report-table.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { ReportCard } from "./report-table";

function Harness() {
  const ref = useRef<HTMLDivElement | null>(null);
  return <ReportCard lang="en" sizeRef={ref} onResetSize={() => {}}><p>body</p></ReportCard>;
}
test("ReportCard renders Print, reset-size, corner hint, and content", () => {
  const { container } = render(<Harness />);
  expect(screen.getByText("body")).toBeInTheDocument();
  expect(container.querySelector(".print-root")).toBeTruthy();
  expect(container.textContent).toContain("⠿");
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/app/report-table.test.tsx src/app/view-pane-sweep.test.ts`.

- [ ] **Step 3: Create `report-table.tsx`** moving `compareStrOrNum`, `useSortableFilter`, `TableFilter` verbatim out of `reports.tsx`, plus the new `SortHeaderButton` and `ReportCard` above.

- [ ] **Step 4: Refactor `reports.tsx`** to delete the moved definitions and `import { compareStrOrNum, useSortableFilter, TableFilter, SortHeaderButton, ReportCard, type SortDir } from "./report-table";`. Replace its root `<div className={...VIEW_PANE_CLASS min-h-full space-y-6 p-6}>` + the manual Print/Reset-cols toolbar with `<ReportCard lang={lang} sizeRef={reportsRef} onResetSize={resetReportsSize} onResetCols={resetAllReports}>…sections…</ReportCard>`. Add `const { ref: reportsRef, reset: resetReportsSize } = useResizable("lop-app:reports-size");` (import `useResizable` from `./use-resizable`). Keep `SortDir` referencing the shared type.

- [ ] **Step 5: Run reports + report-table + sweep tests, expect PASS** (existing Reports characterization tests must still pass):

Run: `npx vitest run src/app/reports.test.tsx src/app/report-table.test.tsx src/app/view-pane-sweep.test.ts`
Then `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add src/app/report-table.tsx src/app/reports.tsx src/app/report-table.test.tsx src/app/view-pane-sweep.test.ts
git commit -m "refactor: extract shared report-table kit; reports onto resizable ReportCard"
```

---

## Phase 1 — Resize + toolbar order (Tasks, Chat, Gantt, RAID, Activity)

### Task 4: Tasks modern branch regains drag-resize

**Files:**
- Modify: `src/app/tasks-section.tsx:206-214` (the `fillHeight` ternary) and `:536-537` (the inline corner span)
- Test: `src/app/view-pane-sweep.test.ts`

The `tableRef`/`resetTableSize` already flow in as props (from `useResizable("lop-app:table-size")` in task-manager.tsx) and the section already carries `ref={tableRef}` and a ResetSize button at `:312-320`. Only the class lost `resize`.

- [ ] **Step 1: Failing test** — append to `view-pane-sweep.test.ts`:

```ts
test("tasks-section modern (fillHeight) branch is resizable", () => {
  const src = readFileSync(join(__dirname, "tasks-section.tsx"), "utf8");
  expect(src).toMatch(/fillHeight\s*\?\s*VIEW_PANE_RESIZABLE_CLASS/);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** — in `tasks-section.tsx`:
  - import: `import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";` (replace the `VIEW_PANE_FILL_CLASS` import).
  - change the ternary to `fillHeight ? VIEW_PANE_RESIZABLE_CLASS : "relative mb-10 …"` (classic branch unchanged).
  - replace the inline corner `<span … >⠿</span>` at `:536-537` with `<ResizeCornerHint lang={lang} />` (add `ResizeCornerHint` to the existing `./task-manager-ui` import).

- [ ] **Step 4: Run tasks + sweep tests, expect PASS** — `npx vitest run src/app/tasks-section.tsx --run` is not a test; use `npx vitest run src/app/view-pane-sweep.test.ts` and any `tasks-section.test.tsx`. Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks-section.tsx src/app/view-pane-sweep.test.ts
git commit -m "fix: restore drag-resize on the modern Tasks pane"
```

---

### Task 5: Chat — centered half-size, resizable

**Files:**
- Modify: `src/app/chat-panel.tsx:252` (root) — currently `<div className={VIEW_PANE_FILL_CLASS}>`
- Test: `src/app/chat-panel.test.tsx` (create if absent)

- [ ] **Step 1: Failing test:**

```tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";
test("chat root is the centered half-size resizable card, not the plain fill card", () => {
  const src = readFileSync(join(__dirname, "chat-panel.tsx"), "utf8");
  expect(src).toMatch(/CHAT_PANE_CLASS/);
  expect(src).not.toMatch(/className=\{VIEW_PANE_FILL_CLASS\}/);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** — in `chat-panel.tsx`:
  - add `import { useResizable } from "./use-resizable";` and `import { ResizeCornerHint } from "./task-manager-ui";`
  - add a module-scope const:
    ```tsx
    // Half the content area, centered horizontally, top-anchored, scales with %.
    const CHAT_PANE_CLASS =
      "relative mx-auto flex h-1/2 max-h-full min-h-[360px] w-1/2 min-w-[420px] flex-col overflow-hidden rounded-xl border border-line bg-surface p-6 resize";
    ```
  - inside the component: `const { ref: chatRef, reset: resetChatSize } = useResizable("lop-app:chat-size");`
  - root: `<div ref={chatRef} className={CHAT_PANE_CLASS}>` … keep the existing `flex-1 overflow-y-auto` scroller and input area … before the closing `</div>` add a footer row with the reset-size control and `<ResizeCornerHint lang={lang} />`. Put `<ResetSizeButton onClick={resetChatSize} lang={lang} />` into the existing input button column (`flex flex-col gap-2`) or a small top-right control — simplest: add it next to the send controls. (Import `ResetSizeButton` too.)

- [ ] **Step 4: Run chat + tsc, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/app/chat-panel.tsx src/app/chat-panel.test.tsx
git commit -m "feat: chat is a centered half-size resizable pane"
```

---

### Task 6: Gantt — Add Task before search + pane resize

**Files:**
- Modify: `src/app/gantt.tsx` toolbar `:1038-1161`, the two return roots (`VIEW_PANE_FILL_CLASS` at ~`:1165` and ~`:1186`), and the inner chart `:1188-1191` (remove its `resize` + `panelRef`)
- Test: `src/app/gantt.test.tsx`

- [ ] **Step 1: Failing test** — assert the Add Task button precedes the search input in DOM order and the pane is resizable:

```tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";
test("gantt toolbar: + Add Task markup precedes the search input", () => {
  const src = readFileSync(join(__dirname, "gantt.tsx"), "utf8");
  const addIdx = src.indexOf('onClick={onAddTask}');
  const searchIdx = src.indexOf('type="search"');
  expect(addIdx).toBeGreaterThan(-1);
  expect(addIdx).toBeLessThan(searchIdx);
});
test("gantt pane uses VIEW_PANE_RESIZABLE_CLASS", () => {
  const src = readFileSync(join(__dirname, "gantt.tsx"), "utf8");
  expect(src).toMatch(/VIEW_PANE_RESIZABLE_CLASS/);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement:**
  - Move the `{onAddTask && (<button … >+ Add Task</button>)}` block to be the FIRST child of the toolbar `<div>` (before the `<input type="search">`), and remove `ml-auto` from its className.
  - Replace the inner-chart resize: the `<div ref={panelRef} className="… flex-1 resize overflow-auto …">` becomes `<div className="… flex-1 overflow-auto …">` (drop `resize`; drop `ref={panelRef}`).
  - Move the size ref to the pane: change `const { ref: panelRef } = useResizable("lop-app:gantt-size");` to `const { ref: ganttRef, reset: resetGanttSize } = useResizable("lop-app:gantt-size");`. Attach `ref={ganttRef}` to BOTH return roots and swap `VIEW_PANE_FILL_CLASS` → `VIEW_PANE_RESIZABLE_CLASS` (import it). Add a `ResetSizeButton` to the toolbar (right side) and `<ResizeCornerHint lang={lang} />` before each root's closing tag.

- [ ] **Step 4: Run gantt + tsc, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/app/gantt.tsx src/app/gantt.test.tsx
git commit -m "feat: gantt add-task before search; pane-level resize"
```

---

### Task 7: RAID — remove Open report, Add item before search, pane resize

**Files:**
- Modify: `src/app/raid-panel.tsx` toolbar `:346-448`, root `:451`
- Modify: `src/app/workspace-section.tsx` — drop the `onOpenReport` wiring for RAID (the `openPopoutWindow("raid-report", …)` callback) since the button is removed
- Test: `src/app/raid-panel.test.tsx`

- [ ] **Step 1: Failing test:**

```tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";
test("raid toolbar: add-item precedes search; no open-report button", () => {
  const src = readFileSync(join(__dirname, "raid-panel.tsx"), "utf8");
  const addIdx = src.indexOf("openNew()");
  const searchIdx = src.indexOf('type="search"');
  expect(addIdx).toBeGreaterThan(-1);
  expect(addIdx).toBeLessThan(searchIdx);
  expect(src).not.toMatch(/raidReportOpenReport\b/);
});
test("raid pane uses VIEW_PANE_RESIZABLE_CLASS", () => {
  expect(readFileSync(join(__dirname, "raid-panel.tsx"), "utf8")).toMatch(/VIEW_PANE_RESIZABLE_CLASS/);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement:**
  - Move the `<button … onClick={() => openNew()}>` (Add raid item) to be the FIRST child of the toolbar, before `<input type="search">`; remove `ml-auto`.
  - Delete the entire `{onOpenReport && (<button …>{t(lang,"raidReportOpenReport")}</button>)}` block (`:429-439`). Remove the now-unused `onOpenReport` prop from `raid-panel.tsx`'s Props + destructure, and remove the `onOpenReport={…}` arg where `<RaidPanel>` is rendered in `workspace-section.tsx`.
  - Add resize: `const { ref: raidRef, reset: resetRaidSize } = useResizable("lop-app:raid-size");`; root `<div ref={raidRef} className={VIEW_PANE_RESIZABLE_CLASS}>`; add `ResetSizeButton` to the toolbar and `<ResizeCornerHint lang={lang} />` before the closing root tag. Import `useResizable`, `VIEW_PANE_RESIZABLE_CLASS`, `ResetSizeButton`, `ResizeCornerHint`.

- [ ] **Step 4: Run raid + tsc, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/app/raid-panel.tsx src/app/workspace-section.tsx src/app/raid-panel.test.tsx
git commit -m "feat: raid add-item before search; remove open-report; pane resize"
```

---

### Task 8: Activity — pane resize

**Files:**
- Modify: `src/app/activity-log-panel.tsx:165-177` (root + header toolbar) — already has `PrintButton` + `ResetColWidthsButton`
- Test: `src/app/view-pane-sweep.test.ts`

- [ ] **Step 1: Failing test** — extend the sweep `FILL_FILES`/add an assertion that `activity-log-panel.tsx` matches `VIEW_PANE_RESIZABLE_CLASS`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** — add `useResizable`, `VIEW_PANE_RESIZABLE_CLASS`, `ResetSizeButton`, `ResizeCornerHint`. `const { ref: actRef, reset: resetActSize } = useResizable("lop-app:activity-size");`. Root `<section ref={actRef} className={\`print-root ${VIEW_PANE_RESIZABLE_CLASS}\`}>`. Add `<ResetSizeButton onClick={resetActSize} lang={lang} />` to the header (after `ResetColWidthsButton`) and `<ResizeCornerHint lang={lang} />` before `</section>`.

- [ ] **Step 4: Run sweep + tsc, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/app/activity-log-panel.tsx src/app/view-pane-sweep.test.ts
git commit -m "feat: activity pane drag-resize"
```

---

## Phase 2 — Budget (Group C)

### Task 9: Budget header (bucket-count heading left, buttons right) + resizable card

**Files:**
- Modify: `src/app/budget-panel.tsx:162-186`
- Modify: `src/app/i18n.ts` + `src/app/i18n.de.ts` — add `budgetBucketsCount`
- Test: `src/app/budget-panel.test.tsx`

- [ ] **Step 1: Failing test:**

```tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";
test("budget renders a Buckets (N) heading and is a resizable card", () => {
  const src = readFileSync(join(__dirname, "budget-panel.tsx"), "utf8");
  expect(src).toMatch(/budgetBucketsCount/);
  expect(src).toMatch(/VIEW_PANE_RESIZABLE_CLASS/);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Add i18n key** — in `i18n.ts` (EN) add `budgetBucketsCount: (n: number) => \`${n} buckets\`,` near the other `budget*` keys; in `i18n.de.ts` add `budgetBucketsCount: (n: number) => \`${n} Buckets\`,`. (Match the existing function-valued key style — check how `tasksCount` is declared and mirror it exactly.)

- [ ] **Step 4: Implement header** — replace `budget-panel.tsx:163-186`:
  - root: `import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";`, `import { useResizable } from "./use-resizable";`, `import { ResetSizeButton, ResizeCornerHint } from "./task-manager-ui";`. Add `const { ref: budgetRef, reset: resetBudgetSize } = useResizable("lop-app:budget-size");`. Root becomes `<div ref={budgetRef} className={\`${VIEW_PANE_RESIZABLE_CLASS} gap-6\`}>` (the inner sections already provide spacing; keep `gap-6`). NOTE: drop the old `flex min-h-full flex-col … p-6` literal — `VIEW_PANE_RESIZABLE_CLASS` already supplies `flex flex-col p-6 overflow-hidden`; wrap the scrolling content (`<section>`s) in a `<div className="min-h-0 flex-1 space-y-6 overflow-y-auto">`.
  - header row: left = `<h2 className="text-lg font-medium text-foreground">{t(lang,"tabBudget")} <span className="text-sm font-normal text-muted-foreground">{t(lang,"budgetBucketsCount", report.buckets.length)}</span></h2>`; right cluster (in order): `+ Add Bucket`, `Refresh FX` (move the existing FX button here), `ResetColWidthsButton`, `ResetSizeButton`. Add `<ResizeCornerHint lang={lang} />` before the root closes.

- [ ] **Step 5: Run budget + tsc + lint, expect PASS; grep i18n.de.ts for curly quotes.**

- [ ] **Step 6: Commit**

```bash
git add src/app/budget-panel.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/budget-panel.test.tsx
git commit -m "feat: budget bucket-count heading, right-aligned buttons, resizable card"
```

---

## Phase 3 — Resources navigation restructure (Group D)

### Task 10: Nav config — new tree, view ids, slug remaps

**Files:**
- Modify: `src/app/nav-config.ts`
- Test: `src/app/nav-config.test.ts` (create if absent)

- [ ] **Step 1: Failing test:**

```ts
import { allNavViews, slugToView, NAV_GROUPS } from "./nav-config";
test("resources sub-menu = directory/workload/calendar/planning/manage-roles; no resource-report/address-book", () => {
  const views = allNavViews();
  expect(views).toEqual(expect.arrayContaining(["directory","workload","calendar","planning","manage-roles"]));
  expect(views).not.toContain("resource-report");
  expect(views).not.toContain("address-book");
});
test("removed slugs remap", () => {
  expect(slugToView("address-book")).toBe("directory");
  expect(slugToView("resource-report")).toBe("resources");
  expect(slugToView("totally-unknown")).toBe("open-points");
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** — edit `nav-config.ts`:
  - `AppView`: remove `"address-book"` and `"resource-report"`; add `"directory" | "workload" | "calendar" | "planning" | "manage-roles"`.
  - `NAV_GROUPS` Plan group resources item:
    ```ts
    {
      view: "resources",
      children: [
        { view: "directory" },
        { view: "workload" },
        { view: "calendar" },
        { view: "planning" },
        { view: "manage-roles" },
      ],
    },
    ```
  - `LABEL_KEYS`: drop the two removed entries; add
    ```ts
    directory: "resourcesViewDirectory",
    workload: "resourcesViewWorkload",
    calendar: "resourcesViewCalendar",
    planning: "resourcesViewPlanning",
    "manage-roles": "resourcesManageRoles",
    ```
  - `slugToView`: before the existing fallback, add explicit remaps:
    ```ts
    export function slugToView(slug: string): AppView {
      if (slug === "address-book") return "directory";
      if (slug === "resource-report") return "resources";
      const found = allNavViews().find((v) => viewToSlug(v) === slug);
      return found ?? "open-points";
    }
    ```

- [ ] **Step 4: Run nav-config + tsc, expect PASS.** (tsc will flag every exhaustive `AppView` switch that referenced the removed ids — those are fixed in Task 11–13. If tsc is red only in workspace-section/task-manager, proceed; they're addressed next. Keep this commit's tests green.)

- [ ] **Step 5: Commit**

```bash
git add src/app/nav-config.ts src/app/nav-config.test.ts
git commit -m "feat: resources nav tree restructure + slug remaps"
```

---

### Task 11: RolesEditor extraction + RolesPanel view

**Files:**
- Read first: `src/app/roles-modal.tsx` (full)
- Create: `src/app/roles-editor.tsx` (the editor body, no Modal chrome)
- Create: `src/app/roles-panel.tsx` (modern card view wrapping RolesEditor)
- Modify: `src/app/roles-modal.tsx` (render `<RolesEditor … />` inside the Modal)
- Test: `src/app/roles-panel.test.tsx`, keep `src/app/roles-modal.test.tsx` green

- [ ] **Step 1: Failing test** for RolesPanel:

```tsx
import { render } from "@testing-library/react";
import { RolesPanel } from "./roles-panel";
test("RolesPanel renders the roles editor inside a resizable card", () => {
  const noop = () => {};
  const { container } = render(
    <RolesPanel lang="en" roles={[]} disciplines={[]} grades={[]}
      onSaveRole={noop} onDeleteRole={noop} onResolveOrCreateRole={() => 0}
      onAddDiscipline={() => 0} onRenameDiscipline={noop} onDeleteDiscipline={noop} onReorderDisciplines={noop}
      onAddGrade={() => 0} onRenameGrade={noop} onDeleteGrade={noop} onReorderGrades={noop} />,
  );
  expect(container.querySelector(".resize")).toBeTruthy();
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Extract** — move the editor body of `roles-modal.tsx` (everything inside the `<Modal>` below the `ModalHeader`) into `RolesEditor` in `roles-editor.tsx`. `RolesEditor` props = the existing `Props` minus `open`/`onClose` (keep the data + all `on*` callbacks). It owns the `useColumnResize("roles", …)`, sort state, and add-combo state currently in RolesModal. `RolesModal` keeps `Modal` + `ModalHeader` + `useDraggable` and renders `<RolesEditor {...rest} />`.

- [ ] **Step 4: Create `roles-panel.tsx`:**

```tsx
"use client";
import { useResizable } from "./use-resizable";
import { ResetSizeButton, ResizeCornerHint } from "./task-manager-ui";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { type Lang, t } from "./i18n";
import { RolesEditor, type RolesEditorProps } from "./roles-editor";

export function RolesPanel(props: RolesEditorProps & { lang: Lang }) {
  const { ref, reset } = useResizable("lop-app:manage-roles-size");
  return (
    <section ref={ref} className={VIEW_PANE_RESIZABLE_CLASS}>
      <header className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-foreground">{t(props.lang, "resourcesManageRoles")}</h2>
        <ResetSizeButton onClick={reset} lang={props.lang} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto"><RolesEditor {...props} /></div>
      <ResizeCornerHint lang={props.lang} />
    </section>
  );
}
```
(Export a `RolesEditorProps` type from `roles-editor.tsx`.)

- [ ] **Step 5: Run roles-panel + roles-modal + tsc, expect PASS.**

- [ ] **Step 6: Commit**

```bash
git add src/app/roles-editor.tsx src/app/roles-panel.tsx src/app/roles-modal.tsx src/app/roles-panel.test.tsx
git commit -m "refactor: extract RolesEditor; add modern RolesPanel view"
```

---

### Task 12: resources-panel — drop in-view toggle, prop-driven subview, header cleanup

**Files:**
- Modify: `src/app/resources-panel.tsx` (`:172` view state, `:257-322` header, `:324-...` render switch)
- Test: `src/app/resources-panel.test.tsx`

- [ ] **Step 1: Failing test** — assert the SegmentedControl view toggle and the Manage Roles / Open Report buttons are gone, and a `view` prop selects the subview:

```tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";
test("resources-panel no longer renders the view SegmentedControl or roles/report buttons", () => {
  const src = readFileSync(join(__dirname, "resources-panel.tsx"), "utf8");
  expect(src).not.toMatch(/resourcesViewWorkload.*resourcesViewPlanning/s); // toggle options gone
  expect(src).not.toMatch(/onManageRoles/);
  expect(src).not.toMatch(/onOpenReport/);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement:**
  - Props: add `view: "workload" | "calendar" | "planning";` Remove `onManageRoles`, `onOpenReport`, `onAddResource`, `onOpenAddressBook` (directory moves out — Task 13), and the directory-only callbacks no longer used here. Keep absence/shift/plan/utilization callbacks. Remove `onAddAbsence` from this panel (absence add now lives in the Directory toolbar — Task 13) UNLESS calendar still needs it; per spec it does not.
  - Delete the internal `const [view, setView] = useState<View>("directory");` and the directory branch; drive rendering off the `view` prop. Delete the `SegmentedControl<View>` block and the Manage Roles + Open Report + Add Absence buttons from `renderHeader`. The header keeps: title + count, the planning `ResetColWidthsButton` (when `view==="planning"`), and the calendar Import-Outlook button (when `view==="calendar"`).
  - Keep the root as `VIEW_PANE_FILL_CLASS` for now (resize for these subviews is added in Task 14 via keys workload/calendar/planning; OR fold here: add `useResizable("lop-app:" + view + "-size")`, swap to `VIEW_PANE_RESIZABLE_CLASS`, add ResetSize + corner). Do the resize wiring here to keep the file's edits together.

- [ ] **Step 4: Run resources-panel + tsc, expect PASS** (tsc may still be red in workspace-section until Task 13).

- [ ] **Step 5: Commit**

```bash
git add src/app/resources-panel.tsx src/app/resources-panel.test.tsx
git commit -m "refactor: resources-panel prop-driven subview; header cleanup; resize"
```

---

### Task 13: Directory toolbar + workspace-section routing

**Files:**
- Modify: `src/app/resource-directory.tsx:189-227` (toolbar)
- Modify: `src/app/workspace-section.tsx` (route the new views; remove address-book/resource-report panels; pass `view` + Add Absence to Directory)
- Test: `src/app/resource-directory.test.tsx`, `src/app/workspace-section.test.tsx`

- [ ] **Step 1: Failing tests:**

```tsx
// resource-directory.test.tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";
test("directory toolbar: add-resource then add-absence; reset-cols last; no address-book button", () => {
  const src = readFileSync(join(__dirname, "resource-directory.tsx"), "utf8");
  expect(src).not.toMatch(/resourcesOpenAddressBook/);
  const addRes = src.indexOf("onAddResource");
  const addAbs = src.indexOf("onAddAbsence");
  const resetCols = src.indexOf("ResetColWidthsButton");
  expect(addRes).toBeLessThan(addAbs);
  expect(addAbs).toBeLessThan(resetCols);
});
```

```tsx
// workspace-section.test.tsx — add
test("resources view renders the resource report; manage-roles renders RolesPanel", () => {
  const src = readFileSync(join(__dirname, "workspace-section.tsx"), "utf8");
  expect(src).toMatch(/ResourcesReportPanel/);
  expect(src).toMatch(/RolesPanel/);
  expect(src).not.toMatch(/panel-address-book/);
  expect(src).not.toMatch(/panel-resource-report/);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Directory toolbar** — in `resource-directory.tsx`:
  - add an `onAddAbsence: () => void;` prop.
  - toolbar order: `+ Add Resource`, then a new **Add Absence** button (same dark-blue style as Add Resource), then the search input, then Import-Outlook (if present), then `ResetColWidthsButton` LAST. Remove the entire `{onOpenAddressBook && (…)}` block and the `onOpenAddressBook` prop.

- [ ] **Step 4: workspace-section routing** — edit `workspace-section.tsx`:
  - Remove the `panel-address-book` and `panel-resource-report` tabpanels.
  - For the `resources` view, render `<ResourcesReportPanel … />` (move its props from the old `panel-resource-report`).
  - Add tabpanels/branches for `directory` → `<ResourceDirectory … onAddAbsence={onAddAbsence} />` (no `onOpenAddressBook`); `workload`/`calendar`/`planning` → `<ResourcesPanel view={view} … />`; `manage-roles` → `<RolesPanel … />` (wire the role callbacks previously passed to the roles modal trigger).
  - Apply the chosen `panelClass`/`panelScrollClass` per pane (resizable panes use `panelClass`; the report/roles cards manage their own scroll).
  - Remove the `onOpenReport`/`onManageRoles` props passed to `<ResourcesPanel>`.

- [ ] **Step 5: Run directory + workspace-section + tsc + lint, expect PASS.**

- [ ] **Step 6: Commit**

```bash
git add src/app/resource-directory.tsx src/app/workspace-section.tsx src/app/resource-directory.test.tsx src/app/workspace-section.test.tsx
git commit -m "feat: directory toolbar + route resources sub-menu views"
```

---

## Phase 4 — Report parity (Group G)

### Task 14: RAID report onto ReportCard + sortable/filterable/resizable

**Files:**
- Modify: `src/app/raid-report-panel.tsx`
- Test: `src/app/raid-report-panel.test.tsx`

- [ ] **Step 1: Failing test:**

```tsx
import { render, screen } from "@testing-library/react";
import { RaidReportPanel } from "./raid-report-panel";
const items = [{ id: 1, category: "Risk", title: "X", severity: "High", status: "Open", owner: "A", raisedDate: "2026-01-01", targetDate: null, linkedTaskIds: [] }] as any;
test("raid report uses the resizable ReportCard and exposes a filter input + resize handles", () => {
  const { container } = render(<RaidReportPanel lang="en" items={items} today="2026-05-31" />);
  expect(container.querySelector(".print-root.resize")).toBeTruthy();
  expect(container.querySelector('input[type="search"]')).toBeTruthy(); // TableFilter
  expect(container.querySelectorAll('[data-resize-handle], .cursor-col-resize').length).toBeGreaterThan(0); // ColumnResizeHandle
});
```
(Adjust the resize-handle selector to whatever `ColumnResizeHandle` renders — inspect it once.)

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** — wrap the existing content in `<ReportCard lang={lang} sizeRef={ref} onResetSize={reset} onResetCols={resetAllRaidCols} toolbarExtra={<SegmentedControl … summary/full … />}>`. Add `const { ref, reset } = useResizable("lop-app:raid-report-size");`. Convert the **Full Detail** table's `SortTh` to the shared `SortHeaderButton` + add a `TableFilter` (filter by title/owner) + `ColumnResizeHandle` per `<th>` backed by a `useColumnResize("raidReportDetail", …)` width map. For the summary `ReportTableShell` tables, add `ColumnResizeHandle` + `useColumnResize` width maps and make their header cells sortable via `useSortableFilter` where a `name` field exists (rows expose `name`; map severity/status/owner/category labels to `name`). Keep the empty-state guard. Import from `./report-table`, `./use-column-resize`, `./use-resizable`.

- [ ] **Step 4: Run raid-report + tsc, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/app/raid-report-panel.tsx src/app/raid-report-panel.test.tsx
git commit -m "feat: raid report — reports-style resizable card, sortable/filterable/resizable tables"
```

---

### Task 15: Resource report onto ReportCard + sortable/filterable/resizable

**Files:**
- Modify: `src/app/resources-report.tsx`
- Test: `src/app/resources-report.test.tsx`

- [ ] **Step 1: Failing test** (mirror Task 14's structure for `ResourcesReportPanel` — assert `.print-root.resize`, a `TableFilter` search input, and sort buttons exist).

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement:**
  - Wrap content in `<ReportCard lang={lang} sizeRef={ref} onResetSize={reset} onResetCols={resetAllResCols}>`; the card is the `resources` landing pane (key `lop-app:resources-size`) — `const { ref, reset } = useResizable("lop-app:resources-size");`.
  - The local `Table` component already does column-resize via `ColumnResizeHandle`; extend it to make headers sortable (`SortHeaderButton`) and add a `TableFilter` above tables whose rows have a label/name (By Resource, By Discipline, etc.). Wire sorting with `useSortableFilter` by mapping each table's row to a `name` (the first column's label) — reuse the existing `useColumnResize` width maps already declared (`byPeriod`, `byDiscipline`, `byGrade`, `byCombo`, `byResource`). Provide a combined reset `resetAllResCols` that calls each `.resetColWidths()`.

- [ ] **Step 4: Run resources-report + tsc, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/app/resources-report.tsx src/app/resources-report.test.tsx
git commit -m "feat: resource report — reports-style resizable card, sortable/filterable/resizable tables"
```

---

## Phase 5 — Finalize

### Task 16: Version + CHANGELOG + highlight key

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify: `src/app/i18n.ts` + `src/app/i18n.de.ts` (one new highlight key)
- Test: existing `src/app/version.test.ts` (if it asserts the highlight-key/i18n parity) — run it.

- [ ] **Step 1:** Bump `APP_VERSION` to `"0.38.0"`; prepend a `// 0.38.0 "<codename>" …` summary block (groups A–G) above the existing notes; set `APP_BUILD_DATE` codename comment. Append one `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` (e.g. `versionHighlightPaneResize`) and add its EN+DE string in both i18n files.

- [ ] **Step 2:** Add a `## 0.38.0` section to `CHANGELOG.md` describing groups A–G.

- [ ] **Step 3:** Run the full suite + tsc + lint:

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all green. Grep `i18n.de.ts` for stray curly quotes.

- [ ] **Step 4: Commit**

```bash
git add src/app/version.ts CHANGELOG.md src/app/i18n.ts src/app/i18n.de.ts
git commit -m "chore: release v0.38.0 — resize, resources nav, report parity"
```

---

## Self-review notes (coverage map)

- Spec S1 (resize affordance) → Tasks 1, 2; applied in 4–9, 12, 14, 15.
- Spec S2 (report-table kit) → Task 3; consumed in 14, 15.
- Group A (resize on all panes) → 4 (tasks), 5 (chat), 6 (gantt), 7 (raid), 8 (activity), 9 (budget), 12 (workload/calendar/planning), 3 (reports), 11 (manage-roles), 14/15 (reports).
- Group B (chat half-size) → Task 5.
- Group C (budget header) → Task 9.
- Group D (resources nav) → Tasks 10, 11, 12, 13.
- Group E (gantt toolbar) → Task 6.
- Group F (raid toolbar) → Task 7.
- Group G (report parity) → Tasks 3, 14, 15.
- Versioning → Task 16.

**Known follow-through for the implementer:** confirm `ColumnResizeHandle`'s rendered DOM (selector used in 14/15 tests) and the exact function-valued i18n key style (`tasksCount`) before writing 9/16's i18n entries; both are existing patterns to copy, not invent.
