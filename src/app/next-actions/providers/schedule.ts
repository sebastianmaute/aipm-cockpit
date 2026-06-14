// src/app/next-actions/providers/schedule.ts
import { scoreAction, bandTier, ACTION_WEIGHTS } from "../score";
import type { ActionInput, ActionProvider, SuggestedAction } from "../types";

const W = ACTION_WEIGHTS;

export const scheduleProvider: ActionProvider = {
  // core (no moduleId) — schedule health is project-wide
  provide(input: ActionInput): SuggestedAction[] {
    const warn = input.scheduleSpiWarn ?? 0.9;
    const critical = input.scheduleSpiCritical ?? 0.8;
    const spi = input.dashboard.evm?.spi ?? null;
    if (spi == null || spi >= warn) return [];

    const trend = input.trends?.schedule;
    const penaltyBase = input.staticPenalty ?? W.staticPenalty;
    // Worsening trend has real momentum -> less penalty so the score rises vs a stale signal.
    const staticPenalty = trend === "worsening" ? Math.round(penaltyBase / 2) : penaltyBase;

    const score =
      spi < critical
        ? scoreAction({ urgency: W.urgencyOverdue, risk: W.riskCritical, staticPenalty })
        : scoreAction({ urgency: W.urgencySoon, risk: W.riskHigh, staticPenalty });

    const why =
      trend === "worsening"
        ? { key: "actionScheduleWhySlipping" as const, params: [spi.toFixed(2)] }
        : { key: "actionScheduleWhyBehind" as const, params: [spi.toFixed(2)] };

    return [
      {
        id: "schedule:project:spi",
        source: "schedule",
        title: { key: "actionScheduleTitle", params: [input.projectName] },
        why,
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "dashboard", id: 0 },
      },
    ];
  },
};
