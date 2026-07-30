// Structured Help content backbone — consumed by the in-pane Help view
// (`help-view.tsx`, all groups) and the floating top-bar Help panel
// (`help-menu.tsx`, features group only, via the derived HELP_SECTIONS).
// Each entry is a title + body i18n key pair (EN/DE in i18n*.ts), tagged by
// group, with optional relations (related views + related concept entries) that
// later help surfaces (per-view callouts, the relations map) also read.

import type { TranslationKey } from "./i18n";
import type { AppView } from "./nav-config";

export type HelpGroup = "concepts" | "workflows" | "features" | "automated";

export interface HelpEntry {
  id: string;
  group: HelpGroup;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  relatedViews?: readonly AppView[];
  relatedConcepts?: readonly string[];
}

/** Render order of the groups (TOC + content). */
export const HELP_GROUP_ORDER: readonly HelpGroup[] = ["concepts", "workflows", "features", "automated"];

/** i18n label key per group (group headers in the Help view). */
export const HELP_GROUP_LABEL: Record<HelpGroup, TranslationKey> = {
  concepts: "helpGroupConcepts",
  workflows: "helpGroupWorkflows",
  features: "helpGroupFeatures",
  automated: "helpGroupAutomated",
};

export const HELP_ENTRIES: readonly HelpEntry[] = [
  // ── Concepts (what / why / in this app) ──
  { id: "concept-milestone", group: "concepts", titleKey: "helpConceptMilestoneTitle", bodyKey: "helpConceptMilestoneBody", relatedViews: ["milestones", "gantt"], relatedConcepts: ["concept-dependency", "concept-baseline"] },
  { id: "concept-raid", group: "concepts", titleKey: "helpConceptRaidTitle", bodyKey: "helpConceptRaidBody", relatedViews: ["raid"], relatedConcepts: ["concept-change", "concept-stakeholder"] },
  { id: "concept-change", group: "concepts", titleKey: "helpConceptChangeTitle", bodyKey: "helpConceptChangeBody", relatedViews: ["changes"], relatedConcepts: ["concept-raid", "concept-budget"] },
  { id: "concept-stakeholder", group: "concepts", titleKey: "helpConceptStakeholderTitle", bodyKey: "helpConceptStakeholderBody", relatedViews: ["stakeholders", "raci"], relatedConcepts: ["concept-raci", "concept-steering"] },
  { id: "concept-raci", group: "concepts", titleKey: "helpConceptRaciTitle", bodyKey: "helpConceptRaciBody", relatedViews: ["raci", "stakeholders"], relatedConcepts: ["concept-stakeholder"] },
  { id: "concept-budget", group: "concepts", titleKey: "helpConceptBudgetTitle", bodyKey: "helpConceptBudgetBody", relatedViews: ["budget", "budget-report"], relatedConcepts: ["concept-resource"] },
  { id: "concept-resource", group: "concepts", titleKey: "helpConceptResourceTitle", bodyKey: "helpConceptResourceBody", relatedViews: ["resources", "workload", "planning"], relatedConcepts: ["concept-budget"] },
  { id: "concept-steering", group: "concepts", titleKey: "helpConceptSteeringTitle", bodyKey: "helpConceptSteeringBody", relatedViews: ["steering-committee"], relatedConcepts: ["concept-stakeholder"] },
  { id: "concept-task-status", group: "concepts", titleKey: "helpConceptTaskStatusTitle", bodyKey: "helpConceptTaskStatusBody", relatedViews: ["open-points"], relatedConcepts: ["concept-milestone"] },
  { id: "concept-baseline", group: "concepts", titleKey: "helpConceptBaselineTitle", bodyKey: "helpConceptBaselineBody", relatedViews: ["trends"], relatedConcepts: ["concept-milestone", "concept-budget"] },
  { id: "concept-dependency", group: "concepts", titleKey: "helpConceptDependencyTitle", bodyKey: "helpConceptDependencyBody", relatedViews: ["gantt", "open-points"], relatedConcepts: ["concept-milestone"] },
  { id: "concept-knowledge", group: "concepts", titleKey: "helpConceptKnowledgeTitle", bodyKey: "helpConceptKnowledgeBody", relatedViews: ["knowledge"], relatedConcepts: ["concept-stakeholder"] },

  // ── Workflows (numbered guides) ──
  { id: "workflow-end-to-end", group: "workflows", titleKey: "helpWorkflowEndToEndTitle", bodyKey: "helpWorkflowEndToEndBody", relatedViews: ["dashboard", "open-points", "milestones"], relatedConcepts: ["concept-milestone", "concept-task-status"] },
  { id: "workflow-plan", group: "workflows", titleKey: "helpWorkflowPlanTitle", bodyKey: "helpWorkflowPlanBody", relatedViews: ["milestones", "gantt"], relatedConcepts: ["concept-milestone", "concept-dependency"] },
  { id: "workflow-risk", group: "workflows", titleKey: "helpWorkflowRiskTitle", bodyKey: "helpWorkflowRiskBody", relatedViews: ["raid"], relatedConcepts: ["concept-raid"] },
  { id: "workflow-scope", group: "workflows", titleKey: "helpWorkflowScopeTitle", bodyKey: "helpWorkflowScopeBody", relatedViews: ["changes"], relatedConcepts: ["concept-change"] },
  { id: "workflow-budget", group: "workflows", titleKey: "helpWorkflowBudgetTitle", bodyKey: "helpWorkflowBudgetBody", relatedViews: ["budget", "trends"], relatedConcepts: ["concept-budget", "concept-baseline"] },
  { id: "workflow-stakeholders", group: "workflows", titleKey: "helpWorkflowStakeholdersTitle", bodyKey: "helpWorkflowStakeholdersBody", relatedViews: ["stakeholders", "raci", "steering-committee"], relatedConcepts: ["concept-stakeholder", "concept-raci"] },

  // ── Features (migrated from help-sections.ts) ──
  { id: "feature-rate-card", group: "features", titleKey: "helpSecRateCardTitle", bodyKey: "helpSecRateCardBody", relatedViews: ["resources", "planning"], relatedConcepts: ["concept-resource", "concept-budget"] },
  { id: "feature-usage-limits", group: "features", titleKey: "helpSecUsageLimitsTitle", bodyKey: "helpSecUsageLimitsBody", relatedViews: ["settings", "chat"] },
  { id: "feature-layout", group: "features", titleKey: "helpSecLayoutTitle", bodyKey: "helpSecLayoutBody" },
  { id: "feature-add", group: "features", titleKey: "helpSecAddTitle", bodyKey: "helpSecAddBody" },
  { id: "feature-field-visibility", group: "features", titleKey: "helpSecFieldVisibilityTitle", bodyKey: "helpSecFieldVisibilityBody" },
  { id: "feature-templates", group: "features", titleKey: "helpSecTemplatesTitle", bodyKey: "helpSecTemplatesBody" },
  { id: "feature-per-project-functions", group: "features", titleKey: "helpSecPerProjectFunctionsTitle", bodyKey: "helpSecPerProjectFunctionsBody" },
  { id: "feature-template-suggest", group: "features", titleKey: "helpSecTemplateSuggestTitle", bodyKey: "helpSecTemplateSuggestBody" },
  { id: "feature-workspace", group: "features", titleKey: "helpSecWorkspaceTitle", bodyKey: "helpSecWorkspaceBody" },
  { id: "feature-tabs", group: "features", titleKey: "helpSecTabsTitle", bodyKey: "helpSecTabsBody" },
  { id: "feature-tasks", group: "features", titleKey: "helpSecTasksTitle", bodyKey: "helpSecTasksBody" },
  { id: "feature-task-status", group: "features", titleKey: "helpSecTaskStatusTitle", bodyKey: "helpSecTaskStatusBody" },
  { id: "feature-rich-text", group: "features", titleKey: "helpSecRichTextTitle", bodyKey: "helpSecRichTextBody", relatedViews: ["open-points", "raid", "changes", "milestones"] },
  { id: "feature-gantt", group: "features", titleKey: "helpSecGanttTitle", bodyKey: "helpSecGanttBody" },
  { id: "feature-raid", group: "features", titleKey: "helpSecRaidTitle", bodyKey: "helpSecRaidBody" },
  { id: "feature-resources", group: "features", titleKey: "helpSecResourcesTitle", bodyKey: "helpSecResourcesBody" },
  { id: "feature-steering", group: "features", titleKey: "helpSecSteeringTitle", bodyKey: "helpSecSteeringBody" },
  { id: "feature-activity", group: "features", titleKey: "helpSecActivityTitle", bodyKey: "helpSecActivityBody" },
  { id: "feature-knowledge", group: "features", titleKey: "helpSecKnowledgeTitle", bodyKey: "helpSecKnowledgeBody" },
  { id: "feature-voice", group: "features", titleKey: "helpSecVoiceTitle", bodyKey: "helpSecVoiceBody" },
  { id: "feature-notif", group: "features", titleKey: "helpSecNotifTitle", bodyKey: "helpSecNotifBody" },
  { id: "feature-timezones", group: "features", titleKey: "helpSecTimezonesTitle", bodyKey: "helpSecTimezonesBody" },
  { id: "feature-jira", group: "features", titleKey: "helpSecJiraTitle", bodyKey: "helpSecJiraBody" },
  { id: "feature-storage", group: "features", titleKey: "helpSecStorageTitle", bodyKey: "helpSecStorageBody" },
  { id: "feature-setup-wizard", group: "features", titleKey: "helpSecSetupWizardTitle", bodyKey: "helpSecSetupWizardBody" },
  { id: "feature-version-history", group: "features", titleKey: "helpSecVersionHistoryTitle", bodyKey: "helpSecVersionHistoryBody" },
  { id: "feature-ai", group: "features", titleKey: "helpSecAiTitle", bodyKey: "helpSecAiBody" },
  { id: "feature-ai-advanced", group: "features", titleKey: "helpSecAiAdvancedTitle", bodyKey: "helpSecAiAdvancedBody" },
  { id: "feature-input-feedback", group: "features", titleKey: "helpSecInputFeedbackTitle", bodyKey: "helpSecInputFeedbackBody" },
  { id: "feature-tour", group: "features", titleKey: "helpSecTourTitle", bodyKey: "helpSecTourBody" },
  { id: "feature-keys", group: "features", titleKey: "helpSecKeysTitle", bodyKey: "helpSecKeysBody" },

  // ── What's automated ──
  { id: "automated-tracking", group: "automated", titleKey: "helpAutomatedTrackingTitle", bodyKey: "helpAutomatedTrackingBody", relatedViews: ["dashboard", "actions", "open-points"], relatedConcepts: ["concept-task-status"] },
  { id: "automated-health", group: "automated", titleKey: "helpAutomatedHealthTitle", bodyKey: "helpAutomatedHealthBody", relatedViews: ["dashboard", "budget", "trends"], relatedConcepts: ["concept-budget", "concept-baseline"] },
];

/** Features-group slice — the floating top-bar Help panel renders only these. */
export const HELP_SECTIONS = HELP_ENTRIES.filter((e) => e.group === "features");
