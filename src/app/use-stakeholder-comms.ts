// src/app/use-stakeholder-comms.ts
"use client";
import {
  type CommsFlags,
  type StakeholderCommsReminder,
  getStakeholderCommsItems,
} from "./stakeholder-comms";
import type { Settings } from "./settings-types";
import type { ChangeItem, Milestone, RaidItem, Stakeholder } from "./types";

export interface UseStakeholderCommsArgs {
  today: string;
  stakeholders: readonly Stakeholder[];
  milestones: readonly Milestone[];
  raid: readonly RaidItem[];
  changes: readonly ChangeItem[];
  settings: Settings;
  flags: CommsFlags;
}

/**
 * Computes the reactive stakeholder-comms reminder items. The banner/modal/toast
 * surfaces were removed once these reminders moved into the Action Center; the
 * items still feed `buildActionInput` (via `commsReminders`).
 */
export function useStakeholderComms({
  today,
  stakeholders,
  milestones,
  raid,
  changes,
  settings,
  flags,
}: UseStakeholderCommsArgs): { items: StakeholderCommsReminder[] } {
  const items =
    flags.stakeholdersEnabled && settings.notifications.stakeholderComms.enabled
      ? getStakeholderCommsItems({
          stakeholders, milestones, raid, changes, today, flags,
          leadDaysByQuadrant: settings.notifications.stakeholderCommsLeadDays,
        })
      : [];

  return { items };
}
