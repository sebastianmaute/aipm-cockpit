"use client";

// The Forecast view's Scenarios mode (§502, spec §4.2): range bars on one shared axis, the compared table,
// the milestone chances, and the saved scenarios with Edit · Rename · Delete and "New scenario". Every column
// comes from ONE `computeScenarioComparison` call per input or list change. The editor and the rename dialog
// are opened from here; Task 11 renders them (`dialog` below is the open request until then).

import { useId, useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { computeScenarioComparison, type ScenarioRunInput, type ScenarioComparison } from "./forecast-scenario-compare";
import type { ScenarioDirectory } from "./forecast-added-people";
import { MAX_FORECAST_SCENARIOS, type ForecastScenario } from "./forecast-scenarios";
import type { ForecastScenariosApi } from "./use-forecast-scenarios";
import { ScenarioComparisonTable, ScenarioMilestoneTable, type ComparedColumn } from "./forecast-scenario-tables";
import { ForecastRangeBar } from "./forecast-range-bar";
import { formatWhen } from "./forecast-tables";
import { InsufficientState } from "./forecast-insufficient";
import { Button } from "./button";
import { useConfirm } from "./confirm-dialog";
import { Section } from "./report-table";
import { rowLabel } from "./row-tokens";
import { useRowTokens } from "./use-row-tokens";
import { isValidIsoDate } from "./forecast/throughput";

/** The panel's `scenarios` prop; absent = no Scenarios segment and no "Save as scenario". */
export type ForecastScenariosProps = { api: ForecastScenariosApi; directory: ScenarioDirectory; readOnly: boolean };

/** What the view asked to open: the editor (scenario null = new, from `openId`) or the rename dialog. */
export type ScenarioDialog =
  | { kind: "edit"; scenario: ForecastScenario | null; openId: number }
  | { kind: "rename"; scenario: ForecastScenario };

/** As is sits in the token list too, so a scenario named "As is" still gets a distinct name. */
const AS_IS_ID = -1;
type Named = { id: number; name: string };
const nameOf = (n: Named) => n.name;

/** The shared axis: today to the latest in-horizon date any bar shows (P95s, P50/P80s, the plan end). */
function sharedAxis(comparison: ScenarioComparison, today: string, planEnd: string): { lo: string; hi: string } {
  let hi = isValidIsoDate(planEnd) && planEnd > today ? planEnd : today;
  for (const { forecast } of [comparison.asIs, ...comparison.scenarios.map((s) => s.column)]) {
    if (forecast.kind !== "forecast") continue;
    for (const w of forecast.when) if (w.date !== null && w.date > hi) hi = w.date;
  }
  return { lo: today, hi };
}

function RangeBars({ lang, columns, today, planEnd, axis }: {
  lang: Lang; columns: readonly ComparedColumn[]; today: string; planEnd: string; axis: { lo: string; hi: string };
}) {
  return (
    <Section title={t(lang, "forecastScenarioRangeTitle")}>
      <ul className="space-y-1">
        {columns.map(({ key, name, column }) => {
          const { forecast } = column;
          if (forecast.kind !== "forecast") {
            return (
              <li key={key} className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0 truncate font-medium text-foreground">{name}</span>
                <span className="text-muted-foreground">{t(lang, "forecastScenarioColumnInsufficient")}</span>
              </li>
            );
          }
          const at = (p: number) => forecast.when.find((w) => w.p === p)?.date ?? null;
          const [p50, p80, p95] = [at(50), at(80), at(95)];
          return (
            <li key={key} className="flex items-center gap-3 text-sm">
              <span className="w-40 shrink-0 truncate font-medium text-foreground">{name}</span>
              {p50 === null || p80 === null ? (
                <span className="tabular-nums text-muted-foreground">{formatWhen(null, lang)}</span>
              ) : (
                <div className="min-w-0 max-w-md flex-1">
                  <ForecastRangeBar
                    lang={lang} p50={p50} p80={p80} p95={p95} planEnd={planEnd} today={today} axis={axis}
                    label={rowLabel(t(lang, "forecastScenarioRangeTitle"), name)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function ScenarioList({ lang, scenarios, tokens, api, readOnly, onOpen }: {
  lang: Lang; scenarios: readonly ForecastScenario[]; tokens: ReadonlyMap<number, string>;
  api: ForecastScenariosApi; readOnly: boolean; onOpen: (d: ScenarioDialog) => void;
}) {
  const confirm = useConfirm();
  const capId = useId();
  const remove = async (s: ForecastScenario) => {
    const ok = await confirm({
      message: t(lang, "forecastScenarioDeleteConfirm", s.name),
      confirmLabel: t(lang, "forecastScenarioDelete"),
      tone: "danger",
    });
    if (ok) api.deleteScenario(s.id);
  };
  return (
    <Section title={t(lang, "forecastModeScenarios")}>
      {scenarios.length === 0 ? (
        <p className="mb-2 text-sm text-muted-foreground">{t(lang, "forecastScenariosNone")}</p>
      ) : (
        <ul className="mb-2 divide-y divide-line rounded-md border border-line">
          {scenarios.map((s) => {
            // The token can't miss: the list went through useRowTokens in the view.
            const token = tokens.get(s.id) ?? s.name;
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{s.name}</span>
                {!readOnly && (
                  <>
                    <Button variant="secondary" size="xs" aria-label={rowLabel(t(lang, "forecastScenarioEdit"), token)}
                      onClick={() => onOpen({ kind: "edit", scenario: s, openId: s.id })}>
                      {t(lang, "forecastScenarioEdit")}
                    </Button>
                    <Button variant="secondary" size="xs" aria-label={rowLabel(t(lang, "forecastScenarioRename"), token)}
                      onClick={() => onOpen({ kind: "rename", scenario: s })}>
                      {t(lang, "forecastScenarioRename")}
                    </Button>
                    <Button variant="destructive" size="xs" aria-label={rowLabel(t(lang, "forecastScenarioDelete"), token)}
                      onClick={() => void remove(s)}>
                      {t(lang, "forecastScenarioDelete")}
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="xs" disabled={!api.canCreate} aria-describedby={api.canCreate ? undefined : capId}
            onClick={() => onOpen({ kind: "edit", scenario: null, openId: api.mintId() })}>
            {t(lang, "forecastScenarioNew")}
          </Button>
          {/* Visible, not a title: a disabled button takes no focus and a title shows only on hover. */}
          {!api.canCreate && (
            <span id={capId} className="text-xs text-muted-foreground">{t(lang, "forecastScenarioCapReached", MAX_FORECAST_SCENARIOS)}</span>
          )}
        </div>
      )}
    </Section>
  );
}

export function ForecastScenariosView({ lang, input, scenarios }: {
  lang: Lang;
  input: ScenarioRunInput;
  scenarios: ForecastScenariosProps;
}) {
  const { api, readOnly } = scenarios;
  const list = api.scenarios;
  // ONE comparison per input or list change: As is plus one forecast per scenario (spec §5.4).
  const comparison = useMemo(() => computeScenarioComparison(input, list), [input, list]);
  const named = useMemo<Named[]>(
    () => [{ id: AS_IS_ID, name: t(lang, "forecastScenariosAsIs") }, ...list.map((s) => ({ id: s.id, name: s.name }))],
    [lang, list],
  );
  const tokens = useRowTokens(named, nameOf);
  const [dialog, setDialog] = useState<ScenarioDialog | null>(null);

  const columns = useMemo<ComparedColumn[]>(
    () => [
      { key: "as-is", name: tokens.get(AS_IS_ID) ?? t(lang, "forecastScenariosAsIs"), column: comparison.asIs },
      ...comparison.scenarios.map(({ scenario, column }) => ({ key: String(scenario.id), name: tokens.get(scenario.id) ?? scenario.name, column })),
    ],
    [comparison, tokens, lang],
  );
  const listEl = <ScenarioList lang={lang} scenarios={list} tokens={tokens} api={api} readOnly={readOnly} onOpen={setDialog} />;

  // Below the floor every column shares As is's window, so the message shows once; the list stays editable.
  if (comparison.asIs.forecast.kind === "insufficient") {
    return (
      <div data-open-dialog={dialog?.kind}>
        <InsufficientState lang={lang} result={comparison.asIs.forecast} />
        {listEl}
      </div>
    );
  }
  return (
    <div data-open-dialog={dialog?.kind} className="space-y-4">
      {listEl}
      <RangeBars lang={lang} columns={columns} today={input.today} planEnd={input.planEnd} axis={sharedAxis(comparison, input.today, input.planEnd)} />
      <ScenarioComparisonTable lang={lang} columns={columns} currency={input.directory.baseCurrency} />
      <ScenarioMilestoneTable lang={lang} milestones={input.milestones} columns={columns} />
    </div>
  );
}
