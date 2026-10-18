// The forecast decision (§502 part 4, spec §3.8) as a two-column (field, value) export section, beside the §545
// budget forecast. The heading ("Forecast decision (simulated)") and the first row both say "simulated": a reader
// who sees only the export must not take a Monte Carlo figure for a plan date. Levers read as the badges do
// (`leverTexts`), so the export and the Reports section never phrase "what it would take" two ways.
//
// ★ DERIVED, not a workspace slice: the decision arrives as `ExportExtras.forecastDecision`, and the CSV / Markdown /
//  JSON workspace formats never carry it (they are storage round-trip formats, pinned by the golden tests).

import { type Lang, localeFor, t } from "./i18n";
import { formatChanceOverBudget, percentileLabel } from "./budget-sim-text";
import { formatChance, formatWhen, leverTexts } from "./forecast-lever-text";
import { formatCurrency } from "./resource-cost";
import type { DecisionMoney, ForecastDecision, ForecastDecisionMilestone } from "./forecast-decision";
import type { TargetConfidence } from "./forecast-target";
import type { BudgetCurrency } from "./types";

const NONE = "—";
const SAFE_TO_COMMIT = 80;

function money(lang: Lang, value: DecisionMoney, currency: BudgetCurrency): string {
  return value === "beyond" ? t(lang, "simHistogramBeyond") : formatCurrency(value, currency, localeFor(lang));
}

/** "31 % — to reach 80 %: +2 people (team average), or 9 fewer tasks". */
function milestoneValue(lang: Lang, m: ForecastDecisionMilestone, goal: TargetConfidence): string {
  const goalText = t(lang, "forecastPercent", goal);
  const chance = formatChance(m.chance, lang);
  if (m.take === null) return `${chance} — ${t(lang, "forecastDecisionTakeUnknown")}`;
  // A preview's background search has not settled this one yet (the Reports cell's own placeholder).
  if (m.take === "pending") return `${chance} — ${t(lang, "forecastLeverWorking")}`;
  const { texts, anyReaches } = leverTexts(lang, m.take, goal);
  const lever = anyReaches
    ? t(lang, "forecastDecisionToReach", goalText, texts.join(", "))
    : [t(lang, "forecastDecisionNoLever", goalText), ...texts].join(", ");
  return `${chance} — ${lever}`;
}

/** The section's body rows. Every decision yields at least the "Forecast (simulated)" row. */
export function forecastDecisionRows(d: ForecastDecision, lang: Lang): string[][] {
  const heading = t(lang, "forecastDecisionHeading");
  if (d.insufficient) return [[heading, t(lang, "forecastInsufficientTitle")]];
  const locale = localeFor(lang);
  // The proposal's cost shows only beside an As-is cost, as the Reports comparison table does.
  const currency = d.cost?.currency;
  const rows: string[][] = [
    [heading, t(lang, "forecastDecisionBasis", new Intl.NumberFormat(locale).format(d.trials), t(lang, "forecastPercent", d.goal))],
    [
      percentileLabel(lang, SAFE_TO_COMMIT),
      d.chanceOnTime === null
        ? formatWhen(d.p80, lang)
        : `${formatWhen(d.p80, lang)} — ${t(lang, "forecastDecisionPlanEnd", formatWhen(d.planEnd, lang), formatChance(d.chanceOnTime, lang))}`,
    ],
  ];
  if (d.cost !== null) {
    const over = d.cost.overBudget === null
      ? "" : ` — ${t(lang, "forecastReportChanceOverBudget", formatChanceOverBudget(d.cost.overBudget, locale))}`;
    rows.push([t(lang, "forecastScenarioRowCostP80"), `${money(lang, d.cost.p80, d.cost.currency)}${over}`]);
  }
  for (const m of d.below) {
    rows.push([t(lang, "forecastDecisionBelow", m.name, formatWhen(m.date, lang)), milestoneValue(lang, m, d.goal)]);
  }
  // Overdue milestones have no chance, so no lever: the row says what the Reports table says (`forecastOverdue`).
  for (const m of d.overdue) {
    rows.push([t(lang, "forecastDecisionOverdue", m.name, formatWhen(m.date, lang)), t(lang, "forecastOverdue")]);
  }
  if (d.proposal !== null) {
    const p = d.proposal;
    const onTime = p.chanceOnTime === null ? NONE : formatChance(p.chanceOnTime, lang);
    const head = t(lang, "forecastDecisionProposal", p.name, formatWhen(p.p80, lang), onTime);
    const cost = p.costP80 === null || currency === undefined
      ? "" : `, ${t(lang, "forecastDecisionProposalCost", money(lang, p.costP80, currency))}`;
    rows.push([t(lang, "forecastReportProposalTitle"), `${head}${cost}`]);
  }
  return rows;
}
