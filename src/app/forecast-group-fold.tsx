"use client";

// "Forecast by group" (§502; surfaces design §3.7, part 4 §3.2 item 6): a native `<details>`, closed by default.
// One full run per group, so nothing is computed until it is opened (`forecastByGroup` runs in a memo keyed on the
// open state). Each simulated figure is a `SimValue` named "<group>, <column>", so two cells never share a name.

import { useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { localeFor } from "./date-format";
import { forecastByGroup, type GroupForecastInput, type GroupForecastRow } from "./forecast-by-group";
import { formatChance, formatWhen } from "./forecast-tables";
import { percentileLabel } from "./budget-sim-text";
import { SimValue } from "./sim-value";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { FOCUS_RING } from "./interaction-styles";

const CELL = "px-3 py-2";
const NONE = "—";
const SAFE_TO_COMMIT = 80;

function insufficientText(lang: Lang, row: Extract<GroupForecastRow, { kind: "insufficient" }>): string {
  return row.finished < row.neededFinished
    ? t(lang, "forecastByGroupInsufficient", row.finished, row.neededFinished)
    : t(lang, "forecastByGroupInsufficientDays", row.days, row.neededDays);
}

function GroupRows({ lang, rows }: { lang: Lang; rows: readonly GroupForecastRow[] }) {
  const locale = localeFor(lang);
  const p80Label = percentileLabel(lang, SAFE_TO_COMMIT);
  const onTimeLabel = t(lang, "kpiOnTime");
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="min-w-full text-left text-sm">
        <thead className={TABLE_HEAD_CLASS}>
          <tr>
            <th scope="col" className={`${CELL} font-medium`}>{t(lang, "forecastByGroupColGroup")}</th>
            <th scope="col" className={`${CELL} text-right font-medium`}>{t(lang, "forecastByGroupColOpen")}</th>
            <th scope="col" className={`${CELL} font-medium`}>{p80Label}</th>
            <th scope="col" className={`${CELL} font-medium`}>{onTimeLabel}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => {
            // Group keys are unique, and "" is the one ungrouped row, so the name is already row-unique.
            const name = row.key === "" ? t(lang, "reportsUngrouped") : row.key;
            return (
              <tr key={row.key}>
                <th scope="row" className={`${CELL} font-medium text-foreground`}>{name}</th>
                <td className={`${CELL} text-right tabular-nums`}>{new Intl.NumberFormat(locale).format(row.open)}</td>
                {row.kind === "insufficient" ? (
                  <td colSpan={2} className={`${CELL} text-muted-foreground`}>{insufficientText(lang, row)}</td>
                ) : (
                  <>
                    <td className={CELL}><SimValue lang={lang} label={`${name}, ${p80Label}`} value={formatWhen(row.p80, lang)} /></td>
                    <td className={CELL}>
                      {row.chanceOnTime === null ? NONE : <SimValue lang={lang} label={`${name}, ${onTimeLabel}`} value={formatChance(row.chanceOnTime, lang)} />}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ForecastGroupFold({ lang, input }: { lang: Lang; input: GroupForecastInput }) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => (open ? forecastByGroup(input) : null), [open, input]);
  return (
    <details className="mt-3" onToggle={(e) => setOpen(e.currentTarget.open)} data-testid="forecast-by-group">
      <summary className={`cursor-pointer text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey ${FOCUS_RING}`}>
        {t(lang, "forecastByGroupTitle")}
      </summary>
      {rows !== null && (
        <div className="mt-2 space-y-2">
          {rows.length === 0
            ? <p className="text-sm text-muted-foreground">{t(lang, "forecastByGroupNone")}</p>
            : <GroupRows lang={lang} rows={rows} />}
          <p className="text-xs text-muted-foreground">{t(lang, "forecastByGroupNote")}</p>
        </div>
      )}
    </details>
  );
}
