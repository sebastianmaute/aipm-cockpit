"use client";
import { useCallback, useMemo, useState } from "react";
import { ArrowPathIcon } from "./icons";
import { type Lang, t, localeFor } from "./i18n";
import { computeBudgetReport, effectiveBudgetHours, costIsKnowable, type BucketReport } from "./budget-report";
import { CostUnknownNotice } from "./budget-cost-notice";
import { Cci } from "./budget-panel-cards";
import { BudgetBucketCard, cpiCciValue } from "./budget-panel-bucket-card";
import { generatePeriods, type Period } from "./resource-capacity";
import { useListReorderDnd } from "./use-list-reorder-dnd";
import { buildPlannedByResourcePeriod, useDetailedRoleRows } from "./budget-panel-people-rows";
import type { ActualsByBucket } from "./timelog-actuals";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { BudgetFxRollupNotice } from "./budget-fx-rollup-notice";
import type { Absence, BucketAllocation, BudgetBucket, Discipline, FxRates, Grade, Resource, ResourcePlan, Role, Task } from "./types";
import { BudgetBucketModal } from "./budget-bucket-modal";
import type { BucketCommitMeta } from "./use-budget-buckets";
import { mintId } from "./id-mint-session";
import { useColumnResize } from "./use-column-resize";
import { ResetColWidthsButton, ResetSizeButton } from "./task-manager-ui";
import { useResizable } from "./use-resizable";
import { TableFilter, nextSortDir, type SortDir } from "./report-table";
import { ratioHealth, marginHealth, costPerformanceHealth, costPerformanceIndexHealth } from "./budget-health";
import { InfoTooltip } from "./info-tooltip";
import { Button } from "./button";
import { ToggleButton } from "./toggle-button";
import { AddButton } from "./pane-toolbar";
import { AddFirstItemButton } from "./add-first-item-button";
import { ViewCallout } from "./view-callout";
import { BudgetUnappliedNotice } from "./budget-unapplied-notice";
import { computeProjectForecast } from "./budget-forecast";
import { BudgetForecastLink } from "./budget-forecast-link";
import { useConfirm } from "./confirm-dialog";
import { buildRowTokens } from "./row-tokens";

const BUDGET_COL_WIDTHS = {
  role: 160,
  period: 100,
} as const;
type BudgetCol = keyof typeof BUDGET_COL_WIDTHS;

export interface BudgetPanelProps {
  lang: Lang;
  buckets: readonly BudgetBucket[];
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  resources: readonly Resource[];
  plan: ResourcePlan;
  fxRates: FxRates | null;
  absences: readonly Absence[];
  holidaySet: Set<string>;
  workdayHours: number;
  today: string;
  /** Tasks available to the bucket editor's "linked tasks" picker (earned value). */
  tasks?: readonly Task[];
  /** Per-bucket, per-period Timelog actuals carrying the `byResource` breakdown
   *  the per-person rows report as BOOKED. Optional, and its absence is not a
   *  zero: a period with no breakdown renders "—" (unknown) all the way down.
   *  ★ `workspace-section` DOES wire this — from the per-device
   *  `timelog-actuals-store` cache (`loadActualsCache`) that `timelog-panel.tsx`
   *  writes, NOT from live sync state, so it is a DIFFERENT source from the role
   *  row's persisted `actualHours`; see the booked-vs-role-row follow-up. */
  actualsByBucket?: ActualsByBucket;
  /** `fetchedAt` of the per-device Timelog cache `actualsByBucket` came from.
   *  Drives the §122 source cue on the people rows; absent means this device
   *  has never fetched. */
  actualsFetchedAt?: string;
  onChangeBuckets: (next: BudgetBucket[], meta?: BucketCommitMeta) => void;
  onSetBudgetFollowsPlan?: (v: boolean) => void;
  onRefreshFx: () => void;
  fxLoading?: boolean;
  showHints?: boolean;
  isPopout?: boolean;
  onLearnMore?: (conceptId: string) => void;
  /** Cache key for the per-device TimeLog actuals the unapplied notice reads —
   *  the SAME one `TimelogPanel` writes under. Both it and `onGoToTimelog` are
   *  needed before the notice renders at all. */
  timelogProjectId?: string;
  onGoToTimelog?: () => void;
  /** Opens the Budget report tab (§6.4 link line). `workspace-section.tsx`
   *  omits this prop in a popout (Plan Ruling 12), so the link renders only
   *  when both this and a project forecast exist. */
  onOpenBudgetReport?: () => void;
}

/** Module-level so the default is one stable identity, not a fresh `{}` per render. */
const NO_ACTUALS: ActualsByBucket = {};
/** Same reason: the card's `detailedRows` for a bucket the map has no entry for. */
const NO_ROWS: readonly BucketAllocation[] = [];

function nextBucketId(buckets: readonly BudgetBucket[]): number {
  return mintId("budgetBucket", buckets);
}

function blankBucket(id: number, plan: ResourcePlan, today: string): BudgetBucket {
  return {
    id, name: `Bucket ${id}`, type: "tm", currency: "EUR",
    startDate: plan.startDate, endDate: plan.endDate, status: "open", allocations: [],
    createdDate: today,
  };
}

export function BudgetPanel(props: BudgetPanelProps) {
  const { lang, buckets, roles, resources, plan, fxRates, absences, holidaySet, workdayHours, showHints, isPopout, onLearnMore, onSetBudgetFollowsPlan, timelogProjectId, onGoToTimelog, onOpenBudgetReport, tasks = [], actualsByBucket = NO_ACTUALS, actualsFetchedAt } = props;
  const locale = localeFor(lang);
  const confirm = useConfirm();
  // Hoisted from `props.today` — a `react-hooks/exhaustive-deps` dep may not
  // be a member expression.
  const today = props.today;

  const report = useMemo(
    () => computeBudgetReport(buckets, plan, roles, resources, workdayHours, holidaySet, absences, tasks, fxRates),
    [buckets, plan, roles, resources, workdayHours, holidaySet, absences, tasks, fxRates],
  );
  // §6.4 Budget view link line: null without buckets (nothing to forecast) —
  // `computeProjectForecast` builds its own report/chain/burn-down, so this is
  // a second, cheap pass over the same inputs, not a reuse of `report` above.
  const forecast = useMemo(
    () => computeProjectForecast({ buckets, plan, roles, resources, workdayHours, holidaySet, absences, tasks, fxRates, today }),
    [buckets, plan, roles, resources, workdayHours, holidaySet, absences, tasks, fxRates, today],
  );

  const bucketById = useMemo(() => new Map(buckets.map((b) => [b.id, b])), [buckets]);
  // ★★ The rollup sums the engine's EUR figures and converts NOTHING, so it is
  // EUR regardless of what `plan.currency` says. Narrowing that field to the
  // `BudgetCurrency` union did NOT make it safe to label with: the union still
  // admits `USD`/`GBP`, so it states the plan's base currency, never the unit
  // of an unconverted engine figure. Labelling it
  // `plan.currency` printed EUR money under another currency's symbol
  // (docs/open-followups.md §465). The per-bucket tiles below are the other
  // case and stay as they are: they convert EUR→bucket currency (`inCur` /
  // `cci`) BEFORE labelling, so there the bucket's own currency is correct.
  const projCur = "EUR";

  // "Budget hours follow plan": when on, a resourced allocation's budget input
  // mirrors the live planned hours and becomes read-only. Scalars hoisted for
  // exhaustive-deps (no obj.member in dep arrays).
  const budgetFollowsPlan = plan.budgetFollowsPlan ?? false;
  const granularity = plan.granularity;
  // The budget value a cell shows — the SAME `effectiveBudgetHours` the report
  // aggregates through, so the cell and every bucket/CCI/RAG figure agree. When
  // the plan's budget follows planning AND the row is resourced it mirrors the
  // live planned capacity; otherwise it is the stored budgetHours entry.
  const resourcesById = useMemo(() => new Map(resources.map((r) => [r.id, r])), [resources]);
  const cellBudget = (
    alloc: { resourceIds: readonly number[]; budgetHours: Record<string, number> },
    period: Period, periods: readonly Period[],
  ): number =>
    effectiveBudgetHours(alloc, period, periods, resources, workdayHours, holidaySet, granularity, absences, budgetFollowsPlan, resourcesById);

  const { colWidths, startColResize, resetColWidths } = useColumnResize<BudgetCol>(
    "budget",
    BUDGET_COL_WIDTHS,
  );
  const startResize = startColResize as (col: string, e: React.MouseEvent) => void;

  const { ref: budgetRef, reset: resetBudgetSize } = useResizable("aipm-cockpit:budget-size");

  const [editingBucketId, setEditingBucketId] = useState<number | null>(null);
  const [roleFilter, setRoleFilter] = useState("");
  const [bucketFilter, setBucketFilter] = useState("");
  const [roleSort, setRoleSort] = useState<SortDir>("off");

  // `bucketId:roleId` keys. Collapsed by default and deliberately NOT persisted:
  // this is a momentary "who is behind this line?", not a view preference.
  const [openPeople, setOpenPeople] = useState<ReadonlySet<string>>(() => new Set());
  const togglePeople = useCallback((key: string) => {
    setOpenPeople((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // ONE derivation per render, over the plan's FULL period list — each bucket's
  // `bucketActivePeriods` is a filtered subset of it, so this map covers every
  // bucket by period key and no role line rebuilds it. Scalars hoisted for
  // exhaustive-deps (no `obj.member` in a dep array).
  const planStart = plan.startDate;
  const planEnd = plan.endDate;
  const plannedByResourcePeriod = useMemo(
    () => buildPlannedByResourcePeriod(
      resources, absences, generatePeriods(planStart, planEnd, granularity), workdayHours, holidaySet,
    ),
    [resources, absences, planStart, planEnd, granularity, workdayHours, holidaySet],
  );

  const bucketQuery = bucketFilter.trim().toLowerCase();
  const visibleBuckets = bucketQuery
    ? report.buckets.filter((b) => b.name.toLowerCase().includes(bucketQuery))
    : report.buckets;

  // WCAG 2.4.6 disambiguation tokens for the per-bucket controls. Bucket names
  // carry no uniqueness constraint (`budget-bucket-modal.tsx` enforces only
  // BUDGET_NAME_MAX), so two buckets can share one and their controls would
  // otherwise render byte-identical accessible names.
  //
  // ★★★ BUILT OVER `visibleBuckets`, THE RENDERED LIST — not over `buckets`.
  // The occurrence index has to follow what is on screen, and this list is both
  // FILTERED (`bucketQuery`) and REORDERED: `computeBudgetReport` sorts by
  // `order ?? id`, so `report.buckets` is not the prop's array order. Bucket ids
  // are `number`, which makes the `useRowTokens(buckets)` shortcut type-check —
  // and number the tokens by the wrong sequence.
  //
  // ★ A fresh Map every render, for the reason `sortedBucketIds()` below gives:
  // memoising would key on an array `visibleBuckets` rebuilds anyway under a filter.
  const bucketTokens = buildRowTokens(visibleBuckets.map((br) => ({ id: br.bucketId, name: br.name })));

  // Hoisted for exhaustive-deps inside the hook (no `obj.member` in a dep array).
  const disciplines = props.disciplines;
  const grades = props.grades;

  // Detailed (per-role) rows for every rendered, non-blended bucket, plus the
  // WCAG 2.4.6 disambiguation tokens for their people-disclosure triggers —
  // see budget-panel-people-rows.tsx's useDetailedRoleRows docstring.
  const { rowsByBucket: detailedRowsByBucket, roleTokens } = useDetailedRoleRows(
    visibleBuckets, bucketById, roles, disciplines, grades, roleFilter, roleSort,
  );

  const stamp = () => new Date().toISOString();

  const addBucket = () => {
    const id = nextBucketId(buckets);
    const fresh = blankBucket(id, plan, today);
    props.onChangeBuckets([...buckets, fresh], { kind: "budget.created", name: fresh.name });
    setEditingBucketId(id);
  };

  const updateBucket = (id: number, patch: Partial<BudgetBucket>) => {
    props.onChangeBuckets(
      buckets.map((b) => (b.id === id ? { ...b, ...patch, localModifiedAt: stamp() } : b)),
      { kind: "budget.updated", name: bucketById.get(id)?.name },
    );
  };

  const removeBucket = async (id: number) => {
    if (!(await confirm({ message: t(lang, "budgetRemoveBucketConfirm") }))) return;
    props.onChangeBuckets(
      buckets
        .filter((b) => b.id !== id)
        .map((b) => (b.successorId === id ? { ...b, successorId: null, localModifiedAt: stamp() } : b)),
      { kind: "budget.deleted", name: bucketById.get(id)?.name },
    );
  };

  const setCell = (
    bucketId: number, roleId: number, periodKey: string,
    field: "budgetHours" | "actualHours", value: number,
  ) => {
    props.onChangeBuckets(
      buckets.map((b) => {
        if (b.id !== bucketId) return b;
        const allocations = b.allocations.map((a) =>
          a.roleId === roleId ? { ...a, [field]: { ...a[field], [periodKey]: value } } : a,
        );
        return { ...b, allocations, localModifiedAt: stamp() };
      }),
      { kind: "budget.updated", name: bucketById.get(bucketId)?.name },
    );
  };

  const setDisciplineCell = (
    bucketId: number, disciplineId: number, periodKey: string,
    field: "budgetHours" | "actualHours", value: number,
  ) => {
    props.onChangeBuckets(
      buckets.map((b) => {
        if (b.id !== bucketId) return b;
        const disciplineAllocations = (b.disciplineAllocations ?? []).map((a) =>
          a.disciplineId === disciplineId ? { ...a, [field]: { ...a[field], [periodKey]: value } } : a,
        );
        return { ...b, disciplineAllocations, localModifiedAt: stamp() };
      }),
      { kind: "budget.updated", name: bucketById.get(bucketId)?.name },
    );
  };

  const sortedBucketIds = () =>
    [...buckets].sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id)).map((b) => b.id);

  // Reassign contiguous `order` (0,1,2,…) from an ordered id list. Only buckets
  // whose order actually changes get a fresh `localModifiedAt` stamp.
  const applyBucketOrder = (orderedIds: number[]) => {
    const orderById = new Map(orderedIds.map((id, idx) => [id, idx]));
    const ts = stamp();
    props.onChangeBuckets(
      buckets.map((b) => {
        const newOrder = orderById.get(b.id) ?? b.order ?? 0;
        return b.order === newOrder ? b : { ...b, order: newOrder, localModifiedAt: ts };
      }),
      { kind: "budget.updated" },
    );
  };

  // ★ `sortedBucketIds()` builds a fresh array every render. That is fine here —
  // the hook holds no memo on `ids` — and it keeps the order the rows render in
  // and the order the drag commits against derived from one expression.
  const bucketOrder = useListReorderDnd<number>({
    ids: sortedBucketIds(),
    onReorder: applyBucketOrder,
  });

  const disciplineNamesFor = (ids: readonly number[]) =>
    ids.map((id) => props.disciplines.find((d) => d.id === id)?.name).filter((n): n is string => !!n);

  return (
    <div ref={budgetRef} className={`print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`}>
      {onLearnMore && (
        <ViewCallout view="budget" lang={lang} showHints={showHints !== false} isPopout={!!isPopout} onLearnMore={onLearnMore} />
      )}
      {/* Above the bucket cards deliberately: editing allocations here is what
          makes cached bookings applicable, and this view otherwise points at
          Timelog nowhere at all. Read-only — it never writes a money figure. */}
      {timelogProjectId !== undefined && onGoToTimelog && (
        <BudgetUnappliedNotice
          lang={lang} projectId={timelogProjectId} buckets={buckets} roles={roles}
          resources={resources} granularity={plan.granularity} onGoToTimelog={onGoToTimelog}
        />
      )}
      {onOpenBudgetReport && forecast && (
        <BudgetForecastLink lang={lang} forecast={forecast} onOpen={onOpenBudgetReport} />
      )}
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-foreground">
          {t(lang, "tabBudget")}{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {t(lang, "budgetBucketsCount", report.buckets.length)}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          {!isPopout && onSetBudgetFollowsPlan ? (
            // ★ A bare `<input type="checkbox">` here was the odd one out: this is
            //   a binary display/behaviour switch in a row of toggle chips, and
            //   the shared primitive is what carries the non-colour pressed
            //   marker and the pinned-label/aria-pressed coherence a hand-rolled
            //   input has neither of (AGENTS.md: use ToggleButton, never a
            //   hand-rolled aria-pressed button — or, as here, a lone checkbox).
            // ★ The label already names what pressed=true ENABLES ("budget hours
            //   FOLLOW plan") and does not flip with state, so it satisfies the
            //   primitive's WCAG 4.1.2 contract as written.
            // ★ The InfoTooltip stays OUTSIDE the control so its hint text does
            //   not bleed into the name-from-content accessible name.
            <div className="flex items-center gap-1.5 text-sm print:hidden">
              <ToggleButton
                lang={lang}
                pressed={plan.budgetFollowsPlan ?? false}
                onToggle={() => onSetBudgetFollowsPlan(!(plan.budgetFollowsPlan ?? false))}
              >
                {t(lang, "budgetFollowsPlan")}
              </ToggleButton>
              <InfoTooltip text={t(lang, "budgetFollowsPlanHint")} />
            </div>
          ) : null}
          <AddButton onClick={addBucket}>
            + {t(lang, "budgetAddBucket")}
          </AddButton>
          {/* ★ `Button` already supplies `disabled:cursor-not-allowed
              disabled:opacity-50` in its base class — do not re-declare them
              here. The className is layout only, appended after the variant. */}
          <Button
            variant="secondary"
            size="xs"
            onClick={props.onRefreshFx}
            disabled={props.fxLoading}
            className="inline-flex items-center gap-1.5"
          >
            <ArrowPathIcon aria-hidden="true" className={`h-4 w-4 ${props.fxLoading ? "animate-spin" : ""}`} />
            {t(lang, "budgetFxRefresh")}
          </Button>
          <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
          <ResetSizeButton onClick={resetBudgetSize} lang={lang} />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-2">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
          {t(lang, "budgetTitle")} — {t(lang, "budgetProjectTotal")}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Cci label={t(lang, "budgetCciMargin")} hint={t(lang, "budgetCciMarginHint")} value={report.project.contributionMargin} currency={projCur} locale={locale} lang={lang} rag={marginHealth(report.project.contributionMargin.percent)} unknown={!costIsKnowable(report.project)} />
          <Cci label={t(lang, "budgetCciBurn")} hint={t(lang, "budgetCciBurnHint")} value={report.project.costPerformance} currency={projCur} locale={locale} lang={lang} rag={costPerformanceHealth(report.project.costPerformance.percent)} primary="percent" unknown={!costIsKnowable(report.project)} />
          <Cci label={t(lang, "budgetCciInternalCostIndex")} hint={t(lang, "budgetCciInternalCostIndexHint")} value={cpiCciValue(report.project.earnedValue, report.project.costPerformanceIndex)} currency={projCur} locale={locale} lang={lang} rag={costPerformanceIndexHealth(report.project.costPerformanceIndex)} primary="percent" unknown={report.project.costPerformanceIndex === null} />
          <Cci label={t(lang, "budgetCciConsumption")} hint={t(lang, "budgetCciConsumptionHint")} value={report.project.consumption} currency={projCur} locale={locale} lang={lang} rag={ratioHealth(report.project.consumedValue, report.project.budgetValue)} primary="percent" />
        </div>
        <CostUnknownNotice
          lang={lang}
          reason={report.project.costUnknownReason}
          disciplineNames={disciplineNamesFor(report.project.unpricedDisciplineIds)}
        />
        <BudgetFxRollupNotice lang={lang} buckets={buckets} fxRates={fxRates} />
      </section>

      <section className="flex flex-col gap-3">
        {/* ★★★ PANEL-WIDE, NOT PER-BUCKET. These two hints used to render inside
            every period cell of every role row (open-followups §246), i.e.
            2 x periods x roles focusable tab stops per bucket table all
            announcing one of the same two sentences. Rendering the legend once
            per BUCKET table would re-create that collision the moment a second
            bucket exists, so it lives here — outside the bucket map — where it
            renders exactly once however many buckets there are. Pinned by
            "states the Budget-hours hint exactly once across the whole panel"
            in budget-panel.test.tsx. */}
        {report.buckets.length > 0 && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              {t(lang, "budgetCellBudget")}
              <InfoTooltip text={t(lang, "budgetBudgetHoursHint")} />
            </span>
            <span className="flex items-center gap-1">
              {t(lang, "budgetCellActual")}
              <InfoTooltip text={t(lang, "budgetActualHoursHint")} />
            </span>
          </div>
        )}
        {report.buckets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <TableFilter lang={lang} value={roleFilter} onChange={setRoleFilter} placeholderKey="budgetRoleFilter" />
            <TableFilter lang={lang} value={bucketFilter} onChange={setBucketFilter} placeholderKey="budgetReportFilterBucket" />
          </div>
        )}
        {visibleBuckets.map((br: BucketReport) => (
          <BudgetBucketCard
            key={br.bucketId}
            // ★★ EVERY control inside this map is one of N identically-shaped
            // controls once a second bucket exists, so each takes this token
            // (open-followups §246). Bucket-UNIQUE, not merely bucket-QUALIFIED:
            // names are free text with no uniqueness constraint, so interpolating
            // `br.name` still collides when two buckets share one. The fallback is
            // only reached if a bucket is missing from the token map, which cannot
            // happen while the map is built over `visibleBuckets`.
            bucketToken={bucketTokens.get(br.bucketId) ?? br.name}
            lang={lang}
            locale={locale}
            br={br}
            bucket={bucketById.get(br.bucketId)!}
            roleTokens={roleTokens}
            detailedRows={detailedRowsByBucket.get(br.bucketId) ?? NO_ROWS}
            plan={plan}
            fxRates={fxRates}
            roles={roles}
            disciplines={disciplines}
            grades={grades}
            resources={resources}
            tasks={tasks}
            today={today}
            budgetFollowsPlan={budgetFollowsPlan}
            cellBudget={cellBudget}
            roleFilter={roleFilter}
            roleSort={roleSort}
            onSortRole={() => setRoleSort((d) => nextSortDir(d))}
            colWidths={colWidths}
            startResize={startResize}
            openPeople={openPeople}
            togglePeople={togglePeople}
            reorder={bucketOrder}
            actualsByBucket={actualsByBucket}
            plannedByResourcePeriod={plannedByResourcePeriod}
            actualsFetchedAt={actualsFetchedAt}
            onEdit={setEditingBucketId}
            onUpdateBucket={updateBucket}
            onRemoveBucket={removeBucket}
            onSetCell={setCell}
            onSetDisciplineCell={setDisciplineCell}
          />
        ))}
        {bucketQuery && visibleBuckets.length === 0 && (
          <p className="text-sm text-muted-foreground">{t(lang, "reportsNoMatches")}</p>
        )}
        {report.buckets.length === 0 && (
          <AddFirstItemButton onAdd={addBucket} addLabel={`+ ${t(lang, "budgetAddBucket")}…`} padding={6} />
        )}
      </section>
      {editingBucketId != null && bucketById.get(editingBucketId) && (
        <BudgetBucketModal
          lang={lang}
          bucket={bucketById.get(editingBucketId)!}
          allBuckets={buckets}
          roles={roles}
          disciplines={props.disciplines}
          grades={props.grades}
          resources={resources}
          tasks={tasks}
          onSave={(next) => {
            props.onChangeBuckets(buckets.map((b) => (b.id === next.id ? next : b)), { kind: "budget.updated", name: next.name });
            setEditingBucketId(null);
          }}
          onClose={() => setEditingBucketId(null)}
        />
      )}
      </div>
    </div>
  );
}
