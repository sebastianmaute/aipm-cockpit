"use client";

// The Reports Forecast section (§502 part 4, spec §3.2): the decision surface a sponsor reads. In order: the target
// control, the verdict `Banner` and the basis line, four simulated tiles, the small P80-over-time line, the plan
// end's "what it would take", the milestones table worst first, the proposed intervention and the "Forecast by
// group" fold-out. ★ No title of its own: `ArrangementTile` draws the block's heading from the catalogue, and a
// second one would stack two identical headings (see `reports.tsx`'s `renderBlock`).
//
// The runs: As is is the SHARED app run (`computeAppScheduleRun`, the memo `useAppForecast` fills on this tab), handed
// to `computeScenarioComparison` so no second 10,000-trial run happens (spec §4); the proposal's column once per
// proposal, and the lever search off the render path (`useLeverSearch`, which is given `enabled: false` below the
// history floor, so an insufficient run searches nothing). Run settings are the app-wide defaults the Forecast
// view opens with, so an Explore draft opened from here shows the number its row did.

import { useMemo } from "react";
import { type Lang, t, tPlural } from "./i18n";
import { localeFor } from "./date-format";
import { formatDayMonthYear } from "./forecast-format";
import { formatChance, formatWhen } from "./forecast-tables";
import { formatChanceOverBudget, percentileLabel } from "./budget-sim-text";
import {
  computeScenarioColumn, computeScenarioComparison, sharedAsIsRun, type ScenarioColumn, type ScenarioRunInput,
} from "./forecast-scenario-compare";
import type { ScheduleForecast } from "./forecast";
import { milestoneCounts, milestoneRowsWorstFirst } from "./forecast-milestone-rows";
import { useRowTokens } from "./use-row-tokens";
import type { ForecastHistoryEntry } from "./forecast-history";
import type { ForecastScenario } from "./forecast-scenarios";
import type { LeverTarget } from "./forecast-levers";
import { leverKey, useLeverSearch } from "./use-lever-search";
import type { ForecastSettingsApi } from "./use-forecast-settings";
import { chanceRagLevel, chanceSeverity, type TargetConfidence } from "./forecast-target";
import { chanceRagLabel } from "./forecast-rag-label";
import { forecastVerdict, type ForecastVerdict } from "./forecast-verdict";
import { isValidIsoDate } from "./forecast/throughput";
import { addCalendarDays, countWorkingDays } from "./working-days";
import type { ForecastDraftRequest } from "./workspace-tab-context";
import type { BudgetCurrency } from "./types";
import { Banner } from "./banner";
import { RagDot } from "./rag-dot";
import { Tile } from "./report-table";
import { SimBadge, SimPlaceholder, SimValue } from "./sim-value";
import { ForecastTargetControl } from "./forecast-target-control";
import { ForecastLeverCell } from "./forecast-lever-cell";
import { InsufficientState } from "./forecast-insufficient";
import { ForecastCaption } from "./forecast-caption";
import { ForecastP80Line } from "./forecast-p80-line";
import { ForecastReportMilestones, exploreFor } from "./forecast-report-milestones";
import { ForecastReportProposal, columnCostText, liveProposal } from "./forecast-report-proposal";
import { ForecastGroupFold } from "./forecast-group-fold";

export type ForecastReportProps = {
  /** The As-is run's inputs (workspace-section builds it on the Reports tab); null while the holiday calendar loads. */
  input: ScenarioRunInput | null;
  scenarios: readonly ForecastScenario[];
  settings: ForecastSettingsApi;
  history: readonly ForecastHistoryEntry[];
  currency: BudgetCurrency;
  /** A popout: the target control and the proposal select are disabled, and there is no Explore. */
  readOnly: boolean;
  /** Opens the Forecast view on a draft (`requestForecastDraft`); absent = no Explore buttons. */
  onExplore?: (req: ForecastDraftRequest) => void;
  /** The AI master switch (`isAiEnabled(settings.ai)`); off, no "Ask Claude to draft a proposal" button renders. */
  aiEnabled?: boolean;
};

const NONE = "—";
const PLAN_END: LeverTarget = { kind: "planEnd" };
/** The plan end's pseudo row in the token list (as the Scenarios view's "As is"): milestone ids are positive. */
const PLAN_END_ROW_ID = -1;
const nameOfRow = (r: { name: string }) => r.name;

function verdictText(lang: Lang, verdict: ForecastVerdict, planEnd: string, chance: number, goal: TargetConfidence): { head: string; rest: string } {
  // The plan end on target but a milestone overdue: not "On target", and not "Below target" either (it is not).
  const planEndOn = chanceSeverity(chance, goal) === "green";
  const headKey = verdict.severity === "success" ? "forecastReportVerdictOn" : planEndOn ? "forecastReportVerdictOverdueHead" : "forecastReportVerdictBelow";
  const planEndText = t(lang, "forecastReportVerdictPlanEnd", formatDayMonthYear(planEnd, localeFor(lang)), formatChance(chance, lang), t(lang, "forecastPercent", goal));
  const milestones = verdict.total > 0 ? tPlural(lang, "forecastReportVerdictMilestones", verdict.below, verdict.below, verdict.total) : "";
  const overdue = verdict.overdue > 0 ? tPlural(lang, "forecastReportVerdictOverdue", verdict.overdue, verdict.overdue) : "";
  return { head: t(lang, headKey), rest: [planEndText, milestones, overdue].filter((s) => s !== "").join(" ") };
}

/** "14 working days after plan end" under the Safe-to-commit tile; undefined beyond the horizon or with no plan end. */
function planEndDelta(lang: Lang, p80: string | null, planEnd: string, holidaySet: ReadonlySet<string>): string | undefined {
  if (p80 === null || !isValidIsoDate(planEnd)) return undefined;
  const [from, to] = p80 > planEnd ? [planEnd, p80] : [p80, planEnd];
  const n = countWorkingDays(addCalendarDays(from, 1), addCalendarDays(to, 1), holidaySet);
  if (n === 0) return t(lang, "forecastReportOnPlanEnd");
  return tPlural(lang, p80 > planEnd ? "forecastReportAfterPlanEnd" : "forecastReportBeforePlanEnd", n, n);
}

function ForecastTiles({ lang, forecast, asIs, input, goal, currency }: {
  lang: Lang; forecast: ScheduleForecast; asIs: ScenarioColumn; input: ScenarioRunInput; goal: TargetConfidence; currency: BudgetCurrency;
}) {
  const when = (p: number) => forecast.when.find((w) => w.p === p)?.date ?? null;
  const p50Label = percentileLabel(lang, 50);
  const p80Label = percentileLabel(lang, 80);
  const onTimeLabel = t(lang, "kpiOnTime");
  const costLabel = t(lang, "forecastScenarioRowCostP80");
  const chance = asIs.chanceOnTime;
  const rag = chance === null ? null : chanceRagLevel(chance, goal);
  const costText = columnCostText(lang, asIs, currency);
  const overBudget = asIs.cost?.kind === "sim" ? asIs.cost.chanceOverBudget : null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="forecast-report-tiles">
      <Tile flat label={p50Label} value={<SimValue lang={lang} label={p50Label} value={formatWhen(when(50), lang)} />} />
      <Tile flat label={p80Label} value={<SimValue lang={lang} label={p80Label} value={formatWhen(when(80), lang)} />}
        sub={planEndDelta(lang, when(80), input.planEnd, input.holidaySet)} />
      <Tile flat label={onTimeLabel}
        rag={rag === null ? undefined : <RagDot level={rag} label={chanceRagLabel(lang, rag)} />}
        value={chance === null ? NONE : <SimValue lang={lang} label={onTimeLabel} value={formatChance(chance, lang)} />} />
      {costText !== null && (
        <Tile flat label={costLabel} value={<SimValue lang={lang} label={costLabel} value={costText} />}
          sub={overBudget === null ? undefined : t(lang, "forecastReportChanceOverBudget", formatChanceOverBudget(overBudget, localeFor(lang)))} />
      )}
    </div>
  );
}

function ForecastReportBody({ lang, input, scenarios, settings, history, currency, readOnly, onExplore, aiEnabled = false }: Omit<ForecastReportProps, "input"> & {
  lang: Lang; input: ScenarioRunInput;
}) {
  const goal = settings.target;
  const base = useMemo(() => computeScenarioComparison(input, [], sharedAsIsRun(input)), [input]);
  const { asIs, context } = base;
  const forecast = asIs.forecast;
  // The stale-id rule (`proposalIdOf`) a second time: an id naming no scenario in THIS list is no proposal.
  const proposalChanges = liveProposal(settings.proposalId, scenarios)?.changes ?? null;
  const proposalColumn = useMemo(
    () => (proposalChanges === null ? null : computeScenarioColumn(input, proposalChanges, context)),
    [input, proposalChanges, context],
  );
  // Ruling A: only targets WITH an As-is chance are searched; an overdue milestone, or one with nothing linked, has no lever.
  const chanceOnTime = asIs.chanceOnTime;
  const targets = useMemo<LeverTarget[]>(() => (forecast.kind !== "forecast" ? [] : [
    ...(chanceOnTime === null ? [] : [PLAN_END]),
    ...forecast.milestones.flatMap((m): LeverTarget[] => (m.state === "chance" ? [{ kind: "milestone", id: m.id }] : [])),
  ]), [forecast, chanceOnTime]);
  const levers = useLeverSearch({ input, targets, goal, enabled: forecast.kind === "forecast" });
  const rows = useMemo(
    () => (forecast.kind === "forecast" ? milestoneRowsWorstFirst(input.milestones, forecast.milestones) : []),
    [input.milestones, forecast],
  );
  const planEndName = t(lang, "forecastRangePlanEnd");
  const named = useMemo(() => [{ id: PLAN_END_ROW_ID, name: planEndName }, ...rows], [planEndName, rows]);
  const tokens = useRowTokens(named, nameOfRow);
  const groupInput = useMemo(
    () => ({ tasks: input.tasks, today: input.today, holidaySet: input.holidaySet, planEnd: input.planEnd }),
    [input],
  );
  if (forecast.kind === "insufficient") return <InsufficientState lang={lang} result={forecast} />;

  const explore = readOnly ? undefined : onExplore;
  const askClaude = aiEnabled && !readOnly;
  const verdict = forecastVerdict(chanceOnTime, goal, milestoneCounts(forecast.milestones, goal));
  const text = verdict === null || chanceOnTime === null ? null : verdictText(lang, verdict, input.planEnd, chanceOnTime, goal);
  const planEndBelow = chanceOnTime !== null && chanceSeverity(chanceOnTime, goal) !== "green";
  // Absent = the search left the plan end out (its `whatItTakesSync` is null): no lever line, as the view shows no cell.
  const planEndLevers = levers.get(leverKey(PLAN_END));
  return (
    <div className="space-y-3">
      {verdict && text && (
        <Banner severity={verdict.severity} data-testid="forecast-verdict"><strong>{text.head}</strong> {text.rest}</Banner>
      )}
      <ForecastCaption lang={lang} forecast={forecast} historyWindow={input.window} />
      <ForecastTiles lang={lang} forecast={forecast} asIs={asIs} input={input} goal={goal} currency={currency} />
      <ForecastP80Line lang={lang} history={history} planEnd={input.planEnd} compact />
      {planEndBelow && planEndLevers !== undefined && (
        <div className="flex flex-wrap items-start gap-2" data-testid="forecast-plan-end-lever">
          <span className="text-xs font-medium text-foreground">{t(lang, "forecastReportPlanEndLever", t(lang, "forecastPercent", goal))}</span>
          <ForecastLeverCell
            lang={lang} milestoneName={tokens.get(PLAN_END_ROW_ID) ?? planEndName} result={planEndLevers} goal={goal}
            onExplore={exploreFor(PLAN_END, planEndLevers, explore)} exploreLabel={t(lang, "forecastReportExplore")}
          />
        </div>
      )}
      <ForecastReportMilestones lang={lang} rows={rows} tokens={tokens} goal={goal} levers={levers} onExplore={explore} askClaude={askClaude} />
      <ForecastReportProposal
        lang={lang} scenarios={scenarios} proposalId={settings.proposalId} onChange={settings.setProposal} disabled={readOnly}
        asIs={asIs} proposal={proposalColumn} milestones={input.milestones} tokens={tokens} goal={goal} currency={currency}
        askPlan={askClaude && planEndBelow && chanceOnTime !== null
          ? { date: input.planEnd, chance: chanceOnTime, rowName: tokens.get(PLAN_END_ROW_ID) ?? planEndName }
          : undefined}
      />
      <ForecastGroupFold lang={lang} input={groupInput} />
    </div>
  );
}

export function ForecastReportSection({ lang, ...props }: ForecastReportProps & { lang: Lang }) {
  const { input, settings, readOnly } = props;
  return (
    <div data-testid="forecast-report-section">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <SimBadge lang={lang} />
        <ForecastTargetControl lang={lang} value={settings.target} onChange={settings.setTarget} disabled={readOnly} />
      </div>
      {input === null ? <SimPlaceholder /> : <ForecastReportBody lang={lang} {...props} input={input} />}
    </div>
  );
}
