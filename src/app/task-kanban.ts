// src/app/task-kanban.ts — pure, i18n-free Kanban grouping.
import { effectiveAssignee, personNameKey, resourceDisplayName } from "./resource-foundation";
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

/** Case-folded, whitespace-collapsed key for matching a stored assignee string
 *  against a directory display name.
 *
 *  ★★ `raw` is typed `string` and is NOT always one — `Task.assignee` is absent
 *  on partial/legacy rows. `laneOf` has always had this hazard on its FK-miss
 *  branch (the pre-change code did a bare `task.assignee.trim()` there, so
 *  `groupByStatusAndPerson` crashed on such a row before this work too). What
 *  changed is the SECOND entry point: `laneResourceIds` previously read only
 *  `resourceId` and never touched the field at all, so an unguarded `.trim()`
 *  here took down the whole Open Points view on mount via `tasks-section.tsx`.
 *  ★ Linked tasks are NOT the ones at risk — `laneResourceIdOf` returns on the
 *  FK branch before reaching this. It is the UNLINKED rows. Coerce at this one
 *  choke point rather than at each call site. */
const nameKey = personNameKey;

/**
 * Display name -> resource id, with a name owned by MORE THAN ONE resource
 * mapping to `null`.
 *
 * ★★ The null is not the same as absent and both branches are load-bearing:
 * absent means "nobody here is called that" and ambiguous means "several people
 * are". Both keep the task in its own name lane, but collapsing them to one
 * state invites a later `?? firstMatch` that would file one person's work under
 * a namesake. Poisoning on insert (rather than counting afterwards) also means
 * a third resource with the same name cannot un-poison the clash.
 */
function nameToResourceId(resourcesById: ReadonlyMap<number, Resource>): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const r of resourcesById.values()) {
    // ★★★ EXTERNALS ARE NEVER NAME-MATCHED. `task-external.ts` classifies
    // external ownership LINK-ONLY and says why: "a name collision would HIDE
    // REAL WORK, so this fails safe". Resolving a free-string assignee onto an
    // external would hand this lane a `resourceId`, making it a live DROP
    // TARGET — and a task dropped there gets that FK, which `isExternalTask`
    // then classifies as external, so with "Hide externals" on the card
    // silently vanishes. `tasks-section.tsx` already filters `extraLaneIds`
    // (`visibleExtraLaneIds`) for exactly this failure; task-DERIVED lanes are
    // not filtered, so the guard has to live here.
    // ★ Cost: an external with both FK-linked and string-only tasks still shows
    // two lanes while "Hide externals" is OFF. That is the documented lesser
    // evil — a duplicate lane is visible and harmless, a vanishing card is not.
    if (r.isExternal === true) continue;
    const key = nameKey(resourceDisplayName(r));
    if (!key) continue;
    out.set(key, out.has(key) ? null : r.id);
  }
  return out;
}

/**
 * The resource a task belongs to for LANE purposes: its FK when that resolves,
 * otherwise the resource its assignee string uniquely names. `null` when the
 * task names nobody the directory knows.
 *
 * ★★★ THE NAME FALLBACK IS THE WHOLE POINT. Keying a linked task `res:<id>` and
 * an unlinked one `name:<string>` rendered the SAME person as two lanes with
 * identical labels — indistinguishable on screen, and only the FK lane's cards
 * had a populated assignee select. A project acquires both shapes routinely:
 * Jira/CSV imports and AI-created tasks write the name, the picker writes the
 * FK. `backfillTaskResourceFks` repairs the DATA at load, but this must resolve
 * too — a task created in-session with a free-text assignee, or one whose
 * person was renamed after the string was cached, never reaches that pass.
 */
function laneResourceIdOf(
  task: Task,
  resourcesById: ReadonlyMap<number, Resource>,
  names: ReadonlyMap<string, number | null>,
): number | null {
  if (task.resourceId != null && resourcesById.has(task.resourceId)) return task.resourceId;
  const key = nameKey(task.assignee);
  if (!key) return null;
  return names.get(key) ?? null;
}

function laneOf(
  task: Task,
  resourcesById: ReadonlyMap<number, Resource>,
  names: ReadonlyMap<string, number | null>,
): KanbanLane {
  const resourceId = laneResourceIdOf(task, resourcesById, names);
  if (resourceId != null) {
    return {
      key: `res:${resourceId}`,
      // The LIVE directory name, never the task's cached string — two tasks
      // reaching this lane by different routes must not disagree on its label.
      label: effectiveAssignee({ assignee: "", resourceId }, resourcesById),
      resourceId,
    };
  }
  const name = (task.assignee ?? "").trim();
  // ★ The KEY is normalised, the LABEL is the first-seen spelling. Keying on the
  // raw string forked `"Ext  Contractor"` (double space) and `"Ext Contractor"`
  // into two lanes with visually identical headers — the same duplicate-lane
  // symptom this module now prevents for people the directory KNOWS, left open
  // for the ones it does not. `ensure()` keeps the first lane object for a key,
  // so the first spelling encountered supplies the label.
  // ★ Safe for the drop payload: `use-task-row-handlers.ts` writes `lane.label`,
  // never `lane.key`, so a drop still stores a human spelling. It does mean
  // dropping a variant-spelled task into the merged lane normalises its
  // `assignee` to the label — a deliberate write, on an explicit user action.
  if (name) return { key: `name:${nameKey(name)}`, label: name, resourceId: null };
  return { key: UNASSIGNED_LANE, label: "", resourceId: null };
}

function emptyCells(): Record<TaskStatus, Task[]> {
  const out = {} as Record<TaskStatus, Task[]>;
  for (const s of TASK_STATUSES) out[s] = [];
  return out;
}

/** Resource ids that already have a swimlane: everyone owning a visible task,
 *  plus the lanes the user pulled in explicitly. The add-lane picker excludes
 *  these so it never offers a lane that already exists. Mirrors
 *  `groupByStatusAndPerson`'s own dangling-FK handling: an id (task-owned or
 *  extra) that does not resolve in the directory is dropped, not just deduped. */
export function laneResourceIds(
  tasks: readonly Task[],
  resourcesById: ReadonlyMap<number, Resource>,
  extraLaneIds: readonly number[],
): number[] {
  const ids = new Set<number>();
  const names = nameToResourceId(resourcesById);
  for (const id of extraLaneIds) if (resourcesById.has(id)) ids.add(id);
  // Must use the SAME resolution as `laneOf`, name fallback included: a person
  // who owns a lane only by way of a free-string assignee still owns a lane, and
  // offering them in the add-lane picker would promise a second one.
  for (const t of tasks) {
    const id = laneResourceIdOf(t, resourcesById, names);
    if (id != null) ids.add(id);
  }
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

  const names = nameToResourceId(resourcesById);
  for (const task of tasks) {
    const key = ensure(laneOf(task, resourcesById, names));
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
