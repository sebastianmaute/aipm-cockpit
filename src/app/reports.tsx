"use client";

import { useMemo, useRef, useState } from "react";
import { useListReorderDnd } from "./use-list-reorder-dnd";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { useColumnResize } from "./use-column-resize";
import { useResizable } from "./use-resizable";
import { ReportCard } from "./report-table";
import { ArrangementGrid } from "./arrangement-grid";
import { ArrangementTile } from "./arrangement-tile";
import { useReportsArrangement } from "./use-reports-arrangement";
import { reportBlockById, type ReportBlockId } from "./report-blocks";
import {
  computeGroupHealth,
  type GroupHealth,
  type Health,
  type HealthDriver,
} from "./health";
import { computeStats } from "./reports-stats";
import {
  REPORTS_ASSIGNEE_COL_WIDTHS,
  REPORTS_BY_X_COL_WIDTHS,
  REPORTS_INQUIRY_COL_WIDTHS,
  type AssigneeSort,
  type GroupOrLabelSort,
  type ReportsAssigneeCol,
  type ReportsByXCol,
  type ReportsInquiryCol,
} from "./reports-tables";
// ★ The nine built-in block BODIES. This file keeps the state and every
// derivation; the bodies are presentational and take only what they read.
// ★★ THE `<Section>` WRAPPERS ARE GONE as of the arrangement binding — an
// earlier revision of this comment said this file kept them, which Task 12
// falsified. `ArrangementTile` draws the frame and the `<h3>` now.
// One-way dependency: reports.tsx → reports-blocks.tsx → reports-tables.tsx →
// reports-stats.ts.
import {
  ByAssigneeBlock,
  ByGroupBlock,
  ByLabelBlock,
  ByPriorityBlock,
  CompletionOutcomesBlock,
  GroupHealthBlock,
  InquiriesBlock,
  OpenByStatusBlock,
  StatsBlock,
} from "./reports-blocks";
import { type Lang, t } from "./i18n";
import { type Task } from "./types";
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

/** ★ Module-level so the default `extraReports` is ONE reference. An inline
 *  `= []` in the destructuring mints a new array every render, which is exactly
 *  the identity churn the prop's own docstring asks callers to avoid. */
const EMPTY_EXTRA_REPORTS: AddableReportId[] = [];

/** ★ Narrows a block id to one of the four embedded report panels. Those are
 *  the only blocks a feature module can switch off; the nine built-ins read
 *  from `tasks` and are always available. */
const isAddableReportId = (id: ReportBlockId): id is AddableReportId =>
  ADDABLE_REPORTS.some((r) => r.id === id);

export function ReportsPanel({
  tasks, today, holidaySet, lang,
  raid = [], buckets = [], plan, roles = [], disciplines = [], grades = [],
  resources = [], absences = [], workdayHours = 8, fxRates = null,
  extraReports = EMPTY_EXTRA_REPORTS,
  stakeholders = [], milestones = [],
  features = [...ALL_MODULE_IDS],
  nextActions = [], onOpenAction, onShowActions,
  projectId = "default",
  isPopout = false,
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
  /**
   * The retiring `settings.reports.extra`, now read for ONE purpose only: it is
   * the input to `useReportsArrangement`'s one-time migration seed. Order and
   * visibility belong to the arrangement from here on.
   *
   * ★★ STABLE REFERENCE, PLEASE. The seed closes over this array. A fresh
   * literal each render is harmless TODAY only because of `use-arrangement.ts`'s
   * internals — the seed sits in no dependency array — and that is an internal
   * fact, not a promise of this signature. The default is a module-level
   * constant rather than an inline `[]` for the same reason.
   */
  extraReports?: AddableReportId[];
  /**
   * ★★★ NO LONGER CALLED, AND THAT IS THE POINT OF THIS TASK — `reports.tsx`
   * stopped writing `settings.reports.extra` here, which is what makes
   * `use-reports-arrangement.ts`'s "the field retires" true rather than an
   * obligation. Add is now `arrangement.restore`, remove is hide (Task 13's ⋮),
   * and reorder is `arrangement.move`.
   *
   * ★★ DELIBERATELY LEFT ON THE TYPE, undestructured, so `workspace-section.tsx`
   * keeps compiling while this commit touches it for the two NEW props only —
   * the plan's ★ asks that its diff show nothing else. Removing this prop and
   * its call site is owed, and is a change to Settings' own surface rather than
   * to this one.
   */
  onChangeExtraReports?: (next: AddableReportId[]) => void;
  /** ★ `"default"` when absent, NEVER `""` or a number: `arrangement-store.ts`'s
   *  recency rule relies on project keys not being integer-like, because
   *  `Object.keys` lists integer-like keys first in ascending numeric order. */
  projectId?: string;
  /** ★ Must carry the REAL popout signal. Hardcoding `false` would let a popout
   *  persist and cross-write the main window's arrangement. */
  isPopout?: boolean;
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
      // ★★ This sums `counts` only, which since the §66 change EXCLUDES
      //    out-of-scope work — so the rank is IN-SCOPE size, not group size, and
      //    a mostly-cancelled group sorts below a smaller active one. That is
      //    deliberate and matches the sentence above (cancelled work does not
      //    move the needle), but it IS a silent behaviour change from before
      //    that release. Add `+ a.health.outOfScope` if raw group size is ever
      //    wanted back; `reports.test.tsx` pins the current order.
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
  // The card list scrolls in ReportCard's inner div, so THAT is what has to move
  // under the cursor during a drag — see `use-drag-autoscroll.ts` for why the
  // browser will not do it for us here. The hook drives the autoscroll itself.
  const cardsScrollRef = useRef<HTMLDivElement>(null);

  // ★★ THE ARRANGEMENT NOW OWNS ORDER AND VISIBILITY for all thirteen blocks,
  // built-in and addable alike — one mechanism, not two. The old
  // `useListReorderDnd<AddableReportId>` over `extraReports`, and the
  // `onReorder → onChangeExtraReports` write it drove, are both gone.
  const arrangement = useReportsArrangement({ projectId, extraReports, isPopout });
  const reorder = useListReorderDnd<ReportBlockId>({
    ids: arrangement.layout.board.map((b) => b.id),
    // ★ `onMove`, not `onReorder`: the engine splices by (dragged, target) and
    // owns the resulting order, so handing it a whole reordered id list would
    // be a second source of truth for the same move.
    onMove: arrangement.move,
    scrollRef: cardsScrollRef,
    disabled: arrangement.readOnly,
  });

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
    | "healthDriverClosed"
    | "healthDriverCancelled"
    | "healthDriverOnTrack"> = {
    manual: "healthDriverManual",
    overdue: "healthDriverOverdue",
    blocked: "healthDriverBlocked",
    dueToday: "healthDriverDueToday",
    dueSoon: "healthDriverDueSoon",
    completed: "healthDriverCompleted",
    closed: "healthDriverClosed",
    cancelled: "healthDriverCancelled",
    onTrack: "healthDriverOnTrack",
  };

  const enabledReportIds = new Set(visibleReports(ADDABLE_REPORTS.map((r) => r.id), features));
  // ★★ "Add report" is now RESTORE FROM THE SHELF, not a settings write. The
  // candidates are the addable reports this project has HIDDEN — which after the
  // one-time migration is exactly the set that was absent from
  // `settings.reports.extra` — intersected with the modules that are switched on.
  const hiddenIds = new Set<string>(arrangement.layout.hidden);
  const remainingReports = ADDABLE_REPORTS.filter(
    (r) => hiddenIds.has(r.id) && enabledReportIds.has(r.id),
  );
  const addReportControl = (
    <select
      aria-label={t(lang, "reportsAddReport")}
      value=""
      disabled={remainingReports.length === 0}
      onChange={(e) => {
        const id = e.target.value as AddableReportId;
        if (id) arrangement.restore(id);
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

  const REPORT_SOURCE_VIEW: Partial<Record<AddableReportId, AppView>> = {
    "raid-report": "raid",
    "budget-report": "budget",
    "stakeholder-report": "stakeholders",
    // resource-report: Resources is not an action source → no chips
  };

  const renderEmbedded = (id: AddableReportId) => {
    if (id === "raid-report") return <RaidReportPanel embedded lang={lang} items={raid} today={today} resourcesById={resourcesById} />;
    if (id === "budget-report") return plan ? <BudgetReportPanel embedded lang={lang} buckets={buckets} plan={plan} roles={roles} disciplines={disciplines} resources={resources} absences={absences} holidaySet={holidaySet} workdayHours={workdayHours} fxRates={fxRates} tasks={tasks} today={today} /> : null;
    if (id === "resource-report") return plan ? <ResourcesReportPanel embedded lang={lang} resources={resources} roles={roles} disciplines={disciplines} grades={grades} plan={plan} absences={absences} holidaySet={holidaySet} workdayHours={workdayHours} /> : null;
    if (id === "stakeholder-report") return <StakeholderReportPanel embedded lang={lang} stakeholders={stakeholders} milestones={milestones} />;
    return null;
  };

  /**
   * One block's BODY. ★★ The `<Section>` wrappers are gone: `ArrangementTile`
   * draws the bordered frame and the `<h3>` from the catalogue's `labelKey`, so a
   * body that titled itself would stack two borders and two identical headings —
   * the failure `docs/AGENTS/dashboard.md` records from the Dashboard.
   *
   * ★ Returns null for an addable report whose embedded panel cannot render (no
   * `plan`, say). `isRenderable` below tests exactly that, so the tile chrome is
   * never drawn over nothing.
   */
  const renderBlock = (id: ReportBlockId): React.ReactNode => {
    if (id === "stats") {
      return (
        <StatsBlock
          lang={lang}
          total={stats.total}
          cancelled={stats.cancelled}
          open={stats.open}
          completed={stats.completed}
          overdue={stats.overdue}
        />
      );
    }
    if (id === "groupHealth") return <GroupHealthBlock lang={lang} rows={groupHealth} driverKey={driverKey} />;
    if (id === "openByStatus") return <OpenByStatusBlock lang={lang} openByStatus={stats.openByStatus} open={stats.open} />;
    if (id === "completionOutcomes") {
      return (
        <CompletionOutcomesBlock
          lang={lang}
          completedOnTime={stats.completedOnTime}
          completedLate={stats.completedLate}
        />
      );
    }
    if (id === "inquiries") {
      return (
        <InquiriesBlock
          lang={lang}
          inquiriesTotal={stats.inquiriesTotal}
          inquiriesAvg={stats.inquiriesAvg}
          topInquiries={stats.topInquiries}
          colWidths={inquiry.colWidths}
          onStartResize={inquiryStartResize}
        />
      );
    }
    if (id === "byAssignee") {
      return (
        <ByAssigneeBlock
          lang={lang}
          rows={stats.byAssignee}
          colWidths={assignee.colWidths}
          onStartResize={assigneeStartResize}
          sort={assigneeSort}
          setSort={setAssigneeSort}
          filter={assigneeFilter}
          setFilter={setAssigneeFilter}
        />
      );
    }
    if (id === "byPriority") return <ByPriorityBlock byPriority={stats.byPriority} />;
    if (id === "byGroup") {
      return (
        <ByGroupBlock
          lang={lang}
          rows={stats.byGroup}
          colWidths={byX.colWidths}
          onStartResize={byXStartResize}
          sort={groupSort}
          setSort={setGroupSort}
          filter={groupFilter}
          setFilter={setGroupFilter}
        />
      );
    }
    if (id === "byLabel") {
      return (
        <ByLabelBlock
          lang={lang}
          rows={stats.byLabel}
          colWidths={byX.colWidths}
          onStartResize={byXStartResize}
          sort={labelSort}
          setSort={setLabelSort}
          filter={labelFilter}
          setFilter={setLabelFilter}
        />
      );
    }
    // The four addable reports embed a whole report panel. ★ The action chips
    // ride ABOVE the panel, exactly as they did in the old extra-report card.
    const body = renderEmbedded(id);
    if (!body) return null;
    const src = REPORT_SOURCE_VIEW[id];
    const chips = src && onOpenAction && onShowActions ? (
      <ActionChips
        lang={lang}
        actions={chipsForView(nextActions, src)}
        onOpen={onOpenAction}
        onShowMore={onShowActions}
        className="mb-2"
      />
    ) : null;
    return <>{chips}{body}</>;
  };

  /**
   * ★★ ONE PREDICATE, shared by the board and (from Task 13) the shelf. Two
   * copies drifted on the Dashboard: the shelf must never offer a block that
   * restoring cannot render, and a gated-off block must reappear the moment its
   * module returns. It tests the GATE and that a body actually exists — a body
   * that becomes conditional without its gate following would otherwise render
   * empty tile chrome, a frame and a heading over nothing.
   */
  const isRenderable = (id: ReportBlockId): boolean => {
    const spec = reportBlockById(id);
    if (!spec) return false;
    // ★★★ MODULE GATING FOR THE ADDABLE REPORTS IS DONE HERE, NOT BY
    // `spec.gate`, AND THAT IS A REAL TRAP THIS CAUGHT. `ReportBlockSpec.gate`
    // is optional and NOT ONE catalogue entry declares it today
    // (`grep -c "gate:" src/app/report-blocks.ts` → 0), so a `spec.gate &&`
    // test gates NOTHING — the first cut of this predicate did exactly that and
    // silently rendered the Stakeholder report with the Stakeholders module
    // switched off. `visibleReports` is what the pre-arrangement code used and
    // is still the authority for these four ids.
    // ★ The built-ins are ungated by design: they read from `tasks`, which is
    // always present.
    if (isAddableReportId(id) && !enabledReportIds.has(id)) return false;
    if (spec.gate && !spec.gate(features)) return false;
    return renderBlock(id) !== null;
  };

  // ★★ `previewOrder`, not the stored board: `grid-auto-flow: row dense`
  // re-places everything after a move, so rendering the committed order during
  // a drag would show the tile snapping to a slot it does not end up in.
  const sizeById = new Map(arrangement.layout.board.map((b) => [b.id, b]));
  const visible = reorder.previewOrder
    .map((id) => sizeById.get(id))
    .filter((b) => b !== undefined && isRenderable(b.id));

  return (
    <ReportCard lang={lang} sizeRef={reportsRef} contentRef={cardsScrollRef} onResetSize={resetReportsSize} onResetCols={resetAllReports} leading={addReportControl} toolbarExtra={<ReportsViewsControl lang={lang} currentState={reportsViewState} onApply={applyReportsView} />}>
      {/* ★★★ `auto-rows-[120px]` and `gap-4` are WHOLE LITERAL STRINGS. Tailwind
          v4 scans source for class candidates, so an interpolated value emits no
          CSS at all — and jsdom has no layout, so no unit test can see the
          difference. ★★ 120px, not the Dashboard's 80px: `BlockSpan` caps at 4,
          which would put an embedded report in a 320px box. The class assertion
          in `reports.test.tsx` is the only guard that exists for either. */}
      <ArrangementGrid rowClass="auto-rows-[120px]" gapClass="gap-4" testId="reports-grid">
        {visible.map((b) => {
          const spec = reportBlockById(b!.id)!;
          return (
            <ArrangementTile
              key={b!.id}
              id={b!.id}
              title={t(lang, spec.labelKey)}
              w={b!.w}
              h={b!.h}
              lang={lang}
              readOnly={arrangement.readOnly}
              testIdPrefix="report-block"
              dragProps={reorder.itemProps(b!.id)}
              handleProps={reorder.handleProps(b!.id)}
              // ★★★ INERT UNTIL TASK 13, which wires the ⋮ menu and the shelf.
              // It renders a control that does nothing, which is a false
              // affordance and must not survive this branch — the next task
              // replaces it with the real popover.
              onOpenMenu={() => {}}
            >
              {renderBlock(b!.id)}
            </ArrangementTile>
          );
        })}
      </ArrangementGrid>
    </ReportCard>
  );
}
