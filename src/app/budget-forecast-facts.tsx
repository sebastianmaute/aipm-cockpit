"use client";

// Forecast facts row (spec §6.1, §6.2): BAC / AC / Remaining / EV, rendered at
// the TOP of the "Project total" section, before the existing tiles. Pure
// presentation over `BudgetForecast["facts"]` — no computation here.
import { type Lang, t, localeFor } from "./i18n";
import { formatCurrency } from "./resource-cost";
import { Tile } from "./report-table";
import { TermTooltip } from "./budget-forecast-tooltip";
import type { BudgetForecast } from "./budget-forecast";
import { rateFactParts, rateFactTip } from "./budget-rate-mix-text";
import type { RateMix } from "./budget-rate-mix";

/** Label with a term-bearing "What is X?" tooltip trigger (§6.2). */
function FactLabel({ lang, term, tip }: { lang: Lang; term: string; tip: string }) {
  return (
    <>
      {term}
      <TermTooltip lang={lang} term={term} tip={tip} />
    </>
  );
}

export function ForecastFactsRow({
  lang, forecast, mix = null,
}: {
  lang: Lang; forecast: BudgetForecast; mix?: RateMix | null;
}) {
  const locale = localeFor(lang);
  const money = (n: number) => formatCurrency(n, "EUR", locale);
  const { bac, ac, remaining, ev, percentComplete } = forecast.facts;

  // EV can be unresolved (a linked bucket has no percent complete) — the tip
  // still renders, with a dash standing in for the unknown figures, rather
  // than being suppressed (facts row always shows all four terms).
  const evMoneyText = ev === null ? "—" : money(ev);
  const evPercentText = percentComplete === null ? "—" : `${percentComplete.toFixed(0)}%`;
  const evValue = ev === null || percentComplete === null ? "—" : `${money(ev)} (${percentComplete.toFixed(0)}%)`;

  const bacTerm = t(lang, "forecastFactBac");
  const acTerm = t(lang, "forecastFactAc");
  const remainingTerm = t(lang, "forecastFactRemaining");
  const evTerm = t(lang, "forecastFactEv");

  // Split into rate/note/arrow by Task 7's `rateFactParts` — the ONE place the
  // `RATE_DRIFT_SIGNAL_RATIO` threshold is checked (controller ruling P13);
  // this component never re-derives the arrow from the raw drift ratio.
  const rateParts = mix ? rateFactParts(lang, mix) : null;

  return (
    <div className={`mb-3 grid grid-cols-2 gap-3 ${mix ? "sm:grid-cols-3 lg:grid-cols-5" : "sm:grid-cols-4"}`}>
      <Tile
        label={<FactLabel lang={lang} term={bacTerm} tip={t(lang, "forecastTipBac", money(bac))} />}
        value={money(bac)}
      />
      <Tile
        label={<FactLabel lang={lang} term={acTerm} tip={t(lang, "forecastTipAc", money(ac))} />}
        value={money(ac)}
      />
      <Tile
        label={<FactLabel lang={lang} term={remainingTerm} tip={t(lang, "forecastTipRemaining", money(bac), money(ac), money(remaining))} />}
        value={money(remaining)}
      />
      <Tile
        label={<FactLabel lang={lang} term={evTerm} tip={t(lang, "forecastTipEv", evMoneyText, evPercentText)} />}
        value={evValue}
      />
      {mix && rateParts ? (
        <Tile
          label={<FactLabel lang={lang} term={t(lang, "forecastFactRate")} tip={rateFactTip(lang, mix)} />}
          value={
            rateParts.arrow !== null ? (
              <>{rateParts.rate} <span aria-hidden="true">{rateParts.arrow}</span> {rateParts.note}</>
            ) : (
              <>{rateParts.rate} · {rateParts.note}</>
            )
          }
        />
      ) : null}
    </div>
  );
}
