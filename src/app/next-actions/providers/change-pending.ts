// src/app/next-actions/providers/change-pending.ts
import { isPendingChange, changeImpactRag, SCOPE_PENDING_RED } from "../../change-log";
import { scoreAction, bandTier, ACTION_WEIGHTS } from "../score";
import type { ActionInput, ActionProvider, SuggestedAction } from "../types";

const W = ACTION_WEIGHTS;

export const changePendingProvider: ActionProvider = {
  moduleId: "changes",
  provide(input: ActionInput): SuggestedAction[] {
    const out: SuggestedAction[] = [];
    const pending = input.changes.filter((c) => isPendingChange(c.status));
    const scopePendingRed = input.scopePendingRed ?? SCOPE_PENDING_RED;

    // Aggregate action — fires when pending backlog reaches the Red threshold
    if (pending.length >= scopePendingRed) {
      const score = scoreAction({ risk: W.riskCritical, impact: W.impactScopePending, clarity: input.clarityBonus ?? W.clarityBonus });
      out.push({
        id: "change-pending:all:aggregate",
        source: "change-pending",
        moduleId: "changes",
        title: { key: "actionChangeAggTitle", params: [pending.length] },
        why: { key: "actionChangeAggWhy" },
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "changes", id: 0 },
      });
    }

    // Per-item actions — pending changes whose impact maps to Red
    for (const c of pending) {
      if (changeImpactRag(c.impact) !== "R") continue;
      const score = scoreAction({ risk: W.riskCritical, clarity: input.clarityBonus ?? W.clarityBonus });
      out.push({
        id: `change-pending:${c.id}:item`,
        source: "change-pending",
        moduleId: "changes",
        title: { key: "actionChangeItemTitle", params: [c.title] },
        why: { key: "actionChangeItemWhy", params: [c.impact ?? ""] },
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "changes", id: c.id },
      });
    }

    return out;
  },
};
