import type { Task, Absence } from "./types";

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
    // Local date key (not toISOString/UTC) — holidays are keyed by local civil
    // dates, so UTC would be off by one for this day in UTC+ timezones.
    const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
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
 * or whose working-day-shifted reminder trigger has been reached. Sorted by
 * due date ascending.
 */
export function getAlertableTasks(
  tasks: readonly Task[],
  reminderLeadDays: number,
  today: string,
  holidays: Set<string>,
  absences: readonly Absence[],
): AlertableTask[] {
  const absMap = absenceDayMap(absences);
  const EMPTY: ReadonlySet<string> = new Set();
  const out: AlertableTask[] = [];
  for (const task of tasks) {
    if (!task.dueDate || task.completedDate) continue;
    if (task.dueDate < today) { out.push({ task, category: "overdue", workDaysLeft: 0 }); continue; }
    if (task.dueDate === today) { out.push({ task, category: "today", workDaysLeft: 0 }); continue; }
    const absenceDays = absMap.get(task.assignee.trim().toLowerCase()) ?? EMPTY;
    const trigger = shiftToWorkingDay(isoAddDays(task.dueDate, -reminderLeadDays), holidays, absenceDays);
    if (today >= trigger) {
      out.push({ task, category: "soon", workDaysLeft: workdaysUntil(task.dueDate, today, holidays) });
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

function isoAddDays(iso: string, delta: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isNonWorkingDay(iso: string, holidays: ReadonlySet<string>, absenceDays: ReadonlySet<string>): boolean {
  const dow = new Date(iso + "T00:00:00").getDay(); // 0 Sun .. 6 Sat
  return dow === 0 || dow === 6 || holidays.has(iso) || absenceDays.has(iso);
}

/**
 * Step `iso` (YYYY-MM-DD) backward to the nearest working day, skipping
 * weekends, holidays, and absence days. Bounded to 366 steps. Pure.
 */
export function shiftToWorkingDay(
  iso: string,
  holidays: ReadonlySet<string>,
  absenceDays: ReadonlySet<string>,
): string {
  let cur = iso;
  for (let i = 0; i < 366 && isNonWorkingDay(cur, holidays, absenceDays); i++) {
    cur = isoAddDays(cur, -1);
  }
  return cur;
}

/** Map case-folded assignee name -> set of YYYY-MM-DD covered by their absences (inclusive). */
export function absenceDayMap(absences: readonly Absence[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const a of absences) {
    const key = (a.assignee ?? "").trim().toLowerCase();
    if (!key || !a.startDate || !a.endDate) continue;
    let set = map.get(key);
    if (!set) { set = new Set(); map.set(key, set); }
    let cur = a.startDate;
    for (let i = 0; i < 366 && cur <= a.endDate; i++) {
      set.add(cur);
      cur = isoAddDays(cur, 1);
    }
  }
  return map;
}

// Re-exported so birthdays.ts computes event − leadDays with the same calendar math.
export { isoAddDays };
