import { type Lang, t } from "./i18n";
import type { VarianceRow, VarianceKey } from "./snapshot";

export const VARIANCE_LABEL_KEYS: Record<VarianceKey, Parameters<typeof t>[1]> = {
  remainingHours: "trendKpiRemainingHours",
  remainingCost: "trendKpiRemainingCost",
  pctComplete: "trendKpiPctComplete",
  forecastEndDate: "trendKpiForecastSlip",
  spi: "trendKpiSpi",
  cpi: "trendKpiCpi",
};

export function fmtVarianceCell(row: VarianceRow, which: "baseline" | "current"): string {
  if (row.key === "forecastEndDate") return "—";
  const v = row[which];
  if (v === null) return "—";
  if (row.key === "pctComplete") return `${v}%`;
  return String(Math.round(v * 100) / 100);
}

export function fmtVarianceDelta(row: VarianceRow, lang: Lang): string {
  if (row.key === "forecastEndDate") {
    if (row.deltaDays == null) return "—";
    const d = row.deltaDays;
    return d === 0 ? t(lang, "trendsNoSlip") : t(lang, d > 0 ? "trendsSlipDays" : "trendsAheadDays", Math.abs(d));
  }
  if (row.delta === null) return "—";
  const sign = row.delta > 0 ? "+" : "";
  if (row.key === "pctComplete") return `${sign}${row.delta}%`;
  return `${sign}${Math.round(row.delta * 100) / 100}`;
}
