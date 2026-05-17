import type { Task } from "./types";

export function workdaysUntil(
  dueDate: string,
  today: string,
  holidays: Set<string>,
): number {
  if (dueDate <= today) return 0;
  const due = new Date(dueDate + "T00:00:00");
  const cur = new Date(today + "T00:00:00");
  let count = 0;
  while (cur < due) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay();
    if (day === 0 || day === 6) continue;
    const iso = cur.toISOString().slice(0, 10);
    if (holidays.has(iso)) continue;
    count++;
  }
  return count;
}

export type AlertCategory = "overdue" | "today" | "soon";

export type AlertableTask = {
  task: Task;
  category: AlertCategory;
  workDaysLeft: number; // 0 for overdue/today
};

/**
 * Returns tasks that should appear in due-date alerts: overdue, due today,
 * or due within `thresholdWorkDays` workdays. Sorted by due date ascending.
 */
export function getAlertableTasks(
  tasks: Task[],
  thresholdWorkDays: number,
  today: string,
  holidays: Set<string>,
): AlertableTask[] {
  const out: AlertableTask[] = [];
  for (const task of tasks) {
    if (!task.dueDate) continue;
    if (task.completedDate) continue;
    if (task.dueDate < today) {
      out.push({ task, category: "overdue", workDaysLeft: 0 });
      continue;
    }
    if (task.dueDate === today) {
      out.push({ task, category: "today", workDaysLeft: 0 });
      continue;
    }
    const days = workdaysUntil(task.dueDate, today, holidays);
    if (days <= thresholdWorkDays) {
      out.push({ task, category: "soon", workDaysLeft: days });
    }
  }
  out.sort((a, b) => a.task.dueDate.localeCompare(b.task.dueDate));
  return out;
}

export function summarizeAlerts(items: AlertableTask[]): {
  overdue: number;
  today: number;
  soon: number;
} {
  let overdue = 0;
  let today = 0;
  let soon = 0;
  for (const i of items) {
    if (i.category === "overdue") overdue++;
    else if (i.category === "today") today++;
    else soon++;
  }
  return { overdue, today, soon };
}
