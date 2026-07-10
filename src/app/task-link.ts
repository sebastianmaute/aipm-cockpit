// src/app/task-link.ts
// Pure helper: wire a predecessor/successor dependency between a parent task and
// a child task. `TaskDependency` lives on the DEPENDENT task and points at its
// predecessor (see types.ts). Consumed by the task-editor "create linked task"
// flow (Task 8) both for existing parents and buffer-flushed new parents.
import type { DependencyType, Task } from "./types";
import type { LinkSpec } from "./use-task-editor-buffer";

/**
 * Return a new task list with the parent↔child dependency wired per `link`.
 * - predecessor ⇒ the child is added as a predecessor of the parent.
 * - successor   ⇒ the parent is added as a predecessor of the child.
 * De-dupes: an existing dependency on the same predecessor id is left as-is.
 * Pure — never mutates the input tasks.
 */
export function applyTaskLink(
  tasks: readonly Task[],
  parentId: number,
  link: LinkSpec,
): Task[] {
  // A self-link (child id === parent id) would make a task its own predecessor —
  // never wire it (guards a degenerate flush, e.g. an id-reuse edge).
  if (parentId === link.childId) return tasks.slice();
  const targetId = link.direction === "predecessor" ? parentId : link.childId;
  const depId = link.direction === "predecessor" ? link.childId : parentId;
  const type = link.type as DependencyType;
  return tasks.map((task) => {
    if (task.id !== targetId) return task;
    const deps = task.dependencies ?? [];
    if (deps.some((d) => d.taskId === depId)) return task;
    return { ...task, dependencies: [...deps, { taskId: depId, type }] };
  });
}
