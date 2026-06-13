// src/app/next-actions/types.ts
import type { Lang, TranslationKey } from "../i18n";
import type { AppView } from "../nav-config";
import type { FeatureModuleId } from "../feature-modules";
import type { Task, RaidItem, ChangeItem, Milestone, Stakeholder } from "../types";
import type { DashboardModel } from "../dashboard";
import type { StakeholderCommsReminder } from "../stakeholder-comms";

export type ActionTier = "now" | "soon" | "monitor";
export type ActionSource =
  | "task-due" | "raid" | "change-pending" | "milestone" | "budget" | "stakeholder-comms";

/** Translated by the surface (SP2); the engine stays i18n-free. */
export interface I18nText {
  key: TranslationKey;
  params?: (string | number)[];
}

/** A serializable description of the primary action — the surface executes it. */
export type ActionCta =
  | { kind: "open"; view: AppView; id: string | number } // deep-link to the entity
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
  dismissed: ReadonlySet<string>;     // snoozed/dismissed action ids (injected; SP3 wires the store)
}

export interface ActionProvider {
  moduleId?: FeatureModuleId;         // skipped if set and the module is disabled
  provide(input: ActionInput): SuggestedAction[];
}

export type { Lang };
