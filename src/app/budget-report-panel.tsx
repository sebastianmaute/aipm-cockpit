"use client";

import { useCallback, useMemo, useState } from "react";
import { type Lang, t, localeFor } from "./i18n";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { ColumnResizeHandle } from "./task-manager-ui";
import { useColumnResize } from "./use-column-resize";
import { useResizable } from "./use-resizable";
import {
  ReportCard,
  Section,
  Tile,
  TableFilter,
  SortHeaderButton,
  useSortableFilter,
  type SortDir,
} from "./report-table";
import { computeBudgetReport, type BucketReport, type CciValue } from "./budget-report";
import { computeEvm, projectBlendedInternalRate } from "./evm";
import { formatCurrency } from "./resource-cost";
import { resolveRate } from "./fx";
import type { Absence, BudgetBucket, FxRates, ResourcePlan, Resource, Role, Task } from "./types";
import { RagBadge } from "./rag-badge";
import { ratioHealth, marginHealth, costPerformanceHealth } from "./budget-health";
import { computeBurndownSeries } from "./budget-burndown";
import { BurndownCharts } from "./burndown-chart";

const DETAIL_COL_WIDTHS = {
  bucket: 160, mode: 90, type: 80, status: 80, currency: 110,
  budgetH: 80, planH: 80, actualH: 80, budgetEur: 110, consumedEur: 120, margin: 90, winLoss: 110,
} as const;
type DetailCol = keyof typeof DETAIL_COL_WIDTHS;

type DetailSortKey =
  | "name" | "mode" | "type" | "status" | "currency"
  | "budgetH" | "planH" | "actualH" | "budgetEur" | "consumedEur" | "margin" | "winLoss";

interface Props {
  lang: Lang;
  buckets: BudgetBucket[];
  plan: ResourcePlan;
  roles: Role[];
  resources: Resource[];
  absences: Absence[];
  holidaySet: Set<string>;
  workdayHours: number;
  fxRates: FxRates | null;
  tasks: Task[];
  today: string;
  embedded?: boolean;
}

export function BudgetReportPanel({
  lang, buckets, plan, roles, resources, absences, holidaySet, workdayHours, fxRates, tasks, today, embedded = false,
}: Props) {
  // Hooks are called unconditionally before the empty-state early return (rules of hooks).
  const report = useMemo(
    () => computeBudgetReport(buckets, plan, roles, resources, workdayHours, holidaySet, absences),
    [buckets, plan, roles, resources, workdayHours, holidaySet, absences],
  );
  const evm = useMemo(
    () => computeEvm(tasks, today, { blendedRate: projectBlendedInternalRate(roles) }),
    [tasks, today, roles],
  );
  const bucketById = useMemo(() => new Map(buckets.map((b) => [b.id, b])), [buckets]);
  const burndown = useMemo(
    () => computeBurndownSeries(buckets, plan, roles, today),
    [buckets, plan, roles, today],
  );
  const { ref, reset } = useResizable("lop-app:budget-report-size");
  const detail = useColumnResize<DetailCol>("budgetReportDetail", DETAIL_COL_WIDTHS);

  if (buckets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted-foreground">
        {t(lang, "budgetReportEmpty")}
      </div>
    );
  }

  const locale = localeFor(lang);
  const money = (n: number) => formatCurrency(n, "EUR", locale);
  const pct = (v: CciValue) => (v.percent == null ? "—" : `${v.percent.toFixed(1)}%`);
  const proj = report.project;

  const content = (
    <>
      <Section title={t(lang, "budgetReportProjectTotal")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label={t(lang, "budgetBudgetHours")} value={proj.budgetHours.toFixed(0)} />
          <Tile label={t(lang, "budgetPlanHours")} value={proj.plannedHours.toFixed(0)} />
          <Tile label={t(lang, "budgetActualHours")} value={proj.actualHours.toFixed(0)} />
          <Tile label={t(lang, "budgetReportRevenue")} value={money(proj.revenue)} />
          <Tile label={t(lang, "budgetReportCost")} value={money(proj.cost)} />
          <Tile label={t(lang, "budgetCciMargin")} value={`${money(proj.contributionMargin.amount)} (${pct(proj.contributionMargin)})`} rag={<RagBadge value={marginHealth(proj.contributionMargin.percent)} lang={lang} title={t(lang, "budgetCciMargin")} />} />
          <Tile label={t(lang, "budgetCciCpi")} value={`${money(proj.costPerformance.amount)} (${pct(proj.costPerformance)})`} rag={<RagBadge value={costPerformanceHealth(proj.costPerformance.percent)} lang={lang} title={t(lang, "budgetCciCpi")} />} />
          <Tile label={t(lang, "budgetCciConsumption")} value={`${money(proj.consumption.amount)} (${pct(proj.consumption)})`} rag={<RagBadge value={ratioHealth(proj.consumedValue, proj.budgetValue)} lang={lang} title={t(lang, "budgetCciConsumption")} />} />
        </div>
      </Section>

      <Section title={t(lang, "evmTitle")}>
        {evm.coverage.withEstimate === 0 ? (
          <p className="text-sm text-muted-foreground">{t(lang, "evmNoEstimates")}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label={t(lang, "evmPv")} value={`${Math.round(evm.pv)}h${evm.money ? ` (${money(evm.money.pv)})` : ""}`} />
              <Tile label={t(lang, "evmEv")} value={`${Math.round(evm.ev)}h${evm.money ? ` (${money(evm.money.ev)})` : ""}`} />
              <Tile label={t(lang, "evmAc")} value={`${Math.round(evm.ac)}h${evm.money ? ` (${money(evm.money.ac)})` : ""}`} />
              <Tile label={t(lang, "evmSpi")} value={evm.spi != null ? evm.spi.toFixed(2) : "—"} />
              <Tile label={t(lang, "evmCpi")} value={evm.cpi != null ? evm.cpi.toFixed(2) : "—"} />
              <Tile label={t(lang, "evmSv")} value={`${Math.round(evm.sv)}h${evm.money ? ` (${money(evm.money.sv)})` : ""}`} />
              <Tile label={t(lang, "evmCv")} value={`${Math.round(evm.cv)}h${evm.money ? ` (${money(evm.money.cv)})` : ""}`} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t(lang, "evmCoverage", String(evm.coverage.withEstimate), String(evm.coverage.total))}</p>
          </>
        )}
      </Section>

      <Section title={t(lang, "budgetBurndownTitle")}>
        <BurndownCharts series={burndown} lang={lang} currency={plan.currency || "EUR"} />
      </Section>

      <BucketDetailTable
        lang={lang}
        rows={report.buckets}
        bucketById={bucketById}
        fxRates={fxRates}
        colResize={detail}
        money={money}
      />
    </>
  );

  if (embedded) return <div className="space-y-6">{content}</div>;

  return (
    <ReportCard
      lang={lang}
      sizeRef={ref}
      onResetSize={reset}
      onResetCols={detail.resetColWidths}
      title={t(lang, "budgetReportTitle")}
    >
      {content}
    </ReportCard>
  );
}

type DetailResizable = ReturnType<typeof useColumnResize<DetailCol>>;

function BucketDetailTable({
  lang, rows, bucketById, fxRates, colResize, money,
}: {
  lang: Lang;
  rows: BucketReport[];
  bucketById: Map<number, BudgetBucket>;
  fxRates: FxRates | null;
  colResize: DetailResizable;
  money: (n: number) => string;
}) {
  const [sort, setSort] = useState<{ key: DetailSortKey; dir: SortDir }>({ key: "budgetEur", dir: "desc" });
  const [filter, setFilter] = useState("");

  const mapped = useMemo(
    () =>
      rows.map((r) => {
        const b = bucketById.get(r.bucketId);
        const blended = b?.planningMode === "blended";
        // Amounts are already EUR (the engine's base); the FX rate is shown for context only, not used to convert.
        const rate = b ? resolveRate(b, fxRates) : 1;
        return {
          ...r,
          modeLabel: t(lang, blended ? "budgetModeBlended" : "budgetModeDetailed"),
          typeLabel: t(lang, r.type === "fixed" ? "budgetTypeFixed" : "budgetTypeTm"),
          statusLabel: t(lang, r.status === "closed" ? "budgetReportStatusClosed" : "budgetReportStatusOpen"),
          currencyLabel: rate !== 1 ? `${r.currency} (×${rate})` : r.currency,
          marginPct: r.contributionMargin.percent,
        };
      }),
    [rows, bucketById, fxRates, lang],
  );

  const getValue = useCallback((r: typeof mapped[number], k: DetailSortKey): string | number => {
    switch (k) {
      case "name": return r.name;
      case "mode": return r.modeLabel;
      case "type": return r.typeLabel;
      case "status": return r.statusLabel;
      case "currency": return r.currency;
      case "budgetH": return r.budgetHours;
      case "planH": return r.plannedHours;
      case "actualH": return r.actualHours;
      case "budgetEur": return r.budgetValue;
      case "consumedEur": return r.consumedValue;
      case "margin": return r.marginPct ?? Number.NEGATIVE_INFINITY;
      case "winLoss": return r.winLossValue;
    }
  }, []);

  const { sorted, click } = useSortableFilter(mapped, sort, setSort, filter, getValue);
  const w = colResize.colWidths;
  const sr = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  const cols: { key: DetailSortKey; col: DetailCol; label: string; align: "left" | "right" }[] = useMemo(
    () => [
      { key: "name", col: "bucket", label: t(lang, "budgetReportByBucket"), align: "left" },
      { key: "mode", col: "mode", label: t(lang, "budgetReportColMode"), align: "left" },
      { key: "type", col: "type", label: t(lang, "budgetType"), align: "left" },
      { key: "status", col: "status", label: t(lang, "budgetReportColStatus"), align: "left" },
      { key: "currency", col: "currency", label: t(lang, "budgetCurrency"), align: "left" },
      { key: "budgetH", col: "budgetH", label: t(lang, "budgetBudgetHours"), align: "right" },
      { key: "planH", col: "planH", label: t(lang, "budgetPlanHours"), align: "right" },
      { key: "actualH", col: "actualH", label: t(lang, "budgetActualHours"), align: "right" },
      { key: "budgetEur", col: "budgetEur", label: t(lang, "budgetReportColBudgetEur"), align: "right" },
      { key: "consumedEur", col: "consumedEur", label: t(lang, "budgetReportColConsumed"), align: "right" },
      { key: "margin", col: "margin", label: t(lang, "budgetReportColMargin"), align: "right" },
      { key: "winLoss", col: "winLoss", label: t(lang, "budgetReportColWinLoss"), align: "right" },
    ],
    [lang],
  );

  return (
    <Section title={t(lang, "budgetReportByBucket")}>
      <TableFilter lang={lang} value={filter} onChange={setFilter} placeholderKey="budgetReportFilterBucket" />
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="px-2 py-2 text-left font-medium" style={{ width: 32, minWidth: 32 }}>{t(lang, "budgetRoleStatus")}</th>
              {cols.map((c) => (
                <th
                  key={c.col}
                  className={`relative px-3 py-2 font-medium ${c.align === "right" ? "text-right" : ""}`}
                  style={{ width: w[c.col], minWidth: w[c.col] }}
                >
                  <SortHeaderButton
                    label={c.label}
                    active={sort.key === c.key && sort.dir !== "off"}
                    dir={sort.dir}
                    onClick={() => click(c.key)}
                  />
                  <ColumnResizeHandle col={c.col} onMouseDown={sr} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.length === 0 && filter !== "" ? (
              <tr>
                <td colSpan={cols.length + 1} className="px-3 py-3 text-center text-xs text-muted-foreground">
                  {t(lang, "reportsNoMatches")}
                </td>
              </tr>
            ) : (
              sorted.map((r) => (
                <tr key={r.bucketId}>
                  <td className="px-2 py-2"><RagBadge value={ratioHealth(r.consumedValue, r.budgetValue)} lang={lang} title={t(lang, "budgetRoleStatus")} /></td>
                  <td className="px-3 py-2 font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">{r.name}</td>
                  <td className="px-3 py-2">{r.modeLabel}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.typeLabel}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.statusLabel}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.currencyLabel}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.budgetHours.toFixed(0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.plannedHours.toFixed(0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className="inline-flex items-center justify-end gap-1.5">
                      {r.actualHours.toFixed(0)}
                      <RagBadge value={ratioHealth(r.actualHours, r.budgetHours)} lang={lang} title={t(lang, "budgetActualHours")} />
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.budgetValue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.consumedValue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.marginPct == null ? "—" : `${r.marginPct.toFixed(1)}%`}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.winLossValue < 0 ? "text-AIPM-pink font-medium" : ""}`}>{money(r.winLossValue)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
