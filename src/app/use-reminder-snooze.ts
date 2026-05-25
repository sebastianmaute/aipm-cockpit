"use client";
import { useCallback, useEffect, useState } from "react";
import {
  type ReminderKind,
  clearSnooze,
  getSnoozedUntil,
  setSnoozedUntil,
} from "./reminder-snooze";

export function useReminderSnooze(kind: ReminderKind): {
  isSnoozed: boolean;
  snoozedUntil: number | null;
  snooze: (durationMs: number) => void;
  clear: () => void;
} {
  const [snoozedUntil, setSnoozedUntilState] = useState<number | null>(() => getSnoozedUntil(kind));

  useEffect(() => {
    if (snoozedUntil == null) return;
    const remaining = snoozedUntil - Date.now();
    if (remaining <= 0) {
      setSnoozedUntilState(null);
      clearSnooze(kind);
      return;
    }
    const timer = setTimeout(() => {
      setSnoozedUntilState(null);
      clearSnooze(kind);
    }, remaining);
    return () => clearTimeout(timer);
  }, [snoozedUntil, kind]);

  const snooze = useCallback((durationMs: number) => {
    const until = Date.now() + durationMs;
    setSnoozedUntil(kind, until);
    setSnoozedUntilState(until);
  }, [kind]);

  const clear = useCallback(() => {
    clearSnooze(kind);
    setSnoozedUntilState(null);
  }, [kind]);

  const isSnoozed = snoozedUntil != null && Date.now() < snoozedUntil;
  return { isSnoozed, snoozedUntil, snooze, clear };
}
