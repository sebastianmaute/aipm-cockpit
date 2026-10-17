/**
 * The simulated cost range's shared wording (§502 part 3): ONE source for the missing-input line and the
 * P50/P80/P95/chance rows, used by the pace card (`SimCostBlock`), the burn tile (`SimTileLine`) and the
 * Forecast view (`CostTable`), so the three can never word the same state differently.
 */
import { localeFor, t, type Lang } from "./i18n";
import { formatShare } from "./forecast-format";
import type { CostAtFinish } from "./forecast/cost";
import { percentileWord, type SimPercentile } from "./percentile-words";

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

/** The chance over budget as a share. A chance that rounds to 0 % or 100 % without being exactly that reads
 *  "<1 %" / ">99 %", so a small risk never shows as none and a near-certain overrun never as certain. */
export function formatChanceOverBudget(chance: number, locale: string): string {
  if (chance > 0 && chance < 0.005) return `<${formatShare(0.01, locale)}`;
  if (chance >= 0.995 && chance < 1) return `>${formatShare(0.99, locale)}`;
  return formatShare(chance, locale);
}

/** A percentile row label: the plain word, then "(Pxx)", e.g. "Safe to commit (P80)". */
export function percentileLabel(lang: Lang, p: SimPercentile): string {
  return `${t(lang, percentileWord(p))} (P${p})`;
}

/** [term, value] rows: P50, P80, P95, then the chance over budget when there is a budget. `figure`
 *  formats an amount in the surface's unit; a beyond-horizon percentile reads "beyond the horizon". */
export function costRangeRows(lang: Lang, cost: Sim, figure: (v: number) => string): [string, string][] {
  const show = (v: number | "beyond") => (v === "beyond" ? t(lang, "simHistogramBeyond") : figure(v));
  const rows: [string, string][] = [
    [percentileLabel(lang, 50), show(cost.p50)],
    [percentileLabel(lang, 80), show(cost.p80)],
    [percentileLabel(lang, 95), show(cost.p95)],
  ];
  if (cost.chanceOverBudget !== null) rows.push([t(lang, "budgetSimChanceOver"), formatChanceOverBudget(cost.chanceOverBudget, localeFor(lang))]);
  return rows;
}
