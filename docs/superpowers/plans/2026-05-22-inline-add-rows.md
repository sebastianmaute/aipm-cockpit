# Inline Add Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-visible inline "add" row at the bottom of the task table and the RAID panel, matching the existing Gantt panel pattern — a dashed-border clickable row that opens the relevant creation modal.

**Architecture:** Both components currently use a three-branch conditional (`tasks.length === 0` / `filtered.length === 0` / table). Each must be restructured to always render a table; empty states become `<tr><td colSpan>` rows; the new inline-add `<tr>` is appended as the last `<tbody>` row. No new props or state needed in either component.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library

---

## Files Modified

| File | Change |
|------|--------|
| `src/app/tasks-section.tsx` | Add `visibleColumnCount`; restructure to always-table; add inline-add `<tr>` |
| `src/app/tasks-section.test.tsx` | Add 3 new tests for inline-add row |
| `src/app/raid-panel.tsx` | Add `effectiveCategory`; restructure to always-table; add inline-add `<tr>` |

## New Files

| File | Purpose |
|------|---------|
| `src/app/raid-panel.test.tsx` | 4 tests for RAID inline-add row |

---

### Task 1: Add inline add row to tasks-section.tsx + tests

**Files:**
- Modify: `src/app/tasks-section.tsx`
- Modify: `src/app/tasks-section.test.tsx`

The current conditional at line 434 (`tasks.length === 0 ? … : filteredSortedTasks.length === 0 ? … : <div><table>`) needs to collapse into a single always-rendering table. Empty states become `<tr>` rows inside that table. The inline-add row is always the last `<tr>` in `<tbody>`.

The column list is already defined inline in `<colgroup>` at line 452: `["sel","status","id","taskName","assignee","startDate","dueDate","lastUpdateDate","priority","blockers","notes","depRelations","actions"]`. Derive `visibleColumnCount` from the same list.

- [ ] **Step 1: Write 3 failing tests**

Append to `src/app/tasks-section.test.tsx` (inside the existing `describe("TasksSection", ...)` block, after the three existing `it(...)` calls). Also add `fireEvent` to the import at the top of the file:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
```

New tests to append:

```typescript
  it("inline add row is present when tasks list is non-empty", () => {
    const task = { id: 1, taskName: "T1" };
    stubWorkspace([task], [task]);
    render(<TasksSection {...makeProps()} />);
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "addTask") });
    expect(addBtns.length).toBeGreaterThanOrEqual(1);
  });

  it("inline add row is present when tasks list is empty", () => {
    stubWorkspace([], []);
    render(<TasksSection {...makeProps()} />);
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "addTask") });
    expect(addBtns.length).toBeGreaterThanOrEqual(1);
  });

  it("clicking inline add row calls setTaskModalOpen with true", () => {
    const task = { id: 1, taskName: "T1" };
    stubWorkspace([task], [task]);
    const setTaskModalOpen = vi.fn();
    render(<TasksSection {...makeProps()} setTaskModalOpen={setTaskModalOpen} />);
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "addTask") });
    fireEvent.click(addBtns[addBtns.length - 1]); // last = inline row
    expect(setTaskModalOpen).toHaveBeenCalledWith(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/tasks-section.test.tsx --reporter=verbose`
Expected: 3 new tests FAIL (inline add row not yet in DOM)

- [ ] **Step 3: Restructure tasks-section.tsx**

In `src/app/tasks-section.tsx`, make two changes:

**3a.** Before the `return (` statement (around line 433), add:

```typescript
const ALL_TASK_COLS = ["sel","status","id","taskName","assignee","startDate","dueDate","lastUpdateDate","priority","blockers","notes","depRelations","actions"] as const;
const visibleColumnCount = ALL_TASK_COLS.filter((col) => !hiddenCols.has(col)).length;
```

**3b.** Replace the three-branch conditional (lines 434–501) with a single always-rendered table. The outer `<div>` wrapper and `<RowContextProvider>` are preserved; the three-branch conditional is removed. Empty states become `<tr>` rows; the inline-add row is the final `<tr>` in `<tbody>`:

```tsx
<div
  className="min-h-0 flex-1 w-full overflow-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
>
  <RowContextProvider value={rowContextValue}>
    <table
      className="divide-y divide-zinc-200 text-left text-sm dark:divide-zinc-800"
      style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}
    >
      <colgroup>
        {(["sel","status","id","taskName","assignee","startDate","dueDate","lastUpdateDate","priority","blockers","notes","depRelations","actions"] as const)
          .filter((col) => !hiddenCols.has(col))
          .map((col) => (
            <col key={col} style={{ width: colWidths[col] ?? DEFAULT_COL_WIDTHS[col] }} />
          ))}
      </colgroup>
      <thead className="sticky top-0 z-10 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 shadow-sm dark:bg-zinc-900 dark:text-zinc-400">
        <tr>
          <Th onResize={(e) => startColResize("sel", e)}>
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAllVisible}
              aria-label={t(lang, "selectAllVisible")}
              className="h-4 w-4 cursor-pointer rounded border-zinc-300 text-AIPM-dark-blue focus:ring-AIPM-dark-blue dark:border-zinc-600 dark:bg-zinc-800"
            />
          </Th>
          {!hiddenCols.has("status") && <Th onResize={(e) => startColResize("status", e)}><span className="sr-only">Status</span></Th>}
          {!hiddenCols.has("id") && <SortableTh label={t(lang, "id")} sortKey="id" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("id", e)} />}
          <SortableTh label={t(lang, "task")} sortKey="taskName" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("taskName", e)} />
          {!hiddenCols.has("assignee") && <SortableTh label={t(lang, "assignee")} sortKey="assignee" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("assignee", e)} />}
          {!hiddenCols.has("startDate") && <SortableTh label={t(lang, "start")} sortKey="startDate" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("startDate", e)} />}
          {!hiddenCols.has("dueDate") && <SortableTh label={t(lang, "due")} sortKey="dueDate" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("dueDate", e)} />}
          {!hiddenCols.has("lastUpdateDate") && <SortableTh label={t(lang, "lastUpdate")} sortKey="lastUpdateDate" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("lastUpdateDate", e)} />}
          {!hiddenCols.has("priority") && <SortableTh label={t(lang, "priority")} sortKey="priority" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("priority", e)} />}
          {!hiddenCols.has("blockers") && <Th onResize={(e) => startColResize("blockers", e)}>{t(lang, "blockers")}</Th>}
          {!hiddenCols.has("notes") && <Th onResize={(e) => startColResize("notes", e)}>{t(lang, "notes")}</Th>}
          {!hiddenCols.has("depRelations") && <Th onResize={(e) => startColResize("depRelations", e)}>{t(lang, "depRelations")}</Th>}
          <Th>
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {tasks.length === 0 && (
          <tr>
            <td colSpan={visibleColumnCount} className="p-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {t(lang, "noTasks")}
            </td>
          </tr>
        )}
        {tasks.length > 0 && filteredSortedTasks.length === 0 && (
          <tr>
            <td colSpan={visibleColumnCount} className="p-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {t(lang, "noTasksFiltered")}
            </td>
          </tr>
        )}
        {filteredSortedTasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            isSelected={selectedIds.has(task.id)}
            isEditing={editingId === task.id}
            isExpanded={expandedNotes.has(task.id)}
            isPushing={pushingIds.has(task.id)}
            raidRefs={raidByTask.get(task.id)}
          />
        ))}
        <tr>
          <td colSpan={visibleColumnCount}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => { handleCancelEdit(); setTaskModalOpen(true); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCancelEdit();
                  setTaskModalOpen(true);
                }
              }}
              aria-label={t(lang, "addTask")}
              className="group flex cursor-pointer items-center gap-2 border-b border-dashed border-zinc-200 px-3 py-1.5 text-sm text-zinc-400 hover:bg-AIPM-dark-blue/5 hover:text-AIPM-dark-blue dark:border-zinc-700 dark:hover:bg-white/5"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100">
                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
              </svg>
              {t(lang, "addTask")}
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </RowContextProvider>
</div>
```

- [ ] **Step 4: Run tests to verify all 6 pass**

Run: `npx vitest run src/app/tasks-section.test.tsx --reporter=verbose`
Expected: PASS — 6 tests passed (3 original + 3 new)

- [ ] **Step 5: Run tsc**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add src/app/tasks-section.tsx src/app/tasks-section.test.tsx
git commit -m "feat(tasks-section): add inline add row to task table"
```

---

### Task 2: Add inline add row to raid-panel.tsx + tests

**Files:**
- Modify: `src/app/raid-panel.tsx`
- Create: `src/app/raid-panel.test.tsx`

The RAID panel has the same three-branch conditional structure (lines 399–541): `raid.length === 0` / `visible.length === 0` / table. Restructure to always-table. The RAID table has exactly 9 fixed columns (confirmed from `<thead>` at lines 411–421): `#`, category, title, severity, status, owner, targetDate, linkedTasks, causedBy — so `colSpan={9}`.

The inline-add handler uses `openNew(effectiveCategory)` where `effectiveCategory` defaults to `"R"` when the filter is `"All"`. `openNew` is already defined inside `RaidPanelInner` at line 220; `categoryFilter` is already local state at line 144.

- [ ] **Step 1: Write 4 failing tests**

Create `src/app/raid-panel.test.tsx`:

```typescript
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { t } from "./i18n";
import { RaidPanel } from "./raid-panel";
import type { RaidPanelProps } from "./raid-panel";

function makeProps(overrides: Partial<RaidPanelProps> = {}): RaidPanelProps {
  return {
    lang: "en-US",
    tasks: [],
    raid: [],
    today: "2026-05-22",
    filterTaskId: null,
    onClearTaskFilter: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onCreateMitigationTask: vi.fn().mockReturnValue(null),
    onJumpToTask: vi.fn(),
    ...overrides,
  };
}

describe("RaidPanel inline add row", () => {
  it("inline add row is present when RAID list is empty", () => {
    render(<RaidPanel {...makeProps()} />);
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "raidAddItem") });
    expect(addBtns.length).toBeGreaterThanOrEqual(1);
  });

  it("inline add row is present when RAID list is non-empty", () => {
    const item = {
      id: 1, category: "R" as const, title: "Test risk",
      severity: "Medium" as const, status: "Open" as const,
      raisedDate: "2026-05-22", linkedTaskIds: [],
      causedByRaidIds: [],
    };
    render(<RaidPanel {...makeProps({ raid: [item] })} />);
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "raidAddItem") });
    expect(addBtns.length).toBeGreaterThanOrEqual(1);
  });

  it("clicking inline add row when category filter is 'All' opens modal with category R", () => {
    render(<RaidPanel {...makeProps()} />);
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "raidAddItem") });
    fireEvent.click(addBtns[addBtns.length - 1]);
    const radioR = screen.getByRole("radio", { name: t("en-US", "raidCategoryR") });
    expect(radioR).toHaveAttribute("aria-checked", "true");
  });

  it("clicking inline add row when category filter is 'A' opens modal with category A", () => {
    render(<RaidPanel {...makeProps()} />);
    const categorySelect = screen.getByDisplayValue("All");
    fireEvent.change(categorySelect, { target: { value: "A" } });
    const addBtns = screen.getAllByRole("button", { name: t("en-US", "raidAddItem") });
    fireEvent.click(addBtns[addBtns.length - 1]);
    const radioA = screen.getByRole("radio", { name: t("en-US", "raidCategoryA") });
    expect(radioA).toHaveAttribute("aria-checked", "true");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/raid-panel.test.tsx --reporter=verbose`
Expected: FAIL — `RaidPanel` named export may be missing, or inline add row not found

- [ ] **Step 3: Verify RaidPanel named export**

Check the bottom of `src/app/raid-panel.tsx` for `export const RaidPanel = memo(RaidPanelInner)`. If only a default export exists, add the named export:

```typescript
export { RaidPanel };
```

Run: `npx tsc --noEmit` to confirm no errors before continuing.

- [ ] **Step 4: Add effectiveCategory + restructure raid-panel.tsx**

In `src/app/raid-panel.tsx`, inside `RaidPanelInner`:

**4a.** After the `visible` `useMemo` closing `}, [raid, filterTaskId, categoryFilter, severityFilter, statusFilter, search]);` (around line 218), add:

```typescript
const effectiveCategory: RaidCategory =
  categoryFilter === "All" ? "R" : categoryFilter;
```

**4b.** Replace the three-branch conditional (lines 399–541) with a single always-rendered table. Preserve the `<div>` wrapper with `min-h-[240px] flex-1 overflow-auto`. Empty states become `<tr>` rows; the inline-add row is the final `<tr>` in `<tbody>`. All existing data rows remain byte-for-byte identical:

```tsx
<div className="min-h-[240px] flex-1 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
  <table className="min-w-full text-left text-sm">
    <thead className="sticky top-0 z-10 bg-zinc-50 text-xs uppercase tracking-wide text-AIPM-medium-grey dark:bg-zinc-900">
      <tr>
        <th className="px-3 py-2">#</th>
        <th className="px-3 py-2">{t(lang, "raidCategory")}</th>
        <th className="px-3 py-2">{t(lang, "raidTitle")}</th>
        <th className="px-3 py-2">{t(lang, "raidSeverity")}</th>
        <th className="px-3 py-2">{t(lang, "raidStatus")}</th>
        <th className="px-3 py-2">{t(lang, "raidOwner")}</th>
        <th className="px-3 py-2">{t(lang, "raidTargetDate")}</th>
        <th className="px-3 py-2">{t(lang, "raidLinkedTasks")}</th>
        <th className="px-3 py-2">{t(lang, "raidCausedBy")}</th>
      </tr>
    </thead>
    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {raid.length === 0 && (
        <tr>
          <td colSpan={9} className="p-10 text-center text-sm text-AIPM-medium-grey dark:text-zinc-400">
            {t(lang, "raidEmpty")}
          </td>
        </tr>
      )}
      {raid.length > 0 && visible.length === 0 && (
        <tr>
          <td colSpan={9} className="p-10 text-center text-sm text-AIPM-medium-grey dark:text-zinc-400">
            {t(lang, "raidNoMatches")}
          </td>
        </tr>
      )}
      {visible.map((item) => {
        const rag = severityRag(item.severity);
        const terminal = isTerminalStatus(item.status, item.category);
        return (
          <tr
            key={item.id}
            onClick={() => openEdit(item)}
            className={`cursor-pointer align-top hover:bg-AIPM-light-grey/40 dark:hover:bg-zinc-900 ${
              terminal ? "opacity-60" : ""
            }`}
          >
            <td className="px-3 py-2 font-mono text-AIPM-medium-grey">
              #{item.id}
            </td>
            <td className="px-3 py-2">
              <span
                className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${categoryPillClass[item.category]}`}
                title={categoryLabel(item.category, lang)}
              >
                {item.category}
              </span>
            </td>
            <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
              {item.title}
            </td>
            <td className="px-3 py-2">
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={`inline-block h-2 w-2 rounded-full ${severityDotClass[rag]}`}
                />
                <span>
                  {item.severity ? severityLabel(item.severity, lang) : "—"}
                  {item.category === "R" && item.probability && item.impact
                    ? ` (${item.probability}×${item.impact})`
                    : ""}
                </span>
              </span>
            </td>
            <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
              {statusLabel(item.status, lang)}
            </td>
            <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
              {item.owner ?? ""}
            </td>
            <td className="px-3 py-2 font-mono text-xs text-AIPM-medium-grey">
              {item.targetDate ?? ""}
            </td>
            <td className="px-3 py-2">
              {item.linkedTaskIds.length === 0 ? (
                <span className="text-AIPM-medium-grey">—</span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {item.linkedTaskIds.map((tid) => {
                    const tk = tasksById.get(tid);
                    return (
                      <button
                        key={tid}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onJumpToTask(tid);
                        }}
                        title={tk?.taskName ?? `#${tid}`}
                        className="inline-flex rounded bg-AIPM-light-grey px-1.5 py-0.5 font-mono text-[10px] text-AIPM-dark-blue hover:bg-AIPM-dark-blue hover:text-white dark:bg-zinc-800 dark:text-AIPM-blue"
                      >
                        #{tid}
                      </button>
                    );
                  })}
                </span>
              )}
            </td>
            <td className="px-3 py-2">
              {(() => {
                const parentIds = item.causedByRaidIds ?? [];
                const children = causesIndex.get(item.id) ?? [];
                if (parentIds.length === 0 && children.length === 0) {
                  return <span className="text-AIPM-medium-grey">—</span>;
                }
                return (
                  <span className="flex flex-wrap items-center gap-1">
                    {parentIds.map((pid) => {
                      const parent = raidById.get(pid);
                      return (
                        <button
                          key={pid}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (parent) openEdit(parent);
                          }}
                          title={parent?.title ?? `RAID #${pid}`}
                          className="inline-flex items-center gap-1 rounded bg-AIPM-light-grey px-1.5 py-0.5 font-mono text-[10px] text-AIPM-dark-blue hover:bg-AIPM-dark-blue hover:text-white dark:bg-zinc-800 dark:text-AIPM-blue"
                        >
                          ↩ #{pid}
                        </button>
                      );
                    })}
                    {children.length > 0 && (
                      <span
                        title={t(lang, "raidCausedThisCount", children.length)}
                        className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                      >
                        → {children.length}
                      </span>
                    )}
                  </span>
                );
              })()}
            </td>
          </tr>
        );
      })}
      <tr>
        <td colSpan={9}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => openNew(effectiveCategory)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openNew(effectiveCategory);
              }
            }}
            aria-label={t(lang, "raidAddItem")}
            className="group flex cursor-pointer items-center gap-2 border-b border-dashed border-zinc-200 px-3 py-1.5 text-sm text-zinc-400 hover:bg-AIPM-dark-blue/5 hover:text-AIPM-dark-blue dark:border-zinc-700 dark:hover:bg-white/5"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100">
              <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
            </svg>
            {t(lang, "raidAddItem")}
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

- [ ] **Step 5: Run tests to verify all 4 pass**

Run: `npx vitest run src/app/raid-panel.test.tsx --reporter=verbose`
Expected: PASS — 4 tests passed

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All existing tests pass

- [ ] **Step 7: Run tsc**

Run: `npx tsc --noEmit`
Expected: No new errors (one pre-existing error in `use-due-alerts.test.ts` is unrelated)

- [ ] **Step 8: Commit**

```bash
git add src/app/raid-panel.tsx src/app/raid-panel.test.tsx
git commit -m "feat(raid-panel): add inline add row to RAID table"
```
