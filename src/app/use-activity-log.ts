"use client";

import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import {
  appendActivity,
  type ActivityEntry,
  type ActivityKind,
  clearActivityLog as clearActivityLogStorage,
  loadActivityLog,
  saveActivityLog,
} from "./activity-log";
import { type Lang, t } from "./i18n";
import { useConfirm } from "./confirm-dialog";

export interface UseActivityLogArgs {
  lang: Lang;
}

export function useActivityLog({ lang }: UseActivityLogArgs): {
  activityLog: ActivityEntry[];
  setActivityLog: Dispatch<SetStateAction<ActivityEntry[]>>;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  handleClearActivityLog: () => void;
} {
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const activityLogHydratedRef = useRef(false);
  const confirm = useConfirm();

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

  const handleClearActivityLog = useCallback(async () => {
    if (activityLog.length === 0) return;
    if (
      !(await confirm({
        message: t(lang, "confirmClearActivityLog", activityLog.length),
      }))
    )
      return;
    setActivityLog([]);
    clearActivityLogStorage();
  }, [activityLog.length, lang, confirm]);

  return { activityLog, setActivityLog, logActivity, handleClearActivityLog };
}
