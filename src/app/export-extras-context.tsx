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
//   a renderer does with the argument omitted. A test that mounts a leaf
//   alone keeps working and renders the block as nothing. Popouts are NOT
//   that case: their `legacyTree` renders `WorkspaceSection` too, from the
//   popout's own `workspaceProps`, so they get the provider and the forecast.
//
// §502 part 4 — the simulated forecast decision rides here too, as a lazy
// source (`ForecastDecisionSource`): nothing runs until a document block or an
// export asks for the section. Previews read its `forecastDecisionLive` half
// instead (`usePreviewExportExtras`), so their lever search runs off the render
// path. The header Export menu and task-manager's export handler (the Projects
// panel's "export current project") are built by task-manager, so the main
// window's provider also PUBLISHES its source, and those two call sites read it
// through `withPublishedForecastDecision` at the click — no prop threaded
// through the shell, and no engine run for an export that leaves the section out.
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { ExportExtras } from "./export-forecast-section";
import type { ForecastBundle } from "./budget-forecast-bundle";
import type { ForecastDecisionHandle, ForecastDecisionSource } from "./forecast-decision";

const NO_EXTRAS: ExportExtras = {};

const Ctx = createContext<ExportExtras>(NO_EXTRAS);

/** The main window's current source; null while the simulation is off or no provider publishes. */
const published: { source: ForecastDecisionSource | null } = { source: null };

/** `extras` plus the published forecast decision source, when there is one; unchanged otherwise. */
export function withPublishedForecastDecision(extras: ExportExtras): ExportExtras {
  const source = published.source;
  return source === null ? extras : { ...extras, forecastDecision: source };
}

export function ExportExtrasProvider({
  forecast,
  forecastDecision = null,
  publish = false,
  children,
}: {
  /** `exportForecastFor(settings.features, dashboardModel.forecastBundle)`:
   *  null with the budget module off or no forecast. */
  forecast: ForecastBundle | null | undefined;
  /** `useForecastDecisionSource`'s handle; null while the simulation is off, and then both keys are absent. */
  forecastDecision?: ForecastDecisionHandle | null;
  /** Publish the source for the exports built outside this tree (the main window only, never a popout). */
  publish?: boolean;
  children: ReactNode;
}) {
  const value = useMemo<ExportExtras>(() => {
    if (!forecast && !forecastDecision) return NO_EXTRAS;
    return {
      ...(forecast ? { budgetForecast: forecast } : {}),
      ...(forecastDecision ? { forecastDecision: forecastDecision.source, forecastDecisionLive: forecastDecision.live } : {}),
    };
  }, [forecast, forecastDecision]);
  const source = forecastDecision?.source ?? null;
  useEffect(() => {
    if (!publish || source === null) return undefined;
    published.source = source;
    return () => {
      if (published.source === source) published.source = null;
    };
  }, [publish, source]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useExportExtras(): ExportExtras {
  return useContext(Ctx);
}