import { useState, type Dispatch, type SetStateAction } from "react";
import type { Resource, Task } from "./types";
import type { ActivityKind } from "./activity-log";
import {
  addBlocker,
  deleteBlocker,
  editBlocker,
  reopenBlocker,
  resolveBlocker,
  selfBlockerActor,
} from "./blocker-log";
import { t, type Lang } from "./i18n";
import type { BlockersWindowProps } from "./blockers-window";

// Live render-scope values the blocker window reads each render. Deps-object
// hook convention: called unconditionally, returns NON-memoized handlers.
export interface BlockersWindowDeps {
  tasks: readonly Task[];
  setTasks: Dispatch<SetStateAction<readonly Task[]>>;
  selfResourceId?: number | null;
  resources: readonly Resource[];
  lang: Lang;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
}

export interface UseBlockersWindowResult {
  openTaskBlockers: (id: number) => void;
  blockersWindowProps: BlockersWindowProps;
}

/** One write against the STORED row: `now` is minted by the caller in the event
 *  handler, and the mutator receives the row as it is in `prev`. */
type BlockerWrite = (task: Task, now: string) => Task;

// The task-only blocker window (the note log's three-register machinery is not
// needed). Never mounted in popouts — the caller gates the mount.
//
// ★★★ WRITE-THROUGH, like the note log, and NO undo entry (spec). Every handler
// commits straight into `tasks` through a FUNCTIONAL setter, so the mutator runs
// on the row as stored at that moment — two adds in one tick chain, and a field
// another writer changed after the window opened is kept.
export function useBlockersWindow(deps: BlockersWindowDeps): UseBlockersWindowResult {
  const { tasks, setTasks, selfResourceId, resources, lang, logActivity } = deps;
  const [targetId, setTargetId] = useState<number | null>(null);

  const target = targetId === null ? undefined : tasks.find((tk) => tk.id === targetId);

  const commit = (write: BlockerWrite) => {
    if (targetId === null) return;
    const id = targetId;
    const now = new Date().toISOString();
    setTasks((prev) =>
      prev.map((tk) => {
        if (tk.id !== id) return tk;
        const next = write(tk, now);
        // A no-op mutator (blank text, unknown id) returns the same row.
        return next === tk ? tk : { ...next, localModifiedAt: now };
      }),
    );
    // Name read from the LIVE closure array, never from inside the updater.
    // `activityTaskUpdated` takes ONE argument after the id.
    logActivity("task.updated", id, tasks.find((tk) => tk.id === id)?.taskName ?? "");
  };

  const blockersWindowProps: BlockersWindowProps = {
    open: targetId !== null,
    onClose: () => setTargetId(null),
    entries: target?.blockerLog ?? [],
    onAdd: (text) => {
      // The author is resolved at write time, so a self resource set while the
      // window is open is honoured.
      const actor = selfBlockerActor(selfResourceId, resources);
      commit((tk, now) => addBlocker(tk, text, actor, now));
    },
    onEdit: (entryId, text) => commit((tk, now) => editBlocker(tk, entryId, text, now)),
    onResolve: (entryId) => commit((tk, now) => resolveBlocker(tk, entryId, now)),
    onReopen: (entryId) => commit((tk) => reopenBlocker(tk, entryId)),
    onDelete: (entryId) => commit((tk) => deleteBlocker(tk, entryId)),
    resources,
    lang,
    entityLabel: target?.taskName ?? t(lang, "blockerLogTitle"),
    taskId: targetId,
  };

  return {
    openTaskBlockers: (id: number) => setTargetId(id),
    blockersWindowProps,
  };
}
