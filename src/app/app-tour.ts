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

export const TOUR_ANCHORS = {
  navTasks: "tour-nav-tasks",
  navActions: "tour-nav-actions",
  askClaude: "tour-ask-claude",
  projectSwitcher: "tour-project-switcher",
} as const;

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

/** Drop steps whose deep-link view belongs to a disabled feature module, so the
 *  tour never navigates to a hidden view. Steps without a `view` always survive. */
export function visibleSteps(features: readonly FeatureModuleId[]): TourStep[] {
  return TOUR_STEPS.filter((s) => s.view === undefined || isViewEnabled(s.view, features));
}

/** Bound an index to [0, total-1]; returns 0 for an empty list. */
export function clampStep(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(index, total - 1));
}
