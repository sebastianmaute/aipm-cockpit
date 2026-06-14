// src/app/next-actions/providers/task-due.ts
import { getAlertableTasks } from "../../due-dates";
import { scoreAction, bandTier, ACTION_WEIGHTS } from "../score";
import type { ActionInput, ActionProvider, SuggestedAction } from "../types";

const W = ACTION_WEIGHTS;

export const taskDueProvider: ActionProvider = {
  // no moduleId → core, always runs
  provide(input: ActionInput): SuggestedAction[] {
    if (input.taskDueEnabled === false) return []; // Settings → Notifications "due reminders" off
    const alerts = getAlertableTasks(
      input.tasks,
      input.reminderLeadDays,
      input.today,
      new Set<string>(),
      [],
    );
    return alerts.map((al): SuggestedAction => {
      const urgency =
        al.category === "overdue" ? W.urgencyOverdue : al.category === "today" ? W.urgencyToday : W.urgencySoon;
      const why =
        al.category === "overdue"
          ? { key: "actionTaskWhyOverdue" as const, params: [al.workDaysLeft] }
          : al.category === "today"
            ? { key: "actionTaskWhyToday" as const }
            : { key: "actionTaskWhySoon" as const, params: [al.workDaysLeft] };
      const score = scoreAction({ urgency, clarity: input.clarityBonus ?? W.clarityBonus });
      return {
        id: `task-due:${al.task.id}:${al.category}`,
        source: "task-due",
        title: { key: "actionTaskTitle", params: [al.task.taskName] },
        why,
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "open-points", id: al.task.id },
      };
    });
  },
};
