// src/app/next-actions/providers/milestone.ts
import { partitionMilestones } from "../../milestones";
import { scoreAction, bandTier, ACTION_WEIGHTS } from "../score";
import type { ActionInput, ActionProvider, SuggestedAction } from "../types";

const W = ACTION_WEIGHTS;

export const milestoneProvider: ActionProvider = {
  moduleId: "milestones",
  provide(input: ActionInput): SuggestedAction[] {
    const out: SuggestedAction[] = [];

    // Build tasksById map required by partitionMilestones
    const tasksById = new Map(input.tasks.map((t) => [t.id, t]));

    // ActionInput has no holidaySet — use empty set (no holidays configured)
    const holidaySet = new Set<string>();

    const { overdue, atRisk } = partitionMilestones(
      input.milestones,
      tasksById,
      input.today,
      holidaySet,
      input.dueSoonWorkdays,
    );

    for (const m of overdue) {
      const score = scoreAction({ urgency: W.urgencyOverdue, impact: W.impactBlocksMilestone });
      out.push({
        id: `milestone:${m.id}:overdue`,
        source: "milestone",
        moduleId: "milestones",
        title: { key: "actionMilestoneTitle", params: [m.name] },
        why: { key: "actionMilestoneWhyOverdue" },
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "milestones", id: m.id },
      });
    }

    for (const m of atRisk) {
      const score = scoreAction({ risk: W.riskHigh, impact: W.impactBlocksMilestone });
      out.push({
        id: `milestone:${m.id}:at-risk`,
        source: "milestone",
        moduleId: "milestones",
        title: { key: "actionMilestoneTitle", params: [m.name] },
        why: { key: "actionMilestoneWhyAtRisk" },
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "milestones", id: m.id },
      });
    }

    return out;
  },
};
