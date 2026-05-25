"use client";
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { getUpcomingBirthdays } from "./birthdays";
import { birthdayToastText } from "./notifications";
import type { Settings } from "./settings-menu";
import type { Resource } from "./types";

export interface UseBirthdayAlertsArgs {
  hydrated: boolean;
  resources: Resource[];
  today: string;
  settings: Settings;
  showToast: (kind: "info" | "error", text: string) => void;
}

export function useBirthdayAlerts({
  hydrated, resources, today, settings, showToast,
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

  useEffect(() => {
    if (!hydrated || notifiedThisSessionRef.current) return;
    if (resources.length === 0) return;
    const cfg = settingsRef.current.notifications.birthday;
    if (!cfg.enabled) return;
    notifiedThisSessionRef.current = true;
    const items = getUpcomingBirthdays(resources, todayRef.current, cfg.leadDays);
    const lang = settingsRef.current.language;
    void Promise.resolve().then(() => {
      if (items.length > 0) showToast("info", birthdayToastText(items, lang));
    });
  }, [hydrated, resources, showToast]);

  return { birthdayDismissed, setBirthdayDismissed };
}
