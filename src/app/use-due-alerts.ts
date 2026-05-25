// src/app/use-due-alerts.ts
"use client";
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { getAlertableTasks } from "./due-dates";
import { dueAlertsToastText } from "./notifications";
import type { Settings } from "./settings-menu";
import type { Task, Absence } from "./types";

export interface UseDueAlertsArgs {
  hydrated: boolean;
  tasks: Task[];
  holidaySet: Set<string>;
  absences: Absence[];
  settings: Settings;
  today: string;
  showToast: (kind: "info" | "error", text: string) => void;
}

export function useDueAlerts({
  hydrated,
  tasks,
  holidaySet,
  absences,
  settings,
  today,
  showToast,
}: UseDueAlertsArgs): {
  bannerDismissed: boolean;
  setBannerDismissed: Dispatch<SetStateAction<boolean>>;
  dueModalOpen: boolean;
  setDueModalOpen: Dispatch<SetStateAction<boolean>>;
} {
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [dueModalOpen, setDueModalOpen] = useState(false);
  const notifiedThisSessionRef = useRef(false);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const todayRef = useRef(today);
  useEffect(() => {
    todayRef.current = today;
  }, [today]);

  useEffect(() => {
    if (!hydrated || notifiedThisSessionRef.current) return;
    if (tasks.length === 0) return;
    notifiedThisSessionRef.current = true;

    const { toast: toastCfg, popup: popupCfg } =
      settingsRef.current.notifications;

    const toastItems = toastCfg.enabled
      ? getAlertableTasks(
          tasks,
          settingsRef.current.notifications.reminderLeadDays,
          todayRef.current,
          holidaySet,
          absences,
        )
      : [];

    const popupItems = popupCfg.enabled
      ? getAlertableTasks(
          tasks,
          settingsRef.current.notifications.reminderLeadDays,
          todayRef.current,
          holidaySet,
          absences,
        )
      : [];

    const currentLanguage = settingsRef.current.language;
    void Promise.resolve().then(() => {
      if (toastItems.length > 0)
        showToast("info", dueAlertsToastText(toastItems, currentLanguage));
      if (popupItems.length > 0) setDueModalOpen(true);
    });
  }, [hydrated, tasks, holidaySet, absences, showToast]);

  return { bannerDismissed, setBannerDismissed, dueModalOpen, setDueModalOpen };
}
