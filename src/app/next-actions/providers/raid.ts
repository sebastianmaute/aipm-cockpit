// src/app/next-actions/providers/raid.ts
import { severityRag, isTerminalStatus } from "../../raid";
import { getRaidReviewItems } from "../../raid-review";
import { scoreAction, bandTier, stalenessScore, ACTION_WEIGHTS } from "../score";
import type { ActionInput, ActionProvider, SuggestedAction } from "../types";

const W = ACTION_WEIGHTS;

export const raidProvider: ActionProvider = {
  moduleId: "raid",
  provide(input: ActionInput): SuggestedAction[] {
    const out: SuggestedAction[] = [];

    // (A) Severity actions — non-terminal items with RAG "R" or "A"
    for (const item of input.raid) {
      if (isTerminalStatus(item.status, item.category)) continue;
      const rag = severityRag(item.severity);
      if (rag !== "R" && rag !== "A") continue;
      const hasOwner = !!(item.owner || item.ownerEmail || item.ownerResourceId != null);
      const clarity = hasOwner
        ? (input.semiClarityBonus ?? W.semiClarityBonus)
        : (input.clarityBonus ?? W.clarityBonus);
      const score = scoreAction({ risk: rag === "R" ? W.riskCritical : W.riskHigh, clarity });
      const why = hasOwner
        ? { key: "actionRaidWhySeverity" as const, params: [item.severity ?? ""] }
        : { key: "actionRaidWhyNoOwner" as const, params: [item.severity ?? ""] };
      out.push({
        id: `raid:${item.id}:severity`,
        source: "raid",
        moduleId: "raid",
        title: { key: "actionRaidTitle" as const, params: [item.id, item.title] },
        why,
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "raid", id: item.id },
      });
    }

    // Review-due nudges deliberately carry NO clarity bonus: confidence weighting
    // applies only to the actionable severity signals in section (A).
    // (B) Review-due actions — overdue or stale items per getRaidReviewItems.
    // Gated by the "RAID review reminder" toggle; severity actions (A) always run.
    const reviewItems =
      input.raidReviewEnabled === false
        ? []
        : getRaidReviewItems(input.raid, input.today, input.raidReviewIntervalDays);
    for (const r of reviewItems) {
      const urgency = r.reason === "overdue" ? W.urgencyOverdue : 0;
      const staleness = stalenessScore(r.reason === "overdue" ? r.daysOverdue : r.daysSinceReview);
      const score = scoreAction({ urgency, staleness });
      const why =
        r.reason === "overdue"
          ? { key: "actionRaidWhyReviewOverdue" as const, params: [r.daysOverdue] }
          : { key: "actionRaidWhyReviewStale" as const, params: [r.daysSinceReview] };
      out.push({
        id: `raid:${r.item.id}:${r.reason}`,
        source: "raid",
        moduleId: "raid",
        title: { key: "actionRaidTitle" as const, params: [r.item.id, r.item.title] },
        why,
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "raid", id: r.item.id },
      });
    }

    return out;
  },
};
