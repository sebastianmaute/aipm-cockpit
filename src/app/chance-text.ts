import { chancePercent } from "./kpi-simulation";
import { type Lang, t } from "./i18n";

/** A simulated chance as display text, never reading as certainty: "<1%" / ">99%" at the edges. */
export function chanceText(lang: Lang, chance: number): string {
  const c = chancePercent(chance);
  if (c.kind === "above99") return t(lang, "kpiSimPercentAbove99");
  if (c.kind === "below1") return t(lang, "kpiSimPercentBelow1");
  return t(lang, "kpiSimPercent", c.percent);
}
