"use client";
import { Fragment, useCallback, useMemo, useState } from "react";
import { ArrowPathIcon } from "./icons";
import { type Lang, t, localeFor } from "./i18n";
import { formatCurrency } from "./resource-cost";
import { computeBudgetReport, bucketActivePeriods, effectiveBudgetHours, costIsKnowable, type BucketReport, type CciValue } from "./budget-report";
import { CostUnknownNotice } from "./budget-cost-notice";
import { bucketPercentComplete } from "./budget-earned-value";
import { describeClamp } from "./sanitize-report";
import { generatePeriods, type Period } from "./resource-capacity";
import { useListReorderDnd } from "./use-list-reorder-dnd";
import { DragHandle } from "./drag-handle";
import {
  BucketRolePeople, PeopleDisclosureLabel, buildPlannedByResourcePeriod,
  filterSortAllocations, useDetailedRoleRows,
} from "./budget-panel-people-rows";
import type { ActualsByBucket } from "./timelog-actuals";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { roleLabel } from "./resource-foundation";
import { eurToCurrency, resolveRate } from "./fx";
import type { Absence, BudgetBucket, Discipline, FxRates, Grade, Resource, ResourcePlan, Role, Task } from "./types";
import { BudgetBucketModal } from "./budget-bucket-modal";
import type { BucketCommitMeta } from "./use-budget-buckets";
import { mintId } from "./id-mint-session";
import { useColumnResize } from "./use-column-resize";
import { useCommitDraft } from "./use-commit-draft";
import { ColumnResizeHandle, ResetColWidthsButton, ResetSizeButton } from "./task-manager-ui";
import { DataTable } from "./data-table";
import { useResizable } from "./use-resizable";
import { RagBadge } from "./rag-badge";
import { TableFilter, SortResizeTh, nextSortDir, type SortDir } from "./report-table";
import {
  ratioHealth, marginHealth, costPerformanceHealth, costPerformanceIndexHealth,
  winLossHealth, planVsBudgetHealth,
} from "./budget-health";
import type { Health } from "./health";
import { InfoTooltip } from "./info-tooltip";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { Button } from "./button";
import { ToggleButton } from "./toggle-button";
import { AddButton } from "./pane-toolbar";
import { AddFirstItemButton } from "./add-first-item-button";
import { ViewCallout } from "./view-callout";
import { BudgetUnappliedNotice } from "./budget-unapplied-notice";
import { useConfirm } from "./confirm-dialog";
import {
  DOT_COL_PX, TOTAL_COL_PX, HoursTd, BucketRowLeadCells, BucketTotalRow, bucketColumnTotals,
  type TotalsRow,
} from "./budget-panel-totals";

const BUDGET_COL_WIDTHS = {
  role: 160,
  period: 100,
} as const;
type BudgetCol = keyof typeof BUDGET_COL_WIDTHS;

function sumPeriods(hours: Record<string, number>, periods: { key: string }[]): number {
  return periods.reduce((s, p) => s + (hours[p.key] ?? 0), 0);
}

/** The bucket's Manual % complete, editable without opening the bucket modal.
 *  The placeholder shows the task-derived percentage so the override
 *  relationship is visible in place. */
function ManualPercentCell({
  lang, bucket, tasks, onCommit,
}: {
  lang: Lang;
  bucket: BudgetBucket;
  /** OPTIONAL on the panel — a caller that omits it gets no derived hint, never
   *  a misleading 0 %. */
  tasks: readonly Task[] | undefined;
  onCommit: (pct: number | undefined) => void;
}) {
  const derived = bucket.percentComplete === undefined && tasks
    ? bucketPercentComplete({ taskIds: bucket.taskIds, percentComplete: undefined }, tasks)
    : null;
  // Clearing the box must write `undefined`, NOT 0: `bucketPercentComplete`
  // treats a manual 0 as a real override that wins over the task derivation,
  // so a 0 would pin the bucket at 0 % forever.
  const draft = useCommitDraft(
    bucket.percentComplete === undefined ? "" : String(bucket.percentComplete),
    (raw) => onCommit(describeClamp(raw, { min: 0, max: 100, round: 2 }).value),
  );
  return (
    <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
      {t(lang, "budgetPercentComplete")}
      <InfoTooltip text={t(lang, "budgetPercentCompleteHint")} />
      <input
        // ★★ Bucket-QUALIFIED, which is NOT bucket-UNIQUE — an earlier revision
        // of this comment read as if the qualifier closed 2.4.6, and it does
        // not. N identical "Manual % complete" labels is a WCAG 2.4.6 failure
        // the axe gate cannot see (of axe-core 4.12.1's rules, not one carrying
        // a tag e2e/a11y.spec.ts requests flags two controls sharing a name),
        // and appending the bucket name fixes only the ordinary case. The
        // RESIDUAL case is live: `budget-bucket-modal.tsx` edits the name as
        // free text with no uniqueness constraint (only `BUDGET_NAME_MAX`), so
        // two buckets can carry one name and these inputs then collide
        // byte-for-byte again. Closing it needs a `buildRowTokens`
        // (`row-tokens.ts`) map built where the buckets are MAPPED and threaded
        // down as a prop — a per-item component has no sibling visibility — so
        // it is a deferred follow-up, deliberately not attempted here.
        aria-label={`${t(lang, "budgetPercentComplete")} – ${bucket.name}`}
        type="number"
        min={0}
        max={100}
        step="1"
        placeholder={derived === null ? "—" : String(Math.round(derived))}
        value={draft.value}
        onChange={(e) => draft.onChange(e.target.value)}
        onFocus={draft.onFocus}
        onBlur={draft.onBlur}
        onKeyDown={draft.onKeyDown}
        className={`w-16 rounded border border-line bg-surface px-1 py-0.5 text-right tabular-nums ${FOCUS_RING} ${TRANSITION}`}
      />
      <span aria-hidden="true">%</span>
    </span>
  );
}

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
}

function Cci({ label, hint, value, currency, locale, lang, rag, primary = "amount", unknown = false }: { label: string; hint?: string; value: CciValue; currency: string; locale: string; lang: Lang; rag?: Health | null; primary?: "amount" | "percent"; unknown?: boolean }) {
  const pct = value.percent == null ? "—" : `${value.percent.toFixed(1)}%`;
  // `unknown` means the figure could not be computed (no internal rate), NOT
  // that it computed to zero. Both figures go to "—" and the tone stays neutral:
  // the green/red tone reads as a judgement, and there is nothing to judge.
  const tone = unknown
    ? "text-muted-foreground"
    : value.amount >= 0 ? "text-[var(--rag-green-text)]" : "text-[var(--rag-red-text)]";
  const bigFigure = unknown ? "—" : primary === "percent" ? pct : formatCurrency(value.amount, currency, locale);
  const smallFigure = unknown ? "—" : primary === "percent" ? formatCurrency(value.amount, currency, locale) : pct;
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          {label}
          {hint ? <InfoTooltip text={hint} /> : null}
        </span>
        {rag !== undefined && !unknown ? <RagBadge value={rag} lang={lang} title={label} /> : null}
      </div>
      <div className={`text-lg font-semibold ${tone}`}>{bigFigure}</div>
      <div className="text-xs text-muted-foreground">{smallFigure}</div>
    </div>
  );
}

/** Builds the Cci-shaped value for the CPI tile: `costPerformanceIndex` is a
 *  0-1 ratio (not the 0-100 percent every other CciValue.percent carries), so
 *  it is scaled ×100 here at the one render boundary rather than in the pure
 *  engine. `earnedValue` is EUR, like every other CciValue.amount — callers
 *  convert it to the bucket's display currency the same way they already do
 *  for margin/burn (`cci(...)`). */
function cpiCciValue(earnedValue: number | null, costPerformanceIndex: number | null): CciValue {
  return { amount: earnedValue ?? 0, percent: costPerformanceIndex === null ? null : costPerformanceIndex * 100 };
}

/** Module-level so the default is one stable identity, not a fresh `{}` per render. */
const NO_ACTUALS: ActualsByBucket = {};

function nextBucketId(buckets: readonly BudgetBucket[]): number {
  return mintId("budgetBucket", buckets);
}

function blankBucket(id: number, plan: ResourcePlan): BudgetBucket {
  return {
    id, name: `Bucket ${id}`, type: "tm", currency: "EUR",
    startDate: plan.startDate, endDate: plan.endDate, status: "open", allocations: [],
  };
}

export function BudgetPanel(props: BudgetPanelProps) {
  const { lang, buckets, roles, resources, plan, fxRates, absences, holidaySet, workdayHours, showHints, isPopout, onLearnMore, onSetBudgetFollowsPlan, timelogProjectId, onGoToTimelog, tasks = [], actualsByBucket = NO_ACTUALS } = props;
  const locale = localeFor(lang);
  const confirm = useConfirm();

  const report = useMemo(
    () => computeBudgetReport(buckets, plan, roles, resources, workdayHours, holidaySet, absences, tasks),
    [buckets, plan, roles, resources, workdayHours, holidaySet, absences, tasks],
  );

  const bucketById = useMemo(() => new Map(buckets.map((b) => [b.id, b])), [buckets]);
  const projCur = plan.currency || "EUR"; // project rollup is in the plan base currency (EUR)

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
    const fresh = blankBucket(id, plan);
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
          resources={resources} onGoToTimelog={onGoToTimelog}
        />
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
          <Cci label={t(lang, "budgetCciCpi")} hint={t(lang, "budgetCciCpiHint")} value={cpiCciValue(report.project.earnedValue, report.project.costPerformanceIndex)} currency={projCur} locale={locale} lang={lang} rag={costPerformanceIndexHealth(report.project.costPerformanceIndex)} primary="percent" unknown={report.project.costPerformanceIndex === null} />
          <Cci label={t(lang, "budgetCciConsumption")} hint={t(lang, "budgetCciConsumptionHint")} value={report.project.consumption} currency={projCur} locale={locale} lang={lang} rag={ratioHealth(report.project.consumedValue, report.project.budgetValue)} primary="percent" />
        </div>
        <CostUnknownNotice
          lang={lang}
          reason={report.project.costUnknownReason}
          disciplineNames={disciplineNamesFor(report.project.unpricedDisciplineIds)}
        />
      </section>

      <section className="flex flex-col gap-3">
        {report.buckets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <TableFilter lang={lang} value={roleFilter} onChange={setRoleFilter} placeholderKey="budgetRoleFilter" />
            <TableFilter lang={lang} value={bucketFilter} onChange={setBucketFilter} placeholderKey="budgetReportFilterBucket" />
          </div>
        )}
        {visibleBuckets.map((br: BucketReport) => {
          const bucket = bucketById.get(br.bucketId)!;
          const isBlended = bucket.planningMode === "blended";
          const rate = resolveRate(bucket, fxRates);
          const periods = bucketActivePeriods(bucket, plan);
          const inCur = (eur: number) => formatCurrency(eurToCurrency(eur, bucket, fxRates), bucket.currency, locale);
          // CCI amounts are EUR from the engine — convert to the bucket currency for display.
          const cci = (v: CciValue): CciValue => ({ amount: eurToCurrency(v.amount, bucket, fxRates), percent: v.percent });
          const detailedRows = detailedRowsByBucket.get(br.bucketId) ?? [];
          const blendedRows = filterSortAllocations(
            bucket.disciplineAllocations ?? [],
            (a) => props.disciplines.find((d) => d.id === a.disciplineId)?.name || `#${a.disciplineId}`,
            roleFilter, roleSort,
          );
          // Only one of the two branches renders, so the totals follow the same
          // choice the rows do. Both allocation shapes carry the three fields
          // TotalsRow names, so the union widens without a cast.
          const rowsForTotals: readonly TotalsRow[] = isBlended ? blendedRows : detailedRows;
          const totals = bucketColumnTotals(rowsForTotals, periods, (r, p) => cellBudget(r, p, periods));
          return (
            <div
              key={br.bucketId}
              {...bucketOrder.itemProps(br.bucketId)}
              className={`rounded-xl border p-4 ${
                bucketOrder.isDragging && bucketOrder.dragId !== br.bucketId
                  ? "border-ui-dark-blue/60"
                  : "border-line"
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DragHandle
                    {...bucketOrder.handleProps(br.bucketId)}
                    // ★★ Bucket-QUALIFIED name (WCAG 2.4.6). Every handle carried
                    // the identical "Reorder bucket — …", so a screen-reader
                    // user listing the buttons heard the same label N times
                    // with nothing to say which bucket each moved. Budget IS an
                    // axe-scanned view and axe cannot see this at ANY seed size,
                    // so the qualifier is written at the source and pinned by a
                    // unit test.
                    ariaLabel={`${t(lang, "budgetReorderHandle")} – ${br.name}`}
                    title={t(lang, "budgetReorderHandle")}
                    // `select-none` and the focus-visible ring are the primitive's own
                    // base; `leading-none` went with the text glyph it used to tune.
                    className="cursor-grab rounded text-muted-foreground hover:text-ui-dark-blue active:cursor-grabbing dark:hover:text-ui-light-grey"
                  />
                  <span className="font-semibold text-ui-dark-blue dark:text-ui-light-grey">
                    {br.name}{bucket.poNumber ? ` · ${bucket.poNumber}` : ""}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {t(lang, br.type === "fixed" ? "budgetTypeFixed" : "budgetTypeTm")} · {bucket.currency}
                  {rate !== 1 ? ` (×${rate})` : ""}
                  {" · "}{t(lang, isBlended ? "budgetModeBlended" : "budgetModeDetailed")}
                  <ManualPercentCell
                    lang={lang}
                    bucket={bucket}
                    tasks={props.tasks}
                    onCommit={(pct) => updateBucket(bucket.id, { percentComplete: pct })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div><div className="text-xs text-muted-foreground">{t(lang, "budgetBudgetHours")}</div>{br.budgetHours.toFixed(0)}</div>
                <div><div className="flex items-center gap-1 text-xs text-muted-foreground">{t(lang, "budgetPlanHours")}<InfoTooltip text={t(lang, "budgetPlanHoursHint")} /></div><span className="inline-flex items-center gap-1.5">{br.plannedHours.toFixed(0)}{!br.budgetMirrorsPlan && <RagBadge value={planVsBudgetHealth(br.plannedHours, br.budgetHours)} lang={lang} title={t(lang, "budgetPlanHours")} />}</span></div>
                <div><div className="flex items-center gap-1 text-xs text-muted-foreground">{t(lang, "budgetActualHours")}<InfoTooltip text={t(lang, "budgetActualHoursHint")} /></div><span className="inline-flex items-center gap-1.5">{br.actualHours.toFixed(0)}<RagBadge value={ratioHealth(br.actualHours, br.budgetHours)} lang={lang} title={t(lang, "budgetActualHours")} /></span></div>
                {/* A fixed-price bucket's win/loss IS revenue − cost, so it is
                    unknowable without an internal rate. A T&M bucket's is
                    budgetValue − consumedValue on EXTERNAL rates and stays
                    valid — gating it there would hide a real figure. */}
                <div><div className="flex items-center gap-1 text-xs text-muted-foreground">{t(lang, "budgetWinLoss")}<InfoTooltip text={t(lang, "budgetWinLossHint")} /></div><span className="inline-flex items-center gap-1.5">{!costIsKnowable(br) && br.type === "fixed" ? "—" : <>{inCur(br.winLossValue)}<RagBadge value={winLossHealth(br.consumedValue, br.budgetValue)} lang={lang} title={t(lang, "budgetWinLoss")} /></>}</span></div>
              </div>
              {br.spilloverInHours !== 0 && (
                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <span>{t(lang, "budgetSpilloverIn")}</span>
                  <InfoTooltip text={t(lang, "budgetSpilloverInHint")} />
                  <span>: {br.spilloverInHours.toFixed(0)} h · {inCur(br.spilloverInValue)}</span>
                </div>
              )}
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Cci label={t(lang, "budgetCciMargin")} hint={t(lang, "budgetCciMarginHint")} value={cci(br.contributionMargin)} currency={bucket.currency} locale={locale} lang={lang} rag={marginHealth(br.contributionMargin.percent)} unknown={!costIsKnowable(br)} />
                <Cci label={t(lang, "budgetCciBurn")} hint={t(lang, "budgetCciBurnHint")} value={cci(br.costPerformance)} currency={bucket.currency} locale={locale} lang={lang} rag={costPerformanceHealth(br.costPerformance.percent)} primary="percent" unknown={!costIsKnowable(br)} />
                {/* Earned value needs progress (linked tasks or a manual %),
                    on top of the same internal-rate basis burn/margin need —
                    so it is gated on its OWN null-ness, not `costIsKnowable`
                    alone (a rated bucket with no progress set is still "—"). */}
                <Cci label={t(lang, "budgetCciCpi")} hint={t(lang, "budgetCciCpiHint")} value={cci(cpiCciValue(br.earnedValue, br.costPerformanceIndex))} currency={bucket.currency} locale={locale} lang={lang} rag={costPerformanceIndexHealth(br.costPerformanceIndex)} primary="percent" unknown={br.costPerformanceIndex === null} />
                {/* Consumption is an EXTERNAL-rate ratio — knowable without a
                    rate card, so it is deliberately not gated. */}
                <Cci label={t(lang, "budgetCciConsumption")} hint={t(lang, "budgetCciConsumptionHint")} value={cci(br.consumption)} currency={bucket.currency} locale={locale} lang={lang} rag={ratioHealth(br.consumedValue, br.budgetValue)} primary="percent" />
              </div>
              <CostUnknownNotice
                lang={lang}
                reason={br.costUnknownReason}
                disciplineNames={disciplineNamesFor(br.unpricedDisciplineIds)}
              />
              <div className="mt-3 overflow-x-auto">
                <DataTable
                  // `w-max`, NOT `w-full`. A `width: 100%` table whose columns
                  // sum to less than the container spreads the leftover across
                  // ALL of them — including the three pinned ones, whose offsets
                  // are arithmetic over their DECLARED widths. This is a SECOND
                  // mechanism, independent of the content clamps below: measured
                  // in Chromium with those clamps already applied, 3 periods in
                  // a 1400px container still rendered the 28px dot column at 53
                  // and a 60px role column at 113.5. Sizing to content leaves no
                  // leftover to spread; the cost is that a short plan no longer
                  // stretches to fill the pane.
                  className="w-max text-xs"
                  // The role rows carry per-role people disclosures, whose
                  // aria-controls target has to be a `<tbody>` — so this table
                  // owns its bodies (a tbody inside DataTable's own tbody drops
                  // off the column grid entirely; see `ownBodies`).
                  ownBodies
                  head={<>
                    <tr>
                      <th
                        className="sticky px-1 py-1 text-left font-medium print:static"
                        style={{ left: 0, width: DOT_COL_PX, minWidth: DOT_COL_PX }}
                      >
                        {/* Visually hidden: this column shows RAG dots, and each
                            badge carries its own title. The visible word was
                            what rendered the column at 41.3px against a declared
                            28, so the role column — pinned at DOT_COL_PX — sat
                            over its right 13px once scrolled, clipping the tail
                            of the word. Widening the constant instead would tune
                            it to ONE string: this key happens to be "Status" in
                            both EN and DE today, but nothing holds it there, and
                            a constant cannot track a translation. Taking the
                            label out of layout makes 28 true in every language. */}
                        <span className="sr-only">{t(lang, "budgetRoleStatus")}</span>
                      </th>
                      <SortResizeTh
                        label={t(lang, isBlended ? "budgetDiscipline" : "budgetRole")}
                        sortCol="role"
                        width={colWidths.role}
                        stickyLeft={DOT_COL_PX}
                        sortKey="role"
                        sortDir={roleSort}
                        onSort={() => setRoleSort((d) => nextSortDir(d))}
                        onResize={startResize}
                      />
                      {/* Fixed Total column. Its offset tracks the LIVE role width —
                          the role column is user-resizable, so a hardcoded offset
                          drifts the moment it is dragged. The offset is only true
                          because the two columns to its left are clamped to their
                          declared widths; nothing pins to the RIGHT of this one,
                          so it needs no clamp of its own. */}
                      <th
                        className="sticky px-3 py-2 font-medium print:static"
                        style={{
                          left: DOT_COL_PX + colWidths.role,
                          width: TOTAL_COL_PX,
                          minWidth: TOTAL_COL_PX,
                        }}
                      >
                        {t(lang, "budgetTotal")}
                      </th>
                      {periods.map((p) => (
                        <th
                          key={p.key}
                          className="relative px-3 py-2 font-medium"
                          style={{ width: colWidths.period, minWidth: colWidths.period }}
                        >
                          {p.key}
                          <ColumnResizeHandle col="period" onMouseDown={startResize} />
                        </th>
                      ))}
                    </tr>
                  </>}
                >
                    {!isBlended && detailedRows.map((a) => {
                      // Effective budget (mirrors planned when follow-plan is on) so the
                      // row RAG agrees with the cells + bucket dot — not the stored hours.
                      const totBudget = periods.reduce((s, p) => s + cellBudget(a, p, periods), 0);
                      const totActual = sumPeriods(a.actualHours, periods);
                      const mirror = budgetFollowsPlan && a.resourceIds.length > 0;
                      const label = roleLabel(roles.find((r) => r.id === a.roleId), props.disciplines, props.grades) || `#${a.roleId}`;
                      const openKey = `${bucket.id}:${a.roleId}`;
                      const open = openPeople.has(openKey);
                      const roleToken = roleTokens.get(openKey) ?? label;
                      return (
                      <Fragment key={a.roleId}>
                      <tbody>
                      <tr className="border-t border-line">
                        <BucketRowLeadCells
                          label={
                            <PeopleDisclosureLabel
                              lang={lang} label={label} token={roleToken} bucketId={bucket.id} roleId={a.roleId}
                              open={open} onToggle={() => togglePeople(openKey)}
                            />
                          }
                          budget={totBudget} actual={totActual} lang={lang} roleWidth={colWidths.role}
                        />
                        {periods.map((p) => (
                          <HoursTd
                            key={p.key}
                            ariaPrefix={`${bucket.id}-${a.roleId}-${p.key}`}
                            budget={cellBudget(a, p, periods)}
                            actual={a.actualHours[p.key]}
                            readOnly={mirror}
                            onBudget={(v) => setCell(bucket.id, a.roleId, p.key, "budgetHours", v)}
                            onActual={(v) => setCell(bucket.id, a.roleId, p.key, "actualHours", v)}
                            lang={lang}
                            periodEnd={p.end}
                            today={props.today}
                          />
                        ))}
                      </tr>
                      </tbody>
                      <BucketRolePeople
                        bucketId={bucket.id}
                        allocation={a}
                        resources={resources}
                        actualsByPeriod={actualsByBucket[bucket.id] ?? {}}
                        plannedByResourcePeriod={plannedByResourcePeriod}
                        periods={periods}
                        collapsed={!open}
                        roleWidth={colWidths.role}
                      />
                      </Fragment>
                      );
                    })}
                    {isBlended && <tbody>{blendedRows.map((a) => {
                      // Effective budget (mirrors planned when follow-plan is on) so the
                      // row RAG agrees with the cells + bucket dot — not the stored hours.
                      const totBudget = periods.reduce((s, p) => s + cellBudget(a, p, periods), 0);
                      const totActual = sumPeriods(a.actualHours, periods);
                      // Each blended row IS one disciplineAllocation carrying its own
                      // resourceIds, and allocationPlannedHours already sums over them —
                      // so the mirror rule is identical to the role rows.
                      const mirror = budgetFollowsPlan && a.resourceIds.length > 0;
                      return (
                      <tr key={a.disciplineId} className="border-t border-line">
                        <BucketRowLeadCells
                          label={props.disciplines.find((d) => d.id === a.disciplineId)?.name || `#${a.disciplineId}`}
                          budget={totBudget} actual={totActual} lang={lang} roleWidth={colWidths.role}
                        />
                        {periods.map((p) => (
                          <HoursTd
                            key={p.key}
                            ariaPrefix={`${bucket.id}-d${a.disciplineId}-${p.key}`}
                            budget={cellBudget(a, p, periods)}
                            actual={a.actualHours[p.key]}
                            readOnly={mirror}
                            onBudget={(v) => setDisciplineCell(bucket.id, a.disciplineId, p.key, "budgetHours", v)}
                            onActual={(v) => setDisciplineCell(bucket.id, a.disciplineId, p.key, "actualHours", v)}
                            lang={lang}
                            periodEnd={p.end}
                            today={props.today}
                          />
                        ))}
                      </tr>
                      );
                    })}</tbody>}
                    {rowsForTotals.length > 0 && (
                      <tbody>
                        <BucketTotalRow
                          columns={totals.columns}
                          grandBudget={totals.grandBudget}
                          grandActual={totals.grandActual}
                          lang={lang}
                          roleWidth={colWidths.role}
                        />
                      </tbody>
                    )}
                </DataTable>
              </div>
              <div className="mt-2 flex items-center gap-4">
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => setEditingBucketId(bucket.id)}
                >
                  {t(lang, "budgetEditBucket")}
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => updateBucket(bucket.id, bucket.status === "open"
                    ? { status: "closed", closedDate: props.today }
                    : { status: "open", closedDate: undefined })}
                >
                  {t(lang, bucket.status === "open" ? "budgetClose" : "budgetReopen")}
                </Button>
                {/* ★ `destructive`, not `secondary`: this is the only action in
                    the row that destroys data, and rendering it identically to
                    Edit and Close made the row's one irreversible control
                    indistinguishable. It stays `confirm()`-gated either way —
                    the variant is the affordance, not the safeguard. */}
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={() => removeBucket(bucket.id)}
                  title={t(lang, "budgetRemoveBucket")}
                >
                  {t(lang, "budgetRemoveBucket")}
                </Button>
              </div>
            </div>
          );
        })}
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
