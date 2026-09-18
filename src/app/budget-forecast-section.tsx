"use client";

// Forecast section body (MR 3; forecast-switch spec B): banners, the role-mix
// disclosure, then the forecast ROW — the chosen card (30% from `xl`) beside the
// chart column the caller passes in — and whatever the caller mounts under the
// row at full width. Owns the disclosure's open state, the focus nonce the
// banner action bumps, and the device setting that picks the card (read and
// written through `useSettings` with a FUNCTIONAL setter, as the chart's own
// switches are), so the Budget report panel stays an orchestrator (plan
// Ruling 10) and keeps owning the chart's data wiring.
// Below `xl` (1280px) the row stacks card-then-chart in one column.
import { useState, type ReactNode } from "react";
import type { Lang } from "./i18n";
import type { PlanGranularity } from "./types";
import type { ForecastBundle } from "./budget-forecast-bundle";
import { useSettings } from "./use-settings";
import { ForecastBanners } from "./budget-forecast-banner";
import { ForecastCards, type ForecastView } from "./budget-forecast-cards";
import { RateMixDetails } from "./budget-rate-mix-details";

export function ForecastSection({
  lang, bundle, granularity, chart, belowRow = null,
}: {
  lang: Lang; bundle: ForecastBundle; granularity: PlanGranularity;
  /** The chart column's content; the caller keeps owning the chart's data wiring. */
  chart: ReactNode;
  /** Full-width content under the row (the Budget report's recorded-change table). */
  belowRow?: ReactNode;
}) {
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
      <div className="flex flex-col gap-3 xl:flex-row">
        <div className="xl:w-[30%]">
          <ForecastCards
            lang={lang} forecast={eur} hours={hours} mix={mix} history={history}
            view={view}
            onViewChange={(v) => setSettings((s) => ({ ...s, budgetForecastView: v }))}
          />
        </div>
        <div className="min-w-0 flex-1">{chart}</div>
      </div>
      {belowRow}
    </div>
  );
}
