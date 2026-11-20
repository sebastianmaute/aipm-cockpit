// Pure task-reference helpers for undoing an "Optimize with AI" apply (§796) — React-free, i18n-free.
//
// The apply's undo entry removes the tasks it created unless they changed or became referenced since
// (`captureCreatedPart`, `undo/created-rows.ts`). These say, for TASKS, what "referenced" means, how a
// removed task's links are dropped from the rows that stay, and how a redo's re-mint is followed.
import type { BudgetBucket, ChangeItem, Milestone, RaidItem, Task, TaskDependency } from "../types";

/** The four non-task slices that can point at a task. */
export interface TaskReferrers {
  raid: readonly RaidItem[];
  milestones: readonly Milestone[];
  changes: readonly ChangeItem[];
  budgets: readonly BudgetBucket[];
}

/** One field-patch edit, as `fieldEditsFromRows` builds it. */
export interface TaskFieldEdit {
  id: number;
  before: Partial<Task>;
  after: Partial<Task>;
}

const dependsOn = (row: Task, id: number): boolean => (row.dependencies ?? []).some((d) => d.taskId === id);

/**
 * Whether something OUTSIDE the apply's own writes points at task `id`: a dependency on it from a task the
 * apply did not create; a dependency on it from a created task whose created image did not have it (a
 * person added it since); or a RAID item, milestone, change or budget bucket linking it.
 * ★ `prev` is the FULL live list, so a created task's own image dependency must not count — in a chain
 * (created 12 depends on created 11) 11 would otherwise always be "referenced" and never removed.
 * ★ Called after the composite's field patch has reverted the edited tasks, so a link the apply wrote on
 * an existing task is already gone here.
 */
export function taskReferencedOutsideApply(
  prev: readonly Task[],
  id: number,
  createdById: ReadonlyMap<number, Task>,
  others: TaskReferrers,
): boolean {
  for (const row of prev) {
    if (row.id === id || !dependsOn(row, id)) continue;
    const image = createdById.get(row.id);
    if (image === undefined || !dependsOn(image, id)) return true;
  }
  const links = (xs: readonly { linkedTaskIds: readonly number[] }[]) => xs.some((x) => x.linkedTaskIds.includes(id));
  return (
    links(others.raid) ||
    links(others.milestones) ||
    links(others.changes) ||
    others.budgets.some((b) => (b.taskIds ?? []).includes(id))
  );
}

/** `row` without its dependencies on `removed` ids — the SAME row when it has none. */
export function dropTaskRefs(row: Task, removed: ReadonlySet<number>): Task {
  const deps = row.dependencies;
  if (!deps || !deps.some((d) => removed.has(d.taskId))) return row;
  return { ...row, dependencies: deps.filter((d) => !removed.has(d.taskId)) };
}

/** `row` with its dependencies followed through `remap` — the SAME row when nothing moved. With `only`,
 *  just the entries equal to one of those (taskId and type) move: on an edited existing task, the links
 *  the apply wrote follow a re-mint, never a link a person added to the row that took the freed id. */
export function remapTaskRefs(row: Task, remap: ReadonlyMap<number, number>, only?: readonly TaskDependency[]): Task {
  const deps = row.dependencies;
  if (!deps || remap.size === 0) return row;
  const moves = (d: TaskDependency) =>
    remap.has(d.taskId) && (only === undefined || only.some((o) => o.taskId === d.taskId && o.type === d.type));
  if (!deps.some(moves)) return row;
  return { ...row, dependencies: deps.map((d) => (moves(d) ? { ...d, taskId: remap.get(d.taskId) as number } : d)) };
}

/** Where each created task lives after one more redo: `base` maps an ORIGINAL created id to the id it lives
 *  under now, `step` is that redo's re-mint (keyed by the ids it re-inserted). Returns `base` itself when
 *  `step` moved nothing. */
export function composeRemap(
  base: ReadonlyMap<number, number>,
  step: ReadonlyMap<number, number>,
  originalIds: readonly number[],
): ReadonlyMap<number, number> {
  if (step.size === 0) return base;
  const out = new Map<number, number>();
  for (const o of originalIds) {
    const cur = base.get(o) ?? o;
    const next = step.get(cur) ?? cur;
    if (next !== o) out.set(o, next);
  }
  return out;
}

/** The edits with each `after` dependency on a created task followed to where that task lives now
 *  (`followed`, from `composeRemap`) — so the patch matches what the last redo actually wrote. `before` is
 *  left alone: it predates the created ids. Returns `edits` itself when nothing moved. */
export function followEditDeps(edits: readonly TaskFieldEdit[], followed: ReadonlyMap<number, number>): readonly TaskFieldEdit[] {
  if (followed.size === 0) return edits;
  let changed = false;
  const out = edits.map((e) => {
    const deps = e.after.dependencies;
    if (!deps) return e;
    const next = remapTaskRefs({ id: e.id, dependencies: deps } as Task, followed).dependencies;
    if (next === deps) return e;
    changed = true;
    return { ...e, after: { ...e.after, dependencies: next } };
  });
  return changed ? out : edits;
}
