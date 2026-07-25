// src/app/task-kanban.ts — pure, i18n-free Kanban grouping.
import { effectiveAssignee } from "./resource-foundation";
import { TASK_STATUSES, type Resource, type Task, type TaskStatus } from "./types";

/** Partition tasks into one bucket per TaskStatus (all buckets present, even empty).
 *  Input order is preserved within each bucket. */
export function groupByStatus(tasks: readonly Task[]): Record<TaskStatus, Task[]> {
  const out = {} as Record<TaskStatus, Task[]>;
  for (const s of TASK_STATUSES) out[s] = [];
  for (const task of tasks) out[task.status].push(task);
  return out;
}

/** Lane key for tasks with neither a resource link nor an assignee string. */
export const UNASSIGNED_LANE = "unassigned";

export interface KanbanLane {
  /** Stable key: `res:<id>` when linked, `name:<string>` for a free-string
   *  assignee, or UNASSIGNED_LANE. Also the drop-target payload. */
  key: string;
  /** Display name; "" for the Unassigned lane (the caller supplies its label,
   *  which is translated — this module stays i18n-free). */
  label: string;
  /** Set only for a linked lane; the drop handler writes it to the task. */
  resourceId: number | null;
}

export interface SwimlaneGrouping {
  lanes: KanbanLane[];
  cells: Record<string, Record<TaskStatus, Task[]>>;
}

function laneOf(task: Task, resourcesById: ReadonlyMap<number, Resource>): KanbanLane {
  if (task.resourceId != null && resourcesById.has(task.resourceId)) {
    return {
      key: `res:${task.resourceId}`,
      label: effectiveAssignee(task, resourcesById),
      resourceId: task.resourceId,
    };
  }
  const name = task.assignee.trim();
  if (name) return { key: `name:${name}`, label: name, resourceId: null };
  return { key: UNASSIGNED_LANE, label: "", resourceId: null };
}

function emptyCells(): Record<TaskStatus, Task[]> {
  const out = {} as Record<TaskStatus, Task[]>;
  for (const s of TASK_STATUSES) out[s] = [];
  return out;
}

/** Resource ids that already have a swimlane: everyone owning a visible task,
 *  plus the lanes the user pulled in explicitly. The add-lane picker excludes
 *  these so it never offers a lane that already exists. */
export function laneResourceIds(
  tasks: readonly Task[],
  extraLaneIds: readonly number[],
): number[] {
  const ids = new Set<number>(extraLaneIds);
  for (const t of tasks) if (t.resourceId != null) ids.add(t.resourceId);
  return [...ids];
}

/**
 * Group tasks into a 2-D status × person grid.
 *
 * Lanes are derived from the tasks themselves (so search/filter/hide-externals
 * narrow them for free), plus any `extraLaneIds` the user has explicitly pulled
 * in to make an empty lane droppable. A linked lane always shows the resource's
 * LIVE name — the stored `assignee` string is a stale-able cache.
 *
 * Ordering: by display name, Unassigned last. Input order is preserved inside
 * each cell.
 */
export function groupByStatusAndPerson(
  tasks: readonly Task[],
  resourcesById: ReadonlyMap<number, Resource>,
  extraLaneIds: readonly number[],
): SwimlaneGrouping {
  const lanes = new Map<string, KanbanLane>();
  const cells: Record<string, Record<TaskStatus, Task[]>> = {};

  const ensure = (lane: KanbanLane) => {
    if (!lanes.has(lane.key)) {
      lanes.set(lane.key, lane);
      cells[lane.key] = emptyCells();
    }
    return lane.key;
  };

  for (const task of tasks) {
    const key = ensure(laneOf(task, resourcesById));
    cells[key][task.status].push(task);
  }

  for (const id of extraLaneIds) {
    const r = resourcesById.get(id);
    if (!r) continue;
    ensure({
      key: `res:${id}`,
      label: effectiveAssignee({ assignee: "", resourceId: id }, resourcesById),
      resourceId: id,
    });
  }

  ensure({ key: UNASSIGNED_LANE, label: "", resourceId: null });

  const ordered = [...lanes.values()].sort((a, b) => {
    if (a.key === UNASSIGNED_LANE) return 1;
    if (b.key === UNASSIGNED_LANE) return -1;
    return a.label.localeCompare(b.label);
  });

  return { lanes: ordered, cells };
}
