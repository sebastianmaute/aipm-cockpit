// src/app/task-external.ts — pure, i18n-free external-ownership test for a task.
//
// Classification is LINK-ONLY: a task counts as externally owned when its
// resourceId resolves to a directory resource flagged isExternal. A free-string
// assignee is never classified, even when the string equals an external's name.
// resource-workload does name-match, but there a miss only misroutes a row into
// "Unlinked"; here a name collision would HIDE REAL WORK, so this fails safe.
import type { Resource, Task } from "./types";

export function isExternalTask(
  task: Pick<Task, "resourceId">,
  resourcesById: ReadonlyMap<number, Pick<Resource, "isExternal">>,
): boolean {
  if (task.resourceId == null) return false;
  return resourcesById.get(task.resourceId)?.isExternal === true;
}
