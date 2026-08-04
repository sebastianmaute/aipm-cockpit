// src/app/visible-task-rows.ts — the SINGLE definition of which task rows the
// Open Points table actually renders: the health filter, then hide-finished.
//
// Both the pane (which draws the rows) and useBulkOperations (which decides
// what select-all reaches) call this. They used to disagree: the hook read
// `filteredSortedTasks`, which is upstream of BOTH filters, so the header
// checkbox reported on — and acted on — rows the table was not rendering.
// (Its checked state and its click could NOT disagree with each other: both
// read the same `visibleIds`. They agreed perfectly, over the wrong set.)
import { filterTasksByHealth, type HealthFilter } from "./health";
import { isTaskClosed } from "./task-closed";
import { type Task } from "./types";

export function visibleTaskRows<T extends Task>(
  tasks: readonly T[],
  healthFilter: HealthFilter,
  hideFinished: boolean,
  ctx: { today: string; holidaySet: ReadonlySet<string> },
): readonly T[] {
  const byHealth = filterTasksByHealth(tasks, healthFilter, ctx.today, ctx.holidaySet);
  // CLOSED, not DELIVERED: a Cancelled task will not be worked on again, so
  // hide-finished must drop it too.
  return hideFinished ? byHealth.filter((row) => !isTaskClosed(row)) : byHealth;
}
