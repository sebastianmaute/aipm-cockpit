"use client";

// open-followups §545 — what a derived document `dataSection` needs beyond the
// workspace: today, the budget forecast. Provided ONCE by `WorkspaceSection`
// from task-manager's `exportForecast` (the same value the workspace export
// receives) and read by every leaf that renders or downloads a document: the
// preview, the history-row preview, the Documents pane's downloads and the
// chat document card.
//
// ★ A context rather than a prop chain because those leaves sit two to four
//   hops below the section, under memoised panels (`ChatPanel`); a prop
//   threaded through them would hand each a fresh identity on every forecast
//   change, and a hop forgotten would render a `budgetForecast` block as
//   nothing with no error.
// ★ The default is `{}` — no provider means no forecast, which is exactly what
//   a renderer does with the argument omitted. A popout or a test that mounts
//   a leaf alone keeps working and renders the block as nothing.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ExportExtras } from "./export-forecast-section";
import type { ForecastBundle } from "./budget-forecast-bundle";

const NO_EXTRAS: ExportExtras = {};

const Ctx = createContext<ExportExtras>(NO_EXTRAS);

export function ExportExtrasProvider({
  forecast,
  children,
}: {
  /** `exportForecastFor(settings.features, dashboardModel.forecastBundle)`:
   *  null with the budget module off or no forecast. */
  forecast: ForecastBundle | null | undefined;
  children: ReactNode;
}) {
  const value = useMemo<ExportExtras>(
    () => (forecast ? { budgetForecast: forecast } : NO_EXTRAS),
    [forecast],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useExportExtras(): ExportExtras {
  return useContext(Ctx);
}
