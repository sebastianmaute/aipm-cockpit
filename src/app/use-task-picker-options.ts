// Shared task-picker memo for the edit-modal chip pickers. The change- and
// raid-edit modals filtered their linked-task option list identically: drop
// already-selected task ids, match the query against the id OR the task name,
// then cap. Single-sourced here (a thin useMemo wrapper over
// filterPickerOptions with the task getId/getText) so the two blocks can't
// drift. The optional extraFilter mirrors filterPickerOptions' predicate for
// any caller that needs self/cycle exclusion.

import { useMemo } from "react";
import { filterPickerOptions } from "./picker-filter";
import type { Task } from "./types";

export function useTaskPickerOptions(
  tasks: readonly Task[],
  selectedIds: readonly number[],
  query: string,
  extraFilter?: (task: Task) => boolean,
): Task[] {
  return useMemo(
    () =>
      filterPickerOptions(tasks, {
        query,
        excludeIds: new Set(selectedIds),
        getId: (tk) => tk.id,
        getText: (tk) => tk.taskName,
        extraFilter,
      }),
    [tasks, selectedIds, query, extraFilter],
  );
}
