"use client";

// Monte Carlo schedule forecast view (§502), orchestrator only: holds the mode and
// inputs, runs the pure engine (`./forecast`) once per input change in a useMemo,
// and hands the result to the presentational toolbar, chart and tables.

import { useMemo, useState } from "react";
import { type Lang, t, tPlural } from "./i18n";
import { localeFor } from "./date-format";
import { formatDayMonthYear } from "./forecast-format";
import {
  DEFAULT_WHAT_IF,
  clampWhatIf,
  computeScheduleForecast,
  effortCoverage,
  lastForecastableDay,
  type ForecastInsufficient,
  type ScheduleForecast,
  type WhatIf,
} from "./forecast";
import { DEFAULT_HISTORY_WINDOW, type ForecastUnit, type HistoryWindow } from "./forecast/constants";
import { ForecastToolbar, type ForecastMode, type WhatIfField } from "./forecast-toolbar";
import { ForecastChart } from "./forecast-chart";
import { MilestoneTable, PercentileTable } from "./forecast-tables";
import { ReportCard } from "./report-table";
import { EmptyState } from "./empty-state";
import { isValidIsoDate } from "./forecast/throughput";
import { isTaskClosed } from "./task-closed";
import type { Milestone, ResourcePlan, Task } from "./types";
import { useResizable } from "./use-resizable";
import { nthWorkingDayAfter } from "./working-days";

const FALLBACK_TARGET_WORKING_DAYS = 30;

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
  /** Accepted for the view contract; the panel writes nothing, so a popout needs no guard. */
  isPopout?: boolean;
}

export function ForecastPanel({ lang, tasks, milestones, plan, today, holidaySet }: Props) {
  const [mode, setMode] = useState<ForecastMode>("quick");
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
  // Quick always runs the plain forecast, whatever the What-if fields still hold.
  const appliedWhatIf = mode === "whatif" ? whatIf : DEFAULT_WHAT_IF;

  const result = useMemo(
    () =>
      computeScheduleForecast({
        tasks,
        milestones,
        today,
        holidaySet,
        window: historyWindow,
        unit,
        whatIf: appliedWhatIf,
        howManyTarget,
      }),
    [tasks, milestones, today, holidaySet, historyWindow, unit, appliedWhatIf, howManyTarget],
  );

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
          whatIf={whatIf}
          onCommitWhatIf={commitWhatIf}
          onResetSize={reset}
        />
      </div>
      {result.kind === "insufficient" ? (
        <InsufficientState lang={lang} result={result} />
      ) : (
        <>
          <ForecastCaption lang={lang} forecast={result} historyWindow={historyWindow} />
          <ForecastChart lang={lang} forecast={result} today={today} holidaySet={holidaySet} />
          <PercentileTable lang={lang} forecast={result} target={howManyTarget} today={today} maxTarget={maxTarget} onTargetChange={setTarget} />
          <MilestoneTable lang={lang} milestones={milestones} chances={result.milestones} whatIf={mode === "whatif"} />
        </>
      )}
    </ReportCard>
  );
}

/** The history floor is not met: say which shortfall(s), in counts the user can act on. */
function InsufficientState({ lang, result }: { lang: Lang; result: ForecastInsufficient }) {
  const lines: string[] = [];
  if (result.finished < result.neededFinished) {
    lines.push(t(lang, "forecastInsufficient", result.finished, result.neededFinished, result.neededFinished - result.finished));
  }
  if (result.days < result.neededDays) {
    const args = [result.days, result.neededDays, result.neededDays - result.days] as const;
    // R14 cut a fixed window at the first completion: say so, or "8 of 10 days" reads as a wrong window.
    lines.push(
      result.windowCutAt === null
        ? t(lang, "forecastInsufficientDays", ...args)
        : t(lang, "forecastInsufficientDaysCut", ...args, formatDayMonthYear(result.windowCutAt, localeFor(lang))),
    );
  }
  if (result.doneWithoutDate > 0) lines.push(tPlural(lang, "forecastDoneWithoutDate", result.doneWithoutDate, result.doneWithoutDate));
  const [first, ...rest] = lines;
  return (
    <div className="pb-6">
      <EmptyState title={t(lang, "forecastInsufficientTitle")} description={first} />
      {rest.map((line) => (
        <p key={line} className="text-center text-xs text-muted-foreground">
          {line}
        </p>
      ))}
    </div>
  );
}

function ForecastCaption({ lang, forecast, historyWindow }: { lang: Lang; forecast: ScheduleForecast; historyWindow: HistoryWindow }) {
  const locale = localeFor(lang);
  const runs = new Intl.NumberFormat(locale).format(forecast.trials);
  const basis =
    historyWindow === "all"
      ? t(lang, "forecastBasisAll", runs, forecast.windowDays, forecast.finished)
      : t(lang, "forecastBasis", runs, forecast.windowDays, forecast.finished);
  const beyond = t(lang, "forecastPercent", forecast.beyondShare < 0.01 ? "< 1" : Math.round(forecast.beyondShare * 100));
  return (
    <div className="space-y-0.5 text-xs text-muted-foreground">
      <p>{basis}</p>
      {forecast.doneWithoutDate > 0 && <p>{tPlural(lang, "forecastDoneWithoutDate", forecast.doneWithoutDate, forecast.doneWithoutDate)}</p>}
      {forecast.beyondShare > 0 && <p>{t(lang, "forecastBeyondShare", beyond)}</p>}
    </div>
  );
}
