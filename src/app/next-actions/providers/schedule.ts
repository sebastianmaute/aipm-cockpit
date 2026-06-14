// src/app/next-actions/providers/schedule.ts
import { scoreAction, bandTier, ACTION_WEIGHTS } from "../score";
import type { ActionInput, ActionProvider, SuggestedAction } from "../types";

const W = ACTION_WEIGHTS;

export const scheduleProvider: ActionProvider = {
  // core (no moduleId) — schedule health is project-wide
  provide(input: ActionInput): SuggestedAction[] {
    const spi = input.dashboard.evm?.spi ?? null;
    if (spi == null || spi >= 0.9) return [];
    const score =
      spi < 0.8
        ? scoreAction({ urgency: W.urgencyOverdue, risk: W.riskCritical })
        : scoreAction({ urgency: W.urgencySoon, risk: W.riskHigh });
    return [
      {
        id: "schedule:project:spi",
        source: "schedule",
        title: { key: "actionScheduleTitle", params: [input.projectName] },
        why: { key: "actionScheduleWhyBehind", params: [spi.toFixed(2)] },
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "dashboard", id: 0 },
      },
    ];
  },
};
