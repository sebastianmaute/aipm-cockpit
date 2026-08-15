"use client";

import { useCallback } from "react";
import {
  appendActivity,
  appendActivityEntry,
  type ActivityEntry,
  type ActivityKind,
  type FieldChange,
} from "./activity-log";
import { useWorkspace } from "./workspace-context";

/** ★★ The log is WORKSPACE state now, not per-device localStorage — this hook
 *  owns no state of its own. It hydrated from and wrote back to
 *  `localStorage["aipm-cockpit:activity-log"]` (`ACTIVITY_STORAGE_KEY` in
 *  `activity-log.ts`) until the activityLog-as-workspace-data
 *  slice; both effects (and the `clearActivityLog` storage wipe in
 *  `handleClearActivityLog`) were REMOVED, because a second writer would fight
 *  the storage backend's own save for the same entries. Persistence is the save
 *  effect in `use-storage-backend.ts`; reconciliation on load is
 *  `mergeActivityLogs`. Do NOT reintroduce a local mirror here. */
export function useActivityLog(): {
  activityLog: readonly ActivityEntry[];
  /** ★ NO `setActivityLog` here — it used to be returned so task-manager could
   *  hand it to `useStorageBackend`, which now reads the slice from
   *  `useWorkspace()` directly. A raw setter on this hook is a second way to
   *  write the log that bypasses `appendActivity`; anything genuinely needing
   *  it takes it from the workspace context. */
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
  handleClearActivityLog: () => void;
} {
  const { activityLog, setActivityLog } = useWorkspace();

  // ★ FUNCTIONAL setters, always: two appends in one tick must both survive,
  // and each must produce a NEW array — the save effect's dirty check is
  // reference equality, so an in-place push would silently skip the write.
  const logActivity = useCallback(
    (kind: ActivityKind, ...args: (string | number)[]) => {
      setActivityLog((prev) => appendActivity(prev, kind, ...args));
    },
    [setActivityLog],
  );

  // UPDATE-event variant carrying a per-field diff (#22). Separate from
  // logActivity because the shared `(kind, ...args)` signature can't take a
  // trailing options arg after a rest param.
  const logActivityChanges = useCallback(
    (kind: ActivityKind, changes: readonly FieldChange[], ...args: (string | number)[]) => {
      setActivityLog((prev) => appendActivityEntry(prev, kind, args, changes));
    },
    [setActivityLog],
  );

  const handleClearActivityLog = useCallback(() => {
    // The Clear button (activity-log-panel) is the sole caller; it already
    // gates on entries.length > 0 and shows the branded confirm dialog. This
    // just performs the wipe. (Keeping the confirm here would be dead: the
    // hook runs above ConfirmProvider in the tree, so useConfirm would resolve
    // to the no-op default.)
    setActivityLog([]);
  }, [setActivityLog]);

  return { activityLog, logActivity, logActivityChanges, handleClearActivityLog };
}
