// Render layer for Insight records: maps `type` + `data` to localized title +
// detail strings via positional i18n templates. This is the RENDER layer (not a
// pure engine), so it may import `t`/`Lang` — the persisted Insight itself stays
// language-neutral (no prose is ever stored, per insight.ts).
import { type Lang, t, tPlural, type TranslationKey } from "../i18n";
import { buildRowTokens } from "../row-tokens";
import type { Insight, InsightSeverity, InsightStatus, InsightType } from "./insight";

/** The ONE label map per insight enum. The Insights panel and the document
 *  export read all three, the Dashboard card reads the severity map, and
 *  `insightTitle` below reads the type map, so a German export prints the same
 *  words the panel shows (§621). */
export const INSIGHT_SEVERITY_LABEL_KEY: Record<InsightSeverity, TranslationKey> = {
  high: "insightSeverityHigh",
  medium: "insightSeverityMedium",
  low: "insightSeverityLow",
};
export const INSIGHT_STATUS_LABEL_KEY: Record<InsightStatus, TranslationKey> = {
  active: "insightStatusActive",
  acknowledged: "insightStatusAcknowledged",
  acted: "insightStatusActed",
  dismissed: "insightStatusDismissed",
  resolved: "insightStatusResolved",
};
export const INSIGHT_TYPE_LABEL_KEY: Record<InsightType, TranslationKey> = {
  milestoneSlip: "insightMilestoneSlipTitle",
  overdueTrend: "insightOverdueTrendTitle",
  stalledWork: "insightStalledWorkTitle",
  budgetVariance: "insightBudgetVarianceTitle",
  raidAging: "insightRaidAgingTitle",
  timelogCapPerEntry: "insightTimelogCapPerEntryTitle",
  timelogCapPerDay: "insightTimelogCapPerDayTitle",
  timelogNonWorkingDay: "insightTimelogNonWorkingDayTitle",
  timelogWorkingHours: "insightTimelogWorkingHoursTitle",
};

// Read a `data` field with a graceful fallback (a detector may omit a field).
function str(data: Insight["data"], key: string, fallback = "—"): string {
  const v = data[key];
  return v === undefined || v === null || v === "" ? fallback : String(v);
}
function num(data: Insight["data"], key: string): number {
  const v = data[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Short headline for an insight (type-driven, i18n). */
export function insightTitle(insight: Insight, lang: Lang): string {
  return t(lang, INSIGHT_TYPE_LABEL_KEY[insight.type]);
}

/**
 * Row-unique headline for one insight within a RENDERED LIST.
 *
 * ★★ `insightTitle` is type-driven and nothing else, so two insights of one
 * type produce byte-identical control names - WCAG 2.4.6. Both list surfaces
 * (insights-panel, dashboard InsightsCard) must build names from THIS, never
 * from `insightTitle` directly.
 *
 * ★ Takes the whole rendered list because the disambiguator is an occurrence
 * index over the colliding rows, not a property of one insight.
 */
export function insightRowTitles(insights: readonly Insight[], lang: Lang): Map<number, string> {
  return buildRowTokens(insights.map((i) => ({ id: i.id, name: insightTitle(i, lang) })));
}

/** One-line detail, filling the type's positional template from `data`. */
export function insightDetail(insight: Insight, lang: Lang): string {
  const d = insight.data;
  switch (insight.type) {
    case "milestoneSlip":
      return t(lang, "insightMilestoneSlipDetail", str(d, "name"), num(d, "daysOverdue"), str(d, "date"));
    case "overdueTrend":
      return tPlural(lang, "insightOverdueTrendDetail", num(d, "current"), num(d, "current"), num(d, "delta"), num(d, "prior"));
    case "stalledWork":
      return tPlural(lang, "insightStalledWorkDetail", num(d, "count"), num(d, "count"));
    case "budgetVariance":
      return t(lang, "insightBudgetVarianceDetail", str(d, "name"), num(d, "variancePct"), num(d, "buckets"));
    case "raidAging":
      return t(lang, "insightRaidAgingDetail", str(d, "name"), num(d, "daysSinceUpdate"), str(d, "targetDate"));
    case "timelogCapPerEntry":
      return t(lang, "insightTimelogCapPerEntryDetail", str(d, "person"), num(d, "count"), num(d, "worstHours"), num(d, "threshold"));
    case "timelogCapPerDay":
      return t(lang, "insightTimelogCapPerDayDetail", str(d, "person"), num(d, "count"), num(d, "worstHours"), num(d, "threshold"));
    case "timelogNonWorkingDay":
      return t(lang, "insightTimelogNonWorkingDayDetail", str(d, "person"), num(d, "count"), num(d, "worstHours"), num(d, "threshold"));
    case "timelogWorkingHours":
      return t(lang, "insightTimelogWorkingHoursDetail", str(d, "person"), num(d, "count"), num(d, "worstHours"), num(d, "threshold"));
  }
}
