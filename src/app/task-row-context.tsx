"use client";
// src/app/task-row-context.tsx — the Open Points table row's two React contexts.
//
// Extracted from `task-row.tsx` when that file reached 793 of its hard 800-line
// budget (`scripts/check-file-sizes.mjs`, no baseline entry) and the row-unique
// accessible-name work needed to add a prop to it. Pure move: no behaviour
// change, and `task-row.tsx` re-exports every name below so no importer or test
// mock had to be touched.
//
// ★★ THE RE-EXPORT IS LOAD-BEARING, not tidiness. `tasks-section.test.tsx`
// carries `vi.mock("./task-row", () => ({ RowContextProvider, TaskRow }))` — a
// FULL factory mock with no `importOriginal` — to capture the provider's
// `value` prop. Point `tasks-section.tsx` at this module directly and that mock
// stops intercepting the provider, the real one renders, and the captured value
// stays null. Import the hooks from here in NEW code; leave existing importers
// on `./task-row`.
//
// ★ No cycle results: this module imports only react and type-only modules,
// none of which reach `task-row.tsx`.

import { createContext, useContext, type ReactNode } from "react";
import type { Lang } from "./i18n";
import type { JiraExtraProject } from "./settings-types";
import type { Resource, Task, TaskStatus } from "./types";

export interface RowContextValue {
  lang: Lang;
  today: string;
  holidaySet: Set<string>;

  // Flattened from settings.jira so consumers only re-render
  // on Jira-config change, not on unrelated settings changes.
  jiraSiteUrl: string;
  jiraExtraProjects: readonly JiraExtraProject[];
  jiraEnabled: boolean;
  jiraProjectKey: string;

  hiddenCols: Set<string>;

  // Stable callbacks (useCallback'd in TaskManagerInner).
  onToggleSelect: (id: number) => void;
  /** Open the floating notes window for a task (running note log). */
  onOpenNotes: (id: number) => void;
  onJumpToRaid: (id: number) => void;
  onSendInquiry: (task: Task) => void;
  onPushToJira: (id: number) => void;
  onStatusChange: (id: number, next: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
  // Inline "Ask Claude" task edit (SP1): per-row trigger + its enablement gate,
  // threaded from the single useInlineAiEdit instance in TasksSection.
  onAiEdit: (task: Task) => void;
  aiEditEnabled: (task: Task) => boolean;
  // Inline Open-Points cell editing: applies a sanitized field patch to one task
  // (functional setter + localModifiedAt stamp on the pane side). Jira-synced
  // rows are skipped there (read-only) and render no inline affordance here.
  onInlinePatch: (taskId: number, patch: Partial<Task>) => void;
  // Directory lookup (id -> Resource) for resolving the LIVE assignee name of a
  // linked task. The stored `assignee` string is only a cache and goes stale
  // after a resource rename/re-link, so linked rows render the resource's
  // current name instead. Built once (useMemo) on the pane side.
  resourcesById: ReadonlyMap<number, Resource>;
  // Full directory list for the inline assignee ResourcePicker (dropdown of
  // resources + free-text). Reference-stable from the pane; contacts are NOT
  // threaded (inline picker suggests directory resources only).
  resources: readonly Resource[];
}

const RowContext = createContext<RowContextValue | undefined>(undefined);

// `tasksById` lives in its OWN context, split out of RowContextValue: it gets a
// brand-new Map on ANY task edit (audit #6/#32), so bundling it into the main
// value would re-render every row on every edit. Only the dependency-chip cell
// reads the lookup, so only it re-renders when the map changes; the main value
// stays reference-stable and unchanged rows are skipped by their React.memo.
const RowLookupContext = createContext<Map<number, Task> | undefined>(undefined);

/** Stable shared empty lookup for callers that render no dependency chips. */
const EMPTY_TASK_LOOKUP: Map<number, Task> = new Map();

export function RowContextProvider({
  value,
  tasksById = EMPTY_TASK_LOOKUP,
  children,
}: {
  value: RowContextValue;
  tasksById?: Map<number, Task>;
  children: ReactNode;
}) {
  return (
    <RowContext.Provider value={value}>
      <RowLookupContext.Provider value={tasksById}>{children}</RowLookupContext.Provider>
    </RowContext.Provider>
  );
}

export function useTaskRowContext(): RowContextValue {
  const ctx = useContext(RowContext);
  if (!ctx)
    throw new Error("useTaskRowContext must be used within RowContext.Provider");
  return ctx;
}

export function useTaskLookup(): Map<number, Task> {
  const ctx = useContext(RowLookupContext);
  if (!ctx)
    throw new Error("useTaskLookup must be used within RowContext.Provider");
  return ctx;
}

