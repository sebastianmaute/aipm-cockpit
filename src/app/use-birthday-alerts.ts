"use client";
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { getUpcomingBirthdays } from "./birthdays";
import { birthdayToastText } from "./notifications";
import { effectiveLeadDays } from "./notifications-lead";
import { getSnoozedUntil } from "./reminder-snooze";
import type { Settings } from "./settings-menu";
import type { Resource, Absence } from "./types";

export interface UseBirthdayAlertsArgs {
  hydrated: boolean;
  resources: Resource[];
  today: string;
  settings: Settings;
  holidaySet: Set<string>;
  absences: Absence[];
  showToast: (kind: "info" | "error", text: string) => void;
}

export function useBirthdayAlerts({
  hydrated, resources, today, settings, holidaySet, absences, showToast,
}: UseBirthdayAlertsArgs): {
  birthdayDismissed: boolean;
  setBirthdayDismissed: Dispatch<SetStateAction<boolean>>;
} {
  const [birthdayDismissed, setBirthdayDismissed] = useState(false);
  const notifiedThisSessionRef = useRef(false);
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  const todayRef = useRef(today);
  useEffect(() => { todayRef.current = today; }, [today]);
  // holidaySet + absences load asynchronously (holiday lib / workspace load),
  // often AFTER this once-per-session effect would otherwise fire. Read them
  // via refs so the toast's working-day shift uses the latest values and
  // matches the (reactive) banner instead of an empty mount-time set.
  const holidaySetRef = useRef(holidaySet);
  useEffect(() => { holidaySetRef.current = holidaySet; }, [holidaySet]);
  const absencesRef = useRef(absences);
  useEffect(() => { absencesRef.current = absences; }, [absences]);

  useEffect(() => {
    if (!hydrated || notifiedThisSessionRef.current) return;
    if (resources.length === 0) return;
    const cfg = settingsRef.current.notifications.birthday;
    if (!cfg.enabled) return;
    const u = getSnoozedUntil("birthday");
    if (u != null && Date.now() < u) { notifiedThisSessionRef.current = true; return; }
    notifiedThisSessionRef.current = true;
    const items = getUpcomingBirthdays(resources, todayRef.current, effectiveLeadDays(settingsRef.current.notifications, "birthday"), holidaySetRef.current, absencesRef.current);
    const lang = settingsRef.current.language;
    void Promise.resolve().then(() => {
      if (items.length > 0) showToast("info", birthdayToastText(items, lang));
    });
  }, [hydrated, resources, showToast]);

  return { birthdayDismissed, setBirthdayDismissed };
}
