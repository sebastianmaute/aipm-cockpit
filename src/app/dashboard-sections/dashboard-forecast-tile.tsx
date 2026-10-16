"use client";

import { Button } from "../button";
import { chanceText } from "../chance-text";
import { localeFor } from "../date-format";
import type { AppForecast } from "../forecast/app-forecast";
import { formatDayMonthYear } from "../forecast-format";
import type { ForecastHistoryEntry } from "../forecast-history";
import { ForecastRangeBar } from "../forecast-range-bar";
import { milestonesAtRisk, weeklyChange, type AtRiskMilestone, type WeeklyChange } from "../forecast-tile-model";
import { type Lang, t, tPlural } from "../i18n";
import { kpiSimulationGap } from "../kpi-simulation";
import { simulationGapText } from "../kpi-simulation-text";
import { buildRowTokens, rowLabel } from "../row-tokens";
import { SimPlaceholder, SimValue } from "../sim-value";
import type { Milestone } from "../types";

/**
 * The Dashboard's Forecast tile (§502 part 2). Presentational: the panel runs the ONE forecast it
 * shares with the KPI strip and passes it in. Top to bottom: the P80 headline (one `SimValue`, one
 * explainer), the change since last week, the range bar, the open-task count (calculated, NOT
 * sim), the milestones most at risk and the way to the Forecast view.
 *
 * ★ Unboxed and un-titled: the tile chrome draws the frame and the "Forecast" heading.
 * ★ `forecast` null = holidays still loading: the simulated slots are placeholders, open work shows.
 * ★ An insufficient forecast shows the KPI strip's gap line ALONE, not sim-styled.
 */
export interface DashboardForecastTileProps {
  lang: Lang;
  /** Null = waiting for holidays; the simulated slots render as placeholders. */
  forecast: AppForecast | null;
  history: readonly ForecastHistoryEntry[];
  milestones: readonly Milestone[];
  planEnd: string;
  today: string;
  holidaySet: ReadonlySet<string>;
  openTaskCount: number;
  onOpenMilestone?: (id: number) => void;
  onOpenForecast?: () => void;
  onOpenHelp?: (conceptId: string) => void;
}

const MUTED_LINE = "text-xs text-muted-foreground";

function changeText(lang: Lang, change: WeeklyChange, fmt: (iso: string) => string): { glyph: string | null; text: string } {
  switch (change.kind) {
    case "later": return { glyph: "▲", text: tPlural(lang, "forecastTileLater", change.workingDays, change.workingDays) };
    case "earlier": return { glyph: "▼", text: tPlural(lang, "forecastTileEarlier", change.workingDays, change.workingDays) };
    case "same": return { glyph: null, text: t(lang, "forecastTileNoChange") };
    case "pending": return { glyph: null, text: t(lang, "forecastTileChangeFrom", fmt(change.from)) };
    case "beyond": return { glyph: null, text: t(lang, "forecastTileChangeBeyond") };
  }
}

/** The change since last week. The arrow is decorative; the words carry the direction. */
function ChangeLine({ lang, change, fmt }: { lang: Lang; change: WeeklyChange; fmt: (iso: string) => string }) {
  const { glyph, text } = changeText(lang, change, fmt);
  return (
    <p data-forecast-change className={MUTED_LINE}>
      {glyph && <><span aria-hidden="true">{glyph}</span> </>}
      {text}
    </p>
  );
}

function AtRiskList({
  lang, rows, fmt, onOpenMilestone,
}: {
  lang: Lang;
  rows: readonly AtRiskMilestone[];
  fmt: (iso: string) => string;
  onOpenMilestone?: (id: number) => void;
}) {
  if (rows.length === 0) return <p className={MUTED_LINE}>{t(lang, "forecastTileNoneAtRisk")}</p>;
  // Two milestones can share a name; every row's name is told apart.
  const tokens = buildRowTokens(rows.map((m) => ({ id: m.id, name: m.name })));
  return (
    <ul aria-label={t(lang, "forecastTileAtRisk")} className="space-y-1">
      {rows.map((m) => {
        const token = tokens.get(m.id) ?? m.name;
        const chance = t(lang, "forecastTileChanceOnTime", chanceText(lang, m.chance));
        return (
          <li key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {onOpenMilestone ? (
              <Button variant="secondary" size="xs" aria-label={token} onClick={() => onOpenMilestone(m.id)}>
                {m.name}
              </Button>
            ) : (
              <span className="text-sm font-medium text-foreground">{m.name}</span>
            )}
            <span className={MUTED_LINE}>{fmt(m.date)}</span>
            <SimValue lang={lang} label={rowLabel(chance, token)} value={chance} />
          </li>
        );
      })}
    </ul>
  );
}

export function DashboardForecastTile(props: DashboardForecastTileProps) {
  const { lang, forecast, onOpenForecast } = props;
  const fmt = (iso: string) => formatDayMonthYear(iso, localeFor(lang));
  const gap = forecast ? kpiSimulationGap(forecast) : null;

  if (forecast?.kind === "insufficient") {
    return <p className={MUTED_LINE}>{gap && simulationGapText(lang, gap)}</p>;
  }

  const ready = forecast !== null;
  const change = ready
    ? weeklyChange({ history: props.history, today: props.today, p80: forecast.p80, holidaySet: props.holidaySet })
    : null;
  const atRisk = ready ? milestonesAtRisk(forecast.milestones, props.milestones) : [];
  const forecastLabel = t(lang, "dashboardForecast");

  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          {!ready ? (
            <SimPlaceholder />
          ) : forecast.p80 === null || forecast.p50 === null ? (
            <p className={MUTED_LINE}>{gap && simulationGapText(lang, gap)}</p>
          ) : (
            <>
              <SimValue
                lang={lang}
                label={t(lang, "forecastTileHeadlineLabel", fmt(forecast.p80))}
                value={t(lang, "forecastTileHeadline", fmt(forecast.p80))}
                hint={forecast.p95
                  ? t(lang, "forecastTileHeadlineRest", fmt(forecast.p50), fmt(forecast.p95))
                  : t(lang, "forecastTileHeadlineRestBeyond", fmt(forecast.p50))}
                wrap
                explainer={{
                  windowDays: forecast.windowDays,
                  distribution: forecast.distribution,
                  trials: forecast.trials,
                  markers: forecast.markers,
                  label: forecastLabel,
                }}
                onOpenHelp={props.onOpenHelp}
              />
              <ForecastRangeBar
                lang={lang}
                p50={forecast.p50}
                p80={forecast.p80}
                p95={forecast.p95}
                planEnd={props.planEnd}
                today={props.today}
              />
            </>
          )}
          {change ? <ChangeLine lang={lang} change={change} fmt={fmt} /> : <SimPlaceholder />}
          <p className="text-sm text-foreground">{tPlural(lang, "forecastTileOpenTasks", props.openTaskCount, props.openTaskCount)}</p>
        </div>
        <div className="min-w-0 space-y-1.5">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">{t(lang, "forecastTileAtRisk")}</h4>
          {ready ? (
            <AtRiskList lang={lang} rows={atRisk} fmt={fmt} onOpenMilestone={props.onOpenMilestone} />
          ) : (
            <SimPlaceholder />
          )}
        </div>
      </div>
      {onOpenForecast && (
        <Button variant="ghost" size="xs" className="mt-2 underline-offset-2 hover:underline" onClick={onOpenForecast}>
          {t(lang, "forecastTileOpen")}<span aria-hidden="true"> →</span>
        </Button>
      )}
    </div>
  );
}
