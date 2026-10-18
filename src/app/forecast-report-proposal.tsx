"use client";

// The Reports Forecast section's proposed intervention (§502 part 4, spec §3.2 item 5 / §3.5): a `Select` of the
// saved scenarios (and "None") that sets the project's proposal, then As is vs. Proposal on Safe to commit, On time,
// each below-target milestone and Cost at finish. A stored id naming no scenario reads as no proposal (the stale-id
// rule), so the select shows "None" and the empty line shows. Presentational: the section computes both columns.

import { useId } from "react";
import { type Lang, t } from "./i18n";
import { localeFor } from "./date-format";
import { formatChance, formatWhen } from "./forecast-tables";
import { formatCurrency } from "./resource-cost";
import { percentileLabel } from "./budget-sim-text";
import { chanceSeverity, type TargetConfidence } from "./forecast-target";
import { milestoneRowsWorstFirst } from "./forecast-scenario-tables";
import type { ScenarioColumn } from "./forecast-scenario-compare";
import type { ForecastScenario } from "./forecast-scenarios";
import type { BudgetCurrency, Milestone } from "./types";
import { Select } from "./form-controls";
import { Section } from "./report-table";
import { SimValue } from "./sim-value";
import { TABLE_HEAD_CLASS } from "./table-styles";

const CELL = "px-3 py-2";
const NONE = "—";
const SAFE_TO_COMMIT = 80;

/** The P80 finish of a column as text; "—" below the history floor. */
export function columnP80Text(lang: Lang, column: ScenarioColumn): string {
  if (column.forecast.kind !== "forecast") return NONE;
  return formatWhen(column.forecast.when.find((w) => w.p === SAFE_TO_COMMIT)?.date ?? null, lang);
}

/** Cost at finish (P80) of a column as text; null when the column has no simulated cost. */
export function columnCostText(lang: Lang, column: ScenarioColumn, currency: BudgetCurrency): string | null {
  const cost = column.cost;
  if (cost === null || cost.kind !== "sim") return null;
  return cost.p80 === "beyond" ? t(lang, "simHistogramBeyond") : formatCurrency(cost.p80, currency, localeFor(lang));
}

function milestoneText(lang: Lang, column: ScenarioColumn, id: number): string {
  if (column.forecast.kind !== "forecast") return NONE;
  const c = column.forecast.milestones.find((m) => m.id === id);
  return c?.state === "chance" ? formatChance(c.chance, lang) : NONE;
}

function Figure({ lang, label, text }: { lang: Lang; label: string; text: string }) {
  return text === NONE ? <>{NONE}</> : <SimValue lang={lang} label={label} value={text} />;
}

function ComparisonTable({ lang, asIs, proposal, milestones, goal, currency }: {
  lang: Lang; asIs: ScenarioColumn; proposal: ScenarioColumn; milestones: readonly Milestone[]; goal: TargetConfidence; currency: BudgetCurrency;
}) {
  const chances = asIs.forecast.kind === "forecast" ? asIs.forecast.milestones : [];
  const below = milestoneRowsWorstFirst(milestones, chances).filter((r) => r.asIs.state === "chance" && chanceSeverity(r.asIs.chance, goal) !== "green");
  const showCost = columnCostText(lang, asIs, currency) !== null;
  const columns: { key: string; label: string; text: (c: ScenarioColumn) => string }[] = [
    { key: "p80", label: percentileLabel(lang, SAFE_TO_COMMIT), text: (c) => columnP80Text(lang, c) },
    { key: "onTime", label: t(lang, "kpiOnTime"), text: (c) => (c.chanceOnTime === null ? NONE : formatChance(c.chanceOnTime, lang)) },
    ...below.map((r) => ({ key: `m${r.id}`, label: r.name, text: (c: ScenarioColumn) => milestoneText(lang, c, r.id) })),
    ...(showCost ? [{ key: "cost", label: t(lang, "forecastScenarioRowCostP80"), text: (c: ScenarioColumn) => columnCostText(lang, c, currency) ?? NONE }] : []),
  ];
  const rows = [
    { key: "asIs", label: t(lang, "forecastScenariosAsIs"), column: asIs },
    { key: "proposal", label: t(lang, "forecastReportProposalLabel"), column: proposal },
  ];
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="min-w-full text-left text-sm" data-testid="forecast-proposal-table">
        <thead className={TABLE_HEAD_CLASS}>
          <tr>
            <td className={CELL} />
            {columns.map((col) => <th key={col.key} scope="col" className={`${CELL} font-medium`}>{col.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className={`${CELL} font-medium text-foreground`}>{row.label}</th>
              {columns.map((col) => (
                <td key={col.key} className={`${CELL} tabular-nums`}>
                  <Figure lang={lang} label={`${row.label}, ${col.label}`} text={col.text(row.column)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ForecastReportProposal({ lang, scenarios, proposalId, onChange, disabled, asIs, proposal, milestones, goal, currency }: {
  lang: Lang;
  scenarios: readonly ForecastScenario[];
  proposalId: number | null;
  onChange: (id: number | null) => void;
  disabled: boolean;
  asIs: ScenarioColumn;
  /** The proposal's column, computed by the section; null when no live scenario is the proposal. */
  proposal: ScenarioColumn | null;
  milestones: readonly Milestone[];
  goal: TargetConfidence;
  currency: BudgetCurrency;
}) {
  const selectId = useId();
  const live = scenarios.some((s) => s.id === proposalId) ? proposalId : null;
  return (
    <Section title={t(lang, "forecastReportProposalTitle")}>
      {/* Task 6 adds "Ask Claude to draft a proposal" to this row (spec §3.6). */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label htmlFor={selectId} className="text-xs text-muted-foreground">{t(lang, "forecastReportProposalLabel")}</label>
        <Select
          id={selectId} size="xs" className="w-auto" disabled={disabled} value={live === null ? "" : String(live)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">{t(lang, "forecastReportProposalNone")}</option>
          {scenarios.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
        </Select>
      </div>
      {live !== null && proposal !== null ? (
        <ComparisonTable lang={lang} asIs={asIs} proposal={proposal} milestones={milestones} goal={goal} currency={currency} />
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="forecast-proposal-empty">{t(lang, "forecastReportProposalEmpty")}</p>
      )}
    </Section>
  );
}
