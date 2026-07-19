"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "./empty-state";
import { Select } from "./form-controls";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";
import { useColumnResize } from "./use-column-resize";
import { useResizable } from "./use-resizable";
import { ColumnResizeHandle } from "./task-manager-ui";
import { InfoTooltip } from "./info-tooltip";
import { RagDot } from "./rag-dot";
import { DataTable } from "./data-table";
import { ReportCard, Section, Tile } from "./report-table";
import { Card } from "./card";
import {
  computeGroupHealth,
  type GroupHealth,
  type Health,
  type HealthDriver,
} from "./health";
import { computeStats } from "./reports-stats";
import {
  AssigneeTable,
  GroupOrLabelTable,
  REPORTS_ASSIGNEE_COL_WIDTHS,
  REPORTS_BY_X_COL_WIDTHS,
  REPORTS_INQUIRY_COL_WIDTHS,
  type AssigneeSort,
  type GroupOrLabelSort,
  type ReportsAssigneeCol,
  type ReportsByXCol,
  type ReportsInquiryCol,
  StackedBar,
} from "./reports-tables";
import { type Lang, t } from "./i18n";
import { PRIORITIES, type Task } from "./types";
import { RaidReportPanel } from "./raid-report-panel";
import { BudgetReportPanel } from "./budget-report-panel";
import { ResourcesReportPanel } from "./resources-report";
import { StakeholderReportPanel } from "./stakeholder-report-panel";
import { ADDABLE_REPORTS, type AddableReportId } from "./addable-reports";
import { ReportsViewsControl } from "./reports-views-control";
import { type ReportsViewState } from "./reports-views";
import { visibleReports, type FeatureModuleId, ALL_MODULE_IDS } from "./feature-modules";
import { ActionChips, chipsForView } from "./action-chips";
import type { AppView } from "./nav-config";
import type { SuggestedAction } from "./next-actions/types";
import type {
  Absence, BudgetBucket, Discipline, FxRates, Grade, Milestone, RaidItem, Resource, ResourcePlan, Role, Stakeholder,
} from "./types";

// Stats aggregation + its row/stat types live in the pure reports-stats.ts
// engine; the panel and the table sub-components import from there.

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
  // id -> Resource lookup so the by-assignee grouping keys off each linked
  // task's LIVE resource name (the stored `assignee` cache goes stale on rename).
  const resourcesById = useMemo(
    () => new Map(resources.map((r) => [r.id, r])),
    [resources],
  );
  const stats = useMemo(
    () => computeStats(tasks, today, holidaySet, resourcesById),
    [tasks, today, holidaySet, resourcesById],
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

  const moveReport = (id: AddableReportId, delta: number) => {
    const ids = [...extraReports];
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    onChangeExtraReports?.(ids);
  };

  const resetAllReports = () => {
    inquiry.resetColWidths();
    assignee.resetColWidths();
    byX.resetColWidths();
  };
  const { ref: reportsRef, reset: resetReportsSize } = useResizable("aipm-cockpit:reports-size");

  const reportsViewState: ReportsViewState = {
    assignee: { filter: assigneeFilter, sort: assigneeSort },
    group: { filter: groupFilter, sort: groupSort },
    label: { filter: labelFilter, sort: labelSort },
  };
  const applyReportsView = (s: ReportsViewState) => {
    setAssigneeFilter(s.assignee.filter);
    if (s.assignee.sort) setAssigneeSort(s.assignee.sort as AssigneeSort);
    setGroupFilter(s.group.filter);
    if (s.group.sort) setGroupSort(s.group.sort as GroupOrLabelSort);
    setLabelFilter(s.label.filter);
    if (s.label.sort) setLabelSort(s.label.sort as GroupOrLabelSort);
  };

  if (stats.total === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted-foreground">
        {t(lang, "reportsEmpty")}
      </div>
    );
  }

  const completedTotal = stats.completedOnTime + stats.completedLate;

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
    | "healthDriverCancelled"
    | "healthDriverOnTrack"> = {
    manual: "healthDriverManual",
    overdue: "healthDriverOverdue",
    blocked: "healthDriverBlocked",
    dueToday: "healthDriverDueToday",
    dueSoon: "healthDriverDueSoon",
    completed: "healthDriverCompleted",
    cancelled: "healthDriverCancelled",
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
      className={`rounded-md border border-ui-dark-blue bg-ui-dark-blue px-2 py-1.5 text-xs font-medium text-white hover:bg-ui-dark-blue/90 disabled:opacity-50 ${FOCUS_RING} ${TRANSITION}`}
    >
      {/* Options carry explicit readable colors: the select's white text would
          otherwise render white-on-white in Chrome's open dropdown popup. */}
      <option value="" className="bg-surface text-foreground">{remainingReports.length === 0 ? t(lang, "reportsAddReportNone") : `+ ${t(lang, "reportsAddReport")}`}</option>
      {remainingReports.map((r) => (
        <option key={r.id} value={r.id} className="bg-surface text-foreground">{t(lang, r.titleKey)}</option>
      ))}
    </select>
  );

  const removeReportControl = extraReports.length > 0 ? (
    <Select
      aria-label={t(lang, "reportsRemoveReport")}
      size="xs"
      value=""
      onChange={(e) => {
        const id = e.target.value as AddableReportId;
        if (id) onChangeExtraReports?.(extraReports.filter((x) => x !== id));
      }}
    >
      <option value="">{`− ${t(lang, "reportsRemoveReport")}`}</option>
      {extraReports.map((id) => {
        const meta = ADDABLE_REPORTS.find((r) => r.id === id);
        return meta ? <option key={id} value={id}>{t(lang, meta.titleKey)}</option> : null;
      })}
    </Select>
  ) : null;

  const REPORT_SOURCE_VIEW: Partial<Record<AddableReportId, AppView>> = {
    "raid-report": "raid",
    "budget-report": "budget",
    "stakeholder-report": "stakeholders",
    // resource-report: Resources is not an action source → no chips
  };

  const renderEmbedded = (id: AddableReportId) => {
    if (id === "raid-report") return <RaidReportPanel embedded lang={lang} items={raid} today={today} resourcesById={resourcesById} />;
    if (id === "budget-report") return plan ? <BudgetReportPanel embedded lang={lang} buckets={buckets} plan={plan} roles={roles} resources={resources} absences={absences} holidaySet={holidaySet} workdayHours={workdayHours} fxRates={fxRates} tasks={tasks} today={today} /> : null;
    if (id === "resource-report") return plan ? <ResourcesReportPanel embedded lang={lang} resources={resources} roles={roles} disciplines={disciplines} grades={grades} plan={plan} absences={absences} holidaySet={holidaySet} workdayHours={workdayHours} /> : null;
    if (id === "stakeholder-report") return <StakeholderReportPanel embedded lang={lang} stakeholders={stakeholders} milestones={milestones} />;
    return null;
  };

  return (
    <ReportCard lang={lang} sizeRef={reportsRef} onResetSize={resetReportsSize} onResetCols={resetAllReports} leading={<>{addReportControl}{removeReportControl}</>} toolbarExtra={<ReportsViewsControl lang={lang} currentState={reportsViewState} onApply={applyReportsView} />}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={t(lang, "reportsTotal")} value={stats.total} size="2xl" flat />
        <Tile label={t(lang, "reportsOpen")} value={stats.open} size="2xl" flat />
        <Tile
          label={t(lang, "reportsCompleted")}
          value={stats.completed}
          size="2xl"
          flat
        />
        <Tile
          label={t(lang, "reportsOverdue")}
          value={stats.overdue}
          danger={stats.overdue > 0}
          size="2xl"
          flat
        />
      </div>

      <Section title={t(lang, "reportsGroupHealth")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groupHealth.map((row) => (
            <Card
              key={row.name}
              className="flex items-start gap-3 p-3"
            >
              <RagDot level={row.health.color} size="lg" className="mt-1" />
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
            </Card>
          ))}
        </div>
      </Section>

      <Section title={t(lang, "reportsOpenByStatus")}>
        <StackedBar
          segments={[
            {
              value: stats.openByStatus.red,
              color: "bg-[var(--rag-red)]",
              label: t(lang, "alertCatOverdue"),
            },
            {
              value: stats.openByStatus.yellow,
              color: "bg-[var(--rag-amber)]",
              label: t(lang, "reportsDueSoon"),
            },
            {
              value: stats.openByStatus.green,
              color: "bg-[var(--rag-green)]",
              label: t(lang, "reportsOnTrack"),
            },
          ]}
          total={stats.open}
          emptyText={t(lang, "reportsNoOpen")}
        />
      </Section>

      <Section title={t(lang, "reportsCompletionOutcomes")}>
        {completedTotal === 0 ? (
          <EmptyState compact title={t(lang, "reportsNoCompletions")} />
        ) : (
          <StackedBar
            segments={[
              {
                value: stats.completedOnTime,
                color: "bg-[var(--rag-green)]",
                label: t(lang, "reportsCompletedOnTime"),
              },
              {
                value: stats.completedLate,
                color: "bg-[var(--rag-red)]",
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
            size="2xl"
            flat
          />
          <Tile
            label={t(lang, "reportsInquiriesAvg")}
            value={stats.inquiriesAvg.toFixed(1)}
            size="2xl"
            flat
          />
          <Tile
            label={t(lang, "reportsInquiriesTasks")}
            value={stats.topInquiries.length}
            size="2xl"
            flat
          />
        </div>
        {stats.topInquiries.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-md border border-line">
            <DataTable
              className="min-w-full text-left text-xs"
              head={
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
              }
              tbodyClassName="divide-y divide-line"
            >
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
            </DataTable>
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
            <Tile key={p} label={p} value={stats.byPriority[p] ?? 0} size="2xl" flat />
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
                  tabIndex={0}
                  onDragStart={() => setDragId(id)}
                  onDragEnd={() => setDragId(null)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      moveReport(id, -1);
                    } else if (e.key === "ArrowDown") {
                      e.preventDefault();
                      moveReport(id, 1);
                    }
                  }}
                  aria-label={t(lang, "reportReorderHandle")}
                  title={t(lang, "reportReorderHandle")}
                  className="cursor-grab touch-none select-none rounded px-1 py-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-green print:hidden"
                >
                  ⠿
                </button>
                <h3 className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">{t(lang, meta.titleKey)}</h3>
              </div>
              <button
                type="button"
                onClick={() => onChangeExtraReports?.(extraReports.filter((x) => x !== id))}
                aria-label={removeLabel}
                title={removeLabel}
                className={`rounded-md border border-transparent px-2 py-0.5 text-xs text-muted-foreground hover:border-ui-dark-blue hover:bg-surface-muted print:hidden ${INTERACTIVE}`}
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
