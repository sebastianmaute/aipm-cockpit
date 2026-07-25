// src/app/next-actions/types.ts
import type { Lang, TranslationKey } from "../i18n";
import type { AppView } from "../nav-config";
import type { FeatureModuleId } from "../feature-modules";
import type { Task, RaidItem, ChangeItem, Milestone, Stakeholder, SteeringCommittee } from "../types";
import type { DashboardModel } from "../dashboard";
import type { StakeholderCommsReminder } from "../stakeholder-comms";
import type { WorkloadAlert } from "../next-actions-workload";
import type { ActionTrends } from "./trends";

export type ActionTier = "now" | "soon" | "monitor";
export type ActionSource =
  | "task-due" | "raid" | "change-pending" | "milestone" | "budget" | "stakeholder-comms"
  | "schedule" | "workload" | "committee" | "task-attention";

/** Translated by the surface (SP2); the engine stays i18n-free. */
export interface I18nText {
  key: TranslationKey;
  params?: (string | number)[];
}

/** A serializable description of the primary action — the surface executes it. */
export type ActionCta =
  | { kind: "open"; view: AppView; id: string | number } // deep-link to the entity
  // Open the task list filtered to one person's at-risk work. Deliberately NOT
  // an `open` arm with a sentinel id: `onPoints(a)` would then be true and would
  // attach the task-specific verbs (mark-done / reschedule / clear-blocker),
  // which all do Number(cta.id) and have no task to act on here.
  | { kind: "open-tasks-for"; resourceId: number; resourceName: string }
  | { kind: "snooze"; actionId: string };

export interface SuggestedAction {
  id: string;                  // stable: `${source}:${entityId}:${reason}`
  source: ActionSource;
  moduleId?: FeatureModuleId;  // undefined = always-on (core)
  title: I18nText;
  why: I18nText;
  score: number;
  tier: ActionTier;
  cta: ActionCta;
  learning?: { bias: number; moved: "up" | "down" };
}

/** Read-only slice the providers consume. The surface (SP2) builds this. */
export interface ActionInput {
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  changes: readonly ChangeItem[];
  milestones: readonly Milestone[];
  stakeholders: readonly Stakeholder[];
  commsReminders: readonly StakeholderCommsReminder[];
  dashboard: DashboardModel;          // existing computed model — reused, not recomputed
  features: readonly FeatureModuleId[];
  today: string;                      // ISO yyyy-mm-dd
  projectName: string;                // display name of the current project
  now: Date;
  reminderLeadDays: number;
  dueSoonWorkdays: number;
  raidReviewIntervalDays: number;
  // Optional signal-firing threshold overrides (Settings → Next actions). Each
  // provider falls back to its hard-coded default when the field is undefined,
  // so existing callers/tests need not supply them.
  scopePendingRed?: number;
  scheduleSpiWarn?: number;
  scheduleSpiCritical?: number;
  workloadAllocatedCritical?: number;
  workloadOverdueUrgent?: number;
  taskDueEnabled?: boolean;           // Settings → Notifications "due reminders" toggle; false → no task-due actions (undefined = enabled)
  workloadAlerts?: readonly WorkloadAlert[];  // pre-computed by the surface via buildWorkloadAlerts; feeds the `workload` provider
  steeringCommittee?: SteeringCommittee;      // optional — feeds the `committee` info-pack reminder provider (undefined off the steering-committee module)
  raidReviewEnabled?: boolean;        // "RAID review reminder" toggle; false → no RAID review-due actions, severity actions stay (undefined = enabled)
  /** Aggregate-metric trend directions (Turso snapshots). Undefined off-Turso. */
  trends?: ActionTrends;
  /** Confidence weights (Settings -> Next actions). Provider falls back to const. */
  clarityBonus?: number;
  semiClarityBonus?: number;
  staticPenalty?: number;
  /** Learned per-kind bias (`${source}:${why.key}` -> points). Off when undefined. */
  learnedBias?: Record<string, number>;
  dismissed: ReadonlySet<string>;     // snoozed/dismissed action ids (injected; SP3 wires the store)
}

export interface ActionProvider {
  moduleId?: FeatureModuleId;         // skipped if set and the module is disabled
  provide(input: ActionInput): SuggestedAction[];
}

export type { Lang };
