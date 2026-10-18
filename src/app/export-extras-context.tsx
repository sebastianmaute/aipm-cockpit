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
// path. The two workspace exports read the source at the click: the Projects
// panel's "export current project" takes it from this context (main window and
// popout alike) and hands it to task-manager's handler; the header Export menu,
// which is mounted on views where `WorkspaceSection` is not, derives its own from
// the same recipe (`useWorkspaceForecastDecisionSource`). Neither is a published
// module slot — that held the last mounted section's source, so it was empty on
// the modern shell's Open Points, Settings and Learning insights views.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ExportExtras } from "./export-forecast-section";
import type { ForecastBundle } from "./budget-forecast-bundle";
import type { ForecastDecisionHandle, ForecastDecisionSource } from "./forecast-decision";

const NO_EXTRAS: ExportExtras = {};

const Ctx = createContext<ExportExtras>(NO_EXTRAS);

/** A workspace export's extras: the budget forecast, plus the decision source when the simulation offers one. */
export function workspaceExportExtras(budgetForecast: ForecastBundle | null, forecastDecision: ForecastDecisionSource | null | undefined): ExportExtras {
  return forecastDecision ? { budgetForecast, forecastDecision } : { budgetForecast };
}

export function ExportExtrasProvider({
  forecast,
  forecastDecision = null,
  children,
}: {
  /** `exportForecastFor(settings.features, dashboardModel.forecastBundle)`:
   *  null with the budget module off or no forecast. */
  forecast: ForecastBundle | null | undefined;
  /** `useForecastDecisionSource`'s handle; null while the simulation is off, and then both keys are absent. */
  forecastDecision?: ForecastDecisionHandle | null;
  children: ReactNode;
}) {
  const value = useMemo<ExportExtras>(() => {
    if (!forecast && !forecastDecision) return NO_EXTRAS;
    return {
      ...(forecast ? { budgetForecast: forecast } : {}),
      ...(forecastDecision ? { forecastDecision: forecastDecision.source, forecastDecisionLive: forecastDecision.live } : {}),
    };
  }, [forecast, forecastDecision]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useExportExtras(): ExportExtras {
  return useContext(Ctx);
}
