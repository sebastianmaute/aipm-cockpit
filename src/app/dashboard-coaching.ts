// Pure, i18n-free coaching-CTA selector for the Dashboard's first-open
// "Get started" card. No React, no I/O. Returns translation keys + view ids;
// the card translates and wires navigation. Gated on a blank project so it
// self-hides (never nags) once work begins.

import type { TranslationKey } from "./i18n";
import type { AppView } from "./nav-config";

export type CoachingCta = { key: string; labelKey: TranslationKey; view: AppView };

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
  if (!input.aiConfigured) ctas.push({ key: "ai", labelKey: "coachingConfigureAi", view: "settings" });
  if (input.showMilestones && input.milestoneCount === 0) ctas.push({ key: "milestone", labelKey: "coachingAddMilestone", view: "milestones" });
  if (input.showBudget && input.budgetCount === 0) ctas.push({ key: "budget", labelKey: "coachingSetBudget", view: "budget" });
  return ctas;
}
