# TaskRow Extraction + Memoization (Slice 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the inline `<tr>` row JSX (~250 lines) out of `TaskManagerInner` into a memoized `<TaskRow>` component family (TaskRow + NotesCell + TaskActions + DependencyChips + RaidBadge) under a local `RowContext`. Stabilize the ~10 row-handler callbacks with `useCallback`. Pure refactor — no observable behaviour change. Spec: `docs/superpowers/specs/2026-05-18-task-row-memo-slice2b-design.md`.

**Architecture:** New module `src/app/task-row.tsx` exports 5 memoized components, a local `RowContext`, and `useTaskRowContext()` (throws outside provider). `TaskManagerInner` wraps the `<table>` in `<RowContextProvider value={rowContextValue}>` and renders `<TaskRow … />` per task. Per-row state slices (`isSelected`, `isEditing`, `isExpanded`, `isPushing`, `raidRefs`) come as props; cross-cutting ambient state (`lang`, `today`, `holidaySet`, Jira config, `hiddenCols`, `tasksById`, stable callbacks) flows through `RowContext`. Two helpers used both inside the row and elsewhere (`priorityLabel`, `healthDot`) move to non-cyclic modules first.

**Tech Stack:** React 19 + Next 16 (App Router, `"use client"`); TypeScript; Vitest 3 + `@testing-library/react` + `React.Profiler`. Reuses Slice 1/2's `FiltersProvider` + `WorkspaceProvider`.

---

## File Structure

| File | Role |
|---|---|
| `src/app/i18n.ts` | Modified — `priorityLabel(lang, p)` moves here from `task-manager.tsx` |
| `src/app/health.ts` | Modified — `healthDot: Record<Health, string>` moves here from `task-manager.tsx` |
| `src/app/task-row.tsx` | **NEW** ~350 lines — RowContext + 5 components + helpers (`Td`, `priorityStyle`, `safeJiraIssueHref`, `summarizeNote`, `NOTES_COLLAPSED_MAX`) |
| `src/app/task-row.test.tsx` | **NEW** ~140 lines, 6 tests |
| `src/app/task-manager.tsx` | Modified — delete row JSX + 5 helpers + 6 inline handler closures; add `useCallback` wrappers + memo'd `rowContextValue`; wrap `<table>` in `<RowContextProvider>` and render `<TaskRow … />` |

---

## Task 1: Relocate `priorityLabel` and `healthDot` to break cyclic imports

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/health.ts`
- Modify: `src/app/task-manager.tsx`

`priorityLabel` is used at `task-manager.tsx` lines 2968, 3465, 3573 (outside the row) and inside the row. `healthDot` is used at `task-manager.tsx:3231` (outside the row) and inside the row. If they stay in `task-manager.tsx`, the new `task-row.tsx` must import them from there — creating a cycle once `task-manager.tsx` imports `TaskRow` back. Move them to neutral modules first.

No new unit tests in this task — `vitest run` + `npm run build` are sufficient because behaviour doesn't change.

- [ ] **Step 1: Add `priorityLabel` to `i18n.ts`**

Open `src/app/i18n.ts`. Verify `Lang`, `TranslationKey`, and `t` are already exported. At the bottom of the file, append:

```ts
import { type Priority } from "./types";

/**
 * Localized label for a task priority value. Thin wrapper over `t()` that
 * encodes the convention `priority${Low|Medium|High|Urgent}`.
 */
export function priorityLabel(lang: Lang, p: Priority): string {
  return t(lang, `priority${p}` as TranslationKey);
}
```

If a `./types` import already exists at the top of `i18n.ts`, add `Priority` to the existing import statement instead of adding a new line.

- [ ] **Step 2: Add `healthDot` to `health.ts`**

Open `src/app/health.ts`. `Health` is already exported on line 23. Append at the end of the file:

```ts
/**
 * Tailwind class for the RAG status dot, indexed by health color.
 * Standard steering-committee palette, distinct from the AIPM-pink
 * "overdue" highlight used elsewhere.
 */
export const healthDot: Record<Health, string> = {
  R: "bg-red-500",
  A: "bg-amber-500",
  G: "bg-emerald-500",
};
```

- [ ] **Step 3: Replace local declarations in `task-manager.tsx` with imports**

In `src/app/task-manager.tsx`:

1. Find the existing `priorityLabel` function (currently around line 369):

   ```tsx
   function priorityLabel(lang: Lang, p: Priority): string {
     return t(lang, `priority${p}` as TranslationKey);
   }
   ```

   Delete it.

2. Find the existing `healthDot` declaration (currently around lines 380–386, including the comment immediately above):

   ```tsx
   // RAG dot palette — standard steering-committee colors, distinct from the
   // existing AIPM-pink "overdue" highlight used elsewhere.
   const healthDot: Record<Health, string> = {
     R: "bg-red-500",
     A: "bg-amber-500",
     G: "bg-emerald-500",
   };
   ```

   Delete it. The same comment was preserved on the new declaration in `health.ts`.

3. Find the existing import from `./i18n` (search `from "./i18n"`). Add `priorityLabel` to the named imports list, kept in alphabetical order.

4. Find the existing import from `./health` (search `from "./health"`). Add `healthDot` to the named imports. If the existing line imports `Health`, `TaskHealth`, `computeTaskHealth`, `formatHealthTooltip` from `./health`, keep them and add `healthDot`. If there is no existing import from `./health`, add one:

   ```tsx
   import { healthDot } from "./health";
   ```

- [ ] **Step 4: Verify build and tests**

Run: `npm run build`
Expected: `✓ Compiled successfully` + `Finished TypeScript`. No new warnings.

Run: `npx vitest run`
Expected: All 47 existing tests still pass (7 test files).

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/health.ts src/app/task-manager.tsx
git commit src/app/i18n.ts src/app/health.ts src/app/task-manager.tsx -m "refactor: relocate priorityLabel to i18n and healthDot to health"
```

No Co-Authored-By trailer (repo disables attribution globally).

---

## Task 2: Scaffold `task-row.tsx` with RowContext + useTaskRowContext + throw test

**Files:**
- Create: `src/app/task-row.tsx`
- Create: `src/app/task-row.test.tsx`
- Test: `src/app/task-row.test.tsx`

Follow TDD strictly.

- [ ] **Step 1: Write the failing test**

Create `src/app/task-row.test.tsx`:

```tsx
import { describe, test, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTaskRowContext } from "./task-row";

describe("useTaskRowContext", () => {
  test("throws a documented error when used outside RowContext.Provider", () => {
    const original = console.error;
    console.error = () => {};
    try {
      expect(() => renderHook(() => useTaskRowContext())).toThrow(
        "useTaskRowContext must be used within RowContext.Provider",
      );
    } finally {
      console.error = original;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/task-row.test.tsx`
Expected: FAIL with `Cannot find module './task-row'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/task-row.tsx`:

```tsx
"use client";

import { createContext, useContext, type ReactNode } from "react";
import { type Lang } from "./i18n";
import { type Task } from "./types";
import { type RaidItem } from "./raid";

export interface RowContextValue {
  lang: Lang;
  today: string;
  holidaySet: Set<string>;

  // Flattened from settings.jira so consumers only re-render
  // on Jira-config change, not on unrelated settings changes.
  jiraSiteUrl: string;
  jiraEnabled: boolean;
  jiraProjectKey: string;

  hiddenCols: Set<string>;
  tasksById: Map<number, Task>;

  // Stable callbacks (useCallback'd in TaskManagerInner).
  onToggleSelect: (id: number) => void;
  onToggleNoteExpanded: (id: number) => void;
  onJumpToRaid: (id: number) => void;
  onToggleComplete: (task: Task) => void;
  onSendInquiry: (task: Task) => void;
  onPushToJira: (id: number) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
}

const RowContext = createContext<RowContextValue | undefined>(undefined);

export function RowContextProvider({
  value,
  children,
}: {
  value: RowContextValue;
  children: ReactNode;
}) {
  return <RowContext.Provider value={value}>{children}</RowContext.Provider>;
}

export function useTaskRowContext(): RowContextValue {
  const ctx = useContext(RowContext);
  if (!ctx)
    throw new Error("useTaskRowContext must be used within RowContext.Provider");
  return ctx;
}

// Marker re-export so TaskRow consumers can pass a typed `RaidItem[]` prop
// without importing from `./raid` separately.
export type { RaidItem };
```

(Real component exports come in later tasks. This file scaffolds the context only.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/task-row.test.tsx`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/app/task-row.tsx src/app/task-row.test.tsx
git commit src/app/task-row.tsx src/app/task-row.test.tsx -m "feat(task-row): scaffold RowContext + useTaskRowContext"
```

---

## Task 3: Implement `<TaskRow>` with rendering, memo-isolation, and own-prop-rerender tests

**Files:**
- Modify: `src/app/task-row.tsx`
- Modify: `src/app/task-row.test.tsx`
- Modify: `src/app/task-manager.tsx` (deletions only — see Step 1)

This task lifts the row JSX into a single `<TaskRow>` component. Sub-components (`NotesCell`, `TaskActions`, `DependencyChips`, `RaidBadge`) come in Tasks 4–6 — `TaskRow` renders their content inline for now.

**Important — build stays green every task.** Helper duplicates (`Td`, `summarizeNote`, `priorityStyle`, `safeJiraIssueHref`, `NOTES_COLLAPSED_MAX`) live temporarily in BOTH `task-row.tsx` (newly added) and `task-manager.tsx` (existing) between Task 3 and Task 7. Task 7 deletes the duplicates from `task-manager.tsx` when the inline row JSX is removed. This avoids a broken-build window in the middle of the slice.

- [ ] **Step 1: Add row-only helpers to `task-row.tsx` (do not yet remove duplicates from `task-manager.tsx`)**

At the top of `src/app/task-row.tsx`, expand the existing React import to add `useContext` (already there) and just below it add:

```tsx
import { type Priority } from "./types";
```

Append these to `src/app/task-row.tsx` (after the existing context/hook code):

```tsx
export const NOTES_COLLAPSED_MAX = 50;

/**
 * Produce a one-line summary of a note for the collapsed Notes cell.
 *
 * Rules (in order):
 *   1. Take only the first line — anything past the first `\n` is hidden.
 *   2. If that line fits within `maxLen`, show it as-is (still flagged as
 *      truncated when there were more lines hidden below).
 *   3. Otherwise, cut at the last whitespace ≤ maxLen so we never split mid-word.
 *      Fall back to a hard slice only when the first word itself is too long.
 */
export function summarizeNote(
  notes: string,
  maxLen: number,
): { text: string; truncated: boolean } {
  if (!notes) return { text: "", truncated: false };

  const newlineIdx = notes.search(/\r?\n/);
  const firstLine = newlineIdx >= 0 ? notes.slice(0, newlineIdx) : notes;
  const hasMoreLines = firstLine.length < notes.length;

  if (firstLine.length <= maxLen) {
    return { text: firstLine, truncated: hasMoreLines };
  }

  const window = firstLine.slice(0, maxLen + 1);
  const lastWs = window.search(/\s\S*$/);
  const cut = lastWs > Math.floor(maxLen / 2) ? lastWs : maxLen;
  return { text: firstLine.slice(0, cut).trimEnd(), truncated: true };
}

export const priorityStyle: Record<Priority, string> = {
  Low: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  Medium: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  High: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  Urgent: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

/**
 * Build the Jira browse URL only when siteUrl parses to an http(s) origin.
 * Without this guard, a user-supplied siteUrl like "javascript:..." would
 * render as an executable href.
 */
export function safeJiraIssueHref(siteUrl: string, key: string): string | null {
  try {
    const u = new URL(siteUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.origin}/browse/${encodeURIComponent(key)}`;
  } catch {
    return null;
  }
}

function Td({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 ${className ?? ""}`}>{children}</td>;
}
```

**Do not** delete the corresponding declarations from `task-manager.tsx` in this task. Leave them in place; the inline `<tr>{...250 lines}` block in `task-manager.tsx` still uses them. Task 7 removes both the inline block and the now-unused helpers in a single commit.

- [ ] **Step 2: Add imports to `task-row.tsx` for the TaskRow JSX**

Update the imports at the top of `src/app/task-row.tsx`:

```tsx
"use client";

import { createContext, memo, useContext, type ReactNode } from "react";
import { computeTaskHealth, formatHealthTooltip, healthDot, type TaskHealth } from "./health";
import { priorityLabel, t, type Lang } from "./i18n";
import { countByCategory } from "./raid";
import { type Priority, type Task } from "./types";
import { type RaidItem } from "./raid";
```

Re-export the re-export of `RaidItem` at the bottom of the file (already there from Task 2) — leave it untouched.

- [ ] **Step 3: Append the `TaskRow` component**

Append to `src/app/task-row.tsx`:

```tsx
interface TaskRowProps {
  task: Task;
  isSelected: boolean;
  isEditing: boolean;
  isExpanded: boolean;
  isPushing: boolean;
  raidRefs: RaidItem[] | undefined;
}

function TaskRowImpl({
  task,
  isSelected,
  isEditing,
  isExpanded,
  isPushing,
  raidRefs,
}: TaskRowProps) {
  const {
    lang,
    today,
    holidaySet,
    jiraSiteUrl,
    jiraEnabled,
    jiraProjectKey,
    hiddenCols,
    tasksById,
    onToggleSelect,
    onToggleNoteExpanded,
    onJumpToRaid,
    onToggleComplete,
    onSendInquiry,
    onPushToJira,
    onEdit,
    onDelete,
  } = useTaskRowContext();

  const isComplete = !!task.completedDate;
  const health: TaskHealth = computeTaskHealth(task, today, holidaySet);
  const label = isComplete
    ? t(lang, "completedOn", task.completedDate!)
    : formatHealthTooltip(health, lang);

  return (
    <tr
      className={`align-top ${isEditing ? "bg-amber-50 dark:bg-amber-950/20" : isSelected ? "bg-AIPM-light-grey dark:bg-zinc-900" : isComplete ? "opacity-60" : ""}`}
    >
      <Td>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(task.id)}
          aria-label={t(lang, "selectRow", task.id)}
          className="h-4 w-4 cursor-pointer rounded border-zinc-300 text-AIPM-dark-blue focus:ring-AIPM-dark-blue dark:border-zinc-600 dark:bg-zinc-800"
        />
      </Td>
      {!hiddenCols.has("status") && (
        <Td>
          {isComplete && !task.healthOverride ? (
            <span title={label} aria-label={label} className="text-AIPM-green">✓</span>
          ) : (
            <span title={label} aria-label={label} className={`inline-block h-2.5 w-2.5 rounded-full ${healthDot[health.color]}`} />
          )}
        </Td>
      )}
      {!hiddenCols.has("id") && <Td className="font-mono text-zinc-500">
        #{task.id}
        {(() => {
          if (!task.jiraKey || !jiraSiteUrl) return null;
          const href = safeJiraIssueHref(jiraSiteUrl, task.jiraKey);
          if (!href) return null;
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={
                task.jiraIssueType
                  ? `${task.jiraKey} (${task.jiraIssueType})`
                  : task.jiraKey
              }
              className="ml-1 inline-block rounded bg-AIPM-light-grey px-1.5 py-0.5 text-[10px] font-medium text-AIPM-dark-blue no-underline hover:bg-AIPM-dark-blue hover:text-white dark:bg-zinc-800 dark:text-AIPM-blue dark:hover:bg-AIPM-dark-blue dark:hover:text-white"
            >
              {task.jiraKey}
            </a>
          );
        })()}
        {raidRefs && raidRefs.length > 0 && (() => {
          const counts = countByCategory(raidRefs);
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onJumpToRaid(task.id);
              }}
              title={t(lang, "raidReferencedBy", raidRefs.length)}
              aria-label={t(lang, "raidReferencedBy", raidRefs.length)}
              className="ml-1 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60"
            >
              {t(lang, "raidReferencedByMix", counts.R, counts.A, counts.I, counts.D)}
            </button>
          );
        })()}
      </Td>}
      <Td
        className={`font-medium text-zinc-900 dark:text-zinc-100 ${isComplete ? "line-through" : ""}`}
      >
        <span>{task.taskName}</span>
        {(task.group || (task.labels?.length ?? 0) > 0) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {task.group && (
              <span className="inline-flex rounded-md bg-AIPM-dark-blue/10 px-1.5 py-0.5 text-[10px] font-medium text-AIPM-dark-blue dark:bg-AIPM-dark-blue/30 dark:text-AIPM-light-grey">
                {task.group}
              </span>
            )}
            {(task.labels ?? []).map((l) => (
              <span
                key={l}
                className="inline-flex rounded-full bg-AIPM-light-grey px-1.5 py-0.5 text-[10px] font-medium text-AIPM-dark-grey dark:bg-zinc-800 dark:text-AIPM-medium-grey"
              >
                {l}
              </span>
            ))}
          </div>
        )}
      </Td>
      {!hiddenCols.has("assignee") && <Td>{task.assignee}</Td>}
      {!hiddenCols.has("startDate") && (
        <Td className="whitespace-nowrap text-zinc-600 dark:text-zinc-400">
          {task.startDate || "—"}
        </Td>
      )}
      {!hiddenCols.has("dueDate") && <Td>{task.dueDate}</Td>}
      {!hiddenCols.has("lastUpdateDate") && <Td>{task.lastUpdateDate}</Td>}
      {!hiddenCols.has("priority") && (
        <Td>
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${priorityStyle[task.priority]}`}>
            {priorityLabel(lang, task.priority)}
          </span>
        </Td>
      )}
      {!hiddenCols.has("blockers") && (
        <Td className="max-w-xs whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">
          {task.blockers || "—"}
        </Td>
      )}
      {!hiddenCols.has("notes") && (
        <Td className="max-w-xs text-zinc-600 dark:text-zinc-400">
          {(() => {
            const notes = task.notes ?? "";
            if (!notes) return <span>—</span>;
            const summary = summarizeNote(notes, NOTES_COLLAPSED_MAX);
            const displayed = isExpanded ? notes : summary.text + (summary.truncated ? " …" : "");
            return (
              <div className="flex flex-col gap-1">
                <span className={isExpanded ? "whitespace-pre-wrap" : "whitespace-normal"}>
                  {displayed}
                </span>
                {summary.truncated && (
                  <button
                    type="button"
                    onClick={() => onToggleNoteExpanded(task.id)}
                    className="self-start text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-blue"
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? t(lang, "showLess") : t(lang, "showMore")}
                  </button>
                )}
              </div>
            );
          })()}
        </Td>
      )}
      {!hiddenCols.has("depRelations") && (
        <Td className="text-zinc-600 dark:text-zinc-400">
          {(task.dependencies?.length ?? 0) === 0 ? (
            <span>—</span>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {(task.dependencies ?? []).map((dep, i) => {
                const pred = tasksById.get(dep.taskId);
                const predName = pred?.taskName ?? t(lang, "depMissing");
                return (
                  <li key={`dep-${dep.taskId}-${dep.type}-${i}`}>
                    <span
                      title={`${t(lang, "depDependsOn")} #${dep.taskId} (${dep.type}) — ${predName}`}
                      className="inline-flex items-center gap-0.5 rounded-full bg-AIPM-blue/15 px-1.5 py-0.5 text-[10px] font-medium text-AIPM-dark-blue dark:bg-AIPM-blue/25 dark:text-AIPM-light-grey"
                    >
                      <span className="font-mono">{dep.type}</span>
                      <span className="opacity-70">·</span>
                      <span className="font-mono">#{dep.taskId}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Td>
      )}
      <Td>
        <div className="flex flex-col gap-1 whitespace-nowrap">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onToggleComplete(task)}
              className="text-xs font-medium text-AIPM-green underline-offset-2 hover:underline"
            >
              {task.completedDate ? t(lang, "reopenTask") : t(lang, "markComplete")}
            </button>
            {!task.completedDate && (
              <button
                type="button"
                onClick={() => onSendInquiry(task)}
                className="text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-blue"
              >
                {t(lang, "sendInquiry")}
              </button>
            )}
            {jiraEnabled && jiraProjectKey && !task.jiraKey && !task.completedDate && (
              <button
                type="button"
                onClick={() => onPushToJira(task.id)}
                disabled={isPushing}
                className="text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-AIPM-blue"
              >
                {isPushing ? t(lang, "jiraPushing") : t(lang, "jiraPushToJira")}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onEdit(task)}
              className="text-xs font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
            >
              {t(lang, "edit")}
            </button>
            <button
              type="button"
              onClick={() => onDelete(task.id)}
              className="text-xs font-medium text-red-600 underline-offset-2 hover:underline dark:text-red-400"
            >
              {t(lang, "delete")}
            </button>
          </div>
        </div>
      </Td>
    </tr>
  );
}

export const TaskRow = memo(TaskRowImpl);
```

- [ ] **Step 4: Write the rendering-correctness test**

Replace the entire contents of `src/app/task-row.test.tsx` with:

```tsx
import { describe, test, expect, vi } from "vitest";
import { render, renderHook, fireEvent, act } from "@testing-library/react";
import React, { Profiler, type ReactNode, type ProfilerOnRenderCallback } from "react";
import {
  TaskRow,
  RowContextProvider,
  useTaskRowContext,
  type RowContextValue,
} from "./task-row";
import { type Task } from "./types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Sample task",
    assignee: "Alice",
    assigneeEmail: "",
    dueDate: "2026-12-01",
    lastUpdateDate: "2026-05-18",
    priority: "Medium",
    blockers: "",
    notes: "",
    group: "",
    labels: [],
    dependencies: [],
    ...overrides,
  };
}

function makeContext(overrides: Partial<RowContextValue> = {}): RowContextValue {
  return {
    lang: "en-US",
    today: "2026-05-18",
    holidaySet: new Set(),
    jiraSiteUrl: "",
    jiraEnabled: false,
    jiraProjectKey: "",
    hiddenCols: new Set(),
    tasksById: new Map(),
    onToggleSelect: vi.fn(),
    onToggleNoteExpanded: vi.fn(),
    onJumpToRaid: vi.fn(),
    onToggleComplete: vi.fn(),
    onSendInquiry: vi.fn(),
    onPushToJira: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

function rowWrapper({
  context,
  children,
}: {
  context: RowContextValue;
  children: ReactNode;
}) {
  // <tbody> wrapper required because TaskRow returns a <tr>.
  return (
    <table>
      <tbody>
        <RowContextProvider value={context}>{children}</RowContextProvider>
      </tbody>
    </table>
  );
}

describe("TaskRow", () => {
  test("renders task data: name, assignee, due date, priority label", () => {
    const ctx = makeContext();
    const task = makeTask({
      id: 7,
      taskName: "Showcase this app",
      assignee: "Paul",
      dueDate: "2026-09-01",
      priority: "High",
    });
    const { getByText } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={task}
            isSelected={false}
            isEditing={false}
            isExpanded={false}
            isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );
    expect(getByText("Showcase this app")).toBeTruthy();
    expect(getByText("Paul")).toBeTruthy();
    expect(getByText("2026-09-01")).toBeTruthy();
    // "High" is the English label for priority High.
    expect(getByText("High")).toBeTruthy();
  });
});

describe("useTaskRowContext", () => {
  test("throws a documented error when used outside RowContext.Provider", () => {
    const original = console.error;
    console.error = () => {};
    try {
      expect(() => renderHook(() => useTaskRowContext())).toThrow(
        "useTaskRowContext must be used within RowContext.Provider",
      );
    } finally {
      console.error = original;
    }
  });
});
```

Run: `npx vitest run src/app/task-row.test.tsx`
Expected: PASS — 2 tests.

- [ ] **Step 5: Add the memo-isolation test**

Append inside the `describe("TaskRow", ...)` block in `src/app/task-row.test.tsx`:

```tsx
  test("does not re-render on unrelated parent state change (memo holds)", () => {
    const ctx = makeContext();
    const task = makeTask({ id: 42 });
    let setCounter: (n: number) => void = () => {};
    const renderSpy = vi.fn<ProfilerOnRenderCallback>();

    function Harness() {
      const [, setN] = React.useState(0);
      setCounter = setN;
      return rowWrapper({
        context: ctx,
        children: (
          <Profiler id="row" onRender={renderSpy}>
            <TaskRow
              task={task}
              isSelected={false}
              isEditing={false}
              isExpanded={false}
              isPushing={false}
              raidRefs={undefined}
            />
          </Profiler>
        ),
      });
    }

    render(<Harness />);
    const initialRenders = renderSpy.mock.calls.length;
    expect(initialRenders).toBeGreaterThanOrEqual(1);

    act(() => setCounter(1));
    act(() => setCounter(2));

    expect(renderSpy.mock.calls.length).toBe(initialRenders);
  });
```

Run: `npx vitest run src/app/task-row.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 6: Add the own-prop re-render test**

Append inside the `describe("TaskRow", ...)` block:

```tsx
  test("re-renders when its own props change (isSelected flip)", () => {
    const ctx = makeContext();
    const task = makeTask({ id: 100 });
    let setSel: (b: boolean) => void = () => {};
    const renderSpy = vi.fn<ProfilerOnRenderCallback>();

    function Harness() {
      const [sel, setSelLocal] = React.useState(false);
      setSel = setSelLocal;
      return rowWrapper({
        context: ctx,
        children: (
          <Profiler id="row" onRender={renderSpy}>
            <TaskRow
              task={task}
              isSelected={sel}
              isEditing={false}
              isExpanded={false}
              isPushing={false}
              raidRefs={undefined}
            />
          </Profiler>
        ),
      });
    }

    render(<Harness />);
    const before = renderSpy.mock.calls.length;

    act(() => setSel(true));

    expect(renderSpy.mock.calls.length).toBeGreaterThan(before);
  });
```

Run: `npx vitest run src/app/task-row.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 7: Verify full vitest suite**

Run: `npx vitest run`
Expected: 51 tests across 8 test files (47 existing + 4 new).

- [ ] **Step 8: Verify build is still green**

Run: `npm run build`
Expected: `✓ Compiled successfully` + `Finished TypeScript`. The duplicate helpers are inert; the inline row JSX in `task-manager.tsx` is unchanged. Build remains green.

- [ ] **Step 9: Commit**

```bash
git add src/app/task-row.tsx src/app/task-row.test.tsx
git commit src/app/task-row.tsx src/app/task-row.test.tsx -m "feat(task-row): TaskRow component + memo isolation tests"
```

Note: only the two new files change in this commit — `task-manager.tsx` is untouched (helpers stay in place until Task 7).

---

## Task 4: Extract `<NotesCell>` with isolation test

**Files:**
- Modify: `src/app/task-row.tsx`
- Modify: `src/app/task-row.test.tsx`

- [ ] **Step 1: Implement `NotesCell` in `task-row.tsx`**

Append to `src/app/task-row.tsx` (after the `TaskRow` export):

```tsx
interface NotesCellProps {
  notes: string;
  isExpanded: boolean;
  taskId: number;
}

function NotesCellImpl({ notes, isExpanded, taskId }: NotesCellProps) {
  const { lang, onToggleNoteExpanded } = useTaskRowContext();
  if (!notes) return <span>—</span>;
  const summary = summarizeNote(notes, NOTES_COLLAPSED_MAX);
  const displayed = isExpanded
    ? notes
    : summary.text + (summary.truncated ? " …" : "");
  return (
    <div className="flex flex-col gap-1">
      <span className={isExpanded ? "whitespace-pre-wrap" : "whitespace-normal"}>
        {displayed}
      </span>
      {summary.truncated && (
        <button
          type="button"
          onClick={() => onToggleNoteExpanded(taskId)}
          className="self-start text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-blue"
          aria-expanded={isExpanded}
        >
          {isExpanded ? t(lang, "showLess") : t(lang, "showMore")}
        </button>
      )}
    </div>
  );
}

export const NotesCell = memo(NotesCellImpl);
```

In `TaskRow`'s body, replace the inline notes IIFE with a `<NotesCell>` call. Find:

```tsx
      {!hiddenCols.has("notes") && (
        <Td className="max-w-xs text-zinc-600 dark:text-zinc-400">
          {(() => {
            const notes = task.notes ?? "";
            if (!notes) return <span>—</span>;
            const summary = summarizeNote(notes, NOTES_COLLAPSED_MAX);
            const displayed = isExpanded ? notes : summary.text + (summary.truncated ? " …" : "");
            return (
              <div className="flex flex-col gap-1">
                <span className={isExpanded ? "whitespace-pre-wrap" : "whitespace-normal"}>
                  {displayed}
                </span>
                {summary.truncated && (
                  <button
                    type="button"
                    onClick={() => onToggleNoteExpanded(task.id)}
                    className="self-start text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-blue"
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? t(lang, "showLess") : t(lang, "showMore")}
                  </button>
                )}
              </div>
            );
          })()}
        </Td>
      )}
```

Replace with:

```tsx
      {!hiddenCols.has("notes") && (
        <Td className="max-w-xs text-zinc-600 dark:text-zinc-400">
          <NotesCell notes={task.notes ?? ""} isExpanded={isExpanded} taskId={task.id} />
        </Td>
      )}
```

Both `summarizeNote` and `onToggleNoteExpanded` are now unused in `TaskRowImpl`. Remove them from the destructure of `useTaskRowContext()` at the top of `TaskRowImpl`.

- [ ] **Step 2: Write the isolation test**

In `src/app/task-row.test.tsx`, expand the existing import statement to include `NotesCell`:

```tsx
import {
  TaskRow,
  NotesCell,
  RowContextProvider,
  useTaskRowContext,
  type RowContextValue,
} from "./task-row";
```

Append a new top-level `describe("NotesCell", ...)` block (after the existing `describe("useTaskRowContext", ...)`):

```tsx
describe("NotesCell", () => {
  test("isolation: re-rendering cell A does not re-render cell B", () => {
    const ctx = makeContext();
    let setExpA: (b: boolean) => void = () => {};
    const renderSpyB = vi.fn<ProfilerOnRenderCallback>();

    function Harness() {
      const [expA, setExpALocal] = React.useState(false);
      setExpA = setExpALocal;
      return (
        <table>
          <tbody>
            <tr>
              <td>
                <RowContextProvider value={ctx}>
                  <NotesCell
                    notes="A note long enough to trigger expansion behaviour with more than fifty characters of body text here."
                    isExpanded={expA}
                    taskId={1}
                  />
                </RowContextProvider>
              </td>
              <td>
                <RowContextProvider value={ctx}>
                  <Profiler id="cellB" onRender={renderSpyB}>
                    <NotesCell
                      notes="B note also long enough to trigger expansion behaviour with more than fifty characters of body text here."
                      isExpanded={false}
                      taskId={2}
                    />
                  </Profiler>
                </RowContextProvider>
              </td>
            </tr>
          </tbody>
        </table>
      );
    }

    render(<Harness />);
    const before = renderSpyB.mock.calls.length;

    act(() => setExpA(true));

    expect(renderSpyB.mock.calls.length).toBe(before);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/app/task-row.test.tsx`
Expected: PASS — 5 tests.

Run: `npx vitest run`
Expected: 52 tests across 8 files.

- [ ] **Step 4: Commit**

```bash
git add src/app/task-row.tsx src/app/task-row.test.tsx
git commit src/app/task-row.tsx src/app/task-row.test.tsx -m "feat(task-row): extract memoized NotesCell + isolation test"
```

---

## Task 5: Extract `<TaskActions>` with handler-argument test

**Files:**
- Modify: `src/app/task-row.tsx`
- Modify: `src/app/task-row.test.tsx`

- [ ] **Step 1: Implement `TaskActions` in `task-row.tsx`**

Append to `src/app/task-row.tsx` (after the `NotesCell` export):

```tsx
interface TaskActionsProps {
  task: Task;
  isPushing: boolean;
}

function TaskActionsImpl({ task, isPushing }: TaskActionsProps) {
  const {
    lang,
    jiraEnabled,
    jiraProjectKey,
    onToggleComplete,
    onSendInquiry,
    onPushToJira,
    onEdit,
    onDelete,
  } = useTaskRowContext();
  return (
    <div className="flex flex-col gap-1 whitespace-nowrap">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onToggleComplete(task)}
          className="text-xs font-medium text-AIPM-green underline-offset-2 hover:underline"
        >
          {task.completedDate ? t(lang, "reopenTask") : t(lang, "markComplete")}
        </button>
        {!task.completedDate && (
          <button
            type="button"
            onClick={() => onSendInquiry(task)}
            className="text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-blue"
          >
            {t(lang, "sendInquiry")}
          </button>
        )}
        {jiraEnabled && jiraProjectKey && !task.jiraKey && !task.completedDate && (
          <button
            type="button"
            onClick={() => onPushToJira(task.id)}
            disabled={isPushing}
            className="text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-AIPM-blue"
          >
            {isPushing ? t(lang, "jiraPushing") : t(lang, "jiraPushToJira")}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onEdit(task)}
          className="text-xs font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
        >
          {t(lang, "edit")}
        </button>
        <button
          type="button"
          onClick={() => onDelete(task.id)}
          className="text-xs font-medium text-red-600 underline-offset-2 hover:underline dark:text-red-400"
        >
          {t(lang, "delete")}
        </button>
      </div>
    </div>
  );
}

export const TaskActions = memo(TaskActionsImpl);
```

In `TaskRow`'s body, replace the inline action buttons block. Find the final `<Td>` (the actions column) containing the two `<div className="flex flex-wrap gap-2">` rows, and replace its entire body:

FROM:
```tsx
      <Td>
        <div className="flex flex-col gap-1 whitespace-nowrap">
          <div className="flex flex-wrap gap-2">
            { /* ... mark-complete / send-inquiry / push-to-jira ... */ }
          </div>
          <div className="flex flex-wrap gap-2">
            { /* ... edit / delete ... */ }
          </div>
        </div>
      </Td>
```

TO:
```tsx
      <Td>
        <TaskActions task={task} isPushing={isPushing} />
      </Td>
```

Update the destructure of `useTaskRowContext()` in `TaskRowImpl` to drop the now-unused `onToggleComplete`, `onSendInquiry`, `onPushToJira`, `onEdit`, `onDelete`, `jiraEnabled`, `jiraProjectKey`.

- [ ] **Step 2: Write the handler-argument test**

Update the import at the top of `src/app/task-row.test.tsx` to include `TaskActions`:

```tsx
import {
  TaskRow,
  NotesCell,
  TaskActions,
  RowContextProvider,
  useTaskRowContext,
  type RowContextValue,
} from "./task-row";
```

Append a new top-level `describe("TaskActions", ...)` block:

```tsx
describe("TaskActions", () => {
  test("each button calls the corresponding handler with the right argument", () => {
    const ctx = makeContext({ jiraEnabled: true, jiraProjectKey: "MCP" });
    const task = makeTask({ id: 99 });

    const { getByText } = render(
      <table>
        <tbody>
          <tr>
            <td>
              <RowContextProvider value={ctx}>
                <TaskActions task={task} isPushing={false} />
              </RowContextProvider>
            </td>
          </tr>
        </tbody>
      </table>,
    );

    fireEvent.click(getByText("Mark complete"));
    expect(ctx.onToggleComplete).toHaveBeenCalledTimes(1);
    expect(ctx.onToggleComplete).toHaveBeenCalledWith(task);

    fireEvent.click(getByText("Edit"));
    expect(ctx.onEdit).toHaveBeenCalledTimes(1);
    expect(ctx.onEdit).toHaveBeenCalledWith(task);

    fireEvent.click(getByText("Delete"));
    expect(ctx.onDelete).toHaveBeenCalledTimes(1);
    expect(ctx.onDelete).toHaveBeenCalledWith(99);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/app/task-row.test.tsx`
Expected: PASS — 6 tests.

Run: `npx vitest run`
Expected: 53 tests across 8 files.

- [ ] **Step 4: Commit**

```bash
git add src/app/task-row.tsx src/app/task-row.test.tsx
git commit src/app/task-row.tsx src/app/task-row.test.tsx -m "feat(task-row): extract memoized TaskActions + handler-argument test"
```

---

## Task 6: Extract `<DependencyChips>` and `<RaidBadge>`

**Files:**
- Modify: `src/app/task-row.tsx`

No new tests — both sub-components are covered by Task 3's rendering test when seeded tasks have `dependencies` / `raidRefs`.

- [ ] **Step 1: Implement `DependencyChips` in `task-row.tsx`**

Update the existing `./types` import at the top of `src/app/task-row.tsx` to include `TaskDependency`:

```tsx
import { type Priority, type Task, type TaskDependency } from "./types";
```

Append (after the `TaskActions` export):

```tsx
interface DependencyChipsProps {
  deps: TaskDependency[];
}

function DependencyChipsImpl({ deps }: DependencyChipsProps) {
  const { lang, tasksById } = useTaskRowContext();
  if (deps.length === 0) return <span>—</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {deps.map((dep, i) => {
        const pred = tasksById.get(dep.taskId);
        const predName = pred?.taskName ?? t(lang, "depMissing");
        return (
          <li key={`dep-${dep.taskId}-${dep.type}-${i}`}>
            <span
              title={`${t(lang, "depDependsOn")} #${dep.taskId} (${dep.type}) — ${predName}`}
              className="inline-flex items-center gap-0.5 rounded-full bg-AIPM-blue/15 px-1.5 py-0.5 text-[10px] font-medium text-AIPM-dark-blue dark:bg-AIPM-blue/25 dark:text-AIPM-light-grey"
            >
              <span className="font-mono">{dep.type}</span>
              <span className="opacity-70">·</span>
              <span className="font-mono">#{dep.taskId}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export const DependencyChips = memo(DependencyChipsImpl);
```

- [ ] **Step 2: Implement `RaidBadge` in `task-row.tsx`**

Append (after the `DependencyChips` export):

```tsx
interface RaidBadgeProps {
  taskId: number;
  refs: RaidItem[];
}

function RaidBadgeImpl({ taskId, refs }: RaidBadgeProps) {
  const { lang, onJumpToRaid } = useTaskRowContext();
  const counts = countByCategory(refs);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onJumpToRaid(taskId);
      }}
      title={t(lang, "raidReferencedBy", refs.length)}
      aria-label={t(lang, "raidReferencedBy", refs.length)}
      className="ml-1 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60"
    >
      {t(lang, "raidReferencedByMix", counts.R, counts.A, counts.I, counts.D)}
    </button>
  );
}

export const RaidBadge = memo(RaidBadgeImpl);
```

- [ ] **Step 3: Replace inline JSX in `TaskRow` with the new sub-components**

In `TaskRow`'s body:

1. Find the inline `raidRefs && raidRefs.length > 0 && (() => { ... })()` IIFE (inside the `id` column `<Td>`). Replace with:

   ```tsx
        {raidRefs && raidRefs.length > 0 && (
          <RaidBadge taskId={task.id} refs={raidRefs} />
        )}
   ```

2. Find the inline dependency-chips block (the `<Td>` whose body starts with `(task.dependencies?.length ?? 0) === 0 ? ... : <ul>`). Replace its body with `<DependencyChips deps={task.dependencies ?? []} />`:

   FROM:
   ```tsx
        {!hiddenCols.has("depRelations") && (
          <Td className="text-zinc-600 dark:text-zinc-400">
            {(task.dependencies?.length ?? 0) === 0 ? (
              <span>—</span>
            ) : (
              <ul className="flex flex-wrap gap-1">
                {/* ... */}
              </ul>
            )}
          </Td>
        )}
   ```

   TO:
   ```tsx
        {!hiddenCols.has("depRelations") && (
          <Td className="text-zinc-600 dark:text-zinc-400">
            <DependencyChips deps={task.dependencies ?? []} />
          </Td>
        )}
   ```

3. Update the destructure of `useTaskRowContext()` in `TaskRowImpl` — drop `onJumpToRaid` and `tasksById` (now read inside the sub-components). Keep the rest only as needed.

After all extractions, `TaskRowImpl`'s `useTaskRowContext()` destructure should only contain: `lang`, `today`, `holidaySet`, `jiraSiteUrl`, `hiddenCols`, `onToggleSelect`. Cross-check this list against your edited code; if anything else is still referenced in `TaskRowImpl`'s body that wasn't moved into a sub-component, leave it.

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: 53 tests across 8 files (unchanged from Task 5 — no new tests).

Build will still fail until Task 7 — that's expected.

- [ ] **Step 5: Commit**

```bash
git add src/app/task-row.tsx
git commit src/app/task-row.tsx -m "feat(task-row): extract memoized DependencyChips and RaidBadge"
```

---

## Task 7: Migrate `TaskManagerInner` to render `<TaskRow>`

**Files:**
- Modify: `src/app/task-manager.tsx`

No new tests. Verification: build + full suite + manual smoke.

- [ ] **Step 1: Delete the now-duplicated row-only helpers from `task-manager.tsx`**

These are duplicated in `task-row.tsx` from Task 3 Step 1; after Step 4 of this task replaces the inline `<tr>{...}` block, nothing in `task-manager.tsx` references them anymore. Delete them now to avoid leaving dead code in the file:

- `const NOTES_COLLAPSED_MAX = 50;` (currently around line 259)
- `function summarizeNote(...) { ... }` (currently around lines 271–293)
- `const priorityStyle: Record<Priority, string> = { ... };` (currently around lines 373–378)
- `function safeJiraIssueHref(...) { ... }` (currently around lines 396–404)
- `function Td(...) { ... }` (currently around lines 4476–4484)

Build will fail temporarily inside this task until Step 4 replaces the inline JSX. That's OK — it's all within a single uncommitted edit session; the final Step 8 commit lands a green tree.

- [ ] **Step 2: Import the new components**

Near the other `./` imports in `src/app/task-manager.tsx`, add:

```tsx
import {
  RowContextProvider,
  TaskRow,
  type RowContextValue,
} from "./task-row";
```

- [ ] **Step 3: Rewrite the row-related handler closures as `useCallback`s**

Inside `TaskManagerInner`, locate each of these existing inline handler declarations (search by name) and rewrite as `useCallback`s placed near the top of the function body, after the existing `useFilters()` and `useWorkspace()` destructures.

**`toggleSelect` → `onToggleSelect`:**

FROM (existing inline function):
```tsx
function toggleSelect(id: number) {
  setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}
```

TO:
```tsx
const onToggleSelect = useCallback((id: number) => {
  setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}, []);
```

**`toggleNoteExpanded` → `onToggleNoteExpanded`:**

FROM:
```tsx
function toggleNoteExpanded(id: number) {
  setExpandedNotes((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}
```

TO:
```tsx
const onToggleNoteExpanded = useCallback((id: number) => {
  setExpandedNotes((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}, []);
```

**`onJumpToRaid` (new, replaces the inline RAID-badge click handler):**

```tsx
const onJumpToRaid = useCallback((id: number) => {
  setRaidFilterTaskId(id);
  setActiveTab("raid");
  setWorkspaceCollapsed((prev) => (prev ? false : prev));
}, [setRaidFilterTaskId]);
```

`setRaidFilterTaskId` comes from `useFilters()` and is stable, but the linter may require it in the deps. The other two setters (`setActiveTab`, `setWorkspaceCollapsed`) are local `useState` setters and are always stable.

**`handleToggleComplete` → `onToggleComplete`, `handleSendInquiry` → `onSendInquiry`, `handlePushToJira` → `onPushToJira`, `handleEdit` → `onEdit`, `handleDelete` → `onDelete`:**

For each, copy the existing function body verbatim into a `useCallback`. List in deps every state, setter, or constant the body reads from the outer scope. Stable React setters (any `setX` from `useState` or context) and refs (`tasksRef`) don't need to be listed but may be flagged by eslint-plugin-react-hooks — list them anyway. Frequently-changing values like `lang`, `settings`, `today`, `holidaySet` go in deps and the callback identity will change with them.

For example, `handleEdit` body:
```tsx
const onEdit = useCallback((task: Task) => {
  setForm({
    id: task.id,
    taskName: task.taskName,
    assignee: task.assignee,
    assigneeEmail: task.assigneeEmail ?? "",
    startDate: task.startDate ?? "",
    dueDate: task.dueDate,
    lastUpdateDate: task.lastUpdateDate,
    priority: task.priority,
    blockers: task.blockers,
    notes: task.notes,
    group: task.group ?? "",
    labels: task.labels ?? [],
    dependencies: task.dependencies ?? [],
    healthOverride: task.healthOverride,
    jiraKey: task.jiraKey,
    jiraIssueType: task.jiraIssueType,
    completedDate: task.completedDate,
  });
  setEditingId(task.id);
  setTaskModalOpen(true);
}, []);
```

(Adjust the body to match the existing `handleEdit` exactly — the example above is illustrative; preserve whatever shape the existing handler builds.)

Rename every internal call site of the old handler names to the new names. For example, places where the bulk-edit code calls `handleDelete(id)` should now call `onDelete(id)`.

- [ ] **Step 4: Build the memoized `rowContextValue`**

After all 8 `useCallback`s are declared, add (inside `TaskManagerInner`, right after them):

```tsx
const rowContextValue = useMemo<RowContextValue>(
  () => ({
    lang,
    today,
    holidaySet,
    jiraSiteUrl: settings.jira.siteUrl,
    jiraEnabled: settings.jira.enabled,
    jiraProjectKey: settings.jira.projectKey,
    hiddenCols,
    tasksById,
    onToggleSelect,
    onToggleNoteExpanded,
    onJumpToRaid,
    onToggleComplete,
    onSendInquiry,
    onPushToJira,
    onEdit,
    onDelete,
  }),
  [
    lang,
    today,
    holidaySet,
    settings.jira.siteUrl,
    settings.jira.enabled,
    settings.jira.projectKey,
    hiddenCols,
    tasksById,
    onToggleSelect,
    onToggleNoteExpanded,
    onJumpToRaid,
    onToggleComplete,
    onSendInquiry,
    onPushToJira,
    onEdit,
    onDelete,
  ],
);
```

- [ ] **Step 5: Replace the inline `<tr>{...}` block with `<TaskRow … />` and wrap with `<RowContextProvider>`**

Find the existing `<tbody>` block in `task-manager.tsx` (around line 3865, look for `divide-y divide-zinc-200`). The block currently looks like:

```tsx
<tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
  {filteredSortedTasks.map((task) => {
    const isComplete = !!task.completedDate;
    // ... ~250 lines of inline JSX ...
  })}
</tbody>
```

Replace the entire `.map(...)` body with:

```tsx
<tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
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
</tbody>
```

Then wrap the `<table>` element (containing `<thead>` and `<tbody>`) with `<RowContextProvider value={rowContextValue}>`:

```tsx
<RowContextProvider value={rowContextValue}>
  <table className="...existing classes...">
    <thead>...</thead>
    <tbody className="...">...</tbody>
  </table>
</RowContextProvider>
```

- [ ] **Step 6: Build to verify TypeScript and Next compilation**

Run: `npm run build`
Expected: `✓ Compiled successfully` + `Finished TypeScript`. No new warnings.

If TypeScript complains about undefined `onToggleSelect` / etc., they were declared after their first use — move the `useCallback` block earlier in `TaskManagerInner`'s body (right after `useWorkspace()`).

If it complains about removed helpers (`Td`, `summarizeNote`, etc.), there's still an inline reference somewhere in `task-manager.tsx`. Grep for the name and either remove the reference or import the helper back from `./task-row`.

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: 53 tests across 8 files. No regressions.

- [ ] **Step 8: Manual smoke (uncommitted)**

Run: `npm run dev`. Open `http://localhost:3000`. Verify:

1. **Search debounce:** type in the search box. The task list updates after ~150 ms.
2. **Priority filter:** pick a priority. List narrows.
3. **Group / Label / Assignee filter:** each narrows the list.
4. **Sortable column header:** click. Sort direction toggles.
5. **RAID badge:** click a task row's RAID badge. RaidPanel opens with the task filter applied.
6. **Edit a task:** open Edit, change a field, save. The row updates immediately.
7. **Mark complete / Reopen:** click the workflow button on one row; only that row's appearance changes.
8. **Notes expansion:** expand a long note. Other rows are unaffected.
9. **Cross-window sync (optional):** open the app in a second tab. Edit a task in tab A; tab B updates within ~1 second.

**Perf check:** with 20+ tasks loaded, open React DevTools Profiler, record while you:
- Type one character in the search box → confirm only the rows narrowed/excluded by the filter re-render after the 150 ms debounce. Other matching rows don't re-render.
- Expand one row's notes → confirm only that row's `NotesCell` re-renders.
- Click Mark Complete on one row → confirm only that row re-renders.

Stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add src/app/task-manager.tsx
git commit src/app/task-manager.tsx -m "refactor(task-manager): consume TaskRow + RowContext, useCallback handlers"
```

---

## Done

After Task 7:

- `src/app/task-row.tsx` owns ~250 lines of row JSX, split into 5 memoized components under a local `RowContext`.
- `src/app/task-manager.tsx` is ~230 lines shorter; the `<tbody>` body is a one-liner `.map(task => <TaskRow … />)`.
- Six new tests in `src/app/task-row.test.tsx` covering: outside-provider throw, render correctness, memo isolation under parent state change, own-prop re-render, NotesCell sub-component isolation, TaskActions handler-argument forwarding.
- Full suite green at 53 tests across 8 files.
- `priorityLabel` lives in `src/app/i18n.ts`; `healthDot` lives in `src/app/health.ts`. Both are imported by `task-row.tsx` and `task-manager.tsx`.
- Slice 3 (TaskFormProvider) can build on top by lifting the add/edit/bulk-edit form drafts out of `TaskManagerInner` — the row is now stable, so the form's own re-renders won't cascade.
