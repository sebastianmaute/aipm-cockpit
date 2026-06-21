// src/app/reports-stats.ts — pure stats aggregation for the Reports view.
// i18n-free engine (per the repo's "engines live in plain modules; React
// surfaces import them" pattern); `reports.tsx` + `reports-tables.tsx` consume.
import { workdaysUntil } from "./due-dates";
import { type Priority, type Task } from "./types";

export type GroupOrLabelRow = {
  name: string;
  total: number;
  open: number;
  completed: number;
  overdue: number;
  inquiries: number;
};

export type Stats = {
  total: number;
  open: number;
  completed: number;
  overdue: number; // open and past due
  completedOnTime: number; // completedDate <= dueDate
  completedLate: number; // completedDate > dueDate
  inquiriesTotal: number;
  inquiriesAvg: number; // average per task that has inquiries
  openByStatus: { red: number; yellow: number; green: number };
  byPriority: Record<Priority, number>;
  topInquiries: Array<{
    id: number;
    taskName: string;
    inquiriesSent: number;
  }>;
  byAssignee: Array<{
    name: string;
    total: number;
    open: number;
    completed: number;
    overdue: number;
    inquiries: number;
    onTime: number;
    late: number;
  }>;
  byGroup: GroupOrLabelRow[];
  byLabel: GroupOrLabelRow[];
};

export function computeStats(
  tasks: readonly Task[],
  today: string,
  holidaySet: Set<string>,
): Stats {
  const stats: Stats = {
    total: tasks.length,
    open: 0,
    completed: 0,
    overdue: 0,
    completedOnTime: 0,
    completedLate: 0,
    inquiriesTotal: 0,
    inquiriesAvg: 0,
    openByStatus: { red: 0, yellow: 0, green: 0 },
    byPriority: { Low: 0, Medium: 0, High: 0, Urgent: 0 },
    topInquiries: [],
    byAssignee: [],
    byGroup: [],
    byLabel: [],
  };

  const assigneeMap = new Map<string, Stats["byAssignee"][number]>();
  const groupMap = new Map<string, GroupOrLabelRow>();
  const labelMap = new Map<string, GroupOrLabelRow>();
  function bump(map: Map<string, GroupOrLabelRow>, name: string, task: Task) {
    let row = map.get(name);
    if (!row) {
      row = {
        name,
        total: 0,
        open: 0,
        completed: 0,
        overdue: 0,
        inquiries: 0,
      };
      map.set(name, row);
    }
    row.total++;
    row.inquiries += task.inquiriesSent ?? 0;
    if (task.completedDate) row.completed++;
    else {
      row.open++;
      if (task.dueDate && task.dueDate < today) row.overdue++;
    }
  }
  let inquiryTaskCount = 0;

  for (const task of tasks) {
    stats.byPriority[task.priority] =
      (stats.byPriority[task.priority] ?? 0) + 1;

    const inquiries = task.inquiriesSent ?? 0;
    if (inquiries > 0) {
      stats.inquiriesTotal += inquiries;
      inquiryTaskCount++;
    }

    const isComplete = !!task.completedDate;
    if (isComplete) {
      stats.completed++;
      if (task.dueDate && task.completedDate) {
        if (task.completedDate <= task.dueDate) stats.completedOnTime++;
        else stats.completedLate++;
      }
    } else {
      stats.open++;
      if (task.dueDate) {
        if (task.dueDate < today) stats.overdue++;
        if (task.dueDate <= today) {
          stats.openByStatus.red++;
        } else {
          const days = workdaysUntil(task.dueDate, today, holidaySet);
          if (days <= 3) stats.openByStatus.yellow++;
          else stats.openByStatus.green++;
        }
      } else {
        stats.openByStatus.green++;
      }
    }

    const groupKey = (task.group ?? "").trim();
    bump(groupMap, groupKey || "—", task);
    const labels = task.labels ?? [];
    if (labels.length === 0) {
      bump(labelMap, "—", task);
    } else {
      for (const l of labels) {
        const k = l.trim();
        if (k) bump(labelMap, k, task);
      }
    }

    const aKey = task.assignee.trim() || "—";
    let entry = assigneeMap.get(aKey);
    if (!entry) {
      entry = {
        name: aKey,
        total: 0,
        open: 0,
        completed: 0,
        overdue: 0,
        inquiries: 0,
        onTime: 0,
        late: 0,
      };
      assigneeMap.set(aKey, entry);
    }
    entry.total++;
    entry.inquiries += inquiries;
    if (isComplete) {
      entry.completed++;
      if (task.dueDate && task.completedDate) {
        if (task.completedDate <= task.dueDate) entry.onTime++;
        else entry.late++;
      }
    } else {
      entry.open++;
      if (task.dueDate && task.dueDate < today) entry.overdue++;
    }
  }

  stats.inquiriesAvg =
    inquiryTaskCount > 0 ? stats.inquiriesTotal / inquiryTaskCount : 0;

  stats.topInquiries = tasks
    .filter((t) => (t.inquiriesSent ?? 0) > 0)
    .sort((a, b) => (b.inquiriesSent ?? 0) - (a.inquiriesSent ?? 0))
    .slice(0, 5)
    .map((t) => ({
      id: t.id,
      taskName: t.taskName,
      inquiriesSent: t.inquiriesSent ?? 0,
    }));

  stats.byAssignee = Array.from(assigneeMap.values()).sort(
    (a, b) => b.total - a.total,
  );
  stats.byGroup = Array.from(groupMap.values()).sort(
    (a, b) => b.total - a.total,
  );
  stats.byLabel = Array.from(labelMap.values()).sort(
    (a, b) => b.total - a.total,
  );

  return stats;
}
