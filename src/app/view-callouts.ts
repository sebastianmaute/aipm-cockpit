// Per-view contextual callouts (Help SP2). Maps a working view to a short
// novice one-liner (i18n key) + the Help concept that explains it in depth.
// Pure + i18n-free; the presentational `view-callout.tsx` renders it and the
// `requestHelpConcept` channel deep-links the "Learn more" target into the
// Help view. Views with no entry render no callout (the component self-hides).

import type { TranslationKey } from "./i18n";
import type { AppView } from "./nav-config";

export interface ViewCallout {
  /** Short plain-language "what this view is for" one-liner. */
  textKey: TranslationKey;
  /** A HELP_ENTRIES concept id — the "Learn more" deep-link target. */
  conceptId: string;
}

export const VIEW_CALLOUTS: Partial<Record<AppView, ViewCallout>> = {
  "open-points": { textKey: "viewHintOpenPoints", conceptId: "concept-task-status" },
  gantt: { textKey: "viewHintGantt", conceptId: "concept-dependency" },
  milestones: { textKey: "viewHintMilestones", conceptId: "concept-milestone" },
  raid: { textKey: "viewHintRaid", conceptId: "concept-raid" },
  changes: { textKey: "viewHintChanges", conceptId: "concept-change" },
  stakeholders: { textKey: "viewHintStakeholders", conceptId: "concept-stakeholder" },
  "stakeholder-map": { textKey: "viewHintStakeholderMap", conceptId: "concept-stakeholder" },
  knowledge: { textKey: "viewHintKnowledge", conceptId: "concept-knowledge" },
  raci: { textKey: "viewHintRaci", conceptId: "concept-raci" },
  budget: { textKey: "viewHintBudget", conceptId: "concept-budget" },
  "budget-report": { textKey: "viewHintBudgetReport", conceptId: "concept-budget" },
  resources: { textKey: "viewHintResources", conceptId: "concept-resource" },
  workload: { textKey: "viewHintWorkload", conceptId: "concept-resource" },
  planning: { textKey: "viewHintPlanning", conceptId: "concept-resource" },
  "steering-committee": { textKey: "viewHintSteering", conceptId: "concept-steering" },
  trends: { textKey: "viewHintTrends", conceptId: "concept-baseline" },
};
