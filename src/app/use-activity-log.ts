"use client";

import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import {
  appendActivity,
  appendActivityEntry,
  type ActivityEntry,
  type ActivityKind,
  type FieldChange,
  clearActivityLog as clearActivityLogStorage,
  loadActivityLog,
  saveActivityLog,
} from "./activity-log";
export function useActivityLog(): {
  activityLog: ActivityEntry[];
  setActivityLog: Dispatch<SetStateAction<ActivityEntry[]>>;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
  handleClearActivityLog: () => void;
} {
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const activityLogHydratedRef = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client-only hydration; lazy initializer would run during SSR
    setActivityLog(loadActivityLog());
    activityLogHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!activityLogHydratedRef.current) return;
    saveActivityLog(activityLog);
  }, [activityLog]);

  const logActivity = useCallback(
    (kind: ActivityKind, ...args: (string | number)[]) => {
      setActivityLog((prev) => appendActivity(prev, kind, ...args));
    },
    [],
  );

  // UPDATE-event variant carrying a per-field diff (#22). Separate from
  // logActivity because the shared `(kind, ...args)` signature can't take a
  // trailing options arg after a rest param.
  const logActivityChanges = useCallback(
    (kind: ActivityKind, changes: readonly FieldChange[], ...args: (string | number)[]) => {
      setActivityLog((prev) => appendActivityEntry(prev, kind, args, changes));
    },
    [],
  );

  const handleClearActivityLog = useCallback(() => {
    // The Clear button (activity-log-panel) is the sole caller; it already
    // gates on entries.length > 0 and shows the branded confirm dialog. This
    // just performs the wipe. (Keeping the confirm here would be dead: the
    // hook runs above ConfirmProvider in the tree, so useConfirm would resolve
    // to the no-op default.)
    setActivityLog([]);
    clearActivityLogStorage();
  }, []);

  return { activityLog, setActivityLog, logActivity, logActivityChanges, handleClearActivityLog };
}
