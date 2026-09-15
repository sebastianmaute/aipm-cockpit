"use client";

// Forecast method cards (spec §6.1, §6.2): "At current pace" and "At current
// efficiency", each with a question subtitle, its EAC as the large figure, a
// <dl> of VAC/ETC plus method-specific rows, and the gap line below both.
// Pure presentation over `BudgetForecast` — every figure is formatted here,
// nothing is computed.
import { useId, type ReactNode } from "react";
import { type Lang, t, localeFor } from "./i18n";
import { formatCurrency } from "./resource-cost";
import { formatSignedPercent, formatDayMonth, formatDayMonthYear } from "./forecast-format";
import { TermTooltip } from "./budget-forecast-tooltip";
import {
  isPaceAvailable, isEfficiencyAvailable, BURN_RATE_WINDOW_WORKING_DAYS,
  type BudgetForecast, type PaceForecast, type PaceUnavailable,
  type EfficiencyForecast, type EfficiencyUnavailable, type ForecastGap,
} from "./budget-forecast";

type Money = (n: number) => string;
type Facts = BudgetForecast["facts"];

/** One `<dl>` row: term (+ tooltip) on the left, value on the right. */
function MetricRow({
  lang, term, tip, means = false, children,
}: {
  lang: Lang; term: string; tip: string; means?: boolean; children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="flex items-center text-muted-foreground">
        {term}
        <TermTooltip lang={lang} term={term} tip={tip} means={means} />
      </dt>
      <dd className="tabular-nums font-medium text-foreground">{children}</dd>
    </div>
  );
}

/** The card's large EAC figure, labelled above it (§6.1). */
function EacFigure({ lang, label, tip, value }: { lang: Lang; label: string; tip: string; value: string }) {
  return (
    <div className="mt-2">
      <p className="flex items-center text-xs uppercase tracking-wide text-muted-foreground">
        {label}
        <TermTooltip lang={lang} term={label} tip={tip} />
      </p>
      <p className="text-2xl font-semibold tabular-nums text-ui-dark-blue dark:text-ui-light-grey">{value}</p>
    </div>
  );
}

function runOutText(lang: Lang, pace: PaceForecast, locale: string): string {
  if (pace.runOutDate === null) return t(lang, "forecastRunOutAlready");
  const dateText = formatDayMonthYear(pace.runOutDate, locale);
  const days = pace.daysBeforePlannedEnd ?? 0;
  if (days > 0) return t(lang, "forecastRunOutBefore", dateText, String(days));
  if (days < 0) return t(lang, "forecastRunOutAfter", dateText, String(Math.abs(days)));
  return t(lang, "forecastRunOutOnEnd", dateText);
}

function PaceUnavailableBody({ lang, pace }: { lang: Lang; pace: PaceUnavailable }) {
  const key = pace.unavailable === "not-enough-bookings" ? "forecastPaceNotEnough" : "forecastPaceNoBurn";
  return <p className="mt-2 text-sm text-muted-foreground">{t(lang, key)}</p>;
}

function EfficiencyUnavailableBody({ lang, efficiency }: { lang: Lang; efficiency: EfficiencyUnavailable }) {
  if (efficiency.unavailable === "needs-percent-complete") {
    return (
      <p className="mt-2 text-sm text-muted-foreground">
        {t(lang, "forecastEfficiencyNeedsPercent")}
        <TermTooltip lang={lang} term={t(lang, "forecastNeeds")} means tip={t(lang, "forecastTipNeeds")} />
      </p>
    );
  }
  const key = efficiency.unavailable === "no-actual-cost" ? "forecastEfficiencyNoCost" : "forecastEfficiencyNoEarned";
  return <p className="mt-2 text-sm text-muted-foreground">{t(lang, key)}</p>;
}

function PaceCard({
  lang, pace, facts, money, locale, hasFixedPrice,
}: {
  lang: Lang; pace: BudgetForecast["pace"]; facts: Facts; money: Money; locale: string; hasFixedPrice: boolean;
}) {
  const titleId = useId();
  const paceTitle = t(lang, "forecastPaceTitle");
  return (
    <section aria-labelledby={titleId} className="rounded-lg border border-line bg-surface p-3">
      <h4 className="flex items-center text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
        <span id={titleId}>{paceTitle}</span>
        <TermTooltip lang={lang} term={paceTitle} means tip={t(lang, "forecastTipPace", String(BURN_RATE_WINDOW_WORKING_DAYS))} />
      </h4>
      <p className="text-xs text-muted-foreground">{t(lang, "forecastPaceQuestion", String(BURN_RATE_WINDOW_WORKING_DAYS))}</p>
      {isPaceAvailable(pace) ? (
        <>
          <EacFigure
            lang={lang}
            label={t(lang, "forecastEacPace")}
            tip={t(lang, "forecastTipEac", money(facts.ac), money(pace.etc), money(pace.eac))}
            value={money(pace.eac)}
          />
          <dl className="mt-2 space-y-1 text-sm">
            <MetricRow
              lang={lang}
              term={t(lang, "forecastVacPace")}
              tip={t(lang, "forecastTipVac", money(facts.bac), money(pace.eac), money(pace.vac))}
            >
              {money(pace.vac)} ({formatSignedPercent(facts.bac > 0 ? pace.vac / facts.bac : 0, locale, 1)})
            </MetricRow>
            <MetricRow
              lang={lang}
              term={t(lang, "forecastEtcPace")}
              tip={t(lang, "forecastTipEtcPace", money(pace.burnRatePerDay), String(pace.workingDaysLeft), money(pace.etc))}
            >
              {money(pace.etc)}
            </MetricRow>
            <MetricRow
              lang={lang}
              term={t(lang, "forecastBurnRate")}
              tip={t(lang, "forecastTipBurnRate", money(pace.burnRatePerDay * pace.windowDays), String(pace.windowDays), money(pace.burnRatePerDay))}
            >
              {t(lang, "forecastPerDay", money(pace.burnRatePerDay))}
            </MetricRow>
            <MetricRow
              lang={lang}
              term={t(lang, "forecastRunOut")}
              means
              tip={t(lang, "forecastTipRunOut", money(facts.remaining), money(pace.burnRatePerDay))}
            >
              {runOutText(lang, pace, locale)}
            </MetricRow>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            {t(lang, "forecastWindowLine", formatDayMonth(pace.windowStart, locale), formatDayMonth(pace.windowEnd, locale), String(pace.windowDays))}
          </p>
        </>
      ) : (
        <PaceUnavailableBody lang={lang} pace={pace} />
      )}
      {hasFixedPrice && <p className="mt-2 text-xs text-muted-foreground">{t(lang, "forecastFixedPriceNote")}</p>}
    </section>
  );
}

function EfficiencyCard({
  lang, efficiency, facts, money, locale, hasFixedPrice,
}: {
  lang: Lang; efficiency: BudgetForecast["efficiency"]; facts: Facts; money: Money; locale: string; hasFixedPrice: boolean;
}) {
  const titleId = useId();
  const effTitle = t(lang, "forecastEfficiencyTitle");
  // Guaranteed non-null whenever `efficiency` is available (§5.3: EV null ⇒
  // "needs-percent-complete", which is the unavailable branch below).
  const ev = facts.ev ?? 0;
  return (
    <section aria-labelledby={titleId} className="rounded-lg border border-line bg-surface p-3">
      <h4 className="flex items-center text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
        <span id={titleId}>{effTitle}</span>
        <TermTooltip lang={lang} term={effTitle} means tip={t(lang, "forecastTipEfficiency")} />
      </h4>
      <p className="text-xs text-muted-foreground">{t(lang, "forecastEfficiencyQuestion")}</p>
      {isEfficiencyAvailable(efficiency) ? (
        <>
          <EacFigure
            lang={lang}
            label={t(lang, "forecastEacEfficiency")}
            tip={t(lang, "forecastTipEac", money(facts.ac), money(efficiency.etc), money(efficiency.eac))}
            value={money(efficiency.eac)}
          />
          <dl className="mt-2 space-y-1 text-sm">
            <MetricRow
              lang={lang}
              term={t(lang, "forecastVacEfficiency")}
              tip={t(lang, "forecastTipVac", money(facts.bac), money(efficiency.eac), money(efficiency.vac))}
            >
              {money(efficiency.vac)} ({formatSignedPercent(facts.bac > 0 ? efficiency.vac / facts.bac : 0, locale, 1)})
            </MetricRow>
            <MetricRow
              lang={lang}
              term={t(lang, "forecastEtcEfficiency")}
              tip={t(lang, "forecastTipEtcEfficiency", money(facts.bac), money(ev), efficiency.cpi.toFixed(2), money(efficiency.etc))}
            >
              {money(efficiency.etc)}
            </MetricRow>
            <MetricRow
              lang={lang}
              term={t(lang, "forecastCpi")}
              tip={t(lang, "forecastTipCpi", money(ev), money(facts.ac), efficiency.cpi.toFixed(2))}
            >
              {efficiency.cpi.toFixed(2)}
            </MetricRow>
            <MetricRow
              lang={lang}
              term={t(lang, "forecastSpi")}
              tip={t(lang, "forecastTipSpi", money(ev), money(efficiency.pv), efficiency.spi === null ? "—" : efficiency.spi.toFixed(2))}
            >
              {efficiency.spi === null ? "—" : efficiency.spi.toFixed(2)}
            </MetricRow>
          </dl>
        </>
      ) : (
        <EfficiencyUnavailableBody lang={lang} efficiency={efficiency} />
      )}
      {hasFixedPrice && <p className="mt-2 text-xs text-muted-foreground">{t(lang, "forecastFixedPriceNote")}</p>}
    </section>
  );
}

function GapLine({
  lang, gap, pace, efficiency, money, locale,
}: {
  lang: Lang; gap: ForecastGap; pace: PaceForecast; efficiency: EfficiencyForecast; money: Money; locale: string;
}) {
  const pctText = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(gap.percentOfBac);
  const text = t(
    lang, gap.severity === "warning" ? "forecastGapWarning" : "forecastGapInfo",
    money(gap.eacDifference), pctText,
  );
  const extra = gap.extraWorkingDays === null ? null : (
    <>
      {" "}
      {t(lang, "forecastGapExtraDays", String(gap.extraWorkingDays))}
      <TermTooltip
        lang={lang}
        term={t(lang, "forecastExtraDaysTerm")}
        means
        tip={t(
          lang, "forecastTipExtraDays",
          money(efficiency.etc), money(pace.burnRatePerDay),
          String(gap.extraWorkingDays + pace.workingDaysLeft), String(gap.extraWorkingDays),
        )}
      />
    </>
  );
  if (gap.severity === "warning") {
    return <p role="status" className="mt-3 text-sm font-medium">{text}{extra}</p>;
  }
  return <p className="mt-3 text-sm">{text}{extra}</p>;
}

export function ForecastCards({ lang, forecast }: { lang: Lang; forecast: BudgetForecast }) {
  const locale = localeFor(lang);
  const money: Money = (n) => formatCurrency(n, "EUR", locale);
  const { pace, efficiency, gap, facts, hasFixedPrice } = forecast;
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <PaceCard lang={lang} pace={pace} facts={facts} money={money} locale={locale} hasFixedPrice={hasFixedPrice} />
        <EfficiencyCard lang={lang} efficiency={efficiency} facts={facts} money={money} locale={locale} hasFixedPrice={hasFixedPrice} />
      </div>
      {gap && isPaceAvailable(pace) && isEfficiencyAvailable(efficiency) && (
        <GapLine lang={lang} gap={gap} pace={pace} efficiency={efficiency} money={money} locale={locale} />
      )}
    </div>
  );
}
