"use client";

// The recorded budget changes beside the burn-down chart (spec 2026-09-16 §5.3,
// planning ruling R4). One row per recorded change — date, bucket, signed
// amount and the running attributed scope — with the pace forecast's variance
// split in the footer.
//
// ★ The rows are ORDERED by `orderBudgetChanges`, never by array order:
// `mergeBudgetHistories` unions prev-then-new ids, so a same-project load from
// a second device can hand the entries back out of chronological order, and the
// cumulative column is a running total over whatever order it is given.
//
// No sort, so `SortResizeTh` is deliberately not used (see
// `docs/AGENTS/ui-shell.md` — non-sortable text-only header cells keep a raw
// `<th>`). The `<caption>` is the table's accessible name and carries the unit,
// which is the only thing that tells a "+30" apart from a "+€3,000".
import { type Lang, t, localeFor } from "./i18n";
import { formatCurrency } from "./resource-cost";
import { formatDayMonthYear, formatHours, signedFigure } from "./forecast-format";
import { orderBudgetChanges, type BudgetHistorySummary, type VarianceSplit } from "./budget-history";
import type { ChartUnit } from "./burndown-geometry";

const TH_CLASS = "px-2 py-1 text-left text-xs font-medium text-muted-foreground";
const TH_NUM_CLASS = "px-2 py-1 text-right text-xs font-medium text-muted-foreground";
const TD_CLASS = "px-2 py-1 align-top";
const TD_NUM_CLASS = "px-2 py-1 text-right align-top tabular-nums";

export function BudgetChangeTable({
  lang, history, split, unit, currency,
}: {
  lang: Lang;
  history: BudgetHistorySummary;
  /** The pace forecast's variance split in the DISPLAYED unit, or null when
   *  that forecast is unavailable — the rows still stand on their own then. */
  split: VarianceSplit | null;
  unit: ChartUnit;
  currency: string;
}) {
  const locale = localeFor(lang);
  const eurUnit = unit === "eur";
  const fmt = (v: number) => (eurUnit ? formatCurrency(v, currency, locale) : formatHours(v, locale));
  const signed = (v: number) => signedFigure(fmt(v), v);
  const unitLabel = t(lang, eurUnit ? "burndownUnitEur" : "burndownUnitHours");

  const ordered = orderBudgetChanges(history.changes);
  const deltas = ordered.map((entry) => (eurUnit ? entry.deltaValue : entry.deltaHours));
  // A running total without a reassigned accumulator: `react-hooks/immutability`
  // rejects mutating a local across a render, and the lists here are tiny.
  const runningTotals = deltas.map((_, i) => deltas.slice(0, i + 1).reduce((sum, d) => sum + d, 0));
  const rows = ordered.map((entry, i) => ({
    id: entry.id,
    date: formatDayMonthYear(entry.date, locale),
    bucketName: entry.bucketName,
    removed: entry.kind === "deleted",
    change: signed(deltas[i]),
    cumulative: signed(runningTotals[i]),
  }));

  const footRows: readonly { key: string; term: string; value: number }[] = split === null ? [] : [
    { key: "performance", term: t(lang, "forecastSplitPerformance"), value: split.performance },
    { key: "attributed", term: t(lang, "forecastSplitScope"), value: split.attributed },
    { key: "unattributed", term: t(lang, "forecastSplitUnattributed"), value: split.unattributed },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="mb-1 text-left text-xs uppercase tracking-wide text-muted-foreground">
          {t(lang, "budgetChangeTableCaption", unitLabel)}
        </caption>
        <thead>
          <tr>
            <th scope="col" className={TH_CLASS}>{t(lang, "budgetChangeColDate")}</th>
            <th scope="col" className={TH_CLASS}>{t(lang, "budgetChangeColBucket")}</th>
            <th scope="col" className={TH_NUM_CLASS}>{t(lang, "budgetChangeColChange")}</th>
            <th scope="col" className={TH_NUM_CLASS}>{t(lang, "budgetChangeColCumulative")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-line">
              <td className={TD_CLASS}>{row.date}</td>
              <td className={TD_CLASS}>
                {row.bucketName === "" ? "—" : row.bucketName}
                {/* A deletion is called out in words, never by the sign alone. */}
                {row.removed && (
                  <span className="ml-1 text-xs text-muted-foreground">{t(lang, "budgetChangeRemoved")}</span>
                )}
              </td>
              <td className={TD_NUM_CLASS}>{row.change}</td>
              <td className={TD_NUM_CLASS}>{row.cumulative}</td>
            </tr>
          ))}
        </tbody>
        {footRows.length > 0 && (
          <tfoot className="border-t border-line">
            {footRows.map((row) => (
              <tr key={row.key}>
                <th scope="row" colSpan={3} className={`${TD_CLASS} text-left font-normal text-muted-foreground`}>
                  {row.term}
                </th>
                <td className={TD_NUM_CLASS}>{signed(row.value)}</td>
              </tr>
            ))}
          </tfoot>
        )}
      </table>
      {footRows.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">{t(lang, "budgetChangePaceNote")}</p>
      )}
    </div>
  );
}
