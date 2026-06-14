// src/app/next-actions/providers/stakeholder-comms.ts
import { scoreAction, bandTier, ACTION_WEIGHTS } from "../score";
import type { ActionInput, ActionProvider, SuggestedAction } from "../types";

const W = ACTION_WEIGHTS;

export const stakeholderCommsProvider: ActionProvider = {
  moduleId: "stakeholders",
  provide(input: ActionInput): SuggestedAction[] {
    return input.commsReminders.map((r) => {
      const score = scoreAction({ urgency: W.urgencySoon, risk: W.riskHigh, clarity: input.clarityBonus ?? W.clarityBonus });
      return {
        id: `stakeholder-comms:${r.stakeholderId}:${r.itemKind}:${r.itemId}`,
        source: "stakeholder-comms",
        moduleId: "stakeholders",
        title: { key: "actionCommsTitle" as const, params: [r.stakeholderName] },
        why: { key: "actionCommsWhy" as const, params: [r.itemKind] },
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "stakeholders", id: r.stakeholderId },
      };
    });
  },
};
