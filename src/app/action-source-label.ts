import type { TranslationKey } from "./i18n";
import type { ActionSource } from "./next-actions/types";

/** Source -> short i18n label, shared by ActionRow (the chip) and the task-seed
 *  builder (the "From:" note). */
export const ACTION_SOURCE_LABEL: Record<ActionSource, TranslationKey> = {
  "task-due": "actionSourceTask",
  raid: "actionSourceRaid",
  "change-pending": "actionSourceChange",
  milestone: "actionSourceMilestone",
  budget: "actionSourceBudget",
  "stakeholder-comms": "actionSourceComms",
  schedule: "actionSourceSchedule",
  workload: "actionSourceWorkload",
  committee: "actionSourceCommittee",
};
