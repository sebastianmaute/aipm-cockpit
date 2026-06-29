// src/app/next-actions/providers/task-attention.ts
import { isTaskFinished } from "../../task-status";
import { scoreAction, bandTier, stalenessScore, ACTION_WEIGHTS } from "../score";
import type { ActionInput, ActionProvider, SuggestedAction } from "../types";
import type { Task } from "../../types";

const W = ACTION_WEIGHTS;
const STALE_DAYS = 14;

/** Whole-day gap between two YYYY-MM-DD dates; NaN if either is unparseable. */
function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(aISO);
  const b = Date.parse(bISO);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.floor((b - a) / 86_400_000);
}

/** Surfaces active tasks that cannot progress: no owner, gone stale, explicitly
 *  blocked, or waiting on an unfinished predecessor. Pure; core (no moduleId). */
export const taskAttentionProvider: ActionProvider = {
  provide(input: ActionInput): SuggestedAction[] {
    const cl = input.clarityBonus ?? W.clarityBonus;
    const sc = input.semiClarityBonus ?? W.semiClarityBonus;
    const byId = new Map<number, Task>(input.tasks.map((t) => [t.id, t]));
    const out: SuggestedAction[] = [];
    for (const task of input.tasks) {
      if (isTaskFinished(task)) continue;
      const base = {
        source: "task-attention" as const,
        title: { key: "actionTaskTitle" as const, params: [task.taskName] },
        cta: { kind: "open" as const, view: "open-points" as const, id: task.id },
      };
      if (task.assignee.trim() === "" && task.resourceId == null) {
        const score = scoreAction({ risk: W.riskHigh, clarity: cl });
        out.push({ ...base, id: `task-attention:${task.id}:unassigned`,
          why: { key: "actionTaskWhyUnassigned" }, score, tier: bandTier(score) });
      }
      // On-hold tasks are intentionally still flagged stale — isTaskFinished covers only Done/Cancelled, so on-hold items remain due for periodic review.
      const days = daysBetween(task.lastUpdateDate, input.today);
      if (Number.isFinite(days) && days >= STALE_DAYS) {
        const score = scoreAction({ staleness: stalenessScore(days), clarity: sc });
        out.push({ ...base, id: `task-attention:${task.id}:stale`,
          why: { key: "actionTaskWhyStale", params: [days] }, score, tier: bandTier(score) });
      }
      if (task.blockers.trim() !== "") {
        const score = scoreAction({ risk: W.riskHigh, clarity: cl });
        out.push({ ...base, id: `task-attention:${task.id}:blocked`,
          why: { key: "actionTaskWhyBlocked", params: [task.blockers.trim()] }, score, tier: bandTier(score) });
      }
      // First unfinished predecessor only — one :dep-blocked action per task (the id structure prevents a second).
      const dep = (task.dependencies ?? []).find((d) => {
        const pred = byId.get(d.taskId);
        return d.taskId !== task.id && pred != null && !isTaskFinished(pred);
      });
      if (dep) {
        const pred = byId.get(dep.taskId)!;
        const score = scoreAction({ impact: W.impactBlocksMilestone, clarity: cl });
        out.push({ ...base, id: `task-attention:${task.id}:dep-blocked`,
          why: { key: "actionTaskWhyDepBlocked", params: [pred.taskName] }, score, tier: bandTier(score) });
      }
    }
    return out;
  },
};
