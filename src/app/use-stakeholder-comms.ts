// src/app/use-stakeholder-comms.ts
"use client";
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { stakeholderCommsToastText } from "./notifications";
import { getSnoozedUntil } from "./reminder-snooze";
import {
  type CommsFlags,
  type StakeholderCommsReminder,
  getStakeholderCommsItems,
} from "./stakeholder-comms";
import type { Settings } from "./settings-menu";
import type { ChangeItem, Milestone, RaidItem, Stakeholder } from "./types";

export interface UseStakeholderCommsArgs {
  hydrated: boolean;
  today: string;
  showToast: (kind: "info" | "error", text: string) => void;
  stakeholders: Stakeholder[];
  milestones: Milestone[];
  raid: RaidItem[];
  changes: ChangeItem[];
  settings: Settings;
  flags: CommsFlags;
}

export function useStakeholderComms({
  hydrated,
  today,
  showToast,
  stakeholders,
  milestones,
  raid,
  changes,
  settings,
  flags,
}: UseStakeholderCommsArgs): {
  items: StakeholderCommsReminder[];
  bannerDismissed: boolean;
  setBannerDismissed: Dispatch<SetStateAction<boolean>>;
  reviewModalOpen: boolean;
  setReviewModalOpen: Dispatch<SetStateAction<boolean>>;
} {
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const notifiedThisSessionRef = useRef(false);

  // Source data + settings load asynchronously; read via refs so the once-per-
  // session toast uses the latest values (matches the reactive banner).
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const todayRef = useRef(today);
  useEffect(() => {
    todayRef.current = today;
  }, [today]);
  const stakeholdersRef = useRef(stakeholders);
  useEffect(() => {
    stakeholdersRef.current = stakeholders;
  }, [stakeholders]);
  const milestonesRef = useRef(milestones);
  useEffect(() => {
    milestonesRef.current = milestones;
  }, [milestones]);
  const raidRef = useRef(raid);
  useEffect(() => {
    raidRef.current = raid;
  }, [raid]);
  const changesRef = useRef(changes);
  useEffect(() => {
    changesRef.current = changes;
  }, [changes]);
  const flagsRef = useRef(flags);
  useEffect(() => {
    flagsRef.current = flags;
  }, [flags]);

  // Reactive items for the banner/modal surfaces (always reflect current data).
  const items =
    flags.stakeholdersEnabled && settings.notifications.stakeholderComms.enabled
      ? getStakeholderCommsItems({
          stakeholders, milestones, raid, changes, today, flags,
          leadDaysByQuadrant: settings.notifications.stakeholderCommsLeadDays,
        })
      : [];

  useEffect(() => {
    if (!hydrated || notifiedThisSessionRef.current) return;
    if (stakeholders.length === 0) return;
    notifiedThisSessionRef.current = true;

    const until = getSnoozedUntil("stakeholderComms");
    const snoozed = until != null && Date.now() < until;

    const cfg = settingsRef.current.notifications;
    const currentLanguage = settingsRef.current.language;
    const toastItems =
      cfg.stakeholderComms.enabled && cfg.toast.enabled && !snoozed
        ? getStakeholderCommsItems({
            stakeholders: stakeholdersRef.current,
            milestones: milestonesRef.current,
            raid: raidRef.current,
            changes: changesRef.current,
            today: todayRef.current,
            flags: flagsRef.current,
            leadDaysByQuadrant: settingsRef.current.notifications.stakeholderCommsLeadDays,
          })
        : [];

    void Promise.resolve().then(() => {
      if (toastItems.length > 0) {
        showToast("info", stakeholderCommsToastText(toastItems, currentLanguage));
      }
    });
  }, [hydrated, stakeholders, milestones, raid, changes, showToast]);

  return {
    items,
    bannerDismissed,
    setBannerDismissed,
    reviewModalOpen,
    setReviewModalOpen,
  };
}
