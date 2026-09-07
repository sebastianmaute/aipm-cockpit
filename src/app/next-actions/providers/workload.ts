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
      // This engine is i18n-free (no Lang in scope — see `I18nText`'s docstring
      // in ../types), so it cannot call `tPlural`; it picks the plural/singular
      // KEY directly instead, for the surface's later `t(lang, key, ...params)`
      // to render. `count === 1` matches `tPlural`'s own category selection for
      // en-US/en-GB/de today (see its docstring) — this is the same equivalence,
      // applied where no `Lang` is available to call it directly.
      const why =
        al.reason === "over-allocated"
          ? { key: "actionWorkloadWhyOverAllocated" as const, params: [al.value] }
          : { key: al.value === 1 ? "actionWorkloadWhyOverloadOne" as const : "actionWorkloadWhyOverload" as const, params: [al.value] };
      return {
        id: `workload:${al.resourceId}:${al.reason}`,
        source: "workload",
        moduleId: "resources",
        title: { key: "actionWorkloadTitle" as const, params: [al.resourceName] },
        why,
        score,
        tier: bandTier(score),
        cta:
          al.reason === "overload"
            ? { kind: "open-tasks-for", resourceId: al.resourceId, resourceName: al.resourceName }
            : { kind: "open", view: "workload", id: al.resourceId },
      };
    });
  },
};
