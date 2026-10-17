"use client";

// The Forecast view's Scenarios mode (§502, spec §4.2): range bars on one shared axis, the compared table,
// the milestone chances, and the saved scenarios with Edit · Rename · Delete and "New scenario". Every column
// comes from ONE `computeScenarioComparison` call per input or list change. The editor and the rename dialog
// open from here, each mounted fresh per open (keyed), so their drafts are seeded at mount and never in an effect.

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
import { SimValue } from "./sim-value";
import { ForecastScenarioEditor } from "./forecast-scenario-editor";
import { ForecastScenarioNameDialog } from "./forecast-scenario-name-dialog";

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

/** The shared axis: min(today, plan end) to the latest in-horizon date any bar shows (P95s, P50/P80s, the plan end).
 *  A plan end in the past opens the axis, so its tick is not drawn at today. */
function sharedAxis(comparison: ScenarioComparison, today: string, planEnd: string): { lo: string; hi: string } {
  const plan = isValidIsoDate(planEnd) ? planEnd : null;
  let hi = plan !== null && plan > today ? plan : today;
  for (const { forecast } of [comparison.asIs, ...comparison.scenarios.map((s) => s.column)]) {
    if (forecast.kind !== "forecast") continue;
    for (const w of forecast.when) if (w.date !== null && w.date > hi) hi = w.date;
  }
  return { lo: plan !== null && plan < today ? plan : today, hi };
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
                // "> 5 y" is a simulated figure too, so it wears the sim marking like the bar it stands in for.
                <SimValue lang={lang} label={rowLabel(t(lang, "forecastScenarioRangeTitle"), name)} value={formatWhen(null, lang)} />
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
  const close = () => setDialog(null);
  // A refused write (a concurrent delete) is reported by the hook; the editor already validated the draft.
  const dialogEl = readOnly || dialog === null ? null : dialog.kind === "edit" ? (
    <ForecastScenarioEditor
      key={dialog.scenario?.id ?? `new-${dialog.openId}`}
      lang={lang} open scenario={dialog.scenario} openId={dialog.openId} context={comparison.context} list={list}
      onCancel={close}
      onSave={(d) => {
        if (dialog.scenario) api.updateScenario(dialog.scenario.id, d);
        else api.createScenario(dialog.openId, d);
        close();
      }}
    />
  ) : (
    <ForecastScenarioNameDialog
      key={dialog.scenario.id}
      lang={lang} open title={t(lang, "forecastScenarioRenameTitle")} initialName={dialog.scenario.name} list={list}
      exceptId={dialog.scenario.id} onCancel={close}
      onSave={(name) => {
        api.renameScenario(dialog.scenario.id, name);
        close();
      }}
    />
  );

  // Below the floor every column shares As is's window, so the message shows once; the list stays editable.
  if (comparison.asIs.forecast.kind === "insufficient") {
    return (
      <div>
        <InsufficientState lang={lang} result={comparison.asIs.forecast} />
        {listEl}
        {dialogEl}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {listEl}
      {dialogEl}
      <RangeBars lang={lang} columns={columns} today={input.today} planEnd={input.planEnd} axis={sharedAxis(comparison, input.today, input.planEnd)} />
      <ScenarioComparisonTable lang={lang} columns={columns} currency={input.directory.baseCurrency} />
      <ScenarioMilestoneTable lang={lang} milestones={input.milestones} columns={columns} />
    </div>
  );
}
