// src/app/app-tour.ts — pure, i18n-free guided-tour engine (keys only; no React/Date).
import type { TranslationKey } from "./i18n";
import type { AppView } from "./nav-config";
import { isViewEnabled } from "./feature-modules";
import type { FeatureModuleId } from "./feature-modules";

export type TourStepKind = "modal" | "spotlight";

export interface TourStep {
  id: string;
  kind: TourStepKind;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  view?: AppView;
  anchorId?: string;
}

/** A themed tour: a named, described, ordered list of steps. */
export interface TourDefinition {
  id: string;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  iconView: AppView;
  steps: readonly TourStep[];
}

/** The catalog projection the Help-view picker renders (no steps). */
export interface TourCatalogEntry {
  id: string;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  stepCount: number;
  iconView: AppView;
}

export const TOUR_ANCHORS = {
  navTasks: "tour-nav-tasks",
  navActions: "tour-nav-actions",
  askClaude: "tour-ask-claude",
  projectSwitcher: "tour-project-switcher",
} as const;

// The original onboarding walkthrough — now the "getting-started" tour's steps.
export const TOUR_STEPS: readonly TourStep[] = [
  { id: "welcome", kind: "modal", titleKey: "tourStepWelcomeTitle", bodyKey: "tourStepWelcomeBody" },
  { id: "projects", kind: "spotlight", titleKey: "tourStepProjectsTitle", bodyKey: "tourStepProjectsBody", view: "projects", anchorId: TOUR_ANCHORS.projectSwitcher },
  { id: "tasks", kind: "spotlight", titleKey: "tourStepTasksTitle", bodyKey: "tourStepTasksBody", view: "open-points", anchorId: TOUR_ANCHORS.navTasks },
  { id: "actions", kind: "spotlight", titleKey: "tourStepActionsTitle", bodyKey: "tourStepActionsBody", view: "actions", anchorId: TOUR_ANCHORS.navActions },
  { id: "chat", kind: "spotlight", titleKey: "tourStepChatTitle", bodyKey: "tourStepChatBody", view: "chat", anchorId: TOUR_ANCHORS.askClaude },
  { id: "dashboard", kind: "modal", titleKey: "tourStepDashboardTitle", bodyKey: "tourStepDashboardBody", view: "dashboard" },
  { id: "reports", kind: "modal", titleKey: "tourStepReportsTitle", bodyKey: "tourStepReportsBody", view: "reports" },
  { id: "raid", kind: "modal", titleKey: "tourStepRaidTitle", bodyKey: "tourStepRaidBody", view: "raid" },
  { id: "milestones", kind: "modal", titleKey: "tourStepMilestonesTitle", bodyKey: "tourStepMilestonesBody", view: "milestones" },
  { id: "stakeholders", kind: "modal", titleKey: "tourStepStakeholdersTitle", bodyKey: "tourStepStakeholdersBody", view: "stakeholders" },
  { id: "steering", kind: "modal", titleKey: "tourStepSteeringTitle", bodyKey: "tourStepSteeringBody", view: "steering-committee" },
  { id: "settings", kind: "modal", titleKey: "tourStepSettingsTitle", bodyKey: "tourStepSettingsBody", view: "settings" },
];

const RAID_STEPS: readonly TourStep[] = [
  { id: "raid-overview", kind: "modal", titleKey: "tourStepRaidOverviewTitle", bodyKey: "tourStepRaidOverviewBody", view: "raid" },
  { id: "raid-matrix", kind: "modal", titleKey: "tourStepRaidMatrixTitle", bodyKey: "tourStepRaidMatrixBody", view: "raid" },
  { id: "raid-review", kind: "modal", titleKey: "tourStepRaidReviewTitle", bodyKey: "tourStepRaidReviewBody", view: "raid" },
];

const REPORTING_STEPS: readonly TourStep[] = [
  { id: "report-dashboard", kind: "modal", titleKey: "tourStepReportDashboardTitle", bodyKey: "tourStepReportDashboardBody", view: "dashboard" },
  { id: "report-reports", kind: "modal", titleKey: "tourStepReportReportsTitle", bodyKey: "tourStepReportReportsBody", view: "reports" },
  { id: "report-evm", kind: "modal", titleKey: "tourStepReportEvmTitle", bodyKey: "tourStepReportEvmBody", view: "reports" },
];

const PLANNING_STEPS: readonly TourStep[] = [
  { id: "plan-milestones", kind: "modal", titleKey: "tourStepPlanMilestonesTitle", bodyKey: "tourStepPlanMilestonesBody", view: "milestones" },
  { id: "plan-gantt", kind: "modal", titleKey: "tourStepPlanGanttTitle", bodyKey: "tourStepPlanGanttBody", view: "milestones" },
  { id: "plan-critical", kind: "modal", titleKey: "tourStepPlanCriticalTitle", bodyKey: "tourStepPlanCriticalBody", view: "milestones" },
];

const STAKEHOLDER_STEPS: readonly TourStep[] = [
  { id: "stake-register", kind: "modal", titleKey: "tourStepStakeRegisterTitle", bodyKey: "tourStepStakeRegisterBody", view: "stakeholders" },
  { id: "stake-raci", kind: "modal", titleKey: "tourStepStakeRaciTitle", bodyKey: "tourStepStakeRaciBody", view: "stakeholders" },
  { id: "stake-comms", kind: "modal", titleKey: "tourStepStakeCommsTitle", bodyKey: "tourStepStakeCommsBody", view: "stakeholders" },
];

const AI_STEPS: readonly TourStep[] = [
  { id: "ai-chat", kind: "modal", titleKey: "tourStepAiChatTitle", bodyKey: "tourStepAiChatBody", view: "chat" },
  { id: "ai-actions", kind: "modal", titleKey: "tourStepAiActionsTitle", bodyKey: "tourStepAiActionsBody", view: "actions" },
  { id: "ai-settings", kind: "modal", titleKey: "tourStepAiSettingsTitle", bodyKey: "tourStepAiSettingsBody", view: "settings" },
];

export const TOURS: readonly TourDefinition[] = [
  { id: "getting-started", titleKey: "tourGettingStartedTitle", descKey: "tourGettingStartedDesc", iconView: "dashboard", steps: TOUR_STEPS },
  { id: "raid", titleKey: "tourRaidTitle", descKey: "tourRaidDesc", iconView: "raid", steps: RAID_STEPS },
  { id: "reporting", titleKey: "tourReportingTitle", descKey: "tourReportingDesc", iconView: "reports", steps: REPORTING_STEPS },
  { id: "planning", titleKey: "tourPlanningTitle", descKey: "tourPlanningDesc", iconView: "milestones", steps: PLANNING_STEPS },
  { id: "stakeholders", titleKey: "tourStakeholdersTitle", descKey: "tourStakeholdersDesc", iconView: "stakeholders", steps: STAKEHOLDER_STEPS },
  { id: "ai", titleKey: "tourAiTitle", descKey: "tourAiDesc", iconView: "chat", steps: AI_STEPS },
];

export function findTour(id: string): TourDefinition | undefined {
  return TOURS.find((t) => t.id === id);
}

/** Drop steps whose deep-link view belongs to a disabled feature module, so a
 *  tour never navigates to a hidden view. Steps without a `view` always survive. */
export function visibleSteps(steps: readonly TourStep[], features: readonly FeatureModuleId[]): TourStep[] {
  return steps.filter((s) => s.view === undefined || isViewEnabled(s.view, features));
}

/** Bound an index to [0, total-1]; returns 0 for an empty list. */
export function clampStep(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(index, total - 1));
}
