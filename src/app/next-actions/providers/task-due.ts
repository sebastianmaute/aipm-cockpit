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
      // i18n-free engine: the singular KEY is picked here (`count === 1`, the
      // same equivalence `tPlural` uses for en/de — see raid.ts) because no
      // `Lang` is in scope. §450: the overdue count is `workDaysOverdue`;
      // `workDaysLeft` is always 0 for an overdue task.
      const why =
        al.category === "overdue"
          ? { key: al.workDaysOverdue === 1 ? "actionTaskWhyOverdueOne" as const : "actionTaskWhyOverdue" as const, params: [al.workDaysOverdue] }
          : al.category === "today"
            ? { key: "actionTaskWhyToday" as const }
            : { key: al.workDaysLeft === 1 ? "actionTaskWhySoonOne" as const : "actionTaskWhySoon" as const, params: [al.workDaysLeft] };
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
