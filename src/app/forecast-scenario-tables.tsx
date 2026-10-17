"use client";

// Scenarios mode's two tables (§502, spec §4.2 parts 2 and 3): the compared figures and the milestone
// chances, one column per scenario with As is first. Presentational: the view computes every column
// (`computeScenarioComparison`) and passes them in. Every simulated figure is a `SimValue` named
// "<row>, <column>", so two cells never share an accessible name.

import { useMemo } from "react";
import { type Lang, localeFor, t, type TranslationKey } from "./i18n";
import { formatDayMonthYear } from "./forecast-format";
import { costUnavailableText, formatChanceOverBudget, percentileLabel } from "./budget-sim-text";
import { formatChance, formatWhen } from "./forecast-tables";
import { formatCurrency } from "./resource-cost";
import { SimValue } from "./sim-value";
import { Section } from "./report-table";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { useRowTokens } from "./use-row-tokens";
import { isValidIsoDate } from "./forecast/throughput";
import type { MilestoneChance } from "./forecast/milestones";
import type { ScenarioColumn } from "./forecast-scenario-compare";
import type { AddedPersonStatus } from "./forecast-added-people";
import type { SimPercentile } from "./percentile-words";
import type { BudgetCurrency, Milestone } from "./types";

/** One compared column. `name` is already row-unique (the view passes its row token). */
export type ComparedColumn = { key: string; name: string; column: ScenarioColumn };

const CELL = "px-3 py-2";
const NONE = "—";
const PERCENTILES: readonly SimPercentile[] = [50, 80, 95];

type InertReason = Extract<AddedPersonStatus, { kind: "inert" }>["reason"];
const INERT_REASON_KEY: Record<InertReason, TranslationKey> = {
  "person-gone": "forecastScenarioPersonGone",
  "on-team": "forecastScenarioOnTeam",
  ended: "forecastScenarioEnded",
  "needs-booked-hours": "forecastScenarioNeedsHours",
};

/** A figure cell; `null` = covered by a cell above it that spans down. */
type Cell = { text: string; sim: boolean; rowSpan?: number } | null;
type Row = { key: string; label: string; cells: Cell[] };

const sim = (text: string): Cell => ({ text, sim: true });
const plain = (text: string): Cell => ({ text, sim: false });

/** The distinct inert reasons of a scenario's Add-people rows, then the doubles-the-team warning (§4.1a). */
export function columnNotes(lang: Lang, column: ScenarioColumn): string[] {
  const schedule = column.schedule;
  if (schedule === null) return [];
  const reasons = new Set<InertReason>();
  for (const row of schedule.rows) {
    if (row.kind === "addPeople" && row.status.kind === "inert") reasons.add(row.status.reason);
  }
  const notes = [...reasons].map((r) => t(lang, INERT_REASON_KEY[r]));
  if (schedule.addedShareAtFullSpeed > 1) notes.push(t(lang, "forecastScenarioDoublesTeam"));
  return notes;
}

/** One note per cost caveat of a sized added person: no rate (cost counted as 0) or converted at par. */
function costCaveats(lang: Lang, columns: readonly ComparedColumn[]): string[] {
  const notes = new Set<string>();
  for (const { name, column } of columns) {
    for (const row of column.schedule?.rows ?? []) {
      if (row.kind !== "addPeople" || row.status.kind !== "sized") continue;
      if (row.status.rateNote === "no-rate") notes.add(t(lang, "forecastScenarioNoRate", name, row.status.name));
      if (row.status.rateNote === "at-par") notes.add(t(lang, "forecastScenarioAtPar", name, row.status.name));
    }
  }
  return [...notes];
}

/** The cost rows' two cells for one column: P80 and the chance over budget, or one spanning missing-input line. */
function costCells(lang: Lang, column: ScenarioColumn, currency: BudgetCurrency): [Cell, Cell] {
  const { cost } = column;
  if (cost === null) return [plain(NONE), plain(NONE)];
  if (cost.kind === "unavailable") return [{ text: costUnavailableText(lang, cost), sim: false, rowSpan: 2 }, null];
  const locale = localeFor(lang);
  const p80 = cost.p80 === "beyond" ? t(lang, "simHistogramBeyond") : formatCurrency(cost.p80, currency, locale);
  const over = cost.chanceOverBudget === null ? plain(NONE) : sim(formatChanceOverBudget(cost.chanceOverBudget, locale));
  return [sim(p80), over];
}

function buildRows(lang: Lang, columns: readonly ComparedColumn[], currency: BudgetCurrency): Row[] {
  const hasCost = columns.some((c) => c.column.cost !== null);
  const rows: Row[] = [
    ...PERCENTILES.map((p): Row => ({ key: `p${p}`, label: percentileLabel(lang, p), cells: [] })),
    { key: "on-time", label: t(lang, "forecastScenarioRowOnTime"), cells: [] },
    ...(hasCost
      ? [
          { key: "cost-p80", label: t(lang, "forecastScenarioRowCostP80"), cells: [] },
          { key: "cost-over", label: t(lang, "budgetSimChanceOver"), cells: [] },
        ]
      : []),
  ];
  for (const { column } of columns) {
    const { forecast } = column;
    if (forecast.kind !== "forecast") {
      // The whole column is one line: there are no figures to show for it.
      rows.forEach((row, i) => row.cells.push(i === 0 ? { text: t(lang, "forecastScenarioColumnInsufficient"), sim: false, rowSpan: rows.length } : null));
      continue;
    }
    PERCENTILES.forEach((p, i) => rows[i].cells.push(sim(formatWhen(forecast.when.find((w) => w.p === p)?.date ?? null, lang))));
    rows[3].cells.push(column.chanceOnTime === null ? plain(NONE) : sim(formatChance(column.chanceOnTime, lang)));
    if (hasCost) {
      const [p80, over] = costCells(lang, column, currency);
      rows[4].cells.push(p80);
      rows[5].cells.push(over);
    }
  }
  return rows;
}

function FigureCell({ lang, cell, label }: { lang: Lang; cell: Cell; label: string }) {
  if (cell === null) return null;
  return (
    <td rowSpan={cell.rowSpan} className={`${CELL} text-right tabular-nums ${cell.sim ? "" : "text-muted-foreground"}`}>
      {cell.sim ? <SimValue lang={lang} label={label} value={cell.text} /> : cell.text}
    </td>
  );
}

/** Spec §4.2 part 2: P50 · P80 · P95 · on time by plan end, then (with a cost) cost at finish (P80) and the
 *  chance over budget. Each scenario's notes (inert reasons, doubles-the-team) sit once under its header. */
export function ScenarioComparisonTable({
  lang,
  columns,
  currency,
}: {
  lang: Lang;
  columns: readonly ComparedColumn[];
  currency: BudgetCurrency;
}) {
  const rows = buildRows(lang, columns, currency);
  const notes = columns.map((c) => columnNotes(lang, c.column));
  const caveats = rows.some((r) => r.key === "cost-p80") ? costCaveats(lang, columns) : [];
  return (
    <Section title={t(lang, "forecastScenarioTableTitle")}>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <td className={CELL} />
              {columns.map((c) => (
                <th key={c.key} scope="col" className={`${CELL} text-right font-medium`}>{c.name}</th>
              ))}
            </tr>
            {notes.some((n) => n.length > 0) && (
              <tr>
                <td className={CELL} />
                {columns.map((c, i) => (
                  <td key={c.key} data-column-notes={c.key} className={`${CELL} align-top text-xs font-normal text-muted-foreground`}>
                    {notes[i].length > 0 && (
                      <ul className="space-y-0.5">
                        {notes[i].map((note) => <li key={note}>{note}</li>)}
                      </ul>
                    )}
                  </td>
                ))}
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className={`${CELL} font-medium text-foreground`}>{row.label}</th>
                {row.cells.map((cell, i) => (
                  <FigureCell key={columns[i].key} lang={lang} cell={cell} label={`${row.label}, ${columns[i].name}`} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caveats.map((note) => (
        <p key={note} className="mt-1 text-xs text-muted-foreground">{note}</p>
      ))}
    </Section>
  );
}

type MilestoneRow = { id: number; name: string; date: string; asIs: MilestoneChance };
const nameOfRow = (r: MilestoneRow) => r.name;

/** As-is chance ascending (worst first); a state that is not a chance ("overdue", "no linked tasks") goes last,
 *  in date order. */
function compareRows(a: MilestoneRow, b: MilestoneRow): number {
  const aChance = a.asIs.state === "chance" ? a.asIs.chance : null;
  const bChance = b.asIs.state === "chance" ? b.asIs.chance : null;
  if (aChance !== null && bChance !== null && aChance !== bChance) return aChance - bChance;
  if (aChance !== null && bChance === null) return -1;
  if (aChance === null && bChance !== null) return 1;
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name);
}

function chanceCell(result: MilestoneChance | undefined, lang: Lang): Cell {
  if (result === undefined) return plain(NONE);
  if (result.state === "chance") return sim(formatChance(result.chance, lang));
  return plain(t(lang, result.state === "overdue" ? "forecastOverdue" : "forecastNoLinkedTasks"));
}

/** Spec §4.2 part 3: the chance on time per column for every milestone the As-is run (the FIRST column) reports. */
export function ScenarioMilestoneTable({
  lang,
  milestones,
  columns,
}: {
  lang: Lang;
  milestones: readonly Milestone[];
  columns: readonly ComparedColumn[];
}) {
  const asIs = columns[0]?.column.forecast;
  const rows = useMemo(() => {
    if (asIs === undefined || asIs.kind !== "forecast") return [];
    const byId = new Map(milestones.map((m) => [m.id, m]));
    return asIs.milestones
      .flatMap((c): MilestoneRow[] => {
        const m = byId.get(c.id);
        return m ? [{ id: m.id, name: m.name, date: m.date, asIs: c }] : [];
      })
      .sort(compareRows);
  }, [asIs, milestones]);
  const tokens = useRowTokens(rows, nameOfRow);
  const byColumn = useMemo(
    () => columns.map(({ column }) => new Map(column.forecast.kind === "forecast" ? column.forecast.milestones.map((c) => [c.id, c]) : [])),
    [columns],
  );
  const locale = localeFor(lang);
  return (
    <Section title={t(lang, "forecastScenarioMilestonesTitle")}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "forecastNoMilestones")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="min-w-full text-left text-sm">
            <thead className={TABLE_HEAD_CLASS}>
              <tr>
                <th scope="col" className={`${CELL} font-medium`}>{t(lang, "forecastColMilestone")}</th>
                <th scope="col" className={`${CELL} font-medium`}>{t(lang, "forecastColDate")}</th>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className={`${CELL} text-right font-medium`}>{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => {
                // The token can't miss: every rendered row went through useRowTokens above.
                const token = tokens.get(row.id) ?? row.name;
                return (
                  <tr key={row.id}>
                    <th scope="row" aria-label={token} className={`${CELL} font-medium text-foreground`}>{row.name}</th>
                    <td className={`${CELL} tabular-nums text-muted-foreground`}>{isValidIsoDate(row.date) ? formatDayMonthYear(row.date, locale) : ""}</td>
                    {columns.map((c, i) => (
                      <FigureCell key={c.key} lang={lang} cell={chanceCell(byColumn[i].get(row.id), lang)} label={`${token}, ${c.name}`} />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
