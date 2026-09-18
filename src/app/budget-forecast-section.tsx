"use client";

// Forecast section body (MR 3): banners, the role-mix disclosure and the cards.
// Owns the disclosure's open state and the focus nonce the banner action bumps,
// so the Budget report panel stays an orchestrator (plan Ruling 10). Also reads
// and writes the device setting that picks the card (forecast-switch spec B),
// through `useSettings` with a FUNCTIONAL setter, as `BurndownChartPanel` does
// for the chart's two switches.
import { useState } from "react";
import type { Lang } from "./i18n";
import type { PlanGranularity } from "./types";
import type { ForecastBundle } from "./budget-forecast-bundle";
import { useSettings } from "./use-settings";
import { ForecastBanners } from "./budget-forecast-banner";
import { ForecastCards, type ForecastView } from "./budget-forecast-cards";
import { RateMixDetails } from "./budget-rate-mix-details";

export function ForecastSection({ lang, bundle, granularity }: { lang: Lang; bundle: ForecastBundle; granularity: PlanGranularity }) {
  const [mixOpen, setMixOpen] = useState(false);
  const [focusNonce, setFocusNonce] = useState(0);
  const { settings, setSettings } = useSettings();
  const view: ForecastView = settings.budgetForecastView ?? "pace";
  const { eur, hours, mix, history } = bundle;
  const showMix = () => {
    setMixOpen(true);
    setFocusNonce((n) => n + 1);
  };
  return (
    <div className="space-y-3">
      <ForecastBanners lang={lang} forecast={eur} hours={hours} mix={mix} granularity={granularity} onShowMix={mix ? showMix : undefined} />
      {mix ? (
        <RateMixDetails lang={lang} mix={mix} eur={eur} hours={hours} open={mixOpen} onToggle={setMixOpen} focusNonce={focusNonce} />
      ) : null}
      <ForecastCards
        lang={lang} forecast={eur} hours={hours} mix={mix} history={history}
        view={view}
        onViewChange={(v) => setSettings((s) => ({ ...s, budgetForecastView: v }))}
      />
    </div>
  );
}
