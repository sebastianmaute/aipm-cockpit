// src/app/next-actions/providers/workload.ts
import { scoreAction, bandTier, ACTION_WEIGHTS } from "../score";
import type { ActionInput, ActionProvider, SuggestedAction } from "../types";

const W = ACTION_WEIGHTS;

export const workloadProvider: ActionProvider = {
  moduleId: "resources",
  provide(input: ActionInput): SuggestedAction[] {
    const alerts = input.workloadAlerts ?? [];
    const allocCritical = input.workloadAllocatedCritical ?? 130;
    const overdueUrgent = input.workloadOverdueUrgent ?? 5;
    return alerts.map((al): SuggestedAction => {
      const score =
        al.reason === "over-allocated"
          ? scoreAction({ risk: al.value >= allocCritical ? W.riskCritical : W.riskHigh, urgency: W.urgencySoon, clarity: input.semiClarityBonus ?? W.semiClarityBonus })
          : scoreAction({ urgency: al.value >= overdueUrgent ? W.urgencyOverdue : W.urgencyToday, risk: W.riskHigh, clarity: input.semiClarityBonus ?? W.semiClarityBonus });
      const why =
        al.reason === "over-allocated"
          ? { key: "actionWorkloadWhyOverAllocated" as const, params: [al.value] }
          : { key: "actionWorkloadWhyOverload" as const, params: [al.value] };
      return {
        id: `workload:${al.resourceId}:${al.reason}`,
        source: "workload",
        moduleId: "resources",
        title: { key: "actionWorkloadTitle" as const, params: [al.resourceName] },
        why,
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "workload", id: al.resourceId },
      };
    });
  },
};
