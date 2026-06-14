"use client";

import { useCallback, useMemo, useState } from "react";
import { workdaysUntil } from "./due-dates";
import { useColumnResize } from "./use-column-resize";
import { useResizable } from "./use-resizable";
import { ColumnResizeHandle } from "./task-manager-ui";
import { InfoTooltip } from "./info-tooltip";
import { TABLE_HEAD_CLASS } from "./table-styles";
import {
  useSortableFilter,
  TableFilter,
  ReportCard,
  SortHeaderButton,
  type SortDir,
} from "./report-table";
import {
  computeGroupHealth,
  type GroupHealth,
  type Health,
  type HealthDriver,
} from "./health";
import { type Lang, t } from "./i18n";
import { type Priority, PRIORITIES, type Task } from "./types";
import { RaidReportPanel } from "./raid-report-panel";
import { BudgetReportPanel } from "./budget-report-panel";
import { ResourcesReportPanel } from "./resources-report";
import { StakeholderReportPanel } from "./stakeholder-report-panel";
import { ADDABLE_REPORTS, type AddableReportId } from "./addable-reports";
import { visibleReports, type FeatureModuleId, ALL_MODULE_IDS } from "./feature-modules";
import { ActionChips, chipsForView } from "./action-chips";
import type { AppView } from "./nav-config";
import type { SuggestedAction } from "./next-actions/types";
import type {
  Absence, BudgetBucket, Discipline, FxRates, Grade, Milestone, RaidItem, Resource, ResourcePlan, Role, Stakeholder,
} from "./types";

const REPORTS_INQUIRY_COL_WIDTHS = {
  id: 60,
  task: 260,
  count: 90,
} as const;
type ReportsInquiryCol = keyof typeof REPORTS_INQUIRY_COL_WIDTHS;

const REPORTS_ASSIGNEE_COL_WIDTHS = {
  assignee: 160,
  total: 90,
  open: 90,
  overdue: 90,
  onTime: 90,
  late: 90,
  inquiries: 90,
} as const;
type ReportsAssigneeCol = keyof typeof REPORTS_ASSIGNEE_COL_WIDTHS;

const REPORTS_BY_X_COL_WIDTHS = {
  label: 180,
  total: 90,
  open: 90,
  completed: 90,
  overdue: 90,
  inquiries: 90,
} as const;
type ReportsByXCol = keyof typeof REPORTS_BY_X_COL_WIDTHS;

type AssigneeSortKey = "assignee" | "total" | "open" | "overdue" | "onTime" | "late" | "inquiries";
type AssigneeSort = { key: AssigneeSortKey; dir: SortDir };

type GroupOrLabelSortKey = "name" | "total" | "open" | "completed" | "overdue" | "inquiries";
type GroupOrLabelSort = { key: GroupOrLabelSortKey; dir: SortDir };

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

export function ReportsPanel({
  tasks, today, holidaySet, lang,
  raid = [], buckets = [], plan, roles = [], disciplines = [], grades = [],
  resources = [], absences = [], workdayHours = 8, fxRates = null,
  extraReports = [], onChangeExtraReports,
  stakeholders = [], milestones = [],
  features = [...ALL_MODULE_IDS],
  nextActions = [], onOpenAction, onShowActions,
}: {
  tasks: readonly Task[];
  today: string;
  holidaySet: Set<string>;
  lang: Lang;
  raid?: readonly RaidItem[];
  buckets?: readonly BudgetBucket[];
  plan?: ResourcePlan;
  roles?: readonly Role[];
  disciplines?: readonly Discipline[];
  grades?: readonly Grade[];
  resources?: readonly Resource[];
  absences?: readonly Absence[];
  workdayHours?: number;
  fxRates?: FxRates | null;
  extraReports?: AddableReportId[];
  onChangeExtraReports?: (next: AddableReportId[]) => void;
  stakeholders?: readonly Stakeholder[];
  milestones?: readonly Milestone[];
  features?: FeatureModuleId[];
  nextActions?: readonly SuggestedAction[];
  onOpenAction?: (a: SuggestedAction) => void;
  onShowActions?: () => void;
}) {
  const stats = useMemo(
    () => computeStats(tasks, today, holidaySet),
    [tasks, today, holidaySet],
  );

  // Group tasks by `task.group`, then compute RAG per group. Sorted R → A → G
  // so the worst workstreams float to the top — the steering-committee view.
  // Computed before the empty-state early return so hook order stays stable.
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

  const inquiry = useColumnResize<ReportsInquiryCol>("reportsInquiry", REPORTS_INQUIRY_COL_WIDTHS);
  const assignee = useColumnResize<ReportsAssigneeCol>("reportsAssignee", REPORTS_ASSIGNEE_COL_WIDTHS);
  const byX = useColumnResize<ReportsByXCol>("reportsByX", REPORTS_BY_X_COL_WIDTHS);
  const inquiryStartResize = inquiry.startColResize as (col: string, e: React.MouseEvent) => void;
  const assigneeStartResize = assignee.startColResize as (col: string, e: React.MouseEvent) => void;
  const byXStartResize = byX.startColResize as (col: string, e: React.MouseEvent) => void;
  const [assigneeSort, setAssigneeSort] = useState<AssigneeSort>({ key: "total", dir: "desc" });
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [groupSort, setGroupSort] = useState<GroupOrLabelSort>({ key: "total", dir: "desc" });
  const [groupFilter, setGroupFilter] = useState("");
  const [labelSort, setLabelSort] = useState<GroupOrLabelSort>({ key: "total", dir: "desc" });
  const [labelFilter, setLabelFilter] = useState("");
  const [dragId, setDragId] = useState<AddableReportId | null>(null);

  const onDropOnReport = (targetId: AddableReportId) => {
    if (dragId == null || dragId === targetId) return;
    const ids = [...extraReports];
    const fromIdx = ids.indexOf(dragId);
    const targetIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || targetIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(targetIdx, 0, dragId);
    onChangeExtraReports?.(ids);
  };

  const resetAllReports = () => {
    inquiry.resetColWidths();
    assignee.resetColWidths();
    byX.resetColWidths();
  };
  const { ref: reportsRef, reset: resetReportsSize } = useResizable("lop-app:reports-size");

  if (stats.total === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted-foreground">
        {t(lang, "reportsEmpty")}
      </div>
    );
  }

  const completedTotal = stats.completedOnTime + stats.completedLate;

  const groupDotClass: Record<Health, string> = {
    R: "bg-AIPM-pink",
    A: "bg-AIPM-purple",
    G: "bg-AIPM-green",
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

  const visibleExtra = visibleReports(extraReports, features);
  const enabledReportIds = new Set(visibleReports(ADDABLE_REPORTS.map((r) => r.id), features));
  const remainingReports = ADDABLE_REPORTS.filter(
    (r) => !extraReports.includes(r.id) && enabledReportIds.has(r.id),
  );
  const addReportControl = (
    <select
      aria-label={t(lang, "reportsAddReport")}
      value=""
      disabled={remainingReports.length === 0}
      onChange={(e) => {
        const id = e.target.value as AddableReportId;
        if (id) onChangeExtraReports?.([...extraReports, id]);
      }}
      className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs disabled:opacity-50"
    >
      <option value="">{remainingReports.length === 0 ? t(lang, "reportsAddReportNone") : `+ ${t(lang, "reportsAddReport")}`}</option>
      {remainingReports.map((r) => (
        <option key={r.id} value={r.id}>{t(lang, r.titleKey)}</option>
      ))}
    </select>
  );

  const removeReportControl = extraReports.length > 0 ? (
    <select
      aria-label={t(lang, "reportsRemoveReport")}
      value=""
      onChange={(e) => {
        const id = e.target.value as AddableReportId;
        if (id) onChangeExtraReports?.(extraReports.filter((x) => x !== id));
      }}
      className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs"
    >
      <option value="">{`− ${t(lang, "reportsRemoveReport")}`}</option>
      {extraReports.map((id) => {
        const meta = ADDABLE_REPORTS.find((r) => r.id === id);
        return meta ? <option key={id} value={id}>{t(lang, meta.titleKey)}</option> : null;
      })}
    </select>
  ) : null;

  const REPORT_SOURCE_VIEW: Partial<Record<AddableReportId, AppView>> = {
    "raid-report": "raid",
    "budget-report": "budget",
    "stakeholder-report": "stakeholders",
    // resource-report: Resources is not an action source → no chips
  };

  const renderEmbedded = (id: AddableReportId) => {
    if (id === "raid-report") return <RaidReportPanel embedded lang={lang} items={raid} today={today} />;
    if (id === "budget-report") return plan ? <BudgetReportPanel embedded lang={lang} buckets={buckets} plan={plan} roles={roles} resources={resources} absences={absences} holidaySet={holidaySet} workdayHours={workdayHours} fxRates={fxRates} tasks={tasks} today={today} /> : null;
    if (id === "resource-report") return plan ? <ResourcesReportPanel embedded lang={lang} resources={resources} roles={roles} disciplines={disciplines} grades={grades} plan={plan} absences={absences} holidaySet={holidaySet} workdayHours={workdayHours} /> : null;
    if (id === "stakeholder-report") return <StakeholderReportPanel embedded lang={lang} stakeholders={stakeholders} milestones={milestones} />;
    return null;
  };

  return (
    <ReportCard lang={lang} sizeRef={reportsRef} onResetSize={resetReportsSize} onResetCols={resetAllReports} toolbarExtra={<>{addReportControl}{removeReportControl}</>} title={t(lang, "tabReports")}>
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
              className="flex items-start gap-3 rounded-lg border border-line bg-surface p-3"
            >
              <span
                aria-hidden
                className={`mt-1 inline-block h-3 w-3 shrink-0 rounded-full ${groupDotClass[row.health.color]}`}
              />
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-sm font-medium ${
                    row.isUngrouped
                      ? "italic text-muted-foreground"
                      : "text-foreground"
                  }`}
                  title={row.name}
                >
                  {row.name}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {t(
                    lang,
                    "reportsGroupCounts",
                    row.health.counts.R,
                    row.health.counts.A,
                    row.health.counts.G,
                  )}
                </div>
                {row.health.drivers.length > 0 && (
                  <div className="mt-1 text-[11px] text-foreground">
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
              color: "bg-AIPM-purple",
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
          <p className="text-sm text-muted-foreground">
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
          <div className="mt-3 overflow-x-auto rounded-md border border-line">
            <table className="min-w-full text-left text-xs">
              <thead className={TABLE_HEAD_CLASS}>
                <tr>
                  <th className="relative px-3 py-2" style={{ width: inquiry.colWidths.id, minWidth: inquiry.colWidths.id }}>
                    #
                    <ColumnResizeHandle col="id" onMouseDown={inquiryStartResize} />
                  </th>
                  <th className="relative px-3 py-2" style={{ width: inquiry.colWidths.task, minWidth: inquiry.colWidths.task }}>
                    {t(lang, "task")}
                    <ColumnResizeHandle col="task" onMouseDown={inquiryStartResize} />
                  </th>
                  <th className="relative px-3 py-2 text-right" style={{ width: inquiry.colWidths.count, minWidth: inquiry.colWidths.count }}>
                    {t(lang, "reportsInquiriesCol")}
                    <InfoTooltip text={t(lang, "reportsInquiriesColHint")} />
                    <ColumnResizeHandle col="count" onMouseDown={inquiryStartResize} />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {stats.topInquiries.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 font-mono text-muted-foreground">
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
        <AssigneeTable
          rows={stats.byAssignee}
          lang={lang}
          colWidths={assignee.colWidths}
          onStartResize={assigneeStartResize}
          sort={assigneeSort}
          setSort={setAssigneeSort}
          filter={assigneeFilter}
          setFilter={setAssigneeFilter}
        />
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
          colWidths={byX.colWidths}
          onStartResize={byXStartResize}
          sort={groupSort}
          setSort={setGroupSort}
          filter={groupFilter}
          setFilter={setGroupFilter}
          filterPlaceholderKey="reportsFilterGroup"
        />
      </Section>

      <Section title={t(lang, "reportsByLabel")}>
        <GroupOrLabelTable
          rows={stats.byLabel}
          lang={lang}
          headerKey="labels"
          emptyKey="reportsNoLabels"
          colWidths={byX.colWidths}
          onStartResize={byXStartResize}
          sort={labelSort}
          setSort={setLabelSort}
          filter={labelFilter}
          setFilter={setLabelFilter}
          filterPlaceholderKey="reportsFilterLabel"
        />
      </Section>

      {visibleExtra.map((id) => {
        const meta = ADDABLE_REPORTS.find((r) => r.id === id);
        const body = meta ? renderEmbedded(id) : null;
        if (!meta || !body) return null;
        const removeLabel = `${t(lang, "reportsRemoveReport")}: ${t(lang, meta.titleKey)}`;
        return (
          <div
            key={id}
            data-testid="extra-report-card"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDropOnReport(id)}
            className={dragId != null && dragId !== id ? "opacity-70" : undefined}
          >
            <div className="mb-2 flex items-center justify-between gap-2 border-t border-line pt-4">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  draggable
                  onDragStart={() => setDragId(id)}
                  onDragEnd={() => setDragId(null)}
                  aria-label="Drag to reorder"
                  title="Drag to reorder"
                  className="cursor-grab touch-none rounded px-1 py-0.5 text-muted-foreground hover:text-foreground print:hidden"
                >
                  ⠿
                </button>
                <h3 className="text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, meta.titleKey)}</h3>
              </div>
              <button
                type="button"
                onClick={() => onChangeExtraReports?.(extraReports.filter((x) => x !== id))}
                aria-label={removeLabel}
                title={removeLabel}
                className="rounded-md border border-transparent px-2 py-0.5 text-xs text-muted-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted print:hidden"
              >
                ×
              </button>
            </div>
            {(() => {
              const src = REPORT_SOURCE_VIEW[id];
              if (!src || !onOpenAction || !onShowActions) return null;
              return (
                <ActionChips
                  lang={lang}
                  actions={chipsForView(nextActions, src)}
                  onOpen={onOpenAction}
                  onShowMore={onShowActions}
                  className="mb-2"
                />
              );
            })()}
            {body}
          </div>
        );
      })}

    </ReportCard>
  );
}

function GroupOrLabelTable({
  rows,
  lang,
  headerKey,
  emptyKey,
  colWidths,
  onStartResize,
  sort,
  setSort,
  filter,
  setFilter,
  filterPlaceholderKey,
}: {
  rows: GroupOrLabelRow[];
  lang: Lang;
  headerKey: "group" | "labels";
  emptyKey: "reportsNoGroups" | "reportsNoLabels";
  colWidths: Record<string, number>;
  onStartResize: (col: string, e: React.MouseEvent) => void;
  sort: GroupOrLabelSort;
  setSort: (s: GroupOrLabelSort) => void;
  filter: string;
  setFilter: (v: string) => void;
  filterPlaceholderKey: "reportsFilterGroup" | "reportsFilterLabel";
}) {
  const getValue = useCallback(
    (r: GroupOrLabelRow, k: GroupOrLabelSortKey): string | number =>
      k === "name" ? r.name : (r[k as Exclude<GroupOrLabelSortKey, "name">] ?? 0),
    [],
  );
  const { sorted, click } = useSortableFilter(rows, sort, setSort, filter, getValue);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t(lang, emptyKey)}</p>;
  }

  return (
    <div>
      <TableFilter lang={lang} value={filter} onChange={setFilter} placeholderKey={filterPlaceholderKey} />
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-xs">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="relative px-3 py-2" style={{ width: colWidths.label, minWidth: colWidths.label }}>
                <SortHeaderButton
                  label={t(lang, headerKey)}
                  active={sort.key === "name" && sort.dir !== "off"}
                  dir={sort.dir}
                  onClick={() => click("name")}
                />
                <ColumnResizeHandle col="label" onMouseDown={onStartResize} />
              </th>
              {(["total", "open", "completed", "overdue", "inquiries"] as const).map((k) => {
                const labelKey = {
                  total: "reportsTotal",
                  open: "reportsOpen",
                  completed: "reportsCompleted",
                  overdue: "reportsOverdue",
                  inquiries: "reportsInquiriesCol",
                } as const;
                const active = sort.key === k && sort.dir !== "off";
                return (
                  <th key={k} className="relative px-3 py-2 text-right" style={{ width: colWidths[k], minWidth: colWidths[k] }}>
                    <SortHeaderButton
                      label={t(lang, labelKey[k])}
                      active={active}
                      dir={sort.dir}
                      onClick={() => click(k)}
                    />
                    <ColumnResizeHandle col={k} onMouseDown={onStartResize} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.length === 0 && filter !== "" ? (
              <tr>
                <td colSpan={6} className="px-3 py-3 text-center text-xs text-muted-foreground">
                  {t(lang, "reportsNoMatches")}
                </td>
              </tr>
            ) : (
              sorted.map((row) => (
                <tr key={row.name}>
                  <td className="px-3 py-2 font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">{row.name}</td>
                  <td className="px-3 py-2 text-right">{row.total}</td>
                  <td className="px-3 py-2 text-right">{row.open}</td>
                  <td className="px-3 py-2 text-right text-AIPM-green-strong">{row.completed}</td>
                  <td className={`px-3 py-2 text-right ${row.overdue > 0 ? "text-AIPM-pink-strong font-semibold" : ""}`}>{row.overdue}</td>
                  <td className="px-3 py-2 text-right">{row.inquiries}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AssigneeTable({
  rows,
  lang,
  colWidths,
  onStartResize,
  sort,
  setSort,
  filter,
  setFilter,
}: {
  rows: Stats["byAssignee"];
  lang: Lang;
  colWidths: Record<ReportsAssigneeCol, number>;
  onStartResize: (col: string, e: React.MouseEvent) => void;
  sort: AssigneeSort;
  setSort: (s: AssigneeSort) => void;
  filter: string;
  setFilter: (v: string) => void;
}) {
  const getValue = useCallback(
    (r: Stats["byAssignee"][number], k: AssigneeSortKey): string | number =>
      k === "assignee" ? r.name : (r[k as Exclude<AssigneeSortKey, "assignee">] ?? 0),
    [],
  );
  const { sorted, click } = useSortableFilter(rows, sort, setSort, filter, getValue);

  return (
    <div>
      {rows.length > 0 && (
        <TableFilter lang={lang} value={filter} onChange={setFilter} placeholderKey="reportsFilterAssignee" />
      )}
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-xs">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="relative px-3 py-2" style={{ width: colWidths.assignee, minWidth: colWidths.assignee }}>
                <SortHeaderButton
                  label={t(lang, "assignee")}
                  active={sort.key === "assignee" && sort.dir !== "off"}
                  dir={sort.dir}
                  onClick={() => click("assignee")}
                />
                <ColumnResizeHandle col="assignee" onMouseDown={onStartResize} />
              </th>
              {(["total", "open", "overdue", "onTime", "late", "inquiries"] as const).map((k) => {
                const labelKey = {
                  total: "reportsTotal",
                  open: "reportsOpen",
                  overdue: "reportsOverdue",
                  onTime: "reportsCompletedOnTime",
                  late: "reportsCompletedLate",
                  inquiries: "reportsInquiriesCol",
                } as const;
                const active = sort.key === k && sort.dir !== "off";
                return (
                  <th key={k} className="relative px-3 py-2 text-right" style={{ width: colWidths[k], minWidth: colWidths[k] }}>
                    <SortHeaderButton
                      label={t(lang, labelKey[k])}
                      active={active}
                      dir={sort.dir}
                      onClick={() => click(k)}
                    />
                    <ColumnResizeHandle col={k} onMouseDown={onStartResize} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.length === 0 && filter !== "" ? (
              <tr>
                <td colSpan={7} className="px-3 py-3 text-center text-xs text-muted-foreground">
                  {t(lang, "reportsNoMatches")}
                </td>
              </tr>
            ) : (
              sorted.map((row) => (
                <tr key={row.name}>
                  <td className="px-3 py-2 font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">{row.name}</td>
                  <td className="px-3 py-2 text-right">{row.total}</td>
                  <td className="px-3 py-2 text-right">{row.open}</td>
                  <td className={`px-3 py-2 text-right ${row.overdue > 0 ? "text-AIPM-pink-strong font-semibold" : ""}`}>{row.overdue}</td>
                  <td className="px-3 py-2 text-right text-AIPM-green-strong">{row.onTime}</td>
                  <td className="px-3 py-2 text-right text-AIPM-pink-strong">{row.late}</td>
                  <td className="px-3 py-2 text-right">{row.inquiries}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
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
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-semibold ${danger ? "text-AIPM-pink-strong" : "text-AIPM-dark-blue dark:text-AIPM-light-grey"}`}
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
      <p className="text-sm text-muted-foreground">
        {emptyText ?? "—"}
      </p>
    );
  }
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-muted">
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
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
