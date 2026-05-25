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

  // `getSnoozedUntil` only ever returns a future timestamp (it clears elapsed
  // snoozes) and `snooze` always stores a future one, so state holds either
  // null or a future epoch. Schedule a one-shot timer to re-show the reminder
  // when it elapses, without needing a reload.
  useEffect(() => {
    if (snoozedUntil == null) return;
    const remaining = Math.max(0, snoozedUntil - Date.now());
    const timer = setTimeout(() => {
      clearSnooze(kind);
      setSnoozedUntilState(null);
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

  const isSnoozed = snoozedUntil != null;
  return { isSnoozed, snoozedUntil, snooze, clear };
}
