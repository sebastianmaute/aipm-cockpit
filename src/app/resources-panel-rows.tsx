"use client";

// Presentational planning grid + roll-up table for the Resource Planner panel
// (gantt-convention `*-rows` leaf). PURE: all data + handlers arrive as props;
// the orchestrator (`resources-panel.tsx`) owns state, derivation and hooks.
//
// Periods are re-derived here from `plan` + `viewGranularity` via the pure
// `generatePeriods` — identical to the orchestrator's own derivation.

import type React from "react";
import { localeFor } from "./date-format";
import { type Lang, t } from "./i18n";
import { INNER_TABLE_CLASS } from "./view-styles";
import { generatePeriods, displayCapacityHours, absencesForResource, absenceWorkdays } from "./resource-capacity";
import { type CostBreakdown, formatCurrency } from "./resource-cost";
import type { Absence, PlanGranularity, Resource, ResourcePlan } from "./types";
import { resourceDisplayName } from "./resource-foundation";
import { ColumnResizeHandle } from "./task-manager-ui";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { DataTable } from "./data-table";
import { RagBadge } from "./rag-badge";
import { marginAmountHealth } from "./budget-health";
import { SortResizeTh, useSortHeaderProps, type SortDir } from "./report-table";
import { FOCUS_RING, TRANSITION, INTERACTIVE } from "./interaction-styles";
import type { PlanningCol, PlanSortKey, RollupCol } from "./resources-panel-columns";

/** One planning-grid row — a resource with its derived capacity + cost. */
export type PlanRow = {
  resource: Resource;
  name: string;
  totalHours: number;
  cost: CostBreakdown;
  capacityDays: number;
  internalCost: number;
  externalCost: number;
  margin: number;
};

interface PlanningTableProps {
  lang: Lang;
  plan: ResourcePlan;
  viewGranularity: PlanGranularity;
  /** Sorted + filtered planning rows (from the orchestrator's `useSortableFilter`). */
  rows: readonly PlanRow[];
  absences: readonly Absence[];
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
  onEditResource: (resource: Resource) => void;
  onSetUtilization: (resourceId: number, periodKey: string, value: number) => void;
  onSetAbsenceOverride: (resourceId: number, periodKey: string, hours: number | null) => void;
  planColWidths: Record<PlanningCol, number>;
  planSort: { key: PlanSortKey; dir: SortDir };
  planClick: (col: PlanSortKey) => void;
  planStartResize: (col: string, e: React.MouseEvent) => void;
  showRollup: boolean;
  onToggleRollup: () => void;
  rollupColWidths: Record<RollupCol, number>;
  rollupStartResize: (col: string, e: React.MouseEvent) => void;
  /** Resources shown in the roll-up (already `hideExternal`-filtered upstream). */
  visibleResources: readonly Resource[];
}

export function PlanningTable({
  lang,
  plan,
  viewGranularity,
  rows,
  absences,
  workdayHours,
  holidaySet,
  onEditResource,
  onSetUtilization,
  onSetAbsenceOverride,
  planColWidths,
  planSort,
  planClick,
  planStartResize,
  showRollup,
  onToggleRollup,
  rollupColWidths,
  rollupStartResize,
  visibleResources,
}: PlanningTableProps) {
  // CANONICAL (entry) periods — where utilization is stored & edited.
  const canonicalPeriods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
  // VIEW periods — how the grid is currently sliced for display.
  const periods = generatePeriods(plan.startDate, plan.endDate, viewGranularity);
  // `derived` = the view granularity differs from the entry/canonical granularity,
  // so cells are read-only borrowed values (you edit at the entry granularity).
  const derived = viewGranularity !== plan.granularity;
  const th = useSortHeaderProps(planSort.key, planSort.dir, planClick, planStartResize);
  return (
    <>
      <div className={INNER_TABLE_CLASS}>
        <table className="w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <SortResizeTh {...th} label={t(lang, "assignee")} sortCol="assignee" width={planColWidths.assignee} />
              {periods.map((p) => (
                <th key={p.key} className="relative px-3 py-2 font-medium tabular-nums" style={{ width: planColWidths.period, minWidth: planColWidths.period }}>
                  {p.key}
                  <ColumnResizeHandle col="period" onMouseDown={planStartResize} />
                </th>
              ))}
              <SortResizeTh {...th} label={t(lang, "planningCapacityHours")} sortCol="capacityHours" width={planColWidths.capacityHours} align="right" />
              <SortResizeTh {...th} label={t(lang, "resourcesCapacityDays")} sortCol="capacityDays" width={planColWidths.capacityDays} align="right" hint={t(lang, "resourcesCapacityDaysHint")} />
              <SortResizeTh {...th} label={t(lang, "resourcesInternalCost")} sortCol="internalCost" width={planColWidths.internalCost} align="right" hint={t(lang, "resourcesInternalCostHint")} />
              <SortResizeTh {...th} label={t(lang, "resourcesExternalCost")} sortCol="externalCost" width={planColWidths.externalCost} align="right" hint={t(lang, "resourcesExternalCostHint")} />
              <SortResizeTh {...th} label={t(lang, "resourcesMargin")} sortCol="margin" width={planColWidths.margin} align="right" hint={t(lang, "resourcesMarginHint")} />
            </tr>
          </thead>
          {(() => {
            const loc = localeFor(lang);
            const totals = rows.reduce((acc, row) => ({
              hours: acc.hours + row.totalHours,
              days: acc.days + row.capacityDays,
              internal: acc.internal + row.internalCost,
              external: acc.external + row.externalCost,
              margin: acc.margin + row.margin,
            }), { hours: 0, days: 0, internal: 0, external: 0, margin: 0 });
            const rowsJsx = rows.map((row) => {
              const r = row.resource;
              const cost = row.cost;
              const totalHours = row.totalHours;
              const resAbs = absencesForResource(absences, r);
              return (
                <tr key={r.id} onClick={() => onEditResource(r)} className="cursor-pointer hover:bg-surface-muted">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onEditResource(r); }}
                      title={resourceDisplayName(r)}
                      className="rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-foreground hover:border-ui-dark-blue hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-green dark:text-ui-light-grey"
                    >
                      {resourceDisplayName(r)}
                    </button>
                  </td>
                  {periods.map((p) => {
                    // In a derived (finer) view, mirror the engine's borrow
                    // rule: show the containing canonical period's stored
                    // utilization; there is no fine-grained value to edit.
                    const owner = derived
                      ? canonicalPeriods.find((c) => c.start <= p.start && p.start <= c.end)
                      : undefined;
                    const cellValue = derived
                      ? (owner ? (r.utilization[owner.key] ?? "") : "")
                      : (r.utilization[p.key] ?? "");
                    return (
                    <td key={p.key} className="px-3 py-2 text-right align-top">
                      {/* ONE left-aligned column: the cell is text-right, so bare siblings get
                          their RIGHT edges flushed, and the "%"/"h" suffix makes the utilization
                          box ~8px wider — which offset its input that far left of the absence
                          one. Stacking lines up their LEFT edges; the group stays right-flush. */}
                      <span className="inline-flex flex-col items-start">
                      <span className="inline-flex items-center gap-0.5">
                        <input type="number" min={0} step={r.utilizationMode === "percent" ? 5 : 1}
                          aria-label={t(lang, "resourceUtilizationForPeriod", resourceDisplayName(r), p.key)}
                          title={t(lang, "resourcesUtilizationHint")}
                          value={cellValue}
                          readOnly={derived}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => { if (!derived) onSetUtilization(r.id, p.key, Number(e.target.value) || 0); }}
                          className={`w-16 rounded border border-line px-1 py-0.5 text-right tabular-nums ${FOCUS_RING} ${TRANSITION} ${derived ? "bg-surface-muted opacity-60" : "bg-surface"}`} />
                        <span aria-hidden="true" className="text-xs text-muted-foreground">
                          {r.utilizationMode === "percent" ? "%" : "h"}
                        </span>
                      </span>
                      <input type="number" min={0} step={1}
                        aria-label={t(lang, "resourceAbsenceOverrideForPeriod", resourceDisplayName(r), p.key)}
                        title={t(lang, "resourcesAbsenceOverrideHint")}
                        value={derived ? "" : (r.absenceOverride?.[p.key] ?? "")}
                        placeholder={derived ? "" : String(absenceWorkdays(resAbs, p.start, p.end, holidaySet) * workdayHours)}
                        readOnly={derived}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => { if (!derived) onSetAbsenceOverride(r.id, p.key, e.target.value === "" ? null : Number(e.target.value)); }}
                        className={`mt-0.5 w-16 rounded border border-ui-purple/40 px-1 py-0.5 text-right text-sm tabular-nums text-ui-purple dark:border-ui-purple/50 dark:text-ui-purple ${FOCUS_RING} ${TRANSITION} ${derived ? "bg-surface-muted opacity-60" : "bg-surface"}`} />
                      </span>
                    </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{totalHours.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{(totalHours / workdayHours).toFixed(1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(cost.internal, plan.currency, loc)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(cost.external, plan.currency, loc)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className="inline-flex items-center justify-end gap-1.5">
                      {formatCurrency(cost.margin, plan.currency, loc)}
                      <RagBadge value={marginAmountHealth(cost.margin, cost.external)} lang={lang} title={t(lang, "resourcesMargin")} />
                    </span>
                  </td>
                </tr>
              );
            });
            return (
              <>
                <tbody className="divide-y divide-line">{rowsJsx}</tbody>
                <tfoot className="border-t border-line">
                  <tr className="font-semibold">
                    <td className="px-3 py-2">{t(lang, "resourcesTotal")}</td>
                    <td className="px-3 py-2" colSpan={periods.length} />
                    <td className="px-3 py-2 text-right tabular-nums">{totals.hours.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{totals.days.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totals.internal, plan.currency, loc)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totals.external, plan.currency, loc)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {formatCurrency(totals.margin, plan.currency, loc)}
                        <RagBadge value={marginAmountHealth(totals.margin, totals.external)} lang={lang} title={t(lang, "resourcesMargin")} />
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </>
            );
          })()}
        </table>
      </div>
      {(() => {
        const other: "week" | "month" = plan.granularity === "month" ? "week" : "month";
        const rollupPeriods = generatePeriods(plan.startDate, plan.endDate, other);
        return (
          <div className="mt-3">
            <button type="button" onClick={onToggleRollup}
              title={t(lang, "resourcesRollupHint")}
              className={`rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:border-ui-dark-blue hover:bg-surface-muted dark:text-ui-light-grey print:hidden ${INTERACTIVE}`}>
              {showRollup ? t(lang, "resourcesRollupHide") : t(lang, "resourcesRollupShow")}
            </button>
            {showRollup && (
              <div className="mt-2 overflow-auto rounded-md border border-line pr-2">
                <DataTable className="w-full text-left text-sm" head={<>
                    <tr>
                      <th
                        className="relative px-3 py-2 font-medium"
                        style={{ width: rollupColWidths.assignee, minWidth: rollupColWidths.assignee }}
                      >
                        {t(lang, "assignee")}
                        <ColumnResizeHandle col="assignee" onMouseDown={rollupStartResize} />
                      </th>
                      {rollupPeriods.map((rp) => (
                        <th
                          key={rp.key}
                          className="relative px-3 py-2 font-medium tabular-nums"
                          style={{ width: rollupColWidths.period, minWidth: rollupColWidths.period }}
                        >
                          {rp.key}
                          <ColumnResizeHandle col="period" onMouseDown={rollupStartResize} />
                        </th>
                      ))}
                    </tr>
                  </>} tbodyClassName="divide-y divide-line">
                    {visibleResources.map((r) => {
                      const resAbs2 = absencesForResource(absences, r);
                      return (
                        <tr key={r.id}>
                          <td className="px-3 py-2 font-medium text-foreground">{resourceDisplayName(r)}</td>
                          {rollupPeriods.map((rp) => (
                            <td key={rp.key} className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {(displayCapacityHours(rp, canonicalPeriods, r, resAbs2, workdayHours, holidaySet, plan.granularity, other) / workdayHours).toFixed(1)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                </DataTable>
              </div>
            )}
          </div>
        );
      })()}
    </>
  );
}
