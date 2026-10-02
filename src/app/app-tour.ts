// src/app/app-tour.ts — pure, i18n-free guided-tour engine (keys only; no React/Date).
import type { TranslationKey } from "./i18n";
import { isViewReachable, type AppView } from "./nav-config";
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
  undo: "tour-undo",
  globalSearch: "tour-global-search",
  tasksViewMode: "tour-tasks-view-mode",
  selectAll: "tour-select-all",
  savedViews: "tour-saved-views",
  navResources: "tour-nav-resources",
  navBudget: "tour-nav-budget",
  navChanges: "tour-nav-changes",
  navDocuments: "tour-nav-documents",
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
  { id: "more-tours", kind: "modal", titleKey: "tourStepMoreToursTitle", bodyKey: "tourStepMoreToursBody", view: "help" },
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
  { id: "report-insights", kind: "modal", titleKey: "tourStepReportInsightsTitle", bodyKey: "tourStepReportInsightsBody", view: "insights" },
  { id: "report-learning", kind: "modal", titleKey: "tourStepReportLearningTitle", bodyKey: "tourStepReportLearningBody", view: "learning-insights" },
  { id: "report-activity", kind: "modal", titleKey: "tourStepReportActivityTitle", bodyKey: "tourStepReportActivityBody", view: "activity" },
  { id: "report-trends", kind: "modal", titleKey: "tourStepReportTrendsTitle", bodyKey: "tourStepReportTrendsBody", view: "trends" },
  { id: "report-history", kind: "modal", titleKey: "tourStepReportHistoryTitle", bodyKey: "tourStepReportHistoryBody", view: "history" },
];

const PLANNING_STEPS: readonly TourStep[] = [
  { id: "plan-milestones", kind: "modal", titleKey: "tourStepPlanMilestonesTitle", bodyKey: "tourStepPlanMilestonesBody", view: "milestones" },
  { id: "plan-gantt", kind: "modal", titleKey: "tourStepPlanGanttTitle", bodyKey: "tourStepPlanGanttBody", view: "gantt" },
  { id: "plan-gantt-view", kind: "modal", titleKey: "tourStepPlanGanttViewTitle", bodyKey: "tourStepPlanGanttViewBody", view: "gantt" },
  { id: "plan-critical", kind: "modal", titleKey: "tourStepPlanCriticalTitle", bodyKey: "tourStepPlanCriticalBody", view: "milestones" },
];

const STAKEHOLDER_STEPS: readonly TourStep[] = [
  { id: "stake-register", kind: "modal", titleKey: "tourStepStakeRegisterTitle", bodyKey: "tourStepStakeRegisterBody", view: "stakeholders" },
  { id: "stake-raci", kind: "modal", titleKey: "tourStepStakeRaciTitle", bodyKey: "tourStepStakeRaciBody", view: "stakeholders" },
  { id: "stake-raci-view", kind: "modal", titleKey: "tourStepStakeRaciViewTitle", bodyKey: "tourStepStakeRaciViewBody", view: "raci" },
  { id: "stake-map", kind: "modal", titleKey: "tourStepStakeMapTitle", bodyKey: "tourStepStakeMapBody", view: "stakeholder-map" },
  { id: "stake-comms", kind: "modal", titleKey: "tourStepStakeCommsTitle", bodyKey: "tourStepStakeCommsBody", view: "stakeholders" },
];

const RESOURCES_STEPS: readonly TourStep[] = [
  { id: "res-directory", kind: "spotlight", titleKey: "tourStepResDirectoryTitle", bodyKey: "tourStepResDirectoryBody", view: "directory", anchorId: TOUR_ANCHORS.navResources },
  { id: "res-workload", kind: "modal", titleKey: "tourStepResWorkloadTitle", bodyKey: "tourStepResWorkloadBody", view: "workload" },
  { id: "res-calendar", kind: "modal", titleKey: "tourStepResCalendarTitle", bodyKey: "tourStepResCalendarBody", view: "calendar" },
  { id: "res-planning", kind: "modal", titleKey: "tourStepResPlanningTitle", bodyKey: "tourStepResPlanningBody", view: "planning" },
  { id: "res-roles", kind: "modal", titleKey: "tourStepResRolesTitle", bodyKey: "tourStepResRolesBody", view: "manage-roles" },
];

const BUDGET_CHANGES_STEPS: readonly TourStep[] = [
  { id: "bud-plan", kind: "spotlight", titleKey: "tourStepBudPlanTitle", bodyKey: "tourStepBudPlanBody", view: "budget", anchorId: TOUR_ANCHORS.navBudget },
  { id: "bud-evm", kind: "modal", titleKey: "tourStepBudEvmTitle", bodyKey: "tourStepBudEvmBody", view: "budget-report" },
  { id: "chg-log", kind: "spotlight", titleKey: "tourStepChgLogTitle", bodyKey: "tourStepChgLogBody", view: "changes", anchorId: TOUR_ANCHORS.navChanges },
  { id: "chg-report", kind: "modal", titleKey: "tourStepChgReportTitle", bodyKey: "tourStepChgReportBody", view: "change-report" },
  { id: "chg-link", kind: "modal", titleKey: "tourStepChgLinkTitle", bodyKey: "tourStepChgLinkBody", view: "changes" },
];

const DOCUMENTS_STEPS: readonly TourStep[] = [
  { id: "doc-ai", kind: "spotlight", titleKey: "tourStepDocAiTitle", bodyKey: "tourStepDocAiBody", view: "documents", anchorId: TOUR_ANCHORS.navDocuments },
  { id: "doc-editor", kind: "modal", titleKey: "tourStepDocEditorTitle", bodyKey: "tourStepDocEditorBody", view: "documents" },
  { id: "doc-versions", kind: "modal", titleKey: "tourStepDocVersionsTitle", bodyKey: "tourStepDocVersionsBody", view: "documents" },
];

const WORKING_FASTER_STEPS: readonly TourStep[] = [
  { id: "wf-undo", kind: "spotlight", titleKey: "tourStepWfUndoTitle", bodyKey: "tourStepWfUndoBody", view: "open-points", anchorId: TOUR_ANCHORS.undo },
  { id: "wf-undo-limits", kind: "modal", titleKey: "tourStepWfUndoLimitsTitle", bodyKey: "tourStepWfUndoLimitsBody", view: "open-points" },
  { id: "wf-search", kind: "spotlight", titleKey: "tourStepWfSearchTitle", bodyKey: "tourStepWfSearchBody", view: "open-points", anchorId: TOUR_ANCHORS.globalSearch },
  { id: "wf-select", kind: "spotlight", titleKey: "tourStepWfSelectTitle", bodyKey: "tourStepWfSelectBody", view: "open-points", anchorId: TOUR_ANCHORS.selectAll },
  { id: "wf-bulk", kind: "modal", titleKey: "tourStepWfBulkTitle", bodyKey: "tourStepWfBulkBody", view: "open-points" },
  { id: "wf-inline", kind: "modal", titleKey: "tourStepWfInlineTitle", bodyKey: "tourStepWfInlineBody", view: "open-points" },
  { id: "wf-table", kind: "modal", titleKey: "tourStepWfTableTitle", bodyKey: "tourStepWfTableBody", view: "open-points" },
  { id: "wf-views", kind: "spotlight", titleKey: "tourStepWfViewsTitle", bodyKey: "tourStepWfViewsBody", view: "open-points", anchorId: TOUR_ANCHORS.savedViews },
  { id: "wf-board", kind: "spotlight", titleKey: "tourStepWfBoardTitle", bodyKey: "tourStepWfBoardBody", view: "open-points", anchorId: TOUR_ANCHORS.tasksViewMode },
  { id: "wf-logs", kind: "modal", titleKey: "tourStepWfLogsTitle", bodyKey: "tourStepWfLogsBody", view: "open-points" },
];

const HELP_YOURSELF_STEPS: readonly TourStep[] = [
  { id: "help-icon", kind: "modal", titleKey: "tourStepHelpIconTitle", bodyKey: "tourStepHelpIconBody", view: "open-points" },
  { id: "help-search", kind: "modal", titleKey: "tourStepHelpSearchTitle", bodyKey: "tourStepHelpSearchBody", view: "help" },
  { id: "help-escape", kind: "modal", titleKey: "tourStepHelpEscapeTitle", bodyKey: "tourStepHelpEscapeBody" },
  { id: "help-popout", kind: "modal", titleKey: "tourStepHelpPopoutTitle", bodyKey: "tourStepHelpPopoutBody" },
];

const AI_STEPS: readonly TourStep[] = [
  { id: "ai-chat", kind: "modal", titleKey: "tourStepAiChatTitle", bodyKey: "tourStepAiChatBody", view: "chat" },
  { id: "ai-inline", kind: "modal", titleKey: "tourStepAiInlineTitle", bodyKey: "tourStepAiInlineBody", view: "open-points" },
  { id: "ai-dictation", kind: "modal", titleKey: "tourStepAiDictationTitle", bodyKey: "tourStepAiDictationBody", view: "settings" },
  { id: "ai-actions", kind: "modal", titleKey: "tourStepAiActionsTitle", bodyKey: "tourStepAiActionsBody", view: "actions" },
  { id: "ai-settings", kind: "modal", titleKey: "tourStepAiSettingsTitle", bodyKey: "tourStepAiSettingsBody", view: "settings" },
];

export const TOURS: readonly TourDefinition[] = [
  { id: "getting-started", titleKey: "tourGettingStartedTitle", descKey: "tourGettingStartedDesc", iconView: "dashboard", steps: TOUR_STEPS },
  { id: "working-faster", titleKey: "tourWorkingFasterTitle", descKey: "tourWorkingFasterDesc", iconView: "open-points", steps: WORKING_FASTER_STEPS },
  { id: "raid", titleKey: "tourRaidTitle", descKey: "tourRaidDesc", iconView: "raid", steps: RAID_STEPS },
  { id: "reporting", titleKey: "tourReportingTitle", descKey: "tourReportingDesc", iconView: "reports", steps: REPORTING_STEPS },
  { id: "planning", titleKey: "tourPlanningTitle", descKey: "tourPlanningDesc", iconView: "milestones", steps: PLANNING_STEPS },
  { id: "stakeholders", titleKey: "tourStakeholdersTitle", descKey: "tourStakeholdersDesc", iconView: "stakeholders", steps: STAKEHOLDER_STEPS },
  { id: "resources", titleKey: "tourResourcesTitle", descKey: "tourResourcesDesc", iconView: "resources", steps: RESOURCES_STEPS },
  { id: "budget-changes", titleKey: "tourBudgetChangesTitle", descKey: "tourBudgetChangesDesc", iconView: "budget", steps: BUDGET_CHANGES_STEPS },
  { id: "documents", titleKey: "tourDocumentsTitle", descKey: "tourDocumentsDesc", iconView: "documents", steps: DOCUMENTS_STEPS },
  { id: "ai", titleKey: "tourAiTitle", descKey: "tourAiDesc", iconView: "chat", steps: AI_STEPS },
  { id: "help-yourself", titleKey: "tourHelpYourselfTitle", descKey: "tourHelpYourselfDesc", iconView: "help", steps: HELP_YOURSELF_STEPS },
];

export function findTour(id: string): TourDefinition | undefined {
  return TOURS.find((t) => t.id === id);
}

/** Drop steps whose deep-link view belongs to a disabled feature module, or is
 *  Turso-only on a non-Turso backend, so a tour never navigates to a hidden view.
 *  Steps without a `view` always survive. */
export function visibleSteps(
  steps: readonly TourStep[],
  features: readonly FeatureModuleId[],
  storageKind?: string,
): TourStep[] {
  return steps.filter((s) => s.view === undefined || isViewReachable(s.view, features, storageKind));
}

/** Bound an index to [0, total-1]; returns 0 for an empty list. */
export function clampStep(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(index, total - 1));
}
