// src/app/next-actions-input.ts
//
// Pure assembler: gathers the live workspace/dashboard/comms data into the
// ActionInput the next-actions engine consumes. Kept out of task-manager so it
// is unit-testable. No side effects.
import type { ActionInput } from "./next-actions/types";
import type { DashboardModel } from "./dashboard";
import type { StakeholderCommsReminder } from "./stakeholder-comms";
import type { FeatureModuleId } from "./feature-modules";
import type { WorkloadAlert } from "./next-actions-workload";
import type { Task, RaidItem, ChangeItem, Milestone, Stakeholder, SteeringCommittee } from "./types";

export interface BuildActionInputArgs {
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  changes: readonly ChangeItem[];
  milestones: readonly Milestone[];
  stakeholders: readonly Stakeholder[];
  steeringCommittee?: SteeringCommittee;
  dashboard: DashboardModel;
  commsReminders: readonly StakeholderCommsReminder[];
  features: readonly FeatureModuleId[];
  projectName: string;
  today: string;
  now: Date;
  reminderLeadDays: number;
  dueSoonWorkdays: number;
  raidReviewIntervalDays: number;
  scopePendingRed?: number;
  scheduleSpiWarn?: number;
  scheduleSpiCritical?: number;
  workloadAllocatedCritical?: number;
  workloadOverdueUrgent?: number;
  workloadAlerts?: readonly WorkloadAlert[];
  taskDueEnabled?: boolean;            // default true
  raidReviewEnabled?: boolean;         // default true
  trends?: import("./next-actions/trends").ActionTrends;
  clarityBonus?: number;
  semiClarityBonus?: number;
  staticPenalty?: number;
  dismissed?: ReadonlySet<string>;
  /** Learned per-kind bias (`${source}:${why.key}` -> points). Off when undefined/empty. */
  learnedBias?: Record<string, number>;
}

export function buildActionInput(a: BuildActionInputArgs): ActionInput {
  return {
    tasks: a.tasks,
    raid: a.raid,
    changes: a.changes,
    milestones: a.milestones,
    stakeholders: a.stakeholders,
    steeringCommittee: a.steeringCommittee,
    dashboard: a.dashboard,
    commsReminders: a.commsReminders,
    features: a.features,
    projectName: a.projectName,
    today: a.today,
    now: a.now,
    reminderLeadDays: a.reminderLeadDays,
    dueSoonWorkdays: a.dueSoonWorkdays,
    raidReviewIntervalDays: a.raidReviewIntervalDays,
    scopePendingRed: a.scopePendingRed,
    scheduleSpiWarn: a.scheduleSpiWarn,
    scheduleSpiCritical: a.scheduleSpiCritical,
    workloadAllocatedCritical: a.workloadAllocatedCritical,
    workloadOverdueUrgent: a.workloadOverdueUrgent,
    workloadAlerts: a.workloadAlerts ?? [],
    taskDueEnabled: a.taskDueEnabled ?? true,
    raidReviewEnabled: a.raidReviewEnabled ?? true,
    trends: a.trends,
    clarityBonus: a.clarityBonus,
    semiClarityBonus: a.semiClarityBonus,
    staticPenalty: a.staticPenalty,
    dismissed: a.dismissed ?? new Set<string>(),
    learnedBias: a.learnedBias,
  };
}
