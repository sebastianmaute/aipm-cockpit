"use client";
import { useMemo, useState } from "react";
import { type Lang, t, localeFor } from "./i18n";
import { formatCurrency } from "./resource-cost";
import { computeBudgetReport, bucketActivePeriods, type BucketReport, type CciValue } from "./budget-report";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { roleLabel } from "./resource-foundation";
import { eurToCurrency, resolveRate } from "./fx";
import type { Absence, BudgetBucket, Discipline, FxRates, Grade, Resource, ResourcePlan, Role } from "./types";
import { BudgetBucketModal } from "./budget-bucket-modal";
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle, ResetColWidthsButton, ResetSizeButton, ResizeCornerHint } from "./task-manager-ui";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { useResizable } from "./use-resizable";
import { RagBadge } from "./rag-badge";
import { TableFilter, SortHeaderButton, nextSortDir, type SortDir } from "./report-table";
import { ratioHealth, marginHealth, costPerformanceHealth, winLossHealth } from "./budget-health";
import type { Health } from "./health";
import { InfoTooltip } from "./info-tooltip";

const BUDGET_COL_WIDTHS = {
  role: 160,
  period: 100,
} as const;
type BudgetCol = keyof typeof BUDGET_COL_WIDTHS;

function sumPeriods(hours: Record<string, number>, periods: { key: string }[]): number {
  return periods.reduce((s, p) => s + (hours[p.key] ?? 0), 0);
}

function filterSortAllocations<T>(
  allocs: readonly T[],
  nameOf: (a: T) => string,
  filter: string,
  dir: SortDir,
): T[] {
  const q = filter.trim().toLowerCase();
  let rows = q ? allocs.filter((a) => nameOf(a).toLowerCase().includes(q)) : allocs.slice();
  if (dir !== "off") {
    rows = rows.slice().sort((a, b) => {
      const c = nameOf(a).localeCompare(nameOf(b));
      return dir === "desc" ? -c : c;
    });
  }
  return rows;
}

function HoursCell({
  ariaPrefix, budget, actual, onBudget, onActual, budgetHint, actualHint, lang,
}: {
  ariaPrefix: string;
  budget: number | undefined;
  actual: number | undefined;
  onBudget: (v: number) => void;
  onActual: (v: number) => void;
  budgetHint: string;
  actualHint: string;
  lang: Lang;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <span className="flex w-10 items-center gap-0.5 text-[10px] text-muted-foreground">
          {t(lang, "budgetCellPlan")}
          <InfoTooltip text={budgetHint} />
        </span>
        <input
          aria-label={`budget-${ariaPrefix}`}
          type="number"
          value={budget ?? ""}
          onChange={(e) => onBudget(Number(e.target.value) || 0)}
          className="w-16 rounded border border-line bg-surface px-1 text-right"
        />
      </div>
      <div className="flex items-center gap-1">
        <span className="flex w-10 items-center gap-0.5 text-[10px] text-muted-foreground">
          {t(lang, "budgetCellActual")}
          <InfoTooltip text={actualHint} />
        </span>
        <input
          aria-label={`actual-${ariaPrefix}`}
          type="number"
          value={actual ?? ""}
          onChange={(e) => onActual(Number(e.target.value) || 0)}
          className="w-16 rounded border border-line bg-surface-muted px-1 text-right"
        />
        <RagBadge value={ratioHealth(actual ?? 0, budget ?? 0)} lang={lang} />
      </div>
    </div>
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
  onChangeBuckets: (next: BudgetBucket[]) => void;
  onRefreshFx: () => void;
  fxLoading?: boolean;
}

function Cci({ label, hint, value, currency, locale, lang, rag }: { label: string; hint?: string; value: CciValue; currency: string; locale: string; lang: Lang; rag?: Health | null }) {
  const pct = value.percent == null ? "—" : `${value.percent.toFixed(1)}%`;
  const tone = value.amount >= 0 ? "text-AIPM-green-strong" : "text-AIPM-pink";
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          {label}
          {hint ? <InfoTooltip text={hint} /> : null}
        </span>
        {rag !== undefined ? <RagBadge value={rag} lang={lang} title={label} /> : null}
      </div>
      <div className={`text-lg font-semibold ${tone}`}>{formatCurrency(value.amount, currency, locale)}</div>
      <div className="text-xs text-muted-foreground">{pct}</div>
    </div>
  );
}

function nextBucketId(buckets: readonly BudgetBucket[]): number {
  return buckets.reduce((m, b) => Math.max(m, b.id), 0) + 1;
}

function blankBucket(id: number, plan: ResourcePlan): BudgetBucket {
  return {
    id, name: `Bucket ${id}`, type: "tm", currency: "EUR",
    startDate: plan.startDate, endDate: plan.endDate, status: "open", allocations: [],
  };
}

export function BudgetPanel(props: BudgetPanelProps) {
  const { lang, buckets, roles, resources, plan, fxRates, absences, holidaySet, workdayHours } = props;
  const locale = localeFor(lang);

  const report = useMemo(
    () => computeBudgetReport(buckets, plan, roles, resources, workdayHours, holidaySet, absences),
    [buckets, plan, roles, resources, workdayHours, holidaySet, absences],
  );

  const bucketById = useMemo(() => new Map(buckets.map((b) => [b.id, b])), [buckets]);
  const projCur = plan.currency || "EUR"; // project rollup is in the plan base currency (EUR)

  const { colWidths, startColResize, resetColWidths } = useColumnResize<BudgetCol>(
    "budget",
    BUDGET_COL_WIDTHS,
  );
  const startResize = startColResize as (col: string, e: React.MouseEvent) => void;

  const { ref: budgetRef, reset: resetBudgetSize } = useResizable("lop-app:budget-size");

  const [dragId, setDragId] = useState<number | null>(null);
  const [editingBucketId, setEditingBucketId] = useState<number | null>(null);
  const [roleFilter, setRoleFilter] = useState("");
  const [roleSort, setRoleSort] = useState<SortDir>("off");

  const stamp = () => new Date().toISOString();

  const addBucket = () => {
    const id = nextBucketId(buckets);
    props.onChangeBuckets([...buckets, blankBucket(id, plan)]);
    setEditingBucketId(id);
  };

  const updateBucket = (id: number, patch: Partial<BudgetBucket>) => {
    props.onChangeBuckets(buckets.map((b) => (b.id === id ? { ...b, ...patch, localModifiedAt: stamp() } : b)));
  };

  const removeBucket = (id: number) => {
    if (!window.confirm(t(lang, "budgetRemoveBucketConfirm"))) return;
    props.onChangeBuckets(
      buckets
        .filter((b) => b.id !== id)
        .map((b) => (b.successorId === id ? { ...b, successorId: null, localModifiedAt: stamp() } : b)),
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
    );
  };

  // Pointer drop: move `dragId` to where `targetId` currently sits.
  const onDropOnBucket = (targetId: number) => {
    if (dragId == null || dragId === targetId) return;
    const ids = sortedBucketIds();
    const fromIdx = ids.indexOf(dragId);
    const targetIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || targetIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(targetIdx, 0, dragId);
    applyBucketOrder(ids);
  };

  // Keyboard reorder: swap a bucket with its neighbour (delta -1 = up, +1 = down),
  // so the drag handle's ArrowUp/ArrowDown lets keyboard users reorder too.
  const moveBucket = (id: number, delta: number) => {
    const ids = sortedBucketIds();
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    applyBucketOrder(ids);
  };

  return (
    <div ref={budgetRef} className={VIEW_PANE_RESIZABLE_CLASS}>
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-foreground">
          {t(lang, "tabBudget")}{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {t(lang, "budgetBucketsCount", report.buckets.length)}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addBucket}
            className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90"
          >
            + {t(lang, "budgetAddBucket")}
          </button>
          <button
            type="button"
            onClick={props.onRefreshFx}
            disabled={props.fxLoading}
            className="inline-flex items-center gap-1.5 rounded-md border border-AIPM-dark-blue bg-surface px-2.5 py-1.5 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={`h-4 w-4 ${props.fxLoading ? "animate-spin" : ""}`}>
              <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
            </svg>
            {t(lang, "budgetFxRefresh")}
          </button>
          <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
          <ResetSizeButton onClick={resetBudgetSize} lang={lang} />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "budgetTitle")} — {t(lang, "budgetProjectTotal")}
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <Cci label={t(lang, "budgetCciMargin")} hint={t(lang, "budgetCciMarginHint")} value={report.project.contributionMargin} currency={projCur} locale={locale} lang={lang} rag={marginHealth(report.project.contributionMargin.percent)} />
          <Cci label={t(lang, "budgetCciCpi")} hint={t(lang, "budgetCciCpiHint")} value={report.project.costPerformance} currency={projCur} locale={locale} lang={lang} rag={costPerformanceHealth(report.project.costPerformance.percent)} />
          <Cci label={t(lang, "budgetCciConsumption")} hint={t(lang, "budgetCciConsumptionHint")} value={report.project.consumption} currency={projCur} locale={locale} lang={lang} rag={ratioHealth(report.project.consumedValue, report.project.budgetValue)} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        {report.buckets.length > 0 && (
          <TableFilter lang={lang} value={roleFilter} onChange={setRoleFilter} placeholderKey="budgetRoleFilter" />
        )}
        {report.buckets.map((br: BucketReport) => {
          const bucket = bucketById.get(br.bucketId)!;
          const isBlended = bucket.planningMode === "blended";
          const rate = resolveRate(bucket, fxRates);
          const periods = bucketActivePeriods(bucket, plan);
          const inCur = (eur: number) => formatCurrency(eurToCurrency(eur, bucket, fxRates), bucket.currency, locale);
          // CCI amounts are EUR from the engine — convert to the bucket currency for display.
          const cci = (v: CciValue): CciValue => ({ amount: eurToCurrency(v.amount, bucket, fxRates), percent: v.percent });
          const detailedRows = filterSortAllocations(
            bucket.allocations,
            (a) => roleLabel(roles.find((r) => r.id === a.roleId), props.disciplines, props.grades) || `#${a.roleId}`,
            roleFilter, roleSort,
          );
          const blendedRows = filterSortAllocations(
            bucket.disciplineAllocations ?? [],
            (a) => props.disciplines.find((d) => d.id === a.disciplineId)?.name || `#${a.disciplineId}`,
            roleFilter, roleSort,
          );
          return (
            <div
              key={br.bucketId}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDropOnBucket(br.bucketId)}
              className={`rounded-xl border p-4 ${
                dragId != null && dragId !== br.bucketId
                  ? "border-AIPM-dark-blue/60"
                  : "border-line"
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    draggable
                    onDragStart={() => setDragId(br.bucketId)}
                    onDragEnd={() => setDragId(null)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        moveBucket(br.bucketId, -1);
                      } else if (e.key === "ArrowDown") {
                        e.preventDefault();
                        moveBucket(br.bucketId, 1);
                      }
                    }}
                    aria-label={t(lang, "budgetReorderHandle")}
                    title={t(lang, "budgetReorderHandle")}
                    className="cursor-grab select-none rounded leading-none text-muted-foreground hover:text-AIPM-dark-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-green active:cursor-grabbing dark:hover:text-AIPM-light-grey"
                  >
                    ⠿
                  </button>
                  <span className="font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
                    {br.name}{bucket.poNumber ? ` · ${bucket.poNumber}` : ""}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {t(lang, br.type === "fixed" ? "budgetTypeFixed" : "budgetTypeTm")} · {bucket.currency}
                  {rate !== 1 ? ` (×${rate})` : ""}
                  {" · "}{t(lang, isBlended ? "budgetModeBlended" : "budgetModeDetailed")}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-sm">
                <div><div className="text-xs text-muted-foreground">{t(lang, "budgetBudgetHours")}</div>{br.budgetHours.toFixed(0)}</div>
                <div><div className="flex items-center gap-1 text-xs text-muted-foreground">{t(lang, "budgetPlanHours")}<InfoTooltip text={t(lang, "budgetPlanHoursHint")} /></div><span className="inline-flex items-center gap-1.5">{br.plannedHours.toFixed(0)}<RagBadge value={ratioHealth(br.plannedHours, br.budgetHours)} lang={lang} title={t(lang, "budgetPlanHours")} /></span></div>
                <div><div className="flex items-center gap-1 text-xs text-muted-foreground">{t(lang, "budgetActualHours")}<InfoTooltip text={t(lang, "budgetActualHoursHint")} /></div><span className="inline-flex items-center gap-1.5">{br.actualHours.toFixed(0)}<RagBadge value={ratioHealth(br.actualHours, br.budgetHours)} lang={lang} title={t(lang, "budgetActualHours")} /></span></div>
                <div><div className="flex items-center gap-1 text-xs text-muted-foreground">{t(lang, "budgetWinLoss")}<InfoTooltip text={t(lang, "budgetWinLossHint")} /></div><span className="inline-flex items-center gap-1.5">{inCur(br.winLossValue)}<RagBadge value={winLossHealth(br.consumedValue, br.budgetValue)} lang={lang} title={t(lang, "budgetWinLoss")} /></span></div>
              </div>
              {br.spilloverInHours !== 0 && (
                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <span>{t(lang, "budgetSpilloverIn")}</span>
                  <InfoTooltip text={t(lang, "budgetSpilloverInHint")} />
                  <span>: {br.spilloverInHours.toFixed(0)} h · {inCur(br.spilloverInValue)}</span>
                </div>
              )}
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Cci label={t(lang, "budgetCciMargin")} hint={t(lang, "budgetCciMarginHint")} value={cci(br.contributionMargin)} currency={bucket.currency} locale={locale} lang={lang} rag={marginHealth(br.contributionMargin.percent)} />
                <Cci label={t(lang, "budgetCciCpi")} hint={t(lang, "budgetCciCpiHint")} value={cci(br.costPerformance)} currency={bucket.currency} locale={locale} lang={lang} rag={costPerformanceHealth(br.costPerformance.percent)} />
                <Cci label={t(lang, "budgetCciConsumption")} hint={t(lang, "budgetCciConsumptionHint")} value={cci(br.consumption)} currency={bucket.currency} locale={locale} lang={lang} rag={ratioHealth(br.consumedValue, br.budgetValue)} />
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className={TABLE_HEAD_CLASS}>
                    <tr>
                      <th className="px-1 py-1 text-left font-medium" style={{ width: 28, minWidth: 28 }}>{t(lang, "budgetRoleStatus")}</th>
                      <th
                        className="relative px-2 py-1 text-left font-medium"
                        style={{ width: colWidths.role, minWidth: colWidths.role }}
                      >
                        <SortHeaderButton
                          label={t(lang, isBlended ? "budgetDiscipline" : "budgetRole")}
                          active={roleSort !== "off"}
                          dir={roleSort}
                          onClick={() => setRoleSort((d) => nextSortDir(d))}
                        />
                        <ColumnResizeHandle col="role" onMouseDown={startResize} />
                      </th>
                      {periods.map((p) => (
                        <th
                          key={p.key}
                          className="relative px-2 py-1 text-right"
                          style={{ width: colWidths.period, minWidth: colWidths.period }}
                        >
                          {p.key}
                          <ColumnResizeHandle col="period" onMouseDown={startResize} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {!isBlended && detailedRows.map((a) => {
                      const totBudget = sumPeriods(a.budgetHours, periods);
                      const totActual = sumPeriods(a.actualHours, periods);
                      return (
                      <tr key={a.roleId} className="border-t border-line">
                        <td className="px-1 py-1"><RagBadge value={ratioHealth(totActual, totBudget)} lang={lang} title={t(lang, "budgetRoleStatus")} /></td>
                        <td className="px-2 py-1">{roleLabel(roles.find((r) => r.id === a.roleId), props.disciplines, props.grades) || `#${a.roleId}`}</td>
                        {periods.map((p) => (
                          <td key={p.key} className="px-1 py-1">
                            <HoursCell
                              ariaPrefix={`${bucket.id}-${a.roleId}-${p.key}`}
                              budget={a.budgetHours[p.key]}
                              actual={a.actualHours[p.key]}
                              onBudget={(v) => setCell(bucket.id, a.roleId, p.key, "budgetHours", v)}
                              onActual={(v) => setCell(bucket.id, a.roleId, p.key, "actualHours", v)}
                              budgetHint={t(lang, "budgetBudgetHoursHint")}
                              actualHint={t(lang, "budgetActualHoursHint")}
                              lang={lang}
                            />
                          </td>
                        ))}
                      </tr>
                      );
                    })}
                    {isBlended && blendedRows.map((a) => {
                      const totBudget = sumPeriods(a.budgetHours, periods);
                      const totActual = sumPeriods(a.actualHours, periods);
                      return (
                      <tr key={a.disciplineId} className="border-t border-line">
                        <td className="px-1 py-1"><RagBadge value={ratioHealth(totActual, totBudget)} lang={lang} title={t(lang, "budgetRoleStatus")} /></td>
                        <td className="px-2 py-1">{props.disciplines.find((d) => d.id === a.disciplineId)?.name || `#${a.disciplineId}`}</td>
                        {periods.map((p) => (
                          <td key={p.key} className="px-1 py-1">
                            <HoursCell
                              ariaPrefix={`${bucket.id}-d${a.disciplineId}-${p.key}`}
                              budget={a.budgetHours[p.key]}
                              actual={a.actualHours[p.key]}
                              onBudget={(v) => setDisciplineCell(bucket.id, a.disciplineId, p.key, "budgetHours", v)}
                              onActual={(v) => setDisciplineCell(bucket.id, a.disciplineId, p.key, "actualHours", v)}
                              budgetHint={t(lang, "budgetBudgetHoursHint")}
                              actualHint={t(lang, "budgetActualHoursHint")}
                              lang={lang}
                            />
                          </td>
                        ))}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setEditingBucketId(bucket.id)}
                  className="rounded-md border border-transparent px-2 py-0.5 text-xs text-muted-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted"
                >
                  {t(lang, "budgetEditBucket")}
                </button>
                <button
                  type="button"
                  onClick={() => updateBucket(bucket.id, bucket.status === "open"
                    ? { status: "closed", closedDate: props.today }
                    : { status: "open", closedDate: undefined })}
                  className="rounded-md border border-transparent px-2 py-0.5 text-xs text-muted-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted"
                >
                  {t(lang, bucket.status === "open" ? "budgetClose" : "budgetReopen")}
                </button>
                <button
                  type="button"
                  onClick={() => removeBucket(bucket.id)}
                  title={t(lang, "budgetRemoveBucket")}
                  className="rounded-md border border-transparent px-2 py-0.5 text-xs text-muted-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted"
                >
                  {t(lang, "budgetRemoveBucket")}
                </button>
              </div>
            </div>
          );
        })}
        {report.buckets.length === 0 && (
          <button
            type="button"
            onClick={addBucket}
            className="w-full rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted-foreground hover:border-AIPM-dark-blue hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey"
          >
            + {t(lang, "budgetAddBucket")}…
          </button>
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
          onSave={(next) => {
            props.onChangeBuckets(buckets.map((b) => (b.id === next.id ? next : b)));
            setEditingBucketId(null);
          }}
          onClose={() => setEditingBucketId(null)}
        />
      )}
      </div>
      <ResizeCornerHint lang={lang} />
    </div>
  );
}
