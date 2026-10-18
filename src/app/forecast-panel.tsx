"use client";

// Monte Carlo schedule forecast view (§502), orchestrator only: holds the mode and
// inputs, runs the pure engine (`./forecast`) once per input change in a useMemo,
// and hands the result to the presentational toolbar, chart and tables. Scenarios mode hands its inputs to
// `ForecastScenariosView` instead and runs none of this view's own forecast or cost pass.

import { useEffect, useMemo, useState } from "react";
import { type Lang, t, tPlural } from "./i18n";
import { formatAmount } from "./forecast-tables";
import { localeFor } from "./date-format";
import {
  DEFAULT_WHAT_IF,
  clampWhatIf,
  computeScheduleForecast,
  effortCoverage,
  lastForecastableDay,
  type ScheduleForecast,
  type WhatIf,
} from "./forecast";
import { DEFAULT_HISTORY_WINDOW, type ForecastUnit, type HistoryWindow } from "./forecast/constants";
import { ForecastToolbar, type ForecastMode, type WhatIfField } from "./forecast-toolbar";
import { ForecastChart } from "./forecast-chart";
import { CostTable, MilestoneTable, PercentileTable } from "./forecast-tables";
import { ForecastScenarioNameDialog, scenarioRefusalText } from "./forecast-scenario-name-dialog";
import { MAX_FORECAST_SCENARIOS, SCOPE_TASKS_MAX, whatIfToScenarioChanges } from "./forecast-scenarios";
import type { ForecastFactsByUnit } from "./budget-forecast";
import { simulateCostFromRunMemo } from "./budget-sim";
import { ReportCard } from "./report-table";
import { InsufficientState } from "./forecast-insufficient";
import { ForecastScenariosView, type ExploreDraft, type ExploreDraftOutcome, type ForecastScenariosProps } from "./forecast-scenarios-view";
import { ForecastTargetControl } from "./forecast-target-control";
import { ForecastLeverCell, alternativeLever } from "./forecast-lever-cell";
import type { LeverKind, LeverTarget } from "./forecast-levers";
import { leverKey, useLeverSearch } from "./use-lever-search";
import type { ForecastSettingsApi } from "./use-forecast-settings";
import type { ForecastDraftRequest } from "./workspace-tab-context";
import { DEFAULT_TARGET_CONFIDENCE, chanceRagLevel } from "./forecast-target";
import { computeScenarioComparison, type ScenarioRunInput } from "./forecast-scenario-compare";
import { ForecastAskClaude, worstMilestoneName } from "./forecast-ask-claude";
import { isValidIsoDate } from "./forecast/throughput";
import { isTaskClosed } from "./task-closed";
import type { Milestone, ResourcePlan, Task } from "./types";
import { useResizable } from "./use-resizable";
import { useDeepLinkRowFlash } from "./use-deeplink-row-flash";
import { useWorkspaceTab } from "./workspace-tab-context";
import { nthWorkingDayAfter } from "./working-days";

export { InsufficientState };
export type { ForecastScenariosProps };

const FALLBACK_TARGET_WORKING_DAYS = 30;

/** The Save-as dialog's note: the scope percent frozen into tasks ("+10% = 6 tasks today"), and the cap when
 *  the row was clamped to ±SCOPE_TASKS_MAX. Undefined when neither applies. */
export function saveAsScopeNote(lang: Lang, scopePercent: number, percentTasks: number, clamped: boolean): string | undefined {
  const parts: string[] = [];
  if (scopePercent !== 0) {
    const signed = `${scopePercent > 0 ? "+" : ""}${scopePercent}`;
    parts.push(t(lang, "forecastSaveAsScenarioScopeNote", t(lang, "forecastPercent", signed), formatAmount(percentTasks, "tasks", lang)));
  }
  if (clamped) parts.push(t(lang, "forecastSaveAsScenarioClamped", new Intl.NumberFormat(localeFor(lang)).format(SCOPE_TASKS_MAX)));
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * The How-many target: the earliest unachieved milestone on or after today, else the plan end, else
 * today + 30 working days. Load keeps a shape-valid non-calendar date (2026-11-31) raw, so each
 * candidate must be a real calendar day before it can become the target.
 */
export function defaultHowManyTarget(
  milestones: readonly Milestone[],
  plan: ResourcePlan,
  today: string,
  holidaySet: ReadonlySet<string>,
): string {
  const upcoming = milestones
    .filter((m) => !m.achievedDate && isValidIsoDate(m.date) && m.date >= today)
    .map((m) => m.date)
    .sort();
  if (upcoming.length > 0) return upcoming[0];
  if (isValidIsoDate(plan.endDate) && plan.endDate >= today) return plan.endDate;
  return nthWorkingDayAfter(today, FALLBACK_TARGET_WORKING_DAYS, holidaySet);
}

/** A stored or default target held inside [today, maxTarget], so a passing midnight or a far plan end re-clamps it (R15). */
export function clampHowManyTarget(target: string, today: string, maxTarget: string): string {
  if (target < today) return today;
  return target > maxTarget ? maxTarget : target;
}

/**
 * A What-if value is accepted only when it is a finite number the engine's clamp
 * leaves unchanged, so the field never shows one figure while the forecast uses another.
 */
function parseWhatIf(whatIf: WhatIf, field: WhatIfField, raw: string, openCount: number): WhatIf | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const next = { ...whatIf, [field]: n };
  return clampWhatIf(next, openCount)[field] === n ? next : null;
}

interface Props {
  lang: Lang;
  tasks: readonly Task[];
  milestones: readonly Milestone[];
  plan: ResourcePlan;
  today: string;
  holidaySet: ReadonlySet<string>;
  /** Hides the Ask-Claude menu: a popout has no chat to send to. The writes ("Save as scenario", Scenarios mode)
   *  are guarded by `scenarios.readOnly`, which `workspace-section` sets from the same flag. */
  isPopout?: boolean;
  /** The AI master switch (`isAiEnabled(settings.ai)`); off, the Ask-Claude menu does not render. */
  aiEnabled?: boolean;
  /** The project's "Use Monte Carlo forecasting" switch. On, the Dashboard's simulated cells use the engine defaults, so this view says so once its own settings differ. */
  showSimulation?: boolean;
  /** The pace forecast's facts (`computeProjectForecastFacts`) for the cost-at-finish card; null when the Budget module is off or there are no buckets. */
  budgetFacts?: ForecastFactsByUnit | null;
  /** The Budget module is on. Off, the cost card does not render at all (no add-a-budget line for a module the user turned off). */
  budgetEnabled?: boolean;
  /** Deep-link target (`ForecastPanelDeepLinked`): the milestone row to flash, and the box it is queried in. */
  flashMilestoneId?: number | null;
  milestonesRef?: React.Ref<HTMLDivElement>;
  /** Saved scenarios (§502); absent (tests, older callers) = no Scenarios segment. */
  scenarios?: ForecastScenariosProps;
  /** The project's target confidence and proposal (§502 part 4); absent = no target control, no lever column,
   *  no proposal toggles. */
  forecastSettings?: ForecastSettingsApi;
  /** An Explore request made elsewhere (the Reports Forecast section is planned as its caller) that this view, mounting fresh, opens as a draft once. */
  pendingDraft?: ForecastDraftRequest | null;
  /** Called once the pending request was taken, so the context can drop it. */
  onDraftConsumed?: () => void;
}

/**
 * The view as the workspace mounts it. The sim next-action opens
 * `{ view: "forecast", id }`; this scrolls that milestone's chances row into view
 * and flashes it (`useDeepLinkRowFlash`, as the Milestones and Changes panels do)
 * and consumes the request. Focus stays where the shell puts it on a view change
 * (the main region) — like every other deep-link that opens no editor.
 * ★ The view mounts fresh on each visit, so an unconsumed request would re-flash on the next one.
 * An Explore draft requested from outside the view (§502 part 4; `requestForecastDraft` has no caller yet, Reports is planned) rides the same context and is consumed by the panel once opened.
 */
export function ForecastPanelDeepLinked(props: Omit<Props, "flashMilestoneId" | "milestonesRef" | "pendingDraft" | "onDraftConsumed">) {
  const { pendingOpen, clearPendingOpen, pendingForecastDraft, clearForecastDraft } = useWorkspaceTab();
  const { flashId, containerRef } = useDeepLinkRowFlash("forecast");
  useEffect(() => {
    if (pendingOpen?.view === "forecast") clearPendingOpen();
  }, [pendingOpen, clearPendingOpen]);
  return (
    <ForecastPanel
      {...props} flashMilestoneId={flashId} milestonesRef={containerRef} pendingDraft={pendingForecastDraft} onDraftConsumed={clearForecastDraft}
    />
  );
}

export function ForecastPanel({ lang, tasks, milestones, plan, today, holidaySet, isPopout = false, aiEnabled = false, showSimulation = false, budgetFacts = null, budgetEnabled = false, flashMilestoneId = null, milestonesRef, scenarios, forecastSettings, pendingDraft = null, onDraftConsumed }: Props) {
  const [mode, setMode] = useState<ForecastMode>("quick");
  // §502 part 4 — an Explore draft opens Scenarios mode on an unsaved scenario. A new request is a new object.
  const [draft, setDraft] = useState<ExploreDraft | null>(null);
  // The mode Explore was clicked from: Cancel goes back there, Save stays in Scenarios.
  const [draftFrom, setDraftFrom] = useState<ForecastMode>("quick");
  const openDraft = (req: ForecastDraftRequest) => {
    setDraft((prev) => ({ req, seq: (prev?.seq ?? 0) + 1 }));
    // Every fresh open records where it was opened from; one opened over a draft already showing keeps that origin.
    if (draft === null) setDraftFrom(mode);
    setMode("scenarios");
  };
  const closeDraft = (outcome: ExploreDraftOutcome) => {
    setDraft(null);
    if (outcome === "cancelled") setMode(draftFrom);
  };
  // ★ Remount-swallow (AGENTS.md): the view mounts fresh on each visit, so the handled marker starts at the
  // SENTINEL null — seeding it with the live request would make a fresh mount see it as already handled.
  const [handledDraft, setHandledDraft] = useState<ForecastDraftRequest | null>(null);
  if (pendingDraft !== null && pendingDraft !== handledDraft) {
    setHandledDraft(pendingDraft);
    openDraft(pendingDraft);
  }
  useEffect(() => {
    if (handledDraft !== null) onDraftConsumed?.();
  }, [handledDraft, onDraftConsumed]);
  const [unit, setUnit] = useState<ForecastUnit>("tasks");
  const [historyWindow, setHistoryWindow] = useState<HistoryWindow>(DEFAULT_HISTORY_WINDOW);
  const [whatIf, setWhatIf] = useState<WhatIf>(DEFAULT_WHAT_IF);
  const [target, setTarget] = useState<string | null>(null);
  const { ref, reset } = useResizable("aipm-cockpit:schedule-forecast-size");

  const open = useMemo(() => tasks.filter((task) => !isTaskClosed(task)), [tasks]);
  const coverage = useMemo(() => effortCoverage(open), [open]);
  const fallbackTarget = useMemo(
    () => defaultHowManyTarget(milestones, plan, today, holidaySet),
    [milestones, plan, today, holidaySet],
  );
  const maxTarget = useMemo(() => lastForecastableDay(today, holidaySet), [today, holidaySet]);
  const howManyTarget = clampHowManyTarget(target ?? fallbackTarget, today, maxTarget);
  // What the engine uses, derived at render: a committed scope of -5 reads -3 once only 3 tasks are open,
  // so the field never shows a figure the forecast does not use. The raw value stays, so it heals if they reopen.
  const usedWhatIf = useMemo(() => clampWhatIf(whatIf, open.length), [whatIf, open.length]);
  // Quick always runs the plain forecast, whatever the What-if fields still hold.
  const appliedWhatIf = mode === "whatif" ? usedWhatIf : DEFAULT_WHAT_IF;
  const differsFromDashboard =
    showSimulation &&
    (historyWindow !== DEFAULT_HISTORY_WINDOW ||
      unit !== "tasks" ||
      appliedWhatIf.scopeTasks !== DEFAULT_WHAT_IF.scopeTasks ||
      appliedWhatIf.scopePercent !== DEFAULT_WHAT_IF.scopePercent ||
      appliedWhatIf.capacityPercent !== DEFAULT_WHAT_IF.capacityPercent);

  const inScenarios = mode === "scenarios" && scenarios !== undefined;
  // Scenarios mode runs As is + one forecast per scenario in the view, so this view's own run is skipped there.
  const result = useMemo(
    () =>
      inScenarios ? null : computeScheduleForecast({
        tasks,
        milestones,
        today,
        holidaySet,
        window: historyWindow,
        unit,
        whatIf: appliedWhatIf,
        howManyTarget,
      }),
    [inScenarios, tasks, milestones, today, holidaySet, historyWindow, unit, appliedWhatIf, howManyTarget],
  );
  // The comparison's inputs; a new object only when one of them changes, so the view's one memo keys on it.
  const planEnd = plan.endDate;
  const directory = scenarios?.directory;
  const costOn = showSimulation && budgetEnabled;
  const scenarioInput = useMemo<ScenarioRunInput | null>(
    () => (directory === undefined ? null : {
      tasks, milestones, today, holidaySet, window: historyWindow, unit, planEnd, directory, budgetFacts, costOn,
    }),
    [tasks, milestones, today, holidaySet, historyWindow, unit, planEnd, directory, budgetFacts, costOn],
  );

  // §502 part 4 — "what it would take", Quick only, searched off the render path (`useLeverSearch`). Ruling A: only
  // milestones WITH a chance are searched; an overdue one, or one with nothing linked, shows no lever and no Explore.
  const goal = forecastSettings?.target ?? DEFAULT_TARGET_CONFIDENCE;
  const leversOn = showSimulation && forecastSettings !== undefined && mode === "quick" && result?.kind === "forecast";
  const leverTargets = useMemo(
    () => (result?.kind === "forecast"
      ? result.milestones.flatMap((m): LeverTarget[] => (m.state === "chance" ? [{ kind: "milestone", id: m.id }] : []))
      : []),
    [result],
  );
  const leverValues = useLeverSearch({ input: scenarioInput, targets: leverTargets, goal, enabled: leversOn });

  // Scenarios mode's ONE comparison lives here, not in the view, so As is's milestone chances reach the Ask-Claude
  // menu without a second run; the view gets it as a prop. List identity is the hook's, so this keys like the view's did.
  const scenarioList = scenarios?.api.scenarios;
  const comparison = useMemo(
    () => (inScenarios && scenarioInput !== null && scenarioList !== undefined ? computeScenarioComparison(scenarioInput, scenarioList) : null),
    [inScenarios, scenarioInput, scenarioList],
  );
  const onScreenChances = result?.kind === "forecast" ? result.milestones
    : comparison?.asIs.forecast.kind === "forecast" ? comparison.asIs.forecast.milestones : null;
  const worstMilestone = useMemo(() => worstMilestoneName(milestones, onScreenChances), [milestones, onScreenChances]);
  const askClaude = aiEnabled && showSimulation && !isPopout && (
    <ForecastAskClaude lang={lang} inScenarios={inScenarios} scenarioCount={scenarioList?.length ?? 0} worstMilestone={worstMilestone} />
  );

  // §502 part 3 — cost at finish from THIS run, so What-if scope moves it; money unit only. Capacity is team
  // availability, so it also scales each drawn spend day (burn scales with headcount): alone it is about
  // cost-neutral — the finish moves, the spend per day moves the other way. Nothing runs while the switch is off.
  // Below the schedule floor there is no card at all: `InsufficientState` already says the history is short.
  // A How-many target change rebuilds `result` with the same trial days; the value-keyed memo behind
  // `simulateCostFromRunMemo` then hands back the last range instead of running the pass again.
  const spendScale = appliedWhatIf.capacityPercent / 100;
  const cost = useMemo(() => {
    if (!showSimulation || !budgetEnabled || budgetFacts === null || result?.kind !== "forecast") return null;
    return simulateCostFromRunMemo(result, budgetFacts.eur, "eur", spendScale);
  }, [showSimulation, budgetEnabled, budgetFacts, result, spendScale]);
  const costCard = !inScenarios && showSimulation && budgetEnabled && (
    <CostTable lang={lang} cost={cost} currency={plan.currency} />
  );

  const percentileTable = result?.kind === "forecast" && (
    <PercentileTable lang={lang} forecast={result} target={howManyTarget} today={today} maxTarget={maxTarget} onTargetChange={setTarget} />
  );

  // "Save as scenario" (§502, spec §4.2): the CLAMPED What-if the engine uses, frozen into rows at open.
  const [saveAs, setSaveAs] = useState<(ReturnType<typeof whatIfToScenarioChanges> & { scopePercent: number }) | null>(null);
  const scenarioApi = scenarios && !scenarios.readOnly ? scenarios.api : null;
  const saveAsScenario = scenarioApi === null ? undefined : {
    onClick: () => setSaveAs({ ...whatIfToScenarioChanges(usedWhatIf, open.length, today), scopePercent: usedWhatIf.scopePercent }),
    disabledReason: scenarioApi.canCreate ? null : t(lang, "forecastScenarioCapReached", MAX_FORECAST_SCENARIOS),
  };

  const exploreFrom = (id: number, kind: LeverKind, n: number) => {
    const value = leverValues.get(leverKey({ kind: "milestone", id }));
    if (value === undefined || value === "pending") return;
    openDraft({ target: { kind: "milestone", id }, kind, n, alt: alternativeLever(value, kind) });
  };
  const leverColumn = leversOn ? {
    header: t(lang, "forecastColWhatItTakes", t(lang, "forecastPercent", goal)),
    rag: (chance: number) => chanceRagLevel(chance, goal),
    cell: (id: number, token: string) => {
      const value = leverValues.get(leverKey({ kind: "milestone", id }));
      return value === undefined ? null : (
        <ForecastLeverCell
          lang={lang} milestoneName={token} result={value} goal={goal}
          onExplore={scenarioApi === null ? undefined : (kind, n) => exploreFrom(id, kind, n)}
        />
      );
    },
  } : undefined;
  const targetControl = showSimulation && forecastSettings && (
    <ForecastTargetControl lang={lang} value={forecastSettings.target} onChange={forecastSettings.setTarget} disabled={isPopout} />
  );
  const proposal = showSimulation && forecastSettings ? { id: forecastSettings.proposalId, onChange: forecastSettings.setProposal } : undefined;

  const commitWhatIf = (field: WhatIfField, raw: string): boolean => {
    const next = parseWhatIf(whatIf, field, raw, open.length);
    if (next) setWhatIf(next);
    return next !== null;
  };

  return (
    <ReportCard lang={lang} sizeRef={ref} onResetSize={reset} hideToolbar>
      <div>
        <h2 className="mb-2 text-lg font-medium text-foreground">{t(lang, "forecastScheduleTitle")}</h2>
        <ForecastToolbar
          lang={lang}
          mode={mode}
          onModeChange={setMode}
          unit={unit}
          onUnitChange={setUnit}
          coverage={coverage}
          historyWindow={historyWindow}
          onWindowChange={setHistoryWindow}
          whatIf={usedWhatIf}
          onCommitWhatIf={commitWhatIf}
          onResetSize={reset}
          showScenarios={scenarios !== undefined}
          saveAsScenario={saveAsScenario}
          targetControl={targetControl || undefined}
          askClaude={askClaude || undefined}
        />
        {saveAs !== null && scenarioApi !== null && (
          <ForecastScenarioNameDialog
            lang={lang} open title={t(lang, "forecastSaveAsScenario")} initialName="" list={scenarioApi.scenarios} exceptId={null}
            note={saveAsScopeNote(lang, saveAs.scopePercent, saveAs.percentTasks, saveAs.clamped)}
            onCancel={() => setSaveAs(null)}
            onSave={(name) => {
              const draft = { name, changes: saveAs.changes };
              // Refused without a toast (the cap or the name was taken since open): stay open, stay in What-if.
              if (scenarioApi.createScenario(scenarioApi.mintId(), draft) === null) {
                return scenarioRefusalText(lang, draft, scenarioApi.scenarios, null);
              }
              setSaveAs(null);
              setMode("scenarios");
              return null;
            }}
          />
        )}
        {differsFromDashboard && (
          <p className="mb-2 text-xs text-muted-foreground print:hidden">{t(lang, "forecastDashboardDefaultsNote")}</p>
        )}
      </div>
      {inScenarios && scenarioInput && comparison ? (
        <ForecastScenariosView
          lang={lang} input={scenarioInput} scenarios={scenarios} comparison={comparison} proposal={proposal}
          // Drafts are not gated on the switch (they only come from surfaces that exist with it on); goal and proposal are,
          // so a draft opened with the simulation off still shows no part-4 figures.
          draft={draft} onDraftClose={closeDraft} goal={showSimulation ? forecastSettings?.target : undefined}
        />
      ) : result === null ? null : result.kind === "insufficient" ? (
        <InsufficientState lang={lang} result={result} />
      ) : (
        <>
          <ForecastCaption lang={lang} forecast={result} historyWindow={historyWindow} />
          <ForecastChart lang={lang} forecast={result} today={today} holidaySet={holidaySet} />
          {/* The side-by-side wrapper only with a cost card, so the view without one is the markup it always was. */}
          {costCard ? (
            <div className="flex flex-col gap-4 lg:flex-row">
              <div className="min-w-0 flex-1">{percentileTable}</div>
              <div className="min-w-0 lg:w-96">{costCard}</div>
            </div>
          ) : percentileTable}
          <div ref={milestonesRef}>
            <MilestoneTable
              lang={lang} milestones={milestones} chances={result.milestones} whatIf={mode === "whatif"} flashId={flashMilestoneId} levers={leverColumn}
            />
          </div>
        </>
      )}
    </ReportCard>
  );
}

function ForecastCaption({ lang, forecast, historyWindow }: { lang: Lang; forecast: ScheduleForecast; historyWindow: HistoryWindow }) {
  const locale = localeFor(lang);
  const runs = new Intl.NumberFormat(locale).format(forecast.trials);
  // An empty backlog skips the history floor, so either count can be 0 or 1 here.
  const days = forecast.windowDays;
  const windowText = tPlural(lang, historyWindow === "all" ? "forecastBasisWindowAll" : "forecastBasisWindow", days, days);
  const finishedText = tPlural(lang, "forecastBasisFinished", forecast.finished, forecast.finished);
  const basis = t(lang, "forecastBasis", runs, windowText, finishedText);
  const beyond = t(lang, "forecastPercent", forecast.beyondShare < 0.01 ? "< 1" : Math.round(forecast.beyondShare * 100));
  return (
    <div className="space-y-0.5 text-xs text-muted-foreground">
      <p>{basis}</p>
      {forecast.doneWithoutDate > 0 && <p>{tPlural(lang, "forecastDoneWithoutDate", forecast.doneWithoutDate, forecast.doneWithoutDate)}</p>}
      {forecast.beyondShare > 0 && <p>{t(lang, "forecastBeyondShare", beyond)}</p>}
    </div>
  );
}
