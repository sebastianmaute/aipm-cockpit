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
import { dueAlertsToastText, raidReviewToastText } from "./notifications";
import { effectiveLeadDays } from "./notifications-lead";
import { getRaidReviewItems } from "./raid-review";
import { getSnoozedUntil } from "./reminder-snooze";
import type { Settings } from "./settings-types";
import type { Task, Absence, RaidItem } from "./types";

export interface UseDueAlertsArgs {
  hydrated: boolean;
  tasks: Task[];
  holidaySet: Set<string>;
  absences: Absence[];
  raid: RaidItem[];
  settings: Settings;
  today: string;
  showToast: (kind: "info" | "error", text: string) => void;
  raidEnabled: boolean;
}

export function useDueAlerts({
  hydrated,
  tasks,
  holidaySet,
  absences,
  raid,
  settings,
  today,
  showToast,
  raidEnabled,
}: UseDueAlertsArgs): {
  bannerDismissed: boolean;
  setBannerDismissed: Dispatch<SetStateAction<boolean>>;
  dueModalOpen: boolean;
  setDueModalOpen: Dispatch<SetStateAction<boolean>>;
  raidReviewModalOpen: boolean;
  setRaidReviewModalOpen: Dispatch<SetStateAction<boolean>>;
} {
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [dueModalOpen, setDueModalOpen] = useState(false);
  const [raidReviewModalOpen, setRaidReviewModalOpen] = useState(false);
  const notifiedThisSessionRef = useRef(false);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const todayRef = useRef(today);
  useEffect(() => {
    todayRef.current = today;
  }, [today]);

  // holidaySet + absences load asynchronously; read via refs so the once-per-
  // session toast uses the latest values (matches the reactive banner).
  const holidaySetRef = useRef(holidaySet);
  useEffect(() => {
    holidaySetRef.current = holidaySet;
  }, [holidaySet]);
  const absencesRef = useRef(absences);
  useEffect(() => {
    absencesRef.current = absences;
  }, [absences]);
  const raidRef = useRef(raid);
  useEffect(() => {
    raidRef.current = raid;
  }, [raid]);

  useEffect(() => {
    if (!hydrated || notifiedThisSessionRef.current) return;
    if (tasks.length === 0 && raid.length === 0) return;
    notifiedThisSessionRef.current = true;

    const u = getSnoozedUntil("due");
    const snoozed = u != null && Date.now() < u;

    const { toast: toastCfg, popup: popupCfg } =
      settingsRef.current.notifications;

    const notifCfgRef = settingsRef.current.notifications;
    const toastItems = toastCfg.enabled && !snoozed
      ? getAlertableTasks(
          tasks,
          effectiveLeadDays(notifCfgRef, "toast"),
          todayRef.current,
          holidaySetRef.current,
          absencesRef.current,
        )
      : [];

    const popupItems = popupCfg.enabled && !snoozed
      ? getAlertableTasks(
          tasks,
          effectiveLeadDays(notifCfgRef, "popup"),
          todayRef.current,
          holidaySetRef.current,
          absencesRef.current,
        )
      : [];

    const currentLanguage = settingsRef.current.language;
    void Promise.resolve().then(() => {
      if (toastItems.length > 0)
        showToast("info", dueAlertsToastText(toastItems, currentLanguage));
      if (popupItems.length > 0) setDueModalOpen(true);
    });

    const rrSnoozeUntil = getSnoozedUntil("raidReview");
    const rrSnoozed = rrSnoozeUntil != null && Date.now() < rrSnoozeUntil;
    const notifCfg = settingsRef.current.notifications;
    const reviewItems = raidEnabled && notifCfg.raidReview.enabled && !rrSnoozed
      ? getRaidReviewItems(raidRef.current, todayRef.current, notifCfg.raidReviewIntervalDays)
      : [];
    void Promise.resolve().then(() => {
      if (reviewItems.length > 0 && notifCfg.toast.enabled) {
        showToast("info", raidReviewToastText(reviewItems, currentLanguage));
      }
      if (reviewItems.length > 0 && notifCfg.popup.enabled) setRaidReviewModalOpen(true);
    });
  }, [hydrated, tasks, raid, showToast, raidEnabled]);

  return {
    bannerDismissed,
    setBannerDismissed,
    dueModalOpen,
    setDueModalOpen,
    raidReviewModalOpen,
    setRaidReviewModalOpen,
  };
}
