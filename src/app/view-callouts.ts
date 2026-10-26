// Per-view contextual callouts (Help SP2). Maps a working view to a short
// novice one-liner (i18n key) + the Help concept that explains it in depth.
// Pure + i18n-free; the presentational `view-callout.tsx` renders it and the
// `requestHelpConcept` channel deep-links the "Learn more" target into the
// Help view. Views with no entry render no callout (the component self-hides).

import type { TranslationKey } from "./i18n";
import type { AppView } from "./nav-config";
import type { HelpVideoId } from "./help-videos";

export interface ViewCallout {
  /** Short plain-language "what this view is for" one-liner. */
  textKey: TranslationKey;
  /** A HELP_ENTRIES concept id — the "Learn more" deep-link target. */
  conceptId: string;
  /** The video guide that shows this view (`help-videos.ts`), linked beside
   *  "Learn more" and opened on YouTube in the browser. Chosen per VIEW, not
   *  per concept: Gantt's concept is dependencies, but its video is the Gantt's. */
  videoId?: HelpVideoId;
}

export const VIEW_CALLOUTS: Partial<Record<AppView, ViewCallout>> = {
  "open-points": { textKey: "viewHintOpenPoints", conceptId: "concept-task-status", videoId: "f-open-points" },
  gantt: { textKey: "viewHintGantt", conceptId: "concept-dependency", videoId: "f-gantt" },
  milestones: { textKey: "viewHintMilestones", conceptId: "concept-milestone", videoId: "f-milestones" },
  raid: { textKey: "viewHintRaid", conceptId: "concept-raid", videoId: "f-raid" },
  changes: { textKey: "viewHintChanges", conceptId: "concept-change", videoId: "f-changes" },
  stakeholders: { textKey: "viewHintStakeholders", conceptId: "concept-stakeholder", videoId: "f-stakeholders" },
  "stakeholder-map": { textKey: "viewHintStakeholderMap", conceptId: "concept-stakeholder", videoId: "f-influence" },
  knowledge: { textKey: "viewHintKnowledge", conceptId: "concept-knowledge", videoId: "f-knowledge" },
  raci: { textKey: "viewHintRaci", conceptId: "concept-raci", videoId: "f-raci" },
  budget: { textKey: "viewHintBudget", conceptId: "concept-budget", videoId: "f-budget" },
  "budget-report": { textKey: "viewHintBudgetReport", conceptId: "concept-budget", videoId: "f-budget" },
  resources: { textKey: "viewHintResources", conceptId: "concept-resource" }, // no video: this banner sits on the capacity report, which no video shows (the directory video is the directory view's)
  workload: { textKey: "viewHintWorkload", conceptId: "concept-resource", videoId: "f-workload" },
  planning: { textKey: "viewHintPlanning", conceptId: "concept-resource", videoId: "f-planning" },
  "steering-committee": { textKey: "viewHintSteering", conceptId: "concept-steering", videoId: "ai-steering" },
  trends: { textKey: "viewHintTrends", conceptId: "concept-baseline", videoId: "f-trends" },
};
