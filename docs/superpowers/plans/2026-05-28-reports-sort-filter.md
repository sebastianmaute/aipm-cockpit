# Reports Sort + Filter (0.19.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Reports popout's three sortable sub-tables (By Assignee, By Group, By Label) sortable + filterable with click-to-sort headers and a text-search filter above each table.

**Architecture:** Single-file change in `src/app/reports.tsx`. Add three small in-file helpers (`SortTh`, `TableFilter`, `compareStrOrNum`). Extract the inline By Assignee `<table>` into a typed `<AssigneeTable>` helper; extend the existing `<GroupOrLabelTable>` with `sort` + `setSort` + `filter` + `setFilter` props. Three independent `useState` hook pairs in `<ReportsPanel>`. Mirrors the `raid-report-panel.tsx` FullDetail sortable pattern shipped at 0.18.0.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-28-reports-sort-filter-design.md`
**Reference:** `src/app/raid-report-panel.tsx` (the `FullDetail` + `SortTh` pattern).
**Branch:** `feat/0.19.0-reports-sort-filter` (already created off `main`).

> **Heads-up for the implementer subagent:**
> 1. **Fact-forcing gate.** Before FIRST shell command print 2 facts. Before EVERY Edit/Write, in the SAME message print 4 facts — (a) importers (Grep `ReportsPanel` / `GroupOrLabelTable`), (b) symbols affected, (c) data fields (Stats / GroupOrLabelRow shapes from existing types), (d) instruction verbatim: "adjust the design to follow the following table:". Then retry.
> 2. **win32** — Bash tool, no `&&`-chained `cd`, don't touch eslint.config.mjs.
> 3. After test runs, if `git status` shows `src/app/sample-workspace.md` dirty, `git restore` it BEFORE committing.

---

## Task 1: Add `SortTh`, `TableFilter`, `compareStrOrNum`, and per-table sort-key types

**Files:** Modify `src/app/reports.tsx`.

- [ ] **Step 1: Add the `useState` import**

READ `src/app/reports.tsx` line 3:
- Find: `import { useMemo } from "react";`
- Replace: `import { useMemo, useState } from "react";`

- [ ] **Step 2: Add the per-table sort-key types**

After the existing `REPORTS_BY_X_COL_WIDTHS` block (~L34), insert:

```ts
type SortDir = "asc" | "desc" | "off";

type AssigneeSortKey = "assignee" | "total" | "open" | "overdue" | "onTime" | "late" | "inquiries";
type AssigneeSort = { key: AssigneeSortKey; dir: SortDir };

type GroupOrLabelSortKey = "name" | "total" | "open" | "completed" | "overdue" | "inquiries";
type GroupOrLabelSort = { key: GroupOrLabelSortKey; dir: SortDir };
```

- [ ] **Step 3: Add the three helpers near the existing `Tile` helper (~L664)**

Insert AFTER the existing `Tile` helper (or anywhere at module scope after the type aliases):

```tsx
function compareStrOrNum(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function SortTh<TKey extends string>({
  label,
  k,
  sortKey,
  dir,
  onClick,
  align,
}: {
  label: string;
  k: TKey;
  sortKey: TKey;
  dir: SortDir;
  onClick: (k: TKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === k && dir !== "off";
  const indicator = active ? (dir === "asc" ? " ↑" : " ↓") : "";
  return (
    <th className={`relative px-3 py-2 ${align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 ${active ? "text-foreground" : ""} hover:text-foreground`}
      >
        {label}{indicator}
      </button>
    </th>
  );
}

function TableFilter({
  lang,
  value,
  onChange,
  placeholderKey,
}: {
  lang: Lang;
  value: string;
  onChange: (v: string) => void;
  placeholderKey: "reportsFilterAssignee" | "reportsFilterGroup" | "reportsFilterLabel";
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t(lang, placeholderKey)}
        aria-label={t(lang, placeholderKey)}
        className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-AIPM-dark-blue focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t(lang, "clear")}
          title={t(lang, "clear")}
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-muted-foreground hover:bg-surface-muted hover:text-foreground"
        >
          ×
        </button>
      )}
    </div>
  );
}
```

The i18n keys `reportsFilterAssignee` / `reportsFilterGroup` / `reportsFilterLabel` / `reportsNoMatches` are added in Task 2 (next), which closes the key-string union before integrations land.

`clear` i18n key — Grep `"clear":` in `i18n.ts` to confirm it exists; if absent, add it in Task 2.

- [ ] **Step 4: Gates**

```bash
npx tsc --noEmit
npm run lint
```
Expected: 0 errors (or temporary unresolved-key errors that Task 2 will close — only commit this if temporary errors are limited to the four new keys above). Restore `sample-workspace.md` if dirty.

- [ ] **Step 5: Commit**

```bash
git add src/app/reports.tsx
git commit -m "feat(reports): SortTh + TableFilter helpers + compareStrOrNum + sort-key types"
```

---

## Task 2: i18n EN + DE — all new keys

**Files:**
- Modify `src/app/i18n.ts`
- Modify `src/app/i18n.de.ts`

Runs IMMEDIATELY after Task 1 to close the i18n key union before Task 3+ integrations.

- [ ] **Step 1: Add EN entries to `i18n.ts`**

READ the file. Add the following keys near the existing `reports*` entries. Match existing style (indentation, quotes, trailing comma).

```ts
reportsFilterAssignee: "Filter assignees…",
reportsFilterGroup: "Filter groups…",
reportsFilterLabel: "Filter labels…",
reportsNoMatches: "No matches for current filter.",
versionHighlightReportsSortFilter: "Reports tables (By Assignee, By Group, By Label) are now sortable and filterable — click any header to sort, type in the search box to narrow rows.",
```

**If MISSING** (Grep `"clear":` in the file first):

```ts
clear: "Clear",
```

**Do NOT append to `APP_HIGHLIGHT_KEYS`** here — that array lives in `version.ts`; Task 7 handles it.

- [ ] **Step 2: Add DE entries to `i18n.de.ts`**

```ts
reportsFilterAssignee: "Assignees filtern…",
reportsFilterGroup: "Gruppen filtern…",
reportsFilterLabel: "Labels filtern…",
reportsNoMatches: "Keine Treffer für den aktuellen Filter.",
versionHighlightReportsSortFilter: "Reports-Tabellen (Nach Assignee, Nach Gruppe, Nach Label) sind sortier- und filterbar — Spaltenkopf zum Sortieren klicken, Filtertext eingeben, um Zeilen einzugrenzen.",
```

If `clear` was added on the EN side, add `clear: "Leeren",` here too.

- [ ] **Step 3: Gates**

```bash
npx tsc --noEmit
npm run lint
npx vitest run
```
Expected: tsc 0; lint 0; all suites pass (existing 915). Restore `sample-workspace.md` if dirty.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(reports): i18n EN + DE for sort/filter (placeholders, no-matches, highlight)"
```

---

## Task 3: Extract inline By Assignee `<table>` into a typed `<AssigneeTable>` helper

**Files:** Modify `src/app/reports.tsx`.

The By Assignee table is currently inline in `<ReportsPanel>` (~L493–553). Extract it into a helper next to `<GroupOrLabelTable>`. The helper takes sort + filter props from day one (Task 4 wires them).

- [ ] **Step 1: Add the `<AssigneeTable>` helper**

Insert AFTER the existing `<GroupOrLabelTable>` (~L662 onward):

```tsx
function AssigneeTable({
  rows,
  lang,
  colWidths,
  onStartResize,
  sort,
  setSort,
  filter,
  setFilter,
}: {
  rows: Stats["byAssignee"];
  lang: Lang;
  colWidths: Record<ReportsAssigneeCol, number>;
  onStartResize: (col: string, e: React.MouseEvent) => void;
  sort: AssigneeSort;
  setSort: (s: AssigneeSort) => void;
  filter: string;
  setFilter: (v: string) => void;
}) {
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, filter]);

  const sorted = useMemo(() => {
    if (sort.dir === "off") return filtered;
    const k = sort.key;
    const arr = filtered.slice().sort((a, b) => {
      const av = k === "assignee" ? a.name : (a[k as Exclude<AssigneeSortKey, "assignee">] ?? 0);
      const bv = k === "assignee" ? b.name : (b[k as Exclude<AssigneeSortKey, "assignee">] ?? 0);
      const c = compareStrOrNum(av, bv);
      return c !== 0 ? c : a.name.localeCompare(b.name);
    });
    if (sort.dir === "desc") arr.reverse();
    return arr;
  }, [filtered, sort]);

  function click(k: AssigneeSortKey) {
    if (k !== sort.key) {
      setSort({ key: k, dir: "asc" });
      return;
    }
    setSort({ key: sort.key, dir: sort.dir === "asc" ? "desc" : sort.dir === "desc" ? "off" : "asc" });
  }

  return (
    <div>
      {rows.length > 0 && (
        <TableFilter lang={lang} value={filter} onChange={setFilter} placeholderKey="reportsFilterAssignee" />
      )}
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-surface-muted text-foreground uppercase tracking-wide">
            <tr>
              <th className="relative px-3 py-2" style={{ width: colWidths.assignee, minWidth: colWidths.assignee }}>
                <button
                  type="button"
                  onClick={() => click("assignee")}
                  className={`inline-flex items-center gap-1 ${sort.key === "assignee" && sort.dir !== "off" ? "text-foreground" : ""} hover:text-foreground`}
                >
                  {t(lang, "assignee")}{sort.key === "assignee" && sort.dir !== "off" ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                </button>
                <ColumnResizeHandle col="assignee" onMouseDown={onStartResize} />
              </th>
              {(["total", "open", "overdue", "onTime", "late", "inquiries"] as const).map((k) => {
                const labelKey: Record<typeof k, string> = {
                  total: "reportsTotal",
                  open: "reportsOpen",
                  overdue: "reportsOverdue",
                  onTime: "reportsCompletedOnTime",
                  late: "reportsCompletedLate",
                  inquiries: "reportsInquiriesCol",
                } as const;
                const active = sort.key === k && sort.dir !== "off";
                const indicator = active ? (sort.dir === "asc" ? " ↑" : " ↓") : "";
                return (
                  <th key={k} className="relative px-3 py-2 text-right" style={{ width: colWidths[k], minWidth: colWidths[k] }}>
                    <button
                      type="button"
                      onClick={() => click(k)}
                      className={`inline-flex items-center gap-1 ${active ? "text-foreground" : ""} hover:text-foreground`}
                    >
                      {t(lang, labelKey[k])}{indicator}
                    </button>
                    <ColumnResizeHandle col={k} onMouseDown={onStartResize} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.length === 0 && filter !== "" ? (
              <tr>
                <td colSpan={7} className="px-3 py-3 text-center text-xs text-muted-foreground">
                  {t(lang, "reportsNoMatches")}
                </td>
              </tr>
            ) : (
              sorted.map((row) => (
                <tr key={row.name}>
                  <td className="px-3 py-2 font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">{row.name}</td>
                  <td className="px-3 py-2 text-right">{row.total}</td>
                  <td className="px-3 py-2 text-right">{row.open}</td>
                  <td className={`px-3 py-2 text-right ${row.overdue > 0 ? "text-AIPM-pink font-semibold" : ""}`}>{row.overdue}</td>
                  <td className="px-3 py-2 text-right text-AIPM-green">{row.onTime}</td>
                  <td className="px-3 py-2 text-right text-AIPM-pink">{row.late}</td>
                  <td className="px-3 py-2 text-right">{row.inquiries}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

(The headers are inlined rather than using `SortTh` because each `<th>` carries a `ColumnResizeHandle` sibling that `SortTh` doesn't accommodate. The `<GroupOrLabelTable>` integration in Task 5 follows the same inline pattern. `SortTh` from Task 1 stays in the file for now; if it ends up unused after the full integration, remove it in a follow-up cleanup commit.)

- [ ] **Step 2: Gates**

```bash
npx tsc --noEmit
npm run lint
```
Expected: 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 3: Commit**

```bash
git add src/app/reports.tsx
git commit -m "feat(reports): extract AssigneeTable helper with sort + filter pipeline"
```

---

## Task 4: Wire By Assignee state in `<ReportsPanel>` + replace inline JSX

**Files:** Modify `src/app/reports.tsx`.

- [ ] **Step 1: Add the state hooks**

Inside `<ReportsPanel>`, near the existing `useColumnResize` calls (Grep `useColumnResize` to find the cluster). Add:

```ts
const [assigneeSort, setAssigneeSort] = useState<AssigneeSort>({ key: "total", dir: "desc" });
const [assigneeFilter, setAssigneeFilter] = useState("");
```

- [ ] **Step 2: Replace the inline By Assignee `<Section>` body with `<AssigneeTable>`**

Find the existing `<Section title={t(lang, "reportsByAssignee")}>` block (~L493). Replace its inner `<div className="overflow-x-auto...">...</div>` with:

```tsx
<Section title={t(lang, "reportsByAssignee")}>
  <AssigneeTable
    rows={stats.byAssignee}
    lang={lang}
    colWidths={assignee.colWidths}
    onStartResize={assigneeStartResize}
    sort={assigneeSort}
    setSort={setAssigneeSort}
    filter={assigneeFilter}
    setFilter={setAssigneeFilter}
  />
</Section>
```

(`assignee`, `assigneeStartResize` are the existing locals from `useColumnResize` for this table — verify their exact names by Grep before editing.)

- [ ] **Step 3: Gates**

```bash
npx tsc --noEmit
npm run lint
npx vitest run
```
Expected: tsc 0, lint 0, full suite green (existing 915). Restore `sample-workspace.md` if dirty.

- [ ] **Step 4: Commit**

```bash
git add src/app/reports.tsx
git commit -m "feat(reports): wire By Assignee sort + filter state"
```

---

## Task 5: Extend `<GroupOrLabelTable>` with sort + filter and wire By Group / By Label

**Files:** Modify `src/app/reports.tsx`.

- [ ] **Step 1: Replace `<GroupOrLabelTable>` body**

READ the existing `function GroupOrLabelTable({ ... })` (~L588). Replace its body entirely:

```tsx
function GroupOrLabelTable({
  rows,
  lang,
  headerKey,
  emptyKey,
  colWidths,
  onStartResize,
  sort,
  setSort,
  filter,
  setFilter,
  filterPlaceholderKey,
}: {
  rows: GroupOrLabelRow[];
  lang: Lang;
  headerKey: "group" | "labels";
  emptyKey: "reportsNoGroups" | "reportsNoLabels";
  colWidths: Record<string, number>;
  onStartResize: (col: string, e: React.MouseEvent) => void;
  sort: GroupOrLabelSort;
  setSort: (s: GroupOrLabelSort) => void;
  filter: string;
  setFilter: (v: string) => void;
  filterPlaceholderKey: "reportsFilterGroup" | "reportsFilterLabel";
}) {
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, filter]);

  const sorted = useMemo(() => {
    if (sort.dir === "off") return filtered;
    const k = sort.key;
    const arr = filtered.slice().sort((a, b) => {
      const av = k === "name" ? a.name : (a[k as Exclude<GroupOrLabelSortKey, "name">] ?? 0);
      const bv = k === "name" ? b.name : (b[k as Exclude<GroupOrLabelSortKey, "name">] ?? 0);
      const c = compareStrOrNum(av, bv);
      return c !== 0 ? c : a.name.localeCompare(b.name);
    });
    if (sort.dir === "desc") arr.reverse();
    return arr;
  }, [filtered, sort]);

  function click(k: GroupOrLabelSortKey) {
    if (k !== sort.key) {
      setSort({ key: k, dir: "asc" });
      return;
    }
    setSort({ key: sort.key, dir: sort.dir === "asc" ? "desc" : sort.dir === "desc" ? "off" : "asc" });
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t(lang, emptyKey)}</p>;
  }

  return (
    <div>
      <TableFilter lang={lang} value={filter} onChange={setFilter} placeholderKey={filterPlaceholderKey} />
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-surface-muted text-foreground uppercase tracking-wide">
            <tr>
              <th className="relative px-3 py-2" style={{ width: colWidths.label, minWidth: colWidths.label }}>
                <button
                  type="button"
                  onClick={() => click("name")}
                  className={`inline-flex items-center gap-1 ${sort.key === "name" && sort.dir !== "off" ? "text-foreground" : ""} hover:text-foreground`}
                >
                  {t(lang, headerKey)}{sort.key === "name" && sort.dir !== "off" ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                </button>
                <ColumnResizeHandle col="label" onMouseDown={onStartResize} />
              </th>
              {(["total", "open", "completed", "overdue", "inquiries"] as const).map((k) => {
                const labelKey: Record<typeof k, string> = {
                  total: "reportsTotal",
                  open: "reportsOpen",
                  completed: "reportsCompleted",
                  overdue: "reportsOverdue",
                  inquiries: "reportsInquiriesCol",
                } as const;
                const active = sort.key === k && sort.dir !== "off";
                const indicator = active ? (sort.dir === "asc" ? " ↑" : " ↓") : "";
                return (
                  <th key={k} className="relative px-3 py-2 text-right" style={{ width: colWidths[k], minWidth: colWidths[k] }}>
                    <button
                      type="button"
                      onClick={() => click(k)}
                      className={`inline-flex items-center gap-1 ${active ? "text-foreground" : ""} hover:text-foreground`}
                    >
                      {t(lang, labelKey[k])}{indicator}
                    </button>
                    <ColumnResizeHandle col={k} onMouseDown={onStartResize} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.length === 0 && filter !== "" ? (
              <tr>
                <td colSpan={6} className="px-3 py-3 text-center text-xs text-muted-foreground">
                  {t(lang, "reportsNoMatches")}
                </td>
              </tr>
            ) : (
              sorted.map((row) => (
                <tr key={row.name}>
                  <td className="px-3 py-2 font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">{row.name}</td>
                  <td className="px-3 py-2 text-right">{row.total}</td>
                  <td className="px-3 py-2 text-right">{row.open}</td>
                  <td className="px-3 py-2 text-right text-AIPM-green">{row.completed}</td>
                  <td className={`px-3 py-2 text-right ${row.overdue > 0 ? "text-AIPM-pink font-semibold" : ""}`}>{row.overdue}</td>
                  <td className="px-3 py-2 text-right">{row.inquiries}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the state hooks in `<ReportsPanel>`**

Near the `assigneeSort` / `assigneeFilter` lines added in Task 4, append:

```ts
const [groupSort, setGroupSort] = useState<GroupOrLabelSort>({ key: "total", dir: "desc" });
const [groupFilter, setGroupFilter] = useState("");
const [labelSort, setLabelSort] = useState<GroupOrLabelSort>({ key: "total", dir: "desc" });
const [labelFilter, setLabelFilter] = useState("");
```

- [ ] **Step 3: Update the two `<GroupOrLabelTable>` invocations**

The By Group invocation (~L563):
```tsx
<GroupOrLabelTable
  rows={stats.byGroup}
  lang={lang}
  headerKey="group"
  emptyKey="reportsNoGroups"
  colWidths={byX.colWidths}
  onStartResize={byXStartResize}
/>
```
Change to:
```tsx
<GroupOrLabelTable
  rows={stats.byGroup}
  lang={lang}
  headerKey="group"
  emptyKey="reportsNoGroups"
  colWidths={byX.colWidths}
  onStartResize={byXStartResize}
  sort={groupSort}
  setSort={setGroupSort}
  filter={groupFilter}
  setFilter={setGroupFilter}
  filterPlaceholderKey="reportsFilterGroup"
/>
```

And the By Label invocation (~L574) — same shape but with `labelSort` / `setLabelSort` / `labelFilter` / `setLabelFilter`, `headerKey="labels"`, `emptyKey="reportsNoLabels"`, `filterPlaceholderKey="reportsFilterLabel"`.

- [ ] **Step 4: Gates**

```bash
npx tsc --noEmit
npm run lint
npx vitest run
```
Expected: tsc 0, lint 0, full suite green. Restore `sample-workspace.md` if dirty.

- [ ] **Step 5: Commit**

```bash
git add src/app/reports.tsx
git commit -m "feat(reports): extend GroupOrLabelTable with sort + filter; wire By Group / By Label"
```

---

## Task 6: Tests in `reports.test.tsx`

**Files:** Create `src/app/reports.test.tsx`.

- [ ] **Step 1: Create the test file**

Create `src/app/reports.test.tsx`. The test file mocks the minimal `<ReportsPanel>` props and asserts the 7 behaviours. Match the actual `Task` shape from `./types` — read it first.

```tsx
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ReportsPanel } from "./reports";
import type { Task } from "./types";

const TODAY = "2026-05-28";

function makeTask(p: Partial<Task> & { id: number; assignee: string }): Task {
  return {
    id: p.id,
    taskName: p.taskName ?? `Task ${p.id}`,
    assignee: p.assignee,
    assigneeEmail: p.assigneeEmail ?? "",
    priority: p.priority ?? "Medium",
    startDate: p.startDate ?? TODAY,
    dueDate: p.dueDate ?? TODAY,
    completedDate: p.completedDate,
    lastUpdateDate: p.lastUpdateDate ?? TODAY,
    blockers: p.blockers ?? "",
    notes: p.notes ?? "",
    estimate: p.estimate,
    spent: p.spent,
    inquiriesSent: p.inquiriesSent ?? 0,
    group: p.group ?? "",
    labels: p.labels ?? [],
    depRelations: p.depRelations ?? [],
    status: p.status ?? "Open",
  } as unknown as Task;
}

function renderReports(tasks: Task[]) {
  return render(
    <ReportsPanel
      tasks={tasks}
      lang="en-US"
      today={TODAY}
      holidaySet={new Set()}
    />,
  );
}

function sectionByTitle(re: RegExp): HTMLElement {
  const heading = screen.getByText(re);
  return heading.closest("div") as HTMLElement;
}

function rowNamesIn(section: HTMLElement): string[] {
  const tbody = section.querySelector("tbody");
  if (!tbody) return [];
  return Array.from(tbody.querySelectorAll("tr")).map(
    (tr) => (tr.querySelector("td") as HTMLElement | null)?.textContent?.trim() ?? "",
  );
}

describe("ReportsPanel — sort + filter", () => {
  const tasks: Task[] = [
    makeTask({ id: 1, assignee: "Alex", group: "Backend", labels: ["urgent"] }),
    makeTask({ id: 2, assignee: "Alex", group: "Backend", labels: ["urgent"] }),
    makeTask({ id: 3, assignee: "Bea", group: "Frontend", labels: ["ui"] }),
    makeTask({ id: 4, assignee: "Carl", group: "Backend", labels: ["urgent"] }),
  ];

  it("By Assignee renders rows with default total-desc sort", () => {
    renderReports(tasks);
    const section = sectionByTitle(/By Assignee/i);
    // Default sort: total desc — Alex (2) first; then Bea (1), Carl (1) tie-break by name asc.
    expect(rowNamesIn(section)).toEqual(["Alex", "Bea", "Carl"]);
  });

  it("clicking By Assignee header cycles asc → desc → off", async () => {
    const user = userEvent.setup();
    renderReports(tasks);
    const section = sectionByTitle(/By Assignee/i);
    const header = within(section).getByRole("button", { name: /assignee/i });

    await user.click(header); // asc by name
    expect(rowNamesIn(section)).toEqual(["Alex", "Bea", "Carl"]);

    await user.click(header); // desc
    expect(rowNamesIn(section)).toEqual(["Carl", "Bea", "Alex"]);

    await user.click(header); // off → default (total desc) restored
    expect(rowNamesIn(section)[0]).toBe("Alex");
  });

  it("By Assignee filter narrows rows (case-insensitive)", async () => {
    const user = userEvent.setup();
    renderReports(tasks);
    const section = sectionByTitle(/By Assignee/i);
    const input = within(section).getByPlaceholderText(/filter assignees/i);
    await user.type(input, "alex");
    expect(rowNamesIn(section)).toEqual(["Alex"]);
  });

  it("By Assignee clear button restores all rows", async () => {
    const user = userEvent.setup();
    renderReports(tasks);
    const section = sectionByTitle(/By Assignee/i);
    const input = within(section).getByPlaceholderText(/filter assignees/i);
    await user.type(input, "alex");
    const clearBtn = within(section).getByRole("button", { name: /clear/i });
    await user.click(clearBtn);
    expect(rowNamesIn(section).length).toBeGreaterThanOrEqual(3);
  });

  it("By Assignee shows 'No matches' when filter matches nothing", async () => {
    const user = userEvent.setup();
    renderReports(tasks);
    const section = sectionByTitle(/By Assignee/i);
    const input = within(section).getByPlaceholderText(/filter assignees/i);
    await user.type(input, "zzz");
    expect(within(section).getByText(/no matches/i)).toBeInTheDocument();
  });

  it("By Group + By Label have independent sort state", async () => {
    const user = userEvent.setup();
    renderReports(tasks);
    const groupSection = sectionByTitle(/By Group/i);
    const labelSection = sectionByTitle(/By Label/i);

    const groupNameHeader = within(groupSection).getByRole("button", { name: /^Group/i });
    await user.click(groupNameHeader);
    expect(rowNamesIn(groupSection)[0]).toBe("Backend"); // alphabetical asc

    // Label default sort is total desc; "urgent" (3) > "ui" (1) → urgent first.
    expect(rowNamesIn(labelSection)[0]).toBe("urgent");
  });

  it("By Assignee filter does not affect By Group rows", async () => {
    const user = userEvent.setup();
    renderReports(tasks);
    const assigneeSection = sectionByTitle(/By Assignee/i);
    const groupSection = sectionByTitle(/By Group/i);

    const assigneeFilter = within(assigneeSection).getByPlaceholderText(/filter assignees/i);
    await user.type(assigneeFilter, "alex");

    const groupNames = rowNamesIn(groupSection);
    expect(groupNames).toContain("Backend");
    expect(groupNames).toContain("Frontend");
  });
});
```

If the `ReportsPanel` props or `Task` type don't match the makeTask helper above (extra required fields), Grep `type Task` in `types.ts` and adapt. If `.closest("div")` is too brittle, fall back to adding `data-testid="report-section-assignee"` (etc.) on each `<Section>` block in `reports.tsx` — but only if needed.

- [ ] **Step 2: Run the tests**

```bash
npx vitest run reports
```
Expected: 7 PASS.

- [ ] **Step 3: Gates**

```bash
npx tsc --noEmit
npm run lint
```
Expected: 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 4: Commit**

```bash
git add src/app/reports.test.tsx
git commit -m "test(reports): sort cycle + filter + no-matches + independent state"
```

---

## Task 7: Release 0.19.0 "Jemisin"

**Files:** `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1: version.ts** — READ first. Set `APP_VERSION = "0.19.0"` (currently `"0.18.1"`). Keep `APP_BUILD_DATE = "2026-05-28"; // Jemisin milestone`. Add a new top-of-file comment block ABOVE the existing `// 0.18.1 …` block:

```ts
// 0.19.0 makes the Reports popout's tables (By Assignee, By Group, By Label)
// sortable + filterable — click any header to cycle asc/desc/off, type in the
// search input above each table to narrow rows. Mirrors the steering-committee
// interaction added to the RAID Report at 0.18.0.
```

Append `"versionHighlightReportsSortFilter"` as the LAST entry of `APP_HIGHLIGHT_KEYS`. Match the tuple's `as const` style.

- [ ] **Step 2: CHANGELOG** — READ to match style; add a new `[0.19.0] — 2026-05-28 "Jemisin"` entry ABOVE the `[0.18.1]` entry:

```markdown
## [0.19.0] — 2026-05-28 "Jemisin"

### Added
- Reports popout: the By Assignee, By Group, and By Label tables are now sortable and filterable. Click any column header to cycle through ascending / descending / off. Type in the search input above each table to narrow rows (case-insensitive match on the name column); click × to clear. Default sort is by Total descending.
- New version highlight: "Reports sort + filter" (`versionHighlightReportsSortFilter`) in both EN and DE.
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
git commit -m "docs(release): 0.19.0 Jemisin — Reports tables sortable + filterable"
```

---

## Final review

Dispatch a final reviewer over `git diff main...HEAD`. Confirm:

1. **Scope:** only `src/app/reports.tsx`, `src/app/reports.test.tsx` (new), `src/app/i18n.ts`, `src/app/i18n.de.ts`, `src/app/version.ts`, `CHANGELOG.md` touched. No accidental edits.
2. **Helpers:** `SortTh`, `TableFilter`, `compareStrOrNum` exist at module scope in `reports.tsx`. The sort-key types `AssigneeSort`, `GroupOrLabelSort`, `SortDir` are defined.
3. **AssigneeTable + GroupOrLabelTable:** both accept `sort` / `setSort` / `filter` / `setFilter` props; both filter then sort; both render the "No matches" placeholder when filter narrows everything out; both render the `TableFilter` above the table only when `rows.length > 0`.
4. **State wiring:** `<ReportsPanel>` has 3 independent sort-state pairs (assignee/group/label), each defaulting to `{ key: "total", dir: "desc" }`, and 3 independent filter-state pairs starting empty.
5. **i18n:** EN and DE both have `reportsFilterAssignee`, `reportsFilterGroup`, `reportsFilterLabel`, `reportsNoMatches`, `versionHighlightReportsSortFilter` (plus `clear` if it was added).
6. **Release metadata:** `APP_VERSION === "0.19.0"`, `APP_BUILD_DATE` and `// Jemisin milestone` UNCHANGED, `APP_HIGHLIGHT_KEYS` ends with `"versionHighlightReportsSortFilter"`, CHANGELOG `[0.19.0]` entry present.
7. **Gates:** `npx tsc --noEmit` 0; `npm run lint` 0 errors; `npx vitest run` ≥ 922 (existing 915 + 7 new) passing; `npm run test:coverage` ≥ 70%.

After approval, use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:**
- `SortTh` + `TableFilter` + `compareStrOrNum` + sort-key types → Task 1 ✓
- i18n EN + DE (5 keys + `clear` if missing + highlight) → Task 2 ✓
- `<AssigneeTable>` extraction with sort + filter pipeline → Task 3; wired in Task 4 ✓
- `<GroupOrLabelTable>` extended → Task 5 ✓
- 7 tests in `reports.test.tsx` → Task 6 ✓
- Release 0.19.0 + new highlight key → Task 7 ✓
- Non-goals (no condition filters, no multi-column sort, no persistence, no data-layer change, no Inquiries top-5 change) → none touched ✓

**Placeholder scan:** No TBD/TODO. Tasks 3 and 5 inline the header buttons because each `<th>` carries a `ColumnResizeHandle` sibling that the `SortTh` helper doesn't accommodate; this is documented and `SortTh` is flagged for follow-up cleanup if it ends up unused. Task 6's selector fallback (`data-testid`) is a documented contingency, not a stub.

**Type consistency:** `SortDir`, `AssigneeSort`, `AssigneeSortKey`, `GroupOrLabelSort`, `GroupOrLabelSortKey` defined in Task 1 and reused in Tasks 3, 4, 5 consistently. Default sort `{ key: "total", dir: "desc" }` is identical across all three tables.

**Ordering note:** Task 2 (i18n) is run after Task 1 (helper code that references the new keys) and BEFORE Task 3+ (where the helpers' integrations land). This closes the i18n key-string union before integrations. Tasks 4 and 5 depend on Task 3's helper existing. Task 6 (tests) requires Tasks 1–5 complete. Task 7 (release) is last.
