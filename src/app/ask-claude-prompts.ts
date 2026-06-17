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

/** The universal foundational prompts. Always offered (chat chips + menu "General"). */
export const FOUNDATIONAL_PROMPTS: PromptDef[] = [
  { labelKey: "aiPromptWhatsNextLabel", bodyKey: "aiPromptWhatsNextBody" },
  { labelKey: "aiPromptStatusLabel", bodyKey: "aiPromptStatusBody" },
  { labelKey: "aiPromptPrioritizeLabel", bodyKey: "aiPromptPrioritizeBody" },
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
  documents: [
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
};

/** What the menu/UI shows for a view: on-page suggestions + the always-on general set. */
export function promptsForView(view: AppView): { onPage: PromptDef[]; general: PromptDef[] } {
  return { onPage: ASK_CLAUDE_PROMPTS[view] ?? [], general: FOUNDATIONAL_PROMPTS };
}
