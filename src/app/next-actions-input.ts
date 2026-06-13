// src/app/next-actions-input.ts
//
// Pure assembler: gathers the live workspace/dashboard/comms data into the
// ActionInput the next-actions engine consumes. Kept out of task-manager so it
// is unit-testable. No side effects.
import type { ActionInput } from "./next-actions/types";
import type { DashboardModel } from "./dashboard";
import type { StakeholderCommsReminder } from "./stakeholder-comms";
import type { FeatureModuleId } from "./feature-modules";
import type { Task, RaidItem, ChangeItem, Milestone, Stakeholder } from "./types";

export interface BuildActionInputArgs {
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  changes: readonly ChangeItem[];
  milestones: readonly Milestone[];
  stakeholders: readonly Stakeholder[];
  dashboard: DashboardModel;
  commsReminders: readonly StakeholderCommsReminder[];
  features: readonly FeatureModuleId[];
  projectName: string;
  today: string;
  now: Date;
  reminderLeadDays: number;
  dueSoonWorkdays: number;
  raidReviewIntervalDays: number;
  dismissed?: ReadonlySet<string>;
}

export function buildActionInput(a: BuildActionInputArgs): ActionInput {
  return {
    tasks: a.tasks,
    raid: a.raid,
    changes: a.changes,
    milestones: a.milestones,
    stakeholders: a.stakeholders,
    dashboard: a.dashboard,
    commsReminders: a.commsReminders,
    features: a.features,
    projectName: a.projectName,
    today: a.today,
    now: a.now,
    reminderLeadDays: a.reminderLeadDays,
    dueSoonWorkdays: a.dueSoonWorkdays,
    raidReviewIntervalDays: a.raidReviewIntervalDays,
    dismissed: a.dismissed ?? new Set<string>(),
  };
}
