/**
 * The simulated cost range's shared wording (§502 part 3): ONE source for the missing-input line and the
 * P50/P80/P95/chance rows, used by the pace card (`SimCostBlock`), the burn tile (`SimTileLine`) and the
 * Forecast view (`CostTable`), so the three can never word the same state differently.
 */
import { localeFor, t, type Lang } from "./i18n";
import { formatShare } from "./forecast-format";
import type { CostAtFinish } from "./forecast/cost";

type Unavailable = Extract<CostAtFinish, { kind: "unavailable" }>;
type Sim = Extract<CostAtFinish, { kind: "sim" }>;

/** The one muted line naming which input the cost range is missing. */
export function costUnavailableText(lang: Lang, cost: Unavailable): string {
  switch (cost.reason) {
    case "schedule-floor":
      return t(lang, "budgetSimMissingSchedule");
    case "no-spend":
      return t(lang, "budgetSimNoSpend");
    case "spend-history":
      return t(lang, "budgetSimMissingSpend", String(cost.neededSpendDays), String(cost.spendDays));
  }
}

/** [term, value] rows: P50, P80, P95, then the chance over budget when there is a budget. `figure`
 *  formats an amount in the surface's unit; a beyond-horizon percentile reads "beyond the horizon". */
export function costRangeRows(lang: Lang, cost: Sim, figure: (v: number) => string): [string, string][] {
  const show = (v: number | "beyond") => (v === "beyond" ? t(lang, "simHistogramBeyond") : figure(v));
  const rows: [string, string][] = [
    [t(lang, "budgetSimP50"), show(cost.p50)],
    [t(lang, "budgetSimP80"), show(cost.p80)],
    [t(lang, "budgetSimP95"), show(cost.p95)],
  ];
  if (cost.chanceOverBudget !== null) rows.push([t(lang, "budgetSimChanceOver"), formatShare(cost.chanceOverBudget, localeFor(lang))]);
  return rows;
}
