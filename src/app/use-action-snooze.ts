// src/app/use-action-snooze.ts
"use client";
import { useCallback, useEffect, useState } from "react";
import { getSnoozedActionIds, snoozeAction, nextSnoozeExpiry } from "./action-snooze";

export interface UseActionSnooze {
  dismissed: ReadonlySet<string>;
  snooze: (actionId: string, durationMs: number) => void;
}

function readDismissed(): ReadonlySet<string> {
  return getSnoozedActionIds(Date.now());
}

export function useActionSnooze(): UseActionSnooze {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(readDismissed);

  const refresh = useCallback(() => {
    setDismissed(readDismissed());
  }, []);

  const snooze = useCallback((actionId: string, durationMs: number) => {
    snoozeAction(actionId, durationMs, Date.now());
    refresh();
  }, [refresh]);

  // Re-arm a timer each time dismissed changes so the action reappears when the snooze expires.
  useEffect(() => {
    const next = nextSnoozeExpiry(Date.now());
    if (next == null) return;
    const delay = Math.max(0, next - Date.now()) + 50;
    const timer = setTimeout(refresh, delay);
    return () => clearTimeout(timer);
  }, [dismissed, refresh]);

  return { dismissed, snooze };
}
