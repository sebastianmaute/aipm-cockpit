// Pure, i18n-free coaching-CTA selector for the Dashboard's first-open
// "Get started" card. No React, no I/O. Returns translation keys + view ids;
// the card translates and wires navigation. Gated on a blank project so it
// self-hides (never nags) once work begins.

import type { TranslationKey } from "./i18n";
import type { AppView } from "./nav-config";

// Minimal string-union mirroring settings-view's SectionId. Declared locally
// (not imported) to keep this module pure/i18n-free — importing the React
// settings view would create a cycle. Keep in sync with settings-view SectionId.
export type SettingsSectionId = "ai" | "nextActions" | "general" | "jira" | "integrations" | "storage";

export type CoachingCta = {
  key: string;
  labelKey: TranslationKey;
  view: AppView;
  /** Optional sub-section to deep-link to once `view` is active (e.g. Settings → AI). */
  section?: SettingsSectionId;
};

export function computeCoaching(input: {
  taskCount: number;
  milestoneCount: number;
  budgetCount: number;
  showMilestones: boolean;
  showBudget: boolean;
  aiConfigured: boolean;
}): CoachingCta[] {
  if (input.taskCount > 0) return [];
  const ctas: CoachingCta[] = [];
  ctas.push({ key: "task", labelKey: "coachingAddTask", view: "open-points" });
  if (!input.aiConfigured) ctas.push({ key: "ai", labelKey: "coachingConfigureAi", view: "settings", section: "ai" });
  if (input.showMilestones && input.milestoneCount === 0) ctas.push({ key: "milestone", labelKey: "coachingAddMilestone", view: "milestones" });
  if (input.showBudget && input.budgetCount === 0) ctas.push({ key: "budget", labelKey: "coachingSetBudget", view: "budget" });
  return ctas;
}
