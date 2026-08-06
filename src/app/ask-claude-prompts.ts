// Pure, i18n-free catalog of suggested AI-assistant prompts. Holds translation
// KEYS only (the surface resolves them via t(lang, ...)), keeping this engine
// free of React and i18n. Consumed by the Ask-Claude header menu and the chat
// empty-state foundational chips.
import type { TranslationKey } from "./i18n";
import type { AppView } from "./nav-config";

export interface PromptDef {
  /** Short label shown on the chip / menu item. */
  labelKey: TranslationKey;
  /** Full prompt text sent to Claude as the user message. */
  bodyKey: TranslationKey;
}

/** The universal short questions, offered as the header Ask-Claude menu's
 *  "General" group. ★ NO LONGER chat chips — the chat strip serves
 *  `CHAT_STARTER_PROMPTS` instead (0.216.0), so `promptsForView` is the only
 *  consumer. Do not delete this on the assumption it is dead. */
export const FOUNDATIONAL_PROMPTS: PromptDef[] = [
  { labelKey: "aiPromptExplainLabel", bodyKey: "aiPromptExplainBody" },
  { labelKey: "aiPromptWhatsNextLabel", bodyKey: "aiPromptWhatsNextBody" },
  // ★ "Status overview" and "Prioritize" were REMOVED here (0.216.0). They
  // duplicated the fuller `CHAT_STARTER_PROMPTS` chips ("Weekly status",
  // "Prioritize tasks"), so the header menu and the chat strip offered two
  // competing versions of the same request. Do NOT reinstate them without
  // deciding which surface owns the question.
];

/** Prompts that only make sense on the CHAT surface, appended after the
 *  foundational set. The attachment prompt asks Claude to read a file the user
 *  has attached — chat has an attach control, the header Ask-Claude menu does
 *  not, so offering it there is a dead prompt. */
export const CHAT_ONLY_PROMPTS: PromptDef[] = [
  { labelKey: "aiPromptProcessAttachmentLabel", bodyKey: "aiPromptProcessAttachmentBody" },
];

/** The one-tap starters shown as chips on the CHAT surface. Complete,
 *  self-contained briefs — unlike `FOUNDATIONAL_PROMPTS`, which are short
 *  questions the header Ask-Claude menu also serves. Kept separate for exactly
 *  that reason: the menu has no attach control and little room, so it keeps the
 *  terse set while the chat strip carries these. ★ Each is answerable from
 *  existing read tools (tasks, RAID, milestones, stakeholders) — do not add a
 *  starter whose question no tool can reach, or it becomes a dead chip that
 *  invites the model to guess. */
export const CHAT_STARTER_PROMPTS: PromptDef[] = [
  { labelKey: "aiPromptRiskReviewLabel", bodyKey: "aiPromptRiskReviewBody" },
  { labelKey: "aiPromptWeeklyStatusLabel", bodyKey: "aiPromptWeeklyStatusBody" },
  { labelKey: "aiPromptStakeholderUpdateLabel", bodyKey: "aiPromptStakeholderUpdateBody" },
  { labelKey: "aiPromptPrioritizeTasksLabel", bodyKey: "aiPromptPrioritizeTasksBody" },
];

/** View-specific suggestions. A view absent here has no "on this page" set;
 *  the menu still shows the foundational prompts. Keys only — surface translates. */
export const ASK_CLAUDE_PROMPTS: Partial<Record<AppView, PromptDef[]>> = {
  dashboard: [
    { labelKey: "aiPromptDashHealthLabel", bodyKey: "aiPromptDashHealthBody" },
    { labelKey: "aiPromptDashRisksLabel", bodyKey: "aiPromptDashRisksBody" },
  ],
  "open-points": [
    { labelKey: "aiPromptOpenOverdueLabel", bodyKey: "aiPromptOpenOverdueBody" },
    { labelKey: "aiPromptOpenFocusLabel", bodyKey: "aiPromptOpenFocusBody" },
    { labelKey: "aiPromptOpenStaleLabel", bodyKey: "aiPromptOpenStaleBody" },
  ],
  raid: [
    { labelKey: "aiPromptRaidTopLabel", bodyKey: "aiPromptRaidTopBody" },
    { labelKey: "aiPromptRaidOwnerlessLabel", bodyKey: "aiPromptRaidOwnerlessBody" },
  ],
  changes: [
    { labelKey: "aiPromptChangeDecideLabel", bodyKey: "aiPromptChangeDecideBody" },
    { labelKey: "aiPromptChangeImpactLabel", bodyKey: "aiPromptChangeImpactBody" },
  ],
  milestones: [
    { labelKey: "aiPromptMsAtRiskLabel", bodyKey: "aiPromptMsAtRiskBody" },
    { labelKey: "aiPromptMsUpcomingLabel", bodyKey: "aiPromptMsUpcomingBody" },
  ],
  stakeholders: [
    { labelKey: "aiPromptStkUpdateLabel", bodyKey: "aiPromptStkUpdateBody" },
    { labelKey: "aiPromptStkGapsLabel", bodyKey: "aiPromptStkGapsBody" },
  ],
  budget: [
    { labelKey: "aiPromptBudCpiLabel", bodyKey: "aiPromptBudCpiBody" },
    { labelKey: "aiPromptBudTrendLabel", bodyKey: "aiPromptBudTrendBody" },
  ],
  gantt: [
    { labelKey: "aiPromptGanttCritLabel", bodyKey: "aiPromptGanttCritBody" },
    { labelKey: "aiPromptGanttSlackLabel", bodyKey: "aiPromptGanttSlackBody" },
  ],
  resources: [
    { labelKey: "aiPromptResOverloadLabel", bodyKey: "aiPromptResOverloadBody" },
    { labelKey: "aiPromptResGapsLabel", bodyKey: "aiPromptResGapsBody" },
  ],
  knowledge: [
    { labelKey: "aiPromptDocMissingLabel", bodyKey: "aiPromptDocMissingBody" },
    { labelKey: "aiPromptDocSummaryLabel", bodyKey: "aiPromptDocSummaryBody" },
  ],
  reports: [
    { labelKey: "aiPromptRepDraftLabel", bodyKey: "aiPromptRepDraftBody" },
    { labelKey: "aiPromptRepStandoutLabel", bodyKey: "aiPromptRepStandoutBody" },
  ],
  actions: [
    { labelKey: "aiPromptActExplainLabel", bodyKey: "aiPromptActExplainBody" },
    { labelKey: "aiPromptActFirstLabel", bodyKey: "aiPromptActFirstBody" },
  ],
  trends: [
    { labelKey: "aiPromptTrendReadLabel", bodyKey: "aiPromptTrendReadBody" },
    { labelKey: "aiPromptTrendActLabel", bodyKey: "aiPromptTrendActBody" },
  ],
  "steering-committee": [
    { labelKey: "aiPromptScUpcomingLabel", bodyKey: "aiPromptScUpcomingBody" },
    { labelKey: "aiPromptScAgendaLabel", bodyKey: "aiPromptScAgendaBody" },
  ],
  insights: [
    { labelKey: "aiPromptInsTopLabel", bodyKey: "aiPromptInsTopBody" },
    { labelKey: "aiPromptInsActLabel", bodyKey: "aiPromptInsActBody" },
  ],
  directory: [
    { labelKey: "aiPromptDirGapsLabel", bodyKey: "aiPromptDirGapsBody" },
    { labelKey: "aiPromptDirUnlinkedLabel", bodyKey: "aiPromptDirUnlinkedBody" },
  ],
  workload: [
    { labelKey: "aiPromptWlOverloadLabel", bodyKey: "aiPromptWlOverloadBody" },
    { labelKey: "aiPromptWlRebalanceLabel", bodyKey: "aiPromptWlRebalanceBody" },
  ],
  calendar: [
    { labelKey: "aiPromptCalWeekLabel", bodyKey: "aiPromptCalWeekBody" },
    { labelKey: "aiPromptCalClashLabel", bodyKey: "aiPromptCalClashBody" },
  ],
  planning: [
    { labelKey: "aiPromptPlanGapsLabel", bodyKey: "aiPromptPlanGapsBody" },
    { labelKey: "aiPromptPlanRampLabel", bodyKey: "aiPromptPlanRampBody" },
  ],
  "manage-roles": [
    { labelKey: "aiPromptRolesUnassignedLabel", bodyKey: "aiPromptRolesUnassignedBody" },
    { labelKey: "aiPromptRolesCoverLabel", bodyKey: "aiPromptRolesCoverBody" },
  ],
  "budget-report": [
    { labelKey: "aiPromptBrVarianceLabel", bodyKey: "aiPromptBrVarianceBody" },
    { labelKey: "aiPromptBrForecastLabel", bodyKey: "aiPromptBrForecastBody" },
  ],
  "raid-report": [
    { labelKey: "aiPromptRrConcentrationLabel", bodyKey: "aiPromptRrConcentrationBody" },
    { labelKey: "aiPromptRrSeverityLabel", bodyKey: "aiPromptRrSeverityBody" },
  ],
  "change-report": [
    { labelKey: "aiPromptCrPendingLabel", bodyKey: "aiPromptCrPendingBody" },
    { labelKey: "aiPromptCrImpactLabel", bodyKey: "aiPromptCrImpactBody" },
  ],
  raci: [
    { labelKey: "aiPromptRaciGapsLabel", bodyKey: "aiPromptRaciGapsBody" },
    { labelKey: "aiPromptRaciOverloadLabel", bodyKey: "aiPromptRaciOverloadBody" },
  ],
  "stakeholder-map": [
    { labelKey: "aiPromptSmapCloseLabel", bodyKey: "aiPromptSmapCloseBody" },
    { labelKey: "aiPromptSmapNeglectLabel", bodyKey: "aiPromptSmapNeglectBody" },
  ],
  "portfolio-health": [
    { labelKey: "aiPromptPhWorstLabel", bodyKey: "aiPromptPhWorstBody" },
    { labelKey: "aiPromptPhCompareLabel", bodyKey: "aiPromptPhCompareBody" },
  ],
};

/** What the menu/UI shows for a view: on-page suggestions + the always-on general set. */
export function promptsForView(view: AppView): { onPage: PromptDef[]; general: PromptDef[] } {
  return { onPage: ASK_CLAUDE_PROMPTS[view] ?? [], general: FOUNDATIONAL_PROMPTS };
}
