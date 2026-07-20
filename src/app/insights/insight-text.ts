// Render layer for Insight records: maps `type` + `data` to localized title +
// detail strings via positional i18n templates. This is the RENDER layer (not a
// pure engine), so it may import `t`/`Lang` — the persisted Insight itself stays
// language-neutral (no prose is ever stored, per insight.ts).
import { type Lang, t, type TranslationKey } from "../i18n";
import type { Insight, InsightType } from "./insight";

const TITLE_KEY: Record<InsightType, TranslationKey> = {
  milestoneSlip: "insightMilestoneSlipTitle",
  overdueTrend: "insightOverdueTrendTitle",
  stalledWork: "insightStalledWorkTitle",
  budgetVariance: "insightBudgetVarianceTitle",
  raidAging: "insightRaidAgingTitle",
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
  return t(lang, TITLE_KEY[insight.type]);
}

/** One-line detail, filling the type's positional template from `data`. */
export function insightDetail(insight: Insight, lang: Lang): string {
  const d = insight.data;
  switch (insight.type) {
    case "milestoneSlip":
      return t(lang, "insightMilestoneSlipDetail", str(d, "name"), num(d, "daysOverdue"), str(d, "date"));
    case "overdueTrend":
      return t(lang, "insightOverdueTrendDetail", num(d, "current"), num(d, "delta"), num(d, "prior"));
    case "stalledWork":
      return t(lang, "insightStalledWorkDetail", num(d, "count"));
    case "budgetVariance":
      return t(lang, "insightBudgetVarianceDetail", str(d, "name"), num(d, "variancePct"), num(d, "buckets"));
    case "raidAging":
      return t(lang, "insightRaidAgingDetail", str(d, "name"), num(d, "daysSinceUpdate"), str(d, "targetDate"));
  }
}
