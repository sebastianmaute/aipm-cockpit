// src/app/next-actions/providers/budget.ts
import { scoreAction, bandTier, ACTION_WEIGHTS } from "../score";
import type { ActionInput, ActionProvider, SuggestedAction } from "../types";

const W = ACTION_WEIGHTS;

export const budgetProvider: ActionProvider = {
  moduleId: "budget",
  provide(input: ActionInput): SuggestedAction[] {
    const eff = input.dashboard.budget.effective;
    if (eff !== "R" && eff !== "A") return [];

    const cpi = input.dashboard.evm.cpi;
    const cpiText = cpi != null && Number.isFinite(cpi) ? cpi.toFixed(2) : "n/a";
    const score = scoreAction({ risk: eff === "R" ? W.riskCritical : W.riskHigh });

    return [
      {
        id: "budget:overall:over",
        source: "budget",
        moduleId: "budget",
        title: { key: "actionBudgetTitle", params: [input.projectName] },
        why: { key: "actionBudgetWhyCpi", params: [cpiText] },
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "budget", id: 0 },
      },
    ];
  },
};
