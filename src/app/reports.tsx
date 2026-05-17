"use client";

import { useMemo } from "react";
import { workdaysUntil } from "./due-dates";
import {
  computeGroupHealth,
  type GroupHealth,
  type Health,
  type HealthDriver,
} from "./health";
import { type Lang, t } from "./i18n";
import { type Priority, PRIORITIES, type Task } from "./types";

type GroupOrLabelRow = {
  name: string;
  total: number;
  open: number;
  completed: number;
  overdue: number;
  inquiries: number;
};

type Stats = {
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

function computeStats(
  tasks: Task[],
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

export function ReportsPanel({
  tasks,
  today,
  holidaySet,
  lang,
}: {
  tasks: Task[];
  today: string;
  holidaySet: Set<string>;
  lang: Lang;
}) {
  const stats = useMemo(
    () => computeStats(tasks, today, holidaySet),
    [tasks, today, holidaySet],
  );

  if (stats.total === 0) {
    return (
      <div className="rounded-lg border border-dashed border-AIPM-light-grey p-10 text-center text-sm text-AIPM-medium-grey dark:border-zinc-800">
        {t(lang, "reportsEmpty")}
      </div>
    );
  }

  const completedTotal = stats.completedOnTime + stats.completedLate;

  // Group tasks by `task.group`, then compute RAG per group. Sorted R → A → G
  // so the worst workstreams float to the top — the steering-committee view.
  const groupHealth = useMemo(() => {
    const buckets = new Map<string, Task[]>();
    for (const task of tasks) {
      const key = (task.group ?? "").trim();
      const bucket = buckets.get(key);
      if (bucket) bucket.push(task);
      else buckets.set(key, [task]);
    }
    type Row = { name: string; isUngrouped: boolean; health: GroupHealth };
    const rows: Row[] = [];
    for (const [key, items] of buckets) {
      rows.push({
        name: key || t(lang, "reportsUngrouped"),
        isUngrouped: key === "",
        health: computeGroupHealth(items, today, holidaySet),
      });
    }
    const colorRank: Record<Health, number> = { R: 0, A: 1, G: 2 };
    rows.sort((a, b) => {
      const dr = colorRank[a.health.color] - colorRank[b.health.color];
      if (dr !== 0) return dr;
      // Within a color bucket, larger group first so the headline rows are
      // the workstreams that move the needle.
      const aTotal = a.health.counts.R + a.health.counts.A + a.health.counts.G;
      const bTotal = b.health.counts.R + b.health.counts.A + b.health.counts.G;
      if (bTotal !== aTotal) return bTotal - aTotal;
      return a.name.localeCompare(b.name);
    });
    return rows;
  }, [tasks, today, holidaySet, lang]);

  const groupDotClass: Record<Health, string> = {
    R: "bg-red-500",
    A: "bg-amber-500",
    G: "bg-emerald-500",
  };

  // Stable mapping from internal driver token to i18n key so the steering
  // line ("3 overdue, 1 blocked") translates correctly. "manual" / "onTrack"
  // / "completed" aren't shown on the cards — the color itself communicates
  // them.
  const driverKey: Record<HealthDriver,
    | "healthDriverManual"
    | "healthDriverOverdue"
    | "healthDriverBlocked"
    | "healthDriverDueToday"
    | "healthDriverDueSoon"
    | "healthDriverCompleted"
    | "healthDriverOnTrack"> = {
    manual: "healthDriverManual",
    overdue: "healthDriverOverdue",
    blocked: "healthDriverBlocked",
    dueToday: "healthDriverDueToday",
    dueSoon: "healthDriverDueSoon",
    completed: "healthDriverCompleted",
    onTrack: "healthDriverOnTrack",
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={t(lang, "reportsTotal")} value={stats.total} />
        <Tile label={t(lang, "reportsOpen")} value={stats.open} />
        <Tile
          label={t(lang, "reportsCompleted")}
          value={stats.completed}
        />
        <Tile
          label={t(lang, "reportsOverdue")}
          value={stats.overdue}
          danger={stats.overdue > 0}
        />
      </div>

      <Section title={t(lang, "reportsGroupHealth")}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {groupHealth.map((row) => (
            <div
              key={row.name}
              className="flex items-start gap-3 rounded-lg border border-AIPM-light-grey bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <span
                aria-hidden
                className={`mt-1 inline-block h-3 w-3 shrink-0 rounded-full ${groupDotClass[row.health.color]}`}
              />
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-sm font-medium ${
                    row.isUngrouped
                      ? "italic text-AIPM-medium-grey"
                      : "text-AIPM-dark-grey dark:text-AIPM-light-grey"
                  }`}
                  title={row.name}
                >
                  {row.name}
                </div>
                <div className="mt-0.5 text-[11px] text-AIPM-medium-grey">
                  {t(
                    lang,
                    "reportsGroupCounts",
                    row.health.counts.R,
                    row.health.counts.A,
                    row.health.counts.G,
                  )}
                </div>
                {row.health.drivers.length > 0 && (
                  <div className="mt-1 text-[11px] text-AIPM-dark-grey dark:text-AIPM-light-grey">
                    {row.health.drivers
                      .map((d) => t(lang, driverKey[d]))
                      .join(", ")}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t(lang, "reportsOpenByStatus")}>
        <StackedBar
          segments={[
            {
              value: stats.openByStatus.red,
              color: "bg-AIPM-pink",
              label: t(lang, "alertCatOverdue"),
            },
            {
              value: stats.openByStatus.yellow,
              color: "bg-amber-500",
              label: t(lang, "reportsDueSoon"),
            },
            {
              value: stats.openByStatus.green,
              color: "bg-AIPM-green",
              label: t(lang, "reportsOnTrack"),
            },
          ]}
          total={stats.open}
          emptyText={t(lang, "reportsNoOpen")}
        />
      </Section>

      <Section title={t(lang, "reportsCompletionOutcomes")}>
        {completedTotal === 0 ? (
          <p className="text-sm text-AIPM-medium-grey">
            {t(lang, "reportsNoCompletions")}
          </p>
        ) : (
          <StackedBar
            segments={[
              {
                value: stats.completedOnTime,
                color: "bg-AIPM-green",
                label: t(lang, "reportsCompletedOnTime"),
              },
              {
                value: stats.completedLate,
                color: "bg-AIPM-pink",
                label: t(lang, "reportsCompletedLate"),
              },
            ]}
            total={completedTotal}
          />
        )}
      </Section>

      <Section title={t(lang, "reportsInquiries")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile
            label={t(lang, "reportsInquiriesTotal")}
            value={stats.inquiriesTotal}
          />
          <Tile
            label={t(lang, "reportsInquiriesAvg")}
            value={stats.inquiriesAvg.toFixed(1)}
          />
          <Tile
            label={t(lang, "reportsInquiriesTasks")}
            value={stats.topInquiries.length}
          />
        </div>
        {stats.topInquiries.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-md border border-AIPM-light-grey dark:border-zinc-800">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-AIPM-light-grey/50 text-AIPM-dark-grey uppercase tracking-wide dark:bg-zinc-900 dark:text-AIPM-medium-grey">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">{t(lang, "task")}</th>
                  <th className="px-3 py-2 text-right">
                    {t(lang, "reportsInquiriesCol")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-AIPM-light-grey dark:divide-zinc-800">
                {stats.topInquiries.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 font-mono text-AIPM-medium-grey">
                      #{row.id}
                    </td>
                    <td className="px-3 py-2">{row.taskName}</td>
                    <td className="px-3 py-2 text-right font-medium">
                      {row.inquiriesSent}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={t(lang, "reportsByAssignee")}>
        <div className="overflow-x-auto rounded-md border border-AIPM-light-grey dark:border-zinc-800">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-AIPM-light-grey/50 text-AIPM-dark-grey uppercase tracking-wide dark:bg-zinc-900 dark:text-AIPM-medium-grey">
              <tr>
                <th className="px-3 py-2">{t(lang, "assignee")}</th>
                <th className="px-3 py-2 text-right">
                  {t(lang, "reportsTotal")}
                </th>
                <th className="px-3 py-2 text-right">
                  {t(lang, "reportsOpen")}
                </th>
                <th className="px-3 py-2 text-right">
                  {t(lang, "reportsOverdue")}
                </th>
                <th className="px-3 py-2 text-right">
                  {t(lang, "reportsCompletedOnTime")}
                </th>
                <th className="px-3 py-2 text-right">
                  {t(lang, "reportsCompletedLate")}
                </th>
                <th className="px-3 py-2 text-right">
                  {t(lang, "reportsInquiriesCol")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-AIPM-light-grey dark:divide-zinc-800">
              {stats.byAssignee.map((row) => (
                <tr key={row.name}>
                  <td className="px-3 py-2 font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">
                    {row.name}
                  </td>
                  <td className="px-3 py-2 text-right">{row.total}</td>
                  <td className="px-3 py-2 text-right">{row.open}</td>
                  <td
                    className={`px-3 py-2 text-right ${row.overdue > 0 ? "text-AIPM-pink font-semibold" : ""}`}
                  >
                    {row.overdue}
                  </td>
                  <td className="px-3 py-2 text-right text-AIPM-green">
                    {row.onTime}
                  </td>
                  <td className="px-3 py-2 text-right text-AIPM-pink">
                    {row.late}
                  </td>
                  <td className="px-3 py-2 text-right">{row.inquiries}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={t(lang, "reportsByPriority")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PRIORITIES.map((p) => (
            <Tile key={p} label={p} value={stats.byPriority[p] ?? 0} />
          ))}
        </div>
      </Section>

      <Section title={t(lang, "reportsByGroup")}>
        <GroupOrLabelTable
          rows={stats.byGroup}
          lang={lang}
          headerKey="group"
          emptyKey="reportsNoGroups"
        />
      </Section>

      <Section title={t(lang, "reportsByLabel")}>
        <GroupOrLabelTable
          rows={stats.byLabel}
          lang={lang}
          headerKey="labels"
          emptyKey="reportsNoLabels"
        />
      </Section>
    </div>
  );
}

function GroupOrLabelTable({
  rows,
  lang,
  headerKey,
  emptyKey,
}: {
  rows: GroupOrLabelRow[];
  lang: Lang;
  headerKey: "group" | "labels";
  emptyKey: "reportsNoGroups" | "reportsNoLabels";
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-AIPM-medium-grey">{t(lang, emptyKey)}</p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-AIPM-light-grey dark:border-zinc-800">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-AIPM-light-grey/50 text-AIPM-dark-grey uppercase tracking-wide dark:bg-zinc-900 dark:text-AIPM-medium-grey">
          <tr>
            <th className="px-3 py-2">{t(lang, headerKey)}</th>
            <th className="px-3 py-2 text-right">{t(lang, "reportsTotal")}</th>
            <th className="px-3 py-2 text-right">{t(lang, "reportsOpen")}</th>
            <th className="px-3 py-2 text-right">
              {t(lang, "reportsCompleted")}
            </th>
            <th className="px-3 py-2 text-right">
              {t(lang, "reportsOverdue")}
            </th>
            <th className="px-3 py-2 text-right">
              {t(lang, "reportsInquiriesCol")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-AIPM-light-grey dark:divide-zinc-800">
          {rows.map((row) => (
            <tr key={row.name}>
              <td className="px-3 py-2 font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">
                {row.name}
              </td>
              <td className="px-3 py-2 text-right">{row.total}</td>
              <td className="px-3 py-2 text-right">{row.open}</td>
              <td className="px-3 py-2 text-right text-AIPM-green">
                {row.completed}
              </td>
              <td
                className={`px-3 py-2 text-right ${row.overdue > 0 ? "text-AIPM-pink font-semibold" : ""}`}
              >
                {row.overdue}
              </td>
              <td className="px-3 py-2 text-right">{row.inquiries}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tile({
  label,
  value,
  danger,
}: {
  label: string;
  value: number | string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg border border-AIPM-light-grey bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs uppercase tracking-wide text-AIPM-medium-grey">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-semibold ${danger ? "text-AIPM-pink" : "text-AIPM-dark-blue dark:text-AIPM-light-grey"}`}
      >
        {value}
      </p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
        {title}
      </h3>
      {children}
    </div>
  );
}

function StackedBar({
  segments,
  total,
  emptyText,
}: {
  segments: Array<{ value: number; color: string; label: string }>;
  total: number;
  emptyText?: string;
}) {
  if (total === 0) {
    return (
      <p className="text-sm text-AIPM-medium-grey">
        {emptyText ?? "—"}
      </p>
    );
  }
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-AIPM-light-grey dark:bg-zinc-800">
        {segments.map((s, i) =>
          s.value > 0 ? (
            <div
              key={i}
              className={`${s.color} h-full`}
              style={{ width: `${(s.value / total) * 100}%` }}
              title={`${s.label}: ${s.value}`}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-AIPM-dark-grey dark:text-AIPM-medium-grey">
        {segments.map((s, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={`inline-block h-2 w-2 rounded-full ${s.color}`}
            />
            {s.label}: <span className="font-medium">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
